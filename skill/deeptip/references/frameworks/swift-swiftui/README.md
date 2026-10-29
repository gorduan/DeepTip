# DeepTip with SwiftUI (Swift)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, in Swift with SwiftUI on macOS, iPadOS and iOS. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Swift implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to SwiftUI and Swift.

SwiftUI cannot be built in this repository (no Apple SDK on the build machine), so nothing here was compiled. API names and their first OS versions are from Apple's documentation; behaviour that differs between OS releases is marked **verify**. Target **macOS 14 / iOS 17** (needed for `onKeyPress` and `@Observable`); the pure parts run anywhere Swift runs, including Linux. The closest complete implementation is the Rust crate [`frameworks/rust-egui`](../rust-egui/README.md): its `src/engine.rs` is the window tree and every timer without UI types and ports to Swift almost line by line.

**Download:** `DeepTip-swift-swiftui-1.0.0.zip` holds this guide together with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout, so every relative link works. **Status:** documented, not built in this repository.

## 1. Architecture

| Target | Contents | Depends on | Verified by |
|---|---|---|---|
| `DeepTipCore` | glossary layers and locale chain [§1], `parseText` [§2], `computePlacement` [§8], the `Engine`: window tree [§4], hot set, grace, tendency, suppression [§5], arming [§6], timer lock [§7], the input decisions of [§9]; time, boxes and the hover state are passed in | Foundation only | the shared parity cases [§11] and engine scenario tests |
| `DeepTip` | the SwiftUI layer: `DeepTipModel` (`@Observable`, `@MainActor`), the overlay layer with the windows, terms, the `.deepTip(_:)` modifier, keys, focus, timers | `DeepTipCore`, SwiftUI | previews and the example on a Mac |
| `DeepTipHUD` | the example app (`swift run DeepTipHUD`) | `DeepTip` | by hand against the web example |

`Package.swift` (swift-tools-version 5.9 or newer): `platforms: [.macOS(.v14), .iOS(.v17)]`, the three targets above, a test target `DeepTipCoreTests`, and the HUD as `.executableTarget`. Build and test on a Mac with Xcode 15 or newer:

```bash
cd frameworks/swift-swiftui
swift build
swift test             # DeepTipCoreTests: parity cases and engine scenarios
swift run DeepTipHUD   # the example (macOS)
```

An executable target started by `swift run` has no bundle: call `NSApplication.shared.setActivationPolicy(.regular)` and `NSApplication.shared.activate(ignoringOtherApps: true)` in the app's `init`, or its window opens behind the terminal and gets no key events (**verify**; an Xcode app target has neither problem).

## 2. SPEC concept → SwiftUI

