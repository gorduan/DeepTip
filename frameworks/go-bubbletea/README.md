# DeepTip for Go with Bubble Tea and Lip Gloss (terminal)

Guide: how to build [DeepTip](../../README.md), nested and pinnable explanation windows, in a [Bubble Tea](https://github.com/charmbracelet/bubbletea) application with [Lip Gloss](https://github.com/charmbracelet/lipgloss). In a terminal the windows are boxes composed over the application's view, terms are underlined runs of cells, the pointer is the mouse where the terminal reports it and otherwise the keyboard focus. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Go implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). The closest complete implementation for a terminal is the Rust adapter in [`frameworks/rust-ratatui`](../rust-ratatui/README.md); the Go details of the pure core (rune indexing, JavaScript whitespace, ordered JSON) are the same as in the [Gio guide](../go-gio/README.md).

Checked with **charm.land/bubbletea/v2 v2.1.1** (it requires Go 1.26), **charm.land/lipgloss/v2 v2.0.6**, **github.com/lrstanley/bubblezone/v2 v2.0.0** and **github.com/charmbracelet/x/exp/teatest/v2** (pseudo-version of 2026-10-28), with Go 1.26.0 on Windows: a prototype of both packages below and of the example passed the parity cases, engine scenarios with exact times, model tests driven through `Update` and `View`, and a `teatest` run of the real program; the Quick start below ran too. Statements marked *(checked)* were reproduced there. This guide is for Bubble Tea v2: v1 (`github.com/charmbracelet/bubbletea`) returns a string from `View()` and has one `tea.MouseMsg` and one `tea.KeyMsg` struct; adapt the input section if you stay on v1.

## Quick start

**Recognise the project:** `charm.land/bubbletea/v2` (or `github.com/charmbracelet/bubbletea`) in `go.mod`, a model with `Init`, `Update` and `View`.

1. `go get charm.land/bubbletea/v2@v2.1.1 charm.land/lipgloss/v2@v2.0.6 github.com/lrstanley/bubblezone/v2@v2.0.0` (section 1).
2. Write package `deeptip`: ordered JSON, glossary, `ParseText`, `ComputePlacement` and the engine; `go test ./deeptip` must pass the parity cases (sections 3, 11 and 14).
3. Write package `teadt`: `Mark`, `Text`, `View`, `Update`, `TickMsg` (sections 5–10, API in section 13).
4. Copy `glossary/core/<locale>.json` to `glossary/core/`; your own entries go to `deeptip/<locale>.json`.
5. Call `dt.Update` first in your `Update` and `dt.View` last in your `View`; mark each element to explain with `dt.Mark` (below).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en glossary/core/en.json deeptip/en.json`.

```go
type model struct{ dt *teadt.DeepTip }

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	used, cmd := m.dt.Update(msg) // DeepTip first
	if k, ok := msg.(tea.KeyPressMsg); ok && !used && k.String() == "q" {
		return m, tea.Quit
	}
	return m, cmd
}

func (m model) View() tea.View {
	help := m.dt.Mark("deeptip.about", "[?]", teadt.MarkOptions{Focused: true}) // F1 and ? open it too
	v := tea.NewView(m.dt.View(help)) // the windows over your view, last
	v.AltScreen = true
	v.MouseMode = tea.MouseModeAllMotion // plain pointer motion: hover
	return v
}

