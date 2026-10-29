# DeepTip for Unity (UI Toolkit): build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Unity project whose runtime UI is made with UI Toolkit (`UIDocument`, `PanelSettings`, UXML and USS), Unity 6 or newer. For uGUI with TextMeshPro read the [Unity (uGUI + TextMeshPro) guide](../unity/README.md); both share the engine-free C# core, the JSON loading and the Esc handshake with the game, which this guide references instead of repeating.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for UI Toolkit. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Statements marked *(checked)* were verified on 2026-10-29 against **Unity 6000.3.24f1**: API names in the XML documentation of the engine modules, behaviour in their decompiled implementation (`UnityEngine.UIElementsModule`, `UnityEngine.TextCoreTextEngineModule`, `UnityEngine.AccessibilityModule`, decompiled with ilspycmd 8.2; marked *(checked in the source)*), and every snippet compiled as C# 9 for .NET Standard 2.1 against those modules and a compiled `Unity.InputSystem` 1.x, together with the C# port of §1, §2 and §8 that passed all 24 shared cases. No editor and no player was run for this guide; points that need one are marked "verify".

## Quick start

**Recognise the project:** `Assets/` and `ProjectSettings/ProjectVersion.txt`, `.uxml` and `.uss` files, a `UIDocument` component with a `PanelSettings` asset in a scene, scripts with `using UnityEngine.UIElements`.

1. Put the C# port of the pure parts into an assembly `DeepTip.Core` and pass `test/cases` (section 12).
2. Build `TipWindowView`, the rich-text builder and `DeepTipHost` as sections 3–7 describe, and the style sheet `deeptip.uss` (section 5).
3. Copy `glossary/core/<locale>.json` and your glossary into `StreamingAssets/deeptip/` (section 8).
4. Add `DeepTipHost` to the GameObject of the `UIDocument`; assign the document, the style sheet, the locale and the sources.
5. Mark elements with `deepTip.SetKey(element, "<key>")`.
6. Validate the glossaries: `node <DeepTip>/tools/deeptip-check.mjs --base en Assets/StreamingAssets/deeptip/core/en.json Assets/StreamingAssets/deeptip/en.json`.

```csharp
public sealed class Hud : MonoBehaviour
{
    [SerializeField] UIDocument document;
    [SerializeField] DeepTipHost deepTip;                 // locale "en", sources "deeptip/core/{locale}.json", "deeptip/{locale}.json"

    void OnEnable() => deepTip.SetKey(document.rootVisualElement.Q<Button>("cart"), "shop.cart");
}
```

