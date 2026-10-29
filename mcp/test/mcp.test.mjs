// The DeepTip MCP server over stdio: both protocol eras (initialize, and stateless 2026-07-28), every tool, resources,
// the prompt and the error cases. Spawns mcp/deeptip-mcp.mjs like an MCP client does.
//   node --test mcp/test/mcp.test.mjs
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = join(ROOT, "mcp", "deeptip-mcp.mjs");
const MODERN = "2026-07-28";
const META = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "deeptip-test", version: "1.0.0" },
};
const TOOL_NAMES = [
  "deeptip_overview",
  "list_frameworks",
  "get_guide",
  "get_spec",
  "get_algorithms",
  "detect_framework",
  "check_glossary",
  "new_glossary_entry",
  "get_example_glossary",
];
// Frameworks the server offers: folders with a manifest and a guide.
const FRAMEWORKS = readdirSync(join(ROOT, "frameworks"))
  .filter((d) => existsSync(join(ROOT, "frameworks", d, "deeptip.json")) && existsSync(join(ROOT, "frameworks", d, "README.md")))
  .sort();
const repo = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** A minimal MCP client: newline-delimited JSON-RPC over the server's stdin and stdout. */
class Client {
  constructor() {
    this.proc = spawn(process.execPath, [SERVER], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.pending = new Map();
    this.queue = [];
    this.waiters = [];
    this.all = [];
    this.stderr = "";
    this.nextId = 1;
    let buf = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim()) this.receive(JSON.parse(line));
      }
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (d) => (this.stderr += d));
    this.exit = new Promise((done) => this.proc.on("exit", (code) => done(code)));
  }
  receive(msg) {
    this.all.push(msg);
    const key = !Array.isArray(msg) && msg.id !== undefined ? JSON.stringify(msg.id) : null;
    if (key && this.pending.has(key)) {
      const done = this.pending.get(key);
      this.pending.delete(key);
      done(msg);
    } else if (this.waiters.length) this.waiters.shift()(msg);
    else this.queue.push(msg);
  }
  raw(line) {
    this.proc.stdin.write(`${line}\n`);
  }
  request(method, params, id = this.nextId++) {
    return new Promise((done, fail) => {
      const key = JSON.stringify(id);
      const timer = setTimeout(() => fail(new Error(`no answer to ${method}\n${this.stderr}`)), 30000);
      this.pending.set(key, (msg) => {
        clearTimeout(timer);
        done(msg);
      });
      this.raw(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }));
    });
  }
  notify(method, params) {
    this.raw(JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }));
  }
  /** The next message that answers none of the pending requests (errors without id, batches). */
  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(new Error("no message")), 30000);
      this.waiters.push((msg) => {
        clearTimeout(timer);
        done(msg);
      });
    });
  }
  close() {
    this.proc.stdin.end();
    return this.exit;
  }
}

