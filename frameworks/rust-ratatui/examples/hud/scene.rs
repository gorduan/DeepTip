//! The scene of the DeepTip example: a strategy-game HUD for the terminal in English and German, with the shared
//! glossaries (`glossary/core/`, `glossary/example/`). `main.rs` runs it in a real terminal; the tests drive the
//! same scene through ratatui's `TestBackend`.

use std::path::Path;

use deeptip_ratatui::{DeepTip, Event as DtEvent, IndexState, MarkOptions, OutsideClick, Side};
use ratatui::buffer::Buffer;
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Line;
use ratatui::widgets::{Block, Widget};
use ratatui::Frame;

/// What can be clicked or focused on the screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Realm,
    Stability,
    Taxes,
    Nobles,
    Gold,
    Help,
    Lang,
    Province,
    Prestige,
    Intro,
    DelayDown,
    DelayUp,
    Lock,
    Outside,
    CloseButtons,
    PinButton,
    Hints,
    Search,
    Revolt,
    Unrest,
}

/// The keyboard focus order of the screen (Tab / Shift+Tab).
pub const RING: [Target; 20] = [
    Target::Realm,
    Target::Stability,
    Target::Taxes,
    Target::Nobles,
    Target::Gold,
    Target::Help,
    Target::Lang,
    Target::Province,
    Target::Prestige,
    Target::Intro,
    Target::DelayDown,
    Target::DelayUp,
    Target::Lock,
    Target::Outside,
    Target::CloseButtons,
    Target::PinButton,
    Target::Hints,
    Target::Search,
    Target::Revolt,
    Target::Unrest,
];

/// Texts of the screen itself (the explanations live in the glossary).
pub fn text(lang: &str, key: &str) -> &'static str {
    let de = lang == "de";
    match (key, de) {
        ("realm", true) => "Reich",
        ("realm", false) => "Realm",
        ("nobles", true) => "Adel",
        ("nobles", false) => "Nobles",
        ("province", true) => "↖ Provinz",
        ("province", false) => "↖ Province",
        ("prestige", _) => "Prestige ↗",
        ("revolt", true) => "↙ Aufstand",
        ("revolt", false) => "↙ Revolt",
        ("unrest", true) => "Unruhe ↘",
        ("unrest", false) => "Unrest ↘",
        ("stability", true) => "Stabilität",
        ("stability", false) => "Stability",
        ("taxes", true) => "Steuern",
        ("taxes", false) => "Taxes",
        ("low", true) => "niedrig",
        ("low", false) => "low",
        ("normal", _) => "normal",
        ("high", true) => "hoch",
        ("high", false) => "high",
        ("try", true) => "Ausprobieren",
        ("try", false) => "Try it",
        ("settings", true) => "Einstellungen",
        ("settings", false) => "Settings",
        ("index", true) => "Enzyklopädie (alle Begriffe)",
        ("index", false) => "Encyclopedia (every term)",
        ("events", true) => "Ereignisse",
        ("events", false) => "Events",
        ("delay", true) => "Verzögerung erstes Fenster",
        ("delay", false) => "Delay of the first window",
        ("lock", true) => "Einrasten nach Ruhezeit",
        ("lock", false) => "Pin after resting",
        ("off", true) => "aus",
        ("off", false) => "off",
        ("outside", true) => "Klick daneben schließt",
        ("outside", false) => "Click outside closes",
        ("closeButtons", true) => "X-Knöpfe",
        ("closeButtons", false) => "X buttons",
        ("pinButton", true) => "Nadel-Knopf",
        ("pinButton", false) => "Pin button",
        ("hints", true) => "Hinweiszeile",
        ("hints", false) => "Hint line",
        ("intro", true) => {
            "Lass die Maus auf einem Knopf oben **ruhen**. Im Fenster sind [[deeptip.term|markierte Begriffe]]: \
             drüberfahren zeigt sie, ein Klick [[deeptip.pin|hält sie fest]]. Kreislauf zum Testen: \
             [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]. Die Knöpfe in den Ecken \
             prüfen die Platzierung am Bildschirmrand."
        }
        ("intro", false) => {
            "**Rest** the pointer on a button at the top. The window contains [[deeptip.term|highlighted terms]]: \
             hover shows them, a click [[deeptip.pin|pins]] them. A loop to try: [[demo.stability]] → \
             [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]. The corner buttons test placement at the \
             screen edge."
        }
        ("controls", true) => {
            "Steuerung: [[deeptip.mouse|Maus]] (ruhen, Klick, Rechtsklick) · [[deeptip.keyboard|Tastatur]] (`Tab`, \
             `F1` oder `?`, `Enter`, `Esc`, `F6`, `q` beendet) · [[deeptip.gamepad|Controller]] (über \
             `DeepTip::action`). *Prestige* und *Gold* gibt es nur auf Deutsch – auf Englisch zeigen sie die \
             Rückfallsprache."
        }
        ("controls", false) => {
            "Controls: [[deeptip.mouse|mouse]] (rest, click, right-click) · [[deeptip.keyboard|keyboard]] (`Tab`, \
             `F1` or `?`, `Enter`, `Esc`, `F6`, `q` quits) · [[deeptip.gamepad|gamepad]] (through \
             `DeepTip::action`). *Prestige* and *Gold* exist only in German – in English they show the fallback \
             language."
        }
        _ => "?",
    }
}

