// lib/translator.js — sends translation requests to the native Swift handler via
// Safari's native-messaging API.  All inference runs on-device using Apple's
// Translation framework (macOS 15+).  No network calls are made.

const APP_ID = 'com.example.LocalTranslator';

// Safari's primary WebExtensions namespace is `browser`; `chrome` is a compat shim.
// Use browser for native messaging since that is the Safari-native API.
const _api = self.browser ?? self.chrome;

async function setStatus(phase, label) {
  try {
    await _api.storage.local.set({
      lt_modelStatus: { phase, label, pct: null, updatedAt: Date.now() },
    });
  } catch (_) {}
}

// Wrap Safari's callback-based sendNativeMessage in a Promise.
function nativeMessage(payload) {
  return new Promise((resolve, reject) => {
    _api.runtime.sendNativeMessage(APP_ID, payload, (response) => {
      const err = _api.runtime.lastError;
      if (err) {
        reject(new Error(err.message ?? 'Native message failed'));
      } else {
        resolve(response);
      }
    });
  });
}

export async function ocr(url, referer) {
  try {
    const response = await nativeMessage({ type: 'ocr', url, referer: referer ?? '' });
    return response ?? { ok: false, error: 'No response' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function translate(text, lang) {
  if (!text?.trim()) return '';
  try {
    const response = await nativeMessage({
      type: 'translate',
      text,
      lang: lang ?? 'jpn',
    });
    if (!response?.ok) {
      const msg = response?.error ?? 'Translation failed';
      await setStatus('error', msg);
      return text;
    }
    return response.text ?? text;
  } catch (err) {
    await setStatus('error', `Translation error: ${err.message}`);
    return text;
  }
}

// Ping the native handler to confirm it is reachable and macOS 15 is available.
export async function checkNative() {
  try {
    const response = await nativeMessage({ type: 'ping' });
    return response ?? { ok: false, error: 'No response from native handler' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Called on extension install — sets the initial translation status banner.
export async function preWarm() {
  const result = await checkNative();
  if (result.ok) {
    await setStatus('ready', 'Translation: Apple on-device · fully offline');
  } else {
    const msg = (result.error ?? '').includes('macOS 15')
      ? 'Requires macOS 15 Sequoia — upgrade to enable translation'
      : `Translation unavailable: ${result.error ?? 'unknown error'}`;
    await setStatus('error', msg);
  }
}
