# DeepTip on Android with Jetpack Compose: build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) in an Android app written with Jetpack Compose, touch first, with mouse, hardware keyboard, game controller and TalkBack as further inputs.

This folder holds no code: DeepTip code exists only as HTML, CSS, JavaScript and Rust. Compose on Android shares most of its API with Compose Desktop, so this guide builds on the desktop guide [frameworks/kotlin-compose](../kotlin-compose/README.md) and links its sections instead of repeating them; it covers what Android changes: touch as the primary input, the app window with system bars and insets, popups and dialogs as separate windows, the back gesture, hardware keyboards, game controllers and TalkBack. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; [SPEC.md](../../SPEC.md) is the contract. Marks: *(checked)* = compiled on 2026-10-29 against Compose Multiplatform 1.12.2 (the common `androidx.compose` API that Android shares; Kotlin 2.4.21, JDK 25) or checked with headless UI tests in the desktop guide; *(checked: source)* = read in the `androidx-main` sources (Compose UI, foundation, activity-compose) or in AOSP; *(checked: docs)* = Android developer documentation; **verify** = needs a device or emulator, which were not used.

## Quick start

**Recognise the project:** a `build.gradle.kts` (or `build.gradle`) applying `com.android.application` and `org.jetbrains.kotlin.plugin.compose` (older projects: `buildFeatures { compose = true }`), dependencies on `androidx.compose:compose-bom` and `androidx.activity:activity-compose`, an activity that calls `setContent { … }`, and `src/main/AndroidManifest.xml`.

1. Add `org.jetbrains.kotlinx:kotlinx-serialization-json` (ordered JSON that also works in local unit tests).
2. Copy `glossary/core/<locale>.json` to `src/main/assets/deeptip/core.<locale>.json` and write `src/main/assets/deeptip/<locale>.json`.
3. Port core and engine as the desktop guide says (sections 2, 4, 11 there) and pass the parity cases with `./gradlew testDebugUnitTest`.
4. Build `DeepTipHost`, `Modifier.deepTip`, `TermText` and `TipLayer` (desktop sections 5, 7, 8) with the Android changes of sections 3 to 8 here.
5. Wrap the content of `setContent` in `DeepTipHost` and mark an element with `Modifier.deepTip("key")`.

```kotlin
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val dt = rememberDeepTip(DeepTipOptions(locale = "en", fallback = listOf("en"),
                sources = listOf("deeptip/core.{locale}.json", "deeptip/{locale}.json")))   // asset paths
            DeepTipHost(dt) {
                Button(onClick = { /* the app's own action */ }, modifier = Modifier.deepTip("shop.cart")) { Text("Cart") }
            }
        }
    }
}
```

**Done when:** a 500 ms long-press on *Cart* opens its window pinned with a short vibration and without running `onClick`, a tap on *check out* opens the next window beside it inside the safe area, back closes the newest window and with none open behaves as before, TalkBack offers *Explain* for the button, `./gradlew testDebugUnitTest` passes the 24 parity cases.

## 1. What the desktop guide already covers

