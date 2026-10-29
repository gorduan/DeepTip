//! The egui layer driven headless: a real `egui::Context` with synthetic pointer, click, key and time input,
//! the shared glossaries and the HUD of the example. No window or GPU is needed.
#![cfg(feature = "egui")]

use std::collections::HashMap;
use std::path::PathBuf;

use deeptip::{Action, AnchorId, DeepTip, MarkOptions, WinId, Window};
use egui::{vec2, Context, Event, Id, Key, Modifiers, PointerButton, Pos2, RawInput, Rect};

const HUD: [(&str, &str); 5] = [
    ("Realm", "demo.realm"),
    ("Stability +1", "demo.stability"),
    ("Taxes: normal", "demo.taxes"),
    ("Nobles", "demo.nobles"),
    ("Gold 1,250", "demo.gold"),
];

struct Harness {
    ctx: Context,
    dt: DeepTip,
    time: f64,
    events: Vec<Event>,
    modifiers: Modifiers,
    buttons: HashMap<String, (Rect, Id)>,
    pointer: Pos2,
    /// Render the encyclopedia with this search text instead of the page text.
    index: Option<String>,
}

fn erect(r: deeptip::Rect) -> Rect {
    Rect::from_min_max(Pos2::new(r.left as f32, r.top as f32), Pos2::new(r.right as f32, r.bottom as f32))
}

impl Harness {
    fn new(locale: &str) -> Self {
        let mut dt = DeepTip::new(locale, &["de", "en"]);
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../glossary");
        let failed = dt.set_sources(&[
            root.join("core/{locale}.json").display().to_string(),
            root.join("example/{locale}.json").display().to_string(),
        ]);
        assert!(failed.is_empty(), "{failed:?}");
        dt.set_value("stability", "+1");
        dt.set_value("gold", "1,250");
        let mut h = Self {
            ctx: Context::default(),
            dt,
            time: 0.0,
            events: Vec::new(),
            modifiers: Modifiers::NONE,
            buttons: HashMap::new(),
            pointer: Pos2::new(990.0, 690.0),
            index: None,
        };
        h.events.push(Event::PointerMoved(h.pointer));
        h.frame();
        h.frame();
        h
    }

