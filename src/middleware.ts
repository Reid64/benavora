import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// ============================================================================
// Auth middleware — FULL FILE REPLACEMENT ONLY (never patch).
//
// Refreshes the Supabase session on every request and gates the authenticated
// dashboard. If the session cannot be established for a protected route, the
// only action is a redirect to /login. No role defaults, no exceptions.
// ============================================================================

const PUBLIC_PATHS = ["/", "/login", "/register"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // Auth callback and Next internals are always public.
  if (pathname.startsWith("/api/auth")) return true;
  // Public invitation acceptance: the invitee has no session yet (BLUEPRINT
  // US-03). The page and its accept endpoint are reached via a bearer token.
  if (pathname === "/invite" || pathname.startsWith("/invite/")) return true;
  if (pathname === "/api/users/accept") return true;
  return false;
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured we cannot authenticate. Protected routes
  // redirect to /login; public routes pass through.
  if (!url || !anonKey) {
    if (isPublicPath(request.nextUrl.pathname)) return response;
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
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
  // creating the client and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
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
