// popup.js — UI controller for the Local Translator extension popup.
// Communicates with the background service worker and the active tab's
// content script. All messages stay local; no network calls are made.

const api = typeof browser !== "undefined" ? browser : chrome;

const toggleEl = document.getElementById("enabled-toggle");
const hintEl = document.getElementById("toggle-hint");
const langEl = document.getElementById("source-lang");
const rescanBtn = document.getElementById("rescan-btn");
const clearBtn = document.getElementById("clear-btn");
const statusEl = document.getElementById("status-text");
const progressWrap = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");

async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadState() {
  const { enabled = false, sourceLang = "auto" } = await api.storage.local.get([
    "enabled",
    "sourceLang",
  ]);
  toggleEl.checked = enabled;
  langEl.value = sourceLang;
  hintEl.textContent = enabled ? "On" : "Off";
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await api.tabs.sendMessage(tab.id, message);
  } catch (err) {
    // Content script may not be injected yet (e.g. chrome:// pages).
    console.warn("sendToContent failed:", err);
    return null;
  }
}

toggleEl.addEventListener("change", async () => {
  const enabled = toggleEl.checked;
  hintEl.textContent = enabled ? "On" : "Off";
  await api.storage.local.set({ enabled });
  await sendToContent({ type: "SET_ENABLED", enabled });
  if (enabled) {
    statusEl.textContent = "Scanning page…";
    await sendToContent({ type: "RESCAN" });
  } else {
    statusEl.textContent = "Overlays removed.";
    await sendToContent({ type: "CLEAR_OVERLAYS" });
  }
});

langEl.addEventListener("change", async () => {
  await api.storage.local.set({ sourceLang: langEl.value });
  await sendToContent({ type: "SET_SOURCE_LANG", sourceLang: langEl.value });
});

rescanBtn.addEventListener("click", async () => {
  statusEl.textContent = "Rescanning…";
  await sendToContent({ type: "RESCAN" });
});

clearBtn.addEventListener("click", async () => {
  await sendToContent({ type: "CLEAR_OVERLAYS" });
  statusEl.textContent = "Overlays removed.";
});

// Progress updates from content script.
api.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "PROGRESS") {
    const { current, total, label } = msg;
    progressWrap.classList.remove("hidden");
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    statusEl.textContent = label ?? `Processing ${current}/${total}…`;
    if (current >= total) {
      setTimeout(() => progressWrap.classList.add("hidden"), 600);
    }
  } else if (msg?.type === "STATUS") {
    statusEl.textContent = msg.text;
  }
});

loadState();
