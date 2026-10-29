# DeepTip

> **DeepTip** is a UI design pattern: explanation windows with depth. Rest on an element and a window explains it. Highlighted terms inside open further windows, a click pins them, and pinned windows contain terms again, so you can read as deep as you like, the way Paradox Interactive's games (Crusader Kings III, Victoria 3, Europa Universalis V) explain their mechanics. The content is data: one JSON glossary per language.

Other names for the same thing: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips, tooltips in tooltips, Erklärfenster. Deutsch: [README.de.md](README.de.md).

This repository is the home of the pattern: the specification, the data format with its schema and validator, shared test cases, the code in HTML, CSS, JavaScript and Rust, and an exact guide for every other framework, each in its own folder with its own download.

## The pattern

A DeepTip is the answer to "what does this mean?" without leaving the screen and without a manual.

| Rule | Why |
|---|---|
| **One entry, three depths**: `title` (the name), `short` (one line), `body` (2–5 sentences with links). | The important part is always at the top; background sits one hover deeper. |
| **Terms are links**: every concept a text mentions can be its own entry. | Explanations nest without limit, nothing is explained twice. |
| **Nothing is lost by accident**: a window stays while the pointer moves towards it, terms crossed on the way do not replace it, and pinned windows close only on purpose. | Reading must never be a race against the mouse. |
| **Never cover the way back**: a further window opens next to the one it came from, never on top of it. | The chain stays readable. |
| **Content is data**: one JSON file per language, like translation files; code never contains explanation text. | Writers and translators work without programmers; every runtime uses the same files. |
| **Every input device is first-class**: mouse, touch, keyboard, gamepad, screen reader. | Games and tools are used with all of them. |
| **Native first**: use what the platform offers (popups, rich text, focus) before writing code. | Less code, better accessibility. |

Use it where users meet many interlocking concepts: games, simulations, professional tools, dashboards, configuration screens, onboarding without tutorials.

## Frameworks: one folder, one download each

DeepTip's code exists in **HTML, CSS and JavaScript** (the reference) and in **Rust**. Every other framework gets an exact guide instead of code: which primitive of the toolkit implements which part of the specification, in which order, with the pitfalls, so the same behaviour can be rebuilt there. The algorithms all of them share (glossary layers, markup parser, window tree, grace and tendency, placement, input, auto-linking, encyclopedia) are written down once, step by step, in [docs/algorithms.md](docs/algorithms.md).

| Framework | Language | Tier | Kind | Folder |
|---|---|---|---|---|
| Web (HTML + CSS + JavaScript), reference | JavaScript | 1 | code | [frameworks/web](frameworks/web) |
| RPG Maker MZ (plugin) | JavaScript | 1 | code | `frameworks/rpgmaker-mz` |
| Rust (egui) | Rust | 2 | code | `frameworks/rust-egui` |
| TypeScript | TypeScript | 1 | guide, on the web runtime | `frameworks/typescript` |
| Svelte | JavaScript/TypeScript | 1 | guide, on the web runtime | `frameworks/svelte` |
| React | JavaScript/TypeScript | 1 | guide, on the web runtime | `frameworks/react` |
| Vue | JavaScript/TypeScript | 1 | guide, on the web runtime | `frameworks/vue` |
| Blazor | C# | 1 | guide, on the web runtime | `frameworks/blazor` |
| Avalonia | C# | 1 | guide | `frameworks/avalonia` |
| Unity (uGUI + TextMeshPro) | C# | 1 | guide | `frameworks/unity` |
| Valheim (BepInEx mod "DeepTip") | C# | 1 | guide; the mod's source: [gorduan/Valheim_DeepTip](https://github.com/gorduan/Valheim_DeepTip) | [frameworks/valheim](frameworks/valheim) |
| Godot 4 | GDScript | 1 | guide | `frameworks/godot` |
| Python (PySide6 / Qt) | Python | 1 | guide | `frameworks/python-pyside6` |
| Java (Swing) | Java | 2 | guide | `frameworks/java-swing` |
| Kotlin (Compose Desktop) | Kotlin | 2 | guide | `frameworks/kotlin-compose` |
| C++ (Dear ImGui) | C++ | 2 | guide | `frameworks/cpp-imgui` |
| C++ (Unreal Engine) | C++ | 2 | guide | `frameworks/cpp-unreal` |
| Swift (SwiftUI) | Swift | 2 | guide | `frameworks/swift-swiftui` |
| Go (Gio) | Go | 2 | guide | `frameworks/go-gio` |

Tier 1 covers the most used platforms, tier 2 follows. Every folder has a README and a manifest `deeptip.json` (`kind`: `runtime`, `adapter` or `guide`, plus its `status`). Code folders have an example that uses the shared example glossary (`glossary/example/`) and tests against the shared cases (`test/cases/`); every guide says how to run those cases in its language. Downloads: `DeepTip-<framework>-<version>.zip` on the releases page, one per framework, built by `npm run package`; each contains the framework folder, `SPEC.md`, `docs/algorithms.md`, the schema, the glossaries and the test cases.

### Quick start on the web

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.css" />
<button data-deeptip="shop.cart">Cart</button>
<script type="module">
  import { DeepTip } from "https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.js";
  DeepTip.init({ locale: "en", sources: ["/deeptip/{locale}.json"] });
</script>
```

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "shop.cart": {
    "title": "Cart",
    "short": "Items you are about to order.",
    "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**."
  }
}
```

More in [frameworks/web/README.md](frameworks/web/README.md).

## For language models and coding agents

DeepTip is meant to be known and used by every assistant:

| File | For |
|---|---|
| [llms.txt](llms.txt) | the compact entry point for language models ([llms.txt proposal](https://llmstxt.org/)) |
| [AGENTS.md](AGENTS.md) | instructions for coding agents ([AGENTS.md format](https://agents.md/)): add DeepTip to a project, port it to a framework |
| [docs/prompt.md](docs/prompt.md) | a one-page briefing to paste into any chat or system prompt |
| [skill/SKILL.md](skill/SKILL.md) | a skill for Claude Code |

## The schema for every runtime

| File | Purpose |
|---|---|
| [SPEC.md](SPEC.md) | the contract, runtime-neutral: data format (§2), behaviour (§3), placement (§4), input (§5), accessibility (§6), options (§7), styling hooks (§8), porting checklist (§9) |
| [docs/algorithms.md](docs/algorithms.md) | the exact algorithms of the reference, language-neutral pseudo-code: what every guide builds on |
| [schema/deeptip.schema.json](schema/deeptip.schema.json) | JSON Schema for glossary files; reference it with `$schema` |
| [tools/deeptip-check.mjs](tools/deeptip-check.mjs) | validator (Node 18+): broken links, missing translations, too long `short` lines, unused entries, keys used in code but not defined; exit code 1 on errors |
| [test/cases/](test/cases) | parity cases for the markup parser, placement and glossary flattening, shared by every runtime |
| `glossary/core/`, `glossary/example/` | shared core glossary and the example glossary, English and German |
| [CONCEPT.md](CONCEPT.md) | research on the Paradox games and the decisions behind DeepTip (German) |

## Development

```bash
npm test          # reference runtime against test/cases
npm run check     # validate the core and example glossaries
npm run demo      # then http://localhost:5560/frameworks/web/example/
npm run package   # one download per framework into dist/
```

## License

MIT, see [LICENSE](LICENSE). Gorduan Community (GC): free for anyone to use, modify and re-upload.
