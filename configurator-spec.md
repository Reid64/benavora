# Bright Box Homes 3D Configurator — Full Product Specification

---

## PHASE 0: MARKET & COMPETITIVE ANALYSIS

### 0.1 Competitive Landscape

#### Competitor 1: Dwellito (configure.so / dwellito.com)

- **What they do:** Full-stack SaaS platform — 3D home configurator, site planner, AI designer, marketplace listing. White-labels for builders (e.g., Auxbox).
- **Target customer:** Modular home builders, ADU manufacturers, prefab companies (B2B SaaS).
- **Technology:** Proprietary web-based 3D renderer. 2D + 3D views, AR support. Image-based and 3D-based configurator tiers.
- **Features:** Real-time pricing, material/finish swaps, site planner with zoning overlays, PDF report generation, deposit collection, AI-powered layout suggestions.
- **Pricing model:** Monthly subscription (pricing not publicly listed — "Schedule a Demo" model). Based on industry benchmarks and their early-stage traction ($5K revenue at seed), estimated $500–$2,000/month per builder. They also take transaction fees on marketplace sales.
- **Strengths:** Purpose-built for homebuilding (not generic product configurator). Includes site planner, zoning, and financing integration. Container home–specific configurator exists. Has live customers and case studies (23% sales increase claim, 34% close rate improvement). AI designer feature is forward-looking.
- **Weaknesses:** Small team, Oakland-based startup with limited traction. Marketplace is California-focused. Configurator setup is done BY Dwellito (not self-service). No self-hosted option. No multi-unit stacking capability for modular apartment buildings.

#### Competitor 2: INHAABIT (inhaabit.com)

- **What they do:** Enterprise AR + 3D product configurator platform. Serves multiple verticals (furniture, outdoor kitchens, modular homes, pods). Australian company with global reach.
- **Target customer:** Modular building manufacturers, furniture brands, large retailers. Enterprise tier.
- **Technology:** Proprietary 3D engine with AR (WebXR). High-fidelity PBR rendering. Modular drag-and-drop configurator.
- **Features:** 360-degree 3D viewing, AR walk-throughs, modular drag-and-drop assembly, material configuration, real-time pricing, ecommerce integration (Magento, Shopify), CPQ workflows.
- **Pricing model:** Enterprise custom pricing. Based on comparable enterprise 3D platforms, estimated $2,000–$10,000+/month. Requires CAD files for onboarding.
- **Strengths:** Ultra-realistic visual quality. True AR walkthrough capability. Modular assembly for complex products. Live case study with Express Portables (modular home manufacturer). Cross-industry platform means mature technology.
- **Weaknesses:** Enterprise-only pricing puts it out of reach for small dealers. Not purpose-built for housing — it's a generic product configurator adapted. No housing-specific features (zoning, financing, building codes). Onboarding requires CAD files and professional services. No self-service setup.

#### Competitor 3: Lightbeans (lightbeans.com)

- **What they do:** 3D texture/visualization platform that builds custom configurators for housing manufacturers. Built ProFab's Edena model configurator.
- **Target customer:** Prefab home manufacturers (B2B custom development).
- **Technology:** Custom web-based 3D configurators. PBR textures scanned from real materials.
- **Pricing model:** Custom development projects. Estimated $15,000–$50,000+ per project (one-time), based on Sketchfab's published benchmarks for similar configurators.
- **Strengths:** Photorealistic material scanning. Deep integration with real supplier materials. Quebec-based, strong in Canadian prefab market.
- **Weaknesses:** Custom development model means high cost and long timelines. Not a SaaS product — each deployment is bespoke. No self-service. No multi-unit capability. Limited to the models they build for each client.

#### Competitor 4: Lunas L-HOUSE (lunas.pro)

- **What they do:** Interactive 3D configuration software specifically for single-family housing developers. 7 years in market.
- **Target customer:** Housing developers and tract builders.
- **Technology:** Proprietary 3D engine with VR support. Plot selection, exterior design, interior walkthrough, time-of-day simulation.
- **Features:** Plot finder, house model selection, exterior customization, VR walkthrough, interior design, time-of-day lighting, landscaping. Sales-focused presentation tool.
- **Pricing model:** Enterprise licensing (pricing not public, estimated $5,000–$20,000+ setup + monthly).
- **Strengths:** Purpose-built for housing sales. VR walkthrough is compelling. 7-year track record. Plot-to-purchase journey.
- **Weaknesses:** Designed for large developers with many housing tracts, not small dealers. Not SaaS/self-service. No modular stacking. No container/prefab specific features. Primarily a sales showroom tool, not an online self-service configurator.

#### Competitor 5: Mobile Modular 360 3D Visualizer (mobilemodular.com)

- **What they do:** In-house 3D building visualizer for Mobile Modular (a McGrath RentCorp subsidiary). Customers select location, browse modular floorplans, customize accessories.
- **Target customer:** Mobile Modular's own commercial customers (not available to others).
- **Technology:** Web-based 3D viewer with accessories customization.
- **Features:** Location-based floorplan filtering, interior/exterior accessory selection, real-time visualization, quote request generation.
- **Pricing model:** N/A — internal tool, not sold.
- **Strengths:** Good example of what a proprietary configurator looks like for a large modular company. Proves the concept works for commercial modular.
- **Weaknesses:** Not available as a product. Commercial modular focus, not residential prefab. No color/material customization. No pricing display.

#### Competitor 6: HomeByMe (home.by.me)

- **What they do:** General-purpose 3D home design platform with drag-and-drop floor planning.
- **Target customer:** General consumers and designers, not specifically prefab/modular.
- **Technology:** Web-based 3D room planner with brand-name furniture catalog.
- **Features:** Drag-and-drop walls, doors, furniture. 2D-to-3D conversion. Realistic rendering.
- **Pricing model:** Freemium for consumers. Enterprise API licensing for brands.
- **Strengths:** Mature platform with large user base. Full interior design capability.
- **Weaknesses:** NOT a product configurator — it's a general design tool. No prefab-specific constraints (module sizing, stacking rules, pricing). No manufacturer catalog integration. No sales/quoting workflow.

#### Competitor 7: Planner 5D (planner5d.com)

- **What they do:** General 3D home design tool.
- **Target customer:** Consumers, designers.
- **Pricing model:** Freemium SaaS.
- **Relevance:** Same as HomeByMe — general tool, not a prefab configurator. Listed because it shows up in searches but is NOT a competitor.

#### Competitor 8: Boxabl (boxabl.com)

- **What they do:** Just launched (June 2, 2026) their own Phase 2 beta catalog and configurator for their standardized modular building system.
- **Target customer:** Their own direct buyers and dealers.
- **Technology:** Proprietary web-based configurator (just launched beta).
- **Relevance:** Boxabl building their own validates the concept. However, Boxabl is a manufacturer, not selling the tool. They're a potential Bright Box Homes competitor at the PRODUCT level but not at the configurator software level. They ARE a potential customer — Boxabl dealers could use your tool.

### 0.2 The Gap Analysis — Brutal Honesty

**Does a real gap exist? Yes, but it's narrower than you think.**

Dwellito is your most direct competitor and they are ahead of you. They have a working product, live customers, case studies, and a container home configurator already deployed. They are doing EXACTLY what you're proposing — a SaaS configurator for homebuilders.

**However, here's where the genuine gaps are:**

1. **Multi-unit stacking configurator:** No competitor offers drag-and-drop modular unit stacking for multi-story apartment/commercial buildings. Dwellito does single-unit config. INHAABIT does modular assembly but for furniture, not buildings. This is your single strongest differentiator for the INVESTOR/DEVELOPER persona. If you cut this feature, your product becomes a Dwellito clone.

2. **Self-service setup with procedural geometry:** Every competitor requires either CAD file upload or professional services to onboard a new home model. A system where dealers define dimensions and the geometry is generated procedurally (viable for container/box-shaped homes specifically) would dramatically reduce onboarding friction and cost. This only works because container homes ARE rectangular prisms. Traditional prefab with complex rooflines would break this approach.

