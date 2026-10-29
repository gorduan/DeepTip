/*!
 * DeepTip 1.0.0 — explanation windows with depth ("tooltips in tooltips", Paradox style).
 *
 * Rest the pointer on a UI element and, after `delay`, a window explains it. Highlighted terms in that window
 * open further windows on hover; a click pins a window open, and pinned windows nest without limit.
 *
 * Native first (SPEC.md §1): terms are <button>s, windows are popovers in the top layer, CSS anchor
 * positioning places them and CSS runs the animations and the timer-lock bar. This file only loads the
 * glossary, keeps the window tree and reads mouse, touch, keyboard and gamepad. No dependencies.
 * Safe to import outside a browser: the validator reuses parseText / flattenGlossary / computePlacement.
 */

export const VERSION = "1.0.0";
export const KEY_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
export const SIDES = ["left", "right", "top", "bottom"];

const ENTRY_FIELDS = ["title", "short", "body"];
const ESCAPABLE = "\\*`[]{}|";
const VAR_RE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/;
const TENDENCY_MAX = 1500; // ms a window may stay open while the pointer keeps heading towards it
const HOLD = 600; //          ms: holding Esc / gamepad B closes every window
const MOVE_TOL = 10; //       px a long-press may drift
const SWIPE = 60; //          px downward swipe on a window's title bar closes all

/* ================================================================== glossary data (pure) */

/**
 * Flatten one locale file into a Map of entries. Accepts flat dotted keys ({"hw.vram": {...}}) and nested
 * i18next-style objects ({"hw": {"vram": {...}}}); an object is an entry once it has title, short or body.
 * Top-level keys starting with "$" are metadata ($schema, $locale, $ui).
 */
export function flattenGlossary(obj) {
  const entries = new Map();
  const meta = {};
  const problems = [];
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("$")) {
        if (!prefix) meta[k] = v;
        continue;
      }
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (ENTRY_FIELDS.some((f) => typeof v[f] === "string")) {
          if (!KEY_RE.test(key)) problems.push({ key, msg: "invalid key (letters, digits, _ - separated by dots)" });
          entries.set(key, v);
        } else walk(v, key);
      } else problems.push({ key, msg: "not an entry object" });
    }
  };
  if (obj && typeof obj === "object" && !Array.isArray(obj)) walk(obj, "");
  else problems.push({ key: "(file)", msg: "a glossary file must be a JSON object" });
  return { entries, meta, problems };
}

/* ================================================================== text: markup -> tiny AST (pure) */

/**
 * Parse DeepTip markup (SPEC §2.4) into blocks. Never produces HTML, so glossary text cannot inject markup.
 *   blocks: {type:"p", c:[inline]} | {type:"ul", items:[[inline]]}
 *   inline: {t:"text",v} {t:"br"} {t:"b",c} {t:"i",c} {t:"code",v} {t:"link",key,text} {t:"var",name}
 */
export function parseText(src) {
  const blocks = [];
  for (const chunk of String(src ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    let para = [];
    let list = null;
    const endPara = () => {
      if (para.length) blocks.push({ type: "p", c: parseInline(para.join("\n")) });
      para = [];
    };
    for (const line of chunk.split("\n")) {
      const m = /^\s*[-•]\s+(.*)$/.exec(line);
      if (m) {
        endPara();
        if (!list) blocks.push((list = { type: "ul", items: [] }));
        list.items.push(parseInline(m[1]));
      } else if (line.trim()) {
        list = null;
        para.push(line.trim());
      }
    }
    endPara();
  }
  return blocks;
}

function parseInline(s, depth = 0) {
  const out = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (c === "[" && s[i + 1] === "[") {
      const end = s.indexOf("]]", i + 2);
      if (end > 0) {
        const inner = s.slice(i + 2, end);
        const bar = inner.indexOf("|");
        const key = (bar < 0 ? inner : inner.slice(0, bar)).trim();
        if (KEY_RE.test(key)) {
          flush();
          out.push({ t: "link", key, text: bar < 0 ? null : inner.slice(bar + 1).trim() || null });
          i = end + 2;
          continue;
        }
      }
    }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "*" && depth < 3) {
      const mark = s[i + 1] === "*" ? "**" : "*";
      const from = i + mark.length;
      if (from < s.length && !/\s/.test(s[from])) {
        const end = findClose(s, from, mark);
        if (end > 0) {
          flush();
          out.push({ t: mark === "**" ? "b" : "i", c: parseInline(s.slice(from, end), depth + 1) });
          i = end + mark.length;
          continue;
        }
      }
    }
    if (c === "{") {
      const m = VAR_RE.exec(s.slice(i, i + 64));
      if (m) {
        flush();
        out.push({ t: "var", name: m[1] });
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

function findClose(s, from, mark) {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "`") {
      const e = s.indexOf("`", j + 1);
      if (e > j) {
        j = e;
        continue;
      }
    }
    if (s.startsWith("[[", j)) {
      const e = s.indexOf("]]", j + 2);
      if (e > j) {
        j = e + 1;
        continue;
      }
    }
    if (mark === "*" && s.startsWith("**", j)) {
      const e = findClose(s, j + 2, "**");
      if (e > 0) {
        j = e + 1;
        continue;
      }
    }
    if (s.startsWith(mark, j) && j > from && !/\s/.test(s[j - 1])) return j;
  }
  return -1;
}

/** All link targets and live-value names used in a text (or in already parsed blocks). */
export function collectRefs(src) {
  const links = [];
  const vars = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.t === "link") links.push(n.key);
      else if (n.t === "var") vars.push(n.name);
      else if (n.c) walk(n.c);
    }
  };
  for (const b of typeof src === "string" ? parseText(src) : src) {
    if (b.type === "ul") b.items.forEach(walk);
    else walk(b.c);
  }
  return { links, vars };
}

/* ================================================================== placement (pure, SPEC §4) */

/**
 * Where a window of `size` goes next to the anchor rectangle `a` inside viewport `vp`.
 * Tries `sides` in order and takes the first where the window fits between anchor and screen edge (it never
 * covers the anchor). On the cross axis it is centred on the anchor and pushed back inside the screen.
 * Nothing fits: the side with the most room, the window shrunk to that room (maxW / maxH).
 */
