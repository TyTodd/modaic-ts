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
    const config = serializeSignatureToConfig(
      opts.signature,
      repoNameToTitle(opts.repo),
    );
    const program = buildProgramJson(opts.signature);

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
      files.config = serializeSignatureToConfig(
        opts.signature,
        repoNameToTitle(this.repo),
      );
      files.program = buildProgramJson(opts.signature);
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
