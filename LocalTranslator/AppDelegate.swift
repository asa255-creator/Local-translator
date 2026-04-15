// AppDelegate.swift — host app for the Local Translator Safari extension.
// The host app does nothing interesting on its own; its only purpose is to
// carry the Safari Web Extension bundle so macOS can install the extension
// into Safari's preferences pane.

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {}
    func applicationWillTerminate(_ notification: Notification) {}
}
