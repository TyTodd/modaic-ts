import { expect, test, describe } from "bun:test";
import { z } from "zod";
import { Signature } from "../../src/signatures/signature";
import { Image, Audio, Scale, Enum } from "../../src/signatures/types";
import { serializeSignatureToConfig } from "../../src/serialization/config";

// Goldens captured by running `serialize_signature` in core/modaic (the Python SDK),
// the same source of truth program.test.ts uses. These are the `signature` sub-object
// of config.json; the TS envelope adds `model: null`.

// .../sync/TyTodd/predict-test-repo/config.json
const EXPECTED_SUMMARIZE = {
  description: "Summarize the given text into a concise summary.",
  properties: {
    text: {
      __dspy_field_type: "input",
      desc: "The text to summarize",
      prefix: "Text:",
      title: "Text",
      type: "string",
    },
    summary: {
      __dspy_field_type: "output",
      desc: "A concise summary of the text",
      prefix: "Summary:",
      title: "Summary",
      type: "string",
    },
  },
  required: ["text", "summary"],
  title: "SummarizeSignature",
  type: "object",
};

const EXPECTED_TYPES = {
  $defs: { Image: { type: "dspy.Image" } },
  description: "Judge the answer.",
  properties: {
    question: {
      __dspy_field_type: "input",
      desc: "the question",
      prefix: "Question:",
      title: "Question",
      type: "string",
    },
    n: {
      __dspy_field_type: "input",
      default: 3,
      desc: "${n}",
      prefix: "N:",
      title: "N",
      type: "integer",
    },
    score: {
      __dspy_field_type: "input",
      desc: "${score}",
      prefix: "Score:",
      title: "Score",
      type: "number",
    },
    flag: {
      __dspy_field_type: "input",
      desc: "${flag}",
      prefix: "Flag:",
      title: "Flag",
      type: "boolean",
    },
    photo: {
      $ref: "#/$defs/Image",
      __dspy_field_type: "input",
      desc: "a picture",
      prefix: "Photo:",
    },
    rating: {
      __dspy_field_type: "output",
      desc: "1-5",
      enum: [1, 2, 3, 4, 5],
      prefix: "Rating:",
      title: "Rating",
      type: "integer",
    },
    decision: {
      __dspy_field_type: "output",
      desc: "${decision}",
      enum: ["YES", "NO", "MAYBE"],
      prefix: "Decision:",
      title: "Decision",
      type: "string",
    },
    note: {
      __dspy_field_type: "output",
      anyOf: [{ type: "string" }, { type: "null" }],
      desc: "${note}",
      prefix: "Note:",
      title: "Note",
    },
    tags: {
      __dspy_field_type: "output",
      desc: "${tags}",
      items: { type: "string" },
      prefix: "Tags:",
      title: "Tags",
      type: "array",
    },
  },
  required: [
    "question",
    "score",
    "flag",
    "photo",
    "rating",
    "decision",
    "note",
    "tags",
  ],
  title: "Types",
  type: "object",
};

describe("serializeSignatureToConfig", () => {
  test("matches the Python config.json for the Summarize signature", () => {
    const signature = new Signature({
      instructions: "Summarize the given text into a concise summary.",
      input: z.object({ text: z.string().describe("The text to summarize") }),
      output: z.object({
        summary: z.string().describe("A concise summary of the text"),
      }),
    });

    const config = serializeSignatureToConfig(signature, "SummarizeSignature");
    expect(config.model).toBeNull();
    expect(config.signature as Record<string, unknown>).toEqual(EXPECTED_SUMMARIZE);
  });

  test("matches Python for primitives, defaults, special types, optional and array", () => {
    const signature = new Signature({
      instructions: "Judge the answer.",
      input: z.object({
        question: z.string().describe("the question"),
        n: z.int().default(3),
        score: z.number(),
        flag: z.boolean(),
        photo: Image.field().describe("a picture"),
      }),
      output: z.object({
        rating: Scale(1, 5).describe("1-5"),
        decision: Enum("YES", "NO", "MAYBE"),
        note: z.string().nullable(),
        tags: z.array(z.string()),
      }),
    });

    const config = serializeSignatureToConfig(signature, "Types");
    expect(config.signature as Record<string, unknown>).toEqual(EXPECTED_TYPES);
  });

  test("emits pydantic-style alphabetical key order", () => {
    const signature = new Signature({
      instructions: "Judge the answer.",
      input: z.object({ photo: Image.field() }),
      output: z.object({ rating: Scale(1, 5) }),
    });
    const sig = serializeSignatureToConfig(signature, "T").signature as any;

    // Top-level keys sorted ($defs first since '$' < letters).
    expect(Object.keys(sig)).toEqual([
      "$defs",
      "description",
      "properties",
      "required",
      "title",
      "type",
    ]);
    // properties keeps declaration order (inputs then outputs), not sorted.
    expect(Object.keys(sig.properties)).toEqual(["photo", "rating"]);
    // A $ref field's keys are sorted: '$ref' < '__dspy_field_type' < letters.
    expect(Object.keys(sig.properties.photo)).toEqual([
      "$ref",
      "__dspy_field_type",
      "desc",
      "prefix",
    ]);
  });

  test("required excludes fields with a default or .optional()", () => {
    const signature = new Signature({
      instructions: "x",
      input: z.object({
        a: z.string(),
        b: z.string().default("hi"),
        c: z.string().optional(),
      }),
      output: z.object({ out: z.string() }),
    });
    const sig = serializeSignatureToConfig(signature, "T").signature as any;

    expect(sig.required).toEqual(["a", "out"]);
    expect(sig.properties.b.default).toBe("hi");
    // .optional() with no default => not required, and no `default` key emitted.
    expect("default" in sig.properties.c).toBe(false);
  });

  test("Audio serializes to a dspy.Audio $ref + $def", () => {
    const signature = new Signature({
      instructions: "x",
      input: z.object({ clip: Audio.field().describe("a sound") }),
      output: z.object({ ok: z.boolean() }),
    });
    const sig = serializeSignatureToConfig(signature, "T").signature as any;

    expect(sig.$defs).toEqual({ Audio: { type: "dspy.Audio" } });
    expect(sig.properties.clip).toEqual({
      $ref: "#/$defs/Audio",
      __dspy_field_type: "input",
      desc: "a sound",
      prefix: "Clip:",
    });
  });

  test("single-value Enum serializes as a const", () => {
    const signature = new Signature({
      instructions: "x",
      input: z.object({ q: z.string() }),
      output: z.object({ ok: Enum("ONLY") }),
    });
    const sig = serializeSignatureToConfig(signature, "T").signature as any;

    expect(sig.properties.ok).toEqual({
      __dspy_field_type: "output",
      const: "ONLY",
      desc: "${ok}",
      prefix: "Ok:",
      title: "Ok",
      type: "string",
    });
  });
});
