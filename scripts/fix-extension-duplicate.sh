#!/usr/bin/env bash
# fix-extension-duplicate.sh — remove the duplicate "Local Translator" entry
# from Safari WITHOUT quitting Safari.
#
# Run this whenever you see two Local Translator entries:
#   ./scripts/fix-extension-duplicate.sh

set -euo pipefail

SCHEME="LocalTranslator"
BUNDLE_ID="com.example.LocalTranslator.Extension"

echo ""
echo "Fixing duplicate Safari extension..."
echo ""

# 1. Force-remove all plugin registrations for this bundle ID.
#    This clears zombie entries that persist even after the .app is deleted.
echo "Removing plugin registrations..."
pluginkit -r -i "$BUNDLE_ID" 2>/dev/null && echo "  Removed: $BUNDLE_ID" || echo "  (pluginkit found none)"
sleep 1

# 2. Kill all running instances of the app.
#    When the app exits Safari deregisters its extension.
if killall "$SCHEME" 2>/dev/null; then
  echo "  Stopped running $SCHEME instances."
else
  echo "  (no running instances found)"
fi
sleep 2

# 3. Delete every Index.noindex copy across all DerivedData folders.
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

# 4. Relaunch from the correct (non-Index.noindex) build.
REAL="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -name "$SCHEME.app" \
  -not -path "*/Index.noindex/*" \
  -maxdepth 12 2>/dev/null | head -1)"

if [[ -n "$REAL" ]]; then
  open "$REAL"
  echo "  Relaunched from: $REAL"
  echo ""
  echo "Done. Check Safari Settings -> Extensions."
  echo "If still two entries: quit Safari once (cmd+Q), reopen it, done."
else
  echo ""
  echo "No built app found. Run ./scripts/update-and-rebuild.sh first,"
  echo "then run this script again."
  exit 1
fi
echo ""
