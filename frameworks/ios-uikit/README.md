# DeepTip on iOS and iPadOS with UIKit: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth) in a UIKit app for iPhone and iPad, in Swift: touch first, plus the iPad's pointer and Apple Pencil hover, hardware keyboards, game controllers and VoiceOver.

This folder holds no code: DeepTip code exists only as HTML, CSS, JavaScript and Rust. This guide is the exact recipe for UIKit. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; [SPEC.md](../../SPEC.md) is the contract. The UI-free Swift parts (ordered JSON, parser, placement, engine, their tests) are the same as in the [SwiftUI guide](../swift-swiftui/README.md) and are linked there. No Apple SDK was available, so nothing here was compiled: API names and the first iOS version of each were checked on 2026-10-29 in Apple's documentation (marked *(checked: docs)*); behaviour that needs a device is marked **verify**. Target **iOS 17** (text item actions); the rest works from iOS 15.

## Quick start

**Recognise the project:** an `.xcodeproj` or `.xcworkspace`, Swift files with `import UIKit`, `AppDelegate.swift` and `SceneDelegate.swift` (`UIWindowSceneDelegate`), `UIViewController` subclasses, storyboards or `UIApplicationSceneManifest` in `Info.plist`.

1. Add a Swift package `DeepTipCore` with glossary, parser, placement and engine as the SwiftUI guide describes (its sections 4, 11, 12) and pass the parity cases with `swift test`.
2. Add `glossary/core/<locale>.json` as `deeptip/core.<locale>.json` and your `deeptip/<locale>.json` to the app's resources.
3. Build `DeepTipWindow`, the layer, `TipWindowView`, `TermTextView` and the input handling of sections 3 to 8.
4. Create the scene's window as `DeepTipWindow` and configure DeepTip once.
5. Mark a control: `DeepTip.shared.mark(button, key: "shop.cart")`.

```swift
// SceneDelegate.swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene else { return }
    let window = DeepTipWindow(windowScene: scene)                 // section 3: keeps the layer on top, sees every event
    window.rootViewController = ShopViewController()
    window.makeKeyAndVisible()
    self.window = window
    DeepTip.shared.configure(locale: "en", fallback: ["en"], sources: ["deeptip/core.{locale}.json", "deeptip/{locale}.json"])
}

// ShopViewController.viewDidLoad()
let cart = UIButton(configuration: .filled(), primaryAction: UIAction(title: "Cart") { _ in print("open the cart") })
view.addSubview(cart)
DeepTip.shared.mark(cart, key: "shop.cart")
```

**Done when:** a 0.5 s long-press on *Cart* opens its window pinned with a haptic tick and does not print "open the cart", a tap on *check out* opens the next window beside the first, a tap outside every window closes them all, Esc on a hardware keyboard closes the newest window, `swift test` passes the 24 parity cases.

## 1. Architecture

| Target | Contents | Depends on |
|---|---|---|
| `DeepTipCore` | glossary layers and chain [§1], `parseText` [§2], `computePlacement` [§8], the engine [§4]–[§7] and the decisions of [§9]: exactly the SwiftUI guide's [`DeepTipCore`](../swift-swiftui/README.md#1-architecture) | Foundation |
| `DeepTipUIKit` | `DeepTip` (the controller and API), `DeepTipWindow`, `DeepTipLayerView`, `TipWindowView`, `TermTextView`, element marks, keys, controllers, VoiceOver | `DeepTipCore`, UIKit, GameController |
| example app | the HUD of section 12 | `DeepTipUIKit` |

`DeepTipCore` has no UIKit types; the closest complete implementation to port from is the Rust crate's `src/engine.rs` ([frameworks/rust-egui](../rust-egui/README.md)).

## 2. SPEC concept → UIKit

