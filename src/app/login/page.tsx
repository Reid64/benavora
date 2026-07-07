"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/layout/Logo";
import { recordAuthEvent } from "@/lib/audit/client";
import { isValidEmail } from "@/lib/utils/validators";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length === 0) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Email or password is incorrect."
          : signInError.message,
      );
      setSubmitting(false);
      return;
    }

    // Record the login (best-effort) now that the session cookie is set
    // (Behavioral Contracts §24). Awaited so the audit fires before navigation.
    await recordAuthEvent("login");

    // Session cookies are set; refresh so the middleware sees them.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen bg-surface">
      {/* Brand panel - large screens only */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-900 p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-primary/25 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10">
          <Logo size={40} />
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Fund More.{" "}
            <span className="text-teal-400">Do More.</span>{" "}
            <span className="text-accent">Change More.</span>
          </h1>
          <p className="mt-5 text-navy-200">
            AI-powered grant research, drafting, and lifecycle tracking - built
            so a single operator can run hundreds of opportunities without
            anything slipping through.
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

          <h2 className="text-2xl font-semibold tracking-tight text-navy-900">
            Welcome back
          </h2>
          <p className="mt-2 text-sm text-navy-500">
            Sign in to your organization&rsquo;s workspace.
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

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-navy-700"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-teal-600 transition hover:text-teal-700"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-900 shadow-sm outline-none transition placeholder:text-navy-300 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center rounded-lg bg-gradient-accent bg-[length:200%_100%] bg-left px-4 py-2.5 text-sm font-semibold text-white shadow-glow-blue transition hover:bg-right hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-navy-500">
            Don&rsquo;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-teal-600 transition hover:text-teal-700"
            >
              Create one
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
