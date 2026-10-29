# DeepTip for Ren'Py

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, into a Ren'Py visual novel: windows as screens above the game, terms as `{a=dt:…}` hyperlinks in any text, including say lines. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Ren'Py implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to Ren'Py.

Statements marked (checked) were verified on 2026-10-29 against **Ren'Py 8.5.3** (the SDK's documentation and its engine source in `renpy/`), and by running headless: every Ren'Py snippet below passed `renpy.py <project> lint` in a throwaway project (lint also runs the init code, which loaded the shared glossaries through `renpy.open_file` and checked file order and fallback), and a Python port of [§1], [§2] and [§8] passed all 24 shared cases on the Python that Ren'Py ships (3.12.7). No game window was opened, so behaviour that only shows at runtime (focus of nested buttons, measured text sizes) is marked (verify). The closest complete implementation is the [Python (PySide6) guide](../python-pyside6/README.md) for the pure functions and the Rust crate's `src/engine.rs` in [frameworks/rust-egui](../rust-egui/README.md) for the window tree.

**Download:** `DeepTip-renpy-1.0.0.zip` holds this guide with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** a `game/` folder with `*.rpy` scripts (`script.rpy`, `screens.rpy`, `options.rpy`, `gui.rpy`) and compiled `*.rpyc`, made with the Ren'Py SDK (`renpy.exe`, `renpy.sh`).

1. Write `game/deeptip_core.py` and `game/deeptip_renpy.py` (plain Python modules, section 1) and `game/deeptip.rpy` (screens and wiring, sections 7 and 9).
2. Run the parity runner with Ren'Py's Python until it prints `24/24 parity cases passed` (section 16).
3. Copy `glossary/core/*.json` to `game/deeptip/core/`; your own entries go to `game/deeptip/<locale>.json`.
4. Mark buttons with `hovered dt.Hover(key)`, `unhovered dt.Unhover(key)` and `alternate dt.Open(key)`, and terms in text with `{a=dt:key}…{/a}`.
5. Run `renpy.sh <project> lint`, then validate: `node <DeepTip>/tools/deeptip-check.mjs --base en game/deeptip/core/en.json game/deeptip/en.json`.

```renpy
init -10 python:
    import deeptip_renpy
    dt = deeptip_renpy.install(locale="en", fallback=["en"],
        sources=["deeptip/core/{locale}.json", "deeptip/{locale}.json"])

screen hud():
    textbutton "?":
        pos (20, 20)
        action NullAction()
        hovered dt.Hover("deeptip.about")      # rest the mouse on it: its window opens
        unhovered dt.Unhover("deeptip.about")
        alternate dt.Open("deeptip.about")     # long-press on touch, right click, gamepad X

label start:
    show screen hud
    "Rebels threaten your {a=dt:demo.province}province{/a}."
```

**Done when:** the parity runner prints `24/24 parity cases passed` and lint reports no errors, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without opening the game menu, the validator reports 0 errors.

## 1. Parts to build

| File | Content | Algorithms |
|---|---|---|
| `game/deeptip_core.py` | pure functions: `flatten(obj)`, `parse_text(src)`, `collect_refs(blocks)`, `compute_placement(size, anchor, sides, vp, gap)`; no Ren'Py imports | [§1.1], [§2], [§8] |
| `game/deeptip_engine.py` | the window tree and its timers as a state machine: open, close, pin, hot set, grace, tendency, suppression, arming, timer lock; time, boxes and the hover state are passed in | [§4]–[§7] |
| `game/deeptip_renpy.py` | the Ren'Py layer: `install()`, the controller (glossary layers, locale chain, markup → text tags, measuring, placement), the input displayable, the actions `Hover`, `Unhover`, `Open` | [§1.2], [§3], [§9] |
| `game/deeptip.rpy` | hyperlink wiring, styles, the screens `deeptip_layer` and `deeptip_window` | |
| `game/deeptip/core/<locale>.json`, `game/deeptip/<locale>.json` | copies of `glossary/core/` and your project glossary | |
| `tests/parity.py` | the parity runner (section 16), outside `game/` | [§11] |

Why plain `.py` modules: Ren'Py can import pure-Python modules placed in the game directory, and "Python defined in .rpy files is transformed to allow rollback to work. Python imported from .py files is not" (checked, Ren'Py documentation "First and Third-Party Python Modules"). DeepTip's state is interface state: it must neither be saved nor rolled back. Create the controller once in `init python` and never assign the variable again: variables set during init are not saved, and objects from `.py` modules are not tracked by rollback.

