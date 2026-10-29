//! The controller: glossary, window tree and the terminal rendering (`DeepTip`).

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};

use deeptip::engine::HOLD;
use deeptip::{
    collect_refs, parse_text, AnchorId, Block, Emphasis, Engine, Event, Glossary, Hover, LinkHover, Options, Side,
    TrigHover, Via, WinId, Window,
};
use ratatui::buffer::Buffer;
use ratatui::crossterm::event::{
    Event as TermEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::Frame;

use crate::geometry::{centre_px, place_in_cells, rect_px, CELL};
use crate::layout::{self, lay_out, truncate, width, Kind, Laid, Piece, TextCtx};

/// Esc presses closer together than this (ms) count as auto-repeat on terminals that report no key releases.
pub const ESC_REPEAT: f64 = 120.0;
/// Redraw interval (ms) while something animates (flash, timer-lock bar, rest progress).
pub const ANIMATION: f64 = 50.0;

/// Per-element options for [`DeepTip::mark_with`].
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarkOptions {
    /// Own rest time in ms (web: `data-deeptip-delay`), e.g. `Some(0.0)` for a help button.
    pub delay: Option<f64>,
    /// Own side order for the first window (web: `data-deeptip-place`). Empty = [`Options::root`].
    pub place: Vec<Side>,
    /// The application's keyboard focus is on this element: `F1`, `?` and gamepad Y open its window.
    pub focused: bool,
    /// A text field: `?` is typed into it instead of opening the window, and typing hushes it.
    pub text_input: bool,
    /// A stable id when the same key is marked more than once and the order of those elements can change.
    pub id: Option<u64>,
}

/// What [`DeepTip::mark`] reports about an element (web: `data-dt-open`, `data-dt-arming`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MarkState {
    /// A window is open for this element: hide your own simple tooltip.
    pub open: bool,
    /// The pointer rests on it: progress 0‥1 until its window opens.
    pub arming: Option<f32>,
}

/// Characters of the window chrome. [`Symbols::ascii`] for terminals without box-drawing glyphs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Symbols {
    /// Corners and edges of the frame.
    pub top_left: &'static str,
    /// Top-right corner.
    pub top_right: &'static str,
    /// Bottom-left corner.
    pub bottom_left: &'static str,
    /// Bottom-right corner.
    pub bottom_right: &'static str,
    /// Horizontal edge.
    pub horizontal: &'static str,
    /// Vertical edge.
    pub vertical: &'static str,
    /// Pin button of a preview.
    pub pin: &'static str,
    /// Pin button of a pinned window.
    pub pinned: &'static str,
    /// Close button.
    pub close: &'static str,
    /// List bullet.
    pub bullet: &'static str,
    /// Timer-lock bar on the bottom edge.
    pub lock: &'static str,
    /// Scroll thumb on the right edge.
    pub thumb: &'static str,
    /// Marks cut text.
    pub ellipsis: &'static str,
}

impl Default for Symbols {
    fn default() -> Self {
        Self {
            top_left: "╭",
            top_right: "╮",
            bottom_left: "╰",
            bottom_right: "╯",
            horizontal: "─",
            vertical: "│",
            pin: "○",
            pinned: "●",
            close: "✕",
            bullet: "•",
            lock: "━",
            thumb: "┃",
            ellipsis: "…",
        }
    }
}

impl Symbols {
    /// Plain ASCII, for consoles whose font has no box-drawing characters.
    pub fn ascii() -> Self {
        Self {
            top_left: "+",
            top_right: "+",
            bottom_left: "+",
            bottom_right: "+",
            horizontal: "-",
            vertical: "|",
            pin: "o",
            pinned: "*",
            close: "x",
            bullet: "*",
            lock: "=",
            thumb: "#",
            ellipsis: "...",
        }
    }
}

/// Look of the windows (SPEC §8 for a terminal). Colours are the terminal's own 16 colours by default, so the
/// user's colour scheme (light or dark) applies.
#[derive(Clone, Debug, PartialEq)]
pub struct Look {
    /// Nominal pixel size of a cell (width, height); DeepTip's pixel constants are converted with it.
    pub cell: (f64, f64),
    /// Narrowest window in columns (240 px / 8).
    pub min_width: u16,
    /// Widest window in columns (384 px / 8).
    pub max_width: u16,
    /// Tallest window in rows (480 px / 16); longer text scrolls.
    pub max_height: u16,
    /// Window background (`Style::default()` = the terminal's background).
    pub background: Style,
    /// Body text.
    pub text: Style,
    /// Labels, hint line, badge.
    pub weak: Style,
    /// Frame of a preview.
    pub border: Style,
    /// Frame of a pinned window, flash, timer-lock bar, scroll thumb.
    pub accent: Style,
    /// Window title.
    pub title: Style,
    /// Terms.
    pub link: Style,
    /// A term under the pointer.
    pub link_hover: Style,
    /// Added to a term whose window is open.
    pub link_open: Style,
    /// Added to the term or button that has the keyboard focus.
    pub focus: Style,
    /// Links to missing entries.
    pub missing: Style,
    /// Inline code.
    pub code: Style,
    /// Live values.
    pub value: Style,
    /// Frame glyphs and buttons.
    pub symbols: Symbols,
    /// No flashing frame (the timer-lock bar still runs, it is a timer).
    pub reduced_motion: bool,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            cell: CELL,
            min_width: 30,
            max_width: 48,
            max_height: 30,
            background: Style::default(),
            text: Style::default(),
            weak: Style::default().fg(Color::DarkGray),
            border: Style::default().fg(Color::Gray),
            accent: Style::default().fg(Color::LightBlue),
            title: Style::default().add_modifier(Modifier::BOLD),
            link: Style::default().fg(Color::Cyan).add_modifier(Modifier::UNDERLINED),
            link_hover: Style::default().fg(Color::LightCyan).add_modifier(Modifier::UNDERLINED | Modifier::BOLD),
            link_open: Style::default().add_modifier(Modifier::BOLD),
            focus: Style::default().add_modifier(Modifier::REVERSED),
            missing: Style::default().fg(Color::Red).add_modifier(Modifier::DIM),
            code: Style::default().fg(Color::Yellow),
            value: Style::default().add_modifier(Modifier::BOLD),
            symbols: Symbols::default(),
            reduced_motion: false,
        }
    }
}

/// Where the keyboard focus of DeepTip is. `None` from [`DeepTip::focus`] = the application has it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Focus {
    /// A term in a window or on a page.
    Term(AnchorId),
    /// The pin button of a window.
    Pin(WinId),
    /// The close button of a window.
    Close(WinId),
    /// A window without terms and buttons.
    Window(WinId),
}

/// Input the terminal does not deliver, e.g. a gamepad read with `gilrs` (SPEC §5, algorithms §9.4): Y →
/// `OpenFocused`, A → `Activate`, B tap → `CloseNewest`, B held 600 ms → `CloseAll`, RB / LB → `Cycle(1)` /
/// `Cycle(-1)`, d-pad → `Step(±1)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Open the window of the focused element or term, pinned, focus moves in.
    OpenFocused,
    /// Close the newest window opened from the focused one (or the newest).
    CloseNewest,
    /// Close every window.
    CloseAll,
    /// Focus the next older (`1`) or newer (`-1`) window.
    Cycle(i32),
    /// Focus the next (`1`) or previous (`-1`) term or button of the focused window, wrapping.
    Step(i32),
    /// Follow the focused term or press the focused button.
    Activate,
}