| SPEC concept | SwiftUI |
|---|---|
| UI element with a key (web: `data-deeptip`) | `.deepTip("key", id: …)` modifier. It adds `anchorPreference(key: DeepTipAnchors.self, value: .bounds) { [id: $0] }` (iOS 13), `.onHover` (iOS 13.4 / macOS 10.15) for the rest timer, a simultaneous `LongPressGesture(minimumDuration: 0.5, maximumDistance: 10)` for touch, `.onKeyPress` for F1 and `?` while it is focused, `.focused($focus, equals: .element(id))`, and `.accessibilityHint(short)` plus `.accessibilityAction(named: "Explain")`. `id` defaults to the key; give an own id when one key marks several views. |
| Anchor box | `overlayPreferenceValue(DeepTipAnchors.self) { anchors in GeometryReader { proxy in … proxy[anchor] … } }`: `proxy[anchor]` resolves each `Anchor<CGRect>` into the overlay's coordinate space, which is the host's. Exact, and updated on every layout pass (scrolling included). |
| Window | A view in **DeepTip's own overlay layer** on the host view (section 3), positioned with `.offset(x:y:)` inside a top-leading `ZStack`; later windows are later in the `ForEach`, so they are on top. |
| Term (a link in a text) | Two ways, section 6: `Text(AttributedString)` with `.link` runs (tap / click only), or a flow layout of words and term buttons (hover previews, Tab, VoiceOver per term). |
| Preview, pinned | A flag in the window record; pinned: accent border, filled pin (`pin.fill`), no hint line. |
| What the pointer is over | `.onHover` on windows, terms and marked views feeds three variables (hovered windows, hovered term, hovered element); after every change compute `Hover {win, link, trig}` [§6] and call `engine.setHover` (a no-op when nothing changed). |
| Pointer samples for the tendency [§5] | `.onContinuousHover(coordinateSpace: .named("deeptip"))` (iOS 16 / macOS 13) on the host: `.active(location)` → `engine.pointerMoved(x, y, now)`; `.ended` → hover = {}. Window boxes are kept in the same space. |
| `schedule(ms, f)` | One `Task { @MainActor in try await Task.sleep(for: …) }` for the engine's next due time, cancelled and re-created after every engine call (section 9). |
| Time | `ContinuousClock` milliseconds since the model was created. |
| Keys | `.onKeyPress` (iOS 17 / macOS 14): `.escape` with `phases: [.down, .repeat]`, `press.modifiers.contains(.shift)`; `?` with `onKeyPress(characters: CharacterSet(charactersIn: "?"))`; F1 and F6 on macOS as the function-key characters `"\u{F704}"` and `"\u{F709}"` (`NSF1FunctionKey`, `NSF6FunctionKey`) (**verify** on iPadOS hardware keyboards; use a `UIKeyCommand` with `UIKeyCommand.f1` there if needed). |
| Focus [§9.5] | One `@FocusState var focus: DeepTipFocus?` in the host (`enum DeepTipFocus: Hashable { case element(AnyHashable), term(TermID), button(WinID, Int) }`); its `Binding` goes into the environment (as an optional, default `nil`: a `FocusState.Binding` cannot be created outside a view) so `.deepTip` and the windows can use `.focused(_:equals:)`. Into a window: set `focus = .term(firstTerm)` after the window appeared; back: `focus = .element(id)`. |
| Long-press | `.simultaneousGesture(LongPressGesture(minimumDuration: 0.5, maximumDistance: 10).onEnded { _ in model.longPress(id) })`; haptic `.sensoryFeedback(.impact, trigger: …)` (iOS 17). |
| Click inside a preview, outside presses | `.onTapGesture` on the window background (child buttons win); `.simultaneousGesture(SpatialTapGesture(coordinateSpace: .named("deeptip")))` (iOS 16 / macOS 13) on the host sees every tap with its location without blocking the app: outside all window boxes → [§9.2] (`outsideClickCloses`; on iOS every tap is touch). |
| Swipe a title bar down | `DragGesture(minimumDistance: 10)` on the title bar: `translation.height > 60 && abs(translation.width) < 60` → close all. |
| Reduced motion | `@Environment(\.accessibilityReduceMotion)`. |
| Accessibility (SPEC §6) | Terms: `.accessibilityAddTraits(.isLink)`. Windows: `.accessibilityElement(children: .contain)`, `.accessibilityLabel(title)`; not `.isModal` (pinned windows are non-modal). The described-by relation of the web becomes the element's `.accessibilityHint(short)`, and `.accessibilityAction(named: "Explain")` opens the window pinned with focus. |
| Gamepad | Offer the actions of [§9.4] as model methods; a host reads `GCController` (GameController framework) itself: Y → `openFocused()`, A → `activate()`, B → `closeNewest()` (held 600 ms → `closeAll()`), LB / RB → `cycle(-1 / +1)`, d-pad → `step(±1)`. |
| Encyclopedia [§12] | `DeepTipIndex(model:)`: a `TextField` for the search and a `LazyVStack` of rows built with page terms. |

## 3. Overlay layer, not popovers

