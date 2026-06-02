"""End-to-end: TypeScript serialization -> Python deserialization.

For each spec in specs.json we run the TS generator (via bun) to emit the
on-disk artifacts, then deserialize them with the real Modaic SDK and assert the
reconstructed signature matches the spec.

Run with the modaic SDK's interpreter (see run.sh), e.g.:
    ../modaic/.venv/bin/python -m pytest e2e_tests -q
"""

import json
import os
import subprocess
import warnings
from pathlib import Path

import pytest

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
MODAIC_TS = HERE.parent  # modaic-ts repo root (where bun + src live)
SPECS = json.loads((HERE / "specs.json").read_text())

# spec "type" string -> expected reconstructed python annotation
PY_TYPE = {"string": str, "number": float, "boolean": bool, "integer": int}


def _run_generator(spec_name: str, out_dir: Path) -> None:
    bun = os.environ.get("BUN", "bun")
    res = subprocess.run(
        [bun, "run", str(HERE / "generate.ts"), spec_name, str(out_dir)],
        cwd=MODAIC_TS,
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(
            f"generator failed for {spec_name!r}:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )


@pytest.fixture(params=sorted(SPECS.keys()))
def generated(request, tmp_path):
    """(name, spec, out_dir) with TS artifacts written into a temp dir."""
    name = request.param
    out = tmp_path / name
    _run_generator(name, out)
    return name, SPECS[name], out


def _all_fields(spec):
    for f in spec["inputs"]:
        yield f, "input"
    for f in spec["outputs"]:
        yield f, "output"


def test_program_json_load_state(generated):
    """The TS program.json (the prompt/state) loads into a Python signature.

    Builds a signature with the spec's field names/types, then applies the TS
    program.json via load_state and checks instructions + descriptions land.
    """
    from dspy import InputField, OutputField
    from dspy.signatures import make_signature
    from modaic import Predict

    name, spec, out = generated

    fields = {}
    for f in spec["inputs"]:
        fields[f["name"]] = (PY_TYPE[f["type"]], InputField())
    for f in spec["outputs"]:
        fields[f["name"]] = (PY_TYPE[f["type"]], OutputField())
    predict = Predict(make_signature(fields, instructions="placeholder"))

    predict.load_state(json.loads((out / "program.json").read_text()))

    assert predict.signature.instructions == spec.get("instructions")
    desc = {
        n: (fl.json_schema_extra or {}).get("desc")
        for n, fl in predict.signature.fields.items()
    }
    for f, _kind in _all_fields(spec):
        assert desc[f["name"]] == f.get("desc"), f["name"]


def test_full_from_precompiled(generated):
    """TS config.json + program.json deserialize via the real hub entrypoint.

    Skips until the TS config serializer (serializeSignatureToConfig) is wired
    up — until then the generator does not emit config.json.
    """
    name, spec, out = generated
    if not (out / "config.json").exists():
        pytest.skip("config.json serializer not implemented yet (serializeSignatureToConfig)")

    from modaic import Predict

    sig = Predict.from_precompiled(str(out)).signature

    assert sig.instructions == spec.get("instructions")
    assert list(sig.input_fields.keys()) == [f["name"] for f in spec["inputs"]]
    assert list(sig.output_fields.keys()) == [f["name"] for f in spec["outputs"]]

    for f, kind in _all_fields(spec):
        fld = sig.fields[f["name"]]
        extra = fld.json_schema_extra or {}
        assert extra.get("desc") == f.get("desc"), f["name"]
        assert extra.get("__dspy_field_type") == kind, f["name"]
        assert fld.annotation == PY_TYPE[f["type"]], f["name"]
