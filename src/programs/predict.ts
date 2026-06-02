import { Module } from "../primitives/module";
import { Signature } from "../signatures/signature";

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
  public lm: null = null;
  public readonly isPredict = true as const;

  constructor(signature: S | string) {
    super();
    this.signature =
      typeof signature === "string" ? Signature.parse(signature) : signature;
  }

  override dump_state(): {
    traces: any[];
    train: any[];
    demos: any[];
    signature: any;
    lm: null;
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
    // Secrets are never stored, so we keep lm null regardless of state.lm.
    this.lm = null;
    if (state.signature) {
      this.signature = this.signature.load_state(state.signature);
    }
  }
}
