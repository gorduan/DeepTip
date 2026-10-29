//! DeepTip on a bare ratatui screen with small glossaries of its own: missing keys, wide characters, long entries,
//! vanished anchors, ASCII glyphs, outside clicks, gamepad actions, rest progress and timers.

use deeptip_ratatui::{Action, AnchorId, DeepTip, Focus, MarkOptions, MarkState, OutsideClick, Symbols};
use ratatui::backend::TestBackend;
use ratatui::crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::Terminal;

struct B {
    term: Terminal<TestBackend>,
    dt: DeepTip,
    t: f64,
    marks: Vec<(Rect, &'static str, MarkOptions)>,
    states: Vec<MarkState>,
}

fn focused() -> MarkOptions {
    MarkOptions { focused: true, ..MarkOptions::default() }
}

impl B {
    fn new(json: &str, w: u16, h: u16) -> Self {
        let mut dt = DeepTip::new("en", &["en"]);
        dt.glossary.add_json("en", json).expect("valid JSON");
        dt.set_time(0.0);
        Self { term: Terminal::new(TestBackend::new(w, h)).unwrap(), dt, t: 0.0, marks: Vec::new(), states: Vec::new() }
    }

    /// Draw like a real loop: again at once while DeepTip asks for it (`timeout() == 0`).
    fn frame(&mut self) {
        for _ in 0..4 {
            let (dt, marks, states) = (&mut self.dt, &self.marks, &mut self.states);
            self.term
                .draw(|f| {
                    states.clear();
                    for (r, key, opts) in marks {
                        f.buffer_mut().set_string(r.x, r.y, format!("[{key}]"), Style::default());
                        states.push(dt.mark_with(*r, key, opts.clone()));
                    }
                    dt.render(f);
                })
                .unwrap();
            if self.dt.timeout() != Some(std::time::Duration::ZERO) {
                break;
            }
        }
    }

    fn wait(&mut self, ms: f64) {
        let end = self.t + ms;
        while self.t < end {
            self.t = (self.t + 16.0).min(end);
            self.dt.set_time(self.t);
            self.frame();
        }
    }

    fn mouse(&mut self, kind: MouseEventKind, x: u16, y: u16) -> bool {
        let used =
            self.dt.handle_event(&Event::Mouse(MouseEvent { kind, column: x, row: y, modifiers: KeyModifiers::NONE }));
        self.frame();
        used
    }

    fn key(&mut self, code: KeyCode) -> bool {
        let used = self.dt.handle_event(&Event::Key(KeyEvent::new(code, KeyModifiers::NONE)));
        self.frame();
        used
    }

    fn keys(&self) -> Vec<String> {
        self.dt.engine.windows().iter().map(|w| w.key.clone()).collect()
    }

    fn area(&self, key: &str) -> Rect {
        let w = self.dt.engine.windows().iter().find(|w| w.key == key).unwrap_or_else(|| panic!("{key} not open"));
        self.dt.window_area(w.id).expect("drawn")
    }

