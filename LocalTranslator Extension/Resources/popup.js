// popup.js — UI controller for the Local Translator extension popup.
// Communicates with the background service worker and the active tab's
// content script. All messages stay local; no network calls are made.

const api = typeof browser !== "undefined" ? browser : chrome;

const toggleEl     = document.getElementById("enabled-toggle");
const hintEl       = document.getElementById("toggle-hint");
const langEl       = document.getElementById("source-lang");
const rescanBtn    = document.getElementById("rescan-btn");
const clearBtn     = document.getElementById("clear-btn");
const statusEl     = document.getElementById("status-text");
const progressWrap = document.getElementById("progress");
const progressBar  = document.getElementById("progress-bar");

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

// Inject content scripts into the active tab. Called from user-action handlers
// so the popup's activeTab permission context is active. The IIFE guards in
// each script prevent double-execution if the manifest already injected them.
async function injectContentScripts(tabId) {
  try {
    await api.scripting.executeScript({
      target: { tabId },
      files: ["lib/bubble-detector.js", "lib/ocr.js", "lib/overlay.js", "content.js"],
    });
    await api.scripting.insertCSS({ target: { tabId }, files: ["overlay.css"] });
  } catch (err) {
    // Log but don't surface to user — manifest injection may have already worked.
    console.warn("[LT] popup inject:", err.message);
  }
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab?.id) return null;
  try {
    return await api.tabs.sendMessage(tab.id, message);
  } catch (err) {
    console.warn("sendToContent failed:", err);
    return null;
  }
}

toggleEl.addEventListener("change", async () => {
  const enabled = toggleEl.checked;
  hintEl.textContent = enabled ? "On" : "Off";
  await api.storage.local.set({ enabled });
  const tab = await getActiveTab();
  if (tab?.id) await injectContentScripts(tab.id);
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
  const tab = await getActiveTab();
  if (tab?.id) await injectContentScripts(tab.id);
  await sendToContent({ type: "RESCAN" });
});

clearBtn.addEventListener("click", async () => {
  await sendToContent({ type: "CLEAR_OVERLAYS" });
  statusEl.textContent = "Overlays removed.";
});

// ── Message listener (progress, status, dev log) ─────────────────────────────
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
const mtDot     = document.getElementById("mt-dot");
const mtStatus  = document.getElementById("mt-status");
const mtBarWrap = document.getElementById("mt-bar-wrap");
const mtBar     = document.getElementById("mt-bar");

const PHASE_DOT = {
  idle    : "",
  loading : "dot-loading",
  ready   : "dot-ok",
  error   : "dot-error",
};

function applyModelStatus(s) {
  if (!s) return;
  mtDot.className = "dot " + (PHASE_DOT[s.phase] ?? "");
  mtStatus.textContent = s.label ?? s.phase;
  mtBarWrap.classList.add("hidden");
}

// Ping the server directly from the popup for a live status check.
async function checkServerNow() {
  try {
    const resp = await fetch("http://127.0.0.1:7070/status", {
      signal: AbortSignal.timeout(2000),
    });
    const { models = [] } = await resp.json();
    const warm = models.some((m) => m.includes("ja"));
    applyModelStatus({
      phase: "ready",
      label: warm ? "Server ready · model warm" : "Server running · model loading…",
    });
  } catch {
    applyModelStatus({
      phase: "error",
      label: "Server offline — run: ./scripts/start-server.sh",
    });
  }
}

async function loadModelStatus() {
  // Show stored status immediately, then refresh with a live ping.
  const { lt_modelStatus: s } = await api.storage.local.get("lt_modelStatus");
  if (s) applyModelStatus(s);
  checkServerNow();
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lt_modelStatus) {
    applyModelStatus(changes.lt_modelStatus.newValue);
  }
  if (changes.lt_cs_injected || changes.lt_inject_error) {
    renderCsStatus(
      changes.lt_cs_injected?.newValue,
      changes.lt_cs_url?.newValue,
      changes.lt_inject_error?.newValue
    );
  }
  if (changes.lt_vendor_diag) {
    renderVendorDiag(changes.lt_vendor_diag.newValue);
  }
  if (changes.lt_sw_started) {
    renderSwStatus(changes.lt_sw_started.newValue);
  }
  if (changes.lt_devLog) {
    const entries = changes.lt_devLog.newValue ?? [];
    if (entries.length < _lastLogLen) {
      // Log was cleared (new scan started) — reset display.
      devLogEl.innerHTML = "";
      _lastLogLen = 0;
    }
    renderDevEntries(entries);
  }
});

// ── Developer log ────────────────────────────────────────────────────────────
// Entries are written to chrome.storage.local by the content script, then
// read here via storage.onChanged — no fragile message relay needed.

const devToggle = document.getElementById("dev-toggle");
const devPanel  = document.getElementById("dev-panel");
const devLogEl  = document.getElementById("dev-log");
const devClear  = document.getElementById("dev-clear-btn");

const KIND_CLASS = {
  scan : "dev-entry-scan",
  ok   : "dev-entry-ok",
  skip : "dev-entry-skip",
  ocr  : "dev-entry-ocr",
  xlat : "dev-entry-xlat",
  err  : "dev-entry-err",
};

let _lastLogLen = 0; // how many entries we've already rendered