export function computePlacement(size, a, sides, vp, gap = 8) {
  const horiz = (s) => s === "left" || s === "right";
  const room = {
    left: a.left - 2 * gap,
    right: vp.w - a.right - 2 * gap,
    top: a.top - 2 * gap,
    bottom: vp.h - a.bottom - 2 * gap,
  };
  const need = (s) => (horiz(s) ? size.w : size.h);
  const order = sides.filter((s) => SIDES.includes(s));
  if (!order.length) order.push("bottom");
  let side = order.find((s) => room[s] >= need(s));
  const fits = !!side;
  let maxW = 0;
  let maxH = 0;
  if (!side) {
    side = order.reduce((best, s) => (room[s] / need(s) > room[best] / need(best) ? s : best));
    if (room[side] >= 120) horiz(side) ? (maxW = room[side]) : (maxH = room[side]);
  }
  const w = maxW ? Math.min(size.w, maxW) : size.w;
  const h = maxH ? Math.min(size.h, maxH) : size.h;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const aw = a.right - a.left;
  const ah = a.bottom - a.top;
  let x;
  let y;
  if (horiz(side)) {
    x = side === "left" ? a.left - gap - w : a.right + gap;
    y = a.top + ah / 2 - h / 2;
  } else {
    y = side === "top" ? a.top - gap - h : a.bottom + gap;
    x = a.left + aw / 2 - w / 2;
  }
  x = clamp(x, gap, vp.w - gap - w);
  y = clamp(y, gap, vp.h - gap - h);
  return { side, x, y, fits, maxW, maxH };
}

/* ================================================================== runtime */

const UI = {
  en: {
    close: "Close",
    pin: "Pin",
    unpin: "Unpin",
    missing: "No explanation for this term yet.",
    fallback: "Not translated yet",
    hint: "Click to pin · Esc closes",
    seeAlso: "See also:",
    search: "Search terms …",
    mentionedIn: "Mentioned in",
    empty: "No matches.",
  },
  de: {
    close: "Schließen",
    pin: "Festhalten",
    unpin: "Loslassen",
    missing: "Zu diesem Begriff gibt es noch keine Erklärung.",
    fallback: "Noch nicht übersetzt",
    hint: "Klick hält fest · Esc schließt",
    seeAlso: "Siehe auch:",
    search: "Begriffe suchen …",
    mentionedIn: "Erwähnt in",
    empty: "Keine Treffer.",
  },
};

const DEFAULTS = {
  delay: 800, //            ms the pointer rests on a UI element before its window opens (0 = at once)
  linkDelay: 80, //         ms on a highlighted term before its window opens
  closeDelay: 300, //       ms grace before an unpinned window closes once the pointer left it
  lockAfter: 0, //          ms resting inside an unpinned window pins it (Paradox "timer lock"); 0 = off
  longPress: 500, //        ms touch press that opens a window
  closeButtons: true, //    X in every window
  pinButton: true, //       pin toggle in every window
  hints: true, //           "Click to pin · Esc closes" line in unpinned windows
  clickInsidePins: true, // a click anywhere inside an unpinned window pins it
  outsideClickCloses: "touch", // "never" | "touch" | "always": pressing outside every window closes them all
  root: ["bottom", "top", "right", "left"], // first window: sides of the UI element, in order of preference
  child: ["left", "right", "top", "bottom"], // further windows: sides of the previous window
  engine: "auto", //        "auto" (CSS anchor positioning, JS when nothing fits) | "js"
  locale: "en",
  fallback: ["en"], //      locales tried when an entry is missing
  sources: [], //           URL templates, "{locale}" is replaced: ["/glossary/core/{locale}.json", ...]
  vars: null, //            live values for {name}: object (values or functions) or (name, key) => value
  selector: "[data-deeptip]",
  attribute: "data-deeptip",
  openKeys: ["F1", "?"], // keys that open the focused element's window (pinned)
  gamepad: true,
  vibrate: true,
  container: null, //       where windows are appended (default document.body)
  onOpen: null, //          (key, element) => void
  onClose: null, //         (key) => void
  onPin: null, //           (key, element) => void
};

const PIN_PATH =
  "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z";
const CLOSE_PATH = "M18 6 6 18M6 6l12 12";

let seq = 0;

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(d) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d);
  svg.append(p);
  return svg;
}

function overlap(a, b) {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return x > 0 && y > 0 ? Math.min(x, y) : 0;
}

