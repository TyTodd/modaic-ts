# @modaic/modaic-ts

TypeScript client for [Modaic](https://modaic.dev) Arbiters (LLM judges).

`Arbiter` is a thin wrapper over the Modaic REST API and git — it never runs an
LLM locally. `predict()` calls the API; `create()` / `update()` write the judge's
`config.json` (signature schema) and `program.json` (stored prompt) and push them
to Modaic Hub via git. These files are produced the same way as the Python SDK so
the two interoperate.

## Quickstart

```ts
import { Arbiter, Signature } from "@modaic/modaic-ts";
import { z } from "zod";

const signature = new Signature({
  instructions: "Decide whether the answer correctly addresses the question.",
  input: z.object({
    question: z.string().describe("The user's question"),
    answer: z.string().describe("The answer to judge"),
  }),
  output: z.object({
    verdict: z.string().describe("correct | incorrect"),
  }),
});

// Create + push a new judge (private by default). Uses MODAIC_TOKEN.
const arbiter = await Arbiter.create({
  repo: "modaic/quality-judge",
  signature,
  commit_message: "initial judge",
});

// Run it (the server runs the LLM).
const result = await arbiter.predict({ question: "...", answer: "..." });
console.log(result.output, result.reasoning);

// Update later (optional new signature / metadata / extra files).
await arbiter.update({ signature, commit_message: "tweak prompt" });

// Open an existing judge at a specific revision.
const existing = new Arbiter("modaic/quality-judge", { rev: "v1" });
```

## Configuration

| Env var          | Default                   | Purpose                              |
| ---------------- | ------------------------- | ------------------------------------ |
| `MODAIC_TOKEN`   | —                         | Access token (or pass `access_token`)|
| `MODAIC_API_URL` | `https://api.modaic.dev`  | Modaic REST API base URL             |
| `MODAIC_GIT_URL` | `https://git.modaic.dev`  | Modaic git host                      |
| `MODAIC_CACHE`   | `~/.cache/modaic`         | Staging dir for git working trees    |

## Develop

```bash
bun install
bun test
bun run build
```

> Note: `serializeSignatureToConfig` (signature → `config.json`) is provided
> separately and currently throws. `create()`/`update()` with a signature will
> not push until that lands; `predict()` and `program.json` generation work today.
