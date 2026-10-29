//=============================================================================
// DeepTipDemo.js v1.0.0: the DeepTip example HUD for RPG Maker MZ
// https://github.com/gorduan/DeepTip (MIT)
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v1.0.0 DeepTip example: a HUD on the map whose labels explain themselves.
 * @author Gorduan
 * @url https://github.com/gorduan/DeepTip
 * @base DeepTip
 * @orderAfter DeepTip
 *
 * @help DeepTipDemo.js
 *
 * The example of the DeepTip download, like the web example: a HUD at the
 * top of the map with Realm, Stability, Taxes, Nobles, Gold and a "?".
 * Rest the mouse on a label (the "?" opens at once), hover the highlighted
 * terms in the window, click to pin. Keyboard: F1 walks through the labels.
 *
 * Click Stability or Taxes to change them: an open window shows the new
 * value. Press L to switch between English and German.
 *
 * Stability is variable 1 (-3 to +3), taxes variable 2 (0 low, 1 normal,
 * 2 high), gold is the party's gold. The glossary comes from
 * data/deeptip/core/<locale>.json and data/deeptip/<locale>.json.
 */

(() => {
    "use strict";

    const STABILITY = 1; // variable ids
    const TAXES = 2;

    const TEXT = {
        en: {
            realm: "Realm",
            nobles: "Nobles",
            stability: (v) => `Stability ${v > 0 ? "+" : ""}${v}`,
            taxes: (v) => `Taxes: ${["low", "normal", "high"][v] || "normal"}`,
            gold: (v) => `Gold ${v}`
        },
        de: {
            realm: "Reich",
            nobles: "Adel",
            stability: (v) => `Stabilität ${v > 0 ? "+" : ""}${v}`,
            taxes: (v) => `Steuern: ${["niedrig", "normal", "hoch"][v] || "normal"}`,
            gold: (v) => `Gold ${v}`
        }
    };

    const locale = () => {
        const dt = window.DeepTipMZ && DeepTipMZ.controller;
        return dt && TEXT[dt.locale] ? dt.locale : "en";
    };

    class Window_DeepTipHud extends Window_Base {
        initialize(rect) {
            super.initialize(rect);
            this._signature = "";
            this._areas = [];
            this.refresh();
        }

        signature() {
            return [locale(), $gameVariables.value(STABILITY), $gameVariables.value(TAXES), $gameParty.gold()].join();
        }

        update() {
            super.update();
            // MZ windows hide what lies below them: make room for messages shown at the top
            this.visible = !($gameMessage.isBusy() && $gameMessage.positionType() === 0);
            if (this.signature() !== this._signature) this.refresh();
            if (this.visible) this.processClick();
        }

        refresh() {
            this._signature = this.signature();
            this.contents.clear();
            this.contents.fontSize = 20;
            const t = TEXT[locale()];
            const labels = [
                ["demo.realm", t.realm],
                ["demo.stability", t.stability($gameVariables.value(STABILITY))],
                ["demo.taxes", t.taxes($gameVariables.value(TAXES))],
                ["demo.nobles", t.nobles],
                ["demo.gold", t.gold($gameParty.gold())],
                ["deeptip.about", "?", 0]
            ];
            const height = this.innerHeight;
            this._areas = [];
            let x = 0;
            for (const [key, label, delay] of labels) {
                const width = this.textWidth(label) + 20;
                if (key === "deeptip.about") x = this.innerWidth - width; // the help button sits on the right
                this.drawText(label, x, 0, width, "center");
                // an explained area: the rest delay applies, "?" opens at once like data-deeptip-delay="0"
                this._areas.push({ key, x, y: 0, width, height, delay });
                x += width + 6;
            }
        }

        // DeepTip asks every window for its explained areas (contents coordinates)
        deepTipAreas() {
            return this._areas;
        }

        areaAt(x, y) {
            const p = this.worldTransform.applyInverse(new Point(x, y));
            const cx = p.x - this.padding;
            const cy = p.y - this.padding;
            return this._areas.find((a) => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) || null;
        }

        isTouched() {
            const p = this.worldTransform.applyInverse(new Point(TouchInput.x, TouchInput.y));
            return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
        }

        // the labels keep their own click action, DeepTip only adds the explanation
        processClick() {
            if (!TouchInput.isClicked()) return;
            const area = this.areaAt(TouchInput.x, TouchInput.y);
            if (!area) return;
            if (area.key === "demo.stability") {
                const v = $gameVariables.value(STABILITY);
                $gameVariables.setValue(STABILITY, v >= 3 ? -3 : v + 1);
            } else if (area.key === "demo.taxes") {
                const level = ($gameVariables.value(TAXES) + 1) % 3;
                $gameVariables.setValue(TAXES, level);
                $gameParty.gainGold([50, 120, 260][level]);
            }
        }
    }
    window.Window_DeepTipHud = Window_DeepTipHud;

    const _Scene_Map_createAllWindows = Scene_Map.prototype.createAllWindows;
    Scene_Map.prototype.createAllWindows = function() {
        _Scene_Map_createAllWindows.call(this);
        const rect = new Rectangle(0, 0, Graphics.boxWidth, this.calcWindowHeight(1, false));
        this._deepTipHud = new Window_DeepTipHud(rect);
        this.addWindow(this._deepTipHud);
        this._mapNameWindow.y = rect.height; // MZ windows hide what lies below them, even when transparent
    };

    // a click on the HUD must not also walk the player there
    const _Scene_Map_isAnyButtonPressed = Scene_Map.prototype.isAnyButtonPressed;
    Scene_Map.prototype.isAnyButtonPressed = function() {
        return _Scene_Map_isAnyButtonPressed.call(this) || !!(this._deepTipHud && this._deepTipHud.isTouched());
    };

    const _DataManager_setupNewGame = DataManager.setupNewGame;
    DataManager.setupNewGame = function() {
        _DataManager_setupNewGame.call(this);
        $gameVariables.setValue(STABILITY, 1);
        $gameVariables.setValue(TAXES, 1);
        $gameParty.gainGold(1250 - $gameParty.gold());
    };

    // L switches the language, like the select box of the web example
    document.addEventListener("keydown", (e) => {
        if ((e.key === "l" || e.key === "L") && window.DeepTipMZ && DeepTipMZ.controller) {
            DeepTipMZ.setLocale(DeepTipMZ.controller.locale === "de" ? "en" : "de");
        }
    });
})();
