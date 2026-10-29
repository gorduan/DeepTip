# DeepTip with Gio (Go)

Guide: how to build [DeepTip](../../README.md), nested and pinnable explanation windows, in Go with [Gio](https://gioui.org). This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Go implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to Gio and Go.

Every Gio name below was checked against the sources of **gioui.org v0.10.3** and **gioui.org/x v0.10.3** (Go 1.24 or newer). Statements about Gio's event routing quote `io/input/router.go`, `io/input/pointer.go` and `io/input/key.go` of that version. The closest complete implementation is the Rust crate in [`frameworks/rust-egui`](../rust-egui/README.md): egui is immediate-mode like Gio, and its `src/engine.rs` (the window tree and every timer, no UI types) ports to Go almost line by line.

**Download:** `DeepTip-go-gio-1.0.0.zip` holds this guide together with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout, so every relative link works. **Status:** documented, not built in this repository.

## 1. Architecture

| Package | Contents | Depends on | Verified by |
|---|---|---|---|
| `deeptip` (core) | glossary layers and locale chain [§1], `ParseText` [§2], `ComputePlacement` [§8] | standard library | the shared parity cases [§11] |
| `deeptip` (engine) | window tree [§4], hot set, grace, tendency, suppression [§5], arming [§6], timer lock [§7], the input decisions of [§9]; time, boxes and the hover state are passed in | standard library | scenario tests with exact times |
| `giodt` | text layout with terms [§3], windows, hit areas, Gio input, focus, timers | `gioui.org`, `gioui.org/x/styledtext` | headless frames with `input.Router` (section 17) |

Keep the engine free of Gio types: anchors are comparable `any` values, boxes are float rectangles, time is milliseconds. Then every rule of [§4]–[§7] is testable without a window, as in the Rust crate.

```bash
go get gioui.org@v0.10.3 gioui.org/x@v0.10.3
```

## 2. SPEC concept → Gio primitive

| SPEC concept | Gio primitive |
|---|---|
| UI element with a key (web: `data-deeptip`) | `dt.Mark(gtx, tag, "key", w)` wraps the element's widget: it lays out `w`, then pushes `pointer.PassOp{}`, `clip.Rect{Max: dims.Size}` and `event.Op(gtx.Ops, m)` with its own state `m *markState` as tag. Pass-through: the element's own `widget.Clickable` still gets every event. `tag` is the element's focus tag (for a `widget.Clickable` the `*widget.Clickable` itself), used for F1 / `?` via `gtx.Focused(tag)`. |
| Hover on an element, a term, a window | `gtx.Event(pointer.Filter{Target: t, Kinds: pointer.Enter \| pointer.Leave \| …})`; keep one `entered` flag per tag. Gio delivers an event to every handler on the hit path: ancestors of the hit area and areas below a `pointer.PassOp`, each with the position in **its own** coordinates (`invTransform` in `pointer.go`). A window area (not pass-through) blocks the elements under it, which is exactly SPEC §3.4. |
| Term (a link in a text) | A span of `styledtext.TextStyle` (gioui.org/x/styledtext); in its span callback every line fragment of the term pushes `clip.Rect{Max: gtx.Constraints.Max}` and `event.Op(gtx.Ops, term)` with one persistent `*termState` per term. One tag in several areas is one handler: the term is one Tab stop and one hover target although it wraps. |
| Window | A recorded macro (`op.Record` … `Stop()`), measured, placed, then drawn with `op.Defer` (section 7). Deferred ops run after the whole frame, so windows are on top of the app and of each other in open order (Defer is first-in-first-out). The window's background area: `clip.Rect` of its box plus `event.Op(gtx.Ops, win)`, not pass-through. |
| Preview, pinned | A flag in the window record. Pinned: border in the accent colour, filled pin, no hint line. |
| `schedule(ms, f)` | A due time in the engine; after each frame `gtx.Execute(op.InvalidateCmd{At: due})`. Gio draws only on events, so without it no timer ever fires. |
| Time | `gtx.Now` (the frame's animation time) in milliseconds for every engine call of that frame. |
| Pointer samples for the tendency [§5] | The observer area (section 5, step 6) receives `pointer.Move` and `pointer.Drag` everywhere, in window coordinates; append `{x, y, now}` when `e.Source == pointer.Mouse`. Gio has no pen source; touch is `pointer.Touch`. |
| Click on a term | `gesture.Click` per term, or the term's own `pointer.Press`/`Release` pair; keyboard: `gtx.Event(key.FocusFilter{Target: term}, key.Filter{Focus: term, Name: key.NameReturn}, key.Filter{Focus: term, Name: key.NameSpace})`, the same filters `widget.Clickable` uses. |
| Keys | `key.Event{Name, Modifiers, State}`: `key.NameEscape`, `key.NameF6`, `key.NameF1`, `key.Name("?")`, `key.NameTab`; `key.ModShift`. |
| Consuming Esc [§9] | In Gio a key event goes to the **first** `gtx.Event` call of the frame whose `key.Filter` matches (it is then deleted from the queue, `router.go`). So `dt.Frame` asks for Esc and F6 **before** it lays out the application, and only while windows are open, otherwise it would steal Esc from the app. |
| Tab between terms | Automatic: Tab / Shift+Tab are `input.SystemEvent`s; when no filter names them, the window moves focus between handlers registered with `key.FocusFilter`, in registration order. |
| Focus into a window | `gtx.Execute(key.FocusCmd{Tag: firstTerm})`; back to an element: `key.FocusCmd{Tag: elementTag}`. The focused DeepTip window: the window whose term or button tag satisfies `gtx.Focused(tag)`. |
| Long-press (touch) | Own timer from `pointer.Press` with `Source == pointer.Touch` on the mark area; cancel on `Release`, `Cancel` or a move beyond `MOVE_TOL`. When it fires: `gtx.Execute(pointer.GrabCmd{Tag: m, ID: e.PointerID})` — every other handler of that pointer gets `pointer.Cancel`, so the element's `widget.Clickable` reports no click (SPEC: no click after a long-press). Vibration on Android: `gioui.org/x/haptic` (`haptic.NewBuzzer(w)`, `Buzz()`). |
| Gamepad | Gio has no gamepad input. Offer the actions of [§9.4] as methods (section 14) for a host that reads a gamepad itself. |
| `data-dt-open`, `data-dt-arming` | `dt.IsOpen(tag)`, `dt.Arming(tag) (progress float32, ok bool)`; the HUD draws a 2 dp bar under the button while arming. |
| Accessibility (SPEC §6) | `semantic.LabelOp`, `semantic.DescriptionOp`, `semantic.ClassOp(semantic.Button)` for terms and window buttons, `semantic.SelectedOp(pinned)` for the pin. Gio has no tooltip or dialog class and no relation like `aria-describedby`; give the element a `semantic.DescriptionOp` with the entry's `short` instead. |
| Encyclopedia [§12] | `dt.Index(gtx, &state)`: a `widget.Editor` for the search and a `widget.List` of rows rendered with page terms. |

## 3. Data structures

```go
package deeptip

type WinID uint64 // 0 = none

// Anchors are compared with ==, so every anchor value must be comparable.
type TermAnchor struct { // a term inside a window
	Win WinID
	Key string
	N   int // occurrence of Key in that window's text (0 = first): survives a language switch [§4.6]
}
type PageAnchor struct { // a term on a page (Text, Index)
	Text any // the persistent state of that text
	N    int // ordinal of the term in the text
}
// An element's anchor is its *markState (any pointer is comparable).

type Rect struct{ Left, Top, Right, Bottom float64 } // window pixels, y down

type Entry struct {
	Title, Short, Body *string // nil = absent (only string values count)
	Aliases, See       []string
}

type Window struct {
	ID       WinID
	Key      string
	Parent   WinID
	Anchor   any
	Via      Via // Hover, Click, Key, Touch, Pad, API
	Pinned   bool
	Children []WinID // oldest first
	Rect     *Rect   // last laid-out box (tendency)
	AnchorRect *Rect // a root's anchor box as last seen
	Frozen   bool
	flashAt  float64
	leaving  *struct{ since, checkAt float64 } // the grace timer of [§5]
}

type Hover struct {
	Win  WinID
	Link *struct{ Anchor any; Key string; Parent WinID }
	Trig *struct{ Anchor any; Key string; Delay *float64 }
}

type Engine struct {
	Options Options // SPEC §7 names: Delay, LinkDelay, CloseDelay, LockAfter, LongPress, CloseButtons, PinButton,
	                // Hints, ClickInsidePins, OutsideClickCloses ("never"|"touch"|"always"), Root, Child, Gap
	wins    []*Window // oldest first
	hover   Hover
	hot     map[WinID]bool
	pending *pending  // the armed element or term [§6]
	quiet   any       // hushed element
	samples []sample  // pointer history [§5]
	lock    *struct{ win WinID; since float64 }
	events  []Event   // Opened, Closed, Pinned, Unpinned
}

func (e *Engine) Tick(now float64) (next float64, ok bool) // run every due timer in time order, return the next due time
```

Compare `Hover` values field by field (it contains pointers to small structs; compare their contents). `SetHover` returns at once when nothing changed: in an immediate-mode toolkit the hover is recomputed every frame, but [§6] reacts only to changes (an element whose window was closed with Esc must not reopen while the pointer rests on it).

The Gio layer keeps per-frame and per-tag state:

```go
package giodt

type markState struct { // tag of an element's area
	key      string
	focusTag event.Tag   // the element's own focus tag (F1, ?)
	opts     MarkOptions // Delay *float64, Place []deeptip.Side, TextInput bool
	size     image.Point
	origin   image.Point // the element's top-left corner in window pixels, section 8
	known    bool        // origin was measured at least once
	entered  bool
	seen     uint64      // frame number of the last Mark call
	press    *longPress
}

type termState struct { // tag of a term's areas
	anchor  any
	key     string
	parent  deeptip.WinID
	entered bool
	click   gesture.Click
}
```

## 4. Look (from `frameworks/web/deeptip.css`)

| Part | Value |
|---|---|
| Window | width between 240 and 384 dp (`--dt-min-width` 15rem, `--dt-max-width` 24rem), max height 480 dp (body scrolls), border 1 dp, radius 8 dp, shadow `0 10px 30px rgb(0 0 0 / .3)`, text 14 sp, line height 1.5 |
| Colours light / dark | background `#ffffff` / `#1b1e24`, text `#1f2328` / `#e6e8ec`, border `#c8cdd5` / `#3b414d`, accent and pinned border `#0b69d4` / `#58a6ff`, term `#0b69d4` / `#6cb6ff`, term hover `#084f9f` / `#9ccfff`, button hover `rgb(0 0 0 / .07)` / `rgb(255 255 255 / .09)`, missing `#d33` |
| Title bar | padding 6 dp 6 dp 2 dp 12 dp; title weight 650 (`font.SemiBold`); badge 0.7 em with a 1 dp border; pin and close 26 dp (40 dp for touch), icons 15 dp |
| Body | padding 0 12 dp 10 dp; paragraph gap 0.5 em; list indent 1.2 em; code `Go Mono, monospace` at 0.92 em; values weight 600 |
| See also, hint | see also 0.9 em with label at 60 % alpha; hint 0.75 em at 60 % alpha with a 1 dp top border, hidden when pinned and on touch screens |
| Terms | link colour, dotted underline (a 1 dp line of short dashes under the fragment), solid when hovered, open term with a 16 % tint of its colour behind it |
| Lock bar, flash | 2 dp accent bar along the bottom edge growing over `LockAfter`; flash = 3 dp accent outline, strongest at 30 % of 600 ms, static outline when reduced motion |

Gio's Go fonts (`gofont.Collection()`) have regular, italic, bold, bold italic and mono faces, so `**bold**` and `*italic*` map to real faces: `font.Font{Weight: font.Bold}`, `font.Font{Style: font.Italic}`, code `font.Font{Typeface: "Go Mono, monospace"}`. System fonts are on by default (`text.NewShaper` without `text.NoSystemFonts()`), which covers arrows and symbols the Go fonts lack.

## 5. Order of operations per frame

`dt.Frame(gtx, app)` wraps the whole window content:

```go
for {
	switch e := w.Event().(type) {
	case app.DestroyEvent:
		return e.Err
	case app.FrameEvent:
		gtx := app.NewContext(&ops, e)
		dt.Frame(gtx, appLayout) // DeepTip first and last in the frame
		e.Frame(gtx.Ops)
	}
}
```

Inside `Frame`, with `now = gtx.Now` in milliseconds:

1. **Keys** (before the app, because the first matching `gtx.Event` wins): if windows are open, drain `key.Filter{Name: key.NameEscape, Optional: key.ModShift}` and `key.Filter{Name: key.NameF6, Optional: key.ModShift}`. Esc press with Shift → close all, focus to the root's anchor; Esc press without Shift and not already down → close `newest(focused window)` with focus back, remember `escDownAt`; Esc release → forget it. F6 → `cycle`. Then for every mark of the previous frame whose `focusTag` is focused and every focused term: `key.Filter{Focus: tag, Name: key.NameF1}` and `key.Filter{Focus: tag, Name: "?", Optional: key.ModShift}` (on many layouts `?` is a shifted key, and a filter rejects modifiers that are neither required nor optional). A term: `Follow(term, its window, focus)`; an element: `OpenPinned(element, focus, via Key)`.
2. **Observer events** (the full-window pass-through area of step 6, from the previous frame): `pointer.Move` / `Drag` → samples and `globalAt[e.Time] = e.Position` (for section 8); `Press` → remember whether it hit a window (any window tag entered) and the element under it, then `PointerDown(inWindow, element, touch)` [§9.2]; a touch press on a title bar starts a swipe, its `Release` with dy > 60 and |dx| < 60 closes all; `Leave` / `Cancel` → the pointer left the window: hover = {}.
3. **The application**: `dims := app(gtx)`. Each `Mark` drains its area's events (Enter / Leave / Move / Press / Release / Cancel): `entered`, the origin from `globalAt[e.Time] − e.Position`, a mouse `Press` → `Hush(m)`, a touch `Press` → long-press timer. Each `Text` lays out page terms and drains their events.
4. **Windows**, oldest first (section 7): build the content from the glossary [§3], record it, measure, place, defer. Inside, every term and window button drains its events: term `Enter`/`Leave`, term clicks (pointer or Return/Space), pin and close clicks, a click on the window background.
5. **Vanished anchors** [§4.5]: an element whose `seen` is not this frame, a term not drawn this frame → `RetainAnchors`: previews close, pinned roots freeze.
6. **Observer area**: record `pointer.PassOp{}`, `clip.Rect{Max: gtx.Constraints.Max}`, `event.Op(gtx.Ops, &dt.observer)` and `op.Defer` it after the windows, so it is the top-most area and passes every event on.
7. **Hover** [§6]: `win` = the newest window whose tag is entered; `link` = an entered term (its window must be open); `trig` = an entered element when there is neither. Skip while the last pointer source was touch. `SetHover(hover, now)` (no-op when unchanged).
8. **Clicks** [§9.1]: close button → `Close` with focus back; pin button → toggle; term → `Follow(term, window, focus = it came from Return/Space)`; window background → `ClickInside`. Page terms the same with parent 0.
9. **Long-press** fired → `OpenPinned(element, focus = false, via Touch)` plus the `GrabCmd` of section 2.
10. **Esc held**: `escDownAt` set and `now − escDownAt ≥ 600` → close all with focus back (needs key release events, which Gio delivers on macOS, Linux, Windows and the web; elsewhere Shift+Esc is the way).
11. **Focus**: a window opened by keyboard or gamepad gets `key.FocusCmd` on its first term (else its pin button) once it has been drawn.
12. **Timers**: `next, ok := engine.Tick(now)`; if `ok`, `gtx.Execute(op.InvalidateCmd{At: next})`; while a lock bar, a flash or an arming bar is visible, `gtx.Execute(op.InvalidateCmd{})` for the next frame.
13. Emit the engine's events to the host (`onOpen`, `onClose`, `onPin`).

## 6. Text: markup → styled spans with terms [§3]

One paragraph (`p`) or one list item is one `styledtext.TextStyle`:

```go
spans := []styledtext.SpanStyle{}
for _, r := range deeptip.Runs(inlines) { // flatten the AST: text, code, var, link, break with bold/italic flags
	s := styledtext.SpanStyle{Size: unit.Sp(14), Color: fg, Font: font.Font{}}
	if r.Bold { s.Font.Weight = font.Bold }
	if r.Italic { s.Font.Style = font.Italic }
	switch r.Kind {
	case deeptip.RunText:  s.Content = r.Text
	case deeptip.RunBreak: s.Content = "\n" // styledtext ends the line after a span ending in "\n"
	case deeptip.RunCode:  s.Content, s.Font.Typeface = r.Text, "Go Mono, monospace"
	case deeptip.RunVar:   s.Content, s.Font.Weight = valueOf(r.Name), font.SemiBold
	case deeptip.RunLink:  s.Content, s.Color = labelOf(r), linkColor // or bold text for the window's own key, dimmed for a missing key [§3]
	}
	spans = append(spans, s)
}
styledtext.Text(shaper, spans...).Layout(gtx, func(gtx layout.Context, i int, dims layout.Dimensions) {
	t := termOfSpan[i] // nil for non-terms
	if t == nil {
		return
	}
	// called once per line fragment of span i, already offset to it; Constraints.Max = fragment size
	defer clip.Rect{Max: gtx.Constraints.Max}.Push(gtx.Ops).Pop()
	pointer.CursorPointer.Add(gtx.Ops)
	semantic.ClassOp(semantic.Button).Add(gtx.Ops)
	event.Op(gtx.Ops, t)
	t.click.Add(gtx.Ops)
	drawUnderline(gtx, t) // dotted, solid when hovered or open; focus outline when gtx.Focused(t)
})
```

- `styledtext` calls the span callback **after** drawing the span's glyphs, so paint only things that may lie on top (underline, focus outline, a translucent open-tint).
- Blocks: `layout.Flex{Axis: layout.Vertical}` with 0.5 em between blocks; a list item is `layout.Flex{Axis: layout.Horizontal}` with a rigid `•` and a flexed paragraph.
- Term anchors: inside a window `TermAnchor{Win, Key, N}` with `N` counted per key in reading order (body, then "See also"); on a page `PageAnchor{&textState, ordinal}`. Keep the `*termState` per anchor in a map that you sweep each frame (drop states not drawn).
- Plain text needs no escaping: glossary text is data, never Gio markup.
- `gioui.org/x/richtext` looks tempting (interactive spans with hover, click, long-press events), but its spans cannot take keyboard focus, and `TextStyle.Layout` drains all span events itself; DeepTip needs its own areas, so use `styledtext` directly.

## 7. Windows: record, measure, place, defer [§8]

For each window, oldest first:

```go
macro := op.Record(gtx.Ops)
cgtx := gtx
cgtx.Constraints = layout.Constraints{
	Min: image.Pt(gtx.Dp(240), 0),
	Max: image.Pt(min(gtx.Dp(384), maxW), min(gtx.Dp(480), maxH)), // maxW/maxH from the previous placement, else the look
}
dims := layoutWindow(cgtx, w) // frame, title bar, body (widget.List when it must scroll), see also, hint, lock bar
call := macro.Stop()

target := parentBox(w)         // children: the parent's box from this frame
if w.Parent == 0 {
	target = anchorBox(w)       // roots: the element's box in window pixels (section 8)
}
p := deeptip.ComputePlacement(sizeOf(dims), target, sides(w), viewport, float64(gtx.Dp(8)))
// if p.MaxW or p.MaxH is set: lay out again with that limit and place again with []Side{p.Side} [§8 step 3]

m := op.Record(gtx.Ops)
op.Offset(image.Pt(int(p.X), int(p.Y))).Add(gtx.Ops)
area := clip.Rect{Max: dims.Size}.Push(gtx.Ops)
event.Op(gtx.Ops, w) // the window's own area: hover and background clicks; not pass-through
area.Pop()
call.Add(gtx.Ops)    // the content with its term areas, on top of the window area
op.Defer(gtx.Ops, m.Stop())
engine.SetRect(w.ID, rectOf(p, dims))
```

- Measuring and drawing happen in the same frame (record, then replay), so Gio needs no invisible first frame.
- `op.Defer` saves the transformation, but `dt.Frame` defers at the top level, so `(p.X, p.Y)` are window pixels.
- The viewport for `ComputePlacement` is `gtx.Constraints.Max` at the top of `Frame` (the window size minus the insets `app.NewContext` already applied).
- A frozen root keeps its last position; everything else is placed again every frame, so a window follows its anchor when the layout moves.

## 8. Anchor boxes in window coordinates

Gio has no API that tells a widget where it is in the window: transformations live inside the op stack, and the router's per-area transforms are private. The one exact source is an event that two handlers receive: the observer area (window coordinates) and the element's mark area (local coordinates) get the **same** pointer event, with the same `pointer.Event.Time`, each converted into its own coordinates. So:

```go
// step 2, observer events:   dt.globalAt[e.Time] = e.Position
// step 3, inside Mark:        if g, ok := dt.globalAt[e.Time]; ok { m.origin = (g - e.Position).Round(); m.known = true }
```

The anchor box is `origin + size`. Hover, touch and click open a root only after the pointer touched the element, so its box is always known then. A root opened by F1, `?`, gamepad or code for an element the pointer never touched: place it below the element's last known box, or, if none is known, in the middle of the viewport, and offer `dt.SetOrigin(tag, image.Point)` for hosts that know the position (a fixed HUD). After scrolling, a root window keeps its place until the pointer touches its element again. Do not use `op.Affine` scaling around marked widgets; the subtraction assumes pure translations.

## 9. Input details [§9]

- **Filters are per frame.** The router queues a key event only if some filter of the previous frame matched it (`processEvent`), so ask for every key you handle in every frame you may need it.
- **Hover** comes from `pointer.Enter`/`pointer.Leave` per tag; include `pointer.Cancel` and treat it like `Leave`. A touch delivers `Enter` with the press: ignore hover changes while `Source == pointer.Touch` [§6].
- **Outside presses**: the observer sees every press; it hit a window when a window tag is entered at that moment (or test the position against the boxes of this frame).
- **Hush** [§6]: a mouse `Press` on a mark area. Typing: Gio's edit events go to the focused editor only; for a marked `widget.Editor` set `MarkOptions.TextInput` and hush it while `gtx.Focused(editor)`.
- **Clicks that end a long-press** are cancelled by the `pointer.GrabCmd` (section 2).
- **Esc** must not reach the app when it closed a window: DeepTip asks first in the frame (step 1); an app that asks for Esc later sees nothing.
- **Gamepad** [§9.4]: methods `OpenFocused`, `Activate`, `CloseNewest`, `CloseAll`, `Cycle(±1)`, `Step(±1)`; `Step` moves `key.FocusCmd` through the window's terms, then its buttons, wrapping.

## 10. Timers and animation

All timers live in the engine as due times ([§5]–[§7]); Gio wakes the window with `op.InvalidateCmd{At: due}` (`At` zero = at once). Animations (flash, lock bar, fade-in, the arming bar) read `gtx.Now` and request the next frame while running. Respect reduced motion with an option (Gio reports no system preference).

## 11. Loading the JSON in file order [§1]

`encoding/json` into `map[string]any` loses the key order, but [§1] and the glossary cases need file order. Decode with the token API:

```go
type Member struct {
	Key   string
	Value any
}
type Object []Member // a JSON object in file order

func decode(dec *json.Decoder) (any, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := Object{}
			for dec.More() {
				k, err := dec.Token()
				if err != nil {
					return nil, err
				}
				v, err := decode(dec)
				if err != nil {
					return nil, err
				}
				obj = append(obj, Member{k.(string), v})
			}
			_, err = dec.Token() // '}'
			return obj, err
		case '[':
			arr := []any{}
			for dec.More() {
				v, err := decode(dec)
				if err != nil {
					return nil, err
				}
				arr = append(arr, v)
			}
			_, err = dec.Token() // ']'
			return arr, err
		}
	}
	return tok, nil // string, float64, bool or nil
}
```

A key that occurs twice keeps its first position and its last value (what JavaScript's `JSON.parse` does); handle that when flattening. Locale of a file: `$locale`, else the file name (`de.json`, `myapp.de.json`), else the caller's argument. Sources are file templates with `{locale}`; load them with `os.ReadFile` (or `embed.FS` for shipped glossaries) in template order = layer order.

## 12. Porting the parser and placement to Go [§2] [§8]

- Index runes, not bytes: `s := []rune(src)`. All markup characters are ASCII, so rune positions give the same results as JavaScript's UTF-16 positions.
- JavaScript's `\s` is not Go's: write `isJSSpace(r rune)` for `\t \n \v \f \r`, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. `unicode.IsSpace` adds U+0085 and lacks U+FEFF; `strings.TrimSpace` uses it, so trim with `strings.TrimFunc(s, isJSSpace)`.
- RE2's `\s` is ASCII only. `regexp.MustCompile("\n[ \t]*\n").Split(src, -1)` does split paragraphs like JavaScript; write the bullet test `^\s*[-•]\s+(.*)$` by hand with `isJSSpace` (a line containing U+2028 or U+2029 after the bullet's spaces is no bullet, because `.` does not match them).
- Normalise `\r\n` and lone `\r` to `\n` first.
- `[[`: the first `]]` after it; key = trimmed text before `|`; `text` = trimmed rest or nil. Emphasis depth limit 3; closing marks need a non-space before them and a non-empty content; `findClose` skips escapes, code, links and (for `*`) whole `**…**` [§2].
- `{name}` is looked for within 64 characters of the `{`.
- Placement: `math.Min`/`math.Max` propagate NaN like JavaScript; keep the expression order `a.Top + ah/2 - h/2` so the cases match exactly (17.5 in `placement.json`).

## 13. API to offer

| Call | Does |
|---|---|
| `giodt.New(shaper, locale, fallback)` | the controller |
| `SetSources(templates...)`, `Add(locale, json)`, `SetLocale(locale)` | glossary layers [§1] |
| `SetValue(name, value)`, `SetValueFunc(func(name, key string) (string, bool))` | live values |
| `Frame(gtx, w)` | wraps the window content: keys first, windows and timers last (section 5) |
| `Mark(gtx, tag, key, w, opts...)` | an element with an explanation; `MarkOptions{Delay, Place, TextInput}` |
| `Text(gtx, state, markup)` | markup with live terms on a page |
| `Index(gtx, state)` | the encyclopedia [§12] |
| `Open(tag, key, pinned)`, `Close(id)`, `CloseAll()`, `Pin(id)`, `Unpin(id)` | windows from code |
| `IsOpen(tag)`, `Arming(tag)` | hooks for the host's own look |
| `Events()` | opened, closed, pinned, unpinned since the last frame |
| `OpenFocused()`, `Activate()`, `CloseNewest()`, `CloseAll()`, `Cycle(step)`, `Step(step)` | gamepad and other devices |
| `Options` (SPEC §7), `Look` (section 4) | behaviour and look |

## 14. Minimal use

```go
func run(w *app.Window) error {
	th := material.NewTheme()
	dt := giodt.New(th.Shaper, "en", []string{"en"})
	dt.SetSources("glossary/core/{locale}.json", "deeptip/{locale}.json")
	var ops op.Ops
	var cart widget.Clickable
	var intro giodt.TextState
	for {
		switch e := w.Event().(type) {
		case app.DestroyEvent:
			return e.Err
		case app.FrameEvent:
			gtx := app.NewContext(&ops, e)
			dt.Frame(gtx, func(gtx layout.Context) layout.Dimensions {
				return layout.Flex{Axis: layout.Vertical}.Layout(gtx,
					layout.Rigid(func(gtx layout.Context) layout.Dimensions {
						return dt.Mark(gtx, &cart, "shop.cart", material.Button(th, &cart, "Cart").Layout)
					}),
					layout.Rigid(func(gtx layout.Context) layout.Dimensions {
						return dt.Text(gtx, &intro, "Your items wait in the [[shop.cart]].")
					}),
				)
			})
			e.Frame(gtx.Ops)
		}
	}
}

func main() {
	go func() {
		w := new(app.Window)
		w.Option(app.Title("Shop"), app.Size(unit.Dp(900), unit.Dp(600)))
		if err := run(w); err != nil {
			log.Fatal(err)
		}
		os.Exit(0)
	}()
	app.Main()
}
```

## 15. The example to build

`example/` (`go run ./example`): the HUD every framework shows. A top bar with buttons marked `demo.realm`, `demo.stability` (a click cycles −3…+3, shown live through `{stability}`), `demo.taxes` (a click cycles the tax level and adds gold), `demo.nobles`, `demo.gold` (`{gold}`), and a help button `deeptip.about` with delay 0; four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`; the bottom ones with their own side order top first) for placement at the window edge; a language switch (German / English, fallback `["de", "en"]`: *Prestige* and *Gold* exist only in German, so English shows the badge); settings for delay, timer lock, outside click, close and pin buttons, hint line; the encyclopedia; an event log. It loads `../../glossary/core/{locale}.json` and `../../glossary/example/{locale}.json` relative to the module directory (the download zip keeps that layout). The texts of the screen itself are the web example's (`frameworks/web/example/index.html`).

## 16. Tests [§11]

- **Parity cases** (`go test ./...`): read `test/cases/markup.json`, `placement.json`, `glossary.json` relative to the test file (`runtime.Caller(0)` → `../../test/cases/`, or an environment variable). Compare the AST by converting it to the case's JSON shape (`{"t":"link","key":…,"text":null}`); compare placement numbers exactly; for the glossary cases decode `input` with the ordered decoder of section 11.
- **Engine scenarios** with exact times, no Gio: rest → open after `Delay`; one preview per parent; click pins the chain; subtree close; same key up the chain flashes; grace; tendency up to 1.5 s; suppression; timer lock; hush; outside presses; Esc and F6 targets; vanished anchors. `frameworks/rust-egui/tests/engine.rs` has all of them with times you can copy.
- **Gio frames without a window**, the way Gio tests its own widgets (`widget/button_test.go`):

```go
var r input.Router
gtx := layout.Context{Ops: new(op.Ops), Source: r.Source(), Constraints: layout.Exact(image.Pt(1000, 700))}
frame := func(t time.Time) {
	gtx.Reset()
	gtx.Now = t
	dt.Frame(gtx, hud)
	r.Frame(gtx.Ops)
}
frame(t0)
r.Queue(pointer.Event{Kind: pointer.Move, Source: pointer.Mouse, Position: f32.Pt(40, 12)})
for i := 1; i <= 60; i++ {
	frame(t0.Add(time.Duration(i) * 16 * time.Millisecond)) // the window opens after Delay
}
```

Use `text.NewShaper(text.NoSystemFonts(), text.WithCollection(gofont.Collection()))` in tests so text sizes do not depend on the machine.

## 17. Pitfalls

- Asking for Esc while no window is open steals it from the application (first asker wins).
- `key.Filter` rejects events with modifiers that are neither `Required` nor `Optional`: `?` and Shift+Esc need `Optional: key.ModShift`.
- Without `op.InvalidateCmd{At: …}` timers fire only when the mouse happens to move.
- Areas registered inside a recorded macro get the transformation that is current where the macro is **added**, so record the window content first and add it after the `op.Offset`.
- `styledtext` calls the span callback once per line fragment; never assume one call per term.
- Gio drops handler state for tags not used in a frame; a term or mark that is not laid out loses its `entered` state, which is also how vanished anchors show up.
- `widget.Clickable` keeps keyboard focus after a click; F1 then opens the focused element, which is intended.

## 18. Limitations

- No accessibility roles for tooltip / dialog and no `aria-describedby` (Gio's semantic classes are Button, CheckBox, Editor, RadioButton, Switch).
- Anchor boxes come from pointer events (section 8); roots opened by keyboard for never-touched elements are placed approximately.
- No gamepad input in Gio; no reduced-motion query.

[§1]: ../../docs/algorithms.md#1-data
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
[§10]: ../../docs/algorithms.md#10-auto-linking-aliases
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
