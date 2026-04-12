// SafariWebExtensionHandler.swift — required bridge between Safari and the
// bundled web extension. We don't use the native messaging channel for any
// business logic (the pipeline runs entirely in JavaScript/WASM inside the
// browser), so this handler just logs incoming messages for debugging and
// acknowledges them. No network calls are made.

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey]
        os_log(.default, "LocalTranslator extension received message: %@",
               String(describing: message))

        let response = NSExtensionItem()
        response.userInfo = [ SFExtensionMessageKey: [ "ok": true ] ]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
