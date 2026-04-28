// TranslationBridge.swift — routes translation requests from the Safari extension
// into Apple's on-device Translation framework (macOS 15+).
//
// Architecture:
//   JS sendNativeMessage → SafariWebExtensionHandler → TranslationBridge.translate()
//
// Per language pair we keep one hidden 1×1 off-screen NSWindow that hosts a
// SwiftUI view.  That view uses .translationTask to obtain a TranslationSession,
// then processes requests forwarded through an AsyncStream.  The window is never
// visible; it only exists to satisfy SwiftUI's view-lifecycle requirement for
// TranslationSession.

import Foundation
import AppKit
import SwiftUI
import Translation
import os.log

private let log = Logger(subsystem: "com.example.LocalTranslator", category: "TranslationBridge")

// MARK: - Shared request type

@available(macOS 15.0, *)
struct TranslationRequest: Sendable {
    let text: String
    let continuation: CheckedContinuation<String, Error>
}

// MARK: - Bridge singleton (MainActor so SwiftUI calls are safe)

@available(macOS 15.0, *)
@MainActor
final class TranslationBridge {

    static let shared = TranslationBridge()
    private init() {}

    private var autoHost: LanguageSessionHost?   // source = nil → Apple auto-detects
    private var jaHost:   LanguageSessionHost?
    private var zhHost:   LanguageSessionHost?

    func translate(text: String, lang: String) async throws -> String {
        guard !text.isEmpty else { return "" }
        let host = langHost(for: lang)
        return try await host.translate(text)
    }

    private func langHost(for lang: String) -> LanguageSessionHost {
        switch lang {
        case "chi_sim", "chi_tra":
            if zhHost == nil { zhHost = LanguageSessionHost(sourceLang: Locale.Language(identifier: "zh")) }
            return zhHost!
        case "jpn":
            if jaHost == nil { jaHost = LanguageSessionHost(sourceLang: Locale.Language(identifier: "ja")) }
            return jaHost!
        default: // "auto" or anything unrecognised — let Apple detect the source
            if autoHost == nil { autoHost = LanguageSessionHost(sourceLang: nil) }
            return autoHost!
        }
    }
}

// MARK: - Per-language session host

@available(macOS 15.0, *)
@MainActor
final class LanguageSessionHost {

    private var streamContinuation: AsyncStream<TranslationRequest>.Continuation?
    private let requestStream: AsyncStream<TranslationRequest>
    private var window: NSPanel?            // retain to keep SwiftUI lifecycle alive

    init(sourceLang: Locale.Language?) {
        var cont: AsyncStream<TranslationRequest>.Continuation!
        requestStream = AsyncStream(TranslationRequest.self, bufferingPolicy: .unbounded) {
            cont = $0
        }
        streamContinuation = cont

        spawnWorkerWindow(sourceLang: sourceLang, stream: requestStream)
    }

    private func spawnWorkerWindow(sourceLang: Locale.Language?, stream: AsyncStream<TranslationRequest>) {
        let target = Locale.Language(identifier: "en")
        let workerView = TranslationWorkerView(source: sourceLang, target: target, requests: stream)

        // NSPanel with .nonactivatingPanel never steals focus or activates the host app.
        // alphaValue=0 makes it invisible. orderFront is still required so SwiftUI's
        // onAppear fires and .translationTask activates.
        let win = NSPanel(
            contentRect: NSRect(x: -50000, y: -50000, width: 1, height: 1),
            styleMask:   [.borderless, .nonactivatingPanel],
            backing:     .buffered,
            defer:       false
        )
        win.isReleasedWhenClosed     = false
        win.isFloatingPanel          = true
        win.hidesOnDeactivate        = false
        win.isExcludedFromWindowsMenu = true
        win.collectionBehavior       = [.canJoinAllSpaces, .transient, .ignoresCycle, .stationary]
        win.ignoresMouseEvents       = true
        win.hasShadow                = false
        win.alphaValue               = 0
        win.backgroundColor          = .clear
        win.isOpaque                 = false
        win.contentViewController    = NSHostingController(rootView: workerView)
        win.orderFront(nil)
        window = win

        let langLabel = sourceLang.map { $0.languageCode?.identifier ?? "?" } ?? "auto"
        log.info("Created translation worker window for source=\(langLabel)")
    }

    func translate(_ text: String) async throws -> String {
        return try await withCheckedThrowingContinuation { continuation in
            streamContinuation?.yield(TranslationRequest(text: text, continuation: continuation))
        }
    }

    deinit {
        streamContinuation?.finish()
        let w = window
        DispatchQueue.main.async { w?.close() }
    }
}

// MARK: - SwiftUI view that holds the TranslationSession alive

@available(macOS 15.0, *)
private struct TranslationWorkerView: View {

    let source:   Locale.Language?   // nil → Apple auto-detects source language
    let target:   Locale.Language
    let requests: AsyncStream<TranslationRequest>

    @State private var config: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .translationTask(config) { session in
                // This closure runs in a long-lived Task for the lifetime of the view.
                // It drains the AsyncStream, translating each request in turn.
                for await req in requests {
                    do {
                        let response = try await session.translate(req.text)
                        req.continuation.resume(returning: response.targetText)
                    } catch {
                        log.error("Translation error: \(error.localizedDescription)")
                        req.continuation.resume(throwing: error)
                    }
                }
            }
            .onAppear {
                guard config == nil else { return }
                config = TranslationSession.Configuration(source: source, target: target)
            }
    }
}
