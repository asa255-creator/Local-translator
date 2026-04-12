#!/usr/bin/env bash
# Verify the extension bundle makes no network references.
# Fails (exit 1) if any non-allowlisted http(s) URL is found in the
# extension source tree. Run from repo root: ./scripts/verify-offline.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT_DIR="$ROOT/LocalTranslator Extension/Resources"

# URLs we tolerate in comments/docs: Apple/W3C DTDs in plist headers,
# local loopback, and example.com in code comments.
ALLOW='apple\.com/DTDs|w3\.org|127\.0\.0\.1|localhost|example\.com'

echo "Scanning $EXT_DIR for network URLs..."
if grep -rnE "https?://" "$EXT_DIR" \
    | grep -vE "$ALLOW" \
    | grep -vE '^\s*\*|^\s*//'; then
  echo
  echo "FAIL: found outbound URL references. Local Translator must be fully offline."
  exit 1
fi

echo "OK: no outbound URLs detected."