## 2. SPEC concept → Ren'Py primitive

| DeepTip | Ren'Py 8.5 |
|---|---|
| Controller | one object from `deeptip_renpy.install(...)` in `init python`, stored in the store variable `dt` |
| Top layer, window order | the screen `deeptip_layer` with `zorder 1000`, listed in `config.overlay_screens` (shown on the screens layer whenever the overlay is enabled, checked); windows are drawn in a `for` loop, oldest first, so the newest lies on top |
| Window ([§3]) | the screen `deeptip_window(w)`: a `button` (its action is `clickInsidePins`) with a `vbox` of header (`text` title, badge, pin and close `textbutton`s), body (`viewport` with `mousewheel True` around a `text`), "See also", hint |
| Rich text | text tags generated from the AST: `{b}`, `{i}`, `{u}`, `{color=#…}`, `{font=…}`, `{a=…}`; glossary text escaped (`{` → `{{`) and shown with `substitute False`, so `[…]` is not interpolated |
| Term | a hyperlink `{a=dt:<target>}label{/a}`. Its focus calls the third element of `style.default.hyperlink_functions` with the target, and with `None` when the focus leaves (checked in the documentation and in `Text.focus`/`unfocus`); a click calls the handler registered in `config.hyperlink_handlers["dt"]` with everything after `dt:` (checked) |
| Term box (page terms) | `renpy.focus_coordinates()` while the term has the focus: `(x, y, w, h)` of the focused area (checked) |
| Marked UI element (web: `data-deeptip`) | a button with `hovered dt.Hover(key)`, `unhovered dt.Unhover(key)`, `alternate dt.Open(key)`; `Hover` reads the button's box with `renpy.focus_coordinates()` (the button has the focus when `hovered` runs) |
| Element, window, term under the pointer | Ren'Py's focus: the hovered button or hyperlink; windows by their computed rectangles |
| Pointer samples ([§5]) | the input displayable's `event()` receives every `MOUSEMOTION` with `x`, `y` (section 9) |
| `now()`, `schedule()` | `time.monotonic() * 1000`; due times in the records; `renpy.timeout(seconds)` makes sure the input displayable gets an event before then (checked) |
| Consuming Esc | the input displayable is the last child of a screen on a layer above `config.underlay`, where the keymap lives: events go to the last-added child first and the underlay was added before the layers (checked in `display/core.py` and `display/layout.py`), so `raise renpy.IgnoreEvent()` hides Esc from the game menu (checked: documented) |
| Touch long-press | the button property `alternate`: on touch devices a press of `config.longpress_duration` (0.5 s, the SPEC value) within `config.longpress_radius` (15) runs it and vibrates `config.longpress_vibrate` (0.1 s) (checked in `display/behavior.py`) |
| Gamepad | Ren'Py posts `pad_<control>_<state>` events (`pad_y_press`, `pad_b_press`, `pad_leftshoulder_press` …) and maps them through `config.pad_bindings` (checked); `renpy.map_event(ev, "pad_b_press")` tests them |
| Vibration | `renpy.vibrate(seconds)`, Android only (checked) |
| Rest progress (`data-dt-arming`) | `dt.arming(id)` → 0‥1 or `None`, for a bar in your own screen |
| Open state (`data-dt-open`) | `dt.is_open(id)`; hide your own `tooltip` while it is true |
| `onOpen`, `onClose`, `onPin` | options `on_open`, `on_close`, `on_pin` |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | Ren'Py's self-voicing reads focused buttons and text (`alt` text); DeepTip windows are ordinary displayables, so give the window buttons `alt` texts |

## 3. Data structures

```python
# game/deeptip_engine.py (excerpt): one open window
class Win(object):
    def __init__(self, wid, key, parent, anchor, via):
        self.id = wid                # 1, 2, 3 …
        self.key = key
        self.parent = parent         # the Win that contains the term it came from; None for roots
        self.anchor = anchor         # "m:<id>" for marks, "t:<win>:<key>:<n>" for terms in windows, "p:<target>" for page terms
        self.via = via               # "hover", "click", "key", "touch", "pad", "api"
        self.children = []           # windows opened from terms in this one, oldest first
        self.pinned = False
        self.frozen = False          # a pinned root whose anchor vanished (§4.5)
        self.leave_since = None      # grace (§5)
        self.check_at = None
        self.flash_at = None
        self.rect = None             # (left, top, right, bottom) as placed, virtual pixels
        self.anchor_rect = None      # the root's anchor box as last seen
```

