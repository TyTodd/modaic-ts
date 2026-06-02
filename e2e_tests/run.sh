#!/usr/bin/env bash
# Run the TS-serialization -> Python-deserialization e2e suite.
#
# Uses the modaic SDK's interpreter (which has modaic/dspy/pytest installed).
# Override with MODAIC_PYTHON=/path/to/python if your venv lives elsewhere.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MODAIC_TS="$(dirname "$HERE")"
PYTHON="${MODAIC_PYTHON:-$MODAIC_TS/../modaic/.venv/bin/python}"

if [ ! -x "$PYTHON" ]; then
  echo "Python interpreter not found: $PYTHON" >&2
  echo "Set MODAIC_PYTHON to a python with the modaic SDK installed." >&2
  exit 1
fi

exec "$PYTHON" -m pytest "$HERE" "$@"
