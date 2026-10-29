# DeepTip in React: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) in a React app (React 18 or 19; Vite, Next.js, Remix …).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. In React you use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; this guide is the exact recipe around it. It works by event delegation on `document`, so React needs no wrapper per element: a provider that owns the one controller, `data-deeptip` attributes, and two small components for texts and the encyclopedia. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). The code blocks that start with a file path were type-checked with React 19.3 and TypeScript 7.0 (`tsc --noEmit`, strict), built with Vite 8, and the built app was run in Chromium: page texts after `ready`, encyclopedia, rest opens a window, one window per anchor under `<StrictMode>`, live value update, language switch (2026-10-29).

## Quick start

**Recognise the project:** `react` and `react-dom` in `package.json`, `.jsx` or `.tsx` files; Next.js adds `next`.

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` to `src/deeptip/`; TypeScript projects also need the declarations (section 1).
2. Copy `glossary/core/en.json` to `public/deeptip/core/en.json`; your own entries go to `public/deeptip/en.json`.
3. Create the one controller in an effect of the root component and destroy it in the cleanup (below; Next.js and server rendering: section 5).
4. Mark elements with `data-deeptip="key"` (section 3); section 2 wraps the controller in `DeepTipProvider` with `useDeepTip`, `DeepTipText` and `DeepTipIndex`.
5. Validate the glossary files: `node <DeepTip>/tools/deeptip-check.mjs --base en public/deeptip/core/en.json public/deeptip/en.json`.

```tsx
// src/App.tsx
import { useEffect } from "react";
import { DeepTip } from "./deeptip/deeptip.js";
import "./deeptip/deeptip.css";

export function App() {
  useEffect(() => {
    const dt = DeepTip.init({ locale: "en", sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] });
    return () => dt.destroy(); // unmount, StrictMode's test remount, Fast Refresh
  }, []);
  return <button data-deeptip="deeptip.about" aria-label="Help">?</button>;
}
```

**Done when:** resting on `?` for 800 ms opens the *DeepTip* window below it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows, `Esc` closes the newest window, the validator reports 0 errors.

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | `src/deeptip/` |
| the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) (TypeScript projects) | `src/deeptip/deeptip.d.ts` |
| glossaries `glossary/core/<locale>.json` and yours | `public/deeptip/core/<locale>.json`, `public/deeptip/<locale>.json`: served as static files, fetched per language |

Download `DeepTip-react-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository. Plain JavaScript projects use the same code without the type annotations.

Nothing is ported: the parser, the placement and the glossary flattening are the web runtime's, and `npm test` in the DeepTip repository runs them against `test/cases/*.json` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 2. The controller: one provider at the root

```tsx
// src/deeptip/DeepTipProvider.tsx
// Next.js App Router: put "use client"; as the first line, this module runs in the browser.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DeepTip, type DeepTipOptions } from "./deeptip.js";

const Controller = createContext<DeepTip | null>(null);

/** Owns the page's one controller. Effects never run during server rendering, so neither does DeepTip. */
export function DeepTipProvider({ options, children }: { options: DeepTipOptions; children: ReactNode }) {
  const [dt, setDt] = useState<DeepTip | null>(null);
  useEffect(() => {
    const controller = DeepTip.init(options); // options are read once; change them with dt.configure()
    setDt(controller);
    return () => controller.destroy(); // unmount, StrictMode's test remount, Fast Refresh
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Controller.Provider value={dt}>{children}</Controller.Provider>;
}

/** The controller; null until the provider has mounted. */
export function useDeepTip(): DeepTip | null {
  return useContext(Controller);
}

/** Markup with live terms. DeepTip owns this element's children: never give it React children. */
export function DeepTipText({ text, locale, className }: { text: string; locale?: string; className?: string }) {
  const dt = useDeepTip();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dt) return;
    let current = true;
    void dt.ready.then(() => {
      if (current && ref.current) dt.renderText(ref.current, text); // after ready: titles of [[key]] are known
    });
    return () => {
      current = false;
    };
  }, [dt, text, locale]); // locale: link titles change with the language even when `text` does not
  return <div ref={ref} className={className} />;
}

/** The encyclopedia of every entry; DeepTip keeps it current on every refresh(). */
export function DeepTipIndex({ search = true }: { search?: boolean }) {
  const dt = useDeepTip();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!dt || !el) return;
    dt.renderIndex(el, { search });
    return () => dt.removeIndex(el);
  }, [dt, search]);
  return <div ref={ref} />;
}
```

Lifecycle, exactly:

- `DeepTip.init` listens on `document` and `window` and starts fetching `sources`. It belongs in an effect: the effect runs once after the first commit, in the browser only.
- React runs child effects before parent effects, so on the first render every `useDeepTip()` returns `null`; the provider's `setDt` re-renders them with the controller. Code that needs it depends on `dt` (as above).
- `<StrictMode>` mounts, unmounts and mounts again in development: the first controller is destroyed, the second stays. `destroy()` closes all windows and removes every listener and observer, so nothing is left behind.
- Fast Refresh re-runs effects of an edited component: editing the provider destroys and recreates the controller, open windows close.

## 3. Mark elements

```tsx
<button data-deeptip="demo.realm">{t.realm}</button>
<button data-deeptip="deeptip.about" data-deeptip-delay={0} aria-label="Help">?</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input /></label>
```

