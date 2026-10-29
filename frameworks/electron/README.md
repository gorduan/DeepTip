# DeepTip in Electron: integration guide

How to use [DeepTip](../../README.md) (explanation windows with depth) in an Electron app.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. DeepTip runs in the renderer process, in every window that shows explained elements, with the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; the main process only serves files and, if you want, hands glossaries and live values to the renderer over IPC. This guide is the exact recipe around it. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). Statements marked *(checked)* were verified on 2026-10-29 with Electron 45.1.0 (Chromium 156, Node 24) on Windows 11: the code blocks that start with a file path ran in four windows (`loadFile` and a custom protocol, glossaries by `sources` and by IPC) with context isolation, the sandbox and a strict Content Security Policy, driven with real mouse and keyboard input through the DevTools protocol. *(verify)* marks statements taken from the Electron documentation that were not run.

## Quick start

**Recognise the project:** `electron` in the `devDependencies` of `package.json`, a main script that creates a `BrowserWindow` (`"main"` in `package.json`), often `forge.config.js`, `electron.vite.config.*` or `electron-builder.yml`.

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` into `app/deeptip/`, next to the window's `index.html`.
2. Write your glossary as `app/deeptip/en.json`.
3. Link the stylesheet and start DeepTip in a module script of the page, as below.
4. Mark an element with `data-deeptip="key"`.
5. Load the page with `win.loadFile("app/index.html")` and run `npx electron .`.

```html
<!-- app/index.html, loaded with win.loadFile("app/index.html") -->
<link rel="stylesheet" href="deeptip/deeptip.css" />
<button data-deeptip="shop.cart">Cart</button>
<script type="module">
  import { DeepTip } from "./deeptip/deeptip.js";
  DeepTip.init({ locale: "en", sources: ["deeptip/{locale}.json"] });
</script>
```

**Done when:** resting the pointer on the button opens a window with the entry's title, the button carries `data-dt-open` while it is open, the renderer's DevTools console shows no `DeepTip:` warning, nothing in the main process changed.

## 1. Files

| File | Where | Process |
|---|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | `app/deeptip/` (or your renderer's source folder) | renderer |
| your page and its module script | `app/index.html`, `app/renderer.js` | renderer |
| glossaries `glossary/core/<locale>.json` and yours | `app/deeptip/core/<locale>.json`, `app/deeptip/<locale>.json` | read by the renderer (sections 4a, 4b) or by the main process (4c) |
| `main.js`, optional `preload.cjs` | the app root | main, preload |

With a bundler (Electron Forge's Vite template, electron-vite) the runtime goes into the renderer's source folder and is bundled like any module; the glossaries go into the renderer's `public/` folder, which is copied to the output as it is, and `sources` stays relative *(verify)*. Download `DeepTip-electron-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

## 2. One controller per window

The Quick start works as it is *(checked)*. A real app moves the script into a file, so a strict Content Security Policy can forbid inline scripts (section 3).

Every `BrowserWindow` holds its own document, so each window that shows explained elements starts its own controller, once, in its renderer:

