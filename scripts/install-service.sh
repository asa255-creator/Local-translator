#!/usr/bin/env bash
# install-service.sh — install the translation server as a macOS background service.
#
# Run ONCE:
#   ./scripts/install-service.sh
#
# After that the server starts automatically on login. No terminal needed.
# To remove it:  ./scripts/uninstall-service.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.localtranslator.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="/tmp/local-translator.log"
ERRLOG="/tmp/local-translator-error.log"
HF="https://huggingface.co"
MODELS_DIR="$ROOT/LocalTranslator Extension/Resources/vendor/models"

echo ""
echo "========================================"
echo " Local Translator -- install service"
echo "========================================"
echo ""

# ── 1. Find node ──────────────────────────────────────────────────────────────
NODE_BIN="$(which node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: 'node' not found. Install Node.js from https://nodejs.org and re-run."
  exit 1
fi
echo "Using node: $NODE_BIN  ($(node --version))"

# ── 2. npm install ────────────────────────────────────────────────────────────
if [[ ! -d "$ROOT/node_modules/@xenova" ]]; then
  echo "Installing @xenova/transformers..."
  cd "$ROOT" && npm install --silent
  echo "  Done."
fi

# ── 3. Download missing tokenizer.json files ──────────────────────────────────
for model in "Xenova/opus-mt-ja-en" "Xenova/opus-mt-zh-en"; do
  tok="$MODELS_DIR/$model/tokenizer.json"
  if [[ ! -f "$tok" ]]; then
    echo "Downloading tokenizer.json for $model..."
    mkdir -p "$(dirname "$tok")"
    curl -fsSL "$HF/$model/resolve/main/tokenizer.json" -o "$tok"
    echo "  OK."
  fi
done

# ── 4. Write launchd plist ────────────────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/scripts/translation-server.mjs</string>
  </array>
  <key>WorkingDirectory</key>  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>StandardOutPath</key>   <string>$LOG</string>
  <key>StandardErrorPath</key> <string>$ERRLOG</string>
  <key>ThrottleInterval</key>  <integer>10</integer>
</dict>
</plist>
PLIST

# ── 5. Load the service ───────────────────────────────────────────────────────
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load   "$PLIST"

echo ""
echo "  Service installed at: $PLIST"
echo "  Logs: $LOG"
echo ""
echo "The translation server now runs automatically in the background."
echo "You never need to open a terminal for it again."
echo ""
echo "Waiting for model to warm up (~15 s on first run)..."
sleep 15
if curl -sf "http://127.0.0.1:7070/status" >/dev/null 2>&1; then
  echo "  Server is running."
else
  echo "  Server still loading — check logs: tail -f $LOG"
fi
echo ""