/// A term drawn in the last frame (tests, tutorials, highlighting).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermInfo {
    /// Its anchor.
    pub anchor: AnchorId,
    /// The key it opens.
    pub key: String,
    /// Its first visible fragment.
    pub area: Rect,
    /// The window it is in (`None` = on a page).
    pub window: Option<WinId>,
}

/// The state of an encyclopedia drawn with [`DeepTip::index`]; keep it in the application.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IndexState {
    /// The search text.
    pub query: String,
    /// First visible line of the list.
    pub scroll: u16,
    /// Show a cursor in the search line (the application's focus is there).
    pub editing: bool,
}

#[derive(Clone, Debug)]
struct Mark {
    anchor: AnchorId,
    key: String,
    area: Rect,
    opts: MarkOptions,
}

#[derive(Clone, Debug)]
struct PageTerm {
    anchor: AnchorId,
    key: String,
    frags: Vec<Rect>,
    bbox: Option<Rect>,
}

/// Marks and page terms of one frame.
#[derive(Clone, Debug, Default)]
struct Collected {
    marks: Vec<Mark>,
    pages: Vec<PageTerm>,
    keys: HashMap<String, u32>,
    texts: HashMap<u64, u32>,
}

#[derive(Clone, Debug)]
struct TermHit {
    anchor: AnchorId,
    key: String,
    frags: Vec<Rect>,
}

/// A drawn window, for hit-testing until the next frame.
#[derive(Clone, Debug)]
struct WinLayout {
    id: WinId,
    rect: Rect,
    pin: Option<Rect>,
    close: Option<Rect>,
    terms: Vec<TermHit>,
    rows: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Part {
    Close(WinId),
    Pin(WinId),
    Term(WinId, AnchorId, String),
    Body(WinId),
    Page(AnchorId, String),
}

/// Everything a window shows.
#[derive(Clone, Debug)]
struct Content {
    title: String,
    badge: Option<String>,
    blocks: Vec<Block>,
    see: Vec<String>,
    see_label: String,
    hint: Option<String>,
    ctx: TextCtx,
}

/// A window laid out and placed, not drawn yet.
struct Built {
    id: WinId,
    rect: Rect,
    content: Content,
    laid: Laid,
    anchors: Vec<AnchorId>,
}

#[derive(Clone, Copy, Debug, Default)]
struct Esc {
    last: Option<f64>,
    hold_since: Option<f64>,
    down: bool,
}

#[derive(Clone, Copy, Debug)]
enum Clock {
    Real(Instant),
    Manual(f64),
}

type ValueFn = Box<dyn Fn(&str, &str) -> Option<String>>;

fn hash_of<T: Hash>(t: T) -> u64 {
    let mut h = DefaultHasher::new();
    t.hash(&mut h);
    h.finish()
}

fn hit(r: Rect, x: u16, y: u16) -> bool {
    u32::from(x) >= u32::from(r.x)
        && u32::from(x) < u32::from(r.x) + u32::from(r.width)
        && u32::from(y) >= u32::from(r.y)
        && u32::from(y) < u32::from(r.y) + u32::from(r.height)
}

fn put(buf: &mut Buffer, x: u16, y: u16, symbol: &str, style: Style) {
    if let Some(cell) = buf.cell_mut((x, y)) {
        cell.set_symbol(symbol).set_style(style);
    }
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

/// Sort key for the encyclopedia: lower case without the common Latin accents.
fn fold(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.to_lowercase().chars() {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => out.push('a'),
            'æ' => out.push_str("ae"),
            'ç' | 'ć' | 'č' => out.push('c'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ě' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' => out.push('i'),
            'ñ' | 'ń' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' => out.push('o'),
            'œ' => out.push_str("oe"),
            'ß' => out.push_str("ss"),
            'š' | 'ś' => out.push('s'),
            'ù' | 'ú' | 'û' | 'ü' | 'ů' => out.push('u'),
            'ý' | 'ÿ' => out.push('y'),
            'ž' | 'ź' | 'ż' => out.push('z'),
            c => out.push(c),
        }
    }
    out
}

/// DeepTip for one Ratatui application: the glossary, the window tree and the terminal rendering.
///
/// Per frame: draw your UI and call [`mark`](Self::mark) with the area of every element that has an explanation
/// ([`text`](Self::text) for markup with terms, [`index`](Self::index) for the encyclopedia), then
/// [`render`](Self::render) once at the end. Pass every terminal event to [`handle_event`](Self::handle_event)
/// first and skip it in your own handling when it returns `true`. Poll for events no longer than
/// [`timeout`](Self::timeout).
pub struct DeepTip {
    /// Entries per locale, the locale chain and the `$ui` labels.
    pub glossary: Glossary,
    /// The window tree and its timing; `engine.options` holds the behaviour options (SPEC §7).
    pub engine: Engine,
    /// Sizes, colours and glyphs of the windows.
    pub look: Look,
    values: HashMap<String, String>,
    value_fn: Option<ValueFn>,
    clock: Clock,
    frame: Collected,
    last: Collected,
    layouts: Vec<WinLayout>,
    places: HashMap<WinId, Rect>,
    anchor_boxes: HashMap<WinId, Rect>,
    scroll: HashMap<WinId, usize>,
    viewport: Rect,
    pointer: Option<(u16, u16)>,
    press: Option<Part>,
    swallow_right_up: bool,
    focus: Option<Focus>,
    /// The focus the bodies were last scrolled for (scroll into view only when it changes).
    shown_focus: Option<Focus>,
    pending_focus: Option<WinId>,
    esc: Esc,
    releases: bool,
    hovered: Option<AnchorId>,
    warned: HashSet<String>,
    events: Vec<Event>,
    next_due: Option<f64>,
    dirty: bool,
}

impl std::fmt::Debug for DeepTip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeepTip")
            .field("locale", &self.glossary.locale())
            .field("windows", &self.engine.windows().len())
            .field("focus", &self.focus)
            .finish_non_exhaustive()
    }
}

impl Default for DeepTip {
    fn default() -> Self {
        Self::new("en", &["en"])
    }
}

impl DeepTip {
    /// DeepTip for `locale` with fallback locales (SPEC §2.3), default options and look, a real clock.
    pub fn new(locale: &str, fallback: &[&str]) -> Self {
        Self {
            glossary: Glossary::new(locale, fallback),
            engine: Engine::new(Options::default()),
            look: Look::default(),
            values: HashMap::new(),
            value_fn: None,
            clock: Clock::Real(Instant::now()),
            frame: Collected::default(),
            last: Collected::default(),
            layouts: Vec::new(),
            places: HashMap::new(),
            anchor_boxes: HashMap::new(),
            scroll: HashMap::new(),
            viewport: Rect::default(),
            pointer: None,
            press: None,
            swallow_right_up: false,
            focus: None,
            shown_focus: None,
            pending_focus: None,
            esc: Esc::default(),
            releases: false,
            hovered: None,
            warned: HashSet::new(),
            events: Vec::new(),
            next_due: None,
            dirty: false,
        }
    }

    /* ------------------------------------------------------------------ data */

    /// Glossary files per locale, `{locale}` is replaced; source order is layer order (core first, project
    /// after). Loads them for the locale chain; returns the files that could not be loaded.
    pub fn set_sources<S: AsRef<str>>(&mut self, sources: &[S]) -> Vec<String> {
        self.dirty = true;
        self.glossary.set_sources(sources)
    }

