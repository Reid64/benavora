import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// ============================================================================
// Auth middleware - FULL FILE REPLACEMENT ONLY (never patch).
//
// Runs on every matched request. Responsibilities, in strict order:
//   1. Refresh the Supabase session (getUser auto-refreshes the token cookie).
//   2. For protected routes, confirm the caller has a valid profile row and
//      derive organization_id + role from it.
//   3. On ANY role-fetch failure - query error, missing row, or null
//      organization_id - redirect to /login ONLY. Never render a default or
//      wrong-role page (Iron Law 4).
//   4. On success, inject x-user-id / x-organization-id / x-user-role /
//      x-onboarding-edit-restricted / x-pathname headers so downstream
//      layouts and handlers can read the authoritative identity and current
//      path without re-trusting anything from the request body (Six Laws
//      Law 2).
//
// Identity is re-read from the database on every request; role data is never
// cached in cookies or local state, so a revoked or downgraded role takes
// effect immediately (no stale-role exploitation).
//
// NOTE ON ROLE VALUES: this build's user_role enum is
// owner | admin | writer | viewer (migration 001 / SCHEMA_REGISTRY), the live
// authoritative model the whole app is built on. The BEHAVIORAL_CONTRACTS auth
// section names roles admin | member | viewer against a `users` table; that
// naming was never the implemented schema. x-user-role therefore carries the
// real enum value. Server enforcement lives in @/lib/auth/role-gate
// (requireRole), which re-derives the profile per request as a second barrier.
//
// NOTE ON x-onboarding-edit-restricted (migration 138, Demo Account Scope):
// mirrors profiles.restricted_onboarding_edit. Route handlers that write
// onboarding-authored organizational data (organizations' protected columns,
// knowledge_base, board_members, programs, organizational_digital_twins,
// documents) check this header to return a clean 403 instead of letting the
// caller hit a raw Postgres trigger exception. The DB-layer triggers
// (is_onboarding_edit_restricted()) remain the authoritative enforcement -
// this header is a UX nicety only, same as x-user-role is only a first-layer
// hint ahead of requireRole's own re-query.
// ============================================================================

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

// Session cookie (no Max-Age) set by the onboarding wizard's "Explore the
// platform first" link. Must match ONBOARDING_SKIP_COOKIE in
// src/app/(dashboard)/onboarding/page.tsx.
const ONBOARDING_SKIP_COOKIE = "benavora_onboarding_skip";

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Supabase auth callback (email confirmation, recovery, magic links) and the
  // log-event endpoint are reached before a full profile exists.
  if (pathname.startsWith("/api/auth")) return true;
  // Public invitation acceptance: the invitee has no session yet (BLUEPRINT
  // US-03). The page and its accept endpoint are reached via a bearer token.
  if (pathname === "/invite" || pathname.startsWith("/invite/")) return true;
  if (pathname === "/api/users/accept") return true;
  return false;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const isPublic = isPublicPath(request.nextUrl.pathname);

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured we cannot authenticate. Protected routes
  // redirect to /login; public routes pass through.
  if (!url || !anonKey) {
    if (isPublic) return response;
    return redirectToLogin(request);
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: getUser() refreshes the session. Do not run code between
  // creating the client and this call. If the token is expired and the refresh
  // token is missing or invalid, `user` comes back null.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes never block, even for signed-in users.
  if (isPublic) return response;

  // Protected route with no (refreshable) session -> /login.
  if (!user) {
    return redirectToLogin(request);
  }

  // Resolve the caller's profile to confirm organization_id + role. The
  // profiles RLS policy lets a user read their own row (id = auth.uid()), so the
  // session client suffices - no service-role key on the edge. ANY failure here
  // redirects to /login ONLY (Iron Law 4): a missing/broken profile must never
  // render the app with a default or wrong role.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id, role, restricted_onboarding_edit")
    .eq("id", user.id)
    .single();

  if (
    profileError ||
    !profile ||
    !profile.organization_id ||
    !profile.role
  ) {
    return redirectToLogin(request);
  }

  // Inject the authoritative identity and current path for downstream pages /
  // route handlers. Cloned from the (cookie-refreshed) request; the refreshed
  // auth cookies set on `response` are carried over below.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", user.id);
  requestHeaders.set("x-organization-id", profile.organization_id as string);
  requestHeaders.set("x-user-role", profile.role as string);
  requestHeaders.set(
    "x-onboarding-edit-restricted",
    profile.restricted_onboarding_edit === true ? "true" : "false",
  );
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  // Onboarding gate: redirect to /onboarding if not completed. Bypassed for
  // the current browser session once the user picks "Explore the platform
  // first" on the wizard (sets ONBOARDING_SKIP_COOKIE, a session cookie with
  // no Max-Age) - a fresh login in a new session still lands on /onboarding.
  if (profile.organization_id && !request.nextUrl.pathname.includes("onboarding")) {
    const skipOnboarding = request.cookies.get(ONBOARDING_SKIP_COOKIE);
    if (!skipOnboarding) {
      const { data: org } = await supabase
        .from("organizations")
        .select("onboarding_completed")
        .eq("id", profile.organization_id)
        .single();
      if (org && org.onboarding_completed === false) {
        const onboardingUrl = request.nextUrl.clone();
        onboardingUrl.pathname = "/onboarding";
        return NextResponse.redirect(onboardingUrl);
      }
    }
  }

  const authedResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.cookies.getAll().forEach((cookie) => {
    authedResponse.cookies.set(cookie);
  });
  return authedResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - files with an extension (e.g. .png, .svg)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.).*)",
  ],
};
