# DeepTip in Flutter: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth) in a Flutter app: one Dart code base for Android, iOS, web, Windows, macOS and Linux, used with touch, mouse, keyboard, gamepad and screen readers.

This folder holds no code: DeepTip code exists only as HTML, CSS, JavaScript and Rust. This guide is the exact recipe for Flutter. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12] instead of repeated; [SPEC.md](../../SPEC.md) is the contract. Marks: *(checked)* = ran on 2026-10-29 in a throwaway Dart 3.13.7 project (the Dart of Flutter 3.47.8): a port of the pure functions that passes all 24 parity cases, probes of Dart's strings, regular expressions and JSON, and timer and clock probes under `FakeAsync`; *(checked: source)* = read in the Flutter 3.47.8 framework source; **verify** = needs the Flutter SDK or a device, which were not available.

## Quick start

**Recognise the project:** `pubspec.yaml` with `flutter: sdk: flutter` under `dependencies`, `lib/main.dart` calling `runApp`, the folders `android/`, `ios/` (often `web/`, `windows/`, `macos/`, `linux/`) and a `.metadata` file.

1. Copy `glossary/core/<locale>.json` to `assets/deeptip/core.<locale>.json`, write `assets/deeptip/<locale>.json`, and list `assets/deeptip/` under `flutter: assets:`.
2. Port the pure core to `lib/deeptip/core.dart` (section 11) and pass the 24 parity cases with `flutter test` (section 12).
3. Build the engine and the widgets of sections 3 to 8 in `lib/deeptip/`.
4. Put `DeepTipScope` into `MaterialApp.builder` (or `CupertinoApp.builder`, `WidgetsApp.builder`).
5. Wrap an element in `DeepTip('shop.cart', child: …)` and give each page a `DeepTipBackScope`.

```dart
import 'package:flutter/material.dart';
import 'deeptip/deeptip.dart'; // built from this guide

final dt = DeepTipController(
  locale: 'en',
  fallback: ['en'],
  sources: ['assets/deeptip/core.{locale}.json', 'assets/deeptip/{locale}.json'],
);

void main() => runApp(MaterialApp(
      builder: (context, child) => DeepTipScope(controller: dt, child: child!),
      home: DeepTipBackScope(
        child: Scaffold(
          body: Center(
            child: DeepTip('shop.cart', child: FilledButton(onPressed: () {}, child: const Text('Cart'))),
          ),
        ),
      ),
    ));
```

**Done when:** resting the mouse on *Cart* for 800 ms opens its window below the button, a 500 ms long-press opens it pinned with a short vibration and without running `onPressed`, a tap or click on *check out* opens a second window beside the first, Esc or the Android back gesture closes the newest window, `flutter test` passes the 24 parity cases.

## 1. Parts to build

