#!/usr/bin/env sh
# SAFE TO RUN
# POSIX wrapper for Hydra Ensemble smoke test (Linux/macOS).
# Verifies Node is available, then delegates to scripts/smoke.mjs.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: 'node' not found on PATH. Install Node.js 20+ before running smoke tests." >&2
  exit 1
fi

if [ ! -d "$REPO_ROOT/node_modules" ]; then
  echo "ERROR: node_modules/ missing. Run \`npm install\` (and \`npm run rebuild\`) first." >&2
  exit 1
fi

exec node "$SCRIPT_DIR/smoke.mjs" "$@"
