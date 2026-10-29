# DeepTip for Blazor: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Blazor application (Blazor Web App with interactive Server or WebAssembly rendering, or standalone WebAssembly), .NET 8 or newer.

Blazor runs in a browser, so it uses the **web runtime** ([frameworks/web](../web/README.md): `deeptip.js` + `deeptip.css`) through JS interop; nothing is ported to C#. This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust, and this guide is the exact recipe for the .NET side. The download `DeepTip-blazor-1.0.0.zip` contains this guide together with `frameworks/web`, the glossaries, the schema, the shared test cases, [SPEC.md](../../SPEC.md) and [docs/algorithms.md](../../docs/algorithms.md). Statements marked *(checked)* were verified on 2026-10-29 with a .NET 8 Blazor Web App (interactive server rendering, global interactivity) driven by headless Chromium 149 through Playwright 1.61: the snippets below are the code of that run, and its 12 checks passed (initialisation with `sources`, live values, terms in page text, encyclopedia, a window on hover, `OnOpen` in .NET, a term preview, click pins the term and its parent, `OnPin` in .NET, Esc closes the newest window, Shift+Esc closes all, the element's own `@onclick` still runs and `setValues` refreshes the open window, `setLocale` switches the language).

## Quick start

**Recognise the project:** `.razor` files, and a `Program.cs` that calls `AddRazorComponents()` (Blazor Web App) or a `.csproj` with `Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"` (standalone WebAssembly).

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` to `wwwroot/deeptip/` and `glossary/core/en.json` to `wwwroot/deeptip/glossary/core/en.json`; your own entries go to `wwwroot/deeptip/en.json` (section 3).
2. Link `deeptip/deeptip.css` in the `<head>` of `Components/App.razor` (standalone WebAssembly: `wwwroot/index.html`).
3. Add the glue `wwwroot/deeptip/deeptip-blazor.js` (section 3) and `DeepTipService` (section 4) unchanged; register it with `builder.Services.AddScoped<DeepTipService>();`.
4. Initialise once in an interactive layout and mark elements with `data-deeptip="key"` (below; other render modes: section 8).
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en wwwroot/deeptip/glossary/core/en.json wwwroot/deeptip/en.json --scan Components`.

```razor
@* Components/Layout/MainLayout.razor, with <Routes @rendermode="InteractiveServer" /> in App.razor *@
@inherits LayoutComponentBase
@inject DeepTipService DeepTip

<button data-deeptip="deeptip.about" aria-label="Help">?</button>
@Body

@code {
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (firstRender)
            await DeepTip.InitAsync(new { locale = "en", sources = new[] { "deeptip/glossary/core/{locale}.json", "deeptip/{locale}.json" } });
    }
}
```

**Done when:** resting on `?` for 800 ms opens the *DeepTip* window below it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows, `Esc` closes the newest window and no `@onkeydown` handler sees that Esc, the validator reports 0 errors.

## 1. Parts

| Part | Where | Does |
|---|---|---|
| `deeptip.js`, `deeptip.css` | `wwwroot/deeptip/` (copies of `frameworks/web`) | the whole behaviour: windows in the top layer, placement, mouse/touch/keyboard/gamepad, accessibility, encyclopedia |
| `deeptip-blazor.js` (section 3) | `wwwroot/deeptip/` | creates the controller from JSON options; owns the live values; forwards callbacks to .NET |
| `DeepTipService` (section 4) | C#, registered as scoped | imports the glue, initialises once, waits for that in every call, raises `Opened`, `Closed`, `Pinned` |
| initialisation (section 5) | the layout's `OnAfterRenderAsync` | once per circuit (Server) or per app (WebAssembly) |
| your markup | any component | `data-deeptip="key"` on elements |
| glossaries | `wwwroot/deeptip/glossary/…` | `glossary/core/{locale}.json`, then your project's files ([§1](../../docs/algorithms.md#1-data)) |

## 2. SPEC concept → Blazor

