#!/usr/bin/env bash
# download-vendors.sh — fetch ALL assets needed to run fully offline.
#
# Run this ONCE from the repo root after cloning:
#   ./scripts/download-vendors.sh
#
# Downloads (~240 MB total):
#   vendor/tesseract/      — Tesseract.js v4 library + worker + WASM core
#   vendor/traineddata/    — OCR models: Japanese + Chinese (~65 MB)
#   vendor/transformers.min.js — Transformers.js v2 library (~1 MB)
#   vendor/onnx/           — ONNX Runtime WASM files (~20 MB)
#   vendor/models/         — opus-mt translation models (~150 MB)
#
# After this script the extension is 100% offline — no network needed at all.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/tesseract"
TRAINED_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/traineddata"
VENDOR_DIR="$ROOT/LocalTranslator Extension/Resources/vendor"
ONNX_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/onnx"
MODELS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/models"

mkdir -p "$TESS_DIR" "$TRAINED_DIR" "$ONNX_DIR"

JSDELIVR="https://cdn.jsdelivr.net/npm"
TESSDATA="https://tessdata.projectnaptha.com/4.0.0_best"
HF="https://huggingface.co"

# ── Tesseract.js ──────────────────────────────────────────────────────────────
echo "━━━ Tesseract.js v4 library ━━━"
curl -fL "$JSDELIVR/tesseract.js@4/dist/tesseract.min.js"       -o "$TESS_DIR/tesseract.min.js"
curl -fL "$JSDELIVR/tesseract.js@4/dist/worker.min.js"          -o "$TESS_DIR/worker.min.js"
curl -fL "$JSDELIVR/tesseract.js-core@4/tesseract-core.wasm.js" -o "$TESS_DIR/tesseract-core.wasm.js"
echo "  ✓ Tesseract.js library"

echo ""
echo "━━━ Tesseract traineddata (OCR language models) ━━━"
echo -n "  Downloading jpn.traineddata.gz (~25 MB)… "
curl -fL --progress-bar "$TESSDATA/jpn.traineddata.gz" | gunzip > "$TRAINED_DIR/jpn.traineddata"
echo "✓"
echo -n "  Downloading chi_sim.traineddata.gz (~20 MB)… "
curl -fL --progress-bar "$TESSDATA/chi_sim.traineddata.gz" | gunzip > "$TRAINED_DIR/chi_sim.traineddata"
echo "✓"
echo -n "  Downloading chi_tra.traineddata.gz (~20 MB)… "
curl -fL --progress-bar "$TESSDATA/chi_tra.traineddata.gz" | gunzip > "$TRAINED_DIR/chi_tra.traineddata"
echo "✓"

# ── Transformers.js ───────────────────────────────────────────────────────────
echo ""
echo "━━━ Transformers.js v2 library ━━━"
curl -fL "$JSDELIVR/@xenova/transformers@2.17.2/dist/transformers.min.js" \
  -o "$VENDOR_DIR/transformers.min.js"
echo "  ✓ transformers.min.js"

# ── ONNX Runtime WASM ─────────────────────────────────────────────────────────
echo ""
echo "━━━ ONNX Runtime WASM (~20 MB) ━━━"
ONNX_BASE="$JSDELIVR/@xenova/transformers@2.17.2/dist"
for f in ort-wasm-simd-threaded.wasm ort-wasm-simd.wasm ort-wasm.wasm ort-wasm-threaded.wasm; do
  curl -fL --progress-bar "$ONNX_BASE/$f" -o "$ONNX_DIR/$f" 2>/dev/null || \
    echo "  (skipped $f — not available)"
done
echo "  ✓ ONNX WASM files"

# ── Translation model weights ─────────────────────────────────────────────────
echo ""
echo "━━━ Translation model weights (~150 MB total) ━━━"
echo "    These are bundled with the extension so no network is needed at runtime."
echo ""

download_model() {
  local model="$1"
  local label="$2"
  local dir="$MODELS_DIR/$model"
  mkdir -p "$dir/onnx"
  local base="$HF/$model/resolve/main"

  echo "  $label"
  # Small config/tokenizer files
  for f in config.json generation_config.json tokenizer_config.json vocab.json source.spm target.spm; do
    curl -fsSL "$base/$f" -o "$dir/$f" 2>/dev/null || true
  done
  # ONNX weights — these are the large files
  echo -n "    encoder_model.onnx… "
  curl -fL --progress-bar "$base/onnx/encoder_model.onnx" -o "$dir/onnx/encoder_model.onnx"
  echo -n "    decoder_model_merged.onnx… "
  curl -fL --progress-bar "$base/onnx/decoder_model_merged.onnx" -o "$dir/onnx/decoder_model_merged.onnx" 2>/dev/null || {
    # Some models use decoder_with_past + plain decoder instead of merged
    echo -n " (trying split files)… "
    curl -fL --progress-bar "$base/onnx/decoder_model.onnx" -o "$dir/onnx/decoder_model.onnx"
    curl -fL --progress-bar "$base/onnx/decoder_with_past_model.onnx" -o "$dir/onnx/decoder_with_past_model.onnx"
  }
  echo "  ✓ $model"
}

download_model "Xenova/opus-mt-ja-en" "Japanese → English (~75 MB)"
echo ""
download_model "Xenova/opus-mt-zh-en" "Chinese → English (~75 MB)"

echo ""
echo "━━━ Done ━━━"
echo "All assets downloaded. Now:"
echo "  1. Open Xcode and press ⌘R to rebuild"
echo "  2. Reload any Safari tab and click the extension icon"
echo ""
echo "The extension is now 100% offline — no network needed at runtime."
