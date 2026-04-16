// AppDelegate.swift — host app for the Local Translator Safari extension.
// The host app's only purpose is to carry the Safari Web Extension bundle so
// macOS can install it into Safari's preferences pane.

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let vc = ViewController()
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 280),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        win.center()
        win.title = "Local Translator"
        win.contentViewController = vc
        win.makeKeyAndOrderFront(nil)
        window = win
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}
