/*!
 * deeptip-phaser.js 1.0.0 — DeepTip for Phaser 3 and 4 games.
 * The windows are the web runtime's (deeptip.js, imported below) as HTML over the canvas. This adapter keeps one invisible
 * anchor element over every explained game object, every frame, and tells the runtime what is under the pointer: the
 * anchors never take the pointer, so Phaser receives every real mouse, touch and wheel event as before. Pointer and key
 * presses inside DeepTip windows do not reach the game.
 * https://github.com/gorduan/DeepTip (MIT)
 *
 *   const tips = DeepTipPhaser.attach(game, { locale: "en", sources: ["deeptip/{locale}.json"] });
 *   tips.explain(sprite, "demo.revolt");                       // rest on it: its window opens
 *   tips.explain(word, "demo.unrest", { term: true });         // a term: hover opens, click pins
 */
import { DeepTip } from "./deeptip.js";

export const VERSION = "1.0.0";

let seq = 0;

export class DeepTipPhaser {
  /** Start DeepTip for one Phaser.Game. Options: DeepTip's options (SPEC §7), plus `controller` (use an existing one) and `helpKeys`. */
  static attach(game, options = {}) {
    return new DeepTipPhaser(game, options);
  }

  constructor(game, options = {}) {
    const { controller, helpKeys = ["F1", "?"], ...dtOptions } = options;
    this.game = game;
    this.canvas = game.canvas;
    this.helpKeys = helpKeys;
    this.records = new Map(); //   target -> record
    this.byAnchor = new Map(); //  anchor element -> record
    this.announced = new Set(); // windows whose deeptip:open was emitted
    this.hoverRec = undefined; //  record under the pointer (undefined: unknown, null: none)
    this.pointer = null; //        last pointer position over the canvas {x, y, type, id}
    this.longPressAt = -Infinity;
    this.pressInGame = false;

    // styles through the CSSOM only: a Content Security Policy without unsafe-inline allows them
    this.anchors = this._layer("dtph-anchors", { position: "fixed", inset: "0", margin: "0", padding: "0", overflow: "hidden", pointerEvents: "none" });
    this.windows = this._layer("dtph-windows", { display: "contents" }); // no box: DeepTip windows live in the top layer

    const own = {
      onOpen: (key, el) => this._event("open", key, el),
      onPin: (key, el) => this._event("pin", key, el),
      onClose: (key) => this._closed(key),
    };
    if (controller) {
      this.dt = controller;
      this.ownsController = false;
      this.user = { onOpen: controller.o.onOpen, onPin: controller.o.onPin, onClose: controller.o.onClose };
      controller.configure({ container: this.windows, ...own });
    } else {
      this.dt = DeepTip.init({ ...dtOptions, container: this.windows, ...own });
      this.ownsController = true;
      this.user = { onOpen: dtOptions.onOpen, onPin: dtOptions.onPin, onClose: dtOptions.onClose };
    }

    this._on = {
      frame: () => this._frame(),
      destroy: () => this.destroy(),
      move: (e) => this._pointer(e),
      over: (e) => this._pointer(e),
      leave: () => {
        this.pointer = null; // the runtime sees the element the pointer moves to by itself
        this.hoverRec = undefined;
      },
      down: (e) => this._down(e),
      click: (e) => this._click(e),
      menu: (e) => this._menu(e),
      key: (e) => this._key(e),
      shield: (e) => this._shield(e),
      keyShield: (e) => e.stopPropagation(),
      upAnywhere: () => {
        this.pressInGame = false;
      },
    };
    game.events.on("postrender", this._on.frame);
    game.events.once("destroy", this._on.destroy);
    if (game.canvas) this._bindCanvas();
    else game.events.once("ready", () => this._bindCanvas()); // attached before the game booted
    document.addEventListener("keydown", this._on.key, true);
    window.addEventListener("mouseup", this._on.upAnywhere, true);
    // presses inside DeepTip windows belong to DeepTip: Phaser also listens on window, so stop them on the way up
    for (const type of ["mousedown", "mouseup", "touchstart", "touchend", "touchcancel", "wheel"]) {
      this.windows.addEventListener(type, this._on.shield, { passive: true });
    }
    this.windows.addEventListener("keydown", this._on.keyShield);
  }

  /* ------------------------------------------------------------------ public API */

