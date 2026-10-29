import AppKit
import Foundation

// LaunchServices gives this ad-hoc signed test application its own TCC identity.
// It never edits the permission database or grants permissions to itself.
final class PermissionProbe: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = CommandLine.arguments
        DispatchQueue.global().async {
            do {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: args[1])
                process.arguments = ["-I", "-S", "-B", args[2], "--permission-probe", args[3], args[4], args[5]]
                process.standardInput = FileHandle.nullDevice
                process.standardOutput = FileHandle.nullDevice
                process.standardError = FileHandle.nullDevice
                try process.run()
                process.waitUntilExit()
                if process.terminationStatus != 0 {
                    let data = try JSONSerialization.data(withJSONObject: ["ok": false, "exit_code": process.terminationStatus])
                    try data.write(to: URL(fileURLWithPath: args[5]), options: .atomic)
                }
            } catch {
                let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "error": String(describing: error)])
                try? data?.write(to: URL(fileURLWithPath: args[5]), options: .atomic)
            }
            DispatchQueue.main.async { NSApplication.shared.terminate(nil) }
        }
    }
}

@main
@MainActor
struct PermissionApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = PermissionProbe()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}