3. **Self-hosted Enterprise tier:** No competitor offers source-code access or self-hosted deployment. Large manufacturers (Clayton Homes, Cavco, Skyline Champion) would never put their product data into a third-party SaaS. A self-hosted license is a real differentiator for Enterprise deals.

4. **Price point accessibility:** INHAABIT and Lightbeans are $2K–$10K+/month or $15K–$50K one-time custom builds. Dwellito is $500–$2K/month. A $250/month entry tier (your Indie plan annualized) would undercut Dwellito significantly, but only if you can deliver comparable quality. At $2,995 one-time for Indie, you're pricing well below Dwellito's annual cost — which either makes you very competitive or signals "cheap tool."

**What is NOT a gap:**

- Basic 3D home visualization with color/material swaps — Dwellito, INHAABIT, and Lightbeans all do this.
- Real-time pricing — standard feature across competitors.
- PDF/screenshot export — standard.
- White-label embedding — Dwellito already does this.

### 0.3 Total Addressable Market (TAM)

**Hard data:**

- **Manufactured home dealers in the US (2025):** 2,438 businesses (IBISWorld NAICS 45393). Declining at -2.1% CAGR 2020–2025.
- **Prefab home manufacturers in the US:** Approximately 35 active manufacturers of meaningful scale (Clayton/Berkshire, Cavco Industries, Skyline Champion, Boxabl, Onx Homes, Guerdon, etc.). Top 5 control <30% of volume.
- **Modular/prefab builders (broader):** Estimated 500–800 companies including regional builders, container home companies, ADU builders, tiny home manufacturers.
- **Total addressable market (dealers + manufacturers + builders):** ~3,000–3,500 US businesses that could theoretically use this tool.

**Serviceable addressable market (SAM):** Not all 3,500 need or can afford a 3D configurator. Realistic SAM:

- Dealers with active websites and online sales capability: ~800–1,200.
- Manufacturers selling direct-to-consumer or through digital channels: ~100–200.
- Container/expandable home dealers (your sweet spot): ~150–300.
- **SAM total: ~1,000–1,500 businesses.**

**Serviceable obtainable market (SOM) Year 1:** Realistically, with a new product and no brand recognition in this vertical, capturing 0.5%–1% of SAM is aggressive. That's 5–15 paying customers in Year 1.

### 0.4 Pricing Validation

**Your proposed tiers:**
- Indie: $2,995 (one-time?)
- Business: $7,995 (one-time?)
- Enterprise: $19,995 (one-time?)

**Problems with this pricing:**

1. **One-time vs. recurring is unclear.** If one-time, you're leaving massive revenue on the table and creating a support liability without ongoing revenue. If annual, it's more defensible but the Indie tier ($250/month effective) is reasonable while Enterprise ($1,666/month effective) is aggressive for a new product with no track record.

2. **Comparison to competitors:**
   - Dwellito: estimated $500–$2,000/month recurring = $6,000–$24,000/year.
   - INHAABIT: estimated $2,000–$10,000/month = $24,000–$120,000/year.
   - Custom development (Lightbeans): $15,000–$50,000 one-time + maintenance.
   - Sketchfab-based configurators: $15,000–$55,000 one-time.
   - VividWorks: $922/month ($11,060/year) for a Shopify configurator.

3. **Recommended pricing adjustment:**

| Tier | Price | Model | Justification |
|------|-------|-------|---------------|
| Indie | $299/month or $2,995/year | Recurring | Undercuts Dwellito entry point. Annual discount encourages commitment. Low enough that a small dealer selling $30K–$60K homes recovers cost with one additional sale influenced by the configurator. |
| Business | $799/month or $7,995/year | Recurring | Competitive with Dwellito mid-tier. White-label + multi-unit stacking justifies the premium. API access adds developer value. |
| Enterprise | $19,995/year + $2,500/month hosting support OR $49,995 perpetual license | Hybrid | Self-hosted with source access is genuinely premium. Large manufacturers (Clayton, Cavco) spend $100K+ on custom tools. $50K perpetual is a steal for them. Monthly support covers updates and patches. |

**Critical point:** Do NOT launch SaaS pricing until the product has proven value on brightboxhomes.com first. Your own site is the proof of concept. Ship Bright Box integration → get data on conversion impact → use that data to sell the SaaS.

### 0.5 First 10 Target Customers

| # | Company | Why They Fit |
|---|---------|-------------|
| 1 | **Bob's Containers** (bobscontainers.com) | Container home builder in TX. Already has product configurator-like pages. Sells multiple models with upgrades. Would benefit from 3D visualization. |
| 2 | **Custom Container Living** (customcontainerliving.com) | Missouri-based container home builder. Sells shipping container homes with custom options. No 3D configurator. Active online sales. |
| 3 | **CHOMEX** (containerhomex.com) | Expandable container homes, apple pod designs — almost identical product line to Bright Box. No 3D configurator. Direct competitor at product level, potential customer at software level. |
| 4 | **Global Modulars** (globalmodulars.com) | Florida-based container/modular builder. Ships nationwide. Multiple models. No configurator. |
| 5 | **Off Grid Dwellings** (offgriddwellings.com) | Florida factory, container homes for sale. Active online store. No 3D tool. |
| 6 | **Honomobo** (honomobo.com) | 8 models of eco container homes, NW US delivery. Premium brand positioning. Would benefit from a premium configurator. |
| 7 | **Steelblox** | ADU container home manufacturer. Modular designs. Active online presence. |
| 8 | **24Prefab** (24prefab.com) | Expandable/foldable/Apple Pod container homes. Almost identical product catalog to Bright Box. Ships to all 50 states. No 3D tool. |
| 9 | **Custom Living Homes** (customlivinghomes.com) | Boxabl Casita authorized dealer. Specializes in customization. Would benefit from a configurator to show upgrades/finishes. |
| 10 | **Flex Port Containers** (flexportcontainer.com) | Container home retailer. Boxabl reseller. Online sales focused. No visualization tool. |

### 0.6 Sales Motion

**Phase 1 (Months 1–6): Prove it on your own site.**
- Deploy configurator on brightboxhomes.com.
- Measure conversion rate, time-on-site, lead quality, quote requests.
- Document the before/after data as a case study.

**Phase 2 (Months 6–12): Direct outreach with proof.**
- Cold email/LinkedIn outreach to the 10 targets above WITH your own conversion data.
- Demo strategy: Live screen-share showing YOUR working configurator on YOUR site with YOUR sales data. "Here's what it did for us. Here's what it'll do for you."
- Offer first 3 customers a 50% discount for 6 months in exchange for case study rights.

**Phase 3 (Months 12–18): Scale.**
- Trade shows: Modular Home Builders Association (MHBA) events, Offsite Construction Expo, MHI Congress & Expo.
- Content marketing: YouTube videos showing the configurator in action, blog posts on "how 3D configurators increase prefab sales."
- Partnerships: Approach Chinese/overseas container home manufacturers (AKAY, etc.) who need US-market-ready sales tools for their dealer networks.

**Demo strategy:** Self-service demo on your own website. "Try it yourself" with a live sandbox. Do NOT require a sales call to see the product — that's what INHAABIT and Lightbeans do, and it's friction. Let the product sell itself.

### 0.7 Revenue Projections

**Conservative (Year 1):**
- Months 1–6: $0 SaaS revenue (building + deploying on own site).
- Months 7–12: 3–5 Indie customers × $2,995/year = $9K–$15K.
- 1 Business customer × $7,995/year = $8K.
- **Year 1 SaaS total: $17K–$23K.**
- Bright Box Homes site impact: If configurator increases conversion by even 10% on a $40K average order, and you close 2 additional sales, that's $80K in home revenue (not software revenue, but business revenue).

**Conservative (Year 2):**
- 10–15 Indie × $2,995 = $30K–$45K.
- 3–5 Business × $7,995 = $24K–$40K.
- 1 Enterprise × $19,995 = $20K.
- **Year 2 SaaS total: $74K–$105K.**

