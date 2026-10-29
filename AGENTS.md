# AGENTS.md — DeepTip

Instructions for AI coding agents (Codex, Claude Code, Copilot, Cursor, Gemini CLI, Jules, Aider …).

## What this repository is

DeepTip is a **UI design pattern** (explanation windows with depth: nested, pinnable, Paradox-style tooltips) plus everything needed to use it in any language: the specification, the JSON glossary format with its schema and validator, shared test cases, the code in HTML/CSS/JavaScript and Rust, and an exact guide for every other framework. When a user says "DeepTip", "DeepTooltip", "3DTooltip", "nested tooltips", "Paradox tooltips" or "Erklärfenster", they mean this pattern. A short briefing for any model: [docs/prompt.md](docs/prompt.md).

## Layout

| Path | Content |
|---|---|
| `SPEC.md` | the contract (data §2, behaviour §3, placement §4, input §5, a11y §6, options §7, styling §8, porting §9) |
| `docs/algorithms.md` | the exact algorithms of the reference as language-neutral pseudo-code (§1 data … §12 encyclopedia); build from these |
| `schema/deeptip.schema.json` | JSON Schema of a glossary file |
| `glossary/core/` | shared core glossary (DeepTip help `deeptip.*`, general terms), English and German |
| `glossary/example/` | the example glossary every framework's example uses (`demo.*`) |
| `test/cases/*.json` | parity cases: markup AST, placement, glossary flattening; every runtime must pass them |
| `frameworks/<name>/` | one framework each: `README.md`, `deeptip.json` (manifest); code folders (web, rpgmaker-mz, rust-egui) also the runtime, `example/` and tests, guide folders only the exact guide |
| `tools/deeptip-check.mjs` | validator for glossary files (Node 18+) |
| `tools/package.mjs` | builds `dist/DeepTip-<name>-<version>.zip`, one download per framework |

## Using DeepTip in a user's project

1. Pick the folder in `frameworks/` that matches the project (read its README). If none matches, port it (below).
2. Code frameworks (web, RPG Maker MZ, Rust/egui): copy the runtime files (or the download zip) into the project; never edit them in place there, update from here. Guide frameworks: build DeepTip in the project exactly as the guide and `docs/algorithms.md` say, then pass `test/cases/`.
3. Write the project's glossary as `deeptip/<locale>.json` (user's language first). Keys `<project>.<term>`. `short` is one line (≤ 140 chars), `body` 2–5 sentences, link generously but only to keys that exist.
4. Mark UI elements with their key (web: `data-deeptip="key"`; other frameworks: see their README).
5. Validate: `node tools/deeptip-check.mjs --base <locale> glossary/core/<locale>.json <project glossary files> --scan <project src>`.

## Adding or changing a framework

- **Code lives only in HTML, CSS, JavaScript and Rust.** Every other language gets a guide, not code: the repository must stay small enough to keep exact, and a precise description lets any developer or model rebuild DeepTip in any toolkit.
- Follow SPEC §9 and `docs/algorithms.md`. Keep the behaviour of the reference (`frameworks/web/deeptip.js`): window tree invariants (§3.2), grace and mouse tendency (§3.4), placement (§4, `computePlacement`), input (§5).
- Every folder needs `README.md` and `deeptip.json` (name, title, language, tier, version, kind, status, `uses` = other framework folders bundled into its download).
  - Code (`kind` `runtime` or `adapter`): an `example/` that uses `glossary/example/` and `glossary/core/`, and tests that load `test/cases/*.json` where the framework has its own parser or placement. Status `stable`, `tested` (built and its tests ran) or `untested` (no toolchain was available).
  - Guide (`kind` `guide`, status `documented`): only the README. It maps every SPEC concept to the toolkit's primitive (windows and z-order, rich text with hoverable and clickable terms and how to hit-test them, pointer events, timers or the frame loop, coordinates for placement, keys incl. consuming Esc, theming), lists the data structures, the exact order of operations per event or frame, JSON loading, the toolkit's pitfalls, and how to run `test/cases/*.json` in that language. Short snippets inside the README are fine; no separate code files. Link the sections of `docs/algorithms.md` instead of repeating them.
- Code and comments in English. Glossary text never contains HTML.

## Commands

```bash
npm test                 # reference runtime against test/cases
npm run check            # validate core and example glossaries
npm run cases            # regenerate test/cases from the reference (only after a deliberate behaviour change)
npm run package          # one zip per framework into dist/
node tools/package.mjs --list
```
