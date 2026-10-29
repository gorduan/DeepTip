# DeepTip for Windows Forms: build guide

How to build [DeepTip](../../README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Windows Forms application with C#, .NET 8 or newer.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Windows Forms. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. Statements marked *(checked)* were verified on 2026-10-29 with **Windows Forms on .NET 10** (SDK 10.0.403, Windows Desktop runtime 10.0.14, Windows 11, 96 DPI) in a headless probe: a form whose handles were created but which was never shown, messages posted to its hidden windows and pumped with `Application.DoEvents`, accessibility objects queried in process and through UI Automation from a second thread, views rendered with `DrawToBitmap`. The C# port of §1, §2 and §8 described in the [Avalonia guide](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked) passed all 24 shared cases on .NET 8 and .NET 10 as C# 9. Touch is marked "verify": it needs a device.

## Quick start

**Recognise the project:** a `.csproj` with `<UseWindowsForms>true</UseWindowsForms>` and a Windows target framework (`net8.0-windows` or newer), `Form1.cs` with `Form1.Designer.cs`, `Program.cs` calling `ApplicationConfiguration.Initialize()` and `Application.Run(new Form1())`, `using System.Windows.Forms`; .NET Framework projects reference `System.Windows.Forms`.

1. Port `flatten`, `parseText` and `computePlacement` and pass `test/cases` (section 12.1).
2. Build `Glossary`, `TermView`, `TipWindowView`, the message filter and `DeepTipHost` as sections 3–7 describe.
3. Copy `glossary/core/<locale>.json` and your `deeptip/<locale>.json` into the output folder (section 8).
4. Attach one `DeepTipHost` to each form in its constructor.
5. Mark controls with `host.SetKey(control, "<key>")` (or the designer property of section 2).
6. Validate the glossaries: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```csharp
public partial class Form1 : Form
{
    public Form1()
    {
        InitializeComponent();
        DeepTipHost deepTip = DeepTipHost.Attach(this, new DeepTipOptions
        {
            Locale = "en",
            Sources = { "deeptip/core/{locale}.json", "deeptip/{locale}.json" },
        });
        deepTip.SetKey(cartButton, "shop.cart");
    }
}
```

**Done when:** resting on the button for 800 ms opens its window below it inside the form, hovering a term in it opens a second window beside the first and a click pins both, `Esc` closes the newest window while the form's `CancelButton`, `KeyPreview` handlers and `ProcessCmdKey` do not see it, `F1` on the focused button opens its window pinned with the focus on its first term, Inspect or Accessibility Insights lists the terms as hyperlinks.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary`, `Markup.Parse`, `Placement.Compute` | plain C# 9, no WinForms types | files per locale, layers, chain, `$ui` labels, live values; glossary text → AST; `computePlacement` | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement) |
| `TermView` | owner-drawn `Control` | rich text with terms: measuring, line breaking, painting, hit tests, focus, accessible children | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `TipWindowView` | `Panel` subclass | one window: header, scrolling body, "See also", hint, lock bar | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `DeepTipFilter` | `IMessageFilter` | the capture phase: every queued mouse and key message of the thread, before any control | [§6](../../docs/algorithms.md#6-arming-and-delays), [§9](../../docs/algorithms.md#9-input) |
| `DeepTipHost` | one per `Form` | keys of the marked controls, window tree, hover state, timers | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock) |
| `DeepTipText`, `DeepTipIndex` | controls | terms on normal pages (a `TermView`), the encyclopedia | [§12](../../docs/algorithms.md#12-encyclopedia) |

The pure parts are the same C# for every .NET UI: port them as the [Avalonia guide, section 9](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked) describes and test them as in its [section 10.1](../avalonia/README.md#101-parity-cases-11). One WinForms clash: `System.Windows.Forms.Keys` is an enum, so do not call the key validator `Keys` *(checked: `Keys` became ambiguous)*.

## 2. SPEC concept → Windows Forms primitive

| SPEC | Windows Forms |
|---|---|
| Top layer for windows | the form's own `Controls`: each window view is a child of the form itself (never of a nested container), moved to the top of the z-order with `BringToFront()` *(checked: z-index 0; docked siblings kept their bounds; child controls carry `WS_CLIPSIBLINGS`, so siblings do not paint over the view)*. The form's client area is the viewport, as the browser viewport is for the web; one coordinate space, normal keyboard focus. |
| Window | `TipWindowView : Panel` at `Bounds` in form client pixels |
| Rich text | none with mixed fonts and focusable links: an owner-drawn `TermView` measures and draws words with `TextRenderer` (section 4.3) |
| Term (a real button, SPEC §6) | a run inside a `TermView`: hit-tested by its word boxes, focused through an own focus index, exposed as an accessible child with the role `Link` *(checked: UI Automation reports it as a hyperlink)* |
| Element with an explanation (`data-deeptip`) | `host.SetKey(control, key)`, `SetDelay(control, ms)`, `SetPlace(control, "top,bottom")`; for the designer, the same as a component implementing `IExtenderProvider` with `[ProvideProperty("DeepTipKey", typeof(Control))]`, the way the `ToolTip` component adds its property |
| `data-dt-open`, `data-dt-arming` | host events `AnchorOpenChanged(control, bool)` and `Arming(control, ms or null)` (paint a rest-progress bar there); while a window is open, `toolTip.SetToolTip(anchor, null)` (restore the text on close) so the app's simple tooltip stays hidden |
| `pointerover` + `closest()` | `WM_MOUSEMOVE` in the message filter, then a recursive `GetChildAtPoint` from the form and a walk up `Parent` (section 7.1) |
| Pointer type | mouse messages that Windows made from touch or pen carry `(GetMessageExtraInfo() & 0xFFFFFF00) == 0xFF515700`, bit `0x80` set for touch (Windows documentation; posted test messages carried 0 *(checked)*) |
| Clicks | `TermView.OnMouseUp` for terms, `Button.Click` for close and pin, `WM_LBUTTONUP` in the filter for clicks elsewhere inside a window |
| Keyboard | `WM_KEYDOWN`, `WM_KEYUP`, `WM_CHAR` in the filter; returning `true` consumes before `ProcessCmdKey`, `ProcessDialogKey` (the `CancelButton`), `KeyPreview` and `KeyDown` *(checked)* |
| `schedule(ms, f)` / `cancel` | a `System.Windows.Forms.Timer` that stops itself in `Tick` *(checked)*; cancel = `Stop()` |
| `now()` | `Stopwatch.GetTimestamp()` converted to ms (monotonic) |
| CSS transitions | none for child controls (no opacity); the lock bar and the flash are repainted by a 16 ms `Timer` |
| Long-press | an own timer on a touch-generated button down; Windows' press-and-hold right-click is switched off per control by answering `WM_TABLET_QUERYSYSTEMGESTURESTATUS` (0x02CC) with `TABLET_DISABLE_PRESSANDHOLD` (1) (verify) |
| Theme (light/dark) | own colour sets (section 5); `Application.SetColorMode(SystemColorMode.System)` makes the standard controls follow Windows (no `Experimental` attribute in .NET 10 *(checked)*); `Application.IsDarkModeEnabled` tells which set to use |
| `forced-colors` | `SystemInformation.HighContrast`, then `SystemColors` |
| `prefers-reduced-motion` | `SystemParametersInfo(SPI_GETCLIENTAREAANIMATION = 0x1042)` through P/Invoke ("Animation effects" in Windows); `SystemInformation.UIEffectsEnabled` is the older master switch |
| ARIA | `AccessibleRole`, `AccessibleName`, `AccessibleDescription` on controls; `CreateAccessibilityInstance` for the terms |
| Vibration, gamepad | no WinForms API (section 14) |

The alternative top layer, owned top-level forms (`FormBorderStyle.None`, `ShowInTaskbar = false`, `Owner = form`, `ShowWithoutActivation` returning true, `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`, `CS_DROPSHADOW`): windows may then leave the form, get a system shadow and `Opacity`, and the viewport becomes `Screen.FromControl(form).WorkingArea`. But a non-activating window cannot hold the keyboard focus, and activating it deactivates the main form, the trade-off the [Java Swing guide](../java-swing/README.md#41-the-window-jwindow) describes. Child controls keep focus, coordinates and input in one form, so they are the default.

## 3. Data structures

```csharp
public sealed class TipWindow                          // §4
{
    public int Id;
    public string Key = "";
    public TipWindow? Parent;
    public readonly List<TipWindow> Children = new();
    public object Anchor = null!;                       // a marked Control, or a TermRef
    public string Via = "api";                          // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public System.Windows.Forms.Timer? CloseTimer;      // §5 leave()
    public Rectangle Box;                               // last placed box, form client pixels
    public TipWindowView View = null!;
}

// A term inside a TermView (a window body, "See also" or a page text): the view and the term's index in it.
public readonly record struct TermRef(TermView View, int Index);
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hover`, `lastTarget` | `(TipWindow? Win, TermRef? Link, Control? Trig)` | §5, §6 |
| `samples` | `List<(Point P, long T)>` | §5 |
| `pending` | `(object El, System.Windows.Forms.Timer Timer)?` | §6 |
| `quiet` | `Control?` | §6 `hush` |
| `lockWindow`, `lockStart` | `TipWindow?`, `long` | §7 |
| `escAt`, `escUsed` | `long`, `bool` | §9.3 |
| `press`, `swallow`, `swipe` | small records with the position, the control, the timer | §9.2 |
| `keys`, `delays`, `places` | `Dictionary<Control, …>` filled by `SetKey`, `SetDelay`, `SetPlace` | SPEC §3.3 |

The glossary keeps `data[locale]` as `Dictionary<string, Entry>`, `labels[locale]`, the chain and the live values as in the [Avalonia guide, section 3](../avalonia/README.md#3-data-structures). One `DeepTipHost` per form, one message filter per thread; the glossary can be shared.

## 4. Windows and terms

### 4.1 The top layer

```csharp
form.Controls.Add(view);                 // a child of the form itself
view.BringToFront();                     // z-index 0: drawn and hit-tested above every other child
```

Child windows are opaque rectangles: no translucency, no shadow, no anti-aliased corners. Paint square corners and a 1 px border, or clip with `Region` (hard edges). Bring the newest window to the front again after the app adds controls of its own.

### 4.2 The window view

`TipWindowView : Panel`, an own class so the host recognises it:

- `DoubleBuffered = true`, `BackColor` from section 5, `TabStop = false` and `SetStyle(ControlStyles.Selectable, true)`: a focus target when the window has no terms, but no Tab stop of its own. Paint the 1 px border (accent when pinned) and the lock bar in `OnPaint`.
- Header: a title `Label` (semi-bold font), the fallback badge `Label` (§3), pin and close as flat `Button`s (`FlatStyle.Flat`, `FlatAppearance.BorderSize = 0`), 26×26 logical pixels, 40×40 after touch input; their icons are glyphs of the "Segoe Fluent Icons" font (Windows 11; "Segoe MDL2 Assets" on Windows 10): pin U+E718, pinned U+E841, close U+E711, drawn with `TextRenderer.DrawText` (GDI+ has no SVG path parser for the `PIN_PATH` of `deeptip.js`). Order: title, badge, pin, close, so Tab reaches pin before close as in the reference.
- Body: a `Panel` with `AutoScroll = true` holding the body `TermView`, padding 12,0,12,10; then "See also" as a second `TermView` (label at 70 % opacity, terms comma separated, font × 0.9); then the hint `Label` with a 1 px top border (font × 0.75, 60 % opacity), hidden when pinned, when `hints` is off and after touch input.
- Size: natural width = the widest of header, unwrapped body + 24, "See also" + 24, hint + 24, plus 2 for the border, clamped to the limits of section 6; lay the `TermView`s out at that width and add the heights; above the maximum height the body panel scrolls.

### 4.3 `TermView`: rich text with terms

Render the AST ([§3](../../docs/algorithms.md#3-rendering-the-ast)) into *pieces*: text with a `Font` and a `Color`, a term index or −1, and line breaks. One `Font` per style, created for the control's DPI: `new Font("Segoe UI", 14f * DeviceDpi / 96f, style, GraphicsUnit.Pixel)` (regular, bold, italic, bold italic; code `Cascadia Code`/`Consolas` at 0.92; values semi-bold); re-create them in `DpiChangedAfterParent`.

| Node | Piece |
|---|---|
| text, b, i | text in the regular, bold, italic or bold italic font |
| br | a line break |
| code | text in the code font |
| var | the live value in the value font |
| link to the window's own key | bold text |
| link to a missing key | text with a wavy underline in `--dt-missing` red (owner-drawn, so the reference's wavy line is possible), no term, one warning |
| link | text in the link colour with a term index; keep `(key, label)` per index |
| p | a gap of 0.5 em before the next block |
| ul | per item a "•" and the text indented by 1.2 em, wrapped lines indented too |

Measuring and line breaking *(checked: the window of `demo.realm` wrapped at 384 px with the terms in place)*:

```csharp
const TextFormatFlags Flags = TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
static int TextWidth(string s, Font f) => TextRenderer.MeasureText(s, f, new Size(int.MaxValue, int.MaxValue), Flags).Width;
static int SpaceWidth(Font f) => TextWidth("x x", f) - TextWidth("xx", f);
int LineHeight => (int)Math.Ceiling(Font.GetHeight() * 1.5);

int LayoutText(int maxWidth)                            // greedy: words separated by whitespace tokens
{
    words.Clear();
    int x = 0, y = 0, lh = LineHeight;
    foreach (Piece p in Pieces)
    {
        if (p.Text == "\n") { x = 0; y += lh; continue; }
        foreach (string tok in Tokens(p.Text))           // runs of whitespace and of other characters
        {
            if (char.IsWhiteSpace(tok[0])) { if (x > 0) x += SpaceWidth(p.Font) * tok.Length; continue; }
            int w = TextWidth(tok, p.Font);
            if (x > 0 && x + w > maxWidth) { x = 0; y += lh; }
            words.Add(new Word(new Rectangle(x, y, w, lh), tok, p));
            x += w;
        }
    }
    return y + lh;                                      // the height
}
```

- Paint every word with `TextRenderer.DrawText(g, word, font, origin, color, Flags)` on a common baseline per line: `ascent = font.FontFamily.GetCellAscent(style) * font.GetHeight() / font.FontFamily.GetLineSpacing(style)`, `baseline = lineTop + (lineHeight − font.GetHeight()) / 2 + ascent`, origin y = `baseline − ascent`. Terms get a dotted underline (`new Pen(color) { DashStyle = DashStyle.Dot }`) 2 px below the baseline; the open term a background at 16 % of the link colour; the focused term a 2 px focus rectangle.
- `TextRenderer.MeasureText` does not count trailing spaces reliably; measure whitespace as the difference above. Words are measured alone, so kerning between words is lost (invisible at body sizes).
- `TermAt(point)` = the term index of the word box that contains the point, else −1; the box of a term = the union of its word boxes *(checked: the point in the first term returned 0)*.
- `Unwrapped()` = the widest line without wrapping (sum of the word and space widths between line breaks), for the natural width.

### 4.4 Focus, keys and clicks inside a `TermView`

```csharp
public TermView() => SetStyle(ControlStyles.Selectable | ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);

protected override bool IsInputKey(Keys keyData) => (keyData == Keys.Enter && FocusIndex >= 0) || base.IsInputKey(keyData);

protected override bool ProcessDialogKey(Keys keyData)       // Tab walks the terms, then leaves the view
{
    if ((keyData == Keys.Tab || keyData == (Keys.Tab | Keys.Shift)) && Terms.Count > 0)
    {
        int next = FocusIndex + (keyData == Keys.Tab ? 1 : -1);
        if (next >= 0 && next < Terms.Count) { FocusIndex = next; Invalidate(); return true; }
    }
    return base.ProcessDialogKey(keyData);
}

protected override void OnKeyDown(KeyEventArgs e)            // Enter and Space follow the focused term
{
    if ((e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) && FocusIndex >= 0) { Follow?.Invoke(FocusIndex, true); e.Handled = true; }
    base.OnKeyDown(e);
}

protected override void OnMouseUp(MouseEventArgs e)
{
    int t = e.Button == MouseButtons.Left ? TermAt(e.Location) : -1;
    if (t >= 0) Follow?.Invoke(t, false);                    // false: not the keyboard
    base.OnMouseUp(e);
}
```

*(checked)*: Enter on the focused term followed it, flagged as keyboard; without `IsInputKey`, Enter is a dialog key and goes to the form's `AcceptButton`. A mouse click on the second term followed it, flagged as mouse. `TabStop` = the view has terms; when the view gets the focus from Shift+Tab start at the last term, else at the first. Repaint on `GotFocus` and `LostFocus`.

### 4.5 Accessible terms

```csharp
protected override AccessibleObject CreateAccessibilityInstance() => new ViewAccessible(this);

sealed class ViewAccessible : ControlAccessibleObject
{
    readonly TermView view;
    public ViewAccessible(TermView v) : base(v) { view = v; }
    public override AccessibleRole Role => AccessibleRole.Text;
    public override int GetChildCount() => view.Terms.Count;
    public override AccessibleObject? GetChild(int index) => index >= 0 && index < view.Terms.Count ? new TermAccessible(view, index) : null;
}

sealed class TermAccessible : AccessibleObject
{
    readonly TermView view; readonly int index;
    public TermAccessible(TermView v, int i) { view = v; index = i; }
    public override AccessibleRole Role => AccessibleRole.Link;
    public override string? Name => view.Terms[index].Label;
    public override string? DefaultAction => "Follow";
    public override Rectangle Bounds => view.RectangleToScreen(view.TermBounds(index));
    public override AccessibleObject? Parent => view.AccessibilityObject;
    public override AccessibleStates State => AccessibleStates.Focusable | AccessibleStates.Linked
        | (view.Focused && view.FocusIndex == index ? AccessibleStates.Focused : AccessibleStates.None);
    public override void DoDefaultAction() => view.FollowFromAccessibility(index);
}
```

*(checked)*: the view reported 3 children with role `Link` named by their labels; `DoDefaultAction` followed the term; UI Automation (`AutomationElement.FromHandle` on another thread) listed them as `ControlType.Hyperlink`.

## 5. Look: the values of `deeptip.css`

| Colour (web token) | Light | Dark |
|---|---|---|
| Background (`--dt-bg`) | `#FFFFFF` | `#1B1E24` |
| Text (`--dt-fg`) | `#1F2328` | `#E6E8EC` |
| Border, hint line (`--dt-border`) | `#C8CDD5` | `#3B414D` |
| Accent: pinned frame, lock bar, focus (`--dt-accent`, `--dt-pinned`) | `#0B69D4` | `#58A6FF` |
| Term (`--dt-link`) | `#0B69D4` | `#6CB6FF` |
| Term on hover (`--dt-link-hover`) | `#084F9F` | `#9CCFFF` |
| Open term background (`--dt-link-open-bg`) | term colour at 16 % alpha | same |
| Button hover (`--dt-hover-bg`) | black at 7 % | white at 9 % |
| Missing term underline (`--dt-missing`) | `#DD3333` | `#DD3333` |

`ColorTranslator.FromHtml("#0B69D4")`. Sizes in logical pixels, multiplied by `DeviceDpi / 96` (`LogicalToDeviceUnits`): font 14 px, line height 1.5, padding 12, border 1, min width 240, max width 384, max height 480, gap 8; code at 0.92 em; values semi-bold; badge 0.7 em with a 1 px border, radius 3, opacity 0.65. Child controls have no shadow and no fade; the lock bar grows linearly over `lockAfter`, a flash is a 3 px accent border for 0.6 s.

## 6. Placement and coordinates

DeepTip computes in CSS pixels ([§8](../../docs/algorithms.md#8-placement)); WinForms works in device pixels of the form's client area (origin top-left, y down). Divide every box by `scale = DeviceDpi / 96f` before computing and multiply the result back, so `GAP` and `MIN_SHRINK` keep their meaning on high-DPI screens. Declare `<ApplicationHighDpiMode>PerMonitorV2</ApplicationHighDpiMode>` in the project (or call `Application.SetHighDpiMode(HighDpiMode.PerMonitorV2)` before the first form) and re-create fonts and re-place all windows in `Form.DpiChanged`.

```csharp
void Place(TipWindow w)
{
    if (w.Frozen) return;                                                       // §4.5
    float s = form.DeviceDpi / 96f;
    Rectangle t = w.Parent != null ? w.Parent.Box : AnchorBox(w.Anchor);         // children sit next to their parent window
    var a = new Box(t.Left / s, t.Top / s, t.Right / s, t.Bottom / s);
    double vw = form.ClientSize.Width / s, vh = form.ClientSize.Height / s;
    Size size = w.View.Measure(minW: Math.Min(240, vw - 16), maxW: Math.Min(384, vw - 16), maxH: Math.Min(480, vh - 16), scale: s);
    var p = Placement.Compute(size.Width / s, size.Height / s, a, Sides(w), vw, vh, 8);
    if (p.MaxW > 0 || p.MaxH > 0)                                               // nothing fits: shrink, the body scrolls
    {
        size = w.View.Measure(minW: Math.Min(240, vw - 16), maxW: p.MaxW > 0 ? p.MaxW : Math.Min(384, vw - 16),
                              maxH: p.MaxH > 0 ? p.MaxH : Math.Min(480, vh - 16), scale: s);
        p = Placement.Compute(size.Width / s, size.Height / s, a, new[] { p.Side }, vw, vh, 8);
    }
    w.View.Bounds = new Rectangle((int)Math.Round(p.X * s), (int)Math.Round(p.Y * s), size.Width, size.Height);
    w.Box = w.View.Bounds;
}

Rectangle AnchorBox(object anchor) => anchor is Control c
    ? form.RectangleToClient(c.RectangleToScreen(c.ClientRectangle))
    : TermBoxInForm((TermRef)anchor);                                           // union of the term's word boxes
```

`Sides(w)`: `SetPlace` of the anchor (roots only), else the `child` order for children and the `root` order for roots. *(checked)*: a 59×30 anchor at (8, 285) in a 900×600 client area put the 384×102 root window below it at (8, 323).

WinForms has no "layout updated" event. Re-check in `Application.Idle` (raised whenever the message queue runs empty): for every window that is not frozen, compare the target box, the natural size and the client size with the remembered values and re-place on a change, parents before children. That covers resizing, scrolling containers, pinning (the hint line disappears) and live values.

## 7. Events: exact order of operations

### 7.1 The message filter

`Application.AddMessageFilter(filter)` once per UI thread (remove it when the last form closes). `PreFilterMessage` runs inside the WinForms message loop for every *queued* message of the thread, before the control's `PreProcessMessage`, `ProcessCmdKey`, `ProcessDialogKey`, `KeyPreview` and window procedure; returning `true` drops the message *(checked for `WM_KEYDOWN` posted to a text box in the form)*.

```csharp
public bool PreFilterMessage(ref Message m)
{
    switch (m.Msg)
    {
        case WM_MOUSEMOVE:   host.OnMouseMove(m.HWnd, ClientPoint(m.LParam), FromTouch()); return false;
        case WM_MOUSELEAVE:  host.OnMouseLeave(); return false;
        case WM_LBUTTONDOWN: case WM_RBUTTONDOWN: case WM_MBUTTONDOWN: host.OnPointerDown(m.HWnd, ClientPoint(m.LParam), FromTouch()); return false;
        case WM_LBUTTONUP:   return host.OnLeftButtonUp(m.HWnd, ClientPoint(m.LParam));    // clicks inside windows, swipes, swallow
        case WM_KEYDOWN: case WM_SYSKEYDOWN: return host.OnKeyDown((Keys)(int)m.WParam, ((long)m.LParam & 0x40000000) != 0);
        case WM_KEYUP: case WM_SYSKEYUP: return host.OnKeyUp((Keys)(int)m.WParam);
        case WM_CHAR:        return host.OnChar((char)(int)m.WParam);
    }
    return false;
}

static Point ClientPoint(IntPtr lParam) => new Point((short)((long)lParam & 0xFFFF), (short)(((long)lParam >> 16) & 0xFFFF));
static bool FromTouch() => (GetMessageExtraInfo() & 0xFFFFFF00) == 0xFF515700 && (GetMessageExtraInfo() & 0x80) != 0;
```

The coordinates of a mouse message are client coordinates of `m.HWnd`: `Control.FromChildHandle(m.HWnd)` and `form.PointToClient(control.PointToScreen(point))` give form coordinates *(checked)*. Messages for other forms of the application arrive in the same filter: handle only those whose control's `FindForm()` is the host's form. Bit 30 of a key message's `lParam` is set for auto-repeats.

### 7.2 Mouse moved

1. A press of that pointer moved more than 10 px → `pressEnd` ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)); touch-generated moves stop here.
2. Add a sample and trim the samples ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)).
3. Resolve the triple: `deep` = the deepest control under the point, found from the form with `GetChildAtPoint(p, GetChildAtPointSkip.Invisible | GetChildAtPointSkip.Transparent)` repeated child by child (converting the point each time); `win` = the `TipWindowView` among `deep` and its parents (skip windows that are closing); `link` = if `deep` is a `TermView` and `TermAt` finds a term: `TermRef(deep, index)`; `trig` = only when there is neither: the first control from `deep` upwards with a key.
4. If the triple differs from the last one: "on pointer over" of [§6](../../docs/algorithms.md#6-arming-and-delays) (hover, quiet reset, `refreshHot`, `lockTrack`, arm or disarm).

*(checked)*: the recursive search returned the window view where it covers other controls, the `TermView` and its term under a term, and a disabled button (`GetChildAtPoint` does not skip disabled controls, unlike `WindowFromPoint`).

### 7.3 Pointer left the form

WinForms asks Windows for `WM_MOUSELEAVE` on every control the pointer enters. In the filter: when the cursor (`Cursor.Position`) is no longer over the form's client area or over another window of this form → "on pointer leaving" ([§6](../../docs/algorithms.md#6-arming-and-delays)): `hover = {}`, `disarm()`, `lockTrack(none)`, `refreshHot()`.

### 7.4 Pointer pressed and released, touch

In the order of [§9.2](../../docs/algorithms.md#92-pointer-down-touch):

1. Button down: `win` = the window view under the point; not in a window and not touch → `hush(marked control)`; not in a window → `outsideClickCloses` (`"always"`, or `"touch"` for touch) closes all; touch on a marked control and not on a term → `pressStart` (a one-shot timer of `longPress`, remembering the position); touch on a window header outside its buttons → swipe start.
2. `WM_LBUTTONUP`: end a press; a swipe with dy > 60 and |dx| < 60 closes all; a left click inside a window that hit neither a `Button` nor a term → `clickInsidePins` pins it. Return `false`: the control under the pointer gets its own click.
3. After a long-press opened a window, the release must not click the control under the finger (1.5 s swallow). Windows reports touch as `WM_POINTERDOWN` / `WM_POINTERUP` (0x0246 / 0x0247, pointer type from `GetPointerType`) before it generates mouse messages from them; dropping the `WM_POINTERUP` of that pointer in the filter should keep the generated button-up away (verify on a touch device).

### 7.5 Clicks inside windows ([§9.1](../../docs/algorithms.md#91-clicks))

- `TermView.Follow(index, viaKeyboard)` → `follow(TermRef(view, index), the window that holds the view or none for page texts, focus: viaKeyboard)`.
- Close `Button.Click` → `close(win, focusBack: true)`; pin `Button.Click` → `pin` or `unpin`, then update its glyph, `AccessibleName` and tooltip text.

### 7.6 Keyboard ([§9.3](../../docs/algorithms.md#93-keyboard))

```csharp
bool OnKeyDown(Keys key, bool repeat)                        // from the filter; true = consumed
{
    bool shift = (Control.ModifierKeys & Keys.Shift) != 0;
    if (key == Keys.Escape)
    {
        if (windows.Count == 0) return false;                    // the application gets this Esc
        if (shift || (repeat && Now() - escAt >= 600)) CloseAllAndFocusRootAnchor();
        else if (!repeat) { escAt = Now(); Close(Newest(FocusedControl()), focusBack: true); }
        escUsed = true;
        return true;                                             // no ProcessCmdKey, CancelButton, KeyPreview, KeyDown
    }
    if (key == Keys.F6 && windows.Count > 0) { Cycle(shift ? -1 : 1); return true; }
    if (key == Keys.F1) return OpenFocused();                    // a focused term → follow; a marked control → open pinned
    return false;
}

bool OnKeyUp(Keys key) { if (key != Keys.Escape || !escUsed) return false; escUsed = false; return true; }

bool OnChar(char c)
{
    Control? focused = FocusedControl();                         // Control.FromChildHandle(GetFocus())
    if (c == '?') return !(focused is TextBoxBase) && OpenFocused();
    if (!char.IsControl(c)) Hush(MarkedAncestorOf(focused));     // typing into a marked field
    return false;
}
```

*(checked)*: without the filter, an Esc in a text box reached `ProcessCmdKey` and `ProcessDialogKey` (which clicks the `CancelButton`), and with no `CancelButton` the form's `KeyDown` (`KeyPreview`) and the text box's `KeyDown`; with the filter returning `true`, none of them. A dropped `WM_KEYDOWN` is never translated, so no `WM_CHAR` for Esc follows. Read "?" from `WM_CHAR`: its key differs between keyboard layouts. Native modal loops (`MessageBox.Show`, menus, moving a window) bypass WinForms message filters; DeepTip windows are not usable there anyway.

### 7.7 Timers

```csharp
static System.Windows.Forms.Timer After(int ms, Action f)
{
    var t = new System.Windows.Forms.Timer { Interval = Math.Max(1, ms) };
    t.Tick += (_, _) => { t.Stop(); t.Dispose(); f(); };
    t.Start();
    return t;                                                    // cancel: t.Stop(); t.Dispose()
}
```

- `closeTimer`, `pending.timer`, the `RETRY` re-checks (90 ms), the long-press and the swallow end are `After` handles; they tick on the UI thread *(checked: one tick)*, with the resolution of Windows timers (about 15 ms).
- Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): a one-shot `After(lockAfter, pin if still the lock window)` plus a 16 ms repeating timer that invalidates the 2 px bar, drawn at `elapsed / lockAfter` of the width.
- Flash ([§4.4](../../docs/algorithms.md#44-flashw)): accent border 3 px for 600 ms, then repaint.

### 7.8 Focus ([§9.5](../../docs/algorithms.md#95-focus))

`focusWindow`: the body `TermView` (or "See also") with terms → `FocusIndex = 0; view.Focus()`, else the window view. `hadFocus` = `view.ContainsFocus` for the window or a descendant window. Closing with focus inside → `anchor.Focus()` (a `TermRef`: its `TermView` with `FocusIndex = Index`). F6 cycles windows newest first. Window views are added last, so Tab reaches them after the form's own controls.

### 7.9 Anchors that disappear

In the `Application.Idle` pass: a marked control that `IsDisposed`, is no longer `Visible` or whose `FindForm()` is not the host's form is gone ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)): previews close, a pinned root freezes at `w.Box`. Term anchors are replaced when their `TermView` is re-rendered (section 9).

## 8. Loading the glossaries

Order per [§1.2](../../docs/algorithms.md#12-layers-locales-lookup): for each locale of the chain, each source template in order (core first, project after); a missing file is a warning.

```xml
<ItemGroup>
  <Content Include="deeptip\**\*.json" CopyToOutputDirectory="PreserveNewest" />
</ItemGroup>
```

Read with `File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, path))` (it strips a UTF-8 byte order mark), add the files on the UI thread in exactly that order. Embedded files (`EmbeddedResource`) come from `Assembly.GetManifestResourceStream`. Parse with `System.Text.Json.JsonDocument` and walk `EnumerateObject()`: file order, repeated names accepted; keep a repeated key at its first position with the last value, as `JSON.parse` does *(checked with the parity runner)*; `JsonNode` rejects repeated names. Entries are objects whose `title`, `short` or `body` is a JSON string ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)).

## 9. Live values, locales, refresh

- `vars`: a dictionary of values, `Func<object?>` or `Func<string, object?>` (called with the window's key), or one `Func<string, string?, object?>` `(name, key) → value`; null keeps `{name}` visible; read when a window renders.
- `Refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): rebuild the pieces of every window's `TermView`s, then set each child's anchor to the `TermRef` of the first term with its key in the re-rendered parent and mark it open; re-place; re-render every `DeepTipText` and `DeepTipIndex`. Call it after the values change.
- `SetLocale(locale)` loads the missing files of the new chain, then refreshes.
- `DeepTipIndex` ([§12](../../docs/algorithms.md#12-encyclopedia)): a search `TextBox` and a scrolling panel with one `TermView` per entry (title as a term, the `short` line, "Mentioned in" with terms); sort with `string.Compare(a, b, culture, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace)` (sensitivity "base" of `Intl.Collator`); keep the query across refreshes.

## 10. Accessibility

- Terms: accessible children with role `Link` (section 4.5) *(checked)*.
- Window: `view.AccessibleRole = pinned ? AccessibleRole.Dialog : AccessibleRole.ToolTip`, `AccessibleName` = title, `AccessibleDescription` = the body as plain text; set them in `setState`.
- Root anchor while its window is open: `AccessibleDescription` = the window's plain text (the `aria-describedby` of the web), the previous value restored on close.
- Focus as in 7.8; buttons 40×40 after touch input.
- High contrast: `SystemInformation.HighContrast` → `SystemColors.Window`, `WindowText`, `HotTrack` (terms), `Highlight` (pinned border, 2 px). Reduced motion (section 2): a static flash border.

## 11. Pitfalls

- **Message filters see queued messages only**: sent messages (`WM_CONTEXTMENU`, `WM_SETFOCUS`) and native modal loops bypass them (section 7.6). To keep a control's `ContextMenuStrip` closed after a long-press, cancel its `Opening` event while the press or swallow runs.
- **Enter is a dialog key**: without `IsInputKey`, the form's `AcceptButton` takes it from a focused term (section 4.4).
- **Names**: `Keys` (section 1).
- **Device pixels everywhere**: fonts, paddings and the placement need the DPI factor (section 6); keep DeepTip's own fonts in `GraphicsUnit.Pixel`, sized for `DeviceDpi`, and re-create them on DPI changes (section 4.3).
- **`Application.Idle` fires constantly**: compare before writing (section 6).
- **Child controls cannot be translucent**: no shadow, no fade, no anti-aliased corners (section 4.1); owned forms can, with the focus trade-off of section 2.
- **The app's `ToolTip` component** opens over the window: clear the control's tooltip text while its window is open (section 2).
- **Testing with hidden forms**: adding a control to a form that was never shown does not create its window handle, and hit tests by `GetChildAtPoint` miss controls without one: read `Handle` of new controls in tests *(checked)*. `DrawToBitmap` of a form draws the non-client frame and nested children in reverse z-order *(checked: the window view was covered by the panel below it)*; render each window view by itself.

## 12. Testing

### 12.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

The pure parts have no WinForms types; test them in a plain `net8.0` test project as the [Avalonia guide, section 10.1](../avalonia/README.md#101-parity-cases-11) shows. *(checked: 24 of 24 cases on .NET 8 and .NET 10, C# 9.)*

### 12.2 Behaviour, headless

No form has to be shown *(checked; the probe of this guide does it)*:

```csharp
var form = new Form { ClientSize = new Size(900, 600) };
// … add the app's controls and the DeepTip host …
IntPtr handle = form.Handle;                                     // creates the window without showing it
foreach (Control c in Everything(form)) _ = c.Handle;            // child handles too
PostMessage(textBox.Handle, 0x0100 /* WM_KEYDOWN */, (IntPtr)0x1B /* Esc */, (IntPtr)0x00010001);
Application.DoEvents();                                          // runs the message loop: filters, ProcessCmdKey, KeyDown
AccessibleObject term = termView.AccessibilityObject.GetChild(0)!;
using var bmp = new Bitmap(view.Width, view.Height);
view.DrawToBitmap(bmp, new Rectangle(Point.Empty, view.Size));  // look at it
```

Run on an STA thread with `Application.SetHighDpiMode` before the first form. UI Automation clients must run on another thread while the UI thread pumps (`Application.DoEvents` in a loop), or they deadlock. Hover, grace, tendency and suppression need no real mouse: make the clock injectable and call the host's move handler with positions. Touch needs a device.

### 12.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions.

## 13. The example to build

The same screen as `frameworks/web/example`: a form with a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with delay 0, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`, anchored to the corners) for placement at the edges, a page text with terms (`DeepTipText`), settings (delay, lock, buttons, hints) and the encyclopedia (`DeepTipIndex`). Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

```csharp
deepTip.SetKey(realmButton, "demo.realm");
deepTip.SetKey(helpButton, "deeptip.about");
deepTip.SetDelay(helpButton, 0);
deepTip.SetKey(revoltButton, "demo.revolt");
deepTip.SetPlace(revoltButton, "top,right");
```

## 14. Limitations compared with the web reference

- **Windows stay inside the form** and have no shadow or fade (child controls); owned forms lift that at the cost of keyboard focus (section 2).
- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): no WinForms API. Poll XInput (`XInputGetState` from `xinput1_4.dll`) or `Windows.Gaming.Input.Gamepad` (target framework `net8.0-windows10.0.19041.0`) in a `Timer` while the form is active.
- **Vibration** on long-press: no API.
- **Touch**: long-press, the swallowed click, tap outside and swipe need a device to verify (section 7.4).
- **Rich text** is owner-drawn: no text selection, and complex scripts (right-to-left, combining marks across words) need more than the greedy word layout of section 4.3.

## 15. Checklist

1. Port `flatten`, `parseText`, `computePlacement` and pass `test/cases` (section 12.1).
2. `Glossary` with layers, chain, `$ui` labels and live values; validate the same JSON files with `tools/deeptip-check.mjs`.
3. `TermView` (layout, paint, hit test, focus, accessible children), `TipWindowView`, the message filter and `DeepTipHost` (sections 4–7); headless tests (section 12.2).
4. The example (section 13); compare with the web example by hand.
5. Then list the framework with its state in the main README.