**Reality check:** These are modest numbers. This is a niche B2B product in a market of ~1,500 potential buyers. It will not be a venture-scale business at these adoption rates. It CAN be a solid lifestyle business or a strategic asset that increases Bright Box Homes revenue. Manage expectations accordingly. The configurator's primary ROI is accelerating YOUR OWN home sales, not SaaS revenue.

---

## PHASE 1: PRODUCT REQUIREMENTS DOCUMENT

### 1.1 Executive Summary

**Product vision:** A browser-based 3D configurator that lets buyers visualize and customize prefab/container homes in real-time, and lets dealers offer that experience under their own brand.

**Value proposition by user type:**

- **Home buyer:** See exactly what you're getting before you buy. Change colors, add upgrades, see the price change live. Eliminate the uncertainty of buying a $30K–$60K product sight-unseen.
- **Investor/developer:** Design multi-unit modular buildings by stacking assembly homes. Validate configurations, get instant pricing for project budgets, export designs for permit applications.
- **Prefab dealer (licensee):** Get a premium 3D sales tool without building one. Embed it on your site, use your own branding, manage your own product catalog.
- **Licensee admin:** Upload your product catalog, set colors and pricing, manage configurations, view analytics.

**Revenue model:** Recurring SaaS subscriptions at 3 tiers (validated in Phase 0). Primary revenue driver in Year 1 is Bright Box Homes conversion improvement.

### 1.2 Problem Statement

**For home buyers:**
- Prefab/container homes are purchased primarily through static images and PDF brochures. Buyers cannot visualize color combinations, upgrades, or how the home will actually look.
- The average prefab home purchase involves 3–5 back-and-forth quote revision cycles, each taking 2–5 business days. A configurator compresses this to minutes.
- Buyer hesitation is the #1 reason prefab deals stall. Dwellito's data shows 34% higher close rates when buyers can visualize the product. This is consistent with broader 3D commerce research (61% of customers prefer brands that offer AR/3D experiences per INHAABIT's published data).

**For dealers/builders:**
- Each custom quote costs a dealer 1–3 hours of sales labor. At $50/hour fully loaded, that's $50–$150 per quote. If a dealer generates 50 quotes/month and closes 20%, that's $2,000–$6,000/month in quoting labor for 40 lost deals.
- Without a visual tool, dealers rely on sales calls and in-person meetings to close. This limits geographic reach and sales velocity.
- No affordable self-service option exists. Dwellito requires their team to set up each deployment. INHAABIT requires CAD files and enterprise contracts. Small container home dealers are underserved.

### 1.3 User Personas

**Persona 1: Sarah, the First-Time Buyer**
- Age 32, married, looking at a container home as a primary residence or ADU.
- Budget: $35K–$60K for the unit.
- Goals: See color options, understand what upgrades cost, share the design with her spouse, feel confident enough to place a deposit.
- Pain points: Doesn't trust static photos. Wants to "try before she buys." Overwhelmed by upgrade options without seeing them.
- Workflow: Lands on dealer website → opens configurator → selects model → changes exterior color → adds solar panels → sees price update → screenshots design → texts it to spouse → returns next day → submits lead form with saved configuration.

**Persona 2: Marcus, the Real Estate Developer**
- Age 45, owns 3 rental properties, evaluating modular for a 12-unit workforce housing project.
- Budget: $300K–$500K for the project.
- Goals: Validate that Assembly Homes can stack to 3 stories. Design a building layout. Get a total project cost estimate. Export the design for his architect.
- Pain points: No tool lets him visualize multi-unit configurations. Currently sketching on paper or paying an architect $5K for preliminary renderings.
- Workflow: Opens configurator → selects Assembly Home model → places 4 units on ground floor → stacks 4 units on second floor → adds staircases and railings → reviews total pricing → exports design → sends to architect for site plan integration.

**Persona 3: Lisa, the Container Home Dealer**
- Age 38, runs a small container home dealership in Texas, 5 employees. Sells 10–15 homes/month.
- Budget: $250–$800/month for software tools.
- Goals: Embed a configurator on her website that matches her branding. Reduce quote turnaround time. Capture more online leads.
- Pain points: Losing deals to competitors with better websites. Spending too much time on custom quotes that don't close. Can't afford Dwellito's pricing or INHAABIT's enterprise tier.
- Workflow: Signs up for Indie plan → uploads her product catalog (model names, dimensions, colors, prices) → customizes branding (logo, colors) → embeds iframe on her Squarespace site → monitors analytics dashboard for configuration activity and lead captures.

**Persona 4: James, the Licensee Admin**
- Lisa's operations manager. Manages the product catalog and pricing.
- Goals: Keep product catalog current, update seasonal pricing, add new color options, review customer configurations.
- Workflow: Logs into admin dashboard → updates pricing for Q3 → adds 3 new exterior colors from the factory → reviews the 15 saved configurations from last week → exports leads to CRM.

### 1.4 Feature Specifications

#### 1.4.1 3D Engine: Three.js vs Babylon.js

**Recommendation: Three.js.**

Justification:
- Three.js has a larger ecosystem, more community examples, more hiring pool, and smaller bundle size (~600KB vs Babylon.js ~2.5MB+ with full engine).
- For this use case (procedural box geometry with PBR materials, not complex physics or advanced particle systems), Three.js provides everything needed without the overhead.
- Babylon.js advantages (built-in physics, node material editor, inspector) are not needed for a product configurator.
- Three.js's @react-three/fiber (R3F) provides React integration that fits your Next.js stack perfectly. Babylon.js's React wrapper is less mature.
- Three.js r170+ supports WebGPU as a backend if needed for future performance.

**Stack decision: Three.js + @react-three/fiber + @react-three/drei.**

#### 1.4.2 Core Capabilities

**Real-time 3D Rendering:**
- WebGL2 renderer (Three.js WebGLRenderer) with WebGPU fallback path for future.
- PBR materials (MeshStandardMaterial) with environment map lighting.
- Shadow mapping: PCFSoftShadowMap, 2048×2048 shadow map resolution.
- Post-processing: SSAO (screen-space ambient occlusion), FXAA anti-aliasing, ACESFilmicToneMapping.
- HDR environment map for reflections and ambient lighting (neutral studio HDRI).
- Target: 60 FPS on mid-range hardware (GTX 1060 / M1 MacBook Air equivalent).

**Single-Unit Configuration (MVP):**
- Select model from product catalog.
- Exterior walls: choose from predefined color palette (hex values mapped to MeshStandardMaterial color property).
- Roof: choose color (separate from walls).
- Trim/accents: choose color.
- Interior walls: choose color (visible through windows or via interior camera preset).
- Flooring: choose material/color.
- All color changes applied instantly via material color property update (no texture swap needed for solid colors, texture swap for materials like wood grain flooring).

**Multi-Unit Stacking (Phase 2):**
- Grid-based placement: unit snaps to a grid where grid cell size = unit width.
- Drag-and-drop: click a model from the panel, click a grid position to place it.
- Vertical stacking: click above an existing unit to place on top. Maximum 3 stories.
- Structural rules enforced:
  - Ground floor units must exist before second floor can be placed.
  - Second floor units must be directly above or adjacent to ground floor units (no cantilevers beyond 1 unit width).
  - Third floor units must be directly above second floor units.
  - Staircase required between each floor (auto-prompted when second floor unit is placed).
  - Railings auto-added to any elevated platform edge that doesn't have an adjacent unit.
- Deletion: click to select a unit, press delete. Cascade warning if units above depend on it.

**Accessory Attachment (Phase 2):**
- Accessories have defined attachment points (snap points) on each model.
- Covered porch: attaches to front face, extends outward. Defined dimensions per model.
- Side deck: attaches to left/right face.
- Staircase: attaches to front/side face, connects to platform above.
- Railing: auto-placed on exposed edges of elevated platforms.
- Landing platform: connects staircase top to unit entry door.
- Awning: attaches above windows/doors.
- Solar panels: snap to roof surface.
- Mini-split units: snap to exterior wall points.

