# DeepTip on server-rendered pages: integration guide

How to use [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) on websites whose HTML is rendered on the server or at build time: PHP and WordPress, Laravel Blade, Django and Jinja templates, Ruby on Rails ERB, ASP.NET Razor Pages, and static site generators such as Hugo and Astro.

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust; PHP, Python, Ruby and C# appear only as short snippets. The pages use the web runtime [`frameworks/web/deeptip.js`](../web/README.md) unchanged. The server's part is small: serve two files and the glossaries, write `data-deeptip` attributes into the HTML, optionally write terms with their titles, and load one small module per page. The algorithms are in [docs/algorithms.md](../../docs/algorithms.md), the contract is [SPEC.md](../../SPEC.md). Statements marked *(checked)* were verified on 2026-10-29 in headless Chrome 156 with real mouse and keyboard input: a static site, Django 6.1, Flask 3.1 with Jinja 3.1, ASP.NET Core 10 Razor Pages, Astro 7.4, Turbo 8.0 and htmx 2.0. PHP (WordPress, Laravel), Ruby (Rails) and Hugo were not installed: their snippets are marked *(verify)*, which means checked against the official documentation, not run.

## Quick start

**Recognise the project:** `wp-config.php` or `wp-content/` (WordPress), `artisan` and `resources/views/*.blade.php` (Laravel), `manage.py` and `templates/` (Django), a Flask or other Python app with Jinja `templates/` (Jinja), `Gemfile` with `rails` and `app/views/**/*.erb` (Rails), a `*.csproj` with `Pages/*.cshtml` (Razor Pages), `hugo.toml` (Hugo), `astro.config.mjs` (Astro).

1. Copy `frameworks/web/deeptip.js` and `deeptip.css` into the folder your server serves as static files, e.g. `static/deeptip/`.
2. Put your glossary next to them: `static/deeptip/en.json`.
3. In the base layout, link the stylesheet and start DeepTip, as below (section 2 replaces the inline script by a file).
4. Mark an element in any template with `data-deeptip="key"`.
5. Open a page and rest the pointer on the element.

```html
<!-- what the base layout writes into every page -->
<link rel="stylesheet" href="/static/deeptip/deeptip.css" />
<button data-deeptip="shop.cart">Cart</button>
<script type="module">
  import { DeepTip } from "/static/deeptip/deeptip.js";
  DeepTip.init({ locale: document.documentElement.lang || "en", sources: ["/static/deeptip/{locale}.json"] });
</script>
```

**Done when:** resting the pointer on the element opens a window with the entry's title, the element carries `data-dt-open` while it is open, the glossary request in the browser's network panel returns 200, the console shows no `DeepTip:` warning.

## 1. Serve the files

| File | Served as | Notes |
|---|---|---|
| `deeptip.js`, `deeptip.css` | static files, e.g. `/static/deeptip/` | copies of `frameworks/web`; never edit them, update from the repository |
| `init.js` (section 2) | next to `deeptip.js` | one small module for every page |
| glossaries `glossary/core/<locale>.json` and yours | `/static/deeptip/core/<locale>.json`, `/static/deeptip/<locale>.json` | fetched per language, core first ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) |

- The runtime fetches `sources` by replacing `{locale}` in each template, so the glossary file names must stay predictable: content-hashed file names (Django's `ManifestStaticFilesStorage`, Rails' asset digests, `MapStaticAssets` fingerprints in ASP.NET, bundler hashes) cannot be expressed as a `{locale}` template. Keep the glossaries under plain names (`public/`, `wwwroot/`, `static/`) and version them with a query instead: `en.json?v=1.0.0` *(checked)*.
- Serve JSON with `Content-Type: application/json` and `.js` with a JavaScript type (module scripts refuse other types).
- Download `DeepTip-server-html-1.0.0.zip` from the releases (it contains `frameworks/web/`, the glossaries and this guide) or copy the files from the repository.

## 2. One init module for every page

The Quick start works as it is *(checked)*; this module replaces its inline script, so pages need no inline script at all:

```js
// static/deeptip/init.js — one small module for every server-rendered page
import { DeepTip } from "./deeptip.js";

const here = new URL("./", import.meta.url).href; // this folder; a string, so "{locale}" stays as it is
const params = new URL(import.meta.url).searchParams;
const version = params.get("v") ?? params.get("ver") ?? ""; // init.js?v=… (WordPress: ?ver=…) versions the glossaries too
const query = version ? `?v=${encodeURIComponent(version)}` : "";
const locale = (document.documentElement.lang || "en").split("-")[0];

// optional: the server embedded the glossary layers as <script type="application/json" id="deeptip-glossary">[core, project]</script>
const embedded = document.getElementById("deeptip-glossary");
const layers = embedded ? JSON.parse(embedded.textContent) : null;

export const dt = DeepTip.init({
  locale,
  fallback: ["en"],
  sources: layers ? [] : [`${here}core/{locale}.json${query}`, `${here}{locale}.json${query}`],
});
for (const glossary of layers ?? []) dt.add(glossary.$locale ?? locale, glossary); // core first, project after

const within = (root, selector) => [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];

/** Texts in data-deeptip-text and the encyclopedia in [data-deeptip-index], in `root` and below it. */
export function renderPage(root = document) {
  for (const el of within(root, "[data-deeptip-text]")) dt.renderText(el, el.dataset.deeptipText);
  for (const el of within(root, "[data-deeptip-index]")) dt.renderIndex(el);
}

/** Before a library replaces the page: close the windows, stop updating encyclopedias that leave. */
export function leavePage(root = document) {
  dt.closeAll();
  for (const el of within(root, "[data-deeptip-index]")) dt.removeIndex(el);
}

await dt.ready;
renderPage();
```

```html
<!-- in the base layout's <head> -->
<link rel="stylesheet" href="/static/deeptip/deeptip.css" />
<script type="module" src="/static/deeptip/init.js?v=1.0.0"></script>
```

- No configuration in the page: the language comes from `<html lang>`, the glossary URLs from the module's own URL. `new URL("{locale}.json", import.meta.url)` would percent-encode the braces (`%7Blocale%7D`), so the folder is computed once and the template appended as a string *(checked)*.
- A module script runs once, after the HTML is parsed, so `init.js` sees the whole page (and the embedded JSON block). Every full page load starts a new controller; nothing has to be cleaned up.
- Other modules import the same instance: `import { dt } from "/static/deeptip/init.js?v=1.0.0"` (the URL, query included, must be the same, or the browser loads a second copy).

## 3. Mark elements in templates

```html
<button data-deeptip="shop.cart">Cart</button>
<button data-deeptip="deeptip.about" data-deeptip-delay="0" aria-label="Help">?</button>
<label data-deeptip="shop.zip" data-deeptip-place="top,bottom">ZIP <input name="zip" /></label>
```

Write the key with your template engine's normal attribute escaping (`{{ key }}`, `<%= key %>`, `@key`); keys contain only letters, digits, `_`, `-` and dots ([SPEC §2.1](../../SPEC.md#21-files-and-layers)). The element keeps its own click action and form behaviour ([SPEC §3.3](../../SPEC.md#33-opening)). Do not give marked elements a `title` (two tooltips).

## 4. Terms in page texts

**a) Written by the server.** A helper writes each term as the element `renderText` would create, a button with the class `dt-link` and the key in `data-dt-key`:

```html
<p>Rebels threaten your <button type="button" class="dt-link" data-dt-key="demo.province">Province</button>.</p>
```

The runtime treats every `.dt-link[data-dt-key]` outside its windows as a term on the page (the RPG Maker plugin relies on the same): hover for `linkDelay` opens a preview and a click pins it *(checked)*; Enter and F1 work from the keyboard as on any term. The helper reads the title from the glossary JSON at render time, in the request's language, with the same fallback as the runtime (first locale of `[lang, …fallback]` that has the key, [§1.2](../../docs/algorithms.md#12-layers-locales-lookup)), and writes plain text with `dt-link dt-missing` when no locale has the key. Advantages: the words are in the HTML (search engines, no-JS), nothing moves when DeepTip starts. The helpers for each stack are in section 11; they read flat keys (`"demo.province": {…}`), so keep server-read glossaries flat or flatten nested ones first ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)).