```js
// app/renderer.js
import { DeepTip } from "./deeptip/deeptip.js";

const host = window.deeptipHost; // from preload.cjs (contextBridge)
const viaIpc = new URLSearchParams(location.search).get("glossary") === "ipc";
const state = { stability: 1, gold: 1250 };
const signed = () => (state.stability > 0 ? "+" : "") + state.stability;
const T = {
  en: "Rest on a button. Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].",
  de: "Lass die Maus auf einem Knopf ruhen. Kreislauf: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].",
};

const dt = DeepTip.init({
  locale: "en",
  fallback: ["de", "en"],
  sources: viaIpc ? [] : ["deeptip/core/{locale}.json", "deeptip/{locale}.json"],
  vars: { stability: signed, gold: () => state.gold.toLocaleString(dt.locale) },
});

// glossaries read by the main process: core first, project after
const loaded = new Set();
async function ensure(locale) {
  if (!viaIpc) return;
  for (const l of [locale, ...dt.o.fallback]) {
    if (loaded.has(l)) continue;
    loaded.add(l);
    for (const layer of ["core", "project"]) {
      try {
        dt.add(l, await host.glossary(layer, l));
      } catch (e) {
        console.warn(`DeepTip: glossary ${layer}/${l}: ${e.message}`);
      }
    }
  }
}

function paint() {
  document.documentElement.lang = dt.locale;
  document.getElementById("stab").textContent = `Stability ${signed()}`;
  document.getElementById("gold").textContent = `Gold ${state.gold.toLocaleString(dt.locale)}`;
  dt.renderText(document.getElementById("intro"), T[dt.locale] ?? T.en);
}

await ensure(dt.locale);
await dt.ready;
paint();
dt.renderIndex(document.getElementById("index"));

document.getElementById("stab").addEventListener("click", () => {
  state.stability = state.stability >= 3 ? -3 : state.stability + 1;
  paint();
  dt.refresh();
});

// one language for every window: ask the main process, which tells every window (this one too)
document.getElementById("lang").addEventListener("change", (e) => host.setLocale(e.target.value));
host.onLocale(async (locale) => {
  await ensure(locale);
  await dt.setLocale(locale);
  document.getElementById("lang").value = locale;
  paint();
});

// live values pushed by the main process
host.onValues((values) => {
  Object.assign(state, values);
  paint();
  dt.refresh();
});
```

```html
<!-- app/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:" />
    <title>DeepTip in Electron</title>
    <link rel="stylesheet" href="deeptip/deeptip.css" />
    <link rel="stylesheet" href="app.css" />
    <script type="module" src="renderer.js"></script>
  </head>
  <body>
    <header>
      <button data-deeptip="demo.realm">Realm</button>
      <button data-deeptip="demo.stability" id="stab">Stability +1</button>
      <button data-deeptip="demo.gold" id="gold">Gold 1250</button>
      <button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
      <select id="lang" aria-label="Language">
        <option value="en">English</option>
        <option value="de">Deutsch</option>
      </select>
    </header>
    <p id="intro"></p>
    <div id="index"></div>
  </body>
</html>
```

Lifecycle, exactly:

- A module script runs once, after the document is parsed. `DeepTip.init` listens on the window's `document` and `window` and starts fetching `sources`; `await dt.ready` before `renderText`, or links to entries that are not loaded yet render as missing.
- A reload (`webContents.reload()`, `Ctrl+R`) starts a new document and a new controller; nothing has to be cleaned up. With a bundler's hot module replacement, dispose the old controller: `if (import.meta.hot) import.meta.hot.dispose(() => dt.destroy())`.
- DeepTip never needs Node.js, `require` or a preload script; the preload below exists only for IPC.

## 3. Security: context isolation, sandbox, CSP

```js
// main.js (excerpt)
const win = new BrowserWindow({
  width: 1000,
  height: 700,
  webPreferences: {
    preload: path.join(__dirname, "preload.cjs"), // only for the IPC calls of sections 4c and 6
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  },
});
```

- DeepTip works with context isolation and the sandbox: the checked renderer had neither `require` nor `process` *(checked)*.
- The Content Security Policy `default-src 'self'; script-src 'self'; style-src 'self'` is enough: DeepTip needs no inline script, no inline style and no `eval`; it creates nodes with `createElement`/`textContent` and sets styles through the CSSOM (`element.style.setProperty`), which a CSP does not restrict. The checked windows logged no violation, while an inline `<style>` added as a control was refused and logged *(checked)*. `'self'` covered the `file://` page as well as `app://bundle` *(checked)*.
- A meta tag is enough for pages you ship; for remote content set the header with `session.defaultSession.webRequest.onHeadersReceived` *(verify)*.
- Electron's security checklist prefers a custom protocol to `file://` for app pages (section 4b) *(verify)*.

