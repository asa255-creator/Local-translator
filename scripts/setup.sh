#!/usr/bin/env bash
# setup.sh — one-shot setup from a fresh clone to a Safari extension ready to build.
#
# Usage (paste this into Terminal on a Mac with Xcode installed):
#
#   git clone https://github.com/asa255-creator/Local-translator.git
#   cd Local-translator
#   ./scripts/setup.sh
#
# What it does:
#   1. Checks that Xcode (12 or later) and curl are installed.
#   2. Downloads all vendor files (~67 MB) from free CDNs.
#   3. Generates an Xcode project using Apple's safari-web-extension-converter.
#   4. Opens the project in Xcode so you can set your signing team and build.
#
# After ./scripts/setup.sh:
#   • Set your Apple ID / Team in Xcode → Signing & Capabilities  (one-time)
#   • Press ⌘R — the host app opens and walks you through enabling in Safari
#   • On first translation: ~170 MB of model weights download automatically
#     from Hugging Face; every subsequent use is fully offline.

set -euo pipefail

# ── Always run from the repo root ────────────────────────────────────────────
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

RED='\033[0;31m'
GRN='\033[0;32m'
BLD='\033[1m'
RST='\033[0m'

ok()   { echo -e "${GRN}✓${RST} $*"; }
fail() { echo -e "${RED}✗ $*${RST}" >&2; exit 1; }
hr()   { echo ""; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

hr
echo -e "${BLD}Local Translator — Setup${RST}"
hr

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
echo ""
echo "Checking prerequisites…"

if [[ "$(uname)" != "Darwin" ]]; then
  fail "This project requires macOS. Safari extensions cannot be built on other platforms."
fi

if ! command -v xcode-select &>/dev/null || [[ "$(xcode-select -p 2>/dev/null)" == "" ]]; then
  fail "Xcode Command Line Tools not found.\nInstall with:  xcode-select --install"
fi

XCODE_VERSION=$(xcodebuild -version 2>/dev/null | head -1 | sed 's/Xcode //')
XCODE_MAJOR="${XCODE_VERSION%%.*}"
if [[ -z "$XCODE_MAJOR" || "$XCODE_MAJOR" -lt 12 ]]; then
  fail "Xcode 12 or later is required (found: ${XCODE_VERSION:-none}).\nDownload from the Mac App Store."
fi
ok "Xcode $XCODE_VERSION"

if ! xcrun --find safari-web-extension-converter &>/dev/null; then
  fail "safari-web-extension-converter not found in Xcode toolchain.\nMake sure Xcode (not just the Command Line Tools) is installed."
fi
ok "safari-web-extension-converter available"

if ! command -v curl &>/dev/null; then
  fail "curl is required but not found."
fi
ok "curl available"

# ── 2. Download vendor files ──────────────────────────────────────────────────
hr
echo ""
echo "Step 1 / 3 — Downloading vendor files"
echo ""
"$REPO_ROOT/scripts/download-vendors.sh"

# ── 3. Generate Xcode project ─────────────────────────────────────────────────
hr
echo ""
echo "Step 2 / 3 — Generating Xcode project with safari-web-extension-converter"
echo ""

EXT_RESOURCES="$REPO_ROOT/LocalTranslator Extension/Resources"

if [[ ! -f "$EXT_RESOURCES/manifest.json" ]]; then
  fail "Extension resources not found at: $EXT_RESOURCES\nMake sure you cloned the full repository."
fi

# Run the converter. --force overwrites any previously-generated Swift wrapper
# files so the command is safe to re-run. The web extension resources folder
# is not touched.
xcrun safari-web-extension-converter \
  "$EXT_RESOURCES" \
  --project-location "$REPO_ROOT" \
  --app-name "LocalTranslator" \
  --bundle-identifier "com.example.LocalTranslator" \
  --swift \
  --macos-only \
  --force

# The converter outputs the project at one of these locations depending on
# Xcode version.
PROJ=""
for candidate in \
  "$REPO_ROOT/LocalTranslator/LocalTranslator.xcodeproj" \
  "$REPO_ROOT/LocalTranslator.xcodeproj"; do
  if [[ -d "$candidate" ]]; then
    PROJ="$candidate"
    break
  fi
done

if [[ -z "$PROJ" ]]; then
  # Fall back: find any .xcodeproj in the repo root
  PROJ="$(find "$REPO_ROOT" -maxdepth 2 -name "*.xcodeproj" | head -1)"
fi

if [[ -z "$PROJ" ]]; then
  fail "safari-web-extension-converter did not create a .xcodeproj.\nCheck the output above for errors."
fi

ok "Xcode project created: $PROJ"

# ── 4. Open in Xcode ──────────────────────────────────────────────────────────
hr
echo ""
echo "Step 3 / 3 — Opening Xcode"
echo ""
open "$PROJ"

hr
echo ""
echo -e "${BLD}Setup complete. Three steps remain in Xcode:${RST}"
echo ""
echo "  1. Xcode → your target → Signing & Capabilities"
echo "     → set your Apple ID / Development Team"
echo ""
echo "  2. Press ⌘R (Run)"
echo "     The host app opens and shows instructions."
echo ""
echo "  3. Safari → Settings → Extensions → tick Local Translator"
echo "     Then click the toolbar icon to turn translation on."
echo ""
echo "  On first use: translation model weights (~170 MB) download once"
echo "  from Hugging Face, then the extension is fully offline forever."
echo ""
hr
echo ""
