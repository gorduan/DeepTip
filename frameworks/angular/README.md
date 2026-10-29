# DeepTip in Angular: integration guide

How to use [DeepTip](../../README.md) (explanation windows with depth) in an Angular app with standalone components and signals (Angular 20 or newer; with or without server rendering).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. In Angular you use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged; this guide is the exact recipe around it. The runtime works by event delegation on `document`, so Angular needs no wrapper per element: one root service that owns the controller, `data-deeptip` attributes (plus a small directive for bound keys), and two directives for page texts and the encyclopedia. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). Statements marked *(checked)* were verified on 2026-10-29 with Angular 22.2 (CLI 22.2.5, TypeScript 6.0, zoneless, a project made with `ng new --ssr`) on Node 24: the code blocks that start with a file path were built with `ng build` (strict AOT type check, prerendering), the server-rendered build was run in headless Chrome 156 (hydration, rest opens a window, live value, language switch), and so were a client-only `autoCsp` build, a zone.js variant and the Vitest test of section 10. *(verify)* marks statements taken from the Angular documentation that were not run.

## Quick start

**Recognise the project:** `angular.json` at the project root, `@angular/core` in `package.json`, `bootstrapApplication(App, appConfig)` in `src/main.ts`.

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` into `src/deeptip/`, and save the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) as `src/deeptip/deeptip.d.ts`.
2. Add `"src/deeptip/deeptip.css"` to `projects.<app>.architect.build.options.styles` in `angular.json`.
3. Write your glossary as `public/deeptip/en.json`.
4. Start DeepTip in `app.config.ts` as below.
5. Mark an element in any template: `<button data-deeptip="shop.cart">Cart</button>`.
6. `ng serve` and rest the pointer on the button.

```ts
// src/app/app.config.ts
import { ApplicationConfig, PLATFORM_ID, inject, provideAppInitializer } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { DeepTip } from "../deeptip/deeptip.js";

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => {
      if (isPlatformBrowser(inject(PLATFORM_ID))) DeepTip.init({ locale: "en", sources: ["deeptip/{locale}.json"] });
    }),
  ],
};
```

**Done when:** `ng build` passes without type errors, resting on the button opens a window with the entry's title, the button carries `data-dt-open` while its window is open, the browser console shows no `DeepTip:` warnings.

## 1. Files

| File | Where |
|---|---|
| `frameworks/web/deeptip.js`, `deeptip.css` | `src/deeptip/` |
| the declarations of the [TypeScript guide](../typescript/README.md#9-the-declarations) | `src/deeptip/deeptip.d.ts`, next to `deeptip.js` |
| the service and the directives below | `src/deeptip/deeptip.service.ts`, `src/deeptip/deeptip.directives.ts` |
| glossaries `glossary/core/<locale>.json` and yours | `public/deeptip/core/<locale>.json`, `public/deeptip/<locale>.json`: copied to the output as they are, fetched per language |

`angular.json`, the build options: `"styles": ["src/styles.css", "src/deeptip/deeptip.css"]` *(checked)*. It must be a global style: DeepTip's windows are created outside every component, and component styles are encapsulated.

A `.d.ts` beside the `.js` is all TypeScript needs: the default `tsconfig.app.json` includes `src/**/*.ts`, which covers `deeptip.d.ts`, so `import { DeepTip } from "../deeptip/deeptip.js"` is fully typed without `allowJs`, and the esbuild-based application builder bundles the module *(checked)*. Download `DeepTip-angular-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

## 2. The service: one controller per app

The Quick start works as it is *(checked)*. A real app uses this service instead, which adds signals, language switching and cleanup.

