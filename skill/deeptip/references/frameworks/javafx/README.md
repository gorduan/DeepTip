# DeepTip in JavaFX: build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a JavaFX application, JavaFX 21 or newer, no further dependencies; it was checked with 27.0.1 and says where an API may be missing in older versions.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for JavaFX. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Everything that is plain Java (JSON reader, glossary, parser, placement, the engine with its `Host` and `Clock`) is the same as in the [Swing guide](../java-swing/README.md), which this guide links instead of repeating. Statements marked *(checked)* were verified on 2026-10-29 with **OpenJFX 27.0.1 on JDK 25.0.1** (Windows 11) on JavaFX's headless glass platform (`-Dglass.platform=headless -Dprism.order=sw`, a 1000 × 1000 screen at scale 1, nothing visible), with probe programs and `javap` against the JavaFX jars; *(verify)* marks what could not be checked there (real screens, touch, Linux, macOS).

## Quick start

**Recognise the project:** `org.openjfx` dependencies (`javafx-controls`, often `javafx-fxml`) or the `org.openjfx.javafxplugin` Gradle plugin / `javafx-maven-plugin`, `requires javafx.controls;` in `module-info.java`, a class that `extends javafx.application.Application`, `.fxml` files.

1. Port `Json`, `Glossary`, `Markup` and `Placement` exactly as in the Swing guide (sections 10, 11) and pass the parity cases: `java -cp <classes> deeptip.ParityCases <DeepTip>/test/cases` (section 13.1).
2. Build `Engine` with `Clock` and `Host` as in the Swing guide and test it without a screen (sections 3 and 13.2).
3. Build `TermFlow`, `TipView`, `TipPopup`, `FxHost` and the public `DeepTip` (sections 4–8).
4. Copy `glossary/core/<locale>.json` to `deeptip/core/`; your own entries go to `deeptip/<locale>.json` (section 10).
5. Install DeepTip once per `Stage` on the JavaFX thread and mark nodes with the property `"deeptip"` (below).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```java
public final class Main extends Application {
  @Override public void start(Stage stage) {
    Button help = new Button("?");
    help.getProperties().put("deeptip", "deeptip.about");        // web: data-deeptip="deeptip.about"
    stage.setScene(new Scene(new StackPane(help), 480, 320));
    // options under their SPEC §7 names; sources: core first, yours after (section 10)
    DeepTip.install(stage, Map.of("locale", "en", "sources", List.of("deeptip/core/{locale}.json", "deeptip/{locale}.json")));
    stage.show();
  }
}
```

**Done when:** the parity run exits with 0 (24 of 24), resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without reaching your scene accelerators or a cancel button, the validator reports 0 errors.

## 1. Parts to build

