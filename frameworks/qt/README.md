# DeepTip for Qt 6 (C++): build guide

How to build [DeepTip](../../README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Qt 6 application written in C++ (C++17, Qt 6.5 or newer), with **Qt Widgets** or **Qt Quick / QML**.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Qt in C++. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Qt Widgets behave the same from C++ and from Python, so the widget mechanics (tool windows, the application event filter at the `QWindow`, `ShortcutOverride`, `QLabel` links, placement) are described once in the [PySide6 guide](../python-pyside6/README.md) and linked here; this guide adds the C++ side and Qt Quick. Statements marked *(checked)* were verified on 2026-10-29 with **Qt 6.12.0** (the libraries of PySide6 6.12.0, Windows 11) on the `offscreen` platform, Qt Quick with the software renderer, and in the Qt sources; the C++ snippets were not compiled (no Qt SDK on the test machine), their API names follow the Qt 6 documentation. *(verify)* marks what could not be checked.

## Quick start

**Recognise the project:** `find_package(Qt6 … COMPONENTS Widgets)` or `… Quick` with `qt_add_executable` / `qt_add_qml_module` in `CMakeLists.txt` (qmake: `QT += widgets` or `QT += quick` in a `.pro` file), `#include <QApplication>` or `<QGuiApplication>`, `.ui` or `.qml` files.

1. Port `flatten`, `parseText` and `computePlacement` to C++ (section 11) and pass the parity cases with QtTest (section 13.1); in a QML application reuse the reference's JavaScript instead (section 11.1).
2. Build `Glossary`, `Engine` and the `DeepTip` controller with its event filter (sections 3 and 7), then the view: `DeepTipWindow` for Widgets (section 4.1) or `TipWindow.qml` for Qt Quick (section 4.2).
3. Copy `glossary/core/<locale>.json` to `deeptip/core/` (or into a Qt resource); your own entries go to `deeptip/<locale>.json` (section 10).
4. Create one controller for the application and mark widgets with the dynamic property `deeptip` (Qt Designer: *Add Dynamic Property*), or QML items with the attached property `DeepTip.key`.
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```cpp
#include <QApplication>
#include <QPushButton>
#include "deeptip/deeptip.h"

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    DeepTip::Options options;                       // SPEC §7 names: delay, linkDelay, closeDelay, locale, sources …
    options.locale = u"en"_s;                       // needs: using namespace Qt::StringLiterals;
    options.sources = {u"deeptip/core/{locale}.json"_s, u"deeptip/{locale}.json"_s};
    DeepTip deepTip(&app, options);                 // installs the application event filter
    QPushButton help(u"?"_s);
    help.setProperty("deeptip", u"deeptip.about"_s);
    help.show();
    return app.exec();
}
```

**Done when:** the parity test passes 24 of 24, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without firing your own `QShortcut` or QML `Shortcut` on `Esc`, the validator reports 0 errors.

## 1. Parts to build

| Part | Does | Qt modules |
|---|---|---|
| `deeptip/core.{h,cpp}` | an order-keeping JSON reader, `flatten` ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)), `parseText` ([§2](../../docs/algorithms.md#2-markup-parser)), `collectRefs`, `computePlacement` ([§8](../../docs/algorithms.md#8-placement)) | QtCore only |
| `deeptip/glossary.{h,cpp}` | layers, locale chain, `entry(key)`, `label(name)`, live values, loading ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) | QtCore |
| `deeptip/engine.{h,cpp}` | window tree, hot set, grace, tendency, arming, lock ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock)) against a `Host` and a `Clock`, so it is unit-testable (the split of the [Swing guide](../java-swing/README.md#3-data-structures)) | QtCore |
| `deeptip/deeptip.{h,cpp}` | the controller `DeepTip : QObject`: application event filter, `QTimer`s, focus, the public API | QtGui |
| `deeptip/window.{h,cpp}` | Widgets: `DeepTipWindow : QFrame` and the AST → rich-text renderer | QtWidgets |
| `deeptip/TipWindow.qml`, `deeptip/deeptip-core.mjs` | Qt Quick: one window item; the reference's pure functions (section 11.1) | QtQuick, QtQml |
| `tests/parity.cpp` | QtTest runner for `test/cases` | QtTest |

```cmake
find_package(Qt6 REQUIRED COMPONENTS Widgets Test)            # add Quick and Qml for QML
qt_standard_project_setup()
qt_add_library(deeptip_core STATIC deeptip/core.cpp deeptip/glossary.cpp deeptip/engine.cpp)
target_link_libraries(deeptip_core PUBLIC Qt6::Core)
qt_add_executable(app main.cpp deeptip/deeptip.cpp deeptip/window.cpp)
target_link_libraries(app PRIVATE deeptip_core Qt6::Widgets)
qt_add_executable(parity tests/parity.cpp)
target_link_libraries(parity PRIVATE deeptip_core Qt6::Test)
add_test(NAME parity COMMAND parity)
```

## 2. SPEC concept → Qt primitive

| SPEC | Qt Widgets | Qt Quick |
|---|---|---|
| Controller | `DeepTip : QObject`, `qApp->installEventFilter(this)`: it sees every event for every window and widget first | the same C++ object (exposed to QML as a singleton with `QML_ELEMENT` + `QML_SINGLETON`), the same application event filter: a `QQuickWindow` is a `QWindow` |
| Window (top layer) | `DeepTipWindow : QFrame`, a `Qt::Tool \| Qt::FramelessWindowHint` top-level owned by the anchor's `window()`, `WA_ShowWithoutActivating` (as in the [PySide6 guide](../python-pyside6/README.md#spec--pyside6)); or a child of the host window as overlay | an item in the window's overlay layer: `parent: Overlay.overlay` (QtQuick.Controls; `z` 1000001, above content and the app's popups *(checked)*); or a separate `Window { flags: Qt.ToolTip \| Qt.FramelessWindowHint }` *(verify)* |
| Stacking order | owned tool windows stay above their owner; `raise()` | later children of the overlay are drawn on top; raise by re-parenting or `z` |
| Rich text | `QLabel` with `Qt::RichText` (or `QTextBrowser`) | `Text` with `textFormat: Text.RichText` (or `Text.StyledText`, lighter, fewer tags) |
| Term | `<a href="KEY">` in the label: `linkHovered(QString)`, `linkActivated(QString)` | `<a href="dt:N">`: `linkHovered(link)` (empty when left), `linkActivated(link)`, `hoveredLink`, `linkAt(x, y)` *(all checked)* |
| Marked UI element (`data-deeptip`) | dynamic property `deeptip` (`setProperty("deeptip", key)`, also from Designer); `deeptipDelay`, `deeptipPlace` | an attached property `DeepTip.key: "demo.realm"` (a C++ attached type, `QML_ATTACHED`), plus `DeepTip.delay`, `DeepTip.place` |
| Element under the pointer | `QApplication::widgetAt(globalPos)`, then `parentWidget()` up | the deepest item: descend from `window->contentItem()` with `QQuickItem::childAt()`, then `parentItem()` up |
| Pointer | `MouseMove` at the `QWindow` receiver, `ev->globalPosition()` | the same events at the `QQuickWindow`; inside DeepTip windows the `Text` link signals |
| `now()`, `schedule()` | `QElapsedTimer` (monotonic) started once; single-shot `QTimer` members (`setSingleShot(true)`, `stop()` cancels) | the same C++ timers |
| Keyboard, consuming `Esc` | accept `ShortcutOverride` and consume `KeyPress` at the `QWindow` (section 7.3) | the same filter; it beats QML `Shortcut`s and `Keys` handlers *(checked)* |
| Focus | `QWidget::setFocus()`, `activateWindow()` | `Item.forceActiveFocus()`, `activeFocusOnTab` |
| Screen reader | an own `QAccessibleInterface` via `QAccessible::installFactory()` for the role (section 8) | `Accessible.role: Accessible.ToolTip` / `Accessible.Dialog`, `Accessible.name`, `Accessible.description` (both roles exist *(checked)*) |
| Theme | a style sheet on `DeepTipWindow` plus the HTML colours of the renderer | QML properties from one `Theme` object |
| Coordinates | global device-independent pixels (`mapToGlobal`), viewport `QScreen::availableGeometry()` | overlay coordinates: `item.mapToItem(layer, …)`, viewport = the layer's size |

## 3. Data structures

```cpp
struct Tip {                                       // window record, algorithms §4
    int id = 0;
    QString key;
    Tip *parent = nullptr;
    std::vector<Tip *> children;                   // insertion order
    QPointer<QObject> anchor;                      // marked QWidget / QQuickItem; null once the host deleted it (§4.5)
    int term = -1;                                 // term anchors: number of the term in the parent's body
    int occurrence = 0;                            // n-th term with this key in the parent (refresh(), §4.6)
    QString via = QStringLiteral("api");           // hover, click, key, touch, pad, api
    bool pinned = false, frozen = false;
    QTimer closeTimer;                             // grace / tendency retries (§5), single-shot
    QRectF rect, anchorRect;                       // last placed box, last box of the anchor
    QPointer<QObject> view;                        // DeepTipWindow or the TipWindow item
};
```

The controller owns the records (`std::vector<std::unique_ptr<Tip>> wins`, oldest first); `QTimer` is neither copyable nor movable, so records live behind pointers. Further state: `QSet<Tip *> hot`; the hover triple `(Tip *win, Term link, QPointer<QObject> trig)` with `struct Term { Tip *win; int n; }`; the pending arm (`QPointer<QObject> el`, `QTimer armTimer`); `std::deque<Sample> samples` (`struct Sample { QPointF p; qint64 t; }`); `quiet`; `lockWin`; `escDown`, `escAt`; `kbd`. `QPointer` turns null when the object is destroyed, which is exactly the "anchor removed by the host" test of [§4.5](../../docs/algorithms.md#45-anchors-that-disappear).

## 4. Windows and terms

### 4.1 Qt Widgets

Build `DeepTipWindow : QFrame` exactly as the [PySide6 guide's `DeepTipWindow`](../python-pyside6/README.md#building-a-window-3) (header, body `QLabel` in a `QScrollArea`, "See also", hint, lock bar; `fit(width, maxH)`), with `Q_OBJECT` so `metaObject()->className()` is `"DeepTipWindow"` (section 8). C++ specifics:

- Parent the window to the anchor's `window()`: Qt deletes it with the host; close with `hide()` + `deleteLater()`, never `delete` inside one of its own signal handlers.
- Render the AST like the PySide6 `to_html`, escaping every glossary text with `QString::toHtmlEscaped()` (it escapes `<`, `>`, `&`, `"`), so glossary text never becomes markup. Keys contain only `A–Z a–z 0–9 _ - .` and are safe as `href`.
- Connect the label signals with a context object, so they disconnect when the controller or the view goes away:

```cpp
connect(view->body, &QLabel::linkHovered, this, [this, tip](const QString &key) { termHover(tip, key); });   // "" = left
connect(view->body, &QLabel::linkActivated, this, [this, tip](const QString &key) { followTerm(tip, key); });
connect(view->pin, &QToolButton::clicked, this, [this, tip] { tip->pinned ? unpin(tip) : pin(tip); });
connect(view->closeButton, &QToolButton::clicked, this, [this, tip] { close(tip, /*focusBack=*/true); });
```

Everything else (link behaviour, word-wrapped height via `heightForWidth()`, focus with `LinksAccessibleByKeyboard`) is in the PySide6 guide and holds for C++ unchanged.

### 4.2 Qt Quick

One `TipWindow` item per DeepTip window, created by the controller (`QQmlComponent::createWithInitialProperties`) or by a QML `Repeater` over a model the controller exposes:

```qml
// TipWindow.qml
import QtQuick
import QtQuick.Controls

Rectangle {
    id: tip
    parent: Overlay.overlay                         // the window's top layer, above content and app popups
    property int tipId
    property bool pinned: false
    property alias bodyText: body.text              // rich text made by the renderer, terms as <a href="dt:N">
    color: Theme.bg; border.color: pinned ? Theme.accent : Theme.border; border.width: 1; radius: 8
    Accessible.role: pinned ? Accessible.Dialog : Accessible.ToolTip
    Accessible.name: title.text
    HoverHandler { blocking: true }                 // the item below does not show hover through the window
    TapHandler { onTapped: DeepTip.clickInside(tip.tipId) }
    Column {
        // header: title Text, fallback badge, pin and close buttons; then the body:
        Text {
            id: body
            textFormat: Text.RichText
            wrapMode: Text.Wrap
            onLinkHovered: (link) => DeepTip.termHover(tip.tipId, link)        // "" when the pointer left the term
            onLinkActivated: (link) => DeepTip.followTerm(tip.tipId, link)
        }
        // "See also" Text, hint Text, lock bar Rectangle
    }
}
```

*(checked)*: an item parented to `Overlay.overlay` had `z` 1000001; with a `HoverHandler { blocking: true }` the `Button` below it lost its hover when the pointer moved onto the window; a tap on the window did not click the button below; a click beside the window still reached the app. `Text` with `RichText` and with `StyledText` reported `linkHovered("dt:0")`, then `linkHovered("")` on leaving, `linkActivated("dt:1")` on a click, and `linkAt(x, y)` returned the href or `""` *(checked)*. Without QtQuick.Controls use an own layer item as the last child of `window.contentItem` with a high `z` *(verify)*; separate `Window`s with `Qt.ToolTip` flags can leave the main window but not on Wayland *(verify)*.

Escape every glossary text before it goes into rich text (`&`, `<`, `>`, `"`): in C++ with `toHtmlEscaped()`, in QML JavaScript with a five-line replace function. `Text.StyledText` is faster but knows fewer tags (no `<code>` font); `Text.RichText` takes `<code>` and `style="color:…"` *(checked)*.

**Term geometry** (focus ring, page terms): `Text` has `linkAt()` but no rectangle per link. A read-only `TextEdit { readOnly: true; textFormat: TextEdit.RichText }` has the same link signals plus `positionAt(x, y)` and `positionToRectangle(pos)`, which give the term's box character by character *(checked)*. **Keyboard focus**: links in `Text` are not focusable; keep a focus index per window, draw the ring from those rectangles and handle Tab, Enter and Space in the controller's key filter (section 7.3).

## 5. Look: the values of `deeptip.css`

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border, hint line | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % alpha | same |
| button hover background | black at 7 % | white at 9 % |
| missing link | `#dd3333` | `#dd3333` |

Measures: width 240–384 px (natural width of the longest plain line, measured with `QFontMetricsF::horizontalAdvance()`, plus 24 padding and 2 border), height at most 480 (the body scrolls), font 14 px (`QFont::setPixelSize(14)`, QML `font.pixelSize: 14`), line height 1.5, radius 8, border 1 px (pinned: accent), header padding 6 6 2 12, buttons 26 × 26 with 15 px icons from the SVG paths `PIN_PATH` and `CLOSE_PATH` of `deeptip.js` (`QSvgRenderer`, or QML `Shape`/`PathSvg`), body padding 0 12 10 with blocks 7 px apart, "See also" at 0.9, hint at 0.75 and opacity 0.6 (hidden when pinned), flash a 3 px accent ring for 0.6 s, lock bar 2 px growing over `lockAfter`. Qt rich text knows `text-decoration: underline` but no dotted or wavy line. Light or dark: `QGuiApplication::styleHints()->colorScheme()` (Qt 6.5+), in QML `Application.styleHints.colorScheme` *(verify)*.

## 6. Placement and coordinates

All Qt 6 coordinates are device-independent pixels, so [§8](../../docs/algorithms.md#8-placement) needs no DPI handling; only the viewport origin must be subtracted (PySide6 pitfall 13).

- **Widgets**: the PySide6 guide's [`_place`](../python-pyside6/README.md#placement-8) translates line by line: target box `QRect(w->mapToGlobal(QPoint(0, 0)), w->size())` (children: the parent window's box), viewport `QGuiApplication::screenAt(center)->availableGeometry()` (or the host window in overlay mode), size limits, `computePlacement`, a second pass with `[side]` when `maxW`/`maxH` is set, `move()`. Use `x() + width()` for the far edge: `QRect::right()` is `x + width − 1`.
- **Qt Quick**: everything happens in the overlay layer's coordinates (origin top-left, y down = the space of §8): anchor box `item->mapRectToItem(layer, item->boundingRect())` (QML: `item.mapToItem(layer, 0, 0, item.width, item.height)`), viewport `layer->size()`; measure the window item (`implicitWidth`, then the body's height at the chosen width), compute, set `x`/`y`. Children use their parent window's box.
- Re-place every window that is not frozen, parents before children: after pin and unpin, after `refresh()`, when a window's size changes, when the host window moves or resizes (Widgets: `Move`/`Resize` on it; tool windows do not follow their owner), and in Qt Quick when an anchor's position changes (`QQuickItem::xChanged`, `yChanged`, or once per frame with `QQuickWindow::afterAnimating` while windows are open).

## 7. Events: exact order of operations

### 7.1 The application event filter

```cpp
bool DeepTip::eventFilter(QObject *obj, QEvent *ev)
{
    switch (ev->type()) {
    case QEvent::ShortcutOverride:                 // comes before QShortcut / QML Shortcut and before KeyPress
        if (obj->isWindowType() && wantsKey(static_cast<QKeyEvent *>(ev))) { ev->accept(); return true; }
        break;
    case QEvent::KeyPress:
        if (obj->isWindowType()) return keyPress(static_cast<QKeyEvent *>(ev));   // true = consumed (section 7.3)
        break;
    case QEvent::MouseMove:
        if (obj->isWindowType()) pointerMoved(static_cast<QWindow *>(obj), static_cast<QMouseEvent *>(ev));
        break;
    case QEvent::MouseButtonPress:
        if (obj->isWindowType()) pointerDown(static_cast<QMouseEvent *>(ev));
        break;
    case QEvent::MouseButtonRelease:
        if (obj->isWindowType()) return pointerUp(static_cast<QMouseEvent *>(ev));  // true swallows a long-press click
        break;
    default:
        break;
    }
    return false;
}
```

The filter sees one key or mouse event once per receiver (the `QWindow`, then widgets or items); act once, at the `QWindow`, as the [PySide6 guide](../python-pyside6/README.md#order-of-operations) explains *(checked there; for Qt Quick: the filter saw `Esc` as `ShortcutOverride` and `KeyPress` at the `QQuickWindow` first, checked)*. `isWindowType()` is cheaper than `qobject_cast<QWindow *>`.

### 7.2 Pointer

`pointerMoved(window, ev)` ([§6](../../docs/algorithms.md#6-arming-and-delays)):

1. ignore touch (`ev->pointingDevice()->type() == QInputDevice::DeviceType::TouchScreen`); add the sample `(ev->globalPosition(), clock.elapsed())` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression));
2. resolve `win`, `link`, `trig`: Widgets as in the PySide6 guide (`widgetAt`, walk up; the term comes from `linkHovered`); Qt Quick: `win` = the `TipWindow` that contains the point (in the layer's coordinates), `link` = the term reported by its `linkHovered`, `trig` = the first marked item from the deepest item under the point upwards, only when `win` and `link` are empty;
3. if the triple changed: quiet, `refreshHot()`, `lockTrack()`, arm or disarm.

The label's or `Text`'s `linkHovered` arrives after the filter for the same move: store the term in the record and resolve again (that arms the term), exactly as in the PySide6 guide. Pointer leaving the application: Widgets as in the PySide6 guide (`Leave` on a top-level while `QApplication::widgetAt(QCursor::pos())` is null); Qt Quick: `QEvent::Leave` on the `QQuickWindow` *(verify)*.

`pointerDown` / `pointerUp` follow [§9.2](../../docs/algorithms.md#92-pointer-down-touch) and [§9.1](../../docs/algorithms.md#91-clicks): hush, outside click, long-press (`QTimer` from a touch press, cancelled beyond 10 px or on release; swallow the release and `QEvent::ContextMenu` afterwards), click inside a preview pins it. Touch: Qt synthesizes mouse events from touch; tell them apart by `pointingDevice()->type()`. In Qt Quick a `TapHandler { longPressThreshold: 0.5; onLongPressed: … }` on the marked item is the native long-press *(verify)*.

### 7.3 Keyboard: consuming `Esc` before the application

`wantsKey(ev)` is true for `Qt::Key_Escape` while windows are open, `Qt::Key_F6` while windows are open, `Qt::Key_F1` or `ev->text() == u"?"` when the focus is on a marked element or a term, and Tab / Enter / Space while DeepTip holds the keyboard focus in a Qt Quick window (section 4.2). Accepting `ShortcutOverride` keeps application shortcuts quiet and makes the `KeyPress` arrive; returning `true` from the `KeyPress` hides the key from every widget and item.

*(checked, Qt Quick)*: with a QML `Shortcut { sequence: "Esc" }` and a focused `TextField` with `Keys.onEscapePressed`, a plain `Esc` fired only the `Shortcut`; with the filter accepting `ShortcutOverride` and consuming `KeyPress` at the window, neither the `Shortcut` nor the field saw it. The Widgets case (a `QShortcut` on `Esc`, a focused `QLineEdit`) is checked in the [PySide6 guide](../python-pyside6/README.md#pitfalls) (items 1 and 2).

`keyPress(ev)` ([§9.3](../../docs/algorithms.md#93-keyboard)): `Esc` with windows open → `ev->modifiers() & Qt::ShiftModifier`, or `ev->isAutoRepeat()` held ≥ 600 ms, closes all; a first press closes `newest(focus)`; return `true`. `F6` cycles windows. `F1` or `?` (not `?` inside `QLineEdit`, `QTextEdit`, `QPlainTextEdit`, `QAbstractSpinBox`, or a focused QML `TextInput`/`TextEdit`) opens the focused marked element pinned with focus, or follows the focused term. Printable text into a marked element → `hush`, return `false`.

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm(el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave(w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lockTrack(win)` with `lockAfter > 0` | `stopLock(); pin(win)` ([§7](../../docs/algorithms.md#7-timer-lock)); a `QVariantAnimation` (QML: `NumberAnimation`) only draws the bar |
| flash | `flash(w)` | 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |
| long press | touch press | open pinned |

Single-shot `QTimer` members, `start(ms)` restarts, `stop()` cancels; `QTimer::singleShot(ms, …)` cannot be cancelled and does not fit `schedule()`. `now()` is one `QElapsedTimer` started with the controller (`elapsed()` in ms, monotonic).

### 7.5 Focus

Widgets: as in the PySide6 guide (`activateWindow()`, `body->setFocus(Qt::TabFocusReason)`, the label's link focus). Qt Quick: opening by keyboard gives the window item `forceActiveFocus()` and sets the focus index to the first term; the key filter moves it (Tab, Shift+Tab) and follows it (Enter, Space); closing returns the focus to the anchor (`anchor->forceActiveFocus()` from C++ via `QQuickItem::forceActiveFocus()`), if the focus was inside the closed subtree ([§9.5](../../docs/algorithms.md#95-focus)).

### 7.6 Anchors that move or disappear

`QPointer` anchors that became null, and anchors that are no longer visible (`isVisible()`; Qt Quick: `isVisible()` and `window() != nullptr`), count as removed: previews close, a pinned root freezes at its last box ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Check on each pointer event and when windows are re-placed; connect `QObject::destroyed` for immediate cleanup.

## 8. Accessibility

- **Widgets**: `QWidget` has no setter for the accessible role (only name, description, identifier); register a factory that gives `DeepTipWindow` its role:

```cpp
class TipAccessible : public QAccessibleWidget {
public:
    explicit TipAccessible(QWidget *w) : QAccessibleWidget(w, QAccessible::ToolTip) {}
    QAccessible::Role role() const override
    {
        return widget()->property("dtPinned").toBool() ? QAccessible::Dialog : QAccessible::ToolTip;
    }
};

QAccessible::installFactory([](const QString &className, QObject *object) -> QAccessibleInterface * {
    if (className == QLatin1String("DeepTipWindow") && object && object->isWidgetType())
        return new TipAccessible(static_cast<QWidget *>(object));
    return nullptr;
});
```

  Set `setAccessibleName(title)` and `setAccessibleDescription(plain body)` on the window, and on the root anchor its description while the window is open (restore it on close). `QLabel` links are reachable with Tab when `LinksAccessibleByKeyboard` is set. Whether screen readers notice the role switch on pin without an event *(verify)*.
- **Qt Quick**: `Accessible.role` (`Accessible.ToolTip` for previews, `Accessible.Dialog` when pinned), `Accessible.name`, `Accessible.description`; links inside `Text` are not separate accessible objects, so give each term's focus item (section 4.2) `Accessible.role: Accessible.Link` and `Accessible.name` *(verify with a screen reader)*.
- Reduced motion: no query in Qt; offer an option. High contrast: `QStyleHints::colorScheme()` and the palette.

## 9. Live values, locales, refresh

As in the PySide6 guide: `vars` as a map name → value or `std::function<QVariant(QString key)>`, or one `std::function<QVariant(QString name, QString key)>`; an invalid `QVariant` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)). `setLocale()` loads the missing files of the new chain, then `refresh()` re-renders every window, re-attaches children to the term with the same key and occurrence, re-places the windows ([§4.6](../../docs/algorithms.md#46-refresh)). Use `QLocale::system().name()` (`de_DE`) and take the part before `_` for the chain.

## 10. Loading the glossary (JSON)

**`QJsonObject` does not keep the file order**: it stores keys sorted, and a duplicate key keeps the last value *(checked: `{"zeta":1,"alpha":2,"10":3,…,"alpha":5}` came back as `{"10":3,"alpha":5,…,"zeta":1,…}`)*. The entry order of a glossary and the parity cases need the file order ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)). Three ways:

1. An own small reader into `std::vector<std::pair<QString, Value>>` objects (as the Swing guide's `Json`), on `QString` (UTF-16, like JavaScript).
2. `QJSEngine` (Qt Qml): `engine.evaluate("JSON.parse")` called with the file text, then walk objects with `QJSValueIterator`: it returns JavaScript's order, integer-like keys first, exactly like the reference *(checked: `10, zeta, alpha, beta`)*.
3. `nlohmann::ordered_json` (see the [Dear ImGui guide](../cpp-imgui/README.md)).

Files: `QFile` + `readAll()`, decode with `QString::fromUtf8()` (strip a byte order mark); resources: `:/deeptip/en.json` via `qt_add_resources`. `sources` are templates with `{locale}`, loaded per locale of the chain in template order (core first); a missing file is a warning.

## 11. Porting the pure functions: C++ and Qt pitfalls

`QString` is UTF-16 like a JavaScript string, so indices, `at(i)`, `indexOf(u"]]", from)` and `mid()` behave like the reference's; `QString::split(QRegularExpression(u"\n[ \t]*\n"_s))` keeps empty parts by default. The differences:

1. **Anchors**: QRegularExpression's `$` also matches before a final `\n` *(checked: `a.b\n` passed `KEY_RE` with `$`)*; use `\z` or `QRegularExpression::anchoredPattern()`.
2. **Whitespace**: `\s` matches only ASCII without `UseUnicodePropertiesOption`, and with it matches U+0085 but not U+FEFF *(checked)*; `QChar::isSpace()` and `QString::trimmed()` include U+0085 and exclude U+FEFF (`qchar.h` *(checked)*). JavaScript is the opposite on both. Write one `isJsSpace(char16_t)` (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) and a `jsTrim`, and use them for the bullet test `^\s*[-•]\s+(.*)$`, every trim and the emphasis checks.
3. **`.` matches U+2028** in QRegularExpression, not in JavaScript *(checked)*: check the bullet line by hand.
4. **Bounds**: `s[i + 1]` past the end is `undefined` in JavaScript and an assertion in Qt; test `i + 1 < s.size()`.
5. **`findClose`** advances with `j++` after each skip; port the loop literally.
6. **Placement** in `double` (`QRectF`, not `QRect`); "the side with the most room" keeps the first on ties; JavaScript's `x / 0` is `Infinity` or `NaN`, as IEEE `double` division in C++.
7. **Flatten**: an object is an entry when `title`, `short` or `body` is a string; `$` keys below the top level are skipped; invalid keys are added and reported.

### 11.1 Qt Quick: reuse the reference's JavaScript

QML's JavaScript engine can run the reference's pure functions unchanged. Copy the top of `frameworks/web/deeptip.js` up to the comment `/* === … runtime */` (it exports `VERSION`, `KEY_RE`, `SIDES`, `flattenGlossary`, `parseText`, `collectRefs`, `computePlacement` and uses no DOM) into `deeptip-core.mjs` and import it:

```qml
import "deeptip-core.mjs" as Core
// Core.parseText(src), Core.computePlacement(size, anchor, sides, viewport), Core.flattenGlossary(obj)
```

*(checked)*: in Qt 6.12 the extracted module passed all 24 parity cases through `QJSEngine::importModule()`, and `Core.parseText()` ran in a QML file. The whole `deeptip.js` does not load: its runtime part uses object spread (`{ ...a }`), a syntax error in Qt 6.12's JavaScript engine *(checked)*. List the `.mjs` with the QML files of `qt_add_qml_module` *(verify)*. Keep the copy identical to the reference and update it with each DeepTip release.

## 12. Qt pitfalls

1. **`QJsonObject` sorts keys** (section 10) *(checked)*.
2. **Act at the `QWindow` receiver and accept `ShortcutOverride`** (section 7); the details and checks are in the [PySide6 guide](../python-pyside6/README.md#pitfalls).
3. **QML `Shortcut` beats the focused item's `Keys`**: an app-wide `Esc` shortcut fires before a focused `TextField` sees the key *(checked)*; only the event filter comes earlier.
4. **`Text` links have no geometry and no focus**: use `TextEdit` for rectangles and an own focus index (section 4.2).
5. **Escape glossary text** before rich text (`toHtmlEscaped()`), and do not use `Text.AutoText`, which guesses the format from the content.
6. **`QTimer::singleShot` cannot be cancelled**; timers that DeepTip may cancel are `QTimer` members.
7. **`QRect::right()` is `x + width − 1`**; use `QRectF` or `x() + width()`.
8. **Window flags**: `Qt::Tool | Qt::FramelessWindowHint` plus `WA_ShowWithoutActivating` for Widgets windows (PySide6 guide); `Qt::ToolTip` windows are meant not to take the keyboard focus *(verify per platform)*, which pinned windows need.
9. **Wayland** cannot position top-level windows: use the overlay (Widgets: a child of the host window; Qt Quick: `Overlay.overlay`).
10. **Object spread** and other newer JavaScript syntax do not load in QML's engine (section 11.1).

## 13. Testing

### 13.1 Parity cases

```cpp
// tests/parity.cpp — DEEPTIP_CASES=<DeepTip>/test/cases ctest
class Parity : public QObject {
    Q_OBJECT
private slots:
    void markup_data()
    {
        QTest::addColumn<QString>("src");
        QTest::addColumn<QString>("expected");                    // the case's "blocks" as compact JSON
        for (const Value &c : cases("markup.json"))
            QTest::newRow(qPrintable(c["name"].toString())) << c["src"].toString() << toCompactJson(c["blocks"]);
    }
    void markup()
    {
        QFETCH(QString, src);
        QFETCH(QString, expected);
        QCOMPARE(toCompactJson(astToValue(deeptip::parseText(src))), expected);
    }
    // placement_data/placement: computePlacement(size, anchor, sides, viewport, 8) == expect, numbers as double
    // glossary_data/glossary: {keys, meta, problems} of flatten(input)
};
QTEST_GUILESS_MAIN(Parity)
#include "parity.moc"
```

Write the compact JSON from the order-keeping reader (section 10) with the AST in the shapes of [§2](../../docs/algorithms.md#2-markup-parser) (`"text": null` present for links without own text). Expected: 24 rows passed. With the Qt Quick route, run the cases through `QJSEngine::importModule("deeptip-core.mjs")` instead *(checked: 24 of 24)*.

### 13.2 Behaviour

- Engine tests with a fake clock and host (as in the [Swing guide](../java-swing/README.md#112-behaviour)).
- Widgets and Qt Quick run headless with `QT_QPA_PLATFORM=offscreen` (Qt Quick also `QT_QUICK_BACKEND=software`): drive `QTest::mouseMove(window, pos)`, `QTest::mouseClick(…)`, `QTest::keyClick(window, Qt::Key_Escape)` on the `QWindow`/`QQuickWindow` and assert on the window tree, link signals and the absence of the app's shortcut *(all checked for Qt Quick with these calls)*. The offscreen screen is 800 × 800 at scale 1.

### 13.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 14. The example to build

The same screen as `frameworks/web/example`, as a `QMainWindow` (Widgets) or an `ApplicationWindow` (Qt Quick): a top bar of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`, then `refresh()`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), `?` marked `deeptip.about` with delay 0, a language combo box (`de`, `en`) calling `setLocale()`; four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges; a page text with terms, settings (delay, lock, buttons, hints) and the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia): a filter field and a list). Options: `sources = {"../../glossary/core/{locale}.json", "../../glossary/example/{locale}.json"}` (the download zip keeps the repository layout), fallback `de`, `en`, delay 1000; in English *Prestige* and *Gold* come from the German fallback and show the `DE` badge.

## 15. Limitations compared with the web reference

- **Gamepad** and **vibration**: Qt 6 has no gamepad module; read controllers with SDL's GameController API in a 16 ms `QTimer` (as the PySide6 guide describes).
- **Reduced motion**: no Qt query; an option.
- **Dotted and wavy underlines**: not in Qt rich text.
- **Qt Quick links** have neither geometry nor focus in `Text` (section 4.2).
- **Wayland**: top-level windows cannot be positioned; overlay only.

## 16. Checklist

1. `core` with an order-keeping JSON reader, the parity test 24 of 24 (sections 10, 11, 13.1) — or `deeptip-core.mjs` for Qt Quick (section 11.1).
2. `Glossary`, `Engine` with fake clock and host, tested.
3. The controller's application filter (section 7), then `DeepTipWindow` (Widgets) or `TipWindow.qml` (Qt Quick).
4. Accessibility (section 8), theme (section 5), the example (section 14).
5. Compare with the web example by hand; then list the framework with its state in the main README.
