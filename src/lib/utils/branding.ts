import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type BrandingSettings = {
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  login_message: string;
  footer_text: string;
  email_from_name: string;
  email_footer: string;
};

const DEFAULTS: BrandingSettings = {
  logo_url: "",
  primary_color: "#3D6B50",
  secondary_color: "#1e40af",
  accent_color: "#C49A4F",
  login_message: "",
  footer_text: "",
  email_from_name: "",
  email_footer: "",
};

const KEY_MAP: Record<string, keyof BrandingSettings> = {
  "branding.logo_url": "logo_url",
  "branding.primary_color": "primary_color",
  "branding.secondary_color": "secondary_color",
  "branding.accent_color": "accent_color",
  "branding.login_message": "login_message",
  "branding.footer_text": "footer_text",
  "branding.email_from_name": "email_from_name",
  "branding.email_footer": "email_footer",
};

export async function loadBrandingSettings(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<BrandingSettings> {
  const { data, error } = await supabase
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .like("key", "branding.%");

  if (error || !data) return { ...DEFAULTS };

  const result: BrandingSettings = { ...DEFAULTS };
  for (const row of data) {
    const field = KEY_MAP[row.key];
    if (field) result[field] = row.value;
  }
  return result;
}