func main() {
	zone.NewGlobal()
	dt := teadt.New("en", "en")
	dt.Glossary.SetSources("glossary/core/{locale}.json", "deeptip/{locale}.json")
	if _, err := tea.NewProgram(model{dt}).Run(); err != nil {
		log.Fatal(err)
	}
}
```

**Done when:** `go test ./...` passes the parity cases, resting on `[?]` for 800 ms opens the *DeepTip* window below it with one empty row between, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both and `Esc` closes the newest without reaching your own key handling, `F1` opens it pinned with the focus on its first term, the validator reports 0 errors.

## 1. Architecture

| Package | Contents | Depends on | Verified by |
|---|---|---|---|
| `deeptip` | ordered JSON, glossary layers and locale chain [§1], `ParseText` [§2], `ComputePlacement` [§8], the engine: window tree, hot set, grace, tendency, suppression, arming, timer lock, the input decisions [§4]–[§9] | standard library | the shared parity cases [§11], engine scenarios with exact times |
| `teadt` | marking with zones, text layout in cells with term fragments [§3], window boxes, composition, hit-testing, Bubble Tea messages, focus, `tea.Tick` timers | `charm.land/bubbletea/v2`, `charm.land/lipgloss/v2`, `github.com/lrstanley/bubblezone/v2`, `github.com/charmbracelet/x/ansi`, `github.com/rivo/uniseg` | model tests through `Update` / `View`, `teatest` |

The engine is a port of [`frameworks/rust-egui/src/engine.rs`](../rust-egui/src/engine.rs), keeping its names: anchors are comparable `any` values, boxes are float rectangles in pixels, time is milliseconds, and `Tick(now)` returns when the next timer is due. Bubble Tea v2.1 needs Go 1.26 in `go.mod` (`go 1.26.0`); with `GOTOOLCHAIN=auto` the go command downloads that toolchain *(checked)*.

## 2. SPEC concept → Bubble Tea primitive

| SPEC concept | Bubble Tea, Lip Gloss, bubblezone |
|---|---|
| UI element with a key (web: `data-deeptip`) | `dt.Mark(key, rendered, opts...)` while building the view: it wraps the rendered element with `zone.Mark("dt:<key>:<n>", s)` (`n` counts the key in this view) and remembers the mark for this frame. `MarkOptions{Delay, Place, Focused, TextInput}`. An element that was not marked in a view has vanished [§4.5]. |
| Where an element is | bubblezone: `zone.Scan(view)` strips the markers and records each zone's cells; `zone.Get(id)` gives `StartX`, `StartY`, `EndX`, `EndY` (inclusive) and `InBounds(mouseMsg)`. |
| Window | A string DeepTip draws (frame, title in the top edge, hint in the bottom edge, section 7) and composes over the application's view as a Lip Gloss layer: `lipgloss.NewCompositor(lipgloss.NewLayer(base).Z(0), lipgloss.NewLayer(box).X(x).Y(y).Z(i+1).ID("dt-win-<id>"), …).Render()`. Later windows get higher `Z`, so the newest is on top. |
| Window under the pointer | the boxes DeepTip placed in the last `View`, newest first; or the compositor's `Hit(x, y)`, which returns the ID of the top-most layer with an ID *(checked)* |
| Preview, pinned | frame colour ANSI 7 or the accent (ANSI 12), pin `○` or `●`, the hint line only in previews |
| Term in a window | a run of styled cells; the layout knows every fragment (line, column, width), so the term under the pointer is a cell test against the window's position |
| Term on a page (web: `renderText`) | `dt.Text(id, markup, width)` returns the wrapped, styled text with every term fragment in its own zone (`dtp:<id>:<key>:<n>:<fragment>`); zones are boxes, so a term that wraps needs one zone per line |
| Hover | `tea.MouseMotionMsg` with `View.MouseMode = tea.MouseModeAllMotion` (cell motion reports movement only while a button is pressed) |
| Pointer leaves the application | `tea.BlurMsg` with `View.ReportFocus = true` |
| Click | `tea.MouseClickMsg` and `tea.MouseReleaseMsg` on the same part (`Button` is `tea.MouseLeft` / `tea.MouseRight`) |
| Long-press (touch) | none in terminals: a right click on a marked element opens it pinned |
| Keys | `tea.KeyPressMsg` / `tea.KeyReleaseMsg` (`Key().Code`: `tea.KeyEscape`, `tea.KeyF1`, `tea.KeyF6`, `tea.KeyTab`, `tea.KeyEnter`, `tea.KeySpace`; `Text == "?"`; `Mod & tea.ModShift`; `IsRepeat`) |
| Consuming Esc [§9.3] | `used, cmd := dt.Update(msg)` first in the model's `Update`; when `used`, return without handling the message yourself |
| `schedule(ms, f)` | a `teadt.TickMsg` from `tea.Tick(d, …)` for the engine's next due time (section 10) |
| Time | `dt.Now func() time.Time` (default `time.Now`), in milliseconds since DeepTip was created |
| Keyboard focus | DeepTip's own `Focus` (a term or a window button, drawn reversed); the application's focus is reported per element with `MarkOptions.Focused` |
| `data-dt-open`, `data-dt-arming` | `dt.IsOpen(key)`, `dt.Arming(key) (progress, ok)` |
| `onOpen`, `onClose`, `onPin` | `dt.Engine.TakeEvents()`: `opened`, `closed`, `pinned`, `unpinned` |
| Encyclopedia [§12] | a `textinput` for the search and one `dt.Text("index:"+key, …)` per entry (title as `**[[key]]**`, the `short` line, `*Mentioned in:* [[a]], [[b]]`) in a scrollable view; `label("empty")` when nothing matches |
| Accessibility (SPEC §6) | terminals have no accessibility tree; keyboard paths are complete |

## 3. Data structures

```go
package deeptip