| Part | Desktop guide | On Android |
|---|---|---|
| `Glossary`, `Markup`, `Placement`, the Kotlin pitfalls | [sections 2 and 11](../kotlin-compose/README.md#11-porting-the-pure-functions-kotlin-pitfalls-checked) | unchanged, plain Kotlin; tests run as local unit tests (section 10) |
| `Engine`, `Clock`, `Host`, data structures | [section 4](../kotlin-compose/README.md#4-data-structures) | unchanged |
| `DeepTipHost`, `TipLayer`, measuring with intrinsics | [section 5](../kotlin-compose/README.md#5-the-window-layer-and-placement) | the viewport excludes system bars and the keyboard (section 3) |
| `TermText` with `LinkAnnotation` | [section 7](../kotlin-compose/README.md#7-text-and-terms-termtext) | taps follow terms; the hover `pointerInput` only matters with a mouse or stylus |
| pointer, keyboard, timers, focus | [section 8](../kotlin-compose/README.md#8-events-exact-order-of-operations) | touch first (section 4), Android key events (section 6), back (section 5) |
| look | [section 6](../kotlin-compose/README.md#6-look-the-values-of-deeptipcss) | 40 dp buttons and no hint line on touch screens (section 9) |
| live values, locales, JSON | [sections 9 and 10](../kotlin-compose/README.md#9-live-values-locales-refresh) | glossaries come from assets (section 10) |

One desktop API does not exist on Android: `Modifier.onPointerEvent` lives in Compose's `skikoMain` source set (desktop, iOS, web) *(checked: source)*. Write the enter and exit handlers of `Modifier.deepTip` and of the window container with `pointerInput` and `awaitPointerEvent()`, testing `PointerEventType.Enter` and `Exit` *(checked)*.

## 2. SPEC concept → Android

| SPEC | Android with Compose |
|---|---|
| Window layer (top layer) | The desktop guide's own layer: one `Layout` composed after the content inside `DeepTipHost`. |
| Why not `Popup` | On Android a `Popup` is a separate window (`WindowManager`, type `TYPE_APPLICATION_SUB_PANEL` by default) *(checked: source)*: touches inside it go to that window, so the host's observer misses them (the desktop guide measured the same for desktop popups), and `focusable = true` takes the keyboard focus and the back press. `Popup` + `PopupProperties(focusable = false, dismissOnBackPress = false, dismissOnClickOutside = false)` *(checked)* remains possible when windows must float above other windows; route its touches into the engine yourself. |
| Dialogs, bottom sheets | `Dialog` and `ModalBottomSheet` are windows above the activity's content; elements inside them need a `DeepTipHost` inside the dialog's content. |
| Marked UI element | `Modifier.deepTip(key, delay, place, editable)`: enter and exit with `pointerInput` (section 1), the touch long-press of section 4, the TalkBack actions of section 8. |
| Term (a real button) | `LinkAnnotation.Clickable` (desktop section 7): a tap or Enter follows it. |
| Hover (mouse, touchpad, stylus hover) | `PointerType.Mouse` and `PointerType.Stylus` with `PointerEventType.Enter`, `Move`, `Exit` *(checked)*; how a device reports stylus hover is **verify**. Touch never hovers. |
| Long-press haptics | `LocalHapticFeedback.current.performHapticFeedback(HapticFeedbackType.LongPress)` *(checked)*. |
| Back gesture, back button | `BackHandler(enabled) { … }` of activity-compose, section 5. |
| Viewport, safe areas | The host's size minus `WindowInsets.safeDrawing` and `WindowInsets.ime`, read with `getLeft(density, layoutDirection)`, `getTop(density)`, … *(checked)*. Section 3. |
| Pixels | SPEC pixels are CSS pixels = dp: `GAP` 8 dp, `MOVE_TOL` 10 dp, `SWIPE` 60 dp, sizes 240/384/480 dp; convert with `LocalDensity` (`8.dp.toPx()`). |
| Hardware keyboard | `onPreviewKeyEvent` on the host (desktop section 8.2) with the Android differences of section 6. |
| Game controller | Buttons arrive as key events (`Key.ButtonA`, `ButtonB`, `ButtonY`, `ButtonL1`, `ButtonR1`) *(checked: source)*; sticks as generic motion events of the activity (section 7). |
| Screen reader (TalkBack) | `semantics { onLongClick(label) { … }; customActions = … }` on elements, `paneTitle` and `isTraversalGroup` on windows *(checked)*; section 8. |
| Accessibility timeouts | `LocalAccessibilityManager.current?.calculateRecommendedTimeoutMillis(closeDelay, containsText = true, containsControls = true)` stretches `closeDelay` and `lockAfter` for users who set a longer "time to take action" *(checked)*. |
| Light, dark | `isSystemInDarkTheme()` *(checked)*. |

## 3. The window layer in an Android app

- `DeepTipHost` fills the activity (`setContent { DeepTipHost(state) { … } }`). With `enableEdgeToEdge()`, and always once an app targets SDK 35 on Android 15 or newer (edge-to-edge is enforced *(checked: docs)*), the content draws behind the status bar, the navigation bar and display cutouts.
- **Viewport** for [§8]: the host's size minus the insets. In `TipLayer` (desktop section 5) take `val insets = WindowInsets.safeDrawing.union(WindowInsets.ime)` during composition (the getters are composable); in the measure block read `left = insets.getLeft(this, layoutDirection)`, `top = insets.getTop(this)`, `right`, `bottom` (the `MeasureScope` is the `Density`) *(checked)*, move every target box by `(-left, -top)`, call `computePlacement` with `vp = (width − left − right, height − top − bottom)`, and add `(left, top)` to the result. The inset values are state, so the layer measures again when they change, for example when the keyboard opens.
- **Rotation, split screen, foldables, desktop windowing**: the host's size changes, the layer measures again, every window that is not frozen is placed again.
- **Activity recreation** (rotation without `android:configChanges`, a theme change, process death) creates a new `DeepTipState`: open windows are gone. Keep it that way, or save the keys of pinned roots with `rememberSaveable` and reopen them.
- **Scrolling** moves anchors: their `onGloballyPositioned` bumps `layoutVersion` (desktop section 5), the layer places again in the next frame.

## 4. Touch: the exact behaviour (SPEC §3.3, §3.5)

Touch never hovers: no previews, no tendency, no timer lock. All observers below run in `PointerEventPass.Initial` and consume nothing unless stated, so the app's own gestures keep working.

| Gesture | Steps |
|---|---|
| finger down outside every window | the host's observer gets `Press` with `PointerType.Touch`; no window `box` contains it → with windows open and `outsideClickCloses` `touch` (default) or `always`: close all ([§9.2]). The element below still gets its tap. |
| finger down on a marked element | `Modifier.deepTip`'s observer: remember the position and pointer id, start the `longPress` timer (`rememberCoroutineScope().launch { delay(longPress) … }`), `ref.arming = longPress` (rest progress) |
| moved more than 10 dp from the down position, or lifted early | cancel the timer, `arming = -1`; a short tap runs the element's `onClick` as usual |
| timer fired (`longPress`, 500 ms) | haptic feedback (if `vibrate`), `openPinned(element, focus = false, via = "touch")`, remember `fired` |
| release after the timer fired | `change.consume()` on the `Release` in the Initial pass: the element's `clickable` sees a consumed release and does not click. The desktop guide checked exactly this with injected touch: a short tap clicked, a 700 ms press did not ([desktop section 8.1](../kotlin-compose/README.md#81-pointer)). |
| tap on a term in a window | the `LinkAnnotation`'s listener: `follow(term, window, focus = false)`; the parent is pinned, the term's window opens pinned beside it ([§9.1]) |
| tap on a term in page text | the same without parent (a root window); the finger-down outside every window closed all first, as on the web |
| tap inside a window, not on a term or button | the window container's `pointerInput` in the Main pass pins on an unconsumed `Release` (desktop section 8.1) |
| swipe a title bar down | `pointerInput` on the title row (not its buttons): on `Release` of the same pointer, `dy > 60.dp` and `abs(dx) < 60.dp` → close all |
| pin, close | 40 dp buttons on touch screens |

- Use DeepTip's own timer, not `detectTapGestures(onLongPress = …)`: that detector uses the system long-press timeout (`LocalViewConfiguration.current.longPressTimeoutMillis` *(checked)*), not the `longPress` option, and on the same element it competes with `clickable` for the events.
- An element with its own `combinedClickable(onLongClick = …)` conflicts with DeepTip's long-press: put the explanation into its menu or mark a label next to it.
- Text in a `SelectionContainer` selects on long-press: do not mark selectable text.
- A pressed `Button` shows its ripple during the hold; the consumed release cancels it.

## 5. Back gesture and back button

```kotlin
// inside DeepTipHost, after content() and TipLayer
BackHandler(enabled = state.windows.isNotEmpty()) { state.closeNewest(focusBack = true) }
```

- If several `BackHandler`s are enabled, the one composed last wins *(checked: source)*. Composed after the content, DeepTip's handler wins over the handlers of a `NavHost` or a screen while windows are open; with none open it is disabled and back behaves as before.
- Call `BackHandler` unconditionally and switch it with `enabled`; conditional calls change the composition order *(checked: source, the function's documentation)*. activity-compose routes it through `NavigationEventDispatcher` or the legacy `OnBackPressedDispatcher` *(checked: source)*.
- Do not watch `Key.Back` in a key handler: with predictive back, intercepting back through `KeyEvent.KEYCODE_BACK` is no longer supported *(checked: docs)*.
- Optional: `PredictiveBackHandler` gives the gesture's progress; scale the newest window down with it and close it when the flow completes.
- A game controller's B button falls back to BACK when nothing consumes it (section 7), so it reaches the same handler.

## 6. Hardware keyboard

The desktop guide's `onPreviewKeyEvent` table ([section 8.2](../kotlin-compose/README.md#82-keyboard-onpreviewkeyevent-on-the-host)) applies, with these Android differences:

| Topic | Android |
|---|---|
| event types | only `KeyDown` and `KeyUp` (`ACTION_MULTIPLE` is `Unknown`) *(checked: source)*; there is no separate typed event |
| `?` and typing | on `KeyDown`, `utf16CodePoint` is `KeyEvent.getUnicodeChar()` with the meta state applied *(checked: source)*: `?` is `utf16CodePoint == '?'.code` on `KeyDown`; a printable character (`> 0`, no Ctrl, Alt or Meta) on a focused marked element hushes it ([§6]) |
| Esc held | Android repeats `KeyDown` while a key is held; `nativeKeyEvent.repeatCount > 0` marks the repeats: close all when it is a repeat and `now − escAt ≥ 600` |
| Esc not consumed | Compose turns `Key.Escape` and `Key.Back` into `FocusDirection.Exit` *(checked: source)*: consume Esc (return `true`) whenever DeepTip handled it |
| focus keys | Tab and Shift+Tab move to the next and previous focusable, the arrow keys move in that direction, and Enter, numpad Enter, the d-pad centre and Space click the focused clickable *(checked: source)* |
| F1, F6 | `Key.F1`, `Key.F6` *(checked)* |

The handler on the host sees a key before the focused element, as on desktop: `onPreviewKeyEvent` runs from the root down.

## 7. Game controllers

| Input | Steps |
|---|---|
| `Key.ButtonY` `KeyDown` | as F1 ([§9.4]): the focused marked element (or term window) opens pinned with focus. **Consume it** whenever DeepTip handled it: Android turns an unhandled BUTTON_Y into SPACE *(checked: AOSP `Generic.kcm`)*, which would click the focused element. |
| `Key.ButtonB` `KeyDown` (not a repeat) | start a 600 ms timer that closes all (focus back to the root's anchor); do not rely on key repeat for controller buttons (**verify** whether your controller repeats) |
| `Key.ButtonB` `KeyUp` | timer still pending → cancel it, close `newest(focused)` with focus back. Consume down and up while windows are open; with none open, leave B alone: Android turns an unhandled BUTTON_B into BACK *(checked: AOSP `Generic.kcm`)*. |
| `Key.ButtonA` | leave it alone: unhandled it becomes DPAD_CENTER *(checked: AOSP `Generic.kcm`)*, which clicks the focused term or button (section 6) |
| `Key.ButtonL1`, `Key.ButtonR1` | `cycle(-1)`, `cycle(+1)` (they have no fallback) |
| d-pad as keys (`Key.DirectionUp` …) | inside a window: step through its terms, then its buttons, wrapping ([§9.4]); outside windows let Compose move the focus |
| d-pad as axes, left stick | not delivered to composables: override `dispatchGenericMotionEvent` (or a view's `onGenericMotionEvent`) in the activity, take events with `isFromSource(InputDevice.SOURCE_JOYSTICK)`, read `MotionEvent.AXIS_HAT_X` / `AXIS_HAT_Y` (d-pads reported as axes) and `AXIS_X` / `AXIS_Y` (stick) *(checked: docs)*; a value beyond ±0.6 that was not there before is one d-pad step |

## 8. TalkBack and accessibility (SPEC §6)

| Part | Semantics |
|---|---|
| marked element | `Modifier.semantics { onLongClick(label = label("explain")) { state.openPinned(ref, focus = true, via = "key"); true }; customActions = listOf(CustomAccessibilityAction(label("explain")) { … ; true }) }` *(checked)*. TalkBack users double-tap and hold, or pick *Explain* from the actions menu. If the element already has its own long-click action, use only the custom action. |
| window | `Modifier.semantics { paneTitle = title; isTraversalGroup = true }`: the window is a pane, and Compose sends Android's "pane appeared" event for it *(checked: source)*, so TalkBack announces the title. Compose has no tooltip or dialog role. |
| term | `LinkAnnotation`s are link nodes of the text (desktop section 7); how TalkBack lists them (links menu) is **verify**. |
| focus | opening with focus moves the input focus to the first term (desktop section 8.5); whether TalkBack's accessibility focus follows it is **verify**; the pane announcement covers the case where it does not |
| timeouts | `calculateRecommendedTimeoutMillis` for `closeDelay` and `lockAfter` (section 2) |
| reduced motion | Compose offers no query; read the system animator scale (`Settings.Global.ANIMATOR_DURATION_SCALE`, 0 = animations off) and skip the flash animation then (**verify**) |
| touch targets | at least 40 dp (SPEC); Material components use 48 dp (`LocalMinimumInteractiveComponentSize`) |

`explain` is an own label next to the `$ui` labels of [§1.2]; put it into the project glossary's `$ui` (the schema allows extra labels).

## 9. Look

The desktop guide's tokens and measures ([section 6](../kotlin-compose/README.md#6-look-the-values-of-deeptipcss)), with these touch changes from `deeptip.css` (`pointer: coarse`): pin and close 40 × 40 dp with 18 dp icons, no hint line. Light and dark from `isSystemInDarkTheme()`; text in sp follows the user's font size, the window keeps its 240–384 dp width and its body scrolls. To match a Material 3 app, map the tokens to `MaterialTheme.colorScheme` (`surface`, `onSurface`, `outline`, `primary`) instead.

## 10. Loading the glossary

```kotlin
suspend fun readAsset(context: Context, path: String): String? = withContext(Dispatchers.IO) {
    try {
        context.assets.open(path).bufferedReader(Charsets.UTF_8).use { it.readText() }.removePrefix("\uFEFF")
    } catch (e: IOException) {
        Log.w("DeepTip", "cannot load $path", e)   // a missing file is a warning (§1.2)
        null
    }
}
```

- `sources` are asset paths with `{locale}`: for each locale of the chain, each template in order (core first, project after); `add` them in that order once all have arrived ([§1.2]).
- Parse with `Json.parseToJsonElement`: its `JsonObject` keeps the file order (desktop section 10). Keep `org.json` out of the pure code: local unit tests run against an `android.jar` whose methods are stubs.
- The example copies `glossary/core` and `glossary/example` into `src/main/assets/deeptip/`.
- Validate the files with `node <DeepTip>/tools/deeptip-check.mjs --base en src/main/assets/deeptip/core.en.json src/main/assets/deeptip/en.json --scan src/main`; `--scan` finds the keys of `Modifier.deepTip("key")` calls and the `[[key]]` links in string literals of `.kt` files (since 1.1.0).

## 11. Testing

- **Parity cases** ([§11]): the desktop guide's `CasesTest` ([section 12.1](../kotlin-compose/README.md#121-parity-cases-11)) as a local unit test in `src/test/kotlin`, run with `./gradlew testDebugUnitTest`; pass the folder with `android { testOptions { unitTests.all { it.systemProperty("deeptip.cases", "<DeepTip>/test/cases") } } }` (**verify** the DSL against your Android Gradle plugin version). The Kotlin port behind the desktop guide passes all 24 cases *(checked there)*.
- **Engine**: plain Kotlin tests with a fake clock (desktop section 12.2).
- **Compose UI** (**verify**, instrumented `androidTest` or local tests with Robolectric): `createAndroidComposeRule<ComponentActivity>()`; long-press: `onNodeWithTag("cart").performTouchInput { longClick(center, durationMillis = 700) }`, then assert the window's node exists and `onClick` did not run; terms: `performTouchInput { click(…) }`; back: `rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }`; keys: `performKeyInput { pressKey(Key.ButtonY) }`; TalkBack actions: `fetchSemanticsNode().config[SemanticsActions.OnLongClick].label`. Virtual time with `mainClock.autoAdvance = false` and `mainClock.advanceTimeBy(ms)`, as checked on desktop ([section 12.3](../kotlin-compose/README.md#123-compose-ui-headless)).
- On a phone: compare timing and placement by hand with the web example (`npm run demo`, opened in the phone's browser).

## 12. The example to build

The screen of `frameworks/web/example` in one activity: a HUD row of buttons marked `demo.realm`, `demo.stability` (tap: −3 … +3, live value `{stability}`), `demo.taxes` (tap: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), and a help button `deeptip.about`; a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English); four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) inside the safe area for placement at the screen edges; a page text with terms; settings (outside tap, close and pin buttons, hints); the encyclopedia; an event log. Glossaries: `glossary/core` and `glossary/example` in the assets. Screen texts: those of `frameworks/web/example/index.html`. Try it with touch, a mouse, a hardware keyboard, a controller and TalkBack.

## 13. Pitfalls

- `Modifier.onPointerEvent` does not exist on Android (section 1).
- `Popup`, `Dialog` and sheets are windows of their own (section 2).
- Edge-to-edge without insets puts windows under the status bar or the gesture bar (section 3).
- An unconsumed Esc moves the focus out of the window; an unconsumed Y clicks the focused element (sections 6, 7).
- `KEYCODE_BACK` cannot be intercepted any more; use `BackHandler` (section 5).
- SPEC pixels are dp: convert `GAP`, `MOVE_TOL`, `SWIPE` and the size limits with the density.
- `detectTapGestures(onLongPress)` uses the system timeout and fights the element's `clickable` (section 4).
- Activity recreation drops open windows (section 3).

## 14. Limitations compared with the web reference

- Windows live inside the activity's window; every dialog needs its own host.
- Hover previews, the tendency and the timer lock need a mouse, touchpad or hovering stylus.
- No tooltip or dialog role in Compose semantics; windows are panes.
- F1 or `?` on a focused term is not supported, as on desktop (which `LinkAnnotation` has the focus is not observable).
- Sticks and axis d-pads need the activity's generic motion events.
- Device behaviour was not run here (marked **verify**).

## 15. Checklist

1. Port and test `flatten`, `parseText`, `computePlacement` against `test/cases` as local unit tests (desktop section 11, section 11 here).
2. Glossary with layers, chain, `$ui` labels, live values; assets; the validator on the same files.
3. Engine with clock and host (desktop section 4), then `DeepTipHost`, `TipLayer` with insets, `TermText`, `Modifier.deepTip` with the touch long-press, `BackHandler`, keys, controller, TalkBack (sections 3–8).
4. The example on a phone and a tablet, with TalkBack, a keyboard and a controller; compare with the web example; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.2]: ../../docs/algorithms.md#12-layers-locales-lookup
[§2]: ../../docs/algorithms.md#2-markup-parser
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.1]: ../../docs/algorithms.md#91-clicks
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
