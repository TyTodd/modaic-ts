import { expect, test, describe } from "bun:test";
import { z } from "zod";
import { Signature } from "../../src/signatures/signature";
import { buildProgramJson } from "../../src/serialization/program";

// The meaningful subset of the Python artifact at
// .../sync/TyTodd/predict-test-repo/program.json — the canonical "SummarizeSignature".
// metadata.dependency_versions is environment-specific and excluded from parity.
const EXPECTED_PROGRAM_SUBSET = {
  traces: [],
  train: [],
  demos: [],
  signature: {
    instructions: "Summarize the given text into a concise summary.",
    fields: [
      { prefix: "Text:", description: "The text to summarize" },
      { prefix: "Summary:", description: "A concise summary of the text" },
    ],
  },
  lm: null,
};

function meaningfulSubset(p: ReturnType<typeof buildProgramJson>) {
  return {
    traces: p.traces,
    train: p.train,
    demos: p.demos,
    signature: p.signature,
    lm: p.lm,
  };
}

describe("buildProgramJson", () => {
  const signature = new Signature({
    instructions: "Summarize the given text into a concise summary.",
    input: z.object({ text: z.string().describe("The text to summarize") }),
    output: z.object({
      summary: z.string().describe("A concise summary of the text"),
    }),
  });

  test("matches the Python program.json for the same signature", () => {
    const program = buildProgramJson(signature);
    expect(meaningfulSubset(program)).toEqual(EXPECTED_PROGRAM_SUBSET);
  });

  test("never writes an lm (no secrets) and uses empty defaults", () => {
    const program = buildProgramJson(signature);
    expect(program.lm).toBeNull();
    expect(program.traces).toEqual([]);
    expect(program.train).toEqual([]);
    expect(program.demos).toEqual([]);
  });

  test("records dependency_versions metadata as an object", () => {
    const program = buildProgramJson(signature);
    expect(typeof program.metadata.dependency_versions).toBe("object");
  });

  test("preserves input-then-output field order", () => {
    const program = buildProgramJson(signature);
    expect(program.signature.fields.map((f) => f.prefix)).toEqual([
      "Text:",
      "Summary:",
    ]);
  });
});