  /**
   * Explain a game object (anything with getBounds(): sprites, images, texts, containers …) or an area.
   * options: delay, place (as data-deeptip-delay / -place), term (true: a term, hover opens after linkDelay, click pins),
   * camera (default: the scene's main camera), label (term text for screen readers).
   * Returns `target`. The explanation goes with the object when it is destroyed.
   */
  explain(target, key, options = {}) {
    this.forget(target);
    const rec = { id: ++seq, target, key, options, anchor: this._anchor(key, options), attached: false, rect: null, order: [0, 0, 0] };
    this.records.set(target, rec);
    this.byAnchor.set(rec.anchor, rec);
    if (typeof target.once === "function") {
      rec.onDestroy = () => this.forget(target);
      target.once("destroy", rec.onDestroy);
    }
    return target;
  }

  /** An area without a game object, e.g. a tile region: bounds() returns a world rectangle {x, y, width, height} each frame. */
  explainArea(scene, bounds, key, options = {}) {
    const area = { scene, bounds, isArea: true };
    this.explain(area, key, options);
    return area;
  }

  /** Remove the explanation of a target (its preview closes, a pinned window stays where it was). */
  forget(target) {
    const rec = this.records.get(target);
    if (!rec) return;
    if (rec.onDestroy) target.off?.("destroy", rec.onDestroy);
    rec.anchor.remove();
    this.records.delete(target);
    this.byAnchor.delete(rec.anchor);
    if (this.hoverRec === rec) this.hoverRec = undefined;
  }

  /** Open the target's window (pinned unless pinned: false; focus: true moves the keyboard focus into it). */
  open(target, { pinned = true, focus = false } = {}) {
    const rec = this.records.get(target);
    if (!rec) return Promise.resolve(null);
    this._sync(rec);
    if (!rec.attached) return Promise.resolve(null);
    return this.dt.open(rec.key, { anchor: rec.anchor, pinned, focus, via: "api" });
  }

  /** Close the target's window (and everything opened from it). */
  close(target) {
    const rec = this.records.get(target);
    if (rec) for (const w of this.dt.wins.filter((x) => x.anchor === rec.anchor)) this.dt.close(w);
  }

  /** true while a window of the target is open. */
  isOpen(target) {
    const rec = this.records.get(target);
    return !!rec && rec.anchor.hasAttribute("data-dt-open");
  }

  /** true while the keyboard focus is inside a DeepTip window: ignore gamepad input in the game then. */
  hasFocus() {
    const a = document.activeElement;
    return !!a && this.windows.contains(a);
  }

  /** true for 1.5 s after a touch long-press opened a window: the game may ignore that finger's release. */
  wasLongPress() {
    return performance.now() - this.longPressAt < 1500;
  }

  /** Remove the anchors, the layers and every listener; destroys the controller when attach() created it. */
  destroy() {
    if (!this.game) return;
    this.game.events.off("postrender", this._on.frame);
    this.game.events.off("destroy", this._on.destroy);
    const c = this.canvas ?? document.createElement("canvas");
    c.removeEventListener("pointermove", this._on.move);
    c.removeEventListener("pointerover", this._on.over);
    c.removeEventListener("pointerleave", this._on.leave);
    c.removeEventListener("pointerdown", this._on.down);
    c.removeEventListener("click", this._on.click);
    c.removeEventListener("contextmenu", this._on.menu);
    document.removeEventListener("keydown", this._on.key, true);
    window.removeEventListener("mouseup", this._on.upAnywhere, true);
    for (const target of [...this.records.keys()]) this.forget(target);
    if (this.ownsController) this.dt.destroy();
    else this.dt.closeAll();
    this.anchors.remove();
    this.windows.remove();
    this.game = null;
  }

  _bindCanvas() {
    const c = (this.canvas = this.game.canvas);
    c.addEventListener("pointermove", this._on.move); // target phase: after the runtime's own listeners on document
    c.addEventListener("pointerover", this._on.over);
    c.addEventListener("pointerleave", this._on.leave);
    c.addEventListener("pointerdown", this._on.down);
    c.addEventListener("click", this._on.click);
    c.addEventListener("contextmenu", this._on.menu);
  }

  /* ------------------------------------------------------------------ anchors, every frame */

  _layer(className, style) {
    const el = document.createElement("div");
    el.className = className;
    Object.assign(el.style, style);
    document.body.append(el);
    return el;
  }

