const api = typeof browser !== "undefined" ? browser : chrome;

try {
  api.storage.local.set({ lt_cs_injected: Date.now(), lt_cs_url: location.href.slice(0, 120) });
} catch (_) {}

const STATE = {
  pickMode: false,
  sourceLang: "auto",
  processed: new WeakSet(),
  overlays: new Map(),
};

// ── Dev log ───────────────────────────────────────────────────────────────────

const _queue = [];
let _flushTimer = null;
let _clearGen = 0;   // synced with lt_logEpoch in storage on init and on CLEAR_LOG

function devLog(entry, kind) {
  _queue.push({ entry, kind });
  if (!_flushTimer) _flushTimer = setTimeout(flush, 80);
}

async function flush() {
  _flushTimer = null;
  if (!_queue.length) return;
  const gen = _clearGen;
  const batch = _queue.splice(0);
  try {
    const { lt_devLog: prev = [] } = await api.storage.local.get("lt_devLog");
    if (gen !== _clearGen) return;
    await api.storage.local.set({ lt_devLog: [...prev, ...batch.map(e => ({ ...e, ep: gen }))].slice(-300) });
  } catch {}
}

function imgLabel(img) {
  try {
    const name = new URL(img.src).pathname.split("/").filter(Boolean).pop() ?? "";
    return name.length > 40 ? "…" + name.slice(-37) : name || img.src.slice(-30);
  } catch { return img.src.slice(-30); }
}

// ── Translation ───────────────────────────────────────────────────────────────

async function translateViaBackground(text, lang) {
  try {
    const resp = await Promise.race([
      api.runtime.sendMessage({ type: "TRANSLATE", text, lang: lang ?? "jpn" }),
      new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 60_000)),
    ]);
    if (resp?.ok) return resp.text;
    devLog(`  translation error: ${resp?.error}`, "err");
    return text;
  } catch (err) {
    devLog(`  messaging error: ${err?.message ?? String(err ?? "lost")}`, "err");
    return text;
  }
}

// ── Process one image via native Swift OCR ────────────────────────────────────

async function processImage(img) {
  const label = imgLabel(img);
  devLog(`[OCR]  ${label} — sending to Apple Vision`, "scan");

  let observations;
  try {
    const resp = await Promise.race([
      api.runtime.sendMessage({
        type: "NATIVE_OCR",
        url: img.src,
        referer: location.href,
      }),
      new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 30_000)),
    ]);
    if (!resp?.ok) {
      devLog(`[ERR]  ${label}: OCR failed — ${resp?.error}`, "err");
      return;
    }
    observations = resp.observations ?? [];
    const dims = resp.imageWidth ? `${resp.imageWidth}×${resp.imageHeight}` : "?×?";
    if (!observations.length) {
      devLog(`[SKIP] ${label} — no text detected (Swift image: ${dims}, raw regions: ${resp.rawCount ?? "?"})`, "skip");
      return;
    }
    devLog(`[IMG]  ${label} — ${observations.length} region(s) kept (Swift: ${dims})`, "scan");
  } catch (err) {
    devLog(`[ERR]  ${label}: ${err?.message ?? String(err)}`, "err");
    return;
  }

  if (!observations.length) return;

  const translations = [];
  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    const raw = (obs.text ?? "").trim();
    if (!raw) continue;
    devLog(`  region ${i + 1}: "${raw.slice(0, 50)}" (${Math.round((obs.confidence ?? 0) * 100)}%)`, "ocr");
    const english = await translateViaBackground(raw, STATE.sourceLang === "auto" ? "jpn" : STATE.sourceLang);
    devLog(`  region ${i + 1}: → "${english.slice(0, 60)}"`, "xlat");
    // obs.x/y/w/h are normalized 0-1; overlay.js divides by canvas size,
    // so pass a 1×1 "canvas" and the normalized values work directly as fractions.
    translations.push({ region: { x: obs.x, y: obs.y, w: obs.w, h: obs.h }, original: raw, english });
  }

  if (!translations.length) {
    devLog(`[SKIP] ${label} — no translatable text`, "skip");
    return;
  }

  const fakeCanvas = { width: 1, height: 1 };
  STATE.overlays.set(img, window._LT.renderOverlay(img, fakeCanvas, translations));
  STATE.processed.add(img);
  devLog(`[OK]   ${label} — ${translations.length} overlay(s) placed`, "ok");
}

