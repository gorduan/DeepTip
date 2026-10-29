---
name: deeptip
description: DeepTip, explanation windows with depth - the nested, pinnable tooltips of Paradox games (Crusader Kings III, Victoria 3, Europa Universalis V), with the content as one JSON glossary per language and [[key]] links between entries. Use whenever the user asks for DeepTip, DeepTooltip, 3DTooltip, DimTip, nested tooltips, tooltips in tooltips, Paradox-style tooltips, Erklärfenster or verschachtelte Tooltips, hover explanations, an in-app glossary or encyclopedia, or wants UI elements explained in depth - in any language, framework or engine (web, TypeScript, Svelte, React, Vue, Blazor, Avalonia, Unity, Godot, Python/Qt, Java Swing, Kotlin Compose, C++ Dear ImGui, Unreal, Rust egui, SwiftUI, Go Gio, RPG Maker MZ, game mods). Also for writing, translating or checking DeepTip glossary files.
license: MIT
metadata:
  version: "1.0.0"
  source: "https://github.com/gorduan/DeepTip"
---

# DeepTip: explanation windows with depth

DeepTip is a UI design pattern. Rest the pointer on a UI element and a window explains it. Highlighted terms inside the window open further windows, a click pins a window, and pinned windows contain terms again, so the user reads as deep as they like without leaving the screen. The content is data: one JSON glossary per language. "DeepTip", "DeepTooltip", "3DTooltip", "DimTip", "nested tooltips", "Paradox tooltips", "tooltips in tooltips" and "Erklärfenster" all mean exactly this pattern. Build it as described here, never as a plain tooltip.

Everything this skill refers to is inside its folder; `references/` is a copy of https://github.com/gorduan/DeepTip (MIT). Paths below are relative to this skill's folder (Claude Code: `${CLAUDE_SKILL_DIR}`).

