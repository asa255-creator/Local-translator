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

function devLog(entry, kind) {
  _queue.push({ entry, kind });
  if (!_flushTimer) _flushTimer = setTimeout(flush, 80);
}

async function flush() {
  _flushTimer = null;
  if (!_queue.length) return;
  const batch = _queue.splice(0);
  try {
    const { lt_devLog: prev = [] } = await api.storage.local.get("lt_devLog");
    await api.storage.local.set({ lt_devLog: [...prev, ...batch].slice(-300) });
  } catch {}
}

function imgLabel(img) {
  try {
    const name = new URL(img.src).pathname.split("/").filter(Boolean).pop() ?? "";
    return name.length > 40 ? "…" + name.slice(-37) : name || img.src.slice(-30);
  } catch { return img.src.slice(-30); }
}

function errDetail(img, err) {
  let xo = "?";
  try { xo = new URL(img.src).origin !== location.origin ? "yes" : "no"; } catch {}
  const r = img.getBoundingClientRect();
  return (
    `${err?.message ?? String(err)}\n` +
    `  natural ${img.naturalWidth}×${img.naturalHeight} | ` +
    `displayed ${Math.round(r.width)}×${Math.round(r.height)} | ` +
    `cross-origin: ${xo}\n` +
    `  ${img.src.slice(-80)}`
  );
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

// ── Canvas ────────────────────────────────────────────────────────────────────

async function imageToCanvas(img) {
  const canvas = document.createElement("canvas");
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  try {
    ctx.drawImage(img, 0, 0);
    ctx.getImageData(0, 0, 1, 1); // throws if cross-origin tainted
    return canvas;
  } catch {}

  // Cross-origin: fetch as blob. Must use a FRESH canvas — once a canvas is
  // tainted by a cross-origin drawImage it stays tainted even after clearRect.
  try {
    const resp = await fetch(img.src, { credentials: "omit" });
    if (!resp.ok) return null;
    const bitmap = await createImageBitmap(await resp.blob());
    const fresh = document.createElement("canvas");
    fresh.width  = img.naturalWidth;
    fresh.height = img.naturalHeight;
    fresh.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return fresh;
  } catch { return null; }
}

// ── Process one image ─────────────────────────────────────────────────────────

async function processImage(img) {
  const label = imgLabel(img);
  const canvas = await imageToCanvas(img);
  if (!canvas) {
    devLog(`[SKIP] ${label} — cannot read pixels (cross-origin blocked)`, "skip");
    return;
  }

  const regions = await window._LT.findBubbles(canvas);
  if (!regions.length) {
    devLog(`[SKIP] ${label} — no speech bubbles detected`, "skip");
    return;
  }
  devLog(`[IMG]  ${label} — ${regions.length} bubble(s)`, "scan");

  const translations = [];
  for (let i = 0; i < regions.length; i++) {
    const ocr = await window._LT.recognize(canvas, regions[i], { lang: STATE.sourceLang });
    const raw = ocr.text?.trim() ?? "";
    if (!raw) { devLog(`  bubble ${i + 1}: no text`, "skip"); continue; }
    devLog(`  bubble ${i + 1}: "${raw.slice(0, 50).replace(/\n/g, " ")}" (${Math.round(ocr.confidence ?? 0)}%)`, "ocr");
    const english = await translateViaBackground(raw, ocr.detectedLang ?? STATE.sourceLang);
    devLog(`  bubble ${i + 1}: → "${english.slice(0, 60).replace(/\n/g, " ")}"`, "xlat");
    translations.push({ region: regions[i], original: raw, english });
  }

  if (!translations.length) {
    devLog(`[SKIP] ${label} — no translatable text`, "skip");
    return;
  }

  STATE.overlays.set(img, window._LT.renderOverlay(img, canvas, translations));
  STATE.processed.add(img);
  devLog(`[OK]   ${label} — ${translations.length} overlay(s) placed`, "ok");
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
      const r = img.getBoundingClientRect();
      devLog(
        `[CLICK] ${imgLabel(img)} — ` +
        `${img.naturalWidth}×${img.naturalHeight} natural | ` +
        `${Math.round(r.width)}×${Math.round(r.height)} displayed`,
        "scan"
      );
      try { await processImage(img); }
      catch (err) { devLog(`[ERR]  ${imgLabel(img)}:\n  ${errDetail(img, err)}`, "err"); }
      await flush();
    }, true);
  }
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
    "padding:10px 20px", "border-radius:10px", "font:600 13px/-apple-system,sans-serif",
    "pointer-events:none", "box-shadow:0 4px 20px rgba(0,0,0,0.3)",
  ].join(";");
  document.body.appendChild(el);
}

function removePickBanner() {
  document.getElementById("_lt_banner")?.remove();
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
      await flush();
      sendResponse({ ok: true });
    } else if (msg?.type === "CLEAR_OVERLAYS") {
      clearOverlays();
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const { sourceLang = "auto" } = await api.storage.local.get("sourceLang");
  STATE.sourceLang = sourceLang;
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
