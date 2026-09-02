# SPEC_CAD_BIM_LIBRARY.md
## AFS — Technical Drawing Library (CAD/BIM)
**Phase 5 — Route:** `/architects/cad-library`
**BLOCKED:** CAD files from client (#60-61)

Architects cannot specify products they cannot model. A DWG, DXF, and Revit
download library means AFS products get pulled into architect drawings — which
means they get specified. This is how architectural product manufacturers win.

See SPEC_DOCUMENT_UPLOAD.md §5 for full Context B (CAD/BIM Library) implementation
spec including: CADFileCard component, download flow, admin upload interface,
download logging, and all RLS policies. This spec covers the page-level UX.

**Page layout `/architects/cad-library`:**
```
LibraryHero: "Technical Drawing Library"
  "DWG, DXF, and Revit families for every AFS profile"
LibraryFilters:
  ProfileTypeFilter (checkboxes from product_profiles)
  FormatFilter: All | DWG | DXF | PDF | Revit
  MaterialFilter
LibraryGrid: CADFileCard[] — grid, 3 cols desktop
RequestDrawingCTA:
  "Don't see your profile? Request a detail."
  [Schedule a Consultation] → /architects/consultation
EmptyState (no files yet):
  "CAD library being populated. Files available soon."
  "Request specific details via consultation."
```

**Revit Families note:**
BLOCKED: checklist #61. Most fabricators do not have Revit families.
If none exist: section shows "Revit Families — Coming Soon"
Creating Revit families is a separate deliverable outside this build scope.
Confirm with client before building Revit section UI.

*SPEC_CAD_BIM_LIBRARY.md | AFS | Reid Whitesides | June 2026*
