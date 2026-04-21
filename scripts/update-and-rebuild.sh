#!/usr/bin/env bash
# update-and-rebuild.sh — pull latest code, rebuild the extension, relaunch Safari.
#
# Run from anywhere inside the repo:
#   ./scripts/update-and-rebuild.sh
#
# What it does:
#   1. git pull (fast-forward only — won't clobber local changes)
#   2. xcodebuild (debug build, same as ⌘R in Xcode)
#   3. Opens the built .app so Safari picks up the new extension
#   4. Prints a timestamped confirmation

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCHEME="LocalTranslator"
PROJECT="$ROOT/LocalTranslator.xcodeproj"
BUILD_DIR="$ROOT/build"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Local Translator — update & rebuild"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo "▶ Pulling latest code…"
git pull --ff-only
echo "  ✓ Up to date: $(git log -1 --oneline)"
echo ""

# ── 2. Build ──────────────────────────────────────────────────────────────────
echo "▶ Building $SCHEME (this takes ~15 s)…"
xcodebuild \
  -project "$PROJECT" \
  -scheme  "$SCHEME" \
  -configuration Debug \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  build \
  | tail -5   # suppress the wall of build output; show last 5 lines only

APP_PATH="$(find "$BUILD_DIR/DerivedData" -name "$SCHEME.app" -maxdepth 6 | head -1)"

if [[ -z "$APP_PATH" ]]; then
  echo ""
  echo "✗ Could not find built .app — check Xcode for build errors."
  exit 1
fi

echo "  ✓ Built: $APP_PATH"
echo ""

# ── 3. Relaunch wrapper app ───────────────────────────────────────────────────
echo "▶ Launching app (registers new extension with Safari)…"
open "$APP_PATH"
echo "  ✓ App launched"
echo ""

# ── 4. Done ───────────────────────────────────────────────────────────────────
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ Done at $TIMESTAMP"
echo " Reload any open Safari tabs to pick up"
echo " the new extension."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
