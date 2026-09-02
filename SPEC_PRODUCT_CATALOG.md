# SPEC_PRODUCT_CATALOG.md
## AFS — Product Catalog
**Phase 3**
**Routes:** `/products`, `/products/[category]`, `/products/[category]/[slug]`
**No prices. Catalog drives quote requests.**

---

## 1. PURPOSE

The product catalog lets contractors and architects browse what AFS fabricates —
profile types, materials, gauges, and finishes. Every product page drives to a
quote request. No prices. No cart. No checkout.

The catalog serves discovery and specification verification. Users who know what
they need confirm the right product here, then request a quote.

---

## 2. CATALOG PAGE (`/products`)

```
NavBar
ProductCatalogPage (PageShell)
  CatalogHeader
    H1: "Products" (font-display text-6xl)
    Subheadline: "Custom fabricated sheet metal flashing — every profile, every material"
    ResultCount: "X profiles available"

  CatalogLayout
    ProductFilterPanel (left, 280px sticky on desktop, drawer on mobile)
    ProductGrid (flex-1, 3-col desktop, 2-col tablet, 1-col mobile)
      ProductCard[]
      Pagination (if > 24 results — cursor-based)
Footer
```

### ProductFilterPanel

```typescript
interface FilterState {
  categories:    string[];   // product_profiles.slug values
  materials:     string[];   // materials.id values
  gauges:        string[];   // gauges.id values
  finishes:      string[];   // finishes.id values
  stockType:     ('stock' | 'fabricated' | 'special_order')[];
  rushEligible:  boolean | null;
  search:        string;
}

// Filter sections (collapsible accordions):
// 1. Search — text input, searches name + description
// 2. Profile Type — checkboxes from product_profiles table (not hardcoded)
// 3. Material — checkboxes from materials table
// 4. Gauge — checkboxes from gauges (filtered by selected materials)
// 5. Finish — checkboxes from finishes (filtered by materials)
// 6. Availability — Stock / Made to Order / Special Order checkboxes
// 7. Rush Eligible — toggle

// URL params drive filters: /products?category=coping-caps&material={id}
// "Clear all filters" link when any active
// Mobile: filter icon button + count badge → slide-in drawer
```

### ProductCard

```typescript
interface ProductCardProps {
  product: {
    id:           string;
    sku:          string | null;
    name:         string;
    slug:         string;
    categorySlug: string;
    materialName: string;
    gaugeName:    string | null;
    stockType:    'stock' | 'fabricated' | 'special_order';
    leadTimeDays: number;
    rushEligible: boolean;
  };
}

// Card layout:
// Category badge: font-label text-xs text-afs-chrome-base
// SKU: font-data text-xs text-afs-chrome-dim (shown only if exists)
// Product name: font-heading text-xl text-afs-chrome-high
// Material + Gauge: font-body text-sm text-afs-chrome-mid
// Stock badge:
//   "In Stock":       green dot + text
//   "Made to Order":  amber dot + text
//   "Special Order":  chrome dot + text
// Lead time: font-data text-xs text-afs-chrome-dim
// NO PRICE anywhere on the card
// CTAs:
//   Primary:   "Request a Quote" → /quote?product={id}
//   Secondary: "Configure" → /configure?profile={profileId}
// metal-edge treatment
// Hover: border-afs-chrome-dim transition
```

---

## 3. CATEGORY PAGE (`/products/[category]`)

```typescript
// generateStaticParams():
//   Fetches all product_profiles.slug from Supabase at build time
//   Returns: [{ category: 'coping-caps' }, ...]
//   BLOCKED: empty until catalog data received (checklist #12–15)

// generateMetadata():
//   title: `${profile.name} | AFS Architectural Flashing Supply`
//   description: profile.description

// Layout: identical to catalog but:
//   H1 is the category name
//   Filter panel pre-filtered to this category
//   Category description paragraph (from product_profiles.description)
//   Breadcrumb: Home > Products > [Category Name]
```

---

## 4. PRODUCT DETAIL PAGE (`/products/[category]/[slug]`)

