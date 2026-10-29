# DeepTip in Tauri 2: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) in a Tauri 2 app.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. A Tauri app shows its interface in a webview, so the frontend uses the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; the Rust side is optional and only needed when glossaries or live values come from Rust. (The Rust crate in [frameworks/rust-egui](../rust-egui/README.md) is for egui apps, not for Tauri.) This guide is the exact recipe around it. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). Statements marked *(checked)* were verified on 2026-10-29 on Windows 11 with Tauri 2.12 (`tauri` 2.12.5, CLI and `@tauri-apps/api` 2.12.4, Rust 1.99) in WebView2 (Edge 156): the code blocks that start with a file path were built with `tauri build --debug --no-bundle`, and the app ran with three hidden windows that were driven with real mouse and keyboard input over WebView2's remote debugging. *(verify)* marks statements taken from the Tauri documentation that were not run, among them everything about macOS (WKWebView) and Linux (WebKitGTK).

## Quick start

**Recognise the project:** `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` with `tauri = "2…"`, `@tauri-apps/cli` in `package.json`.

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` into `deeptip/` of the frontend's static files (the folder `build.frontendDist` points at, or Vite's `public/`).
2. Write your glossary as `deeptip/en.json` in the same place.
3. Link the stylesheet and start DeepTip in a module script of the page, as below.
4. Mark an element with `data-deeptip="key"`.
5. `npm run tauri dev` and rest the pointer on the button.

```html
<!-- index.html of the frontend -->
<link rel="stylesheet" href="deeptip/deeptip.css" />
<button data-deeptip="shop.cart">Cart</button>
<script type="module">
  import { DeepTip } from "./deeptip/deeptip.js";
  DeepTip.init({ locale: "en", sources: ["deeptip/{locale}.json"] });
</script>
```

**Done when:** resting the pointer on the button opens a window with the entry's title, the button carries `data-dt-open` while it is open, the webview's DevTools console shows no `DeepTip:` warning and no CSP violation, `tauri build` runs without errors.

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | the frontend's static files, e.g. `dist/deeptip/` (plain frontend) or `public/deeptip/` (Vite); with a bundler you may also import the module from `src/` |
| glossaries `glossary/core/<locale>.json` and yours | `deeptip/core/<locale>.json`, `deeptip/<locale>.json` next to them (section 3a), or `src-tauri/glossary/…` as bundle resources (section 3b) |
| your module script | `main.js` (section 2) |
| optional Rust commands | `src-tauri/src/lib.rs` (sections 3b and 6) |

Everything in `frontendDist` is embedded in the binary at build time and served from the app origin, `http://tauri.localhost` on Windows *(checked)* and `tauri://localhost` on macOS and Linux *(verify)*. React, Vue, Svelte and Angular frontends work the same way; their guides ([React](../react/README.md), [Vue](../vue/README.md), [Svelte](../svelte/README.md), [Angular](../angular/README.md)) show where the calls go. Download `DeepTip-tauri-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

## 2. One controller per webview window

Every Tauri window is its own document, so each window that shows explained elements starts its own controller, once, in its module script:

```js
// dist/main.js
import { DeepTip } from "./deeptip/deeptip.js";

// withGlobalTauri: true; with a bundler: import { invoke } from "@tauri-apps/api/core" and { listen, emit } from "@tauri-apps/api/event"
const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;

const params = new URLSearchParams(location.search);
const fromResources = params.get("glossary") === "resources";
const state = { stability: 1, gold: 1250 };
const signed = () => (state.stability > 0 ? "+" : "") + state.stability;
const T = {
  en: { intro: "Rest on a button. Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]]." },
  de: { intro: "Lass die Maus auf einem Knopf ruhen. Kreislauf: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]]." },
};

const dt = DeepTip.init({
  locale: "en",
  fallback: ["de", "en"],
  sources: fromResources ? [] : ["deeptip/core/{locale}.json", "deeptip/{locale}.json"],
  vars: {
    stability: signed,
    gold: () => state.gold.toLocaleString(dt.locale),
  },
});

// variant (b): glossaries as bundle resources, read by the Rust command `glossary`
async function loadResources(locales) {
  for (const locale of locales) {
    for (const layer of ["core", "example"]) {
      try {
        dt.add(locale, JSON.parse(await invoke("glossary", { layer, locale })));
      } catch (e) {
        console.warn(`DeepTip: glossary ${layer}/${locale}: ${e}`);
      }
    }
  }
}

const loaded = new Set();
async function ensure(locale) {
  if (!fromResources) return;
  const missing = [locale, ...dt.o.fallback].filter((l) => !loaded.has(l));
  missing.forEach((l) => loaded.add(l));
  await loadResources(missing);
}

function paint() {
  document.documentElement.lang = dt.locale;
  document.getElementById("stab").textContent = `Stability ${signed()}`;
  document.getElementById("gold").textContent = `Gold ${state.gold.toLocaleString(dt.locale)}`;
  dt.renderText(document.getElementById("intro"), T[dt.locale].intro);
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

// one language for every window: the select emits, every window (this one too) listens
document.getElementById("lang").addEventListener("change", (e) => emit("deeptip-locale", e.target.value));
await listen("deeptip-locale", async (e) => {
  await ensure(e.payload);
  await dt.setLocale(e.payload);
  document.getElementById("lang").value = e.payload;
  paint();
});

// live values that change in Rust
await listen("deeptip-values", (e) => {
  state.gold = e.payload.gold;
  paint();
  dt.refresh();
});
```