**Done when:** resting on the button for 800 ms opens its window below it, above the rest of the UI, hovering a term opens a second window beside the first and a click pins both, `Esc` closes the newest window while a focused `TextField`, `NavigationCancelEvent` handlers and game code that asks `DeepTipHost.EscapeConsumedThisFrame` ignore it, `F1` on the focused button opens its window pinned with the focus inside, and all of it still works with `Time.timeScale = 0`.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary`, `Markup.Parse`, `Placement.Compute` | assembly `DeepTip.Core`, `"noEngineReferences": true`, C# 9 | as in the [uGUI guide, section 1](../unity/README.md#1-parts-to-build) | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement) |
| `TipWindowView` | `VisualElement` subclass | one window | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `UitkMarkup` | static | AST → UI Toolkit rich text | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `DeepTipHost` | `MonoBehaviour` next to the `UIDocument`, `[DefaultExecutionOrder(-10000)]` | overlay, window tree, hover state, timers, input | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input) |
| `deeptip.uss` | style sheet | the look, light and dark | SPEC §8 |
| `DeepTipText`, `DeepTipIndex` | a `Label` with terms; the encyclopedia | terms on normal panels; every entry | [§12](../../docs/algorithms.md#12-encyclopedia) |
| `DeepTipAccessibility` (optional) | builds `UnityEngine.Accessibility` nodes | screen readers | SPEC §6 |

UI Toolkit and its text engine are built-in modules: the runtime assembly `DeepTip.asmdef` references only `DeepTip.Core` and, optionally, `Unity.InputSystem` with the `versionDefines` entry of the [uGUI guide](../unity/README.md#1-parts-to-build). Two names clash with `using UnityEngine.UIElements`: `UnityEngine.UIElements.Box` is a visual element, so do not call the placement rectangle `Box`, and `PointerType` exists in `UnityEngine` and in `UnityEngine.UIElements` *(checked: both ambiguous)*.

## 2. SPEC concept → UI Toolkit primitive

| SPEC | Unity 6 UI Toolkit |
|---|---|
| Top layer for windows | an overlay element, the last child of `UIDocument.rootVisualElement`, absolute on all four edges, `pickingMode = PickingMode.Ignore`; the windows are its children. `Pick` and pointer events skip an element with `Ignore` (its children stay pickable) *(checked in the source)*. Same panel as the game UI: one coordinate space, one focus controller, one event dispatch. `BringToFront()` moves an element to the end of its parent's children. |
| Runtime tooltips | `VisualElement.tooltip` is shown only in the Editor UI *(checked: documentation)*; DeepTip brings its own windows |
| Window | `TipWindowView : VisualElement` with the USS class `dt-win`, placed with `style.left` / `style.top` |
| Rich text | `Label` (`enableRichText`, default on) with TextCore tags `<b>`, `<i>`, `<u>`, `<color>`, `<mark>`, `<noparse>`, `<link>` *(checked in the source: the text generator parses them)* |
| Term | `<link="dt:key">label</link>` inside a `Label`; the label raises `PointerOverLinkTagEvent`, `PointerMoveLinkTagEvent`, `PointerOutLinkTagEvent`, `PointerDownLinkTagEvent` and `PointerUpLinkTagEvent` (namespace `UnityEngine.UIElements.Experimental`) with `linkID`; they trickle down and bubble, so one handler on the root sees them all *(checked)* |
| Element with an explanation (`data-deeptip`) | `deepTip.SetKey(element, key)`, `SetDelay(element, ms)`, `SetPlace(element, "top,bottom")`: dictionaries in the host (UI Toolkit has no attached properties; a custom element can expose them with `[UxmlElement]` and `[UxmlAttribute]`) |
| `data-dt-open`, `data-dt-arming` | USS classes `dt-open` and `dt-arming` on the anchor (`EnableInClassList`); for a rest-progress bar set its `style.transitionDuration` to the delay |
| `pointerover` + `closest()` | `PointerMoveEvent` registered on the root with `TrickleDown.TrickleDown`, then `panel.Pick(evt.position)` and a walk up `hierarchy.parent`; `Pick` also returns disabled elements *(checked in the source)*; the term comes from the link events |
| Pointer type | `evt.pointerType`: `"mouse"`, `"touch"`, `"pen"` (`UnityEngine.UIElements.PointerType`) |
| Clicks | `PointerUpLinkTagEvent` after a `PointerDownLinkTagEvent` with the same id for terms, `Button.clicked` for pin and close, `ClickEvent` on the window for clicks elsewhere inside |
| Keyboard | `KeyDownEvent` on the root with `TrickleDown`; `StopImmediatePropagation()` ends the dispatch before the focused element and before every bubble-up handler *(checked in the source)*; `PreventDefault()` is obsolete in favour of `StopPropagation` and `FocusController.IgnoreEvent` *(checked)* |
| Cancel | `NavigationCancelEvent` is a separate event made from the "Cancel" input (Esc, gamepad B); with the legacy input processor it is sent after the key events of the same frame *(checked in the source)*: stop it too (section 7.6) |
| `schedule(ms, f)` / `cancel` | `element.schedule.Execute(f)` + `StartingIn(ms)`; cancel = `Pause()`. The panel's scheduler runs on `Time.realtimeSinceStartupAsDouble`, so it keeps going at `timeScale = 0` *(checked in the source)* |
| `now()` | `Time.realtimeSinceStartupAsDouble * 1000` (the scheduler's clock) |
| CSS transitions | USS `transition-property`, `transition-duration`; `TransitionEndEvent` can end the timer lock, as `animationend` does on the web |
| Coordinates | panel space: origin top-left, y down, in panel units, which is the space of [§8](../../docs/algorithms.md#8-placement); `worldBound` is in panel coordinates *(checked: documentation)* |
| Focus | `focusable`, `tabIndex` (below 0: never in the Tab ring, still focusable with `Focus()` *(checked in the source)*), `focusController.focusedElement` |
| Long-press, vibration | an own timer on a touch `PointerDownEvent`; `Handheld.Vibrate()` |
| Gamepad | Input System polling (`Gamepad.current`), plus `NavigationMoveEvent` / `NavigationSubmitEvent` / `NavigationCancelEvent` from the input module |
| ARIA | no accessibility API in `UnityEngine.UIElementsModule` *(checked)*; `UnityEngine.Accessibility` (`AccessibilityHierarchy`, `AccessibilityNode`, `AssistiveSupport`) is built by hand (section 10) |
| Theme | USS custom properties `--dt-*` and two classes `dt-light`, `dt-dark` on the overlay (section 5) |

## 3. Data structures

```csharp
public sealed class TipWindow                             // §4
{
    public int Id;
    public string Key = "";
    public TipWindow Parent;
    public readonly List<TipWindow> Children = new List<TipWindow>();
    public object Anchor;                                  // a marked VisualElement, or a TermRef
    public string Via = "api";                             // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public IVisualElementScheduledItem CloseTimer;         // §5 leave()
    public Rect Box;                                       // last placed box, panel coordinates
    public TipWindowView View;
}

