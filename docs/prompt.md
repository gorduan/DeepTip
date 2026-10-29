# DeepTip — briefing for any language model

Paste this into a chat or a system prompt so a model knows what "DeepTip" means and how to build it.

---

**DeepTip** is a UI design pattern: explanation windows with depth, like the nested tooltips of Paradox Interactive's games (Crusader Kings III, Victoria 3, Europa Universalis V). Synonyms: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips, tooltips in tooltips, Erklärfenster.

**Behaviour**
- Rest the pointer on a UI element; after a delay (typically 0.5–0.8 s, configurable, may be 0) a window explains it.
- Highlighted *terms* inside the window open further windows on hover (about 80 ms). A click pins a window (and every window it came from). Pinned windows contain terms again, so explanations nest without limit.
- A further window opens next to the window it came from (preferred sides: left, right, top, bottom) and never covers it; the first window opens next to its element (bottom, top, right, left).
- One unpinned preview per level; closing a window closes everything opened from it; a term already open further up the chain is not opened twice (that window flashes).
- An unpinned window closes after a grace time (about 300 ms) once the pointer left it, longer (up to 1.5 s) while the pointer moves towards it (mouse tendency); terms crossed on the way into a window do not replace it. Optional timer lock: resting inside a preview pins it.
- Window chrome: title, close (X) and pin buttons, a hint line in previews.
- Input: mouse (rest, hover, click), touch (long-press opens pinned, tap follows, tap outside closes all), keyboard (F1 or ? opens, Tab/Enter follow terms, Esc closes the newest, Shift+Esc or holding Esc closes all, F6 switches), gamepad (Y opens, A follows, B closes, holding B closes all, LB/RB switch).

**Content is data**: one JSON file per language (glossary), never text in code.
```json
{ "$locale": "en",
  "app.term": { "title": "Term", "short": "One line, max 140 chars.",
                "body": "2–5 sentences with [[other.key]] or [[other.key|own text]] links, **bold**, *italic*, `code`, {live_value}.\n\n- lists\n- too",
                "aliases": ["words as they appear in the UI"], "see": ["related.key"] } }
```
Keys are dotted and language-neutral. Layers: a core glossary first, the project after it (a later layer overrides a key). Locales fall back along a chain; a window from a fallback language shows a small badge. Markup is never HTML.

**Building it**: the contract is SPEC.md in https://github.com/gorduan/DeepTip; `docs/algorithms.md` there has every algorithm as language-neutral pseudo-code. Code exists for the web (`frameworks/web`, HTML + CSS + JavaScript, the reference), RPG Maker MZ (`frameworks/rpgmaker-mz`), jQuery (`frameworks/jquery`), Phaser (`frameworks/phaser`), a Bootstrap theme (`frameworks/bootstrap`), Rust egui (`frameworks/rust-egui`) and Rust Ratatui (`frameworks/rust-ratatui`). Every other framework has an exact guide in `frameworks/<name>/README.md`; all 48 frameworks (web, desktop, mobile, games, terminals) are listed in the [README](https://github.com/gorduan/DeepTip#all-frameworks-in-detail). For any runtime: port the glossary loader and the markup parser, the window tree, grace and tendency, the placement function, the input table; then pass the shared cases in `test/cases/*.json` and validate the JSON files with `tools/deeptip-check.mjs`.
