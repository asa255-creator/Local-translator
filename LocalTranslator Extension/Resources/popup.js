// popup.js — UI controller for the Local Translator extension popup.
// Communicates with the background service worker and the active tab's
// content script. All messages stay local; no network calls are made.
// Model download status is read from chrome.storage.local (written by
// background/translator.js) and reflected live via storage.onChanged.

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

// ── Page-processing progress (from content script via background relay) ──────
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

// ── Model download / status display ─────────────────────────────────────────
const mtDot    = document.getElementById("mt-dot");
const mtStatus = document.getElementById("mt-status");
const mtBarWrap = document.getElementById("mt-bar-wrap");
const mtBar    = document.getElementById("mt-bar");

const PHASE_DOT = {
  idle        : "",
  downloading : "dot-downloading",
  loading     : "dot-loading",
  ready       : "dot-ok",
  error       : "dot-error",
};
const PHASE_LABEL = {
  idle        : "Not yet downloaded",
  ready       : "Ready · offline",
};

function applyModelStatus(s) {
  if (!s) return;
  // Update indicator dot
  mtDot.className = "dot " + (PHASE_DOT[s.phase] ?? "");
  // Update label
  mtStatus.textContent = PHASE_LABEL[s.phase] ?? s.label ?? s.phase;
  // Show/hide progress bar
  if (s.phase === "downloading" && s.pct != null) {
    mtBarWrap.classList.remove("hidden");
    mtBar.style.width = s.pct + "%";
  } else {
    mtBarWrap.classList.add("hidden");
  }
}

async function loadModelStatus() {
  const { lt_modelStatus: s } = await api.storage.local.get("lt_modelStatus");
  applyModelStatus(s);
}

// Live updates while popup is open (e.g. during initial model download).
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.lt_modelStatus) {
    applyModelStatus(changes.lt_modelStatus.newValue);
  }
});

loadState();
loadModelStatus();
