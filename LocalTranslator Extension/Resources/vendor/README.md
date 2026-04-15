# vendor/

Third-party binary assets live here. They are **not committed** (see `.gitignore`).
Run the download script once after cloning:

```bash
./scripts/download-vendors.sh
```

## What the script downloads

| Path | Source | Size | Notes |
|---|---|---|---|
| `tesseract/tesseract.min.js` | jsDelivr (tesseract.js@4) | ~0.5 MB | UMD library |
| `tesseract/worker.min.js` | jsDelivr (tesseract.js@4) | ~0.3 MB | Worker bootstrap |
| `tesseract/tesseract-core.wasm.js` | jsDelivr (tesseract.js-core@4) | ~15 MB | WASM engine |
| `traineddata/jpn.traineddata` | tessdata.projectnaptha.com | ~25 MB | Japanese OCR model |
| `traineddata/chi_sim.traineddata` | tessdata.projectnaptha.com | ~20 MB | Simplified Chinese |
| `traineddata/chi_tra.traineddata` | tessdata.projectnaptha.com | ~20 MB | Traditional Chinese |
| `transformers.min.js` | jsDelivr (@xenova/transformers@2.17.2) | ~1 MB | NMT library for service worker |

## What is NOT pre-downloaded (auto-fetched on first use)

| Asset | Source | Size | Cached where |
|---|---|---|---|
| ONNX Runtime WASM files | jsDelivr | ~20 MB | Extension Cache Storage |
| Helsinki-NLP/opus-mt-ja-en weights | Hugging Face | ~75 MB | Extension Cache Storage |
| Helsinki-NLP/opus-mt-zh-en weights | Hugging Face | ~75 MB | Extension Cache Storage |

These are fetched by the background service worker on first translation use and
cached in the **extension's own Cache Storage** (shared across all pages, downloaded
exactly once regardless of how many sites the user visits).

## All paths are chrome-extension:// URLs at runtime

Tesseract files are loaded by `lib/ocr.js` via `chrome.runtime.getURL()`. No CDN
traffic happens during OCR. `transformers.min.js` is imported by `background.js`
as a local extension module — also no CDN traffic for the library itself.