Anchors are strings, so a term laid out again after a language switch is still the same anchor. Inside windows the hyperlink target carries the anchor: DeepTip writes `{a=dt:7.0:demo.unrest}` (window 7, first occurrence of `demo.unrest`), authors write `{a=dt:demo.province}` in say lines and screens (a page term).

Controller state: `data` (locale → dict key → entry, in file order), `labels`, `wins` (oldest first), `hover` (`win`, `link`, `trig`), `hot`, `pending` ([§6]), `quiet`, `samples`, `lock` ([§7]), `marks` (id → key, box, options), `esc_at`, `pad_b_at`, `views` (per window: position, size, the generated text of title, body, "See also" and hint).

## 4. Look (from `frameworks/web/deeptip.css`)

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| text `--dt-fg` | `#1F2328` | `#E6E8EC` |
| frame, hint separator `--dt-border` | `#C8CDD5` | `#3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `#0B69D4` | `#58A6FF` |
| term `--dt-link` | `#0B69D4` | `#6CB6FF` |
| term under the pointer `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| missing term `--dt-missing` | `#DD3333` | same |

The web values are CSS pixels for a desktop browser. Ren'Py games are laid out in virtual pixels (`config.screen_width` × `config.screen_height`, often 1920×1080) and scaled to the window, so multiply every pixel value by `k = config.screen_height / 540` (2.0 at 1080p, 1.33 at 720p): font 14·k, line spacing 7·k (line height 1.5), padding 12·k, window width 240·k–384·k, max height 480·k, gap 8·k, frame 1·k, buttons 26·k (40·k on touch: `renpy.variant("touch")`). Rounded corners need an image: `Frame("gui/deeptip_window.png", 8·k, 8·k)` with a rounded, bordered 9-slice; a `Solid()` gives square corners. Text tags have no background colour, so an open term is shown in the hover colour and bold instead of the web's 16 % background. Hint line at 0.75 of the body size, "See also" at 0.9, fallback badge at 0.7. Motion: fade in with an ATL `on show` (`alpha 0.0` → `linear 0.15 alpha 1.0`), the lock bar as a `bar` or a `Solid` whose width grows over `lockAfter`, flash = the pinned frame image for 0.6 s.

```renpy
style deeptip_window is frame:
    background Frame(Solid("#1B1E24"), 0, 0)
    padding (24, 12, 24, 20)

style deeptip_title is text:
    size 28
    bold True
    color "#E6E8EC"

style deeptip_body is text:
    size 28
    line_spacing 14
    color "#E6E8EC"

style deeptip_term is hyperlink_text:
    color "#6CB6FF"
    hover_color "#9CCFFF"
    underline True
```

`deeptip_badge`, `deeptip_see`, `deeptip_hint` and `deeptip_button` follow the same pattern with the sizes above.

## 5. Order of operations per interaction and frame

Ren'Py redraws and delivers events inside interactions; DeepTip runs in the input displayable's `event()` and in the actions:

1. **Events** reach the input displayable first (section 2): `MOUSEMOTION` → add a sample `(x, y, now)` and drop samples older than 120 ms while more than 2 remain ([§5]); keys and pad events → section 9 (consumed with `raise renpy.IgnoreEvent()` when DeepTip used them); then, when nothing was consumed, the event goes on to the windows, the game's screens and the underlay keymap.
2. **Focus changes** call `Hover` / `Unhover` (marks) and the hyperlink focus function (terms): they set `hover.trig` or `hover.link` and run [§6] "on pointer over": reset `quiet`, `refresh_hot()`, `lock_track()`, then `arm()` or `disarm()`. `hover.win` is the newest window whose rectangle contains the pointer, computed from the samples.
3. **Due times**, checked in every `event()` call (and guaranteed by `renpy.timeout(next_due - now)`): the pending arm (open, or wait another 90 ms while the pointer heads into another preview); each unpinned window's grace check ([§5]: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the timer lock ([§7]); Esc or gamepad B held ≥ 600 ms; the end of a flash.
4. **Any change of the window tree** → lay out the changed windows again (section 6), place them (section 7) and call `renpy.restart_interaction()`, which re-evaluates `deeptip_layer` with the new `dt.views()`.
5. **Clicks** run the window's actions (`toggle_pin`, `close`, `click_inside`) and the hyperlink handler (`follow`), which change the tree and restart the interaction.

