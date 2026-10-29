//! Behaviour of the window tree (SPEC §3) without a UI: invariants, grace, mouse tendency, suppression, arming,
//! timer lock, hush, outside clicks, Esc / F6 targets, vanished anchors.

use deeptip::{AnchorId, Engine, Event, Hover, LinkHover, Options, OutsideClick, Rect, TrigHover, Via, WinId};

fn el(n: u64) -> AnchorId {
    AnchorId::Element(n)
}

fn term(w: WinId, key: &str) -> AnchorId {
    AnchorId::Term(w, key.into(), 0)
}

fn on_element(n: u64, key: &str) -> Hover {
    Hover { trig: Some(TrigHover { anchor: el(n), key: key.into(), delay: None }), ..Hover::default() }
}

fn in_window(w: WinId) -> Hover {
    Hover { win: Some(w), ..Hover::default() }
}

fn on_term(w: WinId, key: &str) -> Hover {
    Hover { win: Some(w), link: Some(LinkHover { anchor: term(w, key), key: key.into(), parent: Some(w) }), trig: None }
}

fn keys(e: &Engine) -> Vec<&str> {
    e.windows().iter().map(|w| w.key.as_str()).collect()
}

fn win(e: &Engine, key: &str) -> WinId {
    e.windows().iter().find(|w| w.key == key).unwrap_or_else(|| panic!("{key} not open: {:?}", keys(e))).id
}

fn pinned(e: &Engine, id: WinId) -> bool {
    e.get(id).unwrap().pinned
}

/// Tick every 16 ms from `from` to `to` (inclusive).
fn run(e: &mut Engine, from: f64, to: f64) {
    let mut t = from;
    while t <= to {
        e.tick(t);
        t += 16.0;
    }
    e.tick(to);
}

/// Pointer moving from (x0, y) to the right by `dx` per 16 ms, from `from` to `to`, ticking along.
fn glide(e: &mut Engine, x0: f64, y: f64, dx: f64, from: f64, to: f64) {
    let mut t = from;
    let mut x = x0;
    while t <= to {
        e.pointer_moved(x, y, t);
        e.tick(t);
        x += dx;
        t += 16.0;
    }
}

#[test]
fn resting_opens_after_the_delay() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.realm"), 0.0);
    e.tick(799.0);
    assert!(e.windows().is_empty());
    e.tick(800.0);
    assert_eq!(keys(&e), ["demo.realm"]);
    let w = &e.windows()[0];
    assert!(!w.pinned);
    assert_eq!(w.via, Via::Hover);
    assert!(e.is_hot(w.id));
}

#[test]
fn own_delay_zero_opens_at_once() {
    let mut e = Engine::new(Options::default());
    let h = Hover {
        trig: Some(TrigHover { anchor: el(9), key: "deeptip.about".into(), delay: Some(0.0) }),
        ..Hover::default()
    };
    e.set_hover(h, 50.0);
    e.tick(50.0);
    assert_eq!(keys(&e), ["deeptip.about"]);
}

#[test]
fn leaving_before_the_delay_cancels() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.realm"), 0.0);
    e.set_hover(Hover::default(), 500.0);
    run(&mut e, 0.0, 2000.0);
    assert!(e.windows().is_empty());
}

#[test]
fn grace_closes_a_preview_and_returning_keeps_it() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.realm"), 0.0);
    e.tick(800.0);
    let r = win(&e, "demo.realm");
    e.set_hover(Hover::default(), 1000.0);
    e.tick(1299.0);
    assert!(e.is_open(r), "grace time");
    e.set_hover(in_window(r), 1100.0);
    run(&mut e, 1100.0, 3000.0);
    assert!(e.is_open(r), "hot again");
    e.set_hover(Hover::default(), 3000.0);
    e.tick(3299.0);
    assert!(e.is_open(r));
    e.tick(3300.0);
    assert!(!e.is_open(r), "closed after closeDelay");
}

#[test]
fn one_preview_per_parent() {
    let mut e = Engine::new(Options::default());
    let r = e.open("demo.realm", el(1), None, false, false, Via::Api, 0.0).unwrap();
    e.set_hover(on_term(r, "demo.province"), 100.0);
    e.tick(180.0);
    let p = win(&e, "demo.province");
    assert_eq!(e.get(p).unwrap().parent, Some(r));
    e.set_hover(on_term(r, "demo.stability"), 300.0);
    e.tick(380.0);
    assert_eq!(keys(&e), ["demo.realm", "demo.stability"]);
    let s = win(&e, "demo.stability");
    assert_eq!(e.get(r).unwrap().children, vec![s]);
}

