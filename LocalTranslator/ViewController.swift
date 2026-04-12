// ViewController.swift — minimal host-app UI.
// Explains to the user how to enable the bundled Safari extension in
// Safari's preferences.

import Cocoa
import SafariServices

class ViewController: NSViewController {

    override func viewDidLoad() {
        super.viewDidLoad()

        let label = NSTextField(wrappingLabelWithString:
            "Local Translator is a Safari extension.\n\n" +
            "1. Open Safari → Settings → Extensions\n" +
            "2. Enable \"Local Translator\"\n" +
            "3. Click the toolbar icon on any page to toggle it on.\n\n" +
            "All translation happens offline on this device."
        )
        label.alignment = .center
        label.font = NSFont.systemFont(ofSize: 13)
        label.translatesAutoresizingMaskIntoConstraints = false

        let button = NSButton(title: "Open Safari Extensions Preferences",
                              target: self, action: #selector(openPrefs))
        button.bezelStyle = .rounded
        button.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(label)
        view.addSubview(button)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.topAnchor.constraint(equalTo: view.topAnchor, constant: 40),
            label.widthAnchor.constraint(lessThanOrEqualToConstant: 420),

            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 20),
        ])
    }

    @objc private func openPrefs() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: "com.example.LocalTranslator.Extension"
        ) { error in
            if let error = error {
                NSLog("Failed to open Safari prefs: \(error)")
            }
        }
    }
}
