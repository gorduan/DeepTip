# DeepTip for Bootstrap

A theme and the recipes that make [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) feel at home in a Bootstrap 5.3 site: `deeptip-bootstrap.css` maps DeepTip's `--dt-*` properties to Bootstrap's `--bs-*` properties, so windows look like Bootstrap popovers and follow the colour mode (`data-bs-theme`); the recipes below make DeepTip work with Bootstrap's tooltips, modals, offcanvases and dropdowns.

Everything else is the web runtime [`frameworks/web/deeptip.js`](../web/README.md), unchanged: windows in the top layer, placement, grace and mouse tendency, touch, keyboard, gamepad, accessibility ([docs/algorithms.md](../../docs/algorithms.md), [SPEC.md](../../SPEC.md)). Statements marked *(checked)* were verified on 2026-10-29 with Bootstrap 5.3.8 and Bootstrap Icons 1.13.2 in headless Chrome 156: 12 checks with real mouse and keyboard input, screenshots in light and dark mode (section 13). Bootstrap 4.6 notes are marked *(verify)*: read from Bootstrap 4.6.2's source, not run.

## Quick start

**Recognise the project:** `bootstrap` in `package.json`, or `bootstrap.min.css` / `bootstrap.bundle.min.js` in the pages; markup with `btn`, `navbar`, `card`, `data-bs-toggle`.

1. Copy `frameworks/web/deeptip.js`, `frameworks/web/deeptip.css` and `frameworks/bootstrap/deeptip-bootstrap.css` into one folder, e.g. `assets/deeptip/`.
2. Write your glossary as `assets/deeptip/en.json`.
3. Link the stylesheets in this order: Bootstrap, `deeptip.css`, `deeptip-bootstrap.css`.
4. Start DeepTip in a module script and mark an element with `data-deeptip`.
5. Rest the pointer on the element.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css" />
<link rel="stylesheet" href="assets/deeptip/deeptip.css" />
<link rel="stylesheet" href="assets/deeptip/deeptip-bootstrap.css" />
<button class="btn btn-outline-secondary" data-deeptip="shop.cart">Cart</button>
<script type="module">
  import { DeepTip } from "./assets/deeptip/deeptip.js";
  DeepTip.init({ locale: "en", sources: ["assets/deeptip/{locale}.json"] });
</script>
```

**Done when:** resting the pointer on the button opens a window with a grey title bar and Bootstrap's body colours, `data-bs-theme="dark"` on `<html>` turns the window dark, terms in it use Bootstrap's link colour, the console shows no `DeepTip:` warning.

## 1. Files and loading

| File | Where |
|---|---|
| `deeptip-bootstrap.css` (this folder) | after Bootstrap's CSS and after `deeptip.css` |
| `frameworks/web/deeptip.js`, `deeptip.css` | anywhere; the module is imported by your script |
| glossaries `glossary/core/<locale>.json` and yours | e.g. `assets/deeptip/core/<locale>.json`, `assets/deeptip/<locale>.json` |
| optional: Bootstrap Icons (`bootstrap-icons.css`) | for the icon variant of section 10 |

- With npm and a bundler: import Bootstrap's CSS first, then `deeptip.css` and `deeptip-bootstrap.css`; the theme only uses Bootstrap's CSS variables, so Sass builds with changed variables work as long as they emit them (Bootstrap 5.3 does by default).
- DeepTip needs nothing from Bootstrap's JavaScript; the recipes in sections 8 and 9 use Bootstrap's events.
- Download `DeepTip-bootstrap-1.0.0.zip` from the releases (it contains this folder, `frameworks/web/`, the glossaries and the tests) or copy the files from the repository.

## 2. Start once, mark elements, texts, live values, language

All of it is the web runtime's API ([frameworks/web/README.md](../web/README.md)), in one module script per page:

```js
import { DeepTip } from "./assets/deeptip/deeptip.js";