// A term inside a Label (a window body, "See also" or a page text): value equality, so a re-rendered text keeps its anchors.
public readonly struct TermRef : IEquatable<TermRef>
{
    public readonly Label Text; public readonly string Key; public readonly int Occurrence;   // the n-th link with this key
    // constructor, Equals, GetHashCode
}
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first (= order in the overlay) | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hover`, `last` | `(TipWindow Win, TermRef? Link, VisualElement Trig)` | §5, §6 |
| `linkUnderPointer` | `(Label Text, string Key)?` from the link events | §6 |
| `samples` | `List<(Vector2 P, double T)>` | §5 |
| `pending` | `(object El, IVisualElementScheduledItem Item)?` | §6 |
| `quiet` | `VisualElement` | §6 `hush` |
| `lockWindow` | `TipWindow` | §7 |
| `escDown`, `escAt`, `escapeFrame` | `bool`, `double`, `int` (static) | §9.3 |
| `press`, `swallow`, `swipe` | pointer id, position, element, scheduled item | §9.2 |
| `padPrev`, `padBAt` | gamepad buttons of the last frame, press time of B | §9.4 |
| `keys`, `delays`, `places` | `Dictionary<VisualElement, …>` | SPEC §3.3 |

Statics such as `escapeFrame` survive play sessions when *Enter Play Mode* skips the domain reload; reset them as the [uGUI guide, section 3](../unity/README.md#3-data-structures) shows.

## 4. Windows and terms

### 4.1 The overlay

```csharp
VisualElement root = document.rootVisualElement;
overlay = new VisualElement { name = "dt-overlay", pickingMode = PickingMode.Ignore };
overlay.style.position = Position.Absolute;
overlay.style.left = 0;
overlay.style.top = 0;
overlay.style.right = 0;
overlay.style.bottom = 0;
overlay.styleSheets.Add(styles);                       // deeptip.uss (section 5)
overlay.AddToClassList("dt-light");
root.Add(overlay);                                     // last child: drawn above the document
```

*(compiled)*. Call `overlay.BringToFront()` before opening a window when the game may have added elements after it. Another `UIDocument` with a higher `sortingOrder` on the same `PanelSettings` shares the panel and works the same; a separate `PanelSettings` makes a separate panel with its own focus controller and picking, which breaks the hover chain between the game UI and the windows.

### 4.2 The window

```csharp
public sealed class TipWindowView : VisualElement
{
    public TipWindow Window;
    public readonly Label Title = new Label(), Body = new Label(), See = new Label(), Hint = new Label();
    public readonly Button Pin = new Button(), Close = new Button();
    public readonly VisualElement LockBar = new VisualElement();
    public readonly ScrollView Scroll = new ScrollView(ScrollViewMode.Vertical);

    public TipWindowView()
    {
        AddToClassList("dt-win");
        focusable = true;
        tabIndex = -1;                                  // focusable from code, never a Tab stop (the web's tabIndex = -1)
        var head = new VisualElement();
        head.AddToClassList("dt-head");
        Title.AddToClassList("dt-title");
        head.Add(Title); head.Add(Pin); head.Add(Close);           // + the fallback badge after the title
        Body.AddToClassList("dt-body");
        See.AddToClassList("dt-see");
        Hint.AddToClassList("dt-hint");
        LockBar.AddToClassList("dt-lock");
        LockBar.pickingMode = PickingMode.Ignore;
        Scroll.Add(Body); Scroll.Add(See);
        Add(head); Add(Scroll); Add(Hint); Add(LockBar);
    }
}
```

*(compiled)*. Content order per [§3](../../docs/algorithms.md#3-rendering-the-ast): title, badge, pin, close; body; "See also"; hint (hidden when pinned, when `hints` is off and after touch input). Pin and close are `Button`s with a 24×24 icon as `background-image` (textures, or `VectorImage` assets of the `PIN_PATH` and `CLOSE_PATH` of `deeptip.js`), 26×26, 40×40 after touch input. Windows are `position: absolute` children of the overlay; their natural size exists only after layout (section 6).

### 4.3 Rendering the AST to rich text

The same table as the [uGUI guide, section 4.3](../unity/README.md#43-rendering-the-ast-to-tmp-rich-text): UI Toolkit's text engine is TextCore, which reads the same tags.

| Node ([§2](../../docs/algorithms.md#2-markup-parser)) | Rich text |
|---|---|
| text | `Plain(v)`: the text, wrapped in `<noparse>…</noparse>` when it contains `<` (glossary text never becomes tags) |
| br | `\n` |
| b, i | `<b>…</b>`, `<i>…</i>` |
| code | `<color=#…>…</color>` (or `<font="…">` with a font asset) |
| var | `<b>value</b>`, the value through `Plain` |
| link, own key | `<b>label</b>` |
| link, missing key | `<color=#DD3333><u>label</u></color>`, no link, one warning |
| link | `<link="dt:key"><color=#…><u>label</u></color></link>` |
| p | blocks joined with `\n\n` (or `-unity-paragraph-spacing`) |
| ul | items as `• ` + text, joined with `\n` |

