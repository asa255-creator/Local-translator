#!/usr/bin/env bash
# fix-extension-duplicate.sh — remove the duplicate "Local Translator" entry
# from Safari WITHOUT quitting Safari.
#
# Run this whenever you see two Local Translator entries:
#   ./scripts/fix-extension-duplicate.sh

set -euo pipefail

SCHEME="LocalTranslator"

echo ""
echo "Fixing duplicate Safari extension..."
echo ""

# 1. Kill all running instances of the app.
#    When the app exits, Safari deregisters its extension automatically.
if killall "$SCHEME" 2>/dev/null; then
  echo "  Stopped running $SCHEME instances."
else
  echo "  (no running instances found)"
fi
sleep 1

# 2. Delete every Index.noindex copy across all DerivedData folders.
#    These are the source of the duplicate — Xcode creates them for indexing
#    and Safari mistakenly registers them as a second extension.
FOUND=0
while IFS= read -r stale; do
  rm -rf "$stale"
  echo "  Removed stale copy: $stale"
  FOUND=1
done < <(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -path "*/Index.noindex/Build/Products/*/$SCHEME.app" \
  -maxdepth 12 2>/dev/null | sort -u)

if [[ $FOUND -eq 0 ]]; then
  echo "  No stale Index.noindex copies found."
fi

# 3. Relaunch from the correct (non-Index.noindex) build.
#    This registers exactly one extension.
REAL="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -name "$SCHEME.app" \
  -not -path "*/Index.noindex/*" \
  -maxdepth 12 2>/dev/null | head -1)"

if [[ -n "$REAL" ]]; then
  open "$REAL"
  echo "  Relaunched from: $REAL"
  echo ""
  echo "Done. Safari now shows only one Local Translator extension."
  echo "You do NOT need to quit or restart Safari."
else
  echo ""
  echo "No built app found. Run ./scripts/update-and-rebuild.sh first,"
  echo "then run this script again."
  exit 1
fi
echo ""