    fn frame(&mut self) {
        let input = RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, vec2(1000.0, 700.0))),
            time: Some(self.time),
            events: std::mem::take(&mut self.events),
            ..RawInput::default()
        };
        let dt = &mut self.dt;
        let buttons = &mut self.buttons;
        let index = &mut self.index;
        let output = self.ctx.run_ui(input, |ui| {
            egui::Panel::top("hud").show(ui, |ui| {
                ui.horizontal(|ui| {
                    for (label, key) in HUD {
                        let r = ui.button(label);
                        dt.mark(&r, key);
                        buttons.insert(label.to_owned(), (r.rect, r.id));
                    }
                    let help = ui.button("?");
                    dt.mark_with(&help, "deeptip.about", MarkOptions { delay: Some(0.0), place: Vec::new() });
                    buttons.insert("?".to_owned(), (help.rect, help.id));
                });
            });
            egui::CentralPanel::default().show(ui, |ui| match index {
                Some(query) => dt.index(ui, query),
                None => {
                    ui.add_space(400.0);
                    dt.text(ui, "Try [[demo.taxes]] on the page.");
                }
            });
            dt.show(ui.ctx());
        });
        output.drop_without_applying_deltas();
        self.time += 1.0 / 60.0;
    }

    fn wait(&mut self, secs: f64) {
        for _ in 0..(secs * 60.0).ceil() as usize {
            self.frame();
        }
    }

    fn move_to(&mut self, p: Pos2) {
        self.pointer = p;
        self.events.push(Event::PointerMoved(p));
        self.frame();
    }

    /// Glide to `p` in `steps` frames, like a real mouse.
    fn glide(&mut self, p: Pos2, steps: usize) {
        let from = self.pointer;
        for i in 1..=steps {
            self.move_to(from + (p - from) * (i as f32 / steps as f32));
        }
    }

    fn click(&mut self) {
        let pos = self.pointer;
        let modifiers = self.modifiers;
        self.events.push(Event::PointerButton { pos, button: PointerButton::Primary, pressed: true, modifiers });
        self.frame();
        self.events.push(Event::PointerButton { pos, button: PointerButton::Primary, pressed: false, modifiers });
        self.frame();
    }

    fn key(&mut self, key: Key, modifiers: Modifiers) {
        self.modifiers = modifiers;
        self.events.push(Event::ModifiersChanged(modifiers));
        self.events.push(Event::Key { key, physical_key: None, pressed: true, repeat: false, modifiers });
        self.frame();
        self.events.push(Event::Key { key, physical_key: None, pressed: false, repeat: false, modifiers });
        self.events.push(Event::ModifiersChanged(Modifiers::NONE));
        self.modifiers = Modifiers::NONE;
        self.frame();
    }

    fn keys(&self) -> Vec<&str> {
        self.dt.engine.windows().iter().map(|w| w.key.as_str()).collect()
    }

    fn window(&self, key: &str) -> &Window {
        self.dt
            .engine
            .windows()
            .iter()
            .find(|w| w.key == key)
            .unwrap_or_else(|| panic!("{key} is not open: {:?}", self.keys()))
    }

    fn rect(&self, key: &str) -> Rect {
        erect(self.window(key).rect.expect("laid out"))
    }

    fn button(&self, label: &str) -> Rect {
        self.buttons[label].0
    }

    /// A term with `key` inside window `win`.
    fn term_in(&self, win: WinId, key: &str) -> Rect {
        self.dt
            .terms()
            .iter()
            .find(|(a, k, _)| k == key && matches!(a, AnchorId::Term(w, ..) if *w == win))
            .map(|(_, _, r)| *r)
            .unwrap_or_else(|| panic!("no term {key} in window {win}"))
    }

    fn page_term(&self, key: &str) -> Rect {
        self.dt
            .terms()
            .iter()
            .find(|(a, k, _)| k == key && matches!(a, AnchorId::Page(..)))
            .map(|(_, _, r)| *r)
            .unwrap_or_else(|| panic!("no page term {key}"))
    }

    /// Rest on the Realm button until its preview is open and laid out.
    fn open_realm(&mut self) -> WinId {
        let b = self.button("Realm");
        self.move_to(b.center());
        self.wait(1.0);
        self.window("demo.realm").id
    }
}

#[test]
fn resting_opens_the_first_window_below_its_button() {
    let mut h = Harness::new("en");
    let b = h.button("Realm");
    h.move_to(b.center());
    h.wait(0.6);
    assert!(h.keys().is_empty(), "delay 800 ms");
    h.wait(0.4);
    assert_eq!(h.keys(), ["demo.realm"]);
    let w = h.window("demo.realm");
    assert!(!w.pinned);
    let r = h.rect("demo.realm");
    assert!(r.top() >= b.bottom() + 7.0, "below the button: {r:?} / {b:?}");
    assert!(!r.intersects(b));
    assert!(r.width() >= 239.0 && r.width() <= 385.0, "width within min/max: {}", r.width());
}

#[test]
fn hovering_a_term_previews_it_and_a_click_pins_the_chain() {
    let mut h = Harness::new("en");
    let realm = h.open_realm();
    let t = h.term_in(realm, "demo.province");
    h.glide(t.center(), 6);
    h.wait(0.3);
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    let child = h.window("demo.province");
    assert_eq!(child.parent, Some(realm));
    assert!(!child.pinned);
    assert!(!h.rect("demo.province").intersects(h.rect("demo.realm")), "a child never covers its parent");
    h.click();
    h.wait(0.1);
    assert!(h.window("demo.realm").pinned && h.window("demo.province").pinned);
}

#[test]
fn another_term_replaces_the_preview_of_the_same_parent() {
    let mut h = Harness::new("en");
    let realm = h.open_realm();
    h.glide(h.term_in(realm, "demo.province").center(), 6);
    h.wait(0.3);
    h.glide(h.term_in(realm, "demo.stability").center(), 2);
    h.wait(0.6);
    assert_eq!(h.keys(), ["demo.realm", "demo.stability"]);
}