async function legacyClient(version = "2025-11-25") {
  const c = new Client();
  const r = await c.request("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "deeptip-test", version: "1.0.0" } });
  assert.ok(r.result, JSON.stringify(r));
  c.notify("notifications/initialized");
  return c;
}

/** Calls a tool and returns the result (fails the test on a JSON-RPC error). */
async function call(c, name, args, meta) {
  const r = await c.request("tools/call", { name, arguments: args, ...(meta ? { _meta: meta } : {}) });
  assert.ok(r.result, `tools/call ${name}: ${JSON.stringify(r.error)}`);
  return r.result;
}
const textOf = (result) => result.content.map((c) => c.text).join("\n");

/** The subset of JSON Schema the server's output schemas use. */
function validate(schema, value, path = "$") {
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  const types = [].concat(schema.type ?? []);
  if (types.length && !types.some((t) => t === typeOf(value) || (t === "number" && typeof value === "number"))) {
    return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
  }
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (typeOf(value) === "object") {
    for (const r of schema.required ?? []) if (!(r in value)) errors.push(`${path}: "${r}" missing`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) errors.push(...validate(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected "${k}"`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  return errors;
}

/* ================================================================== legacy era */

describe("legacy lifecycle (initialize)", () => {
  let c;
  before(() => {
    c = new Client();
  });
  after(() => c.close());

  test("ping before initialize", async () => {
    assert.deepEqual((await c.request("ping")).result, {});
  });

  test("a request before initialize without _meta is rejected", async () => {
    const r = await c.request("tools/list");
    assert.equal(r.error.code, -32602);
    assert.match(r.error.message, /initialize/);
  });

  test("initialize negotiates the requested version", async () => {
    const r = await c.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "deeptip-test", version: "1.0.0" } });
    assert.equal(r.result.protocolVersion, "2025-11-25");
    assert.deepEqual(Object.keys(r.result.capabilities).sort(), ["prompts", "resources", "tools"]);
    assert.equal(r.result.serverInfo.name, "deeptip");
    assert.equal(r.result.serverInfo.version, JSON.parse(repo("package.json")).version);
    assert.match(r.result.instructions, /detect_framework/);
    assert.equal(r.result.resultType, undefined, "legacy results carry no resultType");
    c.notify("notifications/initialized");
    assert.deepEqual((await c.request("ping")).result, {});
  });

  test("tools/list: nine read-only tools in a fixed order", async () => {
    const { result } = await c.request("tools/list");
    assert.deepEqual(result.tools.map((t) => t.name), TOOL_NAMES);
    for (const t of result.tools) {
      assert.equal(t.inputSchema.type, "object", t.name);
      assert.ok(t.description.length > 20 && t.title, t.name);
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      if (t.outputSchema) assert.equal(t.outputSchema.type, "object", t.name);
    }
    const guide = result.tools.find((t) => t.name === "get_guide");
    assert.deepEqual(guide.inputSchema.properties.framework.enum, FRAMEWORKS);
    assert.deepEqual(guide.inputSchema.required, ["framework"]);
    assert.equal(result.ttlMs, undefined);
  });

  test("an unknown version gets the latest legacy version", async () => {
    const d = new Client();
    const r = await d.request("initialize", { protocolVersion: "1999-01-01", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.equal(r.result.protocolVersion, "2025-11-25");
    const old = await d.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.equal(old.result.protocolVersion, "2024-11-05");
    await d.close();
  });
});

/* ================================================================== tools */

describe("tools", () => {
  let c;
  let tools;
  let tmp;
  before(async () => {
    c = await legacyClient();
    tools = new Map((await c.request("tools/list")).result.tools.map((t) => [t.name, t]));
    tmp = mkdtempSync(join(tmpdir(), "deeptip-mcp-"));
  });
  after(async () => {
    await c.close();
    rmSync(tmp, { recursive: true, force: true });
  });
  const file = (rel, content) => {
    const p = join(tmp, ...rel.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    return p;
  };
  const structured = (name, result) => {
    assert.ok(!result.isError, textOf(result));
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent, "text block = serialized structured content");
    assert.deepEqual(validate(tools.get(name).outputSchema, result.structuredContent), []);
    return result.structuredContent;
  };

  test("deeptip_overview: pattern, rules, frameworks and next steps", async () => {
    const text = textOf(await call(c, "deeptip_overview", {}));
    assert.match(text, /^# DeepTip/);
    assert.match(text, /DeepTip is a UI design pattern/);
    assert.match(text, /## The rules/);
    assert.match(text, /## Frameworks/);
    assert.match(text, /`get_guide\("web"\)`/);
    assert.doesNotMatch(text, /references\/frameworks/);
    assert.ok(text.includes(ROOT), "names the repository folder");
  });

  test("list_frameworks: every frameworks/*/deeptip.json", async () => {
    const out = structured("list_frameworks", await call(c, "list_frameworks", {}));
    assert.deepEqual(out.frameworks.map((f) => f.name).sort(), FRAMEWORKS);
    const web = out.frameworks.find((f) => f.name === "web");
    assert.equal(web.kind, "runtime");
    assert.equal(web.guide, "deeptip://frameworks/web");
    assert.deepEqual(out.frameworks.find((f) => f.name === "react").uses, ["web"]);
    const tiers = out.frameworks.map((f) => f.tier);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), "sorted by tier");
  });

  test("get_guide: whole guide, one section, lenient names", async () => {
    assert.equal(textOf(await call(c, "get_guide", { framework: "web" })), repo("frameworks/web/README.md"));
    const one = textOf(await call(c, "get_guide", { framework: "web", section: "1" }));
    assert.match(one, /^## 1\. Add the files\n/);
    assert.doesNotMatch(one, /## 2\./);
    assert.equal(textOf(await call(c, "get_guide", { framework: "egui" })), repo("frameworks/rust-egui/README.md"));
    assert.equal(textOf(await call(c, "get_guide", { framework: "Unity" })), repo("frameworks/unity/README.md"));
  });

  test("get_guide: headings inside code fences do not split sections", async () => {
    const testing = textOf(await call(c, "get_guide", { framework: "godot", section: "Testing" }));
    assert.match(testing, /^## Testing\n/);
    assert.match(testing, /# tests\/parity\.gd/, "the fenced '# …' line stays inside the section");
    assert.doesNotMatch(testing, /## Example to build/);
  });

  test("get_guide: unknown framework or section is a tool error with the choices", async () => {
    const unknown = await call(c, "get_guide", { framework: "cobol" });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /Unknown framework "cobol"\. Frameworks: .*web/);
    const ambiguous = await call(c, "get_guide", { framework: "cpp" });
    assert.equal(ambiguous.isError, true);
    assert.match(textOf(ambiguous), /cpp-imgui.*cpp-unreal|cpp-unreal.*cpp-imgui/);
    const nosection = await call(c, "get_guide", { framework: "web", section: "Quantum" });
    assert.equal(nosection.isError, true);
    assert.match(textOf(nosection), /No section of frameworks\/web\/README\.md matches "Quantum"\. Sections:\n/);
    assert.match(textOf(nosection), /^- 1\. Add the files$/m);
  });

  test("get_spec: whole, by number, by § and by title", async () => {
    assert.equal(textOf(await call(c, "get_spec", {})), repo("SPEC.md"));
    const markup = textOf(await call(c, "get_spec", { section: "2.4" }));
    assert.match(markup, /^### 2\.4 Markup/);
    assert.doesNotMatch(markup, /### 2\.5/);
    const behaviour = textOf(await call(c, "get_spec", { section: "§3" }));
    assert.match(behaviour, /^## 3\. Behaviour/);
    assert.match(behaviour, /### 3\.5 Closing/);
    assert.doesNotMatch(behaviour, /## 4\. Placement/);
    assert.match(textOf(await call(c, "get_spec", { section: "placement" })), /^## 4\. Placement/);
  });

  test("get_algorithms: whole and one section", async () => {
    assert.equal(textOf(await call(c, "get_algorithms", {})), repo("docs/algorithms.md"));
    assert.match(textOf(await call(c, "get_algorithms", { section: "§8" })), /^## §8 Placement\n/);
    const keyboard = textOf(await call(c, "get_algorithms", { section: "9.3" }));
    assert.match(keyboard, /^### 9\.3 Keyboard\n/);
    assert.doesNotMatch(keyboard, /### 9\.4/);
    assert.match(textOf(await call(c, "get_algorithms", { section: "Markup parser" })), /^## §2 Markup parser/);
  });

  test("detect_framework: marker files and dependencies", async () => {
    const detect = async (rel) => structured("detect_framework", await call(c, "detect_framework", { path: join(tmp, ...rel.split("/")) }));
    file("react/package.json", JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" }, devDependencies: { typescript: "^5.0.0" } }));
    file("react/tsconfig.json", "{}");
    file("react/index.html", "<!doctype html>");
    file("react/src/App.tsx", "export const App = () => null;");
    file("react/node_modules/vue/package.json", JSON.stringify({ name: "vue" }));
    const react = await detect("react");
    assert.equal(react.candidates[0].framework, "react");
    assert.equal(react.candidates[0].confidence, "high");
    assert.match(react.candidates[0].reasons.join("\n"), /package\.json: depends on react/);
    assert.ok(react.candidates.some((x) => x.framework === "typescript" && x.confidence === "medium"));
    assert.ok(!react.candidates.some((x) => x.framework === "vue"), "node_modules is skipped");
    assert.match(react.hint, /get_guide \{"framework": "react"\}/);

    file("godot/project.godot", "config_version=5\n\n[application]\nconfig/name=\"Demo\"\n");
    assert.deepEqual((await detect("godot")).candidates.map((x) => [x.framework, x.confidence]), [["godot", "high"]]);
    file("godot3/project.godot", "config_version=4\n");
    assert.match((await detect("godot3")).candidates[0].reasons[0], /Godot 3/);

    file("unity/ProjectSettings/ProjectVersion.txt", "m_EditorVersion: 6000.3.24f1\n");
    mkdirSync(join(tmp, "unity", "Assets"), { recursive: true });
    const unity = await detect("unity");
    assert.equal(unity.candidates[0].framework, "unity");
    assert.match(unity.candidates[0].reasons[0], /6000\.3\.24f1/);

    file("egui/Cargo.toml", '[package]\nname = "demo"\n\n[dependencies]\neframe = "0.33"\n');
    assert.equal((await detect("egui")).candidates[0].framework, "rust-egui");
    file("wpf/App.csproj", "<Project><PropertyGroup><UseWPF>true</UseWPF></PropertyGroup></Project>");
    const wpf = (await detect("wpf")).candidates[0];
    // a close relative of Avalonia until the repository has its own WPF guide
    assert.deepEqual([wpf.framework, wpf.confidence], FRAMEWORKS.includes("wpf") ? ["wpf", "high"] : ["avalonia", "medium"]);
    file("qt/app/main.py", "from PySide6.QtWidgets import QApplication\n");
    assert.equal((await detect("qt")).candidates[0].framework, "python-pyside6");
    file("valheim/Mod.csproj", '<Project><ItemGroup><Reference Include="assembly_valheim" /></ItemGroup></Project>');
    assert.equal((await detect("valheim")).candidates[0].framework, "valheim");

    file("deep/a/b/c/d/project.godot", "config_version=5\n");
    file("deeper/a/b/c/d/e/project.godot", "config_version=5\n");
    assert.equal((await detect("deep")).candidates[0]?.framework, "godot", "4 folder levels below the root are scanned");
    const deeper = await detect("deeper");
    assert.deepEqual(deeper.candidates, [], "5 levels are too deep");
    assert.match(deeper.hint, /deeptip_overview/);
    assert.equal(deeper.scanned.max_depth, 4);
  });

  test("detect_framework: a missing path or a file is a tool error", async () => {
    const missing = await call(c, "detect_framework", { path: join(tmp, "nope") });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /does not exist/);
    const notDir = await call(c, "detect_framework", { path: join(ROOT, "package.json") });
    assert.equal(notDir.isError, true);
    assert.match(textOf(notDir), /Not a folder/);
  });

  test("check_glossary: the example glossaries, with the core glossary first", async () => {
    const ex = (l) => join(ROOT, "glossary", "example", `${l}.json`);
    const out = structured("check_glossary", await call(c, "check_glossary", { files: [ex("de"), ex("en")], base: "de" }));
    assert.equal(out.ok, true);
    assert.equal(out.errors, 0);
    assert.ok(out.warnings > 0, "en lacks two entries of de");
    assert.equal(out.base, "de");
    assert.deepEqual(out.locales, ["de", "en"]);
    assert.deepEqual(out.files, [join(ROOT, "glossary", "core", "de.json"), join(ROOT, "glossary", "core", "en.json"), ex("de"), ex("en")]);
    const alone = structured("check_glossary", await call(c, "check_glossary", { files: ["glossary/example/en.json"], core: false }));
    assert.equal(alone.ok, false, "relative paths resolve against the server's working directory");
    assert.deepEqual(alone.files, [ex("en")]);
    assert.ok(alone.findings.some((f) => f.level === "error" && /broken link \[\[demo\.prestige\]\]/.test(f.msg)));
  });

  test("check_glossary: broken links, keys in code, invalid JSON", async () => {
    const glossary = file(
      "check/deeptip/en.json",
      JSON.stringify({ $locale: "en", "t.app": { title: "App", short: "The app.", body: "Opens [[t.missing]]." } }),
    );
    file("check/src/index.html", '<button data-deeptip="t.app">A</button>\n<b data-deeptip="t.nowhere">B</b>\n');
    const out = structured("check_glossary", await call(c, "check_glossary", { files: [glossary], scan: join(tmp, "check", "src"), core: false }));
    assert.equal(out.ok, false);
    assert.ok(out.findings.some((f) => /broken link \[\[t\.missing\]\]/.test(f.msg)));
    assert.ok(out.findings.some((f) => /"t\.nowhere" is used in code but not defined/.test(f.msg)));
    assert.equal(out.scan, join(tmp, "check", "src"));
    const bad = file("check/bad/de.json", "{ not json");
    const broken = structured("check_glossary", await call(c, "check_glossary", { files: [bad] }));
    assert.ok(broken.findings.some((f) => f.level === "error" && /invalid JSON/.test(f.msg)));
    // A byte order mark must not hide "$locale" (the file name has no locale, so only the content gives it).
    const bom = file("check/bom/glossary.json", String.fromCharCode(0xfeff) + JSON.stringify({ $locale: "en", "t.a": { title: "A", short: "A." } }));
    const withBom = structured("check_glossary", await call(c, "check_glossary", { files: [bom] }));
    assert.deepEqual(withBom.files, [join(ROOT, "glossary", "core", "en.json"), bom]);
    assert.equal(withBom.ok, true, JSON.stringify(withBom.findings));
  });

  test("check_glossary: missing paths and a bad base locale are tool errors", async () => {
    const missing = await call(c, "check_glossary", { files: [join(tmp, "nope.json")] });
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /does not exist/);
    const scanFile = await call(c, "check_glossary", { files: ["glossary/example"], scan: join(ROOT, "package.json") });
    assert.equal(scanFile.isError, true);
    const base = await call(c, "check_glossary", { files: ["glossary/example"], base: "english" });
    assert.equal(base.isError, true);
    assert.match(textOf(base), /locale/);
  });

  test("new_glossary_entry: a valid entry and its snippet", async () => {
    const out = structured(
      "new_glossary_entry",
      await call(c, "new_glossary_entry", {
        key: "shop.cart",
        title: "Cart",
        short: "Items you are about to order.",
        body: "Holds your items until you [[shop.checkout|check out]]. Currently **{items}** items.",
        see: ["shop.wishlist"],
        locale: "de",
      }),
    );
    assert.equal(out.valid, true, JSON.stringify(out.problems));
    assert.deepEqual(out.problems, []);
    assert.deepEqual(out.links, ["shop.checkout", "shop.wishlist"]);
    assert.deepEqual(out.live_values, ["items"]);
    assert.deepEqual(JSON.parse(`{${out.snippet}}`), { "shop.cart": out.entry });
    const fileJson = JSON.parse(out.file);
    assert.equal(fileJson.$locale, "de");
    assert.deepEqual(fileJson["shop.cart"], out.entry);
    assert.deepEqual(Object.keys(out.entry), ["title", "short", "body", "see"]);
  });

  test("new_glossary_entry: key, length, link and HTML problems", async () => {
    const out = structured(
      "new_glossary_entry",
      await call(c, "new_glossary_entry", { key: "Bad Key", title: "<b>Cart</b>", short: "x".repeat(141), body: "See [[Bad Key]] and [[bad key|x]]." }),
    );
    assert.equal(out.valid, false);
    const fields = out.problems.map((p) => `${p.level}:${p.field}`);
    assert.ok(fields.includes("error:key"), fields.join());
    assert.ok(fields.includes("error:short"), fields.join());
    assert.ok(fields.includes("warn:title"), fields.join());
    assert.ok(fields.includes("warn:body"), fields.join());
    const self = structured("new_glossary_entry", await call(c, "new_glossary_entry", { key: "a.b", title: "B", short: "One.", body: "Itself: [[a.b]]." }));
    assert.ok(self.problems.some((p) => /itself/.test(p.msg)));
    const noPrefix = structured("new_glossary_entry", await call(c, "new_glossary_entry", { key: "cart", title: "Cart", short: "Items." }));
    assert.equal(noPrefix.valid, true);
    assert.ok(noPrefix.problems.some((p) => p.level === "warn" && /prefix/.test(p.msg)));
  });

  test("get_example_glossary: the example file per locale", async () => {
    const en = textOf(await call(c, "get_example_glossary", { locale: "en" }));
    assert.equal(en, repo("glossary/example/en.json"));
    assert.equal(JSON.parse(en).$locale, "en");
    assert.deepEqual(tools.get("get_example_glossary").inputSchema.properties.locale.enum, ["de", "en"]);
    const xx = await call(c, "get_example_glossary", { locale: "xx" });
    assert.equal(xx.isError, true);
    assert.match(textOf(xx), /Locales: de, en/);
  });

  test("bad arguments: tool errors; unknown tool: protocol error", async () => {
    const missing = await call(c, "get_guide", {});
    assert.equal(missing.isError, true);
    assert.match(textOf(missing), /"framework" is required/);
    const unknown = await call(c, "get_spec", { chapter: "2" });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /unknown argument "chapter"/);
    const type = await call(c, "check_glossary", { files: "glossary/example/en.json" });
    assert.equal(type.isError, true);
    assert.match(textOf(type), /list of strings/);
    const noTool = await c.request("tools/call", { name: "write_files", arguments: {} });
    assert.equal(noTool.error.code, -32602);
    assert.match(noTool.error.message, /Unknown tool: write_files/);
    const badArgs = await c.request("tools/call", { name: "get_spec", arguments: ["2.4"] });
    assert.equal(badArgs.error.code, -32602);
  });
});

/* ================================================================== resources and prompts */

describe("resources", () => {
  let c;
  before(async () => {
    c = await legacyClient("2025-06-18");
  });
  after(() => c.close());

  test("resources/list: spec, algorithms, skill, schema and one guide per framework", async () => {
    const { result } = await c.request("resources/list");
    const uris = result.resources.map((r) => r.uri);
    assert.deepEqual(uris.slice(0, 4), ["deeptip://spec", "deeptip://algorithms", "deeptip://skill", "deeptip://schema"]);
    assert.deepEqual(uris.slice(4).sort(), FRAMEWORKS.map((f) => `deeptip://frameworks/${f}`));
    for (const r of result.resources) {
      assert.ok(r.name && r.mimeType && r.description, r.uri);
      assert.ok(Number.isInteger(r.size) && r.size > 0, r.uri);
    }
  });

  test("resources/read: the documents as they are", async () => {
    const read = async (uri) => (await c.request("resources/read", { uri })).result.contents[0];
    const spec = await read("deeptip://spec");
    assert.deepEqual([spec.uri, spec.mimeType], ["deeptip://spec", "text/markdown"]);
    assert.equal(spec.text, repo("SPEC.md"));
    assert.equal((await read("deeptip://algorithms")).text, repo("docs/algorithms.md"));
    assert.equal((await read("deeptip://skill")).text, repo("skill/deeptip/SKILL.md"));
    const schema = await read("deeptip://schema");
    assert.equal(schema.mimeType, "application/schema+json");
    assert.equal(JSON.parse(schema.text).title, "DeepTip glossary (one locale)");
    const godot = await read("deeptip://frameworks/godot#testing");
    assert.equal(godot.uri, "deeptip://frameworks/godot", "the fragment is ignored");
    assert.equal(godot.text, repo("frameworks/godot/README.md"));
  });

  test("resources/read: unknown URI, missing uri, cursor", async () => {
    const unknown = await c.request("resources/read", { uri: "deeptip://frameworks/cobol" });
    assert.equal(unknown.error.code, -32002, "legacy code for resource not found");
    assert.deepEqual(unknown.error.data, { uri: "deeptip://frameworks/cobol" });
    assert.equal((await c.request("resources/read", {})).error.code, -32602);
    assert.equal((await c.request("resources/list", { cursor: "2" })).error.code, -32602);
  });

  test("resources/templates/list", async () => {
    const { result } = await c.request("resources/templates/list");
    assert.deepEqual(result.resourceTemplates.map((t) => t.uriTemplate), ["deeptip://frameworks/{name}"]);
  });
});

describe("prompts", () => {
  let c;
  before(async () => {
    c = await legacyClient();
  });
  after(() => c.close());

  test("prompts/list: add-deeptip with two optional arguments", async () => {
    const { result } = await c.request("prompts/list");
    assert.deepEqual(result.prompts.map((p) => p.name), ["add-deeptip"]);
    assert.deepEqual(result.prompts[0].arguments.map((a) => [a.name, a.required]), [["framework", false], ["locale", false]]);
  });

  test("prompts/get: steps for a native guide", async () => {
    const { result } = await c.request("prompts/get", { name: "add-deeptip", arguments: { framework: "godot", locale: "de" } });
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, "user");
    const text = result.messages[0].content.text;
    assert.match(text, /get_guide \{"framework": "godot"\}/);
    assert.match(text, /deeptip\/de\.json in de first/);
    assert.match(text, /Guide for a native build/);
    assert.match(text, /"base": "de"/);
    assert.match(text, /- \[ \] Resting on a marked element/, "the checklist of the skill");
  });

  test("prompts/get: detect first without arguments; kinds per framework", async () => {
    const none = (await c.request("prompts/get", { name: "add-deeptip" })).result.messages[0].content.text;
    assert.match(none, /call detect_framework/);
    assert.match(none, /Guide on the web runtime/);
    assert.match(none, /Guide for a native build/);
    const react = (await c.request("prompts/get", { name: "add-deeptip", arguments: { framework: "react", locale: "" } })).result.messages[0].content.text;
    assert.match(react, /Guide on the web runtime/);
    assert.doesNotMatch(react, /Guide for a native build/);
    assert.match(react, /in the user's language first/);
    const web = (await c.request("prompts/get", { name: "add-deeptip", arguments: { framework: "web" } })).result.messages[0].content.text;
    assert.match(web, /deeptip-sync\.mjs/);
    assert.match(web, /cdn\.jsdelivr\.net\/gh\/gorduan\/DeepTip@v/);
  });

  test("prompts/get: invalid name or arguments are -32602", async () => {
    assert.equal((await c.request("prompts/get", { name: "remove-deeptip" })).error.code, -32602);
    const fw = await c.request("prompts/get", { name: "add-deeptip", arguments: { framework: "cobol" } });
    assert.equal(fw.error.code, -32602);
    assert.ok(fw.error.data.frameworks.includes("web"));
    assert.equal((await c.request("prompts/get", { name: "add-deeptip", arguments: { locale: "German" } })).error.code, -32602);
    assert.equal((await c.request("prompts/get", { name: "add-deeptip", arguments: { theme: "dark" } })).error.code, -32602);
    assert.equal((await c.request("prompts/get", { name: "add-deeptip", arguments: { locale: 7 } })).error.code, -32602);
  });
});

/* ================================================================== modern era (2026-07-28) */

describe("stateless protocol 2026-07-28", () => {
  let c;
  before(() => {
    c = new Client();
  });
  after(() => c.close());

  test("server/discover: versions, capabilities, identity, caching hints", async () => {
    const { result } = await c.request("server/discover", { _meta: META });
    assert.equal(result.resultType, "complete");
    assert.deepEqual(result.supportedVersions, ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
    assert.deepEqual(Object.keys(result.capabilities).sort(), ["prompts", "resources", "tools"]);
    assert.match(result.instructions, /check_glossary/);
    assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "deeptip");
    assert.ok(result.ttlMs > 0);
    assert.equal(result.cacheScope, "public");
  });

  test("every request is served on its own, without initialize", async () => {
    const list = (await c.request("tools/list", { _meta: META })).result;
    assert.equal(list.resultType, "complete");
    assert.deepEqual(list.tools.map((t) => t.name), TOOL_NAMES);
    assert.ok(list.ttlMs >= 0);
    assert.equal(list.cacheScope, "public");
    const tool = await call(c, "get_spec", { section: "2.6" }, META);
    assert.equal(tool.resultType, "complete");
    assert.match(textOf(tool), /^### 2\.6 `\$ui` labels/);
    assert.equal(tool.ttlMs, undefined, "tool results are not cacheable");
    assert.equal(tool._meta["io.modelcontextprotocol/serverInfo"].name, "deeptip");
    const read = (await c.request("resources/read", { uri: "deeptip://algorithms", _meta: META })).result;
    assert.equal(read.resultType, "complete");
    assert.ok(read.ttlMs > 0);
    const prompt = (await c.request("prompts/get", { name: "add-deeptip", arguments: { framework: "unity" }, _meta: META })).result;
    assert.equal(prompt.resultType, "complete");
    assert.match(prompt.messages[0].content.text, /get_guide \{"framework": "unity"\}/);
    const templates = (await c.request("resources/templates/list", { _meta: META })).result;
    assert.equal(templates.resultType, "complete");
  });

  test("modern errors: unsupported version, missing capabilities, resource not found, removed ping", async () => {
    const future = await c.request("tools/list", { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } });
    assert.equal(future.error.code, -32022);
    assert.deepEqual(future.error.data.requested, "2099-01-01");
    assert.ok(future.error.data.supported.includes(MODERN));
    const legacy = await c.request("server/discover", { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": "2025-11-25" } });
    assert.equal(legacy.error.code, -32022);
    assert.match(legacy.error.message, /initialize/);
    const noCaps = await c.request("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } });
    assert.equal(noCaps.error.code, -32602);
    const badVersion = await c.request("tools/list", { _meta: { ...META, "io.modelcontextprotocol/protocolVersion": 20260728 } });
    assert.equal(badVersion.error.code, -32602);
    const missing = await c.request("resources/read", { uri: "deeptip://nope", _meta: META });
    assert.equal(missing.error.code, -32602);
    assert.equal(missing.error.message, "Resource not found");
    assert.equal((await c.request("ping", { _meta: META })).error.code, -32601);
    assert.equal((await c.request("subscriptions/listen", { _meta: META, notifications: { toolsListChanged: true } })).error.code, -32601);
    const noMeta = await c.request("server/discover");
    assert.equal(noMeta.error.code, -32602);
  });

  test("a legacy session and modern requests on one connection", async () => {
    const d = await legacyClient();
    const legacy = (await d.request("tools/list")).result;
    assert.equal(legacy.resultType, undefined);
    const modern = (await d.request("tools/list", { _meta: META })).result;
    assert.equal(modern.resultType, "complete");
    assert.equal((await d.request("server/discover")).error.code, -32601, "server/discover needs _meta");
    const stamped = await d.request("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2025-11-25" } });
    assert.equal(stamped.result?.resultType, undefined, "a legacy version in _meta is extra metadata inside the session");
    assert.equal(stamped.result.tools.length, TOOL_NAMES.length);
    await d.close();
  });
});

/* ================================================================== JSON-RPC robustness */

describe("JSON-RPC errors never stop the server", () => {
  let c;
  before(async () => {
    c = await legacyClient();
  });

  test("parse error, invalid requests, unknown method, bad params", async () => {
    c.raw("this is not json");
    const parse = await c.next();
    assert.equal(parse.error.code, -32700);
    assert.equal("id" in parse, false);
    c.raw("42");
    assert.equal((await c.next()).error.code, -32600);
    c.raw(JSON.stringify({ jsonrpc: "2.0", id: null, method: "ping" }));
    const nullId = await c.next();
    assert.deepEqual([nullId.error.code, "id" in nullId], [-32600, false]);
    c.raw(JSON.stringify({ jsonrpc: "1.0", id: "old", method: "ping" }));
    const old = await c.next();
    assert.deepEqual([old.id, old.error.code], ["old", -32600]);
    c.raw(JSON.stringify({ jsonrpc: "2.0", id: "nomethod" }));
    const noMethod = await c.next();
    assert.deepEqual([noMethod.id, noMethod.error.code], ["nomethod", -32600]);
    assert.equal((await c.request("tools/delete")).error.code, -32601);
    assert.equal((await c.request("tools/list", ["x"])).error.code, -32602);
  });

  test("notifications and client responses get no answer", async () => {
    c.notify("notifications/unknown", { x: 1 });
    c.notify("notifications/cancelled", { requestId: "never-sent" });
    c.raw(JSON.stringify({ jsonrpc: "2.0", id: 99, result: {} }));
    const before = c.all.length;
    assert.deepEqual((await c.request("ping", undefined, "after")).result, {});
    assert.equal(c.all.length, before + 1, "only the ping was answered");
  });

  test("batches are answered as batches", async () => {
    c.raw(JSON.stringify([{ jsonrpc: "2.0", id: "b1", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b2", method: "nope" }]));
    const batch = await c.next();
    assert.ok(Array.isArray(batch));
    assert.deepEqual(batch.map((m) => m.id), ["b1", "b2"]);
    assert.equal(batch[1].error.code, -32601);
    c.raw("[]");
    assert.equal((await c.next()).error.code, -32600);
  });

  test("a cancelled request gets no response", async () => {
    c.raw(JSON.stringify({ jsonrpc: "2.0", id: "slow", method: "tools/call", params: { name: "check_glossary", arguments: { files: ["glossary"] } } }));
    c.notify("notifications/cancelled", { requestId: "slow", reason: "test" });
    await new Promise((done) => setTimeout(done, 1500));
    assert.deepEqual((await c.request("ping")).result, {});
    assert.ok(!c.all.some((m) => m.id === "slow"), "no response for the cancelled request");
  });

  test("the server ends when stdin closes", async () => {
    assert.equal(await c.close(), 0);
    assert.equal(c.stderr, "", "nothing on stderr");
  });
});
