# SPEC_AI_INSTALLATION_ADVISOR.md
## AFS — AI Installation Advisor
**Phase 7 — Embedded in Field Installation Guides**
**Route:** Below installation guide content on /architects/guides/[profileSlug]
**Model:** claude-sonnet-4-6

---

## 1. PURPOSE

The installation guide gives standard steps. The AI advisor handles
"what about my situation" — the questions that deviate from standard conditions.
Expansion joint movement specifications. Unusual substrates. Extreme climate.
Provides an expert-on-call experience without paying for one.

---

## 2. PLACEMENT AND COMPONENT

```typescript
// AIAdvisorSection placed BELOW static guide content on every guide page
// NOT a popup or modal — rendered inline in the page
// Always visible after reading the guide — not gated behind a button

// Component:
//   Eyebrow: "HAVE A QUESTION ABOUT THIS INSTALLATION?"
//   Copy: "Ask our AI advisor — trained on AFS fabrication and SMACNA standards."
//   Input: "Your installation question..."
//   [Ask] button (crimson)
//   ResponseArea: appears below input after first question
//   Maintains conversation for up to 10 exchanges
//   [Start New Question] link resets

// No account required to use — public access
```

---

## 3. SYSTEM PROMPT

```typescript
const INSTALLATION_ADVISOR_PROMPT = `You are an installation specialist for
AFS Architectural Flashing Supply. Answer technical installation questions about
the specific flashing profile the customer is viewing.

CURRENT PROFILE: {profileName}
PROFILE MATERIAL: {materialName} (if known from context)
INSTALLATION GUIDE CONTENT:
{guideContent}

STANDARDS REFERENCE:
SMACNA Sheet Metal Manual, current edition
ASTM standards relevant to sheet metal flashing

RULES:
1. Answer installation questions only. Deflect pricing, ordering, or product
   availability questions to the chatbot or /quote.
2. Recommend professional review for structural calculations or unusual conditions.
3. Cite SMACNA or ASTM when applicable.
4. Be specific. "Follow manufacturer recommendations" is not acceptable.
5. If the question is outside your knowledge, say so directly. Do not guess.
6. NEVER provide information that could be used to bypass a professional engineer.

Keep responses under 200 words unless a step-by-step explanation requires more.`;
```

---

## 4. API ROUTE

```typescript
// POST /api/architects/installation-advisor
// Body: { profileSlug, question, conversationHistory }
// No auth required
// Rate limit: 20 requests per IP per hour (prevent abuse)
// Max 10 conversation turns then reset (context window management)
```

---

*SPEC_AI_INSTALLATION_ADVISOR.md | AFS | Reid Whitesides | June 2026*
