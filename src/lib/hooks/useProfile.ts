"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

export type SessionProfile = Pick<
  Tables<"profiles">,
  "id" | "organization_id" | "role" | "email"
>;

type UseProfileResult = {
  profile: SessionProfile | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolves the authenticated user's profile (id, organization_id, role).
 *
 * organization_id is ALWAYS read from the session-bound profile row here and
 * passed to writes - never accepted from a form field or request body
 * (Behavioral Contracts §2). RLS is the second barrier on every query.
 */
export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (active) {
          setError("Your session has expired. Please sign in again.");
          setLoading(false);
        }
        return;
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("id, organization_id, role, email")
        .eq("id", user.id)
        .single();

      if (!active) return;

      if (profileError || !data) {
        setError("Could not load your profile.");
      } else {
        setProfile(data);
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  return { profile, loading, error };
}

/** Roles permitted to create or edit records. viewer is read-only (BLUEPRINT §3.2). */
export function canEdit(role: SessionProfile["role"] | undefined): boolean {
  return role === "owner" || role === "admin" || role === "writer";
}

/** Roles permitted to delete funders. writer cannot delete funders (BLUEPRINT §3.2). */
export function canDeleteFunder(
  role: SessionProfile["role"] | undefined,
): boolean {
  return role === "owner" || role === "admin";
}