| SPEC | Blazor |
|---|---|
| UI element with an explanation | `data-deeptip="key"` in Razor markup, plus `data-deeptip-delay` and `data-deeptip-place`; `deeptip.js` delegates from `document`, so re-rendered elements need no registration |
| A component as anchor | the component passes the attribute to its root element: `[Parameter(CaptureUnmatchedValues = true)] public Dictionary<string, object>? Rest { get; set; }` and `@attributes="Rest"` |
| Window tree, grace, tendency, placement, input, focus, ARIA | the web runtime, unchanged ([frameworks/web](../web/README.md)) |
| Terms in a normal text (`renderText`) | `ElementReference` of an element that Razor leaves empty |
| Encyclopedia (`renderIndex`) | the same, `removeIndex` on dispose |
| Live values (`vars`, SPEC §2.5) | pushed from .NET with `setValues`; the glue's `vars` function reads them; `refresh()` re-renders open windows |
| `onOpen`, `onClose`, `onPin` | `DotNetObjectReference` + `[JSInvokable]` |
| `setLocale`, `configure` | awaitable calls (they return promises) |
| Options (SPEC §7) | the JSON-serialisable ones, camelCase; functions exist only in the glue |
| Theming (SPEC §8) | `--dt-*` custom properties in a global stylesheet |
| The element's own click | untouched: `@onclick` keeps working *(checked)* |

## 3. Files and the glue module

```
wwwroot/deeptip/deeptip.js              copy of frameworks/web/deeptip.js (never edit it there)
wwwroot/deeptip/deeptip.css             copy of frameworks/web/deeptip.css
wwwroot/deeptip/deeptip-blazor.js       the glue below
wwwroot/deeptip/glossary/core/en.json   copies of glossary/core/*.json
wwwroot/deeptip/glossary/example/…      or your own deeptip/{locale}.json
```

Stylesheet: `<link rel="stylesheet" href="deeptip/deeptip.css" />` in the `<head>` of `Components/App.razor` (Blazor Web App) or `wwwroot/index.html` (standalone WebAssembly). In a Razor class library the same files live in its `wwwroot` and are addressed as `_content/<AssemblyName>/deeptip/…`.

`wwwroot/deeptip/deeptip-blazor.js` *(checked)*:

```js
// Glue between Blazor (.NET) and the DeepTip web runtime. Options arrive as plain JSON; everything that must be a
// function in JavaScript (live values, callbacks) is created here.
import { DeepTip } from "./deeptip.js";

let dt = null;
let values = {};

export async function init(options, dotnet) {
  dt?.destroy();
  values = {};
  const call = (method, ...args) => dotnet?.invokeMethodAsync(method, ...args).catch(() => {});
  dt = DeepTip.init({
    ...options,
    vars: (name) => values[name],
    onOpen: dotnet ? (key) => call("OnOpen", key) : null,
    onClose: dotnet ? (key) => call("OnClose", key) : null,
    onPin: dotnet ? (key) => call("OnPin", key) : null,
  });
  await dt.ready;
}

export function setValues(map) {
  Object.assign(values, map);
  dt?.refresh();
}

export const setLocale = (locale) => dt?.setLocale(locale);
export const configure = (options) => dt?.configure(options);
export const addJson = (locale, json) => {
  dt?.add(locale, JSON.parse(json));
};
export const renderText = (element, text) => {
  dt?.renderText(element, text);
};
export const renderIndex = (element) => {
  dt?.renderIndex(element);
};
export const removeIndex = (element) => dt?.removeIndex(element);
export const closeAll = () => dt?.closeAll();
export function destroy() {
  dt?.destroy();
  dt = null;
}
```

- `vars` returns `undefined` for names .NET has not set, so `{name}` stays visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).
- `init` destroys a previous controller first: two controllers on one document would double every listener.
- The `.catch` keeps a closed circuit from producing unhandled promise rejections.
- `addJson` takes a glossary as a JSON string (for glossaries embedded in a .NET assembly instead of served files).

## 4. The service

*(checked)*; register it with `builder.Services.AddScoped<DeepTipService>();`

