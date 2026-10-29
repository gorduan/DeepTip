# DeepTip

**Explanation windows with depth**: nested, pinnable tooltips like in Paradox Interactive's games (Crusader Kings III, Victoria 3, Europa Universalis V). Rest the pointer on a UI element and, after a delay, a window explains it. Highlighted terms inside open further windows on hover, a click pins a window open, and pinned windows contain terms again, so explanations nest without limit. Mouse, touch (long-press), keyboard (F1, Esc, F6) and gamepad (Y, A, B, LB/RB).

The heart of this repository is the **web runtime** (plain HTML + JavaScript, no dependencies). Around it sits the **schema for every runtime**: one data format, one behaviour specification and one validator, so the same glossary files drive a web page, a desktop app or a game.

Other names for the same thing: DeepTooltip, 3DTooltip, DimTip, nested tooltips, Paradox tooltips, tooltips in tooltips. Deutsch: [README.de.md](README.de.md).

## Web: HTML + JavaScript

### Quick start

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/web/deeptip.css" />

<button data-deeptip="shop.cart">Cart</button>

<script type="module">
  import { DeepTip } from "https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/web/deeptip.js";

  DeepTip.init({
    locale: "en",
    fallback: ["en"],
    delay: 800, // ms the pointer rests on an element before its window opens (0 = at once)
    sources: ["/deeptip/{locale}.json"], // glossary files, "{locale}" is replaced
  });
</script>
```

Or copy `web/deeptip.js` and `web/deeptip.css` into your project (`node tools/deeptip-sync.mjs <target folder>` does it and can check for drift). It works with any framework (Svelte, React, Vue, Tauri, Electron) through event delegation: mark elements with `data-deeptip="key"`, nothing else to wire up.

### The glossary: one JSON file per language

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "shop.cart": {
    "title": "Cart",
    "short": "Items you are about to order.",
    "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**; shipping is added at [[shop.checkout]].",
    "see": ["shop.wishlist"]
  }
}
```

- `title` names the term, `short` is one line (lists, simple tooltips, the encyclopedia), `body` is the explanation (2–5 sentences).
- Markup, never HTML: `[[key]]` (link, text = the target's title), `[[key|text]]`, `**bold**`, `*italic*`, `` `code` ``, `{live_value}`, lines starting with `- ` for lists, a blank line for a new paragraph.
- Layers: load a shared core glossary first and your project's file after it; a later layer overrides an entry with the same key. Locales fall back along a chain (`locale`, then `fallback`), and a window shows a small badge when its entry came from a fallback language.
- `glossary/core/` ships English and German entries for DeepTip's own help (`deeptip.*`) plus general hardware, system and AI terms.

### Options (selection)

| Option | Default | Meaning |
|---|---|---|
| `delay` | 800 ms | rest time on a UI element (per element: `data-deeptip-delay`) |
| `linkDelay` | 80 ms | hover time on a term |
| `closeDelay` | 300 ms | grace before an unpinned window closes |
| `lockAfter` | 0 (off) | timer lock: resting inside a preview pins it |
| `root` / `child` | bottom, top, right, left / left, right, top, bottom | side order for first and further windows (per element: `data-deeptip-place`) |
| `closeButtons`, `pinButton`, `hints`, `clickInsidePins` | true | window chrome |
| `vars` | – | live values for `{name}`: an object of values or functions, or `(name, key) => value` |
| `openKeys` | F1, ? | keyboard opening |

All options and their exact behaviour: [SPEC.md](SPEC.md) §7.

### API

```js
const dt = DeepTip.init({ locale: "en" });
dt.add("en", glossaryObject);          // add or override entries of one locale
await dt.setLocale("de");               // switch language
dt.open("shop.cart", { anchor: button, pinned: true });
dt.closeAll();
dt.refresh();                           // after live values changed
dt.renderText(element, "Text with [[shop.cart]]."); // terms on a normal page
dt.renderIndex(container);              // searchable encyclopedia of every entry
dt.configure({ delay: 0 });
dt.destroy();
```

Theme through CSS custom properties (`--dt-bg`, `--dt-fg`, `--dt-link`, `--dt-pinned` …, light and dark defaults). State attributes: `data-dt-open` on anchors (hide your own simple tooltip while a window is open), `data-dt-arming` with `--dt-delay` (show rest progress), `data-dt-pinned` on windows. Full list in SPEC §8.

### Controls

| Action | Mouse | Touch | Keyboard | Gamepad |
|---|---|---|---|---|
| Open first window | rest | long-press | `F1` / `?` | Y |
| Preview a term | hover | – | – | – |
| Follow / pin a term | click | tap | `Tab` + `Enter` | d-pad + A |
| Close newest | leave / X | X | `Esc` | B |
| Close all | – | tap outside, swipe title bar down | hold `Esc`, `Shift+Esc` | hold B |
| Switch window | – | tap it | `F6` / `Shift+F6` | RB / LB |

Previews stay open while the pointer moves towards them (mouse tendency), and terms crossed on the way do not replace them.

### Demo

```bash
npm run demo
```

Then open `http://localhost:5560/demo/`: a Paradox-style screen in English and German with every setting to try, and the encyclopedia.

## The schema for every runtime

| File | Purpose |
|---|---|
| [SPEC.md](SPEC.md) | the contract, runtime-neutral: data format (§2), behaviour (§3), placement (§4), input (§5), accessibility (§6), options (§7), styling hooks (§8), porting checklist (§9) |
| [schema/deeptip.schema.json](schema/deeptip.schema.json) | JSON Schema for glossary files (editor completion and validation; reference it with `$schema`) |
| [tools/deeptip-check.mjs](tools/deeptip-check.mjs) | validator (Node 18+): invalid keys, broken links, missing translations, too long `short` lines, unused entries, keys used in code but not defined (`--scan`); exit code 1 on errors, for CI |
| `glossary/core/` | shared core glossary (English, German) |
| [CONCEPT.md](CONCEPT.md) | research on the Paradox games and the decisions behind DeepTip (German) |

```bash
node tools/deeptip-check.mjs --base en glossary/core/en.json my-app/deeptip/en.json --scan my-app/src
```

### Runtimes

| Runtime | Folder | State |
|---|---|---|
| Web (HTML + JS, any framework) | `web/` | 1.0, reference implementation |
| Valheim (BepInEx mod, Thunderstore "DeepTip") | `valheim/` | in development, published with its first release |
| Godot 4 | `godot/` | planned |
| .NET (Avalonia/WPF) | `dotnet/` | planned |

A new runtime follows SPEC §9: port the glossary loader and the markup parser, the window tree invariants, grace and mouse tendency, the placement function (`computePlacement`, a pure function with unit tests in `test/`) and the input table, then run the same validator on the same JSON files.

## Development

```bash
npm test        # pure functions: parser, glossary, placement
npm run check   # validate the core and demo glossaries
```

`skill/SKILL.md` is a skill for Claude Code, so an assistant knows how to add DeepTip to a project.

## License

MIT, see [LICENSE](LICENSE). Gorduan Community (GC): free for anyone to use, modify and re-upload.