`.popover(isPresented:attachmentAnchor:arrowEdge:content:)` looks tempting but does not fit: one popover per view, the system decides the side (a child must sit beside its parent window, never on it), arrows, popovers turn into sheets on iPhone unless `.presentationCompactAdaptation(.popover)` (iOS 16.4), and a hover preview that opens a system popover takes the pointer and the key focus away from the term (**verify** per OS). Use one layer above the host instead:

```swift
public struct DeepTipHost: ViewModifier {
	let model: DeepTipModel // @Observable: reading it in body subscribes the view
	@FocusState private var focus: DeepTipFocus?

	public func body(content: Content) -> some View {
		content
			.environment(\.deepTipFocus, $focus)
			.overlayPreferenceValue(DeepTipAnchors.self) { anchors in
				GeometryReader { proxy in
					DeepTipLayer(model: model, anchors: anchors.mapValues { proxy[$0] }, viewport: proxy.size)
				}
			}
			.coordinateSpace(.named("deeptip"))
			.onContinuousHover(coordinateSpace: .named("deeptip")) { model.pointer($0) }
			.onKeyPress(.escape, phases: [.down, .repeat]) { model.escape($0) }
			.onKeyPress("\u{F709}") { model.cycle(1) ? .handled : .ignored } // F6 (macOS)
	}
}
```

`DeepTipLayer` is a `ZStack(alignment: .topLeading)` filling the overlay, with `.allowsHitTesting(true)` only on the window views (an empty layer must not block the app: give the layer itself no background and no content shape). On macOS, check that a window covering a marked button stops that button's `.onHover` (**verify**; SwiftUI hover follows hit-testing, so give windows `.contentShape(RoundedRectangle(cornerRadius: 8))`).

## 4. Data structures

```swift
public typealias WinID = Int // 0 = none

// Not "Anchor" and not "Window": SwiftUI has types with those names.
public enum AnchorID: Hashable { // what a window belongs to
	case element(AnyHashable)                 // the id of .deepTip(_:id:)
	case term(win: WinID, key: String, n: Int) // n = occurrence of key in that window's text: survives a language switch
	case page(text: AnyHashable, n: Int)       // a term in a DeepTipText / the index
}

public struct Entry: Equatable {
	public var title, short, body: String? // only string values count [§1]
	public var aliases: [String] = [], see: [String] = []
}

public struct DTRect: Equatable { public var left, top, right, bottom: Double } // host points, y down

public struct TipWindow: Identifiable {
	public let id: WinID
	public let key: String
	public let parent: WinID
	public let anchor: AnchorID
	public var via: Via // .hover, .click, .key, .touch, .pad, .api
	public var pinned = false
	public var children: [WinID] = []
	public var rect: DTRect?       // last laid-out box (tendency, children's target)
	public var anchorRect: DTRect? // a root's anchor box as last seen
	public var frozen = false
	var flashAt: Double?
	var leaving: (since: Double, checkAt: Double)? // the grace timer [§5]
}

public struct Hover: Equatable {
	public var win: WinID = 0
	public var link: (anchor: AnchorID, key: String, parent: WinID)?
	public var trig: (anchor: AnchorID, key: String, delay: Double?)?
	// write == by hand: tuples are not Equatable
}

public struct Engine {
	public var options: Options // SPEC §7: delay 800, linkDelay 80, closeDelay 300, lockAfter 0, longPress 500,
	                            // closeButtons, pinButton, hints, clickInsidePins, outsideClickCloses, root, child, gap 8
	public private(set) var windows: [TipWindow] = [] // oldest first
	// hover, hot set, pending (armed element or term), quiet (hushed element), samples, lock, events
	public mutating func tick(_ now: Double) -> Double? // run every due timer in time order, return the next due time
}
```

`DeepTipModel` (`@MainActor @Observable final class`) owns the `Glossary`, the `Engine`, the measured window sizes, the anchor boxes of the last layout, the clock, the timer task and the host callbacks (`onOpen`, `onClose`, `onPin`).

