const api = typeof browser !== "undefined" ? browser : chrome;

const langEl    = document.getElementById("source-lang");
const pickBtn   = document.getElementById("pick-btn");
const clearBtn  = document.getElementById("clear-btn");
const devLogEl  = document.getElementById("dev-log");
const devClear  = document.getElementById("dev-clear-btn");

async function getActiveTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(msg) {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try { await api.tabs.sendMessage(tab.id, msg); } catch {}
}

// ── Language ──────────────────────────────────────────────────────────────────

async function loadLang() {
  const { sourceLang = "auto" } = await api.storage.local.get("sourceLang");
  langEl.value = sourceLang;
}

langEl.addEventListener("change", () => {
  api.storage.local.set({ sourceLang: langEl.value });
});

// ── Buttons ───────────────────────────────────────────────────────────────────

// Holds the in-flight clear promise so Translate can wait for it to finish.
let _clearPromise = null;

pickBtn.addEventListener("click", async () => {
  // If the user just clicked Clear, wait for it to fully complete before
  // sending ENTER_PICK_MODE — otherwise the flush inside ENTER_PICK_MODE
  // can race with CLEAR_LOG and write old entries back to storage.
  if (_clearPromise) await _clearPromise;

  await api.storage.local.set({ sourceLang: langEl.value });
  const tab = await getActiveTab();
  if (!tab?.id) {
    pickBtn.textContent = "No active page — navigate to a page first";
    return;
  }
  try {
    await api.tabs.sendMessage(tab.id, { type: "ENTER_PICK_MODE", sourceLang: langEl.value });
    pickBtn.textContent = "✓ Now click an image on the page";
    pickBtn.style.background = "#34c759";
    setTimeout(() => window.close(), 1000);
  } catch {
    pickBtn.textContent = "Reload the page and try again";
  }
});

clearBtn.addEventListener("click", async () => {
  await sendToContent({ type: "CLEAR_OVERLAYS" });
});

// ── Dev log ───────────────────────────────────────────────────────────────────

const KIND_CLASS = {
  scan: "dev-entry-scan",
  ok:   "dev-entry-ok",
  skip: "dev-entry-skip",
  ocr:  "dev-entry-ocr",
  xlat: "dev-entry-xlat",
  err:  "dev-entry-err",
};

let _lastLen = 0;

function renderEntries(entries) {
  const fresh = entries.slice(_lastLen);
  _lastLen = entries.length;
  for (const { entry, kind } of fresh) {
    const div = document.createElement("div");
    div.textContent = entry;
    if (KIND_CLASS[kind]) div.className = KIND_CLASS[kind];
    devLogEl.appendChild(div);
  }
  if (fresh.length) devLogEl.scrollTop = devLogEl.scrollHeight;
}

async function loadLog() {
  const { lt_devLog: entries = [] } = await api.storage.local.get("lt_devLog");
  _lastLen = 0;
  renderEntries(entries);
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.lt_devLog) return;
  const entries = changes.lt_devLog.newValue ?? [];
  if (entries.length < _lastLen) { devLogEl.innerHTML = ""; _lastLen = 0; }
  renderEntries(entries);
});

devClear.addEventListener("click", () => {
  devLogEl.innerHTML = "";
  _lastLen = 0;
  _clearPromise = (async () => {
    // Write the new epoch to storage FIRST — any in-flight flush() in the
    // content script reads lt_logEpoch and aborts on mismatch, even if
    // CLEAR_LOG hasn't arrived yet.
    const epoch = Date.now();
    await api.storage.local.set({ lt_devLog: [], lt_logEpoch: epoch });
    await sendToContent({ type: "CLEAR_LOG", epoch });
  })();
  _clearPromise.finally(() => { _clearPromise = null; });
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadLang();
loadLog();