export class DeepTip {
  /** Create the (one) DeepTip controller of a document. */
  static init(options) {
    return new DeepTip(options);
  }

  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.locale = this.o.locale;
    this.data = new Map(); //    locale -> Map<key, entry>
    this.labels = new Map(); //  locale -> $ui labels
    this.fetched = new Set();
    this.wins = []; //           open windows, oldest first (= top-layer order)
    this.hover = {}; //          {win, link, trig} under the mouse
    this.hot = new Set(); //     windows the pointer is in, on, or on the way to via an anchor
    this.pending = null; //      armed hover timer
    this.samples = []; //        recent mouse positions (mouse tendency)
    this.indexes = new Map();
    this.warned = new Set();
    this.css =
      typeof CSS !== "undefined" && !!CSS.supports?.("position-area: left span-all") && CSS.supports("anchor-name: --dt");
    this.ready = this._load();
    if (typeof document === "undefined") return;
    // JS-placed windows follow size changes (pinning hides the hint line, live values, fonts)
    this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this._reflow(true)) : null;
    this._listen(true);
  }

  /* ---------------------------------------------------------------- data */

  get chain() {
    return [...new Set([this.locale, ...[].concat(this.o.fallback ?? [])])];
  }

  /** Add (or override) entries of one locale. Later calls win per key: core first, project after. */
  add(locale, glossary) {
    const { entries, meta, problems } = flattenGlossary(glossary);
    for (const p of problems) console.warn(`DeepTip: ${locale} ${p.key}: ${p.msg}`);
    const map = this.data.get(locale) ?? new Map();
    for (const [k, v] of entries) map.set(k, v);
    this.data.set(locale, map);
    if (meta.$ui && typeof meta.$ui === "object") this.labels.set(locale, { ...this.labels.get(locale), ...meta.$ui });
    this.refresh();
    return this;
  }

  async _load() {
    const jobs = [];
    for (const loc of this.chain) {
      for (const tpl of [].concat(this.o.sources ?? [])) {
        const url = tpl.replaceAll("{locale}", loc);
        if (this.fetched.has(url)) continue;
        this.fetched.add(url);
        jobs.push(
          fetch(url)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(
              (json) => ({ loc, json }),
              (e) => {
                console.warn(`DeepTip: cannot load ${url}: ${e.message}`);
                return null;
              },
            ),
        );
      }
    }
    for (const r of await Promise.all(jobs)) if (r) this.add(r.loc, r.json); // source order = layer order
  }

  /** Switch language: loads missing files, re-renders open windows in place. */
  async setLocale(locale) {
    this.locale = locale;
    this.ready = this._load();
    await this.ready;
    this.refresh();
  }

  /** Change options at runtime (delay, lockAfter, closeButtons, engine, …). */
  configure(options = {}) {
    const { locale, ...rest } = options;
    const reload = "sources" in rest || "fallback" in rest;
    Object.assign(this.o, rest);
    if (locale && locale !== this.locale) return this.setLocale(locale);
    if (reload) return (this.ready = this._load().then(() => this.refresh()));
    this.refresh();
    return Promise.resolve();
  }

  /** {e: entry, loc} from the first locale of the chain that has the key. */
  entry(key) {
    for (const loc of this.chain) {
      const e = this.data.get(loc)?.get(key);
      if (e) return { e, loc };
    }
    return null;
  }

  has(key) {
    return !!this.entry(key);
  }

  /** UI label (close, pin, hint …): glossary "$ui" first, then the built-ins. */
  t(name) {
    for (const loc of this.chain) {
      const v = this.labels.get(loc)?.[name] ?? UI[loc.split("-")[0]]?.[name];
      if (v != null) return v;
    }
    return UI.en[name] ?? name;
  }

  /** Re-render open windows and indexes (after a language switch or when live values changed). */
  refresh() {
    if (typeof document === "undefined") return;
    for (const w of this.wins) {
      this._fill(w);
      for (const c of w.children) {
        const link = [...w.el.querySelectorAll(".dt-link[data-dt-key]")].find((l) => l.dataset.dtKey === c.key);
        if (link) {
          c.anchor = link;
          link.setAttribute("data-dt-open", "");
        }
      }
    }
    for (const w of this.wins) if (!w.frozen) this._place(w);
    for (const [el, opts] of this.indexes) this._index(el, opts);
  }

  /** Render DeepTip markup (with live [[links]]) into any element of the page. */
  renderText(el, src) {
    el.replaceChildren();
    this._renderInto(el, src, null);
    return el;
  }

  /** Searchable list of every entry with backlinks — the "encyclopedia" (SPEC §2.7). */
  renderIndex(container, { search = true } = {}) {
    this.indexes.set(container, { search });
    this._index(container, { search });
    return container;
  }

  /** Stop re-rendering an index (call when its container leaves the page). */
  removeIndex(container) {
    this.indexes.delete(container);
  }

  destroy() {
    this.closeAll();
    this._disarm();
    this._listen(false);
    cancelAnimationFrame(this.padRAF);
    this.mo?.disconnect();
    this.ro?.disconnect();
  }

  /* ---------------------------------------------------------------- windows */

  /**
   * Open the window for `key` next to `anchor` (a UI element, or a term inside `parent`).
   * Returns the window record; an already open window for the same anchor is reused.
   */
  async open(key, { anchor, parent = null, pinned = false, focus = false, via = "api" } = {}) {
    await this.ready;
    if (!key || !anchor?.isConnected || (parent && !this.wins.includes(parent))) return null;
    const same = this.wins.find((w) => w.anchor === anchor);
    if (same) {
      if (pinned) this.pin(same);
      if (focus) this._focus(same);
      return same;
    }
    // the same term further up this chain: point at it instead of opening it twice
    for (let x = parent; x; x = x.parent) {
      if (x.key === key) {
        this._flash(x);
        if (focus) this._focus(x);
        return x;
      }
    }
    // one preview per level: a new window replaces its unpinned sibling
    for (const w of this.wins.filter((x) => x.parent === parent && !x.pinned)) this.close(w);

    const w = { id: ++seq, key, parent, anchor, via, pinned: false, children: new Set(), closeTimer: 0 };
    w.el = this._build(w);
    (this.o.container ?? document.body).append(w.el);
    this.wins.push(w);
    parent?.children.add(w);
    anchor.setAttribute("data-dt-open", "");
    if (!parent) {
      w.prevAnchorName = anchor.style.getPropertyValue("anchor-name");
      anchor.style.setProperty("anchor-name", `--dt-a${w.id}`);
    }
    try {
      w.el.showPopover();
    } catch {
      w.el.classList.add("dt-no-popover");
    }
    if (pinned) this.pin(w); // before placing: pinned windows hide the hint line, so they are smaller
    else this._state(w);
    this._place(w);
    this.ro?.observe(w.el);
    this._describe(w, true);
    if (focus) this._focus(w);
    this._observe();
    this._refreshHot();
    this.o.onOpen?.(key, w.el);
    return w;
  }

  /** Close a window and everything opened from it. */
  close(w, { focusBack = false } = {}) {
    if (!w || !this.wins.includes(w)) return;
    const hadFocus = this._subtreeHas(w, document.activeElement);
    for (const c of [...w.children]) this.close(c);
    clearTimeout(w.closeTimer);
    if (this.lockWin === w) this._lockTrack(null);
    this.wins.splice(this.wins.indexOf(w), 1);
    w.parent?.children.delete(w);
    this.hot.delete(w);
    this.ro?.unobserve(w.el);
    const a = w.anchor;
    a.removeAttribute("data-dt-open");
    this._describe(w, false);
    const el = w.el;
    try {
      el.hidePopover();
    } catch {
      /* already hidden */
    }
    let gone = false;
    const done = () => {
      if (gone) return;
      gone = true;
      el.remove();
      // release the anchor name only now, so the window does not jump while it fades out
      if (!w.parent && a.style.getPropertyValue("anchor-name") === `--dt-a${w.id}`) {
        if (w.prevAnchorName) a.style.setProperty("anchor-name", w.prevAnchorName);
        else a.style.removeProperty("anchor-name");
      }
    };
    const anims = el.getAnimations?.() ?? [];
    if (anims.length) Promise.allSettled(anims.map((x) => x.finished)).then(done);
    else done();
    setTimeout(done, 600);
    if (focusBack && hadFocus && a.isConnected) a.focus({ preventScroll: true });
    this.o.onClose?.(w.key);
  }

  closeAll() {
    for (const w of this.wins.filter((x) => !x.parent)) this.close(w);
  }

  /** Pin a window — and every window it came from, so a pinned window never hangs off a vanishing one. */
  pin(w) {
    for (let x = w; x && !x.pinned; x = x.parent) {
      x.pinned = true;
      clearTimeout(x.closeTimer);
      x.closeTimer = 0;
      this._state(x);
      this.o.onPin?.(x.key, x.el);
    }
    if (this.lockWin?.pinned) this._lockTrack(null);
  }

  /** Back to a preview: it (and what hangs off it) closes once the pointer is elsewhere. */
  unpin(w) {
    const walk = (x) => {
      x.pinned = false;
      this._state(x);
      x.children.forEach(walk);
    };
    walk(w);
    this._refreshHot();
  }

  _build(w) {
    const el = h("div", "dt-win");
    el.setAttribute("popover", "manual");
    el.tabIndex = -1;
    el.dataset.dtId = String(w.id);
    el.style.setProperty("anchor-name", `--dt-w${w.id}`);
    let depth = 0;
    for (let x = w.parent; x; x = x.parent) depth++;
    el.dataset.dtDepth = String(depth);
    this._fill(w, el);
    return el;
  }

  _fill(w, el = w.el) {
    const found = this.entry(w.key);
    const e = found?.e ?? {};
    if (!found) this._warn(w.key, `DeepTip: no entry "${w.key}"`);
    el.dataset.dtKey = w.key;
    const head = h("div", "dt-head");
    const title = h("span", "dt-title", e.title ?? w.key);
    title.id = `dt-t${w.id}`;
    head.append(title);
    if (found && found.loc !== this.locale) {
      const badge = h("span", "dt-badge", found.loc.toUpperCase());
      badge.title = this.t("fallback");
      head.append(badge);
    }
    if (this.o.pinButton) head.append(this._button("pin", PIN_PATH));
    if (this.o.closeButtons) head.append(this._button("close", CLOSE_PATH));
    const body = h("div", "dt-body");
    body.id = `dt-b${w.id}`;
    this._renderInto(body, e.body ?? e.short ?? this.t("missing"), w.key);
    el.replaceChildren(head, body);
    if (Array.isArray(e.see) && e.see.length) {
      const see = h("div", "dt-see");
      see.append(h("span", "dt-see-label", this.t("seeAlso")), " ");
      e.see.forEach((k, i) => {
        if (i) see.append(", ");
        see.append(this._link(k, null, w.key));
      });
      el.append(see);
    }
    if (this.o.hints) el.append(h("div", "dt-hint", this.t("hint")));
    el.setAttribute("aria-labelledby", title.id);
    el.setAttribute("aria-describedby", body.id);
    if (w.el) this._state(w);
  }

  _button(action, d) {
    const b = h("button", `dt-btn dt-${action}`);
    b.type = "button";
    b.dataset.dtAction = action;
    b.setAttribute("aria-label", this.t(action));
    b.title = this.t(action);
    b.append(icon(d));
    return b;
  }

  _state(w) {
    const el = w.el;
    el.toggleAttribute("data-dt-pinned", w.pinned);
    el.setAttribute("role", w.pinned ? "dialog" : "tooltip");
    if (w.pinned) el.setAttribute("aria-modal", "false");
    else el.removeAttribute("aria-modal");
    const pin = el.querySelector('[data-dt-action="pin"]');
    if (pin) {
      const label = this.t(w.pinned ? "unpin" : "pin");
      pin.setAttribute("aria-pressed", String(w.pinned));
      pin.setAttribute("aria-label", label);
      pin.title = label;
    }
  }

  _renderInto(parent, src, selfKey) {
    for (const b of parseText(src)) {
      if (b.type === "ul") {
        const ul = h("ul");
        for (const it of b.items) {
          const li = h("li");
          this._inline(li, it, selfKey);
          ul.append(li);
        }
        parent.append(ul);
      } else {
        const p = h("p");
        this._inline(p, b.c, selfKey);
        parent.append(p);
      }
    }
  }

  _inline(parent, nodes, selfKey) {
    for (const n of nodes) {
      if (n.t === "text") parent.append(n.v);
      else if (n.t === "br") parent.append(h("br"));
      else if (n.t === "code") parent.append(h("code", null, n.v));
      else if (n.t === "var") parent.append(h("span", "dt-var", this._var(n.name, selfKey)));
      else if (n.t === "link") parent.append(this._link(n.key, n.text, selfKey));
      else if (n.t === "b" || n.t === "i") {
        const x = h(n.t === "b" ? "strong" : "em");
        this._inline(x, n.c, selfKey);
        parent.append(x);
      }
    }
  }

  _link(key, text, selfKey) {
    const found = this.entry(key);
    const label = text ?? found?.e.title ?? key;
    if (key === selfKey) return h("strong", null, label);
    if (!found) {
      this._warn(key, `DeepTip: link to missing entry "${key}"`);
      const s = h("span", "dt-link dt-missing", label);
      s.title = this.t("missing");
      return s;
    }
    const b = h("button", "dt-link", label);
    b.type = "button";
    b.dataset.dtKey = key;
    return b;
  }

  _var(name, key) {
    const v = this.o.vars;
    let r = typeof v === "function" ? v(name, key) : v?.[name];
    if (typeof r === "function") r = r(key);
    return r == null ? `{${name}}` : String(r);
  }

  _warn(id, msg) {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(msg);
  }

  _winOf(el) {
    if (!el?.dataset?.dtId) return null;
    const id = +el.dataset.dtId;
    return this.wins.find((w) => w.id === id) ?? null;
  }

  _subtreeHas(w, node) {
    if (!node) return false;
    if (w.el.contains(node)) return true;
    for (const c of w.children) if (this._subtreeHas(c, node)) return true;
    return false;
  }

  _describe(w, on) {
    const a = w.anchor;
    const id = `dt-b${w.id}`;
    const ids = (a.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((x) => x && x !== id);
    if (on && !w.parent) ids.push(id);
    if (ids.length) a.setAttribute("aria-describedby", ids.join(" "));
    else a.removeAttribute("aria-describedby");
  }

  /** Keyboard / gamepad focus goes to the first term (the dialog's name is still announced), else the window. */
  _focus(w) {
    const first = w.el.querySelector(".dt-body .dt-link[data-dt-key], .dt-see .dt-link[data-dt-key]");
    (first ?? w.el).focus({ preventScroll: true });
  }

  _flash(w) {
    const el = w.el;
    el.classList.remove("dt-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("dt-flash");
    setTimeout(() => el.classList.remove("dt-flash"), 700);
  }

  /* ---------------------------------------------------------------- placement */

  /** Side order: per element `data-deeptip-place="right,left"` (roots only), else the root / child option. */
  _sides(w) {
    const own = !w.parent && w.anchor.getAttribute?.(`${this.o.attribute}-place`);
    const s = (own ? own.split(/[\s,]+/) : w.parent ? this.o.child : this.o.root).filter((x) => SIDES.includes(x));
    return s.length ? s : ["bottom"];
  }

  _place(w) {
    const el = w.el;
    const sides = this._sides(w);
    for (const p of ["left", "top", "max-width", "max-height"]) el.style.removeProperty(p);
    if (this.css && this.o.engine !== "js") {
      el.dataset.dtEngine = "css";
      el.style.setProperty("position-anchor", w.parent ? `--dt-w${w.parent.id}` : `--dt-a${w.id}`);
      el.style.setProperty("position-area", `${sides[0]} span-all`);
      el.style.setProperty("position-try-fallbacks", sides.slice(1).map((s) => `--dt-${s}`).join(", ") || "none");
      if (this._fits(w)) {
        this._remember(w);
        return;
      }
    }
    this._placeJS(w);
  }

  /** CSS could not keep the window on screen without covering the previous one -> measure it in JS. */
  _fits(w) {
    const r = w.el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const tol = 6; // the enter animation shifts the box by a few pixels
    if (!r.width || r.left < -tol || r.top < -tol || r.right > vw + tol || r.bottom > vh + tol) return false;
    return !w.parent || overlap(r, w.parent.el.getBoundingClientRect()) <= tol;
  }

  _placeJS(w) {
    const el = w.el;
    el.dataset.dtEngine = "js";
    for (const p of ["position-anchor", "position-area", "position-try-fallbacks", "max-width", "max-height"]) {
      el.style.removeProperty(p);
    }
    el.style.left = "0px";
    el.style.top = "0px";
    const gap = parseFloat(getComputedStyle(el).marginTop) || 8;
    const target = w.parent ? w.parent.el : w.anchor;
    const a = target.isConnected ? target.getBoundingClientRect() : w.anchorRect;
    if (!a) return;
    const vp = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    let p = computePlacement({ w: el.offsetWidth, h: el.offsetHeight }, a, this._sides(w), vp, gap);
    if (p.maxW || p.maxH) {
      if (p.maxW) el.style.maxWidth = `${p.maxW}px`;
      if (p.maxH) el.style.maxHeight = `${p.maxH}px`;
      p = { ...p, ...computePlacement({ w: el.offsetWidth, h: el.offsetHeight }, a, [p.side], vp, gap) };
    }
    el.style.left = `${p.x - gap}px`; // the CSS margin is the gap; left/top address the margin box
    el.style.top = `${p.y - gap}px`;
    this._remember(w);
  }

  _remember(w) {
    w.rect = w.el.getBoundingClientRect();
    if (w.anchor.isConnected) w.anchorRect = w.anchor.getBoundingClientRect();
  }

  /** Anchor element vanished (framework re-render): previews close, pinned windows stay where they are. */
  _observe() {
    if (this.mo || typeof MutationObserver === "undefined") return;
    this.mo = new MutationObserver(() => {
      for (const w of [...this.wins]) {
        if (!this.wins.includes(w) || w.anchor.isConnected) continue;
        if (!w.pinned) this.close(w);
        else if (!w.parent && !w.frozen) this._freeze(w);
      }
      if (!this.wins.length) {
        this.mo.disconnect();
        this.mo = null;
      }
    });
    this.mo.observe(document.body, { childList: true, subtree: true });
  }

  _freeze(w) {
    const el = w.el;
    const r = w.rect;
    w.frozen = true;
    el.dataset.dtEngine = "js";
    for (const p of ["position-anchor", "position-area", "position-try-fallbacks"]) el.style.removeProperty(p);
    if (!r) return;
    const m = parseFloat(getComputedStyle(el).marginTop) || 0;
    el.style.left = `${r.left - m}px`;
    el.style.top = `${r.top - m}px`;
  }

  /** Re-place JS-placed windows (scroll, size change); CSS-anchored ones follow on their own. */
  _reflow(recheck = false) {
    this.recheck ||= recheck;
    if (this.raf || !this.wins.length) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const recheck = this.recheck;
      this.recheck = false;
      for (const w of this.wins) {
        if (w.frozen) continue;
        if (w.el.dataset.dtEngine === "js") this._placeJS(w);
        else if (recheck && !this._fits(w)) this._placeJS(w); // grew and no longer fits
      }
    });
  }

  _resized() {
    if (this.rafResize || !this.wins.length) return;
    this.rafResize = requestAnimationFrame(() => {
      this.rafResize = 0;
      for (const w of this.wins) if (!w.frozen) this._place(w);
    });
  }

  /* ---------------------------------------------------------------- input: wiring */

  _listen(on) {
    const f = on ? "addEventListener" : "removeEventListener";
    const d = document;
    const h = (this._h ??= {
      over: (e) => this._over(e),
      out: (e) => this._out(e),
      move: (e) => this._move(e),
      down: (e) => this._down(e),
      up: (e) => this._up(e),
      click: (e) => this._click(e),
      menu: (e) => this._menu(e),
      key: (e) => this._key(e),
      anim: (e) => this._anim(e),
      scroll: () => this._reflow(),
      resize: () => this._resized(),
      pad: () => this._padStart(),
    });
    d[f]("pointerover", h.over, true);
    d[f]("pointerout", h.out, true);
    d[f]("pointermove", h.move, { capture: true, passive: true });
    d[f]("pointerdown", h.down, true);
    d[f]("pointerup", h.up, true);
    d[f]("pointercancel", h.up, true);
    d[f]("click", h.click, true);
    d[f]("contextmenu", h.menu, true);
    d[f]("keydown", h.key, true);
    d[f]("animationend", h.anim, true);
    d[f]("scroll", h.scroll, { capture: true, passive: true });
    window[f]("resize", h.resize);
    window[f]("gamepadconnected", h.pad);
  }

  /* ---------------------------------------------------------------- input: mouse & pen (hover) */

  _over(e) {
    if (e.pointerType === "touch") return;
    const t = e.target instanceof Element ? e.target : null;
    const winEl = t?.closest(".dt-win") ?? null;
    const win = this._winOf(winEl);
    const link = t?.closest(".dt-link[data-dt-key]") ?? null;
    const trig = !winEl && !link ? (t?.closest(this.o.selector) ?? null) : null;
    this.hover = { win, link, trig };
    if (this.quiet && this.quiet !== trig) this.quiet = null;
    this._refreshHot();
    this._lockTrack(win && !win.pinned ? win : null);
    if (link && (!winEl || win)) this._arm(link, "link", win);
    else if (trig) this._arm(trig, "trig", null);
    else this._disarm();
  }

  _out(e) {
    if (e.pointerType === "touch" || e.relatedTarget) return;
    this.hover = {}; // left the page
    this._disarm();
    this._lockTrack(null);
    this._refreshHot();
  }

  _move(e) {
    const p = this.press;
    if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOL) this._pressEnd();
    if (e.pointerType === "touch") return;
    const now = performance.now();
    this.samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (this.samples.length > 2 && now - this.samples[0].t > 120) this.samples.shift();
  }

  _refreshHot() {
    const hot = new Set();
    const { win, link, trig } = this.hover;
    for (let x = win; x; x = x.parent) hot.add(x);
    const a = link ?? trig;
    if (a) for (const w of this.wins) if (w.anchor === a) for (let x = w; x; x = x.parent) hot.add(x);
    this.hot = hot;
    for (const w of this.wins) {
      if (w.pinned) continue;
      if (hot.has(w)) {
        clearTimeout(w.closeTimer);
        w.closeTimer = 0;
      } else this._leave(w);
    }
  }

  _leave(w) {
    if (w.closeTimer) return;
    const since = performance.now();
    const tick = () => {
      w.closeTimer = 0;
      if (w.pinned || !this.wins.includes(w) || this.hot.has(w)) return;
      if (performance.now() - since < TENDENCY_MAX && this._heading(w)) {
        w.closeTimer = setTimeout(tick, 90);
        return;
      }
      this.close(w);
    };
    w.closeTimer = setTimeout(tick, this.o.closeDelay);
  }

  /** Mouse tendency (EU5): is the pointer currently moving towards this window? */
  _heading(w) {
    const s = this.samples;
    const now = performance.now();
    if (s.length < 2 || now - s[s.length - 1].t > 80) return false;
    const a = s[0];
    const b = s[s.length - 1];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    if (Math.hypot(vx, vy) < 3) return false;
    const r = w.el.getBoundingClientRect();
    const pad = 12;
    let t0 = 0;
    let t1 = Infinity;
    for (const [p, v, lo, hi] of [
      [b.x, vx, r.left - pad, r.right + pad],
      [b.y, vy, r.top - pad, r.bottom + pad],
    ]) {
      if (Math.abs(v) < 1e-9) {
        if (p < lo || p > hi) return false;
        continue;
      }
      let ta = (lo - p) / v;
      let tb = (hi - p) / v;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }

  /** On the way into a preview, terms crossed on the way must not replace it (the Victoria 3 problem). */
  _headingAway(parent) {
    return this.wins.some((w) => {
      if (w.pinned) return false;
      for (let x = parent; x; x = x.parent) if (x === w) return false;
      return this._heading(w);
    });
  }

  _arm(el, kind, parent) {
    if (this.pending?.el === el) return;
    this._disarm();
    if (this.quiet === el) return; // clicked or typed into: no explanation until the pointer leaves it
    if (this.wins.some((w) => w.anchor === el)) return;
    const key = kind === "link" ? el.dataset.dtKey : el.getAttribute(this.o.attribute);
    if (!key) return;
    const own = kind === "trig" ? el.getAttribute(`${this.o.attribute}-delay`) : null;
    const delay = kind === "link" ? this.o.linkDelay : own != null && own !== "" && !isNaN(+own) ? +own : this.o.delay;
    const since = performance.now();
    const fire = () => {
      if (this.pending?.el !== el) return;
      if (performance.now() - since < delay + TENDENCY_MAX && this._headingAway(parent)) {
        this.pending.timer = setTimeout(fire, 90);
        return;
      }
      this._disarm();
      this.open(key, { anchor: el, parent, via: "hover" });
    };
    this.pending = { el, timer: setTimeout(fire, Math.max(0, delay)) };
    if (kind === "trig") {
      el.style.setProperty("--dt-delay", `${delay}ms`);
      el.setAttribute("data-dt-arming", "");
    }
  }

  /** A click on / typing into a UI element cancels its pending window until the pointer leaves it. */
  _hush(trig) {
    if (!trig) return;
    this.quiet = trig;
    if (this.pending?.el === trig) this._disarm();
  }

  _disarm() {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    p.el.removeAttribute("data-dt-arming");
    p.el.style.removeProperty("--dt-delay");
  }

  /** Timer lock: the CSS bar animation (--dt-lock) is the timer; its animationend pins the window. */
  _lockTrack(win) {
    if (!(this.o.lockAfter > 0)) win = null;
    if (this.lockWin === win) return;
    this.lockWin?.el.removeAttribute("data-dt-locking");
    this.lockWin = win;
    if (win) {
      win.el.style.setProperty("--dt-lock", `${this.o.lockAfter}ms`);
      win.el.setAttribute("data-dt-locking", "");
    }
  }

  _anim(e) {
    if (e.animationName !== "dt-lock") return;
    const w = this._winOf(e.target);
    if (w && w === this.lockWin) {
      this._lockTrack(null);
      this.pin(w);
    }
  }

  /* ---------------------------------------------------------------- input: clicks & touch */

  _down(e) {
    this.lastPointer = e.pointerType;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const winEl = t.closest(".dt-win");
    if (!winEl && e.pointerType !== "touch") this._hush(t.closest(this.o.selector)); // using it, not asking
    if (!winEl) {
      const mode = this.o.outsideClickCloses;
      if (this.wins.length && (mode === "always" || (mode === "touch" && e.pointerType === "touch"))) this.closeAll();
      if (e.pointerType === "touch" && !t.closest(".dt-link")) {
        const trig = t.closest(this.o.selector);
        if (trig) this._pressStart(trig, e);
      }
    } else if (e.pointerType === "touch" && t.closest(".dt-head") && !t.closest("button")) {
      this.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  _up(e) {
    if (this.press?.id === e.pointerId) this._pressEnd();
    const s = this.swipe;
    if (s && s.id === e.pointerId) {
      this.swipe = null;
      if (e.type === "pointerup" && e.clientY - s.y > SWIPE && Math.abs(e.clientX - s.x) < SWIPE) this.closeAll();
    }
  }

  _pressStart(trig, e) {
    this._pressEnd();
    const key = trig.getAttribute(this.o.attribute);
    if (!key) return;
    const timer = setTimeout(() => {
      this._pressEnd();
      if (this.o.vibrate) navigator.vibrate?.(15);
      this.swallow = { el: trig, until: performance.now() + 1500 }; // the press must not also "click" the element
      this.open(key, { anchor: trig, pinned: true, via: "touch" });
    }, this.o.longPress);
    this.press = { trig, id: e.pointerId, x: e.clientX, y: e.clientY, timer };
    trig.style.setProperty("--dt-delay", `${this.o.longPress}ms`);
    trig.setAttribute("data-dt-arming", "");
  }

  _pressEnd() {
    const p = this.press;
    if (!p) return;
    clearTimeout(p.timer);
    this.press = null;
    p.trig.removeAttribute("data-dt-arming");
    p.trig.style.removeProperty("--dt-delay");
  }

  _menu(e) {
    const t = e.target instanceof Node ? e.target : null;
    const sw = this.swallow;
    if ((this.press && this.press.trig.contains(t)) || (sw && performance.now() < sw.until && sw.el.contains(t))) {
      e.preventDefault();
    }
  }

  _click(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const sw = this.swallow;
    if (sw) {
      this.swallow = null;
      if (performance.now() < sw.until && sw.el.contains(t)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    const winEl = t.closest(".dt-win");
    const win = this._winOf(winEl);
    if (winEl && !win) return; // a window that is fading out
    const kbd = e.detail === 0; // Enter/Space on a button, or .click() from the gamepad
    const btn = win && t.closest(".dt-btn");
    if (btn) {
      e.preventDefault();
      if (btn.dataset.dtAction === "close") this.close(win, { focusBack: true });
      else if (win.pinned) this.unpin(win);
      else this.pin(win);
      return;
    }
    const link = t.closest(".dt-link[data-dt-key]");
    if (link) {
      e.preventDefault();
      this._follow(link, win, kbd);
      return;
    }
    if (win && this.o.clickInsidePins && !win.pinned) this.pin(win);
  }

  /** Click / Enter / A on a term: its window opens pinned (and so does the chain it hangs off). */
  _follow(link, parent, focus) {
    this._disarm();
    if (parent) this.pin(parent);
    const open = this.wins.find((w) => w.anchor === link);
    if (open) {
      this.pin(open);
      if (focus) this._focus(open);
      return open;
    }
    return this.open(link.dataset.dtKey, { anchor: link, parent, pinned: true, focus, via: "click" });
  }

  _openPinned(trig, via) {
    this._disarm();
    const open = this.wins.find((w) => w.anchor === trig);
    if (open) {
      this.pin(open);
      this._focus(open);
      return open;
    }
    return this.open(trig.getAttribute(this.o.attribute), { anchor: trig, pinned: true, focus: true, via });
  }

  /* ---------------------------------------------------------------- input: keyboard */

  _key(e) {
    const t = e.target instanceof Element ? e.target : null;
    const k = e.key;
    if (k === "Escape") {
      if (!this.wins.length) return;
      const now = performance.now();
      if (e.shiftKey || (e.repeat && now - (this.escAt ?? now) >= HOLD)) this._closeAllFocus();
      else if (!e.repeat) {
        this.escAt = now;
        this.close(this._newest(t), { focusBack: true });
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === "F6" && this.wins.length) {
      e.preventDefault();
      e.stopPropagation();
      this._cycle(e.shiftKey ? -1 : 1);
      return;
    }
    if (!t || !this.o.openKeys.includes(k)) {
      // typing into a field that has an explanation: do not pop it up over the text
      if (t && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) this._hush(t.closest(this.o.selector));
      return;
    }
    if (k === "?" && t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    const link = t.closest(".dt-link[data-dt-key]");
    if (link) {
      e.preventDefault();
      this._follow(link, this._winOf(t.closest(".dt-win")), true);
      return;
    }
    const trig = !t.closest(".dt-win") && t.closest(this.o.selector);
    if (trig) {
      e.preventDefault();
      this._openPinned(trig, "key");
    }
  }

  /** Esc / B closes the newest window opened from the one you are in (or that one itself; or the newest). */
  _newest(fromEl) {
    const here = this._winOf(fromEl?.closest?.(".dt-win"));
    if (!here) return this.wins[this.wins.length - 1];
    const below = (x) => {
      for (let p = x; p; p = p.parent) if (p === here) return true;
      return false;
    };
    return [...this.wins].reverse().find(below) ?? here;
  }

  _closeAllFocus() {
    let root = this.wins.find((w) => w.el.contains(document.activeElement));
    while (root?.parent) root = root.parent;
    this.closeAll();
    if (root?.anchor.isConnected) root.anchor.focus({ preventScroll: true });
  }

  /** F6 / RB: next older window; Shift+F6 / LB: newer. */
  _cycle(step) {
    const list = [...this.wins].reverse();
    if (!list.length) return;
    const i = list.findIndex((w) => w.el.contains(document.activeElement));
    this._focus(i < 0 ? list[0] : list[(i + step + list.length) % list.length]);
  }

  /* ---------------------------------------------------------------- input: gamepad */

  _padStart() {
    if (!this.o.gamepad || this.padRAF || typeof navigator === "undefined" || !navigator.getGamepads) return;
    const loop = () => {
      this.padRAF = this._padTick() ? requestAnimationFrame(loop) : 0;
    };
    this.padRAF = requestAnimationFrame(loop);
  }

  _padTick() {
    const pads = [...navigator.getGamepads()].filter(Boolean);
    if (!pads.length) return false;
    const cur = new Set();
    for (const p of pads) {
      p.buttons.forEach((b, i) => b.pressed && cur.add(i));
      const [x = 0, y = 0] = p.axes;
      if (y < -0.6) cur.add(12);
      if (y > 0.6) cur.add(13);
      if (x < -0.6) cur.add(14);
      if (x > 0.6) cur.add(15);
    }
    const prev = this.padPrev ?? new Set();
    this.padPrev = cur;
    if (!document.hasFocus()) return true;
    const down = (i) => cur.has(i) && !prev.has(i);
    const now = performance.now();
    const act = document.activeElement;
    const inWin = this._winOf(act?.closest?.(".dt-win"));

    // B: tap closes the window you are in (or the newest), hold closes all
    if (down(1)) this.padB = now;
    if (this.padB && cur.has(1) && now - this.padB >= HOLD && this.wins.length) {
      this.padB = 0;
      this._closeAllFocus();
    } else if (this.padB && !cur.has(1)) {
      this.padB = 0;
      if (this.wins.length) this.close(this._newest(act), { focusBack: true });
    }
    // Y: info on the focused element or term
    if (down(3) && act) {
      const link = act.closest?.(".dt-link[data-dt-key]");
      if (link) this._follow(link, inWin, true);
      else if (!inWin) {
        const trig = act.closest?.(this.o.selector);
        if (trig) this._openPinned(trig, "pad");
      }
    }
    // A: activate the focused term / button inside a window
    if (down(0) && inWin && act !== inWin.el && act.matches("button")) act.click();
    // LB / RB: switch windows; d-pad / stick: walk the terms of the current window
    if (down(4)) this._cycle(-1);
    if (down(5)) this._cycle(1);
    if (inWin) {
      for (const [i, step] of [
        [12, -1],
        [14, -1],
        [13, 1],
        [15, 1],
      ]) {
        if (down(i)) this._step(inWin, step);
      }
    }
    return true;
  }

  _step(w, step) {
    const items = [...w.el.querySelectorAll(".dt-link[data-dt-key]"), ...w.el.querySelectorAll(".dt-btn")];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length;
    items[next].focus();
  }

  /* ---------------------------------------------------------------- encyclopedia */

  _index(c, { search }) {
    const prevQuery = c.querySelector(".dt-index-search")?.value ?? "";
    const keys = new Set();
    for (const loc of this.chain) for (const k of this.data.get(loc)?.keys() ?? []) keys.add(k);
    const coll = new Intl.Collator(this.locale, { sensitivity: "base" });
    const rows = [...keys]
      .map((k) => ({ k, e: this.entry(k).e }))
      .sort((a, b) => coll.compare(a.e.title ?? a.k, b.e.title ?? b.k));
    const back = new Map();
    for (const { k, e } of rows) {
      const refs = [...collectRefs(`${e.short ?? ""}\n\n${e.body ?? ""}`).links, ...(Array.isArray(e.see) ? e.see : [])];
      for (const l of refs) {
        if (l === k) continue;
        if (!back.has(l)) back.set(l, new Set());
        back.get(l).add(k);
      }
    }
    c.classList.add("dt-index");
    c.replaceChildren();
    let input = null;
    if (search) {
      input = h("input", "dt-index-search");
      input.type = "search";
      input.placeholder = this.t("search");
      input.setAttribute("aria-label", this.t("search"));
      input.value = prevQuery;
      c.append(input);
    }
    const list = h("ul", "dt-index-list");
    for (const { k, e } of rows) {
      const li = h("li", "dt-index-item");
      li.dataset.dtFind = [e.title, k, ...(Array.isArray(e.aliases) ? e.aliases : []), e.short].join(" ").toLowerCase();
      li.append(this._link(k, null, null));
      if (e.short) li.append(this.renderText(h("div", "dt-index-short"), e.short));
      const b = back.get(k);
      if (b?.size) {
        const d = h("div", "dt-index-back", `${this.t("mentionedIn")}: `);
        [...b].forEach((x, i) => {
          if (i) d.append(", ");
          d.append(this._link(x, null, null));
        });
        li.append(d);
      }
      list.append(li);
    }
    const empty = h("p", "dt-index-empty", this.t("empty"));
    c.append(list, empty);
    const filter = () => {
      const q = (input?.value ?? "").trim().toLowerCase();
      let n = 0;
      for (const li of list.children) {
        const hit = !q || li.dataset.dtFind.includes(q);
        li.hidden = !hit;
        n += hit ? 1 : 0;
      }
      empty.hidden = n > 0;
    };
    input?.addEventListener("input", filter);
    filter();
  }
}

export default DeepTip;