## 4. Loading glossary files from the app

**a) Relative `sources` next to the page.** In Electron 45 a page loaded with `loadFile` can load module scripts and `fetch` JSON from `file://` (status 200), so `sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"]` works as on a web server *(checked)*. Paths are relative to the page.

**b) A privileged custom protocol** serves the app folder at `app://bundle/…`; `fetch`, module scripts and `'self'` behave as on a web origin *(checked)*:

```js
// main.js (excerpt)
const { app, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.join(__dirname, "app");
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]); // before "ready"

app.whenReady().then(() => {
  protocol.handle("app", (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    const rel = path.relative(root, file);
    if (host !== "bundle" || !rel || rel.startsWith("..") || path.isAbsolute(rel)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // … create the window, then win.loadURL("app://bundle/index.html")
});
```

**c) The main process reads the files** and the renderer adds them with `dt.add()` (`sources: []`, the `ensure()` function of section 2). Use it when the glossaries live outside the renderer's folder, for example next to the executable where translators or mods replace them:

```js
// preload.cjs
// Runs before the page, isolated from it (contextIsolation, sandbox). Exposes four calls, no Node.js.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deeptipHost", {
  glossary: (layer, locale) => ipcRenderer.invoke("deeptip:glossary", layer, locale),
  setLocale: (locale) => ipcRenderer.send("deeptip:set-locale", locale),
  onLocale: (callback) => ipcRenderer.on("deeptip:locale", (_event, locale) => callback(locale)),
  onValues: (callback) => ipcRenderer.on("deeptip:values", (_event, values) => callback(values)),
});
```

```js
// main.js (excerpt)
const { BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");

ipcMain.handle("deeptip:glossary", async (_event, layer, locale) => {
  if (!["core", "project"].includes(layer) || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(String(locale))) throw new Error("invalid glossary name");
  const file = layer === "core" ? path.join(root, "deeptip", "core", `${locale}.json`) : path.join(root, "deeptip", `${locale}.json`);
  return JSON.parse(await fs.promises.readFile(file, "utf8"));
});

ipcMain.on("deeptip:set-locale", (_event, locale) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("deeptip:locale", locale);
});
```

