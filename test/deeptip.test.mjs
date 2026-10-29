// Pure-function tests: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseText, collectRefs, flattenGlossary, computePlacement } from "../frameworks/web/deeptip.js";

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

test("deeptip-check --scan: the marking calls of the guides, without false positives", () => {
  const dir = mkdtempSync(join(tmpdir(), "deeptip-scan-"));
  const files = {
    "web/index.html": `<b data-deeptip="t.web">x</b> [[t.link|y]] <button deeptip="t.ng">?</button> <i [attr.data-deeptip]="'t.ng_attr'">?</i>`,
    "web/main.js": `$("#a").deeptip("t.jq"); $("#a").deeptip("open"); $("#a").deeptip("text", "x"); $("l").deeptip({ key: "t.jq_obj" });\n` +
      `tips.explain(castle, "t.phaser"); performance.mark("t.no_perf");`,
    "rn/App.tsx": `const tip = useDeepTip("t.rn");`,
    "kt/Main.kt": `Button(modifier = Modifier.deepTip("t.kt")) {}\nText(dt.text("See [[t.kt_text]]."))`,
    "swift/View.swift": `Button("?") {}.deepTip("t.swift")\nDeepTip.shared.mark(cart, key: "t.uikit")\nlet grid: [[String]] = []`,
    "dart/main.dart": `DeepTip('t.flutter', child: x); DeepTipScope(controller: dt, child: c);`,
    "cs/Main.xaml": `<Button dt:DeepTip.Key="t.xaml"/>`,
    "cs/Host.cs": `deepTip.SetKey(root.Q<Button>("cart"), "t.uitk"); registry.SetKey(path, "Software"); File.Open("t.no_open");`,
    "cpp/main.cpp": `help.setProperty("deeptip", u"t.qt"_s); DeepTip->Mark(B, TEXT("t.unreal")); dt.Item("t.imgui", /*delay*/0);\n[[nodiscard]] int f();`,
    "c/main.c": `deeptip_mark (help, "t.gtk");`,
    "qml/Main.qml": `Button { DeepTip.key: "t.qml" }`,
    "java/Main.java": `help.putClientProperty("deeptip", "t.swing"); node.getProperties().put("deeptip", "t.fx"); map.put("other", "t.no_put");`,
    "py/app.py": `dt.mark(Button("?", compact=True), "t.py")\nhelp.setProperty("deeptip", "t.py_prop")`,
    "godot/main.gd": `DeepTip.mark(help, "t.gd")`,
    "godot/main.tscn": `metadata/deeptip = "t.tscn"`,
    "rs/main.rs": `dt.mark_with(area, "t.rs", MarkOptions::default()); let a = vec![[1]];`,
    "go/main.go": `m.dt.Mark("t.tea", "[?]"); dt.Mark(gtx, &h, "t.gio", w); zone.Mark("button1", s); zone.Mark("menu.file", s)`,
    "lua/main.lua": `dt:mark("help", "t.love", 0, 0, 9, 9) local s = [[t.no_long_string]]`,
    "gml/obj.gml": `deeptip_mark("help", "t.gml", 0, 0, 9, 9);`,
    "renpy/script.rpy": `hovered dt.Hover("t.renpy")\n"Rebels threaten your {a=dt:t.renpy_term}province{/a}."`,
    "server/page.php": `[deeptip key="t.wp"] <x-deeptip-term key="t.blade" />`,
    "server/page.erb": `<%= deeptip_term "t.rails" %>`,
    "skip/notes.md": `<b data-deeptip="t.no_md">x</b>`,
    "skip/jquery.deeptip.js": `// $(el).deeptip("t.no_plugin")`,
    "skip/build/page.html": `<b data-deeptip="t.no_build">x</b>`,
    "skip/copy/deeptip.json": `{ "kind": "runtime" }`,
    "skip/copy/markup.rs": `parse_text("[[t.no_crate]]")`,
    "skip/List.jsx": `<dl><dt key="t.no_dt">Term</dt></dl>`,
  };
  try {
    for (const [p, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, "src", p)), { recursive: true });
      writeFileSync(join(dir, "src", p), text);
    }
    const glossary = join(dir, "en.json");
    writeFileSync(glossary, JSON.stringify({ $locale: "en", "t.defined": { title: "Defined", short: "Defined." } }));
    const check = fileURLToPath(new URL("../tools/deeptip-check.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [check, "--json", glossary, "--scan", join(dir, "src")], { encoding: "utf8" });
    const reported = JSON.parse(run.stdout)
      .findings.filter((f) => f.level === "error")
      .map((f) => /key "([^"]+)"/.exec(f.msg)?.[1])
      .sort();
    const expected = ["t.web", "t.link", "t.ng", "t.ng_attr", "t.jq", "t.jq_obj", "t.phaser", "t.rn", "t.kt", "t.kt_text", "t.swift", "t.uikit",
      "t.flutter", "t.xaml", "t.uitk", "t.qt", "t.unreal", "t.imgui", "t.gtk", "t.qml", "t.swing", "t.fx", "t.py", "t.py_prop", "t.gd", "t.tscn",
      "t.rs", "t.tea", "t.gio", "t.love", "t.gml", "t.renpy", "t.renpy_term", "t.wp", "t.blade", "t.rails"];
    assert.deepEqual(reported, expected.sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
