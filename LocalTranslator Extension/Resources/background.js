import { translate, preWarm } from "./lib/translator.js";

const api = self.browser ?? self.chrome;

api.runtime.onInstalled.addListener(() => {
  api.storage.local.remove(["lt_inject_error", "lt_cs_injected", "lt_cs_url", "lt_modelStatus"]);
  preWarm();
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "TRANSLATE") {
    translate(msg.text, msg.lang)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg?.type === "FETCH_IMAGE") {
    fetch(msg.url, { credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let b64 = "";
        for (let i = 0; i < bytes.length; i += 32768) {
          b64 += String.fromCharCode(...bytes.subarray(i, Math.min(i + 32768, bytes.length)));
        }
        sendResponse({ ok: true, b64: btoa(b64) });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
