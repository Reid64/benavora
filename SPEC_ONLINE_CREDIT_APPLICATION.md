# SPEC_ONLINE_CREDIT_APPLICATION.md
## AFS — Online Credit Application
**Phase 4 — Embedded in SPEC_TEAM_ACCOUNTS.md**
**Route:** `/account/credit-application`
**BLOCKED:** Net terms options (checklist #34)

---

## 1. PURPOSE

Commercial contractors and GCs who want net-30 or net-60 terms must apply for
credit. The digital form replaces paper, reduces friction for large account
setup, and routes to AFS accounting for review.

---

## 2. FORM FIELDS

```typescript
interface CreditApplicationData {
  // Business
  legalBusinessName:  string;
  dbaName:            string | null;
  taxId:              string;           // EIN
  yearsInBusiness:    number;
  businessType:       'corporation' | 'llc' | 'partnership' | 'sole_proprietor';
  annualRevenue:      '<500k' | '500k-2m' | '2m-10m' | '10m+';

  // Contact
  billingAddress:     Address;
  primaryContact:     { name: string; title: string; phone: string; email: string; };

  // Trade References (3 required)
  tradeReferences:    TradeReference[];  // min 3

  // Request
  requestedCreditLimit: number;
  requestedTerms:       15 | 30 | 60;  // BLOCKED: options from checklist #34

  // Authorization
  authorizedName:     string;
  authorizedTitle:    string;
  signatureTyped:     string;           // Typed name as signature
  signedAt:           string;
  certificationAccepted: boolean;
}
```

---

## 3. PROCESS

```
Multi-step form (4 steps): Business Info | Trade References | Credit Request | Authorization

Submit → POST /api/credit/apply
  Status = 'submitted'
  Admin email: "New Credit Application — [Company Name]"
  Customer: "Application submitted. 3-5 business day review."

Admin review in /admin/credit-applications/{id}
  Approve → set profiles.net_terms + companies.credit_limit + pricing_tier
  Deny → status = 'denied'
Customer notified either way via email
```

---

*SPEC_ONLINE_CREDIT_APPLICATION.md | AFS | Reid Whitesides | June 2026*