| SPEC | UIKit |
|---|---|
| Window layer (top layer) | `DeepTipLayerView`, the last subview of the app's `UIWindow`, kept on top by `DeepTipWindow` (section 3). Its `point(inside:with:)` is true only inside DeepTip windows, so every other touch reaches the app. |
| Why not popovers or context menus | A `UIPopoverPresentationController` is modal by default, chooses its side itself, draws an arrow and becomes a sheet on iPhone; one view controller presents one popover. `UIContextMenuInteraction` (iOS 13 *(checked: docs)*) blurs the screen and shows one menu level. Neither gives non-modal windows side by side. An element that already has a context menu can add an *Explain* action to it that opens its DeepTip window pinned. |
| Marked UI element | `DeepTip.shared.mark(view, key:, delay:, place:)`: a `UILongPressGestureRecognizer` (touch and Pencil only: `allowedTouchTypes` contains every touch type by default *(checked: docs)*, so set it to `.direct` and `.pencil`) and a `UIHoverGestureRecognizer` on the view, VoiceOver hint and action (section 8). |
| Term (a real button) | A `.link` run with a private URL (`deeptip://term/3`) in a non-editable `UITextView`; iOS 17's `textView(_:primaryActionFor:defaultAction:)` returns DeepTip's action instead of opening the URL *(checked: docs)*. VoiceOver lists these links. Section 5. |
| Term under the pointer | `UIHoverGestureRecognizer` on the text view + `closestPosition(to:)`, `selectionRects(for:)` (`UITextInput`) *(checked: docs)* + the `.link` attribute at that offset. |
| Long-press | `UILongPressGestureRecognizer`: `minimumPressDuration` defaults to 0.5 s and `allowableMovement` to 10 points *(checked: docs)*: exactly SPEC's `longPress` and `MOVE_TOL`. |
| Haptics | `UIImpactFeedbackGenerator(style: .light)`: `prepare()` when the press starts, `impactOccurred()` when it fires (iOS 10 *(checked: docs)*). |
| Hover (pointer, Pencil hover) | `UIHoverGestureRecognizer` (iOS 13); Pencil hover reports `zOffset` (iOS 16.1) *(checked: docs)*. Hover events are their own event type, `UIEvent.EventType.hover` (iOS 13.4) *(checked: docs)*. |
| Pointer look | `UIPointerInteraction` (iOS 13.4 *(checked: docs)*) on terms' text views: a highlight region per term (`UIPointerRegion(rect:identifier:)`); appearance only, DeepTip's logic uses the hover recognizers. |
| Events at document level | `DeepTipWindow.sendEvent(_:)` (iOS 2 *(checked: docs)*): every touch, hover and press event of the window passes through it before any view, and it can keep a press from the app by not calling `super`. Section 7. |
| Timers | `Timer.scheduledTimer` or `DispatchWorkItem` + `DispatchQueue.main.asyncAfter`; time = `CACurrentMediaTime() * 1000`. |
| Following anchors | `CADisplayLink` while windows are open: re-place when an anchor's rect in the layer changed (scrolling, rotation, Stage Manager). |
| Coordinates | Points, y down. `view.convert(view.bounds, to: layer)`. Viewport: `layer.bounds.inset(by: layer.safeAreaInsets)` minus the keyboard (`keyboardLayoutGuide`, iOS 15 *(checked: docs)*). |
| Keyboard | `UIPressesEvent` in `sendEvent` (`UIPress.key`: `keyCode`, `characters`, `modifierFlags`, iOS 13.4 *(checked: docs)*); section 7.3. |
| Game controller | GameController: `GCController.controllers()`, `.GCControllerDidConnect`, `extendedGamepad` with `buttonA`, `buttonB`, `buttonY`, `leftShoulder`, `rightShoulder`, `dpad`, `leftThumbstick`, `pressedChangedHandler` *(checked: docs)*; section 7.4. |
| Screen reader | `accessibilityCustomActions`, `accessibilityHint`, `accessibilityPerformEscape()`, `UIAccessibility.post(notification: .layoutChanged, argument:)` *(checked: docs)*; section 8. |
| Reduced motion, contrast | `UIAccessibility.isReduceMotionEnabled`, `isDarkerSystemColorsEnabled` (iOS 8 *(checked: docs)*). |
| Theme (`--dt-*`) | Dynamic `UIColor { trait in … }` with the values of section 9; Dynamic Type through `UIFontMetrics` (iOS 11 *(checked: docs)*). |

