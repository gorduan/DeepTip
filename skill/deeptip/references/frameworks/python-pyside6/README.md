# DeepTip for Python with PySide6 (Qt Widgets)

Guide: how [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) is built in a Qt Widgets application with PySide6. This repository keeps code only in HTML, CSS, JS and Rust, so there is no package to install from here; this page is the exact recipe. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) (the § links below point into it), the contract is [SPEC.md](../../SPEC.md).

Checked with **PySide6 / Qt 6.12.0** and Python 3.13 on Windows, on Qt's `offscreen` platform: the Qt behaviour described here was reproduced there, every snippet was run, and the pytest runner below passed all shared cases (24/24) with a Python port of [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser) and [§8](../../docs/algorithms.md#8-placement).

## What you build

| File | Content |
|---|---|
| `deeptip/core.py` | pure Python, no Qt: `flatten(obj)` ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)), `parse_text(src)` ([§2](../../docs/algorithms.md#2-markup-parser)), `collect_refs(src)`, `compute_placement(size, anchor, sides, vp, gap=8)` ([§8](../../docs/algorithms.md#8-placement)). The parity cases test this module. |
| `deeptip/glossary.py` | layers, locale chain, labels, file loading ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)), no Qt |
| `deeptip/render.py` | AST → Qt rich text ([§3](../../docs/algorithms.md#3-rendering-the-ast)) |
| `deeptip/qt.py` | the controller `DeepTip(QObject)` and the view `DeepTipWindow(QFrame)` |
| `deeptip/data/core/<locale>.json` | copies of `glossary/core/` (read them with `importlib.resources`, below) |
| `tests/test_parity.py` | the parity runner ([Testing](#testing)) |

Dependencies: `pip install PySide6` (`PySide6-Essentials` is enough: QtCore, QtGui, QtWidgets, QtSvg, QtTest), `pip install pytest` for the tests. Install into a virtual environment.

## SPEC → PySide6

| DeepTip | PySide6 |
|---|---|
| Controller | `DeepTip(QObject)`, installed with `QApplication.instance().installEventFilter(dt)`: it sees every event of every window and widget before they do |
| Window ([§3](../../docs/algorithms.md#3-rendering-the-ast)) | `DeepTipWindow(QFrame)`, one of two modes: **window** = top-level `Qt.WindowType.Tool \| Qt.WindowType.FramelessWindowHint` whose parent is the anchor's `window()` (it stays above that window, may extend beyond it, and is deleted with it), `Qt.WidgetAttribute.WA_ShowWithoutActivating` so a preview does not take the focus; **overlay** = a child widget of the anchor's `window()`, `raise_()`d, the window is the viewport. Use overlay on Wayland, where applications cannot position top-level windows. |
| Window content | `QVBoxLayout`: header [title `QLabel`, badge `QLabel`, pin `QToolButton` (checkable), close `QToolButton`], body `QLabel` inside a `QScrollArea`, "See also" `QLabel`, hint `QLabel`, lock bar (2 px `QFrame`) |
| Term | `<a href="key">label</a>` in a rich-text `QLabel` with `LinksAccessibleByMouse \| LinksAccessibleByKeyboard`: `linkHovered(str)` (the key; `""` when the pointer leaves the link or the label), `linkActivated(str)` on click and on Enter. Alternative: `QTextBrowser` with `setOpenLinks(False)`, `highlighted(QUrl)`, `anchorClicked(QUrl)`. |
| Marked UI element (`data-deeptip`) | any `QWidget` with the dynamic property `deeptip` (`w.setProperty("deeptip", "demo.taxes")`, also settable in Qt Designer); optional `deeptipDelay` (int, ms) and `deeptipPlace` (`"top,bottom"`) |
| Element / window under the pointer | `QApplication.widgetAt(global_pos)` (the deepest widget), then walk `parentWidget()` up to the first `DeepTipWindow` or the first widget with `deeptip` |
| Anchor box | `QRect(w.mapToGlobal(QPoint(0, 0)), w.size())`, global coordinates in device-independent pixels |
| Viewport | window mode: `(QGuiApplication.screenAt(center) or host.screen()).availableGeometry()`; overlay mode: the host window's rect mapped to global. `computePlacement` assumes the origin (0, 0): subtract the viewport's top-left before, add it after. |
| Pointer | `ev.globalPosition()` of `MouseMove` events whose receiver is a `QWindow` |
| `now()`, `schedule()` | `time.monotonic() * 1000`; a single-shot `QTimer(self)` per timer (cancel = `stop()`) |
| Rest progress (`data-dt-arming`) | signals `arming(QWidget, int)` / `disarmed(QWidget)`, or a dynamic property `dtArming` + `w.style().polish(w)` so the host's style sheet can react |
| Open state (`data-dt-open`) | dynamic property `dtOpen` + repolish; hide the widget's own `toolTip` while open |
| `onOpen`, `onClose`, `onPin` | signals `opened(str, QWidget)`, `closed(str)`, `pinned(str, QWidget)` |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | `setAccessibleName(title)`, `setAccessibleDescription(plain body)` on the window; QLabel links are keyboard-reachable. `QWidget` has no setter for the accessible role (only name, description, identifier); a tooltip or dialog role needs a custom `QAccessibleInterface` registered with `QAccessible.installFactory()`. |

Public API, named like the reference ([SPEC §7](../../SPEC.md#7-configuration-reference-names) options in snake_case: `delay`, `link_delay`, `close_delay`, `lock_after`, `long_press`, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `open_keys`, `gamepad`; plus `mode` = `"window"` or `"overlay"`):

| Call | Does |
|---|---|
| `DeepTip(app, **options)` | create the controller (one per application) and install the event filter |
| `add(locale, glossary: dict)` | add or override one layer ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) |
| `set_locale(locale)`, `configure(**options)` | switch language / change options; `sources` and `fallback` reload |
| `mark(widget, key, delay=None, place=None)` | set the properties (same as Designer) |
| `open(key, anchor, parent=None, pinned=False, focus=False)` | [§4.1](../../docs/algorithms.md#41-openkey-anchor-parent--none-pinned--false-focus--false) |
| `close(win, focus_back=False)`, `close_all()`, `pin(win)`, `unpin(win)` | [§4.2](../../docs/algorithms.md#42-closew-focusback--false), [§4.3](../../docs/algorithms.md#43-pinw-and-unpinw) |
| `refresh()` | [§4.6](../../docs/algorithms.md#46-refresh), after live values changed |
| `render_text(label: QLabel, text)` | terms on a normal screen (root windows) |
| `index_widget() -> QWidget` | the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia)): `QLineEdit` + list |
| `destroy()` | close all, remove the event filter |

## Data

```python
from dataclasses import dataclass, field

@dataclass(eq=False)                    # identity semantics: windows go into sets and lists
class Win:
    id: int
    key: str
    parent: "Win | None"
    anchor: object                      # a QWidget (UI element) or a term: (window or label, key)
    via: str = "api"                    # hover, click, key, touch, pad, api
    children: list["Win"] = field(default_factory=list)
    pinned: bool = False
    close_timer: "QTimer | None" = None
    leave_since: float = 0.0
    rect: "QRect | None" = None         # last placed box, global
    anchor_rect: "QRect | None" = None  # last box of a widget anchor (frozen roots, §4.5)
    frozen: bool = False
    view: "DeepTipWindow | None" = None
    hovered_term: str = ""              # key of the link under the pointer, "" = none
```

A plain `@dataclass` compares by fields and is unhashable: `hot.add(w)` fails and `wins.remove(w)` can remove the wrong window. Controller state: `data` (locale → {key → entry}), `labels` (locale → {name → text}), `wins` (oldest first), `hover` (win, link, trig), `hot: set`, `pending` ([§6](../../docs/algorithms.md#6-arming-and-delays)), `samples: collections.deque` ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), `quiet`, `lock_win` ([§7](../../docs/algorithms.md#7-timer-lock)), `press`, `swipe`, `swallow` ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)), `esc_at`, `pointer: QPoint`, `touch_mode`, `kbd` (the last activation came from the keyboard). The same key twice in one body is one anchor, because `QLabel` reports only the href: a term anchor is the pair (window, key).

## Loading the glossaries (§1)

```python
import json
import warnings
from pathlib import Path

def read_glossary(path) -> dict | None:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))   # never the platform default (cp1252 on Windows)
    except (OSError, ValueError) as e:                                # json.JSONDecodeError is a ValueError
        warnings.warn(f"DeepTip: cannot read {path}: {e}")
        return None
    return data if isinstance(data, dict) else None

def file_locale(path, data: dict) -> str:
    return data.get("$locale") or Path(path).stem.split(".")[-1]      # de.json, myapp.de.json -> de

def add(self, locale: str, glossary: dict) -> None:                   # method of DeepTip
    entries, meta, problems = flatten(glossary)
    for p in problems:
        warnings.warn(f"DeepTip: {locale} {p['key']}: {p['msg']}")
    self.data.setdefault(locale, {}).update(entries)                  # a later layer wins per key
    if isinstance(meta.get("$ui"), dict):
        self.labels.setdefault(locale, {}).update(meta["$ui"])
    self.refresh()
```

- `sources` are path templates with `{locale}`, e.g. `["data/core/{locale}.json", "data/{locale}.json"]`: for each locale of the chain, read every template in order and `add()` it (template order = layer order, core first); remember read paths; a missing file is a warning.
- Files shipped inside your package: `importlib.resources.files("myapp").joinpath("deeptip", f"{loc}.json").read_text(encoding="utf-8")` (works from wheels and zips).
- The application's language: `QLocale.system().name()` returns `de_DE` (underscore); the chain uses the part before `_`.
- Live values (`vars`): a dict name → value or callable (called with the window's key), or one callable `(name, key)`; `None` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).

## Building a window (§3)

```python
from PySide6.QtCore import Qt
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QScrollArea, QToolButton, QVBoxLayout, QWidget

class DeepTipWindow(QFrame):
    def __init__(self, host: QWidget, overlay: bool = False):
        flags = Qt.WindowType.Widget if overlay else Qt.WindowType.Tool | Qt.WindowType.FramelessWindowHint
        super().__init__(host.window(), flags)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setObjectName("deeptip")
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 6, 12, 10)
        head = QHBoxLayout()
        self.title, self.badge = QLabel(), QLabel()
        for label in (self.title, self.badge):
            label.setTextFormat(Qt.TextFormat.PlainText)
        self.pin, self.close_button = QToolButton(), QToolButton()
        self.pin.setCheckable(True)
        for button in (self.pin, self.close_button):
            button.setAutoRaise(True)
        head.addWidget(self.title, 1)
        head.addWidget(self.badge)
        head.addWidget(self.pin)
        head.addWidget(self.close_button)
        lay.addLayout(head)
        self.body, self.see = QLabel(), QLabel()
        for label in (self.body, self.see):
            label.setTextFormat(Qt.TextFormat.RichText)
            label.setWordWrap(True)
            label.setTextInteractionFlags(
                Qt.TextInteractionFlag.LinksAccessibleByMouse | Qt.TextInteractionFlag.LinksAccessibleByKeyboard)
        self.scroll = QScrollArea()
        self.scroll.setWidget(self.body)
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        lay.addWidget(self.scroll)
        lay.addWidget(self.see)
        self.hint = QLabel()
        lay.addWidget(self.hint)
        self.lock_bar = QFrame()
        self.lock_bar.setFixedHeight(2)
        lay.addWidget(self.lock_bar, 0, Qt.AlignmentFlag.AlignLeft)

    def fit(self, width: int, max_h: int = 0) -> None:
        """Body `width` px wide; at most `max_h` px high (then it scrolls)."""
        h = self.body.heightForWidth(width)
        self.scroll.setFixedSize(width, min(h, max_h) if max_h else h)
        self.see.setFixedWidth(width)
        self.adjustSize()
```

1. Title: the entry's title or the key (plain text). Badge: the source locale in upper case when the entry came from a fallback locale, `setToolTip(label("fallback"))`, hidden otherwise. Pin and close buttons: `setToolTip(label(...))`, `setVisible(pin_button / close_buttons)`; icons from the SVG paths `PIN_PATH` and `CLOSE_PATH` in `frameworks/web/deeptip.js` (QtSvg: `QSvgRenderer` into a `QPixmap`).
2. Body: `setText(to_html(parse_text(body or short or label("missing")), …))`; "See also" line when the entry has `see`; hint `label("hint")`, visible while `hints` and not pinned.
3. Width (reference look: window 240–384 px, max height 480 px, font 14 px): the longest plain line of the body measured with `QFontMetrics(view.body.font()).horizontalAdvance(line)`, plus margins, clamped; then `fit(width)`. A word-wrapped `QLabel` gets its height from `heightForWidth()`; `adjustSize()` after `fit()` gives the right window size (checked).
4. Connect, then place ([§8](../../docs/algorithms.md#8-placement)) and `show()`:

```python
view.body.linkHovered.connect(lambda key, w=w: self._term_hover(w, key))     # "" = left the link
view.body.linkActivated.connect(lambda key, w=w: self._follow_term(w, key))  # click, or Enter on a focused link
view.see.linkHovered.connect(lambda key, w=w: self._term_hover(w, key))
view.see.linkActivated.connect(lambda key, w=w: self._follow_term(w, key))
view.pin.clicked.connect(lambda _=False, w=w: self.unpin(w) if w.pinned else self.pin(w))
view.close_button.clicked.connect(lambda _=False, w=w: self.close(w, focus_back=True))
```

`setState` ([§4.3](../../docs/algorithms.md#43-pinw-and-unpinw)): pinned → border colour `#58a6ff` (style sheet on `QFrame#deeptip` with a dynamic property `pinned` + repolish), pin button checked, hint hidden, then re-place (the size changed). Flash ([§4.4](../../docs/algorithms.md#44-flashw)): a dynamic property `flash` for 700 ms. Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): a `QVariantAnimation` from 0 to 1 over `lock_after` ms sets the lock bar's width; its `finished` signal pins the window (like the CSS animation end in the reference).

## Rendering the AST (§3)

Qt rich text is an HTML subset, so every text from the glossary is escaped with `html.escape()`; glossary text never becomes markup.

```python
import html

def to_html(blocks, self_key, entry, value, is_open, colours) -> str:
    """entry(key) -> (entry, locale) or None; value(name) -> str or None; is_open(key) -> bool."""
    def link(key, text):
        found = entry(key)
        label = html.escape(text or (found and found[0].get("title")) or key)
        if key == self_key:
            return f"<b>{label}</b>"
        if not found:                                    # the caller warns once per key
            return f'<span style="color:{colours["missing"]}; text-decoration:underline">{label}</span>'
        bg = f' background-color:{colours["open"]};' if is_open(key) else ""
        return f'<a href="{key}" style="color:{colours["link"]}; text-decoration:underline;{bg}">{label}</a>'

    def inline(nodes):
        out = []
        for n in nodes:
            t = n["t"]
            if t == "text":
                out.append(html.escape(n["v"]))
            elif t == "br":
                out.append("<br>")
            elif t in ("b", "i"):
                out.append(f"<{t}>{inline(n['c'])}</{t}>")
            elif t == "code":
                out.append(f"<code>{html.escape(n['v'])}</code>")
            elif t == "var":
                v = value(n["name"])
                out.append("<b>" + html.escape("{" + n["name"] + "}" if v is None else str(v)) + "</b>")
            elif t == "link":
                out.append(link(n["key"], n["text"]))
        return "".join(out)

    block = 'style="margin-top:0; margin-bottom:6px"'   # Qt's default <p> margins are 12 px
    return "".join(
        f"<ul {block}>" + "".join(f"<li>{inline(item)}</li>" for item in b["items"]) + "</ul>"
        if b["type"] == "ul" else f"<p {block}>{inline(b['c'])}</p>"
        for b in blocks
    )
```

Keys only contain `A–Z a–z 0–9 _ - .`, so they are safe as `href` values, and `QLabel` returns the href unchanged. Qt rich text knows `text-decoration: underline` but not dotted or wavy lines. Reference colours (`frameworks/web/deeptip.css`, dark): background `#1b1e24`, text `#e6e8ec`, border `#3b414d`, pinned `#58a6ff`, terms `#6cb6ff`, missing `#dd3333`.

## Order of operations

The application event filter sees each event once **per receiver**: a key press arrives as `ShortcutOverride` and `KeyPress` for the `QWindow`, then the focused widget, then its parents while nobody accepts it; a click arrives for the `QWindow`, then the widget under the pointer (checked). The controller acts once, where the event enters the application, at the `QWindow`:

```python
from PySide6.QtCore import QEvent, QObject, Qt
from PySide6.QtGui import QCursor, QInputDevice, QWindow
from PySide6.QtWidgets import QApplication, QWidget

class DeepTip(QObject):
    def eventFilter(self, obj, ev):
        t = ev.type()
        if t == QEvent.Type.Leave and isinstance(obj, QWidget) and obj.isWindow():
            if QApplication.widgetAt(QCursor.pos()) is None:
                self._left_app()                   # §6: hover = {}, disarm, lock_track(None), refresh_hot
            return False
        if t == QEvent.Type.ContextMenu and self._swallowing_menu(obj):
            return True                            # §9.2: no context menu after a long-press
        if not isinstance(obj, QWindow):
            return False
        if t == QEvent.Type.MouseMove:
            self.touch_mode = ev.pointingDevice().type() == QInputDevice.DeviceType.TouchScreen
            if not self.touch_mode:
                self.pointer = ev.globalPosition().toPoint()
                self._sample(self.pointer)         # §5 pointer samples
                self._update_hover()               # §6 "on pointer over"
        elif t == QEvent.Type.MouseButtonPress and ev.button() == Qt.MouseButton.LeftButton:
            self._pointer_down(ev)                 # §9.2: hush, outside click, long-press, swipe
        elif t == QEvent.Type.MouseButtonRelease and ev.button() == Qt.MouseButton.LeftButton:
            return self._pointer_up(ev)            # §9.1 click inside pins; §9.2 True swallows a long-press click
        elif t == QEvent.Type.ShortcutOverride and self._wants_key(ev):
            ev.accept()                            # claim Esc / F1 / F6 before application shortcuts fire
            return True
        elif t == QEvent.Type.KeyPress:
            return self._key(ev)                   # §9.3, True = consumed
        return False

    def _update_hover(self):                       # §6
        under = QApplication.widgetAt(self.pointer)
        win = self._window_of(under)               # nearest DeepTipWindow ancestor, closing windows excluded
        for x in self.wins:
            if x is not win:
                x.hovered_term = ""                # QLabel also sends linkHovered(""), but do not depend on it
        link = (win, win.hovered_term) if win and win.hovered_term else self.page_term
        trig = None if win or link else self._marked_of(under)   # nearest ancestor with "deeptip"
        self._on_pointer_over(win, link, trig)     # §6: quiet, refresh_hot (§5), lock_track (§7), arm / disarm
```

After the filter, the same mouse move reaches the `QLabel`, which emits `linkHovered(key)` → `_term_hover(w, key)`: ignore it in `touch_mode`, set `w.hovered_term = key`, call `_update_hover()` again (this arms the term). `linkActivated(key)` → `follow(term, w, focus=self.kbd)` ([§9.1](../../docs/algorithms.md#91-clicks); `kbd` is set by the filter when Enter or Return reached a window's label and cleared after use).

Timers: arming ([§6](../../docs/algorithms.md#6-arming-and-delays)), grace ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)) and long-press ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)) are single-shot `QTimer(self)` objects with the callbacks of algorithms.md (`fire`, `tick`, press); their retries (`RETRY` 90 ms) restart the same timer. `_pointer_up` does [§9.1](../../docs/algorithms.md#91-clicks) for clicks inside a window that were not on a link or a button: `if click_inside_pins and not win.pinned: pin(win)`.

`_key(ev)` ([§9.3](../../docs/algorithms.md#93-keyboard)): `Qt.Key.Key_Escape` with windows open → Shift (`ev.modifiers() & Qt.KeyboardModifier.ShiftModifier`) or `ev.isAutoRepeat()` held ≥ 600 ms closes all, a first press closes `newest(QApplication.focusWidget())`; `Qt.Key.Key_F6` cycles windows (`activateWindow()` + focus); `Qt.Key.Key_F1` or `ev.text() == "?"` on a marked widget opens it pinned with focus (not `?` in `QLineEdit`, `QTextEdit`, `QPlainTextEdit`, `QAbstractSpinBox`); on a window label with a focused link, F1 sends that label a Return key press (`QApplication.sendEvent`) so `linkActivated` reports the focused key; printable text typed into a marked widget → `hush`.

Keyboard focus ([§9.5](../../docs/algorithms.md#95-focus)): opening by keyboard calls `view.activateWindow()` (window mode) and `view.body.setFocus(Qt.FocusReason.TabFocusReason)`: the first link gets the focus; Tab / Shift+Tab walk the links, then the buttons; Enter on a link emits `linkActivated` (checked). Without links, focus the window. Closing returns the focus: `anchor.window().activateWindow()`, `anchor.setFocus()`.

## Placement (§8)

```python
from PySide6.QtCore import QPoint, QRect
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QWidget

def _box(self, w) -> QRect:
    if w.parent:
        return w.parent.rect                       # children sit beside the parent window
    if isinstance(w.anchor, QWidget) and w.anchor.isVisible():
        w.anchor_rect = QRect(w.anchor.mapToGlobal(QPoint(0, 0)), w.anchor.size())
    return w.anchor_rect                           # frozen roots and page terms keep their last box

def _viewport(self, w) -> QRect:
    host = w.view.parentWidget()
    if not w.view.isWindow():                      # overlay mode
        return QRect(host.mapToGlobal(QPoint(0, 0)), host.size())
    screen = QGuiApplication.screenAt(self._box(w).center()) or host.screen()
    return screen.availableGeometry()

def _place(self, w, width: int) -> None:
    """width: the body's natural width (Building a window, step 3)."""
    view = w.view
    a, vp = self._box(w), self._viewport(w)
    view.fit(width)
    chrome_w, chrome_h = view.width() - view.scroll.width(), view.height() - view.scroll.height()
    # the reference CSS caps every window before it is measured:
    # max-width min(24rem, 100vw - 2·gap), max-height min(30rem, 100dvh - 2·gap)
    width = min(width, min(384, vp.width() - 16) - chrome_w)
    max_h = min(480, vp.height() - 16) - chrome_h
    view.fit(width, max_h)
    box = {"left": a.x() - vp.x(), "top": a.y() - vp.y(),
           "right": a.x() + a.width() - vp.x(), "bottom": a.y() + a.height() - vp.y()}
    room = {"w": vp.width(), "h": vp.height()}
    p = compute_placement({"w": view.width(), "h": view.height()}, box, self._sides(w), room, 8)
    if p["maxW"] or p["maxH"]:
        if p["maxW"]:
            width = int(p["maxW"]) - chrome_w
        view.fit(width, min(max_h, int(p["maxH"]) - chrome_h) if p["maxH"] else max_h)
        p = compute_placement({"w": view.width(), "h": view.height()}, box, [p["side"]], room, 8)
    top_left = QPoint(round(p["x"]) + vp.x(), round(p["y"]) + vp.y())
    view.move(top_left if view.isWindow() else view.parentWidget().mapFromGlobal(top_left))
    w.rect = QRect(top_left, view.size())
```

`_sides(w)`: roots use the widget's `deeptipPlace` if set, else `root`; children use `child`. A term in a `render_text()` label has no box of its own (`QLabel` exposes no link geometry): store a small box around the pointer at hover time as its `anchor_rect`. Re-place non-frozen windows when their size changes (`QEvent.Type.LayoutRequest` / `Resize` of the view), when the host window moves or resizes (`Move`, `Resize` on it: tool windows do not follow their parent by themselves), and when the screen changes.

## Input mapping (§9)

| Reference | PySide6 |
|---|---|
| pointer leaves the application | `Leave` on a top-level `QWidget` while `QApplication.widgetAt(QCursor.pos())` is `None` |
| pointer down / click | `MouseButtonPress` / `MouseButtonRelease` on the `QWindow`, target `QApplication.widgetAt(ev.globalPosition().toPoint())`; terms `linkActivated`; pin and close `clicked` |
| touch | mouse events with `ev.pointingDevice().type() == QInputDevice.DeviceType.TouchScreen` (Qt synthesizes them from touch; `QMouseEvent.source()` is deprecated since Qt 6.0); long-press = a `QTimer` from that press, cancelled beyond `MOVE_TOL` or on release; swallow the release and `ContextMenu` afterwards |
| Esc, hold Esc, Shift+Esc | `Qt.Key.Key_Escape`; `ev.isAutoRepeat()` + 600 ms; `Qt.KeyboardModifier.ShiftModifier` |
| F6, open keys | `Qt.Key.Key_F6`, `Qt.Key.Key_F1`, `ev.text() == "?"` (layout independent) |
| focus | `QApplication.focusWidget()`, `setFocus(Qt.FocusReason.TabFocusReason)`, `activateWindow()` |
| gamepad ([§9.4](../../docs/algorithms.md#94-gamepad)) | Qt 6 has no gamepad module (PySide6 6.12 ships none; Qt Gamepad was not carried into Qt 6). Read controllers with SDL2's GameController API (e.g. PySDL2) in a 16 ms `QTimer` and map by name: A, B, Y, LEFTSHOULDER, RIGHTSHOULDER, DPAD_UP/DOWN/LEFT/RIGHT, left stick beyond ±0.6. |
| vibrate | not available in Qt Widgets; skip it |

## The pure core (§1, §2, §8)

`deeptip/core.py` follows the pseudo-code of algorithms.md line by line and returns plain dicts and lists. Four helpers keep it identical to the JavaScript reference where Python differs:

```python
import math
import re

# KEY_RE: always KEY_RE.fullmatch(key); with re.match and "$" a trailing "\n" would pass
KEY_RE = re.compile(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*")

# JavaScript's \s (whitespace and line terminators); Python's \s, isspace() and strip() use another set
JS_SPACE = frozenset(map(chr, [*range(0x09, 0x0E), 0x20, 0xA0, 0x1680, *range(0x2000, 0x200B),
                               0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]))


def js_trim(s: str) -> str:
    a, b = 0, len(s)
    while a < b and s[a] in JS_SPACE:
        a += 1
    while b > a and s[b - 1] in JS_SPACE:
        b -= 1
    return s[a:b]


def ratio(x: float, y: float) -> float:
    """JavaScript division: x / 0 is Infinity or NaN instead of ZeroDivisionError (computePlacement's room / need)."""
    if y:
        return x / y
    return math.inf if x > 0 else -math.inf if x < 0 else math.nan
```

"Whitespace" in the emphasis rules and in the bullet pattern `^\s*[-•]\s+(.*)$` means `JS_SPACE` as well; in that pattern `.` stops at U+2028 and U+2029, so a line whose text after the marker contains one of them is a paragraph line, not a bullet. `re.split(r"\n[ \t]*\n", src)` splits paragraphs exactly like the reference.

## Pitfalls

1. **Act at the `QWindow` receiver**: the filter sees one key press several times (in the check six: `ShortcutOverride` and `KeyPress`, each for the window, the focused `QLineEdit` and its parent widget). Returning `True` at the `QWindow` hides the key from every widget (checked: a focused `QLineEdit` no longer gets it).
2. **Application shortcuts fire before `KeyPress`**: with a `QShortcut` on Esc in the host, a filter that only handles `KeyPress` never sees the key. Accept `ShortcutOverride` at the `QWindow` (`ev.accept(); return True`) whenever DeepTip will use the key; then the shortcut stays quiet and the `KeyPress` arrives (checked both ways).
3. **`QRect.right()` / `bottom()` are `x + width - 1`** (historical Qt convention): use `x() + width()` for the far edge, as in `_place`.
4. **Enums**: PySide6 6.12 still accepts `Qt.Tool`, but use the fully qualified names (`Qt.WindowType.Tool`, `QEvent.Type.KeyPress`).
5. **Text format**: set `Qt.TextFormat.PlainText` for titles and `Qt.TextFormat.RichText` for bodies explicitly; the default `AutoText` guesses from the content.
6. **`QLabel` links**: mouse tracking is switched on by the label itself (checked); `linkHovered("")` comes when leaving a link inside the label and when leaving the label or window straight from a link (checked). Keyboard: `LinksAccessibleByKeyboard` is required for Tab and Enter.
7. **`QTextBrowser`** navigates to a clicked href and shows an empty page unless `setOpenLinks(False)`; its signals carry `QUrl` (`url.toString()` is the key).
8. **Encoding**: `open()` / `read_text()` without `encoding="utf-8"` uses cp1252 on Windows (`locale.getpreferredencoding(False)`), which breaks `–`, `→`, umlauts.
9. **Porting the parser** ([§2](../../docs/algorithms.md#2-markup-parser)): `re`'s `$` matches before a final `\n`, so check keys with `re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*", key)`. Python's whitespace is not JavaScript's: `\s`, `str.isspace()` and `str.strip()` treat U+001C–U+001F and U+0085 as whitespace (JavaScript does not) and U+FEFF as text (JavaScript: whitespace). Use one explicit set for `trim` and the `*` checks ([The pure core](#the-pure-core-1-2-8)).
10. **Placement port** ([§8](../../docs/algorithms.md#8-placement)): `room[s] / need(s)` raises `ZeroDivisionError` for a zero-sized window; JavaScript gives Infinity or NaN. Emulate it (`ratio()` in [The pure core](#the-pure-core-1-2-8)).
11. **`True == 1`** in Python, so `{"fits": True} == {"fits": 1}`; compare booleans by type in tests (the runner below does).
12. **Lifetime**: give every `QTimer` and window a Qt parent or keep a Python reference; an unreferenced, parentless `QTimer` is garbage-collected and never fires. `QTimer.singleShot(ms, fn)` cannot be cancelled, so it does not fit `schedule()`. Close windows with `close()` + `deleteLater()`.
13. **Coordinates** are device-independent pixels in Qt 6 for widgets and screens alike, so `computePlacement` needs no DPI handling; only the viewport origin must be subtracted (screens other than the primary one have non-zero origins).
14. **Offscreen tests** (`QT_QPA_PLATFORM=offscreen`): the screen is 800×800 at device pixel ratio 1; `QTest.mouseMove(widget, pos)` on a widget inside a separate tool window went to the host window, so target the tool window's handle: `QTest.mouseMove(view.windowHandle(), point_in_view)`; `QCursor.setPos()` and `QApplication.widgetAt()` work; `WA_ShowWithoutActivating` is not observable there (the tool window reports itself active).

## Testing

Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases)), pytest, no Qt needed:

```python
# tests/test_parity.py — DEEPTIP_CASES=<DeepTip>/test/cases pytest -q
import json
import os
from pathlib import Path

import pytest

from deeptip.core import compute_placement, flatten, parse_text

CASES = Path(os.environ.get("DEEPTIP_CASES", Path(__file__).parent / "cases"))


def load(name):
    return json.loads((CASES / name).read_text(encoding="utf-8"))["cases"]


def strict(x):
    """Keep booleans apart from 1/0 (True == 1 in Python)."""
    if isinstance(x, bool):
        return ("bool", x)
    if isinstance(x, dict):
        return {k: strict(v) for k, v in x.items()}
    if isinstance(x, list):
        return [strict(v) for v in x]
    return x


@pytest.mark.parametrize("case", load("markup.json"), ids=lambda c: c["name"])
def test_markup(case):
    assert parse_text(case["src"]) == case["blocks"]


@pytest.mark.parametrize("case", load("placement.json"), ids=lambda c: c["name"])
def test_placement(case):
    got = compute_placement(case["size"], case["anchor"], case["sides"], case["viewport"])
    assert strict(got) == strict(case["expect"])


@pytest.mark.parametrize("case", load("glossary.json"), ids=lambda c: c["name"])
def test_glossary(case):
    entries, meta, problems = flatten(case["input"])
    assert {"keys": list(entries), "meta": list(meta), "problems": len(problems)} == case["expect"]
```

`parse_text()` returns the AST of [§2](../../docs/algorithms.md#2-markup-parser) as dicts and lists (`text` is `None` when absent), `flatten()` returns `(entries, meta, problems)` with `entries` in file order (Python dicts keep it), `compute_placement()` returns `{"side", "x", "y", "fits", "maxW", "maxH"}`; `json` gives ints and floats, which compare equal by value. Expected: `24 passed`.

Behaviour tests run offscreen: create the `QApplication` with `QT_QPA_PLATFORM=offscreen`, give the controller a replaceable clock (`now()`), build a host widget with marked buttons, drive the pointer with `QTest.mouseMove(window.windowHandle(), pos)` and keys with `QTest.keyClick(window.windowHandle(), Qt.Key.Key_Escape)`, and check the invariants of [§4](../../docs/algorithms.md#4-window-tree-and-invariants), grace and tendency ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), that children never cover their parent, and that a host `QShortcut` on Esc stays quiet while a window closes. Compare the feel with the web example (`npm run demo`).

## Example to build

The scene of every DeepTip example (`example/demo.py`): a `QMainWindow` with a top bar of `QPushButton`s marked with `deeptip`: Realm `demo.realm`, Stability `demo.stability` (click cycles −3…+3, then `refresh()`), Taxes `demo.taxes` (click cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, `?` with `deeptip.about` and `deeptipDelay` 0, and a language `QComboBox` (de/en) calling `set_locale()`; four buttons in the corners for placement at the edges (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`). Options: `sources` = copies of `glossary/core/{locale}.json` and `glossary/example/{locale}.json`, `fallback=["de", "en"]`, `delay=1000`, `vars={"stability": lambda key: f"{stability:+d}", "gold": lambda key: f"{gold:,}"}`. In English, Prestige and Gold come from the German fallback and show the `DE` badge. A smoke run: `QT_QPA_PLATFORM=offscreen python example/demo.py` with a `QTimer.singleShot(3000, app.quit)`.

## Limitations

- No gamepad and no vibration from Qt itself (see the input table).
- A term in a `render_text()` label is anchored to the pointer position, not to the term's exact box.
- In window mode on Wayland the windows cannot be positioned; use overlay mode there.
