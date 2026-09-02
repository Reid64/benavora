# SPEC_SAVED_PROJECT_TEMPLATES.md
## AFS — Saved Project Templates
**Phase 4**
**Route:** `/account/templates`

---

## 1. PURPOSE

Production homebuilders and commercial roofing crews order the same flashing
package on every job. Saved templates eliminate re-entry of standard
configurations, driving repeat quote requests with near-zero friction.

---

## 2. DATA MODEL

```sql
-- From SCHEMA.md: quote_templates table
-- id, user_id, company_id, name, description, is_company_shared, items JSONB, use_count
```

---

## 3. TEMPLATE LIST (`/account/templates`)

```typescript
// TemplateCard grid:
//   Name (font-heading), item count, description (2 lines), last used date
//   Company shared badge: "Company" (if is_company_shared and user is in company)
//   use_count: "Used 12 times"
// Actions: [Use Template] [Edit] [Delete]
// [Create Template] button → TemplateCreateFlow
```

---

## 4. CREATE TEMPLATE

```typescript
// Option A: Save from Quote Wizard
//   Step 4 of quote wizard: "Save as Template" button
//   TemplateSaveModal: name, description, share with team toggle
//   Saves items from current session to quote_templates

// Option B: Build from scratch
//   /account/templates → "Create Template"
//   Opens same multi-item interface as quote wizard
//   Name + description at end
```

---

## 5. USE TEMPLATE

```typescript
// "Use Template" → POST /api/templates/{id}/use
//   Increments use_count
//   Creates QuoteRequestSession from template items
//   Redirects to /quote?step=4&from_template={id}
//   Items pre-loaded in Step 4 review
//   Quantities editable before submitting
//   No prices stored in template — AFS prices each new submission fresh
```

---

*SPEC_SAVED_PROJECT_TEMPLATES.md | AFS | Reid Whitesides | June 2026*
