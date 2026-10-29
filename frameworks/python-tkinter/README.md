# DeepTip for Python with Tkinter: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Tkinter application, Python 3.10 or newer with Tk 8.6, no dependencies.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Tkinter. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. The pure Python parts (parser, placement, glossary) are the same as in the [PySide6 guide](../python-pyside6/README.md), which this guide links instead of repeating. Statements marked *(checked)* were verified on 2026-10-29 with **Python 3.13.5 and Tcl/Tk 8.6.15** (windowing system `win32`, Windows 11) without anything visible on screen: a withdrawn root, and where Tk needs a mapped window an override-redirect toplevel with alpha 0 at (−30000, −30000) that never takes the foreground; some points were read in the Tk 8.6.15 sources (`tkFocus.c`, `tkWinWm.c`, `text.tcl`). *(verify)* marks what could not be checked there, mostly X11 and macOS.

## Quick start

**Recognise the project:** `import tkinter` (often `from tkinter import ttk`), a `tk.Tk()` root and `mainloop()` in the Python sources; nothing in `requirements.txt` (Tkinter ships with CPython; on Debian and Ubuntu it is the package `python3-tk`).

1. Write `deeptip/core.py` as in the PySide6 guide ([The pure core](../python-pyside6/README.md#the-pure-core-1-2-8)) and pass the parity cases: `DEEPTIP_CASES=<DeepTip>/test/cases pytest -q` must report `24 passed` (section 13.1).
2. Write `deeptip/glossary.py`, `deeptip/render.py` and `deeptip/tk.py` (section 1) in the order of operations of section 7.
3. Copy `glossary/core/<locale>.json` to `deeptip/core/`; your own entries go to `deeptip/<locale>.json` (section 10).
4. Create one controller after `tk.Tk()` and mark widgets (below).
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```python
import tkinter as tk
from deeptip.tk import DeepTip

root = tk.Tk()
dt = DeepTip(root, locale="en", sources=["deeptip/core/{locale}.json", "deeptip/{locale}.json"])
help_button = tk.Button(root, text="?")
help_button.pack(padx=40, pady=40)
dt.mark(help_button, "deeptip.about")      # the controller keeps key, delay and sides per widget path
root.mainloop()
```

**Done when:** `pytest -q` reports `24 passed`, resting on `?` for 800 ms opens the *DeepTip* window below it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without reaching your own `<Escape>` bindings, the validator reports 0 errors.

## 1. Parts to build

| File | Content | Tk types |
|---|---|---|
| `deeptip/core.py` | `flatten`, `parse_text`, `collect_refs`, `compute_placement` ([§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement)), identical to the [PySide6 core](../python-pyside6/README.md#the-pure-core-1-2-8); the parity cases test it | no |
| `deeptip/glossary.py` | layers, locale chain, `entry(key)`, `label(name)`, live values, file loading ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) | no |
| `deeptip/engine.py` | window tree, hot set, grace, tendency, arming, lock ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock)) against a small host interface and a clock, so it runs in tests without Tk | no |
| `deeptip/render.py` | AST → runs with tags in a `tk.Text` ([§3](../../docs/algorithms.md#3-rendering-the-ast)), term hit-testing | `Text` |
| `deeptip/tk.py` | the controller `DeepTip` (bindings, timers, focus) and the view `TipWindow` | `Toplevel`, `Frame`, `Text`, `Label`, `Canvas` |
| `deeptip/core/<locale>.json` | copies of `glossary/core/` | – |
| `tests/test_parity.py` | the parity runner of the PySide6 guide, unchanged | no |

## 2. SPEC concept → Tkinter primitive

| SPEC | Tkinter |
|---|---|
| Controller | one `DeepTip` per `tk.Tk` root; global bindings with `root.bind_all(…, add="+")` plus one own bindtag `DeepTipKeys` (section 7.3) |
| Window (popover in the top layer) | `tk.Toplevel(root)` with `overrideredirect(True)`: no title bar, no taskbar button; on Windows it is a `WS_POPUP` with `WS_EX_TOOLWINDOW` *(checked in `tkWinWm.c` and on the window)* |
| Stacking order | Windows: make the host window the native owner of each root window and each window the owner of its children (section 4.1), then owned windows stay above their owner *(checked)*; elsewhere `lift()` after the host was raised *(verify)* |
| Overlay alternative | a `Frame` placed with `place(x=…, y=…)` in the host toplevel and `lift()`ed: one coordinate space, no native windows, but the host window is the viewport |
| Rich text | a read-only `tk.Text` (`wrap="word"`, `state="disabled"` after filling) with tags for bold, italic, code, values and terms |
| Term (a real button) | a tagged range: `dt-link` for the look, `dt-term-N` for identity; hit-tested from the global pointer handler (section 4.2); keyboard focus is emulated (section 7.5) |
| Marked UI element (`data-deeptip`) | `dt.mark(widget, key, delay=None, place=None)` stores the options in a dict keyed by the widget path `str(widget)`; a `<Destroy>` binding removes it. Tk widgets have no free properties. |
| Element / window under the pointer | `root.winfo_containing(x_root, y_root)` (the deepest widget), then walk `.master` up to the first `TipWindow` or marked widget |
| Anchor box | `(w.winfo_rootx(), w.winfo_rooty(), w.winfo_width(), w.winfo_height())`, screen pixels |
| Viewport | the work area of the monitor that contains the target (section 6) |
| Pointer | `<Motion>` through `bind_all`, `e.x_root`, `e.y_root` |
| `now()`, `schedule()` | `time.monotonic() * 1000`; `id = root.after(ms, f)`, cancel `root.after_cancel(id)` |
| Rest progress, open state (`data-dt-arming`, `data-dt-open`) | callbacks `on_arming(widget, ms)` (ms < 0: ended) and `on_open_state(widget, bool)`, so the host can draw a progress bar or suppress its own simple tooltip |
| `onOpen`, `onClose`, `onPin` | callbacks `on_open(key, view)`, `on_close(key)`, `on_pin(key, view)` |
| Screen reader | none in Tk 8.6 (section 8) |
| Theme (`--dt-*`) | one `Theme` object with the values of section 5, applied as widget and tag options |

## 3. Data structures

The window record is the `Win` dataclass of the [PySide6 guide](../python-pyside6/README.md#data) with `@dataclass(eq=False)` (identity semantics, windows go into sets), with these differences: `close_timer` and the other timers hold the string id returned by `after()` (or `None`), `view` is the `TipWindow`, and a term anchor is the pair `(win, n)` where `n` is the index of the `dt-term-N` tag; `occurrence` (the how-many-th term with the same key) lets `refresh()` find the term again after re-rendering ([§4.6](../../docs/algorithms.md#46-refresh)).

Controller state: `data` (locale → {key → entry}), `labels`, `wins` (oldest first), `hover = (win, link, trig)`, `hot: set`, `pending = (el, after_id)`, `samples: collections.deque` of `(x, y, t)`, `quiet`, `lock_win`, `esc_down`, `esc_at`, `kbd` (the last activation came from the keyboard), `marked: dict[str, MarkOptions]` keyed by widget path.

## 4. Windows and terms

### 4.1 The window: an override-redirect `Toplevel`

```python
class TipWindow(tk.Toplevel):
    def __init__(self, dt, host: tk.Misc, theme):
        super().__init__(host.winfo_toplevel())
        self.withdraw()                        # never shown before it is placed
        self.overrideredirect(True)            # before the first map; toggling it later replaces the native window
        self.frame = tk.Frame(self, bg=theme.bg, highlightthickness=1,
                              highlightbackground=theme.border, highlightcolor=theme.border)
        self.frame.pack(fill="both", expand=True)
        # header, body Text, "See also" Text, hint Label, lock bar: section 4.3
```

Showing a window ([§4.1](../../docs/algorithms.md#41-openkey-anchor-parent--none-pinned--false-focus--false)): fill the content, `attributes("-alpha", 0.0)`, `geometry(f"{w}x40+{x}+{y}")` at a provisional position, `deiconify()`; the body `Text` gets its real width only once the window is mapped (before that `winfo_width()` is 1 *(checked)*), so measure and place in the body's first `<Configure>` event (section 6), then `attributes("-alpha", 1.0)` and `lift()`. Avoid `update()` inside event handlers: it runs other events re-entrantly.

**Owner on Windows** (z-order): Tk creates an override-redirect toplevel with the desktop as parent, even when `transient()` is set (`UpdateWrapper` in `tkWinWm.c` *(checked)*), so clicking the host window would cover every DeepTip window. Set the native owner after the window was mapped once, with `ctypes`:

```python
import ctypes

user32 = ctypes.windll.user32
user32.SetWindowLongPtrW.restype = ctypes.c_void_p
user32.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
GWLP_HWNDPARENT = -8

def set_owner(win: tk.Toplevel, owner: tk.Toplevel) -> None:
    """Windows only: `owner` (the host window, or the parent DeepTip window) stays below `win`."""
    user32.SetWindowLongPtrW(int(win.wm_frame(), 16), GWLP_HWNDPARENT, int(owner.wm_frame(), 16))
```

*(checked)*: with host → window → child owned like this, `host.lift()` left the window above the host and the child above the window; `withdraw()`, `deiconify()` and `-alpha` keep the native window and the owner; toggling `overrideredirect` after the first map creates a new native window and the owner is lost. Do not use `transient(root)` while the root is withdrawn: a transient of an unmapped master is never mapped *(checked)*.

Closing ([§4.2](../../docs/algorithms.md#42-closew-focusback--false)): cancel the window's timers, `destroy()` the `Toplevel`.

### 4.2 Terms: tags in a `Text` widget

Render the AST of [§2](../../docs/algorithms.md#2-markup-parser) as runs with tags ([§3](../../docs/algorithms.md#3-rendering-the-ast)). `Text.insert` never interprets the text, so glossary text cannot become markup. *(checked: this function and `term_at` below ran on a parsed body with emphasis, a list, a value, a missing link and two terms)*:

```python
def render(text: tk.Text, blocks, self_key, entry, value) -> list[str]:
    """Fills `text`; returns the keys of the terms, tag dt-term-N belongs to terms[N]."""
    terms: list[str] = []
    text.configure(state="normal")             # a disabled Text ignores insert()
    text.delete("1.0", "end")

    def inline(nodes, style=()):
        for n in nodes:
            t = n["t"]
            emph = "dt-bi" if {"b", "i"} <= set(style) else "dt-b" if "b" in style else "dt-i" if "i" in style else None
            base = (emph,) if emph else ()
            if t == "text":
                text.insert("end", n["v"], base)
            elif t == "br":
                text.insert("end", "\n")
            elif t in ("b", "i"):
                inline(n["c"], style + (t,))
            elif t == "code":
                text.insert("end", n["v"], ("dt-code",))
            elif t == "var":
                v = value(n["name"])
                text.insert("end", "{%s}" % n["name"] if v is None else str(v), ("dt-var",))
            elif t == "link":
                found = entry(n["key"])                       # (entry, locale) or None
                label = n["text"] or (found and found[0].get("title")) or n["key"]
                if n["key"] == self_key:
                    text.insert("end", label, ("dt-b",))
                elif not found:                               # the caller warns once per key
                    text.insert("end", label, base + ("dt-missing",))
                else:
                    text.insert("end", label, base + ("dt-link", f"dt-term-{len(terms)}"))
                    terms.append(n["key"])

    for i, b in enumerate(blocks):
        if i:
            text.insert("end", "\n")
        if b["type"] == "p":
            inline(b["c"])
        else:
            for j, item in enumerate(b["items"]):
                if j:
                    text.insert("end", "\n")
                start = text.index("end-1c")
                text.insert("end", "• ")
                inline(item)
                text.tag_add("dt-li", start, "end-1c")         # lmargin1 / lmargin2: hanging indent
        if i < len(blocks) - 1:
            text.tag_add("dt-gap", "end-2c linestart", "end-1c")   # spacing3: the gap between blocks
    text.configure(state="disabled")
    return terms
```

Tag options (section 5 has the colours): `dt-b`, `dt-i`, `dt-bi` with `font=(family, -14, "bold" | "italic" | "bold italic")`; `dt-code` with a monospace font at 0.92; `dt-var` bold; `dt-link` with `foreground` and `underline=True`; `dt-missing` with `underline=True, underlinefg="#dd3333"`; `dt-open` (anchor of an open window) with `background`; `dt-focus` with `relief="solid", borderwidth=1`; `dt-li` with `lmargin1`, `lmargin2`; `dt-gap` with `spacing3=7`. All of them are accepted by Tk 8.6.15 *(checked)*; Tk has no dotted or wavy underline.

**Term under a point** (`x`, `y` relative to the `Text`):

```python
def term_at(text: tk.Text, x: int, y: int) -> int | None:
    i = text.index(f"@{x},{y}")                 # always the nearest character, also far outside the text
    box = text.bbox(i)
    if not box or not (box[0] <= x < box[0] + box[2] and box[1] <= y < box[1] + box[3]):
        return None
    for tag in text.tag_names(i):
        if tag.startswith("dt-term-"):
            return int(tag[8:])
    return None
```

*(checked)*: `index("@x,y")` below the last line returned the last character; with the `bbox` test the function returned `None` there and right of a line, and the term's number inside it. A term box for placing page terms and for the focus ring: the union of `text.bbox(i)` over `text.tag_ranges(f"dt-term-{n}")` (Python 3.13 returns index objects there; `str()` them), plus `winfo_rootx()/winfo_rooty()` of the `Text`.

`tag_bind(tag, "<Enter>")` and `<Leave>` also work for terms (generated `<Motion>` events produced `enter`/`leave` in the expected order *(checked)*), but they run after the global handler; take hover from `term_at` in the global `<Motion>` handler (section 7.1) so there is one source of truth.

### 4.3 Window content

Content order as in [§3](../../docs/algorithms.md#3-rendering-the-ast): header `Frame` [title `Label` (bold), fallback badge `Label` (border 1, `relief="solid"`, font × 0.7), pin and close buttons], the body `Text` (with a `Scrollbar` only when the height is limited), the "See also" `Text` (label at reduced contrast, then one term per key, comma separated), a 1 px separator `Frame` and the hint `Label` (hidden when pinned), and the lock bar: a 2 px `Frame` placed with `place(x=0, rely=1.0, anchor="sw", relwidth=progress, height=2)`.

Buttons: 26 × 26 `Canvas` items or flat `tk.Button`s (`relief="flat"`, `borderwidth=0`) with `command=`. Tk 8.6 cannot draw the SVG icons of `deeptip.js`; the close icon `M18 6 6 18M6 6l12 12` is two lines (`canvas.create_line(…, width=2, capstyle="round")` in a 24-unit box scaled to 15 px), draw the pin as a small polygon. Tk 9.0 reads SVG into a `PhotoImage` *(verify)*. Tooltips and accessible names come from `label("close")`, `label("pin")` / `label("unpin")`.

## 5. Look: the values of `deeptip.css`

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border, hint separator | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background (term colour at 16 % on the background, pre-blended: Tk has no alpha) | `#d8e7f8` | `#283647` |
| button hover background (black 7 % / white 9 %, pre-blended) | `#ededed` | `#303238` |
| missing link underline | `#dd3333` | `#dd3333` |

| Measure | Value |
|---|---|
| width | natural width, at least 240, at most 384 (whole window incl. the 1 px border); natural = the widest plain line of the body measured with `font.measure()` + 24 padding + 2 border |
| height | at most 480; the body scrolls |
| font | 14 px: `tkfont.Font(family=…, size=-14)` (negative = pixels); title bold; code monospace at 0.92; values bold. Segoe UI at −14 has a line spacing of 19 px *(checked)*; reach the line height 1.5 (21 px) with `spacing1=1, spacing3=1` on the body |
| border | 1 px `highlightthickness`, pinned: accent colour; no rounded corners and no shadow (Tk windows are rectangles) |
| header | padding 6 6 2 12; buttons 26 × 26 with 15 px icons, 2 px apart; badge: 0.7 font, 1 px border, padding 0 4 |
| body | `padx=12`, 10 px below; blocks 7 px apart (`spacing3`); list indent `lmargin1=6`, `lmargin2=20` |
| "See also" | padding 0 12 10, font 0.9 |
| hint | padding 4 12 6, font 0.75, the text colour at 60 % opacity (pre-blended: 60 % text, 40 % background); hidden when pinned |
| flash | the border for 600 ms: `highlightthickness=3` in the accent colour, then back |
| lock bar | 2 px at the bottom edge, accent colour, `relwidth` from 0 to 1 over `lockAfter` |

Light or dark: Tk has no query. On Windows read `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, value `AppsUseLightTheme` (0 = dark) with `winreg` *(checked: readable)*; elsewhere offer an option.

## 6. Placement and coordinates

[§8](../../docs/algorithms.md#8-placement) works in a viewport with the origin (0, 0), y down: Tk's screen coordinates already point down.

1. Target box `T`: a child uses the parent window's last box `(rootx, rooty, width, height)`; a root uses the anchor widget's box (section 2), a page term the term box (section 4.2).
2. Viewport `V`: the work area of the monitor that contains the centre of `T`. Tk only knows the screen (`winfo_screenwidth()` = the primary monitor, 3440 × 1440 here) and the virtual root (`winfo_vrootx()` … = all monitors, −1920, 0, 5360 × 1440 here) *(checked)*; neither excludes the taskbar. On Windows:

```python
import ctypes
import ctypes.wintypes as wt

class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT), ("dwFlags", wt.DWORD)]

def work_area(x: int, y: int) -> tuple[int, int, int, int]:
    """(left, top, width, height) of the work area of the monitor nearest to (x, y), in Tk's coordinates."""
    user32 = ctypes.windll.user32
    user32.MonitorFromPoint.restype = ctypes.c_void_p
    hmon = user32.MonitorFromPoint(wt.POINT(x, y), 2)          # MONITOR_DEFAULTTONEAREST
    info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
    user32.GetMonitorInfoW(ctypes.c_void_p(hmon), ctypes.byref(info))
    r = info.rcWork
    return r.left, r.top, r.right - r.left, r.bottom - r.top
```

   *(checked: (0, 0, 3440, 1392) for the primary monitor with a 48 px taskbar, (−1920, 0, 1920, 1032) for the one on its left)*. X11 and macOS: use the screen rectangle, or a library such as `screeninfo` for monitors *(verify)*.
3. `a = T` moved by `(−V.x, −V.y)`, `vp = (V.w, V.h)`; sides = the widget's own `place` (roots), else `root` or `child`.
4. Size limits first: width between min(240, vp.w − 16) and min(384, vp.w − 16), height at most min(480, vp.h − 16). `p = compute_placement(size, a, sides, vp, 8)`; when `p["maxW"]` or `p["maxH"]` is set, give the body that width or height (the `Text` wraps again, the scroll bar appears), measure again and compute once more with `[p["side"]]`.
5. `win.geometry(f"{w}x{h}+{V.x + round(p['x'])}+{V.y + round(p['y'])}")`: Tk accepts negative positions as `+-1920+0` *(checked)*. Store the box.
6. Re-place every window that is not frozen, parents before children, after pin and unpin (the hint line changes the height), after `refresh()`, and on `<Configure>` of the anchor's toplevel (moved or resized: override-redirect windows do not follow their host by themselves).

The height of the wrapped body: `int(body.count("1.0", "end", "ypixels")[0])` read in the body's `<Configure>` handler, where the width is real (*checked*: 57 px for three lines at 384 px; after resizing a mapped window `update_idletasks()` is enough for a new value).

**DPI**: `python.exe` is not DPI-aware, so Windows scales Tk windows as bitmaps on high-DPI screens and every coordinate is in 96-DPI pixels (`GetProcessDpiAwareness` 0, `tk scaling` 1.333, `winfo_fpixels("1i")` 96 *(checked)*); the values above apply unchanged. If the application calls `ctypes.windll.shcore.SetProcessDpiAwareness(1)` before `tk.Tk()` (sharp text), coordinates are physical pixels: multiply every pixel value of section 5 by `root.winfo_fpixels("1i") / 96`; keep fonts in negative sizes scaled the same way *(verify on a high-DPI screen)*.

## 7. Events: exact order of operations

Everything runs in the Tk main loop; Tk is single-threaded, so load files in a thread if you must, but call the controller only from the Tk thread (`root.after(0, …)`).

### 7.1 Pointer

```python
root.bind_all("<Motion>", dt._motion, add="+")
root.bind_all("<Leave>", dt._leave, add="+")
root.bind_all("<ButtonPress-1>", dt._press, add="+")
root.bind_all("<ButtonRelease-1>", dt._release, add="+")
```

`_motion(e)`:

1. add the sample `(e.x_root, e.y_root, now())` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression));
2. `under = root.winfo_containing(e.x_root, e.y_root)`: while a button is held Tk sends the motion to the pressed widget, so `e.widget` is not what is under the pointer;
3. `win` = the open window whose `TipWindow` contains `under` (walk `.master`; ignore windows that are closing); `link` = if `under` is a body or "See also" `Text`: `term_at(under, e.x_root - under.winfo_rootx(), e.y_root - under.winfo_rooty())` as `(win, n)`, or the term of a page text; `trig` = only when `win` and `link` are `None`: the first widget from `under` upwards whose path is in `marked`;
4. if `(win, link, trig)` differs from the last triple: "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)): `quiet`, `refresh_hot()`, `lock_track()`, arm or disarm.

Comparing triples reproduces the web's `pointerover`, which fires only when the element under the pointer changes.

`_leave(e)`: if `root.winfo_containing(e.x_root, e.y_root)` is `None` (the pointer left every window of the application): `hover = {}`, `disarm()`, `lock_track(None)`, `refresh_hot()`.

### 7.2 Pointer down, clicks, buttons

- `_press(e)` ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)): remember the target (window, term, widget); outside DeepTip windows `hush(marked ancestor)`; `outside_click_closes == "always"` closes all. Tk has no pointer type (Windows touch arrives as mouse buttons), so the touch rows of §9.2 do not apply.
- `_release(e)` ([§9.1](../../docs/algorithms.md#91-clicks)): only when the release is on the target remembered at the press. A term → `follow((win, n), win, focus=False)`. A pin or close button → nothing here (their `command=` does it). Elsewhere inside an unpinned window → pin it when `click_inside_pins`. Never return `"break"`: the host's own buttons keep their clicks.

### 7.3 Keyboard: consuming `Esc` before the application

Tk delivers a key to the focus widget and runs the bindings of its bindtags in order: widget, class, toplevel, `all`; a handler that returns `"break"` stops the rest. DeepTip puts its own bindtag **in front** of the focus widget's bindtags when it gets the focus:

```python
DT = "DeepTipKeys"

def _tag_focus(self, e):
    w = e.widget
    if isinstance(w, tk.Misc) and w.bindtags()[0] != DT:
        w.bindtags((DT,) + w.bindtags())

root.bind_all("<FocusIn>", dt._tag_focus, add="+")
root.bind_class(DT, "<KeyPress>", dt._key)                # returns "break" when DeepTip used the key
root.bind_class(DT, "<KeyRelease-Escape>", dt._esc_up)
```

*(checked)*: the focus widget got the tag through `<FocusIn>`; with windows open, `Esc` and `Shift+Esc` reached only `_key`, and the application's `<Escape>` bindings on the widget, its class, its toplevel and `bind_all` stayed silent; with no windows open `_key` returned `None` and all four ran in that order. `F1`, `F6` and `?` (keysym `question`, `e.char == "?"`) arrive the same way.

`_key(e)` ([§9.3](../../docs/algorithms.md#93-keyboard)):

| Key | Steps |
|---|---|
| `Escape` | no windows → return `None`. `repeat = esc_down; esc_down = True`. Shift (`e.state & 0x0001`), or `repeat` and `now() - esc_at >= 600` → close all, focus the anchor of the root that held the focus; else if not `repeat` → `esc_at = now()`, `close(newest(focus), focus_back=True)`. Return `"break"`. |
| `F6` with windows open | cycle the windows (Shift: backwards); `"break"` |
| `F1`, or `?` outside `Entry`, `Text` (editable), `Spinbox`, `ttk.Entry`, `ttk.Combobox` | the focus is on a term of a window → `follow`; on a marked widget outside windows → open it pinned with focus (`via="key"`); `"break"` only when handled |
| printable `e.char`, no Control (`0x0004`) or Alt (`0x20000` on Windows, `ALT_MASK` in `tkInt.h` *(checked)*) in `e.state` | `hush(marked ancestor of the focus)`; return `None` |

`_esc_up`: `esc_down = False`; return `"break"` when the press was consumed. On Windows a held key repeats `KeyPress` without `KeyRelease` (Tk turns every `WM_KEYDOWN` into a `KeyPress` and only `WM_KEYUP` into a `KeyRelease`, *checked in `tkWinX.c`*); X11 auto-repeat sends `KeyRelease`/`KeyPress` pairs, so there clear `esc_down` only when no `KeyPress` follows within about 30 ms (`after(30, …)`) *(verify on X11 and macOS)*.

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lock_track(win)` with `lock_after > 0` | `stop_lock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); a 16 ms `after` loop only moves the bar |
| flash | `flash(w)` | restore the border after 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |
| long press | – | not used (no touch in Tk) |

Every timer is one `after()` id in the record; cancel with `after_cancel(id)` and set it to `None`. `after_cancel(None)` raises `ValueError` in Python 3.13 *(checked)*, so guard it. Cancel every pending id when a window or the controller is destroyed.

### 7.5 Focus

- Opening by keyboard ([§9.5](../../docs/algorithms.md#95-focus)): `view.body.focus_set()`, focus index 0, add the `dt-focus` tag on the first term's range and `text.see()` it. Without terms, focus the window's frame (`takefocus=1`).
- Inside a window, the body's bindtag handles `Tab` / `Shift-Tab` (`<ISO_Left_Tab>` on X11) by moving the focus index over the terms and then on to the pin and close buttons (`tk_focusNext()`), `Return` and `space` on a focused term → `follow(term, win, focus=True)`; return `"break"` so the `Text` class bindings do not insert a tab.
- `focus_set()` is enough while the application is active. `focus_force()` brought the off-screen test window to the foreground on Windows *(checked)*; use it only when the application is already active, never for previews.
- Closing returns the focus to the anchor if it was inside the closed subtree: `anchor.focus_set()`, or for a term anchor the parent body with the focus index on that term.

### 7.6 Anchors that move or disappear

- Marked widgets: `widget.bind("<Destroy>", …, add="+")` (or one `bind_all("<Destroy>")` that checks the path) → [§4.5](../../docs/algorithms.md#45-anchors-that-disappear): previews on it close, a pinned root freezes at its last box. A widget that is only unmapped (`winfo_viewable()` false) counts as gone too.
- `<Configure>` of the anchor's toplevel → re-place non-frozen windows.
- While a root window is open, give the host's own simple tooltip (if any) a rest: call `on_open_state(widget, True)`.

## 8. Accessibility

Tk 8.6 exposes no accessibility tree: screen readers see the window titles and native dialogs, not `Text` runs, `Label`s or the DeepTip windows, and Tk has no API for roles, names or descriptions. Accessibility support for Tk 9 is being worked on *(verify for the Tk version you ship)*. What DeepTip can still do in Tk: full keyboard operation (section 7.5), a visible focus ring (`dt-focus`), the theme's contrast and the high-contrast colours of the system (`SystemWindow`, `SystemWindowText`, `SystemHighlight` on Windows).

## 9. Live values, locales, refresh

- `vars` as in the [PySide6 guide](../python-pyside6/README.md#loading-the-glossaries-1): a dict name → value or callable (called with the window's key), or one callable `(name, key)`; `None` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- `set_locale(locale)` reads the missing files of the new chain, then `refresh()`.
- `refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): re-render every open window's `Text` widgets with `render()`, give each child the term `(parent, n)` whose key and occurrence match its old anchor and re-add `dt-open` there, re-place every window that is not frozen, re-render page texts and the encyclopedia.

## 10. Loading the glossary (JSON)

The loading code of the PySide6 guide applies unchanged ([Loading the glossaries](../python-pyside6/README.md#loading-the-glossaries-1)): `json.loads(Path(p).read_text(encoding="utf-8"))` (never the platform default encoding, cp1252 on Windows), Python dicts keep the file order, `sources` are templates with `{locale}` read per locale of the chain in template order (core first), a missing file is a warning, the locale of a file is its `$locale`, else its file name. Files inside a package: `importlib.resources.files("myapp").joinpath("deeptip", f"{loc}.json").read_text(encoding="utf-8")`.

## 11. Porting the pure functions

Use the Python core of the PySide6 guide as it is: [The pure core](../python-pyside6/README.md#the-pure-core-1-2-8) has the JavaScript whitespace set, `js_trim`, `KEY_RE.fullmatch` and the JavaScript division for `compute_placement`, and its [pitfalls](../python-pyside6/README.md#pitfalls) 8–11 list what differs from JavaScript. Nothing in it touches Tk. *(checked: the same core passed 24 of 24 cases with Python 3.13.5)*

## 12. Tkinter pitfalls

1. **Keys go to Tk's focus window**, and Tk drops a key event when the application has no display focus (`TkFocusKeyEvent` returns `NULL`, *checked in `tkFocus.c`*). A binding on the anchor widget alone never sees `F1` while another widget has the focus; use the bindtag of section 7.3.
2. **`"break"` is the only way to stop the remaining bindtags**; bindings on `all` run last, so `bind_all("<Escape>")` can never consume `Esc` before the application *(checked)*.
3. **`overrideredirect(True)` before the first map**; toggling it later replaces the native window and loses the owner *(checked)*.
4. **No owner for override-redirect windows on Windows**, even with `transient()` (section 4.1, *checked*); and a transient of a withdrawn master is never mapped *(checked)*.
5. **`Text.index("@x,y")` never fails**: it returns the nearest character also far outside the text; always test `bbox` (section 4.2, *checked*).
6. **Geometry needs a mapped window**: `winfo_width()` is 1 and `count -ypixels` is meaningless before the first `<Configure>` *(checked)*.
7. **Font sizes**: positive sizes are points (scaled by `tk scaling`: 11 pt gave a 20 px line spacing at 96 DPI), negative sizes are pixels *(checked)*. Use `size=-14` for the reference 14 px.
8. **`after_cancel(None)` raises `ValueError`** *(checked)*; keep ids per timer and cancel them on destroy.
9. **`focus_force()` takes the foreground** on Windows *(checked)*; previews must never do it.
10. **`winfo_containing()` skips windows with alpha 0** (Windows does not hit-test fully transparent layered windows) *(checked)*: only the measuring phase may use alpha 0.
11. **A disabled `Text` ignores `insert()` and `delete()`**: switch to `state="normal"` while rendering, back to `"disabled"` afterwards; it still takes the focus (`takefocus=1`) and runs bindings.
12. **Tag priority**: later created tags win when two tags set the same option; create `dt-open` and `dt-focus` after `dt-link` (or `tag_raise`) so the open and focus looks show over the term colour.
13. **macOS and Wayland**: override-redirect windows on macOS (Aqua) and Tk under XWayland behave differently from Windows (focus and stacking) *(verify)*; the overlay alternative of section 2 avoids native windows there.

## 13. Testing

### 13.1 Parity cases

Use the pytest runner of the PySide6 guide unchanged ([Testing](../python-pyside6/README.md#testing)): it imports only `deeptip.core`, compares booleans by type and expects `24 passed` *(checked with the same core, 24 of 24)*. No Tk is needed.

### 13.2 Behaviour, without a visible window

- Engine tests with a fake clock (a list of due tasks, `advance(ms)`) and a fake host, as in the [Swing guide](../java-swing/README.md#112-behaviour): one preview per parent, pinning pins the chain, closing closes the subtree, the same key up the chain flashes, grace, tendency, suppression, Esc and Shift+Esc, the timer lock.
- Tk parts: `root = tk.Tk(); root.withdraw()`. For geometry and hit tests create the `TipWindow` with `overrideredirect(True)` at `+-30000+-30000` (alpha 1 when you hit-test with `winfo_containing`, item 10 above), call `root.update()`, then `text.event_generate("<Motion>", x=…, y=…)` and assert on `term_at` and the tag events.
- Keys: generated key events need the display focus (pitfall 1). On Windows give it without taking the foreground with `ctypes.windll.user32.SetFocus(int(top.wm_frame(), 16))`, then `entry.focus_set()`, `root.update()`, `entry.event_generate("<KeyPress-Escape>")` *(checked: the foreground window did not change)*.

### 13.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 14. The example to build

The same screen as `frameworks/web/example` (`example/demo.py`): a `tk.Tk` window with a top bar of `tk.Button`s marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`, then `refresh()`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), `?` marked `deeptip.about` with `delay=0`, a language `ttk.Combobox` (`de`, `en`) calling `set_locale()`; four buttons in the corners (`place(relx=…, rely=…)`) for placement at the edges (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`); a page text in a `Text` with terms (`render_text`), settings (delay, lock, close and pin buttons, hints) and the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia): an `Entry` and a `Text` with one item per entry). Options: `sources = ["../../glossary/core/{locale}.json", "../../glossary/example/{locale}.json"]` (the download zip keeps the repository layout), `fallback=["de", "en"]`, `delay=1000`; in English *Prestige* and *Gold* come from the German fallback and show the `DE` badge.

## 15. Limitations compared with the web reference

- **Touch**: no pointer type in Tk; long-press, tap outside and the swipe of [§9.2](../../docs/algorithms.md#92-pointer-down-touch) are not available.
- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)) and **vibration**: no API; poll a library such as pygame's joystick module in a 16 ms `after` loop if needed.
- **Screen readers**: none in Tk 8.6 (section 8).
- **Look**: no rounded corners, shadows, dotted underlines or animations; reduced motion has no query (offer an option).
- **Terms on a normal screen** live in `Text` widgets; a `Label` or `ttk.Label` cannot hold terms.

## 16. Checklist

1. `deeptip/core.py` from the PySide6 guide, `24 passed` (sections 11, 13.1).
2. `glossary.py` with layers, chain, `$ui` labels, live values; validate the same files with `tools/deeptip-check.mjs`.
3. Engine with a fake clock and host, tested (section 13.2).
4. `render()`, `term_at()`, `TipWindow` with owner and placement, the bindings of section 7 with the `DeepTipKeys` bindtag.
5. The example (section 14); compare with the web example by hand; then list the framework with its state in the main README.
