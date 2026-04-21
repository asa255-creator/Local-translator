// lib/translator.js — sends translation requests to the local Node.js server.
//
// The heavy ML inference (ONNX / opus-mt) runs in a Node.js process started
// by scripts/start-server.sh.  This file is a thin fetch wrapper; there is no
// WASM, no model loading, and no service-worker limitations to worry about.
//
// Server must be running at http://127.0.0.1:7070 before translations work.
// Start it with:  ./scripts/start-server.sh

const SERVER = 'http://127.0.0.1:7070';
const TIMEOUT_MS = 60_000;

async function setStatus(phase, label) {
  try {
    await chrome.storage.local.set({
      lt_modelStatus: { phase, label, pct: null, updatedAt: Date.now() },
    });
  } catch (_) {}
}

export async function translate(text, lang) {
  if (!text?.trim()) return '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const resp = await fetch(`${SERVER}/translate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, lang: lang ?? 'jpn' }),
      signal:  ctrl.signal,
    });
    clearTimeout(timer);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error);
    return data.text;
  } catch (err) {
    const offline = err.name === 'TypeError' || err.name === 'AbortError';
    await setStatus('error', offline
      ? 'Translation server offline — run: ./scripts/start-server.sh'
      : `Translation error: ${err.message}`);
    return text;
  }
}

// Check whether the server is reachable. Returns { ok, models } or throws.
export async function checkServer() {
  const resp = await fetch(`${SERVER}/status`, {
    signal: AbortSignal.timeout(2_000),
  });
  return resp.json();
}

// Called on extension install — checks server and writes status to storage.
export async function preWarm() {
  try {
    const { models } = await checkServer();
    const jaReady = models.some((m) => m.includes('ja'));
    await setStatus('ready', jaReady
      ? 'Server ready · model warm'
      : 'Server running · model loading…');
  } catch {
    await setStatus('error', 'Translation server offline — run: ./scripts/start-server.sh');
  }
}