Marks gone ([§4.5]): a mark whose screen was hidden never calls `Unhover` again; check in step 4 that a root's mark was hovered or focused within the current interaction (`renpy.get_screen(name)` tells whether its screen is still shown), close previews of vanished marks and freeze pinned roots at their last box.

## 6. Text: markup → Ren'Py text tags [§3]

Walk the AST of `parse_text` ([§2]) and build one string per text part:

| Node | Ren'Py text |
|---|---|
| text | the text with `{` doubled (`{{`); shown with `substitute False`, so `[` stays literal |
| br | `\n` |
| p | blocks joined with `\n\n` |
| ul | items as `•` + space + text, joined with `\n` (indent with `{space=…}` after line breaks if you want hanging bullets) |
| b, i | `{b}…{/b}`, `{i}…{/i}` |
| code | `{font=DejaVuSansMono.ttf}…{/font}` (a monospace font in `game/`), or `{color=#…}` |
| var | `{b}value{/b}` (the value escaped like text) |
| link, own key | `{b}label{/b}` |
| link, missing key | `{color=#DD3333}{u}label{/u}{/color}`, one warning |
| link | `{a=dt:<window>.<n>:<key>}label{/a}`: the window id and the occurrence number make the anchor; an open term additionally `{b}` |

```python
def esc(s):                      # glossary text must never become Ren'Py text tags
    return s.replace("{", "{{")
```

Measure before placing: the window needs its size for [§8] before it is shown. `Text(markup, style="deeptip_body", substitute=False).size(width)` returns the laid-out `(width, height)` in virtual pixels (exists in 8.5.3 with this signature, `size(width=4096, height=4096, st=0, at=0)`, but is not in the documentation; checked in the source, behaviour (verify)). Natural width ([§8] step 3): measure the body unwrapped (`size(4096)`), clamp the width to 240·k‥384·k minus the padding, measure again at that width for the height, and add the header, "See also" and hint heights and the paddings.

## 7. Windows: build, place, draw [§8]

```python
def place(dt, w, size):
    vw, vh = renpy.config.screen_width, renpy.config.screen_height       # virtual pixels
    k, gap = vh / 540.0, 8 * vh / 540.0
    a = w.parent.rect if w.parent else w.anchor_rect                    # children sit beside the parent window
    box = {"left": a[0], "top": a[1], "right": a[2], "bottom": a[3]}
    p = core.compute_placement({"w": size[0], "h": size[1]}, box, dt.sides(w), {"w": vw, "h": vh}, gap)
    if p["maxW"] or p["maxH"]:                                          # shrink into the side with most room
        size = dt.measure(w, max_w=p["maxW"] or None, max_h=p["maxH"] or None)
        p = core.compute_placement({"w": size[0], "h": size[1]}, box, [p["side"]], {"w": vw, "h": vh}, gap)
    w.rect = (p["x"], p["y"], p["x"] + size[0], p["y"] + size[1])
```

`dt.sides(w)`: roots use the mark's own order (`dt.Hover(key, place="top,bottom")`) if set, else `root` (`bottom, top, right, left`); children use `child` (`left, right, top, bottom`). The screens draw what the controller computed:

```renpy
screen deeptip_layer():
    zorder 1000
    for w in dt.views():
        use deeptip_window(w)
    add dt.input

screen deeptip_window(w):
    button:
        style "deeptip_window"
        pos (w.x, w.y)
        xsize w.w
        action Function(dt.click_inside, w.id)
        has vbox
        hbox:
            text w.title style "deeptip_title" substitute False
            if w.badge:
                text w.badge style "deeptip_badge" substitute False
            if w.pin_button:
                textbutton w.pin_label style "deeptip_button" action Function(dt.toggle_pin, w.id)
            if w.close_button:
                textbutton w.close_label style "deeptip_button" action Function(dt.close, w.id, True)
        viewport:
            mousewheel True
            ymaximum w.body_h
            text w.body style "deeptip_body" substitute False
        if w.see:
            text w.see style "deeptip_see" substitute False
        if w.hint:
            text w.hint style "deeptip_hint" substitute False
```