```ts
// src/deeptip/deeptip.service.ts
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  NgZone,
  PLATFORM_ID,
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  signal,
  type EnvironmentProviders,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { DeepTip, type DeepTipOptions } from "./deeptip.js";

export const DEEPTIP_OPTIONS = new InjectionToken<DeepTipOptions>("DEEPTIP_OPTIONS");

/** Owns the page's one DeepTip controller. `dt` is null on the server. */
@Injectable({ providedIn: "root" })
export class DeepTipService {
  readonly dt: DeepTip | null = null;
  private readonly localeState = signal("en");
  private readonly readyState = signal(false);
  /** The language DeepTip shows; changes once setLocale() has loaded it. */
  readonly locale = this.localeState.asReadonly();
  /** true once the glossaries of the current language chain are loaded. */
  readonly ready = this.readyState.asReadonly();

  constructor() {
    const options = inject(DEEPTIP_OPTIONS, { optional: true }) ?? {};
    this.localeState.set(options.locale ?? "en");
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return; // server rendering: no document to listen on
    // outside the zone: with zone.js, DeepTip's pointer listeners on document would be Angular tasks
    const dt = inject(NgZone).runOutsideAngular(() => DeepTip.init(options));
    this.dt = dt;
    void dt.ready.then(() => this.readyState.set(true));
    inject(DestroyRef).onDestroy(() => dt.destroy()); // app destroyed (also in tests)
  }

  /** Switch language: waits for the glossary files, then the signals change. */
  async setLocale(locale: string): Promise<void> {
    await this.dt?.setLocale(locale);
    this.localeState.set(locale);
  }
}

/** provideDeepTip({ … }) or provideDeepTip(() => ({ locale: inject(LOCALE_ID) … })) in app.config.ts. */
export function provideDeepTip(options: DeepTipOptions | (() => DeepTipOptions)): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: DEEPTIP_OPTIONS, useFactory: typeof options === "function" ? options : () => options },
    // create the service at start-up: plain data-deeptip attributes need no component that injects it
    provideAppInitializer(() => {
      inject(DeepTipService);
    }),
  ]);
}
```

```ts
// src/app/app.config.ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter } from "@angular/router";
import { routes } from "./app.routes";
import { provideClientHydration } from "@angular/platform-browser";
import { provideDeepTip } from "../deeptip/deeptip.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideDeepTip({
      locale: "en",
      fallback: ["de", "en"],
      sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"], // public/deeptip/…, core first
    }),
  ],
};
```

Lifecycle, exactly:

- `provideAppInitializer` creates the service while the application bootstraps, before the first component renders. `DeepTip.init` then listens on `document` and `window` and starts fetching `sources`; `dt.ready` settles when they are loaded and sets the `ready` signal. Without the initializer, an app that only uses plain `data-deeptip` attributes would never create the service.
- On the server (`ng build` prerendering and SSR requests) `PLATFORM_ID` is `server`: `dt` stays `null`, nothing listens and nothing is fetched *(checked: the build prerenders the page with this service)*.
- `runOutsideAngular`: in zone.js apps it keeps DeepTip's listeners out of the Angular zone (DeepTip's `pointermove` listener then belongs to the root zone instead of `angular` *(checked)*). With Angular 22 even listeners inside the zone did not re-check components (40 pointer moves, 0 checks in both variants *(checked)*), so this is a cheap precaution. In zoneless apps (the default for new projects) `NgZone` is a no-op and the call just runs the function.
- Callbacks (`onOpen`, `onClose`, `onPin`) therefore run outside the zone. Write signals there; signal changes schedule change detection in zoneless and zone.js apps alike *(verify)*.
- `DestroyRef.onDestroy` destroys the controller when the application is destroyed (`appRef.destroy()`, the end of every TestBed test): all windows close, every listener and observer is removed.
- The options may be a factory, which runs in an injection context: `provideDeepTip(() => ({ locale: inject(LOCALE_ID).split("-")[0], fallback: ["en"], sources: […] }))` *(checked with `LOCALE_ID` `de-AT`: DeepTip started in German)*. That is how a build per language made with Angular's i18n (`$localize`, `ng build --localize`) picks the matching glossary.

## 3. Mark elements

```html
<button data-deeptip="demo.realm">{{ t().realm }}</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input /></label>
<button [attr.data-deeptip]="entryKey()">{{ label() }}</button>
<button [deeptip]="helpKey()" [deeptipDelay]="0" aria-label="Help">?</button>
```

