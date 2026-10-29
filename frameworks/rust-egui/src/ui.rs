//! The egui UI (feature `egui`, on by default).
//!
//! Native first (SPEC §1): every window is an [`egui::Area`] in the foreground order, placed with
//! [`compute_placement`]; terms are focusable, clickable [`egui::Label`]s that wrap with the surrounding text;
//! marked widgets are ordinary egui [`Response`]s. All decisions (window tree, grace, tendency, suppression,
//! arming, timer lock) are made by [`Engine`]; this module only draws and reports input.
//!
//! Per frame: draw your UI and call [`DeepTip::mark`] on the responses that have an explanation, then call
//! [`DeepTip::show`] once at the end.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use egui::{
    pos2, vec2, Color32, Context, CursorIcon, Event as InputEvent, Frame, Id, Key, Label, LayerId, Margin, Order, Pos2,
    Rect as ERect, Response, RichText, Role, ScrollArea, Sense, Stroke, StrokeKind, TextEdit, TextWrapMode, Ui, Vec2,
    WidgetInfo,
};

use crate::engine::{AnchorId, Engine, Event, Hover, LinkHover, Options, TrigHover, Via, WinId, HOLD, SWIPE};
use crate::glossary::Glossary;
use crate::markup::{collect_refs, parse_text, runs, Block, Emphasis, Inline, Run};
use crate::placement::{compute_placement, Rect, Side, Size};

/// Per-element options for [`DeepTip::mark_with`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarkOptions {
    /// Own rest time in ms (web: `data-deeptip-delay`), e.g. `Some(0.0)` for a help button.
    pub delay: Option<f64>,
    /// Own side order for the first window (web: `data-deeptip-place`), e.g. form labels that must not cover
    /// the input below them. Empty = [`Options::root`].
    pub place: Vec<Side>,
}

/// Look of the windows (SPEC §8). Colours left at `None` follow the egui visuals, so light and dark work.
#[derive(Clone, Debug, PartialEq)]
pub struct Look {
    /// Minimum window width in points (web: `--dt-min-width`, 15rem).
    pub min_width: f32,
    /// Maximum window width (web: `--dt-max-width`, 24rem).
    pub max_width: f32,
    /// Maximum window height; the body scrolls beyond it (web: `--dt-max-height`, 30rem).
    pub max_height: f32,
    /// Pinned border, timer-lock bar, flash (web: `--dt-accent` / `--dt-pinned`).
    pub accent: Option<Color32>,
    /// Terms (web: `--dt-link`).
    pub link: Option<Color32>,
    /// Links to missing entries (web: `--dt-missing`).
    pub missing: Option<Color32>,
    /// Live values (web: `--dt-var`).
    pub value: Option<Color32>,
    /// No fade-in and no animated flash (the timer-lock bar still runs, it is a timer).
    pub reduced_motion: bool,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            min_width: 240.0,
            max_width: 384.0,
            max_height: 480.0,
            accent: None,
            link: None,
            missing: None,
            value: None,
            reduced_motion: false,
        }
    }
}

/// Input that egui does not read itself, e.g. a gamepad through `gilrs` (SPEC §5, algorithms §9.4): Y →
/// `OpenFocused`, A → `Activate`, B tap → `CloseNewest`, B held ≥ 600 ms → `CloseAll`, RB / LB → `Cycle(1)` /
/// `Cycle(-1)`, d-pad or stick → `Step(1)` / `Step(-1)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Open the window of the focused element or term, pinned, focus moves in.
    OpenFocused,
    /// Close the newest window opened from the focused one (or the newest).
    CloseNewest,
    /// Close every window.
    CloseAll,
    /// Move focus to the next older (`1`) or newer (`-1`) window.
    Cycle(i32),
    /// d-pad / stick inside a window: focus the next (`1`) or previous (`-1`) term or button, wrapping.
    Step(i32),
    /// A: activate the focused term (follow it) or window button.
    Activate,
}

#[derive(Clone, Debug)]
struct Mark {
    anchor: AnchorId,
    key: String,
    rect: ERect,
    hovered: bool,
    focused: bool,
    pressed: bool,
    long_touched: bool,
    opts: MarkOptions,
}

#[derive(Clone, Debug)]
struct LinkHit {
    anchor: AnchorId,
    key: String,
    parent: Option<WinId>,
    rect: ERect,
    widget: Id,
    hovered: bool,
    clicked: bool,
    keyboard: bool,
}

/// Resolved colours of one frame.
#[derive(Clone, Copy, Debug)]
struct Colors {
    bg: Color32,
    border: Color32,
    text: Color32,
    weak: Color32,
    accent: Color32,
    link: Color32,
    link_hover: Color32,
    open_bg: Color32,
    missing: Color32,
    value: Color32,
    hover_bg: Color32,
    shadow: egui::Shadow,
}

/// What a text needs to render: titles of the linked keys, live values, the window's own key.
#[derive(Clone, Debug, Default)]
struct TextCtx {
    titles: HashMap<String, Option<String>>,
    values: HashMap<String, String>,
    self_key: Option<String>,
    missing_tip: String,
}

#[derive(Clone, Debug, Default)]
struct LinkState {
    open: HashSet<AnchorId>,
    hovered: Option<AnchorId>,
}

#[derive(Clone, Copy, Debug)]
enum Owner {
    Window(WinId),
    Page(u64),
}

#[derive(Debug, Default)]
struct Counter {
    per_key: HashMap<String, u32>,
    ordinal: u32,
}

impl Counter {
    fn anchor(&mut self, owner: Owner, key: &str) -> AnchorId {
        match owner {
            Owner::Window(w) => {
                let n = self.per_key.entry(key.to_owned()).or_insert(0);
                let a = AnchorId::Term(w, key.to_owned(), *n);
                *n += 1;
                a
            }
            Owner::Page(base) => {
                let a = AnchorId::Page(base, self.ordinal);
                self.ordinal += 1;
                a
            }
        }
    }
}

/// Everything a window shows.
#[derive(Clone, Debug)]
struct Content {
    title: String,
    badge: Option<String>,
    fallback_tip: String,
    blocks: Vec<Block>,
    see: Vec<String>,
    see_label: String,
    hint: Option<String>,
    pin_label: String,
    unpin_label: String,
    close_label: String,
    pin_button: bool,
    close_button: bool,
    text: TextCtx,
}

#[derive(Clone, Debug)]
struct View {
    id: WinId,
    parent: Option<WinId>,
    pinned: bool,
    frozen: bool,
    anchor: AnchorId,
    anchor_rect: Option<Rect>,
}

