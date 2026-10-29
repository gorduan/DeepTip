// Writes the shared parity cases in test/cases/*.json from the reference implementation (frameworks/web/deeptip.js).
// Every runtime's tests load these files and must produce the same results: same markup AST, same placement,
// same glossary flattening. Run after changing the reference: npm run cases
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseText, flattenGlossary, computePlacement } from "../frameworks/web/deeptip.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "cases");
mkdirSync(dir, { recursive: true });
const write = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n");

const markup = [
  ["links with and without custom text", "Frees [[hw.vram]] and [[ai.comfyui|the image server]]."],
  ["invalid link keys stay text", "[[not a key]] and [[]]"],
  ["bold, italic, nested, code, vars, escapes", "**bold [[a.b]]** *it **x** ok* `c*d` {vram_free} \\*lit\\* 3 * 4 * 5"],
  ["paragraphs, line breaks and lists", "one\ntwo\n\n- a [[x]]\n- b\ntail\n\n\nlast"],
  ["empty custom text means the title", "[[a.b|]] and [[a.b| ]]"],
  ["escaped brackets are text", "\\[[x]] and \\[\\[y\\]\\]"],
  ["unclosed marks stay text", "**open and *half and `tick"],
  ["star with spaces is text", "a * b * c and 2*3*4"],
  ["vars: valid and invalid names", "{v1} {_x} {9no} {not-var} {}"],
  ["bullet with the dot sign", "• first\n• second [[k.y|Y]]"],
  ["windows line endings", "a\r\nb\r\n\r\n- c"],
  ["code keeps markup characters", "`[[x]] **y** {z}` after"],
  ["link inside italic inside bold", "**a *b [[c.d]] e* f**"],
  ["blank lines with spaces separate paragraphs", "p1\n  \t \np2"],
];
write("markup.json", {
  $comment: "Parity cases for SPEC §2.4 (parseText). blocks: {type:'p',c:[inline]} | {type:'ul',items:[[inline]]}; inline: {t:'text',v} {t:'br'} {t:'b',c} {t:'i',c} {t:'code',v} {t:'link',key,text} {t:'var',name}.",
  cases: markup.map(([name, src]) => ({ name, src, blocks: parseText(src) })),
});

const vp = { w: 1000, h: 800 };
const size = { w: 300, h: 200 };
const placement = [
  ["first side with room wins", size, { left: 500, right: 800, top: 100, bottom: 400 }, ["left", "right", "top", "bottom"], vp],
  ["no room left -> right, never covering the anchor", size, { left: 100, right: 400, top: 100, bottom: 400 }, ["left", "right", "top", "bottom"], vp],
  ["cross axis is pushed back on screen", size, { left: 600, right: 900, top: 700, bottom: 790 }, ["left"], vp],
  ["header button -> below, clamped to the right edge", size, { left: 960, right: 990, top: 10, bottom: 40 }, ["bottom", "top", "right", "left"], vp],
  ["nothing fits -> most room, shrunk", { w: 340, h: 260 }, { left: 8, right: 367, top: 150, bottom: 450 }, ["left", "right", "top", "bottom"], { w: 375, h: 700 }],
  ["top side", size, { left: 400, right: 500, top: 500, bottom: 540 }, ["top", "bottom"], vp],
  ["nothing fits horizontally -> shrunk width", { w: 600, h: 100 }, { left: 300, right: 700, top: 300, bottom: 340 }, ["left", "right"], vp],
  ["unknown sides fall back to bottom", size, { left: 100, right: 200, top: 100, bottom: 140 }, ["middle"], vp],
];
write("placement.json", {
  $comment: "Parity cases for SPEC §4 (computePlacement, gap 8). anchor and viewport in pixels, y grows downwards. expect: side, x, y, fits, maxW, maxH.",
  cases: placement.map(([name, s, anchor, sides, viewport]) => ({ name, size: s, anchor, sides, viewport, expect: computePlacement(s, anchor, sides, viewport) })),
});

const glossaries = [
  ["flat, nested, meta, problems", { $locale: "de", $ui: { close: "X" }, "hw.vram": { title: "VRAM" }, ai: { lora: { title: "LoRA" }, model: { short: "…" } }, "bad key!": { title: "?" }, broken: 5 }],
  ["entry needs title, short or body", { a: { note: "only a note" }, b: { body: "text" } }],
];
write("glossary.json", {
  $comment: "Parity cases for SPEC §2.1 (flattening a glossary file). expect: entry keys in file order, metadata keys, number of problems.",
  cases: glossaries.map(([name, input]) => {
    const { entries, meta, problems } = flattenGlossary(input);
    return { name, input, expect: { keys: [...entries.keys()], meta: Object.keys(meta), problems: problems.length } };
  }),
});
console.log("cases written to", dir);