    /// Switch the language (loads missing files); open windows and page texts follow on the next frame.
    pub fn set_locale(&mut self, locale: &str) -> Vec<String> {
        self.dirty = true;
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

    /* ------------------------------------------------------------------ time */

    /// The clock in milliseconds (monotonic; manual after [`set_time`](Self::set_time)).
    pub fn now(&self) -> f64 {
        match self.clock {
            Clock::Real(t0) => t0.elapsed().as_secs_f64() * 1000.0,
            Clock::Manual(t) => t,
        }
    }

    /// Switch to a manual clock at `ms` (tests, replays). Time then only moves when you set it.
    pub fn set_time(&mut self, ms: f64) {
        self.clock = Clock::Manual(ms);
    }

    /// Run the timers that are due (opening, grace, timer lock). Returns `true` when the screen should be
    /// redrawn. [`render`](Self::render) does this too.
    pub fn tick(&mut self) -> bool {
        let now = self.now();
        self.next_due = self.engine.tick(now);
        let events = self.engine.take_events();
        let changed = !events.is_empty();
        self.events.extend(events);
        self.dirty |= changed;
        self.dirty || self.animating(now)
    }

    /// How long the application may wait for the next terminal event before it must draw again: `Some(0)` after
    /// a change, the time to the next DeepTip timer, 50 ms while something animates, `None` when nothing is
    /// pending.
    pub fn timeout(&self) -> Option<Duration> {
        if self.dirty {
            return Some(Duration::ZERO);
        }
        let now = self.now();
        let mut ms = self.next_due.map(|d| (d - now).max(0.0));
        if self.animating(now) {
            ms = Some(ms.map_or(ANIMATION, |m| m.min(ANIMATION)));
        }
        ms.map(|m| Duration::from_secs_f64(m / 1000.0))
    }

    fn animating(&self, now: f64) -> bool {
        self.engine.arming(now).is_some()
            || self.engine.windows().iter().any(|w| {
                self.engine.lock_progress(w.id, now).is_some() || self.engine.flash_progress(w.id, now).is_some()
            })
    }

    /* ------------------------------------------------------------------ marking (during the draw) */

    /// Give an element an explanation (web: `data-deeptip`): `area` is where it was drawn this frame. Call every
    /// frame, during your draw.
    pub fn mark(&mut self, area: Rect, key: &str) -> MarkState {
        self.mark_with(area, key, MarkOptions::default())
    }

    /// [`mark`](Self::mark) with own options (delay, side order, keyboard focus, text field, id).
    pub fn mark_with(&mut self, area: Rect, key: &str, opts: MarkOptions) -> MarkState {
        let id = opts.id.unwrap_or_else(|| {
            let n = self.frame.keys.entry(key.to_owned()).or_insert(0);
            let id = hash_of(("deeptip-mark", key, *n));
            *n += 1;
            id
        });
        let anchor = AnchorId::Element(id);
        let now = self.now();
        let state = MarkState {
            open: self.engine.window_for(&anchor).is_some(),
            arming: self.engine.arming(now).filter(|(a, _)| *a == &anchor).map(|(_, p)| p as f32),
        };
        self.frame.marks.push(Mark { anchor, key: key.to_owned(), area, opts });
        state
    }

    /// Draw DeepTip markup with live terms on a page (web: `renderText`), wrapped to `area`. Returns the number
    /// of lines the text needs (it may be more than `area.height`; the rest is cut).
    pub fn text(&mut self, buf: &mut Buffer, area: Rect, markup: &str) -> u16 {
        self.text_scrolled(buf, area, markup, 0)
    }

    /// [`text`](Self::text) starting at line `scroll`.
    pub fn text_scrolled(&mut self, buf: &mut Buffer, area: Rect, markup: &str, scroll: u16) -> u16 {
        let blocks = parse_text(markup);
        let ctx = self.text_ctx(&blocks, &[], None);
        let laid = lay_out(&blocks, None, &ctx, area.width.max(1), self.look.symbols.bullet);
        let base = hash_of(markup);
        let n = self.frame.texts.entry(base).or_insert(0);
        let id = hash_of((base, *n));
        *n += 1;
        self.draw_page(buf, area, &laid, id, usize::from(scroll));
        laid.lines.len() as u16
    }

    /// How many lines [`text`](Self::text) needs at `width` columns (for the application's layout).
    pub fn text_rows(&mut self, width: u16, markup: &str) -> u16 {
        let blocks = parse_text(markup);
        let ctx = self.text_ctx(&blocks, &[], None);
        lay_out(&blocks, None, &ctx, width.max(1), self.look.symbols.bullet).lines.len() as u16
    }

    /// The encyclopedia (SPEC §2.7, algorithms §12): a search line and every entry sorted by title, with its
    /// `short` text and "Mentioned in" backlinks, all terms live. Feed keys to [`index_input`](Self::index_input)
    /// while your focus is on it.
    pub fn index(&mut self, buf: &mut Buffer, area: Rect, state: &mut IndexState) {
        let area = area.intersection(buf.area);
        if area.height == 0 || area.width == 0 {
            return;
        }
        let search = Rect { height: 1, ..area };
        if state.query.is_empty() {
            let mut placeholder = truncate(&self.glossary.label("search"), search.width, self.look.symbols.ellipsis);
            if state.editing {
                placeholder.insert(0, '▏');
            }
            buf.set_stringn(search.x, search.y, placeholder, usize::from(search.width), self.look.weak);
        } else {
            let line = format!("{}{}", state.query, if state.editing { "▏" } else { "" });
            buf.set_stringn(search.x, search.y, line, usize::from(search.width), self.look.text);
        }
        let list = Rect { y: area.y + 1, height: area.height - 1, ..area };
        let q = state.query.trim().to_lowercase();
        let mut rows: Vec<(String, deeptip::Entry)> = self
            .glossary
            .keys()
            .into_iter()
            .filter_map(|k| self.glossary.entry(&k).map(|f| (k.clone(), f.entry.clone())))
            .filter(|(k, e)| {
                let find = [
                    e.title.clone().unwrap_or_default(),
                    k.clone(),
                    e.aliases.join(" "),
                    e.short.clone().unwrap_or_default(),
                ]
                .join(" ")
                .to_lowercase();
                q.is_empty() || find.contains(&q)
            })
            .collect();
        rows.sort_by_cached_key(|(k, e)| fold(e.title.as_deref().unwrap_or(k)));
        if rows.is_empty() {
            let empty = self.glossary.label("empty");
            buf.set_stringn(list.x, list.y, empty, usize::from(list.width), self.look.weak);
            return;
        }
        let back = self.glossary.backlinks();
        let mentioned = escape_markup(&self.glossary.label("mentionedIn"));
        let entries: Vec<String> = rows
            .iter()
            .map(|(k, e)| {
                let mut s = format!("**[[{k}]]**");
                if let Some(short) = &e.short {
                    s.push('\n');
                    s.push_str(short);
                }
                if let Some(b) = back.get(k).filter(|b| !b.is_empty()) {
                    let links: Vec<String> = b.iter().map(|x| format!("[[{x}]]")).collect();
                    s.push_str(&format!("\n*{mentioned}:* {}", links.join(", ")));
                }
                s
            })
            .collect();
        let markup = entries.join("\n\n");
        let blocks = parse_text(&markup);
        let ctx = self.text_ctx(&blocks, &[], None);
        let laid = lay_out(&blocks, None, &ctx, list.width.max(1), self.look.symbols.bullet);
        let max_scroll = laid.lines.len().saturating_sub(usize::from(list.height));
        state.scroll = state.scroll.min(max_scroll as u16);
        let n = self.frame.texts.entry(hash_of("deeptip-index")).or_insert(0);
        let id = hash_of(("deeptip-index", *n));
        *n += 1;
        self.draw_page(buf, list, &laid, id, usize::from(state.scroll));
    }

    /// Keys for the search line of an encyclopedia while your focus is on it: printable characters, Backspace,
    /// and scrolling with ↑ ↓ PageUp PageDown. Returns `true` when the key was used.
    pub fn index_input(&mut self, state: &mut IndexState, key: &KeyEvent) -> bool {
        if key.kind == KeyEventKind::Release {
            return false;
        }
        match key.code {
            KeyCode::Char(c) if !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                state.query.push(c);
                state.scroll = 0;
            }
            KeyCode::Backspace => {
                state.query.pop();
                state.scroll = 0;
            }
            KeyCode::Down => state.scroll = state.scroll.saturating_add(1),
            KeyCode::Up => state.scroll = state.scroll.saturating_sub(1),
            KeyCode::PageDown => state.scroll = state.scroll.saturating_add(5),
            KeyCode::PageUp => state.scroll = state.scroll.saturating_sub(5),
            _ => return false,
        }
        self.dirty = true;
        true
    }

