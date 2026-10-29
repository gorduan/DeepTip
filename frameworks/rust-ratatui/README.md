# DeepTip for Rust (Ratatui, terminal)

The terminal adapter of [DeepTip](../../README.md): nested, pinnable explanation windows drawn as boxes over a [Ratatui](https://ratatui.rs) screen. Rest the mouse on an element (or focus it and press `F1` or `?`) and a box explains it; highlighted terms in the box open further boxes beside it; a click pins them. The glossary, the markup parser, the placement and the whole window tree with its timers come from the pure core of the Rust implementation, the crate `deeptip` in [`frameworks/rust-egui`](../rust-egui/README.md), used without its egui feature. This crate adds what a terminal needs: character cells instead of pixels, terms hit-tested per cell, crossterm mouse and key events, keyboard focus inside windows. The contract is [SPEC.md](../../SPEC.md); the algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12].

Crate `deeptip-ratatui` 1.0.0, Rust 1.95 or newer (the minimum of the core), ratatui 0.30, crossterm 0.29 through `ratatui::crossterm`. Checked with ratatui 0.30.2, crossterm 0.29.0 and rustc 1.99.1 on Windows 11: `cargo test` passes 44 tests (TestBackend frames, the shared parity cases, unit tests), `cargo clippy --all-targets` reports nothing, the tests also pass from a copy in the download's folder layout, and the example ran for one second without errors (`DEEPTIP_HUD_SECONDS=1`).

## Quick start

**Recognise the project:** `ratatui` in `Cargo.toml` (usually with `crossterm`), a loop around `terminal.draw(|frame| …)`.

1. Add `deeptip-ratatui = { path = "frameworks/rust-ratatui" }` to `[dependencies]` (it needs `frameworks/rust-egui` next to it, section 1).
2. Copy `glossary/core/<locale>.json` to `glossary/core/`; your own entries go to `deeptip/<locale>.json`.
3. Turn the mouse on with `execute!(stdout(), EnableMouseCapture)` after `ratatui::init()`.
4. In every frame mark each explained element with the `Rect` it was drawn in and call `dt.render(frame)` last (section 4).
5. Give every event to `dt.handle_event(&ev)` first and skip it when that returns `true`; poll no longer than `dt.timeout()`.
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en glossary/core/en.json deeptip/en.json`.

```rust
use std::{io::stdout, time::Duration};
use deeptip_ratatui::{DeepTip, MarkOptions};
use ratatui::crossterm::event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode};
use ratatui::crossterm::execute;
use ratatui::{layout::Rect, style::Style};

