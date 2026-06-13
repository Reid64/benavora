"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/layout/Logo";
import { isValidEmail } from "@/lib/utils/validators";

/**
 * Forgot-password request (BEHAVIORAL_CONTRACTS auth flow "Password Reset",
 * step 1-3). Submits an email and asks Supabase to send a recovery link that
 * redirects back to /reset-password.
 *
 * The confirmation message is intentionally neutral and shown regardless of
 * whether the email maps to an account - we never reveal which addresses are
 * registered (anti-enumeration). Only a hard transport/config failure surfaces
 * an error.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const redirectTo =
      typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : undefined;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo },
    );

    // Surface only genuine delivery/config failures; an "unknown email" is
    // reported as success on purpose (no account enumeration).
    if (resetError && /not configured|network|fetch|rate/i.test(resetError.message)) {
      setError("We couldn't send the reset email. Please try again in a moment.");
      setSubmitting(false);
      return;
    }

    setSent(true);
    setSubmitting(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo size={40} />
        </div>

        {sent ? (
          <div
            role="status"
            className="rounded-lg border border-plum-200 bg-plum-50 px-5 py-6"
          >
            <h1 className="text-lg font-semibold text-plum-900">
              Check your email
            </h1>
            <p className="mt-2 text-sm text-plum-800">
              If an account exists for{" "}
              <span className="font-medium">{email.trim()}</span>, we&rsquo;ve
              sent a link to reset your password. The link expires shortly, so
              use it soon.
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
            <h1 className="text-center text-2xl font-semibold tracking-tight text-navy-900">
              Reset your password
            </h1>
            <p className="mt-2 text-center text-sm text-navy-500">
              Enter the email tied to your account and we&rsquo;ll send a link to
              set a new password.
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

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center rounded-lg bg-gradient-accent bg-[length:200%_100%] bg-left px-4 py-2.5 text-sm font-semibold text-white shadow-glow-blue transition hover:bg-right hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Sending link…" : "Send reset link"}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-navy-500">
              Remembered it?{" "}
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
