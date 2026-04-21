#!/usr/bin/env bash
# start-server.sh — install Node deps (once) and start the translation server.
#
# Run this BEFORE opening the Safari extension:
#   ./scripts/start-server.sh
#
# Keep the terminal window open — the model lives in memory here.
# Models load in ~10 s on first start; subsequent starts are the same
# (no caching needed, files are already on disk).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Install @xenova/transformers if not already present.
if [[ ! -d "$ROOT/node_modules/@xenova" ]]; then
  echo ""
  echo "━━━ Installing @xenova/transformers (first run only, ~50 MB) ━━━"
  npm install
  echo ""
fi

exec node "$ROOT/scripts/translation-server.mjs"
