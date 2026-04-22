// SafariWebExtensionHandler.swift — native message bridge between the Safari
// web extension (JavaScript) and Apple's Translation framework (Swift).
//
// Messages arrive from background.js via browser.runtime.sendNativeMessage().
// Supported message types:
//   { type: "ping" }                          → { ok: true, engine: "apple" }
//   { type: "translate", text, lang }         → { ok: true, text: "..." }
//                                          or → { ok: false, error: "..." }

import SafariServices
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

        default:
            finish(context, ["ok": true])
        }
    }

    // MARK: - Private

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