#[derive(Debug)]
struct WinOut {
    rect: ERect,
    head: ERect,
    links: Vec<LinkHit>,
    focusables: Vec<Id>,
    buttons: Vec<(Id, Icon)>,
    pin_clicked: bool,
    close_clicked: bool,
    background_clicked: bool,
    natural_width: f32,
    chrome_height: f32,
}

impl Default for WinOut {
    fn default() -> Self {
        Self {
            rect: ERect::NOTHING,
            head: ERect::NOTHING,
            links: Vec::new(),
            focusables: Vec::new(),
            buttons: Vec::new(),
            pin_clicked: false,
            close_clicked: false,
            background_clicked: false,
            natural_width: 0.0,
            chrome_height: 0.0,
        }
    }
}

/// Window-local memory between frames.
#[derive(Clone, Copy, Debug, Default)]
struct Memo {
    size: Option<Vec2>,
    pos: Option<Pos2>,
    natural_width: f32,
    chrome_height: f32,
}

type ValueFn = Box<dyn Fn(&str, &str) -> Option<String>>;

/// DeepTip for one egui app: the glossary, the window tree and the egui rendering.
///
/// ```no_run
/// # fn demo(ui: &mut egui::Ui, dt: &mut deeptip::DeepTip) {
/// let r = ui.button("Realm");
/// dt.mark(&r, "demo.realm");
/// // … the rest of the UI …
/// dt.show(ui.ctx()); // once per frame, at the end
/// # }
/// ```
pub struct DeepTip {
    /// Entries per locale, the locale chain and the `$ui` labels.
    pub glossary: Glossary,
    /// The window tree and its timing; `engine.options` holds the behaviour options (SPEC §7).
    pub engine: Engine,
    /// Sizes and colours of the windows.
    pub look: Look,
    values: HashMap<String, String>,
    value_fn: Option<ValueFn>,
    marks: Vec<Mark>,
    page_links: Vec<LinkHit>,
    memo: HashMap<WinId, Memo>,
    widget_win: HashMap<Id, WinId>,
    first_focus: HashMap<WinId, Id>,
    /// Terms, then buttons, of every window drawn last (gamepad stepping).
    focus_order: HashMap<WinId, Vec<Id>>,
    buttons: HashMap<Id, (WinId, Icon)>,
    /// Anchors drawn recently: widget id (focus) and key.
    anchors: HashMap<AnchorId, (Id, String)>,
    hovered_link: Option<AnchorId>,
    last_pointer: Option<Pos2>,
    esc_at: Option<f64>,
    swipe: Option<Pos2>,
    pending_focus: Option<WinId>,
    warned: HashSet<String>,
    keys_pass: Option<u64>,
    events: Vec<Event>,
    last_terms: Vec<(AnchorId, String, ERect)>,
    focus_before: Option<Id>,
}

impl std::fmt::Debug for DeepTip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeepTip")
            .field("locale", &self.glossary.locale())
            .field("windows", &self.engine.windows().len())
            .finish_non_exhaustive()
    }
}

impl Default for DeepTip {
    fn default() -> Self {
        Self::new("en", &["en"])
    }
}

fn to_rect(r: ERect) -> Rect {
    Rect::new(f64::from(r.left()), f64::from(r.top()), f64::from(r.right()), f64::from(r.bottom()))
}

fn to_erect(r: Rect) -> ERect {
    ERect::from_min_max(pos2(r.left as f32, r.top as f32), pos2(r.right as f32, r.bottom as f32))
}

fn area_id(win: WinId) -> Id {
    Id::unique(("deeptip-window", win))
}

fn layer_of(win: WinId) -> LayerId {
    LayerId::new(Order::Foreground, area_id(win))
}

fn now_ms(ctx: &Context) -> f64 {
    ctx.input(|i| i.time) * 1000.0
}

/// Backslash-escape markup characters, so a plain string can be embedded in DeepTip markup.
pub fn escape_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '*' | '`' | '[' | ']' | '{' | '}' | '|') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

impl DeepTip {
    /// DeepTip for `locale` with fallback locales (SPEC §2.3), default options and look.
    pub fn new(locale: &str, fallback: &[&str]) -> Self {
        Self {
            glossary: Glossary::new(locale, fallback),
            engine: Engine::new(Options::default()),
            look: Look::default(),
            values: HashMap::new(),
            value_fn: None,
            marks: Vec::new(),
            page_links: Vec::new(),
            memo: HashMap::new(),
            widget_win: HashMap::new(),
            first_focus: HashMap::new(),
            focus_order: HashMap::new(),
            buttons: HashMap::new(),
            anchors: HashMap::new(),
            hovered_link: None,
            last_pointer: None,
            esc_at: None,
            swipe: None,
            pending_focus: None,
            warned: HashSet::new(),
            keys_pass: None,
            events: Vec::new(),
            last_terms: Vec::new(),
            focus_before: None,
        }
    }

    /// The terms drawn in the last frame (in windows and on pages): anchor, key and rectangle.
    /// Useful for tests, tutorials and highlighting.
    pub fn terms(&self) -> &[(AnchorId, String, ERect)] {
        &self.last_terms
    }

    /// Glossary files per locale, `{locale}` is replaced; source order is layer order (core first, project
    /// after). Loads them for the locale chain; returns the files that could not be loaded.
    pub fn set_sources<S: AsRef<str>>(&mut self, sources: &[S]) -> Vec<String> {
        self.glossary.set_sources(sources)
    }

    /// Switch the language (loads missing files). Open windows show the new language on the next frame.
    pub fn set_locale(&mut self, locale: &str) -> Vec<String> {
        self.glossary.set_locale(locale)
    }

    /// Set a live value for `{name}` (SPEC §2.5). Values are read every frame, so no refresh is needed.
    pub fn set_value(&mut self, name: &str, value: impl ToString) {
        self.values.insert(name.to_owned(), value.to_string());
    }

    /// Live values from a function `(name, key) → value`, asked for names without a [`set_value`](Self::set_value).
    pub fn set_value_fn(&mut self, f: impl Fn(&str, &str) -> Option<String> + 'static) {
        self.value_fn = Some(Box::new(f));
    }

    /// Mark a widget with a glossary key: resting on it opens its explanation (SPEC §3.3). Call every frame.
    pub fn mark(&mut self, response: &Response, key: &str) {
        self.mark_with(response, key, MarkOptions::default());
    }

    /// [`mark`](Self::mark) with an own delay or side order.
    pub fn mark_with(&mut self, response: &Response, key: &str, opts: MarkOptions) {
        let anchor = AnchorId::Element(response.id.value());
        self.anchors.insert(anchor.clone(), (response.id, key.to_owned()));
        self.marks.push(Mark {
            anchor,
            key: key.to_owned(),
            rect: response.rect,
            hovered: response.hovered(),
            focused: response.has_focus(),
            pressed: response.is_pointer_button_down_on(),
            long_touched: response.long_touched(),
            opts,
        });
    }

