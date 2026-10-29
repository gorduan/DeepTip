# DeepTip for .NET MAUI: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a .NET MAUI application with C#, .NET 10, on Windows, Mac Catalyst, Android and iOS.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for .NET MAUI. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. What was verified, on 2026-10-29: every cross-platform snippet compiled against **Microsoft.Maui.Controls 10.0.120** (its platform-neutral `net10.0` assemblies, .NET SDK 10.0.403), the public API was read by reflection *(checked)*, platform code was read in the dotnet/maui source at tag `10.0.120` *(checked in the source)*, and the C# port of §1, §2 and §8 passed all 24 shared cases inside a project that references MAUI. No MAUI workload was installed and no app ran on a device: behaviour that needs one, and every platform hook that could not be compiled, is marked "verify".

## Quick start

**Recognise the project:** a `.csproj` with `<UseMaui>true</UseMaui>` and target frameworks such as `net10.0-android;net10.0-ios;net10.0-maccatalyst;net10.0-windows10.0.19041.0`, `MauiProgram.cs` with `MauiApp.CreateBuilder()`, a `Platforms/` folder (`Android`, `iOS`, `MacCatalyst`, `Windows`), `App.xaml` and `AppShell.xaml`, assets under `Resources/Raw`.

1. Port `flatten`, `parseText` and `computePlacement` and pass `test/cases` (section 12).
2. Build `TipWindowView`, the span renderer and `DeepTipHost` as sections 3–7 describe.
3. Put `glossary/core/<locale>.json` and your glossary under `Resources/Raw/deeptip/` (section 8).
4. Add the key hooks of section 7.5 for the platforms you ship.
5. Attach one `DeepTipHost` per page and mark views with `deepTip.SetKey(view, "<key>")`.
6. Validate the glossaries: `node <DeepTip>/tools/deeptip-check.mjs --base en Resources/Raw/deeptip/core/en.json Resources/Raw/deeptip/en.json`.

```csharp
public partial class MainPage : ContentPage
{
    readonly DeepTipHost deepTip;

    public MainPage()
    {
        InitializeComponent();
        deepTip = DeepTipHost.Attach(this, new DeepTipOptions
        {
            Locale = "en",
            Sources = { "deeptip/core/{locale}.json", "deeptip/{locale}.json" },
        });
        deepTip.SetKey(CartButton, "shop.cart");
    }

    protected override bool OnBackButtonPressed() => deepTip.CloseNewest() || base.OnBackButtonPressed();
}
```

