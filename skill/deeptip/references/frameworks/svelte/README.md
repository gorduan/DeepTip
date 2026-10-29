# DeepTip in Svelte: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) in a Svelte 5 app (Vite, SvelteKit).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. In Svelte you use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; this guide is the exact recipe around it. It works by event delegation on `document`, so Svelte needs no action per element: one controller started in the root component, `data-deeptip` attributes, and two attachments for texts and the encyclopedia. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). The code blocks that start with a file path were compiled with Svelte 5.57, built with Vite 8, and the built app was run in Chromium: page texts after `ready`, encyclopedia, rest opens a window, live value update, language switch (2026-10-29).

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | `src/lib/deeptip/` |
| the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) (TypeScript projects) | `src/lib/deeptip/deeptip.d.ts` |
| glossaries `glossary/core/<locale>.json` and yours | Vite: `public/deeptip/…`, SvelteKit: `static/deeptip/…` (`core/<locale>.json`, `<locale>.json`): served as static files, fetched per language |

Download `DeepTip-svelte-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

## 2. The controller: started by the root component

```js
// src/lib/deeptip.svelte.js
import { DeepTip } from "./deeptip/deeptip.js";

/** Reactive state of the page's one controller. */
export const tip = $state({ dt: null, locale: "en", ready: false });

/** Start DeepTip in onMount of the root component and return the result: it is the cleanup. */
export function startDeepTip(options) {
  const dt = DeepTip.init(options);
  tip.dt = dt; // a class instance: $state stores it as it is, without a proxy
  tip.locale = dt.locale;
  dt.ready.then(() => {
    if (tip.dt === dt) tip.ready = true;
  });
  return () => {
    dt.destroy();
    if (tip.dt === dt) Object.assign(tip, { dt: null, ready: false });
  };
}

/** Switch language: waits for the glossary files of the new language, then the page follows. */
export async function setLocale(locale) {
  await tip.dt?.setLocale(locale); // re-renders DeepTip's windows and indexes
  tip.locale = locale;
}

/** {@attach deeptipText(text)}: markup with live terms. DeepTip owns the element's children. */
export function deeptipText(text) {
  return (element) => {
    // runs again when the glossaries arrive or the language changes (link titles change with it)
    if (tip.ready && tip.locale) tip.dt.renderText(element, text);
  };
}

/** {@attach deeptipIndex()}: the encyclopedia; DeepTip keeps it current until the element goes. */
export function deeptipIndex(options) {
  return (element) => {
    const dt = tip.dt;
    if (!dt) return;
    dt.renderIndex(element, options);
    return () => dt.removeIndex(element);
  };
}
```

Lifecycle, exactly:

- `DeepTip.init` listens on `document` and `window` at once and starts fetching `sources`; `dt.ready` settles when they are loaded. `onMount` runs in the browser only, once, after the root component is in the DOM; the function it returns runs when the component is destroyed and calls `destroy()`, which closes all windows and removes every listener and observer.
- Attachments ([`{@attach}`](https://svelte.dev/docs/svelte/@attach), Svelte 5.29+) run in an effect: they run again when the `$state` they read changes (`tip.ready`, `tip.locale`) or when their argument changes (`text`), and their returned function cleans up.
- Hot module replacement re-mounts an edited component: the root's cleanup destroys the controller and `onMount` starts a new one; open windows close.

## 3. Mark elements

```svelte
<button data-deeptip="demo.realm">{t.realm}</button>
<button data-deeptip={entryKey}>{label}</button>
<button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input /></label>
```

No action is needed: Svelte writes `data-*` attributes as they are, and DeepTip finds them by delegation. `data-deeptip-delay` overrides `delay` for one element, `data-deeptip-place` the side order ([SPEC §4](../../SPEC.md#4-placement)). Your `onclick` keeps working: DeepTip never consumes a normal click on the element, only the click that ends a touch long-press ([SPEC §3.3](../../SPEC.md#33-opening)). Do not give marked elements a `title` (two tooltips); use `aria-label` for icon buttons. The validator's `--scan` finds keys written as `data-deeptip="key"` and `data-deeptip={"key"}`.

## 4. Live values and language

```svelte
<!-- src/App.svelte -->
<script>
  import { onMount } from "svelte";
  import { tip, startDeepTip, setLocale, deeptipText, deeptipIndex } from "./lib/deeptip.svelte.js";
  import "./lib/deeptip/deeptip.css";

  const T = {
    en: {
      realm: "Realm", stability: "Stability", taxes: "Taxes", nobles: "Nobles", gold: "Gold", levels: ["low", "normal", "high"],
      intro: "**Rest** the pointer on a button. Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]].",
    },
    de: {
      realm: "Reich", stability: "Stabilität", taxes: "Steuern", nobles: "Adel", gold: "Gold", levels: ["niedrig", "normal", "hoch"],
      intro: "Lass die Maus auf einem Knopf **ruhen**. Kreislauf: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]].",
    },
  };
  const INCOME = [50, 120, 260];

  let stability = $state(1);
  let tax = $state(1);
  let gold = $state(1250);
  const t = $derived(T[tip.locale] ?? T.en);
  const signed = $derived((stability > 0 ? "+" : "") + stability);

  onMount(() => startDeepTip({ locale: "en", fallback: ["de", "en"], sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] }));

  // live values: push them; configure() replaces `vars` and re-renders the open windows
  $effect(() => {
    tip.dt?.configure({ vars: { stability: signed, gold: gold.toLocaleString(tip.locale) } });
  });

  function raiseTaxes() {
    tax = (tax + 1) % 3;
    gold += INCOME[tax];
  }
