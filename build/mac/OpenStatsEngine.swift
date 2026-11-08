// OpenStatsEngine for macOS: the menu bar icon.
//
// The server (ose-server, next to this in Contents/MacOS) is a console program.
// This app runs it and lives in the menu bar with the logo, instead of opening
// it in Terminal:
//
// - The menu opens the entry page, the announcer view and the feed monitor,
//   copies the address for phones and tablets, and restarts the server.
// - "Show Console" opens a window with the server's output, titled with the
//   app's name. While it is open the app is in the Dock and Cmd-Tab too.
//   Opening the app again (from Finder or Launchpad) also shows it, and so does
//   the server stopping on its own, so the reason is never hidden.
// - Quit stops the server: its stdin is closed and it is sent SIGTERM, both of
//   which it takes as the signal to shut down cleanly, and we wait for it to go
//   (killing it after a few seconds) before quitting ourselves. If this app
//   dies, the closed stdin still stops it.
// - Arguments go to the server: open -a OpenStatsEngine --args --port 9000
//
// The server prints "Local : http://..." and "Network : http://..." lines;
// they are how we know where it is (see server.js).
//
// Built by build/package.mjs with swiftc, for Apple silicon and Intel.

import AppKit

private let appName = "OpenStatsEngine"
// The logo's colours, so the console looks like part of the app.
private let consoleBackground = NSColor(srgbRed: 0x0F / 255.0, green: 0x17 / 255.0, blue: 0x2A / 255.0, alpha: 1)
private let consoleText = NSColor(srgbRed: 0xE2 / 255.0, green: 0xE8 / 255.0, blue: 0xF0 / 255.0, alpha: 1)
// The console keeps the newest output only, so a server left running all
// season does not grow without end.
private let consoleMaxChars = 1_000_000

@main
struct OpenStatsEngineApp {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate {
    private enum State { case starting, running, stopping, stopped(String) }

    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu?
    private var serverMenu: NSMenu?
    private var window: NSWindow?
    private var textView: NSTextView?
    private let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    private var signalSource: DispatchSourceSignal?

    /// Whatever the app was opened with goes to the server. Older macOS adds a
    /// -psn_ argument of its own.
    private let serverArguments = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-psn_") }

    private var server: Process?
    private var serverInput: Pipe?
    private var exitWatch: DispatchSourceProcess?   // tells us when the server has exited
    private var exited = DispatchSemaphore(value: 0)
    private var state = State.starting
    private var generation = 0          // which start of the server events belong to
    private var pending = Data()        // output read but not yet a whole line
    private var outputEnded = false
    private var exitReason: String?     // set when the server process has ended
    private var finished = false
    private var localURL: String?
    private var networkURLs: [String] = []
    private var restartWhenStopped = false

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleGetInfoString"] as? String ?? appName
    }

    private var isRunning: Bool {
        if case .running = state { return true }
        return false
    }

    // MARK: - Starting up

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMainMenu()
        makeStatusItem()
        makeWindow()

        // Quit cleanly on SIGTERM (logging out, `kill`), so the server stops with us.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        source.resume()
        signalSource = source