    /* ------------------------------------------------------------------ queries */

    /// Events since the last call: opened, closed, pinned, unpinned (web: `onOpen`, `onClose`, `onPin`).
    pub fn take_events(&mut self) -> Vec<Event> {
        self.events.extend(self.engine.take_events());
        std::mem::take(&mut self.events)
    }

    /// DeepTip's keyboard focus; `None` = the application has the keyboard.
    pub fn focus(&self) -> Option<&Focus> {
        self.focus.as_ref()
    }

    /// The window that holds DeepTip's keyboard focus.
    pub fn focused_window(&self) -> Option<WinId> {
        let id = match self.focus.as_ref()? {
            Focus::Term(AnchorId::Term(w, ..)) | Focus::Pin(w) | Focus::Close(w) | Focus::Window(w) => *w,
            Focus::Term(_) => return None,
        };
        self.engine.is_open(id).then_some(id)
    }

    /// The terms drawn in the last frame, in windows (oldest window first) and on pages.
    pub fn terms(&self) -> Vec<TermInfo> {
        let mut out = Vec::new();
        for l in &self.layouts {
            for t in &l.terms {
                if let Some(r) = t.frags.first() {
                    out.push(TermInfo { anchor: t.anchor.clone(), key: t.key.clone(), area: *r, window: Some(l.id) });
                }
            }
        }
        for p in &self.last.pages {
            if let Some(r) = p.frags.first() {
                out.push(TermInfo { anchor: p.anchor.clone(), key: p.key.clone(), area: *r, window: None });
            }
        }
        out
    }

    /// Where a window was drawn in the last frame.
    pub fn window_area(&self, id: WinId) -> Option<Rect> {
        self.layouts.iter().find(|l| l.id == id).map(|l| l.rect)
    }

    /* ------------------------------------------------------------------ windows from code */

    /// Open the window of the first element marked with `key` in the last frame, as if the pointer had rested
    /// on it (`pinned` = as if it had been clicked). `None` when no element has that key.
    pub fn open(&mut self, key: &str, pinned: bool) -> Option<WinId> {
        let m = self.last.marks.iter().find(|m| m.key == key)?.clone();
        let now = self.now();
        self.dirty = true;
        self.engine.open(&m.key, m.anchor, None, pinned, false, Via::Api, now)
    }

    /// Close every window.
    pub fn close_all(&mut self) {
        self.dirty = true;
        self.engine.close_all();
    }

    /// Put DeepTip's keyboard focus on the first (`forward`) or last term drawn on pages, for an application
    /// whose focus moves onto a text with terms. `Tab` / `Shift+Tab` then walk the page terms and give the focus
    /// back (the event is not consumed) after the last one. Returns `false` when there is no page term.
    pub fn focus_page_terms(&mut self, forward: bool) -> bool {
        let items = self.page_items();
        let pick = if forward { items.first() } else { items.last() };
        match pick {
            Some(a) => {
                self.focus = Some(Focus::Term(a.clone()));
                self.dirty = true;
                true
            }
            None => false,
        }
    }

    /// Gamepads and other devices the terminal does not report (see [`Action`]).
    pub fn action(&mut self, action: Action) {
        let now = self.now();
        match action {
            Action::OpenFocused => {
                self.open_focused(Via::Pad, false, now);
            }
            Action::CloseNewest => {
                if let Some(id) = self.engine.newest(self.focused_window()) {
                    self.close_focus_back(id);
                }
            }
            Action::CloseAll => self.close_all_focus(),
            Action::Cycle(step) => {
                if let Some(target) = self.engine.cycle(self.focused_window(), step) {
                    self.focus_window(target);
                }
            }
            Action::Step(step) => {
                self.step_focus(step, false);
            }
            Action::Activate => self.activate(now),
        }
        self.after_input(now);
    }

    /* ------------------------------------------------------------------ events */

    /// Feed a terminal event to DeepTip, before your own handling. Returns `true` when DeepTip used it; then
    /// skip it (a click inside a window, Esc that closed one, a key that moved focus inside a window …).
    pub fn handle_event(&mut self, event: &TermEvent) -> bool {
        let now = self.now();
        let used = match event {
            TermEvent::Mouse(m) => self.on_mouse(m, now),
            TermEvent::Key(k) => self.on_key(k, now),
            TermEvent::FocusLost => {
                // the terminal lost focus: the pointer has left the application surface (algorithms §6)
                self.pointer = None;
                self.hovered = None;
                self.engine.set_hover(Hover::default(), now);
                false
            }
            _ => false,
        };
        self.after_input(now);
        used
    }

    fn after_input(&mut self, now: f64) {
        self.next_due = self.engine.tick(now);
        self.events.extend(self.engine.take_events());
        self.dirty = true;
    }

    fn on_mouse(&mut self, m: &MouseEvent, now: f64) -> bool {
        let (x, y) = (m.column, m.row);
        match m.kind {
            MouseEventKind::Moved | MouseEventKind::Drag(_) => {
                self.pointer = Some((x, y));
                let (px, py) = centre_px(x, y, self.look.cell);
                self.engine.pointer_moved(px, py, now);
                self.update_hover(now);
                self.window_at(x, y).is_some()
            }
            MouseEventKind::Down(MouseButton::Left) => {
                self.pointer = Some((x, y));
                let part = self.part_at(x, y);
                match &part {
                    Some(Part::Page(..)) => {
                        self.engine.pointer_down(false, None, false);
                    }
                    None => {
                        let trig = self.mark_at(x, y).map(|m| m.anchor.clone());
                        self.engine.pointer_down(false, trig.as_ref(), false);
                        // a press on the application gives it the keyboard back
                        self.focus = None;
                    }
                    Some(_) => {}
                }
                let used = part.is_some();
                self.press = part;
                used
            }
            MouseEventKind::Up(MouseButton::Left) => {
                let Some(press) = self.press.take() else { return false };
                if self.part_at(x, y).as_ref() == Some(&press) {
                    self.click(press, now);
                }
                true
            }
            MouseEventKind::Down(MouseButton::Right) => {
                // the secondary click is the terminal's long-press: it opens an element's window pinned
                let used = match self.part_at(x, y) {
                    Some(Part::Term(w, a, k)) => {
                        self.engine.follow(a, &k, Some(w), false, now);
                        true
                    }
                    Some(Part::Page(a, k)) => {
                        self.engine.follow(a, &k, None, false, now);
                        true
                    }
                    Some(_) => true,
                    None => match self.mark_at(x, y).cloned() {
                        Some(m) => {
                            self.engine.open_pinned(m.anchor, &m.key, false, Via::Click, now);
                            true
                        }
                        None => false,
                    },
                };
                self.swallow_right_up = used;
                used
            }
            MouseEventKind::Up(MouseButton::Right) => std::mem::take(&mut self.swallow_right_up),
            MouseEventKind::ScrollDown | MouseEventKind::ScrollUp => match self.window_at(x, y) {
                Some(id) => {
                    let s = self.scroll.entry(id).or_insert(0);
                    *s = if m.kind == MouseEventKind::ScrollDown { s.saturating_add(1) } else { s.saturating_sub(1) };
                    true
                }
                None => false,
            },
            _ => self.window_at(x, y).is_some(),
        }
    }