```html
<!-- dist/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DeepTip in Tauri</title>
    <link rel="stylesheet" href="deeptip/deeptip.css" />
    <link rel="stylesheet" href="app.css" />
    <script type="module" src="main.js"></script>
  </head>
  <body>
    <header>
      <button data-deeptip="demo.realm" id="realm">Realm</button>
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

- The module script runs once per window, after the page is parsed. `DeepTip.init` listens on the window's `document` and `window` and starts fetching `sources`; `await dt.ready` before `renderText`, or links to entries that are not loaded yet render as missing.
- `window.__TAURI__` exists because the checked app set `app.withGlobalTauri: true`; with a bundler, import the same functions from `@tauri-apps/api`.
- A reload of the webview starts a new document and a new controller. In `tauri dev` with Vite, dispose the old controller on hot module replacement: `if (import.meta.hot) import.meta.hot.dispose(() => dt.destroy())`.

## 3. Glossary files

**a) In the frontend.** Files under `frontendDist` are embedded and fetched by `sources` from the app origin like from a web server: the main window loaded `deeptip/core/{locale}.json` and `deeptip/{locale}.json` this way *(checked)*. This is the simplest choice and needs no Rust.

**b) As bundle resources, read by a Rust command.** Use it when the files must stay replaceable after installation (translators, mods): they are installed next to the executable and read at run time.

```jsonc
// src-tauri/tauri.conf.json (excerpt)
{
  "bundle": { "resources": ["glossary/**/*"] }
}
```

```rust
// src-tauri/src/lib.rs
use std::sync::atomic::{AtomicI64, Ordering};
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

static GOLD: AtomicI64 = AtomicI64::new(1250);

