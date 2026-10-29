# DeepTip for Python with Kivy: build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Kivy application, Kivy 2.2 or newer with Python 3.10 or newer, on desktop and mobile.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Kivy. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. The pure Python parts (parser, placement, glossary) are the same as in the [PySide6 guide](../python-pyside6/README.md), which this guide links instead of repeating. Statements marked *(checked)* were verified on 2026-10-29 with **Kivy 2.3.1** (SDL2 2.30.7 window, GLEW, mouse input provider) and Python 3.13.5 on Windows 11, without anything visible on screen: a hidden window (`Config.set("graphics", "window_state", "hidden")`), probe apps that stop themselves, touches from `kivy.tests.common.UnitTestTouch`, and the installed Kivy sources; *(verify)* marks what could not be checked there (Android, iOS, macOS, Linux, real touch screens).

## Quick start

**Recognise the project:** `kivy` in `requirements.txt` or `pyproject.toml`, `from kivy.app import App` with an `App` subclass whose `build()` returns the root widget, `.kv` files, often a `buildozer.spec` for Android and iOS.

1. `pip install kivy pytest` in a virtual environment; write `deeptip/core.py` as in the PySide6 guide ([The pure core](../python-pyside6/README.md#the-pure-core-1-2-8)) and pass the parity cases: `DEEPTIP_CASES=<DeepTip>/test/cases pytest -q` must report `24 passed` (section 13.1).
2. Write `deeptip/glossary.py`, `deeptip/render.py` and `deeptip/kivy.py` (section 1) in the order of operations of section 7.
3. Copy `glossary/core/<locale>.json` to `deeptip/core/`; your own entries go to `deeptip/<locale>.json` (section 10).
4. Create one controller in `App.on_start()`, when the window exists, and mark widgets (below).
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```python
from kivy.app import App
from kivy.uix.button import Button
from kivy.uix.floatlayout import FloatLayout
from deeptip.kivy import DeepTip

class MyApp(App):
    def build(self):
        root = FloatLayout()
        self.help = Button(text="?", size_hint=(None, None), size=(48, 48), pos_hint={"center_x": 0.5, "center_y": 0.5})
        root.add_widget(self.help)
        return root

    def on_start(self):                    # after the window exists: DeepTip's key and touch handlers run first
        self.dt = DeepTip(locale="en", sources=["deeptip/core/{locale}.json", "deeptip/{locale}.json"])
        self.dt.mark(self.help, "deeptip.about")

MyApp().run()
```

**Done when:** `pytest -q` reports `24 passed`, resting on `?` for 800 ms opens the *DeepTip* window below it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without quitting the app, the validator reports 0 errors.

## 1. Parts to build

| File | Content | Kivy types |
|---|---|---|
| `deeptip/core.py` | `flatten`, `parse_text`, `collect_refs`, `compute_placement` ([§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement)), identical to the [PySide6 core](../python-pyside6/README.md#the-pure-core-1-2-8); the parity cases test it | no |
| `deeptip/glossary.py` | layers, locale chain, `entry(key)`, `label(name)`, live values, file loading ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) | no |
| `deeptip/engine.py` | window tree, hot set, grace, tendency, arming, lock ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock)) against a small host interface and a clock, testable without a window | no |
| `deeptip/render.py` | AST → Kivy markup with `[ref]` terms ([§3](../../docs/algorithms.md#3-rendering-the-ast)), term hit-testing | `Label` |
| `deeptip/kivy.py` | the controller `DeepTip(EventDispatcher)` (Window bindings, clocks, focus) and the view `TipView(BoxLayout)` | `Window`, `Clock`, `BoxLayout`, `Label`, `ScrollView` |
| `deeptip/core/<locale>.json` | copies of `glossary/core/` | – |
| `tests/test_parity.py` | the parity runner of the PySide6 guide, unchanged | no |

## 2. SPEC concept → Kivy primitive

| SPEC | Kivy |
|---|---|
| Controller | one `DeepTip(EventDispatcher)` per app, created after the window exists (`App.on_start`); it binds `Window`: `mouse_pos`, `on_cursor_leave`, `on_touch_down/move/up`, `on_key_down`, `on_key_up`, `on_textinput`, `on_resize` |
| Top layer | `Window.add_widget(view)`: a widget added to the `Window` after the root is drawn above it and gets touches first *(checked: `Window.children[0]` is the newest, its canvas comes after the root's)* |
| Window | `TipView(BoxLayout)`, `size_hint=(None, None)`, background and border as canvas instructions (section 5) |
| Rich text | `Label(markup=True)` with `text_size=(width, None)` (wraps at `width`), one per block |
| Term (a real button) | `[ref=N]…[/ref]` in the markup; `label.refs` gives its boxes, `on_ref_press` fires on touch (section 4.2); keyboard focus is emulated (section 7.5) |
| Marked UI element (`data-deeptip`) | `dt.mark(widget, key, delay=None, place=None)`; keep the options in a `weakref.WeakKeyDictionary` (widgets support weak references *(checked)*) |
| Element under the pointer | no hit-test API for the whole tree: first the DeepTip views (newest first, `collide_point`), then the marked widgets: `w.get_root_window() is not None and w.collide_point(*w.to_widget(x, y))` |
| Anchor box | `w.to_window(w.x, w.y)` and `w.to_window(w.right, w.top)`: window coordinates, y up |
| Viewport | the Kivy window (`Window.width`, `Window.height`): DeepTip windows cannot leave it |
| Pointer | `Window.mouse_pos` (window coordinates, y up, pixels; set on every SDL mouse motion as `(x · density, (system height − 1 − y) · density)` *(checked in `window_sdl2.py`)*); `Window.on_cursor_leave` |
| Touch, click | `Window.bind(on_touch_down=…, on_touch_up=…)`: these run before the widget tree; `touch.device == "mouse"` for the mouse *(checked)* |
| `now()`, `schedule()` | `time.monotonic() * 1000`; `ev = Clock.schedule_once(cb, seconds)`, cancel `ev.cancel()` |
| Keyboard | `Window.bind(on_key_down=…, on_key_up=…)` returning `True` consumes (section 7.3) |
| Rest progress, open state (`data-dt-arming`, `data-dt-open`) | Kivy events of the controller: `on_arming(widget, ms)` and `on_open_state(widget, is_open)` (`register_event_type`), so the host can draw a progress bar or hide its own tooltip |
| `onOpen`, `onClose`, `onPin` | events `on_open(key, view)`, `on_close(key)`, `on_pin(key, view)` |
| Screen reader | none in Kivy 2.3.1 (section 8) |
| Icons | `kivy.graphics.svg.Svg` draws the 24 × 24 paths `PIN_PATH` and `CLOSE_PATH` of `deeptip.js` with `fill="none"` and a stroke *(checked)* |
| Theme (`--dt-*`) | `Color`, `RoundedRectangle`, `Line`, `BoxShadow` (Kivy ≥ 2.2) on the view's canvas; `color` and markup `[color]` on labels |

## 3. Data structures

The window record is the `Win` dataclass of the [PySide6 guide](../python-pyside6/README.md#data) with `@dataclass(eq=False)` (identity semantics), with these differences: timers hold `ClockEvent`s (or `None`), `view` is the `TipView`, `rect` is the last placed box in the y-down viewport of [§8](../../docs/algorithms.md#8-placement), and a term anchor is `(win, n)` where `n` is the ref number of the term (section 4.2) plus its occurrence among terms of the same key, so `refresh()` finds it again ([§4.6](../../docs/algorithms.md#46-refresh)).

Controller state: `data`, `labels`, `wins` (oldest first = the order of the views in `Window.children`, reversed), `hover = (win, link, trig)`, `hot: set`, `pending = (el, ClockEvent)`, `samples: collections.deque` of `(x, y_down, t)`, `quiet`, `lock_win`, `press` and `swallow` ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)), `esc_down`, `esc_at`, `focus = (win, index)` for the emulated focus, `marked: WeakKeyDictionary`.

## 4. Windows and terms

### 4.1 The overlay

```python
view = TipView(dt, theme)                 # BoxLayout(orientation="vertical", size_hint=(None, None))
Window.add_widget(view)                   # on top of the root and of older views
...
Window.remove_widget(view)                # close
```

The newest view is drawn last and gets touches first. To raise an older window (focus with `F6`), remove it and add it again. Children never cover their parent anyway (placement), so plain insertion order is enough.

**Not `ModalView` or `Popup`**: they are modal. `ModalView.on_touch_down` returns `True` for every touch, inside and outside, and dismisses itself on an outside touch when `auto_dismiss` is set *(checked in `modalview.py`)*: the application below would stop working while a preview is open. **A `FloatLayout` layer** inside your own root (added as its last child) works as well; then its coordinates are the layer's, and widgets the app adds to `Window` later (its own popups) would cover DeepTip.

### 4.2 Terms: `[ref]` in markup

Render the inline nodes of [§2](../../docs/algorithms.md#2-markup-parser) to Kivy markup ([§3](../../docs/algorithms.md#3-rendering-the-ast)); every glossary text goes through `escape_markup`, which turns `[`, `]`, `&` into `&bl;`, `&br;`, `&amp;` *(checked)*, so glossary text never becomes markup:

```python
from kivy.utils import escape_markup

LINK, MISSING, MONO = "6cb6ff", "dd3333", "RobotoMono-Regular"   # section 5; RobotoMono ships with Kivy

def to_markup(nodes, self_key, entry, value, terms: list) -> str:
    """Inline AST -> markup; terms collects the keys, [ref=N] belongs to terms[N]."""
    out = []
    for n in nodes:
        t = n["t"]
        if t == "text":
            out.append(escape_markup(n["v"]))
        elif t == "br":
            out.append("\n")
        elif t in ("b", "i"):
            out.append(f"[{t}]{to_markup(n['c'], self_key, entry, value, terms)}[/{t}]")
        elif t == "code":
            out.append(f"[font={MONO}]{escape_markup(n['v'])}[/font]")
        elif t == "var":
            v = value(n["name"])
            out.append("[b]" + escape_markup("{%s}" % n["name"] if v is None else str(v)) + "[/b]")
        elif t == "link":
            found = entry(n["key"])                         # (entry, locale) or None
            label = escape_markup(n["text"] or (found and found[0].get("title")) or n["key"])
            if n["key"] == self_key:
                out.append(f"[b]{label}[/b]")
            elif not found:                                 # the caller warns once per key
                out.append(f"[color={MISSING}][u]{label}[/u][/color]")
            else:
                out.append(f"[ref={len(terms)}][color={LINK}][u]{label}[/u][/color][/ref]")
                terms.append(n["key"])
    return "".join(out)
```

One `Label` per block (`p`), and per list item a row of a bullet `Label` and a `Label` for the text (a hanging indent; one `Label` cannot indent its wrapped lines). Labels: `markup=True`, `font_size=sp(14)`, `line_height=1.5`, `halign="left"`, `valign="top"`, `text_size=(width, None)`, then `texture_update()` and `size = texture_size`. *(checked: the function above gave two terms for the same key, an escaped title, code, a value, a missing and a self link; the label wrapped at 240 px)*

**Term under a point**: `label.refs` maps the ref name to a list of boxes `(x1, y1, x2, y2)` in **texture coordinates, y from the top**, including the label's `padding`, one box per wrapped line *(checked)*. The same ref name used twice gives boxes for both occurrences *(checked)*, which is why the names are term numbers and the keys sit beside them. `Label` draws its texture centred, and `Label.on_touch_down` hit-tests the same way:

```python
def ref_at(label, wx, wy) -> int | None:
    """Window point (y up) -> number of the term under it, else None."""
    x, y = label.to_widget(wx, wy)
    tx = x - (label.center_x - label.texture_size[0] / 2.0)
    ty = label.texture_size[1] - (y - (label.center_y - label.texture_size[1] / 2.0))
    for name, zones in label.refs.items():
        for x1, y1, x2, y2 in zones:
            if x1 <= tx <= x2 and y1 <= ty <= y2:
                return int(name)
    return None
```

*(checked: a point inside the second term returned 1, a point outside every term `None`; the same math inside a `ScrollView` scrolled to the end hit the right term)*. A term's box (for the focus ring and page terms) is the union of its zones converted back with `to_window`. `on_ref_press` fires on a touch on a term *(checked)*; DeepTip takes clicks from its own touch observers (section 7.2) so it knows mouse from touch.

### 4.3 Window content

`TipView(BoxLayout)` vertical, as in [§3](../../docs/algorithms.md#3-rendering-the-ast): header `BoxLayout` [title `Label` (bold), fallback badge `Label` (font × 0.7, a 1 px `Line` border), pin and close buttons], the body (a `BoxLayout` of block labels inside a `ScrollView` with `do_scroll_x=False`, which only scrolls when the height is limited), the "See also" `Label` (`label("seeAlso")` at 70 % opacity, then one `[ref]` per key, comma separated), the hint `Label` with a 1 px line above it (hidden when pinned), and the lock bar: a `Widget` of height `dp(2)` whose canvas `Rectangle` width follows the progress. Buttons: `ButtonBehavior` + `Widget` with an `Svg` icon (or a plain `Button` with `background_normal=""`); pin `on_release` toggles `pin`/`unpin`, close calls `close(win, focus_back=True)`.

## 5. Look: the values of `deeptip.css`

Hex colours go into `get_color_from_hex("#1b1e24")` (canvas `Color`, `Label.color`) or without `#` into markup (`[color=6cb6ff]`; Kivy accepts both forms *(checked)*).

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border, hint line | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background (`Color` with alpha) | term colour at 16 % | same |
| button hover background | black at 7 % | white at 9 % |
| missing link | `#dd3333` | `#dd3333` |
| shadow | `BoxShadow` 0 10 30 at black 30 % | same |

| Measure | Value |
|---|---|
| width | natural width, at least `dp(240)`, at most `dp(384)`; natural = the widest block label laid out without `text_size` (its `texture_size[0]` is the unwrapped width *(checked)*) + 24 padding + 2 border |
| height | at most `dp(480)`; the body scrolls |
| font | `sp(14)`, `line_height=1.5` (three lines of Roboto at 14 px: 51 px at 1.0, 75 px at 1.5 *(checked)*); title bold; code `RobotoMono-Regular`; values bold |
| corner radius, border | `RoundedRectangle(radius=[dp(8)])`, `Line(rounded_rectangle=(x, y, w, h, dp(8)), width=1)`; pinned: accent colour |
| header | padding 6 6 2 12; buttons `dp(26)` with 15 px icons (`dp(40)` after touch input); badge 0.7 font |
| body | padding 0 12 10; blocks `spacing=dp(7)` |
| "See also" | padding 0 12 10, font 0.9 |
| hint | padding 4 12 6, font 0.75, opacity 0.6; hidden when pinned and after touch input |
| flash | a 3 px accent `Line` around the window for 600 ms (an `Animation` on its alpha) |
| lock bar | `dp(2)` at the bottom edge, accent colour, width `Animation` from 0 to full over `lockAfter` |

Kivy has no dotted or wavy underline: terms use `[u]` (solid, text colour). Light or dark: Kivy has no query; offer an option.

## 6. Placement and coordinates

Kivy's window coordinates point **up**; [§8](../../docs/algorithms.md#8-placement) wants y down. Convert at the border and nowhere else (`H = Window.height`):

```python
def box_down(w) -> dict:
    """Window box of widget w in the y-down viewport of §8."""
    x1, y1 = w.to_window(w.x, w.y)
    x2, y2 = w.to_window(w.right, w.top)
    return {"left": x1, "right": x2, "top": Window.height - y2, "bottom": Window.height - y1}

def place(view, a: dict, sides, gap=dp(8)) -> dict:
    vp = {"w": Window.width, "h": Window.height}
    p = compute_placement({"w": view.width, "h": view.height}, a, sides, vp, gap)
    view.pos = (p["x"], Window.height - p["y"] - view.height)     # back to y up
    return p
```

1. Target box: a child uses its parent window's `rect`; a root uses `box_down(anchor)`; a page term the union of its ref zones.
2. Size limits first: width between min(`dp(240)`, vp.w − 2·gap) and min(`dp(384)`, vp.w − 2·gap); height at most min(`dp(480)`, vp.h − 2·gap). Lay the labels out at the body width (`text_size=(w, None)`, `texture_update()`), sum the heights.
3. `compute_placement`; when `maxW` or `maxH` is set, give the view that width or height (labels wrap again, the `ScrollView` scrolls), measure again and compute once more with `[p["side"]]`.
4. Set `view.pos` (above), store `rect`.
5. Re-place every window that is not frozen, parents before children: on `Window.on_resize`, after pin and unpin (the hint line changes the height), after `refresh()`, and when an anchor moves (`bind(pos=…, size=…)` on the anchor while its window is open).

Units: `Window.size` and every coordinate are pixels; `dp(x)` = `x · Metrics.density` turns the CSS pixel values into them, `sp()` also applies the font scale. A hidden window on Windows reads a DPI of 0 (it is never the active window), so tests set `KIVY_METRICS_DENSITY=1` *(checked)*; a normal window reads the screen's DPI.

## 7. Events: exact order of operations

Kivy calls the handlers of one event in reverse order of binding: the last bound runs first, and a handler that returns `True` stops the rest *(checked)*. The `Window` binds its own system keyboard (the one focused `TextInput`s and `FocusBehavior` widgets listen to) when it is created, so DeepTip binds **after** the window exists and always runs first *(checked)*.

### 7.1 Pointer (mouse and pen)

```python
Window.bind(mouse_pos=self._mouse_pos, on_cursor_leave=self._left)
```

`_mouse_pos(window, pos)`:

1. `x, y = pos[0], Window.height - pos[1]`; add the sample `(x, y, now())` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression));
2. `win` = the newest open view with `view.collide_point(*pos)` (skip views that are closing);
3. `link` = inside `win`: the first body or "See also" label with `ref_at(label, *pos)` not `None` → `(win, n)`; on a page: the same over the page labels;
4. `trig` = only when `win` and `link` are `None`: the marked widget under the pointer (section 2); when several match, the one deepest in the tree;
5. if `(win, link, trig)` differs from the last triple: "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)): `quiet`, `refresh_hot()`, `lock_track()`, arm or disarm.

`_left()`: `hover = {}`, `disarm()`, `lock_track(None)`, `refresh_hot()`.

Kivy ≥ 2.1 also sends hover motion events (`Window.on_motion` with `me.type_id == "hover"`), made from `mouse_pos`; in a handler bound on `Window` their `pos` is still (0, 0) *(checked)*, so read `Window.mouse_pos`. Touch has no hover, as on the web.

### 7.2 Touches and clicks

```python
Window.bind(on_touch_down=self._down, on_touch_move=self._move, on_touch_up=self._up)
```

These observers run before the widget tree. Never return `True` from `_down`: the application keeps every normal touch.

- `_down(window, touch)` ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)): `mouse = touch.device == "mouse"`; `win` = view under `touch.pos`; not in a window and `mouse` → `hush(marked widget)`; not in a window → `outside_click_closes` (`"always"`, or `"touch"` and not `mouse`) closes all; not `mouse` on a marked widget that is not a term → `press = Press(touch, widget)` with `Clock.schedule_once(fire, long_press / 1000)`; not `mouse` on a window's header outside its buttons → remember the swipe start.
- `Press.fire`: open the element's window pinned (`via="touch"`); take the touch away from every widget that grabbed it (`for ref in touch.grab_list[:]: touch.ungrab(ref())`) and set a `ButtonBehavior` back to `state = "normal"`; mark `touch.ud["deeptip_swallow"] = True`. *(checked: a 0.7 s press opened the window, the button saw `on_press` but no `on_release`; a 0.1 s tap and a press that drifted 20 px after 0.2 s still clicked the button)*
- `_move`: a press that drifts more than `dp(10)` is cancelled.
- `_up(window, touch)`: end the press of that touch; a swipe with dy > `dp(60)` (downwards = `touch.oy - touch.y` in y-up coordinates) and |dx| < `dp(60)` closes all; `return True` when `touch.ud` has `deeptip_swallow` (the release is swallowed). A release of a mouse `left` button (`touch.button == "left"`) on the same term as its press → `follow(term, win, focus=False)` ([§9.1](../../docs/algorithms.md#91-clicks)); elsewhere inside an unpinned window → pin it when `click_inside_pins`; a touch tap on a term → `follow` too (touch opens terms pinned).
- Pin and close buttons handle their own `on_release`; skip them in `_up`.
- Mouse buttons other than left: Kivy's mouse provider uses right and middle clicks and Ctrl + left for multitouch emulation (red dots); set `Config.set("input", "mouse", "mouse,multitouch_on_demand")` before the window is created so a right click stays a right click.

### 7.3 Keyboard: consuming `Esc` before the application

```python
Window.bind(on_key_down=self._key_down, on_key_up=self._key_up, on_textinput=self._text)
```

The SDL window dispatches `on_key_down`; only when no handler returned `True` it dispatches `on_keyboard` (`window_sdl2.py` *(checked)*), whose default handler **quits the application on `Esc`** (`exit_on_escape`, on by default *(checked)*). A focused `TextInput` unfocuses itself on `Esc` key down, a `FocusBehavior` widget on `Esc` key **up** *(both checked)*.

`_key_down(window, key, scancode, codepoint, modifiers)` ([§9.3](../../docs/algorithms.md#93-keyboard)):

| Key | Steps |
|---|---|
| `27` (Esc) | no windows → return `False` (the app's own behaviour follows: unfocus, or quit). `repeat = esc_down; esc_down = True`. `"shift" in modifiers`, or `repeat` and `now() - esc_at >= 600` → close all, focus back; else if not `repeat` → `esc_at = now()`, `close(newest(focus), focus_back=True)`. Return `True`. |
| `287` (F6) with windows open | cycle the windows (`"shift"`: backwards); `True` |
| `282` (F1), or `codepoint == "?"` while no `TextInput` has the focus | the focus is on a term of a window → `follow`; a marked `FocusBehavior` widget has the focus → open it pinned with focus (`via="key"`); `True` only when handled |
| `9` (Tab), `13` (Enter), `32` (Space) while DeepTip holds the focus | move the emulated focus or follow the focused term (section 7.5); `True` |

`_key_up(window, key, scancode)`: for `27`: `esc_down = False`; return `True` when the press was consumed, so a focused `FocusBehavior` widget keeps its focus *(checked)*. `_text(window, text)`: printable text typed while a marked widget has the focus → `hush(widget)`; return `False`.

*(checked)*: with two windows open and a focused `TextInput`, `Esc` closed one window, the `TextInput` kept the focus and the app kept running; with no windows the app's behaviour was unchanged. In the virtual-keyboard modes (`keyboard_mode` `dock`, `multi`, `systemanddock`, `systemandmulti`) `request_keyboard()` re-binds the system keyboard and puts it in front of DeepTip (`core/window/__init__.py` *(checked)*): re-bind DeepTip's handlers after each focus change there.

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lock_track(win)` with `lock_after > 0` | `stop_lock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); an `Animation` only draws the bar |
| flash | `flash(w)` | 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |
| long press | `_down` | `Press.fire` (section 7.2) |

`Clock.schedule_once(cb, ms / 1000)` takes seconds and calls `cb(dt)`; keep the returned `ClockEvent` and `cancel()` it. Clock callbacks run between frames, so a 90 ms retry can come up to one frame late; compare against `now()`, never count calls.

### 7.5 Focus

Terms inside a `Label` cannot take the focus. DeepTip keeps its own focus `(win, index)` over the window's terms and buttons while a window was opened by keyboard: draw the focus ring (a 2 px accent `Line` around the term's box), handle Tab, Shift+Tab, Enter and Space in `_key_down` (above), and give the focus back to the anchor's `FocusBehavior` (`anchor.focus = True`) when the window closes ([§9.5](../../docs/algorithms.md#95-focus)). While DeepTip holds the focus, set `focus = False` on the app's focused widget so its keyboard handlers stay quiet, and restore it on close.

### 7.6 Anchors that move or disappear

- A root anchor whose `get_root_window()` is `None` was removed from the tree: check it on every pointer event and in a `Clock.schedule_interval` of about 250 ms while windows are open; then [§4.5](../../docs/algorithms.md#45-anchors-that-disappear): previews close, a pinned root freezes at its last box.
- Moves: `anchor.bind(pos=…, size=…)` while its window is open → re-place; unbind on close.

## 8. Accessibility

Kivy 2.3.1 has no accessibility API: its widgets are drawn with OpenGL and expose nothing to screen readers on any platform (no accessibility module in the Kivy sources *(checked)*). DeepTip can still give full keyboard operation (section 7.5), a visible focus ring, readable contrast and `sp()` font sizes that follow the system font scale; that is all.

## 9. Live values, locales, refresh

- `vars` as in the [PySide6 guide](../python-pyside6/README.md#loading-the-glossaries-1): a dict name → value or callable (called with the window's key), or one callable `(name, key)`; `None` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- `set_locale(locale)` reads the missing files of the new chain, then `refresh()`.
- `refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): rebuild the labels of every open view, give each child the term of its parent with the same key and occurrence (new ref number), re-place every window that is not frozen, re-render page labels and the encyclopedia. Kivy properties make live values easy to wire: `app.bind(stability=lambda *a: dt.refresh())`.

## 10. Loading the glossary (JSON)

The loading code of the PySide6 guide applies unchanged ([Loading the glossaries](../python-pyside6/README.md#loading-the-glossaries-1)): UTF-8 always, Python dicts keep the file order, `sources` are templates with `{locale}` read per locale of the chain in template order (core first), a missing file is a warning, the locale of a file is its `$locale`, else its file name. Kivy additions:

- Resolve paths with `kivy.resources.resource_find(path)` or relative to `App.get_running_app().directory`; the working directory differs on Android and iOS.
- Buildozer packs only the extensions listed in `source.include_exts`; add `json` there, or the glossaries are missing on the phone *(verify against your buildozer.spec; the generated default lists `py,png,jpg,kv,atlas`)*.
- Read files before the first window opens (in `on_start`); a large glossary can be read in a thread, but call `dt.add()` on the main thread (`Clock.schedule_once`).

## 11. Porting the pure functions

Use the Python core of the PySide6 guide as it is: [The pure core](../python-pyside6/README.md#the-pure-core-1-2-8) has the JavaScript whitespace set, `js_trim`, `KEY_RE.fullmatch` and the JavaScript division for `compute_placement`, and its [pitfalls](../python-pyside6/README.md#pitfalls) 8–11 list what differs from JavaScript. Nothing in it touches Kivy. *(checked: 24 of 24 with pytest 9.2.0 in the Kivy environment)*

## 12. Kivy pitfalls

1. **`Esc` quits the app** (`exit_on_escape`) unless an `on_key_down` handler returns `True` first *(checked)*; DeepTip must never let an `Esc` that closed a window through.
2. **Handler order is reverse binding order**; bind DeepTip after the window exists (`on_start`), or the system keyboard and the app's own handlers run before it *(checked)*.
3. **`FocusBehavior` unfocuses on `Esc` key up**: consume the key up of every `Esc` you consumed *(checked)*.
4. **`refs` are texture coordinates with y from the top** and include `padding`; `Label` centres its texture, so set `size = texture_size` or keep the default centring when you hit-test *(checked)*. Read `refs` and `texture_size` only after `texture_update()`.
5. **Escape every glossary text** with `escape_markup` before it goes into markup *(checked)*.
6. **Window coordinates point up** (`mouse_pos`, `to_window`, `pos`); §8 points down. Convert in exactly two places (section 6).
7. **Hover motion events** carry `pos` (0, 0) in `Window`-bound handlers *(checked)*; use `Window.mouse_pos`.
8. **`ModalView` and `Popup` are modal** (section 4.1).
9. **Multitouch emulation**: right and middle clicks leave red dots unless `multitouch_on_demand` or `disable_multitouch` is set (Kivy's mouse provider docs).
10. **`Clock` takes seconds**, DeepTip's options are milliseconds.
11. **One label cannot hang-indent** wrapped list lines; build list items as rows (section 4.2).
12. **Hidden test windows** read DPI 0 on Windows; set `KIVY_METRICS_DENSITY=1` in tests *(checked)*. Set `KIVY_HOME` too, or Kivy writes its configuration and logs into the user's home folder.

## 13. Testing

### 13.1 Parity cases

Use the pytest runner of the PySide6 guide unchanged ([Testing](../python-pyside6/README.md#testing)): it imports only `deeptip.core` and expects `24 passed` *(checked)*. No window is needed.

### 13.2 Behaviour, without a visible window

- Engine tests with a fake clock and a fake host, as in the [Swing guide](../java-swing/README.md#112-behaviour).
- Kivy parts: before importing `kivy.core.window`, set `os.environ["KIVY_NO_ARGS"] = "1"`, `KIVY_METRICS_DENSITY=1`, `KIVY_HOME` to a test folder, and `Config.set("graphics", "window_state", "hidden")`; create the window with `EventLoop.ensure_window()` and pump it with `EventLoop.idle()`. Drive the pointer by setting `Window.mouse_pos = (x, y)`, touches with `UnitTestTouch(x, y).touch_down()` / `.touch_up()`, keys with `Window.dispatch("on_key_down", 27, 41, None, [])` followed, if that returned `False`, by `Window.dispatch("on_keyboard", …)` exactly as `window_sdl2.py` does. Replace `kivy.core.window.stopTouchApp` with a recorder to see whether `Esc` would have quit the app *(all checked)*.
- Timed sequences run inside a probe `App` with `Clock.schedule_once` steps and a safety `Clock.schedule_once(lambda dt: app.stop(), 15)`.

### 13.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions ([§11](../../docs/algorithms.md#11-testing-with-testcases)). Try touch on a phone or a touch screen.

## 14. The example to build

The same screen as `frameworks/web/example` (`example/main.py`): a `FloatLayout` with a top bar of `Button`s marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`, then `refresh()`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), `?` marked `deeptip.about` with `delay=0`, a language `Spinner` (`de`, `en`) calling `set_locale()`; four buttons in the corners (`pos_hint`) for placement at the edges (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`); a page text with terms, settings (delay, lock, close and pin buttons, hints) and the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia): a `TextInput` filter and a `RecycleView` of entries). Options: `sources = ["../../glossary/core/{locale}.json", "../../glossary/example/{locale}.json"]` (the download zip keeps the repository layout), `fallback=["de", "en"]`, `delay=1000`; in English *Prestige* and *Gold* come from the German fallback and show the `DE` badge.

## 15. Limitations compared with the web reference

- **Screen readers**: none (section 8).
- **Windows stay inside the Kivy window**: the viewport is the app window, never the whole screen.
- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): Kivy's SDL2 window has `on_joy_button_down`, `on_joy_axis` and `on_joy_hat`, but the button numbers are the joystick's, not the standard A/B/Y layout; map them per controller *(verify)*.
- **Vibration**: not in Kivy; on Android and iOS the separate `plyer` package has a vibrator *(verify)*.
- **Look**: no dotted or wavy underline; reduced motion has no query (offer an option).
- **Terms on a normal screen** live in markup labels with refs; a `TextInput` cannot hold terms.

## 16. Checklist

1. `deeptip/core.py` from the PySide6 guide, `24 passed` (sections 11, 13.1).
2. `glossary.py` with layers, chain, `$ui` labels, live values; validate the same files with `tools/deeptip-check.mjs`.
3. Engine with a fake clock and host, tested (section 13.2).
4. `to_markup()`, `ref_at()`, `TipView` in the overlay, placement with the y conversion, the `Window` bindings of section 7, bound in `on_start`.
5. The example (section 14); compare with the web example by hand, including touch; then list the framework with its state in the main README.