    fn click(&mut self, part: Part, now: f64) {
        match part {
            Part::Close(id) => self.close_focus_back(id),
            Part::Pin(id) => self.engine.toggle_pin(id, now),
            Part::Term(w, a, k) => {
                self.engine.follow(a, &k, Some(w), false, now);
            }
            Part::Body(id) => self.engine.click_inside(id),
            Part::Page(a, k) => {
                self.engine.follow(a, &k, None, false, now);
            }
        }
    }

    fn on_key(&mut self, k: &KeyEvent, now: f64) -> bool {
        if k.kind == KeyEventKind::Release {
            self.releases = true;
            if k.code == KeyCode::Esc {
                self.esc = Esc::default();
            }
            return false;
        }
        if k.code == KeyCode::Esc {
            let repeat = k.kind == KeyEventKind::Repeat;
            return self.on_escape(k.modifiers.contains(KeyModifiers::SHIFT), repeat, now);
        }
        self.esc = Esc::default();
        let shift = k.modifiers.contains(KeyModifiers::SHIFT);
        let plain = !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
        match k.code {
            KeyCode::F(6) if !self.engine.windows().is_empty() => {
                if let Some(target) = self.engine.cycle(self.focused_window(), if shift { -1 } else { 1 }) {
                    self.focus_window(target);
                }
                return true;
            }
            KeyCode::F(1) if self.open_focused(Via::Key, false, now) => return true,
            KeyCode::Char('?') if plain && self.open_focused(Via::Key, true, now) => return true,
            _ => {}
        }
        if self.focus.is_some() && self.focus_key(k, now) {
            return true;
        }
        if matches!(k.code, KeyCode::Char(_)) && plain {
            // typing into a marked field: do not pop its explanation up over the text (algorithms §6, hush)
            let quiet: Vec<AnchorId> =
                self.last.marks.iter().filter(|m| m.opts.focused).map(|m| m.anchor.clone()).collect();
            for a in quiet {
                self.engine.hush(&a);
            }
        }
        false
    }

    /// Esc (algorithms §9.3): a press closes the newest window, Shift+Esc or holding Esc 600 ms closes all, the
    /// auto-repeat of a press DeepTip used never reaches the application.
    fn on_escape(&mut self, shift: bool, repeat_kind: bool, now: f64) -> bool {
        let repeat = repeat_kind
            || (self.releases && self.esc.down)
            || (!self.releases && self.esc.last.is_some_and(|t| now - t < ESC_REPEAT));
        self.esc.last = Some(now);
        self.esc.down = true;
        if repeat {
            let Some(since) = self.esc.hold_since else { return false };
            if !self.engine.windows().is_empty() && now - since >= HOLD {
                self.close_all_focus();
            }
            return true;
        }
        self.esc.hold_since = None;
        if self.engine.windows().is_empty() {
            return false;
        }
        self.esc.hold_since = Some(now);
        if shift {
            self.close_all_focus();
        } else if let Some(id) = self.engine.newest(self.focused_window()) {
            self.close_focus_back(id);
        }
        true
    }

    /// F1 / `?` / gamepad Y: the focused term is followed, the focused marked element opens pinned.
    fn open_focused(&mut self, via: Via, question: bool, now: f64) -> bool {
        match self.focus.clone() {
            Some(Focus::Term(a)) => match self.term_key(&a) {
                Some((key, parent)) => {
                    self.engine.follow(a, &key, parent, true, now);
                    true
                }
                None => false,
            },
            Some(_) => false,
            None => {
                let Some(m) = self.last.marks.iter().rev().find(|m| m.opts.focused).cloned() else { return false };
                if question && m.opts.text_input {
                    return false;
                }
                self.engine.open_pinned(m.anchor, &m.key, true, via, now);
                true
            }
        }
    }

    fn focus_key(&mut self, k: &KeyEvent, now: f64) -> bool {
        match k.code {
            KeyCode::Tab => self.step_focus(1, true),
            KeyCode::BackTab => self.step_focus(-1, true),
            KeyCode::Down | KeyCode::Right => self.step_focus(1, false),
            KeyCode::Up | KeyCode::Left => self.step_focus(-1, false),
            KeyCode::Enter | KeyCode::Char(' ') => {
                self.activate(now);
                true
            }
            KeyCode::PageDown | KeyCode::PageUp => match self.focused_window() {
                Some(w) => {
                    let rows = self.layouts.iter().find(|l| l.id == w).map_or(1, |l| l.rows.max(1));
                    let s = self.scroll.entry(w).or_insert(0);
                    *s = if k.code == KeyCode::PageDown { s.saturating_add(rows) } else { s.saturating_sub(rows) };
                    true
                }
                None => false,
            },
            _ => false,
        }
    }

    /// Move the focus inside the focused window (wrapping), or along the page terms (leaving after the last).
    fn step_focus(&mut self, step: i32, tab: bool) -> bool {
        if let Some(w) = self.focused_window() {
            let items = self.focus_items(w);
            if items.is_empty() {
                return false;
            }
            let n = items.len() as i64;
            let next = match self.focus.as_ref().and_then(|f| items.iter().position(|x| x == f)) {
                None if step > 0 => 0,
                None => n - 1,
                Some(i) => (i as i64 + i64::from(step)).rem_euclid(n),
            };
            self.focus = Some(items[next as usize].clone());
            return true;
        }
        let Some(Focus::Term(current @ AnchorId::Page(..))) = self.focus.clone() else { return false };
        if !tab {
            return false;
        }
        let items = self.page_items();
        let next = items.iter().position(|a| *a == current).map(|i| i as i64 + i64::from(step));
        match next {
            Some(j) if j >= 0 && (j as usize) < items.len() => {
                self.focus = Some(Focus::Term(items[j as usize].clone()));
                true
            }
            _ => {
                self.focus = None; // past the last page term: the application gets the Tab
                false
            }
        }
    }

    fn activate(&mut self, now: f64) {
        match self.focus.clone() {
            Some(Focus::Term(a)) => {
                if let Some((key, parent)) = self.term_key(&a) {
                    self.engine.follow(a, &key, parent, true, now);
                }
            }
            Some(Focus::Pin(w)) => self.engine.toggle_pin(w, now),
            Some(Focus::Close(w)) => self.close_focus_back(w),
            Some(Focus::Window(w)) => self.engine.pin(w),
            None => {}
        }
    }

    /* ------------------------------------------------------------------ focus helpers */

    fn focus_items(&self, win: WinId) -> Vec<Focus> {
        let Some(l) = self.layouts.iter().find(|l| l.id == win) else { return Vec::new() };
        let mut items: Vec<Focus> = l.terms.iter().map(|t| Focus::Term(t.anchor.clone())).collect();
        if l.pin.is_some() {
            items.push(Focus::Pin(win));
        }
        if l.close.is_some() {
            items.push(Focus::Close(win));
        }
        if items.is_empty() {
            items.push(Focus::Window(win));
        }
        items
    }

