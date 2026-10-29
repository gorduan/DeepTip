//! The example HUD driven headless through ratatui's `TestBackend`: synthetic crossterm mouse and key events, a
//! manual clock, the shared glossaries and real frames. No terminal is needed.

#[allow(dead_code)]
#[path = "../examples/hud/scene.rs"]
mod scene;

use std::path::PathBuf;

use deeptip_ratatui::{AnchorId, Focus, WinId, Window};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{
    Event, KeyCode, KeyEvent, KeyEventKind, KeyEventState, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
use ratatui::layout::Rect;
use ratatui::Terminal;
use scene::{Hud, Target, RING};

struct H {
    term: Terminal<TestBackend>,
    hud: Hud,
    t: f64,
    pointer: (u16, u16),
}

fn centre(r: Rect) -> (u16, u16) {
    (r.x + r.width / 2, r.y + r.height / 2)
}

fn key_event(code: KeyCode, modifiers: KeyModifiers, kind: KeyEventKind) -> Event {
    Event::Key(KeyEvent { code, modifiers, kind, state: KeyEventState::NONE })
}

impl H {
    fn new(lang: &str) -> Self {
        Self::sized(lang, 100, 30)
    }

    fn sized(lang: &str, w: u16, h: u16) -> Self {
        let glossary = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../glossary");
        let mut hud = Hud::new(lang, &glossary);
        assert_eq!(hud.log.len(), 1, "glossaries load: {:?}", hud.log);
        hud.dt.set_time(0.0);
        let mut h = Self { term: Terminal::new(TestBackend::new(w, h)).unwrap(), hud, t: 0.0, pointer: (w / 2, h - 1) };
        h.frame();
        h
    }

    /// Draw like a real loop: again at once while DeepTip asks for it (`timeout() == 0`).
    fn frame(&mut self) {
        for _ in 0..4 {
            let hud = &mut self.hud;
            self.term.draw(|f| hud.draw(f)).unwrap();
            if self.hud.dt.timeout() != Some(std::time::Duration::ZERO) {
                break;
            }
        }
    }

    /// Let time pass in 16 ms frames.
    fn wait(&mut self, ms: f64) {
        let end = self.t + ms;
        while self.t < end {
            self.t = (self.t + 16.0).min(end);
            self.hud.dt.set_time(self.t);
            self.frame();
        }
    }

    fn mouse(&mut self, kind: MouseEventKind, (x, y): (u16, u16)) -> bool {
        let used =
            self.hud.handle(&Event::Mouse(MouseEvent { kind, column: x, row: y, modifiers: KeyModifiers::NONE }));
        self.frame();
        used
    }

    fn move_to(&mut self, p: (u16, u16)) {
        self.pointer = p;
        self.mouse(MouseEventKind::Moved, p);
    }

    /// Glide to `p` in `steps` frames of 16 ms, like a real mouse.
    fn glide(&mut self, p: (u16, u16), steps: u16) {
        let (x0, y0) = (f64::from(self.pointer.0), f64::from(self.pointer.1));
        for i in 1..=steps {
            let f = f64::from(i) / f64::from(steps);
            let q = ((x0 + (f64::from(p.0) - x0) * f).round() as u16, (y0 + (f64::from(p.1) - y0) * f).round() as u16);
            self.t += 16.0;
            self.hud.dt.set_time(self.t);
            self.move_to(q);
        }
    }

    fn click(&mut self) -> bool {
        let used = self.mouse(MouseEventKind::Down(MouseButton::Left), self.pointer);
        self.mouse(MouseEventKind::Up(MouseButton::Left), self.pointer);
        used
    }

    fn key(&mut self, code: KeyCode, modifiers: KeyModifiers) -> bool {
        let used = self.hud.handle(&key_event(code, modifiers, KeyEventKind::Press));
        self.frame();
        used
    }

    fn keys(&self) -> Vec<String> {
        self.hud.dt.engine.windows().iter().map(|w| w.key.clone()).collect()
    }

    fn win(&self, key: &str) -> Window {
        self.hud
            .dt
            .engine
            .windows()
            .iter()
            .find(|w| w.key == key)
            .cloned()
            .unwrap_or_else(|| panic!("{key} is not open: {:?}", self.keys()))
    }

    fn area(&self, key: &str) -> Rect {
        let id = self.win(key).id;
        self.hud.dt.window_area(id).expect("drawn")
    }

    fn target(&self, t: Target) -> Rect {
        self.hud.target(t).unwrap_or_else(|| panic!("{t:?} not drawn"))
    }

    fn term_in(&self, win: WinId, key: &str) -> Rect {
        self.hud
            .dt
            .terms()
            .into_iter()
            .find(|t| t.key == key && t.window == Some(win))
            .map(|t| t.area)
            .unwrap_or_else(|| panic!("no term {key} in window {win}"))
    }

    fn page_term(&self, key: &str) -> Rect {
        self.hud
            .dt
            .terms()
            .into_iter()
            .find(|t| t.key == key && t.window.is_none())
            .map(|t| t.area)
            .unwrap_or_else(|| panic!("no page term {key}"))
    }

    /// One row of the screen as text.
    fn row(&self, y: u16) -> String {
        let buf = self.term.backend().buffer();
        (0..buf.area.width).map(|x| buf[(x, y)].symbol().to_owned()).collect()
    }

    /// The text inside a window's frame.
    fn window_text(&self, key: &str) -> String {
        let r = self.area(key);
        let buf = self.term.backend().buffer();
        let mut out = String::new();
        for y in r.y..r.y + r.height {
            for x in r.x..r.x + r.width {
                out.push_str(buf[(x, y)].symbol());
            }
            out.push('\n');
        }
        out
    }

    fn symbol(&self, x: u16, y: u16) -> String {
        self.term.backend().buffer()[(x, y)].symbol().to_owned()
    }

    fn focus_on(&mut self, t: Target) {
        self.hud.focus = RING.iter().position(|x| *x == t).unwrap();
        self.frame();
    }

    /// Rest on the Realm button until its preview is open.
    fn open_realm(&mut self) -> WinId {
        let b = self.target(Target::Realm);
        self.glide(centre(b), 3);
        self.wait(1100.0);
        self.win("demo.realm").id
    }

    /// Realm and its province preview, both pinned by a click on the term.
    fn pinned_chain(&mut self) -> (WinId, WinId) {
        let realm = self.open_realm();
        let t = self.term_in(realm, "demo.province");
        self.glide(centre(t), 6);
        self.wait(200.0);
        assert!(self.click(), "a click on a term belongs to DeepTip");
        self.wait(50.0);
        (realm, self.win("demo.province").id)
    }
}

#[test]
fn resting_opens_the_first_window_below_its_button() {
    let mut h = H::new("en");
    let b = h.target(Target::Realm);
    h.move_to(centre(b));
    h.wait(980.0);
    assert!(h.keys().is_empty(), "delay 1000 ms");
    h.wait(40.0);
    assert_eq!(h.keys(), ["demo.realm"]);
    assert!(!h.win("demo.realm").pinned);
    let r = h.area("demo.realm");
    assert_eq!(r.y, b.y + 2, "below the button with one row of air: {r:?} / {b:?}");
    assert!((30..=48).contains(&r.width), "width {}", r.width);
    assert!(h.row(r.y).contains(" Realm "), "title in the top edge: {}", h.row(r.y));
    let text = h.window_text("demo.realm");
    assert!(text.contains("Your realm is made of"), "{text}");
    assert!(text.contains("Click to pin · Esc closes"), "hint line of a preview: {text}");
}

#[test]
fn hovering_a_term_previews_it_beside_its_parent_and_a_click_pins_the_chain() {
    let mut h = H::new("en");
    let realm = h.open_realm();
    let t = h.term_in(realm, "demo.province");
    h.glide(centre(t), 6);
    h.wait(150.0);
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    let child = h.win("demo.province");
    assert_eq!(child.parent, Some(realm));
    assert!(!child.pinned);
    assert!(!h.area("demo.province").intersects(h.area("demo.realm")), "a child never covers its parent");
    assert!(h.click());
    h.wait(50.0);
    assert!(h.win("demo.realm").pinned && h.win("demo.province").pinned);
    assert!(!h.window_text("demo.realm").contains("Click to pin"), "pinned windows have no hint line");
}

#[test]
fn another_term_replaces_the_preview_of_the_same_parent() {
    let mut h = H::new("en");
    let realm = h.open_realm();
    h.glide(centre(h.term_in(realm, "demo.province")), 6);
    h.wait(150.0);
    h.glide(centre(h.term_in(realm, "demo.stability")), 2);
    h.wait(600.0);
    assert_eq!(h.keys(), ["demo.realm", "demo.stability"]);
}

#[test]
fn escape_closes_the_newest_and_shift_escape_closes_all() {
    let mut h = H::new("en");
    h.pinned_chain();
    assert!(h.key(KeyCode::Esc, KeyModifiers::NONE), "Esc that closes a window is consumed");
    assert_eq!(h.keys(), ["demo.realm"]);
    h.wait(1000.0);
    assert_eq!(h.keys(), ["demo.realm"], "resting on the term does not reopen it");
    h.click();
    h.wait(50.0);
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    h.wait(200.0);
    assert!(h.key(KeyCode::Esc, KeyModifiers::SHIFT));
    assert!(h.keys().is_empty());
    h.wait(200.0);
    assert!(!h.key(KeyCode::Esc, KeyModifiers::NONE), "without windows Esc belongs to the application");
}

#[test]
fn holding_escape_closes_all_with_repeat_events() {
    let mut h = H::new("en");
    h.pinned_chain();
    let esc = |kind| key_event(KeyCode::Esc, KeyModifiers::NONE, kind);
    assert!(h.hud.handle(&esc(KeyEventKind::Press)));
    h.frame();
    assert_eq!(h.keys(), ["demo.realm"], "the press closes the newest");
    for _ in 0..17 {
        h.wait(33.0);
        assert!(h.hud.handle(&esc(KeyEventKind::Repeat)), "auto-repeat of a used Esc is swallowed");
    }
    h.frame();
    assert_eq!(h.keys(), ["demo.realm"], "561 ms: not yet");
    h.wait(40.0);
    assert!(h.hud.handle(&esc(KeyEventKind::Repeat)));
    h.frame();
    assert!(h.keys().is_empty(), "held 600 ms: all closed");
    h.wait(33.0);
    assert!(h.hud.handle(&esc(KeyEventKind::Repeat)), "the rest of the hold does not reach the application");
    assert!(!h.hud.handle(&esc(KeyEventKind::Release)));
}

#[test]
fn holding_escape_closes_all_without_repeat_events() {
    // terminals without the kitty protocol: auto-repeat arrives as presses, no releases
    let mut h = H::new("en");
    let (_, province) = h.pinned_chain();
    let t = h.term_in(province, "demo.taxes");
    h.glide(centre(t), 6);
    h.wait(150.0);
    h.click();
    h.wait(50.0);
    assert_eq!(h.keys(), ["demo.realm", "demo.province", "demo.taxes"]);
    assert!(h.key(KeyCode::Esc, KeyModifiers::NONE));
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    h.wait(500.0); // the keyboard's repeat delay
    assert!(h.key(KeyCode::Esc, KeyModifiers::NONE));
    assert_eq!(h.keys(), ["demo.realm"], "the first repeat looks like a new press");
    for _ in 0..19 {
        h.wait(33.0);
        assert!(h.key(KeyCode::Esc, KeyModifiers::NONE), "quick presses are the auto-repeat");
    }
    assert!(h.keys().is_empty(), "held 600 ms: all closed");
    h.wait(300.0);
    assert!(!h.key(KeyCode::Esc, KeyModifiers::NONE), "a new press after a pause belongs to the application");
}

#[test]
fn leaving_closes_a_preview_after_the_grace() {
    let mut h = H::new("en");
    h.open_realm();
    h.move_to((95, 27));
    h.wait(250.0);
    assert_eq!(h.keys(), ["demo.realm"], "grace");
    h.wait(100.0);
    assert!(h.keys().is_empty());
}

#[test]
fn moving_towards_a_preview_keeps_it_open_and_terms_on_the_way_wait() {
    let mut h = H::new("en");
    h.open_realm();
    let r = h.area("demo.realm");
    // jump to the far right, then move straight towards the window, crossing the page text
    h.move_to((98, r.y + 3));
    h.glide((r.x + r.width + 1, r.y + 3), 40);
    assert_eq!(h.keys(), ["demo.realm"], "still heading towards it after {} ms", 40 * 16);
    h.glide((r.x + r.width - 3, r.y + 3), 2);
    h.wait(1000.0);
    assert_eq!(h.keys(), ["demo.realm"], "inside: hot again");
}

#[test]
fn a_click_inside_a_preview_pins_it() {
    let mut h = H::new("en");
    h.open_realm();
    let r = h.area("demo.realm");
    h.glide((r.x + 2, r.y + 1), 3); // "Your", plain text
    assert!(h.click());
    assert!(h.win("demo.realm").pinned);
}

#[test]
fn timer_lock_pins_a_window_the_pointer_rests_in() {
    let mut h = H::new("en");
    h.hud.dt.engine.options.lock_after = 500.0;
    h.open_realm();
    let r = h.area("demo.realm");
    h.glide((r.x + 2, r.y + 1), 3);
    h.wait(300.0);
    assert!(!h.win("demo.realm").pinned);
    h.wait(300.0);
    assert!(h.win("demo.realm").pinned);
}

#[test]
fn f1_opens_the_focused_element_tab_and_enter_follow_terms_esc_returns_focus() {
    let mut h = H::new("en");
    h.focus_on(Target::Taxes);
    assert!(h.key(KeyCode::F(1), KeyModifiers::NONE));
    assert_eq!(h.keys(), ["demo.taxes"]);
    let taxes = h.win("demo.taxes").id;
    assert!(h.win("demo.taxes").pinned);
    assert_eq!(h.hud.dt.focus(), Some(&Focus::Term(AnchorId::Term(taxes, "demo.gold".into(), 0))), "focus moved in");
    assert!(h.key(KeyCode::Tab, KeyModifiers::NONE));
    assert_eq!(h.hud.dt.focus(), Some(&Focus::Term(AnchorId::Term(taxes, "demo.unrest".into(), 0))));
    assert!(h.key(KeyCode::Enter, KeyModifiers::NONE));
    assert_eq!(h.keys(), ["demo.taxes", "demo.unrest"]);
    let unrest = h.win("demo.unrest");
    assert!(unrest.pinned);
    assert_eq!(h.hud.dt.focused_window(), Some(unrest.id), "focus follows into the new window");
    h.wait(200.0);
    assert!(h.key(KeyCode::Esc, KeyModifiers::NONE));
    assert_eq!(h.keys(), ["demo.taxes"]);
    assert_eq!(
        h.hud.dt.focus(),
        Some(&Focus::Term(AnchorId::Term(taxes, "demo.unrest".into(), 0))),
        "back on the term"
    );
    h.wait(200.0);
    assert!(h.key(KeyCode::Esc, KeyModifiers::NONE));
    assert!(h.keys().is_empty());
    assert_eq!(h.hud.dt.focus(), None, "back to the application, whose focus is still on Taxes");
    assert_eq!(h.hud.focused(), Target::Taxes);
}

#[test]
fn question_mark_opens_but_is_typed_into_a_text_field() {
    let mut h = H::new("en");
    h.focus_on(Target::Gold);
    assert!(h.key(KeyCode::Char('?'), KeyModifiers::SHIFT));
    assert_eq!(h.keys(), ["demo.gold"]);
    h.wait(200.0);
    h.key(KeyCode::Esc, KeyModifiers::NONE);
    h.focus_on(Target::Search);
    assert!(!h.key(KeyCode::Char('?'), KeyModifiers::SHIFT));
    assert_eq!(h.hud.index.query, "?");
    assert!(h.keys().is_empty());
}

#[test]
fn f6_moves_focus_between_windows() {
    let mut h = H::new("en");
    let (realm, province) = h.pinned_chain();
    assert!(h.key(KeyCode::F(6), KeyModifiers::NONE));
    assert_eq!(h.hud.dt.focused_window(), Some(province), "F6: the newest window");
    assert!(h.key(KeyCode::F(6), KeyModifiers::NONE));
    assert_eq!(h.hud.dt.focused_window(), Some(realm), "F6: the next older one");
    assert!(h.key(KeyCode::F(6), KeyModifiers::SHIFT));
    assert_eq!(h.hud.dt.focused_window(), Some(province), "Shift+F6: newer");
}

#[test]
fn a_right_click_opens_an_element_pinned() {
    let mut h = H::new("en");
    let b = h.target(Target::Nobles);
    h.move_to(centre(b));
    assert!(h.mouse(MouseEventKind::Down(MouseButton::Right), centre(b)));
    assert!(h.mouse(MouseEventKind::Up(MouseButton::Right), centre(b)));
    assert_eq!(h.keys(), ["demo.nobles"]);
    assert!(h.win("demo.nobles").pinned);
}

#[test]
fn pin_and_close_buttons() {
    let mut h = H::new("en");
    h.open_realm();
    let r = h.area("demo.realm");
    let find = |h: &H, glyph: &str| (r.x..r.x + r.width).find(|x| h.symbol(*x, r.y) == glyph).expect(glyph);
    let pin = find(&h, "○");
    h.glide((pin, r.y), 4);
    assert!(h.click());
    assert!(h.win("demo.realm").pinned);
    assert_eq!(h.symbol(pin, r.y), "●", "a filled pin when pinned");
    assert!(h.click());
    assert!(!h.win("demo.realm").pinned, "pin off: a preview again");
    let close = find(&h, "✕");
    h.glide((close, r.y), 2);
    assert!(h.click());
    assert!(h.keys().is_empty());
}

#[test]
fn terms_on_the_page_open_root_windows() {
    let mut h = H::new("en");
    let t = h.page_term("deeptip.term");
    h.glide(centre(t), 4);
    h.wait(150.0);
    assert_eq!(h.keys(), ["deeptip.term"]);
    assert!(h.win("deeptip.term").parent.is_none());
    assert!(!h.area("deeptip.term").intersects(t), "beside the term, never on it");
    assert!(h.click());
    assert!(h.win("deeptip.term").pinned);
}

#[test]
fn english_shows_the_fallback_badge_for_german_only_entries() {
    let mut h = H::new("en");
    let b = h.target(Target::Gold);
    h.move_to(centre(b));
    h.wait(1100.0);
    let r = h.area("demo.gold");
    assert!(h.row(r.y).contains(" DE "), "badge: {}", h.row(r.y));
    assert!(h.window_text("demo.gold").contains("1,250"), "live value");
    // in German the same entry has no badge
    h.hud.activate(Target::Lang);
    h.wait(50.0);
    assert!(!h.row(h.area("demo.gold").y).contains(" DE "));
    assert!(h.window_text("demo.gold").contains("1.250"), "German number format");
}

#[test]
fn live_values_follow_the_application() {
    let mut h = H::new("en");
    h.focus_on(Target::Stability);
    h.key(KeyCode::F(1), KeyModifiers::NONE);
    assert!(h.window_text("demo.stability").contains("Currently: +1"));
    let b = h.target(Target::Stability);
    h.move_to(centre(b));
    assert!(!h.click(), "the application keeps its own clicks");
    h.wait(20.0);
    assert_eq!(h.hud.stability, 2);
    assert!(h.window_text("demo.stability").contains("Currently: +2"));
}

#[test]
fn a_click_on_an_element_hushes_it_until_the_pointer_leaves() {
    let mut h = H::new("en");
    let b = h.target(Target::Taxes);
    h.move_to(centre(b));
    h.wait(300.0);
    assert!(!h.click());
    assert_eq!(h.hud.tax, 2, "the click was the application's");
    h.wait(2000.0);
    assert!(h.keys().is_empty(), "no explanation while it is being used");
    h.move_to((95, 27));
    h.move_to(centre(h.target(Target::Taxes)));
    h.wait(1100.0);
    assert_eq!(h.keys(), ["demo.taxes"]);
}

#[test]
fn the_encyclopedia_filters_and_its_terms_are_live() {
    let mut h = H::new("en");
    h.focus_on(Target::Search);
    for c in "stabil".chars() {
        assert!(!h.key(KeyCode::Char(c), KeyModifiers::NONE));
    }
    assert_eq!(h.hud.index.query, "stabil");
    let t = h.page_term("demo.stability");
    h.glide(centre(t), 4);
    h.wait(150.0);
    assert_eq!(h.keys(), ["demo.stability"]);
    // "Mentioned in" lists the entries that link to it, as live terms
    assert!(h.hud.dt.terms().iter().any(|t| t.key == "demo.realm" && t.window.is_none()));
}

#[test]
fn tab_walks_the_page_terms_and_gives_the_focus_back() {
    let mut h = H::new("en");
    h.focus_on(Target::Prestige);
    h.key(KeyCode::Tab, KeyModifiers::NONE);
    assert_eq!(h.hud.focused(), Target::Intro);
    assert!(matches!(h.hud.dt.focus(), Some(Focus::Term(AnchorId::Page(..)))), "{:?}", h.hud.dt.focus());
    assert!(h.key(KeyCode::Enter, KeyModifiers::NONE));
    assert_eq!(h.keys(), ["deeptip.term"], "Enter follows the first page term");
    h.wait(200.0);
    h.key(KeyCode::Esc, KeyModifiers::NONE);
    assert!(h.keys().is_empty());
    let mut steps = 0;
    while h.hud.dt.focus().is_some() {
        h.key(KeyCode::Tab, KeyModifiers::NONE);
        steps += 1;
        assert!(steps < 200);
    }
    assert!(steps > 3);
    assert_eq!(h.hud.focused(), Target::DelayDown, "after the last term the application moves on");
}

#[test]
fn resizing_keeps_windows_on_screen() {
    let mut h = H::new("en");
    h.focus_on(Target::Gold);
    h.key(KeyCode::F(1), KeyModifiers::NONE);
    h.term.backend_mut().resize(64, 18);
    h.frame();
    let r = h.area("demo.gold");
    assert!(r.right() <= 64 && r.bottom() <= 18, "{r:?}");
    assert!(r.width <= 62);
}

#[test]
fn the_bottom_corner_prefers_the_top_side() {
    let mut h = H::new("en");
    let b = h.target(Target::Unrest);
    h.move_to(centre(b));
    h.wait(1100.0);
    let r = h.area("demo.unrest");
    assert!(r.bottom() < b.y, "above its button: {r:?} / {b:?}");
    assert!(r.right() <= 100);
}

#[test]
fn small_terminal_80_by_24() {
    let mut h = H::sized("de", 80, 24);
    let realm = h.open_realm();
    let t = h.term_in(realm, "demo.province");
    h.glide(centre(t), 6);
    h.wait(150.0);
    h.click();
    h.wait(50.0);
    let (a, b) = (h.area("demo.realm"), h.area("demo.province"));
    assert!(!a.intersects(b), "{a:?} / {b:?}");
    for r in [a, b] {
        assert!(r.right() <= 80 && r.bottom() <= 24);
    }
}

/// Prints the screen with a chain of windows (for the README): `cargo test --test hud -- --ignored --nocapture`.
#[test]
#[ignore]
fn print_screen() {
    let mut h = H::new("en");
    let realm = h.open_realm();
    h.focus_on(Target::Realm);
    h.key(KeyCode::F(1), KeyModifiers::NONE); // pins it, the focus moves in
    h.glide(centre(h.term_in(realm, "demo.stability")), 6);
    h.wait(150.0);
    for y in 0..30 {
        println!("{}", h.row(y).trim_end());
    }
}