```csharp
using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;

/// <summary>One per circuit (Server) or per app (WebAssembly): register as scoped.</summary>
public sealed class DeepTipService(IJSRuntime js) : IAsyncDisposable
{
    private readonly TaskCompletionSource<IJSObjectReference> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private DotNetObjectReference<DeepTipService>? self;

    /// <summary>False during prerendering and until InitAsync finished.</summary>
    public bool IsReady => ready.Task.IsCompletedSuccessfully;

    public event Action<string>? Opened;
    public event Action<string>? Closed;
    public event Action<string>? Pinned;

    /// <summary>Call once, from OnAfterRenderAsync(firstRender) of the layout. Options: only the values you set.</summary>
    public async Task InitAsync(object options)
    {
        if (self != null) return;
        self = DotNetObjectReference.Create(this);
        IJSObjectReference module = await js.InvokeAsync<IJSObjectReference>("import", "./deeptip/deeptip-blazor.js");
        await module.InvokeVoidAsync("init", options, self);
        ready.SetResult(module);
    }

    private async Task Call(string function, params object?[] args) => await (await ready.Task).InvokeVoidAsync(function, args);

    public Task SetValuesAsync(IReadOnlyDictionary<string, object?> values) => Call("setValues", values);
    public Task SetLocaleAsync(string locale) => Call("setLocale", locale);
    public Task ConfigureAsync(object options) => Call("configure", options);
    public Task AddAsync(string locale, string json) => Call("addJson", locale, json);
    public Task RenderTextAsync(ElementReference target, string markup) => Call("renderText", target, markup);
    public Task RenderIndexAsync(ElementReference target) => Call("renderIndex", target);
    public Task RemoveIndexAsync(ElementReference target) => Call("removeIndex", target);
    public Task CloseAllAsync() => Call("closeAll");

    [JSInvokable] public void OnOpen(string key) => Opened?.Invoke(key);
    [JSInvokable] public void OnClose(string key) => Closed?.Invoke(key);
    [JSInvokable] public void OnPin(string key) => Pinned?.Invoke(key);

    public async ValueTask DisposeAsync()
    {
        if (ready.Task.IsCompletedSuccessfully)
        {
            IJSObjectReference module = ready.Task.Result;
            try
            {
                await module.InvokeVoidAsync("destroy");
                await module.DisposeAsync();
            }
            catch (JSDisconnectedException)
            {
                // the browser is gone (Blazor Server): nothing left to clean up
            }
        }
        self?.Dispose();
    }
}
```

Every call waits until `InitAsync` has finished, so components may call the service from their own `OnAfterRenderAsync` before the layout's initialisation is done. An `ElementReference` argument arrives in JavaScript as the DOM element.

## 5. Initialise in the layout

*(checked)*:

```razor
@inherits LayoutComponentBase
@inject DeepTipService DeepTip

@Body

@code {
    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender) return;
        await DeepTip.InitAsync(new
        {
            locale = "en",
            fallback = new[] { "de", "en" },
            sources = new[] { "deeptip/glossary/core/{locale}.json", "deeptip/glossary/example/{locale}.json" },
            delay = 800,
        });
    }
}
```

Pass only the options you set: `deeptip.js` merges them over its defaults (`{ ...DEFAULTS, ...options }`), and Blazor's interop serializer writes `null` properties, so a null in an options class would replace a default (for example `delay: null` opens windows at once). Use anonymous objects as above, or `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` on an options class. Property names become camelCase automatically. The `sources` URLs are fetched relative to the document (`<base href>`).

## 6. Use it in components

*(checked; excerpt of the test page)*:

