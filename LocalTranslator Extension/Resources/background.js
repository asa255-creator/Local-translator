// background.js — service worker for Local Translator.

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
  preWarm();
});

// ── Content script injection ─────────────────────────────────────────────────
// Safari's manifest-based content_scripts injection is unreliable for
// locally-built extensions. We inject programmatically on every tab load so
// we control the timing and get real error reporting if it fails.

const CS_FILES = [
  "lib/bubble-detector.js",
  "lib/ocr.js",
  "lib/overlay.js",
  "content.js",
];

async function injectContentScripts(tabId) {
  try {
    await api.scripting.executeScript({ target: { tabId }, files: CS_FILES });
    await api.scripting.insertCSS({ target: { tabId }, files: ["overlay.css"] });
  } catch (err) {
    // Normal for chrome://, PDF, extension pages, etc. Log real errors.
    if (!String(err).includes("Cannot access") && !String(err).includes("chrome://")) {
      console.warn("[LT] Content script injection failed:", err);
      await api.storage.local.set({ lt_inject_error: String(err) });
    }
  }
}

// ── Tab lifecycle ────────────────────────────────────────────────────────────

api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  // Inject content scripts into every completed tab. The content script guards
  // against double-injection with window._LT_CS.
  await injectContentScripts(tabId);

  // If extension is enabled, tell the (now-injected) content script to scan.
  const { enabled, sourceLang } = await api.storage.local.get(["enabled", "sourceLang"]);
  if (!enabled) return;
  try {
    await api.tabs.sendMessage(tabId, { type: "SET_ENABLED", enabled: true, sourceLang });
    await api.tabs.sendMessage(tabId, { type: "RESCAN" });
  } catch {
    // Content script didn't load (e.g. chrome://, PDF) — ignore.
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
});