## 5. Events → engine calls

SwiftUI has no frame loop: every callback updates the model on the main actor, the views re-render from it. After every engine call: publish the change, re-schedule the timer (section 9), and move focus if the engine asked for it.

| Callback | Engine call |
|---|---|
| `.onHover` of a marked view, a term, a window | update the three hover variables; `setHover(hover)` [§6] |
| `onContinuousHover` `.active(p)` / `.ended` | `pointerMoved(p.x, p.y, now)` / hover = {} |
| term button action | `follow(term, parent: window, focus: focusedBeforeAction == term)` [§9.1] (a `Button` does not say whether Return or a click fired it; a term that had keyboard focus counts as keyboard) |
| pin / close button | `pinned ? unpin : pin`; close with focus back to the anchor |
| `.onTapGesture` on a window background | `clickInside(window)` |
| `SpatialTapGesture` on the host outside all windows | `pointerDown(inWindow: false, element: marked view at that point, touch: isTouchDevice)` [§9.2] |
| tap / click on a marked view (its own action runs as usual) | `hush(element)`: from a simultaneous `TapGesture` on the marked view |
| `LongPressGesture` ended | `openPinned(element, focus: false, via: .touch)`; remember a 1.5 s swallow for that element (section 10) |
| text typed into a marked `TextField` | `hush(element)`: `.onChange(of: text)` while it is focused |
| `.onKeyPress` Esc `.down` (Shift) / `.down` / `.repeat` held ≥ 600 ms | `closeAll` / `close(newest(focusedWindow))` / `closeAll`, focus back; return `.handled` only while windows are open, else `.ignored` so the app gets Esc |
| F6 / Shift+F6 | `cycle(±1)` → focus that window's first term |
| F1 / `?` on a focused marked view or term | `openPinned(element, focus: true, via: .key)` / `follow(term, …, focus: true)` |
| anchor boxes in `overlayPreferenceValue` | `setAnchorRect` for roots; anchors missing from the preference → `retainAnchors` [§4.5] (do this in `.onChange(of: anchorIDs)`, not during `body`) |
| window size preference | store the size; the next render places the window [§8] |

## 6. Text and terms [§3]

**Option A: `Text(AttributedString)` with links.** Build an `AttributedString` from the AST: text runs with `.inlinePresentationIntent` (`.stronglyEmphasized`, `.emphasized`, `.code`), terms with `.link = URL(string: "deeptip://term/\(key)?n=\(n)")` and `.foregroundColor`. Handle them with `.environment(\.openURL, OpenURLAction { url in model.openTerm(url); return .handled })` (iOS 15 / macOS 12). Native wrapping, Dynamic Type, VoiceOver's links rotor. But SwiftUI reports no hover per link and links are no Tab stops, so there is **no hover preview**: a click or tap opens the term pinned (the SPEC's touch behaviour). Good for iPhone-only apps.

**Option B: a flow layout of words and terms (recommended on macOS and iPadOS).** A `Layout` (iOS 16 / macOS 13) that places its subviews left to right, wraps when the next one does not fit the proposed width, aligns each line on `firstTextBaseline`, and starts a new line at a break marker:

```swift
struct Flow: Layout {
	var lineGap: CGFloat = 2
	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		arrange(proposal.width ?? .infinity, subviews).size
	}
	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		for (i, p) in arrange(bounds.width, subviews).points.enumerated() {
			subviews[i].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: .unspecified)
		}
	}
	private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (points: [CGPoint], size: CGSize) {
		// x, y, line height, line baseline; for each subview: size = sizeThatFits(.unspecified),
		// baseline = dimensions(in: .unspecified)[VerticalAlignment.firstTextBaseline];
		// a LineBreak marker (a layout value set with LayoutValueKey) or x + size.width > width → next line;
		// then shift every item of the finished line so the baselines meet
		…
	}
}
```

