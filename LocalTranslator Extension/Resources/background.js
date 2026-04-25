// background.js — service worker for Local Translator.
//
// Translation is handled natively by the Swift SafariWebExtensionHandler via
// Apple's Translation framework.  This worker routes TRANSLATE messages from
// content scripts to the native handler and re-broadcasts STATUS/PROGRESS
// messages to the popup.

import { translate, preWarm } from "./lib/translator.js";

const api = self.chrome ?? self.browser;

const DEFAULTS = {
  enabled   : false,
  sourceLang: "auto",
};

// Confirm SW started — popup reads this to verify the service worker is live.
api.storage.local.set({ lt_sw_started: Date.now() }).catch(() => {});

// ── Install / startup ────────────────────────────────────────────────────────

api.runtime.onInstalled.addListener(async () => {
  const existing = await api.storage.local.get(Object.keys(DEFAULTS));
  await api.storage.local.set({ ...DEFAULTS, ...existing });
  await api.storage.local.remove([
    "lt_inject_error", "lt_cs_injected", "lt_cs_url",
    "lt_modelStatus", "lt_vendor_diag",
  ]);
  preWarm();
});

// ── Tab lifecycle ────────────────────────────────────────────────────────────

api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const { enabled, sourceLang } = await api.storage.local.get(["enabled", "sourceLang"]);
  if (!enabled) return;
  try {
    await api.tabs.sendMessage(tabId, { type: "SET_ENABLED", enabled: true, sourceLang });
  } catch {
    // Content script not available (chrome://, PDF, etc.) — ignore.
  }
});

// ── Message routing ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TRANSLATE") {
    translate(msg.text, msg.lang)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep channel open for async response
  }

  if (msg?.type === "PROGRESS" || msg?.type === "STATUS") {
    api.runtime.sendMessage(msg).catch(() => {});
  }
});
