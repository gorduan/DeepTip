// In-page checks of the Phaser adapter. Loaded by example/index.html when the URL has ?test (Phaser 4; &phaser=3 for 3.90).
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
const frames = (n = 2) => new Promise((r) => {
  const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

let scrolledBySpace = 0;
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

const { game, tips, flags, state } = window.demo;
const dt = tips.dt;
const scene = await until(() => game.scene.getScene("realm")?.hud && game.scene.getScene("realm"), 8000);
await dt.ready;
await frames(5);

const rec = (target) => tips.records.get(target);
const centerOf = (target) => {
  const r = rec(target).rect;
  return [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
};
const openWin = (key, extra = "") => document.querySelector(`.dt-win[data-dt-key="${key}"]:popover-open${extra}`);
const park = async () => input({ type: "move", x: 3, y: 3 }); // outside the canvas, on the page header
const closeAll = async () => {
  dt.closeAll();
  await park();
  await until(() => !document.querySelector(".dt-win:popover-open"), 1500);
};
const rest = async (target) => {
  const [x, y] = centerOf(target);
  await input({ type: "move", x, y, steps: 6, from: [x + 2, y + 60] });
};
/** Client point -> world point through Phaser's own camera (independent of the adapter's math). */
const toWorld = (cx, cy, cam) => {
  const box = game.canvas.getBoundingClientRect();
  const gx = ((cx - box.left) * game.scale.width) / box.width;
  const gy = ((cy - box.top) * game.scale.height) / box.height;
  return cam.getWorldPoint(gx, gy);
};

await check("anchors lie over their objects (Phaser's own camera maps them back)", async () => {
  const cam = scene.cameras.main;
  const bad = [];
  for (const p of scene.provinces) {
    const [cx, cy] = centerOf(p);
    const w = toWorld(cx, cy, cam);
    if (!p.getBounds().contains(w.x, w.y)) bad.push(["province", w.x, w.y]);
  }
  const [hx, hy] = centerOf(scene.hud.stability);
  const box = game.canvas.getBoundingClientRect();
  const gx = ((hx - box.left) * game.scale.width) / box.width;
  const gy = ((hy - box.top) * game.scale.height) / box.height;
  if (Math.abs(gx - 210) > 1.5 || Math.abs(gy - 26) > 1.5) bad.push(["hud", gx, gy]);
  return bad.length === 0 || bad;
});

await check("…also with a scrolled and zoomed camera", async () => {
  const cam = scene.cameras.main;
  cam.setZoom(1.5).setScroll(300, 200);
  await frames(3);
  const bad = [];
  for (const p of scene.provinces) {
    if (!rec(p).attached) continue;
    const [cx, cy] = centerOf(p);
    const w = toWorld(cx, cy, cam);
    if (!p.getBounds().contains(w.x, w.y)) bad.push([w.x, w.y]);
  }
  const attached = scene.provinces.filter((p) => rec(p).attached).length;
  cam.setZoom(1).setScroll(0, 0);
  await frames(3);
  return (bad.length === 0 && attached >= 1) || { bad, attached };
});

await check("objects outside the camera lose their anchor, and get it back", async () => {
  const cam = scene.cameras.main;
  const last = scene.provinces[3];
  cam.setScroll(0, 0);
  await frames(2);
  const before = rec(last).attached;
  cam.setScroll(640, 360);
  await frames(2);
  const first = scene.provinces[0];
  const away = !rec(first).attached || rec(first).rect.right - rec(first).rect.left < 50;
  cam.setScroll(0, 0);
  await frames(2);
  return (rec(first).attached && away && before) || { before, away, again: rec(first).attached };
});

await check("rest on a bar button opens its window; Phaser still sees the hover", async () => {
  const hovered = flags.hoverStab;
  await rest(scene.hud.stability);
  const win = await until(() => openWin("demo.stability"), 3000);
  return (!!win && flags.hoverStab > hovered && document.querySelectorAll('.dt-win[data-dt-key="demo.stability"]').length === 1) || { win: !!win, hover: flags.hoverStab - hovered };
});

await check("a click reaches the game object and the scene (pointerdown, not outside); refresh shows the new value", async () => {
  const down = flags.downStab;
  const sceneDown = flags.sceneDown;
  const outside = flags.sceneDownOutside;
  const [x, y] = centerOf(scene.hud.stability);
  await input({ type: "click", x, y });
  const value = await until(() => openWin("demo.stability")?.querySelector(".dt-var")?.textContent === "+2", 2000);
  return (flags.downStab === down + 1 && flags.sceneDown === sceneDown + 1 && flags.sceneDownOutside === outside && !!value) || {
    down: flags.downStab - down,
    sceneDown: flags.sceneDown - sceneDown,
    outside: flags.sceneDownOutside - outside,
    value: openWin("demo.stability")?.querySelector(".dt-var")?.textContent,
  };
});

await check("a term inside the window: hover previews, click pins", async () => {
  const term = openWin("demo.stability")?.querySelector('.dt-link[data-dt-key="demo.unrest"]');
  if (!term) return "no term";
  const r = term.getBoundingClientRect();
  const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
  await input({ type: "move", x, y, steps: 8, from: centerOf(scene.hud.stability) });
  const preview = await until(() => openWin("demo.unrest"), 2000);
  await input({ type: "click", x, y });
  const pinned = await until(() => openWin("demo.unrest", "[data-dt-pinned]"), 2000);
  return (!!preview && !!pinned) || { preview: !!preview, pinned: !!pinned };
});

await check("presses inside a DeepTip window do not reach the game", async () => {
  const win = openWin("demo.unrest");
  const r = win.getBoundingClientRect();
  const sceneDown = flags.sceneDown;
  const outside = flags.sceneDownOutside;
  const prov = flags.provinceDown;
  await input({ type: "click", x: r.left + r.width / 2, y: r.bottom - 12 });
  await sleep(150);
  return (flags.sceneDown === sceneDown && flags.sceneDownOutside === outside && flags.provinceDown === prov) || {
    sceneDown: flags.sceneDown - sceneDown,
    outside: flags.sceneDownOutside - outside,
    province: flags.provinceDown - prov,
  };
});
await closeAll();

await check("a click on an object before its delay mutes it until the pointer leaves", async () => {
  const [x, y] = centerOf(scene.hud.taxes);
  await input({ type: "move", x, y, steps: 4, from: [x, y + 80] });
  await input({ type: "click", x, y });
  await sleep(1000);
  const muted = !openWin("demo.taxes");
  await park();
  await rest(scene.hud.taxes);
  const later = await until(() => openWin("demo.taxes"), 2500);
  await closeAll();
  return (muted && !!later) || { muted, later: !!later };
});

await check("a term drawn by Phaser: hover previews after linkDelay, click pins", async () => {
  const t = scene.terms[1];
  const [x, y] = centerOf(t);
  await input({ type: "move", x, y, steps: 4, from: [x, y - 40] });
  const preview = await until(() => openWin("demo.unrest"), 1500);
  await input({ type: "click", x, y });
  const pinned = await until(() => openWin("demo.unrest", "[data-dt-pinned]"), 1500);
  const marked = rec(t).anchor.hasAttribute("data-dt-open");
  await closeAll();
  return (!!preview && !!pinned && marked) || { preview: !!preview, pinned: !!pinned, marked };
});

await check("F1 explains the object under the pointer, focus moves in; keys then stay out of the game", async () => {
  await rest(scene.hud.realm);
  await until(() => openWin("demo.realm"), 3000);
  await input({ type: "key", key: "F1", vk: 112 });
  const pinned = await until(() => openWin("demo.realm", "[data-dt-pinned]"), 1500);
  const focus = await until(() => tips.hasFocus(), 1000);
  const onTerm = document.activeElement?.matches(".dt-link[data-dt-key]");
  const space = flags.space;
  const esc = flags.esc;
  await input({ type: "key", key: " ", code: "Space", vk: 32 }); // activates the focused term: its window opens
  await sleep(150);
  await input({ type: "key", key: "Escape", vk: 27, shift: true }); // closes all
  await sleep(250);
  const closed = !document.querySelector(".dt-win:popover-open");
  scrolledBySpace = window.scrollY; // Space on a focused window keeps its browser meaning: it may scroll the page
  window.scrollTo(0, 0);
  await closeAll();
  return (!!pinned && !!focus && onTerm && flags.space === space && flags.esc === esc && closed) || { pinned: !!pinned, focus: !!focus, onTerm, space: flags.space - space, esc: flags.esc - esc, closed };
});

await check("an object that moves under a resting pointer opens its window", async () => {
  scene.rebelTween.pause();
  scene.rebel.setPosition(700, 470);
  await frames(2);
  const [x, y] = centerOf(scene.rebel);
  await input({ type: "move", x: x + 120, y, steps: 2, from: [x + 120, y + 30] }); // next to it
  await sleep(200);
  scene.rebel.setPosition(820, 470); // now under the pointer
  const win = await until(() => openWin("demo.revolt"), 3000);
  await closeAll();
  scene.rebelTween.resume();
  return !!win || "no window";
});

await check("a pinned window follows its moving object", async () => {
  const w = await tips.open(scene.rebel);
  await frames(2);
  const a = w.el.getBoundingClientRect();
  const ra = { ...rec(scene.rebel).rect };
  await sleep(700);
  await frames(2);
  const b = w.el.getBoundingClientRect();
  const rb = rec(scene.rebel).rect;
  const objMoved = Math.abs(rb.left - ra.left);
  const winMoved = Math.abs(b.left - a.left);
  await closeAll();
  return (objMoved > 10 && Math.abs(winMoved - objMoved) < 6) || { objMoved, winMoved, engine: w.el.dataset.dtEngine };
});

await check("deeptip:open and deeptip:close are emitted on the game object", async () => {
  const seen = [];
  const r = scene.provinces[1];
  r.once("deeptip:open", (key) => seen.push(`open ${key}`));
  r.once("deeptip:close", (key) => seen.push(`close ${key}`));
  await tips.open(r);
  tips.close(r);
  await sleep(50);
  return seen.join(" | ") === "open demo.province | close demo.province" || seen;
});

await check("hidden and destroyed objects lose their anchor; an open preview closes", async () => {
  const s = scene.add.rectangle(480, 300, 60, 60, 0xffffff).setScrollFactor(0).setDepth(20);
  tips.explain(s, "demo.nobles", { delay: 0 });
  await frames(2);
  await rest(s);
  const opened = await until(() => openWin("demo.nobles"), 1500);
  s.setVisible(false);
  const closedHidden = await until(() => !openWin("demo.nobles"), 1500);
  const detached = !rec(s).anchor.isConnected;
  s.setVisible(true);
  await frames(2);
  const back = rec(s).anchor.isConnected;
  s.destroy();
  await frames(1);
  const forgotten = !tips.records.has(s);
  await park();
  return (!!opened && !!closedHidden && detached && back && forgotten) || { opened: !!opened, closedHidden: !!closedHidden, detached, back, forgotten };
});

await check("terms in a DOM element over the canvas (renderText)", async () => {
  const term = document.querySelector('#intro .dt-link[data-dt-key="demo.unrest"]');
  if (!term) return "no term";
  const r = term.getBoundingClientRect();
  await input({ type: "move", x: r.left + r.width / 2, y: r.top + r.height / 2, steps: 4, from: [r.left, r.top - 30] });
  const win = await until(() => openWin("demo.unrest"), 1500);
  await closeAll();
  return !!win || "no window";
});

await check("setLocale: windows, encyclopedia and the game's texts in German", async () => {
  const select = document.getElementById("lang");
  select.value = "de";
  select.dispatchEvent(new Event("change"));
  await until(() => dt.locale === "de" && scene.hud.realm.label.text === "Reich", 4000);
  await tips.open(scene.hud.stability);
  const title = openWin("demo.stability")?.querySelector(".dt-title")?.textContent;
  const index = [...document.querySelectorAll("#index .dt-index-item > .dt-link")].some((b) => b.textContent === "Stabilität");
  const intro = /Provinz/.test(document.getElementById("intro").textContent);
  const termDe = scene.terms[0].text;
  await closeAll();
  select.value = "en";
  select.dispatchEvent(new Event("change"));
  await until(() => dt.locale === "en" && scene.hud.realm.label.text === "Realm", 4000);
  return (title === "Stabilität" && index && intro && termDe === "Stabilität") || { title, index, intro, termDe };
});

window.deeptipShots = [
  {
    name: "window-over-canvas",
    prepare: async () => {
      scene.rebelTween.pause();
      await tips.open(scene.hud.stability);
      await tips.open(scene.rebel);
    },
  },
];
window.deeptipTest = { pass, fail, info: { scrolledBySpace, phaser: window.Phaser.VERSION, renderer: game.renderer.type === 2 ? "WebGL" : "Canvas", css: dt.css, state } };