    /// Is a window open for this widget (web: `data-dt-open`)? Hide your own simple tooltip then.
    pub fn is_open(&self, response: &Response) -> bool {
        self.engine.window_for(&AnchorId::Element(response.id.value())).is_some()
    }

    /// While the pointer rests on this widget: progress 0‥1 until its window opens (web: `data-dt-arming`).
    pub fn arming(&self, response: &Response) -> Option<f32> {
        let now = now_ms(&response.ctx);
        let (anchor, p) = self.engine.arming(now)?;
        (anchor == &AnchorId::Element(response.id.value())).then_some(p as f32)
    }

    /// Open the window for `key` next to a widget from code (it is marked for this frame as well).
    pub fn open_at(&mut self, response: &Response, key: &str, pinned: bool) -> Option<WinId> {
        self.mark(response, key);
        let now = now_ms(&response.ctx);
        let anchor = AnchorId::Element(response.id.value());
        self.engine.open(key, anchor, None, pinned, false, Via::Api, now)
    }

    /// Close every window.
    pub fn close_all(&mut self) {
        self.engine.close_all();
    }

    /// Events since the last call: opened, closed, pinned, unpinned (web: `onOpen`, `onClose`, `onPin`).
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }

    /// Render DeepTip markup with live terms on a page (web: `renderText`).
    pub fn text(&mut self, ui: &mut Ui, src: &str) -> Response {
        let blocks = parse_text(src);
        let text = self.text_ctx(&blocks, &[], None);
        let colors = self.colors(ui.ctx());
        let state = self.link_state();
        let base = ui.next_auto_id().value();
        let mut links = Vec::new();
        let mut counter = Counter::default();
        let resp = ui
            .scope(|ui| {
                render_blocks(ui, &blocks, &text, Owner::Page(base), &state, &colors, &mut counter, &mut links);
            })
            .response;
        for l in &links {
            self.anchors.insert(l.anchor.clone(), (l.widget, l.key.clone()));
        }
        self.page_links.extend(links);
        resp
    }

    /// The encyclopedia (SPEC §2.7): a searchable list of every entry with "Mentioned in" backlinks
    /// (web: `renderIndex`). `query` is the search text; keep it in your app state.
    pub fn index(&mut self, ui: &mut Ui, query: &mut String) {
        let hint = self.glossary.label("search");
        ui.add(TextEdit::singleline(query).hint_text(hint).desired_width(f32::INFINITY));
        let q = query.trim().to_lowercase();
        let mut rows: Vec<(String, crate::glossary::Entry)> = self
            .glossary
            .keys()
            .into_iter()
            .filter_map(|k| self.glossary.entry(&k).map(|f| (k.clone(), f.entry.clone())))
            .collect();
        rows.sort_by_cached_key(|(k, e)| fold(e.title.as_deref().unwrap_or(k)));
        let back = self.glossary.backlinks();
        let mentioned = self.glossary.label("mentionedIn");
        let mut shown = 0;
        for (k, e) in rows {
            let find = [
                e.title.clone().unwrap_or_default(),
                k.clone(),
                e.aliases.join(" "),
                e.short.clone().unwrap_or_default(),
            ]
            .join(" ")
            .to_lowercase();
            if !q.is_empty() && !find.contains(&q) {
                continue;
            }
            shown += 1;
            ui.add_space(4.0);
            self.text(ui, &format!("**[[{k}]]**"));
            if let Some(s) = &e.short {
                self.text(ui, s);
            }
            if let Some(b) = back.get(&k).filter(|b| !b.is_empty()) {
                let list: Vec<String> = b.iter().map(|x| format!("[[{x}]]")).collect();
                ui.scope(|ui| {
                    ui.style_mut().override_text_style = Some(egui::TextStyle::Small);
                    self.text(ui, &format!("{}: {}", escape_markup(&mentioned), list.join(", ")));
                });
            }
            ui.add_space(4.0);
            ui.separator();
        }
        if shown == 0 {
            ui.weak(self.glossary.label("empty"));
        }
    }

    /// Optional: call at the start of a frame so Esc and F6 reach DeepTip before your own widgets while windows
    /// are open. [`show`](Self::show) does it otherwise.
    pub fn handle_keys(&mut self, ctx: &Context) {
        let pass = ctx.cumulative_pass_nr();
        if self.keys_pass == Some(pass) {
            return;
        }
        self.keys_pass = Some(pass);
        if self.engine.windows().is_empty() {
            return;
        }
        let now = now_ms(ctx);
        let (mut esc_tap, mut esc_all, mut cycle) = (false, false, None);
        ctx.input_mut(|i| {
            i.events.retain(|e| match e {
                InputEvent::Key { key: Key::Escape, pressed, repeat, modifiers, .. } => {
                    if *pressed && modifiers.shift {
                        esc_all = true;
                    } else if *pressed && !*repeat {
                        esc_tap = true;
                    }
                    false
                }
                InputEvent::Key { key: Key::F6, pressed: true, modifiers, .. } => {
                    cycle = Some(if modifiers.shift { -1 } else { 1 });
                    false
                }
                _ => true,
            });
        });
        if esc_all {
            self.esc_at = None;
            self.close_all_focus(ctx);
        } else if esc_tap {
            self.esc_at = Some(now);
            let from = self.focused_window(ctx);
            if let Some(id) = self.engine.newest(from) {
                self.close_focus_back(ctx, id);
            }
        }
        if let Some(step) = cycle {
            let current = self.focused_window(ctx);
            if let Some(target) = self.engine.cycle(current, step) {
                self.focus_window(ctx, target);
            }
        }
    }

    /// Gamepad and other devices egui does not read (see [`Action`]).
    pub fn action(&mut self, ctx: &Context, action: Action) {
        let now = now_ms(ctx);
        match action {
            Action::OpenFocused => self.open_focused(ctx, Via::Pad, now),
            Action::CloseNewest => {
                let from = self.focused_window(ctx);
                if let Some(id) = self.engine.newest(from) {
                    self.close_focus_back(ctx, id);
                }
            }
            Action::CloseAll => self.close_all_focus(ctx),
            Action::Cycle(step) => {
                let current = self.focused_window(ctx);
                if let Some(target) = self.engine.cycle(current, step) {
                    self.focus_window(ctx, target);
                }
            }
            Action::Step(step) => {
                let Some(items) = self.focused_window(ctx).and_then(|w| self.focus_order.get(&w)) else { return };
                if items.is_empty() {
                    return;
                }
                let focused = ctx.memory(|m| m.focused());
                let n = items.len() as i64;
                let next = match focused.and_then(|f| items.iter().position(|x| *x == f)) {
                    None if step > 0 => 0,
                    None => n - 1,
                    Some(i) => (i as i64 + i64::from(step)).rem_euclid(n),
                };
                let target = items[next as usize];
                ctx.memory_mut(|m| m.request_focus(target));
            }
            Action::Activate => {
                let Some(focused) = ctx.memory(|m| m.focused()) else { return };
                if let Some(&(win, icon)) = self.buttons.get(&focused) {
                    match icon {
                        Icon::Pin => self.engine.toggle_pin(win, now),
                        Icon::Close => self.close_focus_back(ctx, win),
                    }
                } else if self.widget_win.contains_key(&focused) {
                    // a term inside a window: follow it, focus moves in (like Enter)
                    self.open_focused(ctx, Via::Pad, now);
                }
            }
        }
    }

    /// Draw the windows and process this frame's input. Call once per frame, after your UI.
    pub fn show(&mut self, ctx: &Context) {
        let now = now_ms(ctx);
        self.handle_keys(ctx);
        let colors = self.colors(ctx);
        let vp = ctx.content_rect();
        let gap = self.engine.options.gap as f32;
        let (pointer, touching, pressed, released, origin, release_pos, typed, esc_down) = ctx.input(|i| {
            (
                i.pointer.latest_pos(),
                i.any_touches(),
                i.pointer.any_pressed(),
                i.pointer.any_released(),
                i.pointer.press_origin(),
                i.pointer.interact_pos(),
                i.events.iter().any(|e| matches!(e, InputEvent::Text(_))),
                i.key_down(Key::Escape),
            )
        });

        // mouse tendency: recent pointer positions (mouse and pen only)
        if let Some(p) = pointer.filter(|_| !touching) {
            if self.last_pointer != Some(p) {
                self.engine.pointer_moved(f64::from(p.x), f64::from(p.y), now);
            }
        }
        self.last_pointer = pointer;

        // root anchors seen this frame
        let mut anchor_rects: HashMap<AnchorId, ERect> = HashMap::new();
        let mut own_sides: HashMap<AnchorId, Vec<Side>> = HashMap::new();
        for m in &self.marks {
            anchor_rects.insert(m.anchor.clone(), m.rect);
            if !m.opts.place.is_empty() {
                own_sides.insert(m.anchor.clone(), m.opts.place.clone());
            }
        }
        for l in &self.page_links {
            anchor_rects.insert(l.anchor.clone(), l.rect);
        }
        let roots: Vec<(WinId, AnchorId)> =
            self.engine.windows().iter().filter(|w| w.parent.is_none()).map(|w| (w.id, w.anchor.clone())).collect();
        for (id, anchor) in roots {
            if let Some(r) = anchor_rects.get(&anchor) {
                self.engine.set_anchor_rect(id, to_rect(*r));
            }
        }

        // draw the windows, oldest first
        let views: Vec<View> = self
            .engine
            .windows()
            .iter()
            .map(|w| View {
                id: w.id,
                parent: w.parent,
                pinned: w.pinned,
                frozen: w.frozen,
                anchor: w.anchor.clone(),
                anchor_rect: w.anchor_rect,
            })
            .collect();
        let state = self.link_state();
        let mut outs: Vec<(WinId, WinOut)> = Vec::new();
        let mut rects: HashMap<WinId, ERect> = HashMap::new();
        self.widget_win.clear();
        self.first_focus.clear();
        self.focus_order.clear();
        self.buttons.clear();
        for v in &views {
            let content = self.content(v);
            let memo = self.memo.get(&v.id).copied().unwrap_or_default();
            let anchor = match v.parent {
                Some(p) => rects.get(&p).copied(),
                None => v.anchor_rect.map(to_erect),
            }
            .unwrap_or_else(|| ERect::from_center_size(vp.center(), Vec2::ZERO));
            let size = memo.size.unwrap_or(vec2(self.look.min_width, 120.0));
            let sides = self.engine.sides(v.id, own_sides.get(&v.anchor).map(Vec::as_slice));
            let (pos, max_w, max_h) = match (v.frozen, memo.pos) {
                (true, Some(pos)) => (pos, 0.0, 0.0),
                _ => place(size, anchor, &sides, vp, gap),
            };
            let lock = self.engine.lock_progress(v.id, now).map(|p| p as f32);
            let flash = self.engine.flash_progress(v.id, now).map(|p| p as f32);
            let out =
                draw_window(ctx, v, &content, pos, max_w, max_h, &memo, &self.look, &colors, &state, lock, flash, gap);
            rects.insert(v.id, out.rect);
            self.engine.set_rect(v.id, to_rect(out.rect));
            self.memo.insert(
                v.id,
                Memo {
                    size: Some(out.rect.size()),
                    pos: Some(pos),
                    natural_width: out.natural_width,
                    chrome_height: out.chrome_height,
                },
            );
            for f in &out.focusables {
                self.widget_win.insert(*f, v.id);
            }
            if let Some(first) = out.links.first().map(|l| l.widget).or_else(|| out.focusables.first().copied()) {
                self.first_focus.insert(v.id, first);
            }
            let mut order: Vec<Id> = out.links.iter().map(|l| l.widget).collect();
            order.extend(out.buttons.iter().map(|(id, _)| *id));
            self.focus_order.insert(v.id, order);
            for (id, icon) in &out.buttons {
                self.buttons.insert(*id, (v.id, *icon));
            }
            for l in &out.links {
                self.anchors.insert(l.anchor.clone(), (l.widget, l.key.clone()));
            }
            outs.push((v.id, out));
        }
        for v in &views {
            ctx.move_to_top(layer_of(v.id));
        }
        self.memo.retain(|id, _| rects.contains_key(id));

        // anchors that were not drawn this frame vanished (SPEC §3.5)
        let mut present: HashSet<AnchorId> = anchor_rects.keys().cloned().collect();
        for (_, out) in &outs {
            present.extend(out.links.iter().map(|l| l.anchor.clone()));
        }
        self.engine.retain_anchors(|a| present.contains(a));

        // what the pointer is over
        if !touching {
            let win = pointer
                .and_then(|p| ctx.layer_id_at(p))
                .and_then(|l| views.iter().find(|v| layer_of(v.id) == l).map(|v| v.id))
                .filter(|id| self.engine.is_open(*id));
            let link = self
                .page_links
                .iter()
                .chain(outs.iter().flat_map(|(_, o)| o.links.iter()))
                .find(|l| l.hovered)
                .map(|l| LinkHover { anchor: l.anchor.clone(), key: l.key.clone(), parent: l.parent });
            let trig = if win.is_none() && link.is_none() {
                self.marks.iter().find(|m| m.hovered).map(|m| TrigHover {
                    anchor: m.anchor.clone(),
                    key: m.key.clone(),
                    delay: m.opts.delay,
                })
            } else {
                None
            };
            self.hovered_link = link.as_ref().map(|l| l.anchor.clone());
            self.engine.set_hover(Hover { win, link, trig }, now);
        }

        // clicks inside windows: buttons, terms, background
        for (id, out) in &outs {
            if !self.engine.is_open(*id) {
                continue;
            }
            if out.close_clicked {
                self.close_focus_back(ctx, *id);
                continue;
            }
            if out.pin_clicked {
                self.engine.toggle_pin(*id, now);
            }
            if let Some(l) = out.links.iter().find(|l| l.clicked) {
                self.engine.follow(l.anchor.clone(), &l.key, Some(*id), l.keyboard, now);
            } else if out.background_clicked {
                self.engine.click_inside(*id);
            }
        }
        if let Some(l) = self.page_links.iter().find(|l| l.clicked).cloned() {
            self.engine.follow(l.anchor, &l.key, None, l.keyboard, now);
        }

        // presses: hush the element in use, outside presses close (touch by default), swipe on a title bar
        if pressed {
            if let Some(o) = origin {
                let in_window = ctx.layer_id_at(o).is_some_and(|l| views.iter().any(|v| layer_of(v.id) == l));
                let trig = self.marks.iter().find(|m| m.pressed || m.rect.contains(o)).map(|m| m.anchor.clone());
                self.engine.pointer_down(in_window, trig.as_ref(), touching);
                if touching && outs.iter().any(|(_, out)| out.head.contains(o)) {
                    self.swipe = Some(o);
                }
            }
        }
        if released {
            if let (Some(start), Some(end)) = (self.swipe.take(), release_pos) {
                let d = end - start;
                if f64::from(d.y) > SWIPE && f64::from(d.x.abs()) < SWIPE {
                    self.engine.close_all();
                }
            }
        }
        // touch: long-press opens pinned (egui swallows the click that ends it)
        if let Some(m) = self.marks.iter().find(|m| m.long_touched).cloned() {
            self.engine.open_pinned(m.anchor, &m.key, false, Via::Touch, now);
        }
        // typing into a marked field: do not pop its explanation up over the text
        if typed {
            let quiet: Vec<AnchorId> = self.marks.iter().filter(|m| m.focused).map(|m| m.anchor.clone()).collect();
            for a in quiet {
                self.engine.hush(&a);
            }
        }

        // keyboard: F1 / ? open the focused element's or term's window; holding Esc closes all
        let (f1, question) = ctx.input(|i| (i.key_pressed(Key::F1), i.key_pressed(Key::Questionmark)));
        if f1 || (question && !ctx.egui_wants_keyboard_input()) {
            self.open_focused(ctx, Via::Key, now);
        }
        if let Some(at) = self.esc_at {
            if !esc_down {
                self.esc_at = None;
            } else if now - at >= HOLD {
                self.esc_at = None;
                self.close_all_focus(ctx);
            } else {
                ctx.request_repaint_after(Duration::from_secs_f64((HOLD - (now - at)) / 1000.0));
            }
        }

        // focus moves into windows opened by keyboard / gamepad
        if let Some(id) = self.engine.take_focus_request() {
            self.pending_focus = Some(id);
        }
        if let Some(id) = self.pending_focus {
            if let Some(w) = self.first_focus.get(&id).copied() {
                ctx.memory_mut(|m| m.request_focus(w));
                self.pending_focus = None;
            } else if !self.engine.is_open(id) {
                self.pending_focus = None;
            }
        }

        // timers, repaint, events
        let next = self.engine.tick(now);
        let events = self.engine.take_events();
        if !events.is_empty() || self.pending_focus.is_some() {
            ctx.request_repaint();
        }
        self.events.extend(events);
        if let Some(t) = next {
            ctx.request_repaint_after(Duration::from_secs_f64(((t - now) / 1000.0).max(0.0)));
        }
        let animating = views
            .iter()
            .any(|v| self.engine.lock_progress(v.id, now).is_some() || self.engine.flash_progress(v.id, now).is_some())
            || self.engine.arming(now).is_some();
        if animating {
            ctx.request_repaint();
        }
        self.last_terms = self
            .page_links
            .iter()
            .chain(outs.iter().flat_map(|(_, o)| o.links.iter()))
            .map(|l| (l.anchor.clone(), l.key.clone(), l.rect))
            .collect();
        self.marks.clear();
        self.page_links.clear();
        self.anchors.retain(|a, _| present.contains(a));
        self.focus_before = ctx.memory(|m| m.focused());
    }

    /* ------------------------------------------------------------------ helpers */

    fn open_focused(&mut self, ctx: &Context, via: Via, now: f64) {
        let Some(focused) = ctx.memory(|m| m.focused()) else { return };
        let Some((anchor, key)) =
            self.anchors.iter().find(|(_, (w, _))| *w == focused).map(|(a, (_, k))| (a.clone(), k.clone()))
        else {
            return;
        };
        match anchor {
            AnchorId::Term(win, ..) => {
                self.engine.follow(anchor, &key, Some(win), true, now);
            }
            AnchorId::Page(..) => {
                self.engine.follow(anchor, &key, None, true, now);
            }
            AnchorId::Element(_) => {
                self.engine.open_pinned(anchor, &key, true, via, now);
            }
        }
    }

    /// The window that holds keyboard focus, if any. (egui drops focus when Esc is pressed, before DeepTip runs;
    /// the focus at the end of the last frame stands in for it then.)
    pub fn focused_window(&self, ctx: &Context) -> Option<WinId> {
        ctx.memory(|m| m.focused()).or(self.focus_before).and_then(|f| self.widget_win.get(&f).copied())
    }

    fn focus_window(&mut self, ctx: &Context, id: WinId) {
        match self.first_focus.get(&id) {
            Some(w) => ctx.memory_mut(|m| m.request_focus(*w)),
            None => self.pending_focus = Some(id),
        }
    }

    /// Close a window; focus returns to its anchor when focus was inside it.
    fn close_focus_back(&mut self, ctx: &Context, id: WinId) {
        let had_focus = self.focused_window(ctx).is_some_and(|f| self.engine.is_in_chain(f, id));
        let anchor = self.engine.get(id).map(|w| w.anchor.clone());
        self.engine.close(id);
        if had_focus {
            if let Some(w) = anchor.and_then(|a| self.anchors.get(&a).map(|(w, _)| *w)) {
                ctx.memory_mut(|m| m.request_focus(w));
            }
        }
    }

    fn close_all_focus(&mut self, ctx: &Context) {
        let mut root = self.focused_window(ctx);
        while let Some(p) = root.and_then(|r| self.engine.get(r)).and_then(|w| w.parent) {
            root = Some(p);
        }
        let anchor = root.and_then(|r| self.engine.get(r)).map(|w| w.anchor.clone());
        self.engine.close_all();
        if let Some(w) = anchor.and_then(|a| self.anchors.get(&a).map(|(w, _)| *w)) {
            ctx.memory_mut(|m| m.request_focus(w));
        }
    }

    fn link_state(&self) -> LinkState {
        LinkState {
            open: self.engine.windows().iter().map(|w| w.anchor.clone()).collect(),
            hovered: self.hovered_link.clone(),
        }
    }

    fn colors(&self, ctx: &Context) -> Colors {
        let style = ctx.global_style();
        let v = &style.visuals;
        let link = self.look.link.unwrap_or(v.hyperlink_color);
        let accent = self.look.accent.unwrap_or(v.hyperlink_color);
        Colors {
            bg: v.window_fill(),
            border: v.window_stroke().color,
            text: v.text_color(),
            weak: v.weak_text_color(),
            accent,
            link,
            link_hover: if v.dark_mode {
                link.lerp_to_gamma(Color32::WHITE, 0.35)
            } else {
                link.lerp_to_gamma(Color32::BLACK, 0.25)
            },
            open_bg: link.gamma_multiply(0.18),
            missing: self.look.missing.unwrap_or(v.error_fg_color),
            value: self.look.value.unwrap_or(v.strong_text_color()),
            hover_bg: v.widgets.hovered.weak_bg_fill,
            shadow: v.popup_shadow,
        }
    }

    /// Titles of the linked keys and the live values a text needs (warns once per missing key).
    fn text_ctx(&mut self, blocks: &[Block], extra_links: &[String], self_key: Option<&str>) -> TextCtx {
        let refs = collect_refs(blocks);
        let mut titles = HashMap::new();
        for key in refs.links.iter().chain(extra_links.iter()) {
            if titles.contains_key(key) {
                continue;
            }
            let title = self.glossary.entry(key).map(|f| f.entry.title.clone().unwrap_or_else(|| key.clone()));
            if title.is_none() && self.warned.insert(key.clone()) {
                log::warn!("DeepTip: link to missing entry \"{key}\"");
            }
            titles.insert(key.clone(), title);
        }
        let mut values = HashMap::new();
        for name in refs.vars {
            let v = self
                .values
                .get(&name)
                .cloned()
                .or_else(|| self.value_fn.as_ref().and_then(|f| f(&name, self_key.unwrap_or_default())))
                .unwrap_or_else(|| format!("{{{name}}}"));
            values.insert(name, v);
        }
        TextCtx { titles, values, self_key: self_key.map(str::to_owned), missing_tip: self.glossary.label("missing") }
    }

    fn content(&mut self, v: &View) -> Content {
        let key = match self.engine.get(v.id) {
            Some(w) => w.key.clone(),
            None => String::new(),
        };
        let found = self.glossary.entry(&key).map(|f| (f.entry.clone(), f.locale.to_owned()));
        if found.is_none() && self.warned.insert(key.clone()) {
            log::warn!("DeepTip: no entry \"{key}\"");
        }
        let missing = self.glossary.label("missing");
        let (title, src, see, badge) = match &found {
            Some((e, loc)) => (
                e.title.clone().unwrap_or_else(|| key.clone()),
                e.text().map_or_else(|| missing.clone(), str::to_owned),
                e.see.clone(),
                (loc != self.glossary.locale()).then(|| loc.to_uppercase()),
            ),
            None => (key.clone(), missing.clone(), Vec::new(), None),
        };
        let blocks = parse_text(&src);
        let text = self.text_ctx(&blocks, &see, Some(&key));
        Content {
            title,
            badge,
            fallback_tip: self.glossary.label("fallback"),
            blocks,
            see,
            see_label: self.glossary.label("seeAlso"),
            hint: (self.engine.options.hints && !v.pinned).then(|| self.glossary.label("hint")),
            pin_label: self.glossary.label("pin"),
            unpin_label: self.glossary.label("unpin"),
            close_label: self.glossary.label("close"),
            pin_button: self.engine.options.pin_button,
            close_button: self.engine.options.close_buttons,
            text,
        }
    }
}