**Color/Material System:**
- Each product defines its own color palette (array of hex values with display names).
- Colors are applied as `MeshStandardMaterial.color` for solid colors.
- Materials (wood grain, stone, metal textures) loaded as 1024×1024 PBR texture sets (baseColor, normal, roughness).
- Texture atlas for common materials to minimize draw calls.
- Material swap is instant — preload all palette textures on model load.

**Live Pricing:**
- Base price displayed for selected model.
- Each upgrade (solar, generator, mini-split, etc.) has a defined price delta.
- Running total updates on every configuration change.
- Price breakdown panel: base price + itemized upgrades = total.
- Multi-unit mode: sum of all units + accessories + upgrades.

**Screenshot/Export:**
- "Save Design" button renders current 3D view to PNG via `renderer.domElement.toDataURL()`.
- Multiple preset camera angles exported (front, side, aerial, interior if applicable).
- PDF generation with configuration summary, pricing breakdown, and rendered images (server-side via Puppeteer or client-side via jsPDF).

**Shareable Links:**
- Configuration state serialized to JSON.
- Short hash generated, stored in Supabase `configurations` table.
- Share URL format: `https://configure.brightboxhomes.com/s/{hash}`
- Loading a share URL hydrates the configurator with saved state.

**Responsive:**
- Desktop: full 3D viewport + side panel UI.
- Tablet: 3D viewport + collapsible bottom sheet UI.
- Mobile: view-only mode — 3D viewport with orbit controls, no configuration UI. "Configure on desktop" prompt. This is a deliberate scope cut — configuring a 3D home on a phone screen is a poor experience.

#### 1.4.3 Product Lines

| Product Line | Models | Price Range | Config Type | Geometry |
|-------------|--------|-------------|-------------|----------|
| Assembly Homes | Vantage, Prism, Vertex, Axis, Pavilion | $25,995–$29,995 | Single + Multi-unit stacking | Rectangular prism, parameterized by L×W×H. Simple gable or flat roof. |
| Expandable Container | 20×10, 20×20, 20×30, 20×40 | $35,995–$59,995 | Single-unit only | Rectangular prism, expandable fold-out animation (cosmetic). |
| Duplex | 1 model | $59,995 | Single-unit only | Double-wide rectangular prism with center wall. |
| Apple Cabins | 1 model | TBD | Single-unit only | Rounded/pod shape — procedural using capsule geometry (cylinder + hemisphere caps). |
| Space Capsules | 1 model | TBD | Single-unit only | Capsule/pod — procedural using elongated sphere/capsule geometry. |
| Emergency Housing | 1 model | TBD | Single-unit only | Foldout rectangular prism with simplified config (minimal color options). |

#### 1.4.4 Geometry Approach (Detailed)

All geometry is procedural. No pre-built 3D model files (no .glTF, .fbx, .obj imports for the core structure). This is possible ONLY because these homes are fundamentally box-shaped.

**Rectangular homes (Assembly, Expandable, Duplex, Emergency):**
```
Parameters: width, depth, height, wallThickness, roofType (flat|gable), roofPitch
Generated geometry:
- 4 walls: BoxGeometry(width, height, wallThickness) positioned and rotated
- Floor: BoxGeometry(width, wallThickness, depth)
- Roof: flat = BoxGeometry, gable = custom BufferGeometry with triangular prism
- Door cutout: CSG subtraction or positioned plane with door texture
- Window cutouts: Same approach, positioned per model definition
- Porch: BoxGeometry for deck + cylinder/box posts + BoxGeometry overhang
```

**Apple Cabins:**
```
Parameters: radius, length
Generated geometry:
- Body: CapsuleGeometry(radius, length) or CylinderGeometry + SphereGeometry halves
- Door: cutout on flat face
- Windows: circular cutouts on curved surface (textured planes)
```

**Space Capsules:**
```
Parameters: radius, length, taper
Generated geometry:
- Body: LatheGeometry from custom profile curve (rounded elongated shape)
- Door/windows: textured planes at defined positions
```

**Textures as visual quality driver:**
- Real product photos mapped as textures onto flat surfaces.
- High-res hero textures on walls (actual siding/cladding photos from factory).
- Normal maps for depth illusion (rivets, panel seams, wood grain).
- This is how you make procedural geometry look premium: the geometry is simple, the textures do the heavy lifting.

**Quality bar for Enterprise tier ($20K license):**
- PBR materials: metalness, roughness, normal maps on all surfaces.
- HDRI environment lighting (3 presets: daylight, overcast, dusk).
- Ground plane with subtle shadow contact (soft shadow on a grey gradient plane).
- SSAO for depth perception at panel seams and overhangs.
- Anti-aliasing (FXAA minimum, MSAA if performance allows).
- Minimum 1024×1024 textures on primary surfaces, 512×512 on secondary.

#### 1.4.5 Upgrade Integration

Each upgrade is defined as:
```typescript
interface Upgrade {
  id: string;
  name: string;
  description: string;
  price: number;
  category: 'energy' | 'climate' | 'kitchen' | 'bathroom' | 'structural' | 'exterior';
  visual: boolean; // does this upgrade have a 3D visual representation?
  meshId?: string; // if visual, which mesh to show/hide
  attachPoint?: string; // where the visual attaches
  compatibleModels: string[]; // which models support this upgrade
}
```

**Upgrades with visual representation:**
- Solar panels: flat panel meshes on roof surface.
- Mini-split AC units: box meshes on exterior wall.
- Covered porch: extension geometry with posts and overhang.
- Kitchen cabinets: visible through window or in interior view mode.
- Awnings: fabric geometry over windows/doors.

**Upgrades without visual representation (price-only):**
- Generator (stored underneath or inside, not visible externally).
- Tankless water heater (interior).
- Washer/dryer (interior).
- Insulation upgrade (invisible, internal).
- Garbage disposal (interior plumbing).
- Window upgrade (same appearance, better specs — could change glass material reflectivity).

#### 1.4.6 SaaS / Licensing Architecture

**Indie ($299/month):**
- Embedded iframe widget (`<iframe src="https://configure.brightboxhomes.com/embed/{tenantId}">`)
- Bright Box Homes branding on configurator (or minimal "Powered by" badge)
- Single-unit configuration only
- Up to 5 product models
- Up to 10 color palettes
- 1,000 configuration sessions/month
- Email lead capture
- No API access

**Business ($799/month):**
- White-label: tenant's own logo, colors, domain (custom subdomain or CNAME)
- Single + multi-unit stacking
- Unlimited product models
- Unlimited color palettes
- 10,000 configuration sessions/month
- REST API access for CRM integration
- Saved configurations export
- Analytics dashboard
- Priority support

**Enterprise ($19,995/year or $49,995 perpetual):**
- Self-hosted license: full source code package
- Custom model import (bring your own 3D models in addition to procedural)
- Unlimited everything
- White-glove onboarding (10 hours included)
- Custom feature development (quoted separately)
- SLA with response time guarantees

**Tenant isolation:**
- Each tenant gets a unique `tenantId`.
- All data (products, colors, configurations, analytics) scoped by `tenantId`.
- Supabase Row Level Security (RLS) policies enforce tenant isolation at the database level.
- Tenant admin dashboard behind authenticated route.

### 1.5 User Flows

**Flow 1: Home Buyer Single-Unit Configuration**
1. Buyer lands on dealer website, clicks "Design Your Home" CTA.
2. Configurator loads in iframe or full-page embed (< 3 seconds).
3. Model selector panel shows available models with thumbnails and base prices.
4. Buyer clicks a model → 3D scene loads with default colors.
5. Buyer orbits the model (click-drag to rotate, scroll to zoom, right-click to pan).
6. Side panel shows color options: Exterior Walls section with color swatches.
7. Buyer clicks a swatch → walls update instantly.
8. Buyer scrolls to Roof Colors, selects one.
9. Buyer scrolls to Upgrades, toggles Solar Panels → solar mesh appears on roof, price updates.
10. Buyer toggles Mini-Split AC → unit appears on wall, price updates.
11. Buyer clicks "Save & Share" → configuration saved, share link generated.
12. Buyer clicks "Request Quote" → lead form overlay with name, email, phone, notes. Configuration ID attached.
13. Lead delivered to dealer via email + stored in dashboard.

