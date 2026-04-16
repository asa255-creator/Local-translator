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

# safari-web-extension-converter check
echo "      Checking for safari-web-extension-converter..."
if ! xcrun --find safari-web-extension-converter > /dev/null 2>&1; then
  echo ""
  echo "ERROR: safari-web-extension-converter not found."
  echo "       This tool ships with Xcode 12 and later."
  echo "       Make sure Xcode is up to date in the Mac App Store."
  exit 1
fi
echo "  OK  safari-web-extension-converter found"

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

# ── 3. Generate Xcode project ─────────────────────────────────────────────────
echo ""
echo "============================================"
echo "[3/3] Generating Xcode project"
echo "============================================"
echo ""

EXT_RESOURCES="$REPO_ROOT/LocalTranslator Extension/Resources"

if [[ ! -f "$EXT_RESOURCES/manifest.json" ]]; then
  echo "ERROR: Extension resources not found at: $EXT_RESOURCES"
  echo "       Make sure you are running this from inside the cloned repository."
  exit 1
fi

echo "Running safari-web-extension-converter..."
xcrun safari-web-extension-converter \
  "$EXT_RESOURCES" \
  --project-location "$REPO_ROOT" \
  --app-name "LocalTranslator" \
  --bundle-identifier "com.example.LocalTranslator" \
  --swift \
  --macos-only \
  --force

# Find the generated .xcodeproj
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
  PROJ="$(find "$REPO_ROOT" -maxdepth 2 -name "*.xcodeproj" 2>/dev/null | head -1)"
fi

if [[ -z "$PROJ" ]]; then
  echo ""
  echo "ERROR: safari-web-extension-converter did not create a .xcodeproj."
  echo "       Check the output above for error details."
  exit 1
fi

echo ""
echo "Xcode project created: $PROJ"
echo ""
echo "Opening Xcode..."
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
echo ""
echo "  2. Press Command + R to build and run"
echo "     (The app will open and show instructions)"
echo ""
echo "  3. In Safari: Settings -> Extensions"
echo "     -> Turn on Local Translator"
echo "     -> Click the toolbar icon to start translating"
echo ""
echo "Note: On first use, the translation model (~170 MB) downloads"
echo "once from Hugging Face. After that, everything is offline."
echo ""
echo "============================================"
