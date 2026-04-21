#!/usr/bin/env node
// translation-server.mjs — local HTTP translation server.
//
// Runs the opus-mt ONNX models in Node.js (native ONNX bindings — no WASM,
// no browser quirks) and exposes a tiny HTTP API on localhost:7070.
// The Safari extension fetches this instead of running inference in-browser.
//
// Usage:  ./scripts/start-server.sh
//
// Endpoints:
//   GET  /status         — { ok, models: [...loaded model IDs] }
//   POST /translate      — body: { text, lang }  → { ok, text }

import http   from 'http';
import path   from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = 7070;
const HOST      = '127.0.0.1';
const MODELS_DIR = path.resolve(__dirname, '../LocalTranslator Extension/Resources/vendor/models');

const MODEL_JA = 'Xenova/opus-mt-ja-en';
const MODEL_ZH = 'Xenova/opus-mt-zh-en';

// ── Load Transformers.js ──────────────────────────────────────────────────────

let pipeline, env;
try {
  ({ pipeline, env } = await import('@xenova/transformers'));
} catch (err) {
  console.error('\n✗ Cannot load @xenova/transformers — did you run npm install?\n', err.message);
  process.exit(1);
}

// Point to the already-downloaded vendor/models directory.
// allowRemoteModels = false ensures no network requests are made at runtime.
env.localModelPath  = MODELS_DIR + path.sep;
env.allowRemoteModels = false;
env.useBrowserCache   = false;

// ── Pipeline cache ────────────────────────────────────────────────────────────

const pipes = {};

function progressCallback(modelId) {
  return (info) => {
    if (info.status === 'initiate') {
      console.log(`  loading ${info.file ?? modelId}…`);
    } else if (info.status === 'done') {
      console.log(`  ✓ ${info.file ?? modelId}`);
    }
  };
}

function getPipe(modelId) {
  // Cache the Promise itself so concurrent callers await the same load
  // instead of starting multiple parallel pipeline instances.
  if (pipes[modelId]) return pipes[modelId];

  const label = modelId === MODEL_ZH ? 'Chinese→English' : 'Japanese→English';
  const t0 = Date.now();
  console.log(`\nLoading ${label} model…`);

  pipes[modelId] = pipeline('translation', modelId, {
    quantized: false,              // use encoder_model.onnx, not _quantized.onnx
    progress_callback: progressCallback(modelId),
  }).then((pipe) => {
    console.log(`✓ ${label} ready (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
    return pipe;
  }).catch((err) => {
    delete pipes[modelId];         // allow retry on next request
    throw err;
  });

  return pipes[modelId];
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  // GET /status
  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, { ok: true, models: Object.keys(pipes) });
  }

  // POST /translate
  if (req.method === 'POST' && req.url === '/translate') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { text, lang } = JSON.parse(body);
        if (!text?.trim()) return json(res, 200, { ok: true, text: '' });
        const modelId = (lang === 'chi_sim' || lang === 'chi_tra') ? MODEL_ZH : MODEL_JA;
        const pipe    = await getPipe(modelId);
        const [result] = await pipe(text, { max_new_tokens: 512 });
        return json(res, 200, { ok: true, text: result.translation_text ?? text });
      } catch (err) {
        console.error('[translate error]', err.message);
        return json(res, 500, { ok: false, error: err.message });
      }
    });
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Local Translator — translation server');
  console.log(`  http://${HOST}:${PORT}`);
  console.log('  Leave this window open while using Safari.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

// Pre-warm Japanese model immediately so the first request is instant.
getPipe(MODEL_JA).catch((err) => {
  console.error('\n✗ Model load failed:', err.message);
  console.error('  Make sure you ran: ./scripts/download-vendors.sh\n');
});
