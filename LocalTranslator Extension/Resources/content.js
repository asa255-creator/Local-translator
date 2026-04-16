// content.js — orchestrates image translation on the page.
//
// lib/bubble-detector.js, lib/ocr.js, lib/overlay.js are injected BEFORE this
// file by the manifest content_scripts list, so window._LT.* is available
// immediately without any dynamic import().
//
// Translation is sent to the background service worker which owns the
// Transformers.js / opus-mt pipeline (cached in extension Cache Storage).
// Content scripts make zero network requests.

const api = typeof browser !== "undefined" ? browser : chrome;

// Diagnostic: written at script-load time so the popup dev panel can confirm
// whether Safari actually injected this content script into the page.
try {
  api.storage.local.set({ lt_cs_injected: Date.now(), lt_cs_url: location.href.slice(0, 120) });
} catch (_) {}

const STATE = {
  enabled: false,
  sourceLang: "auto",
  processed: new WeakSet(),
  overlays: new Map(),
};

// ── Dev log (written to storage so the popup always sees it) ─────────────────

const _devQueue = [];
let _devFlushTimer = null;

function devLog(entry, kind) {
  _devQueue.push({ entry, kind });
  if (!_devFlushTimer) {
    _devFlushTimer = setTimeout(flushDevLog, 80);
  }
}

async function flushDevLog() {
  _devFlushTimer = null;
  if (_devQueue.length === 0) return;
  const batch = _devQueue.splice(0);
  try {
    const { lt_devLog: prev = [] } = await api.storage.local.get("lt_devLog");
    await api.storage.local.set({
      lt_devLog: [...prev, ...batch].slice(-300),
    });
  } catch {}
}

// Short label for an image element (last path segment of URL).
function imgLabel(img) {
  try {
    const name = new URL(img.src).pathname.split("/").filter(Boolean).pop() ?? "";
    return name.length > 40 ? "…" + name.slice(-37) : name || img.src.slice(-30);
  } catch {
    return img.src.slice(-30);
  }
}

// ── Background translation (with timeout) ────────────────────────────────────