- Validate every name that arrives over IPC before it becomes a path: the checked handler refused `"../../main"` *(checked)*.
- Packaged apps: files inside `app.asar` are readable through `fetch`, `net.fetch` and `fs` (Electron's asar support), so a, b and c keep working; files that users may replace belong in `extraResources` and are read from `process.resourcesPath` with variant c *(verify)*.

## 5. Mark elements, terms in page texts, encyclopedia

- `data-deeptip="key"` on any element, optional `data-deeptip-delay="0"` and `data-deeptip-place="top,bottom"` ([SPEC §4](../../SPEC.md#4-placement)). The element keeps its own click action ([SPEC §3.3](../../SPEC.md#33-opening)) *(checked: the Stability button's click handler ran while its window was open)*.
- Page texts: `dt.renderText(element, "… [[key]] …")` after `dt.ready`, and again after every `setLocale` (`paint()` above); `renderText` targets are not re-rendered by `refresh()` ([§3](../../docs/algorithms.md#3-rendering-the-ast)).
- Encyclopedia: `dt.renderIndex(container)` once; it is re-rendered on every refresh ([§12](../../docs/algorithms.md#12-encyclopedia)). Call `dt.removeIndex(container)` when you remove the container. A separate "glossary" `BrowserWindow` is just another page with its own controller.
- Do not give marked elements a `title` (two tooltips).

## 6. Live values and language

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Values that live in the renderer: functions in `vars` and `dt.refresh()` after changes. Values that live in the main process: send them (`win.webContents.send("deeptip:values", { gold: 1300 })`), merge them in `onValues` and call `refresh()`; the open Gold window changed from 1,250 to 1,300 *(checked)*.
- One language for all windows: the renderer asks the main process (`host.setLocale(…)`), the main process sends `deeptip:locale` to every window, each window calls `dt.setLocale()` and re-renders its page texts. All four checked windows switched to German *(checked)*.
- The system language: `app.getPreferredSystemLanguages()` or `app.getLocale()` in the main process, passed to the page (for example `win.loadFile("app/index.html", { query: { locale } })`), or `navigator.language` in the renderer *(verify)*.

## 7. Several windows

Each `BrowserWindow` has its own controller and its own DeepTip windows, and a DeepTip window cannot leave the `BrowserWindow` it belongs to: it is part of that page and is clipped to its content area. Placement keeps it inside ([§8](../../docs/algorithms.md#8-placement)), so very small windows (tool palettes) show narrow explanations. Child and modal `BrowserWindow`s are separate documents too: start DeepTip in their renderer as well.

## 8. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body` of each page: windows are appended to `document.body`. Hooks on your own elements: `[data-dt-open]` while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it. `color-scheme: light dark` on `:root` lets the built-in light and dark defaults follow `nativeTheme.themeSource` *(verify)*.

## 9. Pitfalls

- **Native parts cannot host DeepTip**: application menus, the tray, the native title bar and the `title` tooltip are drawn by the operating system.
- **Drag regions swallow the pointer**: elements inside `-webkit-app-region: drag` (frameless windows) receive no pointer events, so they never open a window; give marked elements `-webkit-app-region: no-drag` *(verify)*.
- **Esc and F1**: DeepTip consumes Esc on `document` while one of its windows is open ([§9.3](../../docs/algorithms.md#93-keyboard)), so page handlers do not see it; `before-input-event` handlers and `globalShortcut` in the main process see keys before the page does and can take Esc or F1 away from DeepTip *(verify)*.
- **Hidden windows**: a window created with `show: false` received mouse input from the DevTools protocol only about once per second, too slow for the 300 ms grace; use visible windows or `webPreferences.offscreen: true` for automated tests *(checked)*.
- **One controller per document**: do not start DeepTip in a preload script and again in the page.

## 10. Testing

- The checked tests ran inside the app: hidden windows with `offscreen: true`, input through `webContents.debugger`, results read with `executeJavaScript`, then `app.quit()`:

  ```js
  wc.debugger.attach("1.3");
  await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  const open = await wc.executeJavaScript(`!!document.querySelector('.dt-win[data-dt-key="demo.stability"]:popover-open')`);
  ```

  Count open windows with `:popover-open`: a closing window stays in the DOM until its fade-out ends.
- Playwright's `_electron.launch()` drives the same checks from outside *(verify)*.
- The parser, the placement and the glossary flattening are the web runtime's: `npm test` in the repository runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 11. The example to build

The same screen as `frameworks/web/example`, as the renderer page of a `BrowserWindow`: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`, here also pushed from the main process), a help button `deeptip.about` with `data-deeptip-delay="0"`, a language select (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms, settings (delay, lock, buttons, hints through `dt.configure`) and the encyclopedia. A second window loads the same page and follows the language switch over IPC. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`. Sections 2 to 6 are the checked core of it. Compare its behaviour with the web example: `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 12. Limitations

None beyond the web runtime's inside a window. DeepTip windows stay inside their `BrowserWindow`, and native menus, the tray and the title bar cannot show them.

## 13. Checklist

1. Copy `deeptip.js`, `deeptip.css` and the glossaries next to the renderer page; link the stylesheet.
2. Start one controller per window in a module script; keep context isolation, the sandbox and a strict CSP.
3. Load glossaries by relative `sources`, through a custom protocol, or from the main process over IPC (validate the names).
4. Mark elements, render page texts after `ready` and after `setLocale`, render the encyclopedia.
5. Broadcast language changes and main-process values to every window; call `refresh()` after values change.
6. Validate the glossaries with `tools/deeptip-check.mjs --scan app`; test in a visible or offscreen window and compare with the web example.
