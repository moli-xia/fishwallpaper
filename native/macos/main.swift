// 碧池观鱼 · macOS 桌面动态壁纸
// Borderless windows one level above the desktop picture (below the icons) render the pond
// on every space of every screen; a transparent window above the desktop icons passes clicks on the
// pond's own controls through to it. A menu-bar item controls the app, and a normal window
// opens the pond for interaction and settings. All web views share one local-storage store,
// and every save one of them makes is passed straight on to the others, so they stay in step.
import Cocoa
import ServiceManagement
import WebKit

// The wallpaper takes key status while one of its panels is open, so the naming and city fields accept typing.
final class WallpaperWindow: NSWindow {
  override var canBecomeKey: Bool { true }
}

// Finder's desktop window lies over every screen above the wallpaper (it holds the desktop icons and
// drag-selection), so the wallpaper itself never receives a click. This view fills a transparent window
// just below ordinary app windows; while the cursor is over the pond's controls it catches the mouse and
// hands each event to the wallpaper page. Both windows cover the same screen, so points carry over unchanged.
final class ClickCatcher: NSView {
  weak var target: WKWebView?
  var onRelease: (() -> Void)?
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    for area in trackingAreas { removeTrackingArea(area) }
    addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .activeAlways, .inVisibleRect], owner: self))
  }
  private func relay(_ e: NSEvent, _ deliver: (WKWebView, NSEvent) -> Void) {
    guard let web = target, let window = web.window,
      let event = NSEvent.mouseEvent(
        with: e.type, location: e.locationInWindow, modifierFlags: e.modifierFlags, timestamp: e.timestamp,
        windowNumber: window.windowNumber, context: nil, eventNumber: e.eventNumber, clickCount: e.clickCount,
        pressure: e.pressure)
    else { return }
    deliver(web, event)
  }
  override func mouseDown(with e: NSEvent) { relay(e) { $0.mouseDown(with: $1) } }
  override func mouseUp(with e: NSEvent) { relay(e) { $0.mouseUp(with: $1) }; onRelease?() }
  override func mouseDragged(with e: NSEvent) { relay(e) { $0.mouseDragged(with: $1) } }
  override func mouseMoved(with e: NSEvent) { relay(e) { $0.mouseMoved(with: $1) } }
  override func rightMouseDown(with e: NSEvent) {}
  override func scrollWheel(with e: NSEvent) { target?.scrollWheel(with: e) }
}

// One screen's wallpaper: the pond page, the click catcher above the desktop icons, and what the page reports.
final class Pane {
  let window: WallpaperWindow, webView: WKWebView, overlay: NSWindow, catcher: ClickCatcher, screen: NSScreen
  var rects: [CGRect] = []  // the pond's controls, in screen coordinates
  var hot = false  // cursor over a control: the catcher takes the mouse
  var modal = false  // a panel is open: the whole wallpaper is lifted above the icons and takes the keyboard
  init(window: WallpaperWindow, webView: WKWebView, overlay: NSWindow, catcher: ClickCatcher, screen: NSScreen) {
    self.window = window; self.webView = webView; self.overlay = overlay; self.catcher = catcher; self.screen = screen
  }
}

