// One-time rename: bg-white -> bg-surface, bg-white-sunken -> bg-surface-sunken.
// Both already resolve to the exact same CSS variable value via tailwind.config.ts's
// existing `surface`/`surface-sunken` color keys - this is a pure rename, no value change.
// Deliberately excludes bg-white-raised (dead/no-op class, unrelated bug, out of scope)
// and bg-white/NN opacity-modifier forms (never intercepted by the compat layer; renaming
// would break them since `surface` isn't an alpha-value-compatible color definition).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const files = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean);

let filesChanged = 0;
let totalReplacements = 0;

for (const file of files) {
  const original = readFileSync(file, "utf8");
  let text = original;
  let count = 0;

  // Step 1: exact "bg-white-sunken" -> "bg-surface-sunken" (must run before step 2,
  // since step 2's negative lookahead would otherwise skip it entirely by design).
  text = text.replace(/bg-white-sunken/g, () => {
    count++;
    return "bg-surface-sunken";
  });

  // Step 2: bare "bg-white" token only - not followed by "-" (bg-white-raised etc.)
  // or "/" (bg-white/50 opacity forms). Handles variant prefixes (hover:bg-white,
  // disabled:bg-white, etc.) since the prefix is unaffected by this pattern.
  text = text.replace(/bg-white(?![-/\w])/g, () => {
    count++;
    return "bg-surface";
  });

  if (count > 0) {
    writeFileSync(file, text, "utf8");
    filesChanged++;
    totalReplacements += count;
    console.log(`${file}: ${count}`);
  }
}

console.log(`\nTOTAL: ${filesChanged} files changed, ${totalReplacements} replacements`);