#[test]
fn escape_closes_the_newest_and_shift_escape_closes_all() {
    let mut h = Harness::new("en");
    let realm = h.open_realm();
    h.glide(h.term_in(realm, "demo.province").center(), 6);
    h.wait(0.3);
    h.click();
    h.wait(0.1);
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    h.key(Key::Escape, Modifiers::NONE);
    assert_eq!(h.keys(), ["demo.realm"]);
    h.wait(1.0);
    assert_eq!(h.keys(), ["demo.realm"], "resting on the term does not reopen it");
    h.click();
    h.wait(0.1);
    assert_eq!(h.keys(), ["demo.realm", "demo.province"]);
    h.key(Key::Escape, Modifiers::SHIFT);
    assert!(h.keys().is_empty());
}

#[test]
fn leaving_closes_previews_after_the_grace() {
    let mut h = Harness::new("en");
    h.open_realm();
    h.move_to(Pos2::new(900.0, 650.0));
    h.wait(0.2);
    assert_eq!(h.keys(), ["demo.realm"], "grace");
    h.wait(0.3);
    assert!(h.keys().is_empty());
}

#[test]
fn a_click_inside_a_preview_pins_it() {
    let mut h = Harness::new("en");
    h.open_realm();
    let r = h.rect("demo.realm");
    h.glide(r.left_top() + vec2(20.0, 14.0), 4);
    h.click();
    assert!(h.window("demo.realm").pinned);
}

#[test]
fn timer_lock_pins_a_window_the_pointer_rests_in() {
    let mut h = Harness::new("en");
    h.dt.engine.options.lock_after = 500.0;
    h.open_realm();
    let r = h.rect("demo.realm");
    h.glide(r.left_top() + vec2(20.0, 14.0), 4);
    h.wait(0.3);
    assert!(!h.window("demo.realm").pinned);
    h.wait(0.4);
    assert!(h.window("demo.realm").pinned);
}

#[test]
fn f1_opens_the_focused_element_pinned_and_moves_focus_in() {
    let mut h = Harness::new("en");
    let (_, id) = h.buttons["Taxes: normal"];
    h.ctx.memory_mut(|m| m.request_focus(id));
    h.frame();
    h.key(Key::F1, Modifiers::NONE);
    h.wait(0.1);
    assert_eq!(h.keys(), ["demo.taxes"]);
    assert!(h.window("demo.taxes").pinned);
    let focused = h.ctx.memory(|m| m.focused());
    assert!(focused.is_some() && focused != Some(id), "focus moved into the window");
    // Esc closes it and focus returns to the button
    h.key(Key::Escape, Modifiers::NONE);
    h.frame();
    assert!(h.keys().is_empty());
    assert_eq!(h.ctx.memory(|m| m.focused()), Some(id));
}

#[test]
fn own_delay_zero_and_terms_on_the_page() {
    let mut h = Harness::new("en");
    h.move_to(h.button("?").center());
    h.wait(0.05);
    assert_eq!(h.keys(), ["deeptip.about"]);
    let t = h.page_term("demo.taxes");
    h.move_to(t.center());
    h.wait(0.3);
    assert_eq!(h.keys(), ["demo.taxes"], "a page term opens a root window that replaces the root preview");
    assert!(h.window("demo.taxes").parent.is_none());
}

#[test]
fn german_and_fallback_entries_render() {
    let mut h = Harness::new("de");
    let b = h.button("Gold 1,250");
    h.move_to(b.center());
    h.wait(1.0);
    assert_eq!(h.keys(), ["demo.gold"]);
    h.dt.set_locale("en");
    h.wait(0.1);
    // demo.gold exists only in German: still open, now from the fallback locale
    let found = h.dt.glossary.entry("demo.gold").unwrap();
    assert_eq!(found.locale, "de");
    assert_eq!(h.keys(), ["demo.gold"]);
}

