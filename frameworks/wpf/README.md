# DeepTip for WPF: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a WPF application with C#, .NET 8 or newer.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for WPF. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Statements marked *(checked)* were verified on 2026-10-29 with **WPF on .NET 10** (SDK 10.0.403, Windows Desktop runtime 10.0.14, Windows 11) in a headless probe: a hidden `HwndSource` (never shown) hosted the tree, keys went through `InputManager.ProcessInput`, automation peers were queried in process and the result was rendered with `RenderTargetBitmap`; details marked *(checked in the source)* were read in the decompiled WPF 8.0.33 assemblies. The C# port of §1, §2 and §8 described in the [Avalonia guide](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked) passed all 24 shared cases on .NET 8 and .NET 10 as C# 9.

## Quick start

**Recognise the project:** a `.csproj` with `<UseWPF>true</UseWPF>` and a Windows target framework (`net8.0-windows` or newer), `App.xaml` with an `<Application>` root, `.xaml` files whose root uses `xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"`; .NET Framework projects reference `PresentationFramework`.

1. Port `flatten`, `parseText` and `computePlacement` and pass `test/cases` (section 12.1).
2. Build `Glossary`, `TermLink`, `TipWindowView`, `OverlayAdorner` and `DeepTipHost` as sections 3–7 describe.
3. Copy `glossary/core/<locale>.json` and your `deeptip/<locale>.json` into the output folder (section 8).
4. Attach one `DeepTipHost` to each window in its `Loaded` event.
5. Mark elements with `dt:DeepTip.Key="<key>"`.
6. Validate the glossaries: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```csharp
// MainWindow.xaml (xmlns:dt="clr-namespace:MyApp.DeepTip"):  <Button dt:DeepTip.Key="shop.cart" Content="Cart"/>
public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        Loaded += (_, _) => DeepTipHost.Attach(this, new DeepTipOptions
        {
            Locale = "en",
            Sources = { "deeptip/core/{locale}.json", "deeptip/{locale}.json" },
        });
    }
}
```

