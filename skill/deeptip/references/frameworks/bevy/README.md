# DeepTip for Bevy (Rust)

Guide: how to bring [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, into a [Bevy](https://bevy.org) game. There are two routes. **Route A** runs the existing Rust crate `deeptip` ([frameworks/rust-egui](../rust-egui/README.md), the second complete implementation) inside Bevy through [bevy_egui](https://github.com/vladbat00/bevy_egui): a few lines of glue, the whole behaviour of the crate. **Route B** builds the windows natively with `bevy_ui` on the crate's pure core (`default-features = false`), for games without egui. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md).

**The version rule of route A.** `deeptip` 1.0.0 uses **egui 0.37**; the newest bevy_egui on 2026-10-29, **0.43.1** for **Bevy 0.20**, uses **egui 0.36.2**, and its pending update to egui 0.37 (bevy_egui pull request #508) did not compile yet. With both in one game, `cargo tree -d -e normal` lists `egui v0.36.2` from bevy_egui and `egui v0.37.0` from deeptip (checked), so `deeptip`'s `show(&egui::Context)` cannot take bevy_egui's context. Use route A with the first bevy_egui release on egui 0.37, or today with a local copy of `frameworks/rust-egui` switched to egui 0.36 (five small edits, section 2.1).

Statements marked (checked) were verified on 2026-10-29 with Rust 1.99.1 on Windows 11, headless (no window, no GPU): a local copy of `deeptip` on egui 0.36.2 compiled after those edits; a test app with Bevy 0.20.1, bevy_egui 0.43.1 (without its `render` feature) and the route A system of the Quick start opened the `deeptip.about` window after 800 ms of resting the pointer on the marked button (none after 480 ms) and closed it on `Esc`; the Quick start program compiled and started; a second test with Bevy's `ui_api` feature set laid out a route B window and its text spans and checked every Bevy API name used in route B. Names marked (verify) were not exercised.

**Download:** `DeepTip-bevy-1.0.0.zip` holds this guide, the crate folder `frameworks/rust-egui/` (route A and B depend on it by path), `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented; no Bevy code is shipped in this repository yet (see the version rule).

## Quick start

**Recognise the project:** a `Cargo.toml` that depends on `bevy` (here 0.20), a `src/main.rs` that builds an `App::new()` with `DefaultPlugins`, and an `assets/` folder next to `Cargo.toml`.

1. Add `deeptip = { path = "<DeepTip>/frameworks/rust-egui" }` and a `bevy_egui` on the same egui minor version; `cargo tree -d -e normal` must not list two `egui` (section 2.1).
2. Copy `glossary/core/*.json` to `assets/deeptip/core/`; your entries go to `assets/deeptip/<locale>.json`.
3. Add `EguiPlugin`, insert `DeepTip` as a non-send resource and run the system below in `EguiPrimaryContextPass`.
4. Mark every explained widget with `dt.mark(&response, key)`; call `dt.show(ctx)` last.
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en assets/deeptip/core/en.json assets/deeptip/en.json`.

```rust
use bevy::prelude::*;
use bevy_egui::{EguiContexts, EguiPlugin, EguiPrimaryContextPass, egui};
use deeptip::DeepTip;

fn main() {
    let mut dt = DeepTip::new("en", &["en"]);
    dt.set_sources(&["assets/deeptip/core/{locale}.json", "assets/deeptip/{locale}.json"]);
    App::new()
        .add_plugins((DefaultPlugins, EguiPlugin::default()))
        .insert_non_send(dt) // DeepTip is not Send: a non-send resource
        .add_systems(Startup, |mut commands: Commands| {
            commands.spawn(Camera2d);
        })
        .add_systems(EguiPrimaryContextPass, hud)
        .run();
}

fn hud(mut contexts: EguiContexts, mut dt: NonSendMut<DeepTip>) -> Result {
    let ctx = contexts.ctx_mut()?;
    dt.handle_keys(ctx); // Esc and F6 reach DeepTip before your widgets
    egui::Area::new(egui::Id::new("hud")).fixed_pos([20.0, 20.0]).show(ctx, |ui| {
        let help = ui.button("?");
        dt.mark(&help, "deeptip.about"); // rest the mouse on it: its window opens
    });
    dt.show(ctx); // once per frame, after your UI
    Ok(())
}
```

**Done when:** `cargo tree -d -e normal` lists one `egui`, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest, the validator reports 0 errors.

## 1. Choose the route

| | Route A: `deeptip` through bevy_egui | Route B: native `bevy_ui` |
|---|---|---|
| Fits | games that already use egui (debug UIs, tools, strategy HUDs drawn with egui) | games whose UI is `bevy_ui` only |
| Code to write | the glue of section 2 | the UI layer of section 3 on the crate's pure core |
| Behaviour | everything of the crate: window tree, grace, mouse tendency, suppression, timer lock, keyboard focus, touch long-press, encyclopedia, live values ([rust-egui README](../rust-egui/README.md)) | the same decisions (the core's `Engine`), with windows, text and input from Bevy |
| Look | egui's visuals with DeepTip's `Look` (section 4) | Bevy nodes styled with the values of section 4 |
| Coupling | the egui version of bevy_egui must equal deeptip's | the Bevy version only; the core has no egui |

Both routes use the same glossaries, the same validator and the crate's tests against `test/cases/` (`cargo test` in `frameworks/rust-egui`, section 6).

## 2. Route A: `deeptip` through bevy_egui

### 2.1 Versions

| Crate | Version (2026-10-29) | egui |
|---|---|---|
| `deeptip` (frameworks/rust-egui) | 1.0.0 | 0.37.0 |
| `bevy_egui` | 0.43.1 (Bevy 0.20) | 0.36.2 (checked) |
| `bevy` | 0.20.1 | – |

`cargo tree -d -e normal` is the test: one `egui` line means the types match. Two ways to get there:

- **Wait for bevy_egui on egui 0.37** (its update is open upstream), then depend on that release.
- **Today:** copy `frameworks/rust-egui` into your workspace, set `egui = { version = "0.36", optional = true, default-features = false, features = ["default_fonts"] }` in its `Cargo.toml`, drop its `[dev-dependencies]`, examples and tests (they need eframe 0.37), and make five edits in `src/ui.rs`, all about accessibility metadata that egui 0.36 does not have yet (checked: the library then compiles against egui 0.36.2, and the headless Bevy test of the intro passed with it):

| egui 0.37 (deeptip 1.0.0) | egui 0.36 |
|---|---|
| `use egui::{…, Role, …}` | remove `Role` from the import |
| `Id::unique(("deeptip-window", win))` | `Id::new(("deeptip-window", win))` |
| `.role(if v.pinned { Role::Dialog } else { Role::Tooltip })` on the window's `Area` | remove (no `Area::role`) |
| `.accessible_name(c.title.clone())` on the same `Area` | remove (no `Area::accessible_name`) |
| `WidgetInfo::labeled(Role::Link, …)`, `WidgetInfo::labeled(Role::Button, …)`, `WidgetInfo::selected(Role::Button, …)` | `egui::WidgetType::Link`, `egui::WidgetType::Button` |

Screen readers then lose the window roles (preview = tooltip, pinned = dialog) until you return to the original crate.

### 2.2 The frame

bevy_egui reads Bevy's input in `PreUpdate` (`EguiPreUpdateSet::ProcessInput`, then `BeginPass`) and runs the `EguiPrimaryContextPass` schedule, and so DeepTip's system, in `PostUpdate` (`EguiPostUpdateSet::EndPass`) (checked in the bevy_egui 0.43.1 source). One egui pass per frame:

1. `PreUpdate`: Bevy's input systems (`bevy::input::InputSystems`), then bevy_egui turns the window's cursor, button, touch and key messages into egui input.
2. `Update`: your game systems.
3. `PostUpdate`, `EguiPrimaryContextPass`: your egui UI; in it, first `dt.handle_keys(ctx)` (Esc and F6 are taken out of egui's input while windows are open, before your widgets see them), then your widgets with `dt.mark(&response, key)` / `dt.mark_with(&response, key, MarkOptions { delay, place })` and page texts with `dt.text(ui, markup)`, last `dt.show(ctx)` (draws the windows, runs every timer, asks egui for the next repaint).

`DeepTip` holds the live-value callback as a `Box<dyn Fn>` without `Send`, so it cannot be a `Resource` (checked: `DeepTip: Send` fails to compile); insert it with `App::insert_non_send` and take it with `NonSend<DeepTip>` / `NonSendMut<DeepTip>` (Bevy 0.20 names, checked). Systems with non-send parameters run on the main thread, like egui itself. `EguiContexts::ctx_mut()` returns a `Result`, so the system returns Bevy's `Result` and uses `?` (checked).

Everything else is the crate's API ([rust-egui README, section 4](../rust-egui/README.md#4-api)): `set_value`, `set_value_fn`, `set_locale`, `index(ui, &mut query)`, `take_events()`, `is_open(&response)`, `arming(&response)`, `open_at`, `close_all`, `engine.options`, `look`.

### 2.3 Esc, gamepad and other Bevy input

- **Esc for the game.** `handle_keys` removes Esc from *egui's* input only. Your own Bevy systems read `ButtonInput<KeyCode>` in `Update`, before DeepTip decides in `PostUpdate`. Hide the press from them while DeepTip has windows: a system in `PreUpdate`, `.after(bevy::input::InputSystems)`, that calls `keys.clear_just_pressed(KeyCode::Escape)` when `!dt.engine.windows().is_empty()`. After that call `just_pressed(Escape)` is false for later systems while `pressed(Escape)` stays true (checked), so DeepTip's hold-Esc timing keeps working; DeepTip itself still gets the key through egui (bevy_egui reads key messages, not `ButtonInput`; the combination: verify).
- **Gamepad.** egui reads no gamepad; Bevy does (`Gamepad` components). Map presses to the crate's `Action`s in a system that also holds `NonSendMut<DeepTip>` and the context: `GamepadButton::North` (Y) → `Action::OpenFocused`, `South` (A) → `Action::Activate`, `East` (B) → `Action::CloseNewest` (held 600 ms → `Action::CloseAll`), `LeftTrigger` / `RightTrigger` (the first, upper triggers: LB / RB) → `Action::Cycle(-1)` / `Cycle(1)`, d-pad → `Action::Step(±1)` (names checked; `dt.action(ctx, Action::…)`).
- **Touch.** egui's own long-touch opens pinned windows; its duration is egui's `max_click_duration` (0.8 s), set it to the SPEC's 500 ms with `ctx.options_mut(|o| o.input_options.max_click_duration = 0.5)` (see the rust-egui README).
- **Fonts.** egui's built-in fonts lack arrows and symbols like `→ △ ○`; add a font with `ctx.add_font(…)` once, or avoid those glyphs in your glossaries.

## 3. Route B: native `bevy_ui` on the pure core

Depend on the core only: `deeptip = { path = "<DeepTip>/frameworks/rust-egui", default-features = false }`. It brings `Glossary` ([§1]), `parse_text`, `collect_refs`, `runs` ([§2], [§3]), `compute_placement` ([§8]) and `Engine` ([§4]–[§7], [§9]): every decision of the reference as a deterministic state machine. Route B is the UI layer around it, like `src/ui.rs` of the crate is for egui. All Bevy names below are Bevy 0.20.1 (checked by compiling them; behaviour notes checked where marked).

### 3.1 SPEC concept → Bevy primitive

| DeepTip | Bevy 0.20 |
|---|---|
| Controller | a `Resource` holding `Glossary` and `Engine` (both plain data) plus the UI state of section 3.2, and a `Plugin` that adds the systems |
| Top layer, window order | one root `Node` per window with `PositionType::Absolute` and `GlobalZIndex` (orders separate UI hierarchies; `ZIndex` only orders siblings, checked in the docs); newer windows get a higher `GlobalZIndex` |
| Window ([§3]) | `Node { min_width: Val::Px(240.0), max_width: Val::Px(384.0), max_height, padding, border, overflow: Overflow::scroll_y(), border_radius: BorderRadius::all(Val::Px(8.0)), .. }` (the radius is a `Node` field in 0.20) with `BackgroundColor`, `BorderColor::all(…)`, `BoxShadow` (all checked); header row (title `Text`, badge, pin and close `Button`s), body `Text`, "See also", hint, lock bar (a `Node` whose `width` is `Val::Percent`) (min and max width honoured in the headless layout: 384 × 118 px, checked) |
| Rich text | one `Text` per paragraph, its runs as `TextSpan` children with their own `TextFont` (`TextFont::from_font_size(14.0)`; weight and style are `TextFont` fields, checked) and `TextColor` |
| Term | a `TextSpan` with a marker component holding the key. Its boxes: `TextLayoutInfo::run_geometry` lists one `RunGeometry { section_index, bounds, … }` per run and line, `bounds` relative to the top-left of the text layout; `section_index` is the span's position in `ComputedTextBlock::entities()` (root text = 0) (checked: the span "unrest" gave one box and six glyphs) |
| Marked UI element (web: `data-deeptip`) | a component `DeepTipKey { key, delay: Option<f64>, place: Vec<Side> }` on any UI node |
| Node boxes | `ComputedNode::size()` (physical pixels; `× inverse_scale_factor()` = logical) and `UiGlobalTransform` (its translation is the node's centre in physical pixels) (checked: a window at left 100, top 50, 384 × 118 has its centre at 292, 109 at scale 1) |
| Pointer | `Window::cursor_position()` (logical pixels, top-left origin, `None` outside the window, checked in the docs) |
| Element under the pointer | `Interaction` / `RelativeCursorPosition::cursor_over()` on marked nodes (both checked); give window nodes `FocusPolicy::Block` (exists, checked) so the nodes below them do not report hover (verify) |
| `now()`, `schedule()` | `Res<Time<Real>>`: `elapsed_secs_f64() * 1000.0` (checked: compiles; real time keeps running while the game's virtual time is paused); the engine's due times (`Engine::tick(now)` returns the next one) |
| Keys | `ButtonInput<KeyCode>`; consume with `clear_just_pressed` (checked, section 2.3) |
| Gamepad | `Query<&Gamepad>`: `just_pressed(GamepadButton::North)`, `South`, `East`, `LeftTrigger`, `RightTrigger`, `DPadUp`…, `left_stick()` (checked) |
| Touch | `Res<Touches>`: `iter_just_pressed()`, `iter()`, positions and start positions for the long-press and the swipe (checked) |
| Focus | `bevy_input_focus`: the `InputFocus` resource (`set(entity, cause)`), `TabIndex`, `TabGroup`, `AutoFocus`, `InputFocusVisible` (exist, checked) for marked elements; inside windows the engine's own focus index over terms and buttons |
| UI scale | `UiScale` multiplies `Val::Px` values (checked in the docs); DeepTip's sizes are logical pixels like `Val::Px` |
| Screen reader | `bevy_a11y` (AccessKit) labels for the window and its buttons (verify for your Bevy version) |

### 3.2 Data

```rust
#[derive(Resource)]
pub struct DeepTipUi {
    pub glossary: deeptip::Glossary,
    pub engine: deeptip::Engine,
    pub values: HashMap<String, String>,       // live values; no Box<dyn Fn> here, so the resource stays Send
    views: HashMap<deeptip::WinId, View>,      // per window: its root entity and term spans
    last_hover: deeptip::Hover,
    pointer: Option<Vec2>,
}

struct View {
    root: Entity,                              // the window's root Node
    terms: Vec<(Entity, deeptip::AnchorId, String)>, // term span entity, its anchor (window, key, occurrence), key
    built_for: (String, bool, String),         // (locale, pinned, values signature): rebuild when it changes
    measured: bool,                            // hidden until laid out once (section 3.4)
}

#[derive(Component)]
pub struct DeepTipKey { pub key: String, pub delay: Option<f64>, pub place: Vec<deeptip::Side> }

#[derive(Component)]
struct TermSpan(deeptip::AnchorId, String);
```

Anchors are the crate's `AnchorId`: `Element(entity.to_bits())` for marked nodes, `Term(window, key, occurrence)` for terms in windows, `Page(text, ordinal)` for terms on normal screens.

### 3.3 Order of operations per frame

1. `PreUpdate`, after `InputSystems`: read `Window::cursor_position()`; when it changed, `engine.pointer_moved(x, y, now)` (mouse only). Hit-test ([§6]): `win` = the newest window whose node box contains the pointer; `link` = the term run box under the pointer in that window's texts (section 3.5); `trig` = the marked node whose `Interaction` is `Hovered` (only when there is neither). `engine.set_hover(Hover { win, link, trig }, now)`; the engine ignores unchanged hovers itself.
2. Same system: clicks (`ButtonInput<MouseButton>` just pressed / released on the same target): close and pin buttons (`Interaction::Pressed` on them), terms → `engine.follow(anchor, key, Some(win), false, now)`, inside a window → `engine.click_inside(win)`; outside → `engine.pointer_down(false, trig.as_ref(), false)` (hush, outside clicks). Keys: Esc → `engine.close_newest(focused)`, Shift+Esc or held 600 ms → `close_all`, F6 → `cycle`, F1 → `open_pinned`; consume what DeepTip used (`clear_just_pressed`). Gamepad and touch likewise ([§9.4], [§9.2]).
3. `engine.tick(now)` runs the due timers ([§5]–[§7]); `engine.take_events()` tells which windows opened, closed, pinned.
4. `Update`: your game.
5. `PostUpdate`, before `UiSystems::Layout` (checked): spawn a root node for every new window (hidden, `Visibility::Hidden`), despawn closed ones, rebuild the text of windows whose locale, pin state or live values changed; set `left`/`top` of windows placed in the last frame; `engine.retain_anchors(…)` with the marked nodes that still exist ([§4.5]).
6. `PostUpdate`, after `UiSystems::Layout`: read `ComputedNode` sizes of new or changed windows, `compute_placement` ([§8], section 3.4), store the position for step 5 of the next frame, `engine.set_rect(id, rect)` and `engine.set_anchor_rect(id, rect)`; show a window once it has been placed.

### 3.4 Placement [§8]

A new window is laid out hidden first, like egui's sizing pass: `ComputedNode::size() * inverse_scale_factor()` is its natural size in logical pixels within `min_width`/`max_width`. Then `compute_placement(size, anchor, sides, viewport, gap)` with the anchor = the parent window's box for children and the marked node's box for roots (both from `UiGlobalTransform` and `ComputedNode`, converted to logical pixels, top-left = centre − size / 2), sides = the mark's `place`, else `engine.options.root` / `child`, viewport = `Window::width()` × `Window::height()` (logical). If `maxW` or `maxH` is set, give the node that `max_width` / `max_height` and place again with `[side]` in the next frame. Write `left: Val::Px(x)`, `top: Val::Px(y)`; with a `UiScale` other than 1 divide by it, since `Val::Px` is multiplied by `UiScale`. Because a window is placed beside the box it came from, a child never covers its parent.

### 3.5 Text, terms and hit-testing [§3]

Build one `Text` per paragraph from `deeptip::runs(...)` (or walk the `Block`s of `parse_text`): plain runs as `TextSpan`s in the text colour, bold and italic with `TextFont { weight, style, .. }`, code in a monospace font, live values in bold, a term as a `TextSpan` with the component `TermSpan(anchor, key)` in the term colour (an open term: the hover colour, since text spans have no background of their own), a link to the window's own key in bold, a missing key in red. Bullet items are their own `Text` nodes with a `• ` prefix and a left margin.

Hit-testing a term: for the window's texts, take `TextLayoutInfo` and `ComputedTextBlock` of each `Text`; for every `RunGeometry` whose `section_index` is the index of a `TermSpan` entity in `ComputedTextBlock::entities()`, the term's box is `bounds` moved by the text node's top-left corner. `TextLayoutInfo::scale_factor` says in which scale the layout was made: at scale factor 1 the boxes are logical pixels (checked); divide by the factor otherwise (verify). A term that wraps has one run per line, so it is hit on every line.

## 4. Look (from `frameworks/web/deeptip.css`)

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| text `--dt-fg` | `#1F2328` | `#E6E8EC` |
| frame, hint separator `--dt-border` | `#C8CDD5` | `#3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `#0B69D4` | `#58A6FF` |
| term `--dt-link` | `#0B69D4` | `#6CB6FF` |
| term under the pointer `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| open term background | the term colour at 16 % alpha | same |
| missing term `--dt-missing` | `#DD3333` | same |

Route A: set `dt.look` (`min_width` 240, `max_width` 384, `max_height` 480, `accent`, `link`, `missing`, `value` as `egui::Color32::from_rgb(0x58, 0xA6, 0xFF)` …; `None` follows egui's visuals, light and dark). Route B: `Color::srgb_u8(0x1B, 0x1E, 0x24)` …; font 14 px with a line height of 1.5, padding 12, header padding 6 6 2 12, gap 8, `border_radius: BorderRadius::all(Val::Px(8.0))` in the `Node`, border 1 px, shadow `0 10 30` at 30 % black (`BoxShadow`), buttons 26 × 26 (40 × 40 after touch input), lock bar 2 px, fade in over 150 ms, flash = the accent border for 600 ms.

## 5. Loading the glossaries [§1]

Both routes use the crate's `Glossary`: `set_sources(&["assets/deeptip/core/{locale}.json", "assets/deeptip/{locale}.json"])` loads every template for each locale of the chain in order (core first, project after) and returns the files that failed; `serde_json` with `preserve_order` keeps the file order ([§1.1]). The paths are file paths, so they work where `assets/` sits next to the executable (desktop). For Android, Web or packed assets, read the files with Bevy's `AssetServer` (as text assets) and pass them to `glossary.add_json(locale, text)`, core first, in the same order. Language switch: `set_locale(locale)`; in route A open windows follow on the next frame, in route B rebuild the window texts (section 3.3, step 5).

## 6. Tests [§11]

- The pure core: `cargo test` in `frameworks/rust-egui` runs the shared parity cases (`tests/cases.rs`), the engine scenarios (`tests/engine.rs`) and, with the default feature, headless egui frames (`tests/egui_headless.rs`); `cargo test --no-default-features` tests the core alone, which is all route B uses ([rust-egui README, section 7](../rust-egui/README.md#7-tests)).
- Route A in Bevy, headless: `App::new()` with `MinimalPlugins`, `WindowPlugin { primary_window: Some(Window { resolution: WindowResolution::new(1000, 700), .. }), exit_condition: ExitCondition::DontExit, close_when_requested: false, .. }`, `InputPlugin`, `EguiPlugin::default()`, `TimeUpdateStrategy::ManualDuration(Duration::from_millis(16))`, a `Camera2d`, and the system of the Quick start; push `egui::Event::PointerMoved(pos)` into the `EguiInput` component of the `PrimaryEguiContext` entity and call `app.update()`. Without bevy_egui's `render` feature nothing uploads egui's textures, and epaint's debug assertion panics when an unapplied `TexturesDelta` is dropped: add a `PostUpdate` system after `EguiPostUpdateSet::ProcessOutput` that calls `textures_delta.clear()` on every `EguiRenderOutput` (checked).
- Route B in Bevy, headless: `DefaultPlugins` with `bevy = { version = "0.20", default-features = false, features = ["std", "ui_api", "default_font", "bevy_window"] }` (UI, text and layout without the render crates), a primary window with a resolution, a `Camera2d`; after a few `app.update()` calls `ComputedNode`, `UiGlobalTransform` and `TextLayoutInfo` hold the layout (checked).
- Behaviour against the reference: compare with the web example (`npm run demo`) by hand.

## 7. The example to build

The scene of every DeepTip example, with the shared glossaries copied to `assets/deeptip/core/` and `assets/deeptip/example/`: a top bar of buttons (route A: egui buttons in a top `Area` or panel; route B: `Button` nodes with `DeepTipKey`): Realm `demo.realm`, Stability `demo.stability` (a click cycles −3…+3, then `set_value("stability", …)`), Taxes `demo.taxes` (cycles low/normal/high, adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and delay 0; a language toggle de/en (`set_locale`); four corner buttons `demo.province` (top left), `demo.prestige` (top right), `demo.revolt` (bottom left), `demo.unrest` (bottom right) for placement at the screen edges; a page text with `[[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]`. Options: fallback `["de", "en"]`, `engine.options.delay = 1000.0`, values `stability` (`+1`) and `gold`. In English, Prestige and Gold come from the German fallback and show the `DE` badge. The crate's own `cargo run --example hud` is the same scene in eframe and the model for route A.

## 8. Pitfalls

1. **Two eguis** (section 2.1): the compiler reports mismatched `egui::Context` types far from the cause; check `cargo tree -d -e normal` first.
2. **`DeepTip` is not `Send`** (checked): `insert_resource` does not compile; use `insert_non_send` and `NonSendMut`.
3. **Schedules**: DeepTip's egui system runs in `PostUpdate`; game systems in `Update` see input first (section 2.3).
4. **Headless without `render`**: clear the egui texture deltas in tests (section 6), or epaint panics in debug builds.
5. **Route B coordinates**: `ComputedNode` and `UiGlobalTransform` are physical pixels, `Window::cursor_position()` and `Val::Px` logical; convert with `inverse_scale_factor()` and `UiScale`.
6. **One frame of layout lag** in route B: a new window is measured after `UiSystems::Layout` and placed in the next frame; keep it hidden for that frame.
7. **Renamed APIs**: Bevy 0.20 calls the non-send API `insert_non_send` / `non_send` / `NonSendMut`, font sizes `TextFont::from_font_size`, and glyphs carry `section_index` (checked); older tutorials use other names.

## 9. Limitations

- Route A depends on matching egui versions; with the egui-0.36 copy the windows lose their screen-reader roles (section 2.1).
- Route B is a description, not shipped code: its UI layer has to be written per game; the decisions (window tree, timers, placement) come from the tested core.
- Text spans in `bevy_ui` have no background colour, so open terms are marked by colour (route B).
- Vibration on long-press: neither route (Bevy has no phone vibration; gamepads rumble through `GamepadRumbleRequest` messages, which exist, checked).

## 10. Checklist

1. Pick the route (section 1); for route A, one `egui` in `cargo tree -d -e normal`.
2. `cargo test` in `frameworks/rust-egui` passes (parity cases, engine, egui headless).
3. Route A: the Quick start system, the Esc guard and gamepad mapping (section 2.3). Route B: plugin, windows, spans, hit-testing, placement, input (section 3).
4. Glossaries in `assets/deeptip/`, loaded core first (section 5); the validator reports 0 errors.
5. The example (section 7); compare with the web example by hand; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.1]: ../../docs/algorithms.md#11-flattening-one-glossary-file
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§4.5]: ../../docs/algorithms.md#45-anchors-that-disappear
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
