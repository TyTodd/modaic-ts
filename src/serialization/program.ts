import type { Signature } from "../signatures/signature";
import { Predict } from "../programs/predict";

/**
 * The shape of `program.json` — the stored program state.
 *
 * Mirrors what the Python SDK writes via `dspy.Module.save` (`precompiled.py`):
 *
 * ```json
 * {
 *   "traces": [], "train": [], "demos": [],
 *   "signature": { "instructions": "...", "fields": [ { "prefix": "Text:", "description": "..." } ] },
 *   "lm": null,
 *   "metadata": { "dependency_versions": { ... } }
 * }
 * ```
 *
 * The `signature` field is exactly what `Signature.dump_state()` returns.
 */
export interface ProgramJson {
  traces: unknown[];
  train: unknown[];
  demos: unknown[];
  signature: { instructions?: string; fields: { prefix: string; description: string }[] };
  lm: null;
  metadata: { dependency_versions: Record<string, string> };
}

/**
 * Record the runtime versions used to produce this program. The Python side
 * records python/dspy/cloudpickle; on the TS side we record the node version.
 * This is informational metadata only.
 */
function dependencyVersions(): Record<string, string> {
  const versions: Record<string, string> = {};
  if (typeof process !== "undefined" && process.versions?.node) {
    versions.node = process.versions.node;
  }
  return versions;
}

/**
 * Build the `program.json` object for a Signature.
 *
 * Mirrors dspy's `Module.save`: take the (flat) `Predict.dump_state()` and append
 * `metadata`. Secrets are never written (`lm` is always null), matching the Python
 * SDK after `_clean_secrets`. Resulting key order: traces, train, demos, signature,
 * lm, metadata.
 */
export function buildProgramJson(signature: Signature): ProgramJson {
  const program = new Predict(signature);
  return {
    ...program.dump_state(),
    metadata: { dependency_versions: dependencyVersions() },
  };
}
