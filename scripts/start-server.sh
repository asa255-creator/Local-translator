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

MODELS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/models"
HF="https://huggingface.co"

# Install @xenova/transformers if not already present.
if [[ ! -d "$ROOT/node_modules/@xenova" ]]; then
  echo ""
  echo "━━━ Installing @xenova/transformers (first run only, ~50 MB) ━━━"
  npm install
  echo ""
fi

# Download tokenizer.json for each model if missing.
# Transformers.js v2 requires this file; it was not included in the
# original download-vendors.sh so existing installs need it fetched once.
for model in "Xenova/opus-mt-ja-en" "Xenova/opus-mt-zh-en"; do
  tok="$MODELS_DIR/$model/tokenizer.json"
  if [[ ! -f "$tok" ]]; then
    echo "Downloading missing tokenizer.json for $model…"
    mkdir -p "$(dirname "$tok")"
    curl -fsSL "$HF/$model/resolve/main/tokenizer.json" -o "$tok"
    echo "  ✓ $tok"
  fi
done

exec node "$ROOT/scripts/translation-server.mjs"