/// Pin realm and its province preview by hovering the term and clicking it.
fn pinned_chain(h: &mut Harness) -> (WinId, WinId) {
    let realm = h.open_realm();
    h.glide(h.term_in(realm, "demo.province").center(), 6);
    h.wait(0.3);
    h.click();
    h.wait(0.1);
    (realm, h.window("demo.province").id)
}

#[test]
fn holding_escape_closes_all() {
    let mut h = Harness::new("en");
    pinned_chain(&mut h);
    h.events.push(Event::Key {
        key: Key::Escape,
        physical_key: None,
        pressed: true,
        repeat: false,
        modifiers: Modifiers::NONE,
    });
    h.frame();
    assert_eq!(h.keys(), ["demo.realm"], "the press closes the newest");
    h.wait(0.4);
    assert_eq!(h.keys(), ["demo.realm"]);
    h.wait(0.3);
    assert!(h.keys().is_empty(), "holding Esc 600 ms closes all");
    h.events.push(Event::Key {
        key: Key::Escape,
        physical_key: None,
        pressed: false,
        repeat: false,
        modifiers: Modifiers::NONE,
    });
    h.frame();
}

#[test]
fn f6_moves_focus_between_windows() {
    let mut h = Harness::new("en");
    let (realm, province) = pinned_chain(&mut h);
    h.key(Key::F6, Modifiers::NONE);
    h.frame();
    assert_eq!(h.dt.focused_window(&h.ctx), Some(province), "F6: the newest window");
    h.key(Key::F6, Modifiers::NONE);
    h.frame();
    assert_eq!(h.dt.focused_window(&h.ctx), Some(realm), "F6: the next older one");
    h.key(Key::F6, Modifiers::SHIFT);
    h.frame();
    assert_eq!(h.dt.focused_window(&h.ctx), Some(province), "Shift+F6: newer");
    // Esc in the realm window closes the newest window opened from it
    h.key(Key::F6, Modifiers::NONE);
    h.frame();
    h.key(Key::Escape, Modifiers::NONE);
    assert_eq!(h.keys(), ["demo.realm"]);
}

#[test]
fn the_encyclopedia_lists_entries_with_live_terms() {
    let mut h = Harness::new("en");
    h.index = Some("stabil".to_owned());
    h.wait(0.1);
    let t = h.page_term("demo.stability");
    h.move_to(t.center());
    h.wait(0.3);
    assert_eq!(h.keys(), ["demo.stability"]);
    // "Mentioned in" lists the entries that link to it
    assert!(h.dt.terms().iter().any(|(a, k, _)| k == "demo.realm" && matches!(a, AnchorId::Page(..))));
}

#[test]
fn gamepad_actions_open_step_activate_and_close() {
    let mut h = Harness::new("en");
    let (_, id) = h.buttons["Realm"];
    h.ctx.memory_mut(|m| m.request_focus(id));
    h.frame();
    h.dt.action(&h.ctx, Action::OpenFocused); // Y on the focused element
    h.wait(0.1);
    assert_eq!(h.keys(), ["demo.realm"]);
    let realm = h.window("demo.realm").id;
    assert!(h.window("demo.realm").pinned);
    assert_eq!(h.dt.focused_window(&h.ctx), Some(realm), "focus moved in");
    // d-pad: from the first term ("provinces") to the next ("stability"); A follows it
    h.dt.action(&h.ctx, Action::Step(1));
    h.frame();
    h.dt.action(&h.ctx, Action::Activate);
    h.wait(0.1);
    assert_eq!(h.keys(), ["demo.realm", "demo.stability"]);
    assert!(h.window("demo.stability").pinned);
    // B: the newest window opened from the focused one
    h.dt.action(&h.ctx, Action::CloseNewest);
    h.frame();
    assert_eq!(h.keys(), ["demo.realm"]);
    h.dt.action(&h.ctx, Action::CloseAll);
    h.frame();
    assert!(h.keys().is_empty());
    assert_eq!(h.ctx.memory(|m| m.focused()), Some(id), "focus back on the element");
}