#[test]
fn a_new_root_preview_replaces_the_old_one_but_not_a_pinned_root() {
    let mut e = Engine::new(Options::default());
    e.open_pinned(el(1), "demo.realm", false, Via::Key, 0.0);
    e.set_hover(on_element(2, "demo.taxes"), 10.0);
    e.tick(810.0);
    e.set_hover(on_element(3, "demo.gold"), 900.0);
    e.tick(1700.0);
    assert_eq!(keys(&e), ["demo.realm", "demo.gold"]);
}

#[test]
fn a_click_pins_the_whole_chain() {
    let mut e = Engine::new(Options::default());
    let r = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    e.set_hover(on_term(r, "demo.province"), 10.0);
    e.tick(90.0);
    let c = win(&e, "demo.province");
    e.set_hover(on_term(c, "demo.taxes"), 100.0);
    e.tick(180.0);
    let g = win(&e, "demo.taxes");
    assert!(!pinned(&e, r) && !pinned(&e, c) && !pinned(&e, g));
    // click on the term whose preview is open: it and everything above it are pinned
    let got = e.follow(term(c, "demo.taxes"), "demo.taxes", Some(c), false, 200.0);
    assert_eq!(got, Some(g));
    assert!(pinned(&e, r) && pinned(&e, c) && pinned(&e, g));
    let pins: Vec<_> = e.take_events().into_iter().filter(|ev| matches!(ev, Event::Pinned { .. })).collect();
    assert_eq!(pins.len(), 3);
}

#[test]
fn clicking_a_term_without_preview_opens_it_pinned() {
    let mut e = Engine::new(Options::default());
    let r = e.open("demo.realm", el(1), None, true, false, Via::Key, 0.0).unwrap();
    let c = e.follow(term(r, "demo.stability"), "demo.stability", Some(r), true, 10.0).unwrap();
    assert!(pinned(&e, c));
    assert_eq!(e.get(c).unwrap().via, Via::Click);
    assert_eq!(e.take_focus_request(), Some(c));
}

#[test]
fn closing_closes_the_subtree() {
    let mut e = Engine::new(Options::default());
    let r = e.open("a", el(1), None, true, false, Via::Api, 0.0).unwrap();
    let c = e.open("b", term(r, "b"), Some(r), true, false, Via::Api, 0.0).unwrap();
    let g = e.open("c", term(c, "c"), Some(c), true, false, Via::Api, 0.0).unwrap();
    e.take_events();
    e.close(c);
    assert_eq!(keys(&e), ["a"]);
    assert!(e.get(r).unwrap().children.is_empty());
    let closed: Vec<WinId> = e
        .take_events()
        .into_iter()
        .filter_map(|ev| if let Event::Closed { win, .. } = ev { Some(win) } else { None })
        .collect();
    assert_eq!(closed, vec![g, c]);
}

#[test]
fn the_same_key_further_up_flashes_instead_of_opening_twice() {
    let mut e = Engine::new(Options::default());
    let s = e.open("demo.stability", el(1), None, true, false, Via::Api, 0.0).unwrap();
    let u = e.open("demo.unrest", term(s, "demo.unrest"), Some(s), true, false, Via::Api, 0.0).unwrap();
    let got = e.open("demo.stability", term(u, "demo.stability"), Some(u), false, false, Via::Hover, 100.0);
    assert_eq!(got, Some(s));
    assert_eq!(e.windows().len(), 2);
    assert!(e.flash_progress(s, 200.0).is_some());
    assert!(e.flash_progress(s, 800.0).is_none());
}

#[test]
fn the_same_anchor_reuses_its_window() {
    let mut e = Engine::new(Options::default());
    let a = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    let b = e.open("demo.realm", el(1), None, true, false, Via::Key, 10.0).unwrap();
    assert_eq!(a, b);
    assert!(pinned(&e, a));
    assert_eq!(e.windows().len(), 1);
}

#[test]
fn pinned_parent_needed_for_children() {
    let mut e = Engine::new(Options::default());
    assert_eq!(e.open("x", term(42, "x"), Some(42), false, false, Via::Api, 0.0), None, "parent not open");
}

