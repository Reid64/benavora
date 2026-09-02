# SPEC_FINISH_PALETTE.md
## AFS — Finish and Color Library
**Phase 5 — Route:** `/architects/finish-palette`
**BLOCKED:** Finish data and color codes (#14, #62)

Architects select finishes for aesthetic reasons. Downloadable palettes and
digital color chips are standard for any architectural product manufacturer.
Without them, architects cannot complete finish schedules.

**Page layout `/architects/finish-palette`:**
```
FinishPaletteHero: "AFS Finish & Color Library"
MaterialTabs: [Copper] [Aluminum] [Galvanized Steel] [Painted Steel]
  Generated from materials table — not hardcoded
  Active tab: copper underline (architect portal accent)

FinishGrid (active material's finishes):
  FinishChip: 80×80px minimum
    hex_preview as background-color
    Name below chip: font-label text-sm
    "Mill finish" always first option per material
    Non-standard finishes: "(+X% upcharge)" informational badge
    Click → FinishDetailModal:
      Full name, manufacturer, color code, hex
      "Add to Spec" → adds to active spec writer session
      "Request Sample" → /contact?finish={id}

"Download Complete Palette" button (per active material):
  GET /api/architects/palette/{materialSlug}/pdf
  8.5×11 landscape PDF
  Chip grid: swatch + name + manufacturer + code
  "For design review only — actual color may vary. Order samples."

EmptyState (no finishes yet):
  "Finish library coming soon."
  [Contact AFS for Finish Information] → /contact
```

*SPEC_FINISH_PALETTE.md | AFS | Reid Whitesides | June 2026*
