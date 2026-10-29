# DeepTip in Vue: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) in a Vue 3 app (Vite, Nuxt …).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. In Vue you use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; this guide is the exact recipe around it. It works by event delegation on `document`, so Vue needs no component per element: a plugin that owns the one controller, `data-deeptip` attributes, and two directives for texts and the encyclopedia. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). The code blocks that start with a file path were type-checked with `vue-tsc` (Vue 3.5, TypeScript 5.9, strict), built with Vite 8, and the built app was run in Chromium: page texts after `ready`, encyclopedia, rest opens a window, live value update, language switch (2026-10-29).

## Quick start

**Recognise the project:** `vue` (version 3) in `package.json` and `.vue` files; Nuxt adds `nuxt` and `nuxt.config.ts`.

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` to `src/deeptip/`; TypeScript projects also need the declarations (section 1).
2. Copy `glossary/core/en.json` to `public/deeptip/core/en.json`; your own entries go to `public/deeptip/en.json`.
3. Create the one controller when the root component mounts and destroy it when it unmounts (below; Nuxt and server rendering: section 5).
4. Mark elements with `data-deeptip="key"` (section 3); the plugin of section 2 adds `useDeepTip`, `v-deeptip-text` and `v-deeptip-index`.
5. Validate the glossary files: `node <DeepTip>/tools/deeptip-check.mjs --base en public/deeptip/core/en.json public/deeptip/en.json`.

```vue
<!-- src/App.vue -->
<script setup>
import { onMounted, onUnmounted } from "vue";
import { DeepTip } from "./deeptip/deeptip.js";
import "./deeptip/deeptip.css";

let dt = null;
onMounted(() => (dt = DeepTip.init({ locale: "en", sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] })));
onUnmounted(() => dt?.destroy());
</script>

<template>
  <button data-deeptip="deeptip.about" aria-label="Help">?</button>
</template>
```

**Done when:** resting on `?` for 800 ms opens the *DeepTip* window below it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows, `Esc` closes the newest window, the validator reports 0 errors.

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | `src/deeptip/` |
| the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) (TypeScript projects) | `src/deeptip/deeptip.d.ts` |
| glossaries `glossary/core/<locale>.json` and yours | `public/deeptip/core/<locale>.json`, `public/deeptip/<locale>.json`: served as static files, fetched per language |

Download `DeepTip-vue-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository. Plain JavaScript projects use the same code without the type annotations.

Nothing is ported: the parser, the placement and the glossary flattening are the web runtime's, and `npm test` in the DeepTip repository runs them against `test/cases/*.json` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 2. The plugin: one controller per app

```ts
// src/deeptip/plugin.ts
import { inject, ref, type App, type Directive, type InjectionKey, type Ref } from "vue";
import { DeepTip, type DeepTipOptions } from "./deeptip.js";

export interface DeepTipContext {
  /** The page's one controller; null during server rendering. */
  dt: DeepTip | null;
  /** The language DeepTip shows; changes once setLocale() has loaded it. */
  locale: Readonly<Ref<string>>;
  setLocale(locale: string): Promise<void>;
}

const KEY: InjectionKey<DeepTipContext> = Symbol("DeepTip");

export function createDeepTip(options: DeepTipOptions) {
  return {
    install(app: App) {
      // in the browser only: a server has no document to listen on
      const dt = typeof window === "undefined" ? null : DeepTip.init(options);
      const locale = ref(options.locale ?? "en");
      app.provide(KEY, {
        dt,
        locale,
        async setLocale(next: string) {
          await dt?.setLocale(next); // loads the missing glossary files, re-renders windows and indexes
          locale.value = next; // components re-render, v-deeptip-text renders their texts again
        },
      });
      // markup with live terms, after the glossaries are loaded; DeepTip owns the element's children
      const text = (el: HTMLElement, value: string) => void dt?.ready.then(() => dt.renderText(el, value));
      app.directive<HTMLElement, string>("deeptip-text", {
        mounted: (el, binding) => text(el, binding.value),
        updated: (el, binding) => text(el, binding.value),
      });
      // the encyclopedia; DeepTip re-renders it on every refresh() until it is removed
      app.directive<HTMLElement, { search?: boolean } | undefined>("deeptip-index", {
        mounted: (el, binding) => void dt?.renderIndex(el, binding.value),
        unmounted: (el) => dt?.removeIndex(el),
      });
      app.onUnmount(() => dt?.destroy()); // Vue 3.5+
    },
  };
}

export function useDeepTip(): DeepTipContext {
  const context = inject(KEY);
  if (!context) throw new Error("DeepTip: app.use(createDeepTip(options)) is missing");
  return context;
}

declare module "vue" {
  interface GlobalDirectives {
    vDeeptipText: Directive<HTMLElement, string>;
    vDeeptipIndex: Directive<HTMLElement, { search?: boolean } | undefined>;
  }
}
```

```ts
// src/main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { createDeepTip } from "./deeptip/plugin";
import "./deeptip/deeptip.css";

createApp(App)
  .use(createDeepTip({ locale: "en", fallback: ["de", "en"], sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] }))
  .mount("#app");
```

Lifecycle, exactly:

- `DeepTip.init` listens on `document` and `window` at once and starts fetching `sources`; `dt.ready` settles when they are loaded. `app.use()` runs once per app, before any component, so every component's `useDeepTip()` finds the controller.
- Directive hooks run in the browser only. `v-deeptip-text` renders after `dt.ready` (before it, links to entries that are not loaded yet would render as missing) and again on every update of its component.
- `app.unmount()` destroys the controller: all windows close, every listener and observer is removed. Vite's hot module replacement re-renders components and keeps the plugin; editing `main.ts` reloads the page.

## 3. Mark elements

```html
<button data-deeptip="demo.realm">{{ t.realm }}</button>
<button :data-deeptip="entryKey">{{ label }}</button>
<button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input /></label>
```

`data-deeptip-delay` overrides `delay` for one element, `data-deeptip-place` the side order ([SPEC §4](../../SPEC.md#4-placement)). Your `@click` keeps working: DeepTip never consumes a normal click on the element, only the click that ends a touch long-press ([SPEC §3.3](../../SPEC.md#33-opening)). Do not give marked elements a `title` (two tooltips); use `aria-label` for icon buttons.

## 4. Live values and language

```vue
<!-- src/App.vue -->
<script setup lang="ts">
import { computed, ref, watchEffect } from "vue";
import { useDeepTip } from "./deeptip/plugin";

type Locale = "en" | "de";
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

const { dt, locale, setLocale } = useDeepTip();
const stability = ref(1);
const tax = ref(1);
const gold = ref(1250);
const t = computed(() => T[locale.value as Locale] ?? T.en);
const signed = computed(() => (stability.value > 0 ? "+" : "") + stability.value);

// live values: push them; configure() replaces `vars` and re-renders the open windows
watchEffect(() => {
  void dt?.configure({ vars: { stability: signed.value, gold: gold.value.toLocaleString(locale.value) } });
});

function raiseTaxes() {
  tax.value = (tax.value + 1) % 3;
  gold.value += INCOME[tax.value] ?? 0;
}
</script>

<template>
  <header>
    <button data-deeptip="demo.realm">{{ t.realm }}</button>
    <button data-deeptip="demo.stability" @click="stability = stability >= 3 ? -3 : stability + 1">{{ t.stability }} {{ signed }}</button>
    <button data-deeptip="demo.taxes" @click="raiseTaxes">{{ t.taxes }}: {{ t.levels[tax] }}</button>
    <button data-deeptip="demo.nobles">{{ t.nobles }}</button>
    <button data-deeptip="demo.gold">{{ t.gold }} {{ gold.toLocaleString(locale) }}</button>
    <button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
    <select :value="locale" aria-label="Language" @change="setLocale(($event.target as HTMLSelectElement).value)">
      <option value="en">English</option>
      <option value="de">Deutsch</option>
    </select>
  </header>
  <div v-deeptip-text="t.intro"></div>
  <div v-deeptip-index></div>
</template>
```

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Pushing them with `configure({ vars })` in a `watchEffect` fits Vue's reactivity; `configure({ vars })` replaces all `vars`, so keep them in one place. Alternatively give the plugin functions (`vars: { gold: () => store.gold }`) and call `dt.refresh()` after changes.
- `setLocale()` waits for the files of the new language, then sets `locale`: DeepTip's windows and indexes re-render at once, the component re-renders its own texts, and `v-deeptip-text` renders the intro again (link titles change with the language).

This is the HUD of the web example (`demo.realm`, `demo.stability`, `demo.taxes`, `demo.nobles`, `demo.gold`, the help button `deeptip.about`) with the same glossaries. Its behaviour equals [frameworks/web/example](https://github.com/gorduan/DeepTip/blob/main/frameworks/web/example/index.html): `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 5. Server rendering (Nuxt, Vite SSR)

The plugin above is universal: on the server `dt` is `null` and the directives do nothing (Vue calls their hooks in the browser only).

```ts
// Nuxt: plugins/deeptip.ts
import { createDeepTip } from "~/deeptip/plugin";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(createDeepTip({ locale: "en", fallback: ["en"], sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] }));
});
```

- Register it as a universal plugin (not `.client.ts`): the server must know `v-deeptip-text` and `v-deeptip-index` while it renders templates.
- `nuxt.config.ts`: `css: ["~/deeptip/deeptip.css"]`; glossaries in `public/deeptip/`; with `app.baseURL` put it in front of the `sources` templates.
- `data-deeptip` attributes are rendered on the server and hydrate unchanged. DeepTip changes the DOM only in the browser after `init`: windows go to `document.body` (outside the app), and anchors get `data-dt-open`, `aria-describedby` and an inline `anchor-name` while a window is open. Vue patches only the attributes it binds and leaves these alone.
- Elements with `v-deeptip-text` are empty on the server; DeepTip fills them after hydration.

## 6. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body`: windows are appended to `document.body`, so properties set on `#app` do not reach them. `<style scoped>` cannot style the windows either (they are not inside the component, `:deep()` does not help): put `.dt-win` rules in a global stylesheet. Hooks on your own elements work in scoped styles, e.g. `button[data-dt-open] { … }` while its window is open and `button[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it.

## 7. Pitfalls

- A marked element that Vue replaces (a changed `key`, `v-if` swapping elements) closes its preview; a pinned window stays where it was ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Keep keys stable.
- `:style` bound to an object is patched per property, so the inline `anchor-name` DeepTip sets survives updates; a `:style` string binding replaces the whole attribute. Use objects on marked elements.
- Elements with `v-deeptip-text` or `v-deeptip-index` must stay empty in the template.
- One controller per document: do not install the plugin into several apps of the same page.