/// 1250 → "1,250" (en) / "1.250" (de).
pub fn grouped(n: i64, lang: &str) -> String {
    let digits = n.abs().to_string();
    let sep = if lang == "de" { '.' } else { ',' };
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(sep);
        }
        out.push(c);
    }
    if n < 0 {
        out.insert(0, '-');
    }
    out
}

/// +1, 0, -2.
pub fn signed(v: i32) -> String {
    if v > 0 {
        format!("+{v}")
    } else {
        v.to_string()
    }
}

fn width(s: &str) -> u16 {
    Line::from(s).width() as u16
}

fn hit(r: Rect, x: u16, y: u16) -> bool {
    x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height
}

/// A box with a title; returns the inside.
fn boxed(buf: &mut Buffer, area: Rect, title: &str, focused: bool) -> Rect {
    let style = Style::default().fg(if focused { Color::LightBlue } else { Color::DarkGray });
    let block = Block::bordered().border_style(style).title(format!(" {title} "));
    let inner = block.inner(area);
    block.render(area, buf);
    inner
}

/// The example application.
pub struct Hud {
    /// DeepTip: glossary, windows, input.
    pub dt: DeepTip,
    pub lang: String,
    pub stability: i32,
    pub tax: usize,
    pub gold: i64,
    pub index: IndexState,
    pub log: Vec<String>,
    /// Index into [`RING`]: the application's keyboard focus.
    pub focus: usize,
    pub quit: bool,
    /// What was drawn where in the last frame.
    pub targets: Vec<(Rect, Target)>,
}

impl Hud {
    pub fn new(lang: &str, glossary: &Path) -> Self {
        let mut dt = DeepTip::new(lang, &["de", "en"]);
        let failed = dt.set_sources(&[
            glossary.join("core").join("{locale}.json").display().to_string(),
            glossary.join("example").join("{locale}.json").display().to_string(),
        ]);
        let mut log = vec![format!("DeepTip {} · Ratatui", deeptip_ratatui::VERSION)];
        log.extend(failed.into_iter().map(|f| format!("cannot load {f}")));
        dt.engine.options.delay = 1000.0;
        Self {
            dt,
            lang: lang.to_owned(),
            stability: 1,
            tax: 1,
            gold: 1250,
            index: IndexState::default(),
            log,
            focus: 0,
            quit: false,
            targets: Vec::new(),
        }
    }

    pub fn focused(&self) -> Target {
        RING[self.focus]
    }

    /// Where a target was drawn in the last frame (the tests use it).
    #[allow(dead_code)]
    pub fn target(&self, t: Target) -> Option<Rect> {
        self.targets.iter().find(|(_, x)| *x == t).map(|(r, _)| *r)
    }