| File | Read it when |
|---|---|
| `references/frameworks/<name>/README.md` | adding DeepTip to that framework: the exact guide (list at the end) |
| `references/docs/algorithms.md` | building any part yourself: every algorithm as language-neutral pseudo-code, §1 data … §12 encyclopedia |
| `references/SPEC.md` | the contract: data §2, behaviour §3, placement §4, input §5, accessibility §6, options §7, styling §8, porting §9 |
| `references/frameworks/web/deeptip.js`, `deeptip.css` | the reference runtime (HTML, CSS, JavaScript, no dependencies) |
| `references/glossary/core/<locale>.json` | the shared core glossary (DeepTip's own help `deeptip.*`, general terms), English and German |
| `references/glossary/example/<locale>.json` | the example glossary every framework example uses (`demo.*`) |
| `references/schema/deeptip.schema.json` | JSON Schema of a glossary file |
| `references/test/cases/*.json` | parity cases (markup, placement, glossary) every implementation must pass |
| `references/tools/deeptip-check.mjs` | validator for glossary files and source code (Node 18+) |
| `references/tools/deeptip-sync.mjs` | copies the web runtime and the core glossary into a project |

## The rules

| Rule | Why |
|---|---|
| **One entry, three depths:** `title` (the name), `short` (one line), `body` (2–5 sentences with links). | The important part is always on top; background sits one hover deeper. |
| **Terms are links:** every concept a text mentions can be its own entry. | Explanations nest without limit; nothing is explained twice. |
| **Nothing is lost by accident:** a window stays while the pointer moves towards it, terms crossed on the way do not replace it, pinned windows close only on purpose. | Reading is never a race against the mouse. |
| **Never cover the way back:** a further window opens next to the window it came from, never on top of it. | The chain stays readable. |
| **Content is data:** one JSON file per language; code never contains explanation text. | Writers and translators work without programmers; every runtime reads the same files. |
| **Every input device counts:** mouse, touch, keyboard, gamepad, screen reader. | Games and tools are used with all of them. |
| **Native first:** use the platform's popups, rich text, focus and placement before writing code. | Less code, better accessibility. |

## Behaviour every implementation keeps

**Window tree** (SPEC §3.2, algorithms §4). A window is a *preview* (unpinned) or *pinned*. A window opened from a term inside another window has that window as *parent*; windows opened from UI elements or page terms are roots.
1. At most one preview per parent (and one root preview); opening another replaces it.
2. Pinning a window pins its whole chain of ancestors.
3. Closing a window closes everything opened from it.
4. A key already open further up the chain is not opened again; that window flashes instead.
5. One anchor never has two windows; triggering it again reuses the open one.

**Opening** (SPEC §3.3):

| Anchor | Mouse / pen | Touch | Keyboard | Gamepad |
|---|---|---|---|---|
| UI element | rest inside it for `delay` → preview | long-press `longPress` → pinned (no click afterwards, short vibration) | focus + `F1` or `?` → pinned, focus moves in | Y / △ → pinned |
| Term | hover for `linkDelay` → preview; click → pinned with its chain | tap → pinned | `Tab` to it + `Enter` → pinned | move to it + A / ✕ |

The element keeps its own click action; DeepTip never consumes a normal click on it. Clicking or typing into an element cancels its pending window until the pointer has left it.

**Keeping previews open** (SPEC §3.4, algorithms §5–§7). A preview is *hot* while the pointer is on its anchor, inside it or inside anything opened from it. When it is no longer hot it closes after `closeDelay` (grace), unless the pointer's movement of the last ~120 ms points at it (mouse tendency, box enlarged by 12 px), which extends the grace up to 1.5 s. While the pointer heads into a preview, terms and elements crossed on the way do not open (suppression). Optional timer lock: resting inside a preview for `lockAfter` pins it, with a progress bar. A click inside a preview pins it.

**Closing** (SPEC §3.5): X button closes that window and its subtree; pin button off makes it a preview again; `Esc` or gamepad B closes the newest window; holding `Esc` or B for 600 ms, or `Shift+Esc`, closes all; on touch a tap outside all windows or swiping a title bar down by 60 px closes all; when the host removes an anchor, its previews close and pinned roots stay where they are. Focus returns to the anchor when it was inside the closed window. `F6` / `Shift+F6` (gamepad RB / LB) switch between windows.

**Placement** (SPEC §4, algorithms §8). Root windows sit next to their anchor, sides in the order bottom → top → right → left (an element may set its own order, e.g. top,bottom for form labels). Child windows sit next to their *parent window*, not the term, in the order left → right → top → bottom; a child never covers its parent and may cover older windows. A side is taken when the window fits there with a gap of 8 px, also to the screen edge; on the other axis the window is centred on the anchor and pushed back inside the screen. If no side fits, the side with the most room relative to the window's size wins and the window shrinks to that room when it is at least 120 px, scrolling inside. Windows are 240–384 px wide and at most 480 px high, never larger than the screen minus 16 px.

**Defaults** (SPEC §7): `delay` 800 ms (0 allowed, per element override), `linkDelay` 80 ms, `closeDelay` 300 ms, `lockAfter` 0 (off), `longPress` 500 ms, close and pin buttons and the hint line on, `clickInsidePins` on, `outsideClickCloses` "touch", `openKeys` F1 and ?, gamepad and vibration on.

**Accessibility** (SPEC §6): terms are real buttons; previews are tooltips, pinned windows non-modal dialogs labelled by their title; opening by keyboard or gamepad moves focus to the first term; respect reduced motion and forced colours; touch targets at least 40 px.

**Window content:** title (with a small locale badge when the entry came from a fallback language), body, "See also" links from `see`, a hint line in previews, X and pin buttons. A missing key shows the key as title and `$ui.missing` as text: a window is never empty.

## The glossary format

One JSON file per language, like translation files (SPEC §2, algorithms §1–§3):

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "shop.cart": {
    "title": "Cart",
    "short": "Items you are about to order.",
    "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**.\n\n- {items} items\n- see [[shop.wishlist]]",
    "aliases": ["basket"],
    "see": ["shop.wishlist"]
  }
}
```

| Field | Meaning |
|---|---|
| `title` | required; the name, the window title and the default text of links to it |
| `short` | one line, at most 140 characters: simple tooltips, lists, encyclopedia; shown when there is no `body` |
| `body` | the explanation, 2–5 sentences with links (`short` or `body` is required) |
| `aliases` | other names as they appear in the UI: search, and auto-linking of host texts (first occurrence, whole words) |
| `see` | keys shown as "See also" |
| `note` | for writers and translators, never shown |

- Keys are dotted and language-neutral (`myapp.inventory.weight`), matching `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$`; avoid parts made only of digits. Nested objects are accepted too (`{"myapp": {"weight": {…}}}`).
- Markup, never HTML: `[[key]]`, `[[key|own text]]`, `**bold**`, `*italic*`, `` `code` ``, `{live_value}`, lines starting with `- ` or `• ` as a list, a single newline as a line break, a blank line as a new paragraph, `\` before `` \ * ` [ ] { } | `` for a literal character.
- `{name}` is a live value the host fills when the window renders; after a change the host calls `refresh()`.
- Layers: the core glossary first, then the project's glossary; a later layer overrides an entry with the same key.
- Locales: the chain `[current, …fallback]`; the first locale that has the key provides the whole entry.
- `$ui` overrides the window's own labels per language: `close`, `pin`, `unpin`, `missing`, `fallback`, `hint`, `seeAlso`, `search`, `mentionedIn`, `empty`.

