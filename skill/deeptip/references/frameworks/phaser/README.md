# DeepTip for Phaser

An adapter that brings [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) into Phaser 3 and Phaser 4 games: rest the pointer on a sprite, a button or a word, read its window, follow the terms inside it as deep as you like. It uses the web runtime [frameworks/web/deeptip.js](../web/README.md) unchanged and adds one file, `deeptip-phaser.js`. Statements marked *(checked)* were verified on 2026-10-29 with Phaser 4.2.1 and 3.90.0 (WebGL) in headless Chrome 156: 32 checks with real mouse and keyboard input (section 12).

## Quick start

**Recognise the project:** `phaser` in `package.json` or a `phaser.min.js` script in the page; `new Phaser.Game({ … })` and scenes that extend `Phaser.Scene`.

1. Copy `frameworks/web/deeptip.js`, `frameworks/web/deeptip.css` and `frameworks/phaser/deeptip-phaser.js` into one folder, e.g. `deeptip/`.
2. Write your glossary as `deeptip/en.json`.
3. Link `deeptip/deeptip.css` in the page.
4. After `new Phaser.Game(…)`, attach DeepTip; in a scene, explain a game object.
5. Rest the pointer on the object.

```js
// main.js (module), deeptip.css linked in the page
import { DeepTipPhaser } from "./deeptip/deeptip-phaser.js";

class Main extends Phaser.Scene {
  create() {
    const castle = this.add.rectangle(480, 270, 160, 120, 0x8866aa);
    tips.explain(castle, "game.castle"); // rest the pointer on it
  }
}
const game = new Phaser.Game({ width: 960, height: 540, scene: Main });
const tips = DeepTipPhaser.attach(game, { locale: "en", sources: ["deeptip/{locale}.json"] });
```

**Done when:** resting the pointer on the object opens a window with the entry's title, a `div[data-deeptip]` lies over the object (DevTools: elements panel), clicks on the object still reach your Phaser handlers, the console shows no `DeepTip:` warning.

## How it works

