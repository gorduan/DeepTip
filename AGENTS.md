# AGENTS.md — DeepTip

Instructions for AI coding agents (Codex, Claude Code, Copilot, Cursor, Gemini CLI, Jules, Aider …).

## What this repository is

DeepTip is a **UI design pattern** (explanation windows with depth: nested, pinnable, Paradox-style tooltips) plus everything needed to use it in any language: the specification, the JSON glossary format with its schema and validator, shared test cases, the code in HTML/CSS/JavaScript and Rust, an exact guide for every other framework, an Agent Skill with install packs for 45 agent harnesses, and an MCP server. When a user says "DeepTip", "DeepTooltip", "3DTooltip", "nested tooltips", "Paradox tooltips" or "Erklärfenster", they mean this pattern. A short briefing for any model: [docs/prompt.md](docs/prompt.md).

## Layout

| Path | Content |
|---|---|
| `SPEC.md` | the contract (data §2, behaviour §3, placement §4, input §5, a11y §6, options §7, styling §8, porting §9) |
| `docs/algorithms.md` | the exact algorithms of the reference as language-neutral pseudo-code (§1 data … §12 encyclopedia); build from these |
| `schema/deeptip.schema.json` | JSON Schema of a glossary file |
| `glossary/core/` | shared core glossary (DeepTip help `deeptip.*`, general terms), English and German |
| `glossary/example/` | the example glossary every framework's example uses (`demo.*`) |
| `test/cases/*.json` | parity cases: markup AST, placement, glossary flattening; every runtime must pass them |
| `frameworks/<name>/` | one framework each: `README.md` (starting with the Quick start), `deeptip.json` (manifest); code folders also the code, examples and tests (web: the reference; rpgmaker-mz, jquery, phaser, bootstrap: adapters on the web runtime; rust-egui: the Rust crate `deeptip`, a complete implementation, `cargo test`; rust-ratatui: its terminal adapter, `cargo test`), guide folders only the exact guide |
| `tools/deeptip-check.mjs` | validator for glossary files (Node 18+); `--scan` finds the keys used in source code |
| `tools/package.mjs` | builds `dist/DeepTip-<name>-<version>.zip`, one download per framework, and `dist/DeepTip-skill-<version>.zip` |
| `tools/frameworks.mjs` | writes the framework lists of `README.md`, `README.de.md`, `skill/deeptip/SKILL.md` and `llms.txt` (only between their `<!-- generated:… -->` markers) from the manifests and each guide's "Recognise the project" line; `--check` exits with 1 while they are out of date |
| `skill/deeptip/` | the Agent Skill: `SKILL.md` (hand-written, except its framework table) and `references/` (a copy made by `tools/skill.mjs`, never edited by hand); install notes in `skill/README.md` |
| `skill/harnesses/` | the files for 45 agent harnesses (pointers in their own formats, a knowledge pack for chat assistants and local models), made from `skill/harnesses/source.json` |
| `tools/harness.mjs` | writes `skill/harnesses/` from `source.json`; `--check` exits with 1 while anything is out of date |
| `tools/install.mjs` | installs the skill and the harness files into a project or the home folder, or writes a knowledge pack; keeps every replaced file as `.bak` |
| `mcp/` | the MCP server `deeptip-mcp.mjs` (read-only, stdio, no dependencies), its tests `mcp/test/mcp.test.mjs` and the client setup in `mcp/README.md` |

## Using DeepTip in a user's project

1. Pick the folder in `frameworks/` that matches the project (its Quick start says how to recognise it). If none matches, port it (below).
2. Code frameworks (web, RPG Maker MZ, jQuery, Phaser, Bootstrap, Rust egui, Rust Ratatui): copy the code files (or the download zip) into the project, or depend on the Rust crates; never edit them in place there, update from here. Guide frameworks: build DeepTip in the project exactly as the guide and `docs/algorithms.md` say, then pass `test/cases/`.
3. Write the project's glossary as `deeptip/<locale>.json` (user's language first). Keys `<project>.<term>`. `short` is one line (≤ 140 chars), `body` 2–5 sentences, link generously but only to keys that exist.
4. Mark UI elements with their key (web: `data-deeptip="key"`; other frameworks: see their README).
5. Validate: `node tools/deeptip-check.mjs --base <locale> glossary/core/<locale>.json <project glossary files> --scan <project src>`.

