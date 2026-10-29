//! Markup → lines of cells (algorithms §3 for a character grid).
//!
//! Word wrapping that counts display cells (a wide character takes two cells and may break before and after it,
//! a combining mark takes none) and remembers where every term ended up, so the pointer can be hit-tested per
//! cell and a term that wraps keeps all its fragments.

use std::collections::HashMap;

use deeptip::{runs, Block, Emphasis, Inline, Run};
use ratatui::buffer::{Buffer, CellWidth};
use ratatui::layout::Rect;
use ratatui::style::Style;
use unicode_segmentation::UnicodeSegmentation;

/// What a piece of text is; decides its style when it is drawn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Text,
    Weak,
    Code,
    Value,
    /// A link to the entry the window shows: bold, not interactive.
    Strong,
    /// A link to a missing entry: marked, not interactive.
    Missing,
    /// A term: index into [`Laid::terms`].
    Term(usize),
}

/// A run of text with one kind and emphasis.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Piece {
    pub text: String,
    pub width: u16,
    pub kind: Kind,
    pub em: Emphasis,
}

/// One line of a laid-out text.
#[derive(Clone, Debug, Default)]
pub(crate) struct Line {
    pub pieces: Vec<Piece>,
}

/// A term in a laid-out text.
#[derive(Clone, Debug)]
pub(crate) struct LaidTerm {
    pub key: String,
    /// `(line, column, width)` of every fragment; a term that wraps has several.
    pub frags: Vec<(usize, u16, u16)>,
}

/// A text wrapped to a width.
#[derive(Clone, Debug, Default)]
pub(crate) struct Laid {
    pub lines: Vec<Line>,
    pub terms: Vec<LaidTerm>,
    /// Width of the widest line.
    pub width: u16,
}

/// What a text needs to render: titles of the linked keys (`None` = no entry), live values, the window's own key.
#[derive(Clone, Debug, Default)]
pub(crate) struct TextCtx {
    pub titles: HashMap<String, Option<String>>,
    pub values: HashMap<String, String>,
    pub self_key: Option<String>,
}

/// Display width of a string in cells, measured the way ratatui's buffer measures it.
pub(crate) fn width(s: &str) -> u16 {
    s.graphemes(true).filter(|g| !g.chars().any(char::is_control)).map(CellWidth::cell_width).sum()
}

/// `s` cut to at most `max` cells, with `ellipsis` when something was cut.
pub(crate) fn truncate(s: &str, max: u16, ellipsis: &str) -> String {
    if width(s) <= max {
        return s.to_owned();
    }
    let room = max.saturating_sub(width(ellipsis));
    let mut out = String::new();
    let mut used = 0;
    for g in s.graphemes(true).filter(|g| !g.chars().any(char::is_control)) {
        let w = g.cell_width();
        if used + w > room {
            break;
        }
        used += w;
        out.push_str(g);
    }
    if max >= width(ellipsis) {
        out.push_str(ellipsis);
    }
    out
}

enum Tok {
    Word(Vec<Piece>),
    Space(Piece),
    Break,
}

#[derive(Default)]
struct Tokens {
    toks: Vec<Tok>,
    /// The last token is a word that the next grapheme continues.
    open: bool,
}

impl Tokens {
    fn text(&mut self, text: &str, kind: Kind, em: Emphasis) {
        for g in text.graphemes(true) {
            if g == " " || g == "\t" {
                // only ordinary spaces break; a no-break space stays inside its word
                self.toks.push(Tok::Space(Piece { text: " ".into(), width: 1, kind, em }));
                self.open = false;
                continue;
            }
            if g.chars().any(char::is_control) {
                continue;
            }
            let width = g.cell_width();
            if width == 0 {
                continue; // ratatui's buffer drops zero-width graphemes as well
            }
            let piece = Piece { text: g.into(), width, kind, em };
            if width > 1 {
                // wide characters (CJK) may break before and after them
                self.toks.push(Tok::Word(vec![piece]));
                self.open = false;
                continue;
            }
            match self.toks.last_mut() {
                Some(Tok::Word(word)) if self.open => word.push(piece),
                _ => {
                    self.toks.push(Tok::Word(vec![piece]));
                    self.open = true;
                }
            }
        }
    }

    fn brk(&mut self) {
        self.toks.push(Tok::Break);
        self.open = false;
    }

    /// A link (algorithms §3): the window's own key is bold text, a missing key is marked, anything else a term.
    fn link(&mut self, key: &str, own: Option<&str>, em: Emphasis, ctx: &TextCtx, terms: &mut Vec<LaidTerm>) {
        let title = ctx.titles.get(key).cloned().flatten();
        let label = own.map(str::to_owned).or_else(|| title.clone()).unwrap_or_else(|| key.to_owned());
        let kind = if ctx.self_key.as_deref() == Some(key) {
            Kind::Strong
        } else if title.is_none() {
            Kind::Missing
        } else {
            terms.push(LaidTerm { key: key.to_owned(), frags: Vec::new() });
            Kind::Term(terms.len() - 1)
        };
        self.text(&label, kind, em);
    }

