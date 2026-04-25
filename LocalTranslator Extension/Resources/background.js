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
});