  _anchor(key, o) {
    const base = { position: "absolute", boxSizing: "border-box", margin: "0", padding: "0", border: "0", background: "none" };
    let el;
    if (o.term) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "dtph-anchor dt-link";
      el.tabIndex = -1;
      el.setAttribute("data-dt-key", key);
      el.setAttribute("aria-label", o.label ?? key);
      Object.assign(el.style, base, { display: "block", color: "var(--dt-link, #0b69d4)", font: "inherit" });
    } else {
      el = document.createElement("div");
      el.className = "dtph-anchor";
      el.setAttribute("data-deeptip", key);
      if (o.delay != null) el.setAttribute("data-deeptip-delay", String(o.delay));
      if (o.place != null) el.setAttribute("data-deeptip-place", [].concat(o.place).join(","));
      Object.assign(el.style, base);
    }
    return el;
  }

  _frame() {
    if (!this.game || !this.canvas) return;
    const box = this.canvas.getBoundingClientRect();
    this.box = box;
    this.kx = box.width / this.game.scale.width;
    this.ky = box.height / this.game.scale.height;
    for (const rec of this.records.values()) this._sync(rec);
    if (this.pointer) this._hover(this._hit(this.pointer.x, this.pointer.y)); // objects move under a resting pointer
  }

  /** Visible screen rectangle of a record in client pixels, or null. */
  _screenRect(rec) {
    const t = rec.target;
    const scene = t.scene;
    if (!scene?.sys || !scene.sys.isActive?.() || !scene.sys.isVisible?.()) return null;
    let world;
    let sfx = 1;
    let sfy = 1;
    if (t.isArea) {
      world = t.bounds();
    } else {
      if (t.active === false || t.visible === false || !t.getBounds) return null;
      let top = t;
      for (let p = t.parentContainer; p; p = p.parentContainer) {
        if (!p.visible) return null;
        top = p;
      }
      sfx = top.scrollFactorX ?? 1;
      sfy = top.scrollFactorY ?? 1;
      world = t.getBounds();
    }
    if (!world || !(world.width > 0) || !(world.height > 0)) return null;
    const cam = rec.options.camera ?? scene.cameras.main;
    // Phaser 4: matrixCombined already holds the scroll and the viewport position; Phaser 3: matrix, scroll applied here
    const p4 = cam.matrixCombined;
    const m = p4 ?? cam.matrix;
    const ox = p4 ? -cam.scrollX * (1 - sfx) : cam.scrollX * sfx;
    const oy = p4 ? -cam.scrollY * (1 - sfy) : cam.scrollY * sfy;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const [wx, wy] of [
      [world.x, world.y],
      [world.x + world.width, world.y],
      [world.x, world.y + world.height],
      [world.x + world.width, world.y + world.height],
    ]) {
      const x = m.a * (wx - ox) + m.c * (wy - oy) + m.e;
      const y = m.b * (wx - ox) + m.d * (wy - oy) + m.f;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    // clip to the camera's viewport, then game pixels -> client pixels
    left = Math.max(left, cam.x);
    top = Math.max(top, cam.y);
    right = Math.min(right, cam.x + cam.width);
    bottom = Math.min(bottom, cam.y + cam.height);
    if (right - left < 2 || bottom - top < 2) return null;
    const b = this.box;
    return { left: b.left + left * this.kx, top: b.top + top * this.ky, right: b.left + right * this.kx, bottom: b.top + bottom * this.ky };
  }

  _sync(rec) {
    if (!this.box) {
      this.box = this.canvas.getBoundingClientRect();
      this.kx = this.box.width / this.game.scale.width;
      this.ky = this.box.height / this.game.scale.height;
    }
    const r = this._screenRect(rec);
    rec.rect = r;
    if (!r) {
      if (rec.attached) {
        rec.anchor.remove(); // the runtime closes its preview; a pinned window stays where it was
        rec.attached = false;
      }
      return;
    }
    const s = rec.anchor.style;
    const left = `${Math.round(r.left * 2) / 2}px`;
    const top = `${Math.round(r.top * 2) / 2}px`;
    const width = `${Math.round((r.right - r.left) * 2) / 2}px`;
    const height = `${Math.round((r.bottom - r.top) * 2) / 2}px`;
    if (s.left !== left) s.left = left;
    if (s.top !== top) s.top = top;
    if (s.width !== width) s.width = width;
    if (s.height !== height) s.height = height;
    if (!rec.attached) {
      this.anchors.append(rec.anchor);
      rec.attached = true;
    }
    rec.order = this._order(rec);
  }

  /** Drawing order: later scenes above earlier ones, then the display list (depth sorted), areas below objects. */
  _order(rec) {
    const t = rec.target;
    const scenes = this.game.scene.scenes;
    const si = scenes.indexOf(t.scene);
    if (t.isArea) return [si, -1, 0];
    let top = t;
    let child = 0;
    for (let p = t.parentContainer; p; p = p.parentContainer) {
      child = p.getIndex?.(top) ?? 0;
      top = p;
    }
    return [si, t.scene.sys.displayList.getIndex(top), child];
  }

  _hit(x, y) {
    let best = null;
    for (const rec of this.records.values()) {
      const r = rec.rect;
      if (!rec.attached || !r || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (!best || compare(rec.order, best.order) > 0) best = rec;
    }
    return best;
  }

  /* ------------------------------------------------------------------ pointer: tell the runtime what is under it */

  _pointer(e) {
    if (!e.isTrusted) return; // our own pointerover on the canvas (nothing under the pointer)
    if (e.type === "pointerover") this.hoverRec = undefined; // the runtime just saw the canvas itself
    this.pointer = { x: e.clientX, y: e.clientY, type: e.pointerType, id: e.pointerId };
    if (e.pointerType === "touch") return;
    this._hover(this._hit(e.clientX, e.clientY));
  }

  _hover(rec) {
    if (rec === this.hoverRec) return;
    this.hoverRec = rec;
    const p = this.pointer;
    const target = rec ? rec.anchor : this.canvas;
    target.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, composed: true, pointerType: p?.type ?? "mouse", pointerId: p?.id ?? 1, clientX: p?.x ?? 0, clientY: p?.y ?? 0 }),
    );
  }

  _down(e) {
    if (!e.isTrusted) return;
    this.pressInGame = true;
    const rec = this._hit(e.clientX, e.clientY);
    if (!rec || rec.options.term) return;
    // mouse: the runtime mutes the element's pending window (the player uses it); touch: the long-press starts
    rec.anchor.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, composed: true, pointerType: e.pointerType, pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, isPrimary: e.isPrimary }),
    );
  }

  _click(e) {
    if (!e.isTrusted) return;
    const rec = this._hit(e.clientX, e.clientY);
    if (!rec?.options.term) return;
    rec.anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, detail: e.detail || 1, clientX: e.clientX, clientY: e.clientY }));
  }

  _menu(e) {
    if (this.dt.press || this.wasLongPress()) e.preventDefault();
  }

  _key(e) {
    if (e.defaultPrevented || !this.helpKeys.includes(e.key) || this.hasFocus()) return;
    const t = e.target;
    if (t?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    const rec = this.hoverRec ?? (this.pointer ? this._hit(this.pointer.x, this.pointer.y) : null);
    if (!rec) return;
    e.preventDefault();
    e.stopPropagation();
    // an open window is reused: pinned, the focus on its first term (as F1 on a focused element does)
    void this.dt.open(rec.key, { anchor: rec.anchor, pinned: true, focus: true, via: "key" });
  }

  _shield(e) {
    if (e.type === "mouseup" && this.pressInGame) return; // a drag the game started ends in the game
    e.stopPropagation();
  }

  /* ------------------------------------------------------------------ events on game objects */

  _event(type, key, el) {
    const win = this.dt.wins.find((w) => w.el === el);
    if (win) {
      if (type === "open") {
        this.announced.add(win);
        if (win.via === "touch") this.longPressAt = performance.now();
      }
      this.byAnchor.get(win.anchor)?.target.emit?.(`deeptip:${type}`, key, el);
    }
    this.user[type === "open" ? "onOpen" : "onPin"]?.(key, el);
  }

  _closed(key) {
    for (const win of [...this.announced]) {
      if (this.dt.wins.includes(win)) continue;
      this.announced.delete(win);
      this.byAnchor.get(win.anchor)?.target.emit?.("deeptip:close", win.key);
    }
    this.user.onClose?.(key);
  }
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export default DeepTipPhaser;
