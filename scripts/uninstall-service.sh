#!/usr/bin/env bash
# uninstall-service.sh — remove the background translation service.

set -euo pipefail

LABEL="com.localtranslator.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Service removed. The translation server will no longer start automatically."
else
  echo "Service not installed (plist not found)."
fi