    fn page_items(&self) -> Vec<AnchorId> {
        let mut seen = HashSet::new();
        self.last.pages.iter().filter(|p| seen.insert(p.anchor.clone())).map(|p| p.anchor.clone()).collect()
    }

    fn focus_window(&mut self, id: WinId) {
        if self.layouts.iter().any(|l| l.id == id) {
            self.focus = self.focus_items(id).into_iter().next();
        } else {
            self.pending_focus = Some(id);
        }
    }

    /// Key and parent window of a term anchor drawn in the last frame.
    fn term_key(&self, a: &AnchorId) -> Option<(String, Option<WinId>)> {
        for l in &self.layouts {
            if let Some(t) = l.terms.iter().find(|t| &t.anchor == a) {
                return Some((t.key.clone(), Some(l.id)));
            }
        }
        self.last.pages.iter().find(|p| &p.anchor == a).map(|p| (p.key.clone(), None))
    }

    /// Close a window; the focus returns to its anchor when it was inside (algorithms §9.5).
    fn close_focus_back(&mut self, id: WinId) {
        let had_focus = self.focused_window().is_some_and(|f| self.engine.is_in_chain(f, id));
        let anchor = self.engine.get(id).map(|w| w.anchor.clone());
        self.engine.close(id);
        if had_focus {
            self.focus = anchor.filter(|a| !matches!(a, AnchorId::Element(_))).map(Focus::Term);
        }
    }

    fn close_all_focus(&mut self) {
        let mut root = self.focused_window();
        while let Some(p) = root.and_then(|r| self.engine.get(r)).and_then(|w| w.parent) {
            root = Some(p);
        }
        let anchor = root.and_then(|r| self.engine.get(r)).map(|w| w.anchor.clone());
        self.engine.close_all();
        if root.is_some() {
            self.focus = anchor.filter(|a| !matches!(a, AnchorId::Element(_))).map(Focus::Term);
        }
    }

    fn check_focus(&mut self) {
        let keep = match &self.focus {
            None => true,
            Some(Focus::Term(a @ AnchorId::Term(..))) => {
                self.layouts.iter().any(|l| l.terms.iter().any(|t| &t.anchor == a))
            }
            Some(Focus::Term(a)) => self.last.pages.iter().any(|p| &p.anchor == a),
            Some(Focus::Pin(w)) | Some(Focus::Close(w)) | Some(Focus::Window(w)) => self.engine.is_open(*w),
        };
        if !keep {
            self.focus = None;
        }
    }

    /* ------------------------------------------------------------------ hit-testing */

    fn window_at(&self, x: u16, y: u16) -> Option<WinId> {
        self.layouts.iter().rev().find(|l| self.engine.is_open(l.id) && hit(l.rect, x, y)).map(|l| l.id)
    }

    fn mark_at(&self, x: u16, y: u16) -> Option<&Mark> {
        self.last.marks.iter().rev().find(|m| hit(m.area, x, y))
    }

    fn part_at(&self, x: u16, y: u16) -> Option<Part> {
        if let Some(l) = self.layouts.iter().rev().find(|l| self.engine.is_open(l.id) && hit(l.rect, x, y)) {
            if l.close.is_some_and(|r| hit(r, x, y)) {
                return Some(Part::Close(l.id));
            }
            if l.pin.is_some_and(|r| hit(r, x, y)) {
                return Some(Part::Pin(l.id));
            }
            if let Some(t) = l.terms.iter().find(|t| t.frags.iter().any(|f| hit(*f, x, y))) {
                return Some(Part::Term(l.id, t.anchor.clone(), t.key.clone()));
            }
            return Some(Part::Body(l.id));
        }
        self.last
            .pages
            .iter()
            .find(|p| p.frags.iter().any(|f| hit(*f, x, y)))
            .map(|p| Part::Page(p.anchor.clone(), p.key.clone()))
    }

    /// What the pointer is over (algorithms §6), from the last frame's layout.
    fn update_hover(&mut self, now: f64) {
        let Some((x, y)) = self.pointer else { return };
        let mut hover = Hover::default();
        if let Some(l) = self.layouts.iter().rev().find(|l| self.engine.is_open(l.id) && hit(l.rect, x, y)) {
            hover.win = Some(l.id);
            hover.link = l.terms.iter().find(|t| t.frags.iter().any(|f| hit(*f, x, y))).map(|t| LinkHover {
                anchor: t.anchor.clone(),
                key: t.key.clone(),
                parent: Some(l.id),
            });
        } else if let Some(p) = self.last.pages.iter().find(|p| p.frags.iter().any(|f| hit(*f, x, y))) {
            hover.link = Some(LinkHover { anchor: p.anchor.clone(), key: p.key.clone(), parent: None });
        } else if let Some(m) = self.mark_at(x, y) {
            hover.trig = Some(TrigHover { anchor: m.anchor.clone(), key: m.key.clone(), delay: m.opts.delay });
        }
        self.hovered = hover.link.as_ref().map(|l| l.anchor.clone());
        self.engine.set_hover(hover, now);
    }

    /* ------------------------------------------------------------------ the frame */

    /// Draw the windows over the frame and finish it. Call once per frame, after your own UI.
    pub fn render(&mut self, frame: &mut Frame<'_>) {
        let area = frame.area();
        self.render_buffer(area, frame.buffer_mut());
    }

    /// [`render`](Self::render) into a buffer: the windows are placed inside `viewport` (usually the frame's area).
    pub fn render_buffer(&mut self, viewport: Rect, buf: &mut Buffer) {
        let now = self.now();
        self.viewport = viewport;
        self.dirty = false;
        self.engine.tick(now);
        let frame = std::mem::take(&mut self.frame);

        // root anchors seen this frame (marked elements, page terms) and their own side order
        let mut boxes: HashMap<AnchorId, Rect> = HashMap::new();
        let mut own_sides: HashMap<AnchorId, Vec<Side>> = HashMap::new();
        for m in &frame.marks {
            boxes.insert(m.anchor.clone(), m.area);
            if !m.opts.place.is_empty() {
                own_sides.insert(m.anchor.clone(), m.opts.place.clone());
            }
        }
        for p in &frame.pages {
            if let Some(b) = p.bbox {
                boxes.entry(p.anchor.clone()).or_insert(b);
            }
        }
        let roots: Vec<(WinId, AnchorId)> =
            self.engine.windows().iter().filter(|w| w.parent.is_none()).map(|w| (w.id, w.anchor.clone())).collect();
        for (id, anchor) in roots {
            if let Some(r) = boxes.get(&anchor) {
                self.anchor_boxes.insert(id, *r);
                self.engine.set_anchor_rect(id, rect_px(*r, self.look.cell));
            }
        }

        // lay out and place every window, oldest first (a child needs its parent's box)
        let present_marks: HashSet<AnchorId> =
            frame.marks.iter().map(|m| m.anchor.clone()).chain(frame.pages.iter().map(|p| p.anchor.clone())).collect();
        let wins: Vec<Window> = self.engine.windows().to_vec();
        let mut built: Vec<Built> = Vec::new();
        let mut rects: HashMap<WinId, Rect> = HashMap::new();
        let drawable = viewport.width >= 12 && viewport.height >= 4;
        for w in &wins {
            if !drawable {
                break;
            }
            let content = self.content(w);
            let target = match w.parent {
                Some(p) => rects.get(&p).copied(),
                None => self.anchor_boxes.get(&w.id).copied(),
            }
            .unwrap_or(Rect::new(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2, 0, 0));
            let sides = self.engine.sides(w.id, own_sides.get(&w.anchor).map(Vec::as_slice));
            let b = self.build(w, content, target, &sides, viewport);
            rects.insert(w.id, b.rect);
            self.engine.set_rect(w.id, rect_px(b.rect, self.look.cell));
            built.push(b);
        }

        // anchors that were not drawn this frame vanished (SPEC §3.5): previews close, pinned roots freeze
        if drawable {
            let mut present = present_marks;
            for b in &built {
                present.extend(b.anchors.iter().cloned());
            }
            self.engine.retain_anchors(|a| present.contains(a));
        }
        self.events.extend(self.engine.take_events());

        // draw what is still open, oldest first: the newest window is on top
        let open: HashSet<AnchorId> = self.engine.windows().iter().map(|w| w.anchor.clone()).collect();
        self.layouts.clear();
        for b in built {
            if self.engine.is_open(b.id) {
                let l = self.draw_window(buf, b, &open, now);
                self.layouts.push(l);
            }
        }
        self.shown_focus = self.focus.clone();
        self.places = self.layouts.iter().map(|l| (l.id, l.rect)).collect();
        let alive: HashSet<WinId> = self.engine.windows().iter().map(|w| w.id).collect();
        self.scroll.retain(|id, _| alive.contains(id));
        self.anchor_boxes.retain(|id, _| alive.contains(id));
        self.last = frame;

        // keyboard focus: into windows opened by keyboard or gamepad, away from things that are gone
        let focus_before = self.focus.clone();
        if let Some(id) = self.engine.take_focus_request() {
            self.pending_focus = Some(id);
        }
        if let Some(id) = self.pending_focus {
            if self.layouts.iter().any(|l| l.id == id) {
                self.focus = self.focus_items(id).into_iter().next();
                self.pending_focus = None;
            } else if !self.engine.is_open(id) {
                self.pending_focus = None;
            }
        }
        self.check_focus();

        // what the pointer is over now that windows moved, then timers due at once (delay 0)
        self.update_hover(now);
        self.next_due = self.engine.tick(now);
        let late = self.engine.take_events();
        self.dirty = !late.is_empty() || self.focus != focus_before || self.pending_focus.is_some();
        self.events.extend(late);
    }

