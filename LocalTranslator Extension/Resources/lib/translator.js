// lib/translator.js — neural machine translation via Transformers.js.
//
// THIS MODULE RUNS IN THE BACKGROUND SERVICE WORKER (background.js imports it).
// It does NOT run in content scripts.
//
// Safari's service worker BLOCKS dynamic import() entirely — "Dynamic-import is
// not available in Worklets or ServiceWorkers". We must use a static import
// instead. The path below is resolved at parse time (relative to this file's
// URL: lib/translator.js → ../vendor/transformers.min.js).
//
// If vendor/transformers.min.js is missing, the service worker will fail to
// start completely. Run scripts/download-vendors.sh first.
//
// Models used (Apache-2.0 / CC-BY-4.0):
//   Xenova/opus-mt-ja-en   (~75 MB, Japanese → English)
//   Xenova/opus-mt-zh-en   (~75 MB, Chinese → English)
//
// Models are bundled into vendor/models/ by download-vendors.sh so no
// network requests are needed at runtime.

import { pipeline, env } from "../vendor/transformers.min.js";
import { setModelStatus, CDN } from "./model-manager.js";

// Configure ONNX runtime and model paths at module init time.
// These must be set before the first pipeline() call.
env.backends.onnx.wasm.wasmPaths = self.chrome.runtime.getURL("vendor/onnx/");
env.backends.onnx.wasm.numThreads = 1;
env.localModelPath = self.chrome.runtime.getURL("vendor/models/");
env.allowRemoteModels = false;
env.useBrowserCache = false;

// One pipeline promise per language pair, cached for the service worker's
// lifetime. Storing the Promise (not the resolved value) means concurrent
// calls share the same loading operation instead of starting parallel loads.
const pipelinePromises = {};

function getPipeline(lang) {
  const modelId =
    lang === "chi_sim" || lang === "chi_tra" ? CDN.modelZh : CDN.modelJa;

  if (pipelinePromises[modelId]) return pipelinePromises[modelId];

  pipelinePromises[modelId] = (async () => {
    await setModelStatus("loading", "Loading translation model…");

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