The windows are the web runtime's ([frameworks/web/deeptip.js](../web/README.md), unchanged) as HTML over the canvas, so all of DeepTip's behaviour is the reference behaviour: window tree ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)), grace and mouse tendency ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), delays ([§6](../../docs/algorithms.md#6-arming-and-delays)), placement ([§8](../../docs/algorithms.md#8-placement)), mouse, touch, keyboard and gamepad ([§9](../../docs/algorithms.md#9-input)). `deeptip-phaser.js` only bridges the game and the runtime:

- **Anchors.** Every explained game object gets one invisible element, which the adapter moves over the object's screen rectangle after every rendered frame (`postrender`), through the object's camera, its scroll factor and the canvas scaling. Objects that are hidden, inactive, outside their camera or in a stopped scene lose their anchor until they are visible again.
- **The pointer stays with the game.** Anchors never take the pointer (`pointer-events: none`), so Phaser receives every real mouse, touch and wheel event exactly as without DeepTip: hover, `pointerdown` (not `pointerdownoutside`), dragging, the hand cursor. The adapter watches the pointer over the canvas, finds the topmost explained object under it and tells the runtime, which then rests, arms, opens and closes as on a web page.
- **Input inside DeepTip windows belongs to DeepTip.** Presses in a window never reach the game (Phaser also listens on `window`, so the adapter stops them on their way up), and while the keyboard focus is in a window the game gets no key presses.

The alternative, windows drawn with Phaser game objects, was rejected: it means porting §2 to §9 (rich text with clickable words, word wrap, focus, placement, every input device) and it would still differ from the reference.

## 1. Files and loading

| File | Where |
|---|---|
| `deeptip-phaser.js` (this folder) | next to `deeptip.js`: it imports `./deeptip.js` |
| `frameworks/web/deeptip.js`, `deeptip.css` | the same folder; link `deeptip.css` in the page |
| glossaries `glossary/core/<locale>.json` and yours | served with the game, e.g. `deeptip/core/<locale>.json`, `deeptip/<locale>.json` |

- The Quick start ran as it is, with the three files side by side *(checked)*.
- The adapter is an ES module and never imports Phaser: it works with Phaser loaded as a script tag (`window.Phaser`) or imported from a bundler, versions 3 and 4.
- The repository's example keeps `deeptip.js` in `frameworks/web` and maps the adapter's import with an import map; in your game the files sit side by side and need no map.
- Download `DeepTip-phaser-1.0.0.zip` from the releases (it contains this folder, `frameworks/web/`, the glossaries and the tests) or copy the files from the repository.

## 2. Attach once

```js
const tips = DeepTipPhaser.attach(game, {
  locale: "en",
  fallback: ["de", "en"],
  sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"], // core first, project after
  delay: 600,
  vars: { gold: () => state.gold.toLocaleString(tips.dt.locale) },
});
```

- One adapter per game, right after `new Phaser.Game(…)`; it may run before the game has booted (it waits for the canvas).
- The options are DeepTip's ([SPEC §7](../../SPEC.md#7-configuration-reference-names)) plus `controller` (attach to a `DeepTip` you created yourself) and `helpKeys` (default `["F1", "?"]`, section 7). The adapter sets the runtime's `container` to its own layer.
- `tips.dt` is the runtime's controller with every call of [the web API](../web/README.md#api): `tips.dt.ready`, `setLocale`, `refresh`, `renderText`, `renderIndex` …
- `game.destroy()` destroys the adapter too: anchors, layers and listeners go, and the controller if the adapter created it. `tips.destroy()` does the same by hand.

## 3. Explain game objects

```js
tips.explain(sprite, "demo.revolt");                                // rest on it
tips.explain(hudButton, "demo.stability", { delay: 0 });            // opens at once
tips.explain(cornerIcon, "demo.prestige", { place: ["left", "top"] });
tips.explain(word, "demo.unrest", { term: true });                  // a term: hover opens, click pins
tips.explain(minimapMarker, "demo.province", { camera: scene.cameras.getCamera("minimap") });
```

- Anything with `getBounds()` can be explained: images, sprites, shapes, texts, containers (the container's bounds cover its children). The object does not need `setInteractive()`.
- The hit area is the object's bounding rectangle on screen (for rotated objects the rectangle around them). When several explained objects lie under the pointer, the one drawn last wins: later scenes over earlier ones, then the scene's display list order (depth), areas below objects.
- Objects with a scroll factor (HUD elements with `setScrollFactor(0)`, also as containers) and zoomed, scrolled or offset cameras are mapped exactly; the checks compare each anchor with Phaser's own `camera.getWorldPoint` at zoom 1.5 and a scrolled camera *(checked, Phaser 3 and 4)*.
- `delay` and `place` are the per-element options of SPEC §3.3 and §4 (`data-deeptip-delay`, `data-deeptip-place`).
- The explanation goes with the object: `destroy()` removes it; `setVisible(false)`, `setActive(false)`, leaving the camera or stopping the scene removes the anchor until the object is back (an open preview closes, a pinned window stays where it was, [§4.5](../../docs/algorithms.md#45-anchors-that-disappear)) *(checked with hidden and destroyed objects)*. `tips.forget(object)` removes the explanation by hand.

Areas without a game object, such as a region of a tilemap, take a function that returns a world rectangle every frame:

```js
tips.explainArea(scene, () => ({ x: 64 * col, y: 64 * row, width: 64, height: 64 }), "demo.province");
```

## 4. Terms in game texts

- A word drawn by Phaser becomes a term with `tips.explain(textObject, key, { term: true })`: hovering it opens a preview after `linkDelay` (80 ms), a click pins it, and while its window is open the anchor shows the link highlight (`.dt-link[data-dt-open]`) over the word *(checked)*. Draw each term as its own `Text` object.
- Texts with many terms (messages, help pages, quest logs) are easier as HTML: a Phaser DOM element (`dom: { createContainer: true }` in the game config, `scene.add.dom(x, y, element)`) whose content DeepTip renders: `tips.dt.renderText(element, "Rebels threaten a [[demo.province|province]].")` after `tips.dt.ready`, and again after `setLocale` *(checked)*.
- Labels the game draws itself take their words from the glossary: `tips.dt.entry(key)?.e.title`.

## 5. Encyclopedia

`tips.dt.renderIndex(element)` renders the searchable list of every entry into any HTML element: on the page next to the game, or in a DOM element of a pause scene ([§12](../../docs/algorithms.md#12-encyclopedia)). Call `tips.dt.removeIndex(element)` when it goes.

## 6. Live values and language

- `{name}` in a glossary text is read when a window renders ([SPEC §2.5](../../SPEC.md#25-live-values)): give `vars` functions that read the game state and call `tips.dt.refresh()` after it changed; the open Stability window showed the new value after the button's own `pointerdown` handler had run *(checked)*.
- `await tips.dt.setLocale("de")` loads the German glossaries and re-renders the open windows and the encyclopedia; re-label the game's own texts and render DOM texts again (the example's `paint()`) *(checked)*.

## 7. Input: who gets what

| Input | Game (Phaser) | DeepTip |
|---|---|---|
| Pointer over the canvas | everything, unchanged (hover, cursor, down, up, drag, wheel) *(checked)* | rest on explained objects, hover on terms |
| Click on an explained object | `pointerdown` on the object and the scene *(checked)* | the object's pending window is muted until the pointer leaves it ([SPEC §3.3](../../SPEC.md#33-opening)) *(checked)* |
| Click on a term object | yes | its window opens pinned |
| Pointer and wheel inside a DeepTip window | nothing (presses are stopped); a drag the game started still ends in the game *(checked: no `pointerdown`, no `pointerdownoutside`)* | everything |
| Keys while the focus is in a DeepTip window | nothing *(checked: Space and Esc did not reach the scene's keyboard)* | Tab, Enter, F6, Esc … |
| Esc while windows are open | no (it closes the newest window first) | yes |
| F1 or `?` (`helpKeys`) with the pointer on an explained object | no | opens it pinned, focus on its first term *(checked)* |
| Gamepad | Phaser polls it itself: ignore it in the game while `tips.hasFocus()` | Y, A, B, LB/RB in DeepTip windows |
| Touch long-press on an explained object | the press and its release, as usual | opens the window pinned; `tips.wasLongPress()` is true for 1.5 s, so the game can ignore that release |

Keys keep their browser meaning inside DeepTip windows: Space and Enter activate the focused term or button.

## 8. API

| Call | Does |
|---|---|
| `DeepTipPhaser.attach(game, options)` | starts DeepTip for the game, returns the adapter |
| `tips.explain(object, key, { delay, place, term, camera, label })` | explains a game object; returns it |
| `tips.explainArea(scene, () => rect, key, options)` | explains a world rectangle |
| `tips.forget(target)` | removes an explanation |
| `tips.open(target, { pinned = true, focus = false })` | opens the target's window (a promise of the window) |
| `tips.close(target)`, `tips.isOpen(target)` | closes it, asks whether it is open |
| `tips.hasFocus()` | the keyboard focus is in a DeepTip window |
| `tips.wasLongPress()` | a touch long-press opened a window in the last 1.5 s |
| `tips.dt` | the runtime's controller |
| `tips.destroy()` | removes everything |

Game objects emit `deeptip:open` (key, window element), `deeptip:pin` (key, window element) and `deeptip:close` (key) through their own event emitter: `sprite.on("deeptip:open", (key) => sprite.setTint(0xffff88))` *(checked)*.

## 9. Moving objects, cameras, scaling

- Anchors follow every frame, so windows of moving objects follow them where the browser places windows with CSS anchor positioning (Chrome, Edge): a pinned window moved with the walking rebel *(checked)*. Where the runtime places windows itself (no CSS anchor positioning, or `engine: "js"`), a window stays where it opened.
- An object that moves under a resting pointer opens its window like one the pointer moved onto *(checked)*.
- The canvas may be scaled (Phaser's scale modes, CSS); anchors use the canvas's rectangle on the page. Phaser 4 keeps the camera's scroll in its view matrix (`matrixCombined`), Phaser 3 does not; the adapter handles both.

## 10. Styling

Theme with the `--dt-*` custom properties ([SPEC §8](../../SPEC.md#8-styling-hooks-web)) on `:root`: the windows live in a layer the adapter appends to `<body>`. Use the game's font (`--dt-font`) and colours; the example uses a dark theme with `--dt-accent` for titles and the pinned frame. Anchors carry the runtime's hooks too (`[data-dt-open]`, `[data-dt-arming]` with `--dt-delay`) and can be styled, e.g. a ring while the pointer rests: `[data-deeptip][data-dt-arming] { outline: 2px solid gold; }`. The adapter sets all its own styles through the CSSOM, so a Content Security Policy without `'unsafe-inline'` allows them.

## 11. Pitfalls

- **One adapter per game**, one controller per page: with two games on one page, attach the second with `controller: tips.dt`.
- **Keep the page from scrolling under the game** (full-window games usually do): keys typed in a DeepTip window keep their browser meaning.
- **Objects inside a RenderTexture, a Graphics drawing or a tilemap layer** have no bounds of their own; use `explainArea`.
- **CSS transforms on the canvas's parents** (rotation, skew) are not mapped; scaling is.
- **Order of `attach` and DeepTip**: create other code that uses `DeepTip.init` before attaching and pass it as `controller`; do not start a second controller.

## 12. Tests

```bash
node frameworks/phaser/test/run.mjs          # Node 22+, Chrome/Chromium/Edge; --chrome <path>, --port, --profile, --shots <dir>
```

`test/run.mjs` serves the repository, opens `example/index.html?test` with Phaser 4.2.1 and with `&phaser=3` (3.90.0) in headless Chrome and drives `test/checks.js` with real mouse and keyboard input through the DevTools protocol; console errors and warnings count as failures. The 16 checks per version: anchors over their objects (also with a zoomed and scrolled camera, compared with Phaser's own `getWorldPoint`); anchors of objects outside the camera; rest opens a window while Phaser still sees the hover; a click reaches the object and the scene and `refresh()` shows the new value; a term inside a window; presses inside a window do not reach the game; a click mutes an object until the pointer leaves; a Phaser text term; F1 with keys kept out of the game; an object moving under a resting pointer; a pinned window following its object; `deeptip:open`/`deeptip:close` on game objects; hidden and destroyed objects; terms in a DOM element; `setLocale`. On 2026-10-29: 32 of 32 passed. Phaser comes from jsDelivr, so the run needs network access.

The parser, the placement and the glossary flattening are the web runtime's: `npm test` runs them against `test/cases` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 13. The example

```bash
npm run demo     # then http://localhost:5560/frameworks/phaser/example/  (add ?phaser=3 for Phaser 3.90)
```

The web example's screen as a Phaser scene: a bar fixed to the screen (`demo.realm`, `demo.stability` with `{stability}`, `demo.taxes` adding gold, `demo.nobles`, `demo.gold` with `{gold}`, a help button `deeptip.about` with delay 0), a map larger than the screen (arrow keys scroll, `Z` zooms) with four provinces and a rebel that walks between them, the loop Stability → Unrest → Revolt as three Phaser text terms, a sentence with terms in a DOM element, four corner objects for placement at the edges, a language select (`en`, `de`, fallback `["de", "en"]`) and the encyclopedia below the game. Glossaries: `glossary/core/{locale}.json`, then `glossary/example/{locale}.json`.

## 14. Limitations

- Hit areas are screen-aligned bounding rectangles, not pixel-exact shapes.
- A word inside a longer Phaser text cannot be a term on its own: draw terms as separate texts, or use a DOM element.
- Windows of moving objects follow only with CSS anchor positioning (section 9).
- Not tested: Phaser's Canvas renderer, mobile browsers with real touch, gamepads.

## 15. Checklist

1. Put `deeptip.js`, `deeptip.css` and `deeptip-phaser.js` in one folder; link the stylesheet.
2. `DeepTipPhaser.attach(game, { locale, fallback, sources })` once, after `new Phaser.Game`.
3. `tips.explain(object, key)` for objects, `{ term: true }` for words, `explainArea` for regions; DOM elements with `renderText` for long texts.
4. Live values: `vars` functions plus `tips.dt.refresh()`; languages: `tips.dt.setLocale` and re-label the game's texts.
5. Ignore gamepad input while `tips.hasFocus()`; ignore a release when `tips.wasLongPress()`.
6. Validate the glossaries (`tools/deeptip-check.mjs`), run `test/run.mjs`, compare with the web example.