**Done when:** resting on the button for 800 ms opens its window below it inside the main window, hovering a term in it opens a second window beside the first and a click pins both, `Esc` closes the newest window while the app's own `Esc` handling (a `KeyBinding`, an `IsCancel` button) does not run, `F1` on the focused button opens its window pinned with the focus on its first term, Inspect or Accessibility Insights lists the terms as hyperlinks.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary`, `Markup.Parse`, `Placement.Compute` | plain C# 9, no WPF types | files per locale, layers, chain, `$ui` labels, live values; glossary text → AST; `computePlacement` | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement) |
| `DeepTip` (attached properties) | static class | `Key`, `Delay`, `Place` on any element; `IsOpen`, `Arming` set by the host | SPEC §3.3, §4, §8 |
| `TermLink` | `Hyperlink` subclass | one term, inline in the text flow | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `TipWindowView` | `Border` subclass with an own automation peer | one window | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `OverlayAdorner` | `Adorner` | the top layer: a `Canvas` over the window's content | SPEC §1 |
| `DeepTipHost` | one per `Window` | window tree, hover state, timers, input | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input) |
| `DeepTipText`, `DeepTipIndex` | controls | terms on normal pages, the encyclopedia | [§3](../../docs/algorithms.md#3-rendering-the-ast), [§12](../../docs/algorithms.md#12-encyclopedia) |

The pure parts are the same C# for every .NET UI: port them as the [Avalonia guide, section 9](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked) describes and test them as in its [section 10.1](../avalonia/README.md#101-parity-cases-11). One WPF clash: `System.Windows.Documents` has `Block`, `Paragraph`, `List`, `Run`, `Bold`, `Italic` and `Hyperlink`, so name the AST types differently (`MarkupBlock`, `BoldNode`) or alias them *(checked: an AST class `Block` is ambiguous in a file that uses `System.Windows.Documents`)*.

## 2. SPEC concept → WPF primitive

| SPEC | WPF |
|---|---|
| Top layer for windows | the window's adorner layer: `AdornerLayer.GetAdornerLayer(content)` returns the layer of the `AdornerDecorator` that the default `Window` template puts around the content *(checked)*. One `OverlayAdorner` adorns the content and hosts a `Canvas` above it. Same HWND as the window: one coordinate space, one input stream, the window's resources and inherited font properties apply *(checked)*. |
| Window | `TipWindowView` in the overlay `Canvas`, placed with `Canvas.SetLeft/SetTop`; later children are drawn on top |
| Rich text | `TextBlock.Inlines` with `Run`, `Bold`, `Italic`, `LineBreak` (namespace `System.Windows.Documents`) |
| Term (a real button, SPEC §6) | `TermLink : Hyperlink`: an inline element that wraps with the text, is focusable and a Tab stop, raises `Click` on the mouse and on `Enter`, and appears to UI Automation as a hyperlink *(checked)* |
| Term under the pointer | `VisualTreeHelper.HitTest` finds the `TextBlock`; its `IContentHost.InputHitTest(point)` returns the `Run` inside the `TermLink` *(checked)* |
| Element with an explanation (`data-deeptip`) | attached properties `DeepTip.Key`, `DeepTip.Delay` (ms), `DeepTip.Place` (`"top,bottom"`) |
| `data-dt-open`, `data-dt-arming` | attached properties `DeepTip.IsOpen` (bool) and `DeepTip.Arming` (delay in ms, or null) that the host sets on anchors and terms, for style triggers; while a window is open also `ToolTipService.SetIsEnabled(anchor, false)` so the app's simple tooltip stays hidden |
| `data-dt-pinned` on windows | a `Pinned` dependency property on `TipWindowView` (stylable) |
| `pointerover` + `closest()` | one `PreviewMouseMove` handler on the window (`AddHandler(..., handledEventsToo: true)`), then a hit test and a walk up (section 7.1) |
| Pointer type | `MouseEventArgs.StylusDevice` is not null for mouse events promoted from pen or touch; `StylusDevice.TabletDevice.Type` is `TabletDeviceType.Touch` or `Stylus`; touch also raises `TouchDown`, `TouchMove`, `TouchUp` |
| Clicks | `Hyperlink.Click` for terms, `Button` and `ToggleButton` for close and pin, `MouseLeftButtonUp` on the window view for clicks on text or background |
| Keyboard | `PreviewKeyDown`, `PreviewKeyUp` and `PreviewTextInput` on the window: tunnel events, the window is the first element of the route; `e.Handled = true` consumes *(checked)* |
| `schedule(ms, f)` / `cancel` | a `DispatcherTimer` that stops itself in `Tick` *(checked)*; cancel = `Stop()` |
| `now()` | `Stopwatch.GetTimestamp()` converted to ms (monotonic) |
| CSS transitions and the lock bar animation | `DoubleAnimation`; its `Completed` event can end the timer lock, as `animationend` does on the web *(checked)* |
| Long-press | an own timer on `TouchDown` / `StylusDown`; `Stylus.IsPressAndHoldEnabled="False"` on marked elements stops Windows' press-and-hold right-click |
| Theme (light/dark) | one `ResourceDictionary` per theme, swapped in `Application.Resources.MergedDictionaries`; views bind with `SetResourceReference` / `DynamicResource`. `Application.ThemeMode` (Fluent, .NET 9+) carries `[Experimental("WPF0001")]` in .NET 10 *(checked)* |
| `forced-colors` | `SystemParameters.HighContrast`, then the `SystemColors` brush keys |
| `prefers-reduced-motion` | `SystemParameters.ClientAreaAnimation` is false when Windows animations are off |
| ARIA | automation peers: an own peer for `TipWindowView`, `AutomationProperties.Name` and `HelpText` |
| Vibration, gamepad | no WPF API (section 14) |

Why not `Popup`: WPF's `ToolTip` and `ContextMenu` are `Popup`s, and each `Popup` is a separate top-level HWND with its own `PresentationSource`: it stays topmost above other applications, its offsets mix device-independent units and screen pixels, WPF moves it back onto the screen by itself, and mouse and keyboard input arrive through another source than the window's. DeepTip's window tree, hot set and `computePlacement` would work around all of that. The adorner layer is the native top layer inside a window and leaves placement and input to DeepTip. Use a `Popup` only where windows must leave the main window or cover HWND-hosted content (section 11).

## 3. Data structures

```csharp
public sealed class TipWindow                          // §4
{
    public int Id;
    public string Key = "";
    public TipWindow? Parent;
    public readonly List<TipWindow> Children = new();
    public DependencyObject Anchor = null!;             // the marked FrameworkElement, or the TermLink it came from
    public string Via = "api";                          // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public DispatcherTimer? CloseTimer;                 // §5 leave()
    public Rect Box;                                    // last placed box, overlay coordinates
    public TipWindowView View = null!;
}
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first (= order of the canvas children) | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hover`, `lastTarget` | `(TipWindow? Win, TermLink? Link, FrameworkElement? Trig)` | §5, §6 |
| `samples` | `List<(Point P, long T)>` | §5 |
| `pending` | `(DependencyObject El, DispatcherTimer Timer)?` | §6 |
| `quiet` | `FrameworkElement?` | §6 `hush` |
| `lockWindow` | `TipWindow?` (the bar's animation is the timer) | §7 |
| `escAt` | `long` | §9.3 |
| `press`, `swallow`, `swipe` | small records with touch device id, position, element, timer | §9.2 |
| `seq`, `warned` | `int`, `HashSet<string>` | §4, §1 |

The glossary keeps `data[locale]` as `Dictionary<string, Entry>` (`Entry`: `Title`, `Short`, `Body`, `Aliases`, `See`), `labels[locale]` as `Dictionary<string, string>`, the chain as `List<string>` and the live values as `Func<string, string?, object?>` (name, window key). One `DeepTipHost` per `Window`; the glossary can be shared.

## 4. Windows and terms

### 4.1 The top layer

```csharp
public sealed class OverlayAdorner : Adorner
{
    public readonly Canvas Layer = new Canvas();        // no Background: its empty parts let the pointer through

    public OverlayAdorner(UIElement content) : base(content) { AddVisualChild(Layer); }
    protected override int VisualChildrenCount => 1;
    protected override Visual GetVisualChild(int index) => Layer;
    protected override Size MeasureOverride(Size constraint) { Layer.Measure(AdornedElement.RenderSize); return AdornedElement.RenderSize; }
    protected override Size ArrangeOverride(Size finalSize) { Layer.Arrange(new Rect(finalSize)); return finalSize; }
}

// DeepTipHost.Attach(window, options), called from window.Loaded
var content = (UIElement)window.Content;
AdornerLayer layer = AdornerLayer.GetAdornerLayer(content)
    ?? throw new InvalidOperationException("Put an AdornerDecorator around the window content.");
var overlay = new OverlayAdorner(content);
layer.Add(overlay);
```

*(checked)*: the canvas covered the whole 900×600 content; a hit test on a button under an empty part of the canvas found the button; `TextElement.FontSize`, `TextElement.FontFamily` and a `DynamicResource` set on the root reached the window views. Before the window is loaded the layer does not exist yet (null for a window that was never shown), hence `Loaded`. A window with an own template needs an `AdornerDecorator` around its `ContentPresenter`. An adorner added after the overlay (a validation error template, a drag adorner) is drawn above it: when the layer holds other adorners, `Remove` and `Add` the overlay again before opening a window, which makes it the last child *(checked)*.

### 4.2 The window view

`TipWindowView : Border`, an own class so hit tests recognise it and it can carry its automation peer (section 10):

- `Focusable = true` with `KeyboardNavigation.IsTabStop = false`: a focus target when the window has no terms, but not a Tab stop of its own, like the reference's `tabIndex = -1` *(checked: without it the frame is a Tab stop)*. `UseLayoutRounding = true` for crisp text.
- `Background`, `BorderBrush` through `SetResourceReference` (section 5); `BorderThickness = 1`, `CornerRadius = 8`, `MinWidth`, `MaxWidth`, `MaxHeight` from section 6; shadow `new DropShadowEffect { BlurRadius = 30, ShadowDepth = 10, Direction = 270, Opacity = 0.3 }` *(checked: rendered)*.
- Child: a `Grid` with rows `Auto, *, Auto, Auto`:
  - row 0, the header: a `Grid` with columns `*, Auto, Auto, Auto` and margin 12,6,6,2: title (`FontWeight = FontWeights.SemiBold`), the fallback badge (§3), the pin `ToggleButton`, the close `Button` (26×26, icon 15×15, opacity 0.6 and 1.0 on hover; 40×40 when the last input was touch). Columns keep the reference's Tab order pin → close; a `DockPanel` with two right-docked buttons reverses it *(checked)*.
  - row 1, a `ScrollViewer` (`VerticalScrollBarVisibility.Auto`, `HorizontalScrollBarVisibility.Disabled`) with a `StackPanel` of the body blocks, margin 12,0,12,10;
  - row 2, "See also": a `TextBlock` with the label (opacity 0.7) and one `TermLink` per key, comma separated, margin 12,0,12,10, font size × 0.9;
  - row 3, the hint line: top border 1 px, padding 12,4,12,6, font size × 0.75, opacity 0.6; collapsed when pinned, when `hints` is off and after touch input.
- The lock bar: a `Border` of height 2 in the accent colour over all rows (`Grid.RowSpan = 4`, `VerticalAlignment.Bottom`), `IsHitTestVisible = false`, `RenderTransformOrigin = new Point(0, 0.5)`, `RenderTransform = new ScaleTransform(0, 1)` (section 7.6).
- Icons: the 24×24 stroke paths `PIN_PATH` and `CLOSE_PATH` of `deeptip.js` as `new Path { Data = Geometry.Parse(...), StrokeThickness = 2, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round, Stretch = Stretch.Uniform }`; pinned: the pin filled with the accent colour.

### 4.3 Rendering the AST

One `TextBlock` per `p` block (`TextWrapping.Wrap`, `LineHeight` = 1.5 × font size with `LineStackingStrategy.BlockLineHeight`); a `ul` becomes a `Grid` with a "•" column and a `TextBlock` per item, indented 1.2 em; blocks in a `StackPanel`, 0.5 em apart. Inlines per [§3](../../docs/algorithms.md#3-rendering-the-ast):

```csharp
void AddInlines(InlineCollection into, IEnumerable<Node> nodes, string? selfKey)
{
    foreach (Node n in nodes)
    {
        switch (n)
        {
            case TextNode t: into.Add(new Run(t.Value)); break;
            case BreakNode: into.Add(new LineBreak()); break;
            case CodeNode c: into.Add(new Run(c.Value) { FontFamily = mono, FontSize = 0.92 * fontSize }); break;
            case VarNode v:
                var value = new Run(glossary.Value(v.Name, selfKey)) { FontWeight = FontWeights.SemiBold };
                Typography.SetNumeralAlignment(value, FontNumeralAlignment.Tabular);
                into.Add(value);
                break;
            case BoldNode b: { var s = new Bold(); AddInlines(s.Inlines, b.Children, selfKey); into.Add(s); break; }
            case ItalicNode i: { var s = new Italic(); AddInlines(s.Inlines, i.Children, selfKey); into.Add(s); break; }
            case LinkNode l: into.Add(LinkInline(l, selfKey)); break;
        }
    }
}

Inline LinkInline(LinkNode l, string? selfKey)
{
    var found = glossary.Entry(l.Key);                       // §1.2: (entry, locale) or null
    string label = l.Text ?? found?.Entry.Title ?? l.Key;
    if (l.Key == selfKey) return new Bold(new Run(label));
    if (found == null) { WarnOnce(l.Key); return new Run(label) { TextDecorations = MissingUnderline }; }
    var term = new TermLink(l.Key, label);
    term.Follow += OnFollow;                                 // section 7.4
    return term;
}
```

A `TermLink` inside `Bold` or `Italic` keeps that formatting, because a `Hyperlink` is a `Span` in the same text flow. The reference's dotted, offset underline *(checked: rendered)*:

```csharp
static TextDecorationCollection Dotted(Brush brush) => new TextDecorationCollection
{
    new TextDecoration(TextDecorationLocation.Underline, new Pen(brush, 1) { DashStyle = DashStyles.Dot }, 2,
        TextDecorationUnit.FontRecommended, TextDecorationUnit.Pixel),
};
```

WPF has no wavy text decoration; draw the missing-term underline dashed in `--dt-missing` red.

### 4.4 `TermLink`

```csharp
public sealed class TermLink : Hyperlink
{
    public string TermKey { get; }                          // not "Key": inside the class it would hide System.Windows.Input.Key
    public event Action<TermLink, bool>? Follow;            // bool: activated by the keyboard
    private bool viaKeyboard;

    public TermLink(string key, string label) : base(new Run(label))
    {
        TermKey = key;
        AutomationProperties.SetName(this, label);
        SetResourceReference(ForegroundProperty, "DeepTip.Link");
    }

    protected override void OnKeyDown(KeyEventArgs e)        // Hyperlink clicks on Enter only; Space is added here
    {
        viaKeyboard = true;
        if (!e.Handled && e.Key == System.Windows.Input.Key.Space) { OnClick(); e.Handled = true; }
        base.OnKeyDown(e);
        viaKeyboard = false;
    }

    protected override void OnClick() { Follow?.Invoke(this, viaKeyboard); base.OnClick(); }
}
```

*(checked)*: a `Hyperlink` is focusable by default and takes `Keyboard.Focus`; `Enter` raised `Click`, `Space` only with the override above, flagged as keyboard; the `TextBlock`'s automation peer listed the three terms of a window as `Hyperlink` children named by their labels. *(checked in the source)*: on a left button press a `Hyperlink` focuses itself and captures the mouse, it raises `Click` on release while the pointer is still over it, and it marks both mouse events handled. A click on a term therefore moves the keyboard focus into the window, as a click on a `<button>` does in most browsers. States: `IsMouseOver` → link-hover colour, solid underline; `DeepTip.IsOpen` → background in the link colour at 16 %; `IsKeyboardFocused` → a 2 px focus outline (a style trigger on these properties).

### 4.5 Boxes of page terms

A window opened from a term inside a window is placed next to that window ([§8](../../docs/algorithms.md#8-placement)); only terms on normal pages (`DeepTipText`) need their own box: the union of `TextPointer.GetCharacterRect` from `ContentStart` to `ContentEnd`, stepping with `GetNextInsertionPosition(LogicalDirection.Forward)`, transformed with `textBlock.TransformToVisual(overlay.Layer).TransformBounds(rect)` *(checked: one-line and two-line terms)*. Read it after layout; the `TextBlock` re-flows on every width change.

## 5. Look: the values of `deeptip.css`

Two dictionaries with the same keys, one swapped into `Application.Current.Resources.MergedDictionaries` per theme; every `SetResourceReference` follows the swap:

```csharp
var dark = new ResourceDictionary { ["DeepTip.Background"] = Brush("#1B1E24"), ["DeepTip.Link"] = Brush("#6CB6FF") /* … */ };
static SolidColorBrush Brush(string hex) { var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex)); b.Freeze(); return b; }
view.SetResourceReference(Border.BackgroundProperty, "DeepTip.Background");
```

| Resource (web token) | Light | Dark |
|---|---|---|
| Background (`--dt-bg`) | `#FFFFFF` | `#1B1E24` |
| Foreground (`--dt-fg`) | `#1F2328` | `#E6E8EC` |
| Border, hint line (`--dt-border`) | `#C8CDD5` | `#3B414D` |
| Accent: pinned frame, lock bar, focus (`--dt-accent`, `--dt-pinned`) | `#0B69D4` | `#58A6FF` |
| Term (`--dt-link`) | `#0B69D4` | `#6CB6FF` |
| Term on hover (`--dt-link-hover`) | `#084F9F` | `#9CCFFF` |
| Open term background (`--dt-link-open-bg`) | term colour at 16 % (`#290B69D4`) | `#296CB6FF` |
| Button hover (`--dt-hover-bg`) | `#12000000` | `#17FFFFFF` |
| Missing term underline (`--dt-missing`) | `#DD3333` | `#DD3333` |
| Shadow (`--dt-shadow`) | `0 10 30` black at 30 % | same |

Sizes: radius 8, border 1, font size 14, line height 1.5, min width 240, max width 384, max height 480, gap 8; code in a monospace font (`Cascadia Code, Consolas`) at 0.92 em; live values semi-bold with tabular digits; badge 0.7 em with a 1 px border, radius 3, opacity 0.65. Motion: windows fade in over 150 ms (opacity and 4 px upwards), the lock bar grows linearly over `lockAfter`, a flash is a 3 px accent ring for 0.6 s.

Which theme: WPF follows no system theme by itself. Read `AppsUseLightTheme` (0 = dark) under `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize` and listen to `SystemEvents.UserPreferenceChanged`, or follow the app's own theme switch; `Application.ThemeMode` is still experimental.

## 6. Placement and coordinates

All boxes are in overlay coordinates: device-independent units (1/96 inch), origin top-left, y down, which is the space of [§8](../../docs/algorithms.md#8-placement); WPF converts to pixels itself, so no DPI factor appears in DeepTip's code. Per-monitor DPI needs the `PerMonitorV2` awareness in the app manifest; `VisualTreeHelper.GetDpi(visual)` tells the current scale.

```csharp
void Place(TipWindow w)
{
    if (w.Frozen) return;                                                  // §4.5
    Rect a = w.Parent != null ? w.Parent.Box : AnchorBox(w.Anchor);         // children sit next to their parent window
    Size vp = overlay.Layer.RenderSize;
    TipWindowView view = w.View;
    view.MinWidth = Math.Min(240, vp.Width - 16);
    view.MaxWidth = Math.Min(384, vp.Width - 16);
    view.MaxHeight = Math.Min(480, vp.Height - 16);
    view.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));   // natural size within the limits
    var p = Placement.Compute(view.DesiredSize.Width, view.DesiredSize.Height, ToBox(a), Sides(w), vp.Width, vp.Height, 8);
    if (p.MaxW > 0 || p.MaxH > 0)                                           // nothing fits: shrink, the ScrollViewer scrolls
    {
        if (p.MaxW > 0) view.MaxWidth = p.MaxW;
        if (p.MaxH > 0) view.MaxHeight = p.MaxH;
        view.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        p = Placement.Compute(view.DesiredSize.Width, view.DesiredSize.Height, ToBox(a), new[] { p.Side }, vp.Width, vp.Height, 8);
    }
    Canvas.SetLeft(view, p.X);                                              // no Margin on the view: Canvas places its margin box
    Canvas.SetTop(view, p.Y);
    w.Box = new Rect(p.X, p.Y, view.DesiredSize.Width, view.DesiredSize.Height);
}

Rect AnchorBox(DependencyObject anchor) => anchor is TermLink t
    ? TermBox(t)                                                            // section 4.5, page terms only
    : new Rect(((UIElement)anchor).TranslatePoint(new Point(), overlay.Layer), ((UIElement)anchor).RenderSize);
```

`Sides(w)`: `DeepTip.Place` of the anchor (roots only), else the `child` order for children and the `root` order for roots. *(checked)*: a 59×30 anchor at (8, 285) in a 900×600 window put the 377×112 root window below it at (8, 323), wrapping its text at the 384 maximum.

Re-place every window that is not frozen, parents before children, when the target box, the natural size or the viewport changed against the remembered values: in `overlay.Layer.LayoutUpdated` (that covers window resizing, scrolling, pinning which hides the hint line, and live values). `LayoutUpdated` fires after every layout pass of the dispatcher: compare before writing, or the handler feeds itself.

## 7. Events: exact order of operations

### 7.1 Mouse moved

```csharp
window.AddHandler(UIElement.PreviewMouseMoveEvent, new MouseEventHandler(OnMouseMove), handledEventsToo: true);

void OnMouseMove(object sender, MouseEventArgs e)
{
    Point p = e.GetPosition(overlay.Layer);
    if (press != null && (p - press.Start).Length > 10) PressEnd();                       // §9.2
    if (e.StylusDevice?.TabletDevice?.Type == TabletDeviceType.Touch) return;             // touch promoted to mouse: no hover
    AddSample(p, Now());                                                                  // §5 samples, before anything else
    DependencyObject? d = VisualTreeHelper.HitTest(window, e.GetPosition(window))?.VisualHit;
    if (d is TextBlock text && ((IContentHost)text).InputHitTest(e.GetPosition(text)) is DependencyObject inner) d = inner;
    TermLink? link = null; TipWindowView? win = null; FrameworkElement? trig = null;
    for (; d != null; d = Up(d))
    {
        if (link == null && d is TermLink t) link = t;
        if (win == null && d is TipWindowView v) win = v;
        if (trig == null && d is FrameworkElement f && DeepTip.GetKey(f) != null) trig = f;
    }
    if (win != null || link != null) trig = null;
    if ((win, link, trig) == lastTarget) return;                                          // the web reacts to pointerover only
    lastTarget = (win, link, trig);
    OnPointerOver(win?.Window, link, trig);   // §6 "on pointer over": hover, quiet, refreshHot, lockTrack, arm or disarm
}

static DependencyObject? Up(DependencyObject d) => d is FrameworkContentElement fce ? fce.Parent
    : d is ContentElement ce ? ContentOperations.GetParent(ce) : VisualTreeHelper.GetParent(d);
```

*(checked)*: the walk from the `Run` reached the `TermLink` and then the `TipWindowView`. Use `VisualTreeHelper.HitTest`, not `UIElement.InputHitTest` and not `e.OriginalSource`: `InputHitTest` returns the nearest *enabled* element, so a disabled control (which should explain why it is disabled) is skipped *(checked: `InputHitTest` returned the parent `Grid`, `HitTest` the disabled button)*, and while a `Hyperlink` or a button holds the mouse capture, `OriginalSource` is the captured element, not the one under the pointer. A window that is fading out after `close` gets `IsHitTestVisible = false` at once.

### 7.2 Pointer left the window

`window.MouseLeave` (mouse and pen): `hover = {}`, `disarm()`, `lockTrack(none)`, `refreshHot()` ([§6](../../docs/algorithms.md#6-arming-and-delays)).

### 7.3 Pointer pressed and released, touch

Handlers on the window with `handledEventsToo: true`, in the order of [§9.2](../../docs/algorithms.md#92-pointer-down-touch):

1. `PreviewMouseDown` from the mouse (not promoted from touch): `win` = window view under the pointer (hit test as in 7.1); not in a window → `hush(marked element)`; not in a window and `outsideClickCloses == "always"` → close all.
2. `PreviewTouchDown`: not in a window → `outsideClickCloses` (`"always"` or `"touch"`) closes all; on a marked element that is not a term → `pressStart`: a one-shot timer of `longPress` remembering `e.TouchDevice.Id` and the position; on a window header outside its buttons → remember the swipe start.
3. `PreviewTouchMove` of that device: moved more than 10 px → `pressEnd`.
4. `PreviewTouchUp` of that device: end the press; a swipe with dy > 60 and |dx| < 60 closes all.
5. While a swallow is active (1.5 s after a long-press opened the element's window) set `e.Handled = true` on `PreviewMouseLeftButtonUp` over that element, so the button under the finger does not click; and on `ContextMenuOpening` (it bubbles from the element) while a press runs or the swallow is active, so its `ContextMenu` stays closed. `Stylus.IsPressAndHoldEnabled="False"` on marked elements keeps Windows from turning the hold into a right-click at all.

### 7.4 Clicks inside windows ([§9.1](../../docs/algorithms.md#91-clicks))

- `TermLink.Follow(term, viaKeyboard)` → `follow(term, the window whose view contains the term or none for page terms, focus: viaKeyboard)`.
- Close `Button.Click` → `close(win, focusBack: true)`; pin `ToggleButton.Click` → `pin` or `unpin`, then set `IsChecked` from the window's state.
- `TipWindowView.MouseLeftButtonUp` (a plain bubble handler): buttons and hyperlinks mark it handled, so it fires only for clicks on text or background → `clickInsidePins` pins an unpinned window.

### 7.5 Keyboard ([§9.3](../../docs/algorithms.md#93-keyboard))

```csharp
window.AddHandler(UIElement.PreviewKeyDownEvent, new KeyEventHandler(OnKeyDown), handledEventsToo: true);
window.AddHandler(UIElement.PreviewTextInputEvent, new TextCompositionEventHandler(OnTextInput), handledEventsToo: true);

void OnKeyDown(object sender, KeyEventArgs e)
{
    bool shift = (Keyboard.Modifiers & ModifierKeys.Shift) != 0;
    if (e.Key == Key.Escape)
    {
        if (windows.Count == 0) return;                                   // the application gets this Esc
        if (shift || (e.IsRepeat && Now() - escAt >= 600)) CloseAllAndFocusRootAnchor();
        else if (!e.IsRepeat) { escAt = Now(); Close(Newest(Keyboard.FocusedElement), focusBack: true); }
        e.Handled = true;                                                 // no KeyDown handler, KeyBinding or IsCancel button sees it
        return;
    }
    if (e.Key == Key.F6 && windows.Count > 0) { Cycle(shift ? -1 : 1); e.Handled = true; return; }
    if (e.Key == Key.F1 && OpenFocused()) e.Handled = true;              // a focused TermLink → follow; a marked element → open pinned
}

void OnTextInput(object sender, TextCompositionEventArgs e)
{
    var focused = Keyboard.FocusedElement as DependencyObject;
    if (e.Text == "?") { if (!(focused is TextBoxBase || focused is PasswordBox) && OpenFocused()) e.Handled = true; return; }
    if (e.Text.Length > 0 && !char.IsControl(e.Text[0])) Hush(MarkedAncestorOf(focused));   // typing into a marked field
}
```

*(checked)*: with `e.Handled = true` in the window's `PreviewKeyDown`, Esc reached neither the focused `TextBox`'s `KeyDown`, nor the window's `KeyDown`, nor a `KeyBinding` for Esc; without it, the `TextBox` and the `KeyBinding` saw it. *(checked in the source)*: the access key manager behind `Button.IsCancel` and `IsDefault` acts only on `KeyDown` events that are not handled. `KeyEventArgs.IsRepeat` tells auto-repeats apart, so no own held flag is needed. F1 is also the default gesture of `ApplicationCommands.Help`: consume it only when DeepTip used it, so the app's help still opens elsewhere. Read "?" from `PreviewTextInput`: its key differs between keyboard layouts.

### 7.6 Timers

Event-driven like the reference; no frame loop is needed. All callbacks run on the UI thread.

```csharp
static DispatcherTimer After(double ms, Action f)
{
    var t = new DispatcherTimer(DispatcherPriority.Normal) { Interval = TimeSpan.FromMilliseconds(Math.Max(0, ms)) };
    t.Tick += (_, _) => { t.Stop(); f(); };
    t.Start();
    return t;                                                             // cancel: t.Stop()
}
```

- `closeTimer`, `pending.timer`, the `RETRY` re-checks (90 ms), the long-press and the swallow end are `After` handles *(checked: one tick)*. Windows timers have a resolution of about 15 ms.
- Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): start = `scale.BeginAnimation(ScaleTransform.ScaleXProperty, anim)` with `new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(lockAfter))` whose `Completed` pins the window if it is still the lock window and `anim` is still its animation; stop = `scale.BeginAnimation(ScaleTransform.ScaleXProperty, null)`, which drops the animation and shows the base value 0 again *(checked: `Completed` fired in the headless dispatcher; the bar returned to 0)*.
- Flash ([§4.4](../../docs/algorithms.md#44-flashw)): a ring `Border` (thickness 3, accent, margin −3, `IsHitTestVisible = false`) inside the view, its opacity animated 0 → 1 at 30 % → 0 over 600 ms; a static ring with reduced motion.
- Fade-out on close: remove the window from `windows` at once ([§4.2](../../docs/algorithms.md#42-closew-focusback--false)), set `IsHitTestVisible = false`, remove the view from the canvas when its 150 ms opacity animation completes.

### 7.7 Focus ([§9.5](../../docs/algorithms.md#95-focus))

`focusWindow`: `Keyboard.Focus(firstTerm)` for the first `TermLink` in the body or "See also" (works on content elements *(checked)*), else `Keyboard.Focus(view)`. Before closing: `hadFocus` = walking up from `Keyboard.FocusedElement` with `Up` reaches the view of the window or of a descendant; afterwards `Keyboard.Focus(anchor)` if the anchor is still in the window. F6 cycles windows newest first. Windows and their terms also follow the content in the window's Tab order, because the adorner layer comes after the content in the visual tree *(checked)*.

### 7.8 Anchors that move or disappear

- Disappeared anchor ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)): in the `LayoutUpdated` pass, a marked element whose `PresentationSource.FromDependencyObject(anchor)` is null or that is no longer below the window (`!window.IsAncestorOf(anchor)`) is gone: previews close, a pinned root freezes at `w.Box`. Terms are gone when re-rendering replaced them (section 9).
- Moved anchors are covered by the re-placement in section 6.

## 8. Loading the glossaries

Order per [§1.2](../../docs/algorithms.md#12-layers-locales-lookup): for each locale of the chain, each source template in order (core first, project after); a missing file is a warning.

```xml
<ItemGroup>
  <Content Include="deeptip\**\*.json" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

Read with `await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, path))` (it strips a UTF-8 byte order mark), then add the files on the UI thread in exactly that order. Files built as `Resource` come from `Application.GetResourceStream(new Uri("pack://application:,,,/deeptip/en.json"))`.

Parse with `System.Text.Json.JsonDocument` and walk `EnumerateObject()`: it keeps the file order and accepts a repeated property name; store objects in an ordered map that keeps a repeated key at its first position with the last value, as `JSON.parse` does *(checked with the parity runner)*. `JsonNode.Parse` / `JsonObject` reject repeated names ([Avalonia guide, section 9](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked)). Entries are objects whose `title`, `short` or `body` is a JSON string ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)).

## 9. Live values, locales, refresh

- `vars`: a dictionary of values, `Func<object?>` or `Func<string, object?>` (called with the window's key), or one `Func<string, string?, object?>` `(name, key) → value`; null keeps `{name}` visible. Values are read when a window renders.
- `Refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): rebuild every window's content, then for each child set its `Anchor` to the new `TermLink` with the same key in the parent and mark it `DeepTip.IsOpen`; re-place; re-render every `DeepTipText` and `DeepTipIndex`. Call it from the setters of the values your texts show (e.g. after `INotifyPropertyChanged` fired for them).
- `SetLocale(locale)` loads the missing files of the new chain, then refreshes.
- `DeepTipIndex` ([§12](../../docs/algorithms.md#12-encyclopedia)): a search `TextBox` and one row per entry (title as `TermLink`, the `short` line, "Mentioned in" with terms); sort with `string.Compare(a, b, culture, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace)`, which matches `Intl.Collator` with sensitivity "base"; keep the query across refreshes.

## 10. Accessibility

- Terms: `TermLink` peers are `Hyperlink` children of the `TextBlock`'s peer, named by their label *(checked)*.
- Window: an own peer reports `AutomationControlType.ToolTip` for previews and `AutomationControlType.Window` for pinned windows *(checked)*; `AutomationProperties.Name` = title, `HelpText` = the body as plain text.

  ```csharp
  protected override AutomationPeer OnCreateAutomationPeer() => new TipPeer(this);
  sealed class TipPeer : FrameworkElementAutomationPeer
  {
      public TipPeer(TipWindowView v) : base(v) { }
      protected override AutomationControlType GetAutomationControlTypeCore() =>
          ((TipWindowView)Owner).Pinned ? AutomationControlType.Window : AutomationControlType.ToolTip;
      protected override string GetClassNameCore() => "DeepTipWindow";
  }
  ```

- Raise `AutomationEvents.ToolTipOpened` / `ToolTipClosed` on the peer of a preview when `AutomationPeer.ListenerExists(...)` is true, as WPF's own `ToolTip` does, so screen readers announce it.
- Root anchor while its window is open: `AutomationProperties.HelpText` = the window's plain text (the `aria-describedby` of the web), the previous value restored on close *(checked: read back through the anchor's peer)*.
- Focus as in 7.7; buttons 40×40 after touch input.
- High contrast: `SystemParameters.HighContrast` → `SystemColors.WindowBrushKey`, `WindowTextBrushKey`, `HotTrackBrushKey` (terms), `HighlightBrushKey` (pinned border, 2 px). Reduced motion: `SystemParameters.ClientAreaAnimation == false` → no fade and no flash animation; the lock bar still runs, it is a timer.

## 11. Pitfalls

- **Airspace**: content hosted in its own HWND (`WebView2`, `WindowsFormsHost`, any `HwndHost`) is always drawn above WPF content, adorners included. A DeepTip window over such content is hidden; give those windows a `Popup` (section 2), or keep hosted content out of their way.
- **The adorner layer** exists only after the window is loaded, needs an `AdornerDecorator`, and later adorners cover the overlay (section 4.1).
- **Hit testing**: `InputHitTest` skips disabled elements and `OriginalSource` follows mouse capture (section 7.1).
- **Names**: a `Key` property inside a `Hyperlink` subclass hides the `System.Windows.Input.Key` enum there *(checked: `Key.Space` did not compile)*; `Block` and friends clash with `System.Windows.Documents` (section 1).
- **Tab order**: right-docked buttons in a `DockPanel` are traversed right to left (section 4.2).
- **F1 and "?"**: F1 is `ApplicationCommands.Help`; "?" comes as text (section 7.5).
- **Esc auto-repeat**: in the reference, the repeats of a held Esc reach the application once the last window has closed; if your application acts on repeated `KeyDown`s, keep consuming Esc until its `KeyUp` when DeepTip used the press.
- **The app's own tooltip** opens over the window: disable it on the anchor while its window is open (section 2).
- **`LayoutUpdated` loops**: compare before writing (section 6).
- **Testing in a hidden source**: `IsCancel` and access keys need an active window and do not fire in a hidden `HwndSource` *(checked)*; assert that the Esc was handled instead.

## 12. Testing

### 12.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

The pure parts have no WPF types; test them in a plain `net8.0` test project exactly as the [Avalonia guide, section 10.1](../avalonia/README.md#101-parity-cases-11) shows (`JsonNode.DeepEquals` for the AST with `"text": null` present, exact `double` comparison for placement, keys in file order for the glossary). *(checked: 24 of 24 cases on .NET 8 and .NET 10, C# 9.)*

### 12.2 Behaviour, headless

A test needs no visible window *(checked; the probe of this guide does it)*:

```csharp
var src = new HwndSource(new HwndSourceParameters("DeepTipTest")
{
    Width = 900, Height = 600, PositionX = -32000, PositionY = -32000,
    WindowStyle = unchecked((int)0x80000000),                       // WS_POPUP without WS_VISIBLE: never shown
});
src.RootVisual = root;                                              // a Border with an AdornerDecorator around the content
root.UpdateLayout();
Keyboard.Focus(textBox);                                            // works in the hidden source
InputManager.Current.ProcessInput(new KeyEventArgs(Keyboard.PrimaryDevice, src, Environment.TickCount, Key.Escape)
    { RoutedEvent = Keyboard.PreviewKeyDownEvent, Source = textBox });
var bmp = new RenderTargetBitmap(900, 600, 96, 96, PixelFormats.Pbgra32);
bmp.Render(root);                                                   // save as PNG and look at it
```

Run tests on an STA thread. Let timers and animations run with a `DispatcherFrame` and `Dispatcher.PushFrame`. Mouse hover, grace, tendency and suppression need no real mouse: make the clock injectable and call the host's move handler with positions. Touch needs a device.

### 12.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions.

## 13. The example to build

The same screen as `frameworks/web/example`: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `DeepTip.Delay="0"`, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms (`DeepTipText`), settings (delay, lock, buttons, hints) and the encyclopedia (`DeepTipIndex`). Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

```xml
<Window xmlns:dt="clr-namespace:MyApp.DeepTip">
  <Grid>
    <StackPanel Orientation="Horizontal" VerticalAlignment="Top">
      <Button dt:DeepTip.Key="demo.realm" Content="Realm"/>
      <Button dt:DeepTip.Key="deeptip.about" dt:DeepTip.Delay="0" Content="?"/>
    </StackPanel>
    <Button dt:DeepTip.Key="demo.revolt" dt:DeepTip.Place="top,right" Content="Revolt"
            HorizontalAlignment="Left" VerticalAlignment="Bottom"/>
  </Grid>
</Window>
```

`DeepTip` is a static class: `DependencyProperty.RegisterAttached("Key", typeof(string), typeof(DeepTip), new PropertyMetadata(null))` with `GetKey`/`SetKey`, like `ToolTipService`.

## 14. Limitations compared with the web reference

- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): no WPF API. Poll XInput (`XInputGetState` from `xinput1_4.dll`) or `Windows.Gaming.Input.Gamepad` (target framework `net8.0-windows10.0.19041.0`) on a `DispatcherTimer` while the window is active.
- **Vibration** on long-press: no API.
- **Wavy underline** for missing terms: none; dashed instead.
- **Windows stay inside the main window** (the adorner layer is the viewport, like the browser viewport for the web); a `Popup` is needed to leave it.
- **Touch** cannot be tested headless.

## 15. Checklist

1. Port `flatten`, `parseText`, `computePlacement` and pass `test/cases` (section 12.1).
2. `Glossary` with layers, chain, `$ui` labels and live values; validate the same JSON files with `tools/deeptip-check.mjs`.
3. `OverlayAdorner`, `TipWindowView`, `TermLink`, `DeepTipHost` (sections 4–7); headless tests (section 12.2).
4. The example (section 13); compare with the web example by hand.
5. Then list the framework with its state in the main README.
