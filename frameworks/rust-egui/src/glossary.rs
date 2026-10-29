//! Glossary data (SPEC §2): flattening one locale file, layers, the locale chain and the `$ui` labels.
//!
//! Pure Rust, no UI. Mirrors `flattenGlossary`, `add`, `entry` and `t` of the web reference
//! (`frameworks/web/deeptip.js`).

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;

use serde_json::{Map, Value};

use crate::markup::collect_refs;

/// Fields that turn a JSON object into an entry (SPEC §2.1).
const ENTRY_FIELDS: [&str; 3] = ["title", "short", "body"];

/// Names of the window's own labels (SPEC §2.6).
pub const LABEL_NAMES: [&str; 10] =
    ["close", "pin", "unpin", "missing", "fallback", "hint", "seeAlso", "search", "mentionedIn", "empty"];

/// Built-in English and German defaults of the `$ui` labels.
pub fn builtin_label(lang: &str, name: &str) -> Option<&'static str> {
    let v = match (lang, name) {
        ("en", "close") => "Close",
        ("en", "pin") => "Pin",
        ("en", "unpin") => "Unpin",
        ("en", "missing") => "No explanation for this term yet.",
        ("en", "fallback") => "Not translated yet",
        ("en", "hint") => "Click to pin · Esc closes",
        ("en", "seeAlso") => "See also:",
        ("en", "search") => "Search terms …",
        ("en", "mentionedIn") => "Mentioned in",
        ("en", "empty") => "No matches.",
        ("de", "close") => "Schließen",
        ("de", "pin") => "Festhalten",
        ("de", "unpin") => "Loslassen",
        ("de", "missing") => "Zu diesem Begriff gibt es noch keine Erklärung.",
        ("de", "fallback") => "Noch nicht übersetzt",
        ("de", "hint") => "Klick hält fest · Esc schließt",
        ("de", "seeAlso") => "Siehe auch:",
        ("de", "search") => "Begriffe suchen …",
        ("de", "mentionedIn") => "Erwähnt in",
        ("de", "empty") => "Keine Treffer.",
        _ => return None,
    };
    Some(v)
}

/// Is `key` a valid glossary key: `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$`?
pub fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
}

/// One glossary entry (SPEC §2.2).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Entry {
    /// Name of the term: window title and default text of links to it.
    pub title: Option<String>,
    /// One line (≤ 140 chars) for simple tooltips, lists and the encyclopedia.
    pub short: Option<String>,
    /// The explanation with links.
    pub body: Option<String>,
    /// Other names (search, auto-linking).
    pub aliases: Vec<String>,
    /// Keys shown as "See also" links under the body.
    pub see: Vec<String>,
    /// For authors and translators; never shown.
    pub note: Option<String>,
}

impl Entry {
    /// Read an entry from its JSON object. Fields of the wrong type are ignored.
    pub fn from_json(obj: &Map<String, Value>) -> Self {
        let text = |f: &str| obj.get(f).and_then(Value::as_str).map(str::to_owned);
        let list = |f: &str| {
            obj.get(f)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_owned).collect())
                .unwrap_or_default()
        };
        Self {
            title: text("title"),
            short: text("short"),
            body: text("body"),
            aliases: list("aliases"),
            see: list("see"),
            note: text("note"),
        }
    }

    /// What a window shows: `body`, else `short` (SPEC §2.2).
    pub fn text(&self) -> Option<&str> {
        self.body.as_deref().or(self.short.as_deref())
    }
}

/// A problem found while flattening a file (invalid key, value that is not an entry object …).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Problem {
    /// The dotted key, or `(file)`.
    pub key: String,
    /// What is wrong.
    pub msg: String,
}

impl Problem {
    fn new(key: &str, msg: &str) -> Self {
        Self { key: key.to_owned(), msg: msg.to_owned() }
    }
}

impl fmt::Display for Problem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.key, self.msg)
    }
}

/// One locale file, flattened.
#[derive(Clone, Debug, Default)]
pub struct Flattened {
    /// Entries in file order. A key that appears twice keeps its first position and its last value.
    pub entries: Vec<(String, Entry)>,
    /// Top-level keys starting with `$` (`$schema`, `$locale`, `$ui`), in file order.
    pub meta: Map<String, Value>,
    /// Invalid keys and values that are not entry objects.
    pub problems: Vec<Problem>,
}

