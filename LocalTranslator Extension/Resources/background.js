// background.js — service worker for Local Translator.
//
// Responsibilities:
//   1. Persists extension state (enabled / sourceLang) across sessions.
//   2. Re-triggers scanning on tab load when extension is enabled.
//   3. Owns translation: content scripts send {type:"TRANSLATE"} messages here.
//      Translation runs via Transformers.js + Helsinki-NLP opus-mt models.
//      Model weights are cached in the extension's own Cache Storage (shared
//      across ALL tabs — download happens exactly once).
//   4. Pre-warms the Japanese translation pipeline on first install so the
//      very first user-visible translation is fast.
//
// Network policy: this service worker is governed by extension_pages CSP.
//   connect-src allows cdn.jsdelivr.net (ONNX WASM) and huggingface.co
//   (model weights). Both are only fetched on first-ever use; after that
//   reads come from extension Cache Storage.

import { translate, preWarm } from "./lib/translator.js";

const api = self.chrome ?? self.browser;

const DEFAULTS = {
  enabled   : false,
  sourceLang: "auto",
};

// ── Install / startup ────────────────────────────────────────────────────────

api.runtime.onInstalled.addListener(async () => {
  const existing = await api.storage.local.get(Object.keys(DEFAULTS));
  await api.storage.local.set({ ...DEFAULTS, ...existing });
  // Kick off model pre-warm in the background. If vendor file is missing this
  // fails silently — the user will see the error on first translation attempt.
  preWarm();
});

// ── Tab lifecycle ────────────────────────────────────────────────────────────

api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const { enabled, sourceLang } = await api.storage.local.get([
    "enabled",
    "sourceLang",
  ]);
  if (!enabled) return;
  try {
    await api.tabs.sendMessage(tabId, { type: "SET_ENABLED", enabled: true, sourceLang });
    await api.tabs.sendMessage(tabId, { type: "RESCAN" });
  } catch {
    // Content script not available (chrome://, PDF, etc.) — ignore.
  }
});

// ── Message routing ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // ── Translation request from content script ──────────────────────────────
  // Content scripts OCR the image and send the raw Japanese/Chinese text here.
  // We run it through the offline neural translation pipeline and return the
  // English result. Model weights live in extension Cache Storage so the cost
  // of re-loading after a service-worker restart is a few seconds, not a
  // network request.
  if (msg?.type === "TRANSLATE") {
    translate(msg.text, msg.lang)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep channel open for async response
  }

  // ── Progress / status relay to popup ────────────────────────────────────
  // Content scripts send PROGRESS / STATUS updates. Rebroadcast so the popup
  // can display them even though it can't receive tab messages directly.
  if (msg?.type === "PROGRESS" || msg?.type === "STATUS" || msg?.type === "DEV_LOG") {
    api.runtime.sendMessage(msg).catch(() => {});
    // no sendResponse needed
  }
});
