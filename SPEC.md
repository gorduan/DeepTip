# DeepTip — Specification 1.0

> **DeepTip** = explanation windows with depth ("tooltips in tooltips", popularised by Paradox Interactive in
> Crusader Kings III / Victoria 3 / Europa Universalis V). Rest on a UI element → after a delay a window explains
> it. Highlighted terms inside open further windows on hover; a click pins a window open; pinned windows contain
> terms again, so explanations nest without limit.
>
> Synonyms that mean this spec: DeepTip, DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips,
> tooltips in tooltips, verschachtelte Tooltips, Erklärfenster.

This document is runtime-neutral. The web reference implementation is `web/deeptip.js` + `web/deeptip.css`;
any other runtime (Svelte, React, Godot, WPF/Avalonia, Unity, ImGui, TUI …) implements the same data format,
behaviour and input mapping. Section numbers are referenced from code.

---

## 1. Principles

1. **Native first.** Use what the platform already does before writing code: real buttons for terms (focus,
   Enter, screen readers for free), the platform's top-layer / popup mechanism for windows, declarative
   placement and animation (CSS anchor positioning, transitions) where available. Code handles only data,
   the window tree and input devices. On the web: *HTML before JS, CSS before JS*.
2. **One entry, three depths.** `title` (name), `short` (one line), `body` (2–5 sentences with links). Anything
   deeper belongs in the linked entries — the important information stays near the top of the chain.
3. **Content is data.** Glossaries are JSON files per locale, like translation files; code never contains
   explanation text. The same files drive windows, simple tooltips (`short`) and the encyclopedia.
4. **Nothing is lost by accident.** Grace time and movement intent keep windows open on the way into them;
   pinned windows only close on an explicit action.
5. **Every input device is first-class:** mouse, touch, keyboard, gamepad, screen reader.

## 2. Glossary format

### 2.1 Files and layers
- One JSON object per locale: `de.json`, `en.json`, or prefixed `myapp.de.json`. The locale comes from
  `"$locale"` or the file name.
- **Layers:** a shared **core glossary** (`glossary/core/<locale>.json`: hardware, system, AI basics, DeepTip's
  own help) plus a **project glossary**. Load core first; a later layer overrides an entry with the same key.
- Keys are dotted namespaces: `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$` — e.g. `hw.vram`, `myapp.gamemode`.
  Keys are language-neutral and never shown.
- Nested i18next style is accepted too: `{"hw": {"vram": {…}}}` ≡ `{"hw.vram": {…}}`. An object is an entry as
  soon as it has `title`, `short` or `body`.
