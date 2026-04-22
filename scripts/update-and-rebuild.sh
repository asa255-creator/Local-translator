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
# Use Xcode's default DerivedData location — same as cmd+R — so there is
# never a second build path for Safari to register as a separate extension.
BUILD_DIR="$HOME/Library/Developer/Xcode/DerivedData"

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
  build \
  2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)" | tail -5

# ── 4. Remove Index.noindex copy ──────────────────────────────────────────────
echo "Removing indexer copy to prevent duplicate extension..."
while IFS= read -r stale; do
  rm -rf "$stale"
  echo "  Removed: $stale"
done < <(find "$BUILD_DIR" \
  -path "*/Index.noindex/Build/Products/*/$SCHEME.app" \
  -maxdepth 12 2>/dev/null | sort -u)

# ── 5. Find the real build (never Index.noindex) ──────────────────────────────
APP_PATH="$(find "$BUILD_DIR" -name "$SCHEME.app" -maxdepth 10 \
  2>/dev/null | grep -v "Index.noindex" | grep "$SCHEME" | head -1)"

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
