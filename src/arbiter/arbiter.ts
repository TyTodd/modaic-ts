import { z } from "zod";
import { Signature } from "../signatures/signature";
import { serializeSignatureToConfig } from "../serialization/config";
import { buildProgramJson } from "../serialization/program";
import { repoNameToTitle } from "../serialization/naming";
import { resolveToken } from "../config";
import {
  createRepo,
  predict as apiPredict,
  type ArbiterPrediction,
} from "../api/client";
import { syncAndPush, type Commit, type PushFiles } from "../git/push";

/**
 * The fixed description given to an Arbiter's injected `reasoning` output field.
 * Matches the Python SDK (`make_arbiter`) verbatim — original wording included —
 * so judges authored here stay byte-compatible with Python ones.
 */
const REASONING_DESC =
  "Your reasoning for your answer. Inlude any uncertainties about your answer or ambiguity in the task.";

/**
 * Return a Signature guaranteed to have a `reasoning` output field — the TS analog
 * of Python `make_arbiter`. Arbiters must expose a plain `reasoning: string` output
 * because the server reads `prediction.reasoning` on every prediction; without it,
 * predictions fail server-side.
 *
 * Mirrors `make_arbiter`'s `signature.insert(-2, "reasoning", …)`: reasoning is
 * inserted within the output section just before the last output field (so a
 * single-output judge gets reasoning first). Idempotent — if a `reasoning` output
 * already exists, the signature is returned unchanged.
 */
export function ensure_reasoning_field(
  signature: Signature,
): Signature<z.ZodObject<any>, z.ZodObject<any>> {
  const outShape = signature.output.shape as Record<string, z.ZodType>;
  if ("reasoning" in outShape) {
    return new Signature({
      instructions: signature.instructions,
      input: signature.input,
      output: signature.output,
    });
  }

  // A plain string field. Set the description on both `.describe()` and `.meta()`
  // so it surfaces in program.json (dump_state) and config.json (serializeField).
  let reasoningField: z.ZodType = z.string().describe(REASONING_DESC);
  if (typeof (reasoningField as any).meta === "function") {
    reasoningField = (reasoningField as any).meta({
      description: REASONING_DESC,
      desc: REASONING_DESC,
    });
  }

  const entries = Object.entries(outShape);
  const insertIdx = Math.max(0, entries.length - 1);
  const newShape: Record<string, z.ZodType> = {};
  entries.forEach(([k, field], i) => {
    if (i === insertIdx) newShape["reasoning"] = reasoningField;
    newShape[k] = field;
  });
  if (entries.length === 0) newShape["reasoning"] = reasoningField;

  return new Signature({
    instructions: signature.instructions,
    input: signature.input,
    output: z.object(newShape),
  });
}

/** Options for constructing an Arbiter handle to an existing repo. */
export interface ArbiterOptions {
  /** Git branch used for create/update operations. Default "main". */
  branch?: string;
  /** Revision (branch/tag/commit) used when running predictions. Default = branch. */
  rev?: string;
}

/** Options for `Arbiter.create`. */
export interface CreateOptions {
  repo: string;
  signature: Signature;
  /**
   * The LiteLLM model string the server runs this judge with, e.g.
   * "gpt-oss-120b" or "openai/gpt-4o". Required — an arbiter with no model is
   * not runnable: `predict()` would fail server-side.
   */
  model: string;
  branch?: string;
  tag?: string;
  access_token?: string;
  commit_message?: string;
  private?: boolean;
  metadata?: Record<string, unknown> | null;
  extra_files?: string[] | null;
}

/** Options for `arbiter.update`. */
export interface UpdateOptions {
  /** Optional new signature; when provided, config.json and program.json are rewritten. */
  signature?: Signature;
  /**
   * LiteLLM model string. Required when `signature` is provided, since rewriting
   * `program.json` needs the model written into its `lm` block.
   */
  model?: string;
  metadata?: Record<string, unknown> | null;
  extra_files?: string[] | null;
  commit_message?: string;
  tag?: string;
  access_token?: string;
}