function renderDevEntries(entries) {
  if (!devToggle.checked) return;
  const newEntries = entries.slice(_lastLogLen);
  _lastLogLen = entries.length;
  for (const { entry, kind } of newEntries) {
    const line = document.createElement("div");
    line.textContent = entry;
    if (kind && KIND_CLASS[kind]) line.className = KIND_CLASS[kind];
    devLogEl.appendChild(line);
  }
  if (newEntries.length > 0) devLogEl.scrollTop = devLogEl.scrollHeight;
}

const devCsStatusEl    = document.getElementById("dev-cs-status");
const devVendorDiagEl  = document.getElementById("dev-vendor-diag");
const devReloadBtn     = document.getElementById("dev-reload-btn");
const devRestartBtn    = document.getElementById("dev-restart-btn");

function renderVendorDiag(msg) {
  if (!devVendorDiagEl) return;
  if (msg) {
    devVendorDiagEl.textContent = `Vendor diag: ${msg}`;
    devVendorDiagEl.classList.remove("hidden");
    devVendorDiagEl.style.color = "#f87171";
  } else {
    devVendorDiagEl.classList.add("hidden");
  }
}

function renderCsStatus(injectedAt, url, injectErr) {
  if (!devCsStatusEl) return;
  if (injectErr) {
    devCsStatusEl.textContent = `Inject error: ${injectErr}`;
    devCsStatusEl.style.color = "#f87171";
  } else if (injectedAt) {
    const ago = Math.round((Date.now() - injectedAt) / 1000);
    devCsStatusEl.textContent = `Content script: injected ${ago}s ago on ${url ?? "?"}`;
    devCsStatusEl.style.color = "#4ade80";
  } else {
    devCsStatusEl.textContent = "Content script: NOT yet detected — reload the page";
    devCsStatusEl.style.color = "#f87171";
  }
}

function renderSwStatus(swStartedAt) {
  const el = document.getElementById("dev-sw-status");
  if (!el) return;
  if (swStartedAt) {
    const ago = Math.round((Date.now() - swStartedAt) / 1000);
    el.textContent = `Service worker: running (started ${ago}s ago)`;
    el.style.color = "#4ade80";
  } else {
    el.textContent = "Service worker: NOT running — static import of transformers.min.js may have failed";
    el.style.color = "#f87171";
  }
}

async function loadDevMode() {
  const {
    devMode = false,
    lt_devLog: entries = [],
    lt_cs_injected: injectedAt,
    lt_cs_url: csUrl,
    lt_inject_error: injectErr,
    lt_vendor_diag: vendorDiag,
    lt_sw_started: swStartedAt,
  } = await api.storage.local.get([
    "devMode",
    "lt_devLog",
    "lt_cs_injected",
    "lt_cs_url",
    "lt_inject_error",
    "lt_vendor_diag",
    "lt_sw_started",
  ]);
  devToggle.checked = devMode;
  devPanel.classList.toggle("hidden", !devMode);
  renderCsStatus(injectedAt, csUrl, injectErr);
  renderVendorDiag(vendorDiag);
  renderSwStatus(swStartedAt);
  // Show entries from any scan that already ran (e.g. popup opened mid-scan).
  _lastLogLen = 0;
  renderDevEntries(entries);
}

devToggle.addEventListener("change", async () => {
  const devMode = devToggle.checked;
  await api.storage.local.set({ devMode });
  devPanel.classList.toggle("hidden", !devMode);
  if (devMode) {
    // Render any existing entries that arrived while panel was closed.
    _lastLogLen = 0;
    const { lt_devLog: entries = [] } = await api.storage.local.get("lt_devLog");
    renderDevEntries(entries);
  }
});

devClear.addEventListener("click", () => {
  devLogEl.innerHTML = "";
  _lastLogLen = 0;
  api.storage.local.set({ lt_devLog: [] });
});

// ── Dev buttons ──────────────────────────────────────────────────────────────

// Tells the background service worker to clear its pipeline cache and
// re-run preWarm(). This is the Safari-compatible alternative to
// runtime.reload() (which is not supported in Safari).
devReloadBtn?.addEventListener("click", async () => {
  const btn = devReloadBtn;
  btn.textContent = "Retrying…";
  btn.disabled = true;
  try {
    await api.runtime.sendMessage({ type: "RELOAD_PIPELINE" });
    statusEl.textContent = "Pipeline reload triggered.";
  } catch (err) {
    statusEl.textContent = `Reload failed: ${err.message}`;
  }
  setTimeout(() => { btn.textContent = "Retry Pipeline Load"; btn.disabled = false; }, 2000);
});

// Soft-restart: toggle translation off then on in the active tab, then rescan.
// Useful for forcing content-script re-initialization without a full reload.
devRestartBtn?.addEventListener("click", async () => {
  statusEl.textContent = "Restarting…";
  const tab = await getActiveTab();

  // Turn off
  await api.storage.local.set({ enabled: false });
  if (tab?.id) {
    try { await api.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled: false }); } catch (_) {}
  }

  await new Promise((r) => setTimeout(r, 300));

  // Turn on
  await api.storage.local.set({ enabled: true });
  toggleEl.checked = true;
  hintEl.textContent = "On";
  if (tab?.id) {
    await injectContentScripts(tab.id);
    try { await api.tabs.sendMessage(tab.id, { type: "SET_ENABLED", enabled: true }); } catch (_) {}
    try { await api.tabs.sendMessage(tab.id, { type: "RESCAN" }); } catch (_) {}
  }
  statusEl.textContent = "Restarted. Scanning…";
});

// ── Init ─────────────────────────────────────────────────────────────────────
loadState();
loadModelStatus();
loadDevMode();
