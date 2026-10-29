//! DeepTip markup (SPEC §2.4) → a tiny AST. Never HTML, so glossary text cannot inject markup.
//!
//! A line-by-line port of `parseText` in `frameworks/web/deeptip.js`; the shared cases in
//! `test/cases/markup.json` pin the behaviour down. Whitespace means JavaScript's `\s`
//! (see [`is_js_space`]), so every runtime splits and trims the same way.

use serde_json::{json, Value};

use crate::glossary::is_valid_key;

/// A block of text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    /// A paragraph.
    P(Vec<Inline>),
    /// A bullet list; every item is a run of inline nodes.
    Ul(Vec<Vec<Inline>>),
}

/// An inline node.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inline {
    /// Plain text.
    Text(String),
    /// A line break (single newline).
    Br,
    /// `**bold**`
    B(Vec<Inline>),
    /// `*italic*`
    I(Vec<Inline>),
    /// `` `code` ``
    Code(String),
    /// `[[key]]` (`text` = `None`: the entry's title) or `[[key|text]]`.
    Link {
        /// Target key.
        key: String,
        /// Own link text, `None` = the target's title.
        text: Option<String>,
    },
    /// `{name}`: a live value filled in at render time (SPEC §2.5).
    Var(String),
}

/// Characters a backslash turns into literals.
const ESCAPABLE: [char; 8] = ['\\', '*', '`', '[', ']', '{', '}', '|'];

/// JavaScript's `\s` (and the set `String.prototype.trim` removes): WhiteSpace and LineTerminator.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// `String.prototype.trim` of JavaScript.
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// Parse DeepTip markup into blocks (SPEC §2.4).
///
/// ```
/// use deeptip::{parse_text, Block, Inline};
/// let blocks = parse_text("See [[hw.vram|VRAM]].");
/// assert_eq!(blocks, vec![Block::P(vec![
///     Inline::Text("See ".into()),
///     Inline::Link { key: "hw.vram".into(), text: Some("VRAM".into()) },
///     Inline::Text(".".into()),
/// ])]);
/// ```
pub fn parse_text(src: &str) -> Vec<Block> {
    let src = normalize_newlines(src);
    let mut blocks: Vec<Block> = Vec::new();
    for chunk in split_paragraphs(&src) {
        let mut para: Vec<&str> = Vec::new();
        let mut list: Option<usize> = None; // index of the open list in `blocks`
        for line in chunk.split('\n') {
            if let Some(item) = bullet_item(line) {
                end_para(&mut para, &mut blocks);
                let i = *list.get_or_insert_with(|| {
                    blocks.push(Block::Ul(Vec::new()));
                    blocks.len() - 1
                });
                if let Block::Ul(items) = &mut blocks[i] {
                    items.push(parse_inline(&chars(item), 0));
                }
            } else {
                let t = js_trim(line);
                if !t.is_empty() {
                    list = None;
                    para.push(t);
                }
            }
        }
        end_para(&mut para, &mut blocks);
    }
    blocks
}

fn end_para(para: &mut Vec<&str>, blocks: &mut Vec<Block>) {
    if !para.is_empty() {
        blocks.push(Block::P(parse_inline(&chars(&para.join("\n")), 0)));
        para.clear();
    }
}

fn chars(s: &str) -> Vec<char> {
    s.chars().collect()
}

/// `\r\n` and lone `\r` become `\n`.
fn normalize_newlines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\r' {
            if it.peek() == Some(&'\n') {
                it.next();
            }
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

/// Split on blank lines: `\n[ \t]*\n` (JavaScript `split` semantics, left to right, no overlap).
fn split_paragraphs(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\n' {
            let mut j = i + 1;
            while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
                j += 1;
            }
            if j < b.len() && b[j] == b'\n' {
                out.push(&s[start..i]);
                start = j + 1;
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    out.push(&s[start..]);
    out
}

/// A bullet line `^\s*[-•]\s+(.*)$`: the item text, or `None`.
fn bullet_item(line: &str) -> Option<&str> {
    let s = line.trim_start_matches(is_js_space);
    let mark = s.chars().next()?;
    if mark != '-' && mark != '•' {
        return None;
    }
    let rest = &s[mark.len_utf8()..];
    let item = rest.trim_start_matches(is_js_space);
    if item.len() == rest.len() {
        return None; // `\s+` needs at least one whitespace after the mark
    }
    if item.contains(['\u{2028}', '\u{2029}']) {
        return None; // `.` does not match line terminators
    }
    Some(item)
}

fn flush(buf: &mut String, out: &mut Vec<Inline>) {
    if !buf.is_empty() {
        out.push(Inline::Text(std::mem::take(buf)));
    }
}

fn find_char(s: &[char], c: char, from: usize) -> Option<usize> {
    (from..s.len()).find(|&i| s[i] == c)
}

