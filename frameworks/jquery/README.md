# DeepTip for jQuery

A small jQuery plugin for [DeepTip](../../README.md) (explanation windows with depth): `$.deeptip.init(options)` starts the page's controller, `$(selector).deeptip("key")` marks elements, `$(el).deeptip("open")` and `"close"` drive their windows, and jQuery events (`deeptip:open`, `deeptip:pin`, `deeptip:close`) arrive on the element a window belongs to.

The plugin is a thin layer over the web runtime [`frameworks/web/deeptip.js`](../web/README.md), which does everything else: windows in the top layer, placement, grace and mouse tendency, touch, keyboard, gamepad, accessibility ([docs/algorithms.md](../../docs/algorithms.md), [SPEC.md](../../SPEC.md)). It works with content inserted later, because the runtime finds `data-deeptip` elements by event delegation. Statements marked *(checked)* were verified on 2026-10-29 with jQuery 3.7.1 and 4.0.0 (also both on one page with `noConflict(true)`) and jQuery UI 1.14.2 in headless Chrome 156: 23 checks with real mouse and keyboard input (section 12).

## Quick start

**Recognise the project:** `jquery` in `package.json`, or a `<script src="…jquery….js">` tag in the pages; code such as `$(function () { … })` or `$(document).ready(…)`.

1. Copy `frameworks/web/deeptip.js`, `frameworks/web/deeptip.css` and `frameworks/jquery/jquery.deeptip.js` into one folder, e.g. `js/deeptip/`.
2. Write your glossary as `js/deeptip/en.json`.
3. Load jQuery, then the plugin as a module script, and link the stylesheet.
4. In your ready handler: `$.deeptip.init(…)` and mark elements.
5. Rest the pointer on a marked element.

```html
<link rel="stylesheet" href="js/deeptip/deeptip.css" />
<button id="cart">Cart</button>
<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
<script type="module" src="js/deeptip/jquery.deeptip.js"></script>
<script>
  $(function () {
    $.deeptip.init({ locale: "en", sources: ["js/deeptip/{locale}.json"] });
    $("#cart").deeptip("shop.cart");
  });
</script>
```

**Done when:** resting the pointer on the button opens a window with the entry's title, `$("#cart").deeptip()` returns `"shop.cart"`, `$("#cart").on("deeptip:open", …)` fires, the console shows no `DeepTip:` warning.

## 1. Files and loading

| File | Where |
|---|---|
| `jquery.deeptip.js` (this folder) | next to `deeptip.js`: it imports `./deeptip.js` |
| `frameworks/web/deeptip.js`, `deeptip.css` | the same folder |
| glossaries `glossary/core/<locale>.json` and yours | e.g. `js/deeptip/core/<locale>.json`, `js/deeptip/<locale>.json` |

- `jquery.deeptip.js` is an ES module (the runtime is one). Module scripts run after classic scripts and before `DOMContentLoaded`, so `$.deeptip` exists inside `$(function () { … })` *(checked)*; do not call it from a classic script at parse time.
- On import it installs itself into `window.jQuery`. With a bundler or another copy of jQuery, call `install` yourself: `import $ from "jquery"; import { install } from "./deeptip/jquery.deeptip.js"; install($);`.
- From a CDN: the runtime files are on jsDelivr (`https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v1.0.0/frameworks/web/deeptip.js`); the plugin imports `./deeptip.js` relatively, so serve the two `.js` files from the same folder, or map the plugin's import with an import map as the example does (`{ "imports": { "<folder of the plugin>/deeptip.js": "<where deeptip.js is>" } }`).
- jQuery's slim build works for everything except `$.getJSON` (section 6), which slim builds do not contain.
- Download `DeepTip-jquery-1.0.0.zip` from the releases (it contains this folder, `frameworks/web/`, the glossaries and the tests) or copy the files from the repository.

## 2. Start once

