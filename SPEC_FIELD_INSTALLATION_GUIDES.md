# SPEC_FIELD_INSTALLATION_GUIDES.md
## AFS — Field Installation Guides
**Phase 5 — Route:** `/architects/guides/[profileSlug]`
**Linked from:** Order detail pages
**BLOCKED:** Installation guides (#57), photography (#9), video (#10)

If a contractor can pull up the exact install guide for the profile they ordered,
AFS owns the jobsite experience and reduces warranty claims and callbacks.

**Page layout:**
```
InstallationGuidePage
  GuideHeader: profile name, material (if specific), last updated
  ToolsList: horizontal chip list
    "Sheet metal brake" "Tin snips" "Aviation snips" "Sealant gun" etc.

  StepList (numbered):
    StepCard per step:
      Number: font-display text-5xl text-afs-crimson/30 (background watermark)
      Title: font-heading text-xl text-afs-chrome-high
      Detailed instructions: font-body text-afs-chrome-mid
      Image slot: BLOCKED #9 — afs-bg-surface placeholder rectangle
      WarningCallout (if any): amber left border bg-afs-warning-ghost
        "Do not allow copper to contact untreated galvanized steel"
      TipCallout (if any): info left border
        "Pre-bend at 90° before site installation for cleaner results"

  CommonMistakesAccordion:
    Mistake | Consequence | Correction
    (BLOCKED #57 — placeholder: "Common mistakes coming soon")

  AIAdvisorSection (below static guide):
    "Have a question about this installation?"
    Inline chat input — see SPEC_AI_INSTALLATION_ADVISOR.md
    Not a popup — renders inline below guide

  PDFDownloadButton:
    "Download Installation Guide (PDF)"
    Server-side PDF from guide content
    (BLOCKED #57 — button hidden until guide content received)
```

**Link from Order Detail:**
```
After order placed, order detail shows:
"Installation Resources" section with links to guides
for each profile type in the order.
```

*SPEC_FIELD_INSTALLATION_GUIDES.md | AFS | Reid Whitesides | June 2026*
