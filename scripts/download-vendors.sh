#!/usr/bin/env bash
# download-vendors.sh — fetch all vendor assets from free CDNs.
#
# Run this ONCE from the repo root after cloning:
#   ./scripts/download-vendors.sh
#
# What it downloads:
#   vendor/tesseract/   — Tesseract.js v4 UMD library + worker + WASM core
#   vendor/traineddata/ — OCR language models for Japanese + Chinese (~65 MB)
#   vendor/             — Transformers.js v2 library (~1 MB)
#
# What it does NOT download (handled automatically at runtime by the extension):
#   ONNX Runtime WASM files  — fetched by Transformers.js from jsDelivr on
#                               first translation, then cached in extension
#                               Cache Storage.
#   Helsinki-NLP/opus-mt weights — fetched from Hugging Face on first
#                               translation per language pair (~75 MB each),
#                               then cached in extension Cache Storage.
#
# Total one-time download: ~67 MB (vendors) + ~170 MB (first translation use).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/tesseract"
TRAINED_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/traineddata"
VENDOR_DIR="$ROOT/LocalTranslator Extension/Resources/vendor"

mkdir -p "$TESS_DIR" "$TRAINED_DIR"

JSDELIVR="https://cdn.jsdelivr.net/npm"
TESSDATA="https://tessdata.projectnaptha.com/4.0.0_best"

echo "━━━ Tesseract.js v4 library ━━━"
curl -fL "$JSDELIVR/tesseract.js@4/dist/tesseract.min.js"     -o "$TESS_DIR/tesseract.min.js"
curl -fL "$JSDELIVR/tesseract.js@4/dist/worker.min.js"        -o "$TESS_DIR/worker.min.js"
curl -fL "$JSDELIVR/tesseract.js-core@4/tesseract-core.wasm.js" -o "$TESS_DIR/tesseract-core.wasm.js"
echo "  ✓ Tesseract.js library"

echo ""
echo "━━━ Tesseract traineddata (OCR language models) ━━━"

echo -n "  Downloading jpn.traineddata.gz (~25 MB)… "
curl -fL --progress-bar "$TESSDATA/jpn.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/jpn.traineddata"
echo "✓"

echo -n "  Downloading chi_sim.traineddata.gz (~20 MB)… "
curl -fL --progress-bar "$TESSDATA/chi_sim.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/chi_sim.traineddata"
echo "✓"

echo -n "  Downloading chi_tra.traineddata.gz (~20 MB)… "
curl -fL --progress-bar "$TESSDATA/chi_tra.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/chi_tra.traineddata"
echo "✓"

echo ""
echo "━━━ Transformers.js v2 library ━━━"
curl -fL "$JSDELIVR/@xenova/transformers@2.17.2/dist/transformers.min.js" \
  -o "$VENDOR_DIR/transformers.min.js"
echo "  ✓ transformers.min.js"

echo ""
echo "━━━ Done ━━━"
echo "Vendor files are ready. Build the Xcode project and enable the extension in Safari."
echo ""
echo "On first use the extension will download:"
echo "  • ONNX Runtime WASM (~20 MB, from cdn.jsdelivr.net)"
echo "  • opus-mt-ja-en model (~75 MB, from huggingface.co)  ← Japanese"
echo "  • opus-mt-zh-en model (~75 MB, from huggingface.co)  ← Chinese"
echo "These are cached in the extension's own storage and never re-downloaded."
