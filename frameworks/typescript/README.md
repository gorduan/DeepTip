# DeepTip in TypeScript: integration guide

How to use [DeepTip](../../README.md) (explanation windows with depth) from TypeScript, with complete type declarations for the web runtime.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. In TypeScript you use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) as it is and give it the declarations below. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). The declarations were checked with `tsc --noEmit` under TypeScript 5.9.3 and 7.0.2 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `skipLibCheck: false`) against a file that uses every call below, and their exports against the runtime's exports (2026-10-29).

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js` | e.g. `src/deeptip/deeptip.js` |
| `frameworks/web/deeptip.css` | e.g. `src/deeptip/deeptip.css` |
| the declarations of section 9 | `src/deeptip/deeptip.d.ts`, **next to `deeptip.js`** |
| glossaries | `public/deeptip/<locale>.json` (fetched at runtime), or imported JSON (bundled) |

A `.d.ts` beside a `.js` of the same name is all TypeScript needs: `import { DeepTip } from "./deeptip/deeptip.js"` is then fully typed, no `allowJs`, no `paths`. Do not put a `deeptip.ts` or `deeptip.tsx` (in any letter case, e.g. `DeepTip.tsx`) into the same folder: TypeScript resolves `./deeptip.js` to it first, which on Windows and macOS becomes a circular import. Download `DeepTip-typescript-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

Module resolution:

| `tsconfig.json` | Import |
|---|---|
| `"moduleResolution": "bundler"` (Vite, esbuild, webpack, Parcel) | `./deeptip/deeptip.js` (the extension may be left out) |
| `"module": "nodenext"` with `"type": "module"` in `package.json` | `./deeptip/deeptip.js` (extension required) |

## 2. Start once

