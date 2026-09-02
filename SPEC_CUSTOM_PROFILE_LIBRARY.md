# SPEC_CUSTOM_PROFILE_LIBRARY.md
## AFS — Saved Custom Profile Library
**Phase 5 — Route:** `/architects/custom-profiles`
**Auth:** Any authenticated user

Past custom designs, searchable per customer, allow architects and contractors
to reference and reorder unique profiles without starting from scratch.

**Data sources (combined view):**
1. `saved_configurations` — from Configurator saves
2. `order_line_items` with non-standard dimensions — from past orders

**Page layout `/architects/custom-profiles`:**
```
Header: "Your Custom Profiles"
Search: by profile type, material, date range
FilterBar: by profile type, material
ProfileGrid: SavedConfigCard[]
EmptyState (no saved profiles):
  "No custom profiles saved yet."
  "Configure a profile and save it — or place a custom order.
   Both appear here for easy reordering."
  [Configure a Profile] → /configure
```

**SavedConfigCard:**
```
Left: ProfileDiagramSVG (scaled down from lib/utils/profile-svg.ts)
Right:
  Profile type: font-heading text-lg
  Material + gauge: font-body text-sm text-afs-chrome-mid
  Dimensions: font-data text-xs "12"W × 4"H × 3"A × 3"B"
  "Last ordered: [date]" or "Saved [date]"
  "Ordered X times" (if from order history)
Actions:
  [Reorder] → /quote?step=4 with this config pre-loaded
  [Edit in Configurator] → /configure?saved={id}
```

*SPEC_CUSTOM_PROFILE_LIBRARY.md | AFS | Reid Whitesides | June 2026*