/// Flatten one locale file (SPEC §2.1). Accepts flat dotted keys (`{"hw.vram": {…}}`) and nested
/// i18next-style objects (`{"hw": {"vram": {…}}}`); an object is an entry once it has a string
/// `title`, `short` or `body`. Top-level keys starting with `$` are metadata.
pub fn flatten_glossary(value: &Value) -> Flattened {
    let mut out = Flattened::default();
    let mut index = HashMap::new();
    match value {
        Value::Object(root) => walk(root, "", &mut out, &mut index),
        _ => out.problems.push(Problem::new("(file)", "a glossary file must be a JSON object")),
    }
    out
}

fn walk(node: &Map<String, Value>, prefix: &str, out: &mut Flattened, index: &mut HashMap<String, usize>) {
    for (k, v) in node {
        if k.starts_with('$') {
            if prefix.is_empty() {
                out.meta.insert(k.clone(), v.clone());
            }
            continue;
        }
        let key = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
        match v {
            Value::Object(obj) => {
                if ENTRY_FIELDS.iter().any(|f| obj.get(*f).is_some_and(Value::is_string)) {
                    if !is_valid_key(&key) {
                        out.problems.push(Problem::new(&key, "invalid key (letters, digits, _ - separated by dots)"));
                    }
                    let entry = Entry::from_json(obj);
                    match index.get(&key) {
                        Some(&i) => out.entries[i].1 = entry,
                        None => {
                            index.insert(key.clone(), out.entries.len());
                            out.entries.push((key, entry));
                        }
                    }
                } else {
                    walk(obj, &key, out, index);
                }
            }
            _ => out.problems.push(Problem::new(&key, "not an entry object")),
        }
    }
}

/// Error while loading a glossary file.
#[derive(Debug)]
pub enum LoadError {
    /// The file could not be read.
    Io(std::io::Error),
    /// The file is not valid JSON.
    Json(serde_json::Error),
    /// Neither `$locale` nor the file name tells the locale.
    NoLocale,
}

impl fmt::Display for LoadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "{e}"),
            Self::Json(e) => write!(f, "invalid JSON: {e}"),
            Self::NoLocale => write!(f, "no $locale and no locale in the file name"),
        }
    }
}

impl std::error::Error for LoadError {}

impl From<std::io::Error> for LoadError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for LoadError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

/// An entry found along the locale chain.
#[derive(Clone, Copy, Debug)]
pub struct Found<'a> {
    /// The entry (whole, from one locale: no field mixing).
    pub entry: &'a Entry,
    /// The locale that provided it. Differs from [`Glossary::locale`] for a fallback.
    pub locale: &'a str,
}

#[derive(Clone, Debug, Default)]
struct LocaleData {
    order: Vec<String>,
    map: HashMap<String, Entry>,
}

/// The glossary of a running app: entries per locale in layers, the locale chain and the `$ui` labels.
///
/// ```
/// let mut g = deeptip::Glossary::new("en", &["en"]);
/// g.add_json("en", r#"{"shop.cart": {"title": "Cart", "short": "Items to order."}}"#).unwrap();
/// assert_eq!(g.entry("shop.cart").unwrap().entry.title.as_deref(), Some("Cart"));
/// ```
#[derive(Clone, Debug)]
pub struct Glossary {
    locale: String,
    fallback: Vec<String>,
    data: HashMap<String, LocaleData>,
    labels: HashMap<String, HashMap<String, String>>,
    sources: Vec<String>,
    loaded: HashSet<String>,
}

impl Default for Glossary {
    fn default() -> Self {
        Self::new("en", &["en"])
    }
}

impl Glossary {
    /// An empty glossary for `locale` with the given fallback locales.
    pub fn new(locale: &str, fallback: &[&str]) -> Self {
        Self {
            locale: locale.to_owned(),
            fallback: fallback.iter().map(|s| (*s).to_owned()).collect(),
            data: HashMap::new(),
            labels: HashMap::new(),
            sources: Vec::new(),
            loaded: HashSet::new(),
        }
    }

    /// The current locale.
    pub fn locale(&self) -> &str {
        &self.locale
    }

    /// The fallback locales.
    pub fn fallback(&self) -> &[String] {
        &self.fallback
    }

