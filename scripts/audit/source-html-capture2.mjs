import { chromium } from "playwright";
import fs from "fs";

const SRC = "file:///" + "C:/Users/manag/Downloads/Recent Downloads/Benavora-Marketing (10).html".replace(/ /g, "%20");
const OUT_DIR = "C:/Users/manag/Documents/benavora/AUDIT_SCREENSHOTS";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(SRC, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const stage = await page.$(".bnf-stage");
await stage.screenshot({ path: `${OUT_DIR}/source-brain-stage.png` });

const computed = await page.evaluate(() => {
  function cs(sel, props) {
    const el = document.querySelector(sel);
    if (!el) return { __missing: sel };
    const c = getComputedStyle(el);
    const out = { __text: el.textContent?.slice(0, 60) };
    for (const p of props) out[p] = c.getPropertyValue(p);
    return out;
  }
  return {
    fleetVars: (() => {
      const el = document.querySelector("#benavora-neural-fleet");
      const c = getComputedStyle(el);
      return {
        background: c.getPropertyValue("--background"),
        card: c.getPropertyValue("--card"),
        border: c.getPropertyValue("--border"),
        mutedFg: c.getPropertyValue("--muted-foreground"),
        primary: c.getPropertyValue("--primary"),
        primaryFg: c.getPropertyValue("--primary-foreground"),
      };
    })(),
    node0: cs(".bnf-node.n0", ["background-color", "background-image", "border-color", "box-shadow", "border-radius"]),
    nodeName: cs(".bnf-node-name", ["color", "font-weight", "font-size"]),
    nodeRole: cs(".bnf-node-role", ["color", "font-size"]),
    nodeCount: cs(".bnf-count", ["background-color", "border-color", "color"]),
    core: cs(".bnf-core", ["background-color", "background-image", "border-color", "box-shadow", "width", "height"]),
    core44: cs(".bnf-44", ["color", "font-size", "font-weight"]),
    coreLabel: cs(".bnf-core-label", ["color", "font-size", "letter-spacing"]),
    coreSub: cs(".bnf-core-sub", ["color"]),
    detail: cs(".bnf-detail", ["color", "max-width"]),
    signal: cs(".bnf-signal", ["color", "letter-spacing", "text-transform"]),
    detailStrong: cs(".bnf-detail strong", ["color"]),
    detailSpan: cs(".bnf-detail span", ["color"]),
    brainPhotoEl: (() => {
      const el = document.querySelector(".bnf-brain-photo");
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        width: c.width, height: c.height, position: c.position,
        left: c.left, top: c.top, transform: c.transform,
        backgroundImage: c.backgroundImage.slice(0, 60) + "...",
      };
    })(),
  };
});
fs.writeFileSync(`${OUT_DIR}/computed-detail.json`, JSON.stringify(computed, null, 2));
await browser.close();
console.log("done");