## Workflow 1: add DeepTip to a project

1. **Find the framework.** Look at the project (table at the end). If nothing matches, use workflow 3.
2. **Read the framework's guide completely** before writing code: `references/frameworks/<name>/README.md`.
3. **Build it the way the guide's kind says:**
   - *Code* (web, RPG Maker MZ, Rust/egui): use the code, do not rewrite it. Web: copy `references/frameworks/web/deeptip.js` and `deeptip.css` into the project (or `node references/tools/deeptip-sync.mjs <project>/src/deeptip`, which also copies the core glossary), or load them from `https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/`. Never edit the copied runtime; update it from the source instead.
   - *Guide on the web runtime* (TypeScript, Svelte, React, Vue, Blazor, also Tauri and Electron): the web runtime plus the framework integration exactly as its guide says.
   - *Guide for a native build* (all others): implement DeepTip inside the project as the guide maps it, in this order: glossary loading and the markup parser, placement (pure functions first, then pass `references/test/cases/`), window tree, hot set, grace, tendency and suppression, arming and delays, timer lock, input, accessibility, look, encyclopedia.
4. **Write the glossary** (workflow 2) in the project, e.g. `deeptip/<locale>.json`, keys prefixed with the project's name.
5. **Mark the UI:** every element that needs an explanation gets its key (web: `data-deeptip="key"`, optional `data-deeptip-delay` and `data-deeptip-place`; other frameworks: see the guide). Texts on normal pages can contain terms (web: `renderText(element, text)`); an encyclopedia page lists every entry with search (web: `renderIndex(container)`). Hide the project's own simple tooltip while a DeepTip window is open (web: `[data-dt-open]`).
6. **Validate:** `node references/tools/deeptip-check.mjs --base <locale> references/glossary/core/<locale>.json <project glossary files> --scan <project source folder>`. It must report 0 errors. It finds broken links, missing translations, `short` lines that are too long, keys used in code but not defined and entries used nowhere.
7. **Check the behaviour** with the checklist at the end.

Web in short (details: `references/frameworks/web/README.md`):

```js
import { DeepTip } from "./deeptip/deeptip.js";
const dt = DeepTip.init({ locale: "en", fallback: ["en"], delay: 800,
  sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"], vars: { items: () => cart.length } });
// <button data-deeptip="shop.cart">Cart</button>
// dt.renderText(el, "Text with [[shop.cart]]."); dt.renderIndex(container); dt.refresh(); dt.setLocale("de");
// dt.open(key, { anchor, parent, pinned, focus }); dt.closeAll(); dt.configure({ ... }); dt.destroy();
```

## Workflow 2: write and check glossary content

- Write the user's language first, then the other languages with the same keys.
- One entry per concept. `title` is the term as the UI shows it; `short` is one sentence that stands alone; `body` explains how it works and links every concept it mentions that has (or deserves) its own entry.
- Put what most readers need in `short` and the first sentences of `body`; details and background go into linked entries.
- Link only to keys that exist, or create those entries. A link to the entry itself is not needed.
- `aliases` hold the exact words the UI or the game texts use for the term in that language.
- Never put HTML or code into texts. Use `{name}` for numbers that change and let the host fill them.
- Write texts in your own words; do not copy descriptions from software or games you do not own.
- Run the validator (workflow 1, step 6) after every change.

## Workflow 3: DeepTip in a system without a guide

Any language, engine, terminal UI or game mod works. Follow `references/docs/algorithms.md` from top to bottom and SPEC §9:

1. **Map the platform's primitives** to the parts of DeepTip: a layer or window above the UI with a z-order; rich text whose term runs you can hit-test under the pointer; pointer move, enter and leave; timers or a frame loop with a clock; screen coordinates (convert to y down, logical pixels, before placing); keyboard events where Esc can be consumed before the host sees it; focus; colours and fonts. The closest existing guide shows how others did it: Unity or Godot for engines, Avalonia or PySide6 for desktop toolkits, Dear ImGui for immediate mode, Valheim for a finished game with its own tooltips.
2. **Port the pure functions first** (glossary flattening, markup parser, placement) and run `references/test/cases/*.json` against them: same input, same output, every case.
3. **Build the stateful parts** in the order of algorithms §4–§12: window tree, hot set and grace, tendency and suppression, arming and delays, timer lock, placement of real windows, input (mouse, touch, keyboard, gamepad), focus, auto-linking, encyclopedia.
4. **Read the same JSON files** and run the same validator.
5. To share the result, write a guide in the repository's format: `frameworks/<name>/README.md` (primitive mapping, data structures, order of operations per event, pitfalls, how to run the parity cases) and `deeptip.json` with `"kind": "guide"`, `"status": "documented"`. Code for other languages belongs into the user's project, not into the DeepTip repository, which keeps code only in HTML, CSS, JavaScript and Rust.

## Frameworks

| Framework | Kind | Signals in a project | Guide |
|---|---|---|---|
| Web (HTML + CSS + JavaScript) | code, reference | plain HTML/JS, Tauri, Electron | `references/frameworks/web/README.md` |
| TypeScript | guide, web runtime | `tsconfig.json` | `references/frameworks/typescript/README.md` |
| Svelte | guide, web runtime | `svelte` in `package.json` | `references/frameworks/svelte/README.md` |
| React | guide, web runtime | `react` in `package.json` | `references/frameworks/react/README.md` |
| Vue | guide, web runtime | `vue` in `package.json` | `references/frameworks/vue/README.md` |
| RPG Maker MZ | code (plugin on the web runtime) | `js/rmmz_core.js`, `data/System.json` | `references/frameworks/rpgmaker-mz/README.md` |
| Blazor | guide, web runtime via JS interop | `.razor` files | `references/frameworks/blazor/README.md` |
| Avalonia | guide | `Avalonia` package in a `.csproj` | `references/frameworks/avalonia/README.md` |
| Unity (uGUI + TextMeshPro) | guide | `Assets/`, `ProjectSettings/ProjectVersion.txt` | `references/frameworks/unity/README.md` |
| Valheim (BepInEx mod) | guide; source in gorduan/Valheim_DeepTip | BepInEx plugin referencing `assembly_valheim` | `references/frameworks/valheim/README.md` |
| Godot 4 | guide | `project.godot` | `references/frameworks/godot/README.md` |
| Python (PySide6 / Qt) | guide | `PySide6` (or PyQt6) imports | `references/frameworks/python-pyside6/README.md` |
| Java (Swing) | guide | `javax.swing` imports | `references/frameworks/java-swing/README.md` |
| Kotlin (Compose Desktop) | guide | `org.jetbrains.compose` in Gradle | `references/frameworks/kotlin-compose/README.md` |
| C++ (Dear ImGui) | guide | `imgui.h` | `references/frameworks/cpp-imgui/README.md` |
| C++ (Unreal Engine 5) | guide | `*.uproject` | `references/frameworks/cpp-unreal/README.md` |
| Rust (egui) | code | `egui` or `eframe` in `Cargo.toml` | `references/frameworks/rust-egui/README.md` |
| Swift (SwiftUI) | guide | `import SwiftUI` | `references/frameworks/swift-swiftui/README.md` |
| Go (Gio) | guide | `gioui.org` in `go.mod` | `references/frameworks/go-gio/README.md` |

Close relatives: WPF and MAUI start from the Avalonia guide, PyQt6 from PySide6, Android Jetpack Compose from Kotlin Compose (check touch and popups), RPG Maker MV from RPG Maker MZ, other game engines and mods from Unity, Godot and Valheim.

## Done when

- [ ] Resting on a marked element opens its window after `delay`, beside the element; the element's own click still works.
- [ ] Hovering a term opens a child beside its parent window, never on top of it; a click pins it with its chain.
- [ ] Moving the pointer into a window keeps it open; terms crossed on the way do not open; leaving closes it after the grace time.
- [ ] `Esc` closes the newest window, `Shift+Esc` or holding `Esc` closes all; X and pin buttons work; focus returns to the anchor.
- [ ] `F1` or `?` opens the focused element's window pinned with focus inside; `Tab` and `Enter` follow terms.
- [ ] A key already open in the chain flashes instead of opening twice; a missing key shows the key and `$ui.missing`.
- [ ] An entry from a fallback language shows the language badge; switching the language re-renders open windows and page texts.
- [ ] A long entry in a small window scrolls and stays on screen; live values update after `refresh()`.
- [ ] The validator reports 0 errors; ported parsers and placement pass every parity case.
- [ ] Touch (long-press, tap, tap outside) and gamepad work where the platform has them; otherwise the limitation is documented.