Never use `<a href="…">` for terms: TextCore opens it with `Application.OpenURL` on pointer up when the target is a well-formed absolute URI, at runtime too, and `dt:key` is one *(checked in the source)*. The `dt:` prefix keeps DeepTip's links apart from other `<link>` users. Colours inside tags must be literal hex values: read them from the style sheet (section 5).

### 4.4 Terms under the pointer

```csharp
root.RegisterCallback<PointerOverLinkTagEvent>(e => OnLink(e.target as Label, e.linkID), TrickleDown.TrickleDown);
root.RegisterCallback<PointerMoveLinkTagEvent>(e => OnLink(e.target as Label, e.linkID), TrickleDown.TrickleDown);
root.RegisterCallback<PointerOutLinkTagEvent>(e => OnLink(null, null), TrickleDown.TrickleDown);
root.RegisterCallback<PointerDownLinkTagEvent>(e => linkPressed = e.linkID, TrickleDown.TrickleDown);
root.RegisterCallback<PointerUpLinkTagEvent>(OnLinkUp, TrickleDown.TrickleDown);

void OnLink(Label text, string linkId)
{
    string key = linkId != null && linkId.StartsWith("dt:", StringComparison.Ordinal) ? linkId.Substring(3) : null;
    var now = text != null && key != null ? (text, key) : ((Label, string)?)null;
    if (now.Equals(linkUnderPointer)) return;
    linkUnderPointer = now;
    ResolveHover();                                     // section 7.1, step 3
}
```

*(compiled; behaviour checked in the source)*:

- A label sends these events only after its text was generated with at least one `<link>`; it then registers its own `TrickleDown` pointer callbacks and sends the link events to itself, so they reach the root's handlers after the pointer event that caused them.
- Treat `PointerMoveLinkTagEvent` like `Over`: with the standard text generator, moving from one term straight onto another sends `Out` and, on the next move, `Over`; with the advanced text generator (`-unity-text-generator: advanced`) it sends `Move` with the new id and no `Out`.
- Use `linkID` only: with the advanced generator `linkText` is a placeholder.
- No public API returns a link's rectangle. A window opened from a term inside a window is placed next to that window ([§8](../../docs/algorithms.md#8-placement)) and needs none; a page term (`DeepTipText`) uses a box of one line height around `evt.position` of its last link event, or the label's `worldBound` when it was opened by keyboard. `label.selection.GetCursorPositionFromStringIndex(i)` exists, but whether its index counts rich-text tags must be verified.

### 4.5 Keyboard and gamepad focus inside windows

