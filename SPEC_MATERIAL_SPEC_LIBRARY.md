# SPEC_MATERIAL_SPEC_LIBRARY.md
## AFS — Material Specification Library
**Phase 5 — Route:** `/architects/specs/[profileSlug]`
**BLOCKED:** Technical data sheets (#58), ASTM references (#59)

ASTM standards, installation guides, and material data sheets. If they live
on AFS, architects come to AFS first for technical reference.

**Page layout `/architects/specs/[profileSlug]`:**
```
ProfileHeader: name, brief description, ProfileDiagramSVG
MaterialTable (one per compatible material):
  Material | Gauge Range | Thickness | Weight/LF | Thermal Expansion
ASTMReferences: (BLOCKED #59 — generic placeholder "ASTM B370, A653")
SmacnaReference: Relevant SMACNA sheet metal manual section
ApplicationGuide: Typical uses, installation environments, considerations
DataSheetDownloads: (BLOCKED #58 — section hidden until sheets received)
RelatedProducts: Link to other profiles in same system
SpecWriterCTA (copper accent):
  "Generate a CSI spec section for this profile"
  [Open Spec Writer] → /architects/spec-writer?profile={slug}
```

*SPEC_MATERIAL_SPEC_LIBRARY.md | AFS | Reid Whitesides | June 2026*
