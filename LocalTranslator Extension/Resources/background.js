// background.js — service worker for Local Translator.

import { translate, preWarm } from "./lib/translator.js";

const api = self.chrome ?? self.browser;

const DEFAULTS = {
  enabled   : false,
  sourceLang: "auto",
};

// Write immediately at module-load time so the popup can confirm the SW
// actually started (static import of transformers.min.js succeeded).
api.storage.local.set({ lt_sw_started: Date.now() }).catch(() => {});

// ── Install / startup ────────────────────────────────────────────────────────

api.runtime.onInstalled.addListener(async () => {
  const existing = await api.storage.local.get(Object.keys(DEFAULTS));
  await api.storage.local.set({ ...DEFAULTS, ...existing });
  // Clear stale diagnostic keys and model status so the popup never shows
  // an error left over from a previous extension version.
  await api.storage.local.remove([
    "lt_inject_error", "lt_cs_injected", "lt_cs_url",
    "lt_modelStatus", "lt_vendor_diag",
  ]);
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
  if (msg?.type === "TRANSLATE") {
    translate(msg.text, msg.lang)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg?.type === "PROGRESS" || msg?.type === "STATUS") {
    api.runtime.sendMessage(msg).catch(() => {});
  }

  // Popup "Retry Pipeline Load" button — re-runs preWarm without a full reload.
  if (msg?.type === "RELOAD_PIPELINE") {
    api.storage.local.remove("lt_modelStatus").then(() => preWarm());
    sendResponse({ ok: true });
    return true;
  }
});