type WinID uint64 // 0 = none

type TermAnchor struct { // a term inside a window: survives a language switch [§4.6]
	Win WinID
	Key string
	N   int // occurrence of Key in that window's text, reading order
}
type PageAnchor struct { // a term on a page
	Text string // the id given to Text
	Key  string
	N    int
}
// An element's anchor is its zone id "dt:<key>:<n>".

type Rect struct{ Left, Top, Right, Bottom float64 } // nominal pixels, y down (section 8)

type Window struct {
	ID       WinID
	Key      string
	Parent   WinID
	Anchor   any // comparable
	Via      string
	Pinned   bool
	Children []WinID
	Rect     *Rect // last box, for the tendency
	Frozen   bool
	flashAt  *float64
	leave    *[2]float64 // since, checkAt: the grace timer of [§5]
}

type Hover struct {
	Win  WinID
	Link *LinkHover // {Anchor any; Key string; Parent WinID}
	Trig *TrigHover // {Anchor any; Key string; Delay *float64}
}
```

Compare `Hover` values field by field: `SetHover` returns at once when nothing changed, because [§6] reacts only to changes (an element whose window was closed with Esc must not reopen while the pointer rests on it). Anchors must be comparable: `any` values holding a slice or map make `==` panic.

The Bubble Tea layer keeps, per frame:

```go
package teadt