Angular writes static attributes as they are. A bound key needs an attribute binding (`[attr.data-deeptip]`; `null` removes it) or the directive below, which also takes the per-element delay and side order ([SPEC §4](../../SPEC.md#4-placement)) as typed inputs:

```ts
// src/deeptip/deeptip.directives.ts (part 1)
import { Directive, ElementRef, effect, inject, input } from "@angular/core";
import { DeepTipService } from "./deeptip.service";

/** <button [deeptip]="key" [deeptipDelay]="0" deeptipPlace="top,bottom">: writes the attributes the runtime reads. */
@Directive({
  selector: "[deeptip]",
  host: {
    "[attr.data-deeptip]": "deeptip()",
    "[attr.data-deeptip-delay]": "deeptipDelay() ?? null",
    "[attr.data-deeptip-place]": "deeptipPlace() ?? null",
  },
})
export class DeepTipKey {
  readonly deeptip = input.required<string>();
  readonly deeptipDelay = input<number | null>();
  readonly deeptipPlace = input<string | null>();
}
```

- Host bindings are rendered on the server too: the prerendered HTML contained `data-deeptip="deeptip.about" data-deeptip-delay="0"` from the directive *(checked)*.
- Your `(click)` keeps working: DeepTip never consumes a normal click on the element, only the click that ends a touch long-press ([SPEC §3.3](../../SPEC.md#33-opening)) *(checked: the Stability button's handler ran while its window was open)*.
- Do not give marked elements a `title` (two tooltips); use `aria-label` for icon buttons.
- The validator's `--scan` finds keys written as `data-deeptip="key"`, `deeptip="key"`, `[deeptip]="'key'"` and `[attr.data-deeptip]="'key'"` in `.html` and `.ts` files (the last three since 1.1.0), not keys behind an expression such as `[deeptip]="helpKey()"`. Write static keys as plain attributes or string literals and keep bound keys in glossary-checked constants.

## 4. Terms in page texts, encyclopedia

```ts
// src/deeptip/deeptip.directives.ts (part 2)
/** <p [deeptipText]="markup"></p>: markup with live terms, rendered again when the language changes. Keep the element empty. */
@Directive({ selector: "[deeptipText]" })
export class DeepTipText {
  readonly deeptipText = input.required<string>();

  constructor() {
    const tips = inject(DeepTipService);
    const element: HTMLElement = inject(ElementRef).nativeElement;
    effect(() => {
      const text = this.deeptipText();
      tips.locale(); // link titles change with the language even when the text does not
      if (tips.ready()) tips.dt?.renderText(element, text); // before ready, links would render as missing
    });
  }
}

/** <div deeptipIndex></div>: the encyclopedia; DeepTip keeps it current until the element is destroyed. */
@Directive({ selector: "[deeptipIndex]" })
export class DeepTipIndex {
  readonly deeptipSearch = input(true);

  constructor() {
    const dt = inject(DeepTipService).dt;
    const element: HTMLElement = inject(ElementRef).nativeElement;
    effect((onCleanup) => {
      if (!dt) return;
      dt.renderIndex(element, { search: this.deeptipSearch() });
      onCleanup(() => dt.removeIndex(element));
    });
  }
}
```

- `renderText` replaces the element's children and is not re-rendered by `refresh()` ([§3](../../docs/algorithms.md#3-rendering-the-ast)); the effect renders after `ready` and again whenever the text or the `locale` signal changes *(checked: the intro switched to German)*.
- `renderIndex` is re-rendered by DeepTip on every refresh ([§12](../../docs/algorithms.md#12-encyclopedia)), so it may run before the glossaries arrive; the effect's cleanup calls `removeIndex` when the element is destroyed.
- Elements with `[deeptipText]` or `deeptipIndex` stay empty in the template: Angular leaves children alone that it did not create.

## 5. Live values and language

```ts
// src/app/app.ts
import { Component, computed, effect, inject, signal } from "@angular/core";
import { DeepTipIndex, DeepTipKey, DeepTipText } from "../deeptip/deeptip.directives";
import { DeepTipService } from "../deeptip/deeptip.service";

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

@Component({
  selector: "app-root",
  imports: [DeepTipKey, DeepTipText, DeepTipIndex],
  templateUrl: "./app.html",
})
export class App {
  protected readonly tips = inject(DeepTipService);
  protected readonly stability = signal(1);
  protected readonly tax = signal(1);
  protected readonly gold = signal(1250);
  protected readonly helpKey = signal("deeptip.about");
  protected readonly t = computed(() => T[this.tips.locale() as Locale] ?? T.en);
  protected readonly signed = computed(() => (this.stability() > 0 ? "+" : "") + this.stability());
  protected readonly goldText = computed(() => this.gold().toLocaleString(this.tips.locale()));

  constructor() {
    // live values: push them; configure() replaces `vars` and re-renders the open windows
    effect(() => {
      void this.tips.dt?.configure({ vars: { stability: this.signed(), gold: this.goldText() } });
    });
  }

  protected cycleStability(): void {
    this.stability.update((v) => (v >= 3 ? -3 : v + 1));
  }

  protected raiseTaxes(): void {
    const next = (this.tax() + 1) % 3;
    this.tax.set(next);
    this.gold.update((g) => g + (INCOME[next] ?? 0));
  }

  protected switchTo(locale: string): void {
    void this.tips.setLocale(locale); // loads the glossary files, re-renders windows and the encyclopedia
  }
}
```

```html
<!-- src/app/app.html -->
<header>
  <button data-deeptip="demo.realm">{{ t().realm }}</button>
  <button data-deeptip="demo.stability" (click)="cycleStability()">{{ t().stability }} {{ signed() }}</button>
  <button data-deeptip="demo.taxes" (click)="raiseTaxes()">{{ t().taxes }}: {{ t().levels[tax()] }}</button>
  <button data-deeptip="demo.nobles">{{ t().nobles }}</button>
  <button data-deeptip="demo.gold">{{ t().gold }} {{ goldText() }}</button>
  <button [deeptip]="helpKey()" [deeptipDelay]="0" aria-label="Help">?</button>
  <select #lang [value]="tips.locale()" (change)="switchTo(lang.value)" aria-label="Language">
    <option value="en">English</option>
    <option value="de">Deutsch</option>
  </select>
</header>
<p id="intro" [deeptipText]="t().intro"></p>
<div id="index" deeptipIndex></div>
```

- Live values ([SPEC §2.5](../../SPEC.md#25-live-values)) are read when a window renders. Pushing them with `configure({ vars })` from an effect fits signals: the open Stability window showed `+2` right after the click *(checked)*. `configure({ vars })` replaces all `vars`, so keep them in one effect.
- The alternative: functions in the options (`vars: { gold: () => game.gold() }`, a signal read outside a reactive context just returns its value) and an effect that reads the same signals and calls `this.tips.dt?.refresh()`.
- `setLocale()` waits for the files of the new language, then sets the `locale` signal: DeepTip's windows and encyclopedias re-render at once, `t()` follows, and `[deeptipText]` renders the intro again *(checked: HUD, intro, window titles and encyclopedia in German)*.

This is the HUD of the web example with the same glossaries; section 11 lists the rest of the example.

## 6. Server rendering, hydration, CSP

- `deeptip.js` touches no DOM when it is imported, so the server bundle may contain it; only `DeepTip.init` needs a browser, and the service skips it there.
- `data-deeptip` attributes are part of the server HTML (all seven of the example, including the directive's) and hydrate unchanged; `[deeptipText]` and `deeptipIndex` elements are empty on the server and on the first client render, so hydration matches. The checked run showed no hydration error (no `NG0500`) and no console error *(checked)*.
- DeepTip changes the DOM only after hydration: windows go to `document.body` (outside `<app-root>`), and anchors get `data-dt-open`, `aria-describedby` and an inline `anchor-name` while a window is open. Angular updates only the attributes and style properties it binds. Do not bind the whole `style` attribute of a marked element as a string (`[attr.style]`): that would remove the inline `anchor-name`.
- Running the SSR server locally for a browser test: Angular 22 rejects unknown `Host` headers with `400 Bad Request`; allow the host with `NG_ALLOWED_HOSTS=localhost` or `security.allowedHosts` in `angular.json` *(checked)*.
- Content Security Policy: DeepTip needs no inline script and no inline style; it sets styles through the CSSOM (`element.style.setProperty`), which a CSP does not restrict. A client-only build with `"security": { "autoCsp": true }` (CSP `script-src 'strict-dynamic'` with hashes, `object-src 'none'`, `base-uri 'self'`) ran without a violation *(checked)*. `autoCsp` cannot be combined with SSR: the build stops with "Cannot set both SSR and auto-CSP at the same time" *(checked)*; server-rendered apps send their CSP as a header, with a nonce for Angular's own inline styles (`ngCspNonce`) *(verify)*.

## 7. Cleanup and hot reload

`DeepTipService` destroys the controller with the application (section 2). Do not call `DeepTip.init` anywhere else: a second controller would handle every `data-deeptip` element a second time. `ng serve` replaces edited templates and styles in place and keeps the service *(verify)*; other edits reload the page, which starts a new document with a new controller.

## 8. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) in a global stylesheet, on `:root` or `body`: windows are appended to `document.body`, so properties set on `<app-root>` or a component host do not reach them, and component styles (emulated or shadow encapsulation) cannot style `.dt-win`. The state hooks are on your own elements, so they can be styled where the element lives: `button[data-dt-open]` while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it. The checked app used `:root { --dt-accent: … }` and `button[data-dt-open] { outline: … }` in `src/styles.css`.

## 9. Pitfalls

- **One controller per document.** Call `provideDeepTip` once, in the root application config.
- **Replaced anchors.** A marked element that Angular destroys (`@if`, `@for` with a changing `track` key) closes its preview; a pinned window stays where it was ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Track `@for` items by a stable id.
- **Texts before `ready`.** `renderText` before the glossaries are loaded renders links to unknown keys as missing; the `[deeptipText]` directive waits for the `ready` signal.
- **Elements DeepTip fills stay empty** in the template (`[deeptipText]`, `deeptipIndex`).
- **`--scan` and bound keys**, see section 3.
- **Node version.** The Angular 22 CLI needs Node 22.22.3 or newer (it refuses 22.17) *(checked)*.

## 10. Testing

The service and the directives can be tested with the default unit-test builder (Vitest with jsdom); the runtime starts in jsdom when no `sources` are given:

```ts
// src/deeptip/deeptip.directives.spec.ts
import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { DeepTipKey, DeepTipText } from "./deeptip.directives";
import { DeepTipService, provideDeepTip } from "./deeptip.service";

@Component({
  imports: [DeepTipKey, DeepTipText],
  template: `<button [deeptip]="key()" [deeptipDelay]="0">?</button><p [deeptipText]="'See [[t.a]].'"></p>`,
})
class Host {
  readonly key = signal("t.a");
}

describe("DeepTip directives", () => {
  it("writes the attributes and renders terms after ready", async () => {
    TestBed.configureTestingModule({ providers: [provideDeepTip({ locale: "en" })] });
    const tips = TestBed.inject(DeepTipService);
    tips.dt!.add("en", { "t.a": { title: "Alpha", short: "First." }, "t.b": { title: "Beta", short: "Second." } });
    const fixture = TestBed.createComponent(Host);
    await tips.dt!.ready;
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const button = host.querySelector("button")!;
    expect(button.getAttribute("data-deeptip")).toBe("t.a");
    expect(button.getAttribute("data-deeptip-delay")).toBe("0");
    expect(host.querySelector("p .dt-link")?.textContent).toBe("Alpha");
    fixture.componentInstance.key.set("t.b");
    await fixture.whenStable();
    expect(button.getAttribute("data-deeptip")).toBe("t.b");
  });

  it("opens a window through the controller", async () => {
    TestBed.configureTestingModule({ providers: [provideDeepTip({ locale: "en" })] });
    const dt = TestBed.inject(DeepTipService).dt!;
    dt.add("en", { "t.a": { title: "Alpha", short: "First." } });
    const anchor = document.body.appendChild(document.createElement("button"));
    const win = await dt.open("t.a", { anchor, pinned: true });
    expect(win?.el.querySelector(".dt-title")?.textContent).toBe("Alpha");
    dt.closeAll();
    anchor.remove();
  });
});
```

`ng test --watch=false` passed both tests *(checked)*. Pointer behaviour (rest, grace, placement) needs a real browser: build the app, open it in Chromium with Playwright or the DevTools protocol, move the mouse onto a marked element and wait for `.dt-win[data-dt-key="…"]:popover-open` (count open windows with `:popover-open`; a closing window stays in the DOM until its fade-out ends). The parser, the placement and the glossary flattening are the web runtime's: `npm test` in the repository runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 11. The example to build

The same screen as `frameworks/web/example`, as standalone components: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `[deeptipDelay]="0"`, a language select (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms (`[deeptipText]`), settings (delay, lock, buttons, hints through `dt.configure`) and the encyclopedia (`deeptipIndex`). Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`, copied to `public/deeptip/core/` and `public/deeptip/`. Sections 2 to 5 are the checked core of it. Compare its behaviour with the web example: `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 12. Limitations

None beyond the web runtime's: everything runs in the browser. Server HTML contains the markers but no explanations (those come from the glossary files after start-up), and `[deeptipText]` elements stay empty until the glossaries are loaded.

## 13. Checklist

1. Copy `deeptip.js`, `deeptip.css` and the declarations into `src/deeptip/`; add `deeptip.css` to the global `styles`; glossaries into `public/deeptip/`.
2. Add the service and `provideDeepTip(…)` once, in the root config.
3. Mark elements with `data-deeptip` (static) or `[deeptip]` (bound); texts with `[deeptipText]`, the encyclopedia with `deeptipIndex`.
4. Push live values from an effect; switch languages with `DeepTipService.setLocale`.
5. With SSR: check the server HTML and the console for hydration errors; keep the CSP free of exceptions for DeepTip.
6. Validate the glossaries with `tools/deeptip-check.mjs --scan src`; test the integration in a browser and compare with the web example.
