// background.js — service worker for Local Translator.
// Keeps global state in sync and forwards messages between popup and tabs.
// No fetch() calls are made. Network access is not used.

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  enabled: false,
  sourceLang: "auto",
};

api.runtime.onInstalled.addListener(async () => {
  const existing = await api.storage.local.get(Object.keys(DEFAULTS));
  const merged = { ...DEFAULTS, ...existing };
  await api.storage.local.set(merged);
});

// Forward tab events so newly-loaded pages can get the current state.
api.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const { enabled, sourceLang } = await api.storage.local.get([
    "enabled",
    "sourceLang",
  ]);
  if (!enabled) return;
  try {
    await api.tabs.sendMessage(tabId, {
      type: "SET_ENABLED",
      enabled: true,
      sourceLang,
    });
    await api.tabs.sendMessage(tabId, { type: "RESCAN" });
  } catch {
    // Content script not available on this page; ignore.
  }
});

// Relay progress messages from content scripts to the open popup (if any).
api.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "PROGRESS" || msg?.type === "STATUS") {
    // The popup listens on runtime.onMessage; broadcast lets it pick up.
    api.runtime.sendMessage(msg).catch(() => {});
  }
});
