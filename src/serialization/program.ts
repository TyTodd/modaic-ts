import type { Signature } from "../signatures/signature";
import { Predict, type LMState } from "../programs/predict";

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
  lm: LMState | null;
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
 * Build the `program.json` object for a Signature and inference model.
 *
 * Mirrors dspy's `Module.save`: take the (flat) `Predict.dump_state()` and append
 * `metadata`. `model` is a LiteLLM model string and is written into the `lm` block
 * (without secrets — the Python SDK's `_clean_secrets` masks secret *values* inside
 * `lm` but keeps the model, so a null `lm` would leave the judge unrunnable on the
 * server). Resulting key order: traces, train, demos, signature, lm, metadata.
 */
export function buildProgramJson(
  signature: Signature,
  model: string,
): ProgramJson {
  const program = new Predict(signature, { model });
  return {
    ...program.dump_state(),
    metadata: { dependency_versions: dependencyVersions() },
  };
}