/** Options for `arbiter.predict`. */
export interface PredictOptions {
  ground_truth?: Record<string, unknown> | null;
  ground_reasoning?: string;
  compute_confidence?: boolean;
}

/**
 * A handle to a Modaic Arbiter (an LLM judge) stored on Modaic Hub.
 *
 * Like `modaic_client.Arbiter`, this is a thin wrapper over the Modaic REST API
 * and git — it never runs an LLM locally. `predict()` calls the API; `create()`
 * and `update()` write the judge's `config.json` / `program.json` and push them
 * to the hub via git, mirroring `modaic.Predict.push_to_hub`.
 */
export class Arbiter {
  repo: string;
  branch: string;
  rev: string;

  constructor(repo: string, opts: ArbiterOptions = {}) {
    this.repo = repo;
    this.branch = opts.branch ?? "main";
    this.rev = opts.rev ?? this.branch;
  }

  /**
   * Create a new Arbiter repo on the hub and push its signature.
   *
   * Builds `config.json` (signature schema) and `program.json` (stored prompt)
   * the same way the Python SDK does, creates the remote repo (private by
   * default), then commits & pushes on `branch`.
   */
  static async create(opts: CreateOptions): Promise<Arbiter> {
    const branch = opts.branch ?? "main";
    const token = resolveToken(opts.access_token);

    // Build files first so a bad signature fails before we create a repo.
    // Inject the `reasoning` output field so the judge is a valid Arbiter.
    const signature = ensure_reasoning_field(opts.signature);
    const config = serializeSignatureToConfig(
      signature,
      repoNameToTitle(opts.repo),
    );
    const program = buildProgramJson(signature, opts.model);

    await createRepo(opts.repo, {
      private: opts.private ?? true,
      existOk: true,
      token,
    });

    await syncAndPush({
      repo: opts.repo,
      branch,
      token,
      files: { config, program },
      metadata: opts.metadata ?? null,
      extraFiles: opts.extra_files ?? null,
      commitMessage: opts.commit_message ?? "(no commit message)",
      tag: opts.tag,
    });

    return new Arbiter(opts.repo, { branch, rev: opts.tag ?? branch });
  }

  /**
   * Pull the latest commit of this Arbiter's branch, write whatever is provided
   * (a new signature rewrites config.json + program.json; metadata updates the
   * README; extra_files are copied in), then commit & push.
   */
  async update(opts: UpdateOptions = {}): Promise<Commit> {
    const token = resolveToken(opts.access_token);

    const files: PushFiles = {};
    if (opts.signature) {
      if (!opts.model) {
        throw new Error(
          "update() requires `model` when `signature` is provided, so the " +
            "rewritten program.json records the inference model.",
        );
      }
      const signature = ensure_reasoning_field(opts.signature);
      files.config = serializeSignatureToConfig(
        signature,
        repoNameToTitle(this.repo),
      );
      files.program = buildProgramJson(signature, opts.model);
    }

    return syncAndPush({
      repo: this.repo,
      branch: this.branch,
      token,
      files,
      metadata: opts.metadata ?? null,
      extraFiles: opts.extra_files ?? null,
      commitMessage: opts.commit_message ?? "(no commit message)",
      tag: opts.tag,
    });
  }

  /**
   * Run this Arbiter against a single input via the Modaic API. The server runs
   * the LLM; this is a pure HTTP call.
   */
  async predict(
    input: Record<string, unknown>,
    opts: PredictOptions = {},
  ): Promise<ArbiterPrediction> {
    const token = resolveToken();
    return apiPredict({
      token,
      input,
      arbiterRepo: this.repo,
      arbiterRevision: this.rev,
      groundTruth: opts.ground_truth ?? null,
      groundReasoning: opts.ground_reasoning ?? "",
      computeConfidence: opts.compute_confidence ?? false,
    });
  }

  /**
   * Alias for {@link predict}. (Python's `__call__` is not idiomatic in TS.)
   */
  call(
    input: Record<string, unknown>,
    opts: PredictOptions = {},
  ): Promise<ArbiterPrediction> {
    return this.predict(input, opts);
  }
}