#[test]
fn mouse_tendency_extends_the_grace_up_to_one_and_a_half_seconds() {
    let mut e = Engine::new(Options::default());
    let w = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    e.set_rect(w, Rect::new(500.0, 100.0, 800.0, 400.0));
    e.set_hover(in_window(w), 0.0);
    e.set_hover(Hover::default(), 1000.0);
    // moving right, straight at the window: 1 px per 16 ms
    glide(&mut e, 100.0, 250.0, 1.0, 1000.0, 2400.0);
    assert!(e.is_open(w), "still heading towards it");
    glide(&mut e, 188.0, 250.0, 1.0, 2416.0, 2600.0);
    assert!(!e.is_open(w), "the tendency ends 1.5 s after leaving");
}

/// A preview that the pointer left at t = 1000.
fn left_preview() -> (Engine, WinId) {
    let mut e = Engine::new(Options::default());
    let w = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    e.set_rect(w, Rect::new(500.0, 100.0, 800.0, 400.0));
    e.set_hover(in_window(w), 0.0);
    e.set_hover(Hover::default(), 1000.0);
    (e, w)
}

#[test]
fn moving_away_closes_after_the_grace() {
    let (mut e, w) = left_preview();
    glide(&mut e, 400.0, 250.0, -2.0, 1000.0, 1290.0);
    assert!(e.is_open(w), "grace");
    glide(&mut e, 300.0, 250.0, -2.0, 1306.0, 1310.0);
    assert!(!e.is_open(w), "moving away");
}

#[test]
fn a_resting_pointer_has_no_tendency() {
    let (mut e, w) = left_preview();
    glide(&mut e, 100.0, 250.0, 1.0, 1000.0, 1100.0); // heads there, then rests
    run(&mut e, 1100.0, 1400.0);
    assert!(!e.is_open(w));
}

#[test]
fn terms_crossed_on_the_way_into_a_preview_do_not_replace_it() {
    let mut e = Engine::new(Options::default());
    let r = e.open("demo.realm", el(1), None, true, false, Via::Key, 0.0).unwrap();
    e.set_rect(r, Rect::new(0.0, 0.0, 300.0, 300.0));
    e.set_hover(on_term(r, "demo.province"), 0.0);
    e.tick(80.0);
    let c = win(&e, "demo.province");
    e.set_rect(c, Rect::new(310.0, 0.0, 610.0, 300.0));
    // on the way to the preview the pointer crosses another term of the same window
    e.set_hover(on_term(r, "demo.stability"), 100.0);
    glide(&mut e, 200.0, 150.0, 2.0, 100.0, 600.0);
    assert_eq!(keys(&e), ["demo.realm", "demo.province"], "suppressed while heading into the preview");
    // the pointer stops on the term: now it opens and replaces the preview
    run(&mut e, 616.0, 900.0);
    assert_eq!(keys(&e), ["demo.realm", "demo.stability"]);
}

#[test]
fn timer_lock_pins_after_resting_inside() {
    let mut e = Engine::new(Options { lock_after: 1500.0, ..Options::default() });
    let w = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    e.set_hover(in_window(w), 100.0);
    e.tick(1599.0);
    assert!(!pinned(&e, w));
    assert!(e.lock_progress(w, 850.0).is_some_and(|p| (p - 0.5).abs() < 1e-9));
    e.tick(1600.0);
    assert!(pinned(&e, w));
    assert!(e.lock_progress(w, 1600.0).is_none());
}

#[test]
fn click_inside_a_preview_pins_it() {
    let mut e = Engine::new(Options::default());
    let w = e.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    e.click_inside(w);
    assert!(pinned(&e, w));
    let mut off = Engine::new(Options { click_inside_pins: false, ..Options::default() });
    let w = off.open("demo.realm", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    off.click_inside(w);
    assert!(!pinned(&off, w));
}

#[test]
fn using_an_element_hushes_it_until_the_pointer_leaves() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.taxes"), 0.0);
    e.pointer_down(false, Some(&el(1)), false);
    e.set_hover(on_element(1, "demo.taxes"), 100.0);
    run(&mut e, 0.0, 2000.0);
    assert!(e.windows().is_empty(), "clicked: no explanation");
    e.set_hover(Hover::default(), 2000.0);
    e.set_hover(on_element(1, "demo.taxes"), 2100.0);
    e.tick(2900.0);
    assert_eq!(keys(&e), ["demo.taxes"]);
}

#[test]
fn a_closed_window_does_not_reopen_while_the_pointer_rests() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.realm"), 0.0);
    e.tick(800.0);
    assert!(e.close_newest(None).is_some());
    run(&mut e, 800.0, 3000.0);
    assert!(e.windows().is_empty());
}

