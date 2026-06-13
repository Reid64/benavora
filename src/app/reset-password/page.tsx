"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/layout/Logo";

/**
 * Set a new password from a recovery link (BEHAVIORAL_CONTRACTS auth flow
 * "Password Reset", steps 5-8).
 *
 * The recovery email points here. Supabase's PKCE flow appends `?code=...`; we
 * exchange it for a short-lived recovery session on mount. (Hash-based recovery
 * tokens, if used, are auto-detected by the browser client.) The user then
 * submits a new password via supabase.auth.updateUser. On success we land on
 * the dashboard; a failed update means the link expired or was already used.
 *
 * The URL is read from window.location rather than useSearchParams so the page
 * needs no Suspense boundary for static export.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [linkError, setLinkError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const code =
      typeof window !== "undefined"
        ? new URL(window.location.href).searchParams.get("code")
        : null;

    (async () => {
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setLinkError(true);
        }
      }
      setChecking(false);
    })();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

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
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(
        "Password reset failed. The link may have expired. Please request a new one.",
      );
      setSubmitting(false);
      return;
    }

    setDone(true);
    // Session is now authenticated with the new password - enter the app.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size={40} />
        </div>

        {checking ? (
          <p className="text-center text-sm text-navy-500">
            Validating your reset link...
          </p>
        ) : linkError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-5 py-6 text-center"
          >
            <h1 className="text-lg font-semibold text-red-900">
              This link is no longer valid
            </h1>
            <p className="mt-2 text-sm text-red-700">
              Password reset links expire after a short time and can only be used
              once. Request a fresh link to continue.
            </p>
            <Link
              href="/forgot-password"
              className="mt-4 inline-block text-sm font-semibold text-teal-600 transition hover:text-teal-700"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-center text-2xl font-semibold tracking-tight text-navy-900">
              Set a new password
            </h1>
            <p className="mt-2 text-center text-sm text-navy-500">
              Choose a new password for your account.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
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
                  htmlFor="password"
                  className="block text-sm font-medium text-navy-700"
                >
                  New password
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
                  Confirm new password
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
                disabled={submitting || done}
                className="flex w-full items-center justify-center rounded-lg bg-gradient-accent bg-[length:200%_100%] bg-left px-4 py-2.5 text-sm font-semibold text-white shadow-glow-blue transition hover:bg-right hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting || done ? "Updating..." : "Update password"}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-navy-500">
              <Link
                href="/login"
                className="font-semibold text-teal-600 transition hover:text-teal-700"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
