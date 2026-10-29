// In-page checks of the Bootstrap theme and recipes. Loaded by example/index.html when the URL has ?test.
// Real mouse and keyboard input comes from test/run.mjs (window.deeptipInput); the result is window.deeptipTest.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(40);
  }
  return null;
};
let seq = 0;
const waiting = new Map();
window.__deeptipInputDone = (id) => {
  waiting.get(id)?.();
  waiting.delete(id);
};
const input = (cmd) =>
  new Promise((ok, fail) => {
    if (typeof window.deeptipInput !== "function") return fail(new Error("run these checks with test/run.mjs (real input)"));
    const id = ++seq;
    waiting.set(id, ok);
    window.deeptipInput(JSON.stringify({ id, ...cmd }));
  });
const center = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
const rest = async (el) => {
  const [x, y] = center(el);
  await input({ type: "move", x, y, steps: 5, from: [x + 3, y + 120] });
};
const openWin = (key, extra = "") => document.querySelector(`.dt-win[data-dt-key="${key}"]:popover-open${extra}`);
const park = () => input({ type: "move", x: window.innerWidth / 2, y: window.innerHeight - 30 });
const topIsWindow = (win) => {
  const [x, y] = center(win);
  return !!document.elementFromPoint(x, y)?.closest(".dt-win");
};

const pass = [];
const fail = [];
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === true) pass.push(name);
    else fail.push({ name, detail: JSON.stringify(r) });
  } catch (e) {
    fail.push({ name, detail: String(e?.stack ?? e) });
  }
}

const { dt, trapFix } = window.demo;
await dt.ready;
await sleep(300);
const html = document.documentElement;
const bodyBg = () => getComputedStyle(document.body).backgroundColor;

await check("the theme maps the window to Bootstrap's colours (light)", async () => {
  html.dataset.bsTheme = "light";
  await rest(document.getElementById("realm"));
  const win = await until(() => openWin("demo.realm"), 3000);
  if (!win) return "no window";
  const cs = getComputedStyle(win);
  const ok = cs.backgroundColor === bodyBg() && cs.borderTopLeftRadius === "8px" && cs.fontSize === "14px";
  return ok || { bg: cs.backgroundColor, body: bodyBg(), radius: cs.borderTopLeftRadius, size: cs.fontSize };
});

await check("…and follows data-bs-theme=dark", async () => {
  html.dataset.bsTheme = "dark";
  await sleep(100);
  const win = openWin("demo.realm");
  const cs = getComputedStyle(win);
  const head = getComputedStyle(win.querySelector(".dt-head")).backgroundColor;
  const link = getComputedStyle(win.querySelector(".dt-link")).color;
  const ok = cs.backgroundColor === bodyBg() && bodyBg() === "rgb(33, 37, 41)" && head !== cs.backgroundColor && link !== getComputedStyle(win).color;
  html.dataset.bsTheme = "light";
  return ok || { bg: cs.backgroundColor, body: bodyBg(), head, link };
});

await check("a term in the window: hover previews, click pins", async () => {
  const term = openWin("demo.realm")?.querySelector('.dt-link[data-dt-key="demo.province"]');
  if (!term) return "no term";
  const [x, y] = center(term);
  await input({ type: "move", x, y, steps: 6, from: center(document.getElementById("realm")) });
  const preview = await until(() => openWin("demo.province"), 2000);
  await input({ type: "click", x, y });
  const pinned = await until(() => openWin("demo.province", "[data-dt-pinned]"), 2000);
  dt.closeAll();
  await park();
  return (!!preview && !!pinned) || { preview: !!preview, pinned: !!pinned };
});

await check("a Bootstrap tooltip and DeepTip on different elements", async () => {
  await rest(document.getElementById("bsTip"));
  const tip = await until(() => document.querySelector(".tooltip.show"), 2000);
  await sleep(900);
  const noWindow = !document.querySelector(".dt-win:popover-open");
  await rest(document.getElementById("nobles"));
  const win = await until(() => openWin("demo.nobles"), 3000);
  await sleep(300);
  const tips = [...document.querySelectorAll(".tooltip.show")].map((t) => t.textContent);
  dt.closeAll();
  await park();
  return (!!tip && noWindow && !!win && tips.length === 0) || { tip: !!tip, noWindow, win: !!win, tips };
});

