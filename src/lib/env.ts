/**
 * Registry of optional-but-warned environment variables. Integrations that
 * degrade gracefully without a key (rather than failing outright) register
 * here instead of warning ad hoc at call sites. `warnIfMissingOptionalEnv`
 * is lazy by design — callers invoke it from the code path that actually
 * needs the var, never at module load, so importing an adapter never
 * produces console noise on its own.
 */

interface OptionalEnvVar {
  key: string;
  usedBy: string;
}

const OPTIONAL_ENV_VARS: OptionalEnvVar[] = [
  {
    key: "GOOGLE_PLACES_API_KEY",
    usedBy: "Donor Discovery — Google Places registry adapter",
  },
];

const warnedKeys = new Set<string>();

/**
 * Warns once per process if `key` is a registered optional var and unset.
 * No-op for unregistered keys or keys that are set. Safe to call repeatedly.
 */
export function warnIfMissingOptionalEnv(key: string): void {
  if (warnedKeys.has(key)) return;

  const entry = OPTIONAL_ENV_VARS.find((v) => v.key === key);
  if (!entry) return;
  if (process.env[key]) return;

  warnedKeys.add(key);
  console.warn(
    `[env] Optional env var ${key} is not set — ${entry.usedBy} will be unavailable.`,
  );
}