**b) Rendered in the browser.** Put DeepTip markup into an attribute and let `init.js` render it after `ready` (`renderPage`):

```html
<p data-deeptip-text="Loop: [[demo.stability]] → [[demo.unrest]] → [[demo.revolt]]."></p>
```

Simpler on the server (no helper), but the paragraph is empty until the glossaries are loaded. Use it for texts written by editors in DeepTip markup.

## 5. Encyclopedia

An element with `data-deeptip-index` (for example on a `/glossary` page) becomes the searchable list of every entry, with "Mentioned in" backlinks ([§12](../../docs/algorithms.md#12-encyclopedia)); `renderPage` calls `renderIndex` for it *(checked)*. DeepTip re-renders it on every refresh until `removeIndex` (`leavePage`) is called.

## 6. Live values

`{name}` in a glossary text is filled when a window renders ([SPEC §2.5](../../SPEC.md#25-live-values)). On a server-rendered page the values come with the HTML or from your own scripts: pass `vars` to `DeepTip.init` (in `init.js` or a page module that imports nothing else), for example `vars: { cart: () => document.querySelectorAll("#cart li").length }`, and call `dt.refresh()` after a script changes something. Values the server knows can be written into `data-*` attributes and read by such functions.

## 7. Language per request

- The language is chosen per request (URL prefix, cookie, `Accept-Language`) and written into `<html lang="de">`; `init.js` starts DeepTip in it and fetches that language plus the fallback. A language switch is a new page.
- Terms written by the server (section 4a) are already in the request's language: the checked Django and Flask helpers wrote *Provinz* for German and *Province* for English *(checked)*.
- Pages that switch the language without reloading call `await dt.setLocale(locale)` and render their page texts again ([§3](../../docs/algorithms.md#3-rendering-the-ast)); server-written terms then keep their old words until the next page.

## 8. Glossary embedded in the page

Instead of `sources`, the server can embed the glossary layers of the request's language as a JSON data block; `init.js` then adds them with `dt.add()` and fetches nothing *(checked: 0 glossary requests)*:

```html
<script type="application/json" id="deeptip-glossary">[{ "$locale": "en", … core … }, { "$locale": "en", … project … }]</script>
```

A data block is not executed, so a CSP does not restrict it. It must be escaped for HTML: Django's `json_script` filter and Jinja's `tojson` *(checked)*, PHP's `wp_json_encode( $data, JSON_HEX_TAG | JSON_HEX_AMP )`, Rails' `json_escape(data.to_json)` and .NET's `JsonSerializer.Serialize` (its default encoder escapes `<`, `>` and `&`) *(verify)*. It makes every page larger; separate files are cached once for all pages.

## 9. Caching

- Glossaries, `deeptip.js` and `deeptip.css` are static: serve them with long cache lifetimes and change the version query (`init.js?v=…`) with every release of the glossaries; `init.js` passes it on to the glossary URLs *(checked)*.
- Full-page caches (WordPress caching plugins, CDNs, `Cache-Control` on HTML) are fine: everything DeepTip adds happens in the browser. Cache pages per language when terms are written by the server.

## 10. Content Security Policy

`init.js` needs no inline script, and DeepTip needs no inline style and no `eval`: it creates nodes with `createElement`/`textContent` and sets styles through the CSSOM (`element.style.setProperty`), which a CSP does not restrict. `default-src 'self'; script-src 'self'; style-src 'self'` produced no violation with a meta tag, Django 6's built-in `SECURE_CSP`, a Flask header and an ASP.NET Core header *(checked)*. The libraries around DeepTip may need more: Turbo inserts a `<style>` for its progress bar when it starts and takes a nonce from `<meta name="csp-nonce">` *(checked: blocked under `style-src 'self'`)*; htmx needs `<meta name="htmx-config" content='{"includeIndicatorStyles": false}'>` to add no `<style>` *(checked)*.

## 11. Pages swapped by Turbo, htmx, Astro view transitions, Livewire

Libraries that fetch the next page and swap it into the current document keep DeepTip's listeners (they live on `document` and `window`), but they replace elements:

- **The whole `<body>`** (Turbo Drive, Astro's `<ClientRouter />`, Livewire's `wire:navigate`, htmx's `hx-boost`): DeepTip's windows are children of the old body and vanish with it, but stay in the controller's list, and the observer that watches for removed anchors still watches the old body. Without countermeasures the checked Turbo page kept two invisible window records, and removing an anchor on the new page no longer closed its preview *(checked)*. Close everything before the swap and render the new page's texts after it:

  ```js
  // static/deeptip/turbo-glue.js — Turbo Drive replaces <body> on every visit
  import "/static/vendor/turbo.js";
  import { dt, renderPage, leavePage } from "./init.js?v=1.0.0";

  document.addEventListener("turbo:before-render", () => leavePage());
  document.addEventListener("turbo:load", () => dt.ready.then(() => renderPage()));
  ```

  With it, a visit left no window records, the new page's texts and encyclopedia were rendered, and anchors on the new page behaved normally *(checked)*. Astro: `astro:before-swap` and `astro:page-load` *(checked)*. Livewire: `livewire:navigating` and `livewire:navigated` *(verify)*. htmx with `hx-boost`: `htmx:beforeSwap` for swaps of the body *(verify)*.
- **Parts of the page** (htmx `hx-target`, Turbo Frames, Livewire updates): the runtime notices removed anchors by itself (previews close, pinned windows freeze, [§4.5](../../docs/algorithms.md#45-anchors-that-disappear)) *(checked with htmx)*; only the new piece's texts need rendering: `document.addEventListener("htmx:load", (e) => dt.ready.then(() => renderPage(e.detail.elt)))` *(checked)*.

## 12. Stacks

### 12.1 PHP and WordPress *(verify)*

```php
// wp-content/plugins/my-deeptip/my-deeptip.php (excerpt): files in my-deeptip/deeptip/
add_action( 'wp_enqueue_scripts', function () {
	$base = plugin_dir_url( __FILE__ ) . 'deeptip/';
	wp_enqueue_style( 'deeptip', $base . 'deeptip.css', array(), '1.0.0' );
	wp_enqueue_script_module( 'my-deeptip-init', $base . 'init.js', array(), '1.0.0' ); // WordPress 6.5+: <script type="module" src="…init.js?ver=1.0.0">
} );

function my_deeptip_title( string $key ): ?string {
	static $cache = array();
	$lang = strtok( determine_locale(), '_' ); // de_DE → de
	foreach ( array_unique( array( $lang, 'en' ) ) as $locale ) {
		if ( ! isset( $cache[ $locale ] ) ) {
			$cache[ $locale ] = array();
			foreach ( array( "core/$locale.json", "$locale.json" ) as $file ) { // core first, project after
				$path = plugin_dir_path( __FILE__ ) . "deeptip/$file";
				if ( is_readable( $path ) ) {
					$cache[ $locale ] = array_merge( $cache[ $locale ], (array) json_decode( file_get_contents( $path ), true ) );
				}
			}
		}
		if ( isset( $cache[ $locale ][ $key ]['title'] ) ) {
			return $cache[ $locale ][ $key ]['title'];
		}
	}
	return null;
}

// [deeptip key="demo.province"] or [deeptip key="demo.unrest"]unrest[/deeptip]: a term; add element="1" for an element that opens on rest
add_shortcode( 'deeptip', function ( $atts, $content = null ) {
	$a     = shortcode_atts( array( 'key' => '', 'element' => '' ), $atts, 'deeptip' );
	$key   = sanitize_text_field( $a['key'] );
	$title = my_deeptip_title( $key );
	$label = $content ? $content : ( $title ?? $key );
	if ( $a['element'] ) {
		return sprintf( '<span data-deeptip="%s" tabindex="0">%s</span>', esc_attr( $key ), esc_html( $label ) );
	}
	return $title
		? sprintf( '<button type="button" class="dt-link" data-dt-key="%s">%s</button>', esc_attr( $key ), esc_html( $label ) )
		: sprintf( '<span class="dt-link dt-missing">%s</span>', esc_html( $label ) );
} );
```

- `wp_enqueue_script_module` (WordPress 6.5+, the Script Modules API) prints a module script; `init.js` imports `./deeptip.js` relatively, so no import map entry is needed. Module dependencies are module ids, never classic script handles. The version becomes `?ver=1.0.0`, which `init.js` passes on to the glossaries.
- The theme's `language_attributes()` writes `<html lang="de-DE">`, which `init.js` reads.
- Blocks: use the Shortcode block, or a Custom HTML block with the attribute (the `data-*` attributes are allowed in post content). Developers can add the attribute to a block's HTML in a `render_block` filter with `WP_HTML_Tag_Processor` (6.2+): find the tag (for example by the block's HTML anchor, `$block['attrs']['anchor']`), then `$p->set_attribute( 'data-deeptip', $key )` and return `$p->get_updated_html()`.
- Page caches store the shortcode output per URL; with several languages, cache per language (most multilingual plugins do).

### 12.2 Laravel Blade *(verify)*

```blade
{{-- resources/views/components/deeptip-term.blade.php: <x-deeptip-term key="demo.province" /> --}}
@props(['key', 'text' => null])
@php($title = \App\Support\DeepTipGlossary::title($key, app()->getLocale()))
@if ($title)
<button type="button" class="dt-link" data-dt-key="{{ $key }}">{{ $text ?? $title }}</button>
@else
<span class="dt-link dt-missing">{{ $text ?? $key }}</span>
@endif
```

- `App\Support\DeepTipGlossary::title()` is the lookup of 12.1, reading `public_path("deeptip/…")`.
- Layout: `<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">`, `<link rel="stylesheet" href="{{ asset('deeptip/deeptip.css') }}">`, `<script type="module" src="{{ asset('deeptip/init.js') }}?v=1.0.0"></script>`, files in `public/deeptip/`. With Vite, import the runtime in `resources/js/app.js` and keep the glossaries in `public/deeptip/`; for a CSP nonce on the Vite tags, `Vite::useCspNonce()`.

### 12.3 Django

```python
# yourapp/templatetags/deeptip.py: {% load deeptip %} … {% deeptip_term "demo.province" %} or {% deeptip_term "demo.unrest" "unrest" %}
import json
from functools import lru_cache

from django import template
from django.contrib.staticfiles import finders
from django.utils.html import format_html
from django.utils.translation import get_language

register = template.Library()
FALLBACK = ["en"]


@lru_cache(maxsize=None)
def entries(locale):
    """Core first, project after: a later layer overrides an entry with the same key (flat keys)."""
    merged = {}
    for name in (f"deeptip/core/{locale}.json", f"deeptip/{locale}.json"):
        path = finders.find(name)
        if path:
            with open(path, encoding="utf-8") as f:
                merged.update({k: v for k, v in json.load(f).items() if not k.startswith("$")})
    return merged


@register.simple_tag
def deeptip_term(key, text=None):
    lang = (get_language() or "en").split("-")[0]
    for locale in dict.fromkeys([lang, *FALLBACK]):
        entry = entries(locale).get(key)
        if entry:
            return format_html('<button type="button" class="dt-link" data-dt-key="{}">{}</button>', key, text or entry["title"])
    return format_html('<span class="dt-link dt-missing">{}</span>', text or key)
```

```django
{% load static deeptip i18n %}{% get_current_language as LANG %}<!doctype html>
<html lang="{{ LANG }}">
  <head>
    <link rel="stylesheet" href="{% static 'deeptip/deeptip.css' %}" />
    <script type="module" src="{% static 'deeptip/init.js' %}?v=1.0.0"></script>
  </head>
  <body>
    <button data-deeptip="{{ help_key }}" data-deeptip-delay="0" aria-label="Help">?</button>
    <p>Rebels threaten your {% deeptip_term "demo.province" %}.</p>
    <p data-deeptip-text="{{ intro }}"></p>
  </body>
</html>
```

- *(checked)* with Django 6.1 (the checked tag also flattened nested files). `format_html` escapes the key and the title; `{{ intro }}` is escaped for the attribute.
- Embedding: `{{ layers|json_script:"deeptip-glossary" }}` writes the data block of section 8 *(checked)*.
- Django 6's `ContentSecurityPolicyMiddleware` with `SECURE_CSP = {"default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'"]}` sends the header *(checked)*.
- `ManifestStaticFilesStorage` hashes names: reference `init.js` through `{% static %}`; `./deeptip.js` and the glossaries keep working under their plain names, which `collectstatic` also writes.

### 12.4 Jinja (Flask)

```python
from flask import Flask
from markupsafe import Markup

app = Flask(__name__)

@app.template_global()
def deeptip_term(key, text=None, lang="en"):
    for locale in dict.fromkeys([lang, "en"]):
        found = entry(locale, key)  # lookup as in 12.3, reading app.static_folder / "deeptip"
        if found:
            return Markup('<button type="button" class="dt-link" data-dt-key="{}">{}</button>').format(key, text or found["title"])
    return Markup('<span class="dt-link dt-missing">{}</span>').format(text or key)
```

```jinja
<html lang="{{ lang }}">
<link rel="stylesheet" href="{{ url_for('static', filename='deeptip/deeptip.css') }}" />
<script type="module" src="{{ url_for('static', filename='deeptip/init.js', v='1.0.0') }}"></script>
<p>Rebels threaten your {{ deeptip_term('demo.province', lang=lang) }}.</p>
<script type="application/json" id="deeptip-glossary">{{ layers|tojson }}</script>
```

*(checked)* with Flask 3.1 and Jinja 3.1: `Markup.format` escapes its arguments, `url_for(…, v=…)` appends `?v=1.0.0`, `tojson` escapes for HTML.

### 12.5 Ruby on Rails ERB *(verify)*

```ruby
# app/helpers/deeptip_helper.rb: <%= deeptip_term "demo.province" %>
module DeeptipHelper
  def deeptip_term(key, text = nil)
    title = DeeptipGlossary.title(key, I18n.locale.to_s) # the lookup of 12.1, reading Rails.public_path.join("deeptip", …)
    return content_tag(:span, text || key, class: "dt-link dt-missing") unless title
    content_tag(:button, text || title, type: "button", class: "dt-link", data: { dt_key: key })
  end
end
```

- Layout: `<html lang="<%= I18n.locale %>">`, `<link rel="stylesheet" href="/deeptip/deeptip.css">`, `<script type="module" src="/deeptip/init.js?v=1.0.0"></script>`, files in `public/deeptip/`. Files under `app/assets` get digested names (Propshaft, Sprockets), which break the relative import in `init.js` and the `{locale}` templates; with importmap-rails, pin the runtime (`pin "deeptip", to: "deeptip.js"`) and import it by that name.
- Turbo Drive is on by default in Rails: add the glue of section 11.

### 12.6 ASP.NET Core Razor Pages

```csharp
// TagHelpers/DeepTipTermTagHelper.cs: <deeptip-term key="demo.province" /> (register: @addTagHelper *, YourAssembly)
[HtmlTargetElement("deeptip-term", TagStructure = TagStructure.WithoutEndTag)]
public sealed class DeepTipTermTagHelper(IWebHostEnvironment env) : TagHelper
{
    public string Key { get; set; } = "";
    public string? Text { get; set; }

    public override void Process(TagHelperContext context, TagHelperOutput output)
    {
        string? title = Glossary.Title(env.WebRootPath, Key, CultureInfo.CurrentUICulture.TwoLetterISOLanguageName); // the lookup of 12.1
        output.TagMode = TagMode.StartTagAndEndTag;
        if (title is null)
        {
            output.TagName = "span";
            output.Attributes.SetAttribute("class", "dt-link dt-missing");
            output.Content.SetContent(Text ?? Key); // SetContent HTML-encodes
            return;
        }
        output.TagName = "button";
        output.Attributes.SetAttribute("type", "button");
        output.Attributes.SetAttribute("class", "dt-link");
        output.Attributes.SetAttribute("data-dt-key", Key);
        output.Content.SetContent(Text ?? title);
    }
}
```

- *(checked)* with .NET 10: layout `<html lang="@CultureInfo.CurrentUICulture.TwoLetterISOLanguageName">`, `<link rel="stylesheet" href="~/deeptip/deeptip.css" asp-append-version="true" />`, `<script type="module" src="~/deeptip/init.js?v=1.0.0"></script>`, files in `wwwroot/deeptip/`; `UseRequestLocalization` chose German from the browser's `Accept-Language`; a middleware sent the CSP header.
- With `MapStaticAssets`, `asp-append-version` writes fingerprinted names (`deeptip.i7ziv7lx0w.css`) *(checked)*; keep `init.js` and the glossaries under their plain names as above.
- The Blazor guide ([frameworks/blazor](../blazor/README.md)) covers interactive Blazor; static server rendering there works like this section.

### 12.7 Hugo *(verify)*

```go-html-template
{{/* layouts/_shortcodes/deeptip.html: {{< deeptip key="demo.province" >}} or {{< deeptip key="demo.unrest" >}}unrest{{< /deeptip >}} */}}
{{- $key := .Get "key" -}}
{{- $entries := index site.Data.deeptip site.Language.Lang | default dict -}}
{{- with index $entries $key -}}
<button type="button" class="dt-link" data-dt-key="{{ $key }}">{{ $.Inner | default .title }}</button>
{{- else -}}
<span class="dt-link dt-missing">{{ $.Inner | default $key }}</span>
{{- end -}}
```

- The glossaries are needed twice: as data at build time (`data/deeptip/<lang>.json` → `site.Data.deeptip.<lang>`) and as static files at run time (`static/deeptip/`). Mount one folder at both places in `hugo.toml` (`[[module.mounts]]` with `source = "glossary"` and the targets `data/deeptip` and `static/deeptip`; mounting replaces the default `data` and `static` mounts, so mount those too).
- Layout: `<html lang="{{ site.Language.LanguageCode }}">`, the stylesheet and `init.js` from `static/deeptip/` with `?v=…`.
- Older Hugo versions read shortcodes from `layouts/shortcodes/`.

### 12.8 Astro

```astro
---
// src/components/Term.astro: <Term key="demo.province" lang="en" />, the title is read from the glossary at build time
import { readFileSync, existsSync } from "node:fs";

interface Props {
  key: string;
  text?: string;
  lang?: string;
}
const { key, text, lang = "en" } = Astro.props;
const layer = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const lookup = (l: string) => layer(`public/deeptip/${l}.json`)[key] ?? layer(`public/deeptip/core/${l}.json`)[key];
const entry = lookup(lang) ?? lookup("en");
---
{entry ? <button type="button" class="dt-link" data-dt-key={key}>{text ?? entry.title}</button> : <span class="dt-link dt-missing">{text ?? key}</span>}
```

```astro
---
// src/components/DeepTip.astro: put it into the <head> of the layout
import "../deeptip/deeptip.css";
---
<script>
  import { DeepTip } from "../deeptip/deeptip.js";

  const locale = (document.documentElement.lang || "en").split("-")[0];
  const dt = DeepTip.init({ locale, fallback: ["en"], sources: ["/deeptip/core/{locale}.json", "/deeptip/{locale}.json"] });
  const render = () => {
    for (const el of document.querySelectorAll<HTMLElement>("[data-deeptip-text]")) dt.renderText(el, el.dataset.deeptipText ?? "");
    for (const el of document.querySelectorAll("[data-deeptip-index]")) dt.renderIndex(el);
  };
  // with <ClientRouter />: the body is swapped on every navigation
  document.addEventListener("astro:before-swap", () => {
    dt.closeAll();
    for (const el of document.querySelectorAll("[data-deeptip-index]")) dt.removeIndex(el);
  });
  document.addEventListener("astro:page-load", () => dt.ready.then(render)); // first load and after every swap
</script>
```

*(checked)* with Astro 7.4 (which needs Node 22.23.4 or newer): the runtime is bundled into one module file, `deeptip.css` into a stylesheet file (no inline `<style>` or `<script>` in the output), the glossaries stay in `public/deeptip/`, and `<ClientRouter />` navigation worked without a CSP violation.

## 13. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root` or `body` in your stylesheet: windows are appended to `document.body`. Hooks on your own elements: `[data-dt-open]` while its window is open (hide your own simple tooltip), `[data-dt-arming]` with `var(--dt-delay)` while the pointer rests on it. Server-written terms take the same `.dt-link` look as terms inside windows.

## 14. Validator

`node tools/deeptip-check.mjs --base en static/deeptip/en.json static/deeptip/de.json --scan templates` checks the glossaries and every key used in source files. Since 1.1.0 `--scan` reads the templates of every server in this guide (`.html`, `.htm`, `.php` including `.blade.php`, `.erb`, `.twig`, `.jinja`, `.j2`, `.astro`, `.cshtml`, `.razor`), JavaScript, TypeScript, Python, C# and `.json` files, and finds `data-deeptip="key"`, `data-dt-key="key"`, `[[key]]` and the helpers shown here: `[deeptip key="…"]`, `{{< deeptip key="…" >}}`, `<x-deeptip-term key="…">`, `<deeptip-term key="…">`, `deeptip_term "…"` and `deeptip_term('…')`, and Astro's `<Term key="…">`. It skips build output (`dist/`, `build/`, `out/`, `vendor/` …) and does not read Markdown: for shortcodes in Hugo or Astro content files, scan the built site instead. A key that a template puts together from variables is found only in the rendered HTML.

## 15. Testing

- Rendered HTML: request a page in a test (Django's test client, Flask's `test_client()`, `WebApplicationFactory`, a static build) and assert the attributes and term buttons, including the missing-key case and the language (`Provinz` vs `Province`) *(checked)*.
- Behaviour: open the page in Chromium (Playwright or the DevTools protocol), move the mouse onto a marked element and onto a term, wait for `.dt-win[data-dt-key="…"]:popover-open`, click to pin, and check that no `securitypolicyviolation` fired. Count open windows with `:popover-open`: a closing window stays in the DOM until its fade-out ends.
- The parser, the placement and the glossary flattening are the web runtime's: `npm test` in the repository runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 16. The example to build

The same screen as `frameworks/web/example`, rendered by the server: a HUD row of buttons marked `demo.realm`, `demo.stability` (a form or link that changes it, live value `{stability}` written into the page), `demo.taxes`, `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `data-deeptip-delay="0"`, the language per request (`/de/`, `/`; fallback `["de", "en"]` in `init.js` for this example, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges, a paragraph with server-written terms, one with `data-deeptip-text`, and a `/glossary` page with `data-deeptip-index`. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`. Compare its behaviour with the web example: `npm run demo` in the repository, then `http://localhost:5560/frameworks/web/example/`.

## 17. Limitations

- The runtime is the web runtime, unchanged; there are no server-side DeepTip windows. Pages without JavaScript show server-written terms as plain buttons that do nothing.
- Terms written by the server keep the page's language; a client-side language switch re-renders only DeepTip's windows and `data-deeptip-text` texts.
- The helpers shown here read flat glossary keys and only the `title`; markup in titles is not interpreted.

## 18. Checklist

1. Serve `deeptip.js`, `deeptip.css`, `init.js` and the glossaries as static files under plain names; version them with a query.
2. Load the stylesheet and `init.js` in the base layout; write the request's language into `<html lang>`.
3. Mark elements with `data-deeptip`; write terms with a server helper or `data-deeptip-text`; add a page with `data-deeptip-index`.
4. With Turbo, Astro view transitions, Livewire navigation or `hx-boost`: close all windows before the swap and render texts after it.
5. Keep the CSP strict; give libraries like Turbo their nonce.
6. Validate the glossaries with `--scan` over the templates (section 14) and test a page in a browser.