Children: every word of a text run as its own `Text` with the trailing space (`"word "`), styled with `.bold()`, `.italic()`, `.font(.body.monospaced())` for code, `.fontWeight(.semibold)` for values; every term as a `Button(label) { model.follow(…) }.buttonStyle(.plain)` with the link colour, `.onHover`, `.focused($focus, equals: .term(id))`, `.accessibilityAddTraits(.isLink)` and the open / hover underline. A term with several words is one button (it moves to the next line as a whole). Paragraphs are a `VStack(alignment: .leading, spacing: 0.5em)`; a list item is `HStack(alignment: .firstTextBaseline) { Text("•"); Flow { … } }`. The link rules of [§3] apply in both options: the window's own key is bold text, a missing key dimmed and not interactive, one warning per key.

`TextRenderer` (iOS 18 / macOS 15) can find the bounds of custom-attributed runs inside one `Text` (`Text.Layout` → lines → runs → `typographicBounds`), which would allow hover on Option A, but it only reports them while drawing; Option B is simpler and also gives Tab stops.

## 7. Windows: measure, place, show [§8]

1. Every window view reports its size with a background `GeometryReader` and a `PreferenceKey` (`[WinID: CGSize]`), or with `onGeometryChange(for: CGSize.self) { $0.size } action: { … }`.
2. A window whose size is still unknown renders with `.opacity(0)` and `.allowsHitTesting(false)` at its anchor (SwiftUI's version of a sizing pass).
3. Target box: the parent window's rect for children, the anchor box from the preference for roots (both in the host's space). Sides: the element's own order (`.deepTip("key", place: [.top, .bottom])`), else `child` / `root`.
4. `computePlacement(size, target, sides, viewport: proxy.size, gap: 8)`; with `maxW` / `maxH` set, give the window `.frame(maxWidth: maxW)` / limit its body (`ScrollView` with `.frame(maxHeight:)`), measure again and place with `[side]` only.
5. `.offset(x: p.x, y: p.y)` inside the top-leading `ZStack`; store the rect in the engine (`setRect`) for the tendency and for children.
6. Width: propose `min(384, viewport.width − 16)` and let short content stay narrower: the content is a `VStack` with `.frame(minWidth: 240, alignment: .leading)` and `.fixedSize(horizontal: false, vertical: true)`; the title row uses `HStack { title; badge; Spacer(minLength: 8); pin; close }`, so the window takes the proposed width when its body wraps, and its text width otherwise (**verify** the result on both platforms; a fixed width of 340 is an acceptable fallback).
7. Body taller than the room: `ViewThatFits(in: .vertical) { body; ScrollView { body } }` (iOS 16) inside `.frame(maxHeight: maxBodyHeight)`.

Write measured sizes back only when they changed by more than 0.5 pt; a size that oscillates by a pixel otherwise re-renders forever.

## 8. Keyboard and focus [§9.3] [§9.5]

- SwiftUI sends a key press to the focused view first and then up the hierarchy until a handler returns `.handled`. DeepTip's Esc handler on the host therefore runs only if the focused view did not handle Esc; the Esc that closed a window is `.handled` and goes no further.
- Holding Esc: the `.repeat` phase arrives while the key is held; close all when `now − escDownAt ≥ 600` (remember `escDownAt` at the first `.down`).
- On macOS, Tab reaches buttons only when keyboard navigation is on in System Settings, unless they are `.focusable()` (`.focusable(interactions: .activate)` on macOS 14). Make terms and the pin / close buttons focusable explicitly, or Tab never reaches them.
- Focus into a new window after it appeared: `.onAppear { DispatchQueue.main.async { focus = .term(first) } }` (one runloop later, when the button exists).
- Focus back: closing a window that held focus sets `focus = .element(id)` or `.term(anchorTerm)` of its anchor.
- `?` inside a text field types `?`: ignore it while a `TextField` has focus.

