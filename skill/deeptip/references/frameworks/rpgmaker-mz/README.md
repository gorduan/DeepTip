# DeepTip for RPG Maker MZ

An RPG Maker MZ plugin that brings [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth) into your game: rest the mouse on a command, an item or a highlighted term, read its window, follow the terms inside it as deep as you like.

## Quick start

**Recognise the project:** `js/rmmz_core.js` and `js/plugins.js` beside `data/System.json`, the folder of an RPG Maker MZ project.

1. From the DeepTip folder run `node frameworks/rpgmaker-mz/example/install.mjs "C:/path/to/MyGame" --plugin-only`: it copies the plugin, the runtime, the stylesheet and the core glossary and adds the plugin to `js/plugins.js` (by hand: [Install](#install)).
2. Save your glossary as `data/deeptip/en.json` (below): an entry named `command.` plus a command's symbol explains that command; items, skills and texts are marked as in [What gets a window](#what-gets-a-window).
3. Check in the Plugin Manager that **DeepTip** is on, then start a playtest.
4. Validate from the DeepTip folder: `node tools/deeptip-check.mjs --base en "C:/path/to/MyGame/data/deeptip/core/en.json" "C:/path/to/MyGame/data/deeptip/en.json" --scan "C:/path/to/MyGame/data"`.

```json
{
  "$locale": "en",
  "command.item": {
    "title": "Item",
    "short": "Use and check what your party carries.",
    "body": "Potions heal, keys open doors. Weapons and armor are changed under [[command.equip|Equip]]."
  },
  "command.equip": {
    "title": "Equip",
    "short": "Weapons and armor your heroes wear."
  }
}
```

**Done when:** in the playtest's menu (`Esc`) resting the mouse on *Item* for 800 ms opens its window beside the command, hovering *Equip* in it opens a second window beside the first, a click pins both windows, `Esc` closes the newest DeepTip window before it closes the menu, the validator reports 0 errors.

## How it works

MZ runs in a browser engine (NW.js on desktop, any browser for web builds), so the plugin uses the reference web runtime `frameworks/web/deeptip.js` unchanged and puts its windows as HTML over the game canvas. Every frame it keeps one invisible element exactly over each explained thing on the canvas: the commands and items of the active list, explained areas of your own windows, and terms drawn with `\DT[...]`. The runtime treats them like elements of a web page, so all of DeepTip's behaviour is the reference behaviour: window tree ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)), grace and mouse tendency ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), delays ([§6](../../docs/algorithms.md#6-arming-and-delays)), placement ([§8](../../docs/algorithms.md#8-placement)), mouse, touch, keyboard and gamepad ([§9](../../docs/algorithms.md#9-input)), locale fallback ([§1](../../docs/algorithms.md#1-data)).

The alternative, native `Window_Base` windows on the canvas, was rejected: it means porting §2 to §9 to PIXI, including word wrap (MZ has none) and clickable terms inside wrapped text, and it would still differ from the reference. The plugin itself only bridges the game and the runtime: anchors, the `\DT` escape code, the glossary files in `data/deeptip/`, and the input rules below.

## Install

Download `DeepTip-rpgmaker-mz-1.0.0.zip` from the releases (it holds this folder, `frameworks/web/` and the glossaries) or clone the repository, then copy into your project:

| From | To (your project) |
|---|---|
| `frameworks/rpgmaker-mz/js/plugins/DeepTip.js` | `js/plugins/DeepTip.js` |
| `frameworks/web/deeptip.js` | `js/libs/deeptip.js` |
| `frameworks/web/deeptip.css` | `css/deeptip.css` |
| your glossary | `data/deeptip/<locale>.json`, e.g. `data/deeptip/en.json` |
| optional: `glossary/core/<locale>.json` (DeepTip's own help, `deeptip.*`) | `data/deeptip/core/<locale>.json`, then add `data/deeptip/core/{locale}.json` as the first entry of the parameter *Glossary files* |

Or let a script do it (Node 18+; every file it replaces is kept as `<file>.bak`):

```bash
node frameworks/rpgmaker-mz/example/install.mjs "C:/path/to/MyGame" --plugin-only
```

Turn **DeepTip** on in the Plugin Manager. Deployment with *Exclude unused files*: check that `js/libs/deeptip.js`, `css/deeptip.css` and `data/deeptip/` are in the output.

## The glossary

One JSON file per language, the format of every DeepTip runtime ([SPEC §2](../../SPEC.md#2-glossary-format)):

```json
{
  "$locale": "en",
  "game.tp": {
    "title": "TP",
    "short": "Tension points for special skills.",
    "body": "TP rise when you take damage and fuel [[game.limit|limit skills]]. You have **{v12}** right now."
  }
}
```

Language: the parameter *Locale*; empty means the database locale (System 2, `en_US` becomes `en`), else the system language. Missing entries come from the *Fallback locales* and show a small language badge. Validate your files with `node tools/deeptip-check.mjs --base en data/deeptip/en.json data/deeptip/de.json` from the DeepTip folder.

## What gets a window

| Thing | How you mark it | Opens |
|---|---|---|
| Items, weapons, armors, skills, actors, enemies | note tag `<DeepTip: key>` in the database | in every list that shows them, while that list is the active window (item, skill, equip, shop, battle lists, actor and enemy selection) |
| Commands | a glossary entry named *Command key prefix* + symbol: `command.item`, `command.skill`, `command.equip`, `command.status`, `command.formation`, `command.options`, `command.save`, `command.gameEnd`, `command.newGame`, `command.continue`, `command.fight`, `command.escape`, `command.attack`, `command.guard`, `command.buy`, `command.sell`, `command.alwaysDash`, `command.bgmVolume` … | while the command window is active |
| Terms in texts | `\DT[key]` (shows the entry's title) or `\DT[key\|text]` in Show Text, choices, item and skill descriptions, the battle log, any text drawn with escape codes | always; drawn in the *Term color*, underlined |
| Areas of your own windows | `deepTipAreas()` on the window class, below | always while the window is open |

Windows of single-column lists go to the side of the item (right, left, then bottom, top) so the other commands stay visible; everything else uses the root order bottom, top, right, left.

Your own windows and lists:

```js
// a status window whose stats explain themselves (contents coordinates, like drawText)
Window_MyStatus.prototype.deepTipAreas = function() {
    return [
        { key: "game.hp", x: 0, y: 0, width: 160, height: this.lineHeight() },
        { key: "game.tp", x: 0, y: 36, width: 160, height: this.lineHeight(), delay: 0, place: "right,left" }
    ];
};

// a list of your own: the key of the item at index ("" = none)
Window_MyQuestList.prototype.deepTipKey = function(index) {
    const quest = this._quests[index];
    return quest ? `quest.${quest.id}` : "";
};
```

`delay` and `place` are the per-element options of SPEC §3.3 and §4 (`data-deeptip-delay`, `data-deeptip-place`).

## Controls

| Device | In the game |
|---|---|
| Mouse | Rest on a command, item or area (*Rest time*), hover a term (*Term hover time*), click to pin. Clicking a command still selects it: DeepTip only adds the explanation. A press inside a DeepTip window or on a term never reaches the game. |
| Touch | Long-press a command or item: its window opens pinned, and lifting the finger does not also select it. Tap a term. Tap outside to close all. |
| Keyboard | `F1` or `?` (*Help keys*) explains the selected command; with no command, the terms on screen, one per press. Inside a window `Tab` and `Enter` follow terms, `F6` switches windows, `Esc` or `X` closes the newest, `Shift+Esc` or holding `Esc` closes all. |
| Gamepad | *Gamepad help button* (default Y) explains the selected command or the terms of a message; on the map without terms Y still opens the menu. Inside a window A follows a term, the d-pad walks the terms, LB/RB switch windows, B closes (hold: all). |

While the keyboard focus is inside a DeepTip window the game ignores keys and gamepad buttons, and while any window is open the cancel button (Esc, X, B) closes DeepTip windows before it cancels a game menu.

## Live values

`{name}` in a glossary text is filled when the window shows ([SPEC §2.5](../../SPEC.md#25-live-values)):

| Name | Value |
|---|---|
| `{gold}` | `$gameParty.gold()` |
| `{v12}` | variable 12 |
| any name from the parameter *Live values* | its JavaScript formula, e.g. `stability` = `($gameVariables.value(1) > 0 ? "+" : "") + $gameVariables.value(1)` |
| your own | `DeepTipMZ.values.set("hp", (key) => $gameParty.leader().hp)` |

Every 20 frames the plugin compares the values each open window showed with the current ones and re-renders when one changed, keeping the keyboard focus on the same term. Unknown names stay visible as `{name}`.

## Plugin commands and script calls

| Plugin command | Script | Does |
|---|---|---|
| Open entry (key, pinned, wait until closed) | `DeepTipMZ.open("demo.realm", { pinned: true })` | opens an entry at the top of the screen with the focus in it; *wait* holds the event until the player closed it |
| Close all windows | `DeepTipMZ.closeAll()` | |
| Set language (locale) | `DeepTipMZ.setLocale("de")` | loads that language's files, re-renders open windows |
| | `DeepTipMZ.refresh()` | re-render open windows now |
| | `DeepTipMZ.controller` | the web runtime's controller: every call of [the web API](../web/README.md#api), e.g. `renderIndex(element)` |
| | `DeepTipMZ.ready` | promise, settles when the glossaries are loaded |

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| Runtime | `js/libs/deeptip.js` | copy of `frameworks/web/deeptip.js` |
| Stylesheet | `css/deeptip.css` | copy of `frameworks/web/deeptip.css` |
| Glossary files | `["data/deeptip/{locale}.json"]` | path templates; listed order = layer order (core first) |
| Locale | empty | language code; empty: database locale, else the system language |
| Fallback locales | `["en"]` | tried when an entry is missing |
| Rest time (ms) | 800 | `delay` |
| Term hover time (ms) | 80 | `linkDelay` |
| Grace time (ms) | 300 | `closeDelay` |
| Pin after resting (ms) | 0 | `lockAfter`, 0 = off |
| Long-press (ms) | 500 | `longPress` |
| Close buttons, Pin button, Hint line | on | window chrome |
| Placement | auto | `auto`: CSS anchor positioning where the engine has it, else measured; `js`: always measured |
| Close on scene change | on | closing all windows when the scene changes (menu, battle, transfer) |
| Help keys | `["F1","?"]` | `KeyboardEvent.key` values |
| Gamepad help button | 3 (Y) | button index; -1 = off |
| Command key prefix | `command.` | |
| Note tag | `DeepTip` | `<DeepTip: key>` |
| Live values | empty | name + formula |
| Font size, Window width | 20, 420 | in game pixels; scaled with the game screen |
| Term color | `#7fd0ff` | CSS color, or a number for the windowskin's text colors |
| Underline terms | on | |
| Background, Text color, Border color, Link color, Accent color | dark blue, white, light, light blue, gold | the window theme (`--dt-bg`, `--dt-fg`, `--dt-border`, `--dt-link`, `--dt-accent`/`--dt-pinned`/`--dt-title`/`--dt-focus`) |

Further tokens of [SPEC §8](../../SPEC.md#8-styling-hooks-web) can be set in `css/game.css` with `html:root { --dt-radius: 0; }` (the plugin's own `:root` block is later in the page, `html:root` outranks it). The windows use the game's main font (`rmmz-mainfont`).

## Compatibility

- RPG Maker MZ 1.x; checked against the core scripts of MZ 1.10.0.
- Desktop games run in the NW.js that MZ ships, 0.48.4 = Chromium 85. It has no Popover API, no CSS anchor positioning, no `Element.replaceChildren`, no `:focus-visible`, no `dvh` and no individual transform properties. The runtime falls back to fixed windows with the highest z-index and to measured placement; the plugin adds the `replaceChildren` polyfill and CSS fallbacks for focus outlines, the timer-lock bar and the window height. Web builds in current browsers use the top layer and CSS anchor positioning.
- The runtime is loaded with `import()`. Where module scripts cannot load (some `file://` wrappers), the plugin reads the file and evaluates it as a function body.
- Hooks, for other plugins: aliases of `Scene_Boot.onDatabaseLoaded`, `Scene_Boot.isReady` (waits up to 5 s for the glossaries), `SceneManager.update`, `SceneManager.onSceneCreate`, `Input.update`, `TouchInput.update`, `Window_Base.processEscapeCharacter` (code `DT`), `Bitmap.clearRect`, `Game_Interpreter.updateWait`; new `Window_Selectable.prototype.deepTipKey`, `Window_Base.prototype.deepTipAreas`, `window.DeepTipMZ`; two layers `#dtmz-anchors` and `#dtmz-windows` in the page.

## Example

The example is the HUD of the web example on the map: Realm, Stability, Taxes, Nobles, Gold and a "?" (`deeptip.about`, opens at once), with the shared glossaries `glossary/core/` and `glossary/example/`. Stability and Taxes change when clicked, an open window shows the new value; `L` switches between English and German.

```bash
# a new project made in RPG Maker MZ, then:
node frameworks/rpgmaker-mz/example/install.mjs "C:/path/to/NewProject"
```

It copies the plugin, the runtime, `example/js/plugins/DeepTipDemo.js`, the core glossary to `data/deeptip/core/` and the example glossary to `data/deeptip/`, and adds both plugins to `js/plugins.js` (the entries of `example/js/plugins.js`; your other plugins stay). Start a playtest. To try terms in a message, add an event with Show Text `Rebels: \DT[demo.revolt] threaten your \DT[demo.province|lands].`; for an item, give it the note `<DeepTip: demo.gold>`.

## Tests

`test/game-checks.js` holds 26 checks that run inside the game: anchors and placement, rest, term hover and click, pinning, Esc and F1, focus muting the game, presses that must or must not reach the game, HUD areas with delay 0, live values, language switch, message terms, gamepad help, note tags, long-press without click, closing on scene change, the plugin command with wait. Run it on a fresh project with the example installed: playtest, `F8`, paste the file into the console; `fail` must be empty.

State on 2026-10-29: all 26 pass in the real MZ 1.10.0 engine on Chromium 152 (web deployment path). The Chromium 85 paths (measured placement, popover fallback, `replaceChildren` polyfill) were checked by switching those features off in the same page. A run in the NW.js 0.48.4 playtest itself is still open.

The parser, the placement and the glossary flattening are the web runtime's, unchanged: `npm test` in the DeepTip repository runs them against `test/cases/*.json` ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## Limitations

- Texts already drawn in the game keep their words after a language switch until the game draws them again; DeepTip windows switch at once.
- Only the active list explains its items, so items hidden under another window never open a window; other windows explain themselves through `deepTipAreas`.
- Map sprites, events and pictures are not anchors yet. Put the explanation on a window (`deepTipAreas`) or open it with `DeepTipMZ.open`.
- With measured placement (desktop NW.js) an open window stays where it opened when its list scrolls; with CSS anchor positioning it follows.
- The text of `\DT[key|text]` is plain: variables (`\V[n]`, `\N[n]`) work, other escape codes inside it do not.
- No encyclopedia scene; `DeepTipMZ.controller.renderIndex(element)` renders one into any HTML element.
- Mobile wrappers (Cordova, `file://`) are untested.
