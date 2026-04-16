// lib/ocr.js — offline OCR via bundled Tesseract.js (UMD v4).

(function () {
  if (window._LT && window._LT.recognize) return; // already loaded

  const VENDOR_BASE  = () => (typeof browser !== "undefined" ? browser : chrome).runtime.getURL("vendor/tesseract/");
  const TRAINED_BASE = () => (typeof browser !== "undefined" ? browser : chrome).runtime.getURL("vendor/traineddata/");

  let workerPromise = null;

  function sendStatus(text) {
    try {
      (typeof browser !== "undefined" ? browser : chrome).runtime.sendMessage({ type: "STATUS", text });
    } catch (_) {}
  }

  async function loadTesseractScript() {
    if (self.Tesseract) return self.Tesseract;

    const url = VENDOR_BASE() + "tesseract.min.js";
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `[LT] OCR vendor file not found at ${url}. ` +
        "Run scripts/download-vendors.sh to fetch it."
      );
    }

    const src = await resp.text();
    // eslint-disable-next-line no-new-func
    new Function(src + "\n;self.Tesseract = (typeof Tesseract !== 'undefined') ? Tesseract : module.exports;")();

    if (!self.Tesseract) throw new Error("[LT] Tesseract global not set after eval.");
    return self.Tesseract;
  }

  async function getWorker() {
    if (workerPromise) return workerPromise;

    const vBase = VENDOR_BASE();
    const tBase = TRAINED_BASE();

    workerPromise = (async () => {
      sendStatus("Loading OCR engine…");
      const Tesseract = await loadTesseractScript();

      const worker = await Tesseract.createWorker({
        workerPath : vBase + "worker.min.js",
        corePath   : vBase + "tesseract-core.wasm.js",
        langPath   : tBase,
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
    return "jpn+chi_sim+chi_tra";
  }

  async function recognize(sourceCanvas, region, { lang = "auto" } = {}) {
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
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "jpn";
    if (/[\u4e00-\u9fff]/.test(text)) return "chi_sim";
    return null;
  }

  window._LT = window._LT || {};
  window._LT.recognize = recognize;
})();