fn starts_with(s: &[char], at: usize, pat: &str) -> bool {
    (at..).zip(pat.chars()).all(|(i, p)| s.get(i) == Some(&p))
}

fn find_seq(s: &[char], pat: &str, from: usize) -> Option<usize> {
    (from..s.len()).find(|&i| starts_with(s, i, pat))
}

fn collect(s: &[char]) -> String {
    s.iter().collect()
}

fn parse_inline(s: &[char], depth: u32) -> Vec<Inline> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let n = s.len();
    let mut i = 0;
    while i < n {
        let c = s[i];
        if c == '\\' && i + 1 < n && ESCAPABLE.contains(&s[i + 1]) {
            buf.push(s[i + 1]);
            i += 2;
            continue;
        }
        if c == '\n' {
            flush(&mut buf, &mut out);
            out.push(Inline::Br);
            i += 1;
            continue;
        }
        if c == '[' && i + 1 < n && s[i + 1] == '[' {
            if let Some(end) = find_seq(s, "]]", i + 2) {
                let inner = &s[i + 2..end];
                let bar = inner.iter().position(|&ch| ch == '|');
                let key = collect(bar.map_or(inner, |b| &inner[..b]));
                let key = js_trim(&key);
                if is_valid_key(key) {
                    flush(&mut buf, &mut out);
                    let text = bar.map(|b| js_trim(&collect(&inner[b + 1..])).to_owned()).filter(|t| !t.is_empty());
                    out.push(Inline::Link { key: key.to_owned(), text });
                    i = end + 2;
                    continue;
                }
            }
        }
        if c == '`' {
            if let Some(end) = find_char(s, '`', i + 1) {
                if end > i + 1 {
                    flush(&mut buf, &mut out);
                    out.push(Inline::Code(collect(&s[i + 1..end])));
                    i = end + 1;
                    continue;
                }
            }
        }
        if c == '*' && depth < 3 {
            let mark = if i + 1 < n && s[i + 1] == '*' { 2 } else { 1 };
            let from = i + mark;
            if from < n && !is_js_space(s[from]) {
                if let Some(end) = find_close(s, from, mark) {
                    flush(&mut buf, &mut out);
                    let inner = parse_inline(&s[from..end], depth + 1);
                    out.push(if mark == 2 { Inline::B(inner) } else { Inline::I(inner) });
                    i = end + mark;
                    continue;
                }
            }
        }
        if c == '{' {
            if let Some((name, len)) = match_var(s, i) {
                flush(&mut buf, &mut out);
                out.push(Inline::Var(name));
                i += len;
                continue;
            }
        }
        buf.push(c);
        i += 1;
    }
    flush(&mut buf, &mut out);
    out
}

/// Where the closing `*` / `**` of an emphasis starting at `from` is. Skips escapes, code, links and
/// (for `*`) nested `**…**`. The closing mark must follow a non-space and cannot be empty.
fn find_close(s: &[char], from: usize, mark: usize) -> Option<usize> {
    let n = s.len();
    let mut j = from;
    while j < n {
        if s[j] == '\\' {
            j += 2;
            continue;
        }
        if s[j] == '`' {
            if let Some(e) = find_char(s, '`', j + 1) {
                j = e + 1;
                continue;
            }
        }
        if starts_with(s, j, "[[") {
            if let Some(e) = find_seq(s, "]]", j + 2) {
                j = e + 2;
                continue;
            }
        }
        if mark == 1 && starts_with(s, j, "**") {
            if let Some(e) = find_close(s, j + 2, 2) {
                j = e + 2;
                continue;
            }
        }
        let at_mark = if mark == 2 { starts_with(s, j, "**") } else { s[j] == '*' };
        if at_mark && j > from && !is_js_space(s[j - 1]) {
            return Some(j);
        }
        j += 1;
    }
    None
}

/// `{name}` at `i` with `name` = `[A-Za-z_][A-Za-z0-9_]*`, looked for within 64 characters.
fn match_var(s: &[char], i: usize) -> Option<(String, usize)> {
    let limit = (i + 64).min(s.len());
    let mut j = i + 1;
    if j >= limit || !(s[j].is_ascii_alphabetic() || s[j] == '_') {
        return None;
    }
    j += 1;
    while j < limit && (s[j].is_ascii_alphanumeric() || s[j] == '_') {
        j += 1;
    }
    if j < limit && s[j] == '}' {
        Some((collect(&s[i + 1..j]), j + 1 - i))
    } else {
        None
    }
}

/// Link targets and live-value names used in a text.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Refs {
    /// Keys of every `[[link]]`, in order.
    pub links: Vec<String>,
    /// Names of every `{value}`, in order.
    pub vars: Vec<String>,
}