```js
$(function () {
  var dt = $.deeptip.init({
    locale: "en",
    fallback: ["de", "en"],
    sources: ["js/deeptip/core/{locale}.json", "js/deeptip/{locale}.json"], // core first, project after
    delay: 1000,
    vars: { gold: function () { return state.gold.toLocaleString(dt.locale); } },
  });
});
```

- `$.deeptip.init(options)` creates the page's one controller and returns it: the runtime's `DeepTip` with every call of [the web API](../web/README.md#api) (`dt.open`, `dt.configure`, `dt.renderIndex` …). Options: SPEC [§7](../../SPEC.md#7-configuration-reference-names).
- A second call does not create a second controller: it changes the options of the first (`configure`) and returns it *(checked)*. That keeps pages safe where several scripts call `init`.
- `onOpen`, `onPin` and `onClose` in the options are still called; the plugin adds its own to trigger the jQuery events.
- `$.deeptip.instance` is the controller (or `null`), `$.deeptip.DeepTip` the runtime class, `$.deeptip.destroy()` removes everything (windows, listeners) so `init` can start again.

## 3. Mark elements

```js
$("#realm").deeptip("demo.realm");
$("#help").deeptip("deeptip.about", { delay: 0 });                 // data-deeptip-delay="0"
$("label.zip").deeptip({ key: "shop.zip", place: ["top", "bottom"] }); // data-deeptip-place="top,bottom"
$("#realm").deeptip();                                              // "demo.realm": the key of the first element
```

```html
<button data-deeptip="demo.nobles">Nobles</button>  <!-- the same without the plugin -->
```

- The plugin only writes the attributes `data-deeptip`, `data-deeptip-delay` and `data-deeptip-place`; the runtime reads them by delegation, so markup with the attributes needs no call at all. Elements inserted later (Ajax, templates, `.append()`) work as soon as they are in the page *(checked)*; `$(sel).deeptip("key")` marks only the elements that exist when it runs.
- The element keeps its own click handlers: DeepTip never consumes a normal click on it, only the click that ends a touch long-press ([SPEC §3.3](../../SPEC.md#33-opening)) *(checked)*.
- A key that is also a method name (`open`, `close`, `pin`, `unpin`, `remove`, `text`, `index`, `removeIndex`) must be given in the object form: `.deeptip({ key: "open" })`.
- The validator's `--scan` finds keys in `data-deeptip="…"` attributes, in `.deeptip("key")` calls and in the object form `.deeptip({ key: "…" })`; it skips the method names (`.deeptip("open")`, `"text"`, `"index"` …) and the plugin file `jquery.deeptip.js` itself *(checked with the validator of 1.1.0; the one of 1.0.0 reported both as undefined keys)*.

## 4. Methods and events

| Call | Does |
|---|---|
| `$.deeptip.init(options)` | creates (once) and returns the controller; later calls configure it |
| `$.deeptip.setLocale(locale)` | switches the language and renders every `"text"` element again; returns a promise |
| `$.deeptip.refresh()` | re-renders open windows and encyclopedias (live values changed) |
| `$.deeptip.destroy()` | closes everything and removes all listeners |
| `$(sel).deeptip("key" [, { delay, place }])`, `.deeptip({ key, delay, place })` | marks the elements |
| `$(sel).deeptip()` | the key of the first element |
| `$(sel).deeptip("open" [, { pinned = true, focus = false }])` | opens the element's window (pinned unless `pinned: false`; an unpinned window closes again as soon as the pointer is not on it) |
| `$(sel).deeptip("close")`, `"pin"`, `"unpin"` | for windows that belong to these elements |
| `$(sel).deeptip("remove")` | closes their windows and removes the attributes *(checked)* |
| `$(sel).deeptip("text", markup)` | renders DeepTip markup with live terms into the elements, after the glossaries are loaded |
| `$(sel).deeptip("index" [, { search }])`, `"removeIndex"` | the encyclopedia |

Events, triggered on the element the window belongs to (a marked element, or a term button inside the parent window) and bubbling like any jQuery event; handlers get `(event, key, windowElement, win)`:

| Event | When |
|---|---|
| `deeptip:open` | a window opened |
| `deeptip:pin` | it was pinned; also for every window above it that a pin pins with it ([§4.3](../../docs/algorithms.md#43-pinw-and-unpinw)) |
| `deeptip:close` | it closed; windows opened from it close (and report) first |

```js
$(document).on("deeptip:open deeptip:pin deeptip:close", "[data-deeptip]", function (e, key) {
  console.log(e.type, key, this);
});
```

A window opened pinned (a click on a term, `"open"`, F1, a long-press) reports `deeptip:open` before `deeptip:pin`. Hovering a term and clicking it reported, in this order: open of the term's window, pin of the parent's element, pin of the term *(checked)*.

## 5. Terms in page texts, encyclopedia

```js
$("#intro").deeptip("text", "Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].");
$("#glossary").deeptip("index");
```

- `"text"` waits for the glossaries (before them, links to unknown keys would render as missing) and remembers the markup; `$.deeptip.setLocale()` renders these elements again in the new language *(checked)*. With `dt.setLocale()` directly, render them yourself.
- `"index"` renders the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia)); DeepTip re-renders it on every refresh until `"removeIndex"`.
- Keep the elements empty: the plugin replaces their children.

## 6. Glossaries: `sources` or `$.getJSON` + `add()`

`sources` (section 2) is the simple way: URL templates with `{locale}`, fetched for the current language and its fallbacks. When the glossaries come from somewhere else (an API, a CMS, files with hashed names), load them yourself and add them, core first:

```js
Promise.all([$.getJSON("/api/glossary/core/de"), $.getJSON("/api/glossary/de")]).then(function (layers) {
  dt.add("de", layers[0]).add("de", layers[1]);
});
```

jqXHR objects are thenables, so `Promise.all` takes them directly *(checked)*. `add()` re-renders open windows; with `sources: []` the controller starts without fetching anything.

## 7. Live values and language

- `{name}` in a glossary text is read when a window renders ([SPEC §2.5](../../SPEC.md#25-live-values)): give `vars` functions that read your state and call `$.deeptip.refresh()` after it changed; the open Stability window showed `+2` after the button's own click handler had run *(checked)*.
- `$.deeptip.setLocale("de").then(paint)` loads the German glossaries, re-renders the windows, the encyclopedia and the `"text"` elements; your own texts are yours to update.

## 8. Next to jQuery UI Tooltip, Tooltipster, qTip2

Never give one element two tooltip systems: both would open on hover.

- **jQuery UI Tooltip** reads `title` attributes. Exclude marked elements: `$(document).tooltip({ items: "[title]:not([data-deeptip])" })`, and do not put a `title` on marked elements. The example keeps a jQuery UI tooltip on one button and DeepTip on the others; each element showed only its own *(checked)*.
- **Tooltipster** and **qTip2** bind to the elements you select (`$(".tooltip").tooltipster()`, `$("[title]").qtip()`): select without marked elements, e.g. `$(".tooltip").not("[data-deeptip]").tooltipster()`, or destroy them where DeepTip takes over (`.tooltipster("destroy")`, `.qtip("destroy", true)`) *(verify)*.
- **Migrating a tooltip**: move its text into the glossary (`title` of the element → `title`/`short` of an entry, longer help → `body` with `[[links]]`), remove the `title` attribute or the plugin call, and mark the element with `.deeptip("key")`. Short hints that need no depth can stay ordinary tooltips on unmarked elements.
- Hide your own simple tooltip while a DeepTip window is open with the hook `[data-dt-open]` ([SPEC §8](../../SPEC.md#8-styling-hooks-web)).

## 9. noConflict, several copies, jQuery 3 and 4

- The plugin never uses the global `$`; it installs into the jQuery it is given. After `var jq4 = jQuery.noConflict(true)`, call `install(jq4)`; every installed copy shares the one controller, and events reach handlers bound with any of them *(checked with 3.7.1 as `window.jQuery` and 4.0.0 as `jq4`)*.
- It uses only `.each`, `.attr`, `.trigger`, `$.fn` and native promises, none of the helpers jQuery 4 removed (`$.trim`, `$.isArray`, `$.isFunction` …).

## 10. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body`: windows are appended to `document.body`. Hooks on your own elements: `[data-dt-open]` while its window is open, `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it (the example fills a bar at the bottom of the button).

## 11. Pitfalls

- **Calling `$.deeptip` too early**: a classic script runs before the module; wrap the call in `$(function () { … })` (or load your code as a module that imports the plugin).
- **Two tooltips on one element** (section 8).
- **`$.getJSON` in the slim build**: not there; use `fetch` or the full build.
- **Inline import map and CSP**: the example's import map is an inline script; in your project the files sit side by side and need no map, so `script-src 'self'` suffices (DeepTip itself needs no inline script or style).
- **Elements replaced by your code** (`.html()`, `.replaceWith()`) close their open previews; pinned windows stay where they were ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)).

## 12. Tests

```bash
node frameworks/jquery/test/run.mjs            # Node 22+, Chrome/Chromium/Edge; --chrome <path>, --port, --profile
```

`test/run.mjs` serves the repository, opens `example/index.html?test` (jQuery 3.7.1, jQuery UI 1.14.2) and `test/jquery4.html?test` (jQuery 4.0.0 with `noConflict(true)` next to 3.7.1) in headless Chrome and drives `test/checks.js` with real mouse and keyboard input through the DevTools protocol; console errors and warnings count as failures. The checks: `init` returns one controller and configures it on a second call; marking and reading keys; rest opens the window with `deeptip:open` on the element; the element's own click and `refresh()`; the event order when a term is hovered and clicked; Esc and Shift+Esc with `deeptip:close`; `"open"` and `"close"`; an element inserted later; `"text"` and `setLocale`; jQuery UI Tooltip next to DeepTip; `$.getJSON` + `add()`; `"remove"`; `noConflict` with a shared controller. On 2026-10-29: 23 of 23 passed. The libraries come from jsDelivr, so the run needs network access.

The parser, the placement and the glossary flattening are the web runtime's: `npm test` runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 13. The example

```bash
npm run demo     # then http://localhost:5560/frameworks/jquery/example/
```

The same screen as `frameworks/web/example`, written with jQuery: a HUD row (`demo.realm`, `demo.stability` with `{stability}`, `demo.taxes` adding gold, `demo.nobles`, `demo.gold` with `{gold}`, a help button `deeptip.about` with delay 0), a language select (`en`, `de`, fallback `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons for placement at the edges, a page text, settings through `dt.configure`, a button that inserts marked elements later, a jQuery UI tooltip on another element, the encyclopedia and a log of the jQuery events. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

## 14. Limitations

- The plugin adds no behaviour of its own; everything the windows do is the web runtime's, with its limits.
- `.deeptip("text")` elements are re-rendered by `$.deeptip.setLocale()` only.
- Events go through jQuery: native `addEventListener("deeptip:open")` handlers do not receive them; use `onOpen`/`onPin`/`onClose` in the options for code without jQuery.

## 15. Checklist

1. Put `deeptip.js`, `deeptip.css` and `jquery.deeptip.js` in one folder; load jQuery, then the plugin as a module.
2. `$.deeptip.init({ locale, fallback, sources })` once, inside `$(function () { … })`.
3. Mark elements with `.deeptip("key")` or `data-deeptip`; keep other tooltip plugins off marked elements.
4. Page texts with `.deeptip("text", …)`, the encyclopedia with `.deeptip("index")`; switch languages with `$.deeptip.setLocale`.
5. Live values: `vars` functions plus `$.deeptip.refresh()`.
6. Validate the glossaries (`tools/deeptip-check.mjs`), run `test/run.mjs`, compare with the web example.