| Part | Does | JavaFX types |
|---|---|---|
| `Json`, `Glossary`, `Markup`, `Placement` | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement), identical to the [Swing parts](../java-swing/README.md#1-parts-to-build) | no |
| `Engine` | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock) and the logic of [§9](../../docs/algorithms.md#9-input), against the `Host` and `Clock` interfaces of the [Swing guide](../java-swing/README.md#3-data-structures) | no |
| `FxClock` | `Clock` on `PauseTransition` | `javafx.animation` |
| `FxHost` | implements `Host`: one `TipPopup` per window, anchors, focus, the event filters | yes |
| `TipView` | content of one window: header, body, "See also", hint, lock bar | `VBox` |
| `TermFlow` | renders the markup AST with terms | `TextFlow` with `Text` and `Hyperlink` children |
| `TipPopup` | the native window of one DeepTip window | `Popup` |
| `DeepTip` | public API: `install`, `mark`, `open`, `close`, `closeAll`, `pin`, `unpin`, `refresh`, `setLocale`, `text`, `index` | yes |

Keep `Engine` free of JavaFX types; with a fake clock and a fake host every invariant and timer is a plain unit test.

## 2. SPEC concept → JavaFX primitive

| SPEC | JavaFX |
|---|---|
| Glossary files (§2.1) | the Swing guide's `Json` reader (no JSON parser ships with the JDK or JavaFX); object order must be kept |
| Marked UI element (`data-deeptip`) | `node.getProperties().put("deeptip", "demo.realm")`; optional `"deeptip.delay"` (ms) and `"deeptip.place"` (`"top,bottom"`); in FXML: `<properties deeptip="demo.realm"/>` inside the element *(verify)* |
| State hooks (`data-dt-open`, `data-dt-arming` + `--dt-delay`) | pseudo-classes on the anchor: `node.pseudoClassStateChanged(PseudoClass.getPseudoClass("dt-open"), true)` and `dt-arming`, plus the delay in `getProperties()`; the host styles `.button:dt-arming` or reacts with a listener |
| Window (popover in the top layer) | `Popup` (a `PopupWindow`): its own native window, always above its owner, coordinates in screen pixels (section 4.1) |
| Stacking order | ownership: roots are shown with the anchor's `Window` as owner, children with the parent's `Popup` *(checked: `child.getOwnerWindow()` is the parent popup; hiding the parent hides the child)* |
| Overlay alternative | a `Pane` layer above the app root in a `StackPane`, windows `relocate()`d in it: one scene, no extra windows, the stage is the viewport |
| Term (a real button) | a `Hyperlink` inside a `TextFlow` (focusable, `AccessibleRole.HYPERLINK`, fires on Enter and Space), or a styled `Text` run (wraps inside the term); section 4.2 |
| Preview / pinned roles (§6) | `AccessibleRole.TOOLTIP` while a preview, `AccessibleRole.DIALOG` when pinned (both exist in 27.0.1 *(checked with javap)*) |
| `delay`, `linkDelay`, `closeDelay`, `lockAfter`, retries | `PauseTransition` (section 7.4) |
| Pointer over / out at document level | event filters for `MouseEvent.ANY` on every scene: the app's and each popup's (section 7.1) |
| Element under the pointer | `e.getPickResult().getIntersectedNode()` walked up with `getParent()` |
| Boxes of windows and anchors | screen coordinates: `node.localToScreen(node.getBoundsInLocal())`; a popup's content node the same way |
| Viewport | `Screen.getScreensForRectangle(box).get(0).getVisualBounds()` (taskbar excluded), section 6 |
| Keyboard in the capture phase | an event filter on the `Stage` (window filter): it runs before scene filters, the focused node, accelerators and cancel buttons (section 7.3) |
| Focus | `scene.getFocusOwner()`, `node.requestFocus()`; each popup has its own scene and focus owner |
| Anchor removed by the host (§4.5) | `node.sceneProperty()` becomes `null` |
| Theme (`--dt-*`) | a stylesheet with the values of section 5, style classes on the views |
| Light/dark, reduced motion | `Platform.getPreferences().getColorScheme()` and `reducedMotionProperty()` (the platform preferences API; both in 27.0.1 *(checked with javap)*, older versions may lack them) |
| Touch | `TouchEvent`s and mouse events with `isSynthesized()` (section 7.2) |

## 3. Data structures

Use the window record `Tip`, the `Term`, `Sample`, `Cancel`, `Clock` and `Host` types of the [Swing guide](../java-swing/README.md#3-data-structures) unchanged, with `TipPopup view` in `Tip`, and `Term(TermFlow view, int index, String key)`. The JavaFX clock:

```java
final class FxClock implements Clock {
  public long now() { return System.nanoTime() / 1_000_000; }
  public Cancel after(long ms, Runnable task) {
    PauseTransition p = new PauseTransition(Duration.millis(Math.max(0, ms)));
    p.setOnFinished(e -> task.run());
    p.play();
    return p::stop;                         // stop() before the end: onFinished never runs
  }
}
```

*(checked)*: `Duration.ZERO` still fires (on the next pulse, 8 ms later); a stopped transition stays silent; a 90 ms transition restarted from its own handler fired every 95–108 ms, always on the JavaFX thread. Animations advance on pulses (about every 16 ms), so timers are that coarse; compare against `now()`.

## 4. Windows and terms

### 4.1 The window: `Popup`

```java
final class TipPopup extends Popup {
  TipPopup(TipView view) {
    getContent().add(view);
    setAutoHide(false);                         // DeepTip closes windows itself (§3.5)
    setHideOnEscape(false);                     // default true: Esc would hide the OLDEST popup, unseen by anyone
    setAutoFix(false);                          // default true: JavaFX would move it; DeepTip has placed it
    setAnchorLocation(AnchorLocation.CONTENT_TOP_LEFT);   // (x, y) = the view's corner, not the shadow's
  }
}
// roots: popup.show(anchorNode.getScene().getWindow(), x, y); children: child.show(parentPopup, x, y)
```

Defaults and effects *(all checked)*: a new `Popup` has `autoHide=false`, `hideOnEscape=true`, `consumeAutoHidingEvents=true`, `autoFix=true`, `anchorLocation=WINDOW_TOP_LEFT`. With `hideOnEscape` on, `Esc` hid the oldest root popup and neither the owner's filters nor its focused field saw that key. With `WINDOW_TOP_LEFT`, a view with a drop shadow landed 29 px right and 19 px below `(x, y)` (the window includes the shadow); `CONTENT_TOP_LEFT` put the view's corner exactly at `(x, y)`. `autoFix` moved a popup shown at (950, 950) back inside the screen. Show roots with the owner **window**: `show(ownerNode, x, y)` hides the popup as soon as that node leaves its scene, `show(ownerWindow, x, y)` keeps it, which [§4.5](../../docs/algorithms.md#45-anchors-that-disappear) needs for pinned roots.

Styles: the popup's scene gets a copy of the owner scene's stylesheets (a rule of the owner styled popup content *(checked)*), but not the owner's `Scene.Preferences` (colour scheme) *(checked)*; put the theme into style classes (section 5). Closing: `popup.hide()`; children are hidden with their owner anyway, but close the subtree through the engine so every child's `onClose` runs ([§4.2](../../docs/algorithms.md#42-closew-focusback--false)).

### 4.2 Terms: `TextFlow`

Render the AST ([§3](../../docs/algorithms.md#3-rendering-the-ast)) into one `TextFlow` per block (a `p`), and per list item an `HBox` of a bullet `Text` and a `TextFlow`; the blocks go into a `VBox` with spacing 7. `Text` nodes never interpret their string, so glossary text cannot become markup.

| AST node | Node |
|---|---|
| `text` | `Text` (style class `dt-text`) |
| `br` | `Text("\n")` |
| `b`, `i`, nested | `Text` with `-fx-font-weight: bold` / `-fx-font-style: italic` (style classes `dt-b`, `dt-i`) |
| `code` | `Text`, class `dt-code` (monospace, 0.92 em) |
| `var` | `Text`, class `dt-var` (bold) |
| link to the window's own key | `Text`, class `dt-b` |
| link to a missing key | `Text`, class `dt-missing` (not interactive) |
| term | `Hyperlink(label)` with class `dt-term` and `getProperties().put("deeptip.term", n)`; or a `Text` run with the same property (below) |

**`Hyperlink` terms** are real buttons: focusable, `AccessibleRole.HYPERLINK`, `setOnAction` fires on a click, on Enter and on Space. In a `TextFlow` a `Hyperlink` is one unit that never breaks across lines, one line high, and its text sits on the line's baseline within 1 px *(checked)*; remove Modena's padding (2 px 3 px) and border with the style of section 5 *(checked)*, and reset the visited colour (`setVisited(false)` after each click, or style `:visited` like the normal state). Make terms of previews **not** focus-traversable (`setFocusTraversable(false)`), and turn it on only when a window was opened by keyboard: a focused node inside a popup receives the keys that the user types into the owner window (pitfall 5).

**`Text` terms** wrap inside a long term and look exactly like the web, but focus and screen-reader support must be emulated (as with the Swing guide's alternative renderer). Picking works per glyph area: on the term's second line the pick result is the term's `Text`, left of it on its first line (inside the term's bounding box) it is the preceding run *(checked)*.

**Term under a point**: take it from the mouse event's pick result (section 7.1): walk up from `getIntersectedNode()` to the first node with the property `"deeptip.term"` (a `Hyperlink`'s pick lands on a node inside it *(checked)*). `TextFlow.getHitInfo(point)` returns the nearest character also far outside the text *(checked)*; an embedded `Hyperlink` counts as one character *(checked)*.

**Term boxes** (page terms, focus ring): `flow.getRangeShape(start, end, false)` returns one rectangle per line of a wrapped `Text` term *(checked)*; `getHitInfo`, `getRangeShape` and `getUnderlineShape` are in 27.0.1 next to the older `hitTest`, `rangeShape` and `underlineShape` *(checked with javap; for older versions verify which exist)*; for a `Hyperlink`, its `localToScreen(getBoundsInLocal())`. `TextFlow.getUnderlineShape(start, end)` gives the underline path, if you want to draw the web's dotted underline yourself with a dashed `Path`.

### 4.3 Window content (`TipView`)

`VBox` with style class `dt-win`, content order as in [§3](../../docs/algorithms.md#3-rendering-the-ast): header `HBox` [title `Label` (`HBox.setHgrow(title, Priority.ALWAYS)`), fallback badge `Label`, pin `ToggleButton`, close `Button`, both 26 × 26 with the `SVGPath`s `PIN_PATH` and `CLOSE_PATH` of `deeptip.js` as graphic (`-fx-fill: transparent; -fx-stroke: …; -fx-stroke-width: 2`)], the body `VBox` inside a `ScrollPane` (`setFitToWidth(true)`, horizontal bar `NEVER`), the "See also" `TextFlow`, the hint `Label` (hidden and `managed=false` when pinned), and the lock bar: a 2 px `Region` with a `Scale(0, 1, 0, 0)` transform (pivot at the left edge) whose `x` a `Timeline` animates from 0 to 1.

## 5. Look: the values of `deeptip.css`

```css
.dt-win { -fx-background-color: #1b1e24; -fx-border-color: #3b414d; -fx-border-width: 1;
          -fx-background-radius: 8; -fx-border-radius: 8; -fx-font-size: 14px;
          -fx-effect: dropshadow(gaussian, rgba(0,0,0,0.3), 30, 0, 0, 10); }
.dt-win.dt-pinned { -fx-border-color: #58a6ff; }
.dt-win TextFlow { -fx-line-spacing: 7; }              /* 14 px × 1.5 = 21 px lines */
.dt-text, .dt-b, .dt-i, .dt-var { -fx-fill: #e6e8ec; }  /* Text uses -fx-fill, not -fx-text-fill */
.dt-term { -fx-padding: 0; -fx-border-width: 0; -fx-text-fill: #6cb6ff; -fx-underline: true; }
.dt-term:hover { -fx-text-fill: #9ccfff; }
.dt-term:visited { -fx-text-fill: #6cb6ff; }
.dt-term.dt-open { -fx-background-color: rgba(108,182,255,0.16); }
.dt-missing { -fx-fill: #e6e8ec; -fx-underline: true; }
```

*(checked)*: `-fx-font-size` on the `TextFlow` reaches its `Text` children, `Text` takes its colour from `-fx-fill`, `-fx-underline` works on `Text` runs and `-fx-line-spacing` on `TextFlow`, and the `.dt-term` rule removes Modena's `Hyperlink` padding. The light theme is the same with the light column:

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border, hint line | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % | same |
| button hover background | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.09)` |
| missing link | `#dd3333` | `#dd3333` |

| Measure | Value |
|---|---|
| width | natural width, at least 240, at most 384; height at most 480, the body scrolls |
| font | 14 px, line height 1.5 (`-fx-line-spacing` 7 at 14 px); title bold; code monospace at 0.92 em; values bold |
| radius, border, shadow | 8, 1 px (pinned: accent), `dropshadow(gaussian, rgba(0,0,0,0.3), 30, 0, 0, 10)` |
| header | padding 6 6 2 12; buttons 26 × 26, icons 15 px, 2 px apart; badge 0.7 em, 1 px border, radius 3, padding 0 4 |
| body | padding 0 12 10; blocks 7 px apart; list indent 1.2 em |
| "See also" | padding 0 12 10, font 0.9 em, label at 70 % opacity |
| hint | padding 4 12 6, font 0.75 em, opacity 0.6, 1 px top border; hidden when pinned |
| flash | a 3 px accent ring for 0.6 s (a second `dropshadow` or the border), static with reduced motion |
| lock bar | 2 px at the bottom edge, accent colour, `scaleX` 0 → 1 over `lockAfter` |

JavaFX CSS has no dotted or wavy underline (`-fx-underline` is a boolean); draw it from `getUnderlineShape` if the exact look matters. Light or dark: `Platform.getPreferences().getColorScheme()` and its property; set the class `dt-light` or `dt-dark` on every view (popups do not inherit the owner's scene preferences, section 4.1).

## 6. Placement in screen coordinates

[§8](../../docs/algorithms.md#8-placement) works in a viewport whose origin is (0, 0). In JavaFX:

1. Target box `T` in screen coordinates: for a child the parent view's `localToScreen(getBoundsInLocal())`; for a root the anchor node's; for a page term its range boxes (section 4.2).
2. Viewport `V`: `Screen.getScreensForRectangle(T.getMinX(), T.getMinY(), T.getWidth(), T.getHeight())` (fall back to `Screen.getPrimary()` when the list is empty), then `getVisualBounds()`, the screen without the taskbar. JavaFX coordinates are logical pixels already; `getOutputScaleX()` only matters for pixel-exact drawing.
3. Size first: `view.applyCss(); view.layout();` natural width `w = clamp(view.prefWidth(-1), 240, 384)` (and at most `V.width - 16`): `prefWidth(-1)` is the unwrapped width and is **not** limited by `maxWidth`, so clamp it yourself *(checked: 605 for a one-line text)*; height `h = min(view.prefHeight(w), 480, V.height - 16)`, where `prefHeight(w)` gives the wrapped height *(checked)*.
4. `a = T` moved by `(-V.getMinX(), -V.getMinY())`; `p = computePlacement(size, a, sides, vp, 8)`; when `p.maxW` or `p.maxH` is set, `view.setPrefWidth`/`setMaxHeight` accordingly (the `ScrollPane` scrolls), measure again and compute with `[p.side]`.
5. `popup.show(owner, V.getMinX() + p.x, V.getMinY() + p.y)` the first time, `popup.setX/setY` afterwards (with `CONTENT_TOP_LEFT` these are the view's corner). Store the box.
6. Re-place every window that is not frozen, parents before children, after pin and unpin, after `refresh()`, when the owner stage moves or resizes (`xProperty`, `yProperty`, `widthProperty`, `heightProperty`), and when a root anchor moves inside its scene (a listener on `localToSceneTransformProperty()` and `boundsInLocalProperty()` *(verify for scrolling)*).

## 7. Events: exact order of operations

All code runs on the JavaFX Application Thread; call DeepTip from other threads with `Platform.runLater`.

### 7.1 Pointer: one filter per scene

Register on the owner scene and on the scene of every `TipPopup` (`popup.getScene()`):

```java
scene.addEventFilter(MouseEvent.ANY, this::mouse);   // filters run before the target's own handlers
```

**Resolve the hover triple** from `e.getPickResult().getIntersectedNode()`:

1. `win` = the open window whose popup scene is `e.getSource()`'s scene (ignore windows that are closing);
2. `link` = the first ancestor (including the node) with the property `"deeptip.term"`, as a `Term`, else `null`;
3. `trig` = if `win == null && link == null`: the first ancestor with the property `"deeptip"`, else `null`.

| Event | Steps |
|---|---|
| `MOUSE_MOVED` | 1. add a sample `(getScreenX(), getScreenY(), now)` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)); 2. resolve the triple; 3. if it differs from the previous triple: "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)) |
| `MOUSE_DRAGGED` | add a sample only |
| `MOUSE_EXITED` with target the `Scene` | if the screen point lies inside any showing window (`Window.getWindows()`), ignore it: the pointer moved into a popup or back; otherwise "on pointer leaving" (§6). *(checked: moving from the owner into a popup gave the owner `MOUSE_EXITED` with the point inside the popup, then `MOUSE_MOVED` at the popup scene)* |
| `MOUSE_PRESSED`, primary button | remember the target; "on pointer down" ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) with `touch = e.isSynthesized()` |
| `MOUSE_RELEASED`, primary button | on the remembered `Text` term: `follow(term, win, false)` ([§9.1](../../docs/algorithms.md#91-clicks)); elsewhere inside an unpinned window and not on a button or `Hyperlink`: pin when `clickInsidePins` |

Comparing triples reproduces the web's `pointerover`. Never consume these events: the host's controls keep working.

### 7.2 Buttons, hyperlinks, touch

- `Hyperlink` terms: `setOnAction(e -> follow(term, win, focus = lastActivationByKey))`; set `lastActivationByKey` in the stage key filter when Enter or Space is pressed on a focused term, clear it on any mouse press.
- Close `Button` → `close(t, focusBack = true)`; pin `ToggleButton` → `pinned ? unpin : pin`.
- Touch: mouse events made from touch have `isSynthesized() == true`; the long-press of [§9.2](../../docs/algorithms.md#92-pointer-down-touch) is an own `PauseTransition` started on `TouchEvent.TOUCH_PRESSED` over a marked node, cancelled on `TOUCH_MOVED` beyond 10 px and on `TOUCH_RELEASED`; swallow the following `MOUSE_CLICKED` and `ContextMenuEvent` while the swallow is active *(verify on a touch screen; headless has no touch)*.

### 7.3 Keyboard: one filter on the `Stage`

```java
stage.addEventFilter(KeyEvent.KEY_PRESSED, this::keyPressed);
stage.addEventFilter(KeyEvent.KEY_RELEASED, this::keyReleased);
stage.addEventFilter(KeyEvent.KEY_TYPED, this::keyTyped);   // "?" (layout independent) and hush
```

*(checked)*: without a consumer, `Esc` passed the stage filter, the scene filter, the focused `TextField`, the scene's handler and then fired the scene's cancel button, in this order; a stage filter that consumed `Esc` hid it from all of them and from scene accelerators; `F1` consumed there kept an `F1` accelerator quiet; `isShiftDown()` tells `Shift+Esc`. Open popups see a key **before** the stage: with `hideOnEscape=false` the order was child popup, parent popup, stage filter, scene filter, field, scene handler, so DeepTip popups must not consume keys themselves. An open `ComboBox` list (the app's own popup, `hideOnEscape` on) closed on `Esc` and the stage filter never saw that key; the next `Esc` reached it, like a browser closing an open `<select>` first *(checked)*.

| Event | Steps ([§9.3](../../docs/algorithms.md#93-keyboard)) |
|---|---|
| `KEY_PRESSED` `ESCAPE` | no windows → return. `repeat = escDown; escDown = true` (JavaFX has no repeat flag; a held key repeats `KEY_PRESSED` *(verify per platform)*). `isShiftDown()`, or `repeat` and `now - escAt >= 600` → close all, focus the root's anchor; else if not `repeat` → `escAt = now`, `close(newest(focusOwner), focusBack = true)`. `consume()`. |
| `KEY_RELEASED` `ESCAPE` | `escDown = false`; consume when the press was consumed |
| `KEY_PRESSED` `F6` with windows open | `consume()`; cycle the windows (Shift: backwards) |
| `KEY_PRESSED` `F1` | the focus owner is a term → `follow(term, its window, focus = true)`; a marked node (or ancestor) outside windows → open it pinned with focus (`via = "key"`); consume only when handled |
| `KEY_TYPED` `"?"` | ignore when the focus owner is a `TextInputControl` (it is typed text *(checked)*); else as `F1`, `consume()` |
| `KEY_TYPED`, printable, no shortcut modifier | `hush(marked ancestor of the focus owner)` |

The focus owner is the stage scene's `getFocusOwner()`, or the focused popup's when DeepTip holds the focus (section 7.5).

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); a `Timeline` only draws the bar |
| flash | `flash(w)` | 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)); no animation when `reducedMotion` is on |
| long press | `TOUCH_PRESSED` | open pinned (section 7.2) |

The engine owns the one-shot timers through `FxClock`; the views only animate.

### 7.5 Focus

- Opening by keyboard ([§9.5](../../docs/algorithms.md#95-focus)): make the window's terms focus-traversable, then `firstTerm.requestFocus()` inside the popup (without terms, the view with `setFocusTraversable(true)`); keys now go to the popup's focus owner first, which is what DeepTip wants while it has the focus.
- Previews opened by the pointer never hold a focused node: *(checked)* while a button inside a popup was focused, `Space` pressed in the owner's focused `TextField` fired that button and `Tab` moved the focus inside the popup, and the owner never saw either key; with non-traversable terms and the popup's root focused, `Tab` and `Space` reached the owner again.
- Closing returns the focus to the anchor if it was inside the closed subtree: `anchor.requestFocus()`, for a term its `Hyperlink`.
- `F6` cycles: focus the first term (or the view) of the next window; back in the stage: `stage.requestFocus()` and the anchor.

### 7.6 Anchors that move or disappear

- Root anchors: listen to `sceneProperty()` while the window is open; `null` (removed) or `!isVisible()` → [§4.5](../../docs/algorithms.md#45-anchors-that-disappear): previews close, a pinned root freezes at its last box.
- Term anchors: re-rendering a `TermFlow` creates new nodes; `refresh()` re-attaches children to the term with the same key and occurrence ([§4.6](../../docs/algorithms.md#46-refresh)).

## 8. Accessibility

- Previews: `view.setAccessibleRole(AccessibleRole.TOOLTIP)`; pinned windows: `AccessibleRole.DIALOG` (non-modal); `setAccessibleText(title)`, `setAccessibleHelp(plain body)`.
- `Hyperlink` terms are announced as links with their text; for `Text` terms set `setAccessibleRole(AccessibleRole.HYPERLINK)` and `setAccessibleText(label)` and handle focus yourself.
- While a root window is open, set the anchor's `setAccessibleHelp(plain body)` (the counterpart of `aria-describedby`) and restore the old value on close.
- Reduced motion: `Platform.getPreferences().reducedMotionProperty()` (no slide, no flash; the lock bar still runs); high contrast: the platform's colours through `Platform.getPreferences()` (`getBackgroundColor()`, `getForegroundColor()`, `getAccentColor()`).

## 9. Live values, locales, refresh

As in the [Swing guide](../java-swing/README.md#8-live-values-locales-refresh): `vars` as a map of values, `Supplier`s or `Function<String, ?>`, or one `BiFunction`; `setLocale` loads the missing files of the new chain, then `refresh()` re-renders every open view, every page `TermFlow` and every index ([§4.6](../../docs/algorithms.md#46-refresh), [§12](../../docs/algorithms.md#12-encyclopedia)). JavaFX properties make the wiring short: `gold.addListener((o, a, b) -> deepTip.refresh())`.

## 10. Loading the glossary (JSON)

As in the [Swing guide](../java-swing/README.md#9-loading-the-glossary-json): UTF-8, strip a leading byte order mark, `sources` as templates with `{locale}` loaded per locale of the chain in template order (core first), objects in `LinkedHashMap`, a missing file is a warning. In a modular application, resources inside your module are read with `getClass().getResourceAsStream("/deeptip/en.json")`; a resource in another module's package must be opened to you (`opens deeptip;` in its `module-info.java`).

## 11. Porting the pure functions

Exactly the Swing guide's Java: [Porting the pure functions](../java-swing/README.md#10-porting-the-pure-functions-java-pitfalls-checked) lists the eight differences to JavaScript (`split(regex, -1)`, the JavaScript whitespace set, U+2028/U+2029, bounds checks, `findClose`, `link.text`, `double` placement, flatten rules). *(checked: the same Java port passed 24 of 24 cases on JDK 25.0.1)*

## 12. JavaFX pitfalls

1. **`hideOnEscape` is on by default**: `Esc` hides the oldest popup and nothing else sees it *(checked)*. Turn it off on every DeepTip popup.
2. **`anchorLocation` defaults to the window corner**, which includes the content's shadow; use `CONTENT_TOP_LEFT` *(checked)*.
3. **`autoFix` moves popups** that touch the screen edge *(checked)*; DeepTip has placed them already.
4. **`show(ownerNode, …)` hides the popup when the node leaves the scene** *(checked)*; use the owner window for roots.
5. **Popups get keys before the owner**: a focused node in a popup takes `Space` and `Tab` typed into the owner's focused field *(checked)*. Previews must not hold a focused node.
6. **Popup scenes copy the owner's stylesheets, not its `Scene.Preferences`** *(checked)*: theme by style class.
7. **`TextFlow.getHitInfo` never fails** *(checked)*: confirm with picking or range boxes.
8. **A `Hyperlink` in a `TextFlow` never wraps** and brings Modena's padding and visited colour *(checked: one unit; padding removed by CSS)*.
9. **`Text` is coloured with `-fx-fill`**, labels and hyperlinks with `-fx-text-fill` *(checked)*.
10. **`prefWidth(-1)` ignores `maxWidth`** *(checked)*: clamp the natural width yourself.
11. **Moving into a popup sends `MOUSE_EXITED` to the owner scene** *(checked)*: test `Window.getWindows()` before treating it as leaving the application.
12. **Threading**: JavaFX nodes belong to the JavaFX Application Thread; timers from `java.util.Timer` or other threads must go through `Platform.runLater`.
13. **Headless key tests**: after a popup hid itself, the headless platform delivered later key presses to another popup window; fire keys with `Event.fireEvent(focusOwner, keyEvent)` in tests (the real dispatch chain with the stage's popup redirector) instead *(checked)*.

## 13. Testing

### 13.1 Parity cases

Run the Swing guide's runner ([Parity cases](../java-swing/README.md#111-parity-cases)) on the same classes; no JavaFX is needed. *(checked: 24 of 24)*

### 13.2 Behaviour, without a screen

- Engine tests with a fake `Clock` and a fake `Host`, as in the [Swing guide](../java-swing/README.md#112-behaviour).
- JavaFX parts: the headless glass platform of current JavaFX releases (27.0.1 here; from which release on: *verify*) runs everything without a display: `java --module-path <javafx jars> --add-modules javafx.controls -Dglass.platform=headless -Dprism.order=sw …` (in Gradle/Maven as JVM arguments of the test task). Stages and popups show on a 1000 × 1000 screen at scale 1; `Platform.startup(…)`, build the scene, `stage.show()`, then fire events with `Event.fireEvent(target, event)` and assert on the dispatch log, layout (`applyCss()`, `layout()`, `prefHeight(w)`), picks and popup positions *(all probes of this guide ran this way)*. Older JavaFX versions need TestFX's Monocle instead *(verify)*.

### 13.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 14. The example to build

The same screen as `frameworks/web/example`: a `Stage` with a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `"deeptip.delay"` = 0, a language `ComboBox` (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) in a `BorderPane`/`AnchorPane` to test placement at the screen edges, a page text with terms (`TermFlow`), settings (delay, lock, buttons, hints) and the encyclopedia (a `TextField` filter over `TermFlow` rows, sorted with `Collator.getInstance(locale)` at `Collator.PRIMARY`). Glossaries: `../../glossary/core/{locale}.json`, then `../../glossary/example/{locale}.json`.

## 15. Limitations compared with the web reference

- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)) and **vibration**: no JavaFX API; poll a native library (SDL, XInput) in an `AnimationTimer` if needed.
- **Touch**: events exist (`TouchEvent`, synthesized mouse events), but long-press, swallowing and the swipe must be built and checked on a device.
- **Dotted and wavy underlines**: not in JavaFX CSS (section 5).
- **Wayland**: popups are separate native windows; their positioning depends on the platform *(verify)*.

## 16. Checklist

1. `Json`, `Glossary`, `Markup`, `Placement`, `Engine` from the Swing guide; 24 of 24 parity cases (sections 11, 13.1).
2. `FxClock`, `TermFlow`, `TipView`, `TipPopup` with `hideOnEscape`, `autoFix` off and `CONTENT_TOP_LEFT` (section 4).
3. Mouse filters on every scene, the key filter on the stage, focus rules for popups (section 7).
4. Accessibility roles, theme classes, reduced motion (sections 5, 8).
5. Headless tests (section 13.2), the example (section 14), a comparison with the web example by hand; then list the framework with its state in the main README.