const modal = document.getElementById("realmModal");
const event = (el, type) => new Promise((ok) => el.addEventListener(type, ok, { once: true }));
const openModal = async () => {
  const done = event(modal, "shown.bs.modal"); // after Bootstrap focused the modal itself
  bootstrap.Modal.getOrCreateInstance(modal).show();
  await done;
};
const closeModal = async () => {
  const done = event(modal, "hidden.bs.modal");
  bootstrap.Modal.getOrCreateInstance(modal).hide();
  await done;
};

await check("the modal's focus trap pulls the focus out of a DeepTip window (without the fix)", async () => {
  trapFix.off();
  await openModal();
  const btn = document.getElementById("modalProvince");
  btn.focus();
  await input({ type: "key", key: "F1", vk: 112 });
  await until(() => openWin("demo.province"), 2000);
  await sleep(200);
  const inWindow = !!document.activeElement?.closest(".dt-win");
  const inModal = modal.contains(document.activeElement);
  dt.closeAll();
  await closeModal();
  trapFix.on();
  return (!inWindow && inModal) || { inWindow, inModal, active: document.activeElement?.outerHTML.slice(0, 60) };
});

await check("with the fix (container = the open modal) the focus stays in the DeepTip window", async () => {
  await openModal();
  const btn = document.getElementById("modalProvince");
  btn.focus();
  await input({ type: "key", key: "F1", vk: 112 });
  const win = await until(() => openWin("demo.province"), 2000);
  await sleep(200);
  const inWindow = !!document.activeElement?.closest(".dt-win");
  const insideModal = !!win && modal.contains(win);
  return (inWindow && insideModal) || { inWindow, insideModal, container: String(dt.o.container?.id ?? dt.o.container), active: document.activeElement?.id };
});

await check("the window lies above the modal and its backdrop (top layer)", async () => {
  const win = openWin("demo.province");
  const z = getComputedStyle(document.querySelector(".modal-backdrop")).zIndex;
  return (!!win && topIsWindow(win) && z === "1050") || { win: !!win, top: win && topIsWindow(win), backdropZ: z };
});

await check("Esc closes the DeepTip window first; the modal stays; the next Esc closes the modal", async () => {
  await input({ type: "key", key: "Escape", vk: 27 });
  await sleep(300);
  const windowClosed = !openWin("demo.province");
  const modalOpen = modal.classList.contains("show");
  modal.focus();
  const gone = event(modal, "hidden.bs.modal");
  await input({ type: "key", key: "Escape", vk: 27 });
  const modalClosed = await Promise.race([gone.then(() => true), sleep(3000).then(() => false)]);
  return (windowClosed && modalOpen && !!modalClosed) || { windowClosed, modalOpen, modalClosed: !!modalClosed };
});

await check("alternative: a modal with data-bs-focus=false keeps the focus in the DeepTip window too", async () => {
  trapFix.off();
  const m2 = document.createElement("div");
  m2.className = "modal";
  m2.tabIndex = -1;
  m2.dataset.bsFocus = "false";
  m2.innerHTML = '<div class="modal-dialog"><div class="modal-content"><div class="modal-body"><button class="btn btn-secondary" data-deeptip="demo.revolt" id="m2btn">Revolt</button></div></div></div>';
  document.body.append(m2);
  const inst = new bootstrap.Modal(m2);
  const ready = event(m2, "shown.bs.modal");
  inst.show();
  await ready;
  document.getElementById("m2btn").focus();
  await input({ type: "key", key: "F1", vk: 112 });
  await until(() => openWin("demo.revolt"), 2000);
  await sleep(200);
  const inWindow = !!document.activeElement?.closest(".dt-win");
  dt.closeAll();
  inst.hide();
  await until(() => getComputedStyle(m2).display === "none", 3000);
  inst.dispose();
  m2.remove();
  trapFix.on();
  return inWindow || { active: document.activeElement?.outerHTML.slice(0, 60) };
});