    fn inlines(&mut self, nodes: &[Inline], ctx: &TextCtx, terms: &mut Vec<LaidTerm>) {
        for run in runs(nodes) {
            match run {
                Run::Break => self.brk(),
                Run::Text { text, em } => self.text(text, Kind::Text, em),
                Run::Code { text, em } => self.text(text, Kind::Code, em),
                Run::Var { name, em } => {
                    let v = ctx.values.get(name).cloned().unwrap_or_else(|| format!("{{{name}}}"));
                    self.text(&v, Kind::Value, em);
                }
                Run::Link { key, text, em } => self.link(key, text, em, ctx, terms),
            }
        }
    }
}

/// Greedy word wrap into lines of at most `avail` cells; a word longer than a line is split.
fn fill(toks: Vec<Tok>, avail: u16) -> Vec<Vec<Piece>> {
    let avail = usize::from(avail.max(1));
    let mut lines = Vec::new();
    let mut cur: Vec<Piece> = Vec::new();
    let mut cur_w = 0usize;
    let mut spaces: Vec<Piece> = Vec::new();
    for tok in toks {
        match tok {
            Tok::Break => {
                lines.push(std::mem::take(&mut cur));
                cur_w = 0;
                spaces.clear();
            }
            Tok::Space(p) => {
                if cur_w > 0 {
                    spaces.push(p);
                }
            }
            Tok::Word(word) => {
                let w: usize = word.iter().map(|p| usize::from(p.width)).sum();
                let sw: usize = spaces.iter().map(|p| usize::from(p.width)).sum();
                if cur_w > 0 && cur_w + sw + w <= avail {
                    cur.append(&mut spaces);
                    cur.extend(word);
                    cur_w += sw + w;
                    continue;
                }
                spaces.clear();
                if cur_w > 0 {
                    lines.push(std::mem::take(&mut cur));
                    cur_w = 0;
                }
                for p in word {
                    if cur_w > 0 && cur_w + usize::from(p.width) > avail {
                        lines.push(std::mem::take(&mut cur));
                        cur_w = 0;
                    }
                    cur_w += usize::from(p.width);
                    cur.push(p);
                }
            }
        }
    }
    if !cur.is_empty() {
        lines.push(cur);
    }
    lines
}

/// Lay out blocks (and a "See also" line) at `width` cells: one empty line between blocks, list items with a
/// bullet and a hanging indent.
pub(crate) fn lay_out(
    blocks: &[Block],
    see: Option<(&str, &[String])>,
    ctx: &TextCtx,
    width: u16,
    bullet: &str,
) -> Laid {
    let mut terms = Vec::new();
    let mut lines: Vec<Vec<Piece>> = Vec::new();
    let marker = format!("{bullet} ");
    let indent = self::width(&marker);
    for (i, block) in blocks.iter().enumerate() {
        if i > 0 {
            lines.push(Vec::new());
        }
        match block {
            Block::P(nodes) => {
                let mut t = Tokens::default();
                t.inlines(nodes, ctx, &mut terms);
                lines.extend(fill(t.toks, width));
            }
            Block::Ul(items) => {
                for item in items {
                    let mut t = Tokens::default();
                    t.inlines(item, ctx, &mut terms);
                    for (j, mut line) in fill(t.toks, width.saturating_sub(indent)).into_iter().enumerate() {
                        let prefix = if j == 0 { marker.clone() } else { " ".repeat(usize::from(indent)) };
                        line.insert(
                            0,
                            Piece { text: prefix, width: indent, kind: Kind::Text, em: Emphasis::default() },
                        );
                        lines.push(line);
                    }
                }
            }
        }
    }
    if let Some((label, keys)) = see.filter(|(_, keys)| !keys.is_empty()) {
        let mut t = Tokens::default();
        t.text(label, Kind::Weak, Emphasis::default());
        t.text(" ", Kind::Weak, Emphasis::default());
        for (i, key) in keys.iter().enumerate() {
            if i > 0 {
                t.text(", ", Kind::Weak, Emphasis::default());
            }
            t.link(key, None, Emphasis::default(), ctx, &mut terms);
        }
        lines.extend(fill(t.toks, width));
    }

    // fragments of the terms, then merge neighbouring pieces of the same kind for drawing
    let mut laid = Laid { lines: Vec::with_capacity(lines.len()), terms, width: 0 };
    for (li, pieces) in lines.into_iter().enumerate() {
        let mut col = 0u16;
        let mut merged: Vec<Piece> = Vec::new();
        for p in pieces {
            if let Kind::Term(i) = p.kind {
                let frags = &mut laid.terms[i].frags;
                match frags.last_mut() {
                    Some((l, c, w)) if *l == li && *c + *w == col => *w += p.width,
                    _ => frags.push((li, col, p.width)),
                }
            }
            col = col.saturating_add(p.width);
            match merged.last_mut() {
                Some(last) if last.kind == p.kind && last.em == p.em => {
                    last.text.push_str(&p.text);
                    last.width += p.width;
                }
                _ => merged.push(p),
            }
        }
        laid.width = laid.width.max(col);
        laid.lines.push(Line { pieces: merged });
    }
    laid
}