    /// Titles of the linked keys and the live values a text needs (warns once per missing key).
    fn text_ctx(&mut self, blocks: &[Block], extra: &[String], self_key: Option<&str>) -> TextCtx {
        let refs = collect_refs(blocks);
        let mut titles = HashMap::new();
        for key in refs.links.iter().chain(extra.iter()) {
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
        TextCtx { titles, values, self_key: self_key.map(str::to_owned) }
    }

    fn content(&mut self, w: &Window) -> Content {
        let key = w.key.clone();
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
            None => (key.clone(), missing, Vec::new(), None),
        };
        let blocks = parse_text(&src);
        let ctx = self.text_ctx(&blocks, &see, Some(&key));
        Content {
            title,
            badge,
            blocks,
            see,
            see_label: self.glossary.label("seeAlso"),
            hint: (self.engine.options.hints && !w.pinned).then(|| self.glossary.label("hint")),
            ctx,
        }
    }

    /// Lay the content out at most `max_w` columns wide; returns the window width and the laid-out body.
    fn measure(&self, c: &Content, min_w: u16, max_w: u16) -> (u16, Laid) {
        let laid = lay_out(
            &c.blocks,
            Some((&c.see_label, &c.see)),
            &c.ctx,
            max_w.saturating_sub(4).max(1),
            self.look.symbols.bullet,
        );
        let buttons = 3 * (u16::from(self.engine.options.pin_button) + u16::from(self.engine.options.close_buttons));
        let badge = c.badge.as_deref().map_or(0, |b| width(b) + 3);
        let title = 4 + width(&c.title) + badge + buttons + 2;
        let hint = c.hint.as_deref().map_or(0, |h| width(h) + 6);
        let natural = (laid.width + 4).max(title).max(hint);
        (natural.clamp(min_w, max_w), laid)
    }

    /// Size and place one window (algorithms §8 step 3: measure within the limits, place, shrink, place again).
    fn build(&self, w: &Window, content: Content, target: Rect, sides: &[Side], vp: Rect) -> Built {
        let (cw, ch) = self.look.cell;
        let gap = self.engine.options.gap;
        let fit_w = ((f64::from(vp.width) * cw - 2.0 * gap) / cw).floor().max(0.0) as u16;
        let fit_h = ((f64::from(vp.height) * ch - 2.0 * gap) / ch).floor().max(0.0) as u16;
        let max_w = self.look.max_width.min(fit_w).max(8).min(vp.width);
        let min_w = self.look.min_width.min(max_w);
        let max_h = self.look.max_height.min(fit_h).max(3).min(vp.height);
        let (mut outer_w, mut laid) = self.measure(&content, min_w, max_w);
        let mut outer_h = (laid.lines.len() as u16).saturating_add(2).min(max_h);
        let rect = match (w.frozen, self.places.get(&w.id)) {
            (true, Some(p)) => {
                // a pinned root whose anchor vanished stays where it is
                let x = p.x.min(vp.x + vp.width.saturating_sub(outer_w)).max(vp.x);
                let y = p.y.min(vp.y + vp.height.saturating_sub(outer_h)).max(vp.y);
                Rect::new(x, y, outer_w, outer_h)
            }
            _ => {
                let p = place_in_cells(outer_w, outer_h, target, sides, vp, self.look.cell, gap);
                if p.max_w > 0 || p.max_h > 0 {
                    if p.max_w > 0 && p.max_w < outer_w {
                        let (w2, l2) = self.measure(&content, min_w.min(p.max_w), p.max_w.max(8));
                        outer_w = w2;
                        laid = l2;
                        outer_h = (laid.lines.len() as u16).saturating_add(2).min(max_h);
                    }
                    if p.max_h > 0 {
                        outer_h = outer_h.min(p.max_h.max(3));
                    }
                    let q = place_in_cells(outer_w, outer_h, target, &[p.side], vp, self.look.cell, gap);
                    Rect::new(q.x, q.y, outer_w, outer_h)
                } else {
                    Rect::new(p.x, p.y, outer_w, outer_h)
                }
            }
        };
        let mut per_key: HashMap<&str, u32> = HashMap::new();
        let anchors = laid
            .terms
            .iter()
            .map(|t| {
                let n = per_key.entry(t.key.as_str()).or_insert(0);
                let a = AnchorId::Term(w.id, t.key.clone(), *n);
                *n += 1;
                a
            })
            .collect();
        Built { id: w.id, rect: rect.intersection(vp), content, laid, anchors }
    }

    fn piece_style(&self, p: &Piece, anchors: &[AnchorId], open: &HashSet<AnchorId>) -> Style {
        let look = &self.look;
        let mut s = match p.kind {
            Kind::Text => look.text,
            Kind::Weak => look.weak,
            Kind::Code => look.code,
            Kind::Value => look.value,
            Kind::Strong => look.text.add_modifier(Modifier::BOLD),
            Kind::Missing => look.missing,
            Kind::Term(i) => {
                let a = &anchors[i];
                let mut s = if self.hovered.as_ref() == Some(a) { look.link_hover } else { look.link };
                if open.contains(a) {
                    s = s.patch(look.link_open);
                }
                if matches!(&self.focus, Some(Focus::Term(f)) if f == a) {
                    s = s.patch(look.focus);
                }
                s
            }
        };
        let Emphasis { bold, italic } = p.em;
        if bold {
            s = s.add_modifier(Modifier::BOLD);
        }
        if italic {
            s = s.add_modifier(Modifier::ITALIC);
        }
        s
    }

