# SPEC_TAXJAR_INTEGRATION.md
## AFS — TaxJar Sales Tax Integration
**Phase 3**
**BLOCKED: Tax nexus states required (checklist #31)**

---

## 1. OVERVIEW

Multi-state tax compliance is a legal requirement. TaxJar handles nexus
detection, rate lookup, and generates reports for tax filing.

Tax is calculated at checkout on the AFS-approved quote total — never on
customer-estimated amounts. Tax appears as a line item on the formal quote
and on the checkout page.

---

## 2. CONFIGURATION (BLOCKED)

```
AFS accountant must provide: every state where AFS has sales tax nexus.
Nexus established by: physical presence, economic nexus thresholds, employee presence.
Configured in TaxJar dashboard — not in code.
Until configured: tax line shows "Calculated at checkout" on quote.
No tax is collected until TaxJar nexus is configured.
```

---

## 3. CALCULATION

```typescript
// lib/taxjar/calculate.ts
import TaxJar from 'taxjar';
const taxjar = new TaxJar({ apiKey: process.env.TAXJAR_API_KEY! });

interface TaxCalcParams {
  toZip:     string;
  toState:   string;
  subtotal:  number;
  shipping:  number;
  lineItems: TaxJarLineItem[];
}

export async function calculateTax(params: TaxCalcParams): Promise<TaxResult> {
  try {
    const response = await taxjar.taxForOrder({
      from_country: 'US',
      from_zip:     process.env.AFS_ORIGIN_ZIP!,  // BLOCKED: checklist #5
      from_state:   'TX',                           // BLOCKED: infer from ZIP
      to_country:   'US',
      to_zip:       params.toZip,
      to_state:     params.toState,
      amount:       params.subtotal,
      shipping:     params.shipping,
      line_items:   params.lineItems,
    });
    return {
      taxAmount: response.tax.amount_to_collect,
      taxRate:   response.tax.rate,
      error:     false,
    };
  } catch (error) {
    console.error('[TaxJar Error]', error);
    return { taxAmount: 0, taxRate: 0, error: true };
  }
}
```

---

## 4. TAX EXEMPTION

```typescript
// profiles.tax_exempt = true → skip TaxJar call, set tax = 0
// Admin sets after receiving resale certificate from contractor
// Tax exemption noted on invoice: "Tax exempt — resale certificate on file"
```

---

*SPEC_TAXJAR_INTEGRATION.md | AFS | Reid Whitesides | June 2026*
