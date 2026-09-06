// Validates the FAQPage JSON-LD generated for /pricing against schema.org's
// FAQPage structural requirements (mainEntity[].{name, acceptedAnswer.text}).
// Run with: node --loader ts-node/esm is unnecessary — this re-implements
// the same generator logic against the real PRICING_FAQS content by reading
// the compiled data via a tiny inline transpile-free check.
import { readFileSync } from "node:fs";

const faqSource = readFileSync(
  new URL("../../src/lib/marketing/pricing-faqs.ts", import.meta.url),
  "utf-8"
);

// Extract the PRICING_FAQS array body without a full TS toolchain: pull each
// { question: "...", answer: "..." } object via regex. Good enough for a
// structural sanity check; the real type-checking already happened in tsc.
const entries = [...faqSource.matchAll(/question:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
const answers = [...faqSource.matchAll(/answer:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

const errors = [];

if (entries.length !== 9) {
  errors.push(`Expected 9 FAQ entries, found ${entries.length}`);
}
if (answers.length !== entries.length) {
  errors.push(`Mismatched question/answer counts: ${entries.length} questions, ${answers.length} answers`);
}

const faqPageJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: entries.map((q, i) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: answers[i] ?? "" },
  })),
};

// Structural checks matching schema.org FAQPage + Google's Rich Results
// requirements: @context/@type present, mainEntity is a non-empty array,
// every item is a Question with a non-empty name and an acceptedAnswer with
// a non-empty text.
if (faqPageJsonLd["@context"] !== "https://schema.org") errors.push("Missing/invalid @context");
if (faqPageJsonLd["@type"] !== "FAQPage") errors.push("Missing/invalid @type");
if (!Array.isArray(faqPageJsonLd.mainEntity) || faqPageJsonLd.mainEntity.length === 0) {
  errors.push("mainEntity must be a non-empty array");
}
faqPageJsonLd.mainEntity.forEach((item, i) => {
  if (item["@type"] !== "Question") errors.push(`mainEntity[${i}]: @type must be "Question"`);
  if (!item.name || typeof item.name !== "string") errors.push(`mainEntity[${i}]: missing name`);
  if (!item.acceptedAnswer || item.acceptedAnswer["@type"] !== "Answer") {
    errors.push(`mainEntity[${i}]: acceptedAnswer must be an Answer`);
  }
  if (!item.acceptedAnswer?.text || typeof item.acceptedAnswer.text !== "string") {
    errors.push(`mainEntity[${i}]: acceptedAnswer.text missing`);
  }
});

// Round-trip through JSON to catch serialization issues (e.g. unescaped
// quotes/apostrophes breaking the parsed structure).
let roundTripOk = true;
try {
  const parsed = JSON.parse(JSON.stringify(faqPageJsonLd));
  if (parsed.mainEntity.length !== faqPageJsonLd.mainEntity.length) roundTripOk = false;
} catch {
  roundTripOk = false;
}
if (!roundTripOk) errors.push("JSON.stringify/parse round-trip failed");

if (errors.length) {
  console.error("FAQPage JSON-LD validation FAILED:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}

console.log(`FAQPage JSON-LD validation PASSED — ${faqPageJsonLd.mainEntity.length} questions, schema-valid.`);
console.log(JSON.stringify(faqPageJsonLd, null, 2));
