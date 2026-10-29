---
name: deeptip
description: DeepTip, explanation windows with depth - the nested, pinnable tooltips of Paradox games (Crusader Kings III, Victoria 3, Europa Universalis V), with one JSON glossary per language and [[key]] links between entries. Use whenever the user asks for DeepTip, DeepTooltip, 3DTooltip, DimTip, nested tooltips, tooltips in tooltips, Paradox-style tooltips, Erklärfenster or verschachtelte Tooltips, hover explanations, an in-app glossary or encyclopedia, or wants UI elements explained in depth in any language, framework or engine - web (TypeScript, React, Vue, Svelte, Angular, jQuery, Bootstrap, Blazor, Electron, Tauri, WordPress), desktop (WPF, WinForms, MAUI, Avalonia, Qt, GTK, Swing, JavaFX, Compose, SwiftUI, Tkinter, Kivy, ImGui, egui, Gio), mobile (Flutter, Android, iOS, React Native), games and mods (Unity, Unreal, Godot, Bevy, GameMaker, LÖVE, Ren'Py, Phaser, RPG Maker, Roblox, Minecraft, Valheim) and terminals (Ratatui, Textual, Bubble Tea). Also for writing, translating or checking DeepTip glossary files.
license: MIT
metadata:
  version: "1.1.0"
  source: "https://github.com/gorduan/DeepTip"
---

# DeepTip: explanation windows with depth

DeepTip is a UI design pattern. Rest the pointer on a UI element and a window explains it. Highlighted terms inside the window open further windows, a click pins a window, and pinned windows contain terms again, so the user reads as deep as they like without leaving the screen. The content is data: one JSON glossary per language. "DeepTip", "DeepTooltip", "3DTooltip", "DimTip", "nested tooltips", "Paradox tooltips", "tooltips in tooltips" and "Erklärfenster" all mean exactly this pattern. Build it as described here, never as a plain tooltip.

Everything this skill refers to is inside its folder; `references/` is a copy of https://github.com/gorduan/DeepTip (MIT). Paths below are relative to this skill's folder (Claude Code: `${CLAUDE_SKILL_DIR}`).

| File | Read it when |
|---|---|
| `references/frameworks/<name>/README.md` | adding DeepTip to that framework: the exact guide (list under [Frameworks](#frameworks)) |
| `references/docs/algorithms.md` | building any part yourself: every algorithm as language-neutral pseudo-code, §1 data … §12 encyclopedia |
| `references/SPEC.md` | the contract: data §2, behaviour §3, placement §4, input §5, accessibility §6, options §7, styling §8, porting §9 |
| `references/frameworks/web/deeptip.js`, `deeptip.css` | the reference runtime (HTML, CSS, JavaScript, no dependencies) |
| `references/frameworks/jquery/jquery.deeptip.js`, `phaser/deeptip-phaser.js`, `bootstrap/deeptip-bootstrap.css`, `rpgmaker-mz/js/plugins/DeepTip.js` | the ready adapters on the web runtime: jQuery plugin, Phaser adapter, Bootstrap theme, RPG Maker MZ plugin |
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

1. **Find the framework.** Look at the project (the table under [Frameworks](#frameworks)). If nothing matches, use workflow 3.
2. **Read the framework's guide completely** before writing code: `references/frameworks/<name>/README.md`.
3. **Build it the way the guide's kind says:**
   - *Code* (web, RPG Maker MZ, jQuery, Phaser, Bootstrap theme, Rust egui, Rust Ratatui): use the code, do not rewrite it. Web: copy `references/frameworks/web/deeptip.js` and `deeptip.css` into the project (or `node references/tools/deeptip-sync.mjs <project>/src/deeptip`, which also copies the core glossary), or load them from `https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/`. The adapters (jQuery, Phaser, Bootstrap, RPG Maker MZ) add their one file from `references/frameworks/<name>/` next to the web runtime; the Rust crates are dependencies from the repository, as their guides say. Never edit the copied code; update it from the source instead.
   - *Guide on the web runtime* (TypeScript, Svelte, React, Vue, Angular, Blazor, Electron, Tauri, server-rendered pages): the web runtime plus the framework integration exactly as its guide says. React Native and Qt Quick use only the runtime's pure functions (parser, placement, glossary).
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

1. **Map the platform's primitives** to the parts of DeepTip: a layer or window above the UI with a z-order; rich text whose term runs you can hit-test under the pointer; pointer move, enter and leave; timers or a frame loop with a clock; screen coordinates (convert to y down, logical pixels, before placing); keyboard events where Esc can be consumed before the host sees it; focus; colours and fonts. The closest existing guide shows how others did it: Unity or Godot for engines, LÖVE or GameMaker for a game loop that draws everything itself, Avalonia, WPF or PySide6 for desktop toolkits, Dear ImGui for immediate mode, Flutter or React Native for touch-first apps, Ratatui or Textual for terminals, Phaser for HTML over a canvas, Valheim for a finished game with its own tooltips.
2. **Port the pure functions first** (glossary flattening, markup parser, placement) and run `references/test/cases/*.json` against them: same input, same output, every case.
3. **Build the stateful parts** in the order of algorithms §4–§12: window tree, hot set and grace, tendency and suppression, arming and delays, timer lock, placement of real windows, input (mouse, touch, keyboard, gamepad), focus, auto-linking, encyclopedia.
4. **Read the same JSON files** and run the same validator.
5. To share the result, write a guide in the repository's format: `frameworks/<name>/README.md` (primitive mapping, data structures, order of operations per event, pitfalls, how to run the parity cases) and `deeptip.json` with `"kind": "guide"`, `"status": "documented"`. Code for other languages belongs into the user's project, not into the DeepTip repository, which keeps code only in HTML, CSS, JavaScript and Rust.

## Frameworks

<!-- generated:framework-table -->
| Framework | Kind | Signals in a project | Guide |
|---|---|---|---|
| Web (HTML + CSS + JavaScript) | code, the reference | HTML pages with plain JavaScript and no UI framework | `references/frameworks/web/README.md` |
| Bootstrap 5 | code, adapter on the web runtime | `bootstrap` in `package.json`, or `bootstrap.min.css` / `bootstrap.bundle.min.js` in the pages | `references/frameworks/bootstrap/README.md` |
| jQuery (plugin) | code, adapter on the web runtime | `jquery` in `package.json`, or a `<script src="…jquery….js">` tag in the pages | `references/frameworks/jquery/README.md` |
| Angular | guide, on the web runtime | `angular.json` at the project root, `@angular/core` in `package.json` | `references/frameworks/angular/README.md` |
| Blazor | guide, on the web runtime | `.razor` files | `references/frameworks/blazor/README.md` |
| Electron | guide, on the web runtime | `electron` in the `devDependencies` of `package.json`, a main script that creates a `BrowserWindow` | `references/frameworks/electron/README.md` |
| React | guide, on the web runtime | `react` and `react-dom` in `package.json`, `.jsx` or `.tsx` files | `references/frameworks/react/README.md` |
| Server-rendered HTML (WordPress, Laravel, Django, Rails, ASP.NET, static sites) | guide, on the web runtime | `wp-config.php` or `wp-content/` (WordPress), `artisan` and `resources/views/*.blade.php` (Laravel) | `references/frameworks/server-html/README.md` |
| Svelte | guide, on the web runtime | `svelte` in `package.json` and `.svelte` files | `references/frameworks/svelte/README.md` |
| Tauri 2 | guide, on the web runtime | `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` with `tauri = "2…"` | `references/frameworks/tauri/README.md` |
| TypeScript | guide, on the web runtime | `tsconfig.json` and `typescript` in `package.json` | `references/frameworks/typescript/README.md` |
| Vue | guide, on the web runtime | `vue` in `package.json` and `.vue` files | `references/frameworks/vue/README.md` |
| Rust (egui) | code, a complete implementation | `egui` or `eframe` in `Cargo.toml` | `references/frameworks/rust-egui/README.md` |
| .NET MAUI | guide | a `.csproj` with `<UseMaui>true</UseMaui>` and target frameworks such as `net10.0-android;net10.0-ios;net10.0-maccatalyst;net10.0-windows10.0.19041.0` | `references/frameworks/dotnet-maui/README.md` |
| Avalonia | guide | a `.csproj` that references the `Avalonia` package, `.axaml` files and an `App.axaml` | `references/frameworks/avalonia/README.md` |
| C++ (Qt 6: Widgets and Qt Quick) | guide, on the web runtime | `find_package(Qt6 … COMPONENTS Widgets)` or `… Quick` with `qt_add_executable` / `qt_add_qml_module` in `CMakeLists.txt` | `references/frameworks/qt/README.md` |
| Python (PySide6 / Qt) | guide | `PySide6` in `requirements.txt` or `pyproject.toml` and `from PySide6.QtWidgets import …` in the code | `references/frameworks/python-pyside6/README.md` |
| Windows Forms | guide | a `.csproj` with `<UseWindowsForms>true</UseWindowsForms>` and a Windows target framework | `references/frameworks/winforms/README.md` |
| WPF | guide | a `.csproj` with `<UseWPF>true</UseWPF>` and a Windows target framework | `references/frameworks/wpf/README.md` |
| C++ (Dear ImGui) | guide | `imgui.h` and `ImGui::NewFrame()` in the render loop | `references/frameworks/cpp-imgui/README.md` |
| Go (Gio) | guide | `gioui.org` in `go.mod` | `references/frameworks/go-gio/README.md` |
| GTK 4 (C, PyGObject, gtk-rs) | guide | `dependency('gtk4')` in `meson.build` or `pkg_check_modules(… gtk4)` in CMake | `references/frameworks/gtk/README.md` |
| Java (JavaFX) | guide | `org.openjfx` dependencies or the `org.openjfx.javafxplugin` Gradle plugin / `javafx-maven-plugin` | `references/frameworks/javafx/README.md` |
| Java (Swing) | guide | `import javax.swing.*` and windows built from `JFrame` and `JComponent`s, Java 17 or newer | `references/frameworks/java-swing/README.md` |
| Kotlin (Compose Desktop) | guide | the `org.jetbrains.compose` plugin and a `compose.desktop` block in `build.gradle.kts` | `references/frameworks/kotlin-compose/README.md` |
| Python (Kivy) | guide | `kivy` in `requirements.txt` or `pyproject.toml` | `references/frameworks/python-kivy/README.md` |
| Python (Tkinter) | guide | `import tkinter`, a `tk.Tk()` root and `mainloop()` in the Python sources | `references/frameworks/python-tkinter/README.md` |
| Swift (SwiftUI) | guide | `import SwiftUI` and an `@main` struct conforming to `App`, in an Xcode project or a `Package.swift` | `references/frameworks/swift-swiftui/README.md` |
| Android (Jetpack Compose) | guide, on the Kotlin (Compose Desktop) guide | a `build.gradle.kts` applying `com.android.application` and `org.jetbrains.kotlin.plugin.compose` | `references/frameworks/android-compose/README.md` |
| Flutter | guide | `pubspec.yaml` with `flutter: sdk: flutter` under `dependencies`, `lib/main.dart` calling `runApp` | `references/frameworks/flutter/README.md` |
| iOS and iPadOS (UIKit) | guide, on the Swift (SwiftUI) guide | an `.xcodeproj` or `.xcworkspace`, Swift files with `import UIKit` | `references/frameworks/ios-uikit/README.md` |
| React Native | guide, on the web runtime | `react-native` in the `dependencies` of `package.json`, `index.js` calling `AppRegistry.registerComponent` | `references/frameworks/react-native/README.md` |
| RPG Maker MZ (plugin) | code, adapter on the web runtime | `js/rmmz_core.js` and `js/plugins.js` beside `data/System.json`, the folder of an RPG Maker MZ project | `references/frameworks/rpgmaker-mz/README.md` |
| Phaser 3/4 (adapter) | code, adapter on the web runtime | `phaser` in `package.json` or a `phaser.min.js` script in the page | `references/frameworks/phaser/README.md` |
| Godot 4 | guide | `project.godot` with `.gd` scripts and `.tscn` scenes | `references/frameworks/godot/README.md` |
| Unity (uGUI + TextMeshPro) | guide | `Assets/`, `ProjectSettings/ProjectVersion.txt` and `com.unity.ugui` in `Packages/manifest.json` | `references/frameworks/unity/README.md` |
| Unity (UI Toolkit) | guide | `Assets/` and `ProjectSettings/ProjectVersion.txt`, `.uxml` and `.uss` files | `references/frameworks/unity-uitoolkit/README.md` |
| Valheim (BepInEx mod) | guide; source: gorduan/Valheim_DeepTip | a BepInEx plugin whose `.csproj` references `assembly_valheim.dll` | `references/frameworks/valheim/README.md` |
| Bevy (Rust) | guide, on Rust (egui) | a `Cargo.toml` that depends on `bevy`, a `src/main.rs` that builds an `App::new()` with `DefaultPlugins` | `references/frameworks/bevy/README.md` |
| C++ (Unreal Engine 5, Slate + UMG) | guide | a `*.uproject` file with C++ modules in `Source/<Module>/` | `references/frameworks/cpp-unreal/README.md` |
| GameMaker (GML) | guide | a `<name>.yyp` project file with `objects/<name>/<name>.yy`, `scripts/` and `rooms/` folders | `references/frameworks/gamemaker/README.md` |
| LÖVE (Lua) | guide | a `main.lua` at the game root that defines `love.load`, `love.update` and `love.draw` | `references/frameworks/love2d/README.md` |
| Minecraft (Fabric mod) | guide | `src/main/resources/fabric.mod.json`, a `build.gradle` with the plugin `net.fabricmc.fabric-loom` | `references/frameworks/minecraft-fabric/README.md` |
| Ren'Py | guide | a `game/` folder with `*.rpy` scripts and compiled `*.rpyc` | `references/frameworks/renpy/README.md` |
| Roblox (Luau) | guide | a place file (`*.rbxl`, `*.rbxlx`) or a Rojo project | `references/frameworks/roblox/README.md` |
| Rust (Ratatui, terminal) | code, adapter on Rust (egui) | `ratatui` in `Cargo.toml`, a loop around `terminal.draw(\|frame\| …)` | `references/frameworks/rust-ratatui/README.md` |
| Go (Bubble Tea, terminal) | guide | `charm.land/bubbletea/v2` in `go.mod`, a model with `Init`, `Update` and `View` | `references/frameworks/go-bubbletea/README.md` |
| Python (Textual, terminal) | guide | `textual` in `requirements.txt` or `pyproject.toml`, a class derived from `textual.app.App` | `references/frameworks/python-textual/README.md` |
<!-- /generated:framework-table -->

Close relatives: PyQt6 and PyQt5 start from the PySide6 guide, WinUI 3 and Uno Platform from WPF, Xamarin.Forms from .NET MAUI, RPG Maker MV from RPG Maker MZ, Forge and NeoForge mods from Minecraft (Fabric), MonoGame and FNA from LÖVE (a frame loop that draws everything; the C# core as in the Avalonia guide), Defold from LÖVE (the Lua core) and Roblox (GUI nodes), PixiJS and other canvas engines from the Phaser adapter, iced and Slint from the Rust crate without egui (rust-egui section 4), mods of other games from Valheim and the guide of their engine.

## Other agents

This folder is the whole skill. To give DeepTip to the other agents of a project or a team, run the installer from a clone of https://github.com/gorduan/DeepTip: `node tools/install.mjs <project>` copies the skill to `.agents/skills/deeptip/` (read by Codex, Copilot, Cursor, Gemini CLI and most others), `--harness claude-code,cline,kiro …` adds the files of agents with their own format, `--user` installs into the home folder, `--list` names all 45 supported agents and assistants. It keeps every file it would replace as `<file>.bak` and changes only its own block in shared files such as `AGENTS.md`; `--dry-run` shows what it would do. Chat assistants and local models get a knowledge pack instead: `node tools/install.mjs <folder> --harness chatgpt --framework react`. Every agent with its files, trigger and limits: `skill/harnesses/README.md` in the repository.

## MCP server

The repository also has an MCP server, `mcp/deeptip-mcp.mjs` (Node 18+, no dependencies, read-only, stdio): `deeptip_overview`, `list_frameworks`, `get_guide`, `get_spec`, `get_algorithms`, `detect_framework` (the guide for a project folder), `check_glossary` (the validator, with `scan`), `new_glossary_entry` and `get_example_glossary`, the resources `deeptip://spec`, `deeptip://algorithms`, `deeptip://frameworks/<name>` and the prompt `add-deeptip`. Connect it with `claude mcp add --transport stdio --scope user deeptip -- node <DeepTip>/mcp/deeptip-mcp.mjs` (setup for Claude Desktop, Cursor, VS Code, Windsurf, Zed, Continue, Cline, Gemini CLI and Codex: `mcp/README.md` in the repository). When it is connected, its tools serve the same files as this skill's `references/`.

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
