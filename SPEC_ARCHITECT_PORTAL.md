# SPEC_ARCHITECT_PORTAL.md
## AFS — Architect Portal
**Phase 5**
**Route:** `/architects`
**Design:** Copper accent throughout. Same gunmetal base. Distinct from contractor-facing pages.

---

## 1. PURPOSE

If AFS is where architects come for spec language, CAD details, and Revit families,
they write AFS into their projects. Specified products = sold products. The architect
portal creates that flywheel.

---

## 2. PORTAL LANDING PAGE (`/architects`)

```
ArchitectShell (copper accent variant of PageShell)

ArchitectHero:
  Eyebrow: font-label text-afs-copper tracking-widest "FOR ARCHITECTS & SPECIFIERS"
  H1: font-display text-[6rem] text-afs-chrome-high "THE ARCHITECT'S PLATFORM"
  Subheadline: font-body text-afs-chrome-mid text-xl
    "Spec language, CAD details, Revit families, and material data.
     Everything needed to specify AFS products in your drawings."
  CTA group:
    Primary (copper): "Generate a Spec Section" → /architects/spec-writer
    Secondary: "Browse CAD Library" → /architects/cad-library

PortalFeatureGrid (4 cards in 2×2):
  Card 1: AI Spec Writer
    Icon: document + AI spark
    "CSI Division 07 spec sections in minutes"
    Link → /architects/spec-writer
    Auth gate badge: "Architect account required"

  Card 2: CAD Library
    Icon: AutoCAD file
    "DWG, DXF, and Revit families for every profile"
    Link → /architects/cad-library
    "Browse free, download with account"

  Card 3: Finish Palette
    Icon: color chips
    "Digital color chips and downloadable palettes"
    Link → /architects/finish-palette

  Card 4: Custom Profiles
    Icon: custom bend SVG
    "Your past custom profiles, searchable and reorderable"
    Link → /architects/custom-profiles
    Auth gate badge: "Account required"

WhySpecAFSSection (3 columns):
  Quality + Industry Standards | Speed of Delivery | Technical Support

ArchitectAccountCTA:
  "Create a free architect account"
  "Access spec generation, CAD downloads, and direct technical support."
  [Register as Architect] → /register
  "Already have an account?" [Sign In] → /login
```

---

## 3. COPPER ACCENT RULES (ARCHITECT PORTAL ONLY)

```typescript
// Replace crimson with copper in all accent positions:
// Primary buttons: bg-afs-copper hover:bg-afs-copper-hover
// Border accents: border-afs-copper
// Eyebrow text: text-afs-copper
// Active states: bg-afs-copper
// CTA sections: border-l-4 border-afs-copper

// DO NOT use copper outside /architects/** routes
// Crimson is still used for: navigation active state, error states
// Copper is purely for architect-targeted content
```

---

## 4. ARCHITECT ACCOUNT GATING

```typescript
// Public (no auth):
//   /architects — landing page
//   /architects/guides — resource center
//   /architects/specs/** — material data
//   Browse /architects/cad-library and /architects/finish-palette

// Auth required (any role):
//   Download from /architects/cad-library
//   Download from /architects/finish-palette
//   /architects/custom-profiles

// Auth required (architect or admin role):
//   /architects/spec-writer — full spec generation

// Non-architect auth user on spec-writer:
//   "This feature is for architect accounts."
//   "Request architect account access." → email to admin
```

---

## 5. ARCHITECT REGISTRATION

```typescript
// Additional fields when accountType = 'architect':
//   Firm name (optional)
//   AIA member number (optional)
//   License state (optional)

// After registration:
//   Role = 'architect' immediately — access granted before review
//   Admin notified for review
//   Full spec generation available immediately (no waiting for approval)
//   Admin can revoke if necessary
```

---

*SPEC_ARCHITECT_PORTAL.md | AFS | Reid Whitesides | June 2026*