        startServer()
    }

    private func makeStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = menuBarImage()
            button.toolTip = appName
        }
        let menu = NSMenu()
        menu.autoenablesItems = false
        menu.delegate = self
        item.menu = menu
        statusMenu = menu
        statusItem = item
        rebuild(menu)
    }

    /// The logo, drawn in the menu bar's own colour so it suits light and dark.
    private func menuBarImage() -> NSImage? {
        if let image = Bundle.main.image(forResource: "MenuBarIcon") {
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            return image
        }
        let icon = NSApp.applicationIconImage.copy() as? NSImage
        icon?.size = NSSize(width: 18, height: 18)
        return icon
    }

    private func makeWindow() {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 860, height: 540),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = appName
        w.isReleasedWhenClosed = false
        w.delegate = self
        w.minSize = NSSize(width: 480, height: 240)
        w.appearance = NSAppearance(named: .darkAqua)

        let scroll = NSTextView.scrollableTextView()
        scroll.drawsBackground = true
        scroll.backgroundColor = consoleBackground
        if let tv = scroll.documentView as? NSTextView {
            tv.isEditable = false
            tv.isSelectable = true
            tv.isRichText = false
            tv.drawsBackground = true
            tv.backgroundColor = consoleBackground
            tv.textColor = consoleText
            tv.font = font
            tv.textContainerInset = NSSize(width: 8, height: 8)
            textView = tv
        }
        w.contentView = scroll
        w.center()
        w.setFrameAutosaveName("Console")
        window = w
    }

    private func makeMainMenu() -> NSMenu {
        let main = NSMenu()

        let appMenu = NSMenu()
        _ = appMenu.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        _ = appMenu.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        _ = appMenu.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appItem = NSMenuItem()
        appItem.submenu = appMenu
        main.addItem(appItem)

        let server = NSMenu(title: "Server")
        server.autoenablesItems = false
        server.delegate = self
        let serverItem = NSMenuItem(title: "Server", action: nil, keyEquivalent: "")
        serverItem.submenu = server
        main.addItem(serverItem)
        serverMenu = server
        rebuild(server)

        let edit = NSMenu(title: "Edit")
        _ = edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        _ = edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editItem.submenu = edit
        main.addItem(editItem)

        let windowMenu = NSMenu(title: "Window")
        _ = windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        _ = windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let windowItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        return main
    }

    // MARK: - Menus

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild(menu)
    }

    private func rebuild(_ menu: NSMenu) {
        menu.removeAllItems()
        if menu === statusMenu {
            menu.addItem(label(version))
            menu.addItem(label(statusText))
            menu.addItem(.separator())
            addServerItems(to: menu)
            menu.addItem(.separator())
            menu.addItem(item("Show Console", #selector(showConsole), key: "l"))
            menu.addItem(.separator())
            menu.addItem(item("Quit \(appName)", #selector(NSApplication.terminate(_:)), key: "q", target: NSApp))
        } else {
            addServerItems(to: menu)
            menu.addItem(.separator())
            menu.addItem(label(statusText))
        }
    }

    private func addServerItems(to menu: NSMenu) {
        for (title, action, key) in [("Open Stats Entry", #selector(openEntry), "o"),
                                     ("Open Announcer View", #selector(openAnnouncer), ""),
                                     ("Open Feed Monitor", #selector(openMonitor), "")] {
            let i = item(title, action, key: key)
            i.isEnabled = isRunning
            menu.addItem(i)
        }
        if isRunning && !networkURLs.isEmpty {
            menu.addItem(.separator())
            menu.addItem(label("For phones and tablets on this Wi-Fi:"))
            for url in networkURLs {
                let copy = item("Copy \(url)", #selector(copyAddress(_:)))
                copy.representedObject = url
                menu.addItem(copy)
            }
        }
        menu.addItem(.separator())
        let restart = item(server == nil ? "Start Server" : "Restart Server", #selector(restartServer))
        if case .stopping = state { restart.isEnabled = false }
        menu.addItem(restart)
    }

    private var statusText: String {
        switch state {
        case .starting: return "Starting the server…"
        case .running: return "Running at \(networkURLs.first ?? localURL ?? "")"
        case .stopping: return "Stopping the server…"
        case .stopped(let why): return why
        }
    }

    private func item(_ title: String, _ action: Selector, key: String = "", target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = target ?? self
        return i
    }

    private func label(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    private func refresh() {
        statusItem?.button?.appearsDisabled = !isRunning
        if let menu = serverMenu { rebuild(menu) }
    }

    // MARK: - Actions

    @objc private func openEntry() { openPage("/") }
    @objc private func openAnnouncer() { openPage("/announcer") }
    @objc private func openMonitor() { openPage("/monitor") }

    private func openPage(_ path: String) {
        guard let base = localURL, let url = URL(string: base + path) else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func copyAddress(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? String else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }

    @objc private func showConsole() {
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func restartServer() {
        if server == nil {
            appendLog("\n—— Starting again ——\n\n")
            startServer()
        } else {
            restartWhenStopped = true
            stopServer()
        }
    }

    // Back to the menu bar only once the console is closed.
    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    // Opening the app while it is already running shows the console.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showConsole()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Stop the server before going, and wait for it here. Not with
    /// .terminateLater: while that waits, AppKit runs only its modal run loop
    /// mode, in which Process never reports that the server has exited.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let p = server else { return .terminateNow }
        let pid = p.processIdentifier
        try? serverInput?.fileHandleForWriting.close()
        serverInput = nil
        if p.isRunning { p.terminate() }
        if exited.wait(timeout: .now() + 4) == .timedOut {
            kill(pid, SIGKILL)
            _ = exited.wait(timeout: .now() + 2)
        }
        generation += 1  // whatever the old server still reports, we are done with it
        server = nil
        return .terminateNow
    }

    // MARK: - The server

    private func startServer() {
        generation += 1
        let gen = generation
        pending = Data()
        outputEnded = false
        exitReason = nil
        finished = false
        localURL = nil
        networkURLs = []
        state = .starting

        guard let exe = Bundle.main.url(forAuxiliaryExecutable: "ose-server") else {
            serverFailed("The server (ose-server) is missing from the app. Download OpenStatsEngine again.")
            return
        }
        let p = Process()
        p.executableURL = exe
        p.arguments = serverArguments
        var env = ProcessInfo.processInfo.environment
        env["OSE_HOSTED"] = "mac"
        p.environment = env
        let output = Pipe()
        let input = Pipe()
        p.standardOutput = output
        p.standardError = output
        p.standardInput = input

        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                DispatchQueue.main.async { self?.outputDidEnd(generation: gen) }
            } else {
                DispatchQueue.main.async { self?.received(data, generation: gen) }
            }
        }
        p.terminationHandler = { [weak self] process in
            let reason = process.terminationReason == .uncaughtSignal
                ? "The server was stopped."
                : "The server stopped (exit code \(process.terminationStatus))."
            DispatchQueue.main.async { self?.serverDidExit(generation: gen, reason: reason) }
        }

        do {
            try p.run()
        } catch {
            output.fileHandleForReading.readabilityHandler = nil
            serverFailed("Could not start the server: \(error.localizedDescription)")
            return
        }
        server = p
        serverInput = input

        // Our own watch on the server's exit, on a queue of its own, so quitting
        // can wait for it on the main thread.
        let done = DispatchSemaphore(value: 0)
        exited = done
        exitWatch?.cancel()
        let watch = DispatchSource.makeProcessSource(identifier: p.processIdentifier, eventMask: .exit,
                                                     queue: DispatchQueue.global(qos: .userInitiated))
        watch.setEventHandler { [weak self] in
            done.signal()
            DispatchQueue.main.async { self?.processDidExit(generation: gen) }
        }
        watch.resume()
        exitWatch = watch
        refresh()
    }

    private func serverFailed(_ message: String) {
        state = .stopped("The server is not running.")
        appendLog(message + "\n")
        refresh()
        showConsole()
    }

    /// Ask the server to stop, and make sure of it if it has not after a few seconds.
    private func stopServer() {
        guard let p = server else { return }
        state = .stopping
        refresh()
        try? serverInput?.fileHandleForWriting.close()
        serverInput = nil
        if p.isRunning { p.terminate() }
        let gen = generation
        let pid = p.processIdentifier
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self = self, self.generation == gen, self.server != nil else { return }
            kill(pid, SIGKILL)
        }
    }

    private func received(_ data: Data, generation gen: Int) {
        guard gen == generation else { return }
        pending.append(data)
        guard let newline = pending.lastIndex(of: 0x0A) else { return }
        let text = String(decoding: pending[pending.startIndex...newline], as: UTF8.self)
        pending = Data(pending[pending.index(after: newline)...])
        show(text)
    }

    private func show(_ text: String) {
        appendLog(text)
        for line in text.split(separator: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            guard let start = t.range(of: "http://")?.lowerBound else { continue }
            let url = String(t[start...].prefix { $0 != " " })
            if t.hasPrefix("Local") {
                localURL = url
                state = .running
                refresh()
            } else if t.hasPrefix("Network") && !networkURLs.contains(url) {
                networkURLs.append(url)
                refresh()
            }
        }
    }

    /// The exit as our own watch saw it. Process's termination handler, which
    /// has the exit code, is preferred, but is given only a moment to arrive.
    private func processDidExit(generation gen: Int) {
        guard gen == generation else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, gen == self.generation else { return }
            if self.exitReason == nil { self.exitReason = "The server stopped." }
            self.finish(generation: gen, force: true)
        }
    }

    private func outputDidEnd(generation gen: Int) {
        guard gen == generation else { return }
        outputEnded = true
        finish(generation: gen)
    }

    private func serverDidExit(generation gen: Int, reason: String) {
        guard gen == generation else { return }
        exitReason = reason
        // Wait for the last of its output before saying it stopped, but not forever.
        if outputEnded {
            finish(generation: gen)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                self?.finish(generation: gen, force: true)
            }
        }
    }

    private func finish(generation gen: Int, force: Bool = false) {
        guard gen == generation, !finished, let reason = exitReason, outputEnded || force else { return }
        finished = true
        if !pending.isEmpty {
            show(String(decoding: pending, as: UTF8.self) + "\n")
            pending = Data()
        }
        server = nil
        serverInput = nil
        exitWatch?.cancel()
        exitWatch = nil

        if restartWhenStopped {
            restartWhenStopped = false
            appendLog("\n—— Restarting ——\n\n")
            startServer()
            return
        }
        // It stopped on its own: say so, and show why.
        state = .stopped(reason)
        appendLog("\n\(reason) Use Start Server in the menu bar to start it again.\n")
        refresh()
        showConsole()
    }

    // MARK: - The console

    private func appendLog(_ text: String) {
        guard let tv = textView, let storage = tv.textStorage else { return }
        let atBottom = isScrolledToBottom(tv)
        storage.append(NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: consoleText]))
        if storage.length > consoleMaxChars {
            let keepFrom = storage.length - consoleMaxChars / 2
            let cut = (storage.string as NSString).lineRange(for: NSRange(location: keepFrom, length: 0)).location
            storage.deleteCharacters(in: NSRange(location: 0, length: cut))
        }
        if atBottom { tv.scrollToEndOfDocument(nil) }
    }

    /// Follow new output, unless the operator has scrolled up to read something.
    private func isScrolledToBottom(_ tv: NSTextView) -> Bool {
        guard let clip = tv.enclosingScrollView?.contentView else { return true }
        return clip.documentVisibleRect.maxY >= tv.bounds.maxY - 24
    }
}
