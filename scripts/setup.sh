#!/usr/bin/env bash
# setup.sh — one-shot setup from a fresh clone to a Safari extension ready to build.
#
# Usage:
#   git clone https://github.com/asa255-creator/Local-translator.git
#   cd Local-translator
#   ./scripts/setup.sh

# Always run from the repo root regardless of where the script is called from.
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

echo ""
echo "============================================"
echo " Local Translator — Setup"
echo "============================================"
echo ""

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
echo "[1/3] Checking prerequisites..."
echo ""

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: This script requires macOS."
  exit 1
fi
echo "  OK  macOS detected"

# Xcode check — needs the FULL Xcode app, not just Command Line Tools.
# xcodebuild is the test: it only works when the full Xcode app is installed.
echo "      Checking for Xcode app..."
XCODE_CHECK=$(xcodebuild -version 2>&1 || true)
if echo "$XCODE_CHECK" | grep -q "requires Xcode"; then
  echo ""
  echo "ERROR: Xcode Command Line Tools are installed, but the full Xcode app is not."
  echo "       Download Xcode from the Mac App Store (it is free):"
  echo "       https://apps.apple.com/app/xcode/id497799835"
  echo ""
  echo "       After installing Xcode, run this script again."
  exit 1
fi
if ! echo "$XCODE_CHECK" | grep -q "^Xcode"; then
  echo ""
  echo "ERROR: Xcode not found. Output from xcodebuild:"
  echo "       $XCODE_CHECK"
  echo ""
  echo "       Download Xcode from the Mac App Store (it is free):"
  echo "       https://apps.apple.com/app/xcode/id497799835"
  exit 1
fi
XCODE_VERSION=$(echo "$XCODE_CHECK" | head -1 | sed 's/Xcode //')
echo "  OK  Xcode $XCODE_VERSION"

# curl check
if ! command -v curl > /dev/null 2>&1; then
  echo ""
  echo "ERROR: curl is required but not found."
  exit 1
fi
echo "  OK  curl found"

echo ""
echo "All prerequisites met."

# ── 2. Download vendor files ──────────────────────────────────────────────────
echo ""
echo "============================================"
echo "[2/3] Downloading vendor files (~67 MB)"
echo "      This may take a few minutes..."
echo "============================================"
echo ""

"$REPO_ROOT/scripts/download-vendors.sh"

# ── 3. Open the Xcode project ─────────────────────────────────────────────────
echo ""
echo "============================================"
echo "[3/3] Opening Xcode project"
echo "============================================"
echo ""

PROJ="$REPO_ROOT/LocalTranslator.xcodeproj"

if [[ ! -d "$PROJ" ]]; then
  echo "ERROR: Xcode project not found at: $PROJ"
  echo "       Make sure you are running this from inside the cloned repository."
  exit 1
fi

echo "Opening $PROJ ..."
open "$PROJ"

echo ""
echo "============================================"
echo " Setup complete!"
echo "============================================"
echo ""
echo "Three more steps in Xcode:"
echo ""
echo "  1. Click your project name in the left panel"
echo "     -> Signing & Capabilities"
echo "     -> Set your Team (sign in with your Apple ID if needed)"
echo "     -> Do this for BOTH the LocalTranslator and LocalTranslator"
echo "        Extension targets"
echo ""
echo "  2. Press Command + R to build and run"
echo "     (The app will open and show instructions)"
echo ""
echo "  3. In Safari: Settings -> Extensions"
echo "     -> Turn on Local Translator"
echo "     -> Click the toolbar icon to start translating"
echo ""
echo "Note: Translation uses Apple's on-device Translation framework."
echo "On first use macOS may prompt you to download a language pack"
echo "(Japanese or Chinese, free from Apple). After that, fully offline."
echo ""
echo "============================================"
