// lib/translator.js — neural machine translation via Transformers.js.
//
// THIS MODULE RUNS IN THE BACKGROUND SERVICE WORKER (background.js imports it).
// It does NOT run in content scripts.
//
// Why the service worker? Chrome/Safari put extension service workers in a
// separate origin context where caches.open() uses the extension's own
// Cache Storage — shared across every tab. That means the ~150 MB of opus-mt
// model weights are downloaded exactly once, then served offline forever.
//
// Models used (Apache-2.0 / CC-BY-4.0):
//   Helsinki-NLP/opus-mt-ja-en   (~75 MB, Japanese → English)
//   Helsinki-NLP/opus-mt-zh-en   (~75 MB, Chinese → English)
//
// First call: triggers ONNX WASM download from jsDelivr (~20 MB) and model
// weight download from Hugging Face (~75 MB per language pair).
// Every subsequent call: fully offline, reads from extension Cache Storage.
//
// Vendor requirement: vendor/transformers.min.js must be present.
// Run scripts/download-vendors.sh to fetch it.

import { setModelStatus, CDN } from "./model-manager.js";

// One pipeline promise per language pair, cached for the service worker's
// lifetime. Storing the Promise (not the resolved value) means concurrent
// calls share the same loading operation instead of starting parallel loads.
// When the service worker restarts (killed after idle timeout), the cache is
// cleared but model weights come from Cache Storage, so reload is fast.
const pipelinePromises = {};

async function getTransformers() {
  // Dynamic import so missing vendor file produces a clear error at call-time,
  // not at module load time (which would break background.js startup entirely).
  try {
    return await import("../vendor/transformers.min.js");
  } catch (err) {
    throw new Error(
      "[LT] vendor/transformers.min.js not found. Run scripts/download-vendors.sh first."
    );
  }
}

function getPipeline(lang) {
  // Pick model by detected script.
  const modelId =
    lang === "chi_sim" || lang === "chi_tra" ? CDN.modelZh : CDN.modelJa;

  // Return the cached promise so concurrent callers all await the same load.
  if (pipelinePromises[modelId]) return pipelinePromises[modelId];

  pipelinePromises[modelId] = (async () => {
    await setModelStatus("loading", "Loading translation model…");

    const { pipeline, env } = await getTransformers();

    // Use bundled ONNX WASM files (downloaded by setup script into vendor/onnx/).
    env.backends.onnx.wasm.wasmPaths = self.chrome.runtime.getURL("vendor/onnx/");
    env.backends.onnx.wasm.numThreads = 1;
    // Use locally-bundled model weights (downloaded by setup script into vendor/models/).
    // This makes the extension 100% offline with no runtime network requests.
    env.localModelPath = self.chrome.runtime.getURL("vendor/models/");
    env.allowRemoteModels = false;
    env.useBrowserCache = false;

    const pipe = await pipeline("translation", modelId, {
      progress_callback: async (info) => {
        if (info.status === "initiate") {
          await setModelStatus("downloading", `Starting download: ${info.file ?? modelId}`);
        } else if (info.status === "downloading") {
          const pct =
            info.total > 0 ? Math.round((info.loaded / info.total) * 100) : null;
          await setModelStatus(
            "downloading",
            `Downloading ${info.file ?? "model"}… ${pct != null ? pct + "%" : ""}`,
            pct
          );
        } else if (info.status === "done") {
          await setModelStatus("loading", `Loaded: ${info.file ?? "model"}`);
        }
      },
    });

    await setModelStatus("ready", "Translation model ready");
    return pipe;
  })().catch((err) => {
    // Remove the cached promise so the next call retries from scratch.
    delete pipelinePromises[modelId];
    throw err;
  });

  return pipelinePromises[modelId];
}

export async function translate(text, detectedLang) {
  if (!text?.trim()) return "";
  try {
    const pipe = await getPipeline(detectedLang ?? "jpn");
    const [result] = await pipe(text, { max_new_tokens: 512 });
    return result?.translation_text ?? text;
  } catch (err) {
    // Log and return the original text so overlays still render something.
    console.error("[LT] Translation error:", err);
    await setModelStatus("error", String(err));
    return text;
  }
}

// Called by background.js on install to pre-warm the Japanese pipeline
// in the background so the first real translation is instant.
export async function preWarm() {
  try {
    await getPipeline("jpn");
  } catch (err) {
    await setModelStatus("error", `Model load failed: ${err?.message ?? err}`);
  }
}