type DeepTip struct {
	Glossary *deeptip.Glossary
	Engine   *deeptip.Engine
	Now      func() time.Time
	Values   map[string]func(key string) string // live values {name}
	Cell     [2]float64                          // nominal pixels of a cell: 8, 16
	MinW, MaxW, MaxH int                        // 30, 48, 30 cells

	marks, building map[string]mark     // zone id -> key and options: last view, view being built
	pages, pagesNext map[string]pageTerm // zone id of a page-term fragment -> anchor, key
	layouts []winLayout                 // last view: box, pin and close cells, term fragments per window
	places  map[deeptip.WinID]rect      // frozen roots keep their place
	focus   *Focus                      // nil = the application has the keyboard
	// Esc hold, tick bookkeeping, hovered term …
}
```

Keep `*DeepTip` behind a pointer in your model: Bubble Tea copies the model on every `Update`, the pointer keeps one state.

## 4. Look

| Part | Value |
|---|---|
| Window | 30–48 columns wide, at most 30 rows (and the screen minus 2·`GAP`); frame `╭─╮ │ ╰─╯`; title bold in the top edge, then the fallback badge (reversed, ` DE `), pin ` ○ ` / ` ● ` and close ` ✕ ` (3 cells each); body with one column of padding; hint in the bottom edge in ANSI 8 |
| Colours | terms ANSI 6 (cyan) underlined, ANSI 14 and bold under the pointer, bold while their window is open, reversed with the keyboard focus; missing links ANSI 1 faint; code ANSI 3; live values bold; pinned frame and timer-lock bar ANSI 12 |
| Flash | the frame reversed in the accent colour for 700 ms |
| Timer lock | the bottom edge fills with `━` from the left over `LockAfter` |

ANSI colour indexes (`lipgloss.Color("6")`) follow the user's terminal theme, light or dark.

## 5. Order of operations

`dt.Update(msg)`, first in the application's `Update`:

| Message | DeepTip does | `used` |
|---|---|---|
| `tea.WindowSizeMsg` | remember the size (the viewport) | no |
| `tea.MouseMotionMsg` | pointer sample at the cell centre in nominal pixels; hover = the newest window under the pointer and its term there, else a page-term zone, else a marked zone (`InBounds`) [§6]; `Engine.SetHover` | over a window |
| `tea.MouseClickMsg` (left) | remember the part under the pointer (close, pin, term, body, page term); outside windows: `Engine.PointerDown(false, marked zone, false)` (hush, outside click [§9.2]) and give the keyboard back to the application | on a window or a page term |
| `tea.MouseReleaseMsg` | same part as the press: close (focus back), pin toggle, `Follow` the term (pins the chain), `ClickInside`, follow the page term [§9.1] | when the press was DeepTip's |
| `tea.MouseClickMsg` (right) | follow a term; `OpenPinned` a marked element | when it did either |
| `tea.MouseWheelMsg` | scroll the window under the pointer | over a window |
| `tea.KeyPressMsg` | section 9 | when DeepTip used the key |
| `tea.KeyReleaseMsg` | the terminal reports releases; an Esc release ends a hold | no |
| `tea.BlurMsg` | empty hover | no |
| `teadt.TickMsg` | — (the tick below runs the timers) | no |

Then `Engine.Tick(now)` and the next `tea.Tick` (section 10). Return `cmd` in every case.

`dt.View(base)`, last in the application's `View`:

1. `base = zone.Scan(base)`: strip the zone markers and record the zones, before composing (markers do not survive the compositor) *(checked)*.
2. This view's marks and page terms become the current ones; reset the counters for the next view.
3. `Engine.Tick(now)`; `Engine.RetainAnchors`: marks and page terms of this view and the terms of open windows are present [§4.5].
4. For every window, oldest first (a child needs its parent's box): content [§3], layout (section 6), size, place (section 8), box string (section 7), `Engine.SetRect` in nominal pixels, a layer with `Z = i + 1`; remember the layout for the next `Update`.
5. A window opened by keyboard: the focus on its first term, else its pin button [§9.5].
6. Compose and return the string.

By the Elm rules `View` should not change state; DeepTip records the layout there because only the view knows where things are. `Update` hit-tests against the last view, the same way bubblezone's zones work.

## 6. Text: markup → lines of cells [§3]

`ParseText` gives the AST; flatten it with `Runs` (text, br, code, var, link with bold and italic) and wrap it greedily:

- Split text into grapheme clusters (`uniseg.NewGraphemes`) and measure each with `ansi.StringWidth`, the measure Lip Gloss uses. Drop control characters and zero-width graphemes. A wide grapheme (two cells, e.g. CJK) is its own word, so a line may break before and after it.
- Ordinary spaces break, a no-break space does not; a word longer than the line is split. An empty line between blocks; list items get `• ` and a hanging indent of two cells; "See also:" (in the weak style) and the `see` terms follow the body.
- Links [§3]: the window's own key is bold text, a missing key is marked and not a term, anything else is a term labelled with its own text, the target's `title` or the key. Live values come from `dt.Values`, read on every view, so no refresh is needed.
- Every term records its fragments `(line, column, width)`; a window turns them into screen cells after placing (`x + 2 + column`, `y + 1 + line`). A window term is `TermAnchor{window, key, n}`.
- Style each piece with a `lipgloss.Style` and `Render` it; never pass glossary text through anything that interprets markup.
- Page terms: `Text` writes each fragment's pieces into one string and wraps that string once with `zone.Mark`. bubblezone pairs the first and the second occurrence of a marker; marking every grapheme separately with the same id leaves a zone of one cell *(checked)*.

## 7. Windows: box, composition, hit areas

```go
func (d *DeepTip) View(base string) string {
	base = zone.Scan(base) // before composing: markers do not survive the compositor
	// … current marks and page terms, Engine.Tick, Engine.RetainAnchors …
	layers := []*lipgloss.Layer{lipgloss.NewLayer(base).Z(0)}
	boxes := map[deeptip.WinID]rect{}
	for i, w := range d.Engine.Windows() { // oldest first
		box, l := d.window(w, boxes, now) // content, layout, size, place, draw
		boxes[w.ID] = l.r
		d.layouts = append(d.layouts, l)
		d.Engine.SetRect(w.ID, pixels(l.r))
		layers = append(layers, lipgloss.NewLayer(box).X(l.r.X).Y(l.r.Y).Z(i+1).ID(fmt.Sprintf("dt-win-%d", w.ID)))
	}
	return lipgloss.NewCompositor(layers...).Render()
}
```

- The box is built line by line: `╭─` + bold ` Title ` + `─`… + badge + ` ○ ` + ` ✕ ` + `─╮`; body rows `│ ` + the styled line padded to `width − 4` + ` │`; `╰─` + the hint in the weak style + `─`… + `╯`. The pin and close cells are recorded as hit areas.
- Size: lay the body out at the widest inner width (48 − 4); the window is as wide as its widest line, the title row or the hint, clamped to 30–48 columns and the screen; height = 2 + body lines, at most `MaxH`; a longer body scrolls.
- `Compositor.Render` draws the layers sorted by `Z`. The sort is not stable, so give every layer its own `Z`.
- `compositor.Hit(x, y)` returns the top-most layer with an ID, an alternative to DeepTip's own box test *(checked)*.

## 8. Placement in cells [§8]

DeepTip's constants are pixels. Give every cell a nominal size of 8 × 16 pixels, convert cells into those pixels, run `ComputePlacement` unchanged and convert back: the gap is one column, a window shrinks into a side only with at least 15 columns or 8 rows of room, the tendency padding is 1.5 columns. The same rule as the [Ratatui adapter](../rust-ratatui/README.md#3-cells-and-placement-8):

```go
func (d *DeepTip) placeInCells(w, h int, a rect, sides []string) (side string, x, y, maxW, maxH int) {
	cw, ch := d.Cell[0], d.Cell[1]
	p := deeptip.ComputePlacement(float64(w)*cw, float64(h)*ch,
		deeptip.Rect{Left: float64(a.X) * cw, Top: float64(a.Y) * ch, Right: float64(a.X+a.W) * cw, Bottom: float64(a.Y+a.H) * ch},
		sides, float64(d.width)*cw, float64(d.height)*ch, d.Engine.Options.Gap)
	fx, fy := p.X/cw, p.Y/ch
	if p.Side == "right" { // away from the anchor on the side's axis, down on the other
		fx = math.Ceil(fx)
	} else {
		fx = math.Floor(fx)
	}
	if p.Side == "bottom" {
		fy = math.Ceil(fy)
	} else {
		fy = math.Floor(fy)
	}
	x = max(0, min(int(fx), d.width-w)) // then inside the screen
	y = max(0, min(int(fy), d.height-h))
	return p.Side, x, y, int(p.MaxW / cw), int(p.MaxH / ch)
}
```

Target box: the parent window's box for children; for roots the element's zone (`StartX … EndX`, `StartY … EndY`), a page term's fragment zones joined, or the last known box. Sides: the element's own `Place` for roots, else `Root` / `Child`. When `maxW` or `maxH` comes back, lay out again at that width or cut the height and place again with that side only. A frozen root keeps its place. A root opens one empty row below its element, a child one column beside its parent *(checked)*.

## 9. Input details [§9]

- **Esc.** A press closes `Engine.Newest(focused window)` and returns the focus to its anchor; `Shift+Esc` (`Mod & tea.ModShift`) closes all. Holding Esc 600 ms closes all: `IsRepeat` marks auto-repeat when the terminal reports it (kitty keyboard protocol, Windows console; ask with `View.KeyboardEnhancements.ReportEventTypes = true`); with release events a press while Esc is down is a repeat; elsewhere presses less than 120 ms apart are. The auto-repeat of a press DeepTip used stays `used`, also after the last window closed. Without windows Esc belongs to the application.
- **F1 and `?`.** On a focused term: follow it with the focus. Else the element marked `Focused: true` opens pinned with the focus inside (`?` not when it is `TextInput`). `?` arrives with `Text == "?"` (`String()` is `"?"`, not `"shift+/"`).
- **F6, Shift+F6:** focus the next older / newer window (`Engine.Cycle`).
- **Focus inside a window:** `Tab` / `Shift+Tab` and the arrows walk its terms, then pin and close, wrapping; `Enter` / `Space` follow the term or press the button. A mouse press on the application gives it the keyboard back.
- **Typing:** a printable key while a marked element is `Focused` hushes it [§6].
- **Without hover:** terminals that report no plain motion still have every path: `F1` / `?`, right click, clicks on terms, `Tab` + `Enter`.
- **Gamepad** [§9.4]: not available in a terminal; offer the actions (`OpenFocused`, `Activate`, `CloseNewest`, `CloseAll`, `Cycle`, `Step`) to a host that reads one.

## 10. Timers

```go
type TickMsg struct{}