    /// Resolution order: `[locale, ...fallback]` without duplicates (SPEC §2.3).
    pub fn chain(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::with_capacity(1 + self.fallback.len());
        for loc in std::iter::once(&self.locale).chain(self.fallback.iter()) {
            if !out.contains(loc) {
                out.push(loc.clone());
            }
        }
        out
    }

    /// Add (or override) entries of one locale. Later calls win per key: core first, project after.
    /// Returns the problems of the file (they are also logged).
    pub fn add(&mut self, locale: &str, value: &Value) -> Vec<Problem> {
        let flat = flatten_glossary(value);
        for p in &flat.problems {
            log::warn!("DeepTip: {locale} {p}");
        }
        let data = self.data.entry(locale.to_owned()).or_default();
        for (key, entry) in flat.entries {
            if data.map.insert(key.clone(), entry).is_none() {
                data.order.push(key);
            }
        }
        if let Some(Value::Object(ui)) = flat.meta.get("$ui") {
            let labels = self.labels.entry(locale.to_owned()).or_default();
            for (name, v) in ui {
                if let Some(s) = v.as_str() {
                    labels.insert(name.clone(), s.to_owned());
                }
            }
        }
        flat.problems
    }

    /// Parse JSON text and [`add`](Self::add) it to `locale`.
    pub fn add_json(&mut self, locale: &str, text: &str) -> Result<Vec<Problem>, serde_json::Error> {
        let value: Value = serde_json::from_str(text)?;
        Ok(self.add(locale, &value))
    }

    /// Load one file. The locale comes from `$locale`, else from the file name (`de.json`, `myapp.de.json`).
    /// Returns the locale it was added to and the problems of the file.
    pub fn add_file(&mut self, path: impl AsRef<Path>) -> Result<(String, Vec<Problem>), LoadError> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)?;
        let value: Value = serde_json::from_str(&text)?;
        let locale = value
            .get("$locale")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| locale_from_file_name(path))
            .ok_or(LoadError::NoLocale)?;
        let problems = self.add(&locale, &value);
        Ok((locale, problems))
    }

    /// File templates loaded for every locale of the chain, `{locale}` is replaced, e.g.
    /// `["glossary/core/{locale}.json", "glossary/example/{locale}.json"]`. Source order is layer order.
    /// Loads what is missing at once; returns the files that could not be loaded.
    pub fn set_sources<S: AsRef<str>>(&mut self, sources: &[S]) -> Vec<String> {
        self.sources = sources.iter().map(|s| s.as_ref().to_owned()).collect();
        self.load()
    }

    /// Load the files of [`set_sources`](Self::set_sources) that are not loaded yet for the chain.
    pub fn load(&mut self) -> Vec<String> {
        let mut failed = Vec::new();
        for loc in self.chain() {
            for tpl in self.sources.clone() {
                let path = tpl.replace("{locale}", &loc);
                if !self.loaded.insert(path.clone()) {
                    continue;
                }
                let result = std::fs::read_to_string(&path)
                    .map_err(LoadError::from)
                    .and_then(|text| serde_json::from_str::<Value>(&text).map_err(LoadError::from));
                match result {
                    Ok(value) => {
                        self.add(&loc, &value);
                    }
                    Err(e) => {
                        log::warn!("DeepTip: cannot load {path}: {e}");
                        failed.push(format!("{path}: {e}"));
                    }
                }
            }
        }
        failed
    }

    /// Switch the language; loads missing source files. Open windows show the new language on the next frame.
    pub fn set_locale(&mut self, locale: &str) -> Vec<String> {
        self.locale = locale.to_owned();
        self.load()
    }

    /// Replace the fallback locales; loads missing source files.
    pub fn set_fallback(&mut self, fallback: &[&str]) -> Vec<String> {
        self.fallback = fallback.iter().map(|s| (*s).to_owned()).collect();
        self.load()
    }

    /// The entry from the first locale of the chain that has the key (SPEC §2.3).
    pub fn entry(&self, key: &str) -> Option<Found<'_>> {
        for loc in self.chain() {
            if let Some((loc_key, data)) = self.data.get_key_value(&loc) {
                if let Some(entry) = data.map.get(key) {
                    return Some(Found { entry, locale: loc_key.as_str() });
                }
            }
        }
        None
    }

    /// Does any locale of the chain have the key?
    pub fn has(&self, key: &str) -> bool {
        self.entry(key).is_some()
    }

    /// A window label (`close`, `pin`, `hint` …): glossary `$ui` first, then the built-ins (SPEC §2.6).
    pub fn label(&self, name: &str) -> String {
        for loc in self.chain() {
            if let Some(v) = self.labels.get(&loc).and_then(|m| m.get(name)) {
                return v.clone();
            }
            let lang = loc.split('-').next().unwrap_or_default();
            if let Some(v) = builtin_label(lang, name) {
                return v.to_owned();
            }
        }
        builtin_label("en", name).map_or_else(|| name.to_owned(), str::to_owned)
    }

    /// Every key of every locale in the chain, in insertion order (for the encyclopedia).
    pub fn keys(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for loc in self.chain() {
            if let Some(data) = self.data.get(&loc) {
                for k in &data.order {
                    if seen.insert(k.as_str()) {
                        out.push(k.clone());
                    }
                }
            }
        }
        out
    }

    /// "Mentioned in": for every key the keys whose `short`, `body` or `see` link to it (SPEC §2.7).
    pub fn backlinks(&self) -> HashMap<String, Vec<String>> {
        let mut back: HashMap<String, Vec<String>> = HashMap::new();
        for k in self.keys() {
            let Some(found) = self.entry(&k) else { continue };
            let e = found.entry;
            let text = format!("{}\n\n{}", e.short.as_deref().unwrap_or(""), e.body.as_deref().unwrap_or(""));
            let refs = collect_refs(&crate::markup::parse_text(&text));
            for target in refs.links.iter().chain(e.see.iter()) {
                if *target == k {
                    continue;
                }
                let list = back.entry(target.clone()).or_default();
                if !list.contains(&k) {
                    list.push(k.clone());
                }
            }
        }
        back
    }
}

