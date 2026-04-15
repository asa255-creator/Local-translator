# Local Translator — Safari Extension

Translates Japanese and Chinese text inside images (manga speech bubbles, signs, screenshots) directly in Safari. No account, no subscription, no cloud — everything runs on your Mac.

---

## Quick start (macOS + Xcode required)

Paste this into Terminal:

```bash
git clone https://github.com/asa255-creator/Local-translator.git
cd Local-translator
./scripts/setup.sh
```

The script:
1. Downloads vendor files (~67 MB) from free CDNs
2. Generates an Xcode project automatically using Apple's `safari-web-extension-converter`
3. Opens Xcode so you can set your signing team and press ⌘R

After the app runs:
- **Safari → Settings → Extensions → enable Local Translator**
- Click the toolbar icon, flip the toggle
- On first translation: ~170 MB of neural MT model weights download once from Hugging Face, then the extension is **fully offline forever**

> **Requirements:** macOS, Xcode 12 or later (free, Mac App Store), a free Apple ID for signing.

---

## What it does

When toggled on, the extension scans every `<img>` on the page:

1. Draws each image to an offscreen canvas
2. Detects speech-bubble regions (light background + dark ink, heuristic flood-fill)
3. OCRs each region with Tesseract.js (Japanese / Simplified Chinese / Traditional Chinese)
4. Translates the recognised text with a Helsinki-NLP neural MT model (opus-mt)
5. Renders the English translation as a DOM overlay, masking the source text in-place

A language selector and rescan / clear-overlays controls are in the popup.

---

## Network policy

| What | Network access | When |
|---|---|---|
| OCR (Tesseract + traineddata) | **Never** | Vendor files bundled locally |
| Transformers.js library | **Never** | Vendor file bundled locally |
| ONNX Runtime WASM (~20 MB) | Once | First use → cached in extension Cache Storage |
| opus-mt-ja-en weights (~75 MB) | Once | First Japanese translation → cached |
| opus-mt-zh-en weights (~75 MB) | Once | First Chinese translation → cached |

The extension's Content Security Policy (`extension_pages`) only allows outbound connections to `cdn.jsdelivr.net` and `huggingface.co`. Content scripts (OCR) make no network requests at all. Run `./scripts/verify-offline.sh` to confirm at any time.

---

## Repository layout

```
Local-translator/
├── LocalTranslator Extension/
│   ├── SafariWebExtensionHandler.swift
│   ├── Info.plist
│   └── Resources/                    ← web extension bundle
│       ├── manifest.json             MV3, CSP restricts connect-src to 2 CDNs
│       ├── background.js             Service worker — owns translation pipeline
│       ├── content.js                Page script — OCR, bubble detection, overlay
│       ├── popup.html/css/js         Toolbar popup with toggle + model status
│       ├── overlay.css
│       ├── lib/
│       │   ├── model-manager.js      CDN constants + download status reporting
│       │   ├── ocr.js                Tesseract.js wrapper (content script)
│       │   ├── bubble-detector.js    Heuristic flood-fill detector
│       │   ├── translator.js         Transformers.js + opus-mt (service worker)
│       │   └── overlay.js            DOM overlay renderer
│       ├── dictionary/               Seed word lists (fallback / reference)
│       └── vendor/                   Binary assets — see vendor/README.md
├── LocalTranslator/                  macOS host app Swift files
├── scripts/
│   ├── setup.sh                  ← one-shot setup (clone → Xcode)
│   ├── download-vendors.sh           fetch Tesseract + traineddata + Transformers.js
│   └── verify-offline.sh             CI: fails if unexpected outbound URLs found
└── README.md
```

---

## Architecture

```
 User visits a page — extension is ON
           │
           ▼
     content.js
       │
       ├─► imageToCanvas()           draw <img> to offscreen canvas
       ├─► bubble-detector.js        flood-fill → candidate regions [{x,y,w,h}]
       ├─► ocr.js (Tesseract.js)     crop + recognise text in each region
       │     ↳ vendor/tesseract/     loaded from chrome-extension:// URL
       │     ↳ vendor/traineddata/   jpn / chi_sim / chi_tra (bundled)
       │
       └─► runtime.sendMessage({type:"TRANSLATE", text, lang})
                     │
                     ▼
             background.js  (service worker)
               └─► translator.js
                     ↳ vendor/transformers.min.js   (local)
                     ↳ Helsinki-NLP/opus-mt-*-en    (HuggingFace, cached)
                     returns English string
                     │
                     ▼
             content.js receives response
               └─► overlay.js        position <div> over image, paint translation
```

---

## Manual Xcode setup (alternative to setup.sh)

If you prefer to wire the project by hand:

1. In Xcode: **File → New → Project → macOS → Safari Extension App**. Name it `LocalTranslator`.
2. Replace Xcode's generated `LocalTranslator/` and `LocalTranslator Extension/` folders with the ones from this repo.
3. Make sure the extension target's **Copy Bundle Resources** build phase includes the entire `LocalTranslator Extension/Resources/` folder (as a folder reference, not individual files).
4. Run `./scripts/download-vendors.sh` first so the `vendor/` folder is populated.
5. Set your development team, press ⌘R.

---

## Quality expectations

- **OCR** — Tesseract is accurate on clean printed text; less reliable on stylised manga fonts. Accuracy improves with the `tessdata_best` models (swap `tessdata_fast` URLs in `download-vendors.sh`).
- **Translation** — Helsinki-NLP opus-mt produces grammatical English sentences, much better than the word-level seed dictionaries it replaces. Complex or idiomatic text may still be awkward.
- **Bubble detection** — heuristic (no ML). Works well on white speech bubbles; skips regions that don't match the light-background + dark-text profile.

---

## Re-running setup

The script is idempotent — running it again re-downloads vendor files and regenerates the Xcode project without losing your signing settings.

```bash
./scripts/setup.sh
```

To just refresh vendor files without regenerating the project:

```bash
./scripts/download-vendors.sh
```
