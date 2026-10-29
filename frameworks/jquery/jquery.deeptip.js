/*!
 * jquery.deeptip.js 1.0.0 — DeepTip as a jQuery plugin (jQuery 3.x and 4.x).
 * The windows, placement and input are the web runtime's (deeptip.js, imported below); this module only adds
 * $.deeptip (the page's one controller) and $.fn.deeptip (mark elements, open and close their windows, texts),
 * and triggers jQuery events on the anchor of a window: deeptip:open, deeptip:pin, deeptip:close.
 * https://github.com/gorduan/DeepTip (MIT)
 *
 *   <script src="jquery.min.js"></script>
 *   <script type="module" src="jquery.deeptip.js"></script>       installs itself into window.jQuery
 *   $(function () { $.deeptip.init({ locale: "en", sources: ["deeptip/{locale}.json"] }); $("#cart").deeptip("shop.cart"); });
 */
import { DeepTip } from "./deeptip.js";

export const VERSION = "1.0.0";

const METHODS = ["open", "close", "pin", "unpin", "remove", "text", "index", "removeIndex"];
const ATTR = "data-deeptip";
const installed = new Set(); // every jQuery this module was installed into: events go through each of them
let dt = null; //               one controller per document, shared by all of them
let user = {}; //               the caller's own onOpen / onPin / onClose
const announced = new Set(); //  windows whose deeptip:open was triggered
const pinLater = new Set(); //   windows pinned before they were announced (opened pinned)
const texts = new Map(); //      element -> markup rendered with .deeptip("text", …), rendered again after setLocale

function trigger(win, type) {
  const anchor = win.anchor;
  for (const $ of installed) $(anchor).trigger(`deeptip:${type}`, [win.key, win.el, win]);
}

function windowOf(el) {
  return dt?.wins.find((w) => w.el === el) ?? null;
}

const callbacks = {
  onOpen(key, el) {
    const win = windowOf(el);
    if (win) {
      announced.add(win);
      trigger(win, "open");
      if (pinLater.delete(win)) trigger(win, "pin");
    }
    user.onOpen?.(key, el);
  },
  onPin(key, el) {
    const win = windowOf(el);
    if (win) {
      if (announced.has(win)) trigger(win, "pin");
      else pinLater.add(win); // open() pins before it calls onOpen: keep the order open → pin
    }
    user.onPin?.(key, el);
  },
  onClose(key) {
    // the closed window has just left dt.wins; children close first, so this finds exactly one
    for (const win of [...announced]) {
      if (dt?.wins.includes(win)) continue;
      announced.delete(win);
      pinLater.delete(win);
      trigger(win, "close");
    }
    user.onClose?.(key);
  },
};

function controller() {
  if (!dt) throw new Error("jquery.deeptip: call $.deeptip.init(options) first");
  return dt;
}

function keyOf(el) {
  return el.getAttribute(ATTR) ?? el.getAttribute("data-dt-key");
}

function renderTexts() {
  for (const [el, markup] of texts) {
    if (el.isConnected) dt.renderText(el, markup);
    else texts.delete(el);
  }
}

/** Adds $.deeptip and $.fn.deeptip to one jQuery. Runs for window.jQuery on import; call it for other copies (noConflict). */
export function install($) {
  if (!$ || !$.fn) throw new TypeError("jquery.deeptip: install($) needs a jQuery");
  installed.add($);
  if ($.deeptip?.version === VERSION) return $;

  $.deeptip = {
    version: VERSION,
    /** The runtime class (frameworks/web/deeptip.js). */
    DeepTip,
    /** The page's controller, null before init(). */
    get instance() {
      return dt;
    },
    /** Creates the controller (once per document) and returns it; later calls change its options. */
    init(options = {}) {
      const { onOpen, onPin, onClose, ...rest } = options;
      if (onOpen !== undefined) user.onOpen = onOpen;
      if (onPin !== undefined) user.onPin = onPin;
      if (onClose !== undefined) user.onClose = onClose;
      if (dt) {
        void dt.configure(rest);
        return dt;
      }
      dt = DeepTip.init({ ...rest, ...callbacks });
      return dt;
    },
    /** Switch language: loads the glossaries, re-renders windows, indexes and every .deeptip("text") element. */
    async setLocale(locale) {
      await controller().setLocale(locale);
      renderTexts();
    },
    /** Re-render open windows and indexes after live values changed. */
    refresh() {
      dt?.refresh();
    },
    /** Close every window, remove every listener; init() starts again. */
    destroy() {
      dt?.destroy();
      dt = null;
      user = {};
      announced.clear();
      pinLater.clear();
      texts.clear();
    },
  };

  /**
   * $(sel).deeptip("key" [, { delay, place }]) or $(sel).deeptip({ key, delay, place }): mark elements.
   * $(sel).deeptip(): the first element's key.
   * $(sel).deeptip("open" [, { pinned = true, focus = false }]), "close", "pin", "unpin", "remove",
   * "text", markup  |  "index" [, { search }]  |  "removeIndex".
   * A key that equals a method name ("open" …) is marked with the object form: .deeptip({ key: "open" }).
   */
  $.fn.deeptip = function (arg, options) {
    if (arg === undefined) return this.length ? keyOf(this[0]) : undefined;
    if (typeof arg === "string" && METHODS.includes(arg)) return run(this, arg, options);
    const spec = typeof arg === "string" ? { ...options, key: arg } : { ...arg };
    if (!spec.key) throw new TypeError("jquery.deeptip: a key is needed");
    return this.each((_, el) => {
      el.setAttribute(ATTR, spec.key);
      if (spec.delay != null) el.setAttribute(`${ATTR}-delay`, String(spec.delay));
      if (spec.place != null) el.setAttribute(`${ATTR}-place`, [].concat(spec.place).join(","));
    });
  };

  function run($set, method, options = {}) {
    if (method === "remove") {
      $set.deeptip("close");
      return $set.each((_, el) => {
        for (const a of [ATTR, `${ATTR}-delay`, `${ATTR}-place`]) el.removeAttribute(a);
      });
    }
    const c = controller();
    return $set.each((_, el) => {
      const open = c.wins.filter((w) => w.anchor === el);
      if (method === "open") {
        const key = keyOf(el);
        if (key) void c.open(key, { anchor: el, pinned: options.pinned ?? true, focus: !!options.focus });
      } else if (method === "close") open.forEach((w) => c.close(w));
      else if (method === "pin") open.forEach((w) => c.pin(w));
      else if (method === "unpin") open.forEach((w) => c.unpin(w));
      else if (method === "text") {
        texts.set(el, String(options));
        void c.ready.then(() => {
          if (texts.get(el) === String(options)) c.renderText(el, String(options));
        });
      } else if (method === "index") c.renderIndex(el, options);
      else if (method === "removeIndex") c.removeIndex(el);
    });
  }

  return $;
}

if (typeof window !== "undefined" && window.jQuery) install(window.jQuery);

export default install;