fn main() -> std::io::Result<()> {
    let mut dt = DeepTip::new("en", &["en"]);
    dt.set_sources(&["glossary/core/{locale}.json", "deeptip/{locale}.json"]);
    let mut terminal = ratatui::init();
    execute!(stdout(), EnableMouseCapture)?;
    loop {
        terminal.draw(|f| {
            let help = Rect::new(2, 1, 3, 1);
            f.buffer_mut().set_string(help.x, help.y, "[?]", Style::default());
            // `focused`: the application's keyboard focus is here, so F1 and ? open it too
            dt.mark_with(help, "deeptip.about", MarkOptions { focused: true, ..MarkOptions::default() });
            dt.render(f); // the windows, after everything else
        })?;
        if event::poll(dt.timeout().unwrap_or(Duration::from_millis(500)))? {
            let ev = event::read()?;
            if dt.handle_event(&ev) {
                continue; // DeepTip used it
            }
            if matches!(ev, Event::Key(k) if k.code == KeyCode::Char('q')) {
                break;
            }
        }
    }
    execute!(stdout(), DisableMouseCapture)?;
    ratatui::restore();
    Ok(())
}
```

**Done when:** resting the mouse on `[?]` for 800 ms opens the *DeepTip* box below it, hovering *terms* in it opens *Highlighted term* one column beside it and never on top, a click pins both and `Esc` closes the newest without reaching your own key handling, `F1` or `?` opens the box pinned with the focus on its first term, `cargo test` and the validator pass.

## 1. Install

```toml
[dependencies]
deeptip-ratatui = { path = "frameworks/rust-ratatui" }
ratatui = "0.30"
```

The crate depends on the core with `deeptip = { path = "../rust-egui", default-features = false }`, so keep both folders side by side: the download `DeepTip-rust-ratatui-1.0.0.zip` contains both in the repository layout, the same as `git clone`. From GitHub: `deeptip-ratatui = { git = "https://github.com/gorduan/DeepTip" }` (Cargo finds both packages in the repository). The core is re-exported as `deeptip_ratatui::core`; use it for `Glossary`, `Engine`, `parse_text` and `compute_placement` without a second dependency.

## 2. SPEC concept → terminal primitive

| SPEC concept | Ratatui / crossterm |
|---|---|
| UI element with a key (web: `data-deeptip`) | `dt.mark(area, "key")` with the `Rect` the application drew the element in this frame; returns `MarkState { open, arming }` (web: `data-dt-open`, `data-dt-arming`). `MarkOptions`: `delay`, `place` (own side order), `focused` (the application's focus is on it), `text_input`, `id` (stable id when one key is marked several times). An element that is not marked in a frame has vanished [§4.5]. |
| Window | A box drawn into the frame's `Buffer` by `dt.render(frame)`, after the application: its cells are reset (opaque), a rounded frame, the title in the top edge, the hint line in the bottom edge. Windows are drawn oldest first, so the newest is on top. |
| Preview, pinned | Frame in `look.border` (gray) or `look.accent` (light blue); pin button `○` or `●`; the hint line only in previews. |
| Term (a link in a text) | A run of cells in `look.link` (cyan, underlined). The layout records every fragment of a term (a term that wraps has several), so the pointer is hit-tested per cell [§3]. |
| Window buttons | Three cells each in the top edge: ` ○ ` pin, ` ✕ ` close (`look.symbols`, `Symbols::ascii()` for consoles without these glyphs). |
| Pointer, hover | `MouseEventKind::Moved` and `Drag`: the terminal reports them in "any event" mouse mode, which crossterm's `EnableMouseCapture` turns on. |
| Pointer leaves the application [§6] | `Event::FocusLost` (with `EnableFocusChange`): the hover becomes empty. |
| Click | `Down(Left)` and `Up(Left)` on the same part (close, pin, term, window body, page term). |
| Long-press (touch) | Terminals have no touch: a secondary click (`Down(Right)`) on a marked element opens its window pinned, on a term it follows the term. |
| `schedule(ms, f)`, `now()` | The engine's due times; `dt.timeout()` is the longest the application may wait in `event::poll` before drawing again. The clock is `Instant` (or manual with `dt.set_time(ms)` in tests). |
| Consuming Esc [§9.3] | `dt.handle_event(&ev)` runs before the application's handling and returns `true` for every key it used. |
| Keyboard focus | DeepTip keeps its own focus on terms and window buttons (`dt.focus()`), shown reversed. The application's focus is reported per element with `MarkOptions::focused`; `F1` / `?` open that element. |
| Gamepad [§9.4] | Not read by terminals: `dt.action(Action::…)` for a host that reads one (Y `OpenFocused`, A `Activate`, B `CloseNewest`, B held `CloseAll`, LB/RB `Cycle(∓1)`, d-pad `Step(±1)`). |
| `onOpen`, `onClose`, `onPin` | `dt.take_events()`: `Opened`, `Closed`, `Pinned`, `Unpinned`. |
| Encyclopedia [§12] | `dt.index(buf, area, &mut IndexState)`: a search line and every entry with its `short` text and "Mentioned in" backlinks, all terms live; `dt.index_input(&mut state, &key)` edits the search. |
| Terms on a page (web: `renderText`) | `dt.text(buf, area, markup)` draws wrapped markup with live terms and returns the lines it needs; `dt.text_rows(width, markup)` measures first. |
| Accessibility (SPEC §6) | Terminals have no accessibility tree; screen readers read the screen text. Keyboard paths are complete (section 6). |

## 3. Cells and placement [§8]

DeepTip's constants are pixels. The adapter gives every cell a nominal size of 8 × 16 pixels (`look.cell`, about the shape of a terminal cell), converts cells into those pixels, calls the core's `compute_placement` unchanged and converts back. Every constant keeps its meaning:

| Constant | Pixels | In cells |
|---|---|---|
| `GAP` | 8 | 1 column, ½ row (rounded to 1 row towards the anchor's side, see below) |
| `MIN_SHRINK` | 120 | 15 columns, 7.5 rows |
| `MIN_W`, `MAX_W` | 240, 384 | 30 and 48 columns (`look.min_width`, `look.max_width`) |
| `MAX_H` | 480 | 30 rows (`look.max_height`); never more than the screen minus 2·`GAP` (columns − 2, rows − 1) |
| `TENDENCY_PAD` | 12 | 1.5 columns, ¾ row |
| `MIN_MOVE` | 3 | any move to another cell |

`place_in_cells(width, height, anchor, sides, viewport, cell, gap)` does the conversion: the coordinate on the side's axis is rounded away from the anchor (right and bottom up, left and top down), the other one down, then the window is clamped into the screen. A window that fits therefore keeps at least one cell of air to its anchor: a root opens one empty row below its button, a child one column beside its parent (checked over 50,000 random placements in `tests/cases.rs`). In an 80-column terminal a 48-column child does not fit beside a 48-column parent: it goes above or below, or shrinks to the room on the best side when that is at least 15 columns, exactly as [§8] says. The pointer samples of the mouse tendency [§5] and the window boxes the engine sees use the same pixels (the centre of the pointer's cell).

Placing one window, every frame (immediate mode, nothing is cached but the scroll position):

1. Target box: the parent window's box for children, the element's `Rect` (or a page term's fragments) for roots.
2. Lay the body out at the widest inner width (48 − 4 columns); the window is as wide as its widest line, the title row (title, badge, buttons) or the hint, clamped to 30–48 columns and the screen.
3. Height: 2 frame rows + the body lines, at most `MAX_H`; longer bodies scroll (wheel, `PageUp`/`PageDown`, a thumb on the right edge).
4. `place_in_cells`; when it returns `max_w` or `max_h`, lay out again at that width or cut the height, and place again with that side only.
5. A frozen root (pinned, anchor gone) keeps its last position, pushed back inside the screen.

## 4. Order of operations

Per frame, inside `terminal.draw(|f| …)`:

1. The application draws and calls `dt.mark(area, key)` for every explained element, `dt.text(…)` for texts with terms, `dt.index(…)` for the encyclopedia. They are collected for this frame; texts are drawn at once with the hover, open and focus state of the last frame.
2. `dt.render(f)` (or `render_buffer(area, buf)`):
   1. run the timers that are due (opening, grace, timer lock) [§5]–[§7];
   2. the anchor box of every root window from this frame's marks and page terms;
   3. lay out and place every window, oldest first (a child needs its parent's box) and give the engine its box in pixels;
   4. anchors that were not drawn this frame vanished [§4.5]: previews close, pinned roots freeze;
   5. draw the windows that are still open, oldest first, and keep their hit areas (buttons, term fragments) until the next frame;
   6. move the focus into a window opened by keyboard or gamepad (its first term, else its pin button) [§9.5];
   7. compute the hover again from the last pointer position (windows may have opened under it);
   8. run timers due now (delay 0); if anything changed after drawing, `timeout()` returns 0 so the application draws again at once.

Per event, `dt.handle_event(&ev)` before the application:

| Event | DeepTip does | Returns `true` |
|---|---|---|
| `Mouse(Moved \| Drag)` | pointer sample (tendency); hover = the newest window under the pointer and its term there, else a page term, else the last marked element there; `engine.set_hover` (only changes count) [§6] | over a window |
| `Mouse(Down(Left))` | remember the part under the pointer; outside windows: hush the marked element there, close all if `outside_click_closes` says so, give the keyboard back to the application [§9.2] | on a window or a page term |
| `Mouse(Up(Left))` | same part as the press: close (focus back), pin toggle, follow the term (pins the chain), pin the preview (`clickInsidePins`), follow the page term [§9.1] | when the press was DeepTip's |
| `Mouse(Down(Right))` | follow a term; open a marked element pinned | on a window or a page term, or when it opened an element (its release too) |
| `Mouse(ScrollUp \| ScrollDown)` | scroll the body of the window under the pointer | over a window |
| `Key(Esc)` | section 6 | when it closed something or belongs to such a press |
| `Key(F6)`, `Shift+F6` | focus the next older / newer window | with windows open |
| `Key(F1)`, `Key('?')` | follow the focused term, or open the focused element pinned with the focus inside (`?` not in a `text_input`) | when it opened something |
| `Tab`, `Shift+Tab`, arrows, `Enter`, `Space`, `PageUp`, `PageDown` | only while DeepTip has the focus: move it inside the window (wrapping) or along the page terms, follow the term, press the button, scroll | when used |
| printable character | hush the focused marked element (the user is typing into it) | no |
| `FocusLost` | the pointer left: empty hover | no |

After every event the due timers run, so the application only has to draw again (it usually does after every event anyway).

## 5. Text in cells [§3]

`parse_text` gives the AST of [§2]; the layout turns it into lines of cells:

- Text is split into grapheme clusters (`unicode-segmentation`) and measured with ratatui's `CellWidth`, the same measure `Buffer::set_stringn` uses. Zero-width graphemes are dropped (the buffer drops them too); a wide character (2 cells, e.g. CJK) is its own word, so a line may break before and after it.
- Ordinary spaces break lines, a no-break space does not; a word longer than the line is split. One empty line between blocks; list items get `• ` and a hanging indent; the "See also:" line follows the body in `look.weak`.
- Links follow [§3]: the window's own key is bold text, a missing key is dimmed red and not a term, anything else is a term labelled with its own text, the target's `title` or the key.
- Every term remembers `(line, column, width)` per fragment; after scrolling, the visible fragments become absolute `Rect`s for hit-testing. A term inside a window is the anchor `AnchorId::Term(window, key, n)` (`n` counts the key in reading order, so the anchor survives a language switch [§4.6]); a page term is `AnchorId::Page(hash(text, key), n)`.
- Styles (all in `Look`): terms cyan and underlined, light cyan and bold under the pointer, bold while their window is open, reversed with the keyboard focus; `**bold**` and `*italic*` as modifiers; code yellow; live values bold.

## 6. Input details [§9]

- **Esc.** A press closes the newest window opened from the focused one [§9.3]; `Shift+Esc` closes all. Holding Esc for 600 ms closes all: with `KeyEventKind::Repeat` (kitty keyboard protocol) or with release events (Windows reports auto-repeat as presses and one release at the end) the hold is exact; elsewhere presses less than 120 ms apart (`ESC_REPEAT`) count as auto-repeat, so the first repeat after the keyboard's repeat delay looks like a second press and the hold closes all about 600 ms later. The auto-repeat of a press DeepTip used is always swallowed, also after the last window closed, so it never reaches the application. Without windows Esc belongs to the application.
- **Keyboard focus.** `F6` moves the focus into the newest window (again: the next older one), `Shift+F6` the other way. Inside a window `Tab` / `Shift+Tab` and the arrows walk its terms, then its pin and close buttons, wrapping; `Enter` or `Space` follows a term or presses a button. Closing a window with the focus inside returns the focus to its anchor: a term of the parent window, or the application. A mouse press on the application also gives it the keyboard back.
- **Terms on a page.** When the application's focus reaches a text with terms, call `dt.focus_page_terms(forward)`; DeepTip then walks the page terms with `Tab` / `Shift+Tab` and returns the `Tab` unused after the last one, so the application moves on.
- **Without hover.** Terminals that report no plain pointer movement (some only report clicks and drags) still have every path: `F1` / `?` on the focused element, a right click on it, a click on a term, `Tab` + `Enter`.
- **Hush.** A mouse press on a marked element, or typing into the focused one, cancels its pending window until the pointer leaves it [§6].

## 7. Glossary, live values, locales

The core loads the glossaries: `set_sources(&["glossary/core/{locale}.json", "deeptip/{locale}.json"])` reads the files for every locale of the chain in template order, which is the layer order (core first, project after), and keeps the keys in file order (`serde_json` with `preserve_order`) [§1]. The locale of a file is its `$locale`, else its file name. `glossary.add_json(locale, text)` adds a layer from memory. `set_locale` switches the language: open windows and page texts show it on the next frame, entries from a fallback locale carry the badge (e.g. ` DE `). Live values are read every frame (`set_value(name, value)`, `set_value_fn(|name, key| …)`), so no `refresh()` is needed.

## 8. API

| Call | Does |
|---|---|
| `DeepTip::new(locale, &fallback)` | the controller: glossary, window tree, terminal rendering |
| `set_sources`, `set_locale`, `glossary.add_json`, `glossary.add_file` | glossary layers [§1] |
| `set_value(name, value)`, `set_value_fn(f)` | live values `{name}` |
| `mark(area, key) -> MarkState`, `mark_with(area, key, MarkOptions)` | an element with an explanation, every frame |
| `text(buf, area, markup) -> u16`, `text_scrolled`, `text_rows(width, markup)` | markup with live terms on a page |
| `index(buf, area, &mut IndexState)`, `index_input(&mut IndexState, &KeyEvent)` | the encyclopedia |
| `render(frame)`, `render_buffer(area, buf)` | draw the windows, finish the frame; last in every draw |
| `handle_event(&Event) -> bool` | every terminal event, before the application |
| `timeout()`, `tick()`, `now()`, `set_time(ms)` | timers, redraw timing, manual clock for tests |
| `open(key, pinned)`, `close_all()` | windows from code (`open` uses the element marked with `key` in the last frame) |
| `focus()`, `focused_window()`, `focus_page_terms(forward)` | keyboard focus |
| `action(Action)` | gamepads and other devices |
| `take_events()` | opened, closed, pinned, unpinned |
| `terms()`, `window_area(id)` | what was drawn in the last frame (tests, tutorials) |
| `engine.options` | SPEC §7: `delay` 800, `link_delay` 80, `close_delay` 300, `lock_after` 0, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `gap` 8 |
| `look` | `cell` 8 × 16, `min_width` 30, `max_width` 48, `max_height` 30, styles, `symbols`, `reduced_motion` |
| `place_in_cells(…)` | the placement in cells on its own |

## 9. Example

```bash
cd frameworks/rust-ratatui
cargo run --example hud
```

The HUD every framework shows ([`examples/hud/`](examples/hud/)): buttons marked `demo.realm`, `demo.stability` (a click cycles −3…+3, shown live through `{stability}`), `demo.taxes` (a click cycles the tax level and adds gold), `demo.nobles`, `demo.gold` (`{gold}`), help `deeptip.about` with delay 0, a language switch (German / English, fallback `["de", "en"]`: *Prestige* and *Gold* exist only in German, so English shows the ` DE ` badge), four corner buttons for placement at the screen edge (the bottom ones with their own side order top first), the intro text with page terms, settings (delay, timer lock, outside click, close and pin buttons, hint line), the encyclopedia with search and an event log. It loads `../../glossary/core/` and `../../glossary/example/`. Keys: `Tab` / `Shift+Tab` move the application's focus, `Enter` presses, `F1` or `?` explains, `Esc` closes, `F6` switches windows, `q` quits. Environment: `DEEPTIP_LANG=en|de`, `DEEPTIP_GLOSSARY=<folder>`, `DEEPTIP_HUD_SECONDS=3` (quit after 3 s). Where the terminal supports the kitty keyboard protocol the example asks for key repeat and release events.

`Realm` pinned with the keyboard focus inside, `Stability` previewed from its term (100 × 30 cells, from `cargo test --test hud -- --ignored --nocapture`):

```text
 DeepTip  [Realm] [Stability +1] [Taxes: normal╭─ Stability ──────────────────────── ○  ✕ ─╮nglish]
 [↖ Province]                                  │ High stability lowers unrest in every     │tige ↗]
 ╭─ Realm ──────────────────────────── ●  ✕ ─╮ │ province. High taxes and lost wars reduce │
 │ Your realm is made of provinces. Its      │─│ it; prestige raises it again.             │──────┐
 │ stability decides how calm it stays, your │ │                                           │s     │
 │ prestige how much you are feared.         │i│ Currently: +1                             │r     │
 ╰───────────────────────────────────────────╯ │ See also: Revolt                          │      │
 │Controls: mouse (rest, click, right-click) · ╰─ Click to pin · Esc closes ───────────────╯ts) · │