/// All link targets and live-value names in parsed blocks.
pub fn collect_refs(blocks: &[Block]) -> Refs {
    fn walk(nodes: &[Inline], r: &mut Refs) {
        for n in nodes {
            match n {
                Inline::Link { key, .. } => r.links.push(key.clone()),
                Inline::Var(name) => r.vars.push(name.clone()),
                Inline::B(c) | Inline::I(c) => walk(c, r),
                _ => {}
            }
        }
    }
    let mut r = Refs::default();
    for b in blocks {
        match b {
            Block::P(c) => walk(c, &mut r),
            Block::Ul(items) => items.iter().for_each(|it| walk(it, &mut r)),
        }
    }
    r
}

/// Emphasis that applies to a run.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Emphasis {
    /// Inside `**…**`.
    pub bold: bool,
    /// Inside `*…*`.
    pub italic: bool,
}

/// A flat run of inline content with its emphasis: what a renderer draws one after the other.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Run<'a> {
    /// Plain text.
    Text {
        /// The text.
        text: &'a str,
        /// Emphasis.
        em: Emphasis,
    },
    /// Inline code.
    Code {
        /// The code.
        text: &'a str,
        /// Emphasis.
        em: Emphasis,
    },
    /// A live value.
    Var {
        /// Its name.
        name: &'a str,
        /// Emphasis.
        em: Emphasis,
    },
    /// A term.
    Link {
        /// Target key.
        key: &'a str,
        /// Own text, `None` = the target's title.
        text: Option<&'a str>,
        /// Emphasis.
        em: Emphasis,
    },
    /// A line break.
    Break,
}

/// Flatten inline nodes into runs (emphasis resolved), in reading order.
pub fn runs(nodes: &[Inline]) -> Vec<Run<'_>> {
    fn walk<'a>(nodes: &'a [Inline], em: Emphasis, out: &mut Vec<Run<'a>>) {
        for n in nodes {
            match n {
                Inline::Text(v) => out.push(Run::Text { text: v, em }),
                Inline::Br => out.push(Run::Break),
                Inline::Code(v) => out.push(Run::Code { text: v, em }),
                Inline::Var(name) => out.push(Run::Var { name, em }),
                Inline::Link { key, text } => out.push(Run::Link { key, text: text.as_deref(), em }),
                Inline::B(c) => walk(c, Emphasis { bold: true, ..em }, out),
                Inline::I(c) => walk(c, Emphasis { italic: true, ..em }, out),
            }
        }
    }
    let mut out = Vec::new();
    walk(nodes, Emphasis::default(), &mut out);
    out
}

/// The AST in the JSON shape of `test/cases/markup.json` (`{type:"p",c:[…]}`, `{t:"link",key,text}` …).
pub fn to_json(blocks: &[Block]) -> Value {
    fn inline(nodes: &[Inline]) -> Value {
        Value::Array(
            nodes
                .iter()
                .map(|n| match n {
                    Inline::Text(v) => json!({"t": "text", "v": v}),
                    Inline::Br => json!({"t": "br"}),
                    Inline::B(c) => json!({"t": "b", "c": inline(c)}),
                    Inline::I(c) => json!({"t": "i", "c": inline(c)}),
                    Inline::Code(v) => json!({"t": "code", "v": v}),
                    Inline::Link { key, text } => json!({"t": "link", "key": key, "text": text}),
                    Inline::Var(name) => json!({"t": "var", "name": name}),
                })
                .collect(),
        )
    }
    Value::Array(
        blocks
            .iter()
            .map(|b| match b {
                Block::P(c) => json!({"type": "p", "c": inline(c)}),
                Block::Ul(items) => {
                    json!({"type": "ul", "items": items.iter().map(|it| inline(it)).collect::<Vec<_>>()})
                }
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bullets() {
        assert_eq!(bullet_item("- a"), Some("a"));
        assert_eq!(bullet_item("  •\tb c"), Some("b c"));
        assert_eq!(bullet_item("-a"), None);
        assert_eq!(bullet_item("- "), Some(""));
        assert_eq!(bullet_item("x - a"), None);
    }

    #[test]
    fn paragraphs_split_like_javascript() {
        assert_eq!(split_paragraphs("a\n\n\nb"), vec!["a", "\nb"]);
        assert_eq!(split_paragraphs("a\n \t\nb\nc"), vec!["a", "b\nc"]);
        assert_eq!(split_paragraphs(""), vec![""]);
    }

    #[test]
    fn runs_carry_emphasis() {
        let blocks = parse_text("**a *b [[c.d]] e* f**");
        let Block::P(nodes) = &blocks[0] else { panic!() };
        let r = runs(nodes);
        assert!(r.contains(&Run::Link { key: "c.d", text: None, em: Emphasis { bold: true, italic: true } }));
    }

    #[test]
    fn refs() {
        let r = collect_refs(&parse_text("[[a.b]] {x}\n- **[[c]]**"));
        assert_eq!(r.links, vec!["a.b", "c"]);
        assert_eq!(r.vars, vec!["x"]);
    }
}
