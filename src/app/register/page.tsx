"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/layout/Logo";
import { isValidEmail } from "@/lib/utils/validators";

/**
 * New organization signup (BLUEPRINT US-01).
 *
 * Registration creates a Supabase auth user, then bootstraps an organization
 * and an owner profile via the SECURITY DEFINER `register_organization()` RPC
 * (migration 002). organization name and full name are written to auth metadata
 * at sign-up and read server-side by the RPC — never from a request body
 * (Behavioral Contracts §2). role is hard-coded to 'owner' inside the RPC.
 *
 * Two paths, depending on the project's email-confirmation setting:
 *   - Confirmation OFF: sign-up returns a session, we bootstrap immediately and
 *     land on the dashboard.
 *   - Confirmation ON: no session yet; we show "check your email". The
 *     /api/auth/callback route bootstraps the org after the link is clicked.
 */
export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (organizationName.trim().length === 0) {
      setError("Enter your organization name.");
      return;
    }
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const emailRedirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/auth/callback`
        : undefined;

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo,
        data: {
          organization_name: organizationName.trim(),
          full_name: fullName.trim(),
        },
      },
    });

    if (signUpError) {
      setError(
        /already|registered|exists/i.test(signUpError.message)
          ? "That email is already registered. Try signing in instead."
          : signUpError.message,
      );
      setSubmitting(false);
      return;
    }

    // No session means email confirmation is required.
    if (!data.session) {
      setCheckEmail(true);
      setSubmitting(false);
      return;
    }

    // Session is live — bootstrap the organization and owner profile.
    const { error: rpcError } = await supabase.rpc("register_organization");
    if (rpcError) {
      setError(
        "Your account was created but the organization could not be set up. Please sign in to finish.",
      );
      setSubmitting(false);
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen bg-surface">
      {/* Brand panel — large screens only */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-plum-600/25 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10">
          <Logo size={40} />
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Fund More.{" "}
            <span className="text-teal-400">Do More.</span>{" "}
            <span className="text-plum-400">Change More.</span>
          </h1>
          <p className="mt-5 text-navy-200">
            Create your organization workspace in seconds. Discover
            opportunities, draft applications with AI, and track every deadline
            from one place.
          </p>
        </div>
        <p className="relative z-10 text-sm text-navy-400">
          Nonprofit funding automation platform
        </p>
      </aside>

      {/* Form panel */}
      <section className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo size={40} />
          </div>

          {checkEmail ? (
            <div
              role="status"
              className="rounded-lg border border-plum-200 bg-plum-50 px-5 py-6"
            >
              <h2 className="text-lg font-semibold text-plum-900">
                Check your email
              </h2>
              <p className="mt-2 text-sm text-plum-800">
                We sent a confirmation link to{" "}
                <span className="font-medium">{email.trim()}</span>. Click it to
                activate your account and set up your organization.
              </p>
              <Link
                href="/login"
                className="mt-4 inline-block text-sm font-semibold text-teal-600 transition hover:text-teal-700"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold tracking-tight text-navy-900">
                Create your account
              </h2>
              <p className="mt-2 text-sm text-navy-500">
                Set up your organization workspace.
              </p>

              <form
                onSubmit={handleSubmit}
                className="mt-8 space-y-5"
                noValidate
              >
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  >
                    {error}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="organizationName"
                    className="block text-sm font-medium text-navy-700"
                  >
                    Organization name
                  </label>
                  <input
                    id="organizationName"
                    name="organizationName"
                    type="text"
                    autoComplete="organization"
                    required
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                    placeholder="Your Faith Foundation"
                  />
                </div>

                <div>
                  <label
                    htmlFor="fullName"
                    className="block text-sm font-medium text-navy-700"
                  >
                    Your name
                  </label>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                    placeholder="Jane Doe"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-navy-700"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                    placeholder="you@organization.org"
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="block text-sm font-medium text-navy-700"
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="block text-sm font-medium text-navy-700"
                  >
                    Confirm password
                  </label>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center rounded-lg bg-gradient-accent bg-[length:200%_100%] bg-left px-4 py-2.5 text-sm font-semibold text-white shadow-glow-blue transition hover:bg-right hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Creating account…" : "Create account"}
                </button>
              </form>

              <p className="mt-8 text-center text-sm text-navy-500">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-teal-600 transition hover:text-teal-700"
                >
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