**Done when:** on Windows or Mac Catalyst, resting the mouse on the button for 800 ms opens its window below it over the page, hovering a term opens a second window beside the first and a click pins both; on Android or iOS a long-press opens the window pinned without clicking the button and a tap on a term opens the next one; `Esc` (desktop) and the Back button (Android) close the newest window before the page reacts; the windows follow the light and dark theme.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary`, `Markup.Parse`, `Placement.Compute` | plain C#, no MAUI types | files per locale, layers, chain, `$ui` labels, live values; glossary text → AST; `computePlacement` | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement) |
| `TipWindowView` | `Border` subclass | one window | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `SpanRenderer` | static | AST → `FormattedString` with term spans | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `DeepTipHost` | one per `ContentPage` | overlay, window tree, hover state, timers, input | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input) |
| key hooks | one per platform, in `Platforms/` | Esc, F1, F6, "?" and Back before the page sees them | [§9.3](../../docs/algorithms.md#93-keyboard) |
| `DeepTipText`, `DeepTipIndex` | views | terms on normal pages; the encyclopedia | [§12](../../docs/algorithms.md#12-encyclopedia) |

The pure parts are the same C# for every .NET UI: port them as the [Avalonia guide, section 9](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked) describes. Name clashes with MAUI: every `VisualElement` has a `Window` property, so do not call the view's window record `Window` *(checked: CS0108)*; `Microsoft.Maui.Graphics` has `Rect`, `Point`, `Size`, so give the placement rectangle another name than `Rect`.

## 2. SPEC concept → .NET MAUI primitive

| SPEC | .NET MAUI 10 |
|---|---|
| Top layer for windows | the page's content wrapped in a root `Grid` whose last child is an `AbsoluteLayout` overlay with `InputTransparent = true` and `CascadeInputTransparent = false`: the overlay takes no input itself, its children (the windows) do, the page below gets the rest *(compiled; per-platform input behaviour: verify)*. Child order and `ZIndex` set the z-order. |
| Why not the built-in overlays | `Window.AddOverlay(IWindowOverlay)` / `WindowOverlay` draws `IWindowOverlayElement`s on a canvas and reports taps *(checked)*: no views, no text input, no focus. CommunityToolkit popups are modal. |
| Window | `TipWindowView : Border` in the overlay, placed with `AbsoluteLayout.SetLayoutBounds(view, rect)` |
| Rich text | `Label.FormattedText` = a `FormattedString` of `Span`s (`FontAttributes`, `TextColor`, `BackgroundColor`, `TextDecorations`, `FontFamily`) |
| Term | a `Span` with a `TapGestureRecognizer` in `span.GestureRecognizers` *(checked)*: tap and click work on every platform; hover through the label (next row) |
| Term under the pointer | a `PointerGestureRecognizer` on the label, then `label.GetChildElements(position)`: the spans with gesture recognizers whose `ISpatialElement.Region` contains the point *(checked: public, `ISpatialElement` lives in `Microsoft.Maui.Controls.Internals`)* |
| Element with an explanation (`data-deeptip`) | `deepTip.SetKey(view, key)`, `SetDelay`, `SetPlace` (dictionaries in the host; a XAML attached property can call them) |
| `data-dt-open`, `data-dt-arming` | visual states `DeepTipOpen` / `DeepTipArming` set with `VisualStateManager.GoToState`; the app's own tooltip: `ToolTipProperties.Text` *(checked)*, cleared while a window is open |
| `pointerover` | `PointerGestureRecognizer.PointerEntered` / `PointerExited` on every marked view and window, `PointerMoved` on term labels and on the root (samples) *(checked: events exist)* |
| Pointer type | Windows: `e.PlatformArgs.PointerRoutedEventArgs.Pointer.PointerDeviceType` *(checked in the source)*; other platforms: verify |
| Clicks | `TapGestureRecognizer.Tapped` on term spans, `Button.Clicked` for pin and close, a `TapGestureRecognizer` on the window for clicks elsewhere inside |
| Keyboard | no cross-platform key events in MAUI (`KeyboardAccelerator` serves menu items only): one hook per platform, each running before the focused control (section 7.5) |
| `schedule(ms, f)` / `cancel` | `IDispatcherTimer` from `Dispatcher.CreateTimer()`, `IsRepeating = false`; cancel = `Stop()` *(compiled)* |
| `now()` | `Stopwatch.GetTimestamp()` converted to ms |
| CSS transitions | `view.FadeToAsync(1, 150)` and `TranslateToAsync(0, 0, 150)`; the older `FadeTo`, `TranslateTo`, `ScaleXTo` are obsolete in MAUI 10 *(checked)* |
| Coordinates | device-independent units, origin top-left, y down, on every platform: the space of [§8](../../docs/algorithms.md#8-placement) |
| Focus | `VisualElement.Focus()`, `IsFocused`; `TabIndex` and `IsTabStop` no longer exist in MAUI 10 *(checked)* |
| Long-press, vibration | an own timer from `PointerPressed`; `HapticFeedback.Default.Perform(HapticFeedbackType.LongPress)`. MAUI 10 has no long-press gesture recognizer *(checked)* |
| ARIA | `SemanticProperties.Description`, `Hint`, `HeadingLevel`, `SemanticScreenReader.Default.Announce`; `AutomationProperties.Name` and `HelpText` are obsolete *(checked)* |
| Theme | `Application.Current.RequestedTheme`, `UserAppTheme`, `RequestedThemeChanged` *(checked)*; `AppThemeBinding` in XAML |
| Gamepad | no MAUI API (section 14) |

## 3. Data structures

```csharp
public sealed class TipWindow                          // §4
{
    public int Id;
    public string Key = "";
    public TipWindow? Parent;
    public readonly List<TipWindow> Children = new();
    public object Anchor = null!;                       // a marked View, or a TermRef
    public string Via = "api";                          // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public IDispatcherTimer? CloseTimer;                // §5 leave()
    public Rect Box;                                    // last placed box, overlay coordinates
    public TipWindowView View = null!;
}