Window content follows the order of [§3]: header (title; fallback badge with the source locale in upper case when the entry came from a fallback locale; pin button if `pin_button`; close button if `close_buttons`), body (`body`, else `short`, else `label("missing")`), "See also" (`label("seeAlso")` and one term per key), hint `label("hint")` when `hints` is on and the window is a preview. The window is a `button` so a click on plain text pins it (`click_inside_pins`); its hyperlinks and text buttons are focused instead of the window when the pointer is on them (verify: nested focusables inside a button). Because a window is placed beside the box it came from, a child never covers its parent; it may cover older windows.

## 8. Coordinates and scale

- Screens, focus rectangles and the event coordinates of displayables use virtual pixels (`config.screen_width` × `config.screen_height`), which Ren'Py scales to the window. DeepTip computes in them, y down, the space of [§8]; the viewport is `{"w": config.screen_width, "h": config.screen_height}`.
- `renpy.focus_coordinates()` and the rectangles of `CaptureFocus(name)` / `GetFocusRect(name)` are `(x, y, w, h)` (checked in `display/focus.py`; the documentation of `GetFocusRect` writes `(x, y, h, w)`, a typo).
- The input displayable must cover the whole screen at `(0, 0)`, so the `x`, `y` it receives are screen coordinates.
- `renpy.get_mouse_pos()` gives the pointer at any time (checked), for example right after a window opened.

## 9. Input details [§9]

```python
# game/deeptip_renpy.py (excerpt)
import time
import renpy.exports as renpy
import renpy.pygame as pygame

class Input(renpy.Displayable):
    """Full screen, invisible, not focusable: pointer samples, keys, pad buttons, timers."""

    def __init__(self, dt, **properties):
        super(Input, self).__init__(**properties)
        self.dt = dt

    def render(self, width, height, st, at):
        return renpy.Render(0, 0)

    def event(self, ev, x, y, st):
        dt = self.dt
        if ev.type == pygame.MOUSEMOTION:
            dt.pointer_moved(x, y, time.monotonic() * 1000)
        if dt.wins and renpy.map_event(ev, "K_ESCAPE"):
            if renpy.map_event(ev, "shift_K_ESCAPE"):
                dt.close_all()
            else:
                dt.close_newest()
            renpy.restart_interaction()
            raise renpy.IgnoreEvent()            # the game menu (keymap in config.underlay) never sees it
        due = dt.next_due()
        if due is not None:
            renpy.timeout(max(0.0, (due - time.monotonic() * 1000) / 1000))
        return None
```

| Reference | Ren'Py |
|---|---|
| pointer leaves the game | Ren'Py sets `renpy.display.interface.mouse_focused` from `ACTIVEEVENT` (checked in `display/core.py`); test it in `event()` and, when it turned false: `hover = {}`, `disarm()`, `lock_track(None)`, `refresh_hot()` (verify that an event reaches the displayable then; `renpy.timeout` guarantees a later one) |
| click ([§9.1]) | hyperlinks: the handler in `config.hyperlink_handlers["dt"]` gets everything after `dt:` → `follow(term, its window, False)`; it returns `None`, or the interaction ends (checked); pin and close: `textbutton` actions; window: the `button` action `click_inside` |
| hush ([§9.2]) | a mark's own `action` runs on click: wrap it, `[dt.Hush(key), YourAction()]` |
| touch ([§9.2]) | `alternate dt.Open(key)` on marks (long-press, section 2); a tap on a term is its click; outside taps: `MOUSEBUTTONDOWN` in `event()` outside every window while `renpy.variant("touch")` → close all |
| Esc, Shift+Esc, hold Esc | `renpy.map_event(ev, "K_ESCAPE")`: without a `shift_` or `noshift_` prefix a keysym matches with and without Shift, so test `shift_K_ESCAPE` first (checked in `compile_event`). Holding: key repeat starts after 0.3 s (`config.key_repeat = (0.3, 0.03)`, checked), so `repeat_K_ESCAPE` events while `now - esc_at ≥ 600` close all. |
| F6, Shift+F6 | `K_F6` / `shift_K_F6` in `event()` while windows are open: focus the first term of the next older (newer) window with `renpy.display.focus.force_focus` (verify) or by restarting the interaction with that window's `default_focus` |
| open keys F1, `?` | `K_F1` is Ren'Py's `help` key by default (`help = ['K_F1', 'meta_shift_/']`, checked): when a mark or term has the focus, open its window pinned and `raise renpy.IgnoreEvent()`; otherwise let it pass. `?` arrives as a `TEXTINPUT` event with `ev.text == "?"`. |
| typing | not relevant: marked `input` displayables are rare; call `dt.hush(id)` from your `InputValue` if you mark one |
| gamepad ([§9.4]) | default bindings (checked): `pad_a_press` → `button_select` (activates the focused hyperlink or button: native follow), `pad_b_press` → `game_menu`, `pad_y_press` → `hide_windows`, `pad_x_press` → `button_alternate`, shoulders → rollback / rollforward, d-pad and stick → `focus_left/right/up/down`. In `event()`: `pad_b_press` with windows open → close newest and consume (held: `repeat_pad_b_press` arrives after 0.25 s, then every 0.05 s, checked → close all at 600 ms); `pad_y_press` with a focused mark or term → open pinned, consume; `pad_leftshoulder_press` / `pad_rightshoulder_press` with windows open → focus the newer / older window, consume (otherwise they roll back). |