- Top-level keys starting with `$` are metadata: `$schema`, `$locale`, `$ui` (the window's own labels, §2.6).
- JSON Schema: `schema/deeptip.schema.json` (editor completion + validation).

### 2.2 Entry
| Field | Req. | Meaning |
|---|---|---|
| `title` | yes | Name of the term. Default text of links to it and the window title. |
| `short` | one of short/body | One line (≤ 140 chars): simple tooltips, lists, encyclopedia. Shown in the window when there is no `body`. |
| `body` | one of short/body | The explanation with links. |
| `aliases` | no | Other names: search, and auto-linking (a runtime may highlight their first occurrence in host texts, e.g. Valheim's tooltips; whole words, case-insensitive). |
| `see` | no | Keys shown as "See also" links under the body. |
| `note` | no | For authors/translators; never shown. |

### 2.3 Locale fallback
Resolution order is the **chain** `[current locale, ...fallback locales]`. The first locale that has the key
provides the **whole entry** (no field mixing). A window whose entry came from a fallback locale shows a small
badge with that locale code (e.g. `DE`) whose tooltip is `$ui.fallback`. A missing key renders the key as title
and `$ui.missing` as text and logs one warning — a window is never empty.

### 2.4 Markup (safe, renderable everywhere)
Text is **never** HTML. Supported:

| Syntax | Result |
|---|---|
| `[[key]]` | Link to `key`, text = its `title` in the current chain |
| `[[key\|text]]` | Link with its own text (translated together with the sentence) |
| `**bold**`, `*italic*` | Emphasis (may nest; opening mark must be followed, closing mark preceded by a non-space) |
| `` `code` `` | Inline code |
| `{name}` | Live value filled at render time (§2.5); `name` = `[A-Za-z_][A-Za-z0-9_]*` |
| `\` + one of `` \ * ` [ ] { } \| `` | Literal character |
| single newline | Line break |
| blank line | New paragraph |
| lines starting with `- ` or `• ` | Bullet list |

- A link to the entry's own key renders as bold text. A link to a missing key renders as marked-missing text
  (not clickable) and is a validator error.
- Renderers map this AST to their medium: DOM nodes (web), BBCode/RichTextLabel (Godot), Inlines (WPF), etc.

### 2.5 Live values
`{name}` is replaced by the host: a map of values or functions, or one function `(name, key) → value`. An unknown
name stays visible as `{name}`. Values are read when a window renders; hosts call `refresh()` after changes.

### 2.6 `$ui` labels
`close`, `pin`, `unpin`, `missing`, `fallback`, `hint`, `seeAlso`, `search`, `mentionedIn`, `empty`. Built-in
German and English defaults exist; `$ui` in a glossary overrides them per locale.

### 2.7 Encyclopedia
The same data renders a searchable list of every entry (title as link, `short`, "Mentioned in" backlinks computed
from all links and `see` lists). No second text source.

### 2.8 Validator
`tools/deeptip-check.mjs` (Node ≥ 18, no dependencies). Errors: invalid JSON/keys, missing `title`, neither
`short` nor `body`, broken links, keys used in code but not defined (`--scan`). Warnings: missing `short`,
`short` too long, self links, unparsed `[[`, links resolvable only via fallback, entries missing in another
locale, live values that differ between translations. Info: entries neither linked nor used in code. Exit code 1
on errors (and warnings with `--strict`) — run it in CI / before builds.

## 3. Behaviour

### 3.1 Vocabulary
- **Anchor** — what a window belongs to: a **UI element** (marked with the key, web: `data-deeptip="key"`), or a
  **term** (a link inside a window, or a term link placed directly on a page).
- **Window** — shows one entry. It is either a **preview** (unpinned) or **pinned**.
- **Parent** — the window that contains the term a window was opened from. Windows opened from UI elements or
  page terms have no parent (roots). Windows form a forest.

### 3.2 Invariants
1. At most **one preview per parent** (and one root preview): opening another replaces it.
2. A **pinned window's ancestors are pinned** — pinning pins the whole chain above it.
3. Closing a window closes **everything opened from it**.
4. The same key **already open in the chain above** is not opened again; that window flashes instead.
5. The same anchor never has two windows; triggering it again reuses (and, if asked, pins) the open one.

### 3.3 Opening
| Anchor | Mouse / pen | Touch | Keyboard / gamepad |
|---|---|---|---|
| UI element | rest inside it for `delay` (per element override, e.g. `data-deeptip-delay`) → preview | long-press `longPress` → pinned (no click/context menu afterwards, short vibration) | focus + `F1`/`?` or Y → pinned, focus moves in |
| Term | hover for `linkDelay` → preview | tap → pinned | Enter / A → pinned, focus moves in |
| Term, click | click → pinned (+ its chain) | – | – |

The UI element keeps its own click action; DeepTip never consumes a normal click on it (only the click that
ends a long-press).
A click on the element or typing into it cancels its pending window until the pointer has left it — the user
is using it, not asking about it.

### 3.4 Keeping previews open, closing them
- A preview stays open while the pointer is on its anchor, inside it, or inside anything opened from it (**hot**).
- When it is no longer hot it closes after `closeDelay` (**grace**, default 300 ms) …
- … unless the pointer is **moving towards it** (mouse tendency, EU5): the ray of the pointer's recent movement
  (last ~120 ms) hits the window's box (+12 px). This extends the grace up to 1.5 s.
- **Suppression** (Victoria 3 problem): while the pointer heads into a preview, terms and UI elements crossed on
  the way do not open (their timers wait while the tendency holds).
- **Timer lock** (optional, `lockAfter` > 0): resting inside a preview for that long pins it; a bar at the window
  edge shows the progress (web: the CSS animation *is* the timer, its end event pins).
- A click anywhere inside a preview pins it (`clickInsidePins`).

### 3.5 Closing
| Action | Result |
|---|---|
| X button (`closeButtons`, can be off) | close that window (and its subtree) |
| Pin button toggled off | back to preview; closes when not hot |
| `Esc` / gamepad B (tap) | close the newest window opened from the focused one (or the focused one, or the newest) |
| hold `Esc` ≥ 600 ms, `Shift+Esc`, hold B ≥ 600 ms | close all |
| touch: tap outside all windows (`outsideClickCloses`: `touch` default, `always`, `never`) | close all |
| touch: swipe a title bar down ≥ 60 px | close all |
| anchor element removed by the host (re-render) | previews close; pinned roots freeze in place |

Focus returns to the closed window's anchor when focus was inside it.

## 4. Placement

- **Root windows** sit next to their anchor. Default order **bottom → top → right → left** (`root`).
  One element can set its own order (web: `data-deeptip-place="top,bottom"`), e.g. form labels whose window
  must not cover the input below them.
- **Child windows** sit next to their **parent window** (not the term). Order **left → right → top → bottom**
  (`child`). A child never overlaps its parent; it may overlap any older window.
- A side is taken when the window fits between anchor and viewport edge (gap `--dt-gap`, 8 px, also to the
  edge). On the other axis the window is **centred on the anchor and pushed back inside the viewport**.
- Nothing fits: the side with the most room relative to the window's size; the window shrinks to that room
  (≥ 120 px, else it is only kept on screen).
- Reference algorithm: `computePlacement(size, anchorRect, sides, viewport, gap)` in `web/deeptip.js`
  (pure function, unit-tested).
- Web: CSS anchor positioning does it natively — `position-anchor`, `position-area: <side> span-all`,
  `position-try-fallbacks` with four `@position-try` rules. JS measures only when the CSS result leaves the
  viewport or covers the parent, and when the engine is set to `js`.

## 5. Input mapping (summary)

| Action | Mouse | Touch | Keyboard | Gamepad |
|---|---|---|---|---|
| Open first window | rest (`delay`) | long-press (`longPress`, vibration) | `F1` / `?` on focused element | Y / △ |
| Preview a term | hover | – | – | – |
| Follow / pin a term | click | tap | `Tab` to it + `Enter` | d-pad/stick to it + A / ✕ |
| Close newest | leave / X | X | `Esc` | B / ○ |
| Close all | – | tap outside, swipe title bar down | hold `Esc`, `Shift+Esc` | hold B |
| Switch window | – | tap it | `F6` / `Shift+F6` | RB / LB |

## 6. Accessibility
- Terms are real buttons. Previews have `role="tooltip"`; pinned windows `role="dialog"` (non-modal),
  `aria-labelledby` = title, `aria-describedby` = body. Root anchors get `aria-describedby` → body while open.
- Opening by keyboard/gamepad moves focus to the first term (else the window); closing returns it.
- Respect reduced motion (no slide/flash; the lock bar still runs, it is a timer) and forced colours.
- Touch targets ≥ 40 px on coarse pointers.

## 7. Configuration (reference names)
| Option | Default | Meaning |
|---|---|---|
| `delay` | 800 ms | rest time on a UI element (0 = immediately); per element override |
| `linkDelay` | 80 ms | hover time on a term |
| `closeDelay` | 300 ms | grace before a preview closes |
| `lockAfter` | 0 (off) | timer lock |
| `longPress` | 500 ms | touch press |
| `closeButtons` / `pinButton` / `hints` | true | window chrome |
| `clickInsidePins` | true | click in a preview pins it |
| `outsideClickCloses` | `"touch"` | `never` / `touch` / `always` |
| `root` / `child` | see §4 | side order |
| `engine` | `auto` | web: CSS anchor positioning with JS rescue, or `js` |
| `locale` / `fallback` / `sources` | – | data (§2) |
| `vars` | – | live values (§2.5) |
| `openKeys` | `F1`, `?` | keyboard open |
| `gamepad` / `vibrate` | true | devices |

## 8. Styling hooks (web)
- Theme via custom properties (all have light/dark defaults): `--dt-bg --dt-fg --dt-border --dt-border-width
  --dt-radius --dt-shadow --dt-accent --dt-pinned --dt-link --dt-link-hover --dt-link-open-bg --dt-focus
  --dt-title --dt-code --dt-var --dt-mono --dt-font --dt-font-size --dt-gap --dt-min-width --dt-max-width
  --dt-max-height --dt-hover-bg --dt-missing`.
- State attributes: on anchors `data-dt-open` (a window is open — hide your own simple tooltip) and
  `data-dt-arming` with `--dt-delay` (pointer resting / finger pressing → show progress); on windows
  `data-dt-pinned`, `data-dt-locking` (+`--dt-lock`), `data-dt-depth`, `data-dt-engine`.

## 9. Porting checklist (other runtimes)
1. Parse the glossary format (§2) incl. nested form, layers and fallback chain; port `parseText` → your rich text.
2. Window tree with the invariants of §3.2; previews vs pinned; subtree close.
3. Hot set + grace + tendency + suppression (§3.4); optional timer lock.
4. `computePlacement` (§4) — or the platform's popup placement if it can express "next to the parent, never
   covering it, first side with room".
5. Input table (§5) incl. long-press, Esc-hold, gamepad B-hold.
6. Accessibility (§6), theming, `$ui` labels.
7. Run the shared validator on the same JSON files.

Known runtimes: **web** (`web/`, framework-free — Svelte/React/Vue/Tauri/Electron use it as is with
`data-deeptip` attributes); **Valheim** (`valheim/`, published with its first release; BepInEx plugin GC_Valheim_DeepTip, on Thunderstore "DeepTip":
TextMeshPro `<link>` terms, Valheim's own tooltip adopted as the root window, auto-linking via `aliases`, the
encyclopedia as a Compendium page, glossary folders `deeptip/` in any plugin, C# API). Planned: Godot 4 (`godot/`,
RichTextLabel `meta_clicked`/`meta_hover_started`), .NET/Avalonia.