**Flow 2: Investor Multi-Unit Building (Phase 2)**
1. Buyer selects "Design a Building" mode.
2. Grid view loads: top-down 2D grid + 3D perspective view.
3. Assembly Home models listed in side panel.
4. Buyer drags "Vantage" model onto grid position (0,0) → unit appears in 3D.
5. Buyer places 3 more units adjacent → row of 4 ground floor units.
6. Buyer clicks above unit (0,0) to start second floor → system prompts "Staircase required. Add staircase?" → Yes.
7. Staircase placed at position (0,0) front face.
8. Second floor units placed above ground floor.
9. Railings auto-added to exposed edges.
10. Buyer reviews pricing panel: 8 units × $27,995 + 2 staircases × $3,500 + railings = total.
11. Buyer exports design as PDF with floor plan, 3D render, and pricing breakdown.

**Flow 3: Dealer Setup (Phase 3)**
1. Dealer signs up at configure.brightboxhomes.com.
2. Selects plan (Indie/Business).
3. Stripe checkout → account provisioned.
4. Admin dashboard: "Add Your First Product."
5. Dealer enters: model name, dimensions (L×W×H), base price, description, photo.
6. System generates procedural 3D model from dimensions.
7. Dealer adds color palettes: clicks "Add Color," enters name and hex value.
8. Dealer adds upgrades: name, price, category.
9. Dealer previews configurator with their products.
10. Dealer copies embed code → pastes into their website.
11. Configurator live on their site within 30 minutes of signup.

### 1.6 MVP vs Phase 2 vs Phase 3 Roadmap

**MVP (Months 1–3): Single-Unit Configurator for Bright Box Homes**
- Scope IN: 3D viewport with orbit controls. Model selector (Assembly Homes + Expandable Container Homes). Exterior wall color, roof color, trim color from predefined palette. Upgrade toggles with price updates. Screenshot export. Save/share configuration links. Lead capture form. Responsive layout (desktop + tablet). Deployed on brightboxhomes.com.
- Scope OUT: Multi-unit stacking, accessory attachment, interior view, AR, SaaS multi-tenancy, admin dashboard, API, Duplex/Apple Cabin/Space Capsule models, analytics.

**Phase 2 (Months 4–6): Stacking + Accessories + Full Product Line**
- Multi-unit stacking for Assembly Homes with structural rules.
- Accessory system: staircases, railings, porches, decks.
- Apple Cabin and Space Capsule geometry.
- Duplex and Emergency Housing models.
- Interior view mode (camera inside unit looking around).
- Flooring color/material selection.
- PDF export with full pricing breakdown.
- Performance optimization for 20+ unit scenes.

**Phase 3 (Months 7–12): SaaS Platform**
- Multi-tenant architecture with Supabase RLS.
- Tenant admin dashboard (product catalog CRUD, color palette management, pricing rules, branding settings).
- Stripe billing integration for subscriptions.
- Embed widget with iframe + JavaScript SDK.
- White-label theming engine.
- REST API for CRM/webhook integrations.
- Analytics dashboard (sessions, conversions, popular configurations).
- Self-hosted packaging for Enterprise tier.

### 1.7 Success Metrics

**Bright Box Homes integration:**
- Configuration-to-lead conversion rate: target 15%+ (vs. industry average ~3% for static product pages).
- Average configuration value: track if users configure higher-value packages than phone/email quotes.
- Time-to-quote reduction: target <5 minutes self-service vs. 2–5 day current cycle.
- Lead quality: measure close rate on configurator-generated leads vs. traditional leads.

**SaaS product:**
- MRR target: $5K by Month 12, $15K by Month 18.
- Tenant acquisition: 5–10 paying tenants by end of Year 1.
- Churn: target <5% monthly (this market has long sales cycles and sticky tools).
- NPS: target 40+ from active tenants.

**Technical:**
- FPS: 60 FPS sustained on mid-range hardware with single unit, 30+ FPS with 20 units.
- Initial load time: <3 seconds on 50 Mbps connection.
- Model swap time: <1 second.
- Memory: <500MB GPU, <200MB JS heap at peak.
- Lighthouse performance score: 80+ on embed page.

### 1.8 Go-to-Market Strategy

**Bright Box Homes Launch (Month 3):**
- Deploy configurator as primary CTA on product pages.
- A/B test: product page with configurator vs. current static page. Measure lead conversion.
- Social media push: video demos of the configurator on Instagram, TikTok, YouTube (container home audience is very active on these).
- Email to existing Bright Box leads: "Now you can design your home online."

**SaaS Launch (Month 9):**
- Beta program: invite 3 target customers from the top 10 list. Free for 90 days in exchange for feedback and case study.
- Launch pricing: 20% early-adopter discount for first 20 customers (locked for 12 months).
- Content marketing: "How 3D Configurators Increase Prefab Home Sales" blog series. YouTube video walkthroughs. SEO targeting "prefab home configurator" and "container home 3D tool."
- Trade show presence: Offsite Construction Expo booth or demo pod.
- Partnership: approach Alibaba/DHgate container home suppliers who need US-market sales tools for their dealer networks.

---

## PHASE 2: ARCHITECTURE DOCUMENT

### 2.1 System Architecture

**High-Level Components:**

```
┌─────────────────────────────────────────────────────────┐
│                   CLIENT (Browser)                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  3D Viewport  │  │  Config UI   │  │  Admin Panel  │ │
│  │  (R3F/Three)  │  │  (React)     │  │  (React)      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            │                             │
│                     ┌──────▼──────┐                      │
│                     │ Zustand Store│                      │
│                     │ (config +   │                      │
│                     │  scene state)│                      │
│                     └──────┬──────┘                      │
└────────────────────────────┼────────────────────────────┘
                             │ HTTPS
                    ┌────────▼────────┐
                    │  Vercel Edge    │
                    │  (Next.js API   │
                    │   Routes)       │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼──────┐  ┌───▼────────┐
     │  Supabase   │  │  Vercel Blob │  │   Stripe   │
     │  (Postgres  │  │  / R2 CDN    │  │  (Billing) │
     │   + Auth    │  │  (Textures,  │  │            │
     │   + RLS)    │  │   HDRIs)     │  │            │
     └─────────────┘  └─────────────┘  └────────────┘
```

**Data Flow:**

1. Browser loads Next.js page → static shell renders instantly.
2. Configurator React component mounts → fetches tenant config + product catalog from Supabase (cached at edge via SWR).
3. 3D viewport initializes Three.js scene → loads HDRI environment map from CDN → generates procedural geometry from product dimensions.
4. User interactions update Zustand store → React re-renders UI panel → R3F reactively updates 3D scene.
5. "Save Configuration" → POST to API route → upserts to Supabase `configurations` table → returns short hash.
6. "Request Quote" → POST to API route → inserts to Supabase `leads` table → triggers email webhook → optionally pushes to tenant's CRM via webhook.

**Deployment Architecture:**

- **App:** Vercel (Next.js 15, Edge Runtime for API routes).
- **Database:** Supabase (Postgres with RLS, Auth for admin users).
- **Static Assets:** Vercel Blob Storage or Cloudflare R2 for textures, HDRIs, product photos. CDN-served with aggressive cache headers (textures are immutable).
- **Billing:** Stripe Checkout + Customer Portal for SaaS subscriptions.
- **Email:** Resend for transactional emails (lead notifications, welcome emails).
- **Analytics:** PostHog (self-hostable, privacy-friendly) for configuration analytics.

### 2.2 Monorepo Package Structure

