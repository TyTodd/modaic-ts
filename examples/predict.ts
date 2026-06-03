/**
 * Example: run an existing Arbiter (an LLM judge) that's already on Modaic Hub.
 *
 * Unlike `create-arbiter.ts`, this does not push anything. It constructs a
 * handle to a repo that already exists with `new Arbiter("<owner>/<name>")`
 * and calls `predict()`. The Modaic server runs the LLM — this is a pure HTTP
 * call authenticated with `MODAIC_TOKEN`.
 *
 * Run it (after running `create-arbiter.ts`, or against any judge you own):
 *   export MODAIC_TOKEN="your-access-token"   # from https://modaic.dev
 *   bun run examples/predict.ts
 *
 * Optionally override which judge to run:
 *   MODAIC_REPO="your-username/quality-judge" bun run examples/predict.ts
 */

import { Arbiter } from "../src/index";

// The judge to run, in "owner/name" form — the same repo create-arbiter.ts
// pushes to. Change the owner to your own Modaic username/profile.
const repo = process.env.MODAIC_REPO ?? "modaic/quality-judge";

async function main() {
  if (!process.env.MODAIC_TOKEN) {
    throw new Error(
      "MODAIC_TOKEN is not set. Get a token from https://modaic.dev and " +
        "run: export MODAIC_TOKEN=...",
    );
  }

  // 1. Get a handle to the existing judge. No network call happens here — the
  //    repo's signature lives on the hub; predict() runs it server-side.
  const arbiter = new Arbiter(repo);

  // 2. Run it against a single input matching the judge's signature.
  console.log(`Running arbiter ${arbiter.repo} (rev: ${arbiter.rev}) ...`);
  const result = await arbiter.predict({
    question: "What is the capital of France?",
    answer: "Paris is the capital of France.",
  });

  console.log("verdict:", result.output.verdict);
  console.log("reasoning:", result.reasoning);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