#[test]
fn outside_presses() {
    let mut e = Engine::new(Options::default());
    e.open_pinned(el(1), "demo.realm", false, Via::Key, 0.0);
    e.pointer_down(false, None, false);
    assert_eq!(e.windows().len(), 1, "touch mode: a mouse press keeps them");
    e.pointer_down(true, None, true);
    assert_eq!(e.windows().len(), 1, "a press inside a window keeps them");
    e.pointer_down(false, None, true);
    assert!(e.windows().is_empty(), "touch press outside closes all");

    e.options.outside_click_closes = OutsideClick::Always;
    e.open_pinned(el(1), "demo.realm", false, Via::Key, 0.0);
    e.pointer_down(false, None, false);
    assert!(e.windows().is_empty());

    e.options.outside_click_closes = OutsideClick::Never;
    e.open_pinned(el(1), "demo.realm", false, Via::Key, 0.0);
    e.pointer_down(false, None, true);
    assert_eq!(e.windows().len(), 1);
}

#[test]
fn escape_and_f6_targets() {
    let mut e = Engine::new(Options::default());
    let r = e.open("a", el(1), None, true, false, Via::Api, 0.0).unwrap();
    let c = e.open("b", term(r, "b"), Some(r), true, false, Via::Api, 0.0).unwrap();
    let g = e.open("c", term(c, "c"), Some(c), true, false, Via::Api, 0.0).unwrap();
    // F6 from nowhere: the newest; then older; wraps
    assert_eq!(e.cycle(None, 1), Some(g));
    assert_eq!(e.cycle(Some(g), 1), Some(c));
    assert_eq!(e.cycle(Some(r), 1), Some(g));
    assert_eq!(e.cycle(Some(g), -1), Some(r));
    // Esc in c closes the newest window opened from c, then c itself
    assert_eq!(e.newest(Some(c)), Some(g));
    assert_eq!(e.close_newest(Some(c)), Some(g));
    assert_eq!(e.close_newest(Some(c)), Some(c));
    assert_eq!(e.close_newest(None), Some(r));
    assert_eq!(e.close_newest(None), None);
}

#[test]
fn vanished_anchors_close_previews_and_freeze_pinned_roots() {
    let mut e = Engine::new(Options::default());
    let b = e.open_pinned(el(2), "b", false, Via::Key, 0.0).unwrap();
    let c = e.open("c", term(b, "c"), Some(b), true, false, Via::Click, 0.0).unwrap();
    let a = e.open("a", el(1), None, false, false, Via::Hover, 0.0).unwrap();
    assert_eq!(e.windows().len(), 3);
    let keep = term(b, "c");
    e.retain_anchors(|x| x == &keep);
    assert!(!e.is_open(a));
    assert!(e.is_open(b) && e.get(b).unwrap().frozen);
    assert!(e.is_open(c));
    e.set_anchor_rect(b, Rect::new(0.0, 0.0, 10.0, 10.0));
    assert!(!e.get(b).unwrap().frozen, "the anchor is back");
}

#[test]
fn unpinning_lets_a_window_close_when_not_hot() {
    let mut e = Engine::new(Options::default());
    let r = e.open_pinned(el(1), "a", false, Via::Key, 0.0).unwrap();
    let c = e.follow(term(r, "b"), "b", Some(r), false, 0.0).unwrap();
    e.unpin(r, 100.0);
    assert!(!pinned(&e, r) && !pinned(&e, c), "unpin goes down the subtree");
    e.tick(399.0);
    assert!(e.is_open(r));
    e.tick(400.0);
    assert!(e.windows().is_empty());
}

#[test]
fn events_and_arming_progress() {
    let mut e = Engine::new(Options::default());
    e.set_hover(on_element(1, "demo.realm"), 0.0);
    let (anchor, p) = e.arming(400.0).unwrap();
    assert_eq!(anchor, &el(1));
    assert!((p - 0.5).abs() < 1e-9);
    e.tick(800.0);
    assert!(e.arming(800.0).is_none());
    let id = win(&e, "demo.realm");
    assert_eq!(e.take_events(), vec![Event::Opened { win: id, key: "demo.realm".into() }]);
    e.set_hover(on_term(id, "demo.taxes"), 900.0);
    assert!(e.arming(900.0).is_none(), "terms have no arming progress");
}