One controller per document ([§4](../../docs/algorithms.md#4-window-tree-and-invariants) keeps all windows of the page in one tree). Create it in browser code, once, after the DOM exists:

```ts
// src/main.ts
import { DeepTip, type DeepTipOptions } from "./deeptip/deeptip.js";
import "./deeptip/deeptip.css"; // bundlers; without one: <link rel="stylesheet" href="deeptip/deeptip.css">

const state = { stability: 1, gold: 1250 };

const options: DeepTipOptions = {
  locale: "en",
  fallback: ["de", "en"],
  sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"], // core first, project after
  delay: 800,
  vars: {
    stability: () => (state.stability > 0 ? "+" : "") + state.stability,
    gold: () => state.gold.toLocaleString(dt.locale),
  },
  onOpen: (key, el) => console.debug("open", key, el.dataset.dtKey),
};

export const dt = DeepTip.init(options);
```

`DeepTip.init` listens on `document` and `window` at once and starts loading `sources`; `dt.ready` settles when they are loaded. Importing the module is safe anywhere (it touches no DOM at import), creating the controller is not: on a server it has no `document` to listen on and its relative `sources` cannot be fetched.

Bundled glossaries instead of `sources`, with `"resolveJsonModule": true` (add `with { type: "json" }` to the imports under `nodenext`):

```ts
import coreEn from "./deeptip/core/en.json";
import en from "./deeptip/en.json";

dt.add("en", coreEn).add("en", en); // layer order: core first, project after
```

Glossaries written in TypeScript are checked with `satisfies`:

```ts
import type { DeepTipGlossary } from "./deeptip/deeptip.js";

export default {
  $locale: "en",
  "shop.cart": { title: "Cart", short: "Items you are about to order.", body: "Holds them until you [[shop.checkout|check out]]." },
} satisfies DeepTipGlossary;
```

## 3. Mark elements

```html
<button data-deeptip="demo.realm">Realm</button>
<button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input /></label>
```

`data-deeptip-delay` overrides `delay` for one element, `data-deeptip-place` the side order ([SPEC §4](../../SPEC.md#4-placement)). The element keeps its own click action ([SPEC §3.3](../../SPEC.md#33-opening)).

## 4. Terms on pages, encyclopedia

```ts
const intro = document.querySelector<HTMLParagraphElement>("#intro")!;
await dt.ready; // before: links to keys that are not loaded yet render as missing
dt.renderText(intro, "Rest on a button. Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].");

const index = dt.renderIndex(document.querySelector("#index")!); // kept current by refresh()
// when the container leaves the page:
dt.removeIndex(index);
```

`renderText` replaces the element's children and is not re-rendered by `refresh()`: call it again after `setLocale()` or when the text changes ([§3](../../docs/algorithms.md#3-rendering-the-ast)). `renderIndex` is re-rendered on every refresh ([§12](../../docs/algorithms.md#12-encyclopedia)).

## 5. Live values, language

```ts
function setStability(v: number): void {
  state.stability = v;
  dt.refresh(); // open windows read {stability} again; page texts are yours to re-render
}

async function setLanguage(locale: "en" | "de"): Promise<void> {
  await dt.setLocale(locale); // loads the missing sources, re-renders windows and indexes
  dt.renderText(intro, texts[locale].intro);
}
```

Values are read when a window renders ([SPEC §2.5](../../SPEC.md#25-live-values)). Instead of functions in `vars`, values can be pushed: `dt.configure({ vars: { gold: 1300 } })` replaces `vars` and re-renders.

## 6. Cleanup, hot module replacement

`dt.destroy()` closes every window and removes all listeners and observers. Under Vite's HMR a re-executed module would add a second controller, so dispose the old one:

```ts
if (import.meta.hot) import.meta.hot.dispose(() => dt.destroy()); // needs "types": ["vite/client"]
```

## 7. Styling

Import `deeptip.css` once. Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body`: windows are appended to `document.body`, outside your layout, so properties set on an app container do not reach them (unless you pass that container as `container`). State hooks: `[data-dt-open]` on an anchor while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `--dt-delay` while the pointer rests on it.

## 8. Using the pure functions

`parseText`, `collectRefs`, `flattenGlossary` and `computePlacement` touch no DOM, so tests and ports can use them directly; the parity cases in `test/cases/*.json` describe their exact output ([§11](../../docs/algorithms.md#11-testing-with-testcases)):

```ts
import { computePlacement, parseText } from "./deeptip/deeptip.js";

const p = computePlacement({ w: 300, h: 200 }, { left: 500, right: 800, top: 100, bottom: 400 }, ["left", "right", "top", "bottom"], { w: 1000, h: 800 });
// p.side === "left", p.x === 192, p.y === 150
const blocks = parseText("Frees [[hw.vram]].");
```

## 9. The declarations

Save as `deeptip.d.ts` next to `deeptip.js` (runtime 1.0.0). When the runtime changes, update them: the exported names must stay equal to `Object.keys(await import("./deeptip.js"))`.

```ts
// deeptip.d.ts: TypeScript declarations for frameworks/web/deeptip.js (DeepTip 1.0.0).
// Save next to deeptip.js; `import { DeepTip } from "./deeptip.js"` is then fully typed.

/** Runtime version, e.g. "1.0.0". */
export declare const VERSION: string;
/** A valid glossary key: dotted namespaces of letters, digits, "_" and "-" (SPEC §2.1). */
export declare const KEY_RE: RegExp;
/** The four sides a window can take, in the order the reference uses for children. */
export declare const SIDES: readonly ["left", "right", "top", "bottom"];

export type DeepTipSide = "left" | "right" | "top" | "bottom";
/** How a window was opened. */
export type DeepTipVia = "api" | "hover" | "click" | "touch" | "key" | "pad";

/* ------------------------------------------------------------------ glossary data (SPEC §2) */

/** One entry. `title` is required by the format; `short` and/or `body` carry the text. */
export interface DeepTipEntry {
  /** Name of the term: window title and default text of links to it. */
  title: string;
  /** One line (≤ 140 chars): simple tooltips, lists, encyclopedia; the window text when there is no body. */
  short?: string;
  /** The explanation in DeepTip markup: [[key]], [[key|text]], **bold**, *italic*, `code`, {value}, "- " lists. */
  body?: string;
  /** Other names: search and auto-linking. */
  aliases?: string[];
  /** Keys shown as "See also" links under the body. */
  see?: string[];
  /** For authors and translators; never shown. */
  note?: string;
}

/** The window's own labels (`$ui`), per locale (SPEC §2.6). */
export interface DeepTipLabels {
  close?: string;
  pin?: string;
  unpin?: string;
  missing?: string;
  fallback?: string;
  hint?: string;
  seeAlso?: string;
  search?: string;
  mentionedIn?: string;
  empty?: string;
}

/** Nested i18next style: {"hw": {"vram": {…}}} is the same as {"hw.vram": {…}}. */
export interface DeepTipGlossaryNode {
  [key: string]: DeepTipEntry | DeepTipGlossaryNode;
}

/** One locale file: entries by key (flat or nested) plus `$` metadata. JSON imports are assignable to it. */
export interface DeepTipGlossary {
  $schema?: string;
  $locale?: string;
  $ui?: DeepTipLabels;
  [key: string]: DeepTipEntry | DeepTipGlossaryNode | DeepTipLabels | string | undefined;
}

/** A live value; null and undefined leave "{name}" visible. */
export type DeepTipValue = string | number | boolean | bigint | null | undefined;
/** Called when a window renders; `key` is the entry key, null in page texts and the encyclopedia. */
export type DeepTipValueFn = (key: string | null) => DeepTipValue;
/** Live values for {name} (SPEC §2.5): a map of values or functions, or one resolver. */
export type DeepTipVars =
  | { [name: string]: DeepTipValue | DeepTipValueFn }
  | ((name: string, key: string | null) => DeepTipValue | DeepTipValueFn);

/* ------------------------------------------------------------------ options (SPEC §7) */

export interface DeepTipOptions {
  /** ms the pointer rests on a UI element before its window opens (0 = at once). Per element: data-deeptip-delay. Default 800. */
  delay?: number;
  /** ms on a highlighted term before its window opens. Default 80. */
  linkDelay?: number;
  /** ms grace before an unpinned window closes once the pointer left it. Default 300. */
  closeDelay?: number;
  /** ms resting inside an unpinned window pins it (timer lock); 0 = off. Default 0. */
  lockAfter?: number;
  /** ms touch press on a UI element that opens its window pinned. Default 500. */
  longPress?: number;
  /** X button in every window. Default true. */
  closeButtons?: boolean;
  /** Pin toggle in every window. Default true. */
  pinButton?: boolean;
  /** "Click to pin · Esc closes" line in unpinned windows. Default true. */
  hints?: boolean;
  /** A click anywhere inside an unpinned window pins it. Default true. */
  clickInsidePins?: boolean;
  /** Pressing outside every window closes them all. Default "touch". */
  outsideClickCloses?: "never" | "touch" | "always";
  /** Sides of the UI element for the first window, in order of preference. Default ["bottom", "top", "right", "left"]. */
  root?: readonly DeepTipSide[];
  /** Sides of the previous window for further windows. Default ["left", "right", "top", "bottom"]. */
  child?: readonly DeepTipSide[];
  /** "auto": CSS anchor positioning, measured in JS only when it fails; "js": always JS. Default "auto". */
  engine?: "auto" | "js";
  /** Current locale. Default "en". */
  locale?: string;
  /** Locales tried when an entry is missing. Default ["en"]. */
  fallback?: string | readonly string[];
  /** URL templates of glossary files, "{locale}" is replaced; listed order = layer order (core first). Default []. */
  sources?: string | readonly string[];
  /** Live values for {name} in texts. Default null. */
  vars?: DeepTipVars | null;
  /** Selector of UI elements with an explanation; keep it in line with `attribute`. Default "[data-deeptip]". */
  selector?: string;
  /** Attribute holding the key; "-delay" and "-place" are appended for the per-element options. Default "data-deeptip". */
  attribute?: string;
  /** Keys that open the focused element's window, pinned. Default ["F1", "?"]. */
  openKeys?: readonly string[];
  /** Read gamepads: Y opens, A follows, B closes (hold: all), LB/RB switch. Default true. */
  gamepad?: boolean;
  /** Vibrate briefly when a long-press opens a window. Default true. */
  vibrate?: boolean;
  /** Where windows are appended. Default document.body. */
  container?: Element | null;
  /** A window opened; `el` is the window element. */
  onOpen?: ((key: string, el: HTMLElement) => void) | null;
  /** A window closed. */
  onClose?: ((key: string) => void) | null;
  /** A window was pinned (called for each window of the chain that becomes pinned). */
  onPin?: ((key: string, el: HTMLElement) => void) | null;
}

export interface DeepTipOpenOptions {
  /** The UI element (or a term button inside `parent`) the window belongs to. */
  anchor: HTMLElement | SVGElement;
  /** The window that contains the term; omit for a root window. */
  parent?: DeepTipWindow | null;
  /** Open pinned (pins the chain above as well). Default false. */
  pinned?: boolean;
  /** Move focus into the window (first term, else the window). Default false. */
  focus?: boolean;
  /** Recorded on the window record. Default "api". */
  via?: DeepTipVia;
}

/** An open window (SPEC §3.1). Read it; change it with pin(), unpin() and close(). */
export interface DeepTipWindow {
  /** Sequence number, unique per controller. */
  readonly id: number;
  /** The glossary key shown. */
  readonly key: string;
  /** The window that contains the term it was opened from; null for roots. */
  readonly parent: DeepTipWindow | null;
  /** The UI element or term button it belongs to (a new button after its parent re-rendered). */
  readonly anchor: HTMLElement | SVGElement;
  /** How it was opened. */
  readonly via: DeepTipVia;
  /** Pinned windows stay until they are closed explicitly. */
  readonly pinned: boolean;
  /** Windows opened from this one. */
  readonly children: ReadonlySet<DeepTipWindow>;
  /** The window element: div.dt-win, a manual popover. */
  readonly el: HTMLDivElement;
  /** true once its anchor left the page while it was pinned: it stays where it was. */
  readonly frozen?: boolean;
  /** Last measured box of the window. */
  readonly rect?: DOMRect;
  /** Last measured box of the anchor. */
  readonly anchorRect?: DOMRect;
}

/* ------------------------------------------------------------------ the controller */

export declare class DeepTip {
  /** Create the (one) controller of a document: starts loading `sources`, listens on document and window. */
  static init(options?: DeepTipOptions): DeepTip;
  constructor(options?: DeepTipOptions);

  /** Effective options (defaults merged with yours). Read them; change them with configure(). */
  readonly o: Readonly<Required<DeepTipOptions>>;
  /** The current locale. */
  readonly locale: string;
  /** Settles when the glossary files of the current locale chain are loaded (replaced by setLocale and configure). */
  readonly ready: Promise<void>;
  /** true when the browser supports CSS anchor positioning. */
  readonly css: boolean;
  /** Open windows, oldest first. */
  readonly wins: readonly DeepTipWindow[];
  /** Entries per locale after layering. */
  readonly data: ReadonlyMap<string, ReadonlyMap<string, DeepTipEntry>>;
  /** [locale, ...fallback] without duplicates: the lookup order. */
  readonly chain: string[];

  /** Add or override entries of one locale; later calls win per key (core first, project after). Re-renders. */
  add(locale: string, glossary: DeepTipGlossary): this;
  /** Switch language: loads the missing `sources`, then re-renders open windows and indexes. */
  setLocale(locale: string): Promise<void>;
  /** Change options at runtime; `locale` switches language, `sources`/`fallback` reload. */
  configure(options?: DeepTipOptions): Promise<void>;
  /** The entry from the first locale of the chain that has the key. */
  entry(key: string): { e: DeepTipEntry; loc: string } | null;
  has(key: string): boolean;
  /** A UI label: `$ui` of the glossary first, then the built-in English/German text. */
  t(name: keyof DeepTipLabels): string;
  /** Re-render open windows and indexes (after live values changed). Page texts are not re-rendered. */
  refresh(): void;
  /** Replace the children of `el` with rendered markup; terms become live links. Returns `el`. */
  renderText<T extends Element>(el: T, src: string): T;
  /** Render the searchable list of every entry into `container` and keep it updated on refresh(). */
  renderIndex<T extends Element>(container: T, options?: { search?: boolean }): T;
  /** Stop updating an index (call when its container leaves the page). */
  removeIndex(container: Element): void;
  /** Close everything and remove all listeners and observers. */
  destroy(): void;
  /** Open the window for `key` next to `anchor`; an open window of the same anchor is reused. */
  open(key: string, options: DeepTipOpenOptions): Promise<DeepTipWindow | null>;
  /** Close a window and everything opened from it. */
  close(win: DeepTipWindow, options?: { focusBack?: boolean }): void;
  closeAll(): void;
  /** Pin a window and every window it came from. */
  pin(win: DeepTipWindow): void;
  /** Back to a preview (with everything opened from it); it closes once the pointer is elsewhere. */
  unpin(win: DeepTipWindow): void;
}

export default DeepTip;

/* ------------------------------------------------------------------ pure functions (no DOM; also used by the validator) */

/** Inline nodes of the markup AST (SPEC §2.4). */
export type DeepTipInline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "b"; c: DeepTipInline[] }
  | { t: "i"; c: DeepTipInline[] }
  | { t: "code"; v: string }
  | { t: "link"; key: string; text: string | null }
  | { t: "var"; name: string };

/** Blocks: a paragraph or a bullet list. */
export type DeepTipBlock = { type: "p"; c: DeepTipInline[] } | { type: "ul"; items: DeepTipInline[][] };

/** Parse markup into blocks; never produces HTML. */
export declare function parseText(src: string | null | undefined): DeepTipBlock[];

/** Link targets and live-value names used in a text or in parsed blocks. */
export declare function collectRefs(src: string | DeepTipBlock[]): { links: string[]; vars: string[] };

/** Flatten one locale file (flat or nested keys) into entries, `$` metadata and problems. */
export declare function flattenGlossary(glossary: unknown): {
  entries: Map<string, DeepTipEntry>;
  meta: { $schema?: string; $locale?: string; $ui?: DeepTipLabels; [key: `$${string}`]: unknown };
  problems: { key: string; msg: string }[];
};

export interface DeepTipRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DeepTipPlacement {
  side: DeepTipSide;
  /** Top-left corner of the window's border box. */
  x: number;
  y: number;
  /** false when no side had room: the window was shrunk (maxW / maxH, 0 = unchanged) or only kept on screen. */
  fits: boolean;
  maxW: number;
  maxH: number;
}

/** SPEC §4: where a window of `size` goes next to `anchor` inside `viewport` (y grows downwards). */
export declare function computePlacement(
  size: { w: number; h: number },
  anchor: DeepTipRect,
  sides: readonly DeepTipSide[],
  viewport: { w: number; h: number },
  gap?: number,
): DeepTipPlacement;
```

## 10. Limitations

- The declarations describe runtime 1.0.0; fields not declared (`hot`, `pending`, `samples` …) are internal and may change.
- `t()` accepts the ten `$ui` names; the runtime would return any other name unchanged.
- Live values are typed as primitives; convert dates and objects to strings yourself.