## Adding or changing a framework

- **Code lives only in HTML, CSS, JavaScript and Rust.** Every other language gets a guide, not code: the repository must stay small enough to keep exact, and a precise description lets any developer or model rebuild DeepTip in any toolkit.
- Follow SPEC §9 and `docs/algorithms.md`. Keep the behaviour of the reference (`frameworks/web/deeptip.js`): window tree invariants (§3.2), grace and mouse tendency (§3.4), placement (§4, `computePlacement`), input (§5).
- Every folder needs `README.md` and `deeptip.json` (name, title, language, tier, area, version, kind, status, `uses` = other framework folders bundled into its download).
  - `area` is one of `web`, `desktop`, `mobile`, `games` (engines and mods too) and `terminal`: the row of the framework in the README's "Works with". `npm run frameworks` writes every framework list from the manifests; run it after adding a framework or changing a manifest or a Quick start.
  - Code (`kind` `runtime` or `adapter`): an `example/` that uses `glossary/example/` and `glossary/core/`, and tests that load `test/cases/*.json` where the framework has its own parser or placement. Status `stable`, `tested` (built and its tests ran) or `untested` (no toolchain was available).
  - Guide (`kind` `guide`, status `documented`): only the README. It maps every SPEC concept to the toolkit's primitive (windows and z-order, rich text with hoverable and clickable terms and how to hit-test them, pointer events, timers or the frame loop, coordinates for placement, keys incl. consuming Esc, theming), lists the data structures, the exact order of operations per event or frame, JSON loading, the toolkit's pitfalls, and how to run `test/cases/*.json` in that language. Short snippets inside the README are fine; no separate code files. Link the sections of `docs/algorithms.md` instead of repeating them.
- Every README, code or guide, has a **Quick start** right after its introduction, in exactly this form. `tools/frameworks.mjs` reads the line `**Recognise the project:**` for the skill's framework table (its first clause, up to a `;`, is what agents match a project against), so keep it on one line:

  ````markdown
  ## Quick start

  **Recognise the project:** <files, packages and code that show this framework, the most telling first>; <more signals>.

  1. <the first thing to copy or build, e.g. port `flatten`, `parseText` and `computePlacement` and pass `test/cases` (section N)>
  2. <the parts to build, in order, with their sections>
  3. Copy `glossary/core/<locale>.json` to `<folder>/core/`; your own entries go to `<folder>/<locale>.json` (section N).
  4. <start DeepTip once and mark the elements: the framework's marking call>
  5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en <folder>/core/en.json <folder>/en.json`.

  ```<language>
  <the smallest complete program: DeepTip started, one element marked with deeptip.about or shop.cart>
  ```

  **Done when:** <what the user sees: resting on the element for 800 ms opens its window next to it, hovering a term in it opens the next window beside it and never on top, a click pins both, `Esc` closes the newest>, <the parity cases pass>, the validator reports 0 errors.
  ````

- Code and comments in English. Glossary text never contains HTML.

## Commands

```bash
npm test                 # node tests (reference, parity cases, harness packs, MCP server), then every --check below
npm run check            # validate core and example glossaries
npm run cases            # regenerate test/cases from the reference (only after a deliberate behaviour change)
npm run package          # one zip per framework and the skill zip into dist/
npm run skill            # refresh skill/deeptip/references (npm test fails while it is out of date)
npm run frameworks       # rewrite the framework lists from the manifests (npm test fails while they are out of date)
npm run harness          # rewrite skill/harnesses from source.json (npm test fails while it is out of date)
npm run mcp              # start the MCP server on stdio
npm run install-skill -- <project> --harness claude-code   # the installer, see skill/README.md
node tools/package.mjs --list
cargo test               # in frameworks/rust-egui and in frameworks/rust-ratatui
```

After changing `SPEC.md`, `docs/algorithms.md`, anything in `frameworks/`, `glossary/`, `schema/`, `test/cases/` or the tools, run `npm run skill` and commit the refreshed copy with the change. After changing a manifest or a Quick start, run `npm run frameworks`; after changing the version in `skill/deeptip/SKILL.md` or `skill/harnesses/source.json`, run `npm run harness`. When the behaviour changes, update `skill/deeptip/SKILL.md` (and `instructions` and `systemPrompt` in `skill/harnesses/source.json`) too.