```razor
@page "/"
@inject DeepTipService DeepTip
@implements IAsyncDisposable

<header>
    <button data-deeptip="demo.realm">Realm</button>
    <button data-deeptip="demo.stability" @onclick="CycleStability">Stability @Signed(stability)</button>
    <button data-deeptip="demo.gold">Gold @gold</button>
    <button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
    <button @onclick="SwitchLanguage">@locale</button>
</header>
<p @ref="intro"></p>
<div @ref="index"></div>

@code {
    private ElementReference intro, index;
    private int stability = 1, gold = 1250;
    private string locale = "en";

    private static string Signed(int v) => (v > 0 ? "+" : "") + v;

    protected override void OnInitialized() => DeepTip.Opened += key => _ = InvokeAsync(() => { /* react */ StateHasChanged(); });

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender) return;
        await PushValues();
        await DeepTip.RenderTextAsync(intro, "A loop to try: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]].");
        await DeepTip.RenderIndexAsync(index);
    }

    private Task PushValues() => DeepTip.SetValuesAsync(new Dictionary<string, object?>
    {
        ["stability"] = Signed(stability),
        ["gold"] = gold.ToString("N0"),
    });

    private async Task CycleStability()
    {
        stability = stability >= 3 ? -3 : stability + 1;
        await PushValues();                                   // the open window shows the new value at once
    }

    private async Task SwitchLanguage()
    {
        locale = locale == "en" ? "de" : "en";
        await DeepTip.SetLocaleAsync(locale);
        await DeepTip.RenderTextAsync(intro, "…");             // page texts are yours to re-render
    }

    public async ValueTask DisposeAsync()
    {
        if (!DeepTip.IsReady) return;                        // prerendering: nothing exists in the browser
        try { await DeepTip.RemoveIndexAsync(index); }
        catch (JSDisconnectedException) { }
    }
}
```

## 7. Order of operations

1. **Prerendering** (server): the HTML with the `data-deeptip` attributes is sent; no JavaScript runs; components are created and disposed at the end of the request. Nothing may wait for DeepTip there (`IsReady` is false).
2. **First interactive render**: the layout's `OnAfterRenderAsync(firstRender: true)` → `InitAsync`: import the glue, create the `DotNetObjectReference`, `init(options, ref)` → `DeepTip.init` loads `sources` for the locale chain and resolves `ready`.
3. **Components' first render**: their calls (`SetValuesAsync`, `RenderTextAsync`, `RenderIndexAsync`) wait for step 2, then run.
4. **Pointer, touch, keyboard, gamepad**: handled in the browser by `deeptip.js`, with no .NET round trip, so grace and tendency are unaffected by Server latency. Only the callbacks travel to .NET, asynchronously and unordered with your own events; a handler that changes component state calls `InvokeAsync(StateHasChanged)`.
5. **Your own state changes**: `@onclick` → update fields → `SetValuesAsync` (refreshes open windows). When Blazor re-renders and replaces an element that anchors a window, `deeptip.js` notices it (MutationObserver): previews close, a pinned root window freezes in place ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)).
6. **Locale**: `SetLocaleAsync` re-renders open windows and encyclopedias; re-render your own `renderText` targets.
7. **Dispose**: components remove their encyclopedias (only when `IsReady`); the scoped service destroys the controller and disposes the module and the reference, ignoring `JSDisconnectedException`.

## 8. Render modes

| Mode | What to do |
|---|---|
| Interactive Server, global (`<Routes @rendermode="InteractiveServer" />`) | as above *(checked)* |
| Interactive WebAssembly, Interactive Auto | the same code: `IJSRuntime`, `IJSObjectReference`, `DotNetObjectReference` behave identically; initialise in a component that is interactive in that runtime |
| Per-page interactivity | a static layout never runs `OnAfterRenderAsync`: call `InitAsync` from an interactive component (the page, or a small component it renders) |
| Static server rendering only | no interop needed: `<script type="module">import { DeepTip } from "./deeptip/deeptip.js"; DeepTip.init({ … });</script>` in `App.razor`; enhanced navigation keeps the document and its listeners |
| Standalone WebAssembly | as above; the stylesheet link goes into `wwwroot/index.html` |

## 9. Pitfalls

