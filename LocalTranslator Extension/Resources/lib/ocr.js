// lib/ocr.js — offline OCR via a bundled copy of Tesseract.js.
//
// Tesseract.js is loaded from vendor/tesseract/tesseract.min.js and its
// worker/core WASM from vendor/tesseract/. Traineddata files (jpn.traineddata,
// chi_sim.traineddata, chi_tra.traineddata) are loaded from vendor/traineddata/.
//
// All paths point at chrome-extension:// URLs, so Tesseract cannot reach the
// internet — matching the project's hard offline requirement.
//
// The global `Tesseract` is exposed by tesseract.min.js via an importScripts()
// shim we load in the content-script world. If it is unavailable (no vendor
// assets shipped yet) we fall back to a no-op stub that returns empty OCR
// results — this lets the rest of the pipeline run and be tested.

const api = typeof browser !== "undefined" ? browser : chrome;

const VENDOR_BASE = api.runtime.getURL("vendor/tesseract/");
const TRAINED_BASE = api.runtime.getURL("vendor/traineddata/");

let workerPromise = null;

async function loadTesseractScript() {
  if (self.Tesseract) return self.Tesseract;
  // Content scripts cannot inject <script src="..."> that loads from
  // chrome-extension:// via the page's CSP, so we fetch the source as text
  // and evaluate it in an isolated Function. The source is packaged with
  // the extension; no network request is made.
  const url = VENDOR_BASE + "tesseract.min.js";
  const resp = await fetch(url); // extension-local URL, offline-safe
  if (!resp.ok) throw new Error("Tesseract.js not bundled at " + url);
  const src = await resp.text();
  // eslint-disable-next-line no-new-func
  new Function(src + "\n;self.Tesseract=Tesseract;")();
  if (!self.Tesseract) throw new Error("Tesseract global missing after load");
  return self.Tesseract;
}

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await loadTesseractScript();
    const worker = await Tesseract.createWorker({
      workerPath: VENDOR_BASE + "worker.min.js",
      corePath: VENDOR_BASE + "tesseract-core.wasm.js",
      langPath: TRAINED_BASE,
      // Prevent traineddata from being auto-downloaded from the internet.
      cacheMethod: "none",
      gzip: false,
    });
    // Pre-load Japanese + Chinese models. They are bundled with the extension.
    await worker.loadLanguage("jpn+chi_sim+chi_tra");
    await worker.initialize("jpn+chi_sim+chi_tra");
    // Page-segmentation mode 6 = assume a single uniform block of text —
    // well-suited to speech-bubble crops.
    await worker.setParameters({ tessedit_pageseg_mode: "6" });
    return worker;
  })().catch((err) => {
    console.warn(
      "[LocalTranslator] OCR disabled — bundle Tesseract.js + traineddata to enable.",
      err
    );
    workerPromise = null;
    return null;
  });
  return workerPromise;
}

function cropRegion(sourceCanvas, region) {
  const { x, y, w, h } = region;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext("2d");
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, out.width, out.height);
  // Mild contrast boost — speech-bubble text is usually black-on-white.
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    const boosted = v < 128 ? Math.max(0, v - 20) : Math.min(255, v + 20);
    d[i] = d[i + 1] = d[i + 2] = boosted;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function pickLang(sourceLang) {
  if (sourceLang === "jpn" || sourceLang === "chi_sim" || sourceLang === "chi_tra") {
    return sourceLang;
  }
  // auto: let Tesseract pick among all loaded scripts.
  return "jpn+chi_sim+chi_tra";
}

export async function recognize(sourceCanvas, region, { lang = "auto" } = {}) {
  const worker = await getWorker();
  if (!worker) {
    return { text: "", detectedLang: null, confidence: 0 };
  }
  const cropped = cropRegion(sourceCanvas, region);
  const { data } = await worker.recognize(cropped, { lang: pickLang(lang) });
  const text = (data?.text ?? "").trim();
  return {
    text,
    confidence: data?.confidence ?? 0,
    detectedLang: guessScript(text),
  };
}

function guessScript(text) {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "jpn"; // hiragana/katakana
  if (/[\u4e00-\u9fff]/.test(text)) return "chi_sim";
  return null;
}
