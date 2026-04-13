// lib/ocr.js — offline OCR via bundled Tesseract.js (UMD v4).
//
// THIS MODULE RUNS IN THE CONTENT SCRIPT.
// Tesseract.js needs Web Workers, which are only available in content-script
// context (not in the background service worker). Canvas access for pixel
// extraction also happens here.
//
// Vendor files required (download via scripts/download-vendors.sh):
//   vendor/tesseract/tesseract.min.js   — Tesseract.js v4 UMD library
//   vendor/tesseract/worker.min.js      — worker bootstrap
//   vendor/tesseract/tesseract-core.wasm.js — WASM core
//   vendor/traineddata/jpn.traineddata  — Japanese OCR model  (~25 MB)
//   vendor/traineddata/chi_sim.traineddata  — Simplified Chinese  (~20 MB)
//   vendor/traineddata/chi_tra.traineddata  — Traditional Chinese (~20 MB)
//
// All paths are chrome-extension:// URLs — no network traffic during OCR.

const api = typeof browser !== "undefined" ? browser : chrome;

const VENDOR_BASE   = api.runtime.getURL("vendor/tesseract/");
const TRAINED_BASE  = api.runtime.getURL("vendor/traineddata/");

let workerPromise = null;

// Report progress back to the popup via the background service worker relay.
function sendStatus(text) {
  api.runtime.sendMessage({ type: "STATUS", text }).catch(() => {});
}

async function loadTesseractScript() {
  if (self.Tesseract) return self.Tesseract;

  const url = VENDOR_BASE + "tesseract.min.js";
  const resp = await fetch(url); // extension-local; offline
  if (!resp.ok) {
    throw new Error(
      `[LT] OCR vendor file not found at ${url}. ` +
      "Run scripts/download-vendors.sh to fetch it."
    );
  }

  // Tesseract.js v4 is a UMD bundle. Evaluating it sets self.Tesseract
  // via the global assignment path (new Function runs in non-strict mode,
  // so `this` is the global object / `self`).
  const src = await resp.text();
  // eslint-disable-next-line no-new-func
  new Function(src + "\n;self.Tesseract = (typeof Tesseract !== 'undefined') ? Tesseract : module.exports;")();

  if (!self.Tesseract) throw new Error("[LT] Tesseract global not set after eval.");
  return self.Tesseract;
}

async function getWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    sendStatus("Loading OCR engine…");
    const Tesseract = await loadTesseractScript();

    const worker = await Tesseract.createWorker({
      workerPath : VENDOR_BASE + "worker.min.js",
      corePath   : VENDOR_BASE + "tesseract-core.wasm.js",
      langPath   : TRAINED_BASE,
      // traineddata is bundled — no caching or gzip needed.
      cacheMethod: "none",
      gzip       : false,
      logger     : (m) => {
        if (m.status === "loading tesseract core") {
          sendStatus("Loading OCR core…");
        } else if (m.status === "initializing tesseract") {
          sendStatus("Initializing OCR…");
        } else if (m.status === "loading language traineddata") {
          sendStatus(`Loading ${m.progress < 1 ? Math.round(m.progress * 100) + "%" : "✓"} language data…`);
        }
      },
    });

    sendStatus("Initializing OCR languages…");
    await worker.loadLanguage("jpn+chi_sim+chi_tra");
    await worker.initialize("jpn+chi_sim+chi_tra");
    // PSM 6 = single uniform block — well-suited to speech-bubble crops.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    sendStatus("OCR ready.");
    return worker;
  })().catch((err) => {
    console.warn("[LT] OCR initialisation failed:", err.message);
    sendStatus("OCR unavailable: " + err.message);
    workerPromise = null;
    return null;
  });

  return workerPromise;
}

function cropRegion(sourceCanvas, region) {
  const { x, y, w, h } = region;
  const out = document.createElement("canvas");
  out.width  = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, out.width, out.height);

  // Mild contrast boost — manga text is typically black-on-white.
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const b = v < 128 ? Math.max(0, v - 20) : Math.min(255, v + 20);
    d[i] = d[i + 1] = d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function pickLang(sourceLang) {
  if (sourceLang === "jpn" || sourceLang === "chi_sim" || sourceLang === "chi_tra") {
    return sourceLang;
  }
  return "jpn+chi_sim+chi_tra"; // auto: try all three
}

export async function recognize(sourceCanvas, region, { lang = "auto" } = {}) {
  const worker = await getWorker();
  if (!worker) return { text: "", detectedLang: null, confidence: 0 };

  const cropped = cropRegion(sourceCanvas, region);
  const { data } = await worker.recognize(cropped, { lang: pickLang(lang) });
  const text = (data?.text ?? "").trim();
  return {
    text,
    confidence : data?.confidence ?? 0,
    detectedLang: guessScript(text),
  };
}

function guessScript(text) {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "jpn"; // hiragana / katakana
  if (/[\u4e00-\u9fff]/.test(text)) return "chi_sim";           // CJK
  return null;
}