```
brightbox/
├── apps/
│   ├── web/                        # Existing brightboxhomes.com Next.js app
│   │   ├── app/
│   │   │   ├── configure/          # Configurator page route
│   │   │   └── admin/              # SaaS admin dashboard routes
│   │   └── ...
│   └── docs/                       # Documentation site (optional)
├── packages/
│   ├── configurator/               # @brightbox/configurator — THE CORE PACKAGE
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── Viewport.tsx            # R3F Canvas wrapper
│   │   │   │   ├── Scene.tsx               # Scene graph root
│   │   │   │   ├── HomeModel.tsx           # Single home unit 3D component
│   │   │   │   ├── StackingGrid.tsx        # Multi-unit grid system
│   │   │   │   ├── Accessory.tsx           # Accessory component (stair, railing, etc.)
│   │   │   │   ├── Ground.tsx              # Ground plane + shadows
│   │   │   │   ├── Environment.tsx         # HDRI, lights, shadows
│   │   │   │   ├── CameraController.tsx    # Orbit controls + presets
│   │   │   │   ├── ModelSelector.tsx        # UI: model picker panel
│   │   │   │   ├── ColorPicker.tsx          # UI: color swatch panel
│   │   │   │   ├── UpgradePanel.tsx         # UI: upgrade toggles
│   │   │   │   ├── PricingSummary.tsx        # UI: running price total
│   │   │   │   ├── ShareDialog.tsx           # UI: save/share modal
│   │   │   │   ├── LeadCaptureForm.tsx       # UI: quote request form
│   │   │   │   └── ConfiguratorRoot.tsx      # Top-level composed component
│   │   │   ├── store/
│   │   │   │   ├── configStore.ts           # Zustand store for configuration state
│   │   │   │   ├── sceneStore.ts            # Zustand store for 3D scene state
│   │   │   │   └── tenantStore.ts           # Zustand store for tenant context
│   │   │   ├── geometry/
│   │   │   │   ├── boxHome.ts               # Procedural geometry for rectangular homes
│   │   │   │   ├── capsuleHome.ts           # Procedural geometry for capsule/pod homes
│   │   │   │   ├── accessories.ts           # Staircase, railing, porch geometry
│   │   │   │   └── snapPoints.ts            # Snap point definitions per model
│   │   │   ├── materials/
│   │   │   │   ├── pbrMaterial.ts           # PBR material factory
│   │   │   │   └── textureLoader.ts         # Texture loading + caching
│   │   │   ├── pricing/
│   │   │   │   └── calculator.ts            # Pricing engine
│   │   │   ├── serialization/
│   │   │   │   ├── serialize.ts             # Config state → JSON
│   │   │   │   └── deserialize.ts           # JSON → config state
│   │   │   ├── types/
│   │   │   │   └── index.ts                 # All TypeScript interfaces
│   │   │   └── index.ts                     # Public API exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── db/                          # @brightbox/db — Supabase client + types
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── types.ts                    # Generated from Supabase
│   │   │   └── queries/
│   │   │       ├── configurations.ts
│   │   │       ├── products.ts
│   │   │       ├── tenants.ts
│   │   │       └── leads.ts
│   │   └── package.json
│   └── ui/                          # @brightbox/ui — Shared UI components (existing)
├── pnpm-workspace.yaml
└── turbo.json
```

### 2.3 3D Engine Architecture

**Scene Graph:**
```
Scene
├── Environment
│   ├── HDRIBackground (EquirectangularTexture)
│   ├── AmbientLight (intensity: 0.4, color: 0xffffff)
│   ├── DirectionalLight (intensity: 1.2, position: [10, 15, 10], castShadow: true)
│   │   └── ShadowCamera (left: -20, right: 20, top: 20, bottom: -20, near: 0.1, far: 50)
│   └── HemisphereLight (skyColor: 0x87ceeb, groundColor: 0x444444, intensity: 0.3)
├── GroundPlane
│   └── Mesh (PlaneGeometry(100, 100), ShadowMaterial, receiveShadow: true)
├── HomeUnits (Group)
│   ├── HomeUnit_0 (Group, position: [0, 0, 0])
│   │   ├── Walls (Mesh[], castShadow: true)
│   │   ├── Roof (Mesh, castShadow: true)
│   │   ├── Floor (Mesh)
│   │   ├── Windows (Mesh[])
│   │   ├── Door (Mesh)
│   │   └── Upgrades (Group)
│   │       ├── SolarPanels (Mesh[], visible: toggle)
│   │       └── MiniSplit (Mesh, visible: toggle)
│   ├── HomeUnit_1 ...
│   └── ...
├── Accessories (Group)
│   ├── Staircase_0 (Group)
│   ├── Railing_0 (Group)
│   └── Porch_0 (Group)
└── Helpers (dev only)
    ├── GridHelper
    └── AxesHelper
```

**Camera System:**
```typescript
// OrbitControls with constraints
const cameraConfig = {
  fov: 45,
  near: 0.1,
  far: 1000,
  defaultPosition: [15, 10, 15], // isometric-ish default
  target: [0, 2, 0], // center of home at ~eye level
  minDistance: 3,
  maxDistance: 50,
  minPolarAngle: 0.1, // prevent going below ground
  maxPolarAngle: Math.PI / 2 - 0.05, // prevent going below horizon
  enableDamping: true,
  dampingFactor: 0.05,
  presets: {
    front: { position: [0, 5, 20], target: [0, 2, 0] },
    side: { position: [20, 5, 0], target: [0, 2, 0] },
    aerial: { position: [0, 25, 0.1], target: [0, 0, 0] },
    interior: { position: [0, 1.6, 0], target: [0, 1.6, -5] }, // eye height inside
  },
  transitionDuration: 800, // ms for camera preset transitions (GSAP or spring)
};
```

**Lighting Setup (Premium Quality):**
```typescript
// Key light (sun)
const directional = new DirectionalLight(0xffffff, 1.2);
directional.position.set(10, 15, 10);
directional.castShadow = true;
directional.shadow.mapSize.set(2048, 2048);
directional.shadow.camera.left = -20;
directional.shadow.camera.right = 20;
directional.shadow.camera.top = 20;
directional.shadow.camera.bottom = -20;
directional.shadow.bias = -0.0001;
directional.shadow.normalBias = 0.02;

// Fill light (ambient)
const ambient = new AmbientLight(0xffffff, 0.4);

// Sky fill (hemisphere)
const hemi = new HemisphereLight(0x87ceeb, 0x444444, 0.3);

// Environment map for PBR reflections
const envMap = new RGBELoader().load('/textures/studio_neutral.hdr');
scene.environment = envMap;
```

**Material System:**
```typescript
interface MaterialConfig {
  color: string; // hex
  roughness: number; // 0-1
  metalness: number; // 0-1
  normalMap?: string; // texture URL
  roughnessMap?: string;
  aoMap?: string;
}

const materialPresets: Record<string, MaterialConfig> = {
  siding: { color: '#ffffff', roughness: 0.8, metalness: 0.0 },
  metal_roof: { color: '#333333', roughness: 0.4, metalness: 0.7 },
  trim: { color: '#222222', roughness: 0.6, metalness: 0.1 },
  glass: { color: '#88ccff', roughness: 0.0, metalness: 0.0 }, // + transmission
  wood_deck: { color: '#8B4513', roughness: 0.9, metalness: 0.0 },
};

// Color swap = update material.color (instant, no texture reload)
function applyColor(mesh: Mesh, hexColor: string) {
  (mesh.material as MeshStandardMaterial).color.set(hexColor);
}
```

**Render Pipeline:**
```typescript
// Post-processing via @react-three/postprocessing
<EffectComposer>
  <SSAO
    radius={0.4}
    intensity={30}
    luminanceInfluence={0.6}
    samples={21}
  />
  <ToneMapping mode={ACESFilmicToneMapping} />
  <SMAA /> // or FXAA for lower-end devices
</EffectComposer>
```

**Asset Loading Strategy:**
- HDRI environment map: loaded once on scene init (~2MB, compressed). Cached in browser.
- Textures: lazy-loaded per material selection. 1024×1024 compressed (WebP/KTX2 via Basis Universal). ~50KB–200KB each.
- No LOD needed — geometry is simple procedural boxes. Total triangle count for a single unit is <5,000. 20 units = <100,000 triangles, trivial for any modern GPU.
- Texture atlas for common materials (all siding colors in one atlas) to minimize material switches.

