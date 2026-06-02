import { expect, test, describe } from "bun:test";
import { z } from "zod";
import { Signature } from "../../src/signatures/signature";
import { Predict } from "../../src/programs/predict";
import { buildProgramJson } from "../../src/serialization/program";

function summarizeSignature() {
  return new Signature({
    instructions: "Summarize the given text into a concise summary.",
    input: z.object({ text: z.string().describe("The text to summarize") }),
    output: z.object({
      summary: z.string().describe("A concise summary of the text"),
    }),
  });
}

describe("Predict.dump_state", () => {
  test("returns the flat dspy.Predict shape with exact key order", () => {
    const p = new Predict(summarizeSignature());
    const state = p.dump_state();

    expect(Object.keys(state)).toEqual([
      "traces",
      "train",
      "demos",
      "signature",
      "lm",
    ]);
    expect(state.traces).toEqual([]);
    expect(state.train).toEqual([]);
    expect(state.demos).toEqual([]);
    expect(state.lm).toBeNull();
    expect(state.signature).toEqual({
      instructions: "Summarize the given text into a concise summary.",
      fields: [
        { prefix: "Text:", description: "The text to summarize" },
        { prefix: "Summary:", description: "A concise summary of the text" },
      ],
    });
  });

  test("accepts a string signature like ds.ts", () => {
    const p = new Predict("question -> answer");
    const state = p.dump_state();
    expect(state.signature.fields.map((f: any) => f.prefix)).toEqual([
      "Question:",
      "Answer:",
    ]);
  });

  test("load_state round-trips instructions and field descriptions", () => {
    const dumped = new Predict(summarizeSignature()).dump_state();

    // Fresh predict with the same field names but no descriptions/instructions.
    const fresh = new Predict(
      new Signature({
        instructions: "placeholder",
        input: z.object({ text: z.string() }),
        output: z.object({ summary: z.string() }),
      }),
    );
    fresh.load_state(dumped);

    expect(fresh.dump_state()).toEqual(dumped);
  });
});

describe("buildProgramJson via Predict", () => {
  test("appends metadata as the last key", () => {
    const program = buildProgramJson(summarizeSignature());
    expect(Object.keys(program)).toEqual([
      "traces",
      "train",
      "demos",
      "signature",
      "lm",
      "metadata",
    ]);
    expect(typeof program.metadata.dependency_versions).toBe("object");
  });
});