Keyboard and gamepad focus inside windows is Ren'Py's own: arrows, the d-pad and the stick move the focus between the hyperlinks and buttons on screen (verify that hyperlinks of a `viewport` child are reached in the order you expect), and Enter or A activates. `Tab` is `toggle_skip` by default (checked), so DeepTip does not use it.

```renpy
init -10 python:
    import deeptip_renpy

    dt = deeptip_renpy.install(locale="en", fallback=["de", "en"],
        sources=["deeptip/core/{locale}.json", "deeptip/example/{locale}.json"])

    # terms in any text: {a=dt:key} (pages, say lines) and {a=dt:<window>.<n>:key} (inside windows)
    config.hyperlink_handlers["dt"] = dt.link_clicked

    _dt_default = style.default.hyperlink_functions
    def _dt_styler(target):
        if target.startswith("dt:"):
            return style.deeptip_term
        default_styler = _dt_default[0]
        return default_styler(target)
    style.default.hyperlink_functions = (_dt_styler, _dt_default[1], dt.link_focus) + tuple(_dt_default[3:])

    config.overlay_screens.append("deeptip_layer")
```

The default `hyperlink_functions` are `(hyperlink_styler, hyperlink_function, None, hyperlink_sensitive)` (checked in `common/00defaults.rpy`): the clicked function dispatches by protocol to `config.hyperlink_handlers`, so registering `"dt"` is enough for clicks; the focus function (third) is new and must ignore targets that do not start with `dt:` and return `None`.

## 10. Focus for keyboard and gamepad [§9.5]

Ren'Py's focus is DeepTip's focus: a window opened by keyboard or gamepad gets the focus on its first term (`default_focus 1` on that hyperlink's text is not available per hyperlink; use the window's first `textbutton` with `default_focus`, or `renpy.display.focus.force_focus(displayable)` (exists, undocumented: verify)). When the focused window closes, the focus returns to its anchor: Ren'Py restores focus to the button that was focused before when it is still on screen (verify), else give the anchor `default_focus`. The window with the focus is the window that contains the focused hyperlink or button (`renpy.display.focus.get_focused()`).

## 11. Timers [§5]–[§7]

Due times, compared with `time.monotonic() * 1000` in the input displayable's `event()`. `renpy.timeout(seconds)` "causes an event to be generated before seconds seconds have elapsed" (checked), so `event()` always runs in time; the screen statement `timer 0.05 repeat True action Function(dt.tick)` is an alternative. Animated parts (lock bar, flash, rest bar) need redraws: `renpy.redraw(displayable, 0)` in their `render()` while they run (checked), or ATL transforms.

## 12. Loading the JSON in file order [§1]

Python's `json` keeps the key order of the file (dicts are ordered), so `flatten` sees the file order directly; a duplicate key keeps its first position and its last value, as in JavaScript. Read the files through Ren'Py's loader, which also finds files inside `.rpa` archives and on Android:

```python
import json
import renpy.exports as renpy
import deeptip_core as core

def load(self):
    for locale in self.chain():
        for template in self.sources:
            path = template.replace("{locale}", locale)
            if path in self.read:
                continue
            self.read.add(path)
            if not renpy.loadable(path):
                print("DeepTip: missing", path)              # a warning, not an error
                continue
            with renpy.open_file(path, encoding="utf-8") as f:
                obj = json.load(f)
            entries, meta, problems = core.flatten(obj)
            self.data.setdefault(locale, {}).update(entries)  # a later layer wins per key
            self.labels.setdefault(locale, {}).update(meta.get("$ui") or {})
```