### 2.4 Component Architecture

#### React Components (detailed)

**ConfiguratorRoot.tsx** — Top-level. Accepts `tenantId` prop. Initializes stores. Renders layout.
```typescript
interface ConfiguratorRootProps {
  tenantId: string;
  mode?: 'single' | 'multi'; // single-unit or multi-unit stacking
  initialConfigId?: string; // load saved config
  onLeadSubmit?: (lead: LeadData) => void; // callback for lead capture
  theme?: Partial<ThemeConfig>; // white-label overrides
}
```

**Viewport.tsx** — R3F Canvas wrapper. Handles WebGL context, resize, device pixel ratio.
```typescript
interface ViewportProps {
  className?: string;
  shadowQuality?: 'low' | 'medium' | 'high';
}
```

**Scene.tsx** — Scene graph root. Renders Environment, Ground, HomeUnits, Accessories.

**HomeModel.tsx** — Single home unit. Consumes `configStore` for colors/upgrades. Generates procedural geometry via `boxHome.ts` or `capsuleHome.ts` based on model type.
```typescript
interface HomeModelProps {
  modelId: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  selected?: boolean;
}
```

**ModelSelector.tsx** — UI panel listing available models with thumbnails and base prices. Click to select.
```typescript
// Reads from tenantStore.products, dispatches to configStore.selectModel
```

**ColorPicker.tsx** — UI panel with labeled color swatches. Sections for walls, roof, trim, floor.
```typescript
interface ColorPickerProps {
  section: 'walls' | 'roof' | 'trim' | 'floor';
}
```

**UpgradePanel.tsx** — Toggle switches for each available upgrade. Shows upgrade name, description, price. Toggles update `configStore.upgrades` and trigger mesh visibility in 3D.

**PricingSummary.tsx** — Computed from `configStore`. Base price + sum of enabled upgrade prices. Itemized breakdown. Sticky at bottom of panel on desktop.

**ShareDialog.tsx** — Modal with shareable URL + copy button + social share buttons. Triggers save to Supabase.

**LeadCaptureForm.tsx** — Name, email, phone, notes. Submits to API route. Attaches configurationId. Success confirmation with saved design link.

### 2.5 State Management

**Recommendation: Zustand.** Justification: Minimal boilerplate, excellent TypeScript support, built-in persist middleware for save/load, no provider wrapping needed (works across R3F and React DOM), subscriptions for selective re-rendering.

**configStore (configuration state):**
```typescript
interface ConfigState {
  // Selected model
  modelId: string | null;
  modelName: string;
  modelDimensions: { width: number; depth: number; height: number };
  basePrice: number;

  // Colors
  wallColor: string; // hex
  roofColor: string;
  trimColor: string;
  floorColor: string;
  floorMaterial: string; // material preset key

  // Upgrades
  upgrades: Record<string, boolean>; // upgradeId → enabled

  // Multi-unit (Phase 2)
  units: Array<{
    id: string;
    modelId: string;
    gridPosition: { x: number; y: number; z: number }; // z = floor level
    colors: { wall: string; roof: string; trim: string; floor: string };
    upgrades: Record<string, boolean>;
  }>;

  // Accessories (Phase 2)
  accessories: Array<{
    id: string;
    type: 'staircase' | 'railing' | 'porch' | 'deck' | 'awning';
    attachedToUnitId: string;
    attachFace: 'front' | 'back' | 'left' | 'right' | 'top';
    position: { x: number; y: number; z: number };
  }>;

  // Computed
  totalPrice: number; // derived

  // History (undo/redo)
  past: ConfigState[];
  future: ConfigState[];

  // Actions
  selectModel: (modelId: string) => void;
  setColor: (target: 'wall' | 'roof' | 'trim' | 'floor', color: string) => void;
  toggleUpgrade: (upgradeId: string) => void;
  addUnit: (modelId: string, gridPosition: GridPosition) => void;
  removeUnit: (unitId: string) => void;
  addAccessory: (accessory: AccessoryConfig) => void;
  undo: () => void;
  redo: () => void;
  serialize: () => string; // JSON
  deserialize: (json: string) => void;
  reset: () => void;
}
```

**Undo/redo:** Implemented via Zustand `temporal` middleware (zustand/middleware). Stores snapshots on each action. Limit history to 50 entries to bound memory.

**State serialization:**
```typescript
function serialize(state: ConfigState): string {
  // Strip computed fields and history, keep only user choices
  const serializable = {
    v: 1, // schema version
    m: state.modelId,
    c: { w: state.wallColor, r: state.roofColor, t: state.trimColor, f: state.floorColor },
    u: Object.entries(state.upgrades).filter(([,v]) => v).map(([k]) => k),
    units: state.units, // Phase 2
    acc: state.accessories, // Phase 2
  };
  return btoa(JSON.stringify(serializable)); // base64 for URL-safe encoding
}
```

**State sync between UI and 3D:** Zustand store is the single source of truth. R3F components use `useStore(configStore, selector)` with shallow equality to subscribe to only the fields they need, preventing unnecessary re-renders.

### 2.6 API Design

**Recommendation: tRPC.** Justification: End-to-end type safety with your TypeScript monorepo. No schema drift between client and server. Works natively with Next.js App Router. Smaller bundle than REST + validation library. If you need to expose a public REST API for Business/Enterprise tenants later, you can add a REST adapter or a separate route handler.

**Procedures:**

```typescript
// Configurations
configurator.save         // POST: save configuration → returns { id, shortHash }
configurator.load         // GET: load configuration by shortHash → returns ConfigState
configurator.list         // GET: list configurations for tenant (admin) → paginated
configurator.delete       // DELETE: soft-delete configuration

// Products (admin)
products.list             // GET: list products for tenant
products.create           // POST: create product (model definition)
products.update           // PATCH: update product
products.delete           // DELETE: soft-delete product

// Color Palettes (admin)
palettes.list             // GET: list palettes for tenant
palettes.upsert           // POST: create/update palette

// Pricing Rules (admin)
pricing.getUpgrades       // GET: list upgrades with prices for tenant
pricing.upsertUpgrade     // POST: create/update upgrade

// Tenants (admin, super-admin)
tenants.get               // GET: tenant profile
tenants.update            // PATCH: update branding, settings
tenants.usage             // GET: session counts, config counts

// Leads
leads.submit              // POST: submit lead form (public, rate-limited)
leads.list                // GET: list leads for tenant (admin)

// Analytics
analytics.track           // POST: track event (config started, model selected, etc.)
analytics.summary         // GET: aggregated analytics for tenant (admin)

// Auth
auth.signIn               // POST: Supabase Auth sign-in (admin)
auth.signUp               // POST: tenant registration
```

**Rate limiting:** Edge middleware. Public endpoints (save, load, leads.submit, analytics.track): 60 req/min per IP. Admin endpoints: 120 req/min per authenticated user. Configure via Vercel Edge middleware or Upstash Redis rate limiter.

**Authentication:** Supabase Auth for admin users. Public configurator endpoints (save, load, leads) require no authentication but are rate-limited and tenant-scoped via `tenantId` in the request.

### 2.7 Database Schema (Supabase Postgres)

