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

let _clearPromise = null;

pickBtn.addEventListener("click", async () => {
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
let _epoch   = 0;   // current log epoch; entries from other epochs are ignored

function visibleEntries(all) {
  // Show only entries from the current epoch. Entries with no ep field
  // (written before epoch tracking was added) are shown only when epoch = 0.
  if (_epoch === 0) return all;
  return all.filter(e => e.ep === _epoch);
}

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
  const { lt_devLog: all = [], lt_logEpoch = 0 } = await api.storage.local.get(["lt_devLog", "lt_logEpoch"]);
  _epoch = lt_logEpoch;
  _lastLen = 0;
  renderEntries(visibleEntries(all));
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.lt_logEpoch) _epoch = changes.lt_logEpoch.newValue ?? 0;
  if (!changes.lt_devLog) return;
  const visible = visibleEntries(changes.lt_devLog.newValue ?? []);
  if (visible.length < _lastLen) { devLogEl.innerHTML = ""; _lastLen = 0; }
  renderEntries(visible);
});

devClear.addEventListener("click", () => {
  devLogEl.innerHTML = "";
  _lastLen = 0;

  _clearPromise = (async () => {
    const epoch = Date.now();
    _epoch = epoch;
    await api.storage.local.set({ lt_devLog: [], lt_logEpoch: epoch });
    await Promise.race([
      sendToContent({ type: "CLEAR_LOG", epoch }),
      new Promise(r => setTimeout(r, 1500)),
    ]);
  })();
  _clearPromise.finally(() => { _clearPromise = null; });
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadLang();
loadLog();
