// Pure-function tests: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText, collectRefs, flattenGlossary, computePlacement } from "../web/deeptip.js";

test("links with and without custom text", () => {
  const [p] = parseText("Frees [[hw.vram]] and [[ai.comfyui|the image server]].");
  assert.deepEqual(p.c, [
    { t: "text", v: "Frees " },
    { t: "link", key: "hw.vram", text: null },
    { t: "text", v: " and " },
    { t: "link", key: "ai.comfyui", text: "the image server" },
    { t: "text", v: "." },
  ]);
});

test("invalid link keys stay text", () => {
  const [p] = parseText("[[not a key]] and [[]]");
  assert.equal(p.c.length, 1);
  assert.equal(p.c[0].v, "[[not a key]] and [[]]");
});

test("bold, italic, nested, code, vars, escapes", () => {
  const [p] = parseText("**bold [[a.b]]** *it **x** ok* `c*d` {vram_free} \\*lit\\* 3 * 4 * 5");
  const kinds = p.c.map((n) => n.t);
  assert.deepEqual(kinds, ["b", "text", "i", "text", "code", "text", "var", "text"]);
  assert.deepEqual(p.c[0].c[1], { t: "link", key: "a.b", text: null });
  assert.equal(p.c[2].c[1].t, "b");
  assert.equal(p.c[4].v, "c*d");
  assert.equal(p.c[6].name, "vram_free");
  assert.equal(p.c[7].v, " *lit* 3 * 4 * 5");
});

test("paragraphs, line breaks and lists", () => {
  const b = parseText("one\ntwo\n\n- a [[x]]\n- b\ntail\n\n\nlast");
  assert.deepEqual(
    b.map((x) => x.type),
    ["p", "ul", "p", "p"],
  );
  assert.equal(b[0].c[1].t, "br");
  assert.equal(b[1].items.length, 2);
  assert.equal(b[1].items[0][1].key, "x");
});

test("collectRefs finds every link and var", () => {
  const r = collectRefs("**[[a]]** - [[b|B]] {v}\n\n- [[c]]");
  assert.deepEqual(r.links, ["a", "b", "c"]);
  assert.deepEqual(r.vars, ["v"]);
});

test("flattenGlossary: flat, nested, meta, problems", () => {
  const { entries, meta, problems } = flattenGlossary({
    $locale: "de",
    $ui: { close: "X" },
    "hw.vram": { title: "VRAM" },
    ai: { lora: { title: "LoRA" }, model: { short: "…" } },
    "bad key!": { title: "?" },
    broken: 5,
  });
  assert.deepEqual([...entries.keys()], ["hw.vram", "ai.lora", "ai.model", "bad key!"]);
  assert.equal(meta.$locale, "de");
  assert.equal(problems.length, 2);
});

const vp = { w: 1000, h: 800 };
const size = { w: 300, h: 200 };

test("placement: first side with room wins", () => {
  const a = { left: 500, right: 800, top: 100, bottom: 400 };
  const p = computePlacement(size, a, ["left", "right", "top", "bottom"], vp);
  assert.equal(p.side, "left");
  assert.equal(p.x, 500 - 8 - 300);
  assert.equal(p.y, 150); // centred on the anchor
  assert.ok(p.fits);
});

test("placement: no room left -> right, never covering the anchor", () => {
  const a = { left: 100, right: 400, top: 100, bottom: 400 };
  const p = computePlacement(size, a, ["left", "right", "top", "bottom"], vp);
  assert.equal(p.side, "right");
  assert.equal(p.x, 408);
});

test("placement: cross axis is pushed back on screen", () => {
  const a = { left: 600, right: 900, top: 700, bottom: 790 };
  const p = computePlacement(size, a, ["left"], vp);
  assert.equal(p.y, 800 - 8 - 200);
});

test("placement: header button -> below, clamped to the right edge", () => {
  const a = { left: 960, right: 990, top: 10, bottom: 40 };
  const p = computePlacement(size, a, ["bottom", "top", "right", "left"], vp);
  assert.equal(p.side, "bottom");
  assert.equal(p.y, 48);
  assert.equal(p.x, 1000 - 8 - 300);
});

test("placement: nothing fits -> most room, shrunk", () => {
  const phone = { w: 375, h: 700 };
  const a = { left: 8, right: 367, top: 150, bottom: 450 };
  const p = computePlacement({ w: 340, h: 260 }, a, ["left", "right", "top", "bottom"], phone);
  assert.equal(p.fits, false);
  assert.equal(p.side, "bottom");
  assert.equal(p.maxH, 700 - 450 - 16);
  assert.equal(p.y, 458);
});