- **Awaiting DeepTip during prerendering blocks the page.** In the checked run, a `DisposeAsync` that awaited a service call (which waits for an initialisation that never happens during prerendering) kept the prerender response open: Kestrel never finished the request, the browser stayed at `readyState == "loading"` and Blazor never started. Guard disposal and every other prerender path with `IsReady` *(checked)*.
- **Nulls in options replace defaults** (section 5).
- **Functions cannot cross the interop boundary**: live values and callbacks live in the glue; .NET pushes values.
- **Elements for `renderText` and `renderIndex` stay empty in Razor**: Blazor does not touch DOM children it did not render, as long as the element itself stays (do not recreate it with `@if`; if you do, render into the new element again) *(checked: the text survived re-renders)*.
- **CSS isolation does not reach the windows**: `.razor.css` selectors carry the component's `b-…` attribute, and DeepTip's windows are created outside Blazor's render tree. Put `--dt-*` overrides into a global stylesheet.
- **Static web assets outside Development**: running the build output (not a publish) in another environment serves only the project's own `wwwroot`: the CSS isolation bundle `<App>.styles.css` returned 404, `_framework/blazor.web.js` and `wwwroot/deeptip/*` were served *(checked)*; a class library's `_content/…` files use the same static web assets mechanism. Run in Development, call `builder.WebHost.UseStaticWebAssets()`, or publish. Copying the DeepTip files into the app's own `wwwroot` avoids the question.
- **Esc**: `deeptip.js` stops the Esc that closes a window in the capture phase on `document`; Blazor registers its delegated `keydown` listener on `document` in the bubble phase (capture only for events that do not bubble), so `@onkeydown` handlers never see that Esc *(checked in `blazor.web.js` of .NET 8)*. With no window open, Esc reaches the application.
- **One controller per document**: initialise once (the glue destroys an older controller); several layouts or circuits in one tab share the document.

## 10. Testing

- The parser, the placement and the glossary flattening are the web runtime's: `npm test` runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)). There is nothing to port to C#; if you port parts anyway, the [Avalonia guide](../avalonia/README.md) has the C# parity tests and porting pitfalls.
- Integration: a browser test against the running app with Playwright for .NET *(checked; excerpt)*:

```csharp
await page.GotoAsync(url);
await page.HoverAsync("button[data-deeptip='demo.realm']");
await page.WaitForSelectorAsync(".dt-win[data-dt-key='demo.realm']:popover-open");
ILocator term = page.Locator(".dt-win[data-dt-key='demo.realm'] button.dt-link[data-dt-key='demo.province']");
await term.ClickAsync();
await page.WaitForSelectorAsync(".dt-win[data-dt-key='demo.province'][data-dt-pinned]");
await page.Keyboard.PressAsync("Escape");          // newest window closes
await page.Keyboard.PressAsync("Shift+Escape");    // all windows close
int open = await page.EvaluateAsync<int>("() => document.querySelectorAll('.dt-win:popover-open').length");
```

  Count open windows with `:popover-open`: a closing window stays in the DOM until its fade-out ends. Wait for the page to be interactive first (for example an element your page fills after `RenderIndexAsync`).

## 11. The example to build

The same screen as `frameworks/web/example`, as a Razor page: a HUD row of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `data-deeptip-delay="0"`, a language switch (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a page text with terms (`RenderTextAsync`), settings (delay, lock, buttons, hints through `ConfigureAsync`) and the encyclopedia (`RenderIndexAsync`). Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

## 12. Limitations

None beyond the web runtime's: everything runs in the browser. Callbacks reach .NET asynchronously, and live values are pushed by .NET rather than pulled when a window renders.

## 13. Checklist

1. Copy `deeptip.js`, `deeptip.css` and the glossaries into `wwwroot/deeptip/`; link the stylesheet.
2. Add the glue (section 3) and the service (section 4); register the service as scoped.
3. Initialise in the layout (section 5); mark elements with `data-deeptip`; push live values.
4. Guard prerender paths with `IsReady`; validate your glossaries with `tools/deeptip-check.mjs`.
5. A browser test (section 10) for the integration; compare with the web example by hand.
