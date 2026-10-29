# DeepTip

[![Release](https://img.shields.io/github/v/release/gorduan/DeepTip)](https://github.com/gorduan/DeepTip/releases) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Agent Skill](https://img.shields.io/badge/AI%20agents-Agent%20Skill-8A2BE2)](skill)

![Three DeepTip windows side by side: "Stability" explains a value and links "unrest", "Unrest" opened beside it links "revolt", and "Revolt" is still a preview](docs/images/deeptip-windows.png)

**DeepTip makes any user interface explain itself, as deep as the user wants.** Rest the mouse on a button, a value or a word, and a small window explains it. Highlighted words in that window have explanations of their own: move onto one and the next window opens beside the first, click and it stays. It is the "tooltips in tooltips" system that Paradox Interactive's strategy games (Crusader Kings III, Victoria 3, Europa Universalis V) use to teach their rules, turned into an open pattern that works in any program, game or tool, in any language.

Deutsch: [README.de.md](README.de.md)

## What this project is for

Modern software and games are full of terms that depend on each other: a value depends on three other values, a rule refers to two other rules. An ordinary tooltip shows one line and disappears; a manual or a wiki is a tab switch away and breaks the flow. DeepTip puts the whole explanation where the user already looks, one hover at a time.

| An ordinary tooltip | A DeepTip |
|---|---|
| one line of text, gone as soon as the mouse moves | a window you can move into, read, pin and close |
| every tooltip stands alone | terms inside open further windows, as deep as you like |
| the text sits in the program code | the texts sit in one JSON file per language, like translations |
| mouse only | mouse, touch, keyboard, gamepad and screen readers |

It is made for anything where people meet many connected concepts: **games and mods** (stats, rules, items), **professional tools** (settings, units, formulas), **dashboards** (what a number means and where it comes from), **configuration screens** and **onboarding without tutorials**.

This repository contains everything you need to use the pattern:

1. **The pattern itself**, written down exactly: the [specification](SPEC.md) and every algorithm as language-neutral pseudo-code in [docs/algorithms.md](docs/algorithms.md).
2. **Ready-made code** in HTML, CSS, JavaScript and Rust.
3. **An exact build guide for every other framework**, step by step, with the pitfalls already found.
4. **An AI skill** that teaches your coding agent all of it, so DeepTip can be added to any project, even in a framework that has no guide yet.
5. **Tools**: a JSON Schema and a validator for the explanation files, and shared test cases that prove an implementation behaves like the reference.

## Works with

**Bold** = ready-made code you copy into your project. The others have an exact step-by-step guide. Each entry links to its folder; each folder is also a separate download on the [releases page](https://github.com/gorduan/DeepTip/releases).

| Area | Frameworks |
|---|---|
| **Web** | **[HTML + CSS + JavaScript](frameworks/web)** (the reference) · [TypeScript](frameworks/typescript) · [React](frameworks/react) · [Vue](frameworks/vue) · [Svelte](frameworks/svelte) · [Blazor](frameworks/blazor) |
| **Desktop** | **[Rust (egui)](frameworks/rust-egui)** · [Avalonia](frameworks/avalonia) · [Python (PySide6 / Qt)](frameworks/python-pyside6) · [Java (Swing)](frameworks/java-swing) · [Kotlin (Compose Desktop)](frameworks/kotlin-compose) · [C++ (Dear ImGui)](frameworks/cpp-imgui) · [Swift (SwiftUI)](frameworks/swift-swiftui) · [Go (Gio)](frameworks/go-gio) |
| **Games, engines, mods** | **[RPG Maker MZ](frameworks/rpgmaker-mz)** · [Unity](frameworks/unity) · [Unreal Engine 5](frameworks/cpp-unreal) · [Godot 4](frameworks/godot) · [Valheim mod](frameworks/valheim) ([released mod](https://github.com/gorduan/Valheim_DeepTip)) |
| **Everything else** | any language, engine or toolkit: your AI agent builds it with the skill from [docs/algorithms.md](docs/algorithms.md) and checks it against the shared test cases |

Every implementation reads the same explanation files, so one glossary serves your web app, your desktop tool and your game.

## Put it anywhere: the DeepTip skill

The [DeepTip skill](skill) teaches an AI coding agent the whole pattern. Install it once, then ask your agent *"Add DeepTip to this project"* in any project, in any language.

```mermaid
flowchart LR
  S["DeepTip skill"] --> A["Your AI agent"]
  A --> D{"Which framework?"}
  D -->|"ready code"| C["copies the runtime<br/>(web, Rust, RPG Maker)"]
  D -->|"guide"| G["follows the exact guide"]
  D -->|"not listed"| N["builds it from the algorithms<br/>and the shared test cases"]
  C --> P["DeepTip in your project,<br/>texts written, checked by the validator"]
  G --> P
  N --> P
```

**What the agent learns:** what DeepTip is and how it must behave (timings, placement, keyboard, touch, gamepad, accessibility), the explanation file format, three workflows (add DeepTip to a project, write and check explanations, build it where no guide exists), every framework guide and a checklist for the result. The skill carries all guides, the specification, the algorithms, the web runtime, the test cases and the validator in its own folder, so it also works offline.

**Which agents:** the skill uses the open [Agent Skills](https://agentskills.io/specification) format, read by **Claude Code, Claude (claude.ai and the desktop app), OpenAI Codex, GitHub Copilot, Cursor and Gemini CLI**.

```bash
git clone --depth 1 https://github.com/gorduan/DeepTip
mkdir -p ~/.claude/skills ~/.agents/skills
cp -r DeepTip/skill/deeptip ~/.claude/skills/   # Claude Code
cp -r DeepTip/skill/deeptip ~/.agents/skills/   # Codex, GitHub Copilot, Cursor, Gemini CLI
```

For claude.ai, upload `DeepTip-skill-<version>.zip` from the [releases](https://github.com/gorduan/DeepTip/releases) under *Customize → Skills*. Every agent, folder and source: [skill/README.md](skill/README.md).

Then, in your project: *"Add DeepTip to this project and explain the main screen."* The agent recognises the framework, follows its guide, writes the explanation files in your language, marks the elements and checks everything with the validator.

## Use it without an agent

### A website or web app: three steps, no build

Save this as a page and open it in the browser:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.css" />

<button data-deeptip="shop.cart">Cart</button>

<script type="module">
  import { DeepTip } from "https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.js";
  DeepTip.init({ locale: "en", delay: 500 }).add("en", {
    "shop.cart": {
      "title": "Cart",
      "short": "Items you are about to order.",
      "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**."
    },
    "shop.checkout": {
      "title": "Checkout",
      "short": "Where you pay and choose delivery.",
      "body": "Confirms the items in your [[shop.cart]] and sends the order."
    }
  });
</script>
```

1. **Load** `deeptip.css` and `deeptip.js` (from the CDN as above, or copy the two files from [frameworks/web](frameworks/web)).
2. **Write the explanations.** In a real project they go into one file per language, `deeptip/en.json`, `deeptip/de.json`, loaded with `DeepTip.init({ locale: "en", sources: ["deeptip/{locale}.json"] })` (served by any web server).
3. **Mark the elements** with `data-deeptip="key"`. Terms in normal page text work too (`renderText`), and one call renders an encyclopedia of every entry (`renderIndex`).

Rest the mouse on the button: the cart window opens, and "check out" inside it opens the next one. Every option and the API: [frameworks/web/README.md](frameworks/web/README.md).

### Any other framework

Open its folder from [Works with](#works-with) or download `DeepTip-<framework>-<version>.zip` from the [releases](https://github.com/gorduan/DeepTip/releases). Each guide starts with what to copy or build and ends with a checklist; [docs/algorithms.md](docs/algorithms.md) and the shared test cases let you prove that your build behaves exactly like the reference.

## Write the explanations

One JSON file per language. Keys are dotted and the same in every language; texts use a small markup, never HTML.

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "game.stability": {
    "title": "Stability",
    "short": "How calm your realm is, from -3 to +3.",
    "body": "High stability lowers [[game.unrest|unrest]] in every province. Currently: **{stability}**.\n\n- lost wars reduce it\n- [[game.prestige]] raises it",
    "see": ["game.revolt"]
  }
}
```

| Markup | Result |
|---|---|
| `[[key]]`, `[[key\|own text]]` | a link to another entry: hover previews it, a click pins it |
| `**bold**`, `*italic*`, `` `code` `` | emphasis and code |
| `{name}` | a live value your program fills in when the window opens |
| lines starting with `- `, a blank line | a list, a new paragraph |

Keep `short` to one line (at most 140 characters), write the `body` in 2–5 sentences and link every concept that has its own entry. Check the files before each release:

```bash
node tools/deeptip-check.mjs --base en deeptip/en.json deeptip/de.json --scan src
```

The full format: [SPEC.md §2](SPEC.md). DeepTip also ships a core glossary with its own help texts (`glossary/core/`, English and German).

## How DeepTip behaves

| Rule | Why |
|---|---|
| **One entry, three depths**: `title` (the name), `short` (one line), `body` (2–5 sentences with links). | The important part is always at the top; background sits one hover deeper. |
| **Terms are links**: every concept a text mentions can be its own entry. | Explanations nest without limit, nothing is explained twice. |
| **Nothing is lost by accident**: a window stays while the pointer moves towards it, terms crossed on the way do not replace it, and pinned windows close only on purpose. | Reading must never be a race against the mouse. |
| **Never cover the way back**: a further window opens next to the one it came from, never on top of it. | The chain stays readable. |
| **Content is data**: one JSON file per language, like translation files; code never contains explanation text. | Writers and translators work without programmers; every runtime uses the same files. |
| **Every input device is first-class**: mouse, touch, keyboard, gamepad, screen reader. | Games and tools are used with all of them. |
| **Native first**: use what the platform offers (popups, rich text, focus) before writing code. | Less code, better accessibility. |

Controls: rest the mouse to open, hover a term to preview it, click to pin; `Esc` closes the newest window, `Shift+Esc` closes all; `F1` or `?` opens the focused element's window; touch opens with a long press; gamepad Y opens, A follows, B closes. The exact behaviour, timings and placement rules: [SPEC.md](SPEC.md).

## All frameworks in detail

| Framework | Language | Tier | Kind | Folder |
|---|---|---|---|---|
| Web (HTML + CSS + JavaScript), reference | JavaScript | 1 | code | [frameworks/web](frameworks/web) |
| RPG Maker MZ (plugin) | JavaScript | 1 | code, plugin on the web runtime | [frameworks/rpgmaker-mz](frameworks/rpgmaker-mz) |
| Rust (egui) | Rust | 2 | code, the second complete implementation | [frameworks/rust-egui](frameworks/rust-egui) |
| TypeScript | TypeScript | 1 | guide, on the web runtime | [frameworks/typescript](frameworks/typescript) |
| Svelte | JavaScript/TypeScript | 1 | guide, on the web runtime | [frameworks/svelte](frameworks/svelte) |
| React | JavaScript/TypeScript | 1 | guide, on the web runtime | [frameworks/react](frameworks/react) |
| Vue | JavaScript/TypeScript | 1 | guide, on the web runtime | [frameworks/vue](frameworks/vue) |
| Blazor | C# | 1 | guide, on the web runtime | [frameworks/blazor](frameworks/blazor) |
| Avalonia | C# | 1 | guide | [frameworks/avalonia](frameworks/avalonia) |
| Unity (uGUI + TextMeshPro) | C# | 1 | guide | [frameworks/unity](frameworks/unity) |
| Valheim (BepInEx mod "DeepTip") | C# | 1 | guide; the mod's source: [gorduan/Valheim_DeepTip](https://github.com/gorduan/Valheim_DeepTip) | [frameworks/valheim](frameworks/valheim) |
| Godot 4 | GDScript | 1 | guide | [frameworks/godot](frameworks/godot) |
| Python (PySide6 / Qt) | Python | 1 | guide | [frameworks/python-pyside6](frameworks/python-pyside6) |
| Java (Swing) | Java | 2 | guide | [frameworks/java-swing](frameworks/java-swing) |
| Kotlin (Compose Desktop) | Kotlin | 2 | guide | [frameworks/kotlin-compose](frameworks/kotlin-compose) |
| C++ (Dear ImGui) | C++ | 2 | guide | [frameworks/cpp-imgui](frameworks/cpp-imgui) |
| C++ (Unreal Engine 5, Slate + UMG) | C++ | 2 | guide | [frameworks/cpp-unreal](frameworks/cpp-unreal) |
| Swift (SwiftUI) | Swift | 2 | guide | [frameworks/swift-swiftui](frameworks/swift-swiftui) |
| Go (Gio) | Go | 2 | guide | [frameworks/go-gio](frameworks/go-gio) |

Every folder has a README and a manifest `deeptip.json` (`kind`: `runtime`, `adapter` or `guide`, plus its `status`). Code folders have an example that uses the shared example glossary (`glossary/example/`) and tests against the shared cases (`test/cases/`); every guide says how to run those cases in its language. Each download `DeepTip-<framework>-<version>.zip` contains the framework folder, `SPEC.md`, `docs/algorithms.md`, the schema, the glossaries and the test cases.

## Reference

| File | Purpose |
|---|---|
| [SPEC.md](SPEC.md) | the contract, runtime-neutral: data format (§2), behaviour (§3), placement (§4), input (§5), accessibility (§6), options (§7), styling hooks (§8), porting checklist (§9) |
| [docs/algorithms.md](docs/algorithms.md) | the exact algorithms of the reference as language-neutral pseudo-code: what every guide builds on |
| [schema/deeptip.schema.json](schema/deeptip.schema.json) | JSON Schema for glossary files; reference it with `$schema` for completion in your editor |
| [tools/deeptip-check.mjs](tools/deeptip-check.mjs) | validator (Node 18+): broken links, missing translations, too long `short` lines, unused entries, keys used in code but not defined; exit code 1 on errors |
| [test/cases/](test/cases) | parity cases for the markup parser, placement and glossary flattening, shared by every runtime |
| `glossary/core/`, `glossary/example/` | the core glossary and the example glossary, English and German |
| [CONCEPT.md](CONCEPT.md) | research on the Paradox games and the decisions behind DeepTip (German) |

## For AI agents and language models

| File | For |
|---|---|
| [skill/](skill) | the Agent Skill that teaches DeepTip to any coding agent, with install notes for each agent |
| [llms.txt](llms.txt) | the compact entry point for language models ([llms.txt proposal](https://llmstxt.org/)) |
| [AGENTS.md](AGENTS.md) | instructions for coding agents working on this repository ([AGENTS.md format](https://agents.md/)) |
| [docs/prompt.md](docs/prompt.md) | a one-page briefing to paste into any chat or system prompt |

## Development

```bash
npm test          # reference runtime against test/cases, skill copy up to date
npm run check     # validate the core and example glossaries
npm run demo      # then http://localhost:5560/frameworks/web/example/
npm run package   # one download per framework, and the skill, into dist/
npm run skill     # refresh skill/deeptip/references after changing the originals
```

## License

MIT, see [LICENSE](LICENSE). Gorduan Community (GC): free for anyone to use, modify and re-upload.