/// Sort key for the encyclopedia: lower case without the common Latin accents (`Ä` sorts with `A`).
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ą' => out.push('a'),
            'æ' => out.push_str("ae"),
            'ç' | 'ć' | 'č' => out.push('c'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' | 'ě' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' => out.push('i'),
            'ñ' | 'ń' | 'ň' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => out.push('o'),
            'œ' => out.push_str("oe"),
            'ß' => out.push_str("ss"),
            'ś' | 'š' => out.push('s'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'ź' | 'ż' | 'ž' => out.push('z'),
            c => out.push(c),
        }
    }
    out
}

/// Placement in egui coordinates: (position, max width, max height); 0 = no limit.
fn place(size: Vec2, anchor: ERect, sides: &[Side], vp: ERect, gap: f32) -> (Pos2, f32, f32) {
    let o = vp.min;
    let a = to_rect(anchor.translate(-o.to_vec2()));
    let vps = Size::new(f64::from(vp.width()), f64::from(vp.height()));
    let g = f64::from(gap);
    let mut p = compute_placement(Size::new(f64::from(size.x), f64::from(size.y)), a, sides, vps, g);
    if p.max_w > 0.0 || p.max_h > 0.0 {
        let w = if p.max_w > 0.0 { f64::from(size.x).min(p.max_w) } else { f64::from(size.x) };
        let h = if p.max_h > 0.0 { f64::from(size.y).min(p.max_h) } else { f64::from(size.y) };
        let again = compute_placement(Size::new(w, h), a, &[p.side], vps, g);
        p = crate::placement::Placement { max_w: p.max_w, max_h: p.max_h, ..again };
    }
    (pos2(o.x + p.x as f32, o.y + p.y as f32), p.max_w as f32, p.max_h as f32)
}

