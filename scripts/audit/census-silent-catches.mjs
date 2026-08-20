#!/usr/bin/env node
/**
 * PT-13: Census every try/catch and .catch() in the codebase, classify each
 * as logged/rethrown (safe), documented-intentional-swallow, or a silent
 * hole (swallows an error with no logging, no rethrow, no documentation).
 *
 * Output: test-evidence/pt-13/silent-catches.json
 *
 * This is a heuristic static scan (brace/paren matching with a small state
 * machine for strings/templates/comments), not a full TS AST parse. It is
 * deliberately conservative about what counts as "logged" so it over-flags
 * rather than under-flags borderline cases -- those get reviewed manually
 * in the summary, not silently dropped.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "worker", "scripts", "e2e", "tests", "audit"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const EXCLUDE_SEGMENTS = ["node_modules", ".next", "dist", "coverage", ".git"];

function listFiles() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    try {
      const files = execSync(
        `git ls-files -- ${dir}`,
        { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }
      )
        .split("\n")
        .filter(Boolean);
      for (const f of files) {
        if (EXCLUDE_SEGMENTS.some((seg) => f.split("/").includes(seg))) continue;
        const dot = f.lastIndexOf(".");
        if (dot === -1) continue;
        const ext = f.slice(dot);
        if (!EXTENSIONS.has(ext)) continue;
        out.push(f);
      }
    } catch {
      // dir may not be tracked / may not exist; skip
    }
  }
  return Array.from(new Set(out));
}

// --- tokenizer-lite brace/paren matcher, string/template/comment aware ---

function findMatchingDelim(content, openIdx, openCh, closeCh) {
  let depth = 0;
  let i = openIdx;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === "/" && content[i + 1] === "/") {
      const j = content.indexOf("\n", i);
      i = j === -1 ? n : j + 1;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const j = content.indexOf("*/", i + 2);
      i = j === -1 ? n : j + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < n && content[i] !== quote) {
        if (content[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "`") {
      i++;
      let tDepth = 0;
      while (i < n) {
        if (content[i] === "\\") {
          i += 2;
          continue;
        }
        if (content[i] === "`" && tDepth === 0) {
          i++;
          break;
        }
        if (content[i] === "$" && content[i + 1] === "{") {
          tDepth++;
          i += 2;
          continue;
        }
        if (content[i] === "}" && tDepth > 0) {
          tDepth--;
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === openCh) {
      depth++;
      i++;
      continue;
    }
    if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

const findMatchingBrace = (content, openIdx) =>
  findMatchingDelim(content, openIdx, "{", "}");
const findMatchingParen = (content, openIdx) =>
  findMatchingDelim(content, openIdx, "(", ")");

// Approximate reverse brace matcher for locating the `try { ... }` block
// immediately preceding a `catch`. Does not track strings/comments (minor
// inaccuracy accepted -- this only feeds a severity heuristic, not the
// core swallowed/documented classification).
function findMatchingBraceReverse(content, closeIdx) {
  let depth = 0;
  let i = closeIdx;
  while (i >= 0) {
    const ch = content[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) return i;
    }
    i--;
  }
  return -1;
}

const MUTATION_PATTERNS = [
  /\.(insert|update|upsert|delete|truncate)\s*\(/,
  /\.(write|writeFile|writeFileSync|unlink|unlinkSync|rm|rmSync|rename|renameSync)\s*\(/,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bTRUNCATE\b/i,
];

function enclosingTryHasMutation(content, catchKwIdx) {
  // walk backward from the catch keyword to the nearest non-whitespace char
  let i = catchKwIdx - 1;
  while (i >= 0 && /\s/.test(content[i])) i--;
  if (i < 0 || content[i] !== "}") return false;
  const tryCloseIdx = i;
  const tryOpenIdx = findMatchingBraceReverse(content, tryCloseIdx);
  if (tryOpenIdx === -1) return false;
  // confirm this brace is actually preceded by `try`
  let j = tryOpenIdx - 1;
  while (j >= 0 && /\s/.test(content[j])) j--;
  const precedingWord = content.slice(Math.max(0, j - 2), j + 1);
  if (!/try$/.test(precedingWord)) return false;
  const tryBody = content.slice(tryOpenIdx + 1, tryCloseIdx);
  return MUTATION_PATTERNS.some((re) => re.test(tryBody));
}

const REAL_DATA_PATH_RE =
  /^(src\/lib\/agents\/|src\/lib\/autoapply\/|src\/lib\/scraper\/|src\/lib\/scraper-v2\/|src\/lib\/intelligence\/|src\/lib\/enrichment\/|src\/lib\/sources\/|src\/lib\/outreach\/|src\/lib\/marketplace\/|src\/lib\/reports\/|src\/lib\/drafts\/|src\/lib\/email\/|src\/lib\/security\/|src\/app\/api\/|worker\/|scripts\/(?!audit\/))/;

function lineOf(content, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// --- classification ---

const LOG_PATTERNS = [
  /console\s*\.\s*(error|warn|log|info|debug|trace)/,
  /logger\s*\./i,
  /\blog\s*\.\s*(error|warn|info|debug)/,
  /\.error\s*\(/,
  /\.warn\s*\(/,
  /sentry/i,
  /captureException/i,
  /captureMessage/i,
  /notify\s*\(/,
  /createNotification/,
  /alert\s*\(/,
  /toast\s*\(/,
  /showError/i,
  /setError\s*\(/,
  /system_errors/,
  /agent_decisions/,
  /agent_runs/,
  /\.push\s*\(\s*(err|error|e)\b/i,
  /errors\s*\.\s*push/i,
  /reportError/i,
  /throw\b/,
  // "surfaced to caller" patterns -- not console-logged, but the error
  // reaches something downstream that can act on it, so not a silent hole
  /success\s*:\s*false/,
  /\berror\s*:/i,
  /status\s*:\s*[45]\d\d/,
  /NextResponse\.json/,
  /res(ponse)?\.status\s*\(\s*[45]\d\d/,
  /\.status\s*=\s*[45]\d\d/,
  /required_human_review/,
  /output_summary/,
  /error_message/,
  /failRun\s*\(/,
  /markFailed/i,
  /onError\s*\(/,
];

const DOC_PATTERNS = [
  /best[\s-]?effort/i,
  /intentional/i,
  /\bignored?\b/i,
  /\bswallow/i,
  /non-?fatal/i,
  /ok(?:ay)? to fail/i,
  /fire[\s-]?and[\s-]?forget/i,
  /silently/i,
  /don'?t fail/i,
  /should not block/i,
  /never fail/i,
  /never\s+block/i,
  /must never/i,
  /safe to ignore/i,
  /expected to fail/i,
  /degrade/i,
  /no-?op/i,
  /not (critical|fatal)/i,
];

function extractFirstIdentifier(paramText) {
  if (!paramText) return null;
  const m = paramText.match(/^[\s{]*([A-Za-z_$][A-Za-z0-9_$]*)/);
  return m ? m[1] : null;
}

// True if the caught error binding is passed as an argument into some
// function call within the body (push/notify/handler/etc.) -- a strong
// signal the error is being surfaced/forwarded even without a recognized
// logging call name.
function paramForwardedInCall(bodyText, paramName) {
  if (!paramName) return false;
  const escaped = paramName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const paramUsed = new RegExp(`\\b${escaped}\\b`).test(bodyText);
  if (!paramUsed) return false;
  // explicit discard idiom (`void err;`) is NOT surfacing, even though the
  // param is technically "referenced"
  if (/^\s*void\s+[A-Za-z_$][A-Za-z0-9_$]*\s*;?\s*$/.test(bodyText.trim())) {
    return false;
  }
  // does the param appear inside a function call, an assignment, or a
  // return statement -- a reasonable proxy for "the error was forwarded
  // somewhere (pushed, assigned to a result field, returned), not just
  // silently discarded"
  const hasCall = /[A-Za-z0-9_$]\s*\(/.test(bodyText);
  const hasAssignOrReturn =
    /(^|[^=!<>])=(?!=)/.test(bodyText) || /\breturn\b/.test(bodyText);
  return hasCall || hasAssignOrReturn;
}

function classifyBody(bodyText, precedingContext, paramName) {
  const hasLog =
    LOG_PATTERNS.some((re) => re.test(bodyText)) ||
    paramForwardedInCall(bodyText, paramName);
  const trimmed = bodyText.trim();
  const isEmpty =
    trimmed === "" ||
    /^(\/\/.*\n?|\/\*[\s\S]*?\*\/)*$/.test(trimmed);
  const isBareReturnNoLog =
    !hasLog &&
    /^return\b[^;{}]*;?$/.test(trimmed.replace(/^\/\/.*$/gm, "").trim());

  const docHay = `${precedingContext}\n${bodyText}`;
  const isDocumented = DOC_PATTERNS.some((re) => re.test(docHay));

  const swallowed = !hasLog;

  return { swallowed, isEmpty, isBareReturnNoLog, isDocumented, hasLog };
}

function precedingComment(content, idx) {
  // grab up to 3 lines before idx as context for "documented" detection
  const before = content.slice(Math.max(0, idx - 400), idx);
  const lines = before.split("\n").slice(-4).join("\n");
  return lines;
}

// --- main scan ---

function scanFile(relPath) {
  const abs = join(ROOT, relPath);
  let content;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  const findings = [];

  // try/catch blocks
  const catchRe = /\bcatch\s*(\(([^()]*)\))?\s*\{/g;
  let m;
  while ((m = catchRe.exec(content)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(content, braceIdx);
    if (closeIdx === -1) continue;
    const body = content.slice(braceIdx + 1, closeIdx);
    const line = lineOf(content, m.index);
    const param = m[2] ? m[2].trim() : "(none)";
    const paramIdent = extractFirstIdentifier(m[2]);
    const cls = classifyBody(body, precedingComment(content, m.index), paramIdent);
    const mutationInTry = enclosingTryHasMutation(content, m.index);
    findings.push({
      file: relPath,
      line,
      kind: "try/catch",
      param,
      bodyPreview: body.trim().slice(0, 160).replace(/\s+/g, " "),
      swallowed: cls.swallowed,
      emptyBody: cls.isEmpty,
      bareReturnNoLog: cls.isBareReturnNoLog,
      documented: cls.isDocumented,
      tryBlockHasMutation: mutationInTry,
    });
    catchRe.lastIndex = closeIdx;
  }

  // .catch( ... ) chained calls
  const dotCatchRe = /\.catch\s*\(/g;
  while ((m = dotCatchRe.exec(content)) !== null) {
    const parenOpenIdx = m.index + m[0].length - 1;
    const parenCloseIdx = findMatchingParen(content, parenOpenIdx);
    if (parenCloseIdx === -1) continue;
    const argText = content.slice(parenOpenIdx + 1, parenCloseIdx);
    const line = lineOf(content, m.index);

    // does the argument have a block body `{ ... }`?
    const blockMatch = argText.match(/=>\s*\{|function\s*\([^)]*\)\s*\{/);
    let bodyText = argText;
    if (blockMatch) {
      const braceIdxLocal = argText.indexOf(
        "{",
        blockMatch.index + blockMatch[0].length - 1
      );
      if (braceIdxLocal !== -1) {
        const closeLocal = findMatchingBrace(argText, braceIdxLocal);
        if (closeLocal !== -1) {
          bodyText = argText.slice(braceIdxLocal + 1, closeLocal);
        }
      }
    }

    const isBareIdentifier = /^[A-Za-z0-9_$.]+$/.test(argText.trim());
    const funcKwMatch = argText.match(
      /^\s*(?:async\s+)?function\s*\w*\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)?/
    );
    const arrowParamMatch = argText.match(
      /^\s*(?:async\s+)?\(?\s*([A-Za-z_$][A-Za-z0-9_$]*)/
    );
    const catchParamIdent = funcKwMatch
      ? funcKwMatch[1] || null
      : arrowParamMatch
        ? arrowParamMatch[1]
        : null;
    const cls = classifyBody(
      bodyText,
      precedingComment(content, m.index),
      catchParamIdent
    );
    // proxy for "does the promise chain this .catch() guards perform a
    // mutation" -- look at the statement leading up to the .catch() call
    const chainContext = content.slice(Math.max(0, m.index - 300), m.index);
    const mutationInChain = MUTATION_PATTERNS.some((re) => re.test(chainContext));

    findings.push({
      file: relPath,
      line,
      kind: ".catch()",
      param: isBareIdentifier ? `handler:${argText.trim()}` : "(inline)",
      bodyPreview: argText.trim().slice(0, 160).replace(/\s+/g, " "),
      swallowed: isBareIdentifier
        ? !LOG_PATTERNS.some((re) => re.test(argText))
        : cls.swallowed,
      emptyBody: !isBareIdentifier && cls.isEmpty,
      bareReturnNoLog: !isBareIdentifier && cls.isBareReturnNoLog,
      documented: cls.isDocumented,
      externalHandler: isBareIdentifier,
      tryBlockHasMutation: mutationInChain,
    });
  }

  return findings;
}

function main() {
  const files = listFiles();
  const allFindings = [];
  for (const f of files) {
    allFindings.push(...scanFile(f));
  }

  const testFileRe = /(^|\/)(__tests__|e2e|tests)(\/|$)/;
  for (const finding of allFindings) {
    finding.testFile = testFileRe.test(finding.file);
    finding.onRealDataOrAgentPath = REAL_DATA_PATH_RE.test(finding.file);
    const isSilentUndocumented =
      finding.swallowed && !finding.documented && !finding.testFile;
    if (!isSilentUndocumented) {
      finding.severity = null;
    } else if (!finding.onRealDataOrAgentPath) {
      finding.severity = "P3"; // silent swallow, but not on a data/agent path
    } else if (finding.tryBlockHasMutation) {
      finding.severity = "P1"; // hides a potential data-loss path
    } else {
      finding.severity = "P2";
    }
  }

  const silentHoles = allFindings.filter(
    (f) => f.swallowed && !f.documented && !f.testFile
  );
  const documentedSwallows = allFindings.filter(
    (f) => f.swallowed && f.documented && !f.testFile
  );
  const findingsList = allFindings.filter(
    (f) => f.severity === "P1" || f.severity === "P2"
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    totalFilesScanned: files.length,
    totalCatchSites: allFindings.length,
    tryCatchSites: allFindings.filter((f) => f.kind === "try/catch").length,
    dotCatchSites: allFindings.filter((f) => f.kind === ".catch()").length,
    swallowedTotal: allFindings.filter((f) => f.swallowed).length,
    silentHolesNonTest: silentHoles.length,
    documentedSwallowsNonTest: documentedSwallows.length,
    testFileCatchSites: allFindings.filter((f) => f.testFile).length,
    onRealDataOrAgentPathSwallows: silentHoles.filter(
      (f) => f.onRealDataOrAgentPath
    ).length,
    p1Count: allFindings.filter((f) => f.severity === "P1").length,
    p2Count: allFindings.filter((f) => f.severity === "P2").length,
    p3Count: allFindings.filter((f) => f.severity === "P3").length,
  };

  const output = {
    summary,
    findings: allFindings,
  };

  mkdirSync(join(ROOT, "test-evidence", "pt-13"), { recursive: true });
  writeFileSync(
    join(ROOT, "test-evidence", "pt-13", "silent-catches.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(`Scanned ${summary.totalFilesScanned} files.`);
  console.log(`Total catch sites: ${summary.totalCatchSites}`);
  console.log(`  try/catch: ${summary.tryCatchSites}`);
  console.log(`  .catch():  ${summary.dotCatchSites}`);
  console.log(`Swallowed (no log/rethrow): ${summary.swallowedTotal}`);
  console.log(`  Silent holes (non-test, undocumented): ${summary.silentHolesNonTest}`);
  console.log(`    ...on real data/agent paths: ${summary.onRealDataOrAgentPathSwallows}`);
  console.log(`  Documented intentional swallows (non-test): ${summary.documentedSwallowsNonTest}`);
  console.log(`  In test files: ${summary.testFileCatchSites}`);
  console.log(`Findings: P1=${summary.p1Count} P2=${summary.p2Count} P3(off-path)=${summary.p3Count}`);
}

main();