    pub fn draw(&mut self, f: &mut Frame<'_>) {
        let area = f.area();
        self.draw_into(area, f.buffer_mut());
    }

    pub fn draw_into(&mut self, area: Rect, buf: &mut Buffer) {
        self.targets.clear();
        let lang = self.lang.clone();
        let t = |k: &str| text(&lang, k);
        self.dt.set_value("stability", signed(self.stability));
        self.dt.set_value("gold", grouped(self.gold, &lang));
        self.index.editing = self.focused() == Target::Search;

        // top bar: the HUD buttons, help and language at the right
        buf.set_string(area.x + 1, area.y, "DeepTip", Style::default().add_modifier(Modifier::BOLD));
        let stab = format!("{} {}", t("stability"), signed(self.stability));
        let tax = format!("{}: {}", t("taxes"), t(["low", "normal", "high"][self.tax]));
        let gold = format!("Gold {}", grouped(self.gold, &lang));
        let mut x = area.x + 10;
        for (label, target, key) in [
            (t("realm").to_owned(), Target::Realm, "demo.realm"),
            (stab, Target::Stability, "demo.stability"),
            (tax, Target::Taxes, "demo.taxes"),
            (t("nobles").to_owned(), Target::Nobles, "demo.nobles"),
            (gold, Target::Gold, "demo.gold"),
        ] {
            x = self.button(buf, x, area.y, &label, target, Some(key), MarkOptions::default()) + 1;
        }
        let lang_label = if lang == "de" { "Deutsch" } else { "English" };
        let lx = area.right().saturating_sub(width(lang_label) + 3);
        self.button(buf, lx, area.y, lang_label, Target::Lang, None, MarkOptions::default());
        let help = MarkOptions { delay: Some(0.0), ..MarkOptions::default() };
        self.button(buf, lx.saturating_sub(4), area.y, "?", Target::Help, Some("deeptip.about"), help);

        // corner buttons: placement at the screen edge; the bottom ones prefer the top side
        self.button(
            buf,
            area.x + 1,
            area.y + 1,
            t("province"),
            Target::Province,
            Some("demo.province"),
            MarkOptions::default(),
        );
        let px = area.right().saturating_sub(width(t("prestige")) + 3);
        self.button(
            buf,
            px,
            area.y + 1,
            t("prestige"),
            Target::Prestige,
            Some("demo.prestige"),
            MarkOptions::default(),
        );
        let bottom = area.bottom().saturating_sub(1);
        let up = MarkOptions { place: vec![Side::Top, Side::Right, Side::Left], ..MarkOptions::default() };
        self.button(buf, area.x + 1, bottom, t("revolt"), Target::Revolt, Some("demo.revolt"), up.clone());
        let ux = area.right().saturating_sub(width(t("unrest")) + 3);
        self.button(buf, ux, bottom, t("unrest"), Target::Unrest, Some("demo.unrest"), up);

        if area.width >= 40 && area.height >= 14 {
            let mid = Rect::new(area.x + 1, area.y + 3, area.width - 2, area.height - 5);
            let inner_w = mid.width.saturating_sub(2);
            let rows = self.dt.text_rows(inner_w, t("intro")) + self.dt.text_rows(inner_w, t("controls"));
            let try_h = (rows + 2).min(mid.height / 2);
            let inner = boxed(buf, Rect { height: try_h, ..mid }, t("try"), self.focused() == Target::Intro);
            let used = self.dt.text(buf, inner, t("intro")).min(inner.height);
            let rest = Rect { y: inner.y + used, height: inner.height - used, ..inner };
            self.dt.text(buf, rest, t("controls"));

            let low = Rect { y: mid.y + try_h, height: mid.height - try_h, ..mid };
            let left = Rect { width: low.width / 2, ..low };
            let right = Rect { x: low.x + left.width + 1, width: low.width - left.width - 1, ..low };
            let settings = Rect { height: 6.min(left.height), ..left };
            self.settings(buf, settings);
            let events = Rect { y: left.y + settings.height, height: left.height - settings.height, ..left };
            let inner = boxed(buf, events, t("events"), false);
            for (i, line) in self.log.iter().rev().take(usize::from(inner.height)).enumerate() {
                buf.set_stringn(
                    inner.x,
                    inner.y + i as u16,
                    line,
                    usize::from(inner.width),
                    Style::default().fg(Color::DarkGray),
                );
            }
            let inner = boxed(buf, right, t("index"), self.focused() == Target::Search);
            self.dt.index(buf, inner, &mut self.index);
            self.targets.push((Rect { height: 1, ..inner }, Target::Search));
        }

        // DeepTip last: the windows lie on top of everything
        self.dt.render_buffer(area, buf);
        for e in self.dt.take_events() {
            self.log.push(match e {
                DtEvent::Opened { key, .. } => format!("open   {key}"),
                DtEvent::Closed { key, .. } => format!("close  {key}"),
                DtEvent::Pinned { key, .. } => format!("pin    {key}"),
                DtEvent::Unpinned { key, .. } => format!("unpin  {key}"),
            });
        }
    }

