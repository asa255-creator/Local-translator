#!/usr/bin/env bash
# verify-offline.sh — enforce the network boundary.
#
# Rules:
#   1. CDN / network URLs are ONLY allowed in these files:
#        lib/model-manager.js   — defines CDN constants (no fetch calls here)
#        lib/translator.js      — imports vendor file; ONNX + HF URLs used
#                                 by Transformers.js internals
#        scripts/download-vendors.sh — the setup download script
#        vendor/README.md        — documentation
#   2. All other source files must be free of http(s):// references
#      (excluding Apple/W3C plist DTDs, localhost, and code comments).
#
# Usage: ./scripts/verify-offline.sh
# Exit 1 if any violation is found.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/LocalTranslator Extension/Resources"

ALLOWED_FILES=(
  "lib/model-manager.js"
  "lib/translator.js"
  "manifest.json"          # CSP string lists the allowed connect-src domains
)

echo "Scanning extension source for unexpected network URL references…"
FAIL=0

while IFS= read -r -d '' file; do
  # Get path relative to EXT_DIR
  rel="${file#$EXT_DIR/}"

  # Check if this file is in the allowed list
  allowed=0
  for a in "${ALLOWED_FILES[@]}"; do
    if [[ "$rel" == "$a" ]]; then allowed=1; break; fi
  done
  if [[ $allowed -eq 1 ]]; then continue; fi

  # Find lines with http(s):// not in comments and not in Apple/W3C DTDs
  hits=$(grep -nE "https?://" "$file" \
    | grep -vE "apple\.com/DTDs|w3\.org|127\.0\.0\.1|localhost|example\.com" \
    | grep -vE "^\s*[0-9]+:\s*(//|\*)" \
    || true)

  if [[ -n "$hits" ]]; then
    echo ""
    echo "VIOLATION in $rel:"
    echo "$hits"
    FAIL=1
  fi
done < <(find "$EXT_DIR" -type f \( -name "*.js" -o -name "*.html" -o -name "*.json" -o -name "*.css" \) -print0)

# Also check Swift files
while IFS= read -r -d '' file; do
  rel="${file#$ROOT/}"
  hits=$(grep -nE "https?://" "$file" \
    | grep -vE "apple\.com|example\.com|localhost" \
    | grep -vE "^\s*[0-9]+:\s*//" \
    || true)
  if [[ -n "$hits" ]]; then
    echo ""
    echo "VIOLATION in $rel:"
    echo "$hits"
    FAIL=1
  fi
done < <(find "$ROOT/LocalTranslator" -type f -name "*.swift" -print0 2>/dev/null || true)
find "$ROOT/LocalTranslator Extension" -type f -name "*.swift" -print0 2>/dev/null \
  | while IFS= read -r -d '' file; do
    rel="${file#$ROOT/}"
    hits=$(grep -nE "https?://" "$file" \
      | grep -vE "apple\.com|example\.com|localhost" \
      | grep -vE "^\s*[0-9]+:\s*//" \
      || true)
    if [[ -n "$hits" ]]; then
      echo ""
      echo "VIOLATION in $rel:"
      echo "$hits"
      FAIL=1
    fi
  done

if [[ $FAIL -eq 1 ]]; then
  echo ""
  echo "FAIL: unexpected outbound URL found."
  echo "Network access is only permitted in lib/model-manager.js and lib/translator.js."
  exit 1
fi

echo "OK: no unexpected outbound URLs found."
