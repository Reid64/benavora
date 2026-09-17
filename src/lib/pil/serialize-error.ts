// Centralized error -> string conversion for everything written into
// pil_agent_runs.error (and related PIL audit/observability text fields).
//
// Root cause of the bug this replaces: `err instanceof Error ? err.message :
// String(err)` was used throughout src/lib/pil/**. Supabase-js throws plain
// PostgrestError objects (not Error instances) from `if (error) throw
// error;` call sites -- so `err instanceof Error` is false for the most
// common failure mode in this codebase, and `String(plainObject)` evaluates
// to the literal string "[object Object]". That is exactly what live
// production data showed in pil_agent_runs.error for BEN-QLF-04 (3/3 failed
// runs) and BEN-QLF-03 (1/1 failed run).

interface PostgrestErrorShape {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

const MAX_PLAIN_OBJECT_LENGTH = 2000;

function isPostgrestErrorShape(value: object): value is PostgrestErrorShape {
  return (
    "code" in value &&
    "message" in value &&
    "details" in value &&
    "hint" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

function hasStringMessage(value: object): value is { message: string } {
  return "message" in value && typeof (value as { message: unknown }).message === "string";
}

function safeJsonStringify(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return "(error value could not be serialized)";
  }
}

export function serializePilError(err: unknown): string {
  let result: string;

  if (err === null || err === undefined) {
    return "(no error value provided)";
  }

  if (typeof err === "string") {
    result = err;
  } else if (err instanceof Error) {
    const frames = (err.stack ?? "")
      .split("\n")
      .slice(1, 6)
      .join("\n");
    result = frames ? `${err.name}: ${err.message}\n${frames}` : `${err.name}: ${err.message}`;
  } else if (typeof err === "object") {
    if (isPostgrestErrorShape(err)) {
      result = `${err.code}: ${err.message} | details: ${err.details} | hint: ${err.hint}`;
    } else if (hasStringMessage(err)) {
      result = err.message;
    } else {
      result = safeJsonStringify(err).slice(0, MAX_PLAIN_OBJECT_LENGTH);
    }
  } else {
    result = String(err);
  }

  if (result === "[object Object]") {
    result = safeJsonStringify(err).slice(0, MAX_PLAIN_OBJECT_LENGTH);
  }

  return result;
}