public readonly record struct TermRef(Label Text, Span Span, string Key);   // a term span inside a label
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first (= overlay children) | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hoverTrig`, `hoverWin`, `hoverLink`, `last` | from the pointer recognizers | §5, §6 |
| `samples` | `List<(Point P, long T)>` | §5 |
| `pending` | `(object El, IDispatcherTimer Timer)?` | §6 |
| `quiet` | `View?` | §6 `hush` |
| `lockWindow` | `TipWindow?` | §7 |
| `escAt`, `keyboardWindow`, `focusIndex` | `long`, `TipWindow?`, `int` | §9.3, section 4.5 |
| `press`, `swallow` | pointer position, view, timer | §9.2 |
| `keys`, `delays`, `places` | `Dictionary<View, …>` | SPEC §3.3 |

The glossary keeps `data[locale]`, `labels[locale]`, the chain and the live values as in the [Avalonia guide, section 3](../avalonia/README.md#3-data-structures); share it between the pages.

## 4. Windows and terms

### 4.1 The overlay

```csharp
View content = page.Content;
var root = new Grid();
page.Content = root;                                   // detaches the old content from the page
root.Add(content);
overlay = new AbsoluteLayout { InputTransparent = true, CascadeInputTransparent = false };
root.Add(overlay);                                     // last child: drawn above the content; only its children take input
```

*(compiled)*. One host per `ContentPage`, attached in the constructor after `InitializeComponent()`. A `Shell` or `NavigationPage` keeps its own bars outside the page; windows stay inside the page's area, which is the viewport, like the browser viewport for the web.

### 4.2 The window

`TipWindowView : Border` with `StrokeShape = new RoundRectangle { CornerRadius = 8 }`, `StrokeThickness = 1`, `Stroke` and `Background` from section 5, `Shadow = new Shadow { Brush = Colors.Black, Offset = new Point(0, 10), Radius = 30, Opacity = 0.3f }`. Content: a `Grid` with rows `Auto, *, Auto, Auto`:

- row 0, the header: a `Grid` with columns `*, Auto, Auto, Auto` and padding 12,6,6,2: the title `Label` (bold, `SemanticProperties.HeadingLevel`), the fallback badge, the pin and the close `Button` (26×26 on desktop, 40×40 on touch devices; glyphs or images of `PIN_PATH` and `CLOSE_PATH` from `deeptip.js`);
- row 1, a `ScrollView` with a `VerticalStackLayout` of one `Label` per block, padding 12,0,12,10;
- row 2, "See also": a `Label` with the label span (70 % opacity) and one term span per key;
- row 3, the hint line (font size × 0.75, opacity 0.6, a 1 px top border), hidden when pinned, when `hints` is off and on touch devices.

Name the field that points back to the window record `Tip`, not `Window` (section 1).

### 4.3 Rendering the AST to spans

One `Label` per `p` block; a `ul` becomes a `Grid` with a "•" column per item. Inlines per [§3](../../docs/algorithms.md#3-rendering-the-ast) become `Span`s:

| Node ([§2](../../docs/algorithms.md#2-markup-parser)) | Span |
|---|---|
| text, b, i | `Text`, `FontAttributes` = `Bold`, `Italic` or both (nesting adds them up) |
| br | a span with `"\n"` |
| code | `FontFamily` = a monospace font registered in `MauiProgram`, `FontSize` × 0.92 |
| var | the live value, `FontAttributes.Bold` |
| link, own key | bold text |
| link, missing key | `TextDecorations.Underline`, `TextColor` = `--dt-missing`, no recognizer, one warning |
| link | a term span: `TextColor` = `--dt-link`, `TextDecorations.Underline`, a `TapGestureRecognizer` |

```csharp
Span TermSpan(Label label, string key, string text)
{
    var span = new Span { Text = text, TextColor = linkColor, TextDecorations = TextDecorations.Underline };
    var tap = new TapGestureRecognizer();
    tap.Tapped += (s, e) => OnTermTapped(new TermRef(label, span, key));
    span.GestureRecognizers.Add(tap);
    return span;
}
```

*(compiled)*. Span text is plain text on every platform, so glossary text never becomes markup. MAUI underlines are solid; the reference's dotted and wavy underlines are not available.

### 4.4 Terms under the pointer (Windows, Mac Catalyst)

```csharp
var hover = new PointerGestureRecognizer();
hover.PointerMoved += (s, e) =>
{
    Span? span = e.GetPosition(label) is Point q
        ? label.GetChildElements(q)?.OfType<Span>().FirstOrDefault(x => ((ISpatialElement)x).Region.Deflate().Contains(q))
        : null;
    SetLink(label, span);                               // term changed → section 7.1, step 3
};
hover.PointerExited += (s, e) => SetLink(label, null);
label.GestureRecognizers.Add(hover);
```

*(compiled)*. *(checked in the source)*: each platform computes the span regions after layout: Windows from `TextPointer.GetCharacterRect` of the span's run, inflated by 10 so taps hit easily; Mac Catalyst and iOS from TextKit line fragments, not inflated; Android from the text layout in device pixels, inflated by 10. `Region.Deflate()` removes the inflation, so hover follows the text exactly; MAUI's own tap handling uses the inflated region. On Android, convert a position to pixels (`× DeviceDisplay.MainDisplayInfo.Density`) before comparing, or rely on taps there (verify). No public API returns the region of a page term as a rectangle in the label's coordinates other than this `Region`; its bounding lines give the anchor box of a page term.

### 4.5 Keyboard focus inside windows

MAUI can neither focus a span nor order the focus (no `TabIndex` in MAUI 10). Keep the focus inside a window as an index, as the [Unity guide, section 4.5](../unity/README.md#45-keyboard-and-gamepad-focus-inside-windows) does: when a window is opened by `F1`, it becomes the host's `keyboardWindow`; the platform key hooks (section 7.5) route `Tab`, `Shift+Tab`, arrows, `Enter` and `Space` to it while it is set; the focused term span gets `BackgroundColor` = term colour at 16 %; the list is its terms in text order, then pin and close. A pointer press outside the window ends the mode.

**Alternative renderer** for apps that need every term as a real control (screen readers on all platforms, native Tab order): a `FlexLayout` (`Direction = Row`, `Wrap = Wrap`) with one `Label` per word and one `Button` (transparent background, no border, padding 0, link colour) per term. Each term is then focusable, announced as a button and clicked by Enter and Space natively, at the cost of line breaking by words only, no underline on `Button` text, and baselines aligned only by `Center`/`End` (`FlexAlignItems` has no baseline value *(checked)*).

## 5. Look: the values of `deeptip.css`

Resources with `AppThemeBinding`, or two dictionaries swapped on `RequestedThemeChanged`:

```xml
<Color x:Key="DeepTipBackgroundLight">#FFFFFF</Color>
<Color x:Key="DeepTipBackgroundDark">#1B1E24</Color>
<!-- view: Background="{AppThemeBinding Light={StaticResource DeepTipBackgroundLight}, Dark={StaticResource DeepTipBackgroundDark}}" -->
```

| Resource (web token) | Light | Dark |
|---|---|---|
| Background (`--dt-bg`) | `#FFFFFF` | `#1B1E24` |
| Text (`--dt-fg`) | `#1F2328` | `#E6E8EC` |
| Border, hint line (`--dt-border`) | `#C8CDD5` | `#3B414D` |
| Accent: pinned frame, lock bar, focus (`--dt-accent`, `--dt-pinned`) | `#0B69D4` | `#58A6FF` |
| Term (`--dt-link`) | `#0B69D4` | `#6CB6FF` |
| Term on hover (`--dt-link-hover`) | `#084F9F` | `#9CCFFF` |
| Open or focused term background | term colour at 16 % (`#290B69D4`) | `#296CB6FF` |
| Button hover (`--dt-hover-bg`) | `#12000000` | `#17FFFFFF` |
| Missing term (`--dt-missing`) | `#DD3333` | `#DD3333` |

