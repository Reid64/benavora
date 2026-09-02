# SPEC_AUTH.md
## AFS — Authentication System
**Phase 3**
**Routes:** `/login`, `/register`, `/forgot-password`, `/reset-password`, `/invite/[token]`

---

## 1. OVERVIEW

Authentication uses Supabase Auth exclusively. No custom auth system.
No NextAuth. No Passport.js. Supabase SSR handles all session management.

Supported methods: Email + password (primary). Magic link / OTP (secondary).
No OAuth providers at launch.

---

## 2. ROLES

```
admin       Full access including admin portal
contractor  Account portal, quote requests, orders
architect   Account portal + full architect portal
customer    Same as contractor — default on registration
```

Role assignment on registration:
```typescript
const roleMap = {
  contractor: 'contractor',
  architect:  'architect',   // Admin review flagged, immediate access granted
  pm_gc:      'customer',
  other:      'customer',
};
```

---

## 3. REGISTRATION FLOW (`/register`)

```typescript
// Registration form fields:
interface RegistrationForm {
  email:        string;   // Required, valid format
  password:     string;   // Required, min 8 chars, at least 1 number or symbol
  fullName:     string;   // Required, min 2 chars
  company:      string;   // Optional
  phone:        string;   // Optional, validated format if provided
  accountType:  'contractor' | 'architect' | 'pm_gc' | 'other';
  // Additional if architect:
  firmName?:    string;
  licenseState?:string;
}

// Password strength indicator:
//   Weak (red):   < 8 chars OR letters only
//   Fair (amber): 8+ chars, mixed case OR numbers
//   Strong (green): 8+ chars, mixed + numbers + symbol

// On submit:
// 1. Client-side validation
// 2. Supabase Auth createUser()
// 3. Insert to profiles table (service role — bypasses RLS)
// 4. If architect: send admin notification email
// 5. Supabase sends confirmation email to user
// 6. Redirect to /register/confirm

// /register/confirm page:
//   "Check your email. We sent a confirmation link to {email}."
//   "Resend confirmation email" (rate limited: 1 per 60 seconds)
//   "Wrong email?" → back to /register
```

---

## 4. LOGIN FLOW (`/login`)

```typescript
// Two modes: password (default) | magic link (toggle)
// Query param: ?redirect={url} honored after auth
// Query param: ?error={code} shows error message

// Password mode:
//   Email + Password inputs
//   "Forgot password?" link → /forgot-password
//   "Sign in with magic link" toggle
//   Submit → Supabase signInWithPassword()
//   On success: redirect by role:
//     admin → /admin
//     all others → ?redirect param or /account

// Magic link mode:
//   Email input only
//   Submit → Supabase signInWithOtp()
//   Redirect to /login/magic-sent:
//     "Check your email. We sent a sign-in link to {email}."
//     "Link expires in 1 hour."

// Auth errors and messages:
//   Invalid credentials: "Email or password is incorrect."
//   Email not confirmed: "Please confirm your email first."
//   Rate limited: "Too many attempts. Try again in X minutes."
//   Generic: "Sign in failed. Please try again."
```

---

## 5. PASSWORD RESET

```
/forgot-password:
  Email input only
  Submit → Supabase resetPasswordForEmail()
  /forgot-password/sent:
    "If an account exists for {email}, we sent a reset link."
    (Never confirm or deny whether email exists)

User clicks email link:
  → /auth/callback processes token
  → Redirect to /reset-password
  → New password input (with confirmation)
  → Submit → Supabase updateUser()
  → Redirect to /login with toast: "Password updated. Please sign in."
```

---

## 6. AUTH CALLBACK ROUTE

```typescript
// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/account';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
```

---

## 7. TEAM INVITATION (`/invite/[token]`)

```typescript
// User receives team invitation email
// Clicks link → /invite/{token}
// If not logged in:
//   LoginForm pre-filled with invited email
//   OR RegistrationForm if no account
// After auth:
//   Token validated against pending invitation
//   User added to company with specified role
//   Redirect to /account with toast: "You've joined {companyName} on AFS"
```

---

## 8. SESSION MANAGEMENT

```typescript
// Session managed by Supabase SSR via cookies
// Access token: 1 hour expiry (Supabase default)
// Refresh token: rotated automatically via middleware.ts

// middleware.ts calls supabase.auth.getUser() on every protected request
// This refreshes the session if access token is expired
// NEVER use localStorage or sessionStorage for session data
// NEVER use browser Supabase client for server-component auth checks
```

---

## 9. ACCOUNT SETTINGS (`/account/settings`)

```typescript
// Profile section:
//   Full name, Company, Phone — all editable
//   Email — display only (change requires new confirmation)
//   Save → PATCH /api/account/profile

// Notification preferences:
//   Email order updates (default: true)
//   Email quote ready (default: true)
//   SMS order updates (default: false — requires phone)
//   SMS delivery alerts (default: false)
//   Save → PATCH /api/account/notifications

// Security:
//   "Change Password" → triggers Supabase password reset email flow

// Account type:
//   Display only: "Contractor Account"
//   "Request account type change" → email to admin
```

---

## 10. AUTH SHELL LAYOUT

```typescript
// components/layout/AuthShell.tsx
// Used on all auth pages: /login, /register, /forgot-password, /reset-password
// Does NOT use NavBar or Footer
// Background: bg-afs-bg-base
// Centered card: bg-afs-bg-raised border border-[var(--afs-border)] metal-edge
//   max-width: 480px, mx-auto, mt-24, px-8, py-10
// AFS logo mark at top of card (in bg-afs-bg-dim container)
// Card subtly elevated from page via box-shadow
```

---

## 11. PLAYWRIGHT TESTS

```typescript
test('user can register and receive confirmation', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'TestPass123!');
  await page.fill('[name="fullName"]', 'Test User');
  await page.click('[value="contractor"]');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/register/confirm');
});

test('password strength indicator updates correctly', async ({ page }) => {
  await page.goto('/register');
  await page.fill('[name="password"]', 'weak');
  await expect(page.locator('[data-testid="strength-label"]')).toContainText('Weak');
  await page.fill('[name="password"]', 'StrongPass123!');
  await expect(page.locator('[data-testid="strength-label"]')).toContainText('Strong');
});

test('login redirects admin to /admin', async ({ page }) => {
  // Auth as admin user, verify redirect to /admin
});

test('forgot password shows success without confirming email exists', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.fill('[name="email"]', 'nonexistent@example.com');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/forgot-password/sent');
});

test('unauthenticated user redirected from /account', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login/);
});

test('non-admin redirected from /admin to /account', async ({ page }) => {
  // Auth as customer, attempt /admin
  await page.goto('/admin');
  await expect(page).toHaveURL('/account');
});

test('magic link mode shows email only', async ({ page }) => {
  await page.goto('/login');
  await page.click('[data-testid="magic-link-toggle"]');
  await expect(page.locator('[name="password"]')).not.toBeVisible();
});
```

---

*SPEC_AUTH.md | AFS | Reid Whitesides | June 2026*
