// Shared helper for FORGE SQL gates.
//
// 2026-09-17: gates matched raw file text, so a COMMENT mentioning a forbidden
// string tripped them. Migration 191 contains the comment "makes no
// net.http_post call" and failed ar-6-no-network-in-triggers.mjs, halting a
// pipeline whose work was correct. A gate that fails on correct work is the
// same defect class as a gate that passes on broken work.
//
// stripSql() removes -- line comments, /* */ block comments and the contents of
// string literals, so every gate matches executable SQL only.
export function stripSql(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {                       // line comment
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
    } else if (two === "/*") {                // block comment (non-nesting)
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (sql[i] === "'") {              // single-quoted literal, '' escape
      // Literals are KEPT: enum values, scope names and table names live in
      // them and gates must still match on those. Only comments are removed.
      out += sql[i]; i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += "''"; i += 2; continue; }
        if (sql[i] === "'") { out += "'"; i++; break; }
        out += sql[i]; i++;
      }
    } else if (sql[i] === "$") {              // dollar-quoted body ($$ or $tag$)
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        // Keep the body: trigger/function logic lives here and must be scanned.
        // Recurse so comments inside the body are stripped too.
        const body = end === -1 ? sql.slice(i + tag.length) : sql.slice(i + tag.length, end);
        out += " " + stripSql(body) + " ";
        i = end === -1 ? n : end + tag.length;
      } else { out += sql[i]; i++; }
    } else { out += sql[i]; i++; }
  }
  return out;
}
