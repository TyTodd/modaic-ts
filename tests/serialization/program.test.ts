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
  // Mirrors dspy.LM(model).dump_state(); see real artifacts under
  // ~/.cache/modaic/.../program.json (e.g. modaic/vercel-email-scoring).
  lm: {
    model: "gpt-oss-120b",
    model_type: "chat",
    cache: true,
    num_retries: 3,
    finetuning_model: null,
    launch_kwargs: {},
    train_kwargs: {},
    temperature: null,
    max_tokens: null,
  },
};

const MODEL = "gpt-oss-120b";

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
    const program = buildProgramJson(signature, MODEL);
    expect(meaningfulSubset(program)).toEqual(EXPECTED_PROGRAM_SUBSET);
  });

  test("writes the model into lm without secrets, and empty defaults", () => {
    const program = buildProgramJson(signature, MODEL);
    expect(program.lm?.model).toBe(MODEL);
    expect(program.lm).not.toHaveProperty("api_key");
    expect(program.traces).toEqual([]);
    expect(program.train).toEqual([]);
    expect(program.demos).toEqual([]);
  });

  test("records dependency_versions metadata as an object", () => {
    const program = buildProgramJson(signature, MODEL);
    expect(typeof program.metadata.dependency_versions).toBe("object");
  });

  test("preserves input-then-output field order", () => {
    const program = buildProgramJson(signature, MODEL);
    expect(program.signature.fields.map((f) => f.prefix)).toEqual([
      "Text:",
      "Summary:",
    ]);
  });
});
