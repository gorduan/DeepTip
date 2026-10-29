# DeepTip for Rust (egui)

The Rust implementation of [DeepTip](../../README.md): nested, pinnable explanation windows for [egui](https://github.com/emilk/egui) 0.37, with a pure core (glossary, markup parser, placement, window tree) that works without any UI.

The second complete implementation next to the web reference. It follows [SPEC.md](../../SPEC.md) and the step-by-step algorithms in [docs/algorithms.md](../../docs/algorithms.md) ([§1]–[§12]), and passes the shared parity cases in `test/cases/`.

Requires Rust 1.95 or newer (the minimum of egui 0.37). Crate name: `deeptip`, version 1.0.0.

## 1. Install

Download `DeepTip-rust-egui-1.0.0.zip` from the releases, or copy the folder `frameworks/rust-egui/` into your workspace, and add it as a path dependency:

```toml
[dependencies]
deeptip = { path = "frameworks/rust-egui" }
egui = "0.37"
```

Or straight from GitHub (Cargo finds the package `deeptip` in the repository):

```toml
[dependencies]
deeptip = { git = "https://github.com/gorduan/DeepTip", tag = "v1.0.0" }
```

Only the core (no egui): `deeptip = { path = "…", default-features = false }`.

The zip mirrors the repository layout (`frameworks/rust-egui/`, `glossary/`, `test/cases/`, `SPEC.md`, `docs/`), so the example and the tests find the shared files through `../../`.

## 2. Write the glossary

One JSON file per language, the same files every DeepTip runtime uses ([SPEC §2](../../SPEC.md)), e.g. `deeptip/en.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "shop.cart": {
    "title": "Cart",
    "short": "Items you are about to order.",
    "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**.",
    "see": ["shop.wishlist"]
  }
}
```

Validate it with `node tools/deeptip-check.mjs` (see the [main README](../../README.md)).

## 3. Minimal code (eframe)

```rust
use deeptip::DeepTip;
use eframe::egui;

struct App {
    dt: DeepTip,
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.dt.handle_keys(ui.ctx()); // optional: Esc / F6 reach DeepTip before your widgets
        egui::CentralPanel::default().show(ui, |ui| {
            let cart = ui.button("Cart");
            self.dt.mark(&cart, "shop.cart"); // rest on the button → its explanation
            self.dt.text(ui, "Your items wait in the [[shop.cart]]."); // terms on a page
        });
        self.dt.show(ui.ctx()); // once per frame, after your UI
    }
}

fn main() -> eframe::Result {
    let mut dt = DeepTip::new("en", &["en"]);
    dt.set_sources(&["glossary/core/{locale}.json", "deeptip/{locale}.json"]); // core first, project after
    dt.set_value("items", 3); // {items} in texts
    eframe::run_native("Shop", eframe::NativeOptions::default(), Box::new(|_cc| Ok(Box::new(App { dt }))))
}
```

Immediate mode makes a few things simpler than on the web: live values are read every frame (no `refresh()`), and a window follows its widget when the layout moves.

## 4. API

| Call | Does |
|---|---|
| `DeepTip::new(locale, &fallback)` | the controller: glossary, window tree, egui rendering |
| `set_sources(&["…/{locale}.json", …])` | load glossary layers for the locale chain (template order = layer order); returns files that failed |
| `glossary.add_json(locale, text)`, `glossary.add_file(path)`, `glossary.add(locale, &json)` | add a layer from memory or a file (a later layer wins per key) |
| `set_locale(locale)` | switch the language; open windows follow on the next frame |
| `set_value(name, value)`, `set_value_fn(\|name, key\| …)` | live values for `{name}` ([§1]) |
| `mark(&response, key)` | give a widget an explanation (web: `data-deeptip`); call every frame |
| `mark_with(&response, key, MarkOptions { delay, place })` | own rest time in ms (`Some(0.0)` = at once) and own side order (web: `data-deeptip-delay`, `data-deeptip-place`) |
| `text(ui, markup)` | markup with live terms on a page (web: `renderText`) |
| `index(ui, &mut query)` | the encyclopedia: every entry, search, "Mentioned in" (web: `renderIndex`) |
| `show(ctx)` | draw the windows and process input; once per frame, last |
| `handle_keys(ctx)` | optional, first thing in a frame: Esc and F6 are consumed before your widgets see them |
| `open_at(&response, key, pinned)`, `close_all()` | windows from code |
| `engine.windows()`, `engine.pin(id)`, `engine.unpin(id, now_ms)`, `engine.close(id)` | the window tree ([§4]) |
| `is_open(&response)` | a window is open for this widget (web: `data-dt-open`: hide your own tooltip) |
| `arming(&response)` | rest progress 0‥1 while the pointer rests on it (web: `data-dt-arming`) |
| `take_events()` | `Opened`, `Closed`, `Pinned`, `Unpinned` since the last call (web: `onOpen`, `onClose`, `onPin`) |
| `action(ctx, Action::…)` | input egui does not read, e.g. a gamepad via `gilrs`: Y `OpenFocused`, A `Activate`, B `CloseNewest` (held 600 ms: `CloseAll`), LB/RB `Cycle(-1)`/`Cycle(1)`, d-pad `Step(±1)` |
| `focused_window(ctx)`, `terms()` | the window with keyboard focus; the terms drawn in the last frame (tests, tutorials) |
| `engine.options` | behaviour, SPEC §7: `delay` 800, `link_delay` 80, `close_delay` 300, `lock_after` 0, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `gap` |
| `look` | `min_width` 240, `max_width` 384, `max_height` 480, colours (`None` = from the egui visuals, light and dark), `reduced_motion` |

The core without egui: `Glossary` ([§1]), `parse_text` / `collect_refs` / `runs` ([§2], [§3]), `compute_placement` ([§8]) and `Engine` ([§4]–[§7], [§9]): the whole behaviour as a deterministic state machine. A UI layer reports what the pointer is over (`set_hover`), pointer samples, clicks and keys, and calls `tick(now_ms)`; that is how `src/ui.rs` uses it, and how another Rust toolkit (iced, Slint, Bevy UI) can.

## 5. How it maps to egui

| SPEC | egui |
|---|---|
| Window | an `egui::Area` in `Order::Foreground` per window, `fixed_pos` from `compute_placement`; stacking = open order (`Context::move_to_top`). egui's first frame of a new area is an invisible sizing pass, so a window is measured before it shows. |
| Term | a `Label` with `Sense::click()` per link, inside `horizontal_wrapped`, so it wraps with the text, is focusable (Tab) and fires on Enter/Space. Accessibility role `Link`. |
| Preview / pinned | AccessKit role `Tooltip` / `Dialog`; the pinned frame and the pin use the accent colour; no hint line when pinned or on touch screens. |
| What the pointer is over | `Context::layer_id_at` (window), `Response::hovered()` (term, marked widget); only a change counts ([§6]). |
| Timers | the engine's due times against `InputState::time`; `request_repaint_after` wakes egui for the next one. |
| Esc | egui itself drops keyboard focus on Esc before any app code runs; DeepTip remembers the focus of the previous frame, so Esc still closes the window you were in and focus returns to its anchor. |
| Long-press (touch) | egui's own long-touch (`Response::long_touched`), which also swallows the click that ends it. Its duration is egui's `max_click_duration` (0.8 s); for the SPEC's 500 ms: `ctx.options_mut(\|o\| o.input_options.max_click_duration = 0.5)`. |
| Vanished anchor | a marked widget that was not drawn in a frame counts as removed: previews close, pinned roots freeze. When it is drawn again (same widget id) the frozen window follows it again. |

## 6. Example

```bash
cd frameworks/rust-egui
cargo run --example hud
```

A strategy-game HUD in German and English (`demo.realm`, `demo.stability`, `demo.taxes`, `demo.nobles`, `demo.gold`, help `deeptip.about` with delay 0), corner buttons for placement at the screen edge, every setting, the encyclopedia and an event log. It loads `glossary/core/` and `glossary/example/` through `../../glossary/`. *Prestige* and *Gold* exist only in German, so English shows the fallback badge.

Environment: `DEEPTIP_LANG=en|de`, `DEEPTIP_GLOSSARY=<folder>` (another `glossary/`), `DEEPTIP_HUD_SECONDS=3` (close after 3 s, for smoke tests).

The example uses eframe with the `glow` renderer and the `system_fonts` feature: egui's built-in fonts have no arrows or symbols like `→ △ ○`, and `system_fonts` (on by default in eframe) takes them from the system fonts. If you turn eframe's default features off, keep `system_fonts`, or add a font with `egui::Context::add_font`.

## 7. Tests

```bash
cargo test                          # everything
cargo test --no-default-features    # the core alone, without egui
```

| File | Checks |
|---|---|
| `tests/cases.rs` | the shared parity cases `test/cases/markup.json`, `placement.json`, `glossary.json` ([§11]); the shared glossaries load and their links resolve |
| `tests/engine.rs` | the window tree without UI and with exact times: invariants, grace, mouse tendency, suppression, timer lock, hush, outside clicks, Esc / F6 targets, vanished anchors |
| `tests/egui_headless.rs` | real egui frames without a window: synthetic pointer, clicks, keys and time drive the HUD; resting, previews, pinning the chain, Esc / Shift+Esc / holding Esc, F1, F6, gamepad actions, timer lock, page terms, the encyclopedia |

Tip: build outside the repository with `CARGO_TARGET_DIR=<folder>`; `target/` is ignored by git anyway.

## 8. Limitations

- No closing animation (egui areas just disappear); the opening fade-in is egui's.
- No `aria-describedby` between a widget and its open window (egui exposes no such relation); terms, previews and pinned windows have their roles.
- Reduced motion is not read from the system (egui has no such query): set `look.reduced_motion`.
- No vibration on long-press; gamepads only through `action()`.
- The encyclopedia sorts case-insensitively and ignores common Latin accents, not a full locale collation.
- Bold text uses egui's strong colour, not a bold font (egui's default font has no bold face).

[§1]: ../../docs/algorithms.md#1-data
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§10]: ../../docs/algorithms.md#10-auto-linking-aliases
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