const dt = DeepTip.init({
  locale: "en",
  fallback: ["de", "en"],
  sources: ["assets/deeptip/core/{locale}.json", "assets/deeptip/{locale}.json"], // core first, project after
  vars: { gold: () => state.gold.toLocaleString(dt.locale) },
});
await dt.ready;
dt.renderText(document.getElementById("intro"), "Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].");
dt.renderIndex(document.getElementById("index"));
```

- Mark elements with `data-deeptip="key"`, optionally `data-deeptip-delay="0"` and `data-deeptip-place="right,left"` (dropdown items, form labels) ([SPEC §4](../../SPEC.md#4-placement)). Buttons keep their own click action ([SPEC §3.3](../../SPEC.md#33-opening)).
- Page texts: `renderText` after `dt.ready`, and again after `await dt.setLocale(locale)`; the encyclopedia (`renderIndex`) re-renders by itself ([§12](../../docs/algorithms.md#12-encyclopedia)).
- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)): `vars` functions plus `dt.refresh()` after a change.
- `dt.destroy()` removes everything (pages that are torn down by a client-side router).

## 3. The theme

`deeptip-bootstrap.css` sets the properties on `.dt-win`, `.dt-index` and `.dt-link` (not only on `:root`), so a window takes the `--bs-*` values of the element it is appended to:

| DeepTip | Bootstrap 5.3 |
|---|---|
| `--dt-bg`, `--dt-fg` | `--bs-body-bg`, `--bs-body-color` |
| `--dt-border`, `--dt-border-width`, `--dt-radius`, `--dt-shadow` | `--bs-border-color-translucent`, `--bs-border-width`, `--bs-border-radius-lg`, `--bs-box-shadow` (the popover's values) |
| `--dt-accent`, `--dt-pinned`, `--dt-focus` | `--bs-primary` |
| `--dt-link`, `--dt-link-hover`, `--dt-link-open-bg` | `--bs-link-color`, `--bs-link-hover-color`, `--bs-primary-bg-subtle` |
| `--dt-title`, `--dt-var` | `--bs-emphasis-color` |
| `--dt-hover-bg` | `--bs-secondary-bg` |
| `--dt-code`, `--dt-missing` | `--bs-code-color`, `--bs-danger` |
| `--dt-font`, `--dt-mono`, `--dt-font-size` | `--bs-body-font-family`, `--bs-font-monospace`, `0.875rem` (the popover's size) |

The title bar gets the popover header's background (`--bs-secondary-bg`) and bottom border, the hint line `--bs-secondary-color`, the encyclopedia's search field the look of a form control. The checked window had Bootstrap's body background, a radius of 8 px and 14 px text *(checked)*.

To change a value, add a rule after the theme on `.dt-win` (a rule on `:root` would be overridden by the theme): `.dt-win { --dt-radius: 0; --dt-shadow: none; }`.

## 4. Colour modes

`data-bs-theme="dark"` on `<html>` switches Bootstrap's variables, and the windows follow, title bar and links included *(checked)*. Windows are appended to `<body>`, so they follow the colour mode of `<html>`/`<body>`, not that of a dark navbar or card they belong to; inside an open modal or offcanvas (section 8) they take its mode. Bootstrap's `auto` mode is a script that sets `data-bs-theme` from `prefers-color-scheme`; the windows follow whatever it sets (the example does the same).

## 5. Bootstrap tooltips and popovers

- Never give one element both: two tooltips would open. Initialise Bootstrap's tooltips without the marked elements, as the example does *(checked: the tooltip element showed only Bootstrap's tooltip, the marked element only its DeepTip window)*:

  ```js
  for (const el of document.querySelectorAll('[data-bs-toggle="tooltip"]:not([data-deeptip])')) new bootstrap.Tooltip(el);
  ```

- Replacing a tooltip by DeepTip: move its text into the glossary (`data-bs-title` becomes the entry's `title` or `short`, longer help the `body` with `[[links]]`), remove `data-bs-toggle="tooltip"` and `data-bs-title`, add `data-deeptip="key"`. Popovers that explain something (a click opens them) become pinned DeepTip windows the same way; keyboard users open them with F1 or `?`.
- Short hints without depth may stay Bootstrap tooltips on unmarked elements.

## 6. Z-order

DeepTip windows are popovers in the browser's top layer, above every `z-index`: above Bootstrap's dropdowns (1000), sticky and fixed bars (1020, 1030), offcanvas (1045), the modal backdrop (1050) and modals (1055), tooltips and popovers (1070, 1080). A window opened from a button inside a modal, an offcanvas or a dropdown menu lay above all of them *(checked: the element at the window's centre was the window)*.

## 7. Esc

DeepTip consumes the Esc that closes one of its windows before the page sees it ([§9.3](../../docs/algorithms.md#93-keyboard)), so the first Esc in an open modal closes the DeepTip window and the modal stays; the next Esc closes the modal *(checked)*. The same holds for offcanvases and dropdowns (their Esc handlers listen on the element or on `document`, after DeepTip).

## 8. Modals and offcanvases: the focus trap

Bootstrap 5's modal and offcanvas keep the keyboard focus inside themselves: when the focus moves to an element outside (a `focusin` on `document`), they move it back. DeepTip's windows are appended to `<body>`, outside the modal, so a window opened with the keyboard (F1, `?`, Enter on a term) loses the focus at once *(checked: after F1 on a button in the modal the focus was back in the modal)*.

The fix: put DeepTip's windows inside the open modal or offcanvas, with the runtime's `container` option *(checked for both)*:

```js
// a modal or offcanvas traps the focus inside itself: DeepTip's windows go inside the open one
for (const type of ["modal", "offcanvas"]) {
  document.addEventListener(`show.bs.${type}`, (e) => dt.configure({ container: e.target }));
  document.addEventListener(`hide.bs.${type}`, () => dt.closeAll());
  document.addEventListener(`hidden.bs.${type}`, (e) => {
    if (dt.o.container === e.target) dt.configure({ container: null }); // a later modal may have taken over already
  });
}
```

- Inside the modal's DOM the windows still live in the top layer (position and z-order do not change), the focus stays in them, screen readers that treat the rest of the page as hidden (`aria-modal`) reach them, and they take the modal's colour mode.
- `hide` closes the windows before the modal goes; `hidden` resets the container only if it is still this modal: the `hidden` event of a closing modal comes after its fade-out, possibly after the next modal's `show` *(found and tested: resetting it unconditionally put the next modal's windows back into `<body>`)*.
- Alternative for modals: `data-bs-focus="false"` turns the trap off; the focus then stayed in the DeepTip window too *(checked)*, but the modal no longer keeps the focus for anyone. Offcanvases have no such option (their trap is off only with `data-bs-scroll="true"` and `data-bs-backdrop="false"`).

## 9. Dropdowns

Explained items in a dropdown menu work like any element (`data-deeptip-place="right,left"` keeps the window beside the menu). Two recipes avoid surprises:

```js
// a click inside a DeepTip window is not a click outside the menu
document.body.addEventListener("click", (e) => {
  if (e.target.closest?.(".dt-win")) e.stopPropagation();
});
// windows of menu items go with the menu
document.addEventListener("hide.bs.dropdown", (e) => {
  const menu = e.target.closest(".dropdown, .dropup, .dropend, .dropstart, .btn-group")?.querySelector(".dropdown-menu");
  for (const w of dt.wins.filter((w) => !w.parent && menu?.contains(w.anchor))) dt.close(w);
});
```

- Bootstrap closes an open menu on any click outside it (`autoClose`), and a DeepTip window is outside the menu: without the first recipe, pinning a term in the window of a menu item closed the menu. With it the menu stayed open and the window pinned *(checked)*. DeepTip's own click handling runs before, on `document` in the capture phase.
- A menu that closes hides its items; their windows would stay without a visible anchor. The second recipe closes them with the menu *(checked: a click elsewhere closed the menu and its windows)*.

## 10. Bootstrap Icons for pin and close

Optional: load `bootstrap-icons.css` and add the class `dt-bi` to `<body>`; the theme hides DeepTip's own icons and shows `bi-pin-angle` (pinned: `bi-pin-angle-fill`) and `bi-x-lg` *(checked: the codepoints `\f4eb`, `\f4ea`, `\f659` of Bootstrap Icons 1.13.2, the icon font loaded)*.

## 11. Bootstrap 4.6 *(verify)*

- No colour modes and no colour variables for the body, borders and shadows; 4.6 has `--primary`, `--danger`, `--font-family-sans-serif` and `--font-family-monospace` on `:root`. Use fixed values with those:

  ```css
  .dt-win, .dt-index, .dt-link {
    --dt-bg: #fff; --dt-fg: #212529; --dt-border: rgb(0 0 0 / 0.2); --dt-radius: 0.3rem;
    --dt-accent: var(--primary); --dt-pinned: var(--primary); --dt-link: var(--primary); --dt-missing: var(--danger);
    --dt-font: var(--font-family-sans-serif); --dt-mono: var(--font-family-monospace); --dt-font-size: 0.875rem;
  }
  ```

- Bootstrap 4's plugins are jQuery plugins and trigger jQuery events: listen with `$(document).on("show.bs.modal", …)`, not `addEventListener`, and use `data-toggle`, `data-focus` (without `bs-`). Its modal moves the focus back the same way (`_enforceFocus`, active unless `focus: false`), so the `container` fix of section 8 applies. Tooltips: `$('[data-toggle="tooltip"]').not("[data-deeptip]").tooltip()`.

## 12. Pitfalls

- **Stylesheet order**: the theme must come after `deeptip.css`; rules of your own for `.dt-win` after the theme.
- **Windows outside a dark component** stay in the page's colour mode (section 4).
- **CSS isolation of frameworks around Bootstrap** (scoped styles) cannot reach the windows; keep the theme global.
- **Two tooltip systems on one element** (section 5).
- **`data-bs-focus="false"`** makes the modal less accessible; prefer the `container` fix.

## 13. Tests

```bash
node frameworks/bootstrap/test/run.mjs     # Node 22+, Chrome/Chromium/Edge; --chrome <path>, --port, --profile, --shots <dir>
```

`test/run.mjs` serves the repository, opens `example/index.html?test` in headless Chrome and drives `test/checks.js` with real mouse and keyboard input through the DevTools protocol; console errors and warnings count as failures; `--shots` saves screenshots in light and dark mode and with a modal. The 12 checks: the theme in light and dark mode; a term previewed and pinned; a Bootstrap tooltip next to DeepTip; the modal's focus trap without the fix; the fix; the window above the modal and its backdrop; Esc in a modal; `data-bs-focus="false"`; the offcanvas with the fix; the dropdown recipes; Bootstrap Icons. On 2026-10-29: 12 of 12 passed. Bootstrap comes from jsDelivr, so the run needs network access.

The parser, the placement and the glossary flattening are the web runtime's: `npm test` runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 14. The example

```bash
npm run demo     # then http://localhost:5560/frameworks/bootstrap/example/
```

The same screen as `frameworks/web/example`, built with Bootstrap: a navbar with the HUD (`demo.realm`, `demo.stability` with `{stability}`, `demo.taxes` adding gold, `demo.nobles`, `demo.gold` with `{gold}`, a help button `deeptip.about` with delay 0), a dropdown with explained items, a language select (`en`, `de`, fallback `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), a colour mode select (light, dark, auto), four corner buttons, cards with a page text, a modal and an offcanvas with explained buttons, a button with an ordinary Bootstrap tooltip, the Bootstrap Icons switch, settings, the encyclopedia and an event log. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

## 15. Limitations

- The theme follows the colour mode of the element the windows are appended to, not that of each window's anchor.
- The recipes for modals, offcanvases and dropdowns are page code (the example's), not part of the theme file.
- Bootstrap 4.6 was not run.

## 16. Checklist

1. Load Bootstrap, then `deeptip.css`, then `deeptip-bootstrap.css`; start DeepTip once per page.
2. Mark elements with `data-deeptip`; keep Bootstrap tooltips off marked elements.
3. Add the modal/offcanvas `container` recipe and the dropdown recipes.
4. Set `data-bs-theme` on `<html>` for dark mode; optional: Bootstrap Icons with `dt-bi`.
5. Validate the glossaries (`tools/deeptip-check.mjs`), run `test/run.mjs`, compare with the web example.
