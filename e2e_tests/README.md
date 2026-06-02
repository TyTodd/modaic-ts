# e2e_tests — TypeScript serialization → Python deserialization

Proves that artifacts serialized by `@modaic/modaic-ts` are deserialized
correctly by the Python Modaic SDK (the same path the hub uses).

## How it works

For every spec in [`specs.json`](./specs.json):

1. **Serialize (TS):** [`generate.ts`](./generate.ts) builds a `Signature` and
   writes `program.json` (always) and `config.json` (when the serializer exists)
   into a temp dir, using the package's real `buildProgramJson` /
   `serializeSignatureToConfig`.
2. **Deserialize (Python):** [`test_roundtrip.py`](./test_roundtrip.py) loads the
   temp dir with the real SDK and asserts the reconstructed signature matches the
   spec.

Two checks per spec:

- `test_program_json_load_state` — loads the TS `program.json` (the prompt/state)
  into a Python signature via `load_state`; verifies instructions + field
  descriptions. **Runs today.**
- `test_full_from_precompiled` — loads `config.json` + `program.json` via
  `modaic.Predict.from_precompiled` and verifies field names, types,
  descriptions, and `__dspy_field_type`. **Auto-skips** until the TS
  `serializeSignatureToConfig` lands (no `config.json` is emitted before then).

## Run

```bash
./e2e_tests/run.sh            # or: ./e2e_tests/run.sh -q -v
```

Requires `bun` on PATH and a Python with the modaic SDK installed. By default it
uses the sibling repo's venv (`../modaic/.venv/bin/python`); override with
`MODAIC_PYTHON=/path/to/python` (or `BUN=/path/to/bun`).

## Adding a case

Add an entry to `specs.json` (`instructions`, `inputs`, `outputs` with
`name`/`type`/`desc`). Both the generator and the asserts pick it up
automatically — `type` is one of `string` | `number` | `boolean`.
