import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { Arbiter } from "../../src/arbiter/arbiter";
import { Signature } from "../../src/signatures/signature";
import { repoNameToTitle } from "../../src/serialization/naming";
import { AuthenticationError } from "../../src/exceptions";

describe("repoNameToTitle", () => {
  test("derives PascalCase from the repo name segment", () => {
    expect(repoNameToTitle("modaic/quality-judge")).toBe("QualityJudge");
    expect(repoNameToTitle("modaic/tyrin_judge")).toBe("TyrinJudge");
    expect(repoNameToTitle("my-judge")).toBe("MyJudge");
  });
});

describe("Arbiter constructor", () => {
  test("defaults branch to main and rev to branch", () => {
    const a = new Arbiter("modaic/judge");
    expect(a.repo).toBe("modaic/judge");
    expect(a.branch).toBe("main");
    expect(a.rev).toBe("main");
  });

  test("honors branch and rev overrides", () => {
    const a = new Arbiter("modaic/judge", { branch: "dev", rev: "v1" });
    expect(a.branch).toBe("dev");
    expect(a.rev).toBe("v1");
  });
});

describe("token resolution", () => {
  const prev = process.env.MODAIC_TOKEN;
  afterEach(() => {
    if (prev === undefined) delete process.env.MODAIC_TOKEN;
    else process.env.MODAIC_TOKEN = prev;
  });

  test("predict throws AuthenticationError without a token", async () => {
    delete process.env.MODAIC_TOKEN;
    const a = new Arbiter("modaic/judge");
    await expect(a.predict({ text: "hi" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });
});

describe("Arbiter.create wiring", () => {
  const prev = process.env.MODAIC_TOKEN;
  beforeEach(() => {
    process.env.MODAIC_TOKEN = "test-token";
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.MODAIC_TOKEN;
    else process.env.MODAIC_TOKEN = prev;
  });

  const signature = new Signature({
    instructions: "Judge the answer.",
    input: z.object({ question: z.string(), answer: z.string() }),
    output: z.object({ verdict: z.string() }),
  });

  test("serializes the signature before any network call", async () => {
    // create() builds config.json/program.json from the signature, then hits the
    // network. Mock fetch to prove we reach the network step (i.e. serialization
    // succeeded) without making a real request.
    const realFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("__network_reached__");
    }) as unknown as typeof fetch;
    try {
      await expect(
        Arbiter.create({ repo: "modaic/judge", signature }),
      ).rejects.toThrow(/__network_reached__/);
      expect(fetchCalled).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("Arbiter.predict request", () => {
  const prevToken = process.env.MODAIC_TOKEN;
  const prevApi = process.env.MODAIC_API_URL;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.MODAIC_TOKEN = "test-token";
    process.env.MODAIC_API_URL = "https://api.example.test";
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (prevToken === undefined) delete process.env.MODAIC_TOKEN;
    else process.env.MODAIC_TOKEN = prevToken;
    if (prevApi === undefined) delete process.env.MODAIC_API_URL;
    else process.env.MODAIC_API_URL = prevApi;
  });

  test("posts the right body and parses the response", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), init };
      return new Response(
        JSON.stringify({
          example_id: "ex1",
          prediction_id: "pred1",
          output: { verdict: "correct" },
          reasoning: "looks right",
          messages: [{ role: "assistant", content: "ok" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const a = new Arbiter("modaic/judge", { rev: "v2" });
    const result = await a.predict(
      { question: "q", answer: "a" },
      { ground_reasoning: "because", compute_confidence: true },
    );

    expect(result.exampleId).toBe("ex1");
    expect(result.predictionId).toBe("pred1");
    expect(result.output).toEqual({ verdict: "correct" });
    expect(result.reasoning).toBe("looks right");
    expect(result.messages).toHaveLength(1);

    expect(captured!.url).toBe(
      "https://api.example.test/api/v2/arbiters/predictions",
    );
    expect(captured!.init.method).toBe("POST");
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toEqual({
      input: { question: "q", answer: "a" },
      arbiter_repo: "modaic/judge",
      arbiter_revision: "v2",
      ground_truth: null,
      ground_reasoning: "because",
      compute_confidence: true,
    });
  });
});
