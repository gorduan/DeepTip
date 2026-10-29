# DeepTip in Java Swing: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth) in a Java Swing application, Java 17 or newer, no dependencies required.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Swing. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract. Statements marked *(checked)* were verified with headless probe programs on JDK 25.0.1 (Windows 11, 2026-10-29); the rest follows the JDK documentation.

## 1. Parts to build

| Part | Does | Swing types |
|---|---|---|
| `Json` | reads glossary files and test cases into ordered maps | no |
| `Glossary` | [§1](../../docs/algorithms.md#1-data): flatten, layers per locale, chain, `entry(key)`, `label(name)`, live values | no |
| `Markup` | [§2](../../docs/algorithms.md#2-markup-parser): `parseText` → blocks, `collectRefs` | no |
| `Placement` | [§8](../../docs/algorithms.md#8-placement): `computePlacement` | no |
| `Engine` | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock) and the logic of [§9](../../docs/algorithms.md#9-input): window tree, hot set, grace, tendency, arming, lock, Esc/F6 | no: talks to a `Host` interface and a `Clock` |
| `SwingHost` | implements `Host`: one `JWindow` per window, anchors, focus, the global listeners | yes |
| `TipView` | content of one window: header, body, "See also", hint, lock bar, flash | `JPanel` |
| `TermView` | renders the markup AST with terms | `JEditorPane` subclass |
| `DeepTip` | public API: `install`, `mark`, `open`, `close`, `closeAll`, `pin`, `unpin`, `refresh`, `setLocale`, `text`, `index` | yes |

Keep `Engine` free of Swing types. `new JWindow()` throws `HeadlessException` in a headless JVM *(checked)*, but the engine with a fake clock and a fake host runs anywhere, so every invariant and timer can be unit-tested in CI (section 11).

## 2. SPEC concept → Swing primitive

| SPEC | Swing |
|---|---|
| Glossary files (§2.1) | No JSON parser ships with the JDK. Write a small reader (objects into `LinkedHashMap`, arrays into `ArrayList`, numbers as `double`) or use Gson/Jackson; object order must be kept (section 9). |
| Marked UI element (`data-deeptip`) | `component.putClientProperty("deeptip", "demo.realm")`; optional `"deeptip.delay"` (milliseconds) and `"deeptip.place"` (`"top,bottom"`). |
| State hooks (`data-dt-open`, `data-dt-arming` + `--dt-delay`) | Client properties `"deeptip.open"` (`Boolean.TRUE` or `null`) and `"deeptip.arming"` (delay in ms or `null`). `putClientProperty` fires a `PropertyChangeEvent` named after the key, so the host can paint a rest-progress bar or hide its own tooltip while a window is open. |
| Window (popover in the top layer) | `JWindow` owned by the parent DeepTip window (children) or by the anchor's window (roots), section 4.1. |
| Stacking order | Ownership: an owned window always stays above its owner, so a child stays above its parent; `toFront()` when focusing. |
| Term (a real button) | `<a href="dt:N">` in a `JEditorPane` with `HTMLEditorKit`, section 4.2. |
| Preview / pinned roles (§6) | Accessible role of the content panel: `AccessibleRole.TOOL_TIP` while a preview, `AccessibleRole.DIALOG` when pinned (override `getAccessibleRole()` in its `AccessibleJPanel`). |
| `delay`, `linkDelay`, `closeDelay`, `lockAfter`, retries | One-shot `javax.swing.Timer` (`setRepeats(false)`), fires on the event dispatch thread. |
| Pointer over / out at document level | `Toolkit.getDefaultToolkit().addAWTEventListener(l, AWTEvent.MOUSE_EVENT_MASK \| AWTEvent.MOUSE_MOTION_EVENT_MASK)`, section 7.1. |
| Pointer samples for the tendency | `MouseEvent.getXOnScreen()`, `getYOnScreen()`, time `System.nanoTime() / 1_000_000`. |
| Boxes of windows and anchors | Screen coordinates: `Window.getBounds()`; `Component.getLocationOnScreen()` + `getSize()`; a term's box from `modelToView2D` + `SwingUtilities.convertPointToScreen`. |
| Viewport | Usable area of the screen that contains the target: `GraphicsConfiguration.getBounds()` minus `Toolkit.getScreenInsets(gc)` (taskbar), section 6. |
| Keyboard in the capture phase | `KeyboardFocusManager.getCurrentKeyboardFocusManager().addKeyEventDispatcher(d)`: runs before the focused component and its `InputMap` bindings; returning `true` consumes the event. Section 7.3. |
| Focus | `KeyboardFocusManager.getFocusOwner()`; `requestFocus()` may switch windows, `requestFocusInWindow()` only works inside the focused window. |
| Anchor removed by the host (§4.5) | `HierarchyListener` on root anchors: on any `PARENT_CHANGED`, `DISPLAYABILITY_CHANGED` or `SHOWING_CHANGED` event test `anchor.isShowing()` (removing a component reports `PARENT_CHANGED` *(checked)*). |
| Re-place on scroll and window moves | `AncestorListener.ancestorMoved` on root anchors (fires when the component or any ancestor moves, also when a `JViewport` scrolls *(checked)*), `ComponentListener` on the anchor's window. |
| Flash, lock bar, rest progress | `repaint()` driven by a repeating `javax.swing.Timer` of about 16 ms. |
| Encyclopedia (§12) | `JTextField` + `DocumentListener` filter over rows of `TermView`; sort with `Collator.getInstance(locale)` at strength `Collator.PRIMARY` (case- and accent-insensitive like `Intl.Collator` with sensitivity "base"). |
| Theme (`--dt-*`) | One `Theme` object holding the tokens of section 5. |
| Touch, gamepad | Not available in Swing, see section 13. |

## 3. Data structures

```java
final class Tip {                                    // window record, algorithms §4
  final int id; final String key; final Tip parent; final String via;
  Object anchor;                                     // JComponent (UI element) or Term (term in a TermView)
  final Set<Tip> children = new LinkedHashSet<>();   // insertion order
  boolean pinned, frozen;
  Cancel closeTimer;                                 // handle from the Clock, null when idle
  Rectangle rect;                                    // last placed box, screen coordinates
  TipWindow view;                                    // null in engine tests
}
record Term(TermView view, int index, String key) {} // identity: the same TermView instance + index
record Sample(int x, int y, long t) {}
interface Cancel { void cancel(); }
interface Clock { long now(); Cancel after(long ms, Runnable task); }
```

Engine state: `List<Tip> wins` (oldest first, which is also the stacking order), `hover` = (`Tip win`, `Term link`, `JComponent trig`), `Set<Tip> hot`, `pending` = (`Object el`, `Cancel timer`), `ArrayDeque<Sample> samples`, `Object quiet`, `Tip lockWin` with its `Cancel`, `boolean escDown`, `long escAt`, `int seq`.

The `Host` interface is everything the engine needs from Swing:

```java
interface Host {
  String keyOf(Object anchor);                 // client property "deeptip" or Term.key
  Long ownDelay(Object trig);                  // "deeptip.delay" or null
  List<String> ownSides(Object trig);          // "deeptip.place" or null
  boolean connected(Object anchor);            // still showing / term still in its view
  void opened(Tip t); void closed(Tip t);      // create + place + show, hide + dispose
  void stateChanged(Tip t);                    // pinned look, roles, hint line; then re-place
  void flash(Tip t); void lockBar(Tip t, long ms);           // ms 0 stops the bar
  void arming(Object trig, long ms);           // ms < 0 ends the rest progress
  void anchorOpen(Object anchor, boolean open);
  Rectangle box(Tip t);                        // current screen box (tendency)
  void focusWindow(Tip t); void focusAnchor(Object anchor); boolean focusInside(Tip t);
  Object rebind(Tip child);                    // §4.6: term of the same key in the re-rendered parent
}
```

The Swing clock:

```java
final class SwingClock implements Clock {
  public long now() { return System.nanoTime() / 1_000_000; }
  public Cancel after(long ms, Runnable task) {
    javax.swing.Timer t = new javax.swing.Timer((int) Math.max(0, ms), e -> task.run());
    t.setRepeats(false);
    t.start();
    return t::stop;
  }
}
```

## 4. Windows and terms

### 4.1 The window: `JWindow`

```java
final class TipWindow extends JWindow {
  TipWindow(Window owner, TipView view) {      // owner: the parent's TipWindow, else SwingUtilities.getWindowAncestor(anchor)
    super(owner);
    setType(Window.Type.POPUP);
    setFocusableWindowState(true);             // keyboard users can Tab inside
    setAutoRequestFocus(false);                // showing a preview never takes the focus
    if (translucent) setBackground(new Color(0, 0, 0, 0)); // TipView paints the rounded box
    setContentPane(view);
  }
}
```

- `translucent` = `GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice().isWindowTranslucencySupported(GraphicsDevice.WindowTranslucency.PERPIXEL_TRANSLUCENT)`; without it paint square corners.
- Opening: build the `TipView`, place it (section 6), then `setVisible(true)`. Closing: `setVisible(false)`, `dispose()`.
- A `JWindow` can only take the focus while its owning `Frame` or `Dialog` is showing, and changing `setFocusableWindowState` on a visible window may take effect late on some platforms, so decide focusability when creating the window.
- Alternative: lightweight windows in the root pane's `JLayeredPane.POPUP_LAYER`. One coordinate space and no window activation, but the windows cannot leave the frame (the frame becomes the viewport). Use `JWindow` when windows should behave like native tooltips.

### 4.2 Terms: `TermView` on `JEditorPane`

Render the AST ([§3](../../docs/algorithms.md#3-rendering-the-ast)) to an HTML string. HTML is only the toolkit's medium: every text from the glossary is escaped (`&` `<` `>` `"`), so glossary text can never become markup *(checked)*.

| AST node | HTML |
|---|---|
| `p` | `<p>…</p>` (the last block gets `class="last"`: Swing CSS has no `:last-child`) |
| `ul` | `<ul><li>…</li></ul>` |
| `text` | escaped text |
| `br` | `<br>` |
| `b`, `i` | `<b>`, `<i>` |
| `code` | `<code>` + escaped text |
| `var` | `<span class="var">` + escaped value |
| link to the window's own key | `<b>` + label |
| link to a missing key | `<span class="missing">` + label (not a link) |
| term | `<a href="dt:N">` + label, `N` = index of the term in this view; keep `keys[N]` beside the view |

Setup, in exactly this order *(checked)*:

```java
setEditable(false);
setMargin(new Insets(0, 0, 0, 0));                            // the default margin is 3 px
putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, Boolean.TRUE);
setFont(theme.font);                                           // body text uses the component font
setEditorKit(new HTMLEditorKit());                             // creates the document right away
StyleSheet css = ((HTMLDocument) getDocument()).getStyleSheet();  // rules per document
css.addRule("p { margin-top: 0; margin-bottom: 7px; } .last { margin-bottom: 0; }");
css.addRule("ul { margin-top: 0; margin-bottom: 7px; margin-left: 16px; }");  // default indent is 50 px
css.addRule("a { color: #0b69d4; text-decoration: underline; }");
css.addRule("code { font-family: monospace; } .var { font-weight: bold; } .missing { color: #d33; }");
setText(html);                                                 // later setText calls keep the same document and rules
```

Never add rules to `HTMLEditorKit.getStyleSheet()` and never call `kit.setStyleSheet(...)`: that sheet is shared by every `HTMLEditorKit` in the JVM *(checked)*, so the host's own HTML panes would change. Rules added to the kit after `setEditorKit` do not reach the already created document *(checked)*.

**Term under a point** (used by the global mouse listener):

1. `int pos = viewToModel2D(p)`. It always returns the nearest offset, also far away from any text *(checked)*, so accept it only when `modelToView2D(pos)` (extended to `pos + 1`) contains `p`.
2. `AttributeSet a = (AttributeSet) doc.getCharacterElement(pos).getAttributes().getAttribute(HTML.Tag.A)`; `String href = (String) a.getAttribute(HTML.Attribute.HREF)` → `"dt:N"` *(checked)*.

**Term box**: union of `modelToView2D(i)` over the term's character range, converted to screen coordinates. Needed as the anchor of page terms and for the focus ring.

**Hyperlink events**: `JEditorPane` fires `HyperlinkEvent` `ENTERED`, `EXITED` and `ACTIVATED` for these links *(checked)*. `getURL()` is `null` because `dt:` is no URL protocol; use `getDescription()` (the raw `href`) and `getSourceElement()` (start and end offset) *(checked)*. The global mouse listener runs before the view's own listeners (section 7.1), so take hover from the hit test above, not from `ENTERED`/`EXITED`; `ACTIVATED` may be used for clicks if you do not use the click procedure of section 7.1 (use one of the two, not both).

**Open term and keyboard focus** (`data-dt-open`, focus ring): `getHighlighter().addHighlight(start, end, painter)` on the term's range paints behind the text *(checked)*; keep the returned tag and remove it when the window closes or the focus moves. Hover colour is optional: `((HTMLDocument) getDocument()).setCharacterAttributes(start, length, attrs, false)` with a `StyleConstants.Foreground`.

**Keyboard**: Tab is a focus-traversal key of the pane, and `HTMLEditorKit`'s own link navigation is bound to Ctrl+T, Ctrl+Shift+T and Ctrl+Space in Metal with its current link kept private *(checked)*. So handle terms yourself:

1. `setFocusTraversalKeysEnabled(false)`; bind Tab and Shift+Tab in the `InputMap` to move an own `focusIndex` through the terms; past the last term call `transferFocus()`, before the first `transferFocusBackward()`.
2. Enter and Space on a focused term: `follow(term, tip, focus = true)` ([§9.1](../../docs/algorithms.md#91-clicks)).
3. On `focusGained`: `FocusEvent.getCause() == FocusEvent.Cause.TRAVERSAL_BACKWARD` → last term, else the first; paint the focus with a highlight; on `focusLost` remove it.
4. Make the view focusable only when it has terms.

**Accessibility**: the pane exposes `AccessibleHypertext` (role `TEXT`, one `AccessibleHyperlink` per term) *(checked)*. On Windows, screen readers reach Swing through the Java Access Bridge (`jabswitch -enable`).

**Alternative renderer** (full control over the look, more code, own `AccessibleContext`): one `AttributedString` per paragraph and list item with `TextAttribute.FONT` and `FOREGROUND` runs, wrapped by `LineBreakMeasurer.nextLayout(width)` (split at `\n` yourself); hover with `TextLayout.hitTestChar(x, y)`; term boxes with `TextLayout.getLogicalHighlightShape(start, end)`; the reference's dotted underline with `TextAttribute.INPUT_METHOD_UNDERLINE` = `TextAttribute.UNDERLINE_LOW_DOTTED`, which Swing's HTML CSS cannot do *(all checked)*.

### 4.3 Window content (`TipView`)

Content order as in [§3](../../docs/algorithms.md#3-rendering-the-ast): header (title, fallback badge, pin, close), body `TermView` inside a borderless `JScrollPane` (vertical scroll bar as needed, never horizontal), "See also" as a second `TermView`, hint line. Close and pin are `JButton`s with icons, tooltips and accessible names from `label(...)`; their `ActionListener`s call `close(t, focusBack = true)` and `pinned ? unpin(t) : pin(t)`. Paint the rounded box, the 2 px lock bar along the bottom edge and the flash ring in `paintComponent` / `paintChildren` of `TipView`.

## 5. Look: the values of `deeptip.css`

Use logical pixels (Java 2D user space; Java scales them on HiDPI screens).

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % alpha | same |
| button hover background | black at 7 % | white at 9 % |
| missing link underline | `#d33` | `#d33` |

| Measure | Value |
|---|---|
| width | natural width, at least 240, at most 384 (whole window incl. 1 px border) |
| height | at most 480; the body scrolls |
| font | 14 px, line height 1.5; title bold; code monospace at 0.92; values bold |
| corner radius, border | 8 px, 1 px (pinned: accent colour) |
| header | padding 6 6 2 12; buttons 26 × 26 with 15 px icons, 2 px apart; badge: 0.7 font size, 1 px border, radius 3, padding 0 4 |
| body | padding 0 12 10; paragraphs and lists 7 px apart; list indent 1.2 em |
| "See also" | padding 0 12 10, font 0.9, label at 70 % opacity |
| hint | padding 4 12 6, font 0.75, 60 % opacity, 1 px top border; hidden when pinned |
| flash | 3 px ring in the accent colour, strongest at 30 % of 0.6 s |
| lock bar | 2 px at the bottom edge, accent colour, grows from left to right over `lockAfter` |

Size of a window: natural width = the widest of header, body + 24, "See also" + 24, hint + 24, plus 2 for the border; clamp it to [240, 384]; lay the body out at the resulting width and add the heights. For a `JEditorPane`, `getPreferredSize()` returns the unwrapped width *(checked: 441 px for a text that wraps at 384)*; measure with the root view instead *(checked)*:

```java
View root = termView.getUI().getRootView(termView);
float natural = root.getPreferredSpan(View.X_AXIS);    // unwrapped width
root.setSize(width, Integer.MAX_VALUE);               // wrap at the chosen width
int height = (int) Math.ceil(root.getPreferredSpan(View.Y_AXIS));
```

## 6. Placement in screen coordinates

[§8](../../docs/algorithms.md#8-placement) works in a viewport whose origin is (0, 0). In Swing:

1. Target box `T` in screen coordinates: for a child the parent's `TipWindow.getBounds()`; for a root on a component `getLocationOnScreen()` + `getSize()`; for a root on a page term the term box.
2. Screen: the `GraphicsDevice` whose `getDefaultConfiguration().getBounds()` contains the centre of `T`. Viewport `V` = those bounds minus `Toolkit.getDefaultToolkit().getScreenInsets(gc)`.
3. `a = T` moved by `(-V.x, -V.y)`; `vp = (V.width, V.height)`; sides = `"deeptip.place"` of a root anchor, else the `root` or `child` option.
4. `p = computePlacement(size, a, sides, vp, 8)`. If `p.maxW` or `p.maxH` is set, measure again with that limit (width → wrap again, height → the body scrolls) and compute once more with `[p.side]`.
5. `window.setBounds(V.x + round(p.x), V.y + round(p.y), w, h)`; store `t.rect`. There is no CSS margin: `(x, y)` is the window's top-left corner.
6. Re-place every window that is not frozen, parents before children, after `pin`/`unpin` (the hint line changes the height), after `refresh()`, on `ancestorMoved` of a root anchor and when the anchor's window moves or resizes.

## 7. Events: exact order of operations

All code runs on the event dispatch thread; timers are `javax.swing.Timer`, never `java.util.Timer`.

### 7.1 Mouse: one global listener

Register `Toolkit.getDefaultToolkit().addAWTEventListener(listener, AWTEvent.MOUSE_EVENT_MASK | AWTEvent.MOUSE_MOTION_EVENT_MASK)`. It sees every mouse event of the application before the target component's own listeners *(checked)*. Swing delivers a mouse event to the deepest component that has mouse listeners, so `e.getComponent()` can be an ancestor of what is under the pointer; `SwingUtilities.getDeepestComponentAt(e.getComponent(), e.getX(), e.getY())` finds the real target *(checked with a `JLabel` without listeners)*.

**Resolve the hover triple** for an event:

1. `t` = the deepest component (fallback `e.getComponent()`).
2. `win` = the open `Tip` whose `TipWindow` is `SwingUtilities.getWindowAncestor(t)`, else `null` (ignore windows that are closing).
3. `link` = if `t` is a `TermView`: the term under the point (section 4.2), else `null`.
4. `trig` = if `win == null && link == null`: the first `JComponent` from `t` upwards (including `t`) with the client property `"deeptip"`, else `null`.

| AWT event | Steps |
|---|---|
| `MOUSE_MOVED` | 1. add a sample and trim the samples ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)); 2. resolve the triple; 3. if it differs from the previous triple: "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)) |
| `MOUSE_DRAGGED` | add a sample only |
| `MOUSE_ENTERED` | steps 2 and 3 of `MOUSE_MOVED` |
| `MOUSE_EXITED` | if the screen point lies inside any showing window of the application (`Window.getWindows()`), ignore it: an `ENTERED` follows. Otherwise "on pointer leaving" (§6) |
| `MOUSE_PRESSED` | remember the pressed target (window, term, button); "on pointer down" ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) with `touch = false` |
| `MOUSE_RELEASED`, button 1 | if the target is the one remembered at the press and not a `JButton`: the click procedure of [§9.1](../../docs/algorithms.md#91-clicks) (a term → `follow(term, win, false)`; elsewhere inside a preview → pin when `clickInsidePins`) |

Comparing triples instead of reacting to every move reproduces the web's `pointerover`, which only fires when the element under the pointer changes. A DeepTip click never consumes the event, so the host's own buttons keep working ([§9.1](../../docs/algorithms.md#91-clicks)).

### 7.2 Buttons in a window

`JButton` `ActionListener`s (mouse, Space and Enter): close → `close(t, focusBack = true)`; pin → `t.pinned ? unpin(t) : pin(t)`. Exclude buttons from the click procedure above so a click is handled once.

### 7.3 Keyboard: one `KeyEventDispatcher`

`dispatchKeyEvent(e)` runs before the focused component and its `InputMap` bindings; return `true` to consume ([§9.3](../../docs/algorithms.md#93-keyboard)):

| Event | Steps |
|---|---|
| `KEY_PRESSED` `VK_ESCAPE` | no windows → return `false`. `repeat = escDown; escDown = true`. AWT has no repeat flag: while a key is held, `KEY_PRESSED` repeats without `KEY_RELEASED` in between. Shift held, or `repeat` and `now - escAt >= 600` → close all and focus the anchor of the root that held the focus; else if not `repeat` → `escAt = now`, `close(newest(focusOwner), focusBack = true)`. Consume. |
| `KEY_TYPED` char `0x1B` (if the platform sends one), `KEY_RELEASED` `VK_ESCAPE` | `escDown = false` on release; consume both when the press was consumed, so no component sees half an Esc (a `JDialog`'s Esc binding must not fire). |
| `KEY_PRESSED` `VK_F6` with windows open | consume; `cycle(shift ? -1 : 1)`. |
| `KEY_PRESSED` `VK_F1` (open key `"F1"`) | focus owner is a `TermView` with a focused term → `follow(term, its tip, focus = true)`; else a marked component (or its ancestor) outside DeepTip windows → open it pinned with focus (`via = "key"`). Consume only when handled. Ctrl+F1 belongs to Swing's `ToolTipManager` (shows the simple tooltip; it also hides it on Esc) through a key listener on every component with a tooltip *(checked in the JDK 25 source)*. |
| `KEY_TYPED` `'?'` (open key `"?"`) | ignore when the focus owner is an editable `JTextComponent`; else as F1. Use `KEY_TYPED`: the key code of `?` depends on the keyboard layout. |
| `KEY_TYPED`, printable, no Ctrl/Alt/Meta | `hush(marked ancestor of the focus owner)` ([§6](../../docs/algorithms.md#6-arming-and-delays)). |

`newest`, `cycle` and "close all" are in [§9.3](../../docs/algorithms.md#93-keyboard); "focus owner inside a window" is `SwingUtilities.isDescendingFrom(focusOwner, tip.view)`.

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); a repeating 16 ms timer only repaints the bar |
| flash | `flash(w)` | repaint frames for 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |

Let the engine own the one-shot timers through the `Clock` (testable); the views only animate.

### 7.5 Focus

- `focusWindow(t)` ([§9.5](../../docs/algorithms.md#95-focus)): `t.view.toFront()`; with terms: `termView.requestFocus()` and `focusIndex = 0`; without: `tipView.requestFocus()` (make the panel focusable).
- `focusAnchor(a)`: a `JComponent` → `requestFocus()`; a `Term` → its `TermView.requestFocus()` with `focusIndex = term.index`.
- `focusInside(t)`: `SwingUtilities.isDescendingFrom(KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner(), t.view)`.
- A click into a window activates it (the window is focusable); that equals the web, where clicking a button inside the popover focuses it.

### 7.6 Anchors that move or disappear

- Root anchor (`JComponent`): when its window opens, add a `HierarchyListener` and an `AncestorListener`; remove both on close. A hierarchy event after which `anchor.isShowing()` is false → [§4.5](../../docs/algorithms.md#45-anchors-that-disappear): unpinned windows close, a pinned root freezes at `t.rect`. `ancestorMoved` → re-place (section 6).
- Term anchors: re-rendering a `TermView` (`setText`) creates new terms. `refresh()` re-attaches children to the term of the same key ([§4.6](../../docs/algorithms.md#46-refresh)); anything not re-attached counts as removed.
- While a root window is open, set the anchor's `AccessibleContext` description to the entry's text and restore the old value on close (the counterpart of `aria-describedby`).

## 8. Live values, locales, refresh

- `vars`: a `Map<String, Object>` whose values are plain values, `Supplier<?>` or `Function<String, ?>` (called with the window's key), or one `BiFunction<String, String, Object>` `(name, key) → value`; `null` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- `setLocale(locale)` loads the missing files of the new chain, then `refresh()`; `refresh()` re-renders every open window, every page `TermView` and every index ([§4.6](../../docs/algorithms.md#46-refresh), [§12](../../docs/algorithms.md#12-encyclopedia)).

## 9. Loading the glossary (JSON)

- Files: `Files.readString(path)` (UTF-8). Resources inside a JAR: `new String(Objects.requireNonNull(cls.getResourceAsStream("/deeptip/en.json")).readAllBytes(), StandardCharsets.UTF_8)`. Strip a leading byte order mark (U+FEFF).
- `sources` are path templates with `{locale}`; load for each locale of the chain, each template in order; that order is the layer order (core first, project after). A missing file is a warning ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- The locale of a file: its `$locale`, else its file name (`de.json`, `myapp.de.json`).
- Object order matters (entry order, problem order, the parity cases): a minimal reader stores objects in `LinkedHashMap`; Gson's `JsonObject` and Jackson's `ObjectNode` keep insertion order as well. Numbers become `double`.
- The example glossaries are reached from `frameworks/java-swing/` as `../../glossary/core/{locale}.json` and `../../glossary/example/{locale}.json` (the download zip keeps the repository layout). Resolve them relative to the working directory or walk up from it until `glossary/core/en.json` exists.

## 10. Porting the pure functions: Java pitfalls *(checked)*

A straight Java port of `flatten`, `parseText` and `computePlacement` passes all 24 parity cases when these differences to JavaScript are handled:

1. `String.split(regex)` drops trailing empty strings; use `split(regex, -1)` to keep the JavaScript semantics.
2. JavaScript `\s` and `trim()` include U+00A0, U+FEFF and the other Unicode spaces. Java's `trim()` and `strip()` keep U+00A0, and `\s` is ASCII-only (`(?U)\s` covers U+00A0 but not U+FEFF). Write one `isJsSpace(char)` predicate (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) and use it for the bullet test `^\s*[-•]\s+(.*)$`, for every `trim` and for the emphasis checks.
3. JavaScript `.` stops at U+2028 and U+2029: a line containing them is not a bullet item.
4. `s[i + 1]` past the end is `undefined` in JavaScript; guard with `i + 1 < s.length()`.
5. The reference's `findClose` advances with `j++` after each skip; port the loop literally (`continue` inside a `for`).
6. `link.text` is `null` when absent or blank after trimming.
7. Placement: use `double` (a case expects `x = 17.5`); "the side with the most room" starts with `order.get(0)` and replaces it only on a strictly larger ratio (first wins ties).
8. Flatten: an object is an entry when `title`, `short` or `body` is a string; nested `$` keys are skipped silently; invalid keys are added and reported.

## 11. Testing

### 11.1 Parity cases

Run [§11](../../docs/algorithms.md#11-testing-with-testcases) with a plain `main` (no test framework needed), headless:

```java
// java -Djava.awt.headless=true -cp <classes> deeptip.ParityCases ../../test/cases
for (Map<String, Object> c : cases(dir, "markup.json"))
  check(c.get("name"), Markup.toJson(Markup.parseText((String) c.get("src"))), c.get("blocks"));
for (Map<String, Object> c : cases(dir, "placement.json"))
  check(c.get("name"), Placement.toJson(Placement.compute(size(c), anchor(c), sides(c), viewport(c), 8)), c.get("expect"));
for (Map<String, Object> c : cases(dir, "glossary.json"))
  check(c.get("name"), Glossary.summary(Glossary.flatten(c.get("input"))), c.get("expect"));   // {keys, meta, problems}
System.exit(failed == 0 ? 0 : 1);

static boolean same(Object a, Object b) {      // maps by key set, lists by index, numbers as double
  if (a instanceof Number x && b instanceof Number y) return x.doubleValue() == y.doubleValue();
  if (a instanceof Map<?, ?> x && b instanceof Map<?, ?> y)
    return x.keySet().equals(y.keySet()) && x.keySet().stream().allMatch(k -> same(x.get(k), y.get(k)));
  if (a instanceof List<?> x && b instanceof List<?> y)
    return x.size() == y.size() && IntStream.range(0, x.size()).allMatch(i -> same(x.get(i), y.get(i)));
  return Objects.equals(a, b);
}
```

`Markup.toJson` writes the AST in the shapes of [§2](../../docs/algorithms.md#2-markup-parser) (`{"type":"p","c":[…]}`, `{"t":"link","key":…,"text":null}` …), with the `text` key present even when it is `null`. With JUnit 5, turn each case into a `DynamicTest` of a `@TestFactory` instead.

### 11.2 Behaviour

- Engine tests with a fake `Clock` (a list of tasks ordered by time; `advance(ms)` runs the due ones in order) and a fake `Host` (records calls, returns boxes). Cover: one preview per parent; pinning pins the chain; closing closes the subtree; the same key up the chain flashes; the same anchor is reused; grace closes after `closeDelay`; samples heading into a window keep it open up to 1.5 s; heading into a preview delays arming of crossed elements; a press hushes the element; Esc closes the newest window of the focused chain; Shift+Esc and holding Esc for 600 ms close all; `lockAfter` pins.
- Views headless: `TipView` and `TermView` are lightweight and can be laid out and painted into a `BufferedImage` with `-Djava.awt.headless=true` *(checked with `JEditorPane`)*; save PNGs to compare looks, assert term boxes and hit tests.
- Only the real windows (`JWindow`), focus and timing feel need a display: compare by hand with the web example (`npm run demo`), as [§11](../../docs/algorithms.md#11-testing-with-testcases) describes.

## 12. The example to build

The same screen as `frameworks/web/example`: a `JFrame` with a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `"deeptip.delay"` = 0, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) to test placement at the screen edges, a page text with terms, settings (delay, lock, buttons, hints) and the encyclopedia. Glossaries: `glossary/core` and `glossary/example`.

## 13. Limitations compared with the web reference

- **Touch**: Swing has no pointer type (Windows delivers touch as mouse events), so long-press, tap-outside and swipe-down ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) cannot be told apart from the mouse.
- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): no JDK API; it needs a native library.
- **Reduced motion**: no JDK query; offer an option that turns the flash animation into a static ring.
- **Forced colours**: on Windows, `Toolkit.getDefaultToolkit().getDesktopProperty("win.highContrast.on")` is `Boolean.TRUE` in high-contrast mode; then use `SystemColor` (`window`, `windowText`, `textHighlight`) instead of the theme.
- **Swing CSS** has no dotted or wavy underlines; use the alternative renderer of section 4.2 if the exact look matters.

## 14. Checklist

1. Port and test `flatten`, `parseText`, `computePlacement` against `test/cases` (sections 10, 11.1).
2. `Glossary` with layers, chain, `$ui` labels, live values; the validator `tools/deeptip-check.mjs` checks the same JSON files.
3. `Engine` with `Clock` and `Host`, tested headless (section 11.2).
4. `TermView`, `TipView`, `TipWindow`, `SwingHost` (sections 4–7), the example (section 12).
5. Compare with the web example by hand; then list the framework with its state in the main README.
