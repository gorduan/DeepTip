# DeepTip in React Native: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth) in a React Native app for iOS and Android, touch first.

React Native has no DOM, so the web runtime [`frameworks/web/deeptip.js`](../web/README.md) cannot run as a whole; this guide is the exact recipe for a native build in JavaScript or TypeScript. Its **pure functions are reused unchanged**: `parseText`, `flattenGlossary`, `computePlacement`, `collectRefs` and `KEY_RE` touch no DOM, and the module touches none at import. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; [SPEC.md](../../SPEC.md) is the contract. Marks: *(checked)* = ran on 2026-10-29 with React Native 0.88.1: `deeptip.js` went through Metro's Babel preset (`@react-native/babel-preset` 0.88.1), the result passed all 24 parity cases in Node and compiled with the Hermes compiler that React Native 0.88.1 ships, and the code blocks that start with a file path type-checked against React Native 0.88.1's own types (TypeScript 7.0, `tsc --noEmit`, strict); *(checked: source)* = read in the React Native 0.88.1 sources; **verify** = needs a device or simulator, which were not available. The engine is not shipped as code because it could not be run on a device here.

## Quick start

**Recognise the project:** `react-native` (often with `expo`) in the `dependencies` of `package.json`, `index.js` calling `AppRegistry.registerComponent` (Expo: `registerRootComponent` or `expo-router`), `app.json`, `metro.config.js`, `babel.config.js`, and the native folders `android/` and `ios/` (absent in Expo's managed workflow).

1. Copy `frameworks/web/deeptip.js` to `src/deeptip/deeptip.js` and save the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) as `src/deeptip/deeptip.d.ts`.
2. Copy `glossary/core/<locale>.json` to `src/deeptip/glossary/core.<locale>.json` and write `src/deeptip/glossary/<locale>.json`.
3. Build the controller and the components of sections 3 to 8 in `src/deeptip/`.
4. Wrap the app in `DeepTipProvider` and spread `useDeepTip("key").props` onto a `Pressable`.
5. Run the parity cases with Jest (section 11).

```tsx
// App.tsx
import { Pressable, Text } from "react-native";
import { DeepTipProvider, useDeepTip } from "./src/deeptip";
import coreEn from "./src/deeptip/glossary/core.en.json";
import en from "./src/deeptip/glossary/en.json";

function Cart() {
  const tip = useDeepTip("shop.cart");
  return (
    <Pressable {...tip.props} onPress={() => console.log("open the cart")}>
      <Text>Cart</Text>
    </Pressable>
  );
}

export default function App() {
  return (
    <DeepTipProvider locale="en" fallback={["en"]} glossaries={{ en: [coreEn, en] }}>
      <Cart />
    </DeepTipProvider>
  );
}
```

**Done when:** a 500 ms long-press on *Cart* opens its window pinned and does not log "open the cart", a tap on *check out* in it opens a second window beside the first, a tap outside every window closes them all, Android's back closes the newest window and with none open navigates as usual, Jest passes the 24 parity cases.

## 1. Parts to build

| Part | Does | React Native |
|---|---|---|
| `deeptip.js` (copied, unchanged) | the pure functions of [§1] (`flattenGlossary`), [§2] (`parseText`, `collectRefs`) and [§8] (`computePlacement`) | none |
| `glossary.ts` | layers per locale, chain, `entry(key)`, `label(name)`, live values ([§1.2]) on top of `flattenGlossary` | none |
| `engine.ts` | [§4]–[§7] and the decisions of [§9]: window tree, hot set, grace, tendency, suppression, arming, lock | none: plain TypeScript with a clock and a host interface, testable in Jest |
| `DeepTipProvider` | context, the window layer above the app, the touch observer, the back handler | `View`, `BackHandler` |
| `useDeepTip(key, opts)` | the props that mark a pressable element | `Pressable` props, accessibility actions |
| `TipWindow` | measures, places and draws one window | `View`, `ScrollView`, `onLayout` |
| `TermText` | renders the AST; terms are nested `Text` with `onPress` | `Text` |
| `DeepTipText`, `DeepTipIndex` | terms on normal screens, the encyclopedia ([§12]) | `Text`, `TextInput`, `FlatList` |

## 2. SPEC concept → React Native primitive