    /// A button `[label]`; with a glossary key it is marked for DeepTip. Returns the column after it.
    #[allow(clippy::too_many_arguments)]
    fn button(
        &mut self,
        buf: &mut Buffer,
        x: u16,
        y: u16,
        label: &str,
        target: Target,
        key: Option<&str>,
        opts: MarkOptions,
    ) -> u16 {
        self.button_text(buf, x, y, &format!("[{label}]"), target, key, opts)
    }

    #[allow(clippy::too_many_arguments)]
    fn button_text(
        &mut self,
        buf: &mut Buffer,
        x: u16,
        y: u16,
        text: &str,
        target: Target,
        key: Option<&str>,
        opts: MarkOptions,
    ) -> u16 {
        let w = width(text);
        let area = Rect::new(x, y, w, 1).intersection(buf.area);
        let focused = self.focused() == target;
        let state = key.map(|k| self.dt.mark_with(area, k, MarkOptions { focused, ..opts }));
        let mut style = Style::default();
        if focused {
            style = style.add_modifier(Modifier::REVERSED);
        }
        if state.is_some_and(|s| s.open) {
            style = style.fg(Color::LightBlue).add_modifier(Modifier::BOLD); // web: [data-dt-open]
        }
        buf.set_stringn(area.x, area.y, text, usize::from(area.width), style);
        if let Some(p) = state.and_then(|s| s.arming) {
            // the rest progress (web: [data-dt-arming]): the label fills up from the left
            let n = (f32::from(area.width) * p).round() as u16;
            buf.set_style(
                Rect { width: n.min(area.width), ..area },
                Style::default().fg(Color::LightBlue).add_modifier(Modifier::UNDERLINED),
            );
        }
        self.targets.push((area, target));
        x + w
    }

    fn label(buf: &mut Buffer, x: u16, y: u16, s: &str) -> u16 {
        buf.set_string(x, y, s, Style::default());
        x + width(s)
    }

    fn settings(&mut self, buf: &mut Buffer, area: Rect) {
        let lang = self.lang.clone();
        let t = |k: &str| text(&lang, k);
        let inner = boxed(buf, area, t("settings"), false);
        if inner.height < 4 {
            return;
        }
        let o = self.dt.engine.options.clone();
        let none = MarkOptions::default;
        let y = inner.y;
        let x = Self::label(buf, inner.x, y, &format!("{}: ", t("delay")));
        let x = self.button(buf, x, y, "-", Target::DelayDown, None, none());
        let secs = format!("{:.1}", o.delay / 1000.0);
        let secs = if lang == "de" { secs.replace('.', ",") } else { secs };
        let x = Self::label(buf, x, y, &format!(" {secs} s "));
        self.button(buf, x, y, "+", Target::DelayUp, None, none());
        let x = Self::label(buf, inner.x, y + 1, &format!("{}: ", t("lock")));
        let lock = if o.lock_after <= 0.0 { t("off").to_owned() } else { format!("{} s", o.lock_after / 1000.0) };
        self.button(buf, x, y + 1, &lock, Target::Lock, None, none());
        let x = Self::label(buf, inner.x, y + 2, &format!("{}: ", t("outside")));
        let outside = format!("{:?}", o.outside_click_closes).to_lowercase();
        self.button(buf, x, y + 2, &outside, Target::Outside, None, none());
        let mark = |on: bool| if on { "x" } else { " " };
        let mut x = inner.x;
        for (on, target, key) in [
            (o.close_buttons, Target::CloseButtons, "closeButtons"),
            (o.pin_button, Target::PinButton, "pinButton"),
            (o.hints, Target::Hints, "hints"),
        ] {
            x = self.button_text(buf, x, y + 3, &format!("[{}] {}", mark(on), t(key)), target, None, none()) + 2;
        }
    }