/// Window button size; 40 on touch screens (SPEC §6: touch targets ≥ 40 px).
const BUTTON: f32 = 22.0;
const BUTTON_TOUCH: f32 = 40.0;
const MARGIN: Margin = Margin { left: 12, right: 6, top: 6, bottom: 8 };

#[allow(clippy::too_many_arguments)]
fn draw_window(
    ctx: &Context,
    v: &View,
    c: &Content,
    pos: Pos2,
    max_w: f32,
    max_h: f32,
    memo: &Memo,
    look: &Look,
    colors: &Colors,
    state: &LinkState,
    lock: Option<f32>,
    flash: Option<f32>,
    gap: f32,
) -> WinOut {
    let vp = ctx.content_rect();
    let mut out = WinOut::default();
    // coarse pointer: bigger buttons, no hint line (the web hides it with `pointer: coarse`)
    let coarse = ctx.input(|i| i.has_touch_screen());
    let button = if coarse { BUTTON_TOUCH } else { BUTTON };
    let chrome_x = f32::from(MARGIN.left) + f32::from(MARGIN.right) + 2.0;
    let outer_max = (if max_w > 0.0 { max_w.min(look.max_width) } else { look.max_width }).min(vp.width() - 2.0 * gap);
    let inner_max = (outer_max - chrome_x).max(40.0);
    let inner_min = (look.min_width.min(vp.width() - 2.0 * gap) - chrome_x).clamp(0.0, inner_max);
    let outer_max_h = (if max_h > 0.0 { max_h } else { look.max_height }).min(vp.height() - 2.0 * gap);
    let chrome_h = if memo.chrome_height > 0.0 { memo.chrome_height } else { 64.0 };
    let body_max = (outer_max_h - chrome_h).max(48.0);

    let stroke = match flash {
        Some(t) if !look.reduced_motion => Stroke::new(1.0 + 2.5 * (t * std::f32::consts::PI).sin(), colors.accent),
        Some(_) => Stroke::new(3.0, colors.accent),
        None if v.pinned => Stroke::new(1.5, colors.accent),
        None => Stroke::new(1.0, colors.border),
    };
    let frame = Frame::new().fill(colors.bg).stroke(stroke).corner_radius(8).shadow(colors.shadow).inner_margin(MARGIN);

    let mut hint_top = None;
    // previews are tooltips, pinned windows non-modal dialogs (SPEC §6)
    let area = egui::Area::new(area_id(v.id))
        .order(Order::Foreground)
        .fixed_pos(pos)
        .constrain(true)
        .fade_in(!look.reduced_motion)
        .role(if v.pinned { Role::Dialog } else { Role::Tooltip })
        .accessible_name(c.title.clone())
        .show(ctx, |ui| {
            ui.style_mut().interaction.selectable_labels = false;
            let framed = frame.show(ui, |ui| {
                ui.set_min_width(inner_min);
                ui.set_max_width(inner_max);
                ui.spacing_mut().item_spacing.y = 2.0;

                // title bar: title, fallback badge, pin, close
                let mut title_w = 0.0;
                let head = ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 4.0;
                    let start = ui.cursor().left();
                    ui.add(Label::new(RichText::new(&c.title).strong()).wrap_mode(TextWrapMode::Extend));
                    if let Some(badge) = &c.badge {
                        Frame::new()
                            .stroke(Stroke::new(1.0, colors.weak))
                            .corner_radius(3)
                            .inner_margin(Margin::symmetric(3, 0))
                            .show(ui, |ui| ui.label(RichText::new(badge).small().color(colors.weak)))
                            .response
                            .on_hover_text(&c.fallback_tip);
                    }
                    let buttons = f32::from(u8::from(c.pin_button) + u8::from(c.close_button)) * (button + 4.0);
                    let used = ui.cursor().left() - start;
                    title_w = used + buttons;
                    let target = memo.natural_width.min(inner_max);
                    if target > title_w {
                        ui.add_space(target - title_w);
                    }
                    if c.pin_button {
                        let label = if v.pinned { &c.unpin_label } else { &c.pin_label };
                        let r = icon_button(ui, Icon::Pin, v.pinned, label, colors, button);
                        out.focusables.push(r.id);
                        out.buttons.push((r.id, Icon::Pin));
                        out.pin_clicked = r.clicked();
                    }
                    if c.close_button {
                        let r = icon_button(ui, Icon::Close, false, &c.close_label, colors, button);
                        out.focusables.push(r.id);
                        out.buttons.push((r.id, Icon::Close));
                        out.close_clicked = r.clicked();
                    }
                });
                out.head = head.response.rect;

                // body
                ui.add_space(2.0);
                let mut counter = Counter::default();
                let body = ScrollArea::vertical()
                    .id_salt(("deeptip-body", v.id))
                    .max_height(body_max)
                    .auto_shrink([true, true])
                    .show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 6.0;
                        render_blocks(
                            ui,
                            &c.blocks,
                            &c.text,
                            Owner::Window(v.id),
                            state,
                            colors,
                            &mut counter,
                            &mut out.links,
                        );
                    });
                let mut natural = title_w.max(body.content_size.x);
                let body_h = body.inner_rect.height();

                // see also
                if !c.see.is_empty() {
                    ui.add_space(4.0);
                    let see = ui.horizontal_wrapped(|ui| {
                        ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                        ui.label(RichText::new(format!("{} ", c.see_label)).small().color(colors.weak));
                        for (i, key) in c.see.iter().enumerate() {
                            if i > 0 {
                                ui.label(RichText::new(", ").small());
                            }
                            let nodes = [Inline::Link { key: key.clone(), text: None }];
                            render_runs(
                                ui,
                                &runs(&nodes),
                                &c.text,
                                Owner::Window(v.id),
                                state,
                                colors,
                                &mut counter,
                                &mut out.links,
                                true,
                            );
                        }
                    });
                    natural = natural.max(see.response.rect.width());
                }

                // hint line in previews
                if let Some(hint) = c.hint.as_ref().filter(|_| !coarse) {
                    ui.add_space(6.0);
                    let r = ui.label(RichText::new(hint).small().color(colors.weak));
                    hint_top = Some(r.rect.top() - 3.0);
                    natural = natural.max(r.rect.width());
                }
                out.natural_width = natural.max(inner_min);
                out.chrome_height = (ui.min_rect().height() - body_h).max(0.0) + f32::from(MARGIN.top + MARGIN.bottom);
            });
            for l in &out.links {
                out.focusables.push(l.widget);
            }
            framed.response.rect
        });
    let rect = area.inner;
    out.rect = area.response.rect;
    out.background_clicked = area.response.clicked();

    // hint separator and timer-lock bar, painted over the frame
    let painter = ctx.layer_painter(layer_of(v.id));
    if let Some(y) = hint_top {
        painter.hline(rect.x_range(), y, Stroke::new(1.0, colors.border));
    }
    if let Some(p) = lock {
        let bar = ERect::from_min_max(
            pos2(rect.left(), rect.bottom() - 2.0),
            pos2(rect.left() + rect.width() * p, rect.bottom()),
        );
        painter.rect_filled(bar, 0, colors.accent);
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Icon {
    Pin,
    Close,
}

fn icon_button(ui: &mut Ui, icon: Icon, active: bool, label: &str, colors: &Colors, size: f32) -> Response {
    let (rect, resp) = ui.allocate_exact_size(vec2(size, size), Sense::click());
    resp.widget_info(|| match icon {
        Icon::Pin => WidgetInfo::selected(Role::Button, true, active, label),
        Icon::Close => WidgetInfo::labeled(Role::Button, true, label),
    });
    if ui.is_rect_visible(rect) {
        let painter = ui.painter();
        if resp.hovered() || resp.has_focus() {
            painter.rect_filled(rect, 4, colors.hover_bg);
        }
        let color = if active {
            colors.accent
        } else if resp.hovered() {
            colors.text
        } else {
            colors.weak
        };
        let stroke = Stroke::new(1.6, color);
        let c = rect.center();
        match icon {
            Icon::Close => {
                let r = ERect::from_center_size(c, vec2(8.5, 8.5));
                painter.line_segment([r.left_top(), r.right_bottom()], stroke);
                painter.line_segment([r.right_top(), r.left_bottom()], stroke);
            }
            Icon::Pin => {
                // the push pin of the web version (Lucide "pin"), 15 px in a 24-unit box; filled when pinned
                let s = 15.0 / 24.0;
                let p = |x: f32, y: f32| pos2(c.x + (x - 12.0) * s, c.y + (y - 12.0) * s);
                let base = [
                    p(9.0, 10.8),
                    p(15.0, 10.8),
                    p(18.0, 12.4),
                    p(19.0, 14.6),
                    p(19.0, 17.0),
                    p(5.0, 17.0),
                    p(5.0, 14.6),
                    p(6.0, 12.4),
                ];
                if active {
                    let cap = vec![p(8.0, 2.0), p(16.0, 2.0), p(16.0, 6.0), p(8.0, 6.0)];
                    let body = vec![p(9.0, 6.0), p(15.0, 6.0), p(15.0, 11.0), p(9.0, 11.0)];
                    for part in [cap, body, base.to_vec()] {
                        painter.add(egui::Shape::convex_polygon(part, color, Stroke::NONE));
                    }
                }
                let mut outline = vec![p(8.0, 2.0), p(16.0, 2.0), p(16.0, 6.0), p(15.0, 6.8)];
                outline.extend_from_slice(&base[1..]);
                outline.extend_from_slice(&[base[0], p(9.0, 6.8), p(8.0, 6.0)]);
                painter.add(egui::Shape::closed_line(outline, stroke));
                painter.line_segment([p(12.0, 17.0), p(12.0, 22.0)], stroke);
            }
        }
        if resp.has_focus() {
            painter.rect_stroke(rect, 4, Stroke::new(1.5, colors.accent), StrokeKind::Inside);
        }
    }
    resp.on_hover_cursor(CursorIcon::PointingHand).on_hover_text(label)
}

#[allow(clippy::too_many_arguments)]
fn render_blocks(
    ui: &mut Ui,
    blocks: &[Block],
    text: &TextCtx,
    owner: Owner,
    state: &LinkState,
    colors: &Colors,
    counter: &mut Counter,
    out: &mut Vec<LinkHit>,
) {
    for block in blocks {
        match block {
            Block::P(nodes) => {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                    render_runs(ui, &runs(nodes), text, owner, state, colors, counter, out, false);
                });
            }
            Block::Ul(items) => {
                for item in items {
                    ui.horizontal_top(|ui| {
                        ui.spacing_mut().item_spacing.x = 6.0;
                        ui.label("•");
                        ui.vertical(|ui| {
                            ui.horizontal_wrapped(|ui| {
                                ui.spacing_mut().item_spacing = vec2(0.0, 0.0);
                                render_runs(ui, &runs(item), text, owner, state, colors, counter, out, false);
                            });
                        });
                    });
                }
            }
        }
    }
}

