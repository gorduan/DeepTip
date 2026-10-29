//=============================================================================
// DeepTip.js v1.0.0 for RPG Maker MZ
// Explanation windows with depth: nested, pinnable tooltips from JSON glossaries.
// https://github.com/gorduan/DeepTip (MIT)
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v1.0.0 Explanation windows with depth: nested, pinnable tooltips from JSON glossaries.
 * @author Gorduan
 * @url https://github.com/gorduan/DeepTip
 *
 * @help DeepTip.js
 *
 * Rest the mouse on a command, an item or a highlighted term and a window
 * explains it. Highlighted terms inside that window open further windows,
 * a click pins a window, and pinned windows nest without limit.
 * The texts come from JSON glossary files, one per language.
 *
 * Files (from the DeepTip download)
 *   js/plugins/DeepTip.js   this plugin
 *   js/libs/deeptip.js      copy of frameworks/web/deeptip.js (the runtime)
 *   css/deeptip.css         copy of frameworks/web/deeptip.css
 *   data/deeptip/en.json    your glossary, one file per language
 *
 * What gets a window
 *   - Items, weapons, armors, skills, actors, enemies with the note tag
 *       <DeepTip: key>
 *     in every list that shows them, while that list is the active window.
 *   - Commands (menu, title, battle, shop, options ...): the key is
 *     "Command key prefix" + symbol, e.g. command.item, command.equip,
 *     command.newGame; used when the glossary has that key.
 *   - Terms in any text drawn with escape codes (messages, choices, help,
 *     item descriptions, battle log):
 *       \DT[key]          shows the entry's title
 *       \DT[key|text]     shows your own text
 *   - Own windows: Window_Base.prototype.deepTipAreas (see the README).
 *
 * Controls
 *   Mouse     rest on a command or item, hover a term, click pins.
 *   Touch     long-press a command or item, tap a term.
 *   Keyboard  F1 or ? explains the selected command (press again: next
 *             term on screen); inside a window Tab and Enter follow terms;
 *             Esc or X closes, Shift+Esc closes all, F6 switches windows.
 *   Gamepad   Y explains the selected command or the terms of a message;
 *             A follows a term, B closes (hold: all), LB/RB switch.
 *
 * Live values in glossary texts: {gold}, {v12} (variable 12) and the names
 * of the parameter "Live values".
 *
 * Script calls
 *   DeepTipMZ.open("key")   DeepTipMZ.closeAll()   DeepTipMZ.setLocale("de")
 *   DeepTipMZ.refresh()     DeepTipMZ.controller (the web runtime's DeepTip)
 *
 * @param files
 * @text Files
 *
 * @param runtime
 * @parent files
 * @text Runtime
 * @desc The DeepTip web runtime: a copy of frameworks/web/deeptip.js.
 * @default js/libs/deeptip.js
 *
 * @param stylesheet
 * @parent files
 * @text Stylesheet
 * @desc A copy of frameworks/web/deeptip.css.
 * @default css/deeptip.css
 *
 * @param glossaries
 * @parent files
 * @text Glossary files
 * @type string[]
 * @desc Path templates, {locale} is replaced by the language. Listed order is the layer order: core first, game after.
 * @default ["data/deeptip/{locale}.json"]
 *
 * @param language
 * @text Language
 *
 * @param locale
 * @parent language
 * @text Locale
 * @desc Language code such as en or de. Empty: the database locale (System 2), else the system language.
 * @default
 *
 * @param fallback
 * @parent language
 * @text Fallback locales
 * @type string[]
 * @desc Languages tried when an entry is missing in the current one.
 * @default ["en"]
 *
 * @param behaviour
 * @text Behaviour
 *
 * @param delay
 * @parent behaviour
 * @text Rest time (ms)
 * @type number
 * @min 0
 * @desc How long the mouse rests on a command or item before its window opens.
 * @default 800
 *
 * @param linkDelay
 * @parent behaviour
 * @text Term hover time (ms)
 * @type number
 * @min 0
 * @default 80
 *
 * @param closeDelay
 * @parent behaviour
 * @text Grace time (ms)
 * @type number
 * @min 0
 * @desc How long an unpinned window stays after the mouse left it.
 * @default 300
 *
 * @param lockAfter
 * @parent behaviour
 * @text Pin after resting (ms)
 * @type number
 * @min 0
 * @desc Resting inside an unpinned window this long pins it. 0 = off.
 * @default 0
 *
 * @param longPress
 * @parent behaviour
 * @text Long-press (ms)
 * @type number
 * @min 100
 * @default 500
 *
 * @param closeButtons
 * @parent behaviour
 * @text Close buttons
 * @type boolean
 * @default true
 *
 * @param pinButton
 * @parent behaviour
 * @text Pin button
 * @type boolean
 * @default true
 *
 * @param hints
 * @parent behaviour
 * @text Hint line
 * @type boolean
 * @desc "Click to pin · Esc closes" under unpinned windows.
 * @default true
 *
 * @param engine
 * @parent behaviour
 * @text Placement
 * @type select
 * @option auto
 * @option js
 * @desc auto: CSS anchor positioning where the engine supports it, else measured in JS.
 * @default auto
 *
 * @param closeOnSceneChange
 * @parent behaviour
 * @text Close on scene change
 * @type boolean
 * @default true
 *
 * @param keys
 * @text Keys and tags
 *
 * @param helpKeys
 * @parent keys
 * @text Help keys
 * @type string[]
 * @desc Keyboard keys (KeyboardEvent.key) that explain the selected command.
 * @default ["F1","?"]
 *
 * @param helpButton
 * @parent keys
 * @text Gamepad help button
 * @type number
 * @min -1
 * @desc Button index that explains the selected command: 3 = Y, 8 = Back, -1 = off.
 * @default 3
 *
 * @param commandPrefix
 * @parent keys
 * @text Command key prefix
 * @desc Commands use the key prefix + symbol, e.g. command.item.
 * @default command.
 *
 * @param noteTag
 * @parent keys
 * @text Note tag
 * @desc <DeepTip: key> in the note of items, skills, actors, enemies ...
 * @default DeepTip
 *
 * @param values
 * @parent keys
 * @text Live values
 * @type struct<Value>[]
 * @desc {name} in glossary texts, filled when a window shows.
 * @default []
 *
 * @param look
 * @text Look
 *
 * @param fontSize
 * @parent look
 * @text Font size
 * @type number
 * @min 8
 * @desc In game pixels; scales with the game screen.
 * @default 20
 *
 * @param maxWidth
 * @parent look
 * @text Window width
 * @type number
 * @min 120
 * @desc Maximum width in game pixels.
 * @default 420
 *
 * @param termColor
 * @parent look
 * @text Term color
 * @desc Color of \DT terms in game texts: a CSS color, or a number for the windowskin's text colors.
 * @default #7fd0ff
 *
 * @param termUnderline
 * @parent look
 * @text Underline terms
 * @type boolean
 * @default true
 *
 * @param background
 * @parent look
 * @text Background
 * @default rgba(16, 22, 40, 0.94)
 *
 * @param textColor
 * @parent look
 * @text Text color
 * @default #ffffff
 *
 * @param borderColor
 * @parent look
 * @text Border color
 * @default rgba(255, 255, 255, 0.45)
 *
 * @param linkColor
 * @parent look
 * @text Link color
 * @default #7fd0ff
 *
 * @param accentColor
 * @parent look
 * @text Accent color
 * @desc Titles, the pinned border, focus.
 * @default #ffd966
 *
 * @command open
 * @text Open entry
 * @desc Opens the window of a glossary entry at the top of the screen.
 *
 * @arg key
 * @text Key
 * @desc Glossary key, e.g. demo.realm
 *
 * @arg pinned
 * @text Pinned
 * @type boolean
 * @default true
 *
 * @arg wait
 * @text Wait until closed
 * @type boolean
 * @desc The event continues after the player closed the window.
 * @default false
 *
 * @command closeAll
 * @text Close all windows
 *
 * @command setLocale
 * @text Set language
 *
 * @arg locale
 * @text Locale
 * @desc Language code such as en or de.
 */

/*~struct~Value:
 * @param name
 * @text Name
 * @desc {name} in glossary texts.
 *
 * @param formula
 * @text Formula
 * @desc JavaScript expression, evaluated when a window shows, e.g. $gameVariables.value(1)
 */

(() => {
    "use strict";

    const VERSION = "1.0.0";
    const KEY_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
    const BOOT_WAIT = 5000; // ms the boot scene waits for the glossaries at most

    const PLUGIN = (() => {
        const src = document.currentScript && document.currentScript.src;
        const m = src && /([^/\\]+)\.js(?:[?#].*)?$/.exec(decodeURIComponent(src));
        return m ? m[1] : "DeepTip";
    })();

    //-------------------------------------------------------------------------
    // parameters (the editor stores every value as a string)

    const raw = PluginManager.parameters(PLUGIN);
    const text = (v, d) => (v == null || v === "" ? d : String(v));
    const num = (v, d) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));
    const bool = (v, d) => (v == null || v === "" ? d : String(v) === "true");
    const json = (v, d) => {
        try {
            return v ? JSON.parse(v) : d;
        } catch (e) {
            return d;
        }
    };
    const strings = (v, d) => {
        const a = json(v, d);
        return Array.isArray(a) ? a.map(String).filter((s) => s !== "") : d;
    };

    const P = {
        runtime: text(raw.runtime, "js/libs/deeptip.js"),
        stylesheet: text(raw.stylesheet, "css/deeptip.css"),
        glossaries: strings(raw.glossaries, ["data/deeptip/{locale}.json"]),
        locale: text(raw.locale, ""),
        fallback: strings(raw.fallback, ["en"]),
        delay: num(raw.delay, 800),
        linkDelay: num(raw.linkDelay, 80),
        closeDelay: num(raw.closeDelay, 300),
        lockAfter: num(raw.lockAfter, 0),
        longPress: num(raw.longPress, 500),
        closeButtons: bool(raw.closeButtons, true),
        pinButton: bool(raw.pinButton, true),
        hints: bool(raw.hints, true),
        engine: text(raw.engine, "auto") === "js" ? "js" : "auto",
        closeOnSceneChange: bool(raw.closeOnSceneChange, true),
        helpKeys: strings(raw.helpKeys, ["F1", "?"]),
        helpButton: num(raw.helpButton, 3),
        commandPrefix: text(raw.commandPrefix, "command."),
        noteTag: text(raw.noteTag, "DeepTip"),
        values: strings(raw.values, [])
            .map((s) => json(s, null))
            .filter((v) => v && v.name),
        fontSize: num(raw.fontSize, 20),
        maxWidth: num(raw.maxWidth, 420),
        termColor: text(raw.termColor, "#7fd0ff"),
        termUnderline: bool(raw.termUnderline, true),
        colors: {
            bg: text(raw.background, "rgba(16, 22, 40, 0.94)"),
            fg: text(raw.textColor, "#ffffff"),
            border: text(raw.borderColor, "rgba(255, 255, 255, 0.45)"),
            link: text(raw.linkColor, "#7fd0ff"),
            accent: text(raw.accentColor, "#ffd966")
        }
    };

    //-------------------------------------------------------------------------
    // NW.js 0.48 (Chromium 85), which RPG Maker MZ ships, has no Element.replaceChildren (Chromium 86+).

    if (typeof Element.prototype.replaceChildren !== "function") {
        Element.prototype.replaceChildren = function(...nodes) {
            while (this.lastChild) {
                this.removeChild(this.lastChild);
            }
            this.append(...nodes);
        };
    }

    //-------------------------------------------------------------------------
    // styles: deeptip.css, then the game theme and fixes for Chromium 85

    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = P.stylesheet;
    document.head.appendChild(sheet);

    const style = document.createElement("style");
    style.id = "deeptip-mz";
    style.textContent = `
:root {
  --dt-bg: ${P.colors.bg};
  --dt-fg: ${P.colors.fg};
  --dt-border: ${P.colors.border};
  --dt-accent: ${P.colors.accent};
  --dt-pinned: ${P.colors.accent};
  --dt-focus: ${P.colors.accent};
  --dt-title: ${P.colors.accent};
  --dt-link: ${P.colors.link};
  --dt-link-hover: ${P.colors.fg};
  --dt-link-open-bg: rgba(255, 255, 255, 0.14);
  --dt-hover-bg: rgba(255, 255, 255, 0.14);
  --dt-code: ${P.colors.fg};
  --dt-var: ${P.colors.fg};
  --dt-missing: #ff7a7a;
  --dt-radius: 6px;
  --dt-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
  --dt-font: rmmz-mainfont, sans-serif;
}
.dt-win { text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.75); }
.dt-win::after { scale: none; transform: scaleX(0); transform-origin: left; }
@keyframes dt-lock { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@supports not (height: 1dvh) {
  .dt-win { max-height: min(var(--dt-max-height, 30rem), calc(100vh - 16px)); }
}
@supports not selector(:focus-visible) {
  .dt-win:focus, .dt-btn:focus, .dt-link:focus { outline: 2px solid var(--dt-focus); outline-offset: 1px; }
  .dt-btn:hover { opacity: 1; background: var(--dt-hover-bg); }
}
#dtmz-anchors {
  position: fixed; left: 0; top: 0; width: 100%; height: 100%;
  margin: 0; padding: 0; overflow: hidden; pointer-events: none; z-index: 5;
}
#dtmz-anchors > .dtmz-anchor {
  position: absolute; box-sizing: border-box; display: block; margin: 0; padding: 0;
  border: 0; border-radius: 0; background: transparent; color: transparent; font: inherit;
  text-decoration: none; outline: none; box-shadow: none; pointer-events: auto; cursor: inherit;
  -webkit-appearance: none; appearance: none;
}
#dtmz-anchors > .dtmz-term { cursor: pointer; }
#dtmz-anchors > .dtmz-term[data-dt-open] { box-shadow: inset 0 -2px 0 var(--dt-link); }
#dtmz-anchors > .dtmz-screen { pointer-events: none; }
`;
    document.head.appendChild(style);

    //-------------------------------------------------------------------------
    // the web runtime: an ES module, imported from this classic script

    const request = (url) =>
        new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.overrideMimeType("text/plain");
            xhr.onload = () => {
                if (xhr.status < 400 && xhr.responseText) {
                    resolve(xhr.responseText);
                } else {
                    reject(new Error(`HTTP ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error("not found"));
            xhr.send();
        });

    // Fallback where module scripts cannot load (file:// in some mobile wrappers): the same file as a function body.
    const evaluateModule = (source) => {
        const names = [];
        const body = source
            .replace(/^export default [A-Za-z_$][\w$]*;?[ \t]*$/m, "")
            .replace(/^export (async function|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
                names.push(name);
                return `${kind} ${name}`;
            });
        return new Function(`"use strict";\n${body}\nreturn { ${names.join(", ")} };`)();
    };

    const runtimeUrl = new URL(P.runtime, document.baseURI).href;
    const runtime = import(runtimeUrl).catch(() => request(runtimeUrl).then(evaluateModule));

    //-------------------------------------------------------------------------
    // layers: transparent anchors over the canvas, and the container of the windows

    const anchorsLayer = document.createElement("div");
    anchorsLayer.id = "dtmz-anchors";
    const windowsLayer = document.createElement("div");
    windowsLayer.id = "dtmz-windows";

    // Pointer input inside DeepTip belongs to DeepTip: the game listens on document, so stop it on the way up.
    // A press the game started (dragging across a window) still ends in the game.
    const shield = (root, applies) => {
        for (const type of ["mousedown", "touchstart", "wheel"]) {
            root.addEventListener(
                type,
                (e) => {
                    if (applies(e)) e.stopPropagation();
                },
                { passive: true }
            );
        }
        for (const type of ["mousemove", "mouseup", "touchmove", "touchend", "touchcancel"]) {
            root.addEventListener(
                type,
                (e) => {
                    if (applies(e) && !TouchInput.isPressed()) e.stopPropagation();
                },
                { passive: true }
            );
        }
        root.addEventListener("contextmenu", (e) => {
            if (applies(e)) e.preventDefault();
        });
    };
    shield(windowsLayer, () => true);
    shield(anchorsLayer, (e) => !!(e.target && e.target.closest && e.target.closest(".dtmz-term")));

    // Keys typed inside a window (Tab, Enter on a term ...) must not move the game's cursor as well.
    windowsLayer.addEventListener("keydown", (e) => {
        if (Input.keyMapper[e.keyCode]) e.stopPropagation();
    });
    windowsLayer.addEventListener("keyup", (e) => {
        const name = Input.keyMapper[e.keyCode];
        if (name && !Input._currentState[name]) e.stopPropagation();
    });
    windowsLayer.addEventListener("focusin", () => Input.clear());

    //-------------------------------------------------------------------------
    // DeepTipMZ: the bridge between the game and the web runtime

    let termSeq = 0;
    let winSeq = 0;
    const winIds = new WeakMap();
    const warned = new Set();
    const warnOnce = (id, msg) => {
        if (warned.has(id)) return;
        warned.add(id);
        console.warn(msg);
    };

    const DTMZ = {
        version: VERSION,
        /** The web runtime's controller (frameworks/web/deeptip.js), null until the boot scene started it. */
        controller: null,
        /** The runtime module: DeepTip, parseText, collectRefs, computePlacement ... */
        lib: null,
        /** Settles when the runtime and the glossaries are loaded (or failed). */
        ready: null,
        /** Live values: name -> (key) => value. Filled from the parameter "Live values"; add your own. */
        values: new Map(),
        _settled: false,
        _startedAt: 0,
        _loaded: new Set(),
        _anchors: new Map(),
        _scale: 0,
        _size: "",
        _canvasRect: null,
        _tick: 0,
        _broken: false,
        _eatRelease: false,
        _helpSig: "",
        _helpAt: -1,
        _helpWin: null,
        _screenAnchor: null
    };
    window.DeepTipMZ = DTMZ;

    for (const v of P.values) {
        try {
            DTMZ.values.set(String(v.name), new Function("key", `return (${v.formula});`));
        } catch (e) {
            console.warn(`DeepTip: live value "${v.name}": ${e.message}`);
        }
    }

    const detectLocale = () => {
        const fromDatabase = window.$dataSystem && $dataSystem.locale;
        const tag = P.locale || fromDatabase || navigator.language || "en";
        return String(tag).split(/[-_]/)[0].toLowerCase();
    };

    DTMZ.start = function() {
        if (this.ready) return this.ready;
        this._startedAt = performance.now();
        document.body.appendChild(anchorsLayer);
        document.body.appendChild(windowsLayer);
        this.ready = runtime
            .then((lib) => {
                this.lib = lib;
                this.controller = new lib.DeepTip({
                    locale: detectLocale(),
                    fallback: P.fallback,
                    delay: P.delay,
                    linkDelay: P.linkDelay,
                    closeDelay: P.closeDelay,
                    lockAfter: P.lockAfter,
                    longPress: P.longPress,
                    closeButtons: P.closeButtons,
                    pinButton: P.pinButton,
                    hints: P.hints,
                    engine: P.engine,
                    openKeys: P.helpKeys,
                    container: windowsLayer,
                    vars: (name, key) => this.value(name, key),
                    onOpen: (key, el) => this._opened(el)
                });
                return this._loadGlossaries(this.controller.chain);
            })
            .catch((e) => console.error(`DeepTip: cannot start (${e && e.message ? e.message : e})`))
            .then(() => {
                this._settled = true;
            });
        return this.ready;
    };

    DTMZ._loadGlossaries = function(chain) {
        const dt = this.controller;
        const jobs = [];
        for (const locale of chain) {
            for (const template of P.glossaries) {
                const url = template.split("{locale}").join(locale);
                if (this._loaded.has(url)) continue;
                this._loaded.add(url);
                jobs.push(
                    request(url)
                        .then((source) => JSON.parse(source))
                        .then(
                            (glossary) => ({ locale, glossary }),
                            (e) => {
                                console.warn(`DeepTip: cannot load ${url} (${e.message})`);
                                return null;
                            }
                        )
                );
            }
        }
        // listed order = layer order: core files first, the game's files after
        return Promise.all(jobs).then((results) => {
            for (const r of results) if (r) dt.add(r.locale, r.glossary);
        });
    };

    DTMZ._bootDone = function() {
        return !this.ready || this._settled || performance.now() - this._startedAt > BOOT_WAIT;
    };

    DTMZ.has = function(key) {
        return !!this.controller && this.controller.has(key);
    };

    /** The entry's title in the current language (the key while it has none). */
    DTMZ.title = function(key) {
        const found = this.controller && this.controller.entry(key);
        return found && found.e.title ? found.e.title : key;
    };

    DTMZ.value = function(name, key) {
        try {
            const fn = this.values.get(name);
            if (fn) return fn(key);
            if (name === "gold") return window.$gameParty ? $gameParty.gold() : null;
            const m = /^v(\d+)$/.exec(name);
            if (m) return window.$gameVariables ? $gameVariables.value(Number(m[1])) : null;
        } catch (e) {
            warnOnce(`value:${name}`, `DeepTip: live value "${name}": ${e.message}`);
        }
        return null; // unknown names stay visible as {name}
    };

    /** true while the keyboard focus is in an open window (a closing one fades out still holding it). */
    DTMZ.focusInside = function() {
        const a = document.activeElement;
        const el = a && a !== document.body && a.closest ? a.closest(".dt-win") : null;
        return !!el && !!this.controller && this.controller.wins.some((w) => w.el === el);
    };

    /** Re-render open windows (live values, language) and keep the keyboard focus on the same term. */
    DTMZ.refresh = function() {
        const dt = this.controller;
        if (!dt) return;
        const a = document.activeElement;
        const winEl = a && a.closest ? a.closest(".dt-win") : null;
        const key = winEl && a.dataset ? a.dataset.dtKey : null;
        const action = winEl && a.dataset ? a.dataset.dtAction : null;
        dt.refresh();
        if (winEl && winEl.isConnected) {
            const target =
                (key && winEl.querySelector(`.dt-link[data-dt-key="${CSS.escape(key)}"]`)) ||
                (action && winEl.querySelector(`[data-dt-action="${action}"]`)) ||
                winEl;
            target.focus({ preventScroll: true });
        }
    };

    /** Open an entry at the top of the screen (plugin command "Open entry"). */
    DTMZ.open = function(key, options) {
        const dt = this.controller;
        if (!dt || !key) return Promise.resolve(null);
        const pinned = !options || options.pinned !== false;
        const r = this._canvasRect || (Graphics._canvas ? Graphics._canvas.getBoundingClientRect() : null);
        if (!r) return Promise.resolve(null);
        let el = this._screenAnchor;
        if (!el) {
            el = this._screenAnchor = document.createElement("div");
            el.className = "dtmz-anchor dtmz-screen";
            anchorsLayer.appendChild(el);
        }
        el.style.left = `${r.left + r.width * 0.2}px`;
        el.style.top = `${r.top + r.height * 0.12}px`;
        el.style.width = `${r.width * 0.6}px`;
        el.style.height = "1px";
        const previous = dt.wins.find((w) => w.anchor === el);
        if (previous && previous.key !== key) dt.close(previous);
        return dt.open(key, { anchor: el, pinned, focus: true, via: "api" });
    };

    DTMZ.closeAll = function() {
        if (this.controller) this.controller.closeAll();
    };

    /** Switch language: loads its glossary files, then re-renders open windows. Texts drawn in the game keep their words until they are drawn again. */
    DTMZ.setLocale = function(locale) {
        const dt = this.controller;
        if (!dt || !locale) return Promise.resolve();
        const chain = [locale].concat(P.fallback);
        return this._loadGlossaries(chain).then(() => dt.setLocale(locale));
    };

    DTMZ._opened = function(el) {
        const w = this.controller.wins.find((x) => x.el === el);
        if (!w) return;
        w._dtmzValues = this._valuesOf(w);
        // a long-press opened it: the finger's release must not also click the command underneath
        if (w.via === "touch") this._eatRelease = true;
    };

    //-------------------------------------------------------------------------
    // anchors: one transparent element per explained command, item, area or term, kept on top of the canvas

    const windowsOf = (scene) => {
        const list = [];
        const add = (parent) => {
            for (const child of parent.children) {
                if (child instanceof Window_Base) list.push(child);
            }
        };
        if (scene._windowLayer) add(scene._windowLayer);
        add(scene);
        return list;
    };

    const windowId = (win) => {
        let id = winIds.get(win);
        if (!id) winIds.set(win, (id = ++winSeq));
        return id;
    };

    const A = new PIXI.Point();
    const B = new PIXI.Point();
    const OA = new PIXI.Point();
    const OB = new PIXI.Point();

    // Maps rectangles of the window's contents to canvas pixels, clipped to the visible inner area.
    const contentMapper = (win) => {
        const sprite = win._contentsSprite;
        A.set(win.padding, win.padding);
        win.toGlobal(A, OA);
        B.set(win.padding + win.innerWidth, win.padding + win.innerHeight);
        win.toGlobal(B, OB, true);
        const clip = {
            left: Math.max(0, Math.min(OA.x, OB.x)),
            top: Math.max(0, Math.min(OA.y, OB.y)),
            right: Math.min(Graphics.width, Math.max(OA.x, OB.x)),
            bottom: Math.min(Graphics.height, Math.max(OA.y, OB.y))
        };
        let fresh = true;
        return (x, y, width, height) => {
            A.set(x, y);
            sprite.toGlobal(A, OA, !fresh);
            fresh = false;
            B.set(x + width, y + height);
            sprite.toGlobal(B, OB, true);
            const left = Math.max(clip.left, Math.min(OA.x, OB.x));
            const top = Math.max(clip.top, Math.min(OA.y, OB.y));
            const right = Math.min(clip.right, Math.max(OA.x, OB.x));
            const bottom = Math.min(clip.bottom, Math.max(OA.y, OB.y));
            return right - left >= 2 && bottom - top >= 2 ? { left, top, right, bottom } : null;
        };
    };

    const validKey = (key) => typeof key === "string" && KEY_RE.test(key);

    DTMZ._collect = function(scene) {
        const out = [];
        for (const win of windowsOf(scene)) {
            if (!win.visible || !win.isOpen() || !win.worldVisible || !win.contents || !win._contentsSprite) continue;
            const map = contentMapper(win);
            const wid = windowId(win);
            const areas = typeof win.deepTipAreas === "function" ? win.deepTipAreas() : null;
            if (areas) {
                areas.forEach((a, i) => {
                    if (!a || !validKey(a.key)) return;
                    const rect = map(a.x, a.y, a.width, a.height);
                    if (rect) out.push({ id: `${wid}:a${i}:${a.key}`, kind: "area", key: a.key, delay: a.delay, place: a.place, rect, win, index: -1 });
                });
            }
            if (win instanceof Window_Selectable && win.active && typeof win.deepTipKey === "function") {
                const top = Math.max(0, win.topIndex());
                const end = Math.min(win.maxItems(), top + win.maxVisibleItems());
                // a vertical list keeps its other commands visible: windows go beside it, not below the item
                const place = win.maxCols() === 1 && win.maxItems() > 1 ? "right,left,bottom,top" : null;
                for (let i = top; i < end; i++) {
                    const key = win.deepTipKey(i);
                    if (!validKey(key)) continue;
                    const r = win.itemRect(i);
                    const rect = map(r.x, r.y, r.width, r.height);
                    if (rect) out.push({ id: `${wid}:i${i}:${key}`, kind: "item", key, place, rect, win, index: i });
                }
            }
            const terms = win.contents._dtTerms;
            if (terms) {
                for (const t of terms) {
                    const rect = map(t.x, t.y, t.w, t.h);
                    if (rect) out.push({ id: `t${t.id}`, kind: "term", key: t.key, label: t.label, rect, win, index: -1 });
                }
            }
        }
        return out;
    };

    DTMZ._createAnchor = function(a) {
        let el;
        if (a.kind === "term") {
            // a term on the page: the runtime previews it on hover and pins it on click or tap
            el = document.createElement("button");
            el.type = "button";
            el.className = "dt-link dtmz-anchor dtmz-term";
            el.tabIndex = -1;
            el.setAttribute("data-dt-key", a.key);
            el.setAttribute("aria-label", a.label || a.key);
        } else {
            // a UI element: rest (mouse) or long-press (touch); clicks still reach the game
            el = document.createElement("div");
            el.className = "dtmz-anchor";
            el.setAttribute("data-deeptip", a.key);
            if (a.delay != null && a.delay !== "") el.setAttribute("data-deeptip-delay", String(a.delay));
            if (a.place) el.setAttribute("data-deeptip-place", Array.isArray(a.place) ? a.place.join(",") : String(a.place));
        }
        anchorsLayer.appendChild(el);
        return { id: a.id, kind: a.kind, key: a.key, el, win: null, index: -1, left: NaN, top: NaN, width: NaN, height: NaN };
    };

    DTMZ._syncAnchors = function(scene) {
        const r = this._canvasRect;
        const list = scene && r ? this._collect(scene) : [];
        const k = r ? r.width / Graphics.width : 1;
        const seen = new Set();
        for (const a of list) {
            seen.add(a.id);
            let rec = this._anchors.get(a.id);
            if (!rec) {
                rec = this._createAnchor(a);
                this._anchors.set(a.id, rec);
            }
            rec.win = a.win;
            rec.index = a.index;
            const left = Math.round((r.left + a.rect.left * k) * 2) / 2;
            const top = Math.round((r.top + a.rect.top * k) * 2) / 2;
            const width = Math.round((a.rect.right - a.rect.left) * k * 2) / 2;
            const height = Math.round((a.rect.bottom - a.rect.top) * k * 2) / 2;
            const s = rec.el.style;
            if (rec.left !== left) s.left = `${(rec.left = left)}px`;
            if (rec.top !== top) s.top = `${(rec.top = top)}px`;
            if (rec.width !== width) s.width = `${(rec.width = width)}px`;
            if (rec.height !== height) s.height = `${(rec.height = height)}px`;
        }
        for (const [id, rec] of this._anchors) {
            if (!seen.has(id)) {
                rec.el.remove(); // the runtime closes its preview; a pinned window stays where it is
                this._anchors.delete(id);
            }
        }
    };

    DTMZ._updateScale = function() {
        const canvas = Graphics._canvas;
        const r = canvas && Graphics.width && Graphics.height ? canvas.getBoundingClientRect() : null;
        if (!r || !r.width) {
            this._canvasRect = null; // during boot the screen has no size yet
            return;
        }
        this._canvasRect = r;
        const k = r.width / Graphics.width;
        const size = `${k}:${Graphics.height}`;
        if (size === this._size) return;
        this._size = size;
        this._scale = k;
        const s = document.documentElement.style;
        s.setProperty("--dt-font-size", `${(P.fontSize * k).toFixed(2)}px`);
        s.setProperty("--dt-max-width", `${Math.round(P.maxWidth * k)}px`);
        s.setProperty("--dt-min-width", `${Math.round(Math.min(P.maxWidth, 220) * k)}px`);
        s.setProperty("--dt-max-height", `${Math.round(Graphics.height * 0.8 * k)}px`);
    };

    // Live values: the values a window showed when it rendered, compared every 20 frames; a change re-renders.
    DTMZ._valuesOf = function(w) {
        const found = this.controller.entry(w.key);
        const e = found ? found.e : {};
        const src = e.body != null ? e.body : e.short || "";
        if (src.indexOf("{") < 0) return "";
        return this.lib
            .collectRefs(src)
            .vars.map((n) => String(this.value(n, w.key)))
            .join("\u0001");
    };

    DTMZ._watchValues = function() {
        const wins = this.controller.wins;
        if (wins.some((w) => w._dtmzValues !== undefined && w._dtmzValues !== this._valuesOf(w))) {
            this.refresh();
            for (const w of wins) w._dtmzValues = this._valuesOf(w);
        }
    };

    DTMZ._frame = function() {
        if (!this.controller || this._broken) return;
        try {
            this._updateScale();
            this._syncAnchors(SceneManager._scene);
            if (++this._tick % 20 === 0 && this.controller.wins.length) this._watchValues();
        } catch (e) {
            this._broken = true;
            console.error("DeepTip: anchors disabled after an error", e);
        }
    };

    //-------------------------------------------------------------------------
    // help key (F1 / ? / gamepad Y): the selected command first, then the terms on screen, one per press

    DTMZ.help = function(via, withAreas) {
        const dt = this.controller;
        if (!dt) return false;
        const all = Array.from(this._anchors.values());
        const byPosition = (a, b) => a.top - b.top || a.left - b.left;
        const targets = all
            .filter((r) => r.kind === "item" && r.win && r.win.active && r.win.index() === r.index)
            .concat(all.filter((r) => r.kind === "term").sort(byPosition))
            .concat(withAreas ? all.filter((r) => r.kind === "area").sort(byPosition) : []);
        if (!targets.length) return false;
        const sig = targets.map((t) => t.id).join("|");
        if (sig !== this._helpSig) {
            this._helpSig = sig;
            this._helpAt = -1;
        }
        this._helpAt = (this._helpAt + 1) % targets.length;
        const target = targets[this._helpAt];
        const last = this._helpWin;
        if (last && dt.wins.indexOf(last) >= 0 && last.anchor !== target.el) dt.close(last);
        dt.open(target.key, { anchor: target.el, pinned: true, focus: true, via }).then((w) => {
            this._helpWin = w;
        });
        return true;
    };

    window.addEventListener(
        "keydown",
        (e) => {
            if (e.repeat || P.helpKeys.indexOf(e.key) < 0 || !DTMZ.controller) return;
            if (DTMZ.focusInside()) return; // inside a window the runtime follows the focused term
            const t = e.target;
            if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
            if (DTMZ.help("key", true)) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true
    );

    //-------------------------------------------------------------------------
    // game input while DeepTip is in use

    let padHelpBefore = false;
    const padHelpPressed = () => {
        if (!(P.helpButton >= 0)) return false;
        const states = Input._gamepadStates || [];
        const now = states.some((s) => s && s[P.helpButton]);
        const hit = now && !padHelpBefore;
        padHelpBefore = now;
        return hit;
    };

    const consume = (input) => {
        input._latestButton = null;
        input._pressedTime = 0;
    };

    const mute = (input) => {
        input._currentState = {};
        input._previousState = {};
        input._dir4 = 0;
        input._dir8 = 0;
        consume(input);
    };

    DTMZ._afterInput = function(input) {
        const dt = this.controller;
        if (!dt) return;
        const help = padHelpPressed();
        if (this.focusInside()) {
            mute(input); // the gamepad drives the focused DeepTip window, not the game
            return;
        }
        if (help && this.help("pad", false)) {
            consume(input);
            return;
        }
        if (dt.wins.length && input._pressedTime === 0) {
            if (input._latestButton === "escape") {
                // X, Insert, Numpad 0 (Esc itself is handled by the runtime): close the newest window first
                consume(input);
                dt.close(dt.wins[dt.wins.length - 1]);
            } else if (input._latestButton === "cancel") {
                consume(input); // gamepad B: the runtime closes the newest window
            }
        }
    };

    const _Input_update = Input.update;
    Input.update = function() {
        _Input_update.call(this);
        DTMZ._afterInput(this);
    };

    const _TouchInput_update = TouchInput.update;
    TouchInput.update = function() {
        _TouchInput_update.call(this);
        if (DTMZ._eatRelease && this._currentState.released) {
            this._clicked = false;
            DTMZ._eatRelease = false;
        }
    };

    //-------------------------------------------------------------------------
    // engine hooks

    const _Scene_Boot_onDatabaseLoaded = Scene_Boot.prototype.onDatabaseLoaded;
    Scene_Boot.prototype.onDatabaseLoaded = function() {
        _Scene_Boot_onDatabaseLoaded.call(this);
        DTMZ.start();
    };

    const _Scene_Boot_isReady = Scene_Boot.prototype.isReady;
    Scene_Boot.prototype.isReady = function() {
        return _Scene_Boot_isReady.call(this) && DTMZ._bootDone();
    };

    const _SceneManager_update = SceneManager.update;
    SceneManager.update = function(deltaTime) {
        _SceneManager_update.call(this, deltaTime);
        DTMZ._frame();
    };

    const _SceneManager_onSceneCreate = SceneManager.onSceneCreate;
    SceneManager.onSceneCreate = function() {
        _SceneManager_onSceneCreate.call(this);
        if (P.closeOnSceneChange) DTMZ.closeAll();
    };

    //-------------------------------------------------------------------------
    // \DT[key] and \DT[key|text] in every text drawn with escape codes

    DTMZ.termColor = function() {
        return /^\d+$/.test(P.termColor) ? ColorManager.textColor(Number(P.termColor)) : P.termColor;
    };

    const drawTerm = (win, textState) => {
        const m = /^\[([^\]]*)\]/.exec(textState.text.slice(textState.index));
        if (!m) return;
        textState.index += m[0].length;
        const bar = m[1].indexOf("|");
        const key = (bar < 0 ? m[1] : m[1].slice(0, bar)).trim();
        const label = bar < 0 ? DTMZ.title(key) : m[1].slice(bar + 1);
        const contents = win.contents;
        const color = contents.textColor;
        const x0 = textState.x;
        win.changeTextColor(DTMZ.termColor());
        textState.buffer += label;
        win.flushTextState(textState);
        win.changeTextColor(color);
        if (!textState.drawing || !validKey(key)) return;
        const x = Math.min(x0, textState.x);
        const width = Math.abs(textState.x - x0);
        if (P.termUnderline && width > 0) {
            const y = Math.round(textState.y + textState.height / 2 + contents.fontSize * 0.35) + 3;
            const opacity = contents.paintOpacity;
            contents.paintOpacity = Math.round(opacity * 0.6);
            contents.fillRect(x, y, width, Math.max(1, Math.round(contents.fontSize / 13)), DTMZ.termColor());
            contents.paintOpacity = opacity;
        }
        if (!contents._dtTerms) contents._dtTerms = [];
        contents._dtTerms.push({ id: ++termSeq, key, label, x, y: textState.y, w: width, h: textState.height });
    };

    const _Window_Base_processEscapeCharacter = Window_Base.prototype.processEscapeCharacter;
    Window_Base.prototype.processEscapeCharacter = function(code, textState) {
        if (code === "DT") {
            drawTerm(this, textState);
        } else {
            _Window_Base_processEscapeCharacter.call(this, code, textState);
        }
    };

    // Terms live on the bitmap they were drawn on and vanish with the pixels.
    const _Bitmap_clearRect = Bitmap.prototype.clearRect;
    Bitmap.prototype.clearRect = function(x, y, width, height) {
        _Bitmap_clearRect.call(this, x, y, width, height);
        if (this._dtTerms) {
            this._dtTerms = this._dtTerms.filter(
                (t) => t.x >= x + width || t.x + t.w <= x || t.y >= y + height || t.y + t.h <= y
            );
        }
    };

    //-------------------------------------------------------------------------
    // keys of list items: note tag, then command symbol; override per window class for your own lists

    /** The database object shown at `index` (item, weapon, armor, skill, actor, enemy) or null. */
    DTMZ.dataObject = function(win, index) {
        let x = null;
        if (typeof win.itemAt === "function") {
            x = win.itemAt(index);
        } else if (typeof Window_BattleEnemy !== "undefined" && win instanceof Window_BattleEnemy) {
            x = win._enemies ? win._enemies[index] : null;
        } else if (typeof win.actor === "function" && win.actor.length > 0) {
            x = win.actor(index);
        }
        if (!x) return null;
        if (x.meta) return x;
        if (typeof x.isActor === "function" && x.isActor()) return x.actor();
        if (typeof x.isEnemy === "function" && x.isEnemy()) return x.enemy();
        return null;
    };

    /** The glossary key of the item at `index`, or "" for none. */
    Window_Selectable.prototype.deepTipKey = function(index) {
        const obj = DTMZ.dataObject(this, index);
        const tag = obj && obj.meta ? obj.meta[P.noteTag] : null;
        if (typeof tag === "string" && tag.trim()) return tag.trim();
        const command = this._list && this._list[index];
        if (command && command.symbol != null) {
            const key = P.commandPrefix + command.symbol;
            if (DTMZ.has(key)) return key;
        }
        return "";
    };

    /** Explained areas of a window: [{ key, x, y, width, height, delay?, place? }] in contents coordinates. */
    Window_Base.prototype.deepTipAreas = function() {
        return null;
    };

    //-------------------------------------------------------------------------
    // plugin commands

    const waits = new WeakMap(); // interpreter -> { pending, win }; never saved with the game

    PluginManager.registerCommand(PLUGIN, "open", function(args) {
        const promise = DTMZ.open(String(args.key || "").trim(), { pinned: args.pinned !== "false" });
        if (args.wait === "true") {
            const wait = { pending: true, win: null };
            waits.set(this, wait);
            promise.then((w) => {
                wait.pending = false;
                wait.win = w;
            });
        }
    });

    PluginManager.registerCommand(PLUGIN, "closeAll", () => DTMZ.closeAll());

    PluginManager.registerCommand(PLUGIN, "setLocale", (args) => {
        DTMZ.setLocale(String(args.locale || "").trim());
    });

    const _Game_Interpreter_updateWait = Game_Interpreter.prototype.updateWait;
    Game_Interpreter.prototype.updateWait = function() {
        const wait = waits.get(this);
        if (wait) {
            const dt = DTMZ.controller;
            if (wait.pending || (wait.win && dt && dt.wins.indexOf(wait.win) >= 0)) return true;
            waits.delete(this);
        }
        return _Game_Interpreter_updateWait.call(this);
    };
})();