```sql
-- Tenants (SaaS customers)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- URL-safe identifier
  plan TEXT NOT NULL DEFAULT 'indie' CHECK (plan IN ('indie', 'business', 'enterprise')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  branding JSONB NOT NULL DEFAULT '{}', -- { logo_url, primary_color, accent_color, font }
  settings JSONB NOT NULL DEFAULT '{}', -- { session_limit, features_enabled }
  custom_domain TEXT, -- CNAME for white-label
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_stripe ON tenants(stripe_customer_id);

-- Tenant Users (admin accounts)
CREATE TABLE tenant_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL, -- Supabase Auth user ID
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tenant_users_auth ON tenant_users(auth_user_id, tenant_id);

-- Products (home models)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN (
    'assembly', 'expandable', 'duplex', 'apple_cabin', 'space_capsule', 'emergency'
  )),
  dimensions JSONB NOT NULL, -- { width, depth, height, wallThickness }
  base_price INTEGER NOT NULL, -- cents
  description TEXT,
  photo_url TEXT,
  roof_type TEXT NOT NULL DEFAULT 'flat' CHECK (roof_type IN ('flat', 'gable')),
  roof_pitch NUMERIC DEFAULT 0,
  stackable BOOLEAN NOT NULL DEFAULT false,
  config_type TEXT NOT NULL DEFAULT 'single' CHECK (config_type IN ('single', 'multi')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_products_tenant ON products(tenant_id) WHERE active = true;
CREATE UNIQUE INDEX idx_products_slug ON products(tenant_id, slug);

-- Color Palettes
CREATE TABLE color_palettes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Exterior Wall Colors"
  target TEXT NOT NULL CHECK (target IN ('wall', 'roof', 'trim', 'floor')),
  colors JSONB NOT NULL, -- [{ name: "Arctic White", hex: "#F5F5F5" }, ...]
  product_ids UUID[], -- null = applies to all products
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_palettes_tenant ON color_palettes(tenant_id);

-- Upgrades
CREATE TABLE upgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL, -- cents
  category TEXT NOT NULL CHECK (category IN (
    'energy', 'climate', 'kitchen', 'bathroom', 'structural', 'exterior'
  )),
  has_visual BOOLEAN NOT NULL DEFAULT false,
  visual_config JSONB, -- { meshType, attachPoint, dimensions }
  compatible_product_ids UUID[], -- null = all products
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upgrades_tenant ON upgrades(tenant_id) WHERE active = true;

-- Saved Configurations
CREATE TABLE configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  short_hash TEXT NOT NULL, -- 8-char URL-safe hash
  state JSONB NOT NULL, -- full serialized configuration state
  model_name TEXT, -- denormalized for queries
  total_price INTEGER, -- cents, denormalized
  screenshot_url TEXT,
  session_id TEXT, -- anonymous session tracking
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '90 days')
);

CREATE UNIQUE INDEX idx_configs_hash ON configurations(tenant_id, short_hash);
CREATE INDEX idx_configs_tenant_created ON configurations(tenant_id, created_at DESC);

-- Leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  configuration_id UUID REFERENCES configurations(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed_won', 'closed_lost')),
  metadata JSONB DEFAULT '{}', -- UTM params, referrer, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_tenant ON leads(tenant_id, created_at DESC);
CREATE INDEX idx_leads_status ON leads(tenant_id, status);

-- Analytics Events
CREATE TABLE analytics_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'config_started', 'model_selected', 'color_changed', 'upgrade_toggled', 'config_saved', 'lead_submitted'
  event_data JSONB DEFAULT '{}',
  session_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_tenant_type ON analytics_events(tenant_id, event_type, created_at DESC);
-- Partition by month for large-scale tenants (Phase 3 optimization)

-- Row Level Security Policies
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE color_palettes ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Policy: tenant users can only access their own tenant's data
CREATE POLICY tenant_isolation ON products
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE auth_user_id = auth.uid()
    )
  );
-- (repeat for all tenant-scoped tables)

-- Policy: public read for configurations (share links)
CREATE POLICY config_public_read ON configurations
  FOR SELECT USING (true); -- anyone with the hash can view

-- Policy: public insert for configurations and leads (rate-limited at API layer)
CREATE POLICY config_public_insert ON configurations
  FOR INSERT WITH CHECK (true);

CREATE POLICY leads_public_insert ON leads
  FOR INSERT WITH CHECK (true);
```

### 2.8 Performance Strategy

**Targets:**
- 60 FPS single unit on GTX 1060 / M1 MacBook Air.
- 30+ FPS with 20 units on same hardware.
- <3s initial load (including 3D scene).
- <1s model swap.
- <500MB GPU memory, <200MB JS heap.

**Optimization techniques:**

1. **Instanced rendering:** When placing multiple identical units in stacking mode, use `InstancedMesh`. 20 identical units = 1 draw call instead of 20.

2. **Geometry merging:** Merge all static geometry per unit (walls + roof + floor) into a single `BufferGeometry` using `BufferGeometryUtils.mergeGeometries`. Reduces draw calls per unit from 6+ to 1.

3. **Texture atlasing:** All siding colors that are solid hex values don't need textures at all — just `material.color.set()`. For material textures (wood, stone), combine into a 2048×2048 atlas and use UV offsets.

4. **Object pooling:** Pre-create a pool of 20 `HomeUnit` objects. On place/remove, toggle visibility and update transforms rather than creating/destroying Three.js objects (which triggers GC).

5. **Frustum culling:** Three.js does this by default. No units off-screen are rendered.

6. **Shadow map reuse:** Only update shadow map when scene changes (units added/removed/moved). Use `renderer.shadowMap.autoUpdate = false` and manually trigger `renderer.shadowMap.needsUpdate = true` on changes.

7. **Progressive loading:** Render scene with placeholder materials immediately → load high-res textures async → swap materials when loaded. User sees the model within 1 second, quality improves over 2–3 seconds.

8. **Adaptive quality:** Detect GPU via `renderer.capabilities` or frame time. If FPS drops below 30, auto-reduce shadow map resolution and disable SSAO.

**Monitoring:**
- Client-side FPS tracking via `Stats.js` (dev mode) and periodic sampling in production → send to analytics.
- JS heap size via `performance.memory` (Chrome only) → alert if >150MB.
- Load time tracked via `PerformanceObserver` → report as custom metric.

### 2.9 Build and Deployment Pipeline

**Package build:**
```bash
# @brightbox/configurator builds as a library
pnpm --filter @brightbox/configurator build
# Output: dist/index.js (ESM), dist/index.d.ts (types)
# Build tool: tsup (fast, zero-config for library builds)
```

**Asset pipeline:**
```bash
# Texture optimization (run in CI)
# Input: /assets/textures/raw/*.png (source textures)
# Output: /public/textures/*.webp (compressed, optimized)
# Tool: sharp CLI for resize + WebP conversion
sharp -i assets/textures/raw/*.png -o public/textures/ --webp --resize 1024 1024
# HDRI: compress with @gltf-transform/cli or use pre-compressed from polyhaven.com
```

**CI/CD (GitHub Actions):**
```yaml
# On push to main:
# 1. Lint (eslint + tsc --noEmit)
# 2. Test (vitest for unit tests, playwright for e2e)
# 3. Build all packages (turbo build)
# 4. Deploy to Vercel (automatic via Vercel GitHub integration)

# On PR:
# 1. Same lint/test/build
# 2. Vercel Preview Deployment (auto)
# 3. Lighthouse CI check on preview URL
```

**Preview deployments:** Every PR gets a Vercel Preview URL. Share with stakeholders for review. Preview environments use a separate Supabase project (staging).

**Production deployment:** Merge to `main` → Vercel builds and deploys to production edge network. Zero-downtime deployment (immutable deployments, instant rollback via Vercel dashboard).

**Rollback:** Vercel maintains deployment history. Rollback = promote a previous deployment to production via CLI (`vercel rollback`) or dashboard. Takes <30 seconds.

---

## APPENDIX: Critical Decisions Summary

| Decision | Choice | Why |
|----------|--------|-----|
| 3D engine | Three.js + R3F | Smaller bundle, better React integration, sufficient for box geometry |
| State management | Zustand | Minimal boilerplate, works across R3F + React DOM, built-in undo middleware |
| API layer | tRPC | End-to-end type safety in TypeScript monorepo |
| Database | Supabase Postgres + RLS | Already in stack, RLS handles tenant isolation natively |
| Geometry approach | Procedural (no 3D model files) | Container homes are boxes. Procedural is faster to iterate, no asset pipeline for models. |
| Pricing model | Monthly recurring SaaS | Predictable revenue, lower barrier to entry than one-time |
| MVP scope | Single-unit configurator on own site only | Prove value before selling to others |
| Mobile strategy | View-only on mobile | Configuring 3D on phone is bad UX. Don't waste time on it. |
