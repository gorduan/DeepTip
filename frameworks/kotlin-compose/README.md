# DeepTip in Kotlin Compose Desktop: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth) with Kotlin and Compose Multiplatform for desktop.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Compose. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract. Statements marked *(checked)* were verified on 2026-10-29 with a throwaway project (Kotlin 2.4.21, Compose Multiplatform 1.12.2, Gradle 9.8.2, JDK 25.0.1, Windows 11): every API named here compiled, and the behaviour marked *(checked)* ran as headless UI tests.

## 1. Build setup *(checked)*

```kotlin
// build.gradle.kts
plugins {
    kotlin("jvm") version "2.4.21"
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21"
    id("org.jetbrains.compose") version "1.12.2"
}
repositories { mavenCentral(); google() }
dependencies {
    implementation(compose.desktop.currentOs)
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")   // Json.parseToJsonElement, no compiler plugin needed
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.compose.ui:ui-test-junit4:1.12.2")       // the accessor compose.desktop.uiTestJUnit4 is deprecated
}
tasks.test { useJUnit(); jvmArgs("--enable-native-access=ALL-UNNAMED") }
compose.desktop {
    application {
        mainClass = "MainKt"
        jvmArgs += listOf("--enable-native-access=ALL-UNNAMED")
    }
}
```

- JDK 25 works with this set. Gradle 9 itself needs Java 17 or newer.
- On JDK 24 and newer, Skiko's native library loading prints "A restricted method in java.lang.System has been called"; `--enable-native-access=ALL-UNNAMED` removes it *(checked)*.
- Verified with Kotlin 2.4.21. The POMs declare `kotlin-stdlib` 2.2.20 (Compose UI 1.12.2) and 2.4.10 (kotlinx-serialization-json 1.12.0); pick the Kotlin version accordingly when you change one of them.
- `gradle wrapper --gradle-version 9.8.2` adds the wrapper; `gradlew run` starts the example, `gradlew test` runs the tests.

## 2. Parts to build

