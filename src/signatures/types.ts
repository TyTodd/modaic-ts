import { z } from "zod";

/**
 * Special signature field types — the modaic-ts analogs of dspy's custom types.
 *
 * These are how a Signature declares a field that is more than a plain primitive.
 * Each one is detected by the serializer (`src/serialization/zod_schema.ts`) via a
 * `__modaic_type` marker on the field's Zod `.meta()`, and is serialized into the
 * exact JSON the Python SDK produces — so an Arbiter authored here round-trips into
 * the right Python type with **no Python-side changes**:
 *
 *   - `Image` / `Audio`  -> `$defs["Image"] = {"type":"dspy.Image"}` + a `$ref` field,
 *                           which the Python SDK reconstructs as a real `dspy.Image` /
 *                           `dspy.Audio` (its adapters already render them multimodally).
 *   - `Scale(lo, hi)`    -> a plain integer enum `{"enum":[lo..hi], "type":"integer"}`,
 *                           matching Python `modaic.Scale[lo, hi]`.
 *   - `Enum(...values)`  -> a plain string enum `{"enum":[...], "type":"string"}`,
 *                           matching Python `modaic.Enum[...]`.
 */

/** Marker value the serializer reads from a field's `.meta().__modaic_type`. */
export type ModaicTypeTag = "image" | "audio" | "scale";

/**
 * `modaic.Image` — a multimodal image field, the TS analog of `dspy.Image`.
 *
 * Use {@link Image.field} inside a `Signature`'s input/output schema, and construct
 * `new Image({ url })` to carry a value when calling `predict`.
 */
export class Image {
  url: string;

  constructor(init: { url: string }) {
    this.url = init.url;
  }

  /**
   * The Zod schema to place in a `Signature`. Serializes to a `dspy.Image` `$ref`.
   * Chain `.describe(...)` to set the field description.
   */
  static field(): z.ZodType {
    return z.custom<Image>().meta({ __modaic_type: "image" });
  }
}

/**
 * `modaic.Audio` — a multimodal audio field, the TS analog of `dspy.Audio`.
 *
 * Use {@link Audio.field} inside a `Signature`'s input/output schema, and construct
 * `new Audio({ url })` to carry a value when calling `predict`.
 */
export class Audio {
  url: string;

  constructor(init: { url: string }) {
    this.url = init.url;
  }

  /**
   * The Zod schema to place in a `Signature`. Serializes to a `dspy.Audio` `$ref`.
   * Chain `.describe(...)` to set the field description.
   */
  static field(): z.ZodType {
    return z.custom<Audio>().meta({ __modaic_type: "audio" });
  }
}

/**
 * `modaic.Scale(lo, hi)` — an integer rating in `[lo, hi]` inclusive.
 *
 * Serializes to a plain integer enum `{"enum":[lo, lo+1, …, hi], "type":"integer"}`,
 * matching Python `modaic.Scale[lo, hi]` (which presents to the model as a Literal of ints).
 */
export function Scale(lo: number, hi: number): z.ZodType {
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
    throw new Error("Scale values must be integers");
  }
  if (lo > hi) {
    throw new Error(`Scale lo (${lo}) must be <= hi (${hi})`);
  }
  return z
    .int()
    .gte(lo)
    .lte(hi)
    .meta({ __modaic_type: "scale", lo, hi });
}

/**
 * `modaic.Enum(...values)` — a string choice from a fixed set.
 *
 * Serializes to `{"enum":[...], "type":"string"}` (a single value serializes as
 * `{"const": v, "type":"string"}`), matching Python `modaic.Enum[...]`.
 */
export function Enum<T extends string>(...values: [T, ...T[]]): z.ZodType {
  return z.enum(values);
}
