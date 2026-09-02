# SPEC_TEAM_ACCOUNTS.md
## AFS — Team Accounts and User Roles
**Phase 4**
**Routes:** `/account/team`, `/invite/[token]`

---

## 1. PURPOSE

A GC firm has estimators, PMs, and accounting staff who all need AFS access
with different permissions. Team accounts unlock the commercial buyer market.
Companies buy more than individuals.

---

## 2. COMPANY ROLES

| Role | Can Do |
|---|---|
| owner | Everything — billing, team, pricing oversight |
| admin | Everything except billing |
| estimator | Create and view quote requests. Cannot submit orders or view invoices. |
| pm | View and track orders. Cannot create quotes or view pricing. |
| accounting | View invoices, download statements. Cannot place orders. |
| viewer | Read-only — orders and tracking only. |

---

## 3. INVITATION FLOW

```
/account/team
  [Invite Team Member] button → InvitationModal
    Email: required
    Role: dropdown (roles above)
    Personal message: optional
  POST /api/team/invite
    Creates pending invitation record
    Sends Resend email: "You've been invited to join {companyName} on AFS"
    Email contains: /invite/{token} link
    Expires: 7 days

/invite/{token}
  If not logged in: LoginForm or RegistrationForm (email pre-filled)
  After auth: validates token → adds user to company with specified role
  Redirect to /account: "You've joined {companyName} on AFS"
```

---

## 4. TEAM MANAGEMENT PAGE (`/account/team`)

```typescript
// Members table:
// Name | Email | Role | Status | Last Active | Actions
// Status: Active | Invited (pending) | Deactivated
// Actions: Change Role | Deactivate | Resend Invitation (if pending)
// Company profile section: company name, billing contact
```

---

## 5. DATA SCOPING FOR TEAMS

```typescript
// When user is part of a company:
//   Orders visible to team members per role
//   Company-level quote requests visible to estimators+
//   Invoices visible to owner, admin, accounting only
//   Projects visible to all team members
//   vault_documents.is_shared = true → visible to all team members

// RLS policies updated for company scope:
//   orders: user_id = auth.uid() OR (company_id matches AND role permits)
```

---

## 6. ONLINE CREDIT APPLICATION (`/account/credit-application`)

```typescript
// Multi-step form:
// Step 1: Business information (legal name, DBA, EIN, years in business)
// Step 2: Trade references (3 required)
// Step 3: Credit request (limit + net terms requested)
// Step 4: Authorization (typed signature, title, certification checkbox)

// Submit → POST /api/credit/apply
//   Saves to credit_applications table
//   Admin notified: "New Credit Application — [Company Name]"
//   Customer: "Application submitted. Review takes 3-5 business days."

// Admin approval → updates profiles.net_terms, companies.credit_limit, pricing_tier
// Customer notified when approved or denied
```

---

*SPEC_TEAM_ACCOUNTS.md | AFS | Reid Whitesides | June 2026*