    fn text(&self, r: Rect) -> String {
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
}

#[test]
fn a_missing_key_shows_the_key_and_the_missing_label() {
    let mut b = B::new(r#"{"a.b": {"title": "B", "body": "Links to [[gone.key]]."}}"#, 80, 20);
    b.marks = vec![(Rect::new(2, 1, 14, 1), "demo.nothing", focused())];
    b.frame();
    assert!(b.key(KeyCode::F(1)));
    let text = b.text(b.area("demo.nothing"));
    assert!(text.contains("demo.nothing"), "{text}");
    assert!(text.contains("No explanation for this term yet."), "{text}");
    // a link to a missing entry is shown, but it is not a term
    b.marks = vec![(Rect::new(2, 1, 5, 1), "a.b", focused())];
    b.key(KeyCode::Esc);
    b.wait(200.0);
    b.key(KeyCode::F(1));
    assert!(b.text(b.area("a.b")).contains("Links to gone.key."));
    assert!(b.dt.terms().is_empty());
}

#[test]
fn wide_characters_keep_the_frame_intact_and_their_terms_hit() {
    let json = r#"{
      "jp.a": {"title": "漢字", "body": "これは長い説明文です。何行にも折り返されて、枠は右端でそろったままです。[[jp.b|次の項目]]を見てください。"},
      "jp.b": {"title": "次", "short": "二つ目の項目。"}
    }"#;
    let mut b = B::new(json, 80, 24);
    b.marks = vec![(Rect::new(2, 1, 6, 1), "jp.a", focused())];
    b.frame();
    b.key(KeyCode::F(1));
    let r = b.area("jp.a");
    for y in r.y..r.y + r.height {
        let edge = b.symbol(r.x + r.width - 1, y);
        assert!(["│", "╮", "╯", "┃"].contains(&edge.as_str()), "row {y}: right edge {edge:?}\n{}", b.text(r));
        assert!(["│", "╭", "╰"].contains(&b.symbol(r.x, y).as_str()));
    }
    let t = b.dt.terms().into_iter().find(|t| t.key == "jp.b").expect("term");
    assert!(t.area.x >= r.x + 2 && t.area.x + t.area.width <= r.x + r.width - 2, "{t:?} in {r:?}");
    b.mouse(MouseEventKind::Moved, t.area.x + 1, t.area.y);
    b.wait(150.0);
    assert_eq!(b.keys(), ["jp.a", "jp.b"]);
}

#[test]
fn a_long_entry_scrolls_and_stays_on_screen() {
    let long: Vec<String> = (1..=30).map(|i| format!("Sentence {i} explains a little more.")).collect();
    let json = format!(
        r#"{{"long.a": {{"title": "Long", "body": "{} See [[long.b]]."}}, "long.b": {{"title": "End", "short": "The end."}}}}"#,
        long.join(" ")
    );
    let mut b = B::new(&json, 70, 14);
    b.marks = vec![(Rect::new(2, 1, 8, 1), "long.a", focused())];
    b.frame();
    b.key(KeyCode::F(1));
    let r = b.area("long.a");
    assert!(r.y + r.height <= 14 && r.height <= 13, "{r:?}");
    // the focus is on the only term, at the very end: the body scrolled to show it
    let t = b.dt.terms().into_iter().find(|t| t.key == "long.b").expect("visible term");
    assert!(t.area.y > r.y && t.area.y < r.y + r.height - 1);
    assert!(!b.text(r).contains("Sentence 1 "), "the beginning scrolled away");
    for _ in 0..40 {
        assert!(b.mouse(MouseEventKind::ScrollUp, r.x + 5, r.y + 3));
    }
    assert!(b.text(r).contains("Sentence 1 "), "the wheel scrolls back\n{}", b.text(r));
}

#[test]
fn vanished_anchors_close_previews_and_freeze_pinned_roots() {
    let mut b =
        B::new(r#"{"x.a": {"title": "A", "short": "First."}, "x.b": {"title": "B", "short": "Second."}}"#, 80, 24);
    b.marks = vec![
        (Rect::new(2, 1, 5, 1), "x.a", MarkOptions::default()),
        (Rect::new(40, 1, 5, 1), "x.b", MarkOptions::default()),
    ];
    b.frame();
    assert!(b.mouse(MouseEventKind::Down(MouseButton::Right), 41, 1), "right-click opens pinned");
    b.mouse(MouseEventKind::Up(MouseButton::Right), 41, 1);
    b.mouse(MouseEventKind::Moved, 3, 1);
    b.wait(900.0);
    assert_eq!(b.keys(), ["x.b", "x.a"]);
    let before = b.area("x.b");
    b.marks.clear(); // the host re-renders without the elements
    b.frame();
    assert_eq!(b.keys(), ["x.b"], "the preview closed, the pinned root stays");
    assert!(b.dt.engine.windows()[0].frozen);
    assert_eq!(b.area("x.b"), before, "frozen in place");
}

#[test]
fn ascii_glyphs_and_outside_clicks() {
    let mut b = B::new(r#"{"x.a": {"title": "A", "short": "First."}}"#, 60, 16);
    b.dt.look.symbols = Symbols::ascii();
    b.dt.engine.options.outside_click_closes = OutsideClick::Always;
    b.marks = vec![(Rect::new(2, 1, 5, 1), "x.a", focused())];
    b.frame();
    b.key(KeyCode::F(1));
    let r = b.area("x.a");
    assert_eq!(b.symbol(r.x, r.y), "+");
    assert_eq!(b.symbol(r.x + 1, r.y), "-");
    assert!(b.text(r).contains(" x "), "close button");
    assert!(!b.mouse(MouseEventKind::Down(MouseButton::Left), 55, 14), "the click stays the application's");
    assert!(b.keys().is_empty(), "outside_click_closes = always");
}

#[test]
fn gamepad_actions_open_step_activate_and_close() {
    let json = r#"{"g.a": {"title": "A", "body": "See [[g.b]] and [[g.c]]."}, "g.b": {"title": "B", "short": "Bee."}, "g.c": {"title": "C", "short": "Sea."}}"#;
    let mut b = B::new(json, 80, 24);
    b.marks = vec![(Rect::new(2, 1, 5, 1), "g.a", focused())];
    b.frame();
    b.dt.action(Action::OpenFocused); // Y
    b.frame();
    let a = b.dt.engine.windows()[0].id;
    assert_eq!(b.dt.focus(), Some(&Focus::Term(AnchorId::Term(a, "g.b".into(), 0))));
    b.dt.action(Action::Step(1)); // d-pad
    b.frame();
    b.dt.action(Action::Activate); // A
    b.frame();
    assert_eq!(b.keys(), ["g.a", "g.c"]);
    b.dt.action(Action::CloseNewest); // B
    b.frame();
    assert_eq!(b.keys(), ["g.a"]);
    b.dt.action(Action::CloseAll); // B held
    b.frame();
    assert!(b.keys().is_empty());
    assert_eq!(b.dt.focus(), None);
}

#[test]
fn rest_progress_and_the_next_timer() {
    let mut b = B::new(r#"{"x.a": {"title": "A", "short": "First."}}"#, 60, 16);
    b.marks = vec![(Rect::new(2, 1, 5, 1), "x.a", MarkOptions::default())];
    b.frame();
    b.dt.tick();
    b.frame();
    assert_eq!(b.dt.timeout(), None, "nothing pending");
    b.mouse(MouseEventKind::Moved, 3, 1);
    b.wait(400.0);
    let p = b.states[0].arming.expect("arming");
    assert!((p - 0.5).abs() < 0.05, "{p}");
    let t = b.dt.timeout().expect("a timer").as_secs_f64() * 1000.0;
    assert!(t <= 50.0, "animation frames while the progress runs: {t}");
    b.wait(420.0);
    assert_eq!(b.keys(), ["x.a"]);
    assert!(b.states[0].open, "MarkState.open (web: data-dt-open)");
}