`renpy.loadable(filename)` and `renpy.open_file(fn, encoding=None)` exist with these signatures (checked); this exact code loaded the shared glossaries in the lint run (the English map started with `deeptip.about`, `deeptip.term`, `deeptip.pin`, the file order, and `demo.gold` came from the German fallback). Paths are relative to `game/`. The locale of a file is its `$locale`, else the last dot part of its name.

## 13. Live values, language, refresh [§4.6]

- `vars`: a dict name → value or function `(key) → value`, or one function `(name, key)`. Store variables (`default stability = 1`) are read through `renpy.store`: `vars={"stability": lambda key: "%+d" % renpy.store.stability}`. `None` keeps `{name}` visible ([§1.2]).
- `dt.refresh()`: generate every open window's text again, re-attach each child to the term with the same anchor in its parent, re-place what is not frozen, `renpy.restart_interaction()`. Call it after your values changed (an action list `[SetVariable("stability", 2), Function(dt.refresh)]`).
- Language: Ren'Py's languages are names chosen by the game (`None` for the default, `"german"`, …), switched with `renpy.change_language(language)` (checked) and stored in `_preferences.language`. Give DeepTip a map (`{None: "en", "german": "de"}`) and append `dt.on_language` to `config.change_language_callbacks` (exists in `config.py`, checked) so it calls `dt.set_locale()`, which loads the files not read yet and refreshes.

## 14. Porting the pure functions to Python [§2] [§8]

Ren'Py 8.5.3 runs Python 3.12.7 (checked). Use the pure core of the [PySide6 guide](../python-pyside6/README.md#the-pure-core-1-2-8) as it is: `KEY_RE.fullmatch`, JavaScript's whitespace set instead of `str.strip()`, `ratio()` for divisions by zero, booleans compared by type in tests. Exactly that port passed the 24 cases on Ren'Py's interpreter (section 16). Keep it in a `.py` module: in `.rpy` files Ren'Py rewrites Python for rollback (lists and dicts become revertable types), which the parity runner does not need.

## 15. API to offer