| Part | Does | Flutter types |
|---|---|---|
| `core.dart` | [§1]: flatten, layers per locale, chain, `entry(key)`, `label(name)`, live values; [§2]: `parseText`, `collectRefs`; [§8]: `computePlacement` | none (pure Dart) |
| `engine.dart` | [§4]–[§7] and the decisions of [§9]: window tree, hot set, grace, tendency, suppression, arming, lock, Esc, F6 | none: talks to a `TipHost` interface and a `Clock` (the same design as the [Swing guide](../java-swing/README.md#3-data-structures)) |
| `DeepTipController` | `ChangeNotifier` that owns glossary, engine, options and the open windows; the public API (section 13) | `ChangeNotifier` |
| `DeepTipScope` | root widget: provides the controller, observes every pointer, registers the early key handler | `InheritedNotifier`, `Listener`, `MouseRegion` |
| `DeepTip` | marks a UI element and hosts the `OverlayPortal` of its window | `OverlayPortal`, `MouseRegion`, `RawGestureDetector`, `Semantics` |
| `TermText`, `TermButton` | renders the AST; terms are focusable inline buttons | `Text.rich`, `WidgetSpan`, `FocusableActionDetector` |
| `TipWindow` | header, body, "See also", hint, lock bar, flash; hosts the `OverlayPortal` of its child windows | `FocusScope`, `SingleChildScrollView` |
| `TipPlacer` | measures and places windows beside their target ([§8]) | own `RenderBox` |
| `DeepTipBackScope` | the back gesture closes the newest window | `PopScope` |
| `DeepTipText`, `DeepTipIndex` | terms on normal screens, the encyclopedia ([§12]) | widgets |

Keep `core.dart` and `engine.dart` free of `package:flutter` imports: every rule of [§4]–[§7] is then a plain unit test.

## 2. SPEC concept → Flutter primitive

| SPEC | Flutter |
|---|---|
| Glossary files (§2.1) | `rootBundle.loadString(path)`, then `jsonDecode`: the `Map` keeps the file order *(checked)*; section 10. |
| Window layer (top layer) | `Overlay`: each window is the overlay child of an `OverlayPortal`, built with `OverlayPortal.overlayChildLayoutBuilder`, the constructor Flutter made for anchored popups. Its builder runs during layout and gets the anchor's size, its paint transform in the overlay and the overlay's size *(checked: source)*. Section 4. |
| Stacking order | Overlay children paint after the overlay entry of their route, in the order their controllers called `show()`; `show()` on a showing portal brings it to the top *(checked: source)*. Windows of a page therefore stay below a dialog opened later and go away with their route. |
| Marked UI element (`data-deeptip`) | `DeepTip('key', delay:, place:, editable:, child:)`. |
| State hooks (`data-dt-open`, `data-dt-arming`) | `controller.isOpen(element)` and `controller.arming(element)` as `ValueListenable`s; `DeepTip(builder: (context, open, arming, child) => …)` draws a rest-progress bar or hides an own tooltip. |
| Term (a real button) | `WidgetSpan(alignment: PlaceholderAlignment.baseline, baseline: TextBaseline.alphabetic, child: TermButton(…))`: focusable, hoverable, a link for screen readers. Like the web's inline `<button class="dt-link">` it is one inline box that moves to the next line as a whole. Section 6. |
| Term under the pointer | The term's own `MouseRegion`; no hit-test arithmetic. |
| Pointer over / out per element, term, window | `MouseRegion.onEnter` / `onExit`. Flutter's `MouseTracker` tracks only mouse and stylus pointers, so touch never hovers, and it sends exits before enters *(checked: source)*. |
| Pointer at document level | `Listener(behavior: HitTestBehavior.translucent)` around the app in `DeepTipScope`: `onPointerHover`, `onPointerMove`, `onPointerDown`, `onPointerUp`, `onPointerCancel` for every pointer; it never takes part in the gesture arena, so the app keeps every gesture. |
| `delay`, `linkDelay`, `closeDelay`, `lockAfter`, retries | `Timer` (dart:async) through the engine's `Clock`; section 3. |
| Flash, lock bar, rest progress | `AnimationController` in the window state, started from engine events; `MediaQuery.disableAnimationsOf(context)` = reduced motion. |
| Keyboard in the capture phase | `FocusManager.instance.addEarlyKeyEventHandler(handler)`: called before any `Focus.onKeyEvent` of the focus tree; returning `KeyEventResult.handled` stops the event *(checked: source)*. Section 7.3. |
| Focus | One `FocusScopeNode` per window (`FocusScope`), `FocusNode.requestFocus()`, `FocusManager.instance.primaryFocus`, `FocusTraversalGroup` per window. |
| Coordinates | Logical pixels, y down. Boxes in global coordinates: `RenderBox.localToGlobal`; pointer events carry `position` (global) and `localPosition`. |
| Viewport, safe areas | The overlay's size minus `MediaQuery.paddingOf(context)` (status bar, notch, home indicator) and `MediaQuery.viewInsetsOf(context)` (on-screen keyboard) *(checked: source: both accessors exist)*. |
| Touch long-press (§9.2) | `RawGestureDetector` with `LongPressGestureRecognizer(duration: longPress, supportedDevices: {PointerDeviceKind.touch})` around the element. When it wins the gesture arena the element's own tap recognizer is rejected, so its `onPressed` does not run (section 7.2). |
| Vibration | `HapticFeedback.mediumImpact()` (or `Feedback.forLongPress(context)`, which also notifies accessibility services). |
| Back (Android) | `PopScope(canPop: no windows open, onPopInvokedWithResult: …)` per route, section 7.4. |
| Gamepad (§9.4) | Android delivers controller buttons as key events: `LogicalKeyboardKey.gameButtonA`, `gameButtonB`, `gameButtonY`, `gameButtonLeft1`, `gameButtonRight1` *(checked: source)*. Section 7.5. |
| Accessibility (§6) | `Semantics` on elements, terms and windows, section 8. |
| Encyclopedia (§12) | `TextField` + `ListView` of rows built with `TermText`. |
| Theme (`--dt-*`) | A `ThemeExtension<DeepTipTheme>` in `ThemeData.extensions` with the values of section 5. |

## 3. Data structures

```dart
enum Via { hover, click, key, touch, pad, api }

sealed class TipAnchor {}                                  // what a window belongs to; value equality
final class ElementAnchor extends TipAnchor { ElementAnchor(this.element); final Object element; /* the DeepTip widget's state; == by identity */ }
final class TermAnchor extends TipAnchor { TermAnchor(this.win, this.key, this.n); final int win; final String key; final int n; /* == by fields */ }
final class PageTermAnchor extends TipAnchor { PageTermAnchor(this.text, this.n); final Object text; final int n; /* == by fields */ }

typedef Box = ({double left, double top, double right, double bottom}); // global logical pixels, y down

class Tip {
  Tip(this.id, this.key, this.parent, this.anchor, this.via);
  final int id;
  final String key;
  final Tip? parent;
  TipAnchor anchor;
  final Via via;
  final children = <Tip>{};                                  // a LinkedHashSet: insertion order
  bool pinned = false, frozen = false;
  void Function()? closeTimer;                               // cancel handle from the Clock
  Box? box;                                                  // last placed box; a plain field
  Object? view;                                              // Flutter side: the window's FocusScopeNode and the
                                                             // OverlayPortalController of its child windows
}

abstract interface class Clock {
  int now();                                                 // milliseconds, monotonic
  void Function() after(int ms, void Function() task);       // returns cancel
}
```

`TermAnchor(win, key, n)` names a term by the window it is in, its key and its occurrence `n` in reading order (body, then "See also"): a re-rendered window (language switch, new live value) produces equal anchors, so [§4.6] needs no re-attachment step. Engine state as in the Swing guide: `wins` (oldest first), hover triple `(win, link, trig)`, `hot`, `pending`, `samples`, `quiet`, `lockWin`, `escDown`, `escAt`, `seq`.

The clock:

```dart
import 'dart:async';
import 'dart:math' as math;
import 'package:clock/clock.dart';

class TimerClock implements Clock {
  final _watch = clock.stopwatch()..start();
  @override
  int now() => _watch.elapsedMilliseconds;
  @override
  void Function() after(int ms, void Function() task) => Timer(Duration(milliseconds: math.max(0, ms)), task).cancel;
}
```

Use `clock.stopwatch()` from `package:clock` (add it to `dependencies`; `flutter_test` already depends on it), not `Stopwatch()`: under `FakeAsync`, which `flutter test` uses, timers fire at their due time in order (equal times in creation order) and `clock.stopwatch()` follows the fake time, while a plain `Stopwatch` keeps measuring real time *(checked)*. `tester.binding.clock` is that fake clock in widget tests *(checked: source)*.

## 4. Windows: overlay portals and placement

### 4.1 Who hosts which window

| Window | Its `OverlayPortal` | Target box ([§8] step 1) |
|---|---|---|
| root on a marked element | in `DeepTip`, around the element | the element (`info.childSize`, `info.childPaintTransform`) |
| root on a page term | in that `TermButton` | the term |
| child (from a term inside a window) | in the parent `TipWindow`, around the window's content; one portal for all children of that window | the parent window |

```dart
// in DeepTipState.build (the element's own child goes in `child`)
OverlayPortal.overlayChildLayoutBuilder(
  controller: portal,
  overlayChildBuilder: (context, info) => TipPlacer(
    controller: dt,
    target: MatrixUtils.transformRect(info.childPaintTransform, Offset.zero & info.childSize),
    overlaySize: info.overlaySize,
    sides: place ?? dt.options.root,
    tips: [?dt.windowAt(anchor)],
  ),
  child: decorated,
)
```

- When the engine opens a window, call `show()` on the portal that hosts it, also when it already shows (brings it to the top, *(checked: source)*); hide a portal when it hosts no window any more.
- Nested portals (a child window's portal inside a window that is itself an overlay child) are what cascading menus need as well; check the paint order of three nested levels once (**verify**).
- The builder runs during layout. Reading another render object's `size` during a layout asserts in debug mode (`RenderBox.size accessed beyond the scope of resize, layout, or permitted parent access`) *(checked: source)*: `info` is the legal way to get the anchor's box at that moment, and it follows the anchor when a list scrolls, without a frame of delay.

### 4.2 `TipPlacer`: measure, place, shrink

A `MultiChildRenderObjectWidget` whose render object is as large as the overlay, paints and hit-tests only its windows, and lays them out in order:

```dart
@override
void performLayout() {
  size = constraints.biggest;                                     // the overlay
  final pad = safeArea;                                           // MediaQuery.paddingOf + viewInsetsOf, from the widget
  final vp = (w: size.width - pad.horizontal, h: size.height - pad.vertical);
  final limits = BoxConstraints(
    minWidth: math.min(240, vp.w - 16), maxWidth: math.min(384, vp.w - 16), maxHeight: math.min(480, vp.h - 16));
  final r = target.translate(-pad.left, -pad.top);                // viewport coordinates
  final a = (left: r.left, top: r.top, right: r.right, bottom: r.bottom);
  for (var child = firstChild; child != null; child = childAfter(child)) {
    final data = child.parentData! as TipParentData;
    final natural = child.getDryLayout(limits);
    var p = computePlacement((w: natural.width, h: natural.height), a, sides, vp, 8);
    var c = limits;
    if (p.maxW > 0 || p.maxH > 0) {
      c = limits.copyWith(
        maxWidth: p.maxW > 0 ? math.max(limits.minWidth, math.min(limits.maxWidth, p.maxW)) : null,
        maxHeight: p.maxH > 0 ? math.min(limits.maxHeight, p.maxH) : null);
    }
    child.layout(c, parentUsesSize: true);
    if (c != limits) p = computePlacement((w: child.size.width, h: child.size.height), a, [p.side], vp, 8);
    data.offset = Offset(p.x + pad.left, p.y + pad.top);
  }
}
```

`computePlacement` takes records (`({double w, double h})`, `({double left, double top, double right, double bottom})`) so `core.dart` needs no `dart:ui`.

- Size limits as in [§8] step 3: width between 240 and 384, height at most 480, each at most the viewport minus 16. When a side forces a width below the minimum width, the minimum wins, as `min-width` beats `max-width` in the web reference's CSS.
- `getDryLayout` measures without laying out. Every render object inside a window must support it: `Column`, `Row`, `Padding`, `DecoratedBox`, `SingleChildScrollView` and `RichText` do, also with baseline-aligned `WidgetSpan`s (they use `ChildLayoutHelper.getDryBaseline`), `LayoutBuilder` does not *(checked: source)*. A `MultiChildLayoutDelegate` cannot do the shrink step: it must lay out each child exactly once *(checked: source)*.
- Hit testing: `hitTestSelf` returns false and `hitTestChildren` tests the windows topmost first (`defaultHitTestChildren`), so presses outside every window reach the app below.
- `tip.box`: in `paint` (after layout), store the window's global box, `localToGlobal(data.offset) & child.size` as a `Box`. Never notify listeners from layout or paint; the engine reads `tip.box` in events and timers only.
- Inside the window: a `Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch)` in `IntrinsicWidth`, the body in `Flexible(child: SingleChildScrollView(…))`: header, "See also" and hint keep their height, the body scrolls when 480 is not enough. `IntrinsicWidth` needs intrinsic sizes, which the same widgets provide *(checked: source: `RenderParagraph` and the scroll view's viewport implement them)*; a wrapping body then takes the full width, as in CSS (`TextWidthBasis.parent`).

### 4.3 Anchors that move or disappear ([§4.5])

- A marked element that is disposed takes its `OverlayPortal` along: previews on it close, and a pinned root closes too. SPEC [§4.5] freezes pinned roots instead; if that matters, render all roots in one layer above the navigator (section 4.4).
- A window whose route is covered by an opaque route is not painted (it belongs to that route's overlay entry) and comes back with it.
- Scrolling and window resizing re-run layout; `TipPlacer` places again.

### 4.4 Alternative: one layer above the navigator

`MaterialApp.builder` wraps the navigator (`Builder(builder: (context) => widget.builder!(context, routing))` in `WidgetsApp`) *(checked: source)*, so a `Stack` of the app and one window layer there floats above every route and dialog, like the web's top layer, and can freeze pinned roots. The costs: anchor boxes must be measured after the frame (a post-frame callback per open root, then `markNeedsLayout` on the layer), so windows trail a scrolling anchor by one frame; covered routes must hide their windows themselves (`ModalRoute.isCurrentOf(context)`); and there is no `Overlay` above the navigator, so `Tooltip` inside a window needs an `Overlay` of its own.

## 5. Look: the values of `deeptip.css`

CSS pixels are logical pixels; text sizes go through the `TextScaler`.

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % | same |
| button hover background | black at 7 % | white at 9 % |
| missing link | text colour, wavy or dotted underline `#d33` | same |

| Measure | Value |
|---|---|
| width, height | 240–384 wide (whole window incl. 1 px border), at most 480 high; the body scrolls |
| text | 14, line height 1.5 (`height: 1.5`); title `FontWeight.w600`; code monospace at 0.92; live values `FontWeight.w600` with `FontFeature.tabularFigures()` |
| frame | radius 8, border 1 (pinned: accent), shadow `BoxShadow(color: Color(0x4D000000), blurRadius: 30, offset: Offset(0, 10))` |
| header | padding left 12, top 6, right 6, bottom 2; pin and close 26 × 26 with 15 px icons, 2 apart; **40 × 40 with 18 px icons on touch devices**; fallback badge 0.7 font size, 1 px border, radius 3 |
| body | padding 0 12 10 (top, sides, bottom); paragraphs and lists 0.5 em apart; list indent 1.2 em |
| "See also" | padding 0 12 10, font 0.9, label at 70 % opacity |
| hint | padding 4 12 6, font 0.75, 60 % opacity, 1 px line above; hidden when pinned **and on touch devices** |
| flash | 3 px ring in the accent colour, strongest at 30 % of 600 ms; with reduced motion a static 3 px outline |
| lock bar | 2 px along the bottom edge, accent colour, grows left to right over `lockAfter` |

Light or dark: `Theme.of(context).brightness`. High contrast (`MediaQuery.highContrastOf`): border in the text colour, pinned border 2 px.

## 6. Text and terms

Render each block of the AST ([§3]) as its own `Text.rich`: a paragraph, or a list item as `Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [Text('•'), Expanded(child: …)])`.

| AST node | `InlineSpan` |
|---|---|
| `text` | `TextSpan(text: v)`: glossary text is data, never markup |
| `br` | `TextSpan(text: '\n')` |
| `b`, `i` | `TextSpan(style: TextStyle(fontWeight: FontWeight.bold) / TextStyle(fontStyle: FontStyle.italic), children: …)`, nested as in the AST |
| `code` | `TextSpan(text: v, style: TextStyle(fontFamily: 'monospace', fontSize: 0.92 * size))` |
| `var` | `TextSpan(text: value ?? '{$name}', style: valueStyle)` |
| link to the window's own key | bold `TextSpan` |
| link to a missing key | `TextSpan` with `decoration: TextDecoration.underline`, `decorationStyle: TextDecorationStyle.wavy`, `decorationColor: Color(0xFFDD3333)`; one warning per key |
| term | `WidgetSpan(alignment: PlaceholderAlignment.baseline, baseline: TextBaseline.alphabetic, child: TermButton(anchor, label, style))` |

`TermButton`:

```dart
FocusableActionDetector(
  focusNode: node,                                    // registered with its window: first term, F6, d-pad steps
  mouseCursor: SystemMouseCursors.click,
  onShowHoverHighlight: (_) {},                       // hover look only; the engine uses the MouseRegion below
  actions: {ActivateIntent: CallbackAction<ActivateIntent>(onInvoke: (_) => dt.followTerm(anchor, keyboard: true))},
  child: MouseRegion(
    onEnter: (_) => dt.hoverTerm(anchor),
    onExit: (_) => dt.unhoverTerm(anchor),
    child: GestureDetector(
      onTap: () => dt.followTerm(anchor, keyboard: false),
      child: Semantics(link: true, child: Text(label, style: termStyle, textScaler: TextScaler.noScaling)),
    ),
  ),
)
```

- **`textScaler: TextScaler.noScaling` is required**: `RichText` already scales every `WidgetSpan` child by the text scale factor (`_AutoScaleInlineWidget`) *(checked: source)*; a `Text` that also reads `MediaQuery.textScalerOf` would be scaled twice.
- Pass the paragraph's resolved style to the term; a `WidgetSpan`'s child does not inherit the style of the span around it.
- Enter, numpad Enter, Space and `gameButtonA` (Android, Fuchsia, Linux, Windows) are bound to `ActivateIntent` by `WidgetsApp.defaultShortcuts` *(checked: source)*, so the term's action runs on them; on iOS and macOS the defaults bind Enter, numpad Enter and Space only.
- Open term (a window for it is open): background in the term colour at 16 %, solid underline; focused term: 2 px outline in the term colour.
- Term box of a page term (a root window's anchor): the `OverlayPortal` around the `TermButton` provides it (section 4.1).

**Alternative: plain spans.** `TextSpan(recognizer: TapGestureRecognizer()..onTap = …, onEnter: …, onExit: …)` gives native wrapping inside a term, hover per span (`TextSpan` is a `MouseTrackerAnnotation`) and a link node for screen readers (`isLink` and the tap action) *(checked: source)*. `RenderParagraph` hit-tests spans by glyph bounds, so the area past the end of a line hits nothing *(checked: source)*. But a span takes no keyboard focus, so Tab, F1 on a term and gamepad steps need an own focus index per text (as the [Swing guide](../java-swing/README.md#42-terms-termview-on-jeditorpane) does), and the owner must dispose every recognizer *(checked: source)*. Fine for touch-only texts.

## 7. Events: exact order of operations

### 7.1 Pointer (mouse, stylus, trackpad)

**`DeepTipScope`'s `Listener`**, positions global:

| Event | Steps |
|---|---|
| `onPointerHover`, `onPointerMove` with `kind` mouse or stylus | add a sample with `clock.now()` and trim ([§5]) |
| `onPointerDown` | `lastInput = pointer`; "on pointer down" ([§9.2]) with `win` = the newest window whose `box` contains `event.position`, `touch = event.kind == PointerDeviceKind.touch` |
| `onPointerUp`, `onPointerCancel` | a title-bar swipe of that pointer (section 7.2) |

**Hover bookkeeping**, each followed by `resolve()`:

| Where | Handler |
|---|---|
| `DeepTip` | `MouseRegion(opaque: false, onEnter: hoverElement = this, onExit: if still this: null)` |
| `TipWindow` | `MouseRegion` (opaque, the default) `onEnter: hoverWindow = tip`, `onExit`: if still `tip`: `null`; being opaque it also sends exits to elements below the window |
| `TermButton` | `onEnter` / `onExit` as above |
| `DeepTipScope` | `MouseRegion(opaque: false, onExit: …)`: the pointer left the app ([§6] "on pointer leaving") |

`resolve()`: `win` = `hoverWindow` if still open; `link` = `hoverTerm`; `trig` = `hoverElement` only when both are `null`; when the triple differs from the previous one run "on pointer over" ([§6]). Moving between neighbours delivers the exit first *(checked: source)*; the empty triple in between only disarms, re-arms and starts close timers that the following enter cancels.

**Clicks inside a window** ([§9.1]): terms and buttons through their `onTap` / `ActivateIntent`; for `clickInsidePins` wrap the window content in `GestureDetector(behavior: HitTestBehavior.opaque, onTap: pinIfPreview)`. Both are tap recognizers in the same arena; the arena's sweep lets the first member win, and members join in hit-test order, innermost first *(checked: source)*, so a click on a term or button is not also a click on the window. **Hush** ([§6]): `Listener(onPointerDown)` inside `DeepTip`, for non-touch pointers.

### 7.2 Touch (SPEC §3.3, §3.5)

Touch never hovers: no previews, no tendency, no timer lock. In the order a finger produces them:

| Gesture | Steps |
|---|---|
| finger down outside every window | the scope's `Listener` runs "on pointer down": with windows open and `outsideClickCloses` `touch` (default) or `always`, close all. The app still gets its own tap (a `Listener` is no gesture recognizer). |
| finger down on a marked element | its `LongPressGestureRecognizer` starts: `onLongPressDown` → show the rest progress (`arming` = `longPress`); `onLongPressCancel` (lifted early, moved beyond the touch slop, or another recognizer won) → stop it |
| held for `longPress` (500 ms) | `onLongPressStart`: stop the progress, `HapticFeedback.mediumImpact()` (if `vibrate`), `openPinned(element, focus: false, via: Via.touch)` ([§9.2] `pressStart`). The recognizer has won the arena, so the element's tap is rejected and `onPressed` does not run (the swallow of [§9.2] comes for free). |
| tap on a term in a window | `followTerm`: the parent window is pinned, the term's window opens pinned beside it ([§9.1]) |
| tap on a page term | the same with no parent (a root window); outside every window, so the finger-down first closed all, as on the web |
| tap inside a window, not on a term or button | `clickInsidePins` (section 7.1) |
| swipe a title bar down | `Listener` on the header (not on its buttons): remember the touch down position; on up, `dy > 60 && dx.abs() < 60` → close all |
| X / pin button | 40 × 40 on touch devices: close (focus back) / toggle pin |

- The long-press tolerance is the platform's touch slop (`gestureSettings.touchSlop`, fallback 18 logical pixels), not the reference's 10 px; `LongPressGestureRecognizer` has no parameter for it *(checked: source)*.
- `supportedDevices: {PointerDeviceKind.touch}` keeps a long mouse press from opening windows; add `stylus` for pen-only tablets.
- `GestureDetector`'s own long-press has no duration parameter (it uses the default 500 ms, `kLongPressTimeout`) *(checked: source)*; use `RawGestureDetector` with `GestureRecognizerFactoryWithHandlers<LongPressGestureRecognizer>` so `longPress` applies.
- An element with its own `onLongPress` competes with DeepTip's: give it the explanation through its menu instead, or mark a label next to it.
- Text fields select text on long-press: mark their label, not the field.

### 7.3 Keyboard: the early key handler

Registered once by `DeepTipScope` with `FocusManager.instance.addEarlyKeyEventHandler`; return `KeyEventResult.handled` to consume, `ignored` to pass it on. Flutter has `KeyDownEvent`, `KeyRepeatEvent` and `KeyUpEvent`.

| Event | Steps |
|---|---|
| `KeyDownEvent` Escape | no windows → `ignored`. Shift (`HardwareKeyboard.instance.isShiftPressed`) → close all, focus the anchor of the root that held the focus; else `escAt = now`, `close(newest(focused window), focusBack: true)`. `handled`. |
| `KeyRepeatEvent` Escape | windows open and `now - escAt >= 600` → close all with focus back; `handled` |
| `KeyUpEvent` Escape | `handled` if the down was handled |
| `KeyDownEvent` F6 with windows open | `cycle(shift ? -1 : 1)`; `handled` |
| `KeyDownEvent` F1, or `event.character == '?'` | the focused term → `followTerm(focus: true)`; else the nearest `DeepTip` above the focused node (`primaryFocus.context.findAncestorStateOfType<DeepTipState>()`) outside every window → `openPinned(focus: true, via: Via.key)`; `handled` only then. `?` does nothing while a text field has focus (an `EditableTextState` above the focused node). |
| `KeyDownEvent` with a printable `character`, no Ctrl, Alt or Meta | `hush(nearest DeepTip above the focused node)`; `ignored` |
| Enter, Space | `lastInput = keyboard`; `ignored` (the term's `ActivateIntent` follows it with focus) |

Without the early handler, Esc pressed in the app would bubble to `WidgetsApp`'s `DismissIntent` shortcut and close a dialog instead of the newest window. Flutter dispatches key events only while some node has primary focus *(checked: source)*.

### 7.4 Back gesture and back button (Android)

```dart
class DeepTipBackScope extends StatelessWidget {
  const DeepTipBackScope({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final dt = DeepTipScope.of(context);                       // rebuilds when windows open or close
    return PopScope(
      canPop: !dt.hasWindows,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) dt.closeNewestFocusBack(); },
      child: child,
    );
  }
}
```

- With `canPop` false a system back calls `onPopInvokedWithResult` with `didPop == false` *(checked: source)*; the route stays. When no window is open the route pops as usual.
- Android's predictive back is decided ahead of time from the navigator and every `PopScope` (`SystemNavigator.setFrameworkHandlesBack`); a back the framework did not claim never reaches Flutter *(checked: source)*. So do not rely on `WidgetsBindingObserver.didPopRoute`: observers run in registration order and `WidgetsApp`'s own observer pops the route first *(checked: source)*.
- iOS has no system back; with `canPop` false the Cupertino swipe-back of that page is off while windows are open *(checked: source)*.
- Put a `DeepTipBackScope` into every route with marked elements, also into dialogs.

### 7.5 Gamepad

On Android the early handler sees controller buttons as keys *(checked: source for the key constants)*:

| Button | Steps |
|---|---|
| `gameButtonY` down | as F1 (focused term or element) ([§9.4]); `handled` only then |
| `gameButtonB` down | remember the time and start a 600 ms timer that closes all (focus back to the root's anchor) |
| `gameButtonB` up | timer still pending → cancel it, `close(newest(focused), focusBack: true)` |
| `gameButtonA` | `ActivateIntent` of the focused term or button (default shortcut, see section 6) |
| `gameButtonLeft1` / `gameButtonRight1` | `cycle(-1)` / `cycle(1)` |
| arrow keys (d-pad) with the focus in a window | step through the window's terms, then its buttons, wrapping ([§9.4]); outside windows `ignored` (the default directional focus moves) |

Android falls back to BACK for an unhandled B and to SPACE for an unhandled Y on the system level (`Generic.kcm`) *(checked: AOSP source)*; whether a key that Flutter reported as unhandled still produces that fallback is **verify**, so handle B and Y yourself. Analog sticks, iOS controllers (GameController framework) and desktop controllers need a plugin that reads them; call the controller's methods `openFocused`, `activate`, `closeNewest`, `closeAll`, `cycle`, `step` from it.

### 7.6 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6] (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5] (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7]); the window's `AnimationController` only draws the bar |
| flash | `flash(w)` | the window animates for 600 ms ([§4.4]) |
| long-press | the recognizer's `duration` | section 7.2 |

After every engine call that changed windows, `notifyListeners()` once (never from build, layout or paint).

### 7.7 Focus ([§9.5])

- Opening with focus: after the frame (`WidgetsBinding.instance.addPostFrameCallback`), `requestFocus()` on the window's first term, else on the window's `FocusScopeNode`.
- Closing returns the focus to the anchor if it was inside the closed subtree (`hasFocus` of the window's `FocusScopeNode`, or of a descendant window's): `DeepTipState.focusNode` of the element, the parent window's scope for a term.
- Reading order inside a window is header (pin, close), then terms, as on the web; wrap each window in `FocusTraversalGroup` so Tab stays inside it until it reaches the end.

## 8. Accessibility (SPEC §6)

| Part | Semantics |
|---|---|
| marked element | `Semantics(hint: entry.short, onLongPressHint: label('explain'), customSemanticsActions: {CustomSemanticsAction(label: label('explain')): () => dt.openPinned(this, focus: true, via: Via.key)})` around the element. The `RawGestureDetector` already exposes the long-press as a semantics action, so TalkBack's double-tap-and-hold opens the window. |
| term | `Semantics(link: true)` with the label; its tap action comes from the gesture detector |
| window | `Semantics(container: true, explicitChildNodes: true, label: title, role: tip.pinned ? SemanticsRole.dialog : null)` |
| preview | no role: `SemanticsRole.tooltip` exists, but in Flutter 3.47.8 the debug role check reports "Missing checks for role" for it *(checked: source)* |
| opening by keyboard, gamepad or a screen reader action | move the focus into the window (section 7.7) |
| announcements | `SemanticsService.sendAnnouncement(View.of(context), text, Directionality.of(context))`; `announce` is deprecated *(checked: source)*, and Android deprecated announcement events, so prefer moving the focus |

`explain` is an own label next to the `$ui` labels of [§1.2] (put it into the project glossary's `$ui`). Reduced motion: `MediaQuery.disableAnimationsOf(context)`; bold text: `MediaQuery.boldTextOf(context)`; touch targets 40 × 40 on touch devices (section 5).

## 9. Live values, locales, refresh

- `vars`: `Map<String, Object?>` with plain values, `Object? Function()` or `Object? Function(String key)` (called with the window's key), or one `Object? Function(String name, String key)`; `null` keeps `{name}` visible ([§1.2]).
- Window content is built from `controller.entry(key)` during `build`, so `refresh()` (= `notifyListeners()`) re-renders every window, `DeepTipText` and `DeepTipIndex`; anchors stay equal (section 3), children stay attached.
- `setLocale(locale)` loads the missing files of the new chain, then refreshes.

## 10. Loading the glossary (JSON)

```dart
Future<Map<String, dynamic>?> loadGlossary(String path) async {
  try {
    var text = await rootBundle.loadString(path);
    if (text.startsWith('\uFEFF')) text = text.substring(1);      // jsonDecode throws on a byte order mark (checked)
    return jsonDecode(text) as Map<String, dynamic>;
  } catch (e) {
    debugPrint('DeepTip: cannot load $path: $e');                // a missing file is a warning (§1.2)
    return null;
  }
}
```

- `jsonDecode` returns a `LinkedHashMap`: keys in file order, a duplicate key keeps its first position and its last value, like JavaScript *(checked)*. Digit-only keys stay in file order, while JavaScript lists them first ([§1.1]) *(checked)*.
- `sources` are asset paths with `{locale}`: for each locale of the chain, each template in order (layer order: core first, project after). Assets must be declared in `pubspec.yaml`; the example copies `glossary/core` and `glossary/example` into `assets/deeptip/` with a small script.
- Desktop apps may read files with `File(path).readAsString()` instead.

## 11. Porting the pure functions: Dart pitfalls *(checked)*

A straight port of `flatten`, `parseText` and `computePlacement` passes all 24 parity cases when these differences are handled:

1. `String.trim()` also removes U+0085, JavaScript's `trim` does not. Trim with one predicate (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF).
2. `RegExp` has JavaScript's syntax and semantics: `\s` matches the same set (U+FEFF yes, U+0085 no) and `.` stops at U+2028 and U+2029, so `^\s*[-•]\s+(.*)$`, `\n[ \t]*\n` and `KEY_RE` port unchanged.
3. `split` keeps trailing empty strings, like JavaScript.
4. `s[i]`, `substring`, `indexOf(pattern, start)` and `startsWith(pattern, index)` throw a `RangeError` past the end, where JavaScript returns `undefined`, `-1` or clamps: guard `s[i + 1]`, and cut the `{name}` window as `s.substring(i, math.min(i + 64, s.length))`.
5. Strings are UTF-16 code units, as in JavaScript: positions match without conversion.
6. `jsonDecode` yields `int` or `double`; convert placement input with `(v as num).toDouble()`. `192 == 192.0` is true.
7. `math.min` and `math.max` propagate NaN like `Math.min` and `Math.max`; `List.reduce` keeps the first element on ties.
8. Port the reference's `findClose` loop literally (each skip ends with the loop's `j++`).

## 12. Testing

### 12.1 Parity cases ([§11])

```dart
// test/deeptip_cases_test.dart — DEEPTIP_CASES=<DeepTip>/test/cases flutter test test/deeptip_cases_test.dart
import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:myapp/deeptip/core.dart';

void main() {
  final dir = Platform.environment['DEEPTIP_CASES'] ?? '../DeepTip/test/cases';
  List<Map<String, dynamic>> cases(String name) =>
      (jsonDecode(File('$dir/$name').readAsStringSync())['cases'] as List).cast<Map<String, dynamic>>();
  double d(Object? v) => (v as num).toDouble();

  for (final c in cases('markup.json')) {
    test('markup: ${c['name']}', () => expect(parseText(c['src'] as String), c['blocks']));
  }
  for (final c in cases('placement.json')) {
    test('placement: ${c['name']}', () {
      final s = c['size'], a = c['anchor'], v = c['viewport'];
      final p = computePlacement((w: d(s['w']), h: d(s['h'])),
          (left: d(a['left']), top: d(a['top']), right: d(a['right']), bottom: d(a['bottom'])),
          (c['sides'] as List).cast<String>(), (w: d(v['w']), h: d(v['h'])));
      expect({'side': p.side, 'x': p.x, 'y': p.y, 'fits': p.fits, 'maxW': p.maxW, 'maxH': p.maxH}, c['expect']);
    });
  }
  for (final c in cases('glossary.json')) {
    test('glossary: ${c['name']}', () {
      final f = flatten(c['input']);
      expect({'keys': f.entries.keys.toList(), 'meta': f.meta.keys.toList(), 'problems': f.problems.length}, c['expect']);
    });
  }
}
```

`expect` compares maps and lists deeply, and `192 == 192.0` holds; `parseText` must produce the case's JSON shapes (`{'t': 'link', 'key': …, 'text': null}` with the `text` key present). This test, with `package:test` in place of `flutter_test` (which re-exports the same `test` and `expect`), ran against the throwaway port with `dart test`: 24 passed *(checked)*.

### 12.2 Engine

Plain `test()`s with a fake `Clock` (tasks ordered by time, `advance(ms)`) and a fake `TipHost`: the behaviours listed in the [Swing guide](../java-swing/README.md#112-behaviour) (one preview per parent, pin chain, subtree close, flash, grace, tendency, suppression, hush, Esc, Shift+Esc, Esc hold, lock). `frameworks/rust-egui/tests/engine.rs` has them all with exact times.

### 12.3 Widgets (**verify**: the Flutter SDK was not available)

- Time: `await tester.pump(const Duration(milliseconds: 800))` runs due timers; `TimerClock` follows because `clock.stopwatch()` is faked *(checked)*. Create the controller inside the test: a stopwatch made outside the fake zone measures real time.
- Mouse hover: `final g = await tester.createGesture(kind: PointerDeviceKind.mouse); await g.addPointer(location: Offset.zero); await g.moveTo(tester.getCenter(find.text('Cart'))); await tester.pump(const Duration(milliseconds: 800));` → the window is there.
- Long-press: `await tester.longPress(find.text('Cart'));` → window pinned, `onPressed` not called.
- Keys: `await tester.sendKeyEvent(LogicalKeyboardKey.escape);`; back: `await tester.binding.handlePopRoute();` (a test hook of `WidgetsBinding`) *(checked: source)*.
- Timing feel and real devices are compared by hand with the web example (`npm run demo`), as [§11] describes.

## 13. API to offer

| Call | Does |
|---|---|
| `DeepTipController(locale:, fallback:, sources:, vars:, options:)` | the controller (SPEC §7 options) |
| `add(locale, json)`, `setLocale(locale)`, `ready` (a `Future`) | glossary layers [§1] |
| `values['gold'] = …`, `refresh()` | live values |
| `DeepTipScope(controller:, child:)` | root: pointer observer, keys, provides the controller |
| `DeepTip('key', delay:, place:, editable:, builder:, child:)` | an element with an explanation |
| `DeepTipBackScope(child:)` | back closes the newest window |
| `DeepTipText(markup)`, `DeepTipIndex()` | terms on pages, the encyclopedia |
| `open(key, anchor:, pinned:)`, `close(tip)`, `closeAll()`, `pin(tip)`, `unpin(tip)` | windows from code |
| `isOpen(element)`, `arming(element)` | hooks for the host's own look |
| `onOpen`, `onClose`, `onPin` | callbacks |
| `openFocused()`, `activate()`, `closeNewest()`, `cycle(step)`, `step(step)` | gamepad and other devices |

## 14. The example to build

`example/` (`flutter run -d windows`, `-d chrome` or a phone): the screen of `frameworks/web/example`. A HUD row with `DeepTip`s on `demo.realm`, `demo.stability` (tap: −3 … +3, live value `{stability}`), `demo.taxes` (tap: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), and a help button `deeptip.about` with `delay: 0`; a language switch (`de`, `en`; fallback chain `['de', 'en']`, so `demo.prestige` and `demo.gold` show the `DE` badge in English); four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the screen edges, inside the safe area; a page text with terms (`DeepTipText`); settings (delay, lock, outside click, close and pin buttons, hints); the encyclopedia; an event log. Glossaries: `glossary/core` and `glossary/example` copied to `assets/deeptip/`. Screen texts: those of `frameworks/web/example/index.html`. Try it with touch, mouse, keyboard and TalkBack or VoiceOver.

## 15. Pitfalls

- Text inside a `WidgetSpan` scaled twice (section 6).
- Reading another render object's size during layout asserts; a `MultiChildLayoutDelegate` lays out each child once; `LayoutBuilder` has no dry layout (section 4).
- `WidgetsBindingObserver.didPopRoute` loses against the navigator and predictive back (section 7.4).
- `jsonDecode` throws on a byte order mark (section 10).
- `Stopwatch` ignores the fake time of `flutter test` (section 3).
- `SemanticsRole.tooltip` and the deprecated `SemanticsService.announce` (section 8).
- Notifying listeners from `build`, layout or paint loops forever; `tip.box` is a plain field.
- A `RenderParagraph` built from `TextSpan` recognizers does not dispose them.

## 16. Limitations compared with the web reference

- Pinned roots close with their element instead of freezing ([§4.5]); use the single layer of section 4.4 if needed.
- Windows live inside the app's view (the view is the viewport).
- Hover, tendency, suppression and the timer lock need a mouse, trackpad or hovering stylus.
- Gamepad: Android button events only; sticks, iOS and desktop controllers need a plugin.
- The long-press tolerance is the platform's touch slop.
- Dart has no locale collation: sort the encyclopedia with a lower-case, accent-folded key.

## 17. Checklist

1. Port and test `flatten`, `parseText`, `computePlacement` against `test/cases` (sections 11, 12.1).
2. Glossary with layers, chain, `$ui` labels and live values; validate the JSON files with `tools/deeptip-check.mjs`.
3. Engine with `Clock` and `TipHost` (12.2), then `DeepTipScope`, `DeepTip`, `TipPlacer`, `TipWindow`, `TermText`, `DeepTipBackScope` (sections 4–8) with widget tests (12.3).
4. The example on a touch device, with a mouse and with a screen reader; compare with the web example; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.1]: ../../docs/algorithms.md#11-flattening-one-glossary-file
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
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
