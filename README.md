# Local Translator - Safari Extension

A Safari browser extension that translates Japanese and Chinese text found in images directly in the browser — entirely offline, with no internet connection required.

## What It Does

When enabled, the extension scans images on the current webpage for Japanese or Chinese characters. It detects speech bubbles within those images, removes the original text, and replaces it with an English translation rendered in-place.

## Key Requirements

- **Fully offline** — no network requests are made at any point. All OCR, text detection, translation, and rendering happen locally on the device. Results may be less accurate than cloud-based alternatives, and that trade-off is acceptable. Enforced at three layers:
  1. The extension's Content Security Policy restricts `connect-src` to `'self'`.
  2. All assets (Tesseract WASM, traineddata, dictionaries) are bundled and loaded via `chrome-extension://` URLs.
  3. `scripts/verify-offline.sh` scans the bundle for any outbound URL as a CI gate.
- **Toggle on/off** — the extension can be enabled or disabled via the Safari toolbar button popup.
- **Image scanning** — detects Japanese (hiragana, katakana, kanji) and Chinese (simplified/traditional) characters within `<img>` elements.
- **Speech bubble detection** — identifies light-background regions containing dark ink and targets those areas.
- **In-place replacement** — translated English text is rendered in an overlay positioned exactly over each source bubble, masking the original text.

## Repository Layout

```
Local-translator/
├── LocalTranslator/                       # macOS host app (Xcode target)
│   ├── AppDelegate.swift
│   ├── ViewController.swift
│   └── Info.plist
├── LocalTranslator Extension/             # Safari Web Extension (Xcode target)
│   ├── SafariWebExtensionHandler.swift
│   ├── Info.plist
│   └── Resources/                         # The actual web extension bundle
│       ├── manifest.json                  # MV3 manifest, CSP locked to self
│       ├── background.js                  # Service worker
│       ├── content.js                     # Page-side orchestrator
│       ├── popup.html / popup.css / popup.js
│       ├── overlay.css
│       ├── lib/
│       │   ├── ocr.js                     # Tesseract.js wrapper (offline)
│       │   ├── bubble-detector.js         # Heuristic speech-bubble finder
│       │   ├── translator.js              # Dictionary-based translator
│       │   └── overlay.js                 # Renders translated text over image
│       ├── dictionary/
│       │   ├── ja-en.json                 # Japanese → English seed dictionary
│       │   └── zh-en.json                 # Chinese → English seed dictionary
│       ├── vendor/                        # (See "Binary assets" below)
│       └── icons/                         # PNG icons (16/48/128)
├── scripts/
│   └── verify-offline.sh                  # Fails CI if any http(s) URL leaks in
└── README.md
```

## Architecture

```
   [Safari page]
        │
        ▼
   content.js ─── reads storage.local ───► ON?
        │
        ▼ (if on)
   for each eligible <img>:
        ├─► imageToCanvas()      ── draws the img into a canvas (CORS-safe)
        ├─► bubble-detector.js   ── finds candidate speech-bubble regions
        │                           via thresholded flood-fill
        ├─► ocr.js               ── crops each region, runs Tesseract.js
        │                           with bundled jpn/chi_sim/chi_tra models
        ├─► translator.js        ── longest-match dictionary segmentation
        │                           against bundled JSON glossaries
        └─► overlay.js           ── positions a DOM overlay that matches the
                                    image rect; paints each translation in
                                    its bubble with auto-shrink font
```

## Setup

### 1. Clone and open in Xcode

You'll need to create the `.xcodeproj` yourself (easiest path — Xcode doesn't need a project file committed; the source layout matches what its Safari Extension template expects):

1. In Xcode, **File → New → Project → macOS → Safari Extension App**. Name it `LocalTranslator`, choose Swift.
2. Delete Xcode's generated `LocalTranslator/` and `LocalTranslator Extension/` folders from disk, then drag the folders from this repo into the two targets (keeping the same names). Check "Create groups" and assign files to the correct target.
3. Set the Safari Web Extension target's **Resources** phase to include the entire `LocalTranslator Extension/Resources/` directory as a folder reference so the `lib/`, `dictionary/`, and `vendor/` subfolders ship intact.

### 2. Drop in the binary assets

These cannot be distributed in a source repository for size/licensing reasons, so you fetch them **once, locally**, and commit or symlink them into the bundle:

| Destination | What | Where to get it |
|---|---|---|
| `LocalTranslator Extension/Resources/vendor/tesseract/tesseract.min.js` | Tesseract.js library | tesseract.js release artifact |
| `LocalTranslator Extension/Resources/vendor/tesseract/worker.min.js` | Tesseract.js worker | tesseract.js release artifact |
| `LocalTranslator Extension/Resources/vendor/tesseract/tesseract-core.wasm.js` | Tesseract.js WASM core | tesseract.js-core release artifact |
| `LocalTranslator Extension/Resources/vendor/traineddata/jpn.traineddata` | Japanese OCR model | `tessdata_fast` repo (Apache-2.0) |
| `LocalTranslator Extension/Resources/vendor/traineddata/chi_sim.traineddata` | Simplified Chinese model | `tessdata_fast` repo |
| `LocalTranslator Extension/Resources/vendor/traineddata/chi_tra.traineddata` | Traditional Chinese model | `tessdata_fast` repo |
| `LocalTranslator Extension/Resources/icons/icon-{16,48,128}.png` | Toolbar icons | any 1-bit/translucent icon you like |

After placing them on disk, re-run `./scripts/verify-offline.sh` to confirm none of the vendored files reference remote URLs at runtime.

### 3. Build & run

1. Select the `LocalTranslator` scheme in Xcode and press **Run**.
2. The host app opens; click *Open Safari Extensions Preferences*.
3. In Safari → Settings → Extensions, tick **Local Translator**. You may also need to enable "Allow unsigned extensions" in the Develop menu for local builds.
4. Click the toolbar icon → flip the toggle. Images on the active tab will be scanned and overlaid.

## Quality expectations

This project deliberately trades output quality for the offline guarantee.

- **OCR** is Tesseract — accurate on clean printed text, noisier on stylised manga fonts.
- **Translation** is dictionary-based (longest-match). It produces *gloss-style* English, not fluent prose. Swapping `lib/translator.js` for a bundled Bergamot / ONNX MarianMT model is the planned upgrade path — the rest of the pipeline is agnostic to the translator implementation as long as `translate(text, detectedLang)` returns a string.
- **Bubble detection** is heuristic (thresholded flood-fill). It handles typical white speech bubbles well and will skip regions that don't look like bubbles rather than producing false overlays.

## Offline verification

```bash
./scripts/verify-offline.sh
```

Fails with non-zero exit if it finds any `http://` or `https://` reference in the extension bundle (excluding Apple/W3C plist DTD identifiers and `localhost`). Wire this into CI before release.

## Status

Working first-pass implementation. Needs: vendored Tesseract.js + traineddata, icons, and an Xcode project to build the extension bundle. Dictionaries are a seed set — expand `dictionary/*.json` or replace the translator with an NMT model for better output.