/// `de.json` → `de`, `myapp.de.json` → `de`.
fn locale_from_file_name(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let loc = stem.rsplit('.').next()?;
    (!loc.is_empty()).then(|| loc.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys() {
        assert!(is_valid_key("hw.vram"));
        assert!(is_valid_key("a-b_c.D9"));
        assert!(!is_valid_key("bad key!"));
        assert!(!is_valid_key("a..b"));
        assert!(!is_valid_key(".a"));
        assert!(!is_valid_key(""));
    }

    #[test]
    fn chain_and_fallback() {
        let mut g = Glossary::new("en", &["de", "en"]);
        g.add_json("de", r#"{"$ui": {"hint": "Hinweis"}, "a.b": {"title": "B (de)"}, "a.c": {"title": "C"}}"#).unwrap();
        g.add_json("en", r#"{"a.b": {"title": "B"}}"#).unwrap();
        assert_eq!(g.chain(), vec!["en", "de"]);
        let b = g.entry("a.b").unwrap();
        assert_eq!((b.entry.title.as_deref(), b.locale), (Some("B"), "en"));
        let c = g.entry("a.c").unwrap();
        assert_eq!((c.entry.title.as_deref(), c.locale), (Some("C"), "de"));
        assert!(g.entry("a.x").is_none());
        // English built-in comes before the German $ui override, because "en" is first in the chain
        assert_eq!(g.label("hint"), "Click to pin · Esc closes");
        g.set_locale("de");
        assert_eq!(g.label("hint"), "Hinweis");
        assert_eq!(g.label("close"), "Schließen");
        assert_eq!(g.label("nonexistent"), "nonexistent");
    }

    #[test]
    fn layers_override_per_key() {
        let mut g = Glossary::new("en", &[]);
        g.add_json("en", r#"{"k.a": {"title": "core"}, "k.b": {"title": "core b"}}"#).unwrap();
        g.add_json("en", r#"{"k.a": {"title": "project"}}"#).unwrap();
        assert_eq!(g.entry("k.a").unwrap().entry.title.as_deref(), Some("project"));
        assert_eq!(g.keys(), vec!["k.a", "k.b"]);
    }

    #[test]
    fn file_name_locale() {
        assert_eq!(locale_from_file_name(Path::new("x/de.json")).as_deref(), Some("de"));
        assert_eq!(locale_from_file_name(Path::new("myapp.en.json")).as_deref(), Some("en"));
    }
}
