//! The shared parity cases of every DeepTip runtime: `test/cases/*.json` at the repository root (the download zip
//! mirrors that layout, so `../../test/cases` is found from `frameworks/rust-egui`).

use std::path::PathBuf;

use deeptip::markup::to_json;
use deeptip::{compute_placement, flatten_glossary, parse_sides, parse_text, Rect, Size};
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
    let all = cases("markup.json");
    assert!(!all.is_empty());
    for c in all {
        let name = c["name"].as_str().unwrap();
        let got = to_json(&parse_text(c["src"].as_str().unwrap()));
        assert_eq!(got, c["blocks"], "markup case: {name}");
    }
}

#[test]
fn placement() {
    let all = cases("placement.json");
    assert!(!all.is_empty());
    for c in all {
        let name = c["name"].as_str().unwrap();
        let size = Size::new(num(&c["size"], "w"), num(&c["size"], "h"));
        let a = &c["anchor"];
        let anchor = Rect::new(num(a, "left"), num(a, "top"), num(a, "right"), num(a, "bottom"));
        let names: Vec<&str> = c["sides"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
        let vp = Size::new(num(&c["viewport"], "w"), num(&c["viewport"], "h"));
        let p = compute_placement(size, anchor, &parse_sides(&names), vp, 8.0);
        let e = &c["expect"];
        assert_eq!(p.side.as_str(), e["side"].as_str().unwrap(), "side: {name}");
        assert_eq!(p.fits, e["fits"].as_bool().unwrap(), "fits: {name}");
        for (got, key) in [(p.x, "x"), (p.y, "y"), (p.max_w, "maxW"), (p.max_h, "maxH")] {
            let want = num(e, key);
            assert!((got - want).abs() < 1e-9, "{key}: {name}: got {got}, want {want}");
        }
    }
}

#[test]
fn glossary() {
    let all = cases("glossary.json");
    assert!(!all.is_empty());
    for c in all {
        let name = c["name"].as_str().unwrap();
        let flat = flatten_glossary(&c["input"]);
        let keys: Vec<&str> = flat.entries.iter().map(|(k, _)| k.as_str()).collect();
        let want_keys: Vec<&str> =
            c["expect"]["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
        assert_eq!(keys, want_keys, "keys: {name}");
        let meta: Vec<&str> = flat.meta.keys().map(String::as_str).collect();
        let want_meta: Vec<&str> =
            c["expect"]["meta"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
        assert_eq!(meta, want_meta, "meta: {name}");
        assert_eq!(flat.problems.len() as u64, c["expect"]["problems"].as_u64().unwrap(), "problems: {name}");
    }
}

/// The shared glossaries load, and every link in them resolves along the chain the examples use.
#[test]
fn shared_glossaries_resolve() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../glossary");
    for (locale, fallback) in [("en", ["de", "en"]), ("de", ["de", "en"])] {
        let mut g = deeptip::Glossary::new(locale, &fallback);
        let sources = [
            root.join("core/{locale}.json").to_string_lossy().into_owned(),
            root.join("example/{locale}.json").to_string_lossy().into_owned(),
        ];
        let failed = g.set_sources(&sources);
        assert!(failed.is_empty(), "{failed:?}");
        for key in ["demo.realm", "demo.stability", "demo.taxes", "demo.gold", "demo.nobles", "deeptip.about"] {
            let found = g.entry(key).unwrap_or_else(|| panic!("{locale}: {key} missing"));
            let refs = deeptip::collect_refs(&parse_text(found.entry.text().unwrap()));
            for link in refs.links {
                assert!(g.has(&link), "{locale}: {key} links to missing {link}");
            }
        }
        // demo.gold and demo.prestige exist only in German: English shows the fallback badge
        let gold = g.entry("demo.gold").unwrap();
        assert_eq!(gold.locale, "de", "{locale}");
    }
}
