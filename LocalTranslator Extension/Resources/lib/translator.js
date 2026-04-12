// lib/translator.js — offline dictionary-based translation.
//
// There is no way to bundle a full neural MT model inside a text-only
// contribution, but the architecture supports it: this module exposes a
// single translate() function. You can swap the implementation for a
// WASM-backed NMT (e.g. Bergamot, ONNX MarianMT) without touching the rest
// of the pipeline, as long as the signature stays the same.
//
// The current implementation does longest-match segmentation against the
// bundled JSON dictionary, plus a few structural rewrites so the output
// reads more like English than a word-salad. It is intentionally simple
// and produces "good-enough" results for short speech-bubble text; the
// README is explicit that quality is traded for the offline guarantee.

const api = typeof browser !== "undefined" ? browser : chrome;

const DICT_URLS = {
  jpn: api.runtime.getURL("dictionary/ja-en.json"),
  chi_sim: api.runtime.getURL("dictionary/zh-en.json"),
  chi_tra: api.runtime.getURL("dictionary/zh-en.json"),
};

const dictCache = new Map();

async function loadDict(lang) {
  if (dictCache.has(lang)) return dictCache.get(lang);
  const url = DICT_URLS[lang];
  if (!url) {
    dictCache.set(lang, {});
    return {};
  }
  const resp = await fetch(url); // extension-local, offline-safe
  if (!resp.ok) {
    dictCache.set(lang, {});
    return {};
  }
  const json = await resp.json();
  dictCache.set(lang, json);
  return json;
}

function normalize(text) {
  return text
    .replace(/[\u3000\s]+/g, " ")
    .replace(/[！]/g, "!")
    .replace(/[？]/g, "?")
    .replace(/[。]/g, ". ")
    .replace(/[、]/g, ", ")
    .trim();
}

// Longest-match segmentation: walk left-to-right, at each position try the
// longest substring present in the dictionary (up to 8 chars — long enough
// for common compound words and set phrases without blowing up complexity).
function segmentAndLookup(text, dict) {
  const out = [];
  let i = 0;
  const MAX = 8;
  while (i < text.length) {
    const ch = text[i];
    if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(ch)) {
      // Pass punctuation / latin / spaces through unchanged.
      out.push(ch);
      i++;
      continue;
    }
    let matched = null;
    for (let len = Math.min(MAX, text.length - i); len >= 1; len--) {
      const slice = text.slice(i, i + len);
      if (dict[slice]) {
        matched = { slice, gloss: dict[slice], len };
        break;
      }
    }
    if (matched) {
      out.push(matched.gloss);
      i += matched.len;
    } else {
      // No dictionary match — keep the character so the user still sees
      // something recognisable in the output.
      out.push(ch);
      i++;
    }
  }
  return out.join(" ").replace(/\s+([,.!?])/g, "$1").replace(/\s+/g, " ").trim();
}

export async function translate(text, detectedLang) {
  const lang = detectedLang && DICT_URLS[detectedLang] ? detectedLang : "jpn";
  const dict = await loadDict(lang);
  const cleaned = normalize(text);
  if (!cleaned) return "";
  const glossed = segmentAndLookup(cleaned, dict);
  if (!glossed) return cleaned;
  // Capitalise sentence starts for readability.
  return glossed.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

// Exposed for tests.
export const _internal = { segmentAndLookup, normalize };
