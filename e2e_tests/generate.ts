/**
 * E2E generator: turn a named signature spec (specs.json) into the on-disk
 * artifacts the Modaic hub stores — `program.json` (always) and `config.json`
 * (best-effort; skipped while `serializeSignatureToConfig` is a stub).
 *
 * Usage:  bun run e2e_tests/generate.ts <specName> <outDir>
 *
 * The Python e2e test then deserializes <outDir> with the real SDK and asserts
 * the reconstructed signature matches the spec.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Signature } from "../src/signatures/signature";
import { buildProgramJson } from "../src/serialization/program";
import { serializeSignatureToConfig } from "../src/serialization/config";
import { repoNameToTitle } from "../src/serialization/naming";

type FieldSpec = { name: string; type: string; desc?: string };
type Spec = {
  instructions?: string;
  inputs: FieldSpec[];
  outputs: FieldSpec[];
  repo?: string;
  model?: string;
};

function zodFor(type: string): z.ZodType {
  switch (type) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "string":
    default:
      return z.string();
  }
}

function buildShape(fields: FieldSpec[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) {
    const t = zodFor(f.type);
    shape[f.name] = f.desc ? t.describe(f.desc) : t;
  }
  return z.object(shape);
}

const [, , specName, outDir] = process.argv;
if (!specName || !outDir) {
  console.error("usage: bun run e2e_tests/generate.ts <specName> <outDir>");
  process.exit(2);
}

const specs = JSON.parse(
  fs.readFileSync(path.join(import.meta.dir, "specs.json"), "utf-8"),
) as Record<string, Spec>;
const spec = specs[specName];
if (!spec) {
  console.error(`unknown spec: ${specName}`);
  process.exit(2);
}

const signature = new Signature({
  instructions: spec.instructions,
  input: buildShape(spec.inputs),
  output: buildShape(spec.outputs),
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "program.json"),
  JSON.stringify(buildProgramJson(signature, spec.model ?? "gpt-oss-120b"), null, 2),
);

const repo = spec.repo ?? `e2e/${specName}`;
try {
  const config = serializeSignatureToConfig(signature, repoNameToTitle(repo));
  fs.writeFileSync(
    path.join(outDir, "config.json"),
    JSON.stringify(config, null, 2),
  );
  console.log(`wrote config.json + program.json to ${outDir}`);
} catch (e) {
  console.warn(`config.json skipped (serializer not ready): ${(e as Error).message}`);
  console.log(`wrote program.json to ${outDir}`);
}
