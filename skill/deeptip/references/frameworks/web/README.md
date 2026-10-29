# DeepTip for the web (HTML + JavaScript)

The reference implementation of [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md): nested, pinnable explanation windows. Plain JavaScript and CSS, no dependencies, no build step. Works on any web page and with every framework (Svelte, React, Vue, Tauri, Electron …) through event delegation.

Files: `deeptip.js` (ES module), `deeptip.css`. Example: `example/index.html`.

## 1. Add the files

Download `DeepTip-web-<version>.zip` from the releases, or copy the two files, or load them from the CDN:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.css" />
<script type="module">
  import { DeepTip } from "https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.js";
</script>
```

## 2. Write the glossary (one JSON file per language)

`deeptip/en.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json",
  "$locale": "en",
  "shop.cart": {
    "title": "Cart",
    "short": "Items you are about to order.",
    "body": "Holds your items until you [[shop.checkout|check out]]. Prices include **VAT**.",
    "see": ["shop.wishlist"]
  }
}
```

Markup, never HTML: `[[key]]`, `[[key|text]]`, `**bold**`, `*italic*`, `` `code` ``, `{live_value}`, `- ` lists, blank line = paragraph. Format: [SPEC.md](../../SPEC.md) §2.

## 3. Start DeepTip and mark elements

```html
<button data-deeptip="shop.cart">Cart</button>

<script type="module">
  import { DeepTip } from "./deeptip.js";
  const dt = DeepTip.init({
    locale: "en",
    fallback: ["en"],
    delay: 800,
    sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"],
    vars: { items: () => cart.length }, // {items} in texts
  });
</script>
```

- `data-deeptip="key"` on any element; optional `data-deeptip-delay="0"` and `data-deeptip-place="top,bottom"`.
- Terms on a normal page: `dt.renderText(element, "Text with [[shop.cart]].")`.
- Encyclopedia of every entry with search: `dt.renderIndex(container)`.

## API

| Call | Does |
|---|---|
| `DeepTip.init(options)` | create the controller (one per document) |
| `add(locale, glossary)` | add or override entries of one locale (core first, project after) |
| `setLocale(locale)` | switch language (loads `sources` for it) |
| `open(key, { anchor, parent, pinned, focus })` | open a window next to an element |
| `close(window)`, `closeAll()`, `pin(window)`, `unpin(window)` | window control |
| `refresh()` | re-render after live values changed |
| `renderText(element, text)`, `renderIndex(container)`, `removeIndex(container)` | terms and encyclopedia on pages |
| `configure(options)`, `destroy()` | change options, remove everything |

Options with defaults: `delay` 800 ms, `linkDelay` 80 ms, `closeDelay` 300 ms, `lockAfter` 0 (off), `longPress` 500 ms, `closeButtons`, `pinButton`, `hints`, `clickInsidePins` (true), `outsideClickCloses` "touch", `root` bottom/top/right/left, `child` left/right/top/bottom, `engine` "auto", `openKeys` F1 and ?, `gamepad`, `vibrate`, `onOpen`, `onClose`, `onPin`. Details: SPEC §7.

## Styling

CSS custom properties with light and dark defaults: `--dt-bg --dt-fg --dt-border --dt-radius --dt-shadow --dt-accent --dt-pinned --dt-link --dt-link-hover --dt-focus --dt-font --dt-font-size --dt-max-width` … State attributes: `data-dt-open` on anchors (hide your own simple tooltip), `data-dt-arming` with `--dt-delay` (rest progress), `data-dt-pinned`, `data-dt-depth` on windows. Full list: SPEC §8.

## Example

```bash
npm run demo
```

Open `http://localhost:5560/frameworks/web/example/`: a strategy-game screen in English and German, every setting to try, the encyclopedia. It uses the shared example glossary in `glossary/example/`, like the examples of every other framework.

## Tests

`npm test` runs the pure functions (parser, glossary, placement) against `test/cases/*.json`, the parity cases every runtime shares.