    /// Handle a terminal event: DeepTip first. Returns `true` when DeepTip used it.
    pub fn handle(&mut self, ev: &Event) -> bool {
        if self.dt.handle_event(ev) {
            return true;
        }
        match ev {
            Event::Key(k) if k.kind != KeyEventKind::Release => self.key(k),
            Event::Mouse(m) if m.kind == MouseEventKind::Down(MouseButton::Left) => {
                if let Some(target) = self.targets.iter().rev().find(|(r, _)| hit(*r, m.column, m.row)).map(|(_, t)| *t)
                {
                    if let Some(i) = RING.iter().position(|x| *x == target) {
                        self.focus = i;
                    }
                    self.activate(target);
                }
            }
            _ => {}
        }
        false
    }

    fn key(&mut self, k: &KeyEvent) {
        if self.focused() == Target::Search && self.dt.index_input(&mut self.index, k) {
            return;
        }
        match k.code {
            KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => self.quit = true,
            KeyCode::Char('q') => self.quit = true,
            KeyCode::Tab => self.move_focus(1),
            KeyCode::BackTab => self.move_focus(-1),
            KeyCode::Enter | KeyCode::Char(' ') => self.activate(self.focused()),
            _ => {}
        }
    }

    fn move_focus(&mut self, step: i32) {
        let n = RING.len() as i32;
        self.focus = (self.focus as i32 + step).rem_euclid(n) as usize;
        if self.focused() == Target::Intro {
            // a text with terms: DeepTip takes the keyboard and gives it back after the last term
            self.dt.focus_page_terms(step > 0);
        }
    }

    /// The application's own actions: DeepTip only adds the explanations.
    pub fn activate(&mut self, target: Target) {
        let o = &mut self.dt.engine.options;
        match target {
            Target::Stability => self.stability = if self.stability >= 3 { -3 } else { self.stability + 1 },
            Target::Taxes => {
                self.tax = (self.tax + 1) % 3;
                self.gold += [50, 120, 260][self.tax];
            }
            Target::Lang => {
                let next = if self.lang == "de" { "en" } else { "de" };
                self.dt.set_locale(next);
                self.lang = next.to_owned();
            }
            Target::DelayDown => o.delay = (o.delay - 100.0).max(0.0),
            Target::DelayUp => o.delay = (o.delay + 100.0).min(3000.0),
            Target::Lock => {
                o.lock_after = if o.lock_after <= 0.0 {
                    1500.0
                } else if o.lock_after < 3000.0 {
                    3000.0
                } else {
                    0.0
                }
            }
            Target::Outside => {
                o.outside_click_closes = match o.outside_click_closes {
                    OutsideClick::Touch => OutsideClick::Always,
                    OutsideClick::Always => OutsideClick::Never,
                    OutsideClick::Never => OutsideClick::Touch,
                }
            }
            Target::CloseButtons => o.close_buttons = !o.close_buttons,
            Target::PinButton => o.pin_button = !o.pin_button,
            Target::Hints => o.hints = !o.hints,
            Target::Intro => {
                self.dt.focus_page_terms(true);
            }
            _ => {}
        }
    }
}
