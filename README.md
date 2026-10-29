# DeepTip

![Three DeepTip windows side by side: "Stability" explains a value and links "unrest", "Unrest" opened beside it links "revolt", and "Revolt" is still a preview](docs/images/deeptip-windows.png)

**DeepTip answers "what does this mean?" right where the user is looking.** Rest the mouse on a button, a value or a word, and a small window explains it. Highlighted words in that window have explanations of their own: move the mouse onto one and the next window opens beside the first, click and it stays. Users read as deep as they need, and no window ever covers the one it came from. Paradox Interactive's strategy games (Crusader Kings III, Victoria 3, Europa Universalis V) teach their rules this way; DeepTip brings the same pattern to any app, game or tool, in any language.

Deutsch: [README.de.md](README.de.md) · Releases and downloads: [v1.0.0](https://github.com/gorduan/DeepTip/releases/tag/v1.0.0)

## What it is

| An ordinary tooltip | A DeepTip |
|---|---|
| one line of text, gone as soon as the mouse moves | a window you can move into, read, pin and close |
| every tooltip stands alone | terms inside open further windows, as deep as you like |
| the text sits in the program code | the texts sit in one JSON file per language, like translations |
| mouse only | mouse, touch, keyboard, gamepad and screen readers |

- **For users:** no manual, no wiki tab, no tutorial. The explanation of a term is one hover away, and so is the explanation of every term inside it.
- **For developers:** mark an element with a key. DeepTip opens, places, chains, pins and closes the windows.
- **For writers and translators:** every text lives in JSON glossaries. An entry has a `title`, a one-line `short` and a `body` with `[[links]]` to other entries. A validator finds broken links and missing translations.

A good fit wherever users meet many concepts that depend on each other: games and simulations, professional tools, dashboards, settings screens, onboarding without tutorials.

Other names for the same idea: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips, tooltips in tooltips, Erklärfenster.

## Use it in your project

### The easiest way: let your AI coding agent do it

This works for every language and framework.

1. Install the DeepTip skill once. It teaches the agent the whole pattern and carries every guide:

   ```bash
   git clone --depth 1 https://github.com/gorduan/DeepTip
   mkdir -p ~/.claude/skills ~/.agents/skills
   cp -r DeepTip/skill/deeptip ~/.claude/skills/   # Claude Code
   cp -r DeepTip/skill/deeptip ~/.agents/skills/   # OpenAI Codex, GitHub Copilot, Cursor, Gemini CLI
   ```

   For claude.ai, upload `DeepTip-skill-1.0.0.zip` from the releases under *Customize → Skills*. All agents and paths: [skill/README.md](skill/README.md).
2. Open your project and ask: *"Add DeepTip to this project and explain the main screen."* The agent recognises your framework, follows its guide, writes the glossary in your language, marks the elements and checks everything with the validator.

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

Rest the mouse on the button: the cart window opens, "check out" inside it opens the next one. Every option and the API: [frameworks/web/README.md](frameworks/web/README.md). React, Vue, Svelte, TypeScript, Blazor, Tauri and Electron use the same two files; their guides show where the calls go.

### Any other framework or engine

1. Find your framework in the [table below](#frameworks) and download `DeepTip-<framework>-1.0.0.zip` from the [release](https://github.com/gorduan/DeepTip/releases/tag/v1.0.0), or open its folder.
2. Web, RPG Maker MZ and Rust (egui) come with ready code. For every other framework the guide maps each part of DeepTip to your toolkit, step by step. Together with [docs/algorithms.md](docs/algorithms.md) and the shared test cases you can check that your build behaves exactly like the reference.
3. Not in the list? [docs/algorithms.md](docs/algorithms.md) describes every algorithm without a programming language, and the skill's third workflow walks an agent through a new system.

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

## Frameworks

DeepTip's code exists in **HTML, CSS and JavaScript** (the reference) and in **Rust**. Every other framework has an exact guide: which part of the toolkit implements which part of DeepTip, in which order, and which pitfalls to avoid.

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

Tier 1 covers the most used platforms, tier 2 follows. Every folder has a README and a manifest `deeptip.json` (`kind`: `runtime`, `adapter` or `guide`, plus its `status`). Code folders have an example that uses the shared example glossary (`glossary/example/`) and tests against the shared cases (`test/cases/`); every guide says how to run those cases in its language. Each download `DeepTip-<framework>-<version>.zip` contains the framework folder, `SPEC.md`, `docs/algorithms.md`, the schema, the glossaries and the test cases.

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
