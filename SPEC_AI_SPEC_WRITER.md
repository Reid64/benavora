# SPEC_AI_SPEC_WRITER.md
## AFS — AI CSI Specification Generator
**Phase 5**
**Route:** `/architects/spec-writer`
**Auth:** architect or admin role required
**BLOCKED:** Confirmed CSI sections (#68-69), standards refs (#70), certifications (#71), sole-source policy (#72), existing spec language (#66)

---

## 1. WHAT THIS IS

The AI Spec Writer generates complete, editable CSI three-part specification
sections tied to AFS products. This is the single highest-value feature for
the architect persona. Architects spend hours writing specs. AFS writes it
for them — correctly, in CSI format.

Output: a complete, editable CSI section downloadable as DOCX.

---

## 2. CSI SECTIONS SCOPE

```typescript
// PRIMARY CSI SECTIONS (BLOCKED — awaiting checklist #68-69)
// Expected based on AFS product types:
const AFS_CSI_SECTIONS = [
  { code: '07 61 00', title: 'Sheet Metal Roofing' },
  { code: '07 62 00', title: 'Sheet Metal Flashing and Trim' },
  { code: '07 65 00', title: 'Flexible Flashing' },
  { code: '07 72 00', title: 'Roof Accessories' },
] as const;
// Actual list confirmed when checklist #68-69 received
```

---

## 3. GENERATION FLOW

```
Step 1 — CSI Section Selection
  CSI section cards: code + title
  User selects one or more (can generate multiple in one session)

Step 2 — Profile Selection
  Checkboxes: which AFS profiles to specify
  Material for each profile (dropdown)
  Finish for each profile (dropdown)

Step 3 — Project Context (optional — improves output)
  Project type: Commercial | Healthcare | Education | Residential | Government
  Climate zone (affects material recommendations for coastal/extreme climates)
  Sole source toggle:
    "Specify AFS exclusively" | "Allow substitutions (or-equal)"
    BLOCKED: default policy from checklist #72 — default to or-equal

Step 4 — Generate
  [Generate Specification] button (copper — architect portal)
  Processing: 10–30 seconds
  SpecPreview panel streams result

Step 5 — Review and Download
  Full spec rendered in SpecPreview (editable rich text)
  Architect edits any section inline
  Download: [Download DOCX] button
  Save: [Save to My Account] → saved_specifications table
```

---

## 4. AI PROMPT

```typescript
// lib/anthropic/spec-writer.ts

const SPEC_WRITER_SYSTEM = `You are a construction specification writer
specializing in CSI MasterFormat Division 07 sheet metal flashing for
AFS Architectural Flashing Supply.

Generate complete, professionally formatted CSI three-part specifications
usable in contract documents.

FORMAT:
- CSI three-part format: PART 1 GENERAL, PART 2 PRODUCTS, PART 3 EXECUTION
- Imperative voice in PART 3: "Install flashing in accordance with..."
- Indicative in PART 2: "Provide sheet metal flashing as follows..."
- Numbered articles: 1.01, 1.02, 2.01, etc.
- Include SMACNA and ASTM references in PART 1 (BLOCKED: confirmed refs from checklist #70)

AFS RULES:
- AFS is the named manufacturer in all PART 2 product references
- Use exact AFS profile names (provided in context)
- Warranty language: BLOCKED pending checklist #63 — use generic placeholder

Return JSON only — no prose, no markdown:
{
  "csiSection": "07 62 00",
  "csiTitle": "Sheet Metal Flashing and Trim",
  "part1": {
    "title": "GENERAL",
    "articles": [
      { "number": "1.01", "title": "SUMMARY", "content": "..." },
      { "number": "1.02", "title": "REFERENCES", "content": "..." },
      { "number": "1.03", "title": "SUBMITTALS", "content": "..." },
      { "number": "1.04", "title": "WARRANTY", "content": "..." }
    ]
  },
  "part2": { "title": "PRODUCTS", "articles": [...] },
  "part3": { "title": "EXECUTION", "articles": [...] }
}`;

export async function generateSpecSection(
  input: SpecWriterInput
): Promise<SpecSection> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SPEC_WRITER_SYSTEM,
    messages: [{
      role: 'user',
      content: buildSpecUserMessage(input),
    }],
  });
  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  return validateSpecSection(parsed);
}
```

---

## 5. DOCX OUTPUT

```typescript
// Generated server-side using docx npm package
// GET /api/spec/{specId}/docx

// Formatting:
//   AFS header (when logo available — BLOCKED #1)
//   Section code + title: bold, all caps, heading style
//   Article numbers: bold
//   Body: 11pt Times New Roman (CSI standard)
//   1-inch margins
//   Page numbers: bottom center
//   "DRAFT — VERIFY WITH AFS BEFORE USE IN CONTRACT DOCUMENTS" footer
```

---

## 6. SAVED SPECIFICATIONS

```sql
-- From SCHEMA.md: saved_specifications table
-- id, user_id, project_id, csi_section, csi_title, spec_data JSONB, version
```

---

## 7. BLOCKED SECTIONS

| Feature | Blocked By | Current Behavior |
|---|---|---|
| CSI section list | Checklist #68-69 | Placeholder sections |
| Standards references | Checklist #70 | Generic SMACNA/ASTM refs |
| UL/FM certifications | Checklist #71 | Certification language omitted |
| Sole source vs or-equal | Checklist #72 | Default: or-equal |
| Existing AFS spec language | Checklist #66 | AI generates from scratch |
| Warranty language | Checklist #63 | Generic placeholder |

---

*SPEC_AI_SPEC_WRITER.md | AFS | Reid Whitesides | June 2026*