```

## 10. Tests [§11]

```bash
cargo test                       # everything
cargo test --test cases          # the shared parity cases and the placement in cells
```

| File | Checks |
|---|---|
| `src/geometry.rs`, `src/layout.rs` | unit tests: cell placement, wrapping with wide characters, term fragments, truncation |
| `tests/cases.rs` | `test/cases/markup.json`, `placement.json`, `glossary.json` against the core this crate uses; 50,000 random placements in cells: a window that fits never covers its anchor and stays on screen |
| `tests/hud.rs` | the example scene in a 100 × 30 `TestBackend` with synthetic crossterm events and a manual clock: resting opens after the delay, below the button; child previews beside their parent; a click pins the chain; Esc, Shift+Esc, holding Esc with and without repeat events; grace, mouse tendency with suppression, timer lock, click inside, hush; F1, `?` (and `?` typed into the search), Tab / Enter / F6 focus; right click; pin and close buttons; page terms; fallback badge and locale switch; live values; encyclopedia; resizing; 80 × 24 |
| `tests/bare.rs` | small glossaries of its own: missing keys, wide characters keep the frame and their terms hit, a long entry scrolls, vanished anchors, ASCII glyphs, outside clicks, gamepad actions, rest progress and `timeout()` |

The core's own suite (`cargo test` in `frameworks/rust-egui`) covers the engine with exact times. A harness for your own application looks like `tests/hud.rs`: `Terminal::new(TestBackend::new(100, 30))`, `dt.set_time(ms)`, events built as `Event::Mouse(MouseEvent { kind, column, row, modifiers })` and `Event::Key(KeyEvent::new(code, modifiers))`, then `terminal.draw(…)` and the buffer through `terminal.backend().buffer()`. Draw again while `dt.timeout()` is zero, like a real loop.

## 11. Pitfalls

- **Draw again when `timeout()` expires.** DeepTip's timers only fire inside `render` or `tick`; a loop that blocks in `event::read()` without a timeout never opens a window.
- **`render` belongs inside the same `draw` closure, after the application.** Ratatui swaps two buffers; windows drawn in another `draw` call are overwritten.
- **Mouse modes.** `EnableMouseCapture` asks for clicks, drags and plain movement with SGR coordinates. Terminals or multiplexers that do not forward plain movement (tmux needs `set -g mouse on`) give no hover; every path still works by click and keyboard. While the mouse is captured the terminal's own text selection usually needs `Shift` + drag.
- **`F1` is taken** by some terminals (GNOME Terminal's help, the command palette of VS Code's integrated terminal); `?` works everywhere.
- **Esc and Shift+Esc.** Esc also starts every escape sequence; inside tmux a lone Esc is held back for its `escape-time`, so keep that setting small. `Shift+Esc` arrives as plain Esc unless the terminal speaks the kitty keyboard protocol (`PushKeyboardEnhancementFlags(DISAMBIGUATE_ESCAPE_CODES | REPORT_EVENT_TYPES)` when `supports_keyboard_enhancement()`) or runs on Windows; pop the flags again before you exit.
- **Press and release on Windows.** crossterm reports a release for every key on Windows; ignore `KeyEventKind::Release` in your own handling or every action fires twice. DeepTip uses releases only to tell auto-repeat apart.
- **Ambiguous-width characters.** Box drawing, `○ ● ✕ • … → ·` take one cell unless the terminal treats ambiguous characters as wide (an option in CJK setups); then frames break. Use `Symbols::ascii()` or switch the option. Emoji sequences differ between terminals; keep them out of titles.
- **Restore the terminal.** `ratatui::init()` restores raw mode and the alternate screen on panic; mouse capture, focus reporting and keyboard flags you enabled yourself must be disabled before `ratatui::restore()`.
- **One key, several elements.** Two elements marked with the same key get anchors by their order in the frame; give them `MarkOptions::id` when that order can change.
- **Colours.** The defaults are the terminal's 16 named colours, so they follow its theme; `DarkGray` can be faint on some themes. Change `look` to suit.

## 12. Limitations

- No hover where the terminal does not report plain pointer movement; no touch, long-press, swipe or vibration (a right click stands in for the long-press); gamepads only through `action()`.
- No accessibility roles: terminals have none.
- No fade or slide; the flash is a blinking frame; reduced motion cannot be read from a terminal (`look.reduced_motion`).
- Positions are whole cells: the vertical gap is a full row, the reference's 8 px gap is half a row.
- The encyclopedia sorts case-insensitively and ignores common Latin accents, not a full locale collation.

## 13. Checklist

- [ ] Resting on a marked element opens its box after `delay`, beside it with one cell of air; the element's own click still works and hushes it.
- [ ] Hovering a term opens a child beside its parent box, never on top of it; a click pins it with its chain.
- [ ] Moving into a box keeps it open; terms crossed on the way do not open; leaving closes it after the grace time.
- [ ] `Esc` closes the newest box and never reaches the application; `Shift+Esc` or holding `Esc` closes all; the X and pin buttons work; the focus returns to the anchor.
- [ ] `F1` or `?` opens the focused element's box pinned with the focus inside; `Tab` and `Enter` follow terms; `F6` switches boxes.
- [ ] A key already open further up the chain flashes; a missing key shows the key and `$ui.missing`.
- [ ] An entry from a fallback locale shows the badge; switching the language changes open boxes and page texts.
- [ ] A long entry in a small terminal scrolls and stays on screen; live values update on the next frame.
- [ ] Wide characters keep the frame straight; resizing keeps every box inside the screen.
- [ ] `cargo test` passes and the validator reports 0 errors.

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
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