| Part | Does | Compose types |
|---|---|---|
| `Glossary` | [§1](../../docs/algorithms.md#1-data): flatten, layers per locale, chain, `entry(key)`, `label(name)`, live values | no (kotlinx.serialization `JsonElement`) |
| `Markup` | [§2](../../docs/algorithms.md#2-markup-parser): `parseText` → blocks, `collectRefs` | no |
| `Placement` | [§8](../../docs/algorithms.md#8-placement): `computePlacement` | no |
| `Engine` | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock) and the logic of [§9](../../docs/algorithms.md#9-input) | no: talks to a `Host` interface and a `Clock` (the same design as the [Swing guide](../java-swing/README.md#3-data-structures)) |
| `DeepTipState` | `@Stable` holder: engine, `mutableStateListOf<Tip>()`, hover bookkeeping; `rememberDeepTip(options)` | state |
| `DeepTipHost(state) { content }` | root composable: draws `content`, then the window layer; global pointer observer; key handling | yes |
| `Modifier.deepTip(key, delay, place, editable)` | marks a UI element | yes |
| `TermText` | renders the AST; terms are `LinkAnnotation`s | yes |
| `TipWindowContent` | header, body, "See also", hint, lock bar, flash | yes |
| `DeepTipText(markup)`, `DeepTipIndex()` | terms on normal screens, the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia)) | yes |

Keep `Glossary`, `Markup`, `Placement` and `Engine` free of Compose imports: they are then plain unit tests, and they could move to `commonMain` of a multiplatform module unchanged.

## 3. SPEC concept → Compose primitive

| SPEC | Compose Desktop |
|---|---|
| Glossary files (§2.1) | `Json.parseToJsonElement(text)`; `JsonObject` keeps the file order *(checked)*; "is a string" = `(v as? JsonPrimitive)?.isString == true`. |
| Window layer (popover, top layer) | An overlay `Layout` composed after `content()` inside `DeepTipHost`: same window, same coordinate space, later children draw on top (section 5). |
| Why not one `Popup` per window | Pointer input inside a `Popup` goes to the popup's own layer: a host observer in the Initial pass saw 0 of the moves inside a popup *(checked)*, so the tendency, the hover triple and "click outside" would need per-popup plumbing. `Popup` + `PopupPositionProvider` (`calculatePosition(anchorBounds, windowSize, layoutDirection, popupContentSize): IntOffset` *(checked)*) remains possible when windows must float above other popups; it can move but not resize a popup, so the shrink case needs a second pass with a size limit. |
| Marked UI element (`data-deeptip`) | `Modifier.deepTip(key)`: `onPointerEvent(PointerEventType.Enter/Exit)` (desktop, `@ExperimentalComposeUiApi`), `onGloballyPositioned` for its box, `onFocusChanged`, a `FocusRequester`. |
| State hooks (`data-dt-open`, `data-dt-arming`) | State on the element's record (`open`, `arming`), read by the host's own drawing, e.g. `drawWithContent` for a rest-progress bar. |
| Term (a real button) | `LinkAnnotation.Clickable(tag, styles = TextLinkStyles(style, focusedStyle, hoveredStyle, pressedStyle), linkInteractionListener)` added with `withLink` in `buildAnnotatedString`. Tab focuses it, Enter activates it, a click calls the listener *(checked)*; it carries link semantics (focusable, `OnClick`). |
| Term under the pointer | `pointerInput` on the text: `TextLayoutResult.getOffsetForPosition(p)`, accept only if `getBoundingBox(offset)` contains `p`, then `annotated.getLinkAnnotations(offset, offset + 1)` → the tag. The text's own `pointerInput` still receives moves while the pointer is over a link *(checked)*. |
| Pointer over / out at document level | `pointerInput` on the host's root with `awaitPointerEvent(PointerEventPass.Initial)`, never consuming: it sees moves over every child of the host *(checked)*. |
| `delay`, `linkDelay`, `closeDelay`, `lockAfter`, retries | `rememberCoroutineScope()`, `scope.launch { delay(ms); task() }`, `Job.cancel()`. |
| Flash, lock bar | `Animatable` / `animateTo(tween(...))` in a `LaunchedEffect` keyed on a counter; draw in `drawWithContent`. |
| Keyboard in the capture phase | `Modifier.onPreviewKeyEvent` on the host: runs before the focused element; returning `true` consumes it *(checked)*. |
| Focus | `FocusRequester`, `onFocusChanged { it.hasFocus }`, `LocalFocusManager.current.moveFocus(FocusDirection.Next)`; one-dimensional order = order of the `place()` calls *(checked)*. |
| Coordinates | Window pixels: `positionInWindow()`, `boundsInWindow()` (clipped), `size`; `LocalDensity` converts dp ↔ px; `LocalWindowInfo.current.containerSize` is the window size. |
| Viewport | The size of `DeepTipHost` (the window content when the host fills it). |
| Touch (§9.2) | `PointerInputChange.type == PointerType.Touch`; long-press timer in the Initial pass; consuming the release swallows the element's click *(checked with injected touch)*. |
| Accessibility (§6) | Links are semantics nodes *(checked)*; give a window `Modifier.semantics { paneTitle = title }`. Compose has no tooltip or dialog role. On Windows, Compose Desktop reaches screen readers through the Java Access Bridge (`jabswitch -enable`). |
| Encyclopedia (§12) | `BasicTextField` (or your design system's text field) + filtered `LazyColumn` of `TermText` rows; sort with `java.text.Collator.getInstance(locale)` at strength `PRIMARY`. |
| Theme (`--dt-*`) | A `DeepTipTheme` in a `CompositionLocal`, values of section 6 (CSS px = dp). |
| Gamepad | Not available, see section 13. |

## 4. Data structures

```kotlin
@Stable
class Tip internal constructor(val id: Int, val key: String, val parent: Tip?, anchor: Any, val via: String) {
    var anchor: Any = anchor; internal set               // ElementRef (UI element) or Term
    val children = LinkedHashSet<Tip>()                    // insertion order
    var pinned by mutableStateOf(false); internal set     // composition reads it (pin icon, hint line, border)
    var frozen = false; internal set
    internal var closeTimer: Cancel? = null
    var box = Rect.Zero; internal set                      // placed box in host pixels: a plain field, written during layout
    var flash by mutableIntStateOf(0); internal set       // +1 restarts the flash animation
    var locking by mutableLongStateOf(0L); internal set   // lockAfter while the lock bar runs, else 0
    internal var focusRequest by mutableIntStateOf(0)     // +1 asks the window to take the focus (section 8.5)
    internal var hasFocus = false                          // from onFocusChanged
}

class ElementRef(val key: String) {                        // one per Modifier.deepTip, remembered
    var box = Rect.Zero                                    // host pixels, from onGloballyPositioned
    var delay: Long? = null; var sides: List<String>? = null; var editable = false
    val focus = FocusRequester(); var focused = false
    var open by mutableStateOf(false)                      // data-dt-open
    var arming by mutableLongStateOf(-1L)                  // data-dt-arming: delay in ms, -1 = idle
}

class TermSource { var layout: TextLayoutResult? = null; var origin = Offset.Zero; var keys = emptyList<String>() }
data class Term(val source: TermSource, val index: Int, val key: String)   // identity: same TermSource + index

fun interface Cancel { fun cancel() }
interface Clock { fun now(): Long; fun after(ms: Long, task: () -> Unit): Cancel }
```

Engine state as in the Swing guide: `wins` (here the `SnapshotStateList`, oldest first = drawing order), hover triple `(win, link, trig)`, `hot`, `pending`, `samples`, `quiet`, `lockWin`, `escDown`, `escAt`, `seq`.

The Compose clock:

```kotlin
class ComposeClock(private val scope: CoroutineScope, private val time: () -> Long = { System.nanoTime() / 1_000_000 }) : Clock {
    override fun now() = time()
    override fun after(ms: Long, task: () -> Unit): Cancel { val job = scope.launch { delay(ms); task() }; return Cancel { job.cancel() } }
}
```

`now()` and `delay` must share one time base. In UI tests `delay` runs on the test's virtual clock *(checked)* while `System.nanoTime()` keeps running, so let the test pass `time = { mainClock.currentTime }`. Take sample times from `now()` too, not from `PointerInputChange.uptimeMillis`.

## 5. The window layer and placement

```kotlin
@Composable
fun DeepTipHost(state: DeepTipState, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize()
        .onGloballyPositioned { state.hostOrigin = it.positionInWindow(); state.viewport = it.size }
        .pointerInput(state) { awaitPointerEventScope { while (true) state.observe(awaitPointerEvent(PointerEventPass.Initial)) } }
        .onPreviewKeyEvent { state.onKey(it) }) {
        content()
        TipLayer(state)                    // composed last: drawn above the content
    }
}
```

`TipLayer` is one `Layout` whose children are the open windows in `state.windows` order, each wrapped in `key(tip.id) { TipWindowContent(state, tip) }` so a window keeps its scroll position and animations when an older one closes. Its measure block, for each window in order (parents come before their children, so a child can use the box its parent got in the same pass):

1. Frozen: measure with `Constraints.fixed` of `tip.box`, place at `tip.box.topLeft`, next window.
2. `natural = m.maxIntrinsicWidth(Constraints.Infinity)`; `w = natural.coerceIn(minW, maxW)` (240 and 384 dp in px).
3. `h = min(m.minIntrinsicHeight(w), maxH)` (480 dp).
4. Target box `a` in host pixels: `tip.parent.box` for children, the anchor's box for roots (`ElementRef.box`, or a term box, section 7).
5. `p = computePlacement(w, h, a, sides, viewport, gap)` with sides = the element's own `place`, else the `root` or `child` option.
6. If `p.maxW > 0`: `w = min(w, p.maxW)`, `h = min(m.minIntrinsicHeight(w), maxH)`; if `p.maxH > 0`: `h = min(h, p.maxH)`; when either was set compute again with `[p.side]`.
7. `placeable = m.measure(Constraints.fixed(w, h))`; `tip.box = Rect(p.x, p.y, p.x + w, p.y + h)`; place it at `(p.x, p.y)` in the `layout(viewport.width, viewport.height) { … }` block.

Rules that make this work:

- A measurable may be measured only once per pass, so size with intrinsics first; intrinsics work through `verticalScroll` *(checked: natural width 584 px, wrapped height at the clamped width, a 40 px height limit honoured)*. Inside the window use a `Column` whose body has `Modifier.weight(1f, fill = false).verticalScroll(...)`: header, "See also" and hint keep their height, the body scrolls.
- Never write snapshot state in the measure block (endless re-layout). `tip.box` is a plain field; the engine reads it from events and timers only.
- Anchor boxes are plain fields as well, so the layer does not re-measure when an anchor moves. Keep a `layoutVersion` `mutableIntStateOf`, read it in the measure block and increment it from the anchors' `onGloballyPositioned` only when a box really changed; that re-places windows after scrolling, window resizing or a re-layout of the host.
- Use `positionInWindow()` + `size` minus `hostOrigin` for anchor boxes; `boundsInWindow()` is clipped by scrolling parents.

## 6. Look: the values of `deeptip.css`

CSS pixels are used as dp, font pixels as sp.

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered (`hoveredStyle`) | `#084f9f` | `#9ccfff` |
| open term / focused term background | term colour at 16 % alpha | same |
| button hover background | black at 7 % | white at 9 % |
| missing link | text colour, underline `#d33` | same |

| Measure | Value |
|---|---|
| width | natural, at least 240 dp, at most 384 dp (whole window incl. 1 dp border) |
| height | at most 480 dp; the body scrolls |
| text | 14 sp, line height 21 sp; title semi-bold; code `FontFamily.Monospace` at 0.92; live values `FontWeight.SemiBold` with tabular figures (`fontFeatureSettings = "tnum"`) |
| corner radius, border | 8 dp, 1 dp (pinned: accent colour) |
| header | padding 12 / 6 / 6 / 2 dp (start, top, end, bottom); buttons 26 × 26 dp with 15 dp icons, 2 dp apart; fallback badge: 0.7 font size, 1 dp border, 3 dp radius |
| body | padding 12 dp at the sides, 10 dp at the bottom; paragraphs and lists 7 dp apart; list indent 1.2 em |
| "See also" | like the body, font 0.9, label at 70 % opacity |
| hint | padding 12 / 4 / 12 / 6 dp, font 0.75, 60 % opacity, 1 dp line above; not shown when pinned |
| flash | 3 dp ring in the accent colour, strongest at 30 % of 600 ms |
| lock bar | 2 dp along the bottom edge, accent colour, grows left to right over `lockAfter` |

## 7. Text and terms (`TermText`)

Render each block of the AST ([§3](../../docs/algorithms.md#3-rendering-the-ast)) as its own `BasicText` (a paragraph, or one row per list item with a "•" column). Build its `AnnotatedString`:

| AST node | `buildAnnotatedString` |
|---|---|
| `text` | `append(v)` (never interpreted further) |
| `br` | `append('\n')` |
| `b`, `i` | `withStyle(SpanStyle(fontWeight = FontWeight.Bold))`, `withStyle(SpanStyle(fontStyle = FontStyle.Italic))`, nested as in the AST |
| `code` | `withStyle(SpanStyle(fontFamily = FontFamily.Monospace))` |
| `var` | `withStyle(valueStyle) { append(value ?: "{$name}") }` |
| link to the window's own key | bold label |
| link to a missing key | label with `textDecoration = Underline` in the missing colour, no link |
| term | `withLink(LinkAnnotation.Clickable(tag = "$index", styles, linkInteractionListener = { follow(term) })) { append(label) }`; record `keys[index] = key` |

- The "open" look (a window for this term is open) is a `SpanStyle(background = …)` added to that term's range; rebuild the string when the set of open terms changes (derive it from state).
- `focusedStyle` and `hoveredStyle` of `TextLinkStyles` give the focus and hover look for free; DeepTip still needs the hover **event** (for `linkDelay`), so add `pointerInput` to each `BasicText`:

```kotlin
.pointerInput(source) {
    awaitPointerEventScope {
        while (true) {
            val e = awaitPointerEvent()                       // Main pass, never consume
            val p = e.changes.first().position
            val term = when (e.type) {
                PointerEventType.Exit -> null
                else -> source.layout?.let { l ->
                    val off = l.getOffsetForPosition(p)
                    if (!l.getBoundingBox(off).contains(p)) null
                    else text.getLinkAnnotations(off, off + 1).firstOrNull()
                        ?.let { (it.item as? LinkAnnotation.Clickable)?.tag?.toInt() }
                }
            }
            state.hoverTerm(source, term)                    // section 8.1
        }
    }
}
```

- Term box (anchor of a term on a normal screen, i.e. a root window): `layout.getPathForRange(start, end).getBounds()` translated by the text's `positionInWindow()` minus `hostOrigin`; store the text's position in `TermSource.origin` from `onGloballyPositioned`.
- Keyboard source of a click: `LinkInteractionListener` does not tell mouse from keyboard, but the web moves the focus into the new window only for keyboard activation. Record the last input in the host (`onPreviewKeyEvent`: Enter, NumPadEnter or Space → keyboard; the root observer's `Press` → pointer) and call `follow(term, tip, focus = lastInput == Keyboard)`.

## 8. Events: exact order of operations

### 8.1 Pointer

**Root observer** (`DeepTipHost`, `PointerEventPass.Initial`, never consumes; positions are host pixels):

| Event | Steps |
|---|---|
| `Move`, mouse or pen | add a sample with `now()` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)) |
| `Press` | `lastInput = Pointer`; "on pointer down" ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) with `win` = the newest window whose `box` contains the point, `trig` = the hovered element (touch: the element whose box contains the point), `touch = change.type == PointerType.Touch` |
| `Release` | end a long-press of that pointer; a title-bar swipe with dy > 60 and \|dx\| < 60 closes every window |
| `Exit` (the pointer left the host) | "on pointer leaving" ([§6](../../docs/algorithms.md#6-arming-and-delays)) |

**Hover bookkeeping**, each followed by `resolve()`:

| Where | Handler |
|---|---|
| `Modifier.deepTip` | `onPointerEvent(Enter)` → `hoverElement = ref`; `onPointerEvent(Exit)` → if it is still `ref`: `hoverElement = null` |
| window container | `Enter` → `hoverWindow = tip`; `Exit` → if it is still `tip`: `null` |
| `TermText` | the `pointerInput` of section 7 → `hoverTerm = Term(...)` or `null` |

`resolve()`: `win` = `hoverWindow` if still open; `link` = `hoverTerm`; `trig` = `hoverElement` only when `win` and `link` are both `null`; when the triple differs from the previous one run "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)). Moving between neighbours delivers Exit before Enter *(checked: enter a, exit a, enter b)*; the short empty triple in between only disarms and re-arms and starts close timers that the following Enter cancels, so it is harmless.

**Clicks inside a window**: terms through their `LinkInteractionListener` (section 7), buttons through `onClick`. For `clickInsidePins` give the window container a `pointerInput` in the Main pass that pins on a `Release` whose change is not consumed: the Main pass reaches children first, and a clickable child consumes its release, so a click on a term or button is not seen twice. DeepTip never consumes the host's own clicks.

**Touch long-press** ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) inside `Modifier.deepTip`: observe in `PointerEventPass.Initial` (before the element's own `clickable`); on a touch `Press` start the `longPress` timer, cancel it on a move beyond 10 px or a release; when it fired, consume the release so the element's click does not happen *(checked: a short tap clicked, a 700 ms press did not)*. On Windows desktop, touch may arrive as mouse input, then `PointerType` is `Mouse`.

### 8.2 Keyboard (`onPreviewKeyEvent` on the host)

| Event | Steps |
|---|---|
| `KeyDown` `Key.Escape` | no windows → `false`. `repeat = escDown; escDown = true` (a held key repeats `KeyDown` without `KeyUp`; Compose has no repeat flag). Shift, or `repeat` and `now() - escAt >= 600` → close all, focus the root's anchor; else if not `repeat`: `escAt = now()`, `close(newest(focused window), focusBack = true)`. Return `true`. |
| `KeyUp` `Key.Escape` | `escDown = false`; `true` if the press was consumed. |
| `KeyDown` `Key.F6` with windows open | `cycle(if (isShiftPressed) -1 else 1)`; `true`. |
| `KeyDown` `Key.F1` | a focused marked element outside every window → open it pinned with focus (`via = "key"`); `true` only when handled. |
| typed `?`: `type == KeyEventType.Unknown && utf16CodePoint == '?'.code` | as F1, unless the focused element is marked `editable` (Compose has no global "a text field has focus" query). |
| `KeyDown` Enter, NumPadEnter, Space | `lastInput = Keyboard`; return `false` (the focused link or button handles it). |
| typed printable character (`KeyEventType.Unknown`), no Ctrl/Alt/Meta, focused marked element | `hush(element)` ([§6](../../docs/algorithms.md#6-arming-and-delays)); `false`. |

Compose Desktop forwards AWT `KEY_PRESSED`, `KEY_RELEASED` and `KEY_TYPED` to the key modifiers: `KeyDown`, `KeyUp` and `KeyEventType.Unknown`, each with `utf16CodePoint = keyChar` *(CMP 1.12.2 source)*. AWT guarantees the character only on `KEY_TYPED`, so detect `?` and typing on the `Unknown` (typed) event; the key of `?` itself differs per keyboard layout. `nativeKeyEvent` is Compose's internal wrapper; `KeyEvent.awtEventOrNull` (package `androidx.compose.ui.awt`) returns the AWT event and is `null` in tests. The root's preview handler runs before the focused element and can consume Esc so no element sees it *(checked)*. `newest`, `cycle` and "close all" are in [§9.3](../../docs/algorithms.md#93-keyboard).

### 8.3 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); `tip.locking` only drives the bar animation |
| flash | `flash(w)` | `tip.flash++`; the window animates for 600 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |

Launch them in the host's `rememberCoroutineScope()`: they run on the UI thread and stop when the host leaves the composition.

### 8.4 Window state in composition

`pin`, `unpin`, `refresh` and locale changes write snapshot state (`pinned`, the entry text, `layoutVersion`); recomposition and the next layout pass re-place everything (section 5). Nothing else has to be called.

### 8.5 Focus

- Opening with focus ([§9.5](../../docs/algorithms.md#95-focus)): `tip.focusRequest++`; in `TipWindowContent`, `LaunchedEffect(tip.focusRequest)` requests the container's `FocusRequester` (container: `focusRequester(r).focusable().onFocusChanged { tip.hasFocus = it.hasFocus }`) and, if the window has terms, `moveFocus(FocusDirection.Next)`.
- Compose's one-dimensional focus order is the order of the `place()` calls, not the composition order and not the position on screen *(checked with all combinations)*. Lay the window out with a custom `Layout` that places the body (and "See also") **before** the header, while drawing the header on top: then `Next` from the container lands on the first term, Tab walks the terms and reaches pin and close last. (The web reference's Tab order is pin, close, terms; its initial focus is the first term as well.)
- `focusAnchor(a)`: `ElementRef.focus.requestFocus()` (the `FocusRequester` in `Modifier.deepTip` sits outside the element's own focusable, so it focuses that); for a term the parent window's container.
- `focusInside(t)`: `t.hasFocus`.

### 8.6 Anchors that move or disappear

- `Modifier.deepTip` needs the `DeepTipState` (provide it through a `CompositionLocal` from `DeepTipHost`) and a lifetime: write it as a `@Composable` modifier factory that `remember`s its `ElementRef` and registers it in a `DisposableEffect`, or as a `Modifier.Node` with `onAttach`/`onDetach`. Removal (`onDispose` / `onDetach`) → [§4.5](../../docs/algorithms.md#45-anchors-that-disappear): unpinned windows on it close, a pinned root freezes at `tip.box`.
- Terms: rebuilding a text creates new `Term`s; `refresh()` re-attaches children to the term with the same key ([§4.6](../../docs/algorithms.md#46-refresh)); others count as removed.

## 9. Live values, locales, refresh

- `vars`: `Map<String, Any?>` whose values are plain values, `() -> Any?` or `(String) -> Any?` (called with the window's key), or one `(name: String, key: String) -> Any?`; `null` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)). Values are read while composing; `refresh()` increments a state counter that `TipWindowContent` and `DeepTipText` read, so they recompose. Live values that are themselves snapshot state recompose without `refresh()`.
- `setLocale(locale)`: load the missing files of the new chain, then refresh.

## 10. Loading the glossary (JSON)

- Files: `File(path).readText()` (UTF-8); resources: `object {}.javaClass.getResourceAsStream("/deeptip/en.json")!!.readBytes().decodeToString()`; Compose resources (`Res.readBytes("files/deeptip/en.json")`) work as well. Strip a leading byte order mark (U+FEFF).
- `sources` are path templates with `{locale}`; load per locale of the chain, templates in order (layer order); a missing file is a warning ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- The example glossaries are `../../glossary/core/{locale}.json` and `../../glossary/example/{locale}.json` from `frameworks/kotlin-compose/` (Gradle's `run` starts in the project directory; the download zip keeps the repository layout).

## 11. Porting the pure functions: Kotlin pitfalls *(checked)*

A straight Kotlin port passes all 24 parity cases when these differences are handled:

1. `split(Regex)` keeps trailing empty strings like JavaScript (Java's `String.split` drops them).
2. `trim()` removes U+00A0 (Kotlin's `isWhitespace` includes space separators) but not U+FEFF; JavaScript removes both. Use `trim { it.isJsSpace() }` with one predicate (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF), also for the bullet test `^\s*[-•]\s+(.*)$` and the emphasis checks.
3. `Regex("\\s")` runs on the Java engine and does not match U+00A0.
4. JavaScript `.` stops at U+2028 and U+2029: a line containing them is not a bullet item.
5. Guard `s[i + 1]` with `i + 1 < s.length` (JavaScript returns `undefined`).
6. Port the reference's `findClose` loop literally (each skip ends with the loop's `j++`).
7. `List.reduce` without an initial value equals JavaScript's `reduce`: "the side with the most room" keeps the first on ties.
8. Placement in `Double` (a case expects `x = 17.5`).

## 12. Testing

### 12.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

```kotlin
class CasesTest {
    private val dir = File(System.getProperty("deeptip.cases") ?: "../../test/cases")
    private fun cases(name: String) =
        Json.parseToJsonElement(File(dir, name).readText()).jsonObject["cases"]!!.jsonArray.map { it.jsonObject }

    @Test fun markup() {
        for (c in cases("markup.json")) assertEquals(c["blocks"], Markup.toJson(Markup.parseText(c["src"]!!.jsonPrimitive.content)), c["name"].toString())
    }
    @Test fun placement() { /* read size, anchor, sides, viewport; compare side, fits and the four numbers as Double */ }
    @Test fun glossary() { /* flatten(c["input"]): keys in order, meta keys, number of problems */ }
}
```

- The markup AST can be compared as `JsonElement` (`JsonObject` equality ignores key order; the AST has no numbers). Compare placement numerically: `192` and `192.0` are different JSON literals.
- Pass the folder from Gradle: `tasks.test { systemProperty("deeptip.cases", rootDir.resolve("../../test/cases").canonicalPath) }`.

### 12.2 Engine

Plain `kotlin.test` with a fake `Clock` (tasks ordered by time, `advance(ms)`) and a fake `Host`: the same list of behaviours as in the [Swing guide](../java-swing/README.md#112-behaviour) (one preview per parent, pin chain, subtree close, flash, grace, tendency, suppression, hush, Esc, Shift+Esc, Esc hold, lock).

### 12.3 Compose UI, headless

- Use `androidx.compose.ui.test.v2.runComposeUiTest` (the v1 `runComposeUiTest` is deprecated in 1.12). With `mainClock.autoAdvance = false`, `mainClock.advanceTimeBy(ms)` also runs the `delay`s of coroutines launched from `rememberCoroutineScope()`: a 300 ms delay had not fired after 200 ms and had after 400 ms *(checked)*, so grace, tendency retries and the lock can be tested in virtual time (with `ComposeClock(scope) { mainClock.currentTime }`).
- Pointer: `onNode(hasTestTag(tag), useUnmergedTree = true).performMouseInput { moveTo(p); click(p) }` (`click` is an extension: `import androidx.compose.ui.test.click`). Touch: `performTouchInput { down(center); advanceEventTime(700); up() }`. Keys: `performKeyInput { pressKey(Key.Tab) }`; the focused node: `onNode(isFocused())`.
- What the probes covered: hover over a link reaches the text's `pointerInput` and maps to its tag; a click and Tab + Enter reach the `LinkInteractionListener`; Exit-before-Enter order; preview key handling; intrinsic sizing; focus order; long-press swallowing a click; popup event routing.
- Timing feel and real windows are compared by hand with the web example (`npm run demo`), as [§11](../../docs/algorithms.md#11-testing-with-testcases) describes.

## 13. The example to build, limitations

**Example**: the same screen as `frameworks/web/example`, in `application { Window(onCloseRequest = ::exitApplication, title = "DeepTip", state = rememberWindowState(width = 1100.dp, height = 760.dp)) { DeepTipHost(state) { … } } }`: a HUD row with `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `delay = 0`, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the window edges, a page text with terms, settings (delay, lock, buttons, hints) and the encyclopedia. Glossaries: `glossary/core` and `glossary/example`.

**Limitations compared with the web reference**:

- Windows live inside the app window (the window is the viewport, as the browser viewport is on the web).
- F1 or `?` on a focused **term** cannot be supported: which `LinkAnnotation` has the focus is not observable; Enter follows a focused term.
- Gamepad ([§9.4](../../docs/algorithms.md#94-gamepad)): no API in Compose Desktop; it needs a native library.
- Reduced motion and forced colours: Compose Desktop offers no query; provide theme and animation options.
- Touch only where the platform reports `PointerType.Touch`.

## 14. Checklist

1. Port and test `flatten`, `parseText`, `computePlacement` against `test/cases` (sections 11, 12.1).
2. `Glossary` with layers, chain, `$ui` labels and live values; validate the JSON files with `tools/deeptip-check.mjs`.
3. `Engine` with `Clock` and `Host` (12.2), then `DeepTipHost`, `TipLayer`, `TermText`, `TipWindowContent`, `Modifier.deepTip` (sections 5–8) with UI tests (12.3).
4. The example; compare with the web example by hand; then list the framework with its state in the main README.
