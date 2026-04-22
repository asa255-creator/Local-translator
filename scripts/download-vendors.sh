#!/usr/bin/env bash
# download-vendors.sh — fetch OCR vendor assets from free CDNs.
#
# Run this ONCE from the repo root after cloning:
#   ./scripts/download-vendors.sh
#
# What it downloads (~65 MB total):
#   vendor/tesseract/   — Tesseract.js v4 UMD library + worker + WASM core
#   vendor/traineddata/ — OCR language models for Japanese + Chinese
#
# Translation is handled entirely on-device by Apple's Translation framework
# (macOS 15+) — no model downloads needed.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/tesseract"
TRAINED_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/traineddata"

mkdir -p "$TESS_DIR" "$TRAINED_DIR"

JSDELIVR="https://cdn.jsdelivr.net/npm"
TESSDATA="https://tessdata.projectnaptha.com/4.0.0_best"

echo "━━━ Tesseract.js v4 library ━━━"
curl -fL "$JSDELIVR/tesseract.js@4/dist/tesseract.min.js"       -o "$TESS_DIR/tesseract.min.js"
curl -fL "$JSDELIVR/tesseract.js@4/dist/worker.min.js"          -o "$TESS_DIR/worker.min.js"
curl -fL "$JSDELIVR/tesseract.js-core@4/tesseract-core.wasm.js" -o "$TESS_DIR/tesseract-core.wasm.js"
echo "  ✓ Tesseract.js library"

echo ""
echo "━━━ Tesseract traineddata (OCR language models) ━━━"

echo -n "  Downloading jpn.traineddata.gz (~25 MB)... "
curl -fL --progress-bar "$TESSDATA/jpn.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/jpn.traineddata"
echo "OK"

echo -n "  Downloading chi_sim.traineddata.gz (~20 MB)... "
curl -fL --progress-bar "$TESSDATA/chi_sim.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/chi_sim.traineddata"
echo "OK"

echo -n "  Downloading chi_tra.traineddata.gz (~20 MB)... "
curl -fL --progress-bar "$TESSDATA/chi_tra.traineddata.gz" \
  | gunzip > "$TRAINED_DIR/chi_tra.traineddata"
echo "OK"

echo ""
echo "━━━ Done ━━━"
echo "OCR vendor files ready (~65 MB total)."
echo ""
echo "Translation uses Apple's on-device Translation framework — no additional"
echo "downloads needed here. On first use, macOS may prompt you to download the"
echo "Japanese or Chinese language pack (a few hundred MB, free from Apple)."
echo ""
echo "Next: Build the Xcode project (Cmd+R) and enable the extension in Safari."
