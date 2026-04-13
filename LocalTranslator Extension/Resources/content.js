// content.js — runs in every page and orchestrates image translation.
//
// Flow when enabled:
//   1. Collect eligible <img> elements on the page.
//   2. For each image:
//      a. Draw to an offscreen canvas (same-origin or cached by Safari).
//      b. bubble-detector.js: propose candidate speech-bubble regions.
//      c. ocr.js: Tesseract.js OCR on each region (offline, vendor bundle).
//      d. translateViaBackground(): send detected text to background service
//         worker which runs the offline Transformers.js / opus-mt pipeline.
//      e. overlay.js: render translated text over the original bubble.
//
// Network: content scripts are NOT governed by the extension_pages CSP.
// Tesseract.js vendor files are loaded from chrome-extension:// URLs (offline).
// Translation is handled by the service worker — content.js is network-free.

const api = typeof browser !== "undefined" ? browser : chrome;

const STATE = {
  enabled: false,
  sourceLang: "auto",
  processed: new WeakSet(),
  overlays: new Map(), // imgElement -> overlay element
  modules: null,       // lazy-loaded pipeline modules
};

// ---------- Dynamic module loading ----------
// We use dynamic import() from the extension's own bundle to keep initial
// page-load cost near zero. These modules are declared web_accessible in
// manifest.json.

async function loadModules() {
  if (STATE.modules) return STATE.modules;
  const base = api.runtime.getURL("lib/");
  // translator.js is NOT loaded here — translation is handled by the background
  // service worker (see translateViaBackground below).
  const [ocr, detector, overlay] = await Promise.all([
    import(base + "ocr.js"),
    import(base + "bubble-detector.js"),
    import(base + "overlay.js"),
  ]);
  STATE.modules = { ocr, detector, overlay };
  return STATE.modules;
}

// Send OCR'd text to the background service worker for offline neural
// translation. The background owns the Transformers.js pipeline so model
// weights are cached once in the extension's shared Cache Storage.
async function translateViaBackground(text, lang) {
  try {
    const resp = await api.runtime.sendMessage({
      type: "TRANSLATE",
      text,
      lang: lang ?? "jpn",
    });
    if (resp?.ok) return resp.text;
    console.warn("[LT] Translation failed:", resp?.error);
    return text; // fall back to original on error
  } catch (err) {
    console.warn("[LT] Background unreachable:", err);
    return text;
  }
}

// ---------- Image collection ----------

function eligibleImages() {
  const imgs = Array.from(document.images);
  return imgs.filter((img) => {
    if (STATE.processed.has(img)) return false;
    if (!img.complete || img.naturalWidth === 0) return false;
    if (img.naturalWidth < 80 || img.naturalHeight < 80) return false;
    const rect = img.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return false;
    return true;
  });
}

async function imageToCanvas(img) {
  // Use createImageBitmap where possible - respects CORS rules the same way,
  // but is more efficient than drawImage for large images.
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  try {
    ctx.drawImage(img, 0, 0);
    // Touch the pixels to surface any CORS failure synchronously.
    ctx.getImageData(0, 0, 1, 1);
    return canvas;
  } catch (e) {
    // Cross-origin image that taints the canvas. We cannot read pixels and
    // we must stay offline, so we skip this image rather than re-fetching.
    return null;
  }
}

// ---------- Main processing ----------

function reportProgress(current, total, label) {
  api.runtime
    .sendMessage({ type: "PROGRESS", current, total, label })
    .catch(() => {});
}

async function processImage(img, modules) {
  const canvas = await imageToCanvas(img);
  if (!canvas) return { skipped: "tainted" };

  const regions = await modules.detector.findBubbles(canvas);
  if (regions.length === 0) return { skipped: "no-bubbles" };

  const translations = [];
  for (const region of regions) {
    const ocrResult = await modules.ocr.recognize(canvas, region, {
      lang: STATE.sourceLang,
    });
    if (!ocrResult.text || !ocrResult.text.trim()) continue;
    const english = await translateViaBackground(
      ocrResult.text,
      ocrResult.detectedLang ?? STATE.sourceLang
    );
    translations.push({ region, original: ocrResult.text, english });
  }
  if (translations.length === 0) return { skipped: "no-text" };

  const overlay = modules.overlay.renderOverlay(img, canvas, translations);
  STATE.overlays.set(img, overlay);
  STATE.processed.add(img);
  return { translations: translations.length };
}

async function rescan() {
  if (!STATE.enabled) return;
  const modules = await loadModules();
  const targets = eligibleImages();
  if (targets.length === 0) {
    reportProgress(0, 0, "No images found.");
    return;
  }
  let done = 0;
  for (const img of targets) {
    try {
      await processImage(img, modules);
    } catch (err) {
      console.warn("[LocalTranslator] failed on image", img.src, err);
    }
    done++;
    reportProgress(done, targets.length, `Processed ${done}/${targets.length}`);
  }
  reportProgress(targets.length, targets.length, "Done.");
}

function clearOverlays() {
  for (const [, overlay] of STATE.overlays) {
    overlay.remove?.();
  }
  STATE.overlays.clear();
  STATE.processed = new WeakSet();
}

// ---------- Message handling ----------

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
  return true; // async response
});

// ---------- Init ----------

(async function init() {
  const { enabled = false, sourceLang = "auto" } = await api.storage.local.get([
    "enabled",
    "sourceLang",
  ]);
  STATE.enabled = enabled;
  STATE.sourceLang = sourceLang;
  if (enabled) {
    // Let the page settle before first pass.
    await new Promise((r) => setTimeout(r, 400));
    await rescan();
  }

  // Re-scan when the DOM mutates significantly (infinite-scroll pages).
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
