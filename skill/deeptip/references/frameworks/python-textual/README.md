# DeepTip for Python with Textual (terminal)

Guide: how [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) is built in a [Textual](https://textual.textualize.io) application. In a terminal the windows are boxes over the screen, terms are underlined spans, the pointer is the mouse where the terminal reports it and otherwise the keyboard focus. This repository keeps code only in HTML, CSS, JavaScript and Rust, so this page is the exact recipe instead of a package. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) (the § links below point into it), the contract is [SPEC.md](../../SPEC.md); the closest complete implementation for a terminal is the Rust adapter in [`frameworks/rust-ratatui`](../rust-ratatui/README.md).

Checked with **Textual 8.2.8** (Rich 15.0.0) and Python 3.10 on Windows: a prototype of every file below (the pure core, a port of the engine, the Textual layer and the example HUD) passed 48 tests with `App.run_test` and `Pilot`: the 24 parity cases, 9 engine scenarios with exact times, 13 interface tests, the test shown under [Testing](#testing) and the Quick start below. Statements marked *(checked)* were reproduced there.

## Quick start

**Recognise the project:** `textual` in `requirements.txt` or `pyproject.toml`, a class derived from `textual.app.App`.

1. `pip install textual` in a virtual environment (`pytest` for the tests).
2. Write `deeptip/core.py`, `glossary.py` and `engine.py` (pure Python); `pytest` must pass the parity cases ([Testing](#testing)).
3. Write `deeptip/tui.py`: windows, terms, controller ([SPEC → Textual](#spec--textual), [Building a window](#building-a-window-3)).
4. Copy `glossary/core/<locale>.json` to `glossary/core/`; your own entries go to `deeptip/<locale>.json`.
5. Give the `App` DeepTip's CSS, bindings and pointer handlers, and mark the widgets to explain (below).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en glossary/core/en.json deeptip/en.json`.

```python
from textual.app import App, ComposeResult
from textual.widgets import Button

from deeptip.tui import DEEPTIP_BINDINGS, DEEPTIP_CSS, DeepTip


class Shop(App):
    CSS = DEEPTIP_CSS                # windows on their own layer
    BINDINGS = DEEPTIP_BINDINGS      # Esc, Shift+Esc, F6, F1, ? (priority, only while DeepTip needs them)

    def __init__(self):
        super().__init__()
        self.dt = DeepTip(self, locale="en", sources=("glossary/core/{locale}.json", "deeptip/{locale}.json"))

    def compose(self) -> ComposeResult:
        yield self.dt.mark(Button("?", compact=True), "deeptip.about")

    def on_mouse_move(self, event) -> None:   # every pointer move bubbles up to the App
        self.dt.pointer_moved(event)

    def on_mouse_down(self, event) -> None:
        self.dt.pointer_down(event)

    def check_action(self, action, parameters):
        return self.dt.check_action(parameters[0]) if action == "deeptip" else True

    def action_deeptip(self, what: str) -> None:
        self.dt.action(what)


if __name__ == "__main__":
    Shop().run()
```

**Done when:** resting the mouse on `?` for 800 ms opens the *DeepTip* window below it with one empty row between, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both and `Esc` closes the newest, `F1` on the focused button opens the window pinned with the focus on its first term, the parity cases and the validator pass.

## What you build

| File | Content |
|---|---|
| `deeptip/core.py` | pure Python: `flatten(obj)` ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)), `parse_text(src)` ([§2](../../docs/algorithms.md#2-markup-parser)), `collect_refs`, `runs` (the AST flattened into `(kind, value, bold, italic)` in reading order), `compute_placement(size, anchor, sides, vp, gap=8)` ([§8](../../docs/algorithms.md#8-placement)). The PySide6 guide describes the same functions with every Python-versus-JavaScript detail ([its pure core](../python-pyside6/README.md#the-pure-core-1-2-8)); only `runs` is new here. |
| `deeptip/glossary.py` | layers, locale chain, labels, `set_sources`, `keys`, `backlinks` ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) |
| `deeptip/engine.py` | the window tree with its timers ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input)): a line-by-line port of [`frameworks/rust-egui/src/engine.rs`](https://github.com/gorduan/DeepTip/blob/main/frameworks/rust-egui/src/engine.rs). No Textual: every call takes `now` in milliseconds. |
| `deeptip/tui.py` | the Textual layer: `DeepTip` (controller), `DeepTipWindow`, `DeepTipBody`, `DeepTipText`, `DEEPTIP_CSS`, `DEEPTIP_BINDINGS`, the messages `DeepTipOpened`, `DeepTipClosed`, `DeepTipPinned` |
| `tests/test_parity.py`, `tests/test_engine.py`, `tests/test_tui.py` | parity cases, engine scenarios, the interface with `run_test` |

## SPEC → Textual

| DeepTip | Textual |
|---|---|
| Controller | A plain object `DeepTip(app, locale, fallback, sources, **options)` owned by the `App`. It mounts windows on `app.screen`, schedules one timer with `app.set_timer`, and gets input from three App handlers (`on_mouse_move`, `on_mouse_down`, `on_app_blur`), the bindings `DEEPTIP_BINDINGS` and the windows' own key handlers. |
| Window ([§3](../../docs/algorithms.md#3-rendering-the-ast)) | `DeepTipWindow(Widget)` mounted on the screen with `layer: deeptip; position: absolute;`, its place in `styles.offset = (x, y)` and its size in `styles.width` / `styles.height`, in screen cells *(checked)*. The screen must declare the layer: `Screen { layers: default deeptip; }`. Windows on one layer stack in mount order, so the newest is on top *(checked)*. |
| Window content | A header `Horizontal` (title `Label`, badge `Label`, pin `Button("○", compact=True)`, close `Button("✕", compact=True)`), then a `VerticalScroll` with the body. The hint line is the window's `border_subtitle` (in the bottom edge); pinned windows get the class `-pinned` (accent border), a flashing one `-flash`. |
| Term | A span of Textual `Content`: the visible style as a string (`"underline $text-accent"`, theme variables resolve) plus `Style.from_meta({"deeptip": (owner, index)})` over the same range *(checked)*. The compositor reports the style of any cell: `screen.get_style_at(x, y).meta` and every mouse event's `event.style.meta` carry the pair (Textual adds an `offset` key) *(checked)*. |
| Marked UI element (`data-deeptip`) | `dt.mark(widget, key, delay=None, place=None)` keeps the widget in a `weakref.WeakKeyDictionary` and returns it, so it fits into `compose`. While a window is open the widget has the class `-dt-open`, while the pointer rests on it `-dt-arming` (web: `data-dt-open`, `data-dt-arming`): style them in your CSS. |
| Element, window, term under the pointer | `screen.get_widget_at(x, y)` gives the top-most widget; walk `widget.ancestors_with_self` to the first `DeepTipWindow` or marked widget; the term is the `deeptip` meta of `screen.get_style_at(x, y)`. |
| Anchor box | `widget.region` (screen cells). A term on a page: scan the cells of its `DeepTipText` region for the term's meta and take the bounding box (a wrapped term gives two rows) *(checked)*. |
| Pointer | `App.on_mouse_move(event)` with `event.screen_x`, `event.screen_y`. Mouse moves bubble from the widget under the pointer up to the `App`: from `Pilot` *(checked)*, and from the terminal through the same routing after `App.on_event` (Textual's source). |
| `now()`, `schedule()` | `time.monotonic() * 1000`; one `Timer` from `app.set_timer(seconds, dt.sync)` for the engine's next due time, stopped with `timer.stop()` and replaced whenever it changes. |
| Keys: Esc, F6, F1, `?` | `DEEPTIP_BINDINGS`: `Binding("escape", "deeptip('escape')", priority=True, show=False)`, likewise `shift+escape`, `f6`, `shift+f6`, `f1`, `question_mark`. `App.check_action` returns `False` while DeepTip has nothing to do, then the key goes on to the focused widget and the application *(checked)*. |
| Focus inside a window | `DeepTipBody(Widget, can_focus=True)` keeps the index of its focused term and shows it reversed; `Tab` / `Shift+Tab` / `Enter` / `Space` are handled in `on_key` with `event.stop()` and `event.prevent_default()`, so neither the screen's `tab` binding nor the application's `on_key` sees them *(checked)*. |
| Terms on a page (`renderText`) | `DeepTipText(dt, markup)`: a focusable widget like the body; a click follows a term, `Tab` walks its terms and moves on after the last one. |
| `onOpen`, `onClose`, `onPin` | Messages `DeepTipOpened(key)`, `DeepTipClosed(key)`, `DeepTipPinned(key)` posted to the App: handlers `on_deep_tip_opened` … |
| Encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia)) | An `Input` (placeholder `label("search")`) above a `VerticalScroll` with one `DeepTipText` per entry (`**[[key]]**`, the `short` line, `*Mentioned in:* [[a]], [[b]]`); rebuild the rows on `Input.Changed`, `Static(label("empty"))` when nothing matches. |
| Screen reader (SPEC §6) | Terminals have no accessibility tree; keyboard paths are complete. |
| Textual's own tooltip | `widget.tooltip` shows after a short hover; take it off the widget while it has `-dt-open`, or do not give marked widgets one. |

## Data

```python
from dataclasses import dataclass, field

@dataclass(eq=False)                 # identity: windows go into sets and lists
class Win:
    id: int
    key: str
    parent: "int | None"
    anchor: object                   # a widget, ("term", window id, key, n) or ("page", id(text widget), key, n)
    via: str                         # hover, click, key, pad, api
    pinned: bool = False
    children: list = field(default_factory=list)
    rect: "tuple | None" = None      # (left, top, right, bottom) in nominal pixels, for the tendency
    frozen: bool = False
    flash_at: "float | None" = None
    leave: "tuple | None" = None     # (since, check_at): the grace timer


@dataclass(frozen=True)              # compared on every pointer move: only a change counts (§6)
class Hover:
    win: "int | None" = None
    link: "tuple | None" = None      # (anchor, key, parent window id or None)
    trig: "tuple | None" = None      # (widget, key, own delay or None)
```

`Engine` holds `wins` (oldest first), `hover`, the hot set, the pending arm ([§6](../../docs/algorithms.md#6-arming-and-delays)), `quiet`, the pointer samples ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), the lock ([§7](../../docs/algorithms.md#7-timer-lock)), the events and the focus request, with the methods of `engine.rs`: `open`, `close`, `close_all`, `pin`, `unpin`, `toggle_pin`, `follow`, `open_pinned`, `click_inside`, `pointer_down`, `hush`, `newest`, `cycle`, `pointer_moved`, `set_hover`, `heading`, `set_rect`, `retain_anchors`, `tick(now) → next due or None`. A term anchor counts the key in reading order (`n`), so it survives a language switch ([§4.6](../../docs/algorithms.md#46-refresh)).

## Loading the glossaries (§1)

Exactly as in the [PySide6 guide](../python-pyside6/README.md#loading-the-glossaries-1): `json.loads(Path(path).read_text(encoding="utf-8"))` (never the platform default), `flatten()`, a later layer wins per key, `$ui` merged into the labels; `sources` are path templates with `{locale}`, read for every locale of the chain in template order (= layer order, core first), each path once; a missing file is a warning. Python dicts keep the file order the parity cases need. Live values: `dt.set_value(name, value_or_callable)`, a callable gets the window's key; after a change call `dt.refresh()`: Textual is retained-mode, so open windows and page texts are rebuilt only then ([§4.6](../../docs/algorithms.md#46-refresh)). `dt.set_locale(locale)` loads missing files and refreshes.

## Building a window (§3)

```python
DEEPTIP_CSS = """
Screen { layers: default deeptip; }
DeepTipWindow {
    layer: deeptip; position: absolute; layout: vertical;
    background: $panel; border: round $panel-lighten-3; padding: 0 1;
    border-subtitle-color: $text-muted;
}
DeepTipWindow.-pinned { border: round $accent; }
DeepTipWindow.-flash { border: heavy $accent; }
DeepTipWindow > .dt-head { height: 1; }
DeepTipWindow .dt-title { width: 1fr; text-style: bold; }
DeepTipWindow .dt-badge { width: auto; margin: 0 1; color: $text-muted; }
DeepTipWindow Button { min-width: 3; width: 3; }
DeepTipWindow > VerticalScroll { height: 1fr; scrollbar-size-vertical: 1; }
DeepTipBody, DeepTipText { height: auto; }
"""

class DeepTipWindow(Widget):
    def __init__(self, dt, wid):
        super().__init__()
        self.dt, self.wid = dt, wid
        self.body = DeepTipBody(dt, wid)

    def compose(self):                                  # title_text, badge_text, _pinned are set before mounting
        with Horizontal(classes="dt-head"):
            yield Label(self.title_text, classes="dt-title")
            badge = Label(self.badge_text, classes="dt-badge")
            badge.display = bool(self.badge_text)
            yield badge
            yield Button("●" if self._pinned else "○", compact=True, id="dt-pin")
            yield Button("✕", compact=True, id="dt-close")
        with VerticalScroll():
            yield self.body

    def on_button_pressed(self, event: Button.Pressed) -> None:
        event.stop()
        if event.button.id == "dt-close":
            self.dt.close(self.wid, focus_back=True)
        else:
            self.dt.toggle_pin(self.wid)

    def on_click(self, event: events.Click) -> None:   # a click inside a preview pins it
        if not isinstance(event.widget, Button):       # the button's own Pressed message does the work
            self.dt.click_inside(self.wid)
```

1. Content: title of the entry or the key; badge = the source locale in upper case when the entry came from a fallback locale; body = `body`, else `short`, else `label("missing")`, plus the "See also" line; hint = `label("hint")` while `hints` and not pinned; pin and close buttons follow `pin_button` / `close_buttons` (`display`). The pin button's `tooltip` is `label("pin")` or `label("unpin")`.
2. Size, in cells, before mounting (no flicker): the body `Content` wrapped with `content.wrap(max_w - 4)` (border 2 + padding 2); width = the widest line + 4, at least the header (title + badge + buttons), clamped to 30–48 columns and the screen; height = 3 (frame and header) + `content.get_height({}, width - 4)`, at most 30 rows and the screen; when it scrolls, measure again one column narrower for the scrollbar. Textual turns a Rich `Text` from `render()` into `Content` and wraps it itself, so measure with `Content`, not with Rich's console *(checked: `wrap()` and `get_height()` match the rendered lines)*.
3. Place it ([Placement](#placement-in-cells-8)), set `styles.offset`, `styles.width`, `styles.height`, then `screen.mount(view)`.
4. Changes later (pinned, locale, live values): update the header labels, the subtitle and the body text, `body.refresh(layout=True)`.

## Rendering the AST (§3)

Glossary text is data: build `Content` from `(text, style)` tuples with `Content.assemble`, never with `Content.from_markup`, which would read `[brackets]` in the text as Textual markup.

```python
from textual.content import Content
from textual.style import Style

def term_text(dt, owner, markup, self_key=None, see=(), anchor_of=None):
    """Content with one meta span per term; terms[i] = (key, anchor)."""
    terms, parts, per_key = [], [], {}
    blocks = parse_text(markup)

    def link(key, own, emph):
        found = dt.glossary.entry(key)
        title = (found[0].get("title") or key) if found else None
        label = own or title or key
        if key == self_key:
            parts.append((label, emph + "bold"))                     # the window's own entry: bold, not a term
        elif found is None:
            parts.append((label, emph + "$text-error dim"))          # missing: marked, not a term
        else:
            n = per_key.get(key, 0)
            per_key[key] = n + 1
            terms.append((key, anchor_of(key, n)))
            meta = Style.from_meta({"deeptip": (owner, len(terms) - 1)})
            parts.append(Content.assemble((label, emph + "underline $text-accent")).stylize(meta))

    def inline(nodes):
        for kind, value, bold, italic in runs(nodes):
            emph = ("bold " if bold else "") + ("italic " if italic else "")
            if kind == "text":
                parts.append((value, emph.strip()))
            elif kind == "br":
                parts.append("\n")
            elif kind == "code":
                parts.append((value, emph + "$text-warning"))
            elif kind == "var":
                v = dt.value(value, self_key)
                parts.append(("{" + value + "}" if v is None else str(v), emph + "bold"))
            else:
                link(value[0], value[1], emph)

    for i, b in enumerate(blocks):
        if i:
            parts.append("\n\n")                                     # blocks are separated by an empty line
        if b["type"] == "p":
            inline(b["c"])
        else:
            for j, item in enumerate(b["items"]):
                parts.append(("\n" if j else "") + "• ")
                inline(item)
    if see:
        parts.append(("\n" + dt.glossary.label("seeAlso") + " ", "$text-muted"))
        for i, key in enumerate(see):
            if i:
                parts.append((", ", "$text-muted"))
            link(key, None, "")
    return Content.assemble(*parts), terms
```

`DeepTipBody.render()` returns this content, with `"reverse"` stylized over the spans of the focused term while it has the focus. List items wrap to the left edge (Textual content has no hanging indent).

## Order of operations

| Input | DeepTip does |
|---|---|
| `App.on_mouse_move(event)` | `engine.pointer_moved((x + 0.5) · 8, (y + 0.5) · 16, now)` (cell centre in nominal pixels, [Placement](#placement-in-cells-8)); hover = `Hover(window under the pointer, the term there, the marked widget there when there is neither)` ([§6](../../docs/algorithms.md#6-arming-and-delays)); `engine.set_hover(hover, now)`; `sync()` |
| `App.on_mouse_down(event)` | outside every window: `engine.pointer_down(False, marked widget under it, False)` (hush, outside click [§9.2](../../docs/algorithms.md#92-pointer-down-touch)); `sync()` |
| `App.on_app_blur()` | the terminal lost the focus: `engine.set_hover(Hover(), now)` |
| `Click` on a term (`DeepTipBody.on_click`, `DeepTipText.on_click`) | `event.stop()`; `engine.follow(anchor, key, window or None, focus=False, now)` ([§9.1](../../docs/algorithms.md#91-clicks)) |
| `Click` elsewhere in a window | `engine.click_inside(window)` |
| `Button.Pressed` (pin, close) | `toggle_pin`, or close with the focus back |
| binding `deeptip('escape')` | a press: close `engine.newest(focused window)`, the focus back to its anchor; presses less than 120 ms apart are the key's auto-repeat: after 600 ms of it close all ([§9.3](../../docs/algorithms.md#93-keyboard)); `deeptip('escape_all')` (Shift+Esc) closes all |
| binding `deeptip('next' \| 'previous')` | F6 / Shift+F6: focus the next older / newer window (`engine.cycle`) |
| binding `deeptip('open' \| 'open_question')` | F1 / `?`: on a focused term follow it with the focus; on a focused marked widget `engine.open_pinned(widget, key, True, "key", now)` |
| `on_key` of a window | `Tab` / `Shift+Tab` cycle its terms, then pin and close, wrapping; `Enter` / `Space` on the body follow the focused term |
| timer | `sync()` |

`sync()` after every change:

1. `engine.tick(now)` runs the due timers ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)–[§7](../../docs/algorithms.md#7-timer-lock)).
2. `engine.retain_anchors(present)`: a marked widget is present while `widget.is_attached and widget.display`, a page term while its `DeepTipText` is attached and still has it ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). DeepTip is not told when the application removes a widget (only the widget itself gets `Unmount`), so this runs at the next pointer event or timer.
3. Remove the views of closed windows (`view.remove()`).
4. For every open window, oldest first (a child needs its parent's box): create the view if new, rebuild its content when new, pinned state or language changed, size and place it, `engine.set_rect` in nominal pixels, toggle `-flash`; mount new views.
5. A window opened by keyboard: `app.call_after_refresh(lambda: focus_window(id))` (its first term, else its pin button) ([§9.5](../../docs/algorithms.md#95-focus)).
6. `-dt-open` / `-dt-arming` on the marked widgets; post the messages of the engine's events.
7. Stop the old timer; if `engine.tick(now)` returns a due time, `app.set_timer((due - now) / 1000, sync)`.

## Placement in cells (§8)

DeepTip's constants are pixels. Give every cell a nominal size of 8 × 16 pixels (about the shape of a terminal cell), convert cells into those pixels, run `compute_placement` unchanged and convert back. Then the gap is one column, a window shrinks into a side only with at least 15 columns or 8 rows of room, the tendency padding is 1.5 columns, and windows are 30–48 columns wide and at most 30 rows high. This is the rule of the [Ratatui adapter](../rust-ratatui/README.md#3-cells-and-placement-8), checked there over 50,000 random placements.

```python
import math

def place_in_cells(w, h, anchor, sides, vp_w, vp_h, gap=8.0, cell=(8.0, 16.0)):
    """anchor = (x, y, width, height) in screen cells; returns (side, x, y, max_w, max_h) in cells."""
    cw, ch = cell
    ax, ay, aw, ah = anchor
    p = compute_placement({"w": w * cw, "h": h * ch},
                          {"left": ax * cw, "top": ay * ch, "right": (ax + aw) * cw, "bottom": (ay + ah) * ch},
                          sides, {"w": vp_w * cw, "h": vp_h * ch}, gap)
    fx, fy = p["x"] / cw, p["y"] / ch
    x = math.ceil(fx) if p["side"] == "right" else math.floor(fx)    # away from the anchor on the side's axis
    y = math.ceil(fy) if p["side"] == "bottom" else math.floor(fy)
    x = max(0, min(int(x), vp_w - w))                                # then inside the screen
    y = max(0, min(int(y), vp_h - h))
    return p["side"], x, y, int(p["maxW"] // cw), int(p["maxH"] // ch)
```

Target box: the parent window's box for children, the anchor box for roots. Sides: the widget's own `place` for roots, else `root` / `child`. When `max_w` or `max_h` comes back, measure again at that width or cut the height, and place again with that side only. A frozen root keeps its place. The viewport is `app.screen.size`; the limits are the screen minus 2·`GAP` (columns − 2, rows − 1).

## Input mapping (§9)

| Reference | Textual |
|---|---|
| pointer leaves the application | `App.on_app_blur` (terminal focus lost); terminals send nothing when the mouse leaves the window |
| hover | `App.on_mouse_move`; Textual turns on the terminal's any-motion mouse mode itself; without it (some terminals, multiplexers) there is no hover, every other path still works |
| click | `Click` on terms and in windows, `Button.Pressed`; a click on a marked widget stays the application's (only hushes it) |
| long-press, swipe (touch) | none in terminals; `F1` / `?` open the focused widget pinned |
| Esc, hold Esc, Shift+Esc | priority bindings; Textual's `Key` events carry no repeat or release information, so a hold is presses less than 120 ms apart; `shift+escape` arrives only where the terminal reports it (kitty keyboard protocol, Windows console) |
| F6, F1, `?` | `f6`, `shift+f6`, `f1`, `question_mark` |
| keyboard focus | `widget.focus()`, `app.focused`; DeepTip's term focus is an index inside `DeepTipBody` / `DeepTipText` |
| gamepad ([§9.4](../../docs/algorithms.md#94-gamepad)) | not available in a terminal; offer `dt.action(...)` to a host that reads one |

## Pitfalls

1. **`Pilot` bypasses `App.on_event`.** It forwards mouse events straight to the screen *(checked in `textual/pilot.py`)*, so a hook in `on_event` sees nothing in tests. Observe the bubbled messages in `on_mouse_move` / `on_mouse_down` instead: they reach the App from the terminal and from `Pilot` alike. A widget that calls `event.stop()` on `MouseMove` hides the pointer from DeepTip while it is over that widget.
2. **Declare the layer.** `layer: deeptip` needs `Screen { layers: default deeptip; }`; Textual adds its own `_toastrack` and `_tooltips` layers above.
3. **Compact buttons are still 16 wide**: `Button(compact=True)` keeps `min-width: 16`; set `min-width: 3; width: 3` *(checked)*.
4. **Key events bubble to the App before bindings run**, also when a widget's binding then handles the key *(checked)*. Handle DeepTip's keys in `on_key` with `event.stop()` and `event.prevent_default()`.
5. **A priority binding on `?` would steal the character from text fields.** `check_action` returns `False` while the focused widget is an `Input` or `TextArea`.
6. **Removing the focused widget moves the focus elsewhere** (to the previous focusable widget) *(checked)*: when a window closes with the focus inside, focus its anchor yourself.
7. **Measure with `Content`** (`wrap`, `get_height`), not with Rich: a Rich `Text` is converted and wrapped by Textual.
8. **Escape and maximized widgets:** with a maximized widget Textual's `App.on_event` minimizes it on Esc before any binding (`ESCAPE_TO_MINIMIZE`).
9. **Do not bind `ctrl+q` or `ctrl+c`** (quit, copy / help-quit in Textual's defaults).
10. **Terminal limits:** `F1` is taken by some terminals (GNOME Terminal's help, VS Code's integrated terminal); `?` works everywhere. Box drawing and `○ ● ✕ •` are ambiguous-width characters: with "ambiguous = wide" (CJK setups) frames break. Inside tmux a lone Esc waits for `escape-time`.
11. **Tests run in real time.** Timers are real `set_timer` timers: use short delays (e.g. `delay=300`) and `await pilot.pause(seconds)`; for exact timing of the Esc hold replace `dt.now` with a fake clock. `pilot.hover(None, offset=(x, y))` raises `OutOfBounds` outside the screen.

## Testing

Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases)): the pytest runner of the PySide6 guide, unchanged ([Testing there](../python-pyside6/README.md#testing)): `DEEPTIP_CASES=<DeepTip>/test/cases pytest -q tests/test_parity.py` → `24 passed`. Engine scenarios: port the tests of [`frameworks/rust-egui/tests/engine.rs`](https://github.com/gorduan/DeepTip/blob/main/frameworks/rust-egui/tests/engine.rs) (resting opens after the delay, grace, one preview per parent, a click pins the chain, flash, tendency up to 1.5 s, suppression, timer lock, hush, Esc and F6 targets, vanished anchors); they need no Textual.

The interface, headless with `App.run_test` and `Pilot`:

```python
import asyncio
from deeptip.tui import META

def test_term_preview_beside_its_parent():
    async def go():
        app = Hud("en", delay=300.0, link_delay=60.0, close_delay=200.0)
        async with app.run_test(size=(100, 30)) as pilot:
            await pilot.hover("#realm")
            await pilot.pause(0.45)                               # real timers
            realm = app.dt.views[app.dt.engine.wins[0].id]
            await pilot.pause()                                   # mounted and laid out
            r = realm.body.region
            cell = next((x, y) for y in range(r.y, r.bottom) for x in range(r.x, r.right)
                        if (m := app.screen.get_style_at(x, y).meta.get(META))
                        and realm.body.text.terms[m[1]][0] == "demo.province")
            await pilot.hover(None, offset=cell)
            await pilot.pause(0.2)
            assert [w.key for w in app.dt.engine.wins] == ["demo.realm", "demo.province"]
            child = app.dt.views[app.dt.engine.wins[1].id]
            await pilot.pause()
            assert not child.region.overlaps(realm.region)        # never on top of its parent
            await pilot.click(None, offset=cell)
            await pilot.pause()
            assert all(w.pinned for w in app.dt.engine.wins)      # a click pins the chain
    asyncio.run(go())
```

The prototype's 13 interface tests also cover: below the button with one row of air, Esc / Shift+Esc / Esc passing to an `Input` without windows, the Esc hold with a fake clock, F1 with the focus on the first term, `Tab` / `Enter` into a child and the focus back on Esc, `Tab` cycling terms → pin → close, `?` opening on a button but typed into an `Input`, click inside, pin and close buttons, grace, page terms by mouse and keyboard, the fallback badge, live values with `refresh()` and a locale switch, the bottom corner opening above, and a removed widget closing its preview.

## Example to build

The scene of every DeepTip example (`hud.py`): a `Horizontal` bar of compact `Button`s marked with `dt.mark`: Realm `demo.realm`, Stability `demo.stability` (a press cycles −3…+3, then `refresh()`), Taxes `demo.taxes` (cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, `?` with `deeptip.about` and `delay=0`, a language button (`set_locale`); corner buttons `demo.province`, `demo.prestige` (second row) and `demo.revolt`, `demo.unrest` (a row docked at the bottom, `place=("top", "right", "left")`); the intro as `DeepTipText`; an `Input` for the encyclopedia search; an event log fed by the messages. Options: `sources` = `glossary/core/{locale}.json` and `glossary/example/{locale}.json`, `fallback=("de", "en")`, `delay=1000`, live values `stability` and `gold` as callables. In English *Prestige* and *Gold* come from the German fallback and show the `DE` badge. CSS for the hooks: `Button.-dt-arming { text-style: underline; }`, `Button.-dt-open { color: $accent; }`. The texts of the screen are the web example's (`frameworks/web/example/index.html`).

## Limitations

- No hover where the terminal reports no plain pointer motion; no touch, long-press, swipe, vibration or gamepad.
- No accessibility roles; the flash is a heavy border, no animation; no reduced-motion query.
- Anchors that the application removes are noticed at the next pointer event or timer.
- Positions are whole cells: the vertical gap is a full row.
- List items have no hanging indent.

## Checklist

- [ ] Resting on a marked widget opens its window after `delay`, beside it with one cell of air; the widget's own press still works and hushes it.
- [ ] Hovering a term opens a child beside its parent window, never on top; a click pins it with its chain.
- [ ] Moving into a window keeps it open; terms crossed on the way do not open; leaving closes it after the grace time.
- [ ] `Esc` closes the newest window and does not reach the application; `Shift+Esc` or holding `Esc` closes all; pin and close buttons work; the focus returns to the anchor.
- [ ] `F1` or `?` opens the focused widget's window pinned with the focus inside; `Tab` and `Enter` follow terms; `F6` switches windows; `?` still types into inputs.
- [ ] A key already open further up the chain flashes; a missing key shows the key and `$ui.missing`.
- [ ] An entry from a fallback locale shows the badge; `set_locale` and `refresh()` update open windows and page texts.
- [ ] A long entry scrolls and stays on screen; the parity cases and the validator pass.