## 3. `DeepTipWindow` and the layer

```swift
final class DeepTipWindow: UIWindow {
    let tipLayer = DeepTipLayerView()                        // windows of DeepTip live here, in open order

    override func didAddSubview(_ subview: UIView) {
        super.didAddSubview(subview)
        if subview !== tipLayer { bringSubviewToFront(tipLayer) } // presented controllers and alerts are added later
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if tipLayer.superview !== self { addSubview(tipLayer) }
        tipLayer.frame = bounds
    }
    override func sendEvent(_ event: UIEvent) {
        if DeepTip.shared.capture(event, in: self) { return } // a press DeepTip consumed (section 7.3)
        super.sendEvent(event)
    }
}

final class DeepTipLayerView: UIView {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        subviews.contains { !$0.isHidden && $0.frame.contains(point) } // empty space passes touches to the app
    }
}
```

- The layer sits above modally presented controllers too, like the web's top layer above `<dialog>`s: windows opened inside a sheet are visible, and pinned windows of the page below stay above the sheet.
- Apps that cannot use their own window class: add the layer to the window anyway and call `bringSubviewToFront` after each presentation, and use `UIKeyCommand`s (section 7.3) instead of `sendEvent`.
- `TipWindowView`s are frame-laid-out subviews of the layer (section 4); later subviews draw on top, so open order is drawing order.

## 4. Measuring and placing windows ([§8])

`TipWindowView` lays out its parts by frame: header (title label, fallback badge, pin and close buttons), body (`TermTextView`), "See also" (`TermTextView`), hint, lock bar.

