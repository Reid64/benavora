// WCAG contrast-ratio check for the marketing "Forest and paper" palette.
// Parses hex values straight out of src/lib/marketing/theme.ts (never
// hardcodes duplicates), computes contrast ratios for 6 required color
// pairs, writes test-evidence/marketing/mkt-003/contrast.json, and exits
// non-zero if any of the 3 gated pairs fail their WCAG minimum.
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const THEME_FILE = path.join(ROOT, "src", "lib", "marketing", "theme.ts");
const OUT_FILE = path.join(ROOT, "test-evidence", "marketing", "mkt-003", "contrast.json");

function parseTheme(source) {
  const mkBlock = source.match(/export const mk = \{([\s\S]*?)\} as const;/);
  if (!mkBlock) throw new Error("Could not find `mk` export in theme.ts");
  const mk = {};
  const lineRe = /(\w+):\s*"(#[0-9A-Fa-f]{6})"/g;
  let m;
  while ((m = lineRe.exec(mkBlock[1])) !== null) {
    mk[m[1]] = m[2];
  }
  return mk;
}

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

function channelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [rl, gl, bl] = [r, g, b].map(channelToLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function darkenChannelSteps(hex, steps) {
  const { r, g, b } = hexToRgb(hex);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const toHex = (v) => clamp(v).toString(16).padStart(2, "0");
  const nr = clamp(r - steps * 4);
  const ng = clamp(g - steps * 4);
  const nb = clamp(b - steps * 4);
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`.toUpperCase();
}

const PAIRS = [
  { name: "terracotta on surface", fg: "terracotta", bg: "surface", min: 4.5, gated: true },
  { name: "heroMuted on forest", fg: "heroMuted", bg: "forest", min: 4.5, gated: true },
  { name: "ink on paper", fg: "ink", bg: "paper", min: 7, gated: true },
  { name: "heroText on forest", fg: "heroText", bg: "forest", min: null, gated: false },
  { name: "muted on paper", fg: "muted", bg: "paper", min: null, gated: false },
  { name: "forest on paper", fg: "forest", bg: "paper", min: null, gated: false },
];

function runChecks(mk) {
  return PAIRS.map((pair) => {
    const fgHex = mk[pair.fg];
    const bgHex = mk[pair.bg];
    const ratio = contrastRatio(fgHex, bgHex);
    const passes = pair.min === null ? null : ratio >= pair.min;
    return { ...pair, fgHex, bgHex, ratio: Math.round(ratio * 100) / 100, passes };
  });
}

function printTable(results) {
  console.log("");
  console.log(
    "pair".padEnd(24) + "fg".padEnd(10) + "bg".padEnd(10) + "ratio".padEnd(8) + "min".padEnd(6) + "result"
  );
  for (const r of results) {
    const result = r.min === null ? "n/a" : r.passes ? "PASS" : "FAIL";
    console.log(
      r.name.padEnd(24) +
        r.fgHex.padEnd(10) +
        r.bgHex.padEnd(10) +
        String(r.ratio).padEnd(8) +
        String(r.min ?? "-").padEnd(6) +
        result
    );
  }
  console.log("");
}

function main() {
  const source = fs.readFileSync(THEME_FILE, "utf-8");
  const mk = parseTheme(source);

  let results = runChecks(mk);
  printTable(results);

  const terracottaPair = results.find((r) => r.name === "terracotta on surface");
  let adjustedTerracotta = null;

  if (!terracottaPair.passes) {
    let steps = 0;
    let hex = mk.terracotta;
    while (steps < 60) {
      steps += 1;
      hex = darkenChannelSteps(mk.terracotta, steps);
      const ratio = contrastRatio(hex, mk.surface);
      if (ratio >= 4.5) {
        adjustedTerracotta = { hex, steps, ratio: Math.round(ratio * 100) / 100 };
        break;
      }
    }
    if (!adjustedTerracotta) {
      throw new Error("Could not darken mk.terracotta enough to pass 4.5:1 on surface within 60 steps");
    }

    const updatedSource = source.replace(
      /terracotta: "#[0-9A-Fa-f]{6}"/,
      `terracotta: "${adjustedTerracotta.hex}"`
    );
    fs.writeFileSync(THEME_FILE, updatedSource);

    mk.terracotta = adjustedTerracotta.hex;
    results = runChecks(mk);
    printTable(results);
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const output = {
    generatedFrom: "src/lib/marketing/theme.ts",
    pairs: results,
    terracottaAdjustment: adjustedTerracotta,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`);

  const gatedFailures = results.filter((r) => r.gated && !r.passes);
  if (gatedFailures.length) {
    console.error(`FAILED gated pairs: ${gatedFailures.map((r) => r.name).join(", ")}`);
    process.exit(1);
  }
  console.log("All gated contrast pairs pass.");
}

main();
