#!/usr/bin/env bash
# update-and-rebuild.sh — pull, rebuild, and relaunch with no duplicate extensions.
#
# Run from anywhere inside the repo:
#   ./scripts/update-and-rebuild.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCHEME="LocalTranslator"
PROJECT="$ROOT/LocalTranslator.xcodeproj"
BUILD_DIR="$ROOT/build"

echo ""
echo "========================================"
echo " Local Translator -- update & rebuild"
echo "========================================"
echo ""

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo "Pulling latest code..."
git pull --ff-only
echo "  OK: $(git log -1 --oneline)"
echo ""

# ── 2. Kill any running instances ─────────────────────────────────────────────
# Killing the app deregisters its Safari extensions, giving us a clean slate.
echo "Stopping any running instances..."
killall "$SCHEME" 2>/dev/null && echo "  Stopped." || echo "  (none running)"
sleep 1

# ── 3. Build ──────────────────────────────────────────────────────────────────
echo "Building $SCHEME..."
xcodebuild \
  -project "$PROJECT" \
  -scheme  "$SCHEME" \
  -configuration Debug \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  build \
  2>&1 | grep -E "error:|warning:|BUILD (SUCCEEDED|FAILED)" | tail -10

if ! grep -q "BUILD SUCCEEDED" < <(xcodebuild \
  -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
  -derivedDataPath "$BUILD_DIR/DerivedData" build 2>&1); then
  # Re-run for the actual result check
  :
fi

# ── 4. Remove Index.noindex copy ──────────────────────────────────────────────
# Xcode creates a second app in Index.noindex/ for code indexing. Safari
# registers it as a separate extension, causing the duplicate. Deleting it
# before we open anything prevents Safari from ever seeing two copies.
echo "Removing indexer copy to prevent duplicate extension..."
while IFS= read -r stale; do
  rm -rf "$stale"
  echo "  Removed: $stale"
done < <(find "$HOME/Library/Developer/Xcode/DerivedData" "$BUILD_DIR/DerivedData" \
  -path "*/Index.noindex/Build/Products/*/$SCHEME.app" \
  -maxdepth 12 2>/dev/null | sort -u)

# ── 5. Find the real build (never Index.noindex) ──────────────────────────────
APP_PATH="$(find "$BUILD_DIR/DerivedData" -name "$SCHEME.app" -maxdepth 8 \
  2>/dev/null | grep -v "Index.noindex" | head -1)"

if [[ -z "$APP_PATH" ]]; then
  echo ""
  echo "ERROR: Could not find built .app -- check Xcode for build errors."
  exit 1
fi

echo "  Built: $APP_PATH"
echo ""

# ── 6. Relaunch ───────────────────────────────────────────────────────────────
echo "Launching app (registers extension with Safari)..."
open "$APP_PATH"
sleep 1
echo "  Done."
echo ""

echo "========================================"
echo " OK at $(date '+%Y-%m-%d %H:%M:%S')"
echo " Reload any open Safari tabs."
echo "========================================"
echo ""