    fn draw_page(&mut self, buf: &mut Buffer, area: Rect, laid: &Laid, id: u64, scroll: usize) {
        let mut per_key: HashMap<&str, u32> = HashMap::new();
        let anchors: Vec<AnchorId> = laid
            .terms
            .iter()
            .map(|t| {
                let n = per_key.entry(t.key.as_str()).or_insert(0);
                let a = AnchorId::Page(hash_of((id, &t.key)), *n);
                *n += 1;
                a
            })
            .collect();
        let area = area.intersection(buf.area);
        let open: HashSet<AnchorId> = self.engine.windows().iter().map(|w| w.anchor.clone()).collect();
        layout::draw(buf, area, laid, scroll, |p| self.piece_style(p, &anchors, &open));
        for (t, anchor) in laid.terms.iter().zip(anchors) {
            let frags = layout::visible(&t.frags, area, scroll);
            let bbox = frags.iter().copied().reduce(|a, b| a.union(b));
            self.frame.pages.push(PageTerm { anchor, key: t.key.clone(), frags, bbox });
        }
    }

    fn draw_window(&mut self, buf: &mut Buffer, b: Built, open: &HashSet<AnchorId>, now: f64) -> WinLayout {
        let r = b.rect;
        let pinned = self.engine.get(b.id).is_some_and(|w| w.pinned);
        let flash = self.engine.flash_progress(b.id, now);
        let lock = self.engine.lock_progress(b.id, now);
        let look = self.look.clone();
        let s = &look.symbols;
        let border = match flash {
            Some(t) if !look.reduced_motion => {
                // blink three times within the flash
                if ((t * 6.0) as u32).is_multiple_of(2) {
                    look.accent.add_modifier(Modifier::BOLD | Modifier::REVERSED)
                } else {
                    look.accent.add_modifier(Modifier::BOLD)
                }
            }
            Some(_) => look.accent.add_modifier(Modifier::BOLD),
            None if pinned => look.accent,
            None => look.border,
        };
        let border = look.background.patch(border);
        let weak = look.background.patch(look.weak);

        // the window covers what is below it
        for y in r.top()..r.bottom() {
            for x in r.left()..r.right() {
                if let Some(cell) = buf.cell_mut((x, y)) {
                    cell.reset();
                    cell.set_style(look.background);
                }
            }
        }
        let (x0, y0, x1, y1) = (r.left(), r.top(), r.right().saturating_sub(1), r.bottom().saturating_sub(1));
        for x in x0..=x1 {
            put(buf, x, y0, s.horizontal, border);
            put(buf, x, y1, s.horizontal, border);
        }
        for y in y0..=y1 {
            put(buf, x0, y, s.vertical, border);
            put(buf, x1, y, s.vertical, border);
        }
        put(buf, x0, y0, s.top_left, border);
        put(buf, x1, y0, s.top_right, border);
        put(buf, x0, y1, s.bottom_left, border);
        put(buf, x1, y1, s.bottom_right, border);

        // title bar in the top edge: title, fallback badge, pin, close
        let mut right = i32::from(x1) - 1; // one edge cell before the corner
        let room_for_buttons = r.width >= 14;
        let mut close = None;
        let mut pin = None;
        let button_style = |focused: bool, active: bool| {
            let base = if active { look.accent } else { look.weak };
            look.background.patch(if focused { base.patch(look.focus) } else { base })
        };
        if self.engine.options.close_buttons && room_for_buttons {
            right -= 3;
            let area = Rect::new(right as u16, y0, 3, 1);
            let focused = self.focus == Some(Focus::Close(b.id));
            put(buf, area.x, y0, " ", button_style(focused, false));
            put(buf, area.x + 1, y0, s.close, button_style(focused, false));
            put(buf, area.x + 2, y0, " ", button_style(focused, false));
            close = Some(area);
        }
        if self.engine.options.pin_button && room_for_buttons {
            right -= 3;
            let area = Rect::new(right as u16, y0, 3, 1);
            let focused = self.focus == Some(Focus::Pin(b.id));
            let glyph = if pinned { s.pinned } else { s.pin };
            put(buf, area.x, y0, " ", button_style(focused, pinned));
            put(buf, area.x + 1, y0, glyph, button_style(focused, pinned));
            put(buf, area.x + 2, y0, " ", button_style(focused, pinned));
            pin = Some(area);
        }
        if let Some(badge) = &b.content.badge {
            let text = format!(" {badge} ");
            let w = i32::from(width(&text));
            if right - w - 1 > i32::from(x0) + 6 {
                right -= w + 1;
                buf.set_stringn(right as u16, y0, &text, w as usize, weak.add_modifier(Modifier::REVERSED));
            }
        }
        let title_room = (right - 1 - (i32::from(x0) + 2)).max(0) as u16;
        if title_room >= 3 {
            let title = format!(" {} ", truncate(&b.content.title, title_room - 2, s.ellipsis));
            let style =
                if flash.is_some() && !look.reduced_motion { border } else { look.background.patch(look.title) };
            buf.set_stringn(x0 + 2, y0, &title, usize::from(title_room), style);
        }

        // body
        let rows = usize::from(r.height.saturating_sub(2));
        let lines = b.laid.lines.len();
        let max_scroll = lines.saturating_sub(rows);
        let mut scroll = self.scroll.get(&b.id).copied().unwrap_or(0).min(max_scroll);
        if let Some(Focus::Term(f)) = self.focus.as_ref().filter(|_| self.focus != self.shown_focus) {
            if let Some(i) = b.anchors.iter().position(|a| a == f) {
                if let Some(&(line, ..)) = b.laid.terms[i].frags.first() {
                    if line < scroll {
                        scroll = line;
                    } else if line >= scroll + rows {
                        scroll = line + 1 - rows;
                    }
                }
            }
        }
        self.scroll.insert(b.id, scroll);
        let body = Rect::new(x0 + 2, y0 + 1, r.width.saturating_sub(4), rows as u16);
        layout::draw(buf, body, &b.laid, scroll, |p| look.background.patch(self.piece_style(p, &b.anchors, open)));
        if max_scroll > 0 && rows > 0 {
            let thumb = (rows * rows / lines).max(1);
            let at = scroll * (rows - thumb) / max_scroll;
            for i in at..at + thumb {
                put(buf, x1, y0 + 1 + i as u16, s.thumb, look.background.patch(look.accent));
            }
        }

        // hint in the bottom edge (previews), timer-lock bar over it
        if let Some(hint) = &b.content.hint {
            let room = r.width.saturating_sub(6);
            if room >= 6 {
                let text = format!(" {} ", truncate(hint, room - 2, s.ellipsis));
                buf.set_stringn(x0 + 2, y1, &text, usize::from(room), weak);
            }
        }
        if let Some(p) = lock {
            let n = (f64::from(r.width) * p).round() as u16;
            for x in x0..x0 + n.min(r.width) {
                if let Some(cell) = buf.cell_mut((x, y1)) {
                    if cell.symbol() == s.horizontal || x == x0 || x == x1 {
                        cell.set_symbol(s.lock);
                    }
                    cell.set_style(look.accent.add_modifier(Modifier::BOLD));
                }
            }
        }

        let terms = b
            .laid
            .terms
            .iter()
            .zip(&b.anchors)
            .map(|(t, a)| TermHit {
                anchor: a.clone(),
                key: t.key.clone(),
                frags: layout::visible(&t.frags, body, scroll),
            })
            .collect();
        WinLayout { id: b.id, rect: r, pin, close, terms, rows }
    }
}