</script>

<header>
  <button data-deeptip="demo.realm">{t.realm}</button>
  <button data-deeptip="demo.stability" onclick={() => (stability = stability >= 3 ? -3 : stability + 1)}>{t.stability} {signed}</button>
  <button data-deeptip="demo.taxes" onclick={raiseTaxes}>{t.taxes}: {t.levels[tax]}</button>
  <button data-deeptip="demo.nobles">{t.nobles}</button>
  <button data-deeptip="demo.gold">{t.gold} {gold.toLocaleString(tip.locale)}</button>
  <button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
  <select value={tip.locale} aria-label="Language" onchange={(e) => setLocale(e.currentTarget.value)}>
    <option value="en">English</option>
    <option value="de">Deutsch</option>
  </select>
</header>
<div {@attach deeptipText(t.intro)}></div>
<div {@attach deeptipIndex()}></div>

<style>
  /* hooks on this component's own elements: :global(), the attributes are added at runtime */
  button:global([data-dt-open]) {
    border-color: var(--dt-accent, #0b69d4);
  }
</style>
```

```js
// src/main.js
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app") });
```

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Pushing them with `configure({ vars })` in an `$effect` fits runes; `configure({ vars })` replaces all `vars`, so keep them in one place. Alternatively pass functions in the options (`vars: { gold: () => game.gold }`) and call `tip.dt.refresh()` after changes.
- `setLocale()` waits for the files of the new language, then sets `tip.locale`: DeepTip's windows and indexes re-render at once, `t` follows, and the text attachment renders the intro again.
- Svelte before 5.29 has no `{@attach}`; write the text as an action instead: `use:text={t.intro}` with `function text(node, src) { const render = (s) => tip.ready && tip.dt.renderText(node, s); render(src); return { update: render }; }`, and render again after `setLocale()`.

This is the HUD of the web example (`demo.realm`, `demo.stability`, `demo.taxes`, `demo.nobles`, `demo.gold`, the help button `deeptip.about`) with the same glossaries. Its behaviour equals [frameworks/web/example](https://github.com/gorduan/DeepTip/blob/main/frameworks/web/example/index.html): `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 5. SvelteKit and server rendering

```svelte
<!-- src/routes/+layout.svelte (SvelteKit) -->
<script>
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { startDeepTip } from "$lib/deeptip.svelte.js";
  import "$lib/deeptip/deeptip.css";

  let { children } = $props();
  onMount(() => startDeepTip({ locale: "en", sources: [`${base}/deeptip/core/{locale}.json`, `${base}/deeptip/{locale}.json`] }));
</script>

{@render children()}
```

- `onMount`, `$effect` and attachments never run on the server, so neither does DeepTip; importing `deeptip.js` there is safe (it touches no DOM at import).
- The module state `tip` is shared by all requests on the server, but only browser code changes it: the server always renders its defaults.
- `data-deeptip` attributes are rendered on the server and hydrate unchanged. DeepTip changes the DOM only after `init`: windows go to `document.body` (outside the app), anchors get `data-dt-open`, `aria-describedby` and an inline `anchor-name` while a window is open. Svelte updates only the attributes it renders.
- Elements with the text and index attachments are empty in the server HTML; DeepTip fills them after hydration.

## 6. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body` in a global stylesheet: windows are appended to `document.body`, so properties set on the app's root element do not reach them. A component's `<style>` is scoped: style the windows with `:global(.dt-win)` (or globally), and the runtime hooks of your own elements with `:global()` as above, `[data-dt-open]` while its window is open and `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it.

## 7. Pitfalls

- A marked element that Svelte replaces (a keyed `{#each}` with new keys, `{#if}` swapping elements) closes its preview; a pinned window stays where it was ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Keep keys stable.
- Do not bind the whole `style` attribute of a marked element as one dynamic string: it replaces the inline `anchor-name` DeepTip sets while a window is open. `style:property={…}` directives are fine.
- Elements with the text or index attachment must stay empty in the markup.
- One controller per document: start it in the root component or layout only.