// WKUserContentController retains its handlers; this keeps it from retaining the app delegate.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ target: WKScriptMessageHandler) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private var wallpaper: [Pane] = []
  private var mouseMonitors: [Any] = []
  // The wallpaper's own level, just above the desktop picture; and the level just below ordinary app windows,
  // above Finder's desktop, the icons and desktop widgets, for the click catcher and for a wallpaper with a panel open.
  static let wallpaperLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
  static let aboveDesktop = NSWindow.Level(rawValue: NSWindow.Level.normal.rawValue - 1)
  private var settingsWindow: NSWindow?
  private var settingsView: WKWebView?
  private var statusItem: NSStatusItem?
  private var refresh: Timer?
  private var userPaused = false
  private var screensAsleep = false
  // Latest weather and night the pond reported, for the menu's check marks.
  private var weather = "sunny"
  private var night = false

  private var indexURL: URL {
    guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
      fatalError("index.html missing from app bundle")
    }
    return url
  }

  private var allViews: [WKWebView] { wallpaper.map(\.webView) + (settingsView.map { [$0] } ?? []) }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    buildMainMenu()
    buildStatusItem()
    rebuildWallpaper()
    // Follow the cursor as it moves, so a control takes a click the moment the pointer reaches it.
    // (Watching mouse movement needs no special permission, unlike watching keys.)
    mouseMonitors = [
      NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in self?.pumpMouse() } as Any,
      NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] e in self?.pumpMouse(); return e } as Any,
    ]
    NotificationCenter.default.addObserver(
      forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.rebuildWallpaper() }
    // Nobody sees the pond while the displays sleep or another user is logged in: stop drawing it.
    let ws = NSWorkspace.shared.notificationCenter
    for (name, asleep) in [
      (NSWorkspace.screensDidSleepNotification, true), (NSWorkspace.screensDidWakeNotification, false),
      (NSWorkspace.sessionDidResignActiveNotification, true), (NSWorkspace.sessionDidBecomeActiveNotification, false),
    ] {
      ws.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.screensAsleep = asleep
        self?.applyPause()
      }
    }
    NSLog("碧池观鱼 wallpaper ready on %d screen(s)", NSScreen.screens.count)
    if let folder = ProcessInfo.processInfo.environment["BICHI_SELFTEST"] { runSelfTest(folder: folder) }
  }

  // The pond's own controls in page coordinates (CSS px, origin top-left), and whether one of its panels is open.
  private static let rectsJS = """
  (() => {
    const r = [];
    for (const el of document.querySelectorAll('.dock, .weather-card, .zen-exit:not([hidden])')) {
      const b = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (b.width > 1 && b.height > 1 && s.visibility !== 'hidden' && parseFloat(s.opacity) > .05) r.push([b.x, b.y, b.width, b.height]);
    }
    return { r, m: !!document.querySelector('dialog[open]') };
  })()
  """

  // Refresh the controls' positions a few times a second (and right after a click), so a panel opened
  // from the dock is lifted and ready for typing before the cursor gets there.
  private func refreshRects() {
    for pane in wallpaper {
      pane.webView.evaluateJavaScript(Self.rectsJS) { [weak self, weak pane] result, error in
        guard let self = self, let pane = pane, error == nil, let info = result as? [String: Any] else { return }
        // JS numbers arrive as NSNumber; casting straight to [[CGFloat]] silently fails.
        let rows = info["r"] as? [[NSNumber]] ?? []
        let f = pane.screen.frame
        // Page top-left == screen top-left in global coords (y grows upward from the bottom).
        pane.rects = rows.compactMap { r in
          guard r.count == 4 else { return nil }
          return CGRect(
            x: f.minX + CGFloat(truncating: r[0]), y: f.maxY - CGFloat(truncating: r[1]) - CGFloat(truncating: r[3]),
            width: CGFloat(truncating: r[2]), height: CGFloat(truncating: r[3]))
        }
        self.setModal(pane, info["m"] as? Bool ?? false)
        self.pumpMouse()
      }
    }
  }

  // The catcher takes the mouse only while the cursor is over the pond's controls;
  // everywhere else clicks fall through to the desktop, its icons and widgets as usual.
  func pumpMouse(at mouse: NSPoint = NSEvent.mouseLocation) {
    for pane in wallpaper where !pane.modal {
      let hot = pane.rects.contains { $0.contains(mouse) }
      guard hot != pane.hot else { continue }
      pane.hot = hot
      pane.overlay.ignoresMouseEvents = !hot
      if !hot, let event = NSEvent.mouseEvent(
        with: .mouseMoved, location: pane.window.convertPoint(fromScreen: mouse), modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: pane.window.windowNumber, context: nil,
        eventNumber: 0, clickCount: 0, pressure: 0)
      {
        pane.webView.mouseMoved(with: event)  // the cursor left: let the page drop its hover highlight
      }
    }
  }

  // While a panel is open the wallpaper is lifted above the desktop icons and made key, so every field,
  // slider and menu in it works with the real mouse and keyboard (input methods included); closing the panel
  // sets it back on the desktop.
  func setModal(_ pane: Pane, _ open: Bool) {
    guard pane.modal != open else { return }
    pane.modal = open
    if open {
      pane.overlay.orderOut(nil)
      pane.window.level = Self.aboveDesktop
      pane.window.ignoresMouseEvents = false
      NSApp.activate(ignoringOtherApps: true)
      pane.window.makeKeyAndOrderFront(nil)
    } else {
      pane.window.level = Self.wallpaperLevel
      pane.window.ignoresMouseEvents = true
      pane.hot = false
      pane.overlay.ignoresMouseEvents = true
      pane.overlay.orderFrontRegardless()
      if settingsWindow == nil && NSApp.isActive { NSApp.deactivate() }
    }
  }

  // Height of a Dock docked at the bottom of this screen (0 when hidden or on a side).
  private func dockInset(for screen: NSScreen) -> CGFloat {
    max(0, screen.visibleFrame.minY - screen.frame.minY)
  }

  private func newWebView(dockInset: CGFloat = 0) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.applicationNameForUserAgent = "BichiKoiPond/1.1"
    config.userContentController.add(WeakScriptHandler(self), name: "pond")
    if dockInset > 0 {
      let source = "document.documentElement.style.setProperty('--dock-inset','\(Int(dockInset))px');"
      config.userContentController.addUserScript(
        WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }
    let view = WKWebView(frame: .zero, configuration: config)
    view.setValue(false, forKey: "drawsBackground")
    view.navigationDelegate = self
    view.loadFileURL(indexURL, allowingReadAccessTo: Bundle.main.resourceURL ?? indexURL)
    return view
  }

  private func rebuildWallpaper() {
    refresh?.invalidate()
    for pane in wallpaper { pane.overlay.close(); pane.window.close() }
    wallpaper.removeAll()
    // BICHI_DEBUG_LEVEL=1 floats the wallpaper above normal apps, for looking at it on a cluttered desktop.
    let debug = ProcessInfo.processInfo.environment["BICHI_DEBUG_LEVEL"] == "1"
    for screen in NSScreen.screens {
      let window = WallpaperWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      window.isReleasedWhenClosed = false
      window.level = debug ? .floating : Self.wallpaperLevel
      window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
      window.isOpaque = true
      window.backgroundColor = .black
      window.hasShadow = false
      window.ignoresMouseEvents = true
      window.title = "碧池观鱼 Wallpaper"
      let view = newWebView(dockInset: dockInset(for: screen))
      window.contentView = view
      window.orderFrontRegardless()

      let overlay = NSWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      overlay.isReleasedWhenClosed = false
      overlay.level = debug ? NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1) : Self.aboveDesktop
      overlay.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
      overlay.isOpaque = false
      // All but invisible; a window needs some coverage for the window server to route clicks to it.
      overlay.backgroundColor = NSColor(white: 0, alpha: 0.002)
      overlay.hasShadow = false
      overlay.ignoresMouseEvents = true
      overlay.acceptsMouseMovedEvents = true
      overlay.title = "碧池观鱼 Controls"
      let catcher = ClickCatcher(frame: NSRect(origin: .zero, size: screen.frame.size))
      catcher.target = view
      catcher.onRelease = { [weak self] in
        for delay in [0.08, 0.3] { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self?.refreshRects() } }
      }
      overlay.contentView = catcher
      overlay.orderFrontRegardless()
      wallpaper.append(Pane(window: window, webView: view, overlay: overlay, catcher: catcher, screen: screen))
    }
    refresh = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      self?.refreshRects()
    }
  }

  private func reloadWallpaper() {
    for entry in wallpaper { entry.webView.reload() }
  }

  // The wallpaper rests while paused from the menu or while nobody can see it; the interactive window never does.
  private func applyPause() {
    let paused = userPaused || screensAsleep
    for entry in wallpaper {
      entry.webView.callAsyncJavaScript(
        "window.pondControl && pondControl.pause(paused)", arguments: ["paused": paused], in: nil, in: .page,
        completionHandler: nil)
    }
  }

  // A menu command goes to one page (the interactive window if open); its save carries the change to the others.
  // Sending it to every page at once would have each save its whole pond at the same instant, and an edit
  // still on its way from another page could be overwritten.
  private func control(_ options: [String: Any]) {
    if let view = settingsView ?? wallpaper.first?.webView {
      view.callAsyncJavaScript(
        "window.pondControl && pondControl.set(o)", arguments: ["o": options], in: nil, in: .page, completionHandler: nil)
    }
    if let w = options["weather"] as? String { weather = w }
    if let n = options["night"] as? Bool { night = n }
  }

  // MARK: Menus

  // Standard app and edit menus, so ⌘C/⌘V/⌘A work in the naming and city fields and ⌘W closes the window.
  private func buildMainMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem()
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "退出碧池观鱼", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu
    main.addItem(appItem)
    let editItem = NSMenuItem()
    let edit = NSMenu(title: "编辑")
    edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit
    main.addItem(editItem)
    let windowItem = NSMenuItem()
    let windowMenu = NSMenu(title: "窗口")
    windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    windowItem.submenu = windowMenu
    main.addItem(windowItem)
    NSApp.mainMenu = main
  }

  private enum Tag: Int { case weather = 100, night, pause, login }

  private func buildStatusItem() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.title = "🐟"
    let menu = NSMenu()
    menu.delegate = self
    let title = NSMenuItem(title: "碧池观鱼", action: nil, keyEquivalent: "")
    title.isEnabled = false
    menu.addItem(title)
    menu.addItem(.separator())
    menu.addItem(menuItem("打开交互窗口", #selector(openInteractive), "i"))
    let weatherMenu = NSMenu()
    for (name, value) in [("晴日", "sunny"), ("多云", "cloudy"), ("下雨", "rain"), ("落雪", "snow")] {
      let w = menuItem(name, #selector(pickWeather(_:)), "")
      w.representedObject = value
      w.tag = Tag.weather.rawValue
      weatherMenu.addItem(w)
    }
    weatherMenu.addItem(.separator())
    let nightItem = menuItem("月下观鱼", #selector(toggleNight), "")
    nightItem.tag = Tag.night.rawValue
    weatherMenu.addItem(nightItem)
    let weatherItem = NSMenuItem(title: "天气", action: nil, keyEquivalent: "")
    weatherItem.submenu = weatherMenu
    menu.addItem(weatherItem)
    let pause = menuItem("暂停壁纸动画", #selector(togglePause), "p")
    pause.tag = Tag.pause.rawValue
    menu.addItem(pause)
    menu.addItem(menuItem("重载桌面壁纸", #selector(reloadItem), "r"))
    if #available(macOS 13.0, *) {
      let login = menuItem("登录时启动", #selector(toggleLogin), "")
      login.tag = Tag.login.rawValue
      menu.addItem(login)
    }
    menu.addItem(.separator())
    menu.addItem(menuItem("退出碧池观鱼", #selector(quitApp), "q"))
    item.menu = menu
    statusItem = item
  }

  private func menuItem(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.target = self
    return item
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    func mark(_ items: [NSMenuItem]) {
      for item in items {
        switch Tag(rawValue: item.tag) {
        case .weather: item.state = (item.representedObject as? String) == weather ? .on : .off
        case .night: item.state = night ? .on : .off
        case .pause: item.state = userPaused ? .on : .off
        case .login:
          if #available(macOS 13.0, *) { item.state = SMAppService.mainApp.status == .enabled ? .on : .off }
        case .none: break
        }
        if let sub = item.submenu { mark(sub.items) }
      }
    }
    mark(menu.items)
  }

  @objc private func pickWeather(_ sender: NSMenuItem) {
    if let value = sender.representedObject as? String { control(["weather": value]) }
  }

  @objc private func toggleNight() { control(["night": !night]) }

  @objc private func togglePause() {
    userPaused.toggle()
    applyPause()
  }

  @objc private func toggleLogin() {
    guard #available(macOS 13.0, *) else { return }
    let service = SMAppService.mainApp
    do {
      if service.status == .enabled { try service.unregister() } else { try service.register() }
    } catch {
      let alert = NSAlert()
      alert.messageText = "无法更改登录项"
      alert.informativeText = "请在“系统设置 › 通用 › 登录项”中手动添加碧池观鱼。\n\(error.localizedDescription)"
      alert.runModal()
    }
  }

  @objc private func openInteractive() {
    // While its window is open the app shows in the Dock and ⌘-Tab, so the window is easy to get back to.
    NSApp.setActivationPolicy(.regular)
    if let window = settingsWindow {
      window.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1180, height: 760),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.title = "碧池观鱼"
    window.minSize = NSSize(width: 420, height: 560)
    window.delegate = self
    window.center()
    let view = newWebView()
    window.contentView = view
    settingsWindow = window
    settingsView = view
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  @objc private func reloadItem() { reloadWallpaper() }

  @objc private func quitApp() { NSApp.terminate(nil) }
}

extension AppDelegate: WKScriptMessageHandler {
  // A page saved the pond: hand the same save to every other page, and note the weather for the menu.
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "pond", let json = message.body as? String else { return }
    let sender = message.webView
    for view in allViews where view !== sender {
      view.callAsyncJavaScript(
        "window.__pondSync && __pondSync(data)", arguments: ["data": json], in: nil, in: .page, completionHandler: nil)
    }
    if let data = json.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let settings = root["settings"] as? [String: Any]
    {
      if let w = settings["weather"] as? String { weather = w }
      if let n = settings["night"] as? Bool { night = n }
    }
  }
}

extension AppDelegate: WKNavigationDelegate {
  // A wallpaper page that (re)loads while the pond is paused starts out paused too.
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if (userPaused || screensAsleep) && wallpaper.contains(where: { $0.webView === webView }) { applyPause() }
    webView.evaluateJavaScript("window.pondControl && pondControl.state()") { [weak self] result, _ in
      guard let state = result as? [String: Any] else { return }
      if let w = state["weather"] as? String { self?.weather = w }
      if let n = state["night"] as? Bool { self?.night = n }
    }
  }
}

extension AppDelegate: NSWindowDelegate {
  // Changes made in the interactive window already reached the wallpaper as they were saved.
  func windowWillClose(_ notification: Notification) {
    if notification.object as? NSWindow === settingsWindow {
      settingsView?.configuration.userContentController.removeScriptMessageHandler(forName: "pond")
      settingsWindow = nil
      settingsView = nil
      NSApp.setActivationPolicy(.accessory)
    }
  }
}

// MARK: Self-test
// BICHI_SELFTEST=<folder> runs the app through its menu actions, checks the pond in every web view,
// snapshots the pages into the folder, logs PASS/FAIL lines, restores the settings it touched and quits.
extension AppDelegate {
  private func js(_ view: WKWebView, _ source: String, _ done: @escaping ([String: Any]) -> Void) {
    view.evaluateJavaScript("JSON.stringify((() => { \(source) })())") { result, error in
      let text = result as? String ?? "{}"
      let dict = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] ?? [:]
      if let error = error { NSLog("SELFTEST js error: %@", error.localizedDescription) }
      done(dict)
    }
  }

  private func snapshot(_ view: WKWebView, _ name: String, into folder: String) {
    view.takeSnapshot(with: nil) { image, _ in
      guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:])
      else { return NSLog("SELFTEST FAIL snapshot %@", name) }
      try? png.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }
  }

  func runSelfTest(folder: String) {
    try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
    var failures = 0
    func check(_ ok: Bool, _ what: String) { if !ok { failures += 1 }; NSLog("SELFTEST %@ %@", ok ? "PASS" : "FAIL", what) }
    // Counts animation frames, to measure how smoothly each page runs.
    let fpsStart = "window.__fc = window.__fc || 0; if (!window.__fcOn) { window.__fcOn = true; (function c(){ window.__fc++; requestAnimationFrame(c); })(); } window.__fc0 = window.__fc; window.__ft0 = performance.now(); return {}"
    let fpsRead = "return { fps: (window.__fc - window.__fc0) * 1000 / (performance.now() - window.__ft0) }"
    let probe = "return { kind: renderer && renderer.kind, fish: simulation.fish.length, name: simulation.fish[0].name, weather: settings.weather, night: settings.night, t: time, paused, rects: document.querySelectorAll('.dock').length }"
    var steps: [(Double, () -> Void)] = []
    var original: [String: Any] = [:]
    var t0: [Double] = []
    let at = { (delay: Double, step: @escaping () -> Void) in steps.append((delay, step)) }

    at(6) {
      check(self.wallpaper.count == NSScreen.screens.count, "one wallpaper window per screen (\(self.wallpaper.count))")
      for (i, entry) in self.wallpaper.enumerated() {
        check(entry.window.level.rawValue == Int(CGWindowLevelForKey(.desktopWindow)) + 1, "wallpaper \(i) sits on the desktop level")
        check(entry.window.frame == entry.screen.frame, "wallpaper \(i) covers its screen")
        self.js(entry.webView, probe) { s in
          if i == 0 {
            original = s
            // A run cut short earlier may have left its test name on the first koi; give it back its own name.
            if s["name"] as? String == "自检" { original["name"] = "锦时" }
          }
          check(s["kind"] as? String == "webgl2", "wallpaper \(i) renders with WebGL2 (\(s["kind"] ?? "none"))")
          check((s["fish"] as? Int ?? 0) > 0, "wallpaper \(i) has koi (\(s["fish"] ?? 0))")
          t0.append(s["t"] as? Double ?? 0)
        }
      }
      self.snapshot(self.wallpaper[0].webView, "1-wallpaper", into: folder)
    }
    at(2) {
      self.js(self.wallpaper[0].webView, probe) { s in check((s["t"] as? Double ?? 0) > (t0.first ?? 0) + 0.5, "wallpaper animates (t \(t0.first ?? 0) → \(s["t"] ?? 0))") }
    }
    // Clicks on the dock go through the catcher above Finder's desktop to the pond page.
    var feed0: Bool?
    func center(_ selector: String, _ done: @escaping (NSPoint) -> Void) {
      let pane = self.wallpaper[0]
      self.js(pane.webView, "const b = document.querySelector('\(selector)').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }") { s in
        let f = pane.screen.frame
        done(NSPoint(x: f.minX + CGFloat(s["x"] as? Double ?? 0), y: f.maxY - CGFloat(s["y"] as? Double ?? 0)))
      }
    }
    func click(at point: NSPoint) {
      let pane = self.wallpaper[0], p = pane.overlay.convertPoint(fromScreen: point)
      for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
        guard let e = NSEvent.mouseEvent(
          with: type, location: p, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
          windowNumber: pane.overlay.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)
        else { continue }
        if type == .leftMouseDown { pane.catcher.mouseDown(with: e) } else { pane.catcher.mouseUp(with: e) }
      }
    }
    at(1) {
      let pane = self.wallpaper[0]
      check(pane.overlay.level.rawValue > Int(CGWindowLevelForKey(.desktopIconWindow)) && pane.overlay.level < .normal,
        "click catcher sits above Finder's desktop and icons, below app windows")
      check(pane.overlay.isVisible, "click catcher is on screen")
      self.js(pane.webView, "return { feed: feedMode }") { s in feed0 = s["feed"] as? Bool }
      center("#feed-button") { p in
        self.pumpMouse(at: p)
        check(!pane.overlay.ignoresMouseEvents, "a control under the cursor takes the click")
        self.pumpMouse(at: NSPoint(x: pane.screen.frame.midX, y: pane.screen.frame.midY))
        check(pane.overlay.ignoresMouseEvents, "open water lets clicks through to the desktop")
        click(at: p)
      }
    }
    at(1) {
      self.js(self.wallpaper[0].webView, "return { feed: feedMode }") { s in
        check(feed0 != nil && s["feed"] as? Bool == !(feed0 ?? true), "clicking 投喂 on the wallpaper toggles feeding")
      }
      center("#feed-button") { click(at: $0) }
    }
    at(1) {
      self.js(self.wallpaper[0].webView, "return { feed: feedMode }") { s in check(s["feed"] as? Bool == feed0, "clicking 投喂 again turns it back") }
      center(".dock [data-panel=weather]") { click(at: $0) }
    }
    at(1.5) {
      let pane = self.wallpaper[0]
      self.js(pane.webView, "return { open: dialog.open, panel: activePanel }") { s in
        check(s["open"] as? Bool == true && s["panel"] as? String == "weather", "clicking 天气 on the wallpaper opens its panel")
      }
      check(pane.modal && pane.window.level == Self.aboveDesktop && pane.window.isKeyWindow && !pane.window.ignoresMouseEvents,
        "an open panel lifts the wallpaper above the icons and takes the keyboard")
      self.js(pane.webView, "dialog.close(); return {}") { _ in }
    }
    at(1.5) {
      let pane = self.wallpaper[0]
      check(!pane.modal && pane.window.level == Self.wallpaperLevel && pane.window.ignoresMouseEvents && pane.overlay.isVisible,
        "closing the panel puts the wallpaper back on the desktop")
    }
    at(1) {
      self.openInteractive()
      check(NSApp.activationPolicy() == .regular, "interactive window brings the app into the Dock")
    }
    at(6) {
      guard let view = self.settingsView else { return check(false, "interactive window opened") }
      self.js(view, probe) { s in check(s["kind"] as? String == "webgl2", "interactive window renders with WebGL2") }
      self.snapshot(view, "2-interactive", into: folder)
      self.control(["weather": "cloudy", "night": false])
    }
    at(2) {
      for (i, view) in self.allViews.enumerated() {
        self.js(view, probe) { s in check(s["weather"] as? String == "cloudy", "menu weather reaches view \(i) (\(s["weather"] ?? "?"))") }
      }
      // A rename in the interactive window must reach the wallpaper through the save bridge.
      if let view = self.settingsView { self.js(view, "simulation.fish[0].name = '自检'; persist(); return {}") { _ in } }
    }
    at(1.5) {
      self.js(self.wallpaper[0].webView, probe) { s in check(s["name"] as? String == "自检", "rename in the window syncs to the wallpaper (\(s["name"] ?? "?"))") }
    }
    at(8) { self.snapshot(self.wallpaper[0].webView, "3-cloudy", into: folder); self.js(self.wallpaper[0].webView, fpsStart) { _ in } }
    at(4) {
      self.js(self.wallpaper[0].webView, fpsRead) { s in NSLog("SELFTEST INFO wallpaper cloudy %.0f fps", s["fps"] as? Double ?? 0) }
      self.control(["weather": "rain", "night": false])
    }
    at(8) { self.js(self.wallpaper[0].webView, fpsStart) { _ in } }
    at(4) {
      self.js(self.wallpaper[0].webView, fpsRead) { s in NSLog("SELFTEST INFO wallpaper rain %.0f fps", s["fps"] as? Double ?? 0) }
      self.snapshot(self.wallpaper[0].webView, "4-rain", into: folder)
    }
    at(2) { self.togglePause() }
    at(2) { self.js(self.wallpaper[0].webView, probe) { s in t0 = [s["t"] as? Double ?? 0]; check(s["paused"] as? Bool == true, "pause from the menu reaches the wallpaper") } }
    at(2) {
      self.js(self.wallpaper[0].webView, probe) { s in check(s["t"] as? Double == t0.first, "paused wallpaper stops animating") }
      self.togglePause()
    }
    at(3) {
      self.js(self.wallpaper[0].webView, probe) { s in check(s["paused"] as? Bool == false && (s["t"] as? Double ?? 0) > (t0.first ?? 0), "wallpaper resumes") }
      // Put back what the test changed.
      let name = (original["name"] as? String ?? "锦时").replacingOccurrences(of: "'", with: "")
      if let view = self.settingsView { self.js(view, "simulation.fish[0].name = '\(name)'; persist(); return {}") { _ in } }
    }
    at(1.5) { self.control(["weather": original["weather"] as? String ?? "sunny", "night": original["night"] as? Bool ?? false]) }
    // Saves travel page → app → page; with two 4K ponds rendering rain that can take a few seconds.
    at(5) {
      self.js(self.wallpaper[0].webView, probe) { s in
        check(s["name"] as? String == original["name"] as? String && s["weather"] as? String == original["weather"] as? String,
          "settings restored (\(s["name"] ?? "?"), \(s["weather"] ?? "?"))")
      }
      NSLog("SELFTEST INFO original weather %@", original["weather"] as? String ?? "?")
      for (i, view) in self.allViews.enumerated() {
        self.js(view, "return { w: settings.weather, rev, auto: settings.autoWeather }") { s in NSLog("SELFTEST INFO view %d %@", i, "\(s)") }
      }
    }
    at(2) { self.settingsWindow?.performClose(nil) }
    at(3) {
      check(self.settingsWindow == nil && NSApp.activationPolicy() == .accessory, "closing the window returns the app to the menu bar only")
      NSLog("SELFTEST DONE failures=%d", failures)
      if ProcessInfo.processInfo.environment["BICHI_SELFTEST_STAY"] != "1" { NSApp.terminate(nil) }
    }

    var delay = 0.0
    for (d, step) in steps {
      delay += d
      DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: step)
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
