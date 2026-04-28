import SafariServices
import Vision
import os.log

private let log = Logger(subsystem: "com.example.LocalTranslator", category: "ExtensionHandler")

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        guard
            let item    = context.inputItems.first as? NSExtensionItem,
            let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any]
        else {
            finish(context, ["ok": true])
            return
        }

        log.debug("Received: \(String(describing: message))")
        let type = message["type"] as? String ?? ""

        switch type {
        case "ping":
            if #available(macOS 15.0, *) {
                finish(context, ["ok": true, "engine": "apple"])
            } else {
                finish(context, ["ok": false, "error": "macOS 15 required"])
            }

        case "translate":
            let text = message["text"] as? String ?? ""
            let lang = message["lang"] as? String ?? "jpn"
            handleTranslate(text: text, lang: lang, context: context)

        case "ocr":
            let url     = message["url"]     as? String ?? ""
            let referer = message["referer"] as? String ?? ""
            handleOCR(urlString: url, referer: referer, context: context)

        default:
            finish(context, ["ok": true])
        }
    }

    // MARK: - OCR

    private func handleOCR(urlString: String, referer: String, context: NSExtensionContext) {
        guard let url = URL(string: urlString) else {
            finish(context, ["ok": false, "error": "Invalid URL: \(urlString)"])
            return
        }

        Task {
            do {
                // Build a browser-like request so CDN hotlink protection passes.
                var req = URLRequest(url: url, timeoutInterval: 20)
                req.setValue(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18 Safari/605.1.15",
                    forHTTPHeaderField: "User-Agent"
                )
                if !referer.isEmpty {
                    req.setValue(referer, forHTTPHeaderField: "Referer")
                }

                let (data, response) = try await URLSession.shared.data(for: req)
                if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                    self.finish(context, ["ok": false, "error": "HTTP \(http.statusCode)"])
                    return
                }

                guard let cgImage = Self.cgImage(from: data) else {
                    self.finish(context, ["ok": false, "error": "Cannot decode image data (size: \(data.count) bytes)"])
                    return
                }

                let imgW = cgImage.width
                let imgH = cgImage.height
                let (observations, rawCount) = try await Self.recognizeText(in: cgImage)
                log.info("OCR: \(rawCount) raw / \(observations.count) kept in \(urlString) (\(imgW)×\(imgH))")
                self.finish(context, ["ok": true, "observations": observations,
                                      "imageWidth": imgW, "imageHeight": imgH, "rawCount": rawCount])

            } catch {
                log.error("OCR failed: \(error.localizedDescription)")
                self.finish(context, ["ok": false, "error": error.localizedDescription])
            }
        }
    }

    private static func cgImage(from data: Data) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(src, 0, nil)
    }

    // Returns (filtered observations, raw observation count before filtering).
    private static func recognizeText(in cgImage: CGImage) async throws -> ([[String: Any]], Int) {
        try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { req, err in
                if let err = err { continuation.resume(throwing: err); return }
                let obs = (req.results as? [VNRecognizedTextObservation]) ?? []
                let rawCount = obs.count
                let result: [[String: Any]] = obs.compactMap { o in
                    guard let top = o.topCandidates(1).first, top.confidence >= 0.1 else { return nil }
                    let b = o.boundingBox
                    return [
                        "text":       top.string,
                        "confidence": Double(top.confidence),
                        // Vision uses bottom-left origin; flip Y for top-left (CSS) origin.
                        "x": Double(b.minX),
                        "y": Double(1.0 - b.maxY),
                        "w": Double(b.width),
                        "h": Double(b.height),
                    ]
                }
                continuation.resume(returning: (result, rawCount))
            }
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["ja", "zh-Hant", "zh-Hans", "en-US"]
            request.usesLanguageCorrection = false

            do {
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }

    // MARK: - Translation

    private func handleTranslate(text: String, lang: String, context: NSExtensionContext) {
        guard !text.isEmpty else {
            finish(context, ["ok": true, "text": ""])
            return
        }
        guard #available(macOS 15.0, *) else {
            finish(context, ["ok": false, "error": "macOS 15 required for on-device translation"])
            return
        }
        Task { @MainActor in
            do {
                let result = try await TranslationBridge.shared.translate(text: text, lang: lang)
                self.finish(context, ["ok": true, "text": result])
            } catch {
                log.error("Translation failed: \(error.localizedDescription)")
                self.finish(context, ["ok": false, "error": error.localizedDescription])
            }
        }
    }

    private func finish(_ context: NSExtensionContext, _ payload: [String: Any]) {
        let item = NSExtensionItem()
        item.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }
}
