import fs from "node:fs";
import type { Signature } from "../signatures/signature";
import type { Predict } from "../programs/predict";

/**
 * Serialization base for programs, ported from `@modaic/dsts`'s `Module` and
 * trimmed to the state/serialization surface — Arbiters never execute an LLM
 * locally (they call the Modaic API), so the tracing/`forward`/`run` machinery
 * is intentionally omitted.
 *
 * Mirrors dspy's `Module`: `dump_state()` aggregates named child predictors,
 * `save()` writes the state as indented JSON. A single leaf program (e.g. an
 * Arbiter's `Predict`) overrides `dump_state()`/`load_state()` to emit the flat
 * dspy-`Predict` shape directly.
 */
export abstract class Module<S extends Signature = Signature> {
  public traces: any[] = [];
  public demos: any[] = [];

  /**
   * Returns a list of all predictors in the module (recursive).
   */
  named_predictors(): { name: string; predictor: Predict<any> }[] {
    const result: { name: string; predictor: Predict<any> }[] = [];

    for (const { name, sub_module } of this.named_sub_modules()) {
      if (isPredictObject(sub_module)) {
        result.push({
          name: name,
          predictor: sub_module as unknown as Predict<any>,
        });
      }
    }

    return result;
  }

  /**
   * Returns a list of all submodules in the module (recursive).
   */
  named_sub_modules(): { name: string; sub_module: Module<any> }[] {
    return this._named_sub_modules();
  }

  _named_sub_modules(
    prefix?: string,
  ): { name: string; sub_module: Module<any> }[] {
    const currentPrefix = prefix ? `${prefix}.` : "";
    const result: { name: string; sub_module: Module<any> }[] = [];

    for (const [key, value] of Object.entries(this)) {
      if (key === "traces" || key === "demos") continue;

      const name = `${currentPrefix}${key}`;

      if (value instanceof Module) {
        result.push({
          name,
          sub_module: value as Module<any>,
        });
        if (!isPredictObject(value)) {
          result.push(...value._named_sub_modules(name));
        }
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const itemName = `${name}[${i}]`;
          if (item instanceof Module) {
            result.push({
              name: itemName,
              sub_module: item as Module<any>,
            });
            if (!isPredictObject(item)) {
              result.push(...item._named_sub_modules(itemName));
            }
          }
        }
      } else if (
        typeof value === "object" &&
        value !== null &&
        value.constructor === Object
      ) {
        for (const [subKey, subValue] of Object.entries(value)) {
          const subName = `${name}.${subKey}`;
          if (subValue instanceof Module) {
            result.push({
              name: subName,
              sub_module: subValue as Module<any>,
            });
            if (!isPredictObject(subValue)) {
              result.push(...subValue._named_sub_modules(subName));
            }
          }
        }
      }
    }

    return result;
  }

  dump_state(): Record<string, any> {
    const state: Record<string, any> = {};
    for (const { name, predictor } of this.named_predictors()) {
      state[name] = predictor.dump_state();
    }
    return state;
  }

  load_state(state: Record<string, any>): void {
    for (const { name, predictor } of this.named_predictors()) {
      predictor.load_state(state[name]);
    }
  }

  /**
   * Write the dumped state to `path` as 2-space-indented JSON. Uses `node:fs`
   * for portability (the ds.ts original used `Bun.write`).
   */
  save(path: string): void {
    fs.writeFileSync(path, JSON.stringify(this.dump_state(), null, 2));
  }

  load(path: string): void {
    const state = JSON.parse(fs.readFileSync(path, "utf-8"));
    this.load_state(state);
  }
}

function isPredictObject(value: unknown): value is { isPredict: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "isPredict" in value &&
    (value as any).isPredict === true
  );
}
