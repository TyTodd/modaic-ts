/**
 * Example: create an Arbiter (an LLM judge) and push it to Modaic Hub.
 *
 * An Arbiter is a thin wrapper over the Modaic REST API + git. `create()`
 * writes the judge's `config.json` (signature schema) and `program.json`
 * (stored prompt) and pushes them to your Modaic profile via git.
 *
 * Run it:
 *   export MODAIC_TOKEN="your-access-token"   # from https://modaic.dev
 *   bun run examples/create-arbiter.ts
 *
 * Optionally override where it pushes:
 *   MODAIC_REPO="your-username/quality-judge" bun run examples/create-arbiter.ts
 */

import { Arbiter, Signature } from "../src/index";
import { z } from "zod";

// Where to push the judge on Modaic Hub, in "owner/name" form.
// Change the owner to your own Modaic username/profile.
const repo = process.env.MODAIC_REPO ?? "modaic/quality-judge";

async function main() {
  if (!process.env.MODAIC_TOKEN) {
    throw new Error(
      "MODAIC_TOKEN is not set. Get a token from https://modaic.dev and " +
        "run: export MODAIC_TOKEN=...",
    );
  }

  // 1. Define what the judge sees (input) and what it decides (output).
  const signature = new Signature({
    instructions:
      "Decide whether the answer correctly and completely addresses the question.",
    input: z.object({
      question: z.string().describe("The user's question"),
      answer: z.string().describe("The answer to judge"),
    }),
    output: z.object({
      verdict: z.string().describe("correct | incorrect"),
    }),
  });

  // 2. Create the repo on Modaic Hub and push the judge.
  //    Private by default. Uses MODAIC_TOKEN for both API + git auth.
  console.log(`Creating arbiter and pushing to ${repo} ...`);
  const arbiter = await Arbiter.create({
    repo,
    signature,
    // The model the Modaic server runs the judge with (a LiteLLM model string,
    // "<provider>/<model>" — the provider prefix is required by LiteLLM).
    model: "modaic/openai/gpt-oss-120b",
    commit_message: "initial judge",
    private: true,
    metadata: {
      tags: ["judge", "example"],
      description: "Judges whether an answer addresses a question.",
    },
  });
  console.log(`Pushed. Branch: ${arbiter.branch}, rev: ${arbiter.rev}`);

  // 3. Run it — the Modaic server runs the LLM, not this client.
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