/// One glossary file shipped as a bundle resource: glossary/<layer>/<locale>.json.
#[tauri::command]
fn glossary(app: AppHandle, layer: String, locale: String) -> Result<String, String> {
    let safe = |s: &str| {
        !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    if !safe(&layer) || !safe(&locale) {
        return Err(format!("invalid glossary name {layer}/{locale}"));
    }
    let path = app
        .path()
        .resolve(format!("glossary/{layer}/{locale}.json"), BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// State that lives in Rust changes: every window hears it and refreshes its open DeepTip windows.
#[tauri::command]
fn earn(app: AppHandle, amount: i64) -> Result<i64, String> {
    let gold = GOLD.fetch_add(amount, Ordering::SeqCst) + amount;
    app.emit("deeptip-values", serde_json::json!({ "gold": gold }))
        .map_err(|e| e.to_string())?;
    Ok(gold)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![glossary, earn])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- The second window loaded every glossary through `invoke("glossary", { layer, locale })` and `dt.add()`, with `sources: []` (the `ensure()` function of section 2) *(checked)*. The order of the calls is the layer order: core first, project after ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- Validate every name that arrives from the webview before it becomes a path: `glossary("..", "en")` was refused *(checked)*.
- The app's own commands needed no permission entry; the capability `core:default` covered the `listen`/`emit` event calls *(checked)*.
- A build with `--no-bundle` copies the resources next to the executable (`target/debug/glossary/…`), so `BaseDirectory::Resource` resolves during development too *(checked)*.

**c) Other ways**: the `fs` plugin reads files from the frontend with scoped permissions, and the asset protocol (`convertFileSrc`) turns a file path into a URL that `fetch` accepts once `app.security.assetProtocol` allows its scope *(verify)*. Both need more configuration than a and b.

## 4. Content Security Policy

```jsonc
// src-tauri/tauri.conf.json (excerpt)
{
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost"
    }
  }
}
```

- Tauri sends this policy as an HTTP header with every page and adds `sha256` hashes for its own scripts and for inline scripts in your HTML to `script-src`, so the Quick start page with its inline module script ran under this policy *(checked: three hashes on that page)*.
- DeepTip needs no inline script, no inline style and no `eval`; it creates nodes with `createElement`/`textContent` and sets styles through the CSSOM (`element.style.setProperty`), which a CSP does not restrict. No window logged a violation (a recorder for `securitypolicyviolation` ran from the start of each page) *(checked)*.
- `connect-src ipc: http://ipc.localhost` is what Tauri's own IPC (`invoke`, events) needs; `fetch` of `sources` is covered by `'self'` *(checked)*.

## 5. Mark elements, terms in page texts, encyclopedia

- `data-deeptip="key"` on any element, optional `data-deeptip-delay="0"` and `data-deeptip-place="top,bottom"` ([SPEC §4](../../SPEC.md#4-placement)). The element keeps its own click action ([SPEC §3.3](../../SPEC.md#33-opening)) *(checked: the Stability button's handler ran while its window was open, the window showed `+2`)*.
- Page texts: `dt.renderText(element, "… [[key]] …")` after `dt.ready`, and again after every `setLocale` (`paint()` above); `refresh()` does not re-render them ([§3](../../docs/algorithms.md#3-rendering-the-ast)).
- Encyclopedia: `dt.renderIndex(container)` once; it is re-rendered on every refresh ([§12](../../docs/algorithms.md#12-encyclopedia)); `dt.removeIndex(container)` when the container goes.
- Do not give marked elements a `title` (two tooltips).

## 6. Live values and language

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Values that live in the frontend: functions in `vars` and `dt.refresh()` after changes. Values that live in Rust: emit an event (`app.emit("deeptip-values", …)`), merge the payload and call `refresh()`; `invoke("earn", { amount: 50 })` changed the open Gold window from 1,250 to 1,300 and the Gold button of the second window *(checked)*.
- One language for all windows: the select emits `deeptip-locale`, every window listens, loads what it needs and calls `dt.setLocale()`; both windows switched to German *(checked)*. Start with the system language from `navigator.language` *(verify)*.

## 7. Several windows

Each webview window has its own controller and its own DeepTip windows; a DeepTip window cannot leave the Tauri window it belongs to (it is part of that page and is clipped to it). List every window that calls Tauri APIs in the capability's `windows` (the checked app: `["main", "second"]`).

## 8. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body` of each page: windows are appended to `document.body`. Hooks on your own elements: `[data-dt-open]` while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it.

## 9. Webviews and pitfalls

- **WebView2 (Windows)** has the Popover API and CSS anchor positioning, so windows are placed by CSS (`data-dt-engine="css"`) *(checked: `dt.css` true, Edge 156)*. **WKWebView (macOS)** and **WebKitGTK (Linux)** follow their WebKit version; where CSS anchor positioning is missing, the runtime measures and places windows itself ([§8](../../docs/algorithms.md#8-placement)), so the behaviour stays the same *(verify)*.
- **Drag regions**: elements with `data-tauri-drag-region` start a window drag on mouse-down; do not put marked elements inside them *(verify)*.
- **Esc and F1**: DeepTip consumes Esc on `document` while one of its windows is open ([§9.3](../../docs/algorithms.md#93-keyboard)); Esc closed the newest window in the checked app *(checked)*. Global shortcuts registered with the global-shortcut plugin take keys before the webview sees them *(verify)*.
- **One controller per document**: do not start DeepTip twice in the same page (for example in a framework component and again in `main.js`).

## 10. Testing

- The checked run started the built app with the environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9721`, which opens WebView2's DevTools protocol; a Node script attached to each window, moved the mouse with `Input.dispatchMouseEvent`, read the results with `Runtime.evaluate` and ended the app. Windows created with `"visible": false` received this input at full rate *(checked)*.
- `tauri-driver` runs WebDriver tests on Windows and Linux *(verify)*.
- Count open windows with `:popover-open`: a closing window stays in the DOM until its fade-out ends.
- The parser, the placement and the glossary flattening are the web runtime's: `npm test` in the repository runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 11. The example to build

The same screen as `frameworks/web/example`, as the frontend of a Tauri window: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`, here changed by a Rust command), a help button `deeptip.about` with `data-deeptip-delay="0"`, a language select (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English *(checked)*), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms, settings (delay, lock, buttons, hints through `dt.configure`) and the encyclopedia. A second window loads its glossaries from the bundle resources and follows the language switch. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`. Sections 2 to 6 are the checked core of it. Compare its behaviour with the web example: `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 12. Limitations

None beyond the web runtime's inside a window. DeepTip windows stay inside their Tauri window, native menus and the tray cannot show them, and placement quality on macOS and Linux depends on the system webview.

## 13. Checklist

1. Copy `deeptip.js`, `deeptip.css` and the glossaries into the frontend's static files; link the stylesheet.
2. Start one controller per window in a module script.
3. Choose where glossaries live: embedded in the frontend (`sources`) or as bundle resources read by a validated Rust command (`dt.add`).
4. Set a strict `app.security.csp`; DeepTip needs no exception.
5. Mark elements, render page texts after `ready` and after `setLocale`, render the encyclopedia; emit Rust values and language changes to every window.
6. Validate the glossaries with `tools/deeptip-check.mjs --scan src`; test with WebView2 remote debugging and compare with the web example.
