import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const SRC = "file:///" + "C:/Users/manag/Downloads/Recent Downloads/Benavora-Marketing (10).html".replace(/ /g, "%20");
const OUT_DIR = "C:/Users/manag/Documents/benavora/AUDIT_SCREENSHOTS";

const browser = await chromium.launch();

async function shoot(viewport, label) {
  const page = await browser.newPage({ viewport });
  await page.goto(SRC, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/source-${label}-full.png`, fullPage: true });
  await page.screenshot({ path: `${OUT_DIR}/source-${label}-viewport.png`, fullPage: false });

  const computed = await page.evaluate(() => {
    function cs(sel, props) {
      const el = document.querySelector(sel);
      if (!el) return { __missing: sel };
      const c = getComputedStyle(el);
      const out = { __text: el.textContent?.slice(0, 80) };
      for (const p of props) out[p] = c.getPropertyValue(p);
      return out;
    }
    return {
      body: cs("body", ["background-color"]),
      brandbarWrap: cs(".bm-brandbar", ["padding-top", "padding-bottom"]),
      brand: cs(".bm-brand", ["width", "height", "mix-blend-mode"]),
      brandTagline: cs(".bm-brand-tagline", ["color", "font-size"]),
      taglineSpan2: cs(".bm-brand-tagline span:nth-child(2)", ["color"]),
      heroEyebrow: cs(".bm-hero .bm-eyebrow", ["color", "font-size", "letter-spacing", "text-transform"]),
      heroH1: cs(".bm-hero h1", ["color", "font-size", "font-weight", "letter-spacing", "line-height"]),
      heroH1Span: cs(".bm-hero h1 span", ["color"]),
      lede: cs(".bm-lede", ["color", "font-size", "line-height", "max-width"]),
      link: cs(".bm-link", ["color", "background-color", "border-color", "border-radius", "padding", "font-weight", "font-size"]),
      autonomyIntro: cs(".bm-autonomy-intro", ["text-align", "padding-top", "padding-bottom"]),
      autonomyH2: cs(".bm-autonomy-intro h2", ["color", "font-size", "font-weight", "letter-spacing"]),
      autonomyP: cs(".bm-autonomy-intro > p:last-child", ["color", "max-width", "font-size"]),
      fleetBg: cs("#benavora-neural-fleet", ["background-color"]),
      stageBg: cs(".bnf-stage", ["background-color"]),
      brainPhoto: cs(".bnf-brain-photo", ["opacity", "mix-blend-mode", "filter", "background-size", "max-width", "mask-image"]),
      aurora: cs(".bnf-aurora", ["display"]),
      grid: cs(".bnf-grid", ["display"]),
      benefits: cs(".bm-autonomy-benefits", ["display", "grid-template-columns", "gap"]),
      benefitH3: cs(".bm-autonomy-benefits article:first-child h3", ["color", "font-size", "font-weight"]),
      benefitP: cs(".bm-autonomy-benefits article:first-child p", ["color", "font-size"]),
      toolkitEyebrow: cs(".bm-toolkit > .bm-eyebrow", ["color", "font-size", "font-weight", "letter-spacing"]),
      toolkitH2: cs(".bm-toolkit h2", ["color", "font-size", "font-weight"]),
      toolkitIntro: cs(".bm-intro", ["color", "font-size", "max-width"]),
      grid6: cs(".bm-grid", ["display", "grid-template-columns", "gap"]),
      wideFeature: cs(".bm-feature.bm-wide", ["background-color", "border", "border-radius", "padding"]),
      wideTag: cs(".bm-feature.bm-wide h3.bm-tag", ["color", "font-size", "font-weight"]),
      wideBenefit: cs(".bm-feature.bm-wide p.bm-feature-benefit", ["color", "font-size", "font-weight"]),
      plainFeature: cs(".bm-feature:not(.bm-wide)", ["background-color", "border", "border-top", "padding"]),
      plainTag: cs(".bm-feature:not(.bm-wide) h3.bm-tag", ["color", "font-size", "font-weight"]),
      plainBenefit: cs(".bm-feature:not(.bm-wide) p.bm-feature-benefit", ["color", "font-size"]),
      featureBody: cs(".bm-feature p:not(.bm-feature-benefit)", ["color", "font-size", "line-height"]),
      featureSummary: cs(".bm-feature summary", ["color", "font-size"]),
      end: cs(".bm-end", ["text-align", "border-top", "margin-top", "padding-top"]),
      endH3: cs(".bm-end h3", ["color", "font-size", "font-weight"]),
      endP: cs(".bm-end p", ["color"]),
      allFeatureCount: document.querySelectorAll(".bm-feature").length,
      wideFeatureCount: document.querySelectorAll(".bm-feature.bm-wide").length,
      nodeCount: document.querySelectorAll(".bnf-node").length,
    };
  });

  const fs = await import("fs");
  fs.writeFileSync(`${OUT_DIR}/computed-${label}.json`, JSON.stringify(computed, null, 2));
  await page.close();
}

await shoot({ width: 1440, height: 900 }, "desktop");
await shoot({ width: 390, height: 844 }, "mobile");

await browser.close();
console.log("done");