Links are not focusable, so the focus inside a window is an index the host keeps, as in the [uGUI guide, section 4.5](../unity/README.md#45-keyboard-and-gamepad-focus-inside-windows): the window root takes the focus (`view.Focus()`), the focus list is its terms in text order, then pin and close; the focused term is rendered with `<mark=#0B69D440>…</mark>` around its label. While the focus is inside a window, `Tab`, `Shift+Tab` and `NavigationMoveEvent` move the index; stop them with `StopImmediatePropagation()` and `focusController.IgnoreEvent(evt)`, which keeps the focus ring from moving the focus *(checked: documentation)*. `Enter` and `NavigationSubmitEvent` follow the focused term or press the focused button.

## 5. Look: `deeptip.uss`

The style properties used below exist in 6000.3 *(checked: `IStyle`)*; the sheet itself was not imported into an editor (verify).

```css
.dt-light { --dt-bg: #ffffff; --dt-fg: #1f2328; --dt-border: #c8cdd5; --dt-accent: #0b69d4; --dt-link: #0b69d4;
            --dt-link-hover: #084f9f; --dt-missing: #dd3333; --dt-hover-bg: rgba(0, 0, 0, 0.07); }
.dt-dark  { --dt-bg: #1b1e24; --dt-fg: #e6e8ec; --dt-border: #3b414d; --dt-accent: #58a6ff; --dt-link: #6cb6ff;
            --dt-link-hover: #9ccfff; --dt-missing: #dd3333; --dt-hover-bg: rgba(255, 255, 255, 0.09); }

.dt-win {
    position: absolute;
    min-width: 240px; max-width: 384px; max-height: 480px;
    background-color: var(--dt-bg); color: var(--dt-fg); font-size: 14px;
    border-width: 1px; border-color: var(--dt-border); border-radius: 8px;
    opacity: 1; translate: 0 0;
    transition-property: opacity, translate, border-color; transition-duration: 0.15s, 0.15s, 0.2s;
}
.dt-win--opening { opacity: 0; translate: 0 4px; }
.dt-win--pinned { border-color: var(--dt-accent); }
.dt-head { flex-direction: row; align-items: center; padding: 6px 6px 2px 12px; }
.dt-title { flex-grow: 1; -unity-font-style: bold; }
.dt-body, .dt-see { padding: 0 12px 10px 12px; white-space: normal; }
.dt-see { font-size: 12.6px; }
.dt-hint { padding: 4px 12px 6px 12px; font-size: 10.5px; opacity: 0.6; border-top-width: 1px; border-color: var(--dt-border); }
.dt-lock { position: absolute; left: 0; bottom: 0; width: 100%; height: 2px; background-color: var(--dt-accent);
           transform-origin: left; scale: 0 1; transition-property: scale; transition-timing-function: linear; }
```

| Token | Light | Dark |
|---|---|---|
| `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| `--dt-fg` | `#1F2328` | `#E6E8EC` |
| `--dt-border` (border, hint line) | `#C8CDD5` | `#3B414D` |
| `--dt-accent` (pinned frame, lock bar, focus) | `#0B69D4` | `#58A6FF` |
| `--dt-link` (terms) | `#0B69D4` | `#6CB6FF` |
| `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| open term background | the term colour at 16 % alpha | same |
| `--dt-missing` | `#DD3333` | `#DD3333` |

Switch themes by swapping `dt-light` / `dt-dark` on the overlay. Rich-text colours are literal values in tags; read them where the style sheet resolves them *(compiled)*:

```csharp
overlay.RegisterCallback<CustomStyleResolvedEvent>(evt =>
{
    if (evt.customStyle.TryGetValue(new CustomStyleProperty<Color>("--dt-link"), out Color c)) linkColor = c;   // then refresh()
});
```

USS in 6000.3 has no `box-shadow`, `outline`, `line-height`, dotted or wavy underlines *(checked: the style properties of `IStyle`)*: give the window a 9-sliced background image with a soft shadow (`background-image`, `-unity-slice-left/right/top/bottom`) or go without; terms get a solid `<u>` underline. Sizes are CSS pixels = panel units: radius 8, border 1, font 14, padding 12, min width 240, max width 384, max height 480, gap 8, code at 0.92 em. Motion: windows fade in over 150 ms (remove `dt-win--opening` one frame after adding the window), the lock bar scales over `lockAfter`, a flash is a 3 px accent border for 0.6 s.

## 6. Placement and coordinates

DeepTip computes in panel space: origin top-left, y down, in panel units ([§8](../../docs/algorithms.md#8-placement)). The viewport is `overlay.panel.visualTree.layout.size`; anchor boxes are `worldBound`, window boxes their own `layout`. `PanelSettings` decides how panel units map to screen pixels (`scaleMode`: constant pixel size, constant physical size, scale with screen size): placing in panel units follows the game's UI scale, as the uGUI guide places in canvas units. A screen position from polled input is converted with `RuntimePanelUtils.ScreenToPanel(panel, new Vector2(x, Screen.height - y))`: the conversion itself only divides by the panel scale, so flip y first *(checked in the source)*.

The natural size exists only after the panel's layout pass, so a window is placed in two steps *(compiled)*:

1. Add the view with `style.visibility = Visibility.Hidden` and the class `dt-win--opening`, its `min-width`, `max-width`, `max-height` limited to the viewport minus 16; register `GeometryChangedEvent` on it.
2. In `GeometryChangedEvent`: `Placement.Compute(view.resolvedStyle.width, view.resolvedStyle.height, targetBox, sides, vp.x, vp.y, 8)`. If `maxW` or `maxH` is set, write them to `style.maxWidth` / `style.maxHeight` and return: the next layout pass raises the event again, and the `ScrollView` scrolls. Else set `style.left`, `style.top`, make the view visible, remember its box.

```csharp
void Place(TipWindow w)                                // from GeometryChangedEvent of w.View
{
    if (w.Frozen) return;                              // §4.5
    TipWindowView view = w.View;
    Rect t = w.Parent != null ? w.Parent.Box : AnchorBox(w.Anchor);
    Vector2 vp = overlay.panel.visualTree.layout.size;
    float natW = view.resolvedStyle.width, natH = view.resolvedStyle.height;
    var p = Placement.Compute(natW, natH, new PlaceBox(t.xMin, t.yMin, t.xMax, t.yMax), Sides(w), vp.x, vp.y, 8);
    if (p.MaxW > 0 || p.MaxH > 0)
    {
        if (p.MaxW > 0) view.style.maxWidth = (float)p.MaxW;
        if (p.MaxH > 0) view.style.maxHeight = (float)p.MaxH;
        return;                                        // placed again after the next layout pass, with [p.Side]
    }
    view.style.left = (float)p.X;
    view.style.top = (float)p.Y;
    view.style.visibility = Visibility.Visible;
    w.Box = new Rect((float)p.X, (float)p.Y, natW, natH);
}
```

After a shrink, compute once more with `[p.Side]` only (remember it on the window). `Sides(w)`: `SetPlace` of the anchor (roots only), else `child` or `root`. Re-place a window when its target box, its size or the viewport changed: `GeometryChangedEvent` of the window, of a root anchor and of the overlay covers resizing, scrolling and pinning. Whether the layout pass places the window in the same frame or one frame later must be verified in a player; the window stays hidden until it is placed.

## 7. Events: exact order of operations

`DeepTipHost` carries `[DefaultExecutionOrder(-10000)]`, so its `Update` runs before the game's scripts. Panel events are dispatched while the event system updates; the scheduler fires during the panel update.

### 7.1 Pointer moved

```csharp
void OnPointerMove(PointerMoveEvent evt)               // registered on the root with TrickleDown.TrickleDown
{
    if (press != null && evt.pointerId == press.PointerId && ((Vector2)evt.position - press.Start).magnitude > 10) PressEnd();
    if (evt.pointerType == UnityEngine.UIElements.PointerType.touch) return;
    AddSample(evt.position, Now());                    // §5 samples, before anything else
    VisualElement picked = overlay.panel.Pick(evt.position);
    hoverWin = null; hoverTrig = null;
    for (VisualElement e = picked; e != null; e = e.hierarchy.parent)
    {
        if (hoverWin == null && e is TipWindowView v) hoverWin = v;
        if (hoverTrig == null && keys.ContainsKey(e)) hoverTrig = e;
    }
    ResolveHover();
}
```

`ResolveHover`: 1. `win` = `hoverWin` (skip windows that are closing); 2. `link` = `linkUnderPointer` as a `TermRef` (the occurrence counted in the label's text) when its label is inside `win` or is a page text; 3. `trig` = `hoverTrig` only when there is neither; 4. if the triple differs from the last one → "on pointer over" of [§6](../../docs/algorithms.md#6-arming-and-delays): hover, quiet reset, `refreshHot`, `lockTrack`, arm or disarm.

### 7.2 Pointer left the panel

`PointerLeaveEvent` on the root: `hover = {}`, `disarm()`, `lockTrack(none)`, `refreshHot()`. Whether a runtime panel sends it when the pointer leaves the game window must be verified; else test in `Update` whether the pointer is outside `Screen` or `Application.isFocused` is false.

### 7.3 Pointer pressed and released, touch

`PointerDownEvent` and `PointerUpEvent` on the root with `TrickleDown`, in the order of [§9.2](../../docs/algorithms.md#92-pointer-down-touch):

1. Down: `win` = the window under `evt.position`; not in a window and not touch → `hush(marked element)`; not in a window → `outsideClickCloses` (`"always"`, or `"touch"` for touch) closes all; touch on a marked element and not on a term → `pressStart` (`schedule.Execute(...).StartingIn(longPress)`, remembering `evt.pointerId` and the position); touch on a window header outside its buttons → swipe start.
2. Up: end a press of that pointer; a swipe with dy > 60 and |dx| < 60 closes all.
3. After a long-press opened a window, the release must not click the element: while the swallow is active (1.5 s), stop the `PointerUpEvent` and the following `ClickEvent` of that pointer on that element with `StopImmediatePropagation()` (verify on a device that `Button.clicked` stays silent).

### 7.4 Clicks ([§9.1](../../docs/algorithms.md#91-clicks))

- `PointerUpLinkTagEvent` whose `linkID` equals the one of the last `PointerDownLinkTagEvent` → `follow(term, the window of the label or none for page texts, focus: false)`; remember that this click followed a term.
- Pin and close `Button.clicked` → `pin`/`unpin`, `close(win, focusBack: true)`.
- `ClickEvent` on a window that did not follow a term and did not hit a button → `clickInsidePins`.

### 7.5 Keys ([§9.3](../../docs/algorithms.md#93-keyboard))

```csharp
void OnKeyDown(KeyDownEvent evt)                        // registered on the root with TrickleDown.TrickleDown
{
    if (evt.keyCode == KeyCode.Escape || evt.character == (char)27)
    {
        if (windows.Count == 0) return;                 // the game gets this Esc
        if (evt.keyCode == KeyCode.Escape)
        {
            bool repeat = escDown;                      // no repeat flag: escDown is cleared by KeyUpEvent
            if (!repeat) { escDown = true; escAt = Now(); }
            if (evt.shiftKey || (repeat && Now() - escAt >= 600)) CloseAllAndFocusRootAnchor();
            else if (!repeat) Close(Newest(overlay.focusController?.focusedElement as VisualElement), focusBack: true);
        }
        escapeFrame = Time.frameCount;
        evt.StopImmediatePropagation();                 // no TextField, no game handler sees it
        overlay.focusController?.IgnoreEvent(evt);
        return;
    }
    if (evt.keyCode == KeyCode.F6 && windows.Count > 0) { Cycle(evt.shiftKey ? -1 : 1); evt.StopImmediatePropagation(); return; }
    bool open = evt.keyCode == KeyCode.F1 || (evt.character == '?' && !(overlay.focusController?.focusedElement is TextField));
    if (open && OpenFocused()) evt.StopImmediatePropagation();
}

void OnCancel(NavigationCancelEvent evt)                // registered on the root with TrickleDown.TrickleDown
{
    if (windows.Count == 0 && escapeFrame != Time.frameCount) return;
    evt.StopImmediatePropagation();                     // Esc and gamepad B belong to DeepTip while windows are open
    overlay.focusController?.IgnoreEvent(evt);
}
```

*(compiled)*. One key press can arrive as two `KeyDownEvent`s, one with the key code and one with the character, hence both tests. Polled input cannot be consumed: game code that reads `Input.GetKeyDown(KeyCode.Escape)` or an Input System action bound to Esc asks `DeepTipHost.EscapeConsumedThisFrame` first, exactly as in the [uGUI guide, section 7.3](../unity/README.md#73-keys-93). Text typed into a marked `TextField` (`KeyDownEvent` with a printable `character`, no Ctrl/Alt/Command) → `hush` it.

### 7.6 Timers and the frame loop

- `closeTimer`, `pending`, the `RETRY` re-checks (90 ms), the long-press and the swallow end: `overlay.schedule.Execute(f).StartingIn(ms)`, cancelled with `Pause()`. They run on the panel clock, which ignores `timeScale` *(checked in the source)*; scheduled items fire during the panel update, so their resolution is one frame.
- Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): set `LockBar.style.transitionDuration` to `lockAfter` and `scale` to 1, and pin the window in the bar's `TransitionEndEvent` if it is still the lock window; stop = duration 0 and `scale` 0 (or a scheduled item, if you prefer not to depend on the transition).
- Flash ([§4.4](../../docs/algorithms.md#44-flashw)): add a class with a 3 px accent border for 600 ms.
- `Update`: poll the gamepad ([§9.4](../../docs/algorithms.md#94-gamepad), mapping as in the uGUI guide: `buttonSouth` A, `buttonEast` B with tap and 600 ms hold, `buttonNorth` Y, shoulders), and remove windows whose anchor left the panel (section 7.8).

### 7.7 Focus ([§9.5](../../docs/algorithms.md#95-focus))

`focusWindow`: `view.Focus()` and the focus index on the first term (section 4.5), else on the view. `hadFocus` = `focusController.focusedElement` is the view of the window or of a descendant, or inside one. Closing with focus inside → `anchor.Focus()` if the anchor is still in the panel; a `TermRef` anchor → its window with the index on that term. F6 cycles windows newest first.

### 7.8 Anchors that disappear

`DetachFromPanelEvent` on a root anchor, or `anchor.panel == null` / `resolvedStyle.display == DisplayStyle.None` in `Update`: previews close, a pinned root freezes at `w.Box` ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Term anchors are replaced when their label is re-rendered (section 9).

## 8. Loading the glossaries

Exactly as the [uGUI guide, section 8](../unity/README.md#8-loading-the-glossaries): files in `StreamingAssets/deeptip/` (read through `UnityWebRequest` where they sit inside an archive: Android, WebGL) or `Resources`, parsed with Newtonsoft `JObject` (keeps the file order and, like `JSON.parse`, the last value of a repeated key at its first position), in the order of [§1.2](../../docs/algorithms.md#12-layers-locales-lookup): for each locale of the chain, core first, project after. Validate the same files with `tools/deeptip-check.mjs`.

## 9. Live values, locales, refresh

Live values are read when a window renders ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)). `refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): set every window's label texts again, re-attach each child to the `TermRef` with the same key and occurrence, mark it open, and let `GeometryChangedEvent` re-place what changed size; re-render every `DeepTipText` and `DeepTipIndex`. A locale switch loads the files of the new chain (coroutine), then refreshes; register `refresh` with the game's own language switch and with the theme switch (section 5).

`DeepTipIndex` ([§12](../../docs/algorithms.md#12-encyclopedia)): a `TextField` for the search and a `ScrollView` (or `ListView`) with one entry per row (title as a term, the `short` line, "Mentioned in" with terms), sorted with `string.Compare(a, b, culture, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace)`.

## 10. Accessibility

UI Toolkit has no screen reader support of its own in 6000.3 *(checked)*. Unity's `UnityEngine.Accessibility` module feeds the platform screen readers it supports *(compiled)*:

```csharp
AccessibilityNode node = hierarchy.AddNode(title);         // a window; AddNode(label, parent) for its terms
node.role = AccessibilityRole.StaticText;                  // terms: AccessibilityRole.Button with node.invoked += () => { Follow(...); return true; }
node.hint = shortLine;                                     // the body as plain text in node.value
node.frameGetter = () => ScreenRect(view.worldBound);      // screen coordinates (verify the y direction on the target platform)
if (AssistiveSupport.isScreenReaderEnabled) AssistiveSupport.notificationDispatcher.SendAnnouncement(title);
```

- Add the nodes to the game's `AssistiveSupport.activeHierarchy` (or set one) and remove them with `RemoveNode` when the window closes; call `notificationDispatcher.SendLayoutChanged(node)` after opening by keyboard or gamepad.
- The roles have no link, tooltip or dialog: terms are buttons, windows static text with the title as label *(checked: the `AccessibilityRole` values)*.
- Focus as in 7.7; buttons 40×40 after touch input. Reduced motion has no runtime query in Unity: offer an option that drops the fade and the flash animation; the lock bar still runs.

## 11. Pitfalls

- **Experimental namespace**: the link tag events live in `UnityEngine.UIElements.Experimental`; their names may change in later versions.
- **Advanced text generator**: `linkText` is a placeholder and terms switch with `Move` events (section 4.4).
- **`<a href>` opens URLs** at runtime (section 4.3).
- **Layout is asynchronous**: no natural size before `GeometryChangedEvent`; keep new windows hidden until placed (section 6).
- **Two cancel paths**: `KeyDownEvent` and `NavigationCancelEvent` are separate; stopping one does not stop the other (section 7.5). Polled input cannot be stopped at all: the game asks the flag.
- **Names**: `Box` and `PointerType` (section 1).
- **The overlay must stay the last child** of the document root, and in the same panel (section 4.1).
- **Disabled elements** receive no pointer events, but `Pick` finds them, which is why the host hit-tests itself (section 7.1).
- **Domain reload off**: reset statics (section 3).

## 12. Testing

### 12.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

`DeepTip.Core` has no engine references, so its files compile in a plain .NET test project with `<LangVersion>9.0</LangVersion>`, run with `dotnet test`, no editor needed; the tests are those of the [uGUI guide, section 10.1](../unity/README.md#101-parity-cases-11) and the [Avalonia guide, section 10.1](../avalonia/README.md#101-parity-cases-11). *(checked: the same C# 9 port compiled against the 6000.3 engine modules for .NET Standard 2.1, and passed all 24 cases on .NET 8 and .NET 10.)*

### 12.2 Behaviour

Unity 6.3 ships the package `com.unity.ui.test-framework` 6.3.0, whose `PanelSimulator` drives a panel in EditMode and PlayMode tests with `MouseMove`, `MouseDown`, `MouseUp`, `Click`, `KeyDown`, `KeyPress`, `TabKeyPress` and `FrameUpdate`, and controls the panel time with `IncrementCurrentTimeMs` (read in the package source, not run). That covers rest, previews, grace, tendency (move the pointer in steps between frames), suppression, Esc, Shift+Esc, F1 and Tab inside windows without a player. Compare the rest by hand with the web example (`npm run demo`).

## 13. The example to build

A script that builds the screen in code (or a UXML file with named elements): a HUD row of `Button`s marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with delay 0, a language button (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`, absolutely positioned in the corners) for placement at the screen edges, a page text with terms (`DeepTipText`) and the encyclopedia (`DeepTipIndex`). Glossaries copied to `StreamingAssets/deeptip/core/{locale}.json` and `StreamingAssets/deeptip/example/{locale}.json` from `glossary/core` and `glossary/example`.

## 14. Limitations compared with the web reference

- **Screen readers** only through hand-built `UnityEngine.Accessibility` nodes, on the platforms Unity supports for it; no link, tooltip or dialog roles.
- **Esc** cannot be withheld from code that polls input itself; the game asks (section 7.5).
- **Look**: no shadow, outline, line height, dotted or wavy underline in USS (section 5).
- **Page-term boxes** are approximated (section 4.4).
- **Not run**: the guide was checked against the engine's code, not in a player; the points marked "verify" need one.

## 15. Checklist

1. `DeepTip.Core` with `flatten`, `parseText`, `computePlacement`, the glossary and live values; pass `test/cases` (section 12.1).
2. Overlay, `TipWindowView`, the rich-text builder, link events and focus index (section 4); `deeptip.uss` (section 5); two-step placement (section 6).
3. `DeepTipHost`: pointer, link, key and cancel handlers, scheduler, gamepad, Esc flag (section 7); tests with the panel simulator (section 12.2).
4. The example (section 13); compare with the web example by hand.
5. Then list the framework with its state in the main README.