```typescript
// generateStaticParams():
//   Fetches all products joined to product_profiles at build time
//   Returns: [{ category: 'coping-caps', slug: 'galvanized-20ga' }, ...]

// Page layout:
// Breadcrumb: Home > Products > [Category] > [Product Name]

// ProductDetailLayout (two-column desktop, stacked mobile)

// LEFT COLUMN:
//   ProfileDiagramSVG (static, category-appropriate, medium size)
//   SVG is illustrative — shows profile shape, not exact dimensions
//   Caption: "Profile illustration"

// RIGHT COLUMN:
//   SKU badge (if exists) — font-data text-xs
//   Product name: font-heading text-4xl font-bold text-afs-chrome-high
//   Material + Gauge: font-body text-afs-chrome-mid
//   Stock signal badge (large, prominent)
//   Lead time: font-data text-sm
//
//   MaterialOptions (if multiple materials for this profile):
//     Radio cards — one per compatible material
//     Selecting changes the URL to the corresponding product slug
//
//   GaugeSelector: chip group
//     Filtered by selected material
//
//   FinishSelector: color chip grid
//     hex_preview as chip background
//     "Mill finish" always first
//
//   DimensionReference (not inputs — reference only):
//     "Dimensions: W {min}–{max}" / "H {min}–{max}" / etc.
//     Shows what AFS can fabricate
//     NOT editable inputs (use /configure for that)
//
//   NO PRICE DISPLAY. NO UNIT PRICE. NO LINE TOTAL.
//
//   CTAs (prominent, full-width on mobile):
//     Primary: "Request a Quote for This Product"
//       → /quote?product={id}&profile={profileId}
//     Secondary: "Configure Custom Dimensions"
//       → /configure?profile={profileId}&material={materialId}
//
//   RushBadge (if rush_eligible):
//     "Rush fabrication available — mention in your request"

// BELOW FOLD:
// ProductTabSection
//   Tab: Overview | Specifications | Installation | Technical Documents
//
//   Overview:
//     product.description (full)
//     Key applications (from profile data)
//     Compatible systems
//
//   Specifications:
//     Materials table: material, gauge range, thickness, weight/LF
//     Dimension ranges: W min–max, H min–max, Leg A min–max, etc.
//     Max length: X ft
//     Standard stock length: X ft (if applicable)
//     Tolerances: [BLOCKED pending checklist #90]
//
//   Installation:
//     Link to installation guide: /architects/guides/{profileSlug}
//     Preview of first 2 steps
//     "View full installation guide →"
//
//   Technical Documents:
//     CAD files from cad_library_files for this profile
//     Data sheets (BLOCKED pending checklist #58)
//     "Download requires a free AFS account" if guest
```

---

## 5. EMPTY STATES (BLOCKED DATA)

```typescript
// When product catalog is empty (no data from client yet):
// /products:
//   CatalogEmptyState:
//     "Product catalog coming soon."
//     "Request a quote for any custom flashing profile."
//     [Request a Quote] → /quote
//     [Upload a Drawing] → /upload

// Category and product pages with no data:
//   Return 404 (generateStaticParams returns empty array)
//   Next.js notFound() call

// Photography placeholder:
//   Profile cards and detail pages use CSS gradient backgrounds
//   No external placeholder image services
//   Gradient colors derived from material type:
//     Copper:     bg-gradient-to-br from-amber-900/30 to-orange-900/20
//     Aluminum:   bg-gradient-to-br from-slate-700/30 to-slate-800/20
//     Galvanized: bg-gradient-to-br from-zinc-700/30 to-zinc-800/20
//   All gradients on afs-bg-raised base
```

---

## 6. SEARCH

```typescript
// /api/products/search?q={query}
// Postgres full-text search:
//   to_tsvector('english', products.name || ' ' || product_profiles.name || ' ' || materials.name)
//   plainto_tsquery('english', query)
// Max 20 results, debounced 300ms client-side
// Results use ProductCard format
// No prices in search results
```

---

## 7. METADATA

```typescript
// /products
export const metadata = {
  title: 'Products | AFS Architectural Flashing Supply',
  description: 'Custom fabricated sheet metal flashing — coping caps, base flashing, drip edge, gravel stop, and more. Copper, aluminum, galvanized steel.',
};

// /products/[category]
// generateMetadata({ params }) → dynamic per category

// /products/[category]/[slug]
// generateMetadata({ params }) → dynamic per product
```

---

## 8. PLAYWRIGHT TESTS

```typescript
test('catalog shows product grid', async ({ page }) => {
  await page.goto('/products');
  // If data loaded: verify grid, verify no prices
  // If empty: verify EmptyState CTA present
});

test('product cards have no price display', async ({ page }) => {
  await page.goto('/products');
  const text = await page.locator('[data-testid="product-grid"]').innerText();
  expect(text).not.toMatch(/\$[\d,]+/);
});

test('filter by material updates URL and results', async ({ page }) => {
  await page.goto('/products');
  // Click a material filter checkbox
  await expect(page.url()).toContain('material=');
});

test('product detail page shows quote CTA', async ({ page }) => {
  await page.goto('/products/coping-caps/galvanized-20ga');
  await expect(page.locator('text=Request a Quote')).toBeVisible();
  await expect(page.locator('text=$')).not.toBeVisible(); // No prices
});

test('configure CTA on product detail links to configurator', async ({ page }) => {
  await page.goto('/products/coping-caps/galvanized-20ga');
  await page.click('text=Configure Custom Dimensions');
  await expect(page).toHaveURL(/\/configure/);
});
```

---

*SPEC_PRODUCT_CATALOG.md | AFS | Reid Whitesides | June 2026*