## 9. Timers and animation

```swift
private var timer: Task<Void, Never>?
private let origin = ContinuousClock.now
var now: Double { let d = ContinuousClock.now - origin; return Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15 }

func reschedule() {
	timer?.cancel()
	guard let due = engine.nextDue else { return }
	timer = Task { @MainActor [weak self] in
		try? await Task.sleep(for: .milliseconds(max(0, due - (self?.now ?? due))))
		guard let self, !Task.isCancelled else { return }
		self.engine.tick(self.now)
		self.publish() // events, focus requests, observation
		self.reschedule()
	}
}
```

The engine stays the timer for everything; animations are only visual: the lock bar as `withAnimation(.linear(duration: lockAfter / 1000)) { lockProgress = 1 }` when locking starts, the flash as a 600 ms `TimelineView(.animation)` or a `phaseAnimator` (iOS 17) on the border, the arming bar under a marked view the same way. With reduced motion: no slide or flash animation, a static outline instead.

## 10. Touch and gestures [§9.2]

- Long-press: SwiftUI `Button`s still run their action when the finger lifts after a long press (**verify**). SPEC: no click after the long-press. `.deepTip` cannot stop the button, so offer `model.consumeLongPress(id) -> Bool` (true once within 1.5 s after a long-press on that element) and call it first in the button's action: `Button { if dt.consumeLongPress("cart") { return }; addToCart() }`. Views that are not buttons (labels, images) need nothing.
- Hover does not exist on iPhone; long-press opens pinned and terms open on tap, which is SPEC's touch column.
- Outside taps close all on touch devices (`outsideClickCloses: "touch"`); on macOS clicks are mouse presses and close only with `"always"`.
- Touch targets: the pin and close buttons are 40 pt on iOS (`frame(minWidth: 40, minHeight: 40)`), 26 pt on macOS; the hint line is hidden on iOS.

## 11. Loading the JSON in file order [§1]

`JSONSerialization` returns `NSDictionary`, and `JSONDecoder`'s keyed containers do not promise an order either, but [§1] and the glossary cases need file order. Write a small recursive-descent parser over `Array(text.utf8)` (about 150 lines) into

```swift
public indirect enum JSON: Equatable {
	case object([Member]) // file order
	case array([JSON])
	case string(String)
	case number(Double)
	case bool(Bool)
	case null
}
public struct Member: Equatable { public var key: String; public var value: JSON }
```

