---
name: deeptip
description: DeepTip = nested, pinnable explanation tooltips ("tooltips in tooltips" like Paradox games CK3/Victoria 3/EU5) driven by per-locale JSON glossaries with [[key|text]] links. Use whenever the user asks for DeepTip, DeepTooltip, 3DTooltip, DimTip, nested/verschachtelte tooltips, Paradox tooltips, Erklärfenster, a glossary/encyclopedia with hover explanations, or wants UI elements explained in depth — in ANY project or runtime (web, Svelte, React, Tauri, Godot, .NET, Unity).
---

# DeepTip — explanation windows with depth

A reusable UI concept. Saying "DeepTip" must be enough — like saying "dialog". Canonical source:
**https://github.com/gorduan/DeepTip** (clone it; below `<DeepTip>` is the clone's folder). Read `SPEC.md` there
before implementing in a new runtime; it is the contract (data format §2, behaviour §3, placement §4, input §5,
a11y §6, options §7, CSS hooks §8, porting checklist §9).

## What it is (so you can explain it)
Rest the pointer on a UI element → after `delay` (per project, can be 0) a window explains it.
Highlighted terms inside open further windows on hover (immediately), a click pins them, pinned windows contain
terms again → endless navigation. Children open next to the previous window, order left → right → top → bottom,
never covering it (older ones may be covered); root windows below → above → right → left of the element. X and
pin buttons (both switchable). Touch: long-press opens (vibration), tap follows a term, tap outside / swipe title
bar down closes all. Keyboard: F1 or ? opens, Tab/Enter follow terms, Esc closes newest, hold Esc / Shift+Esc
closes all, F6 switches windows. Gamepad: Y opens, A follows, B closes (hold = all), LB/RB switch, d-pad walks.
Mouse tendency + grace keep previews open on the way in; optional timer lock pins after resting.

## Content = JSON glossaries (like translation files)
- One file per locale: core `glossary/core/<locale>.json` (hw.*, sys.*, ai.*, deeptip.* help) + project file
  (`<project>/deeptip/<locale>.json`). Later layers override per key. Locale chain + fallback badge.
- Entry: `{"title", "short" (≤140, one line), "body" (2–5 sentences with links), "aliases"?, "see"?, "note"?}`.
  Keys dotted, language-neutral: `myapp.gamemode`. Nested i18next objects also accepted.
- Markup (never HTML): `[[key]]`, `[[key|text]]`, `**b**`, `*i*`, `` `code` ``, `{live_value}`, `- ` lists,
  blank line = paragraph. `$ui` = window labels per locale.
- Write the user's language first; keep `short` truly one line; link generously but only to entries that exist
  (or add them). Important info high in the chain, background deeper.

## Web / Svelte / React / Tauri (reference runtime, no dependencies)
1. `node "<DeepTip>/tools/deeptip-sync.mjs" "<project>/src/deeptip"` → copies `deeptip.js`, `deeptip.css`,
   `core/de.json`, `core/en.json` (re-run to update; `--check` reports drift). Or load from the CDN:
   `https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/web/deeptip.js` (and `deeptip.css`).
2. Create `<project>/src/deeptip/<locale>.json` with the project's entries (prefix = project name).
3. Init once (e.g. main.js):
   ```js
   import "./deeptip/deeptip.css";
   import { DeepTip } from "./deeptip/deeptip.js";
   import core from "./deeptip/core/en.json";
   import app from "./deeptip/en.json";
   export const deeptip = DeepTip.init({ locale: "en", fallback: [], delay: 800, vars: { … } })
     .add("en", core).add("en", app);
   ```
   (or `sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"]` to fetch.)
4. Mark elements: `data-deeptip="key"` (optional `data-deeptip-delay="0"`, `data-deeptip-place="top,bottom"` for
   form labels so the window does not cover the input). Terms on normal pages:
   `deeptip.renderText(el, "… [[key]] …")`. Encyclopedia: `deeptip.renderIndex(el)`.
   Works with any framework (event delegation, no per-element wiring). Theme via `--dt-*` variables; hide the
   project's own simple tooltip while `[data-dt-open]`; show rest-progress with `[data-dt-arming]` + `--dt-delay`.
5. Validate (CI/build): `node "<DeepTip>/tools/deeptip-check.mjs" --base en <core+project json…> --scan src`.
6. API: `open(key,{anchor,parent,pinned,focus})`, `closeAll()`, `pin(w)`, `setLocale(l)`, `configure({...})`,
   `refresh()` (after live values change), `add(locale, json)`, `destroy()`.

## Other runtimes
Follow SPEC §9: port the glossary loader + `parseText` AST (map to RichTextLabel/BBCode in Godot, Inlines in
WPF/Avalonia, TMP rich text in Unity), the window tree invariants (§3.2), hot/grace/tendency (§3.4),
`computePlacement` (§4, pure function in `web/deeptip.js`), the input table (§5). Reuse the SAME JSON files and
the validator. Runtime folders live in the DeepTip repo (`valheim/`, `godot/`, `dotnet/` …).

## Known runtimes
- Web (`web/`): the reference implementation.
- Valheim (`valheim/`, BepInEx plugin GC_Valheim_DeepTip, Thunderstore "DeepTip"): Valheim's UITooltip becomes the
  root window, terms as TMP `<link="dt:key">`, auto-linking via `aliases`, lexicon page in the Compendium,
  glossaries from any plugin's `deeptip/` folder, C# API `DeepTip.Api`.
