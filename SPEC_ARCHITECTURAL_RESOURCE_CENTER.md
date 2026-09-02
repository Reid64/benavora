# SPEC_ARCHITECTURAL_RESOURCE_CENTER.md
## AFS — Architectural Resource Center
**Phase 5 — Route:** `/architects/guides`

Knowledge base of standards, FAQs, and reference materials. CMS-driven.
AFS staff can add content without code deployment. Positions AFS as the
technical authority in the specialty flashing market.

**Content categories:**
```
Industry Standards & References:
  SMACNA Sheet Metal Manual overview
  ASTM standards (BLOCKED #59)
  MCA technical guidelines
  Building code references

Installation References:
  Thermal expansion tables per material
  Gauge selection guide (when to use which thickness)
  Galvanic compatibility chart (which metals contact safely)
  Wind uplift requirements by region

Specification Writing Guides:
  How to write Division 07 flashing specs
  Submittal checklist
  Sole source vs or-equal language guidance

FAQs:
  (BLOCKED #77 — populated from common architect/contractor questions)
```

**Page layout:**
```
CategoryTabs: Standards | Installation | Specification | FAQs
ArticleList (filtered by active tab):
  ResourceArticle component:
    Title, category badge, read time estimate
    First paragraph as preview
    Click → expands or links to dedicated article page
EmptyCategory:
  "Content being prepared. Check back soon."
```

**CMS implementation:**
```typescript
// Articles stored in Supabase as structured content
// Admin creates/edits via simple form in /admin
// Rendered with react-markdown + AFS prose styling
// No external CMS dependency
interface ResourceArticle {
  id:               string;
  category:         'standards' | 'installation' | 'specification' | 'faq';
  title:            string;
  slug:             string;
  content:          string;   // Markdown
  relatedProfiles:  string[]; // Profile slugs
  isFeatured:       boolean;
  publishedAt:      string;
}
```

*SPEC_ARCHITECTURAL_RESOURCE_CENTER.md | AFS | Reid Whitesides | June 2026*
