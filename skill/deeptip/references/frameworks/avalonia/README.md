# DeepTip for Avalonia: build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in an Avalonia 11 desktop application with C#.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Avalonia. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Statements marked *(checked)* were verified on 2026-10-29 with **Avalonia 11.3.8 on .NET 8** (Windows 11): every API name against the assemblies, the behaviour in a headless Avalonia app rendered with Skia, every snippet compiled, and a C# port of §1, §2 and §8 passed all 24 shared cases. Avalonia 12 moved and renamed some APIs; re-check names there.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary` | plain C# | files per locale, layers, fallback chain, `$ui` labels, live values | [§1](../../docs/algorithms.md#1-data) |
| `Markup.Parse` | plain C# | glossary text → AST | [§2](../../docs/algorithms.md#2-markup-parser) |
| `Placement.Compute` | plain C# | `computePlacement` | [§8](../../docs/algorithms.md#8-placement) |
| `DeepTip` (attached properties) | Avalonia | `Key`, `Delay`, `Place` on any control | SPEC §3.3, §4 |
| `TermButton` | Avalonia control | one term: a real button inside the text flow | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `TipWindowView` | Avalonia control | one window | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `DeepTipHost` | one per `TopLevel` | overlay, window tree, hover state, timers, input | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input) |
| `DeepTipText`, `DeepTipIndex` | Avalonia controls | terms on normal pages, the encyclopedia | [§3](../../docs/algorithms.md#3-rendering-the-ast), [§12](../../docs/algorithms.md#12-encyclopedia) |

Keep the three plain-C# parts free of Avalonia types: they are what the shared parity cases test (section 10), and the same port serves every .NET UI (the [Unity guide](../unity/README.md) uses it unchanged).

## 2. SPEC concept → Avalonia primitive

| SPEC | Avalonia 11 |
|---|---|
| Top layer for windows | `OverlayLayer.GetOverlayLayer(topLevel)`: a `Canvas` that the window's `VisualLayerManager` creates on first access at `ZIndex` 2147483550, above the content, the adorner layer and the light-dismiss layer *(checked)*. Same `TopLevel`: one coordinate space, one input stream, the window's styles and resources apply. |
| Window | `TipWindowView` (a `Border` subclass) in `overlay.Children`, positioned with `Canvas.SetLeft/SetTop`; the last child is drawn on top |
| Rich text | `TextBlock.Inlines` with `Run`, `Bold`, `Italic`, `LineBreak` (namespace `Avalonia.Controls.Documents`) |
| Term (a real button, SPEC §6) | `new InlineUIContainer(new TermButton(key, label))`: a focusable `Button` in the text flow; Tab, Enter, Space and UI Automation work natively *(checked)* |
| Element with an explanation (`data-deeptip`) | attached properties `DeepTip.Key`, `DeepTip.Delay` (ms), `DeepTip.Place` (`"top,bottom"`) |
| `data-dt-open`, `data-dt-arming` | style classes on the anchor: `anchor.Classes.Set("dt-open", true)`; also `ToolTip.SetIsOpen(anchor, false)` so the app's simple tooltip hides *(checked)* |
| `data-dt-pinned` on windows | `PseudoClasses.Set(":pinned", pinned)` inside `TipWindowView` (stylable) |
| `pointerover` + `closest()` | one tunnel handler for `PointerMoved` on the `TopLevel` (`handledEventsToo: true`), then `topLevel.InputHitTest(point, enabledElementsOnly: false)` and a walk up `GetVisualParent()` *(checked)* |
| Pointer type | `e.Pointer.Type`: `PointerType.Mouse`, `Pen`, `Touch` |
| Clicks | `Button.Click` for terms, pin and close; `PointerReleased` on the window view for clicks elsewhere inside it |
| Keyboard | tunnel handlers for `KeyDown`, `KeyUp`, `TextInput` on the `TopLevel`; `e.Handled = true` consumes *(checked)* |
| `schedule(ms, f)` / `cancel` | `DispatcherTimer.RunOnce(f, TimeSpan.FromMilliseconds(ms))` returns an `IDisposable`; `Dispose()` cancels *(checked)* |
| `now()` | `Stopwatch.GetTimestamp()` converted to ms (monotonic) |
| CSS transitions | `Transitions` with `DoubleTransition` (`Visual.OpacityProperty`, `ScaleTransform.ScaleXProperty`) *(checked)* |
| Long-press | an own timer on a touch `PointerPressed`; `Gestures.HoldingEvent` waits the platform's `IPlatformSettings.HoldWaitDuration`, which cannot be set to `longPress` *(checked)* |
| Theme (light/dark) | `ResourceDictionary.ThemeDictionaries[ThemeVariant.Light / Dark]`, bound with `control.Bind(property, control.GetResourceObservable(key))` *(checked)* |
| `forced-colors` | `topLevel.PlatformSettings?.GetColorValues().ContrastPreference == ColorContrastPreference.High` *(checked)* |
| ARIA | `AutomationProperties.Name`, `HelpText`, `ControlTypeOverride` *(checked)* |
| Vibration, gamepad, `prefers-reduced-motion` | no API in Avalonia 11 on desktop (section 12) |

Why not `Popup`: a `Popup` (even with `ShouldUseOverlayLayer = true` and `PlacementMode.Custom`) brings its own opening, closing and placement logic that DeepTip's window tree, hot set and `computePlacement` would have to work around, and non-overlay popups are separate native windows with their own coordinates and input. The overlay layer is the native top layer of a `TopLevel` and leaves all of that to DeepTip.

## 3. Data structures

```csharp
public sealed class TipWindow                     // §4
{
    public int Id;
    public string Key = "";
    public TipWindow? Parent;
    public readonly List<TipWindow> Children = new();
    public Control Anchor = null!;                 // the marked element, or the TermButton it came from
    public string Via = "api";                     // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public IDisposable? CloseTimer;                // §5 leave()
    public Rect Box;                               // last placed box, overlay coordinates
    public TipWindowView View = null!;
}
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first (= order of the overlay children) | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hover` | `(TipWindow? Win, TermButton? Link, Control? Trig)` | §5, §6 |
| `samples` | `List<(Point P, long T)>` | §5 |
| `pending` | `(Control El, IDisposable Timer)?` | §6 |
| `quiet` | `Control?` | §6 `hush` |
| `lockWindow`, `lockTimer` | `TipWindow?`, `IDisposable?` | §7 |
| `escHeld`, `escAt` | `bool`, `long` | §9.3 |
| `press`, `swallow`, `swipe` | small records with pointer id, position, element, timer | §9.2 |
| `seq`, `warned` | `int`, `HashSet<string>` | §4, §1 |

The glossary keeps `data[locale]` as `Dictionary<string, Entry>` (`Entry`: `Title`, `Short`, `Body`, `Aliases`, `See`), `labels[locale]` as `Dictionary<string, string>`, the chain as `List<string>`, and the live values as `Func<string, string?, object?>` (name, window key). Name the AST classes differently from Avalonia's inlines (`BoldNode`, not `Bold`), or every file needs aliases.

## 4. Windows and terms

### 4.1 The top layer

```csharp
TopLevel top = TopLevel.GetTopLevel(window)!;          // after the window is shown (Opened or Loaded)
OverlayLayer overlay = OverlayLayer.GetOverlayLayer(top)!;
overlay.UpdateLayout();                                // a new layer has empty Bounds until the next layout pass
```

*(checked)*: right after the first access `overlay.Bounds` was 0×0, after `UpdateLayout()` it was the client size (900×600), and the layer starts at (0, 0) of the client area. Placing against the empty bounds put the first window on the wrong side.

### 4.2 The window view

`TipWindowView : Border` (an own class, so hit tests can recognise it and it can set pseudo-classes):

- `Focusable = true` (focus target when a window has no terms); `Background` from the theme (non-null, so the whole window is hit-testable); `BorderThickness = 1`, `CornerRadius = 8`, `BoxShadow = BoxShadows.Parse("0 10 30 0 #4D000000")`, `MinWidth = 240`, `MaxWidth = 384`.
- Text properties are `TextElement` attached properties (namespace `Avalonia.Controls.Documents`): `[TextElement.FontSizeProperty] = 14.0`, `TextElement.ForegroundProperty`. `Border` has no `Foreground` or `FontSize` of its own *(checked: compile error otherwise)*.
- Child: a `Grid` with `RowDefinitions("Auto,*,Auto,Auto")`:
  - row 0 header, a `DockPanel` with margin 12,6,6,2: close button and pin `ToggleButton` docked right (26×26, icon 15×15, opacity 0.6, 1.0 on hover; 40×40 when the last pointer was touch), the fallback badge (§3), the title (`FontWeight.SemiBold`);
  - row 1 a `ScrollViewer` with the body blocks, padding 12,0,12,10;
  - row 2 "See also", padding 12,0,12,10, font size × 0.9, the label at opacity 0.7;
  - row 3 the hint line, top border 1 px, padding 12,4,12,6, font size × 0.75, opacity 0.6; hidden when pinned, when `hints` is off and when the last pointer was touch.
- The lock bar: a `Border` of height 2 in the accent color spanning all rows (`Grid.RowSpan = 4`, `VerticalAlignment.Bottom`), `IsHitTestVisible = false`, `RenderTransformOrigin = new RelativePoint(0, 0.5, RelativeUnit.Relative)`, `RenderTransform = new ScaleTransform(0, 1)` (section 7.6).
- Icons: the 24×24 stroke paths `PIN_PATH` and `CLOSE_PATH` of `deeptip.js` as `Path { Data = Geometry.Parse(...), Stroke = …, StrokeThickness = 2, StrokeLineCap = PenLineCap.Round, StrokeJoin = PenLineJoin.Round, Stretch = Stretch.Uniform }`; pinned: the pin filled with the accent color.

### 4.3 Rendering the AST

One `TextBlock` (`TextWrapping.Wrap`) per `p` block; a `ul` becomes one row per item (a "•" column and a `TextBlock`, left indent 1.2 em); blocks in a `StackPanel` with spacing ≈ 0.5 em. Inlines per [§3](../../docs/algorithms.md#3-rendering-the-ast):

```csharp
void AddInlines(InlineCollection into, IEnumerable<Node> nodes, bool bold, bool italic, string? selfKey)
{
    foreach (Node n in nodes)
    {
        switch (n)
        {
            case TextNode t: into.Add(new Run(t.Value)); break;
            case BreakNode: into.Add(new LineBreak()); break;
            case CodeNode c: into.Add(new Run(c.Value) { FontFamily = mono, FontSize = 0.92 * fontSize }); break;
            case VarNode v: into.Add(new Run(glossary.Value(v.Name, selfKey)) { FontWeight = FontWeight.SemiBold }); break;
            case BoldNode b: { var s = new Bold(); AddInlines(s.Inlines, b.Children, true, italic, selfKey); into.Add(s); break; }
            case ItalicNode i: { var s = new Italic(); AddInlines(s.Inlines, i.Children, bold, true, selfKey); into.Add(s); break; }
            case LinkNode l: into.Add(LinkInline(l, bold, italic, selfKey)); break;
        }
    }
}

Inline LinkInline(LinkNode l, bool bold, bool italic, string? selfKey)
{
    var found = glossary.Entry(l.Key);                       // §1.2: (entry, locale) or null
    string label = l.Text ?? found?.Entry.Title ?? l.Key;
    if (l.Key == selfKey) return new Run(label) { FontWeight = FontWeight.Bold };
    if (found == null)
    {
        WarnOnce(l.Key);
        return new Run(label) { TextDecorations = TextDecorations.Underline, Foreground = missingBrush };
    }
    return new InlineUIContainer(new TermButton(l.Key, label)
    {
        FontWeight = bold ? FontWeight.Bold : FontWeight.Normal,   // Bold/Italic spans do not reach embedded controls
        FontStyle = italic ? FontStyle.Italic : FontStyle.Normal,
    });
}
```

`TextDecoration` has `StrokeDashArray` and `StrokeOffset` for the dotted, offset underline of the web look.

### 4.4 `TermButton`

```csharp
public sealed class TermButton : Button
{
    public string Key { get; }
    public event Action<TermButton, bool>? Follow;         // bool: activated by keyboard
    private bool viaKeyboard;

    public TermButton(string key, string label)
    {
        Key = key;
        Content = label;
        Cursor = new Cursor(StandardCursorType.Hand);
        AutomationProperties.SetName(this, label);
        Template = new FuncControlTemplate<TermButton>((b, _) => new TextBlock
        {
            Text = (string?)b.Content,
            TextDecorations = TextDecorations.Underline,
            Background = Brushes.Transparent,
        });
    }

    // Without this the term floats above the text baseline by the font's descent.
    protected override Size MeasureOverride(Size availableSize)
    {
        Size size = base.MeasureOverride(availableSize);
        if (this.GetVisualChildren().FirstOrDefault() is TextBlock text)
            TextBlock.SetBaselineOffset(this, text.TextLayout.Baseline);
        return size;
    }

    protected override void OnKeyDown(KeyEventArgs e) { viaKeyboard = true; base.OnKeyDown(e); viaKeyboard = false; } // Enter clicks here
    protected override void OnKeyUp(KeyEventArgs e) { viaKeyboard = true; base.OnKeyUp(e); viaKeyboard = false; }     // Space clicks here
    protected override void OnClick() { Follow?.Invoke(this, viaKeyboard); base.OnClick(); }
}
```

*(checked)*: an embedded control sits with its bottom on the baseline unless `TextBlock.BaselineOffset` is set on it (`EmbeddedControlRun.Baseline`); with the line above, the terms' text baselines were within 0.5 px of the line baselines, without it they visibly floated up. `Button` clicks on Enter in `OnKeyDown` and on Space in `OnKeyUp`, so the flag tells keyboard from pointer (the web uses `event.detail === 0`). States: pointer over → link-hover color and solid underline; anchor of an open window → class `dt-open`, background = link color at 16 %; keyboard focus (`GotFocusEventArgs.NavigationMethod` is `Tab` or `Directional`) → a 2 px focus outline.

### 4.5 Alternative: plain runs and hit-testing

Plain `Run`s can wrap inside a long term, but focus and screen reader support must then be emulated; prefer `TermButton`. If you do it *(checked)*:

- Offsets in the text: each `Run` counts `Text.Length`, each `LineBreak` `Environment.NewLine.Length` (2 on Windows, 1 elsewhere), each `InlineUIContainer` 1.
- `textBlock.TextLayout.HitTestTextRange(start, length)` returns the term's rectangles per line, in layout coordinates (subtract `Padding`); a hit is a pointer inside one of them.
- Do not use `HitTestPoint(p).TextPosition` alone: it returns the nearest character even past the end of a line or below the text, and `IsInside` was `false` inside the last line.
- Read `TextLayout` every time: `TextBlock` disposes and rebuilds it on every arrange.

## 5. Look: the values of `deeptip.css`

Put them into theme dictionaries (light/dark) and bind them, so `ActualThemeVariant` switches them *(checked)*:

```csharp
var deeptip = new ResourceDictionary();
deeptip.ThemeDictionaries[ThemeVariant.Light] = new ResourceDictionary { ["DeepTip.Background"] = new SolidColorBrush(Color.Parse("#FFFFFF")) /* … */ };
deeptip.ThemeDictionaries[ThemeVariant.Dark] = new ResourceDictionary { ["DeepTip.Background"] = new SolidColorBrush(Color.Parse("#1B1E24")) /* … */ };
Application.Current!.Resources.MergedDictionaries.Add(deeptip);
view.Bind(Border.BackgroundProperty, view.GetResourceObservable("DeepTip.Background"));
```

| Resource (web token) | Light | Dark |
|---|---|---|
| Background (`--dt-bg`) | `#FFFFFF` | `#1B1E24` |
| Foreground (`--dt-fg`) | `#1F2328` | `#E6E8EC` |
| Border, hint line (`--dt-border`) | `#C8CDD5` | `#3B414D` |
| Accent: pinned frame, lock bar, focus (`--dt-accent`, `--dt-pinned`) | `#0B69D4` | `#58A6FF` |
| Term (`--dt-link`) | `#0B69D4` | `#6CB6FF` |
| Term on hover (`--dt-link-hover`) | `#084F9F` | `#9CCFFF` |
| Open term background (`--dt-link-open-bg`) | term color at 16 % (`#290B69D4`) | `#296CB6FF` |
| Button hover (`--dt-hover-bg`) | `#12000000` | `#17FFFFFF` |
| Missing term underline (`--dt-missing`) | `#DD3333` | `#DD3333` |
| Shadow (`--dt-shadow`) | `0 10 30 0 #4D000000` | same |

Sizes: radius 8, border 1, font size 14 (0.875 rem), line height 1.5, min width 240, max width 384, max height 480, gap 8; code in a monospace font at 0.92 em; live values semi-bold with tabular digits; badge 0.7 em with a 1 px border, radius 3, opacity 0.65. Motion: windows fade in over 150 ms (opacity and 4 px upwards), the lock bar grows linearly over `lockAfter`, a flash is a 3 px accent ring for 0.6 s.

## 6. Placement and coordinates

All boxes are in overlay coordinates: device-independent pixels, origin top-left, y down, which is exactly the space of [§8](../../docs/algorithms.md#8-placement); no conversion is needed.

```csharp
void Place(TipWindow w)
{
    if (w.Frozen) return;                                            // §4.5
    Visual target = w.Parent != null ? w.Parent.View : w.Anchor;     // children sit next to their parent window
    Rect a = new Rect(target.TranslatePoint(default, overlay) ?? default, target.Bounds.Size);
    Size vp = overlay.Bounds.Size;
    TipWindowView view = w.View;
    view.MaxWidth = 384;
    view.ClearValue(Layoutable.MaxHeightProperty);
    view.Measure(Size.Infinity);                                     // natural size
    var p = Placement.Compute(view.DesiredSize, a, Sides(w), vp, gap: 8);
    if (p.MaxW > 0 || p.MaxH > 0)                                    // nothing fits: shrink, the ScrollViewer scrolls
    {
        if (p.MaxW > 0) view.MaxWidth = p.MaxW;
        if (p.MaxH > 0) view.MaxHeight = p.MaxH;
        view.Measure(Size.Infinity);
        p = Placement.Compute(view.DesiredSize, a, new[] { p.Side }, vp, gap: 8);
    }
    Canvas.SetLeft(view, p.X);                                       // no Margin on the view: Canvas places the margin box
    Canvas.SetTop(view, p.Y);
    w.Box = new Rect(p.X, p.Y, view.DesiredSize.Width, view.DesiredSize.Height);
}
```

`Sides(w)`: `DeepTip.Place` of the anchor (roots only), else the `child` order for children and the `root` order for roots. *(checked)*: a 59×30 anchor at (8, 285) in a 900×600 window put the 378×142 root window below it at (8, 323); a term clicked in it opened the 247×82 child to the right of the parent at (394, 353), because the left side had no room.

Re-place every window that is not frozen after each layout pass (`top.LayoutUpdated`) when the target box, the natural size or the viewport changed against the remembered values; that covers window resizing, scrolling (anchors move), pinning (the hint line disappears) and live values. Compare before writing, or the handler feeds itself. One `DeepTipHost` per `TopLevel`; the glossary can be shared.

## 7. Events: exact order of operations

### 7.1 Pointer moved

```csharp
top.AddHandler(InputElement.PointerMovedEvent, OnPointerMoved, RoutingStrategies.Tunnel, handledEventsToo: true);

void OnPointerMoved(object? sender, PointerEventArgs e)
{
    Point p = e.GetPosition(overlay);
    if (press != null && e.Pointer.Id == press.PointerId && Distance(p, press.Start) > 10) PressEnd();   // §9.2
    if (e.Pointer.Type == PointerType.Touch) return;
    AddSample(p, Now());                                              // §5 samples, before anything else
    var hit = top.InputHitTest(e.GetPosition(top), enabledElementsOnly: false) as Visual;
    TermButton? link = null; TipWindowView? win = null; Control? trig = null;
    for (Visual? v = hit; v != null; v = v.GetVisualParent())
    {
        if (link == null && v is TermButton t) link = t;
        if (win == null && v is TipWindowView w) win = w;
        if (trig == null && v is Control c && DeepTip.GetKey(c) != null) trig = c;
    }
    if (win != null || link != null) trig = null;
    if ((win, link, trig) == lastTarget) return;                      // the web reacts to pointerover only
    lastTarget = (win, link, trig);
    OnPointerOver(win?.Window, link, trig);                           // §6 "on pointer over": hover, quiet, refreshHot, lockTrack, arm
}
```

*(checked)*: `InputHitTest` returns the innermost element (`AccessText` inside a button's presenter, the `TextBlock` inside a term), hence the walk up; `enabledElementsOnly: false` finds disabled controls too, so they can explain why they are disabled. A window that is fading out after `close` gets `IsHitTestVisible = false` at once.

### 7.2 Pointer left the window

`top.PointerExited` (mouse and pen): `hover = {}`, `disarm()`, `lockTrack(none)`, `refreshHot()` ([§6](../../docs/algorithms.md#6-arming-and-delays)).

### 7.3 Pointer pressed and released, touch

Tunnel handlers on the `TopLevel` with `handledEventsToo: true`, in the order of [§9.2](../../docs/algorithms.md#92-pointer-down-touch):

1. `PointerPressed`: `win` = window view under the pointer; not in a window and not touch → `hush(marked element)`; not in a window → `outsideClickCloses` (`"always"`, or `"touch"` with a touch pointer) closes all; touch on a marked element that is not a term → `pressStart`: `DispatcherTimer.RunOnce(…, longPress)` remembering `e.Pointer.Id` and the position; touch on a window header outside its buttons → remember the swipe start.
2. `PointerReleased`: end a press of that pointer; a swipe of that pointer with dy > 60 and |dx| < 60 closes all; while a swallow is active for the element under the finger (1.5 s after a long-press opened its window) set `e.Handled = true`, so the `Button` under the finger does not raise `Click` (class handlers skip handled events *(checked)*).
3. `Control.ContextRequestedEvent` (tunnel): `e.Handled = true` while a press runs on the element or its swallow is active; a touch hold raises `ContextRequested` on the control and would open its `ContextMenu` or `ContextFlyout` *(checked: `Control.OnHoldEvent`)*.

### 7.4 Clicks inside windows ([§9.1](../../docs/algorithms.md#91-clicks))

- `TermButton.Follow(term, viaKeyboard)` → `follow(term, its window or none for page terms, focus: viaKeyboard)`.
- Close button `Click` → `close(win, focusBack: true)`; pin `ToggleButton` `Click` → `pin` or `unpin`.
- `TipWindowView.PointerReleased` (plain bubble handler): buttons mark their pointer events handled, so this fires only for clicks on text or background → `clickInsidePins` pins an unpinned window.

### 7.5 Keyboard ([§9.3](../../docs/algorithms.md#93-keyboard))

```csharp
top.AddHandler(InputElement.KeyDownEvent, OnKeyDown, RoutingStrategies.Tunnel);
top.AddHandler(InputElement.KeyUpEvent, (_, e) => { if (e.Key == Key.Escape) escHeld = false; }, RoutingStrategies.Tunnel);
top.AddHandler(InputElement.TextInputEvent, OnTextInput, RoutingStrategies.Tunnel);   // printable text into a marked element → hush

void OnKeyDown(object? sender, KeyEventArgs e)
{
    if (e.Key == Key.Escape)
    {
        if (windows.Count == 0) return;                                 // the application gets this Esc
        bool repeat = escHeld;                                          // KeyEventArgs has no repeat flag
        if (!repeat) { escHeld = true; escAt = Now(); }
        if (e.KeyModifiers.HasFlag(KeyModifiers.Shift) || (repeat && Now() - escAt >= 600)) CloseAllAndFocusRootAnchor();
        else if (!repeat) Close(Newest(FocusedWindow()), focusBack: true);
        e.Handled = true;                                               // TextBox, Window.KeyDown, flyouts never see it
        return;
    }
    if (e.Key == Key.F6 && windows.Count > 0) { Cycle(e.KeyModifiers.HasFlag(KeyModifiers.Shift) ? -1 : 1); e.Handled = true; return; }
    bool open = e.Key == Key.F1 || e.KeySymbol == "?";
    if (!open) return;
    var focused = top.FocusManager?.GetFocusedElement() as Visual;
    if (e.KeySymbol == "?" && focused is TextBox) return;               // "?" is typed text there
    // a focused TermButton → follow(term, its window, focus: true); a focused marked element outside windows → open it pinned with focus
}
```

*(checked)*: with a window open, Esc reached this tunnel handler first and neither the focused `TextBox` nor `Window.KeyDown` saw it; Shift+? arrived as `Key.OemQuestion` with `KeySymbol == "?"`, so test `KeySymbol` (the `Key` differs between keyboard layouts). In the reference, the auto-repeats of a held Esc reach the application once the last window has closed; if your application acts on every repeated `KeyDown`, keep consuming Esc until its `KeyUp` when DeepTip used the press.

### 7.6 Timers

Event-driven like the reference; no frame loop is needed. All callbacks run on the UI thread.

- `closeTimer`, `pending.timer`, the `RETRY` re-checks (90 ms), the long-press and the swallow end are `DispatcherTimer.RunOnce` handles; `Dispose()` cancels.
- Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): start = `scale.Transitions = new Transitions { new DoubleTransition { Property = ScaleTransform.ScaleXProperty, Duration = lockAfter } }; scale.ScaleX = 1;` and `RunOnce(lockAfter, pin if still the lock window)`; stop = cancel, clear the transitions, `ScaleX = 0` *(compiled)*.
- Flash ([§4.4](../../docs/algorithms.md#44-flashw)): accent ring (border 3 px or a second shadow) for 600 ms, a static ring with reduced motion.
- Fade-out on close: remove the window from `windows` at once (§4.2), remove the view from the overlay after its 150 ms opacity transition.

### 7.7 Focus ([§9.5](../../docs/algorithms.md#95-focus))

Focus the first `TermButton` with `term.Focus(NavigationMethod.Tab)` (shows the focus visual), else the window view. Before closing, `hadFocus = view.IsVisualAncestorOf(focused)` for the window and its descendants; afterwards `anchor.Focus(NavigationMethod.Tab)` if it is still attached *(compiled)*. F6 cycles windows newest first.

### 7.8 Anchors that move or disappear, refresh

- Disappeared anchor ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)): check `anchor.IsAttachedToVisualTree()` (extension method in `Avalonia.VisualTree`; the property of the same name is internal *(checked)*) in the `LayoutUpdated` pass, or subscribe to `DetachedFromVisualTree`: previews close, a pinned root freezes at `w.Box`.
- `refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): rebuild every window's content; the old `TermButton`s are gone, so set each child's `Anchor` to the new `TermButton` with its key in the parent and mark it `dt-open`; then re-place.

## 8. Accessibility

- Terms are `Button`s with `AutomationProperties.Name` = label.
- Window: `AutomationProperties.Name` = title, `HelpText` = body as plain text, `ControlTypeOverride` = `AutomationControlType.ToolTip` for previews and `AutomationControlType.Window` for pinned windows (non-modal) *(checked: both values exist)*.
- Root anchor while its window is open: its `AutomationProperties.HelpText` = the window's plain text (the `aria-describedby` of the web); restore the previous value on close.
- Focus as in 7.7; touch targets 40×40 when the last pointer was touch.
- Reduced motion: no platform query, offer an option. High contrast: section 2; then use system colors and a 2 px border on pinned windows.

## 9. Porting the pure functions: C# pitfalls *(checked)*

Measured with the C# port that passed the 24 cases:

- **Whitespace**: JavaScript's `\s` and `trim()` and .NET's `\s` / `char.IsWhiteSpace` / `string.Trim()` differ in exactly two characters: U+0085 is whitespace only in .NET, U+FEFF only in JavaScript. Port with an own `IsJsSpace(char)` and `JsTrim`.
- **Regex**: .NET `$` also matches before a final `\n` (`"a.b\n"` passes `KEY_RE` with `$`); use `\z`. .NET `.` matches U+2028/U+2029, JavaScript's does not; port the bullet test `^\s*[-•]\s+(.*)$` with explicit character checks.
- **String search**: `string.IndexOf(string)` without `StringComparison.Ordinal` is culture-sensitive and skips ignorable characters (in `a]` + U+00AD soft hyphen + `]`, `IndexOf("]]")` finds index 1, the ordinal search −1). Always `StringComparison.Ordinal`, and `string.CompareOrdinal` for `startsWith` at an index.
- **Numbers**: `computePlacement` in `double` (the JS number type); `Enumerable.Aggregate` without seed is `reduce` without initial value.
- **JSON**: file order matters (§1.1). `System.Text.Json` `JsonObject` keeps it, but rejects duplicate property names (`ArgumentException` when the object is first read); JavaScript keeps the last value at the first position. A `Map` keeps the first position of a key when it is set again.
- **C# version**: the port above is C# 9 with block namespaces, so the same files compile in Unity.

## 10. Testing

### 10.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

```csharp
// xUnit; the cases live in <DeepTip>/test/cases
static JsonNode Cases(string file) => JsonNode.Parse(File.ReadAllText(Path.Combine(CasesDir(), file)))!["cases"]!;

[Fact]
public void Markup()
{
    foreach (JsonNode? c in Cases("markup.json").AsArray())
        Assert.True(JsonNode.DeepEquals(c!["blocks"], ToJson(Markup.Parse((string?)c["src"]))), (string?)c["name"]);
}
```

- `ToJson` writes the AST in the exact shapes of [§2](../../docs/algorithms.md#2-markup-parser), including `"text": null` for links without own text: `JsonNode.DeepEquals` (.NET 8) treats a missing property and `null` differently, ignores the key order and compares numbers by value (`192` equals `192.0`) *(checked)*.
- Placement: compare `side`, `fits` and the four numbers with exact `==` on `double`.
- Glossary: entry keys in file order, metadata keys in file order, number of problems.
- `CasesDir()`: walk up from `AppContext.BaseDirectory` until `test/cases/markup.json` exists, or take an environment variable. The cases are in the repository and in the download zip (`test/cases`).

### 10.2 Behaviour, headless

`Avalonia.Headless` (and `Avalonia.Headless.XUnit` with `[AvaloniaFact]`) runs the real controls without a screen *(checked)*:

```csharp
AppBuilder.Configure<App>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false }).WithInterFont().SetupWithoutStarting();
window.Show();
window.MouseMove(point); window.MouseDown(point, MouseButton.Left); window.MouseUp(point, MouseButton.Left);
window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
window.KeyPress(Key.OemQuestion, RawInputModifiers.Shift, PhysicalKey.Slash, "?");
Dispatcher.UIThread.RunJobs(); AvaloniaHeadlessPlatform.ForceRenderTimerTick();
window.CaptureRenderedFrame()?.Save("frame.png");                   // look at the result
```

`DispatcherTimer.RunOnce` and `TopLevel.RequestAnimationFrame` fire in headless runs after the dispatcher is pumped. Headless has no touch input: check long-press, tap-outside and swipe on a device. Make the clock injectable to test grace, tendency and suppression without waiting.

### 10.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions.

## 11. The example to build

The same screen as `frameworks/web/example`: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `DeepTip.Delay="0"`, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms (`DeepTipText`), settings (delay, lock, buttons, hints) and the encyclopedia (`DeepTipIndex`). Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

```xml
<Window xmlns:dt="using:MyApp.DeepTip">
  <Button dt:DeepTip.Key="demo.realm" Content="Realm"/>
  <Button dt:DeepTip.Key="deeptip.about" dt:DeepTip.Delay="0" Content="?"/>
  <Button dt:DeepTip.Key="demo.revolt" dt:DeepTip.Place="top,right" Content="Revolt"/>
</Window>
```

The attached properties are registered on a non-static class: `AvaloniaProperty.RegisterAttached<DeepTip, Control, string?>("Key")` with `GetKey`/`SetKey` *(checked)*.

## 12. Limitations compared with the web reference

- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): Avalonia 11 has no gamepad input on desktop (`KeyDeviceType.Gamepad` only appears where a platform delivers pads as keys). Poll a native library (XInput, SDL) on a `DispatcherTimer` while a pad is connected and the window is active.
- **Vibration** on long-press: no API.
- **Reduced motion**: no platform query; an option.
- **Terms do not wrap inside themselves**: an embedded control is one unit; a long multi-word term moves to the next line as a whole (section 4.5 has the alternative).
- **Touch** cannot be tested headless.

## 13. Checklist

1. Port `flatten`, `parseText`, `computePlacement` (section 9) and pass `test/cases` (section 10.1).
2. `Glossary` with layers, chain, `$ui` labels and live values; validate the same JSON files with `tools/deeptip-check.mjs`.
3. `TermButton`, `TipWindowView`, `DeepTipHost` on the overlay layer (sections 4–7); headless tests (section 10.2).
4. The example (section 11); compare with the web example by hand.
5. Then list the framework with its state in the main README.