// ── Pick-mode banner ──────────────────────────────────────────────────────────

function showPickBanner() {
  removePickBanner();
  const el = document.createElement("div");
  el.id = "_lt_banner";
  el.textContent = "Local Translator — click an image to translate it";
  el.style.cssText = [
    "position:fixed", "top:16px", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483647", "background:rgba(10,132,255,0.93)", "color:#fff",
    "padding:10px 20px", "border-radius:10px",
    "font:600 13px -apple-system,sans-serif",
    "pointer-events:none", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
  ].join(";");
  document.body.appendChild(el);
}

function removePickBanner() {
  document.getElementById("_lt_banner")?.remove();
}

// ── Click-to-translate ────────────────────────────────────────────────────────

function attachClickListeners() {
  for (const img of document.images) {
    if (img._ltListening) continue;
    img._ltListening = true;

    img.addEventListener("mouseenter", () => {
      if (!STATE.pickMode || STATE.processed.has(img)) return;
      img.style.outline = "3px solid rgba(99,179,237,0.8)";
      img.style.outlineOffset = "-3px";
      img.style.cursor = "zoom-in";
    });
    img.addEventListener("mouseleave", () => {
      img.style.outline = "";
      img.style.outlineOffset = "";
      img.style.cursor = "";
    });
    img.addEventListener("click", async (e) => {
      if (!STATE.pickMode || STATE.processed.has(img)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      img.style.outline = "";
      img.style.outlineOffset = "";
      img.style.cursor = "";
      removePickBanner();
      devLog(`[CLICK] ${imgLabel(img)} — ${img.naturalWidth}×${img.naturalHeight}px`, "scan");
      try { await processImage(img); }
      catch (err) { devLog(`[ERR]  ${imgLabel(img)}: ${err?.message ?? String(err)}`, "err"); }
      await flush();
    }, true);
  }
}

function clearOverlays() {
  for (const [, ov] of STATE.overlays) ov.remove?.();
  STATE.overlays.clear();
  STATE.processed = new WeakSet();
  STATE.pickMode = false;
  removePickBanner();
}

// ── Messages ──────────────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "ENTER_PICK_MODE") {
      STATE.pickMode = true;
      if (msg.sourceLang) STATE.sourceLang = msg.sourceLang;
      attachClickListeners();
      showPickBanner();
      devLog("[PICK] Click an image to translate it.", "scan");
      sendResponse({ ok: true });
    } else if (msg?.type === "CLEAR_OVERLAYS") {
      clearOverlays();
      sendResponse({ ok: true });
    } else if (msg?.type === "CLEAR_LOG") {
      _clearGen = msg.epoch ?? (_clearGen + 1);
      _queue.length = 0;
      clearTimeout(_flushTimer);
      _flushTimer = null;
      await api.storage.local.set({ lt_devLog: [], lt_logEpoch: _clearGen });
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const { sourceLang = "auto", lt_logEpoch = 0 } = await api.storage.local.get(["sourceLang", "lt_logEpoch"]);
  STATE.sourceLang = sourceLang;
  _clearGen = lt_logEpoch;   // sync with whatever epoch is currently in storage
  attachClickListeners();

  new MutationObserver((mutations) => {
    const hasNew = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (n) => n.nodeType === 1 && (n.tagName === "IMG" || n.querySelector?.("img"))
      )
    );
    if (hasNew) { clearTimeout(init._t); init._t = setTimeout(attachClickListeners, 600); }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
