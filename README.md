# Local Translator - Safari Extension

A Safari browser extension that translates Japanese and Chinese text found in images directly in the browser — entirely offline, with no internet connection required.

## What It Does

When enabled, the extension scans images on the current webpage for Japanese or Chinese characters. It detects speech bubbles within those images, removes the original text, and replaces it with an English translation rendered in-place.

## Key Requirements

- **Fully offline** — no network requests are made at any point. All OCR, text detection, translation, and rendering happen locally on the device. Results may be less accurate than cloud-based alternatives, and that trade-off is acceptable.
- **Toggle on/off** — the extension can be enabled or disabled per-tab or globally via the Safari toolbar button.
- **Image scanning** — detects Japanese (hiragana, katakana, kanji) and Chinese (simplified/traditional) characters within `<img>` elements and other image content on the page.
- **Speech bubble detection** — attempts to identify speech bubble regions within images and targets those areas for text removal and replacement.
- **In-place replacement** — original text inside speech bubbles is erased and replaced with the English translation, preserving the visual layout of the image as closely as possible.

## Target Platform

- macOS Safari (extension)
- iOS/iPadOS Safari (extension, stretch goal)

## Offline Stack (Planned)

| Task | Approach |
|---|---|
| OCR / text detection | On-device ML (e.g. Vision framework, Tesseract, or bundled ONNX model) |
| Translation | Bundled offline translation model (e.g. quantized MarianMT or similar) |
| Speech bubble segmentation | Image processing / ML model bundled with the extension |
| Text rendering | Canvas API overlay or direct image manipulation |

## Status

Early planning stage. No code yet.