func (d *DeepTip) schedule(now float64) tea.Cmd {
	at, ok := d.Engine.Tick(now)
	if _, _, arming := d.Engine.Arming(now); arming {
		at, ok = math.Min(at, now+50), true // the rest progress animates
	}
	if !ok || (d.ticking && d.tickAt <= at) {
		return nil // nothing due, or an earlier tick is on its way
	}
	d.ticking, d.tickAt = true, at
	return tea.Tick(time.Duration((at-now)*float64(time.Millisecond)), func(time.Time) tea.Msg { return TickMsg{} })
}
```

`tea.Tick` fires once: `Update` clears `ticking` on `TickMsg` and schedules again. Without it the windows open only when the next key or mouse message happens to arrive. While a flash or the lock bar runs, schedule every 50 ms.

## 11. Loading the JSON in file order [§1]

`encoding/json` into `map[string]any` loses the key order that [§1] and the glossary cases need; decode with the token API into an ordered `Object []Member` exactly as in the [Gio guide](../go-gio/README.md#11-loading-the-json-in-file-order-1) (`dec.UseNumber()` keeps numbers exact). A key that occurs twice keeps its first position and its last value. `Glossary.SetSources("glossary/core/{locale}.json", "deeptip/{locale}.json")` reads the files for every locale of the chain in template order (= layer order, core first) with `os.ReadFile`; the locale of a file is its `$locale`, else the chain locale it was read for; a missing file is reported, not fatal. `Entry(key)` takes the whole entry from the first locale of the chain that has it; `Label(name)` looks at `$ui` of the chain, then the built-in English and German labels.

## 12. Porting the parser and placement

The rules of the [Gio guide's section 12](../go-gio/README.md#12-porting-the-parser-and-placement-to-go-2-8) apply unchanged: index runes, write JavaScript's `\s` as a function (Go's `unicode.IsSpace` and RE2's `\s` differ), trim with `strings.TrimFunc`, split paragraphs with `regexp.MustCompile("\n[ \t]*\n")`, test bullets by hand, look for `{name}` within 64 characters, keep the expression order of the placement so the cases match exactly.

## 13. API to offer

| Call | Does |
|---|---|
| `teadt.New(locale, fallback...)` | the controller |
| `Glossary.SetSources(templates...)`, `Glossary.SetLocale(locale)`, `Glossary.Add(locale, obj)` | glossary layers [§1] |
| `Values[name] = func(key string) string` | live values |
| `Mark(key, rendered, MarkOptions{Delay, Place, Focused, TextInput}) string` | an element with an explanation, while building the view |
| `Text(id, markup, width) string` | markup with live terms on a page |
| `View(base) string` | composes the windows over the view; last in `View` |
| `Update(msg) (used bool, cmd tea.Cmd)` | every message, first in `Update` |
| `IsOpen(key)`, `Arming(key)` | hooks for the application's own look |
| `CurrentFocus()`, `FocusedWindow()` | DeepTip's keyboard focus |
| `Engine` (`Options`, `Windows()`, `Open`, `Close`, `CloseAll`, `Pin`, `TakeEvents()`) | the window tree [§4], SPEC §7 options |
| `Now` | the clock, replaceable in tests |

## 14. Tests [§11]

- **Parity cases** (`go test ./deeptip`): read `test/cases/markup.json`, `placement.json`, `glossary.json` (path from `DEEPTIP_CASES` or relative to the test file). Convert the AST into the case's JSON shape (`map[string]any{"t": "link", "key": …, "text": nil}`) and compare with `reflect.DeepEqual`; compare placements exactly; decode `glossary.json` with the ordered decoder.
- **Engine scenarios** with exact times, no Bubble Tea: the cases of [`frameworks/rust-egui/tests/engine.rs`](../rust-egui/tests/engine.rs).
- **The model, through `Update` and `View`** with a manual clock: no program, no goroutines but bubblezone's.

```go
x.m, _ = x.m.Update(tea.WindowSizeMsg{Width: 100, Height: 30})
send := func(msg tea.Msg) {
	x.m, _ = x.m.Update(msg)
	x.screen = strings.Split(ansi.Strip(x.m.View().Content), "\n")
	time.Sleep(3 * time.Millisecond) // bubblezone records the zones of a Scan in a goroutine
}
z := zone.Get("dt:demo.realm:0")
send(tea.MouseMotionMsg{X: z.StartX + 1, Y: z.StartY})
for i := 0; i < 70; i++ { // 1.1 s in 16 ms steps
	now = now.Add(16 * time.Millisecond) // dt.Now = func() time.Time { return now }
	send(teadt.TickMsg{})
}
// the window is open: dt.Engine.Windows(), its text in x.screen, one row of air below the button …
```

- **The real program with `teatest`**: `tm := teatest.NewTestModel(t, m, teatest.WithInitialTermSize(100, 30))`; `teatest.WaitFor(t, tm.Output(), …)` until the first view is out; `tm.Send(tea.MouseMotionMsg{…})` onto a zone; `WaitFor` the window's text in `ansi.Strip(output)` (the real `tea.Tick` opens it); `tm.Send(tea.KeyPressMsg{Code: tea.KeyEscape})`; `tm.Quit()` and check `tm.FinalModel(t)` *(checked)*.

## 15. The example to build

`cmd/hud` with the model in package `hud`: the HUD every framework shows. A top bar of buttons marked `demo.realm`, `demo.stability` (a click cycles −3…+3, shown live through `{stability}`), `demo.taxes` (a click cycles the tax level and adds gold), `demo.nobles`, `demo.gold` (`{gold}`), help `deeptip.about` with `Delay` 0 and a language switch (German / English, fallback `["de", "en"]`: *Prestige* and *Gold* exist only in German, so English shows the badge); corner buttons `demo.province`, `demo.prestige` (second row) and `demo.revolt`, `demo.unrest` (last row, `Place: []string{"top", "right", "left"}`); the intro text with page terms (`dt.Text`); an event log from `Engine.TakeEvents()`. The application's own clicks use their own zones around DeepTip's: `zone.Mark("btn:"+id, dt.Mark(key, s))` (nested markers work *(checked)*). It loads `glossary/core/{locale}.json` and `glossary/example/{locale}.json`. The texts of the screen are the web example's (`frameworks/web/example/index.html`).

## 16. Pitfalls

- **Scan before composing.** `zone.Scan` must see the application's view before Lip Gloss composes the windows over it; the markers do not survive the compositor *(checked)*.
- **Zones arrive late.** bubblezone records the zones of a `Scan` in a goroutine, so they describe the view before the current one, and a test must wait a moment after `View` *(checked)*. Root windows open after a delay, so their element's zone is known by then. bubblezone also needs the alternate screen (`View.AltScreen = true`) for positions to match the terminal.
- **One marker pair per zone.** Mark each term fragment once (section 6); zones are boxes, so a wrapped term needs one zone per line.
- **Distinct `Z`.** The compositor's sort is not stable.
- **Mouse mode.** `tea.MouseModeCellMotion` reports motion only while a button is pressed: hover needs `tea.MouseModeAllMotion`.
- **Repeats and releases** exist only with the kitty keyboard protocol or on Windows (`Key.IsRepeat`, `tea.KeyReleaseMsg`); elsewhere the Esc hold is timing (section 9). `Shift+Esc` arrives as plain Esc on terminals without the protocol.
- **`F1` is taken** by some terminals (GNOME Terminal's help, VS Code's integrated terminal); `?` works everywhere.
- **Ambiguous-width characters** (box drawing, `○ ● ✕ •`) break frames where the terminal treats them as wide (CJK setups); offer ASCII glyphs. Inside tmux a lone Esc waits for `escape-time`.
- **The model is copied.** Keep `*DeepTip` behind a pointer; a value field loses its state between `Update` and `View`.
- **Ticks.** Without the `tea.Tick` of section 10 timers fire only on the next message; schedule only when the due time moved earlier, or ticks pile up.

## 17. Limitations

- No hover where the terminal reports no plain motion; no touch, long-press, swipe, vibration or gamepad.
- No accessibility roles; the flash is a reversed frame; no reduced-motion query.
- Element positions come from the previous view (bubblezone), anchors that vanish are noticed at the next view.
- Positions are whole cells: the vertical gap is a full row.

## 18. Checklist

- [ ] Resting on a marked element opens its window after `Delay`, beside it with one cell of air; the element's own click still works and hushes it.
- [ ] Hovering a term opens a child beside its parent window, never on top; a click pins it with its chain.
- [ ] Moving into a window keeps it open; terms crossed on the way do not open; leaving closes it after the grace time.
- [ ] `Esc` closes the newest window and does not reach the application; `Shift+Esc` or holding `Esc` closes all; pin and close work; the focus returns to the anchor.
- [ ] `F1` or `?` opens the focused element's window pinned with the focus inside; `Tab` and `Enter` follow terms; `F6` switches windows.
- [ ] A key already open further up the chain flashes; a missing key shows the key and `$ui.missing`.
- [ ] An entry from a fallback locale shows the badge; switching the language changes open windows on the next view.
- [ ] A long entry scrolls and stays on screen; `go test ./...` and the validator pass.

[§1]: ../../docs/algorithms.md#1-data
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§4.5]: ../../docs/algorithms.md#45-anchors-that-disappear
[§4.6]: ../../docs/algorithms.md#46-refresh
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.1]: ../../docs/algorithms.md#91-clicks
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