async function translateViaBackground(text, lang) {
  try {
    const TIMEOUT_MS = 60_000; // give the model up to 60 s to load/respond
    const msgPromise = api.runtime.sendMessage({
      type: "TRANSLATE",
      text,
      lang: lang ?? "jpn",
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
    );
    const resp = await Promise.race([msgPromise, timeoutPromise]);
    if (resp?.ok) return resp.text;
    devLog(`  translation error: ${resp?.error}`, "err");
    return text;
  } catch (err) {
    if (err.message === "timeout") {
      devLog("  translation timed out — model still loading?", "err");
    }
    return text;
  }
}

// ── Image collection ──────────────────────────────────────────────────────────

function eligibleImages() {
  return Array.from(document.images).filter((img) => {
    if (STATE.processed.has(img)) return false;
    if (!img.complete || img.naturalWidth === 0) return false;
    if (img.naturalWidth < 80 || img.naturalHeight < 80) return false;
    const rect = img.getBoundingClientRect();
    return rect.width >= 40 && rect.height >= 40;
  });
}

async function imageToCanvas(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Fast path: same-origin image.
  try {
    ctx.drawImage(img, 0, 0);
    ctx.getImageData(0, 0, 1, 1); // throws if cross-origin tainted
    return canvas;
  } catch (_) {}

  // Slow path: cross-origin. Re-fetch as Blob — extension content scripts
  // can make cross-origin fetches via host_permissions <all_urls>.
  // A Blob-derived ImageBitmap does not taint the canvas.
  try {
    const resp = await fetch(img.src, { credentials: "omit" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return canvas;
  } catch (err) {
    console.warn("[LT] Cannot access image pixels:", img.src, err);
    return null;
  }
}

// ── Main processing ───────────────────────────────────────────────────────────

function reportProgress(current, total, label) {
  api.runtime.sendMessage({ type: "PROGRESS", current, total, label }).catch(() => {});
}

async function processImage(img) {
  const label = imgLabel(img);
  const canvas = await imageToCanvas(img);
  if (!canvas) {
    devLog(`[SKIP] ${label} — cross-origin fetch failed`, "skip");
    return;
  }

  const regions = await window._LT.findBubbles(canvas);
  if (regions.length === 0) {
    devLog(`[SKIP] ${label} — no speech bubbles found`, "skip");
    return;
  }
  devLog(`[IMG]  ${label} — ${regions.length} bubble(s)`, "scan");

  const translations = [];
  for (let i = 0; i < regions.length; i++) {
    const ocrResult = await window._LT.recognize(canvas, regions[i], {
      lang: STATE.sourceLang,
    });
    const rawText = ocrResult.text?.trim() ?? "";
    if (!rawText) {
      devLog(`  bubble ${i + 1}: no text`, "skip");
      continue;
    }
    devLog(
      `  bubble ${i + 1}: "${rawText.slice(0, 50).replace(/\n/g, " ")}" ` +
      `(conf ${Math.round(ocrResult.confidence ?? 0)}%)`,
      "ocr"
    );
    const english = await translateViaBackground(
      rawText,
      ocrResult.detectedLang ?? STATE.sourceLang
    );
    devLog(`  bubble ${i + 1}: → "${english.slice(0, 60).replace(/\n/g, " ")}"`, "xlat");
    translations.push({ region: regions[i], original: rawText, english });
  }

  if (translations.length === 0) {
    devLog(`[SKIP] ${label} — OCR found no text`, "skip");
    return;
  }

  const overlay = window._LT.renderOverlay(img, canvas, translations);
  STATE.overlays.set(img, overlay);
  STATE.processed.add(img);
  devLog(`[OK]   ${label} — ${translations.length} overlay(s) placed`, "ok");
}

async function rescan() {
  if (!STATE.enabled) return;
  await api.storage.local.set({ lt_devLog: [] }); // clear log for new scan
  const targets = eligibleImages();
  if (targets.length === 0) {
    reportProgress(0, 0, "No images found.");
    devLog("[SCAN] No eligible images found on this page.", "scan");
    return;
  }
  devLog(`[SCAN] ${targets.length} image(s) eligible`, "scan");
  let done = 0;
  for (const img of targets) {
    try {
      await processImage(img);
    } catch (err) {
      devLog(`[ERR]  ${imgLabel(img)}: ${err.message}`, "err");
      console.warn("[LT] failed on image", img.src, err);
    }
    done++;
    reportProgress(done, targets.length, `Processing ${done}/${targets.length}…`);
  }
  await flushDevLog(); // flush any remaining batched entries
  reportProgress(targets.length, targets.length, "Done.");
}

function clearOverlays() {
  for (const [, overlay] of STATE.overlays) overlay.remove?.();
  STATE.overlays.clear();
  STATE.processed = new WeakSet();
}

// ── Message handling ──────────────────────────────────────────────────────────

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "SET_ENABLED":
        STATE.enabled = !!msg.enabled;
        if (msg.sourceLang) STATE.sourceLang = msg.sourceLang;
        if (!STATE.enabled) clearOverlays();
        sendResponse({ ok: true });
        break;
      case "SET_SOURCE_LANG":
        STATE.sourceLang = msg.sourceLang;
        sendResponse({ ok: true });
        break;
      case "RESCAN":
        await rescan();
        sendResponse({ ok: true });
        break;
      case "CLEAR_OVERLAYS":
        clearOverlays();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "unknown-message" });
    }
  })();
  return true;
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  const { enabled = false, sourceLang = "auto" } = await api.storage.local.get([
    "enabled",
    "sourceLang",
  ]);
  STATE.enabled = enabled;
  STATE.sourceLang = sourceLang;
  if (enabled) {
    await new Promise((r) => setTimeout(r, 400));
    await rescan();
  }

  const observer = new MutationObserver((mutations) => {
    if (!STATE.enabled) return;
    const hasNewImages = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (n) => n.nodeType === 1 && (n.tagName === "IMG" || n.querySelector?.("img"))
      )
    );
    if (hasNewImages) {
      clearTimeout(init._t);
      init._t = setTimeout(rescan, 800);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