Span colours are set in code: re-render the windows on `RequestedThemeChanged`. Sizes in device-independent units: radius 8, border 1, font size 14, padding 12, min width 240, max width 384, max height 480, gap 8, code at 0.92; live values bold; badge 0.7 em with a 1 px border. Motion: windows fade in over 150 ms (`FadeToAsync`, `TranslateToAsync` from 4 units below), the lock bar grows over `lockAfter` (`ScaleXToAsync` with `AnchorX = 0`), a flash is a 3 px accent stroke for 0.6 s.

## 6. Placement and coordinates

MAUI lays out in device-independent units with y down on every platform, which is the space of [§8](../../docs/algorithms.md#8-placement); no DPI factor appears. The viewport is the overlay's `Width` × `Height`. Anchor boxes in overlay coordinates (the overlay starts at the root's origin):

```csharp
static Rect BoxIn(VisualElement e, Element root)       // e's frame in the coordinates of root
{
    double x = 0, y = 0;
    for (Element? p = e; p != null && p != root; p = p.Parent)
    {
        if (p is VisualElement v) { x += v.Frame.X + v.TranslationX; y += v.Frame.Y + v.TranslationY; }
        if (p.Parent is ScrollView s) { x -= s.ScrollX; y -= s.ScrollY; }
    }
    return new Rect(x, y, e.Width, e.Height);
}

void Place(TipWindow w)
{
    if (w.Frozen) return;                                                  // §4.5
    TipWindowView view = w.View;
    Rect t = w.Parent != null ? w.Parent.Box : AnchorBox(w.Anchor);         // children sit next to their parent window
    double vw = overlay.Width, vh = overlay.Height;
    view.MinimumWidthRequest = Math.Min(240, vw - 16);
    view.MaximumWidthRequest = Math.Min(384, vw - 16);
    view.MaximumHeightRequest = Math.Min(480, vh - 16);
    Size size = view.Measure(view.MaximumWidthRequest, double.PositiveInfinity);   // natural size within the limits
    var p = Placement.Compute(size.Width, size.Height, new PlaceBox(t.Left, t.Top, t.Right, t.Bottom), Sides(w), vw, vh, 8);
    if (p.MaxW > 0 || p.MaxH > 0)                                           // nothing fits: shrink, the ScrollView scrolls
    {
        if (p.MaxW > 0) view.MaximumWidthRequest = p.MaxW;
        if (p.MaxH > 0) view.MaximumHeightRequest = p.MaxH;
        size = view.Measure(view.MaximumWidthRequest, view.MaximumHeightRequest);
        p = Placement.Compute(size.Width, size.Height, new PlaceBox(t.Left, t.Top, t.Right, t.Bottom), new[] { p.Side }, vw, vh, 8);
    }
    AbsoluteLayout.SetLayoutBounds(view, new Rect(p.X, p.Y, size.Width, size.Height));
    w.Box = new Rect(p.X, p.Y, size.Width, size.Height);
}
```

*(compiled)*. Add the view to the overlay before measuring: `Measure` needs its handler to measure text. If a platform returns no size before the first layout pass (verify), place in two steps: add the view with `Opacity = 0`, place it in its `SizeChanged`, then fade it in. `BoxIn` does not see through views that virtualise or transform natively (`CollectionView` items, `CarouselView`): there, `GetVisualTreeElements(root, point)` *(checked: public)* or the platform view's bounds are needed (verify). `Sides(w)`: `SetPlace` of the anchor (roots only), else `child` or `root`. Re-place a window when the overlay's `SizeChanged` fires, when a `ScrollView` raises `Scrolled`, after pinning (the hint line disappears) and after `refresh()`, comparing boxes before writing. Safe areas: the root `Grid` sits where the page's content sat, so the overlay shares its insets.

## 7. Events: exact order of operations

### 7.1 Pointer (Windows, Mac Catalyst, iPad with a pointer)

```csharp
var pointer = new PointerGestureRecognizer();                     // on the root Grid: samples and leaving the page
pointer.PointerMoved += (s, e) => { if (e.GetPosition(overlay) is Point p) AddSample(p, Now()); };
pointer.PointerExited += (s, e) => OnPointerLeftPage();
root.GestureRecognizers.Add(pointer);

public void SetKey(View element, string key)                      // every marked view gets enter/exit
{
    keys[element] = key;
    var p = new PointerGestureRecognizer();
    p.PointerEntered += (s, e) => { hoverTrig = element; Resolve(); };
    p.PointerExited += (s, e) => { if (hoverTrig == element) hoverTrig = null; Resolve(); };
    p.PointerPressed += (s, e) => OnPressed(element, e);
    p.PointerReleased += (s, e) => OnReleased(element, e);
    element.GestureRecognizers.Add(p);
}
```

Window views get the same enter/exit pair (`hoverWin`), term labels the hover recognizer of section 4.4 (`hoverLink`). `Resolve()`: `win` = `hoverWin`; `link` = `hoverLink`; `trig` = `hoverTrig` only when there is neither; if the triple differs from the last one → "on pointer over" of [§6](../../docs/algorithms.md#6-arming-and-delays) (hover, quiet reset, `refreshHot`, `lockTrack`, arm or disarm). *(checked in the source)*: on Windows the recognizers subscribe to the WinUI pointer events of the view's container and never mark them handled, so `PointerMoved` of the root also arrives while the pointer is over its children; whether every platform reports `PointerEntered` and `PointerExited` of nested views in the same order must be verified.

### 7.2 Pointer left the page

`PointerExited` of the root: `hover = {}`, `disarm()`, `lockTrack(none)`, `refreshHot()` ([§6](../../docs/algorithms.md#6-arming-and-delays)).

### 7.3 Pressed and released, touch

In the order of [§9.2](../../docs/algorithms.md#92-pointer-down-touch):

1. `PointerPressed` on a marked view: from the mouse → `hush(view)`; from touch → `pressStart`: a one-shot timer of `longPress` (touch from `PointerDeviceType` on Windows; on Android and iOS, whether `PointerPressed` reports touches must be verified).
2. A press anywhere outside the windows (a `TapGestureRecognizer` on the root `Grid`): `outsideClickCloses` (`"always"`, or `"touch"` on touch devices) closes all.
3. The long-press timer fires: `HapticFeedback.Default.Perform(HapticFeedbackType.LongPress)`, open the view's window pinned, start the 1.5 s swallow. MAUI cannot cancel a `Button.Clicked` from outside: set the anchor's `InputTransparent = true` until the finger is lifted so the release does not reach it (verify), or let the app ask `deepTip.IsSwallowing(button)` in its handler.
4. `PointerReleased` ends the press. A swipe down on a window header (`PanGestureRecognizer` with `TotalY > 60`, `|TotalX| < 60`) closes all.

### 7.4 Clicks and taps ([§9.1](../../docs/algorithms.md#91-clicks))

- A term span's `Tapped` → `follow(term, the window of the label or none for page texts, focus: false)`.
- Pin and close `Button.Clicked` → `pin`/`unpin`, `close(win, focusBack: true)`.
- A `TapGestureRecognizer` on the window view: when the tap did not follow a term (the span recognizer handled it first) → `clickInsidePins`.

### 7.5 Keys, per platform ([§9.3](../../docs/algorithms.md#93-keyboard))

Each hook calls one host method `bool OnKey(string key, bool shift, bool repeat)` (`"Escape"`, `"F1"`, `"F6"`, `"Tab"`, `"Enter"`, `"Space"`, arrows) and `bool OnChar(char c)` (`'?'`, printable text for `hush`) and consumes the key when it returns `true`. The host does what [§9.3](../../docs/algorithms.md#93-keyboard) says: Esc closes the newest window (Shift, or held ≥ 600 ms: all) and is consumed only while windows are open; F6 cycles; F1 and "?" open the focused element's window pinned; keys of section 4.5 move the focus index while a window has the keyboard. None of these hooks could be compiled here (verify each):

- **Windows** (WinUI 3): in `MauiProgram`, `builder.ConfigureLifecycleEvents(e => e.AddWindows(w => w.OnWindowCreated(window => …)))`; once the window's `Content` exists (first `Activated`), add `content.PreviewKeyDown += (s, k) => k.Handled = host.OnKey(k.Key.ToString(), shiftDown, k.KeyStatus.WasKeyDown)` and `content.CharacterReceived` for "?". `PreviewKeyDown` tunnels from the root, so it runs before the focused control; Shift from `InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift)`.
- **Android**: override `DispatchKeyEvent(KeyEvent e)` in `MainActivity`: it sees every key before the focused view; return `true` when the host used it (`Keycode.Escape`, `F1`, `F6`, `e.RepeatCount > 0`, `e.IsShiftPressed`, `e.UnicodeChar` for "?"). The Back button reaches the page as `OnBackButtonPressed` (quick start): close the newest window instead of navigating back *(checked: `Page.OnBackButtonPressed` is protected virtual)*.
- **iOS and Mac Catalyst**: hardware keyboards only; add `UIKeyCommand`s for `UIKeyCommand.Escape` (and "?") to the root view controller's `KeyCommands` with `WantsPriorityOverSystemBehavior = true`, or override `PressesBegan` in the window and pass unused presses on.

Polled or platform-level Esc handlers of the app itself must ask the host (`deepTip.EscapeConsumed`) as in the [Unity guide, section 7.3](../unity/README.md#73-keys-93).

### 7.6 Timers

```csharp
IDispatcherTimer After(double ms, Action f)
{
    IDispatcherTimer t = overlay.Dispatcher.CreateTimer();
    t.Interval = TimeSpan.FromMilliseconds(Math.Max(0, ms));
    t.IsRepeating = false;
    t.Tick += (s, e) => f();
    t.Start();
    return t;                                          // cancel: t.Stop()
}
```

*(compiled)*. `closeTimer`, `pending`, the `RETRY` re-checks (90 ms), the long-press and the swallow end are `After` handles on the UI thread. Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): `After(lockAfter, pin if still the lock window)` plus `lockBar.ScaleXToAsync(1, lockAfter, Easing.Linear)` for the bar; stop = `Stop()`, `lockBar.CancelAnimations()`, `ScaleX = 0`. Flash ([§4.4](../../docs/algorithms.md#44-flashw)): stroke 3 in the accent colour for 600 ms.

### 7.7 Focus ([§9.5](../../docs/algorithms.md#95-focus))

Opening by `F1` makes the window the `keyboardWindow` with the index on its first term (section 4.5); with the alternative renderer, `firstTermButton.Focus()`. Closing with the keyboard inside → `anchor.Focus()` if the anchor is still loaded (`IsLoaded`). F6 cycles windows newest first.

### 7.8 Anchors that disappear

`Unloaded` of a marked view, or a `null` `Parent` / `Handler` in the re-placement pass: previews close, a pinned root freezes at `w.Box` ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Term anchors are replaced when their label is re-rendered (section 9).

## 8. Loading the glossaries

Order per [§1.2](../../docs/algorithms.md#12-layers-locales-lookup): for each locale of the chain, each source template in order (core first, project after); a missing file is a warning. Files under `Resources/Raw` are `MauiAsset`s (the default template includes `Resources\Raw\**` with its folder structure as the logical name):

```csharp
async Task<string?> ReadPackageFile(string path)                     // "deeptip/core/en.json"
{
    try
    {
        using Stream s = await FileSystem.Current.OpenAppPackageFileAsync(path);
        using var r = new StreamReader(s);
        return await r.ReadToEndAsync();
    }
    catch (FileNotFoundException) { return null; }                   // a missing file is a warning (§1.2)
}
```

*(compiled)*. Parse with `System.Text.Json.JsonDocument` and walk `EnumerateObject()`: file order, repeated names accepted; keep a repeated key at its first position with the last value, as `JSON.parse` does *(checked: the same parser passed the parity runner inside the MAUI project)*; `JsonNode` rejects repeated names. Entries are objects whose `title`, `short` or `body` is a JSON string ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)).

## 9. Live values, locales, refresh

- `vars`: a dictionary of values, `Func<object?>` or `Func<string, object?>` (called with the window's key), or one `Func<string, string?, object?>`; null keeps `{name}` visible; read when a window renders.
- `Refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): rebuild every window's `FormattedString`s, set each child's anchor to the new `TermRef` with the same key in the parent and mark it open, re-place; re-render every `DeepTipText` and `DeepTipIndex`. Call it after the values change and on `RequestedThemeChanged` (span colours).
- `SetLocale(locale)` loads the missing files of the new chain, then refreshes.
- `DeepTipIndex` ([§12](../../docs/algorithms.md#12-encyclopedia)): a `SearchBar` and a `CollectionView` with one row per entry (title as a term, the `short` line, "Mentioned in" with terms), sorted with `string.Compare(a, b, culture, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace)`; keep the query across refreshes.

## 10. Accessibility

- Window: `SemanticProperties.Description` = title, `Hint` = the body as plain text; the title label `SemanticProperties.HeadingLevel`. MAUI has no tooltip or dialog role.
- Previews: `SemanticScreenReader.Default.Announce(title + ": " + short)` when they open.
- Terms: spans are read as part of their label and are not separate controls for screen readers on every platform (verify per platform); use the alternative renderer of section 4.5 when every term must be reachable with a screen reader.
- Root anchor while its window is open: its `SemanticProperties.Hint` = the window's plain text, restored on close.
- Touch targets ≥ 40 on touch devices. Reduced motion and high contrast have no MAUI API: read them per platform (Windows `UISettings.AnimationsEnabled`, iOS `UIAccessibility.IsReduceMotionEnabled`, Android `Settings.Global.AnimatorDurationScale`) or offer an option.

## 11. Pitfalls

- **Inflated span regions**: MAUI enlarges them by 10 for taps on Windows and Android; deflate for hover (section 4.4). Android regions are in pixels.
- **No key events in MAUI**: Esc, F1, F6 and "?" need the platform hooks of section 7.5; without them DeepTip works by pointer and touch only.
- **No focus order**: `TabIndex` and `IsTabStop` are gone in MAUI 10; terms inside a label cannot take the focus (section 4.5).
- **Clicks after a long-press** cannot be cancelled from outside a `Button` (section 7.3).
- **Names**: `Window` on every `VisualElement`, `Rect` in `Microsoft.Maui.Graphics` (section 1).
- **`ISpatialElement` is in the `Internals` namespace**: public, but meant for MAUI's own use; check it after MAUI updates.
- **The app's tooltip** (`ToolTipProperties.Text`) shows over the window: clear it with `ClearValue(ToolTipProperties.TextProperty)` while the window is open, set it again on close.
- **Re-parenting the page content** in `Attach` happens once, before the page appears; do it again if the app replaces `page.Content` later.

## 12. Testing

### 12.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

The pure parts have no MAUI types; test them in a plain `net10.0` test project as the [Avalonia guide, section 10.1](../avalonia/README.md#101-parity-cases-11) shows (MAUI's platform heads cannot run `dotnet test`). *(checked: 24 of 24 cases, also in a project that references Microsoft.Maui.Controls 10.0.120.)*

### 12.2 Behaviour

- Without a device: a `net10.0` test project that references `Microsoft.Maui.Controls` compiles against the platform-neutral assemblies (no workload needed *(checked)*); the host's window tree, hot set, grace, tendency and suppression run there with an injected clock and fake pointer calls, as long as they do not need a handler (no measuring, no rendering).
- On devices: Windows and Mac Catalyst for hover, F1, Esc and F6; Android and iOS for long-press, tap, Back and a screen reader. Compare by hand with the web example (`npm run demo`).

## 13. The example to build

The same screen as `frameworks/web/example`, as a `ContentPage`: a row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with delay 0, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) in the corners of a `Grid` for placement at the edges, a page text with terms (`DeepTipText`), settings (delay, lock, buttons, hints) and the encyclopedia (`DeepTipIndex`). Glossaries: `Resources/Raw/deeptip/core/{locale}.json`, then `Resources/Raw/deeptip/example/{locale}.json`, copied from `glossary/core` and `glossary/example`.

## 14. Limitations compared with the web reference

- **Keyboard** only through platform hooks; no native focus for terms (section 4.5); iOS and Android only with hardware keyboards.
- **Hover** only where a pointer exists (Windows, Mac Catalyst, iPad with a pointer); phones use long-press and tap, as SPEC §3.3 intends.
- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): no MAUI API; platform code (`Windows.Gaming.Input`, Apple's `GameController`, Android `InputDevice`).
- **Screen readers** read terms as part of the text unless the alternative renderer is used (section 10).
- **Underlines** are solid; no dotted or wavy line.
- **Not run on a device** for this guide: the "verify" points need Windows, Mac Catalyst, Android and iOS builds.

## 15. Checklist

1. Port `flatten`, `parseText`, `computePlacement` and pass `test/cases` (section 12.1).
2. `Glossary` with layers, chain, `$ui` labels and live values; validate the same JSON files with `tools/deeptip-check.mjs`.
3. Overlay, `TipWindowView`, span renderer, hover and tap on terms (section 4), placement (section 6), `DeepTipHost` events and timers (section 7).
4. Key hooks for each shipped platform (section 7.5); test on each platform (section 12.2).
5. The example (section 13); compare with the web example by hand; then list the framework with its state in the main README.