/// Draw the lines `scroll..` of a laid-out text into `area` (clipped to the buffer).
pub(crate) fn draw(buf: &mut Buffer, area: Rect, laid: &Laid, scroll: usize, style: impl Fn(&Piece) -> Style) {
    let area = area.intersection(buf.area);
    let right = area.x + area.width;
    for row in 0..area.height {
        let Some(line) = laid.lines.get(scroll + usize::from(row)) else { break };
        let y = area.y + row;
        let mut x = area.x;
        for p in &line.pieces {
            if x >= right {
                break;
            }
            let (next, _) = buf.set_stringn(x, y, &p.text, usize::from(right - x), style(p));
            x = next;
        }
    }
}

/// The visible part of a term's fragments when the text is drawn at `area` from line `scroll`.
pub(crate) fn visible(frags: &[(usize, u16, u16)], area: Rect, scroll: usize) -> Vec<Rect> {
    frags
        .iter()
        .filter(|(line, ..)| *line >= scroll && *line < scroll + usize::from(area.height))
        .filter_map(|&(line, col, w)| {
            let x = area.x.checked_add(col)?;
            let right = area.x + area.width;
            (x < right).then(|| Rect::new(x, area.y + (line - scroll) as u16, w.min(right - x), 1))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use deeptip::parse_text;

    fn ctx(keys: &[(&str, &str)]) -> TextCtx {
        TextCtx {
            titles: keys.iter().map(|(k, t)| ((*k).to_owned(), Some((*t).to_owned()))).collect(),
            ..TextCtx::default()
        }
    }

    fn text(l: &Line) -> String {
        l.pieces.iter().map(|p| p.text.as_str()).collect()
    }

    #[test]
    fn wraps_words_and_keeps_term_fragments() {
        let c = ctx(&[("a.b", "Highlighted term")]);
        let laid = lay_out(&parse_text("Hover a [[a.b]] to see more."), None, &c, 16, "•");
        let lines: Vec<String> = laid.lines.iter().map(text).collect();
        assert_eq!(lines, ["Hover a", "Highlighted term", "to see more."]);
        assert_eq!(laid.terms[0].frags, vec![(1, 0, 16)]);
        let laid = lay_out(&parse_text("Hover a [[a.b]] to see more."), None, &c, 20, "•");
        assert_eq!(laid.terms[0].frags, vec![(0, 8, 11), (1, 0, 4)], "a term that wraps has two fragments");
    }

    #[test]
    fn wide_characters_take_two_cells_and_may_break_anywhere() {
        let laid = lay_out(&parse_text("漢字かな交じり文"), None, &TextCtx::default(), 7, "•");
        let lines: Vec<String> = laid.lines.iter().map(text).collect();
        assert_eq!(lines, ["漢字か", "な交じ", "り文"]);
        assert!(laid.lines.iter().all(|l| l.pieces.iter().map(|p| p.width).sum::<u16>() <= 7));
    }

    #[test]
    fn blocks_lists_and_see_also() {
        let c = ctx(&[("x.y", "Why")]);
        let laid =
            lay_out(&parse_text("One.\n\n- two\n- three"), Some(("See also:", &["x.y".to_owned()])), &c, 30, "•");
        let lines: Vec<String> = laid.lines.iter().map(text).collect();
        assert_eq!(lines, ["One.", "", "• two", "• three", "See also: Why"]);
        assert_eq!(laid.terms[0].frags, vec![(4, 10, 3)]);
    }

    #[test]
    fn missing_and_own_links_are_not_terms() {
        let mut c = ctx(&[("a.b", "B")]);
        c.titles.insert("gone".into(), None);
        c.self_key = Some("a.b".into());
        let laid = lay_out(&parse_text("[[a.b]] and [[gone]]"), None, &c, 30, "•");
        assert!(laid.terms.is_empty());
        let kinds: Vec<Kind> = laid.lines[0].pieces.iter().map(|p| p.kind).collect();
        assert_eq!(kinds, [Kind::Strong, Kind::Text, Kind::Missing]);
    }

    #[test]
    fn truncates_by_cells() {
        assert_eq!(truncate("Stability", 6, "…"), "Stabi…");
        assert_eq!(truncate("漢字漢字", 5, "…"), "漢字…");
        assert_eq!(truncate("ok", 5, "…"), "ok");
    }
}