| SPEC | React Native |
|---|---|
| Glossary files (§2.1) | `import en from "./glossary/en.json"`: Metro bundles JSON as a module, so keys keep JavaScript's order, the reference's order ([§1.1]). Remote files: `fetch(url).then((r) => r.json())`. Section 10. |
| Window layer (top layer) | One absolutely filled `View` rendered **after** the app inside `DeepTipProvider`, `pointerEvents="box-none"`: windows are its children in open order, touches outside them reach the app. Section 4. |
| Why not `Modal` | A `Modal` is a native modal (a presented view controller on iOS, a dialog window on Android) that covers the app and takes its touches: no previews, no windows side by side, the app unusable while one is open. A `Modal` of the app is itself above DeepTip's layer: give it its own `DeepTipProvider` inside (pitfall, section 13). |
| Stacking order | Later siblings draw on top. On Android `elevation` also orders views; give the layer a higher `zIndex` and `elevation` than any app view (**verify** with your app's elevated views). |
| Marked UI element (`data-deeptip`) | `useDeepTip("key", { delay, place })` returns `props` for `Pressable`, `TouchableOpacity` and the like, plus `open` and `arming` for the element's own look. Section 5. |
| Term (a real button) | Nested `<Text onPress role="link">` inside the paragraph's `Text`: native wrapping inside the term, tap handling per span. On iOS each link span becomes an accessibility element with the link trait ("Link 1 of 3"); on Android it becomes a clickable span, TalkBack announces that the text has links and lists them in its context menu *(checked: source)*. Section 6. |
| Hover (mouse, trackpad, pencil) | `Pressable`'s `onHoverIn` / `onHoverOut` fire on iOS and Android only when the native feature flag `shouldPressibilityUseW3CPointerEventsForHover` is on; it is off by default in 0.88.1 *(checked: source)*. `View` has `onPointerEnter`, `onPointerMove`, `onPointerLeave` *(checked: types)*; whether a platform dispatches them is **verify**. Treat hover as optional: touch behaviour must stand alone. |
| Long-press | `onLongPress` with `delayLongPress={longPress}`: fires after 500 ms by default, is cancelled when the finger moves more than 10 px, and the release after it does **not** call `onPress` *(checked: source, `Pressability.js`)*: exactly SPEC §3.3 and the reference's `MOVE_TOL`. |
| Tap outside closes all | `onTouchStart` on the provider's root `View`: touch events bubble, so it sees every touch that starts inside the app without becoming the responder. |
| Placement coordinates | Density-independent pixels, y down. Boxes from `ref.current.getBoundingClientRect()`, available on host elements in 0.88.1 *(checked: types and source)*, or `measureInWindow`; always relative to the layer's own box (section 4.2). |
| Viewport, safe areas | The layer's size minus the insets of `react-native-safe-area-context` (`useSafeAreaInsets()`); core's `SafeAreaView` is deprecated in its favour *(checked: source)*. The on-screen keyboard: `Keyboard.addListener("keyboardDidShow", …)`. |
| `delay`, `linkDelay`, `closeDelay`, `lockAfter` | `setTimeout` / `clearTimeout` through the engine's clock; `performance.now()`. |
| Flash, lock bar, rest progress | `Animated.timing(…, { useNativeDriver: true })` on `opacity` and `transform: [{ scaleX }]` with `transformOrigin: "left"`; `AccessibilityInfo.isReduceMotionEnabled()`. |
| Keyboard (Esc, F1, F6, `?`) | No global key events in React Native's core on iOS and Android (only `TextInput.onKeyPress`); see section 7.4. |
| Back (Android) | `BackHandler.addEventListener("hardwareBackPress", …)`; handlers run last registered first, `true` consumes *(checked: source)*. |
| Gamepad | No API in the core; section 7.5. |
| Accessibility (§6) | `accessibilityActions` + `onAccessibilityAction`, `accessibilityHint`, `role`, `onAccessibilityEscape`, `AccessibilityInfo.sendAccessibilityEvent(ref, "focus")` (`setAccessibilityFocus` is deprecated) *(checked: source)*. Section 8. |
| Theme (`--dt-*`) | A theme object with the values of section 9; `useColorScheme()` for light and dark. |

## 3. Data structures

```ts
// src/deeptip/types.ts
import type { DeepTipSide } from "./deeptip.js";

export type Via = "hover" | "click" | "key" | "touch" | "pad" | "api";
export type Box = { left: number; top: number; right: number; bottom: number }; // layer coordinates, y down
export type Anchor =
  | { kind: "element"; id: string } //                     the id useDeepTip registered
  | { kind: "term"; win: number; key: string; n: number } // n = occurrence of key in that window's text
  | { kind: "page"; text: string; n: number }; //          a term of a DeepTipText

export interface Tip {
  id: number;
  key: string;
  parent: Tip | null;
  anchor: Anchor;
  via: Via;
  children: Set<Tip>; //                                   insertion order
  pinned: boolean;
  frozen: boolean;
  closeTimer: ReturnType<typeof setTimeout> | null;
  size: { w: number; h: number } | null; //                from onLayout; null while unmeasured
  limit: { maxW: number; maxH: number }; //                shrink from computePlacement, 0 = none
  box: Box | null; //                                      placed box; null = not placed yet (invisible)
}

export interface ElementRecord {
  id: string;
  key: string;
  delay?: number;
  place?: DeepTipSide[];
  box: () => Box | null; //                                measures the element now (section 4.2)
}
```

Anchors are compared by value (`kind` and fields): a re-rendered window (language switch, live value) produces equal term anchors, so [§4.6] needs no re-attachment. Engine state as in the [Swing guide](../java-swing/README.md#3-data-structures): `wins` (oldest first = drawing order), hover triple `(win, link, trig)`, `hot`, `pending`, `samples`, `quiet`, `lockWin`, `seq`. The controller keeps them in a plain object and lets React re-render through `useSyncExternalStore(subscribe, getVersion)`: every engine call that changes windows increments a version and notifies once.

## 4. The window layer and placement

### 4.1 The provider

```tsx
// src/deeptip/DeepTipProvider.tsx
import { createContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import { DeepTipController, type ControllerOptions } from "./controller";
import { TipWindow } from "./TipWindow";

export const DeepTipContext = createContext<DeepTipController | null>(null);

export function DeepTipProvider({ children, ...options }: ControllerOptions & { children: ReactNode }) {
  const dt = useMemo(() => new DeepTipController(options), []); // options are read once; change them with dt.configure()
  useSyncExternalStore(dt.subscribe, dt.getVersion); //             re-render on every window change
  const open = dt.windows.length > 0;
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (dt.closeNewest({ focusBack: true }), true));
    return () => sub.remove(); //                                   registered while windows are open: it runs first
  }, [dt, open]);
  return (
    <DeepTipContext.Provider value={dt}>
      <View style={styles.root} onTouchStart={(e) => dt.touchStart(e.nativeEvent.pageX, e.nativeEvent.pageY)}>
        {children}
        <View ref={dt.layerRef} pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
          {dt.windows.map((tip) => (
            <TipWindow key={tip.id} tip={tip} />
          ))}
        </View>
      </View>
    </DeepTipContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  layer: { zIndex: 1000, elevation: 1000 },
});
```

Put the provider at the root of the app, inside `SafeAreaProvider` and outside the navigator, so windows float above every screen of a stack.

### 4.2 Boxes

```ts
// src/deeptip/geometry.ts
import type { View } from "react-native";
import type { Box } from "./types";

type Host = React.ComponentRef<typeof View>;

/** The element's box in the layer's coordinates (both read now, so status bar and edge-to-edge offsets cancel out). */
export function boxIn(layer: Host | null, el: Host | null): Box | null {
  if (!layer || !el) return null;
  const l = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { left: r.left - l.left, top: r.top - l.top, right: r.right - l.left, bottom: r.bottom - l.top };
}
```

`getBoundingClientRect()` reads the committed layout synchronously; `measureInWindow((x, y, width, height) => …)` is the callback alternative. Children are placed beside their parent window's `box`, which the engine already knows, so terms inside windows never need measuring.

### 4.3 Measure, place, shrink ([§8])

A window renders twice before it is visible:

1. **Measure**: `position: "absolute"`, `left: 0`, `top: 0`, `opacity: 0`, `pointerEvents: "none"`, width between `min(240, vp.w − 16)` and `min(384, vp.w − 16)` (`minWidth`, `maxWidth`), `maxHeight: min(480, vp.h − 16)`. An absolutely positioned view without a width takes the width of its content up to `maxWidth`, as in CSS (**verify** on both platforms).
2. `onLayout` → `size` → `p = computePlacement(size, target, sides, vp, 8)` with target = the parent's `box` for children, the anchor's box (section 4.2) for roots, both moved by the safe-area insets into viewport coordinates; sides = the element's `place`, else `root` or `child`.
3. If `p.maxW` or `p.maxH` is set: store them in `tip.limit` (`maxWidth: max(minWidth, p.maxW)`, `maxHeight: p.maxH`; `minWidth` wins as in the reference's CSS), render again, and on the next `onLayout` compute once more with `[p.side]`.
4. **Show**: `left: p.x + inset.left`, `top: p.y + inset.top`, `opacity: 1`, `pointerEvents: "auto"`; store `tip.box`.
5. Re-place when the size changes (`onLayout` again: pinning hides the hint line, live values change), on rotation (`useWindowDimensions()` changed) and when the keyboard opens.

React Native has no global scroll event: windows do not follow a scrolling anchor. Close previews and re-measure pinned roots from the app's `ScrollView`s (`onScrollBeginDrag={dt.anchorsMoved}`, `onMomentumScrollEnd={dt.anchorsMoved}`), or accept that pinned roots stay where they were opened, as frozen windows do.

### 4.4 Anchors that disappear ([§4.5])

`useDeepTip` registers its element in an effect and unregisters it in the cleanup: previews on it close, a pinned root freezes at its `box` (the window lives in the layer, not in the element). Terms of a re-rendered window keep their anchor (section 3).

## 5. Marked elements: `useDeepTip`

```ts
// src/deeptip/useDeepTip.ts
import { useContext, useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { AccessibilityActionEvent, PressableProps, View } from "react-native";
import type { DeepTipSide } from "./deeptip.js";
import { DeepTipContext } from "./DeepTipProvider";
import { boxIn } from "./geometry";

export function useDeepTip(key: string, opts: { delay?: number; place?: DeepTipSide[] } = {}) {
  const dt = useContext(DeepTipContext);
  if (!dt) throw new Error("useDeepTip needs a DeepTipProvider");
  useSyncExternalStore(dt.subscribe, dt.getVersion); //  re-render when `open` or `arming` change
  const id = useId();
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  useEffect(
    () => dt.registerElement({ id, key, ...opts, box: () => boxIn(dt.layerRef.current, ref.current) }),
    [dt, id, key, opts.delay, opts.place?.join()],
  ); //                                                    the cleanup unregisters (section 4.4)
  const handlers = {
    delayLongPress: dt.options.longPress,
    onPressIn: () => dt.pressStart(id), //                  rest progress for the long-press; hush for mouse users
    onPressOut: () => dt.pressEnd(id),
    onLongPress: () => dt.longPress(id), //                 open pinned, vibrate; onPress will not follow
    onHoverIn: () => dt.hoverElement(id),
    onHoverOut: () => dt.hoverElement(null, id),
    accessibilityHint: dt.short(key),
    accessibilityActions: [{ name: "explain", label: dt.label("explain") }],
    onAccessibilityAction: (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === "explain") dt.openPinned(id, { focus: true, via: "key" });
    },
  } satisfies PressableProps;
  return { props: { ref, ...handlers }, open: dt.isOpen(id), arming: dt.arming(id) };
}
```

- Spread `props` first and the element's own props after them: `onPress` stays the app's. An element with its own `onLongPress` must call `tip.props.onLongPress()` from it, or the explanation moves into its menu.
- `explain` is an own label next to the `$ui` labels of [§1.2]; put it into the project glossary's `$ui` (the schema allows extra labels).
- `open` (a window for this element is open) and `arming` (the long-press runs, the value is `longPress`) are the hooks `data-dt-open` and `data-dt-arming` of the web: hide an own tooltip, draw a progress bar under the button.

## 6. Text and terms

```tsx
// src/deeptip/TermText.tsx
import { Fragment, type ReactNode } from "react";
import { Text, type TextStyle } from "react-native";
import type { DeepTipInline } from "./deeptip.js";
import type { DeepTipController } from "./controller";
import type { Anchor } from "./types";

/** Renders inline nodes (§3); `term(key, n)` makes the anchor of the n-th term with that key. */
export function renderInline(dt: DeepTipController, nodes: DeepTipInline[], self: string | null, term: (key: string) => Anchor, s: Record<string, TextStyle>): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text": return <Fragment key={i}>{n.v}</Fragment>;
      case "br": return <Fragment key={i}>{"\n"}</Fragment>;
      case "b": return <Text key={i} style={s.b}>{renderInline(dt, n.c, self, term, s)}</Text>;
      case "i": return <Text key={i} style={s.i}>{renderInline(dt, n.c, self, term, s)}</Text>;
      case "code": return <Text key={i} style={s.code}>{n.v}</Text>;
      case "var": return <Text key={i} style={s.value}>{dt.value(n.name, self)}</Text>;
      case "link": {
        const label = n.text ?? dt.entry(n.key)?.e.title ?? n.key;
        if (n.key === self) return <Text key={i} style={s.b}>{label}</Text>;
        if (!dt.entry(n.key)) return <Text key={i} style={s.missing}>{dt.warnMissing(n.key) ?? label}</Text>;
        const anchor = term(n.key);
        return (
          <Text key={i} role="link" accessibilityRole="link" suppressHighlighting style={[s.term, dt.isOpenAt(anchor) && s.termOpen]}
            onPress={() => dt.followTerm(anchor)}>
            {label}
          </Text>
        );
      }
    }
  });
}
```

- A paragraph is one `<Text style={s.p}>` with these children; a list item is a row: `<View style={{ flexDirection: "row" }}><Text>•  </Text><Text style={{ flex: 1 }}>…</Text></View>`; blocks are 0.5 em apart.
- Glossary text is data: plain strings in `Text` are never interpreted.
- Nested texts have no native view: they cannot be measured, focused with a keyboard or hovered. Children need no term box (they sit beside the parent window). A **page term** (a root window from `DeepTipText`) is anchored to the line it was tapped in: keep the lines from the paragraph's `onTextLayout` (`e.nativeEvent.lines`, each with `x`, `y`, `width`, `height` *(checked: types)*), take the line that contains the press (`onPress` gives `e.nativeEvent.locationY`), and add the paragraph's box.
- Alternative for keyboard and hover: an inline `Pressable` inside the paragraph `Text` (React Native lays out views inside text) is focusable and hoverable where hover works, but it moves to the next line as a whole and its baseline alignment differs per platform (**verify**).

## 7. Events: exact order of operations

### 7.1 Touch (SPEC §3.3, §3.5)

Touch never hovers: no previews, no tendency, no timer lock.

| Gesture | Steps |
|---|---|
| finger down anywhere in the app | the provider root's `onTouchStart`: with windows open, no window `box` containing `(pageX, pageY)` (converted to layer coordinates), and `outsideClickCloses` `touch` (default) or `always` → close all. The touch continues to the app. |
| finger down on a marked element | `onPressIn` → `pressStart`: rest progress for `longPress` ms (`arming`) |
| moved more than 10 px or lifted early | `onPressOut` → `pressEnd`: progress gone; a short tap runs the element's `onPress` as usual |
| held for `longPress` | `onLongPress` → `longPress(id)`: progress gone, vibrate (if `vibrate`), `openPinned(element, focus: false, via: "touch")`; Pressability does not call `onPress` on the release *(checked: source)* |
| tap on a term in a window | `followTerm(anchor)`: the parent window is pinned, the term's window opens pinned beside it ([§9.1]) |
| tap on a page term | the same without parent; it started outside every window, so the finger-down first closed all, as on the web |
| tap inside a window, not on a term or button | the window's container is a `Pressable` with `onPress={() => dt.clickInside(tip)}`; a term or button inside wins the touch as the deepest responder, so a tap is never handled twice |
| swipe a title bar down | `onTouchStart` / `onTouchEnd` on the title row (not on its buttons): `dy > 60 && Math.abs(dx) < 60` → close all |
| X / pin | `Pressable`s of 40 × 40 with `hitSlop` |

Vibration: `Vibration.vibrate(15)` needs `<uses-permission android:name="android.permission.VIBRATE" />` on Android, and iOS ignores the duration (**verify**); a haptics module (`expo-haptics`: `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)`) gives the short tick the SPEC means.

### 7.2 Hover, where the platform reports it

With hover events (react-native-web, macOS, Windows, or iOS and Android with the pointer-events flag), wire `onHoverIn` / `onHoverOut` of elements (from `useDeepTip`), of the window container and of inline term views into the hover triple, then run "on pointer over" ([§6]) when the triple changed; samples for the tendency ([§5]) come from `onPointerMove` on the provider root. Without hover events none of [§5]–[§7] runs, and DeepTip behaves like the SPEC's touch column on every device.

### 7.3 Back (Android) and the VoiceOver escape gesture

- `hardwareBackPress` (section 4.1): close `newest(focused window)` with focus back, return `true`. The listener is added when the first window opens, so it runs before the navigator's (last registered first); with no window it is removed and back navigates as usual.
- iOS VoiceOver's escape gesture (two-finger Z): `onAccessibilityEscape` on each window `View` → close that window with focus back.

### 7.4 Hardware keyboards

React Native's core delivers no key events outside a focused `TextInput` on iOS and Android. Esc, `Shift+Esc`, Esc held, F1, `?` and F6 of [§9.3] therefore need a native module that forwards key presses (iOS: `pressesBegan` / `UIKeyCommand`, see the [UIKit guide](../ios-uikit/README.md#73-hardware-keyboard); Android: `dispatchKeyEvent` in the activity, see the [Android guide](../android-compose/README.md#6-hardware-keyboard)) to the controller's `escape(shift, repeat)`, `openFocused()` and `cycle(step)`. On Android an unhandled Esc is not turned into back (`Generic.kcm` maps `ESCAPE` to no fallback) *(checked: AOSP source)*.

### 7.5 Gamepad

No API in the core. On Android, controller buttons the app leaves unhandled fall back on the system level: B to BACK (so `hardwareBackPress` closes the newest window), A to DPAD_CENTER, Y to SPACE *(checked: AOSP `Generic.kcm`)*; whether React Native's views leave them unhandled is **verify**. A controller module can call `openFocused()`, `activate()`, `closeNewest()`, `closeAll()`, `cycle(±1)`, `step(±1)` ([§9.4]).

### 7.6 Timers and focus

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` (hover only) | `fire()` of [§6] |
| close | `leave(w)` (hover only) | `tick()` of [§5] |
| lock | `lockTrack(win)` with `lockAfter > 0` (hover only) | `stopLock(); pin(win)` ([§7]) |
| flash | `flash(w)` | 700 ms highlight ([§4.4]) |
| long-press | Pressability (`delayLongPress`) | section 7.1 |

Focus ([§9.5]) means screen-reader focus here: after a window opened through an accessibility action, call `AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus")` once it has been laid out (its first `onLayout`); after closing it, the same on the anchor element. Terms are nested texts and cannot take that focus themselves; the title can.

## 8. Accessibility (SPEC §6)

| Part | Props |
|---|---|
| marked element | `accessibilityHint` = the entry's `short`; `accessibilityActions` `[{ name: "explain", label }]` and `onAccessibilityAction` → open pinned with focus (section 5). VoiceOver lists it under *Actions*, TalkBack in its actions menu. |
| term | `role="link"` and `accessibilityRole="link"` on the nested `Text` (section 6) |
| window | a `View` with `accessible={false}` (its parts stay separate elements), `role={tip.pinned ? "dialog" : "tooltip"}` (both are values of `role` *(checked: types)*), `aria-modal={false}`, `onAccessibilityEscape` |
| title | `Text` with `role="header"`; it takes the focus on open |
| pin, close | `Pressable` with `accessibilityLabel` = `label("pin" / "unpin" / "close")`, `accessibilityState={{ selected: pinned }}` for the pin, 40 × 40 touch target |
| announcements | `AccessibilityInfo.announceForAccessibility(title)` only where moving the focus is not possible |

`AccessibilityInfo.isReduceMotionEnabled()` (and its `reduceMotionChanged` event) turns the flash into a static outline.

## 9. Look: the values of `deeptip.css`

CSS pixels are density-independent pixels; `fontSize` follows the system text size unless `allowFontScaling={false}`.

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| open term background | `rgba(11,105,212,0.16)` | `rgba(108,182,255,0.16)` |
| missing link | text colour, `textDecorationLine: "underline"`, `textDecorationStyle: "dotted"`, `textDecorationColor: "#dd3333"` | same |

| Measure | Value |
|---|---|
| width, height | 240–384 wide incl. the 1 px border, at most 480 high; the body is a `ScrollView` (`flexGrow: 0`) |
| text | `fontSize: 14`, `lineHeight: 21`; title `fontWeight: "600"`; code `fontFamily: Platform.select({ ios: "Menlo", default: "monospace" })` at 0.92; values `fontWeight: "600"`, `fontVariant: ["tabular-nums"]` |
| frame | `borderRadius: 8`, `borderWidth: 1` (pinned: accent), `boxShadow: "0 10px 30px rgba(0,0,0,0.3)"` (a style of 0.88.1 *(checked: types)*) |
| header | `paddingLeft: 12, paddingTop: 6, paddingRight: 6, paddingBottom: 2`; pin and close 40 × 40 (touch first) with 18 px icons |
| body | `paddingHorizontal: 12, paddingBottom: 10`; blocks 7 apart; list indent 17 |
| "See also" | like the body, `fontSize` 0.9, label at 70 % opacity |
| hint | hidden: there is no hover on touch screens (show it only where hover works: `paddingTop: 4, paddingHorizontal: 12, paddingBottom: 6`, 0.75, 60 %, 1 px line above) |
| terms | link colour, `textDecorationLine: "underline"`, `textDecorationStyle: "dotted"` (iOS; Android draws solid), open: background as above |
| flash, lock bar | 3 px accent ring peaking at 30 % of 600 ms; 2 px accent bar at the bottom, `scaleX` 0 → 1 over `lockAfter` |

## 10. Glossary, live values, locales

- Metro needs literal paths in `import` / `require`, so `{locale}` templates do not work for bundled files. Pass the files per locale, in layer order (core first, project after): `glossaries={{ en: [coreEn, en], de: [coreDe, de] }}`; the controller calls `add(locale, json)` for each, in order. For locales the chain needs later, use `() => import("./glossary/de.json")` thunks.
- Remote glossaries: URL templates with `{locale}` and `fetch`, as the web runtime does ([§1.2]); a failed fetch is a warning.
- Keys keep JavaScript's order, so the order of `flattenGlossary` equals the reference's (also for digit-only key parts, [§1.1]).
- Validate the files with `node <DeepTip>/tools/deeptip-check.mjs --base en src/deeptip/glossary/core.en.json src/deeptip/glossary/en.json --scan src`; `--scan` finds `useDeepTip("key")` calls and `[[key]]` links in the code (`useDeepTip` since 1.1.0).
- **Live values**: `vars` as in the web runtime, a map of values or functions (`{ gold: () => store.getState().gold }`) or one `(name, key) => value`; `null` keeps `{name}` visible ([§1.2]). After a change call `dt.refresh()`: it increments the version, so every window, `DeepTipText` and `DeepTipIndex` re-renders. With React state, push the values from an effect with `dt.configure({ vars })`, as the [React guide](../react/README.md#4-live-values-and-language) does.
- **Locales**: `dt.setLocale(locale)` adds the files of the new chain (calling the thunks it still needs), then refreshes; term anchors stay equal (section 3), so child windows stay attached.

## 11. Testing

### 11.1 Parity cases ([§11])

Nothing is ported, so the cases test that the copy is the reference: `npm test` in the DeepTip repository runs them against `deeptip.js`. In the app, with Jest and the React Native template's `babel.config.js` (`presets: ["module:@react-native/babel-preset"]`), this test passed all 24 cases with Jest 30 *(checked)*; it needs a `package.json` without `"type": "module"`, as React Native apps have:

```js
// __tests__/deeptip-cases.test.js — DEEPTIP_CASES=<DeepTip>/test/cases npx jest __tests__/deeptip-cases.test.js
import { readFileSync } from "fs";
import { computePlacement, flattenGlossary, parseText } from "../src/deeptip/deeptip";

const dir = process.env.DEEPTIP_CASES ?? "../DeepTip/test/cases";
const cases = (name) => JSON.parse(readFileSync(`${dir}/${name}`, "utf8")).cases;

test.each(cases("markup.json"))("markup: $name", (c) => expect(parseText(c.src)).toEqual(c.blocks));
test.each(cases("placement.json"))("placement: $name", (c) =>
  expect(computePlacement(c.size, c.anchor, c.sides, c.viewport)).toEqual(c.expect));
test.each(cases("glossary.json"))("glossary: $name", (c) => {
  const f = flattenGlossary(c.input);
  expect({ keys: [...f.entries.keys()], meta: Object.keys(f.meta), problems: f.problems.length }).toEqual(c.expect);
});
```

### 11.2 Engine

Jest with `jest.useFakeTimers()` and a clock whose `now()` the test advances together with `jest.advanceTimersByTime(ms)`; a fake host that records calls and returns boxes. Cover the list of the [Swing guide](../java-swing/README.md#112-behaviour) that applies without hover: one window per anchor, pin chain, subtree close, the same key up the chain flashes, long-press opens pinned, outside taps close all, back closes the newest, vanished anchors; and the hover rules for platforms that report hover. `frameworks/rust-egui/tests/engine.rs` has them with exact times.

### 11.3 Components

Render tests (`@testing-library/react-native`: `fireEvent(element, "longPress")`, `fireEvent.press(term)`) check the wiring, not the platform; long-press timing, the 10 px tolerance, accessibility actions and placement at the screen edges need a device (**verify**), compared by hand with the web example (`npm run demo`).

## 12. The example to build

The screen of `frameworks/web/example`, in one React Native app: a HUD row of `Pressable`s with `useDeepTip` on `demo.realm`, `demo.stability` (tap: −3 … +3, live value `{stability}`), `demo.taxes` (tap: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), and a help button `deeptip.about`; a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English); four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) inside the safe area for placement at the screen edges; a page text with terms (`DeepTipText`); settings (outside tap, close and pin buttons); the encyclopedia (`DeepTipIndex`: a `TextInput` with `placeholder={label("search")}` and a `FlatList`, sorted with `Intl.Collator(locale, { sensitivity: "base" })` where the JavaScript engine provides `Intl`); an event log. Glossaries: `glossary/core` and `glossary/example`, copied into the app. Screen texts: those of `frameworks/web/example/index.html`. Try it with touch, TalkBack and VoiceOver.

## 13. Pitfalls

- A `Modal` of the app is a native window above DeepTip's layer: elements inside it need a `DeepTipProvider` inside the `Modal`.
- Android `elevation` draws an app view above a later sibling: keep the layer's `elevation` and `zIndex` higher.
- `onPress` and `onLongPress` of a marked element are shared with the app; compose them, never overwrite them silently.
- `measureInWindow`, `getBoundingClientRect` and `pageX` / `pageY` must be compared in one coordinate space; subtract the layer's box (section 4.2).
- Windows do not follow scrolling (section 4.3).
- `Vibration` needs the Android permission; iOS ignores its duration.
- `pointerEvents="box-none"` on the layer is required; without it the layer swallows every touch.
- A glossary key used only through a computed `import` path is invisible to Metro; import every locale file statically or through a literal thunk.

## 14. Limitations compared with the web reference

- Hover previews, the tendency, suppression and the timer lock need hover events, which iOS and Android do not deliver by default (section 2).
- No keyboard (Esc, F1, `?`, F6) or gamepad input without a native module (sections 7.4, 7.5).
- Terms inside text are not focusable with a keyboard; screen readers reach them as links.
- Windows stay where they opened when their anchor scrolls (section 4.3).
- Windows live inside the app's root view.
- **React Native for Web** renders to the DOM: there the web runtime itself is the better choice; `dataSet={{ deeptip: "key" }}` renders `data-deeptip` (**verify** with your react-native-web version).

## 15. Checklist

1. Copy `deeptip.js` and the declarations; run the parity test (section 11.1).
2. Glossary layers, chain, `$ui` labels and live values on top of `flattenGlossary`; validate the JSON files with `tools/deeptip-check.mjs`.
3. Engine with clock and host, tested with fake timers (11.2).
4. `DeepTipProvider`, `useDeepTip`, `TipWindow`, `TermText`, back handler, accessibility (sections 4–8).
5. The example on an iPhone and an Android phone, with VoiceOver and TalkBack; compare with the web example; then list the framework with its state in the main README.

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
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