React passes `data-*` attributes through unchanged (`data-deeptip-delay={0}` becomes `"0"`). Your `onClick` keeps working: DeepTip never consumes a normal click on the element, only the click that ends a touch long-press ([SPEC §3.3](../../SPEC.md#33-opening)). Do not give marked elements a `title` (two tooltips); use `aria-label` for icon buttons.

## 4. Live values and language

```tsx
// src/App.tsx
import { useEffect, useState } from "react";
import { DeepTipIndex, DeepTipText, useDeepTip } from "./deeptip/DeepTipProvider";

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

export function App() {
  const dt = useDeepTip();
  const [locale, setLocale] = useState<Locale>("en");
  const [stability, setStability] = useState(1);
  const [tax, setTax] = useState(1);
  const [gold, setGold] = useState(1250);
  const t = T[locale];
  const signed = (stability > 0 ? "+" : "") + stability;

  // live values: push them; configure() replaces `vars` and re-renders the open windows
  useEffect(() => {
    void dt?.configure({ vars: { stability: signed, gold: gold.toLocaleString(locale) } });
  }, [dt, signed, gold, locale]);

  async function switchTo(next: Locale) {
    await dt?.setLocale(next); // loads the missing glossary files, re-renders open windows
    setLocale(next); // then React re-renders its own texts and <DeepTipText>
  }

  return (
    <>
      <header>
        <button data-deeptip="demo.realm">{t.realm}</button>
        <button data-deeptip="demo.stability" onClick={() => setStability((v) => (v >= 3 ? -3 : v + 1))}>
          {t.stability} {signed}
        </button>
        <button
          data-deeptip="demo.taxes"
          onClick={() => {
            const next = (tax + 1) % 3;
            setTax(next);
            setGold((g) => g + (INCOME[next] ?? 0));
          }}
        >
          {t.taxes}: {t.levels[tax]}
        </button>
        <button data-deeptip="demo.nobles">{t.nobles}</button>
        <button data-deeptip="demo.gold">
          {t.gold} {gold.toLocaleString(locale)}
        </button>
        <button data-deeptip="deeptip.about" data-deeptip-delay={0} aria-label="Help">
          ?
        </button>
        <select value={locale} onChange={(e) => void switchTo(e.target.value as Locale)} aria-label="Language">
          <option value="en">English</option>
          <option value="de">Deutsch</option>
        </select>
      </header>
      <DeepTipText text={t.intro} locale={locale} />
      <DeepTipIndex />
    </>
  );
}
```

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Pushing them with `configure({ vars })` fits React state. With an external store use functions instead, `vars: { gold: () => store.getState().gold }` in the provider's options, and call `dt.refresh()` after each change.
- `configure({ vars })` replaces all `vars`: keep them in one component.
- `setLocale()` re-renders DeepTip's windows and indexes; texts rendered with `renderText` are re-rendered by `DeepTipText` because `locale` is in its dependencies.

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DeepTipProvider } from "./deeptip/DeepTipProvider";
import { App } from "./App";
import "./deeptip/deeptip.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeepTipProvider options={{ locale: "en", fallback: ["de", "en"], sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] }}>
      <App />
    </DeepTipProvider>
  </StrictMode>,
);
```

This is the HUD of the web example (`demo.realm`, `demo.stability`, `demo.taxes`, `demo.nobles`, `demo.gold`, the help button `deeptip.about`) with the same glossaries. Its behaviour equals [frameworks/web/example](https://github.com/gorduan/DeepTip/blob/main/frameworks/web/example/index.html): `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 5. Server rendering and hydration (Next.js, Remix, React Router)

- Mark `src/deeptip/DeepTipProvider.tsx` with `"use client"` (Next.js App Router); render `<DeepTipProvider>` in the root layout, inside `<body>`.
- `deeptip.js` can be imported on the server (it touches no DOM at import); `DeepTip.init` runs only in the effect.
- `data-deeptip` attributes are rendered on the server and hydrate unchanged. DeepTip changes the DOM only after hydration: windows go to `document.body` (outside React's tree), and anchors get `data-dt-open`, `aria-describedby` and an inline `anchor-name` while a window is open. React does not remove attributes it does not manage.
- `DeepTipText` and `DeepTipIndex` render empty elements on the server and on the first client render, so hydration matches; DeepTip fills them in the effect.
- Import `deeptip.css` where global CSS is allowed (Next.js: `app/layout.tsx`). Glossaries go to `public/deeptip/`; with a `basePath` put it in front of the `sources` templates.

## 6. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body`: windows are appended to `document.body`, so properties set on your app container do not reach them. CSS Modules: the classes `dt-win`, `dt-link` … are global, write `:global(.dt-win)`. State hooks on your elements: `[data-dt-open]` while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `--dt-delay` while the pointer rests on it (show progress).

## 7. Pitfalls

- A marked element that React replaces (a changed `key`, a conditional that swaps elements) closes its preview; a pinned window stays where it was ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Keep keys stable.
- `style` objects are patched per property, so the inline `anchor-name` DeepTip sets survives re-renders. Do not set the whole `style` attribute as a string on marked elements.
- `renderText` targets must stay without React children; React leaves the children of an element it renders empty alone.
- Before `dt.ready` settles, links to entries that are not loaded yet render as missing; `DeepTipText` waits for it.
- One controller per document: several providers would each handle every `data-deeptip` element.
