// Billing management's real implementation lives at (dashboard)/billing/page.tsx
// (BLUEPRINT Phase 5). Rendered directly here — not a redirect — so that
// reaching Billing from the Settings tab strip keeps the shared
// SettingsLayout (settings/layout.tsx) sub-navigation on screen instead of
// dropping to a bare top-level route with no tab strip at all.
export { default } from "../../billing/page";
