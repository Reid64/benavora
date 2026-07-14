"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, Image } from "lucide-react";

import { Button, Card, Input, LoadingSpinner } from "@/components/ui";
import { recordAudit } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { loadBrandingSettings, type BrandingSettings } from "@/lib/utils/branding";
import { useProfile } from "@/lib/hooks/useProfile";

function canManageOrg(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export default function BrandingPage() {
  const { profile, loading: profileLoading } = useProfile();
  const manage = canManageOrg(profile?.role);

  const [orgId, setOrgId] = useState<string | null>(null);
  const [settings, setSettings] = useState<BrandingSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id")
      .limit(1)
      .single();

    if (orgError || !org) {
      setLoadError("Could not load your organization.");
      setLoading(false);
      return;
    }

    setOrgId(org.id);
    const s = await loadBrandingSettings(supabase);
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (profileLoading || loading) {
    return <LoadingSpinner center label="Loading branding settings..." />;
  }

  if (loadError || !settings || !orgId) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {loadError ?? "Could not load branding settings."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Branding
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Customize your organization&apos;s visual identity across the platform and
          outgoing communications.
        </p>
      </div>

      {!manage && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          Only owners and admins can change branding settings.
        </div>
      )}

      <LogoSection
        orgId={orgId}
        current={settings.logo_url}
        canManage={manage}
        onSaved={(url) => setSettings((s) => s ? { ...s, logo_url: url } : s)}
      />

      <ColorsSection
        orgId={orgId}
        primary={settings.primary_color}
        secondary={settings.secondary_color}
        accent={settings.accent_color}
        canManage={manage}
        onSaved={(primary, secondary, accent) =>
          setSettings((s) =>
            s ? { ...s, primary_color: primary, secondary_color: secondary, accent_color: accent } : s
          )
        }
      />

      <MessagesSection
        orgId={orgId}
        loginMessage={settings.login_message}
        footerText={settings.footer_text}
        canManage={manage}
        onSaved={(loginMessage, footerText) =>
          setSettings((s) => s ? { ...s, login_message: loginMessage, footer_text: footerText } : s)
        }
      />

      <EmailBrandingSection
        orgId={orgId}
        fromName={settings.email_from_name}
        emailFooter={settings.email_footer}
        canManage={manage}
        onSaved={(fromName, emailFooter) =>
          setSettings((s) => s ? { ...s, email_from_name: fromName, email_footer: emailFooter } : s)
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo upload
// ---------------------------------------------------------------------------

function LogoSection({
  orgId,
  current,
  canManage,
  onSaved,
}: {
  orgId: string;
  current: string;
  canManage: boolean;
  onSaved: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      setError("Please select a PNG, JPEG, WebP, or SVG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be smaller than 2 MB.");
      return;
    }

    setError(null);
    setSaved(false);
    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!selectedFile) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const bucket = `org-${orgId}`;
    const ext = selectedFile.name.split(".").pop() ?? "png";
    const path = `branding/logo-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(path, selectedFile, { contentType: selectedFile.type, upsert: true });

    if (uploadError) {
      setError(uploadError.message);
      setSaving(false);
      return;
    }

    const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
    const logoUrl = urlData.publicUrl;

    const { error: configError } = await supabase.from("platform_config").upsert(
      { organization_id: orgId, key: "branding.logo_url", value: logoUrl },
      { onConflict: "organization_id,key" },
    );

    if (configError) {
      await supabase.storage.from(bucket).remove([path]);
      setError(configError.message);
      setSaving(false);
      return;
    }

    void recordAudit({
      action: "update",
      entityType: "organization",
      entityId: orgId,
      details: { field: "branding.logo_url" },
    });

    onSaved(logoUrl);
    setSelectedFile(null);
    setSaved(true);
    setSaving(false);
  }

  const displaySrc = preview ?? (current || null);

  return (
    <Card
      title="Organization Logo"
      description="Displayed on the login page, email headers, and reports. PNG, JPEG, WebP, or SVG up to 2 MB."
    >
      <div className="space-y-4">
        {displaySrc ? (
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displaySrc}
              alt="Organization logo preview"
              className="h-16 w-auto max-w-[200px] rounded-lg border border-navy-200 object-contain p-1"
            />
            {preview && (
              <span className="text-xs text-navy-400">Preview — not yet saved</span>
            )}
          </div>
        ) : (
          <div className="flex h-16 w-40 items-center justify-center rounded-lg border-2 border-dashed border-navy-200 bg-navy-50">
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image className="h-6 w-6 text-navy-300" aria-hidden />
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              onChange={handleFileChange}
              aria-label="Select logo file"
            />
            <Button
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={saving}
            >
              Choose file
            </Button>
            {selectedFile && (
              <Button onClick={() => void handleSave()} isLoading={saving}>
                Upload logo
              </Button>
            )}
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-4 w-4" aria-hidden />
                Saved
              </span>
            )}
            {selectedFile && !saving && (
              <span className="text-sm text-navy-500 truncate max-w-xs">
                {selectedFile.name}
              </span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

function ColorsSection({
  orgId,
  primary,
  secondary,
  accent,
  canManage,
  onSaved,
}: {
  orgId: string;
  primary: string;
  secondary: string;
  accent: string;
  canManage: boolean;
  onSaved: (primary: string, secondary: string, accent: string) => void;
}) {
  const [primaryColor, setPrimaryColor] = useState(primary);
  const [secondaryColor, setSecondaryColor] = useState(secondary);
  const [accentColor, setAccentColor] = useState(accent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const HEX_RE = /^#[0-9a-fA-F]{6}$/;

  function validateHex(val: string): boolean {
    return HEX_RE.test(val);
  }

  async function handleSave() {
    if (!validateHex(primaryColor) || !validateHex(secondaryColor) || !validateHex(accentColor)) {
      setError("All colors must be valid 6-digit hex codes (e.g. #1e40af).");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const rows = [
      { organization_id: orgId, key: "branding.primary_color", value: primaryColor },
      { organization_id: orgId, key: "branding.secondary_color", value: secondaryColor },
      { organization_id: orgId, key: "branding.accent_color", value: accentColor },
    ];

    const { error: configError } = await supabase
      .from("platform_config")
      .upsert(rows, { onConflict: "organization_id,key" });

    setSaving(false);
    if (configError) {
      setError(configError.message);
      return;
    }

    void recordAudit({
      action: "update",
      entityType: "organization",
      entityId: orgId,
      details: { field: "branding.colors" },
    });

    onSaved(primaryColor, secondaryColor, accentColor);
    setSaved(true);
  }

  return (
    <Card
      title="Color Palette"
      description="Brand colors used in white-label portals and email templates."
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorField
            label="Primary color"
            value={primaryColor}
            onChange={setPrimaryColor}
            disabled={!canManage}
          />
          <ColorField
            label="Secondary color"
            value={secondaryColor}
            onChange={setSecondaryColor}
            disabled={!canManage}
          />
          <ColorField
            label="Accent color"
            value={accentColor}
            onChange={setAccentColor}
            disabled={!canManage}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {canManage && (
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-4 w-4" aria-hidden />
                Saved
              </span>
            )}
            <Button onClick={() => void handleSave()} isLoading={saving}>
              Save colors
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-navy-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`${label} picker`}
          className="h-9 w-10 cursor-pointer rounded border border-navy-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={7}
          placeholder="#000000"
          aria-label={`${label} hex value`}
          className="flex-1 rounded-lg border border-navy-300 px-3 py-2 text-sm font-mono text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-navy-50 disabled:opacity-60"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login message + footer text
// ---------------------------------------------------------------------------

function MessagesSection({
  orgId,
  loginMessage,
  footerText,
  canManage,
  onSaved,
}: {
  orgId: string;
  loginMessage: string;
  footerText: string;
  canManage: boolean;
  onSaved: (loginMessage: string, footerText: string) => void;
}) {
  const [login, setLogin] = useState(loginMessage);
  const [footer, setFooter] = useState(footerText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const rows = [
      { organization_id: orgId, key: "branding.login_message", value: login.trim() },
      { organization_id: orgId, key: "branding.footer_text", value: footer.trim() },
    ];

    const { error: configError } = await supabase
      .from("platform_config")
      .upsert(rows, { onConflict: "organization_id,key" });

    setSaving(false);
    if (configError) {
      setError(configError.message);
      return;
    }

    void recordAudit({
      action: "update",
      entityType: "organization",
      entityId: orgId,
      details: { field: "branding.messages" },
    });

    onSaved(login.trim(), footer.trim());
    setSaved(true);
  }

  return (
    <Card
      title="Page Messages"
      description="Custom text shown on the login page and in the application footer."
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="login-message"
            className="block text-sm font-medium text-navy-700"
          >
            Login page message
          </label>
          <textarea
            id="login-message"
            value={login}
            onChange={(e) => { setLogin(e.target.value); setSaved(false); }}
            disabled={!canManage}
            rows={3}
            maxLength={500}
            placeholder="Welcome to your funding automation platform."
            className="w-full resize-none rounded-lg border border-navy-300 px-3 py-2 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-navy-50 disabled:opacity-60"
          />
          <p className="text-right text-xs text-navy-400">{login.length}/500</p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="footer-text"
            className="block text-sm font-medium text-navy-700"
          >
            Footer text
          </label>
          <textarea
            id="footer-text"
            value={footer}
            onChange={(e) => { setFooter(e.target.value); setSaved(false); }}
            disabled={!canManage}
            rows={2}
            maxLength={200}
            placeholder="© 2026 Your Organization. All rights reserved."
            className="w-full resize-none rounded-lg border border-navy-300 px-3 py-2 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-navy-50 disabled:opacity-60"
          />
          <p className="text-right text-xs text-navy-400">{footer.length}/200</p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {canManage && (
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-4 w-4" aria-hidden />
                Saved
              </span>
            )}
            <Button onClick={() => void handleSave()} isLoading={saving}>
              Save messages
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Email branding
// ---------------------------------------------------------------------------

function EmailBrandingSection({
  orgId,
  fromName,
  emailFooter,
  canManage,
  onSaved,
}: {
  orgId: string;
  fromName: string;
  emailFooter: string;
  canManage: boolean;
  onSaved: (fromName: string, emailFooter: string) => void;
}) {
  const [name, setName] = useState(fromName);
  const [footer, setFooter] = useState(emailFooter);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createClient();
    const rows = [
      { organization_id: orgId, key: "branding.email_from_name", value: name.trim() },
      { organization_id: orgId, key: "branding.email_footer", value: footer.trim() },
    ];

    const { error: configError } = await supabase
      .from("platform_config")
      .upsert(rows, { onConflict: "organization_id,key" });

    setSaving(false);
    if (configError) {
      setError(configError.message);
      return;
    }

    void recordAudit({
      action: "update",
      entityType: "organization",
      entityId: orgId,
      details: { field: "branding.email" },
    });

    onSaved(name.trim(), footer.trim());
    setSaved(true);
  }

  return (
    <Card
      title="Email Template Branding"
      description="Shown in outgoing emails sent through the platform (outreach, follow-ups, notifications)."
    >
      <div className="space-y-4">
        <Input
          label="Sender display name"
          value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }}
          disabled={!canManage}
          placeholder="Reid's Faith Foundation"
          helperText="Appears as the 'from' name on outgoing emails."
        />

        <div className="space-y-1.5">
          <label
            htmlFor="email-footer"
            className="block text-sm font-medium text-navy-700"
          >
            Email footer
          </label>
          <textarea
            id="email-footer"
            value={footer}
            onChange={(e) => { setFooter(e.target.value); setSaved(false); }}
            disabled={!canManage}
            rows={3}
            maxLength={500}
            placeholder="This email was sent by Reid's Faith Foundation. To unsubscribe, reply with 'Unsubscribe'."
            className="w-full resize-none rounded-lg border border-navy-300 px-3 py-2 text-sm text-navy-900 shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-navy-50 disabled:opacity-60"
          />
          <p className="text-right text-xs text-navy-400">{footer.length}/500</p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {canManage && (
          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-4 w-4" aria-hidden />
                Saved
              </span>
            )}
            <Button onClick={() => void handleSave()} isLoading={saving}>
              Save email branding
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

