import AppKit
import Foundation

@MainActor
final class Fixture: NSObject, NSApplicationDelegate {
    let args = CommandLine.arguments
    var window: NSWindow!
    var input: NSTextField!
    var multiline: NSTextView!
    var scroll: NSScrollView!
    var readonly: NSTextField!
    var password: NSSecureTextField!
    var result: NSTextField!
    var clicks = 0
    var timer: Timer?
    var blocker: Bool { args.count > 3 && args[3] == "--blocker" }

    func label(_ text: String, _ frame: NSRect, size: CGFloat = 20) -> NSTextField {
        let view = NSTextField(labelWithString: text)
        view.frame = frame
        view.font = NSFont.systemFont(ofSize: size)
        return view
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if blocker {
            let x = Double(args[4])!, y = Double(args[5])!
            let height = NSScreen.screens[0].frame.height
            window = NSPanel(contentRect: NSRect(x: x, y: height - y - 90, width: 170, height: 90),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.level = .floating
            window.backgroundColor = NSColor(srgbRed: 0.1, green: 0.8, blue: 0.2, alpha: 1)
            window.title = args[1]
            window.orderFrontRegardless()
        } else {
            let menu = NSMenu()
            let applicationItem = NSMenuItem()
            menu.addItem(applicationItem)
            let applicationMenu = NSMenu()
            applicationMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            applicationItem.submenu = applicationMenu
            let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
            menu.addItem(editItem)
            let editMenu = NSMenu(title: "Edit")
            let selectAll = NSMenuItem(title: "Select All", action: NSSelectorFromString("selectAll:"), keyEquivalent: "a")
            selectAll.keyEquivalentModifierMask = .command
            editMenu.addItem(selectAll)
            editItem.submenu = editMenu
            NSApplication.shared.mainMenu = menu
            window = NSWindow(contentRect: NSRect(x: 100, y: 120, width: 850, height: 630),
                              styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
            window.title = args[1]
            window.isReleasedWhenClosed = false
            let content = window.contentView!
            content.wantsLayer = true
            content.layer?.backgroundColor = NSColor.white.cgColor
            content.addSubview(label("DeskPilot Native Fixture", NSRect(x: 25, y: 563, width: 790, height: 45), size: 30))
            content.addSubview(label("自动化测试 中文识别", NSRect(x: 25, y: 515, width: 790, height: 40), size: 28))
            input = NSTextField(frame: NSRect(x: 25, y: 456, width: 620, height: 34))
            input.stringValue = "Initial native value"
            input.font = NSFont.systemFont(ofSize: 20)
            input.setAccessibilityIdentifier("input")
            input.setAccessibilityLabel("Input")
            content.addSubview(input)

            let apply = NSButton(title: "Apply", target: self, action: #selector(applyValue))
            apply.frame = NSRect(x: 665, y: 455, width: 145, height: 36)
            apply.bezelStyle = .rounded
            apply.setAccessibilityIdentifier("apply")
            content.addSubview(apply)
            result = label("Result: none", NSRect(x: 25, y: 404, width: 790, height: 38), size: 22)
            result.setAccessibilityIdentifier("result")
            content.addSubview(result)

            scroll = NSScrollView(frame: NSRect(x: 25, y: 273, width: 785, height: 115))
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            scroll.setAccessibilityIdentifier("scroll")
            multiline = NSTextView(frame: scroll.contentView.bounds)
            multiline.minSize = NSSize(width: 0, height: scroll.contentView.bounds.height)
            multiline.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
            multiline.isVerticallyResizable = true
            multiline.isHorizontallyResizable = false
            multiline.autoresizingMask = .width
            multiline.textContainer?.containerSize = NSSize(width: scroll.contentView.bounds.width, height: CGFloat.greatestFiniteMagnitude)
            multiline.textContainer?.widthTracksTextView = true
            multiline.string = "First line\nSecond line"
            multiline.font = NSFont.systemFont(ofSize: 20)
            multiline.isRichText = false
            multiline.setAccessibilityIdentifier("multiline")
            scroll.documentView = multiline
            content.addSubview(scroll)

            readonly = NSTextField(frame: NSRect(x: 25, y: 218, width: 785, height: 32))
            readonly.stringValue = "Read-only native value"
            readonly.isEditable = false
            readonly.isSelectable = true
            readonly.setAccessibilityIdentifier("readonly")
            content.addSubview(readonly)
            password = NSSecureTextField(frame: NSRect(x: 25, y: 160, width: 620, height: 32))
            password.setAccessibilityIdentifier("password")
            password.setAccessibilityLabel("Password")
            content.addSubview(password)
            let marker = NSView(frame: NSRect(x: 25, y: 25, width: 230, height: 95))
            marker.wantsLayer = true
            marker.layer?.backgroundColor = NSColor(srgbRed: 0.9, green: 0.1, blue: 0.2, alpha: 1).cgColor
            content.addSubview(marker)
            window.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
        writeState()
        timer = Timer.scheduledTimer(timeInterval: 0.1, target: self, selector: #selector(tick(_:)), userInfo: nil, repeats: true)
    }

    @objc func tick(_ timer: Timer) { writeState() }

    @objc func applyValue() {
        clicks += 1
        result.stringValue = "Result: " + input.stringValue
        writeState()
    }

    func writeState() {
        var state: [String: Any] = ["ready": true, "pid": ProcessInfo.processInfo.processIdentifier,
                                  "window_number": window.windowNumber, "blocker": blocker]
        if !blocker {
            state["input"] = input.stringValue
            state["input_editor"] = input.currentEditor()?.string ?? "<not editing>"
            state["input_selection_length"] = (input.currentEditor() as? NSTextView)?.selectedRange().length ?? 0
            state["multiline"] = multiline.string
            state["scroll_y"] = scroll.contentView.bounds.origin.y
            state["scroll_document_height"] = multiline.frame.height
            state["readonly"] = readonly.stringValue
            state["password_empty"] = password.stringValue.isEmpty
            state["result"] = result.stringValue
            state["clicks"] = clicks
            state["key_window"] = window.isKeyWindow
            if input.currentEditor() != nil && window.firstResponder === input.currentEditor() {
                state["focused"] = "input"
            } else if password.currentEditor() != nil && window.firstResponder === password.currentEditor() {
                state["focused"] = "password"
            } else {
                state["focused"] = "other"
            }
        }
        if let data = try? JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: args[2]), options: .atomic)
        }
    }
}

@main
@MainActor
struct FixtureApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = Fixture()
        app.delegate = delegate
        app.setActivationPolicy(delegate.blocker ? .accessory : .regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