fn emphasize(mut rt: RichText, em: Emphasis) -> RichText {
    if em.bold {
        rt = rt.strong();
    }
    if em.italic {
        rt = rt.italics();
    }
    rt
}

#[allow(clippy::too_many_arguments)]
fn render_runs(
    ui: &mut Ui,
    runs: &[Run<'_>],
    text: &TextCtx,
    owner: Owner,
    state: &LinkState,
    colors: &Colors,
    counter: &mut Counter,
    out: &mut Vec<LinkHit>,
    small: bool,
) {
    let size = |rt: RichText| if small { rt.small() } else { rt };
    for run in runs {
        match *run {
            Run::Text { text: t, em } => {
                ui.add(Label::new(size(emphasize(RichText::new(t), em))));
            }
            Run::Code { text: t, em } => {
                ui.add(Label::new(size(emphasize(RichText::new(t).code(), em))));
            }
            Run::Var { name, em } => {
                let v = text.values.get(name).cloned().unwrap_or_else(|| format!("{{{name}}}"));
                ui.add(Label::new(size(emphasize(RichText::new(v).strong().color(colors.value), em))));
            }
            Run::Break => ui.end_row(),
            Run::Link { key, text: own, em } => {
                let title = text.titles.get(key).cloned().flatten();
                let label = own.map(str::to_owned).or_else(|| title.clone()).unwrap_or_else(|| key.to_owned());
                if text.self_key.as_deref() == Some(key) {
                    // a link to the window's own entry is just bold text
                    ui.add(Label::new(size(emphasize(RichText::new(label), em).strong())));
                    continue;
                }
                if title.is_none() {
                    ui.add(Label::new(size(emphasize(RichText::new(label).color(colors.missing).underline(), em))))
                        .on_hover_text(&text.missing_tip);
                    continue;
                }
                let anchor = counter.anchor(owner, key);
                let open = state.open.contains(&anchor);
                let hovered = state.hovered.as_ref() == Some(&anchor);
                let mut rt =
                    emphasize(RichText::new(&label), em).color(if hovered { colors.link_hover } else { colors.link });
                if open || hovered {
                    rt = rt.underline();
                }
                if open {
                    rt = rt.background_color(colors.open_bg);
                }
                let resp = ui.add(Label::new(size(rt)).sense(Sense::click()));
                resp.widget_info(|| WidgetInfo::labeled(Role::Link, true, &label));
                let keyboard = resp.has_focus() && ui.input(|i| i.key_pressed(Key::Enter) || i.key_pressed(Key::Space));
                let resp = resp.on_hover_cursor(CursorIcon::PointingHand);
                out.push(LinkHit {
                    anchor,
                    key: key.to_owned(),
                    parent: match owner {
                        Owner::Window(w) => Some(w),
                        Owner::Page(_) => None,
                    },
                    rect: resp.rect,
                    widget: resp.id,
                    hovered: resp.hovered(),
                    clicked: resp.clicked(),
                    keyboard,
                });
            }
        }
    }
}
