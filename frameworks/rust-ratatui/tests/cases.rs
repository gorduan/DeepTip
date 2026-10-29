//! The shared parity cases (`test/cases/*.json`, algorithms §11) against the core this adapter uses, and the
//! placement in cells: a window that fits never covers its anchor and stays on the screen.

use std::path::PathBuf;

use deeptip_ratatui::core::markup::to_json;
use deeptip_ratatui::core::{compute_placement, flatten_glossary, parse_sides, parse_text, Rect as PxRect, Size};
use deeptip_ratatui::{place_in_cells, Side, CELL};
use ratatui::layout::Rect;
use serde_json::Value;

fn cases(name: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../test/cases").join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let file: Value = serde_json::from_str(&text).expect("valid JSON");
    file["cases"].as_array().expect("a cases array").clone()
}

fn num(v: &Value, k: &str) -> f64 {
    v[k].as_f64().unwrap_or_else(|| panic!("number {k} in {v}"))
}

#[test]
fn markup() {
    for c in cases("markup.json") {
        assert_eq!(to_json(&parse_text(c["src"].as_str().unwrap())), c["blocks"], "{}", c["name"]);
    }
}

#[test]
fn placement() {
    for c in cases("placement.json") {
        let name = c["name"].as_str().unwrap();
        let a = &c["anchor"];
        let sides: Vec<&str> = c["sides"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
        let p = compute_placement(
            Size::new(num(&c["size"], "w"), num(&c["size"], "h")),
            PxRect::new(num(a, "left"), num(a, "top"), num(a, "right"), num(a, "bottom")),
            &parse_sides(&sides),
            Size::new(num(&c["viewport"], "w"), num(&c["viewport"], "h")),
            8.0,
        );
        let e = &c["expect"];
        assert_eq!(p.side.as_str(), e["side"].as_str().unwrap(), "{name}");
        assert_eq!(p.fits, e["fits"].as_bool().unwrap(), "{name}");
        for (got, key) in [(p.x, "x"), (p.y, "y"), (p.max_w, "maxW"), (p.max_h, "maxH")] {
            assert_eq!(got, num(e, key), "{key}: {name}");
        }
    }
}

#[test]
fn glossary() {
    for c in cases("glossary.json") {
        let flat = flatten_glossary(&c["input"]);
        let keys: Vec<&str> = flat.entries.iter().map(|(k, _)| k.as_str()).collect();
        let want: Vec<&str> = c["expect"]["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
        assert_eq!(keys, want, "{}", c["name"]);
        assert_eq!(flat.meta.len(), c["expect"]["meta"].as_array().unwrap().len());
        assert_eq!(flat.problems.len() as u64, c["expect"]["problems"].as_u64().unwrap());
    }
}

/// A small deterministic random generator (no dependency).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u16) -> u16 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % u64::from(n.max(1))) as u16
    }
}

#[test]
fn cells_a_fitting_window_never_covers_its_anchor_and_stays_on_screen() {
    let orders: [&[Side]; 4] = [
        &[Side::Bottom, Side::Top, Side::Right, Side::Left],
        &[Side::Left, Side::Right, Side::Top, Side::Bottom],
        &[Side::Top, Side::Right, Side::Left],
        &[Side::Right],
    ];
    let mut rng = Lcg(29);
    let mut fitted = 0;
    for _ in 0..50_000 {
        let vp = Rect::new(rng.next(5), rng.next(5), 20 + rng.next(200), 8 + rng.next(60));
        let anchor = Rect::new(
            vp.x + rng.next(vp.width - 1),
            vp.y + rng.next(vp.height - 1),
            1 + rng.next(vp.width / 2),
            1 + rng.next(vp.height / 3),
        )
        .intersection(vp);
        let (w, h) = (8 + rng.next(56), 3 + rng.next(30));
        let sides = orders[usize::from(rng.next(4))];
        let p = place_in_cells(w, h, anchor, sides, vp, CELL, 8.0);
        let (w2, h2) = (if p.max_w > 0 { w.min(p.max_w) } else { w }, if p.max_h > 0 { h.min(p.max_h) } else { h });
        let win = Rect::new(p.x, p.y, w2, h2);
        if w2 <= vp.width && h2 <= vp.height {
            assert!(
                vp.contains(win.as_position()) && win.right() <= vp.right() && win.bottom() <= vp.bottom(),
                "{win:?} in {vp:?}"
            );
        }
        if p.fits {
            fitted += 1;
            assert!(!win.intersects(anchor), "fits but covers: {win:?} / {anchor:?} ({:?})", p.side);
            let air = match p.side {
                Side::Right => win.x - anchor.right(),
                Side::Left => anchor.x - win.right(),
                Side::Bottom => win.y - anchor.bottom(),
                Side::Top => anchor.y - win.bottom(),
            };
            assert!(air >= 1, "one cell between window and anchor: {win:?} / {anchor:?}");
        }
    }
    assert!(fitted > 10_000, "{fitted}");
}
