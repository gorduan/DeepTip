// In-page checks of the jQuery plugin. Loaded by example/index.html and test/jquery4.html when the URL has ?test.
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
  await input({ type: "move", x, y, steps: 5, from: [x + 3, y + 140] });
};
const openWin = (key, extra = "") => document.querySelector(`.dt-win[data-dt-key="${key}"]:popover-open${extra}`);
const closeAll = async () => {
  await input({ type: "key", key: "Escape", vk: 27, shift: true });
  await until(() => !document.querySelector(".dt-win:popover-open"), 1500);
  await input({ type: "move", x: 2, y: window.innerHeight - 2 });
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

const $ = window.jQuery;
const jq4 = window.jq4; // test/jquery4.html: a second jQuery, given back by noConflict(true)
const dt = $.deeptip.instance;
await dt.ready;
await sleep(300);

await check("$.deeptip.init returns the one controller; a second call configures it", () => {
  const again = $.deeptip.init({ linkDelay: 90 });
  const ok = again === dt && dt.o.linkDelay === 90;
  $.deeptip.init({ linkDelay: 80 });
  return ok || { same: again === dt, linkDelay: dt.o.linkDelay };
});

await check("$(el).deeptip(key, { delay }) writes the attributes, $(el).deeptip() reads the key", () => {
  const help = $("#help");
  return (help.attr("data-deeptip") === "deeptip.about" && help.attr("data-deeptip-delay") === "0" && $("#realm").deeptip() === "demo.realm") || {
    key: help.attr("data-deeptip"),
    delay: help.attr("data-deeptip-delay"),
    realm: $("#realm").deeptip(),
  };
});

await check("rest opens the window; deeptip:open on the anchor with key and window element", async () => {
  const got = [];
  $("#stab").one("deeptip:open", (e, key, el) => got.push([key, el?.classList.contains("dt-win"), e.target.id]));
  await rest($("#stab")[0]);
  const win = await until(() => openWin("demo.stability"), 3000);
  return (win && got.length === 1 && got[0][0] === "demo.stability" && got[0][1] && got[0][2] === "stab" && $("#stab").is("[data-dt-open]")) || { win: !!win, got };
});

if (document.getElementById("tax")) {
  await check("the element's own click still runs; refresh() shows the new live value", async () => {
    const [x, y] = center($("#stab")[0]);
    await input({ type: "click", x, y });
    const v = await until(() => openWin("demo.stability")?.querySelector(".dt-var")?.textContent === "+2", 2000);
    return (!!v && /\+2/.test($("#stab").text())) || { value: openWin("demo.stability")?.querySelector(".dt-var")?.textContent, button: $("#stab").text() };
  });
}

await check("hover and click on a term: open, then pin of the parent's anchor and of the term", async () => {
  const events = [];
  $(document).on("deeptip:open.t deeptip:pin.t", (e, key) => events.push(`${e.type.slice(8)} ${key}`));
  const term = openWin("demo.stability")?.querySelector('.dt-link[data-dt-key="demo.unrest"]');
  if (!term) return "no term";
  const [x, y] = center(term);
  await input({ type: "move", x, y, steps: 8, from: center($("#stab")[0]) });
  await until(() => openWin("demo.unrest"), 2000);
  await input({ type: "click", x, y });
  await until(() => openWin("demo.unrest", "[data-dt-pinned]"), 2000);
  $(document).off(".t");
  return events.join(" | ") === "open demo.unrest | pin demo.stability | pin demo.unrest" || events;
});

await check("Esc closes the newest window: deeptip:close on its anchor", async () => {
  const closed = [];
  $(document).on("deeptip:close.t", (e, key) => closed.push(`${key} ${e.target.className || e.target.id}`));
  await input({ type: "key", key: "Escape", vk: 27 });
  await sleep(250);
  $(document).off(".t");
  return (closed.length === 1 && closed[0].startsWith("demo.unrest dt-link")) || closed;
});

await check("Shift+Esc closes the rest", async () => {
  const closed = [];
  $(document).on("deeptip:close.t", (e, key) => closed.push(key));
  await input({ type: "key", key: "Escape", vk: 27, shift: true });
  await sleep(250);
  $(document).off(".t");
  return (closed.join() === "demo.stability" && !document.querySelector(".dt-win:popover-open")) || closed;
});

await check('$(el).deeptip("open") opens pinned (events: open, then pin); "close" closes it', async () => {
  const order = [];
  $("#gold").on("deeptip:open.t deeptip:pin.t deeptip:close.t", (e) => order.push(e.type.slice(8)));
  $("#gold").deeptip("open");
  const pinned = await until(() => openWin("demo.gold", "[data-dt-pinned]"), 2000);
  $("#gold").deeptip("close");
  await sleep(200);
  $("#gold").off(".t");
  return (!!pinned && !openWin("demo.gold") && order.join() === "open,pin,close") || { pinned: !!pinned, order };
});

if (document.getElementById("add")) {
  await check("an element inserted later opens by delegation", async () => {
    const [x, y] = center($("#add")[0]);
    await input({ type: "click", x, y });
    const added = await until(() => document.querySelector("#later [data-deeptip]"), 2000);
    if (!added) return "not added";
    await rest(added);
    return !!(await until(() => openWin("demo.nobles"), 3000)) || "no window";
  });
  await closeAll();
}

if (document.getElementById("intro")) {
  await check('"text" renders after ready; $.deeptip.setLocale renders it again', async () => {
    const en = $("#intro .dt-link").map((_, b) => b.textContent).get().join(", ");
    $("#lang").val("de").trigger("change");
    const de = await until(() => /Stabilität/.test($("#intro").text()) && $("#intro .dt-link").map((_, b) => b.textContent).get().join(", "), 4000);
    const index = $("#index .dt-index-item").length;
    $("#lang").val("en").trigger("change");
    await until(() => /Stability/.test($("#intro").text()), 4000);
    return (en === "Stability, Unrest, Revolt, Stability" && de === "Stabilität, Unruhe, Aufstand, Stabilität" && index > 20) || { en, de, index };
  });
}

if (document.getElementById("classic")) {
  await check("a jQuery UI tooltip and DeepTip on different elements", async () => {
    await rest($("#classic")[0]);
    const ui = await until(() => $(".ui-tooltip:visible").length, 2500);
    const noDeepTip = !document.querySelector(".dt-win:popover-open");
    await rest($("#realm")[0]);
    const win = await until(() => openWin("demo.realm"), 3000);
    await sleep(500);
    const uiTexts = $(".ui-tooltip:visible").map((_, t) => $(t).text()).get();
    return (!!ui && noDeepTip && !!win && uiTexts.every((t) => !/Realm|Reich/.test(t))) || { ui, noDeepTip, win: !!win, uiTexts };
  });
  await closeAll();
}

await check("glossaries through $.getJSON and add()", async () => {
  const base = new URL("../../../glossary/", document.baseURI).href;
  const [core, project] = await Promise.all([$.getJSON(`${base}core/de.json`), $.getJSON(`${base}example/de.json`)]);
  dt.add("x-test", core).add("x-test", project);
  const map = dt.data.get("x-test");
  return (map?.get("demo.realm")?.title === "Reich" && map.has("deeptip.about")) || { size: map?.size };
});

await check('"remove" takes the explanation away', async () => {
  $("#nobles").deeptip("remove");
  await rest($("#nobles")[0]);
  await sleep(1400);
  const ok = !document.querySelector(".dt-win:popover-open") && !$("#nobles").is("[data-deeptip]");
  $("#nobles").deeptip("demo.nobles");
  return ok || { open: document.querySelectorAll(".dt-win:popover-open").length };
});

if (jq4) {
  await check("noConflict: install(jq4) shares the controller, events reach handlers of both copies", async () => {
    const seen = [];
    $("#realm").one("deeptip:open", () => seen.push(`$ ${$.fn.jquery}`));
    jq4("#realm").one("deeptip:open", () => seen.push(`jq4 ${jq4.fn.jquery}`));
    jq4("#realm").deeptip("open");
    await until(() => openWin("demo.realm"), 2000);
    jq4("#realm").deeptip("close");
    return (jq4.deeptip.instance === $.deeptip.instance && seen.length === 2 && seen.some((s) => s.startsWith("jq4 4.")) && seen.some((s) => s.startsWith("$ 3."))) || seen;
  });
}

window.deeptipTest = { pass, fail, info: { jquery: $.fn.jquery, jq4: jq4?.fn.jquery ?? null, css: dt.css } };