handling `\uXXXX` escapes with surrogate pairs. A key that occurs twice keeps its first position and its last value (what JavaScript's `JSON.parse` does). Locale of a file: `$locale`, else the file name (`de.json`, `myapp.de.json`), else the caller's argument. Ship glossaries as package resources (`resources: [.copy("glossary")]`, read with `Bundle.module`) or load them from the app bundle; source templates with `{locale}` load in template order = layer order.

## 12. Porting the parser and placement to Swift [§2] [§8]

- Parse on `Array(src.utf16)`. That mirrors JavaScript exactly (string positions are UTF-16 units there); build pieces back with `String(decoding: slice, as: UTF16.self)`. Do not parse on `Character`s: a grapheme cluster can swallow a `*` followed by a combining mark, and `==` on `Character` would then miss the mark.
- JavaScript's `\s` (also what `trim` removes): `\t \n \v \f \r`, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF; all in the BMP, so one UTF-16 unit each. `Character.isWhitespace` and `trimmingCharacters(in: .whitespacesAndNewlines)` use other sets.
- `split(separator: "\n")` drops empty pieces by default: use `split(separator: "\n", omittingEmptySubsequences: false)`, or scan by hand. Normalise `\r\n` and lone `\r` to `\n` first; split paragraphs on `\n[ \t]*\n` left to right.
- The bullet test `^\s*[-•]\s+(.*)$` by hand with the set above; a line with U+2028 / U+2029 after the bullet's spaces is no bullet.
- `[[`, emphasis depth 3, `findClose`, `{name}` within 64 units: exactly as [§2].
- Placement: Swift's `min` / `max` do not propagate NaN like JavaScript (`min(.nan, 1)` is NaN, `min(1, .nan)` is 1); write `jsMin` / `jsMax` that return NaN when either side is NaN, and keep the expression order `a.top + ah / 2 - h / 2` so `placement.json` matches exactly (17.5).

## 13. Look (from `frameworks/web/deeptip.css`)

| Part | Value |
|---|---|
| Window | width 240–384 pt, max height 480 pt (body scrolls), 1 pt border, `RoundedRectangle(cornerRadius: 8)`, `.shadow(color: .black.opacity(0.3), radius: 15, y: 10)`, text `.callout` (≈ 14 pt), line spacing for 1.5 |
| Colours | background `#ffffff` / `#1b1e24`, text `#1f2328` / `#e6e8ec`, border `#c8cdd5` / `#3b414d`, accent `#0b69d4` / `#58a6ff`, term `#0b69d4` / `#6cb6ff`, term hover `#084f9f` / `#9ccfff` (light / dark via `@Environment(\.colorScheme)`; or the system's `.background`, `.primary`, `.tint`) |
| Title bar | padding 6 / 6 / 2 / 12 pt, title `.fontWeight(.semibold)`, badge `.caption2` with a 1 pt border, pin `Image(systemName: pinned ? "pin.fill" : "pin")`, close `Image(systemName: "xmark")` |
| Body, see also, hint | padding 0 / 12 / 10 pt; paragraph gap ½ line; list indent 1.2 em; code `.monospaced()` at 0.92; see also `.footnote` with the label at 60 % opacity; hint `.caption2` at 60 % with a top divider, hidden when pinned and on iOS |
| Terms | link colour, underline dotted (`.underline(pattern: .dot)`), solid when hovered or open, open term with a 16 % tint background |
| Lock bar, flash | 2 pt accent bar at the bottom edge; flash = 3 pt accent outline peaking at 30 % of 600 ms |

## 14. API to offer

| Call | Does |
|---|---|
| `DeepTipModel(locale:fallback:)` | the controller |
| `setSources(in: folderURL, ["core.{locale}.json", …])`, `add(locale:json:)`, `setLocale(_:)` | glossary layers [§1]; `{locale}` is replaced for every locale of the chain |
| `values["name"] = "…"`, `valueProvider = { name, key in … }` | live values (re-render on change; observation does it) |
| `.deepTipHost(model)` | the overlay layer, keys and pointer tracking on the root view |
| `.deepTip("key", id:, delay:, place:)` | an element with an explanation |
| `DeepTipText(markup)` | markup with live terms on a page |
| `DeepTipIndex()` | the encyclopedia [§12] |
| `open(key, at: id, pinned:)`, `close(_:)`, `closeAll()`, `pin(_:)`, `unpin(_:)` | windows from code |
| `isOpen(id)`, `arming(id)` | hooks: hide your own `.help` tooltip while open; draw a rest-progress bar |
| `onOpen`, `onClose`, `onPin` | callbacks |
| `openFocused()`, `activate()`, `closeNewest()`, `cycle(_:)`, `step(_:)`, `consumeLongPress(_:)` | gamepad, other devices, the long-press workaround |
| `options` (SPEC §7), `look` (section 13) | behaviour and look |

## 15. Minimal use

```swift
import SwiftUI
import DeepTip

@main
struct ShopApp: App {
	@State private var dt: DeepTipModel = {
		let model = DeepTipModel(locale: "en", fallback: ["en"])
		model.setSources(in: Bundle.main.resourceURL!, ["glossary/core/{locale}.json", "deeptip/{locale}.json"])
		return model
	}()

	var body: some Scene {
		WindowGroup {
			VStack(alignment: .leading, spacing: 12) {
				Button("Cart") { if !dt.consumeLongPress("shop.cart") { openCart() } }
					.deepTip("shop.cart")
				DeepTipText("Your items wait in the [[shop.cart]].")
			}
			.padding()
			.deepTipHost(dt)
		}
	}

	func openCart() {}
}
```

## 16. The example to build

`DeepTipHUD`: the HUD every framework shows. A top bar with buttons marked `demo.realm`, `demo.stability` (a click cycles −3…+3, shown through `{stability}`), `demo.taxes` (a click changes the tax level and adds gold), `demo.nobles`, `demo.gold` (`{gold}`), and a help button `deeptip.about` with delay 0; four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`; the bottom ones with their own side order top first) for placement at the window edge; a language picker (German / English, fallback `["de", "en"]`: *Prestige* and *Gold* exist only in German, so English shows the badge); settings for delay, timer lock, outside click, close and pin buttons, hint line; the encyclopedia; an event log. It loads `glossary/core/{locale}.json` and `glossary/example/{locale}.json`: copy `../../glossary` into the target's resources (`resources: [.copy("glossary")]` pointing at a symlink or a copy step), or read them from `../../glossary` relative to `#filePath` in debug builds. The screen texts are those of `frameworks/web/example/index.html`.

## 17. Tests [§11]

- **Parity cases** (`swift test`, XCTest or Swift Testing): read `test/cases/markup.json`, `placement.json`, `glossary.json` relative to the test file: `URL(fileURLWithPath: #filePath)` → `deletingLastPathComponent()` → `../../../../test/cases/` (from `Tests/DeepTipCoreTests/` up to the repository root). Convert the AST to the case's JSON shape (`{"t":"link","key":…,"text":null}`) and compare `JSON` values; compare placement numbers exactly; flatten `input` of the glossary cases from the ordered `JSON` of section 11.
- **Engine scenarios** with exact times and no SwiftUI: rest → open after `delay`; one preview per parent; click pins the chain; subtree close; same key up the chain flashes; grace; tendency up to 1.5 s; suppression; timer lock; hush; outside presses; Esc and F6 targets; vanished anchors. `frameworks/rust-egui/tests/engine.rs` contains all of them with times to copy.
- **The SwiftUI layer**: SwiftUI views cannot be driven headless with synthetic hover; test the model methods the views call (section 5) and check the rest in the example against the web example by hand.

## 18. Pitfalls

- Changing observed state inside `body` or inside a preference reader re-renders in a loop: apply anchor and size changes in `.onChange` / `onPreferenceChange` and only when they differ.
- `onPreferenceChange`'s closure is not main-actor isolated in the Swift 6 language mode (**verify** per SDK): hop with `MainActor.assumeIsolated { … }` or `Task { @MainActor in … }`.
- `.deepTip` ids must be unique in a host; one key on two buttons needs two ids.
- `onHover` reports `false` when a view disappears only on some OS versions (**verify**): clear hover entries of views whose anchors left the preference.
- `.help(_:)` tooltips and DeepTip windows both appear on macOS: drop the `.help` while `isOpen(id)`.
- A `ScrollView` takes all offered height: never put the window body in one without the `ViewThatFits` / max-height step of section 7.

## 19. Limitations

- Option A (text links) has no hover previews; Option B wraps per word, not per character, and has no text selection.
- F1 / F6 on iPadOS hardware keyboards and the exact hover behaviour of overlapping views must be checked on a device.
- No gamepad input in SwiftUI itself (GameController is up to the host).
- Not compiled or tested in this repository.

[§1]: ../../docs/algorithms.md#1-data
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§4.5]: ../../docs/algorithms.md#45-anchors-that-disappear
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.1]: ../../docs/algorithms.md#91-clicks
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§10]: ../../docs/algorithms.md#10-auto-linking-aliases
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
