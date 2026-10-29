# DeepTip

> **DeepTip** is a UI design pattern: explanation windows with depth. Rest on an element and a window explains it. Highlighted terms inside open further windows, a click pins them, and pinned windows contain terms again, so you can read as deep as you like, the way Paradox Interactive's games (Crusader Kings III, Victoria 3, Europa Universalis V) explain their mechanics. The content is data: one JSON glossary per language.

Other names for the same thing: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips, tooltips in tooltips, Erklärfenster. Deutsch: [README.de.md](README.de.md).

This repository is the home of the pattern: the specification, the data format with its schema and validator, shared test cases, and one implementation per framework, each in its own folder with its own download.

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

| Framework | Language | Tier | Folder |
|---|---|---|---|
| Web (HTML + JavaScript), reference | JavaScript | 1 | [frameworks/web](frameworks/web) |
| TypeScript | TypeScript | 1 | `frameworks/typescript` |
| Svelte | JavaScript/TypeScript | 1 | `frameworks/svelte` |
| React | JavaScript/TypeScript | 1 | `frameworks/react` |
| Vue | JavaScript/TypeScript | 1 | `frameworks/vue` |
| RPG Maker MZ (plugin) | JavaScript | 1 | `frameworks/rpgmaker-mz` |
| Blazor | C# | 1 | `frameworks/blazor` |
| Avalonia | C# | 1 | `frameworks/avalonia` |
| Unity (uGUI + TextMeshPro) | C# | 1 | `frameworks/unity` |
| Valheim (BepInEx mod, Thunderstore "DeepTip") | C# | 1 | `frameworks/valheim` |
| Godot 4 | GDScript | 1 | `frameworks/godot` |
| Python (PySide6 / Qt) | Python | 1 | `frameworks/python-pyside6` |
| Java (Swing) | Java | 2 | `frameworks/java-swing` |
| Kotlin (Compose Desktop) | Kotlin | 2 | `frameworks/kotlin-compose` |
| C++ (Dear ImGui) | C++ | 2 | `frameworks/cpp-imgui` |
| C++ (Unreal Engine, UMG) | C++ | 2 | `frameworks/cpp-unreal` |
| Rust (egui) | Rust | 2 | `frameworks/rust-egui` |
| Swift (SwiftUI) | Swift | 2 | `frameworks/swift-swiftui` |
| Go (Gio) | Go | 2 | `frameworks/go-gio` |

Tier 1 frameworks are built and tested here; tier 2 follow, each marked with its state in its `deeptip.json`. Every framework has a README (install, minimal code, API), an example that uses the same example glossary (`glossary/example/`), and passes the shared test cases where it has its own parser or placement. Downloads: `DeepTip-<framework>-<version>.zip` on the releases page, built by `npm run package`.

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