await check("offcanvas: with the fix the focus stays in the DeepTip window, which lies on top", async () => {
  const off = document.getElementById("realmOffcanvas");
  const ready = event(off, "shown.bs.offcanvas");
  bootstrap.Offcanvas.getOrCreateInstance(off).show();
  await ready;
  document.getElementById("offNobles").focus();
  await input({ type: "key", key: "F1", vk: 112 });
  const win = await until(() => openWin("demo.nobles"), 2000);
  await sleep(200);
  const inWindow = !!document.activeElement?.closest(".dt-win");
  const top = !!win && topIsWindow(win);
  dt.closeAll();
  bootstrap.Offcanvas.getOrCreateInstance(off).hide();
  await until(() => !off.classList.contains("show") && !off.classList.contains("hiding"), 3000);
  await sleep(300);
  return (inWindow && top) || { inWindow, top };
});

await check("dropdown: the window of a menu item lies above the menu; a click in it keeps the menu open; closing the menu closes it", async () => {
  const toggle = document.getElementById("menu");
  const [tx, ty] = center(toggle);
  await input({ type: "click", x: tx, y: ty });
  const menu = toggle.nextElementSibling;
  await until(() => menu.classList.contains("show"), 2000);
  const item = document.getElementById("menu-province");
  const [ix, iy] = center(item);
  await input({ type: "move", x: ix, y: iy, steps: 4, from: [tx, ty] });
  const win = await until(() => openWin("demo.province"), 3000);
  if (!win) return "no window";
  const top = topIsWindow(win);
  const term = win.querySelector(".dt-link[data-dt-key]");
  const [wx, wy] = center(term);
  await input({ type: "move", x: wx, y: wy, steps: 6, from: [ix, iy] });
  await input({ type: "click", x: wx, y: wy });
  await sleep(300);
  const stillOpen = menu.classList.contains("show");
  const pinned = !!openWin("demo.province", "[data-dt-pinned]");
  await input({ type: "click", x: window.innerWidth / 2, y: window.innerHeight - 40 }); // elsewhere
  await until(() => !menu.classList.contains("show"), 2000);
  await sleep(200);
  const closedWithMenu = !document.querySelector(".dt-win:popover-open");
  return (top && stillOpen && pinned && closedWithMenu) || { top, stillOpen, pinned, closedWithMenu };
});

await check("Bootstrap Icons on the pin and close buttons (optional class dt-bi)", async () => {
  document.body.classList.add("dt-bi");
  await rest(document.getElementById("realm"));
  const win = await until(() => openWin("demo.realm"), 3000);
  await document.fonts.ready;
  const pin = win && getComputedStyle(win.querySelector(".dt-pin"), "::before");
  const close = win && getComputedStyle(win.querySelector(".dt-close"), "::before");
  const svgHidden = win && getComputedStyle(win.querySelector(".dt-pin svg")).display === "none";
  const font = document.fonts.check('14px "bootstrap-icons"');
  const ok = !!win && pin.content === '""' && close.content === '""' && /bootstrap-icons/.test(pin.fontFamily) && svgHidden && font;
  dt.closeAll();
  document.body.classList.remove("dt-bi");
  await park();
  return ok || { win: !!win, pin: pin?.content, close: close?.content, family: pin?.fontFamily, svgHidden, font };
});

window.deeptipShots = [
  {
    name: "light",
    prepare: async () => {
      dt.closeAll();
      html.dataset.bsTheme = "light";
      document.body.classList.add("dt-bi");
      const w = await dt.open("demo.stability", { anchor: document.getElementById("stab"), pinned: true });
      const term = w.el.querySelector('.dt-link[data-dt-key="demo.unrest"]');
      await dt.open("demo.unrest", { anchor: term, parent: w, pinned: true });
    },
  },
  {
    name: "dark",
    prepare: async () => {
      html.dataset.bsTheme = "dark";
    },
  },
  {
    name: "dark-modal",
    prepare: async () => {
      dt.closeAll();
      await openModal();
      await dt.open("demo.province", { anchor: document.getElementById("modalProvince"), pinned: true });
    },
  },
];
window.deeptipTest = { pass, fail, info: { bootstrap: bootstrap.Tooltip.VERSION, css: dt.css } };
