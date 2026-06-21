import "server-only";

import { createClient } from "@/lib/supabase/server";

// MVP: Reid's user ID is the only platform admin. Set PLATFORM_ADMIN_USER_ID in
// .env.local to the Supabase auth user ID for reid@repvg.com. A future iteration
// should check a platform_admins table instead.
const ADMIN_USER_IDS = new Set(
  [process.env.PLATFORM_ADMIN_USER_ID].filter(Boolean),
);

export interface AdminContext {
  userId: string;
}

export async function requireAdmin(_request: Request): Promise<AdminContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Response(
      JSON.stringify({ error: "Authentication required.", code: "unauthenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!ADMIN_USER_IDS.has(user.id)) {
    throw new Response(
      JSON.stringify({ error: "Platform admin access required.", code: "not_platform_admin" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return { userId: user.id };
}
