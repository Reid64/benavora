// AR-17.6: structural enforcement that no figure, outcome, beneficiary
// count, or past-award claim can survive in a draft unless it traces back
// to the organization's own stored data (or the funder's own stated
// opportunity data -- a legitimate source for a draft to cite). This is a
// deliberately narrow, regex-based net, not full NLP fact-checking -- but
// it is a hard backstop. Prompt-level "do not fabricate" instructions
// (grant-narrative.ts's ABSOLUTE RULES, draft-generation-agent.ts's
// sectionSystem) are the first line of defense and were shown (AR-17.4) to
// fail on the twin-powered path (fabricated phone number, every run) and on
// an empty-profile org (94% retention rate, twelve years of operation, 340
// housing units, 28 FTE staff -- none of it real). This is the second
// line: scan what the model actually returned, not what it was told to do.

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

const NUMBER_WORD_PATTERN = Object.keys(WORD_NUMBERS).join("|");

// Each pattern binds a number (digit or spelled-out) tightly to a
// unit/noun that makes it a countable claim, rather than an incidental
// digit (a year standing alone, a section number, a page reference).
function buildFigurePatterns(): RegExp[] {
  return [
    /\b\d{1,3}(?:\.\d+)?\s?%/gi, // 94%
    /\$[\d,]+(?:\.\d+)?(?:\s?(?:million|billion|k))?/gi, // $75,000 / $2.5 million
    new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+)[\\s-]?(?:years?|yrs?)\\b`, "gi"), // 12 years / twelve years
    new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+)[\\s-]?units?\\b`, "gi"), // 340-unit / 340 units
    new RegExp(`\\b(${NUMBER_WORD_PATTERN}|\\d+)\\s?(?:FTE|full-time (?:staff|employees))\\b`, "gi"), // 28 FTE
    new RegExp(
      `\\b(${NUMBER_WORD_PATTERN}|\\d+)\\s?(?:beneficiaries|clients|families|individuals|households|residents|participants)\\b`,
      "gi",
    ),
  ];
}

export interface FigureFinding {
  /** The exact matched substring in the draft (e.g. "340-unit", "94%"). */
  match: string;
  /** The numeric value extracted in digit form, for corpus comparison. */
  numericValue: string;
}

function wordToDigits(token: string): string {
  const lower = token.toLowerCase();
  return WORD_NUMBERS[lower] !== undefined ? String(WORD_NUMBERS[lower]) : token.replace(/[^0-9.]/g, "");
}

/** Extracts figure-shaped claims (percentages, dollar amounts, counts bound to a unit noun) from text. */
export function extractFigureClaims(text: string): FigureFinding[] {
  const findings: FigureFinding[] = [];
  for (const pattern of buildFigurePatterns()) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const match = m[0];
      const numGroup = m[1] ?? match;
      findings.push({ match, numericValue: wordToDigits(numGroup) });
    }
  }
  return findings;
}

/**
 * Builds the corpus of text a draft is allowed to draw figures from: the
 * organization's own profile/knowledge-base/proven-narrative content, plus
 * the funder's own stated opportunity data (a legitimate, non-fabricated
 * source for a draft to cite, e.g. the grant's own amount range).
 */
export function buildFactCorpus(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p): p is string | number => p !== null && p !== undefined && p !== "")
    .map((p) => String(p))
    .join(" \n ");
}

/**
 * Scrubs figure claims from `draftText` that do not appear anywhere in
 * `sourceCorpus`. Each unverified match is replaced with an explicit
 * [NEEDS INPUT: ...] marker naming the removed figure -- never silently
 * dropped (a customer should be able to see what was removed and why) and
 * never silently kept (the whole point of this guard).
 */
export function scrubUnverifiedFigures(
  draftText: string,
  sourceCorpus: string,
): { text: string; removed: string[] } {
  const findings = extractFigureClaims(draftText);
  const removed: string[] = [];
  let text = draftText;

  for (const finding of findings) {
    if (removed.includes(finding.match)) continue;
    const bareNumber = finding.numericValue.replace(/,/g, "");
    const inCorpus =
      sourceCorpus.includes(finding.match) ||
      (bareNumber.length > 0 && sourceCorpus.includes(bareNumber));

    if (!inCorpus) {
      // Deliberately does not echo `finding.match` back into the draft --
      // even inside a bracketed marker, that would mean the fabricated
      // figure still "appears" in what the customer reads. The removed
      // value is preserved in the returned `removed` list for audit/logging
      // instead, never in the customer-facing text.
      const placeholder = "[NEEDS INPUT: unverified figure removed — did not match any stored organizational or funder data]";
      text = text.split(finding.match).join(placeholder);
      removed.push(finding.match);
    }
  }

  return { text, removed };
}
