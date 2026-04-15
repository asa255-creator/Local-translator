// lib/model-manager.js — shared model-status store.
//
// Runs in the background service worker AND is readable by popup.js via
// chrome.storage.local.  Translation progress is written here by translator.js
// and displayed live in the popup through a storage.onChanged listener.
//
// Status object shape:
//   { phase: string, label: string, pct: number|null, updatedAt: number }
//
// Phases:
//   'idle'          — no model work in progress
//   'downloading'   — initial model / WASM download from CDN (one-time)
//   'loading'       — loading model weights from Cache Storage into WASM memory
//   'ready'         — pipeline is warm and ready
//   'error'         — something went wrong (label has the message)

const STATUS_KEY = "lt_modelStatus";

export async function setModelStatus(phase, label, pct = null) {
  const val = { phase, label, pct, updatedAt: Date.now() };
  await chrome.storage.local.set({ [STATUS_KEY]: val });
}

export async function getModelStatus() {
  const result = await chrome.storage.local.get(STATUS_KEY);
  return result[STATUS_KEY] ?? { phase: "idle", label: "Not yet used", pct: null };
}

// CDN locations — used by translator.js and download-vendors.sh alike.
// IMPORTANT: these are the ONLY URLs that may make network requests.
// Everything else in the pipeline is offline once the model is cached.
export const CDN = {
  transformers: "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js",
  onnxWasmBase: "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/",
  // Hugging Face model repo IDs (fetched by Transformers.js internals)
  modelJa: "Helsinki-NLP/opus-mt-ja-en",
  modelZh: "Helsinki-NLP/opus-mt-zh-en",
};