| Call | Does |
|---|---|
| `deeptip_renpy.install(**options)` | the controller; options of [SPEC §7](../../SPEC.md#7-configuration-reference-names) in snake_case (`delay`, `link_delay`, `close_delay`, `lock_after`, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `open_keys`, `gamepad`) plus `languages` (Ren'Py language → locale), `on_open`, `on_close`, `on_pin` (`long_press` is `config.longpress_duration`) |
| `dt.Hover(key, id=None, delay=None, place=None)`, `dt.Unhover(key, id=None)`, `dt.Open(key, id=None)`, `dt.Hush(key, id=None)` | screen actions for marked buttons |
| `{a=dt:key}label{/a}` | a term in any text (say lines, screens) |
| `dt.index_text()` | the encyclopedia ([§12]) as one text with terms, for a `viewport` in your own screen |
| `dt.set_locale(locale)`, `dt.set_value(name, v)`, `dt.refresh()` | data ([§1.2], [§4.6]) |
| `dt.open(key, anchor, pinned)`, `dt.close_all()` | windows from code |
| `dt.has_windows()`, `dt.is_open(id)`, `dt.arming(id)` | for the game's own screens and tooltips |

## 16. Tests [§11]

Parity cases on the Python that Ren'Py ships (no game is started): `<SDK>/lib/py3-windows-x86_64/python.exe tests/parity.py <DeepTip>/test/cases` (`lib/py3-linux-x86_64/python`, `lib/py3-mac-universal/python` elsewhere):

```python
# tests/parity.py — the 24 shared cases against game/deeptip_core.py
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "game"))
import deeptip_core as core

cases = pathlib.Path(sys.argv[1])
def load(name): return json.loads((cases / name).read_text(encoding="utf-8"))["cases"]
def strict(x):                                   # keep booleans apart from 1/0 (True == 1 in Python)
    if isinstance(x, bool): return ("bool", x)
    if isinstance(x, dict): return {k: strict(v) for k, v in x.items()}
    if isinstance(x, list): return [strict(v) for v in x]
    return x
total = failed = 0
def check(name, ok):
    global total, failed
    total += 1
    if not ok:
        failed += 1
        print("FAIL", name)
for c in load("markup.json"): check(c["name"], core.parse_text(c["src"]) == c["blocks"])
for c in load("placement.json"):
    check(c["name"], strict(core.compute_placement(c["size"], c["anchor"], c["sides"], c["viewport"])) == strict(c["expect"]))
for c in load("glossary.json"):
    entries, meta, problems = core.flatten(c["input"])
    check(c["name"], {"keys": list(entries), "meta": list(meta), "problems": len(problems)} == c["expect"])
print(f"{total - failed}/{total} parity cases passed ({sys.version.split()[0]})")
sys.exit(1 if failed or not total else 0)
```

Expected: `24/24 parity cases passed (3.12.7)` (checked). Then `renpy.sh <project> lint`: lint runs the init code too, so errors in loading or wiring show up there; its exit code is 0 even when it reports an exception, so read the report. Lint (and compile) copy the scripts into a `backups` folder in the user's save area (`%APPDATA%\RenPy\backups` on Windows); set the environment variable `RENPY_DISABLE_BACKUPS` to `I take responsibility for this.` for throwaway runs (checked in `script.py`). Behaviour: `engine.py` takes `now` as an argument, so plain Python tests can check the invariants of [§4], grace and tendency ([§5]) and suppression without Ren'Py; compare the feel with the web example (`npm run demo`).

## 17. The example to build

The scene of every DeepTip example, in `game/script.rpy` and a `hud` screen, with the shared glossaries in `game/deeptip/core/` and `game/deeptip/example/`:

- A top bar (`hbox` of `textbutton`s) with `hovered`/`unhovered`/`alternate` actions: Realm `demo.realm`, Stability `demo.stability` (action: cycle −3…+3, then `Function(dt.refresh)`), Taxes `demo.taxes` (cycle low/normal/high, add gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and `delay=0`; a language button calling `Language("german")` / `Language(None)`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- A say line with terms: `"Rebels threaten your {a=dt:demo.province}province{/a}: watch {a=dt:demo.unrest}unrest{/a}."`.
- Options: `sources=["deeptip/core/{locale}.json", "deeptip/example/{locale}.json"]`, `fallback=["de", "en"]`, `delay=1000`, `vars={"stability": lambda key: "%+d" % renpy.store.stability, "gold": lambda key: str(renpy.store.gold)}`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.

## 18. Pitfalls

1. **Interpolation and text tags**: glossary text shown in a `text` must use `substitute False` (else `[name]` is interpolated) and double `{` (else it is a tag). The same text in a say line needs `[[` as well.
2. **Rollback and saves**: classes and containers defined in `.rpy` Python are revertable and become part of rollback; keep DeepTip in `.py` modules and never reassign `dt` after init (section 1).
3. **Default bindings**: Esc and right click open the game menu, F1 opens help, Tab toggles skipping, the shoulders roll back and forward, Y hides the windows, B opens the game menu (checked). DeepTip consumes only what it uses, only while it uses it.
4. **The hyperlink focus function sees every hyperlink**, including `jump:` links of the game: ignore other protocols.
5. **Hyperlink handlers end the interaction** when they return a value (checked): DeepTip's handler returns `None`.
6. **Overlay screens are hidden when the overlay is suppressed** (menus with `suppress_overlay`): close previews then, or show `deeptip_layer` yourself in those screens.
7. **Lint's exit code** is 0 even with errors; read the report.
8. **Script backups** on the user's drive during lint and compile (section 16).
9. **Virtual pixels**: never mix `renpy.get_physical_size()` with screen coordinates.

## 19. Limitations

- Text tags have no background colour: an open term is marked by colour and weight, not by the 16 % background of the web.
- Terms inside windows and say lines are Ren'Py hyperlinks: their hover is focus, so moving onto a term with the keyboard previews it as well (the web previews only on pointer hover).
- The touch long-press duration is `config.longpress_duration` (shared with every `alternate` button), and `alternate` also fires on right click and gamepad X.
- Not run in a game window for this guide (see the intro).

## 20. Checklist

1. `game/deeptip_core.py`; the parity runner prints `24/24 parity cases passed` on Ren'Py's Python (section 16).
2. `game/deeptip_engine.py` ported from algorithms [§4]–[§7] (or from `frameworks/rust-egui/src/engine.rs`) with plain Python tests.
3. `game/deeptip_renpy.py`: loading (section 12), text tags and measuring (section 6), placement (section 7), the input displayable and actions (section 9).
4. `game/deeptip.rpy`: wiring, styles, screens; `lint` reports no errors.
5. The example (section 17); compare with the web example by hand.
6. The validator reports 0 errors for your glossaries; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.1]: ../../docs/algorithms.md#11-flattening-one-glossary-file
[§1.2]: ../../docs/algorithms.md#12-layers-locales-lookup
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
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
