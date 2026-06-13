"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Invitation acceptance form (BLUEPRINT US-03). The email is fixed by the
 * invitation (pre-filled, read-only); the invitee supplies their name and a
 * password. On submit it calls the public accept route - which creates the auth
 * user + profile with the invited role server-side - then signs in and lands on
 * the dashboard.
 */
export function AcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    const res = await fetch("/api/users/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password, full_name: fullName.trim() }),
    });
    const data = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!res.ok) {
      setError(data?.error ?? "Could not accept the invitation.");
      setSubmitting(false);
      return;
    }

    // Account created server-side - establish a session and enter the app.
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      // Account exists but auto sign-in failed; send them to sign in manually.
      router.replace("/login");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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
          type="email"
          value={email}
          readOnly
          className="mt-1.5 block w-full cursor-not-allowed rounded-lg border border-navy-200 bg-navy-50 px-3 py-2.5 text-sm text-navy-500 shadow-sm outline-none"
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
          htmlFor="password"
          className="block text-sm font-medium text-navy-700"
        >
          Password
        </label>
        <input
          id="password"
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
        {submitting ? "Setting up your account…" : "Accept invitation"}
      </button>
    </form>
  );
}
