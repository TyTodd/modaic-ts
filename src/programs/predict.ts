import { Module } from "../primitives/module";
import { Signature } from "../signatures/signature";

/**
 * The serialized `lm` block inside `program.json`. Mirrors what dspy's
 * `LM.dump_state()` writes (see `dspy/clients/lm.py`): the inference model plus
 * its default knobs. The Modaic server reconstructs an LM via `LM(**lm)`, so
 * `model` is the only field it strictly needs; the rest pin dspy's defaults so
 * the stored state round-trips exactly. No secrets are ever included — an
 * `api_key`, if any, is filled in server-side at load time.
 */
export interface LMState {
  /** A LiteLLM model string, e.g. "gpt-oss-120b" or "openai/gpt-4o". */
  model: string;
  model_type: string;
  cache: boolean;
  num_retries: number;
  finetuning_model: string | null;
  launch_kwargs: Record<string, unknown>;
  train_kwargs: Record<string, unknown>;
  // dspy stores temperature/max_tokens in the LM kwargs, so dump_state emits
  // them; null mirrors an LM constructed with only a model string.
  temperature: number | null;
  max_tokens: number | null;
}

/**
 * Build the `lm` state for a model string, matching `dspy.LM(model).dump_state()`
 * with dspy's constructor defaults (model_type="chat", cache=true, num_retries=3,
 * finetuning_model=None, launch_kwargs={}, train_kwargs={}, temperature=None,
 * max_tokens=None). Key order matches the Python artifact.
 */
export function lmStateFromModel(model: string): LMState {
  return {
    model,
    model_type: "chat",
    cache: true,
    num_retries: 3,
    finetuning_model: null,
    launch_kwargs: {},
    train_kwargs: {},
    temperature: null,
    max_tokens: null,
  };
}

/**
 * A state-only program for a single judge, mirroring `dspy.Predict` /
 * `modaic.Predict` for the purposes of serialization only.
 *
 * Unlike `@modaic/dsts`'s `Predict`, this never runs an LLM — the Arbiter calls
 * the Modaic API for inference. This class exists so that `program.json` is
 * produced through the same `dump_state()` / `save()` machinery the hub uses,
 * rather than a hand-assembled object.
 *
 * `dump_state()` returns the exact flat dspy-`Predict` shape
 * (`{ traces, train, demos, signature, lm }`); wrapping it with `metadata`
 * yields the full `program.json` (see `buildProgramJson`).
 */
export class Predict<S extends Signature = Signature> extends Module<S> {
  public signature: S | Signature;
  public train: any[] = [];
  /**
   * The inference model state. Required for the judge to be runnable — the
   * server's loader calls `SafeLM.from_lm(arbiter.lm)`, which dereferences
   * `lm.model`, so a null `lm` makes prediction fail server-side.
   */
  public lm: LMState | null;
  public readonly isPredict = true as const;

  constructor(signature: S | string, opts: { model?: string } = {}) {
    super();
    this.signature =
      typeof signature === "string" ? Signature.parse(signature) : signature;
    this.lm = opts.model ? lmStateFromModel(opts.model) : null;
  }

  override dump_state(): {
    traces: any[];
    train: any[];
    demos: any[];
    signature: any;
    lm: LMState | null;
  } {
    // Key order matches dspy.Predict.dump_state: traces, train, demos, signature, lm.
    return {
      traces: this.traces,
      train: this.train,
      demos: this.demos,
      signature: this.signature.dump_state(),
      lm: this.lm,
    };
  }

  override load_state(state: Record<string, any>): void {
    this.traces = state.traces ?? [];
    this.train = state.train ?? [];
    this.demos = state.demos ?? [];
    // The stored `lm` carries no secrets (only the model + masked fields), so
    // preserve it — dropping it would make the loaded judge unrunnable.
    this.lm = state.lm ?? null;
    if (state.signature) {
      this.signature = this.signature.load_state(state.signature);
    }
  }
}