1. **Natural size**: width = the widest of the header's natural width and `textView.sizeThatFits(CGSize(width: .greatestFiniteMagnitude, height: .greatestFiniteMagnitude)).width` of body and "See also", plus the paddings and the 1 pt border; clamp it to `[min(240, vp.width − 16), min(384, vp.width − 16)]`. Height = the parts' `sizeThatFits(CGSize(width: contentWidth, height: .greatestFiniteMagnitude)).height` at that width, at most `min(480, vp.height − 16)`.
2. **Target**: the parent window's frame for children; for roots `anchor.convert(anchor.bounds, to: layer)`; both moved by `(-safe.left, -safe.top)` into viewport coordinates. Sides: the element's own `place`, else `root` or `child`.
3. `p = computePlacement(size, target, sides, viewport, gap: 8)`. If `maxW` or `maxH` is set, lay out again with that limit (`maxW` below the minimum width keeps the minimum, as `min-width` wins in the reference's CSS) and compute once more with `[p.side]`.
4. `frame = CGRect(x: p.x + safe.left, y: p.y + safe.top, width: w, height: h)`; store it in the engine (tendency, children's target).
5. When the body is taller than its share, give it `isScrollEnabled = true` and the remaining height; otherwise `false` (a scrolling text view reports no intrinsic height).
6. Re-place every window that is not frozen in the layer's `layoutSubviews` (rotation, split view, Stage Manager, keyboard), after `pin`/`unpin` (the hint line changes the height), after `refresh()`, and from the display link when an anchor moved.

Anchors that disappear ([§4.5]): the display link sees `anchor.window == nil`; previews on it close, a pinned root freezes at its frame.

## 5. Text and terms: `TermTextView`

A `UITextView` subclass: `isEditable = false`, `isSelectable = true` (links only react when the view is selectable *(checked: docs)*), `isScrollEnabled = false`, `textContainerInset = .zero`, `textContainer.lineFragmentPadding = 0`, `backgroundColor = .clear`, `adjustsFontForContentSizeCategory = true`.

| AST node ([§3]) | `NSAttributedString` |
|---|---|
| `text` | a plain run (glossary text is never markup) |
| `br` | `"\n"` |
| `b`, `i` | font with `.traitBold` / `.traitItalic` (`UIFontDescriptor.withSymbolicTraits`), nested |
| `code` | `UIFont.monospacedSystemFont(ofSize: 0.92 × size, weight: .regular)` |
| `var` | `UIFont.monospacedDigitSystemFont(ofSize:weight: .semibold)` |
| link to the window's own key | bold run |
| link to a missing key | `.underlineStyle` `.patternDot` with `.underlineColor` `#d33`, no link |
| term | `.link: URL(string: "deeptip://term/\(index)")!`; keep `keys[index]`; the look comes from `linkTextAttributes` |
| paragraphs, lists | `NSParagraphStyle` with `paragraphSpacing` 0.5 em; list items with a `"•\t"` prefix, `headIndent` 1.2 em and a tab stop |

```swift
func textView(_ textView: UITextView, primaryActionFor textItem: UITextItem, defaultAction: UIAction) -> UIAction? {
    guard case .link(let url) = textItem.content, url.scheme == "deeptip", let term = term(for: url) else { return defaultAction }
    return UIAction { _ in DeepTip.shared.follow(term, keyboard: false) }  // the URL is never opened
}
func textView(_ textView: UITextView, menuConfigurationFor textItem: UITextItem, defaultMenu: UIMenu) -> UITextItem.MenuConfiguration? {
    nil                                                                    // nil prevents the link menu (documented)
}
```

- Before iOS 17 use `textView(_:shouldInteractWith:in:interaction:)` and return `false` after handling (deprecated in iOS 17 *(checked: docs)*). iOS 17 also offers `NSAttributedString.Key.textItemTag` with `UITextItem.Content.tag(_:)` *(checked: docs)*; a `.link` run is still the better term because VoiceOver treats it as a link.
- **Hit test for hover**: `let pos = textView.closestPosition(to: p)`, offset = `textView.offset(from: textView.beginningOfDocument, to: pos)`; accept only if one of `textView.selectionRects(for: range of that character)` contains `p` (`closestPosition` always answers, also far from any text), then read `.link` at that offset. Use these `UITextInput` methods rather than `layoutManager`: on iOS 16 and later a text view runs TextKit 2, and reading `layoutManager` switches it to TextKit 1 (Apple's TextKit 2 notes, **verify** on your iOS version).
- **Term box** (anchor of a page term, focus ring): the union of `selectionRects(for:)` of the term's range, converted to the layer.
- **Open term and keyboard focus** look: add `.backgroundColor` (term colour at 16 %) to the range while its window is open; draw the focus ring yourself from the term box.

## 6. Touch: the exact behaviour (SPEC §3.3, §3.5)

Touch never hovers: no previews, no tendency, no timer lock.

| Gesture | Steps |
|---|---|
| finger down outside every window | `DeepTipWindow.sendEvent`: a touch in phase `.began` whose location in the layer hits no window, with windows open and `outsideClickCloses` `touch` (default) or `always` → close all; then `super.sendEvent` delivers it to the app as usual |
| finger down on a marked view | its long-press recognizer starts tracking: show the rest progress (the view's `deepTipArming` hook), `feedback.prepare()` |
| moved more than 10 pt, lifted early | the recognizer fails: progress gone; the view's own tap or button action runs as usual |
| held 0.5 s | `.began`: progress gone, `impactOccurred()` (if `vibrate`), `openPinned(view, focus: false, via: .touch)`. The recognizer's default `cancelsTouchesInView = true` cancels the view's touches, so a `UIButton` gets `touchesCancelled` and fires no primary action (**verify** for your control types). |
| tap on a term in a window | `primaryActionFor` (section 5): `follow`; the parent window is pinned, the term's window opens pinned beside it ([§9.1]) |
| tap on a page term | the same without parent; the finger-down outside every window closed all first, as on the web |
| tap inside a window, not on a term or button | a `UITapGestureRecognizer` on `TipWindowView` with `cancelsTouchesInView = false` whose delegate rejects touches on buttons and links (`gestureRecognizer(_:shouldReceive:)`) → `clickInsidePins` |
| swipe a title bar down | a `UIPanGestureRecognizer` on the header (not its buttons): on `.ended`, `translation.y > 60 && abs(translation.x) < 60` → close all |
| pin, close | `UIButton`s of at least 40 × 40 pt (44 is Apple's guideline) |

- A view whose own long-press, context menu or `UIButton.menu` with `showsMenuAsPrimaryAction` already uses the gesture conflicts with DeepTip's: add *Explain* to that menu instead.
- Inside a `UIScrollView` the long-press fails once the finger moves 10 pt, so scrolling keeps working.
- Text that the user can select (`UITextView` with `isSelectable`, `UITextField`) starts a selection on long-press: mark its label instead.

## 7. Pointer, keyboard, controllers: exact order of operations

### 7.1 Hover (iPad pointer, Apple Pencil hover)

| Where | Handler |
|---|---|
| `DeepTipWindow` | one `UIHoverGestureRecognizer` on the window (it sees hover over every descendant): `.began`/`.changed` → add a sample `(location(in: layer), now)` and trim ([§5]); `.ended`/`.cancelled` → "on pointer leaving" ([§6]) |
| marked view | its own hover recognizer: `.began` → `hoverElement = view`; `.ended`, `.cancelled` → if still that view: `nil` |
| `TipWindowView` | `.began` → `hoverWindow = tip`; `.ended` → if still `tip`: `nil` |
| `TermTextView` | `.began`/`.changed` → the term under the pointer (section 5) or `nil`; `.ended` → `nil` |

After each change, `resolve()`: `win` = `hoverWindow` if open, `link` = `hoverTerm`, `trig` = `hoverElement` only when both are `nil`; when the triple changed, "on pointer over" ([§6]). Clicks with a pointer arrive as touches of type `.indirectPointer` (iOS 13.4 *(checked: docs)*): in `sendEvent`, a click that begins on a marked view hushes it ([§6]); the long-press recognizer ignores pointer clicks because its `allowedTouchTypes` excludes them (section 2).

### 7.2 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6] |
| close | `leave(w)` | `tick()` of [§5] |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7]); the bar is a `CABasicAnimation` on `transform.scale.x` |
| flash | `flash(w)` | 600 ms ring animation ([§4.4]); none with Reduce Motion |
| Esc / B held | first press | 600 ms → close all |

Let the engine own the timers through one clock, as the SwiftUI guide's [section 9](../swift-swiftui/README.md#9-timers-and-animation) does.

### 7.3 Hardware keyboard

`DeepTip.shared.capture(_:in:)` looks at `UIPressesEvent`s before any responder; returning `true` keeps the press from the app.

| Press | Steps |
|---|---|
| `keyCode == .keyboardEscape` began (iOS 13.4 *(checked: docs)*) | no windows → `false`. Shift in `modifierFlags` → close all, focus to the root's anchor; else close `newest(focused window)` with focus back and start the 600 ms hold timer. `true`. |
| Esc ended | cancel the hold timer; `true` if the began was consumed |
| `.keyboardF6` began, windows open | `cycle(shift ? -1 : 1)`; `true` |
| `.keyboardF1` began, or `characters == "?"` | the focused term (DeepTip's own term focus) → `follow(focus: true)`; else a marked view that is or contains the first responder or the focused item (`UIFocusSystem.focusSystem(for: window)?.focusedItem`) → open it pinned with focus (`via: .key`); `true` only then. `?` does nothing while a text input is first responder. |
| Tab, Shift+Tab, Return, Space with the focus in a window | move DeepTip's term focus through the window's terms, then its buttons; Return or Space follows the focused term; `true` |
| a printable `characters`, no Command, Control or Option, first responder inside a marked view | hush it ([§6]); `false` |

Swallow the ended phase of every press whose began was swallowed. Without `DeepTipWindow`, give the root view controller `UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action:)`, `UIKeyCommand.f1`, `UIKeyCommand.f6` (iOS 13.4 *(checked: docs)*) with `wantsPriorityOverSystemBehavior = true` (iOS 15): those run only when no deeper responder handles the key.

### 7.4 Game controllers

Register `pressedChangedHandler`s (iOS 8) for the controllers of `GCController.controllers()` and of every `.GCControllerDidConnect` notification (iOS 7) *(checked: docs)*; they run on the main queue unless `handlerQueue` (of `GCDevice`, iOS 9 *(checked: docs)*) says otherwise:

| Input | Steps ([§9.4]) |
|---|---|
| `buttonY` pressed | as F1 on the focused element or term |
| `buttonB` pressed | start the 600 ms hold timer (close all, focus back) |
| `buttonB` released | timer pending → cancel it, close `newest(focused)` with focus back |
| `buttonA` pressed | activate the focused term (follow) or button |
| `leftShoulder` / `rightShoulder` | `cycle(-1)` / `cycle(1)` |
| `dpad`, `leftThumbstick` beyond ±0.6 | step through the focused window's terms and buttons, wrapping |

A game that reads the controller itself calls `openFocused()`, `activate()`, `closeNewest()`, `closeAll()`, `cycle(_:)`, `step(_:)` instead.

### 7.5 Focus ([§9.5])

Opening by keyboard, controller or VoiceOver focuses the window's first term (DeepTip's term focus, drawn by the window) and posts `UIAccessibility.post(notification: .layoutChanged, argument: titleLabel)` so VoiceOver moves into it. Closing returns the focus to the anchor if it was inside the closed subtree (`.layoutChanged` with the anchor view).

## 8. VoiceOver and accessibility (SPEC §6)

| Part | UIKit |
|---|---|
| marked view | `accessibilityHint` = the entry's `short`; `accessibilityCustomActions = [UIAccessibilityCustomAction(name: label("explain")) { _ in open pinned with focus; return true }]` (iOS 13 *(checked: docs)*): VoiceOver's *Actions* rotor |
| term | a link run (section 5): VoiceOver's links rotor; double-tap follows it through `primaryActionFor` (**verify**) |
| window | `TipWindowView`: `accessibilityLabel` = title, `shouldGroupAccessibilityChildren = true`, `accessibilityViewIsModal = false` (pinned windows are non-modal); `accessibilityPerformEscape()` (iOS 5 *(checked: docs)*) → close it with focus back: the two-finger Z gesture is Esc |
| pin, close | `UIButton`s with `accessibilityLabel` = `label("pin" / "unpin" / "close")`, `.selected` trait while pinned |
| motion, contrast | no flash animation when `UIAccessibility.isReduceMotionEnabled`; with Increase Contrast (`isDarkerSystemColorsEnabled`, or `traitCollection.accessibilityContrast == .high`) border in the text colour |

`explain` is an own label next to the `$ui` labels of [§1.2]; put it into the project glossary's `$ui` (the schema allows extra labels).

## 9. Look: the values of `deeptip.css`

CSS pixels are points.

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term (`linkTextAttributes` foreground) | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % | same |

| Measure | Value |
|---|---|
| width, height | 240–384 pt wide incl. the 1 pt border, at most 480 pt high; the body scrolls |
| text | 14 pt scaled with `UIFontMetrics(forTextStyle: .callout)`, line height 1.5 (`lineHeightMultiple`); title semibold |
| frame | `layer.cornerRadius = 8`, `layer.borderWidth = 1` (pinned: accent), shadow `opacity 0.3, radius 15, offset (0, 10)` with a `shadowPath` |
| header | insets 6 / 12 / 2 / 6 (top, left, bottom, right); pin and close 40 × 40 pt on iPhone, 26 × 26 pt when a pointer is used; SF Symbols `pin`, `pin.fill`, `xmark` |
| body, "See also" | insets 0 / 12 / 10 / 12; "See also" at 0.9 with its label at 70 % opacity |
| hint | hidden on iPhone and when pinned; on iPad with a pointer: 0.75 size, 60 % opacity, 1 pt line above |
| terms | `.underlineStyle` `[.single, .patternDot]`, solid while hovered or open |
| flash, lock bar | 3 pt accent ring peaking at 30 % of 600 ms; 2 pt accent bar at the bottom growing over `lockAfter` |

## 10. Glossary, live values, locales

- Files from the bundle: `Bundle.main.url(forResource:withExtension:)`; parse with the ordered JSON reader of the SwiftUI guide ([section 11](../swift-swiftui/README.md#11-loading-the-json-in-file-order-1)): `JSONSerialization` returns dictionaries without order, and [§1] needs file order. Strip a byte order mark. `sources` are paths with `{locale}`, loaded for each locale of the chain in template order (core first, project after).
- Live values: `values["gold"] = …` or a provider `(name, key) -> String?`; `refresh()` re-renders every open window and page text and re-places them ([§4.6]).
- `setLocale(_:)` loads the missing files of the new chain, then refreshes.
- Validate the files with `tools/deeptip-check.mjs`.

## 11. Testing

- **Parity cases and engine** ([§11]): `swift test` on `DeepTipCore`, as in the SwiftUI guide's [section 17](../swift-swiftui/README.md#17-tests-11), with its [Swift porting notes](../swift-swiftui/README.md#12-porting-the-parser-and-placement-to-swift-2-8) (UTF-16 positions, JavaScript whitespace, NaN in `min` and `max`). Runs on macOS and Linux without UIKit.
- **UIKit** (**verify**, needs Xcode): XCTest with a hosted app; drive `DeepTip` through its methods (`longPress(view)`, `follow(term)`, `capture(event)`) and assert frames, open windows and `isScrollEnabled`; XCUITest for real gestures (`press(forDuration: 0.6)`) and VoiceOver actions (`performAccessibilityAction`) is optional.
- By hand: compare with the web example (`npm run demo`, open it in Safari on the same device).

## 12. The example to build

The screen of `frameworks/web/example`: a HUD row of buttons marked `demo.realm`, `demo.stability` (tap: −3 … +3, live value `{stability}`), `demo.taxes` (tap: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), and a help button `deeptip.about` with `delay: 0`; a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English); four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) inside the safe area for placement at the screen edges; a page text with terms; settings (outside tap, close and pin buttons, hint line, lock); the encyclopedia (`UISearchTextField` + `UITableView` of rows with `TermTextView`s, sorted with `localizedStandardCompare`); an event log. Glossaries: `glossary/core` and `glossary/example` in the bundle. Screen texts: those of `frameworks/web/example/index.html`. Try it on an iPhone, on an iPad with a trackpad and a keyboard, with a controller and with VoiceOver.

## 13. Pitfalls

- A presented controller is added to the window after the layer: without `DeepTipWindow` (or an explicit `bringSubviewToFront`) windows end up below sheets and alerts.
- Links react only in a selectable text view, and a selectable text view also selects text on a long-press inside a window (harmless: DeepTip uses no long-press there); a scrolling text view has no intrinsic height (sections 5, 4).
- `textContainerInset` (8 pt by default) and `lineFragmentPadding` (5 pt) shift every measurement until set to zero.
- Reading `layoutManager` puts the text view into TextKit 1 (section 5).
- Swallow both phases of a press; a lone `pressesEnded` confuses responders.
- `UIButton.menu` with `showsMenuAsPrimaryAction`, context menus and DeepTip's long-press compete (section 6).
- `CADisplayLink` holds its target strongly: invalidate it when the last window closes.

## 14. Limitations compared with the web reference

- Windows live inside the app's window (scene); every scene needs its own layer.
- Hover previews, the tendency and the timer lock need a pointer or Pencil hover (iPad); iPhone is touch only.
- Terms are text runs: keyboard focus on them is DeepTip's own (drawn ring, own Tab order).
- Not compiled in this repository; device behaviour is marked **verify**.

## 15. Checklist

1. `DeepTipCore` with the parity cases and engine scenarios (`swift test`).
2. Glossary with layers, chain, `$ui` labels, live values; the validator on the same files.
3. `DeepTipWindow`, layer, `TipWindowView`, `TermTextView`, marks, touch, hover, keys, controllers, VoiceOver (sections 3–8).
4. The example on iPhone and iPad with VoiceOver, keyboard and controller; compare with the web example; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.2]: ../../docs/algorithms.md#12-layers-locales-lookup
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§4.4]: ../../docs/algorithms.md#44-flashw
[§4.5]: ../../docs/algorithms.md#45-anchors-that-disappear
[§4.6]: ../../docs/algorithms.md#46-refresh
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.1]: ../../docs/algorithms.md#91-clicks
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
