#!/usr/bin/env node
// DeepTip MCP server: the specification, the algorithms, every framework guide and the glossary tools of DeepTip for
// any client of the Model Context Protocol. stdio transport (newline-delimited JSON-RPC 2.0), Node 18+, no dependencies.
// Speaks MCP 2026-07-28 (stateless: server/discover, protocol version and client capabilities in every request's _meta)
// and, for clients that open with initialize, 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05.
// Read-only: it reads the DeepTip repository it lives in (the parent folder of mcp/) and the folders a client names;
// it never writes files and never uses the network. Details and client setup: mcp/README.md.
//
//   node mcp/deeptip-mcp.mjs              started by an MCP client
//   node mcp/deeptip-mcp.mjs --version    print the version
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { parseText, collectRefs, KEY_RE } from "../frameworks/web/deeptip.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = join(ROOT, "tools", "deeptip-check.mjs");
const VERSION = readJson(join(ROOT, "package.json"))?.version ?? "0.0.0";

const MODERN = ["2026-07-28"]; // stateless: version and capabilities in every request's _meta
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]; // initialize handshake
const SUPPORTED = [...MODERN, ...LEGACY];
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPS = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER = "io.modelcontextprotocol/serverInfo";
const CODE = { parse: -32700, request: -32600, method: -32601, params: -32602, internal: -32603, notFoundLegacy: -32002, version: -32022 };
// Freshness hints (ms) for cacheable results (2026-07-28 "Caching"); everything here is the same for every caller.
const TTL = {
  "server/discover": 3600000,
  "tools/list": 300000,
  "resources/list": 300000,
  "resources/templates/list": 300000,
  "prompts/list": 300000,
  "resources/read": 60000,
};

const SERVER_INFO = {
  name: "deeptip",
  title: "DeepTip",
  version: VERSION,
  description: "Explanation windows with depth (nested, pinnable Paradox-style tooltips): specification, algorithms, framework guides and glossary tools.",
  websiteUrl: "https://github.com/gorduan/DeepTip",
};
const CAPABILITIES = { tools: {}, resources: {}, prompts: {} };
const INSTRUCTIONS =
  "DeepTip: explanation windows with depth (nested, pinnable Paradox-style tooltips); every text lives in one JSON glossary per language. " +
  "To add it to a project: detect_framework, then get_guide (read the whole guide), write deeptip/<locale>.json (get_example_glossary, new_glossary_entry), " +
  "then check_glossary until it reports 0 errors. deeptip_overview has the rules; get_spec and get_algorithms hold the contract and the algorithms. All tools only read.";
const SCHEMA_URL = "https://raw.githubusercontent.com/gorduan/DeepTip/main/schema/deeptip.schema.json";
const CDN = `https://cdn.jsdelivr.net/gh/gorduan/DeepTip@v${VERSION}/frameworks/web/`;
const MAX_SHORT = 140;
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const cli = process.argv.slice(2);
if (cli.includes("--version") || cli.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}
if (cli.includes("--help") || cli.includes("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 10).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

/* ================================================================== helpers */

class RpcError extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}
class ToolError extends Error {} // becomes a tool result with isError: true, so the model can correct its call

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
const readRepo = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/^\uFEFF/, "");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const given = (v) => v !== undefined && v !== null && !(typeof v === "string" && !v.trim());
const textResult = (text) => ({ content: [{ type: "text", text }] });
const dataResult = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data });
const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });

/** A path from the client: absolute, relative to the working directory, ~/…, file://… or (Windows) /c/…; must exist. */
function clientPath(input, want) {
  let p = String(input).trim();
  try {
    if (/^file:\/\//i.test(p)) p = fileURLToPath(p);
  } catch {
    throw new ToolError(`Not a file URL: ${input}`);
  }
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = join(homedir(), p.slice(1));
  else if (process.platform === "win32" && /^\/[a-zA-Z](\/|$)/.test(p)) p = `${p[1]}:${p.slice(2) || "/"}`;
  const abs = resolve(p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    throw new ToolError(`Path does not exist: ${abs}`);
  }
  if (want === "directory" && !st.isDirectory()) throw new ToolError(`Not a folder: ${abs}`);
  return abs;
}

/* ================================================================== repository content */

/** frameworks/<dir> with deeptip.json and README.md, sorted by tier and name like tools/package.mjs. */
function frameworks() {
  let dirs;
  try {
    dirs = readdirSync(join(ROOT, "frameworks"));
  } catch {
    return [];
  }
  return dirs
    .filter((d) => existsSync(join(ROOT, "frameworks", d, "deeptip.json")) && existsSync(join(ROOT, "frameworks", d, "README.md")))
    .map((d) => ({ ...(readJson(join(ROOT, "frameworks", d, "deeptip.json")) ?? {}), dir: d }))
    .sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.dir.localeCompare(b.dir));
}

const isCode = (f) => f.kind === "runtime" || f.kind === "adapter"; // ready code in this repository
const onWebRuntime = (f) => !isCode(f) && Array.isArray(f.uses) && f.uses.includes("web"); // a guide that builds on the web runtime

/** Exact folder name first, then manifest name or title, then a unique part ("egui" → rust-egui, "rpg maker mz"). */
function findFramework(input) {
  const all = frameworks();
  const q = String(input ?? "").trim().toLowerCase();
  const flat = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  let hits = all.filter((f) => f.dir.toLowerCase() === q);
  if (!hits.length) hits = all.filter((f) => String(f.name ?? "").toLowerCase() === q || String(f.title ?? "").toLowerCase() === q);
  if (!hits.length && q) hits = all.filter((f) => f.dir.toLowerCase().split("-").includes(q) || flat(f.dir) === flat(q));
  return { hit: hits.length === 1 ? hits[0] : null, matches: hits, all };
}

function exampleLocales() {
  try {
    return readdirSync(join(ROOT, "glossary", "example"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/* Markdown sections. Headings inside code fences do not count (guides contain "# comment" lines in code). */

function headings(md) {
  const lines = md.split(/\r?\n/);
  const heads = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      return;
    }
    if (fence) return;
    const h = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (h) heads.push({ level: h[1].length, text: h[2].trim(), line: i });
  });
  return { lines, heads };
}

const plain = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const headNumber = (t) => /^§?\s*(\d+(?:\.\d+)*)\.?(?=\s|$)/.exec(t)?.[1] ?? null;
const headTitle = (t) => plain(t).replace(/^§?\s*\d+(?:\.\d+)*\.?\s*/, "");

/** The section whose heading matches `query` (a number like "2.4" / "§8", or heading text), with its subsections. */
function findSection(md, query) {
  const { lines, heads } = headings(md);
  const q = String(query).trim();
  const num = /^§?\s*(\d+(?:\.\d+)*)\.?$/.exec(q)?.[1];
  let hit = num ? heads.find((h) => headNumber(h.text) === num) : undefined;
  const nq = plain(q).replace(/^§\s*/, "");
  if (!hit && nq) {
    hit =
      heads.find((h) => headTitle(h.text) === nq || plain(h.text) === nq) ??
      heads.find((h) => headTitle(h.text).startsWith(nq)) ??
      heads.find((h) => plain(h.text).includes(nq));
  }
  if (!hit) return { heads };
  const next = heads.find((h) => h.line > hit.line && h.level <= hit.level);
  return { heads, text: `${lines.slice(hit.line, next ? next.line : lines.length).join("\n").trim()}\n` };
}

function pickSection(md, query, file) {
  if (!given(query)) return md;
  const found = findSection(md, query);
  if (found.text) return found.text;
  const outline = found.heads
    .filter((h) => h.level >= 2)
    .map((h) => `${"  ".repeat(h.level - 2)}- ${h.text}`)
    .join("\n");
  throw new ToolError(`No section of ${file} matches "${query}". Sections:\n${outline}`);
}

function overview() {
  const skill = readRepo("skill/deeptip/SKILL.md").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const intro = skill
    .split(/\r?\n[ \t]*\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("#"));
  const part = (name) => (findSection(skill, name).text ?? "").trim();
  const table = part("Frameworks").replace(/`references\/frameworks\/([\w-]+)\/README\.md`/g, '`get_guide("$1")`');
  return [
    "# DeepTip: explanation windows with depth",
    "",
    intro ?? "",
    "",
    part("The rules"),
    "",
    table,
    "",
    "## Using DeepTip through this server",
    "",
    "1. `detect_framework` with the project's folder names the guide that fits, with reasons; `list_frameworks` lists them all.",
    `2. \`get_guide\` with that framework: read it completely before writing code. Ready code (${frameworks()
      .filter(isCode)
      .map((f) => f.title ?? f.dir)
      .join(", ")}) is used as it is, never rewritten.`,
    "3. Write the glossary `deeptip/<locale>.json` in the user's language first: `get_example_glossary` shows a complete file, `new_glossary_entry` builds and checks one entry.",
    "4. `check_glossary` with the glossary files (and `scan` = the source folder) until it reports 0 errors.",
    "5. Exact behaviour: `get_spec` (the contract) and `get_algorithms` (language-neutral pseudo-code), whole or one section. The prompt `add-deeptip` walks through all steps; the resources `deeptip://spec`, `deeptip://algorithms`, `deeptip://skill`, `deeptip://schema` and `deeptip://frameworks/<name>` hold the documents.",
    "",
    `This server reads the DeepTip repository at ${ROOT}; files the guides mention (test/cases/*.json, frameworks/web/deeptip.js, tools/deeptip-sync.mjs …) are there.`,
    "",
  ].join("\n");
}

/* ================================================================== detect_framework */

const SKIP_DIRS = new Set(["node_modules", "bower_components", "dist", "build", "out", "target", "bin", "obj", "Library", "Temp", "Logs", "Binaries", "Intermediate", "Saved", "DerivedDataCache", "Pods", "DerivedData", "__pycache__", "venv"]);
const DETECT = { maxDepth: 4, maxEntries: 20000, maxReads: 400, maxBytes: 512 * 1024 };
const LEVELS = ["none", "low", "medium", "high"];

/** The signals of the framework table in SKILL.md (plus its close relatives), looked up in one folder tree. */
function detect(root) {
  const files = [];
  let dirs = 1;
  let entries = 0;
  let reads = 0;
  let truncated = false;
  let hasAssets = false;
  const walk = (abs, rel, depth) => {
    let list;
    try {
      list = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const d of list) {
      if (++entries > DETECT.maxEntries) {
        truncated = true;
        return;
      }
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) continue; // never leave the folder tree
      if (d.isDirectory()) {
        if (d.name.startsWith(".") || SKIP_DIRS.has(d.name)) continue;
        dirs++;
        if (d.name === "Assets") hasAssets = true;
        if (depth < DETECT.maxDepth) walk(join(abs, d.name), r, depth + 1);
      } else if (d.isFile()) files.push({ rel: r, abs: join(abs, d.name), name: d.name, ext: extname(d.name).toLowerCase() });
    }
  };
  walk(root, "", 0);

  const read = (f) => {
    if (reads >= DETECT.maxReads) {
      truncated = true;
      return "";
    }
    try {
      if (statSync(f.abs).size > DETECT.maxBytes) return "";
      reads++;
      return readFileSync(f.abs, "utf8");
    } catch {
      return "";
    }
  };
  const found = new Map(); // framework -> { level, reasons, seen }
  const add = (fw, level, signal, reason) => {
    let c = found.get(fw);
    if (!c) found.set(fw, (c = { level: 0, reasons: [], seen: new Set() }));
    if (c.seen.has(signal)) return;
    c.seen.add(signal);
    c.level = Math.max(c.level, LEVELS.indexOf(level));
    if (c.reasons.length < 6) c.reasons.push(reason);
  };
  const has = (fw, signal) => found.get(fw)?.seen.has(signal);
  const at = (rel, tail) => rel === tail || rel.endsWith(`/${tail}`);
  const known = new Map(frameworks().map((f) => [f.dir, f]));

  for (const f of files) {
    const { rel, name, ext } = f;
    if (name === "project.godot") {
      const v = /config_version\s*=\s*(\d+)/.exec(read(f))?.[1];
      if (v && +v < 5) add("godot", "medium", "godot", `${rel}: Godot 3 or older (config_version=${v}); the guide targets Godot 4`);
      else add("godot", "high", "godot", `${rel}: Godot project`);
    } else if (ext === ".uproject") add("cpp-unreal", "high", "uproject", `${rel}: Unreal Engine project`);
    else if (at(rel, "ProjectSettings/ProjectVersion.txt")) {
      const v = /m_EditorVersion:\s*(\S+)/.exec(read(f))?.[1];
      add("unity", "high", "unity", `${rel}: Unity project${v ? ` (editor ${v})` : ""}`);
    } else if (at(rel, "js/rmmz_core.js")) add("rpgmaker-mz", "high", "rmmz", `${rel}: RPG Maker MZ project`);
    else if (at(rel, "js/rpg_core.js")) add("rpgmaker-mz", "medium", "rmmv", `${rel}: RPG Maker MV; start from the MZ plugin`);
    else if (at(rel, "data/System.json")) add("rpgmaker-mz", "low", "system", `${rel}: RPG Maker data folder`);
    else if (name === "Cargo.toml") {
      const src = read(f);
      const dep = (names) => new RegExp(`^[ \\t]*(${names})[ \\t]*=|^[ \\t]*\\[(?:[\\w-]+\\.)*dependencies\\.(${names})\\]`, "m").exec(src);
      const egui = dep("egui|eframe");
      if (egui) add("rust-egui", "high", "cargo", `${rel}: depends on ${egui[1] ?? egui[2]}`);
      if (known.has("rust-ratatui") && dep("ratatui")) add("rust-ratatui", "high", "ratatui", `${rel}: depends on ratatui`);
    } else if (name === "go.mod") {
      if (/\bgioui\.org\b/.test(read(f))) add("go-gio", "high", "gio", `${rel}: requires gioui.org`);
    } else if (/^(build|settings)\.gradle(\.kts)?$/.test(name) || name === "libs.versions.toml") {
      const src = read(f);
      if (/org\.jetbrains\.compose/.test(src)) add("kotlin-compose", "high", "compose", `${rel}: Compose Desktop (org.jetbrains.compose)`);
      else if (/androidx\.compose/.test(src)) add("kotlin-compose", "medium", "android", `${rel}: Jetpack Compose for Android; start from the Compose Desktop guide (check touch and popups)`);
    } else if (ext === ".csproj" || ["Directory.Packages.props", "Directory.Build.props", "packages.config"].includes(name)) {
      const src = read(f);
      if (/Include\s*=\s*"Avalonia/i.test(src)) add("avalonia", "high", "avalonia", `${rel}: references Avalonia`);
      if (/<UseWPF>\s*true\s*</i.test(src)) {
        if (known.has("wpf")) add("wpf", "high", "wpf", `${rel}: WPF project`);
        else add("avalonia", "medium", "wpf", `${rel}: WPF; start from the Avalonia guide`);
      }
      if (/<UseWindowsForms>\s*true\s*</i.test(src) && known.has("winforms")) add("winforms", "high", "winforms", `${rel}: Windows Forms project`);
      if (/<UseMaui>\s*true\s*</i.test(src)) add("avalonia", "medium", "maui", `${rel}: .NET MAUI; start from the Avalonia guide`);
      if (/assembly_valheim/i.test(src)) add("valheim", "high", "valheim", `${rel}: references assembly_valheim (Valheim mod)`);
      else if (/BepInEx/i.test(src)) add("valheim", "low", "bepinex", `${rel}: BepInEx plugin; the Valheim guide shows DeepTip in a finished game`);
      if (/BlazorWebAssembly|Components\.WebAssembly/i.test(src)) add("blazor", "high", "blazor-sdk", `${rel}: Blazor project`);
    } else if (name === "package.json") {
      let pkg = null;
      try {
        pkg = JSON.parse(read(f));
      } catch {
        // not JSON: no signal
      }
      if (isObject(pkg)) {
        const deps = {};
        for (const k of ["dependencies", "devDependencies", "peerDependencies"]) if (isObject(pkg[k])) Object.assign(deps, pkg[k]);
        const dep = (...names) => names.find((n) => Object.hasOwn(deps, n));
        let ui = false;
        for (const [fw, names] of [["react", ["react", "next"]], ["vue", ["vue", "nuxt"]], ["svelte", ["svelte", "@sveltejs/kit"]]]) {
          const n = dep(...names);
          if (n) {
            add(fw, "high", `${fw}-dep`, `${rel}: depends on ${n}`);
            ui = true;
          }
        }
        if (dep("electron")) add("web", "high", "electron", `${rel}: Electron app`);
        if (dep("@tauri-apps/api", "@tauri-apps/cli")) add("web", "high", "tauri", `${rel}: Tauri app`);
        if (dep("typescript")) add("typescript", "medium", "ts-dep", `${rel}: depends on typescript`);
        if (!ui) add("web", "low", "package", `${rel}: JavaScript project`);
      }
    } else if (name === "tsconfig.json") add("typescript", "medium", "tsconfig", `${rel}: TypeScript project`);
    else if (name === "tauri.conf.json") add("web", "high", "tauri", `${rel}: Tauri app`);
    else if (["requirements.txt", "pyproject.toml", "setup.py", "setup.cfg", "Pipfile"].includes(name)) {
      const src = read(f);
      if (/\bPySide6\b/i.test(src)) add("python-pyside6", "high", "pyside6-req", `${rel}: requires PySide6`);
      else if (/\bPyQt6\b/i.test(src)) add("python-pyside6", "medium", "pyqt6-req", `${rel}: requires PyQt6; start from the PySide6 guide`);
    } else if (["CMakeLists.txt", "vcpkg.json", "conanfile.txt", "conanfile.py"].includes(name)) {
      if (/imgui/i.test(read(f))) add("cpp-imgui", "medium", "imgui-build", `${rel}: builds with imgui`);
    } else if (name === "imgui.h") add("cpp-imgui", "high", "imgui-h", `${rel}: Dear ImGui header`);
    else if (ext === ".razor") add("blazor", "high", "razor", `${rel}: Razor component`);
    else if (ext === ".svelte") add("svelte", "high", "svelte-file", `${rel}: Svelte component`);
    else if (ext === ".vue") add("vue", "high", "vue-file", `${rel}: Vue component`);
    else if (ext === ".jsx" || ext === ".tsx") add("react", "medium", "jsx", `${rel}: JSX file`);
    else if (ext === ".html" || ext === ".htm") add("web", "medium", "html", `${rel}: HTML page`);
    else if ([".cpp", ".cc", ".cxx", ".h", ".hpp"].includes(ext)) {
      if (!has("cpp-imgui", "imgui-include") && /#\s*include\s*[<"](?:[\w./-]*\/)?imgui\.h[>"]/.test(read(f))) add("cpp-imgui", "high", "imgui-include", `${rel}: includes imgui.h`);
    } else if (ext === ".py") {
      if (!has("python-pyside6", "pyside6")) {
        const src = read(f);
        if (/^[ \t]*(?:from|import)[ \t]+PySide6\b/m.test(src)) add("python-pyside6", "high", "pyside6", `${rel}: imports PySide6`);
        else if (/^[ \t]*(?:from|import)[ \t]+PyQt6\b/m.test(src)) add("python-pyside6", "medium", "pyqt6", `${rel}: imports PyQt6; start from the PySide6 guide`);
      }
    } else if (ext === ".java") {
      if (!has("java-swing", "swing") && /^[ \t]*import[ \t]+javax\.swing\b/m.test(read(f))) add("java-swing", "high", "swing", `${rel}: imports javax.swing`);
    } else if (ext === ".swift") {
      if (!has("swift-swiftui", "swiftui") && /^[ \t]*import[ \t]+SwiftUI\b/m.test(read(f))) add("swift-swiftui", "high", "swiftui", `${rel}: imports SwiftUI`);
    }
  }
  if (hasAssets && !found.has("unity")) add("unity", "low", "assets", "Assets/: the folder name Unity projects use");

  const candidates = [...found]
    .filter(([fw]) => known.has(fw))
    .sort(([a, x], [b, y]) => y.level - x.level || y.seen.size - x.seen.size || (known.get(a).tier ?? 9) - (known.get(b).tier ?? 9) || a.localeCompare(b))
    .map(([fw, c]) => ({ framework: fw, title: String(known.get(fw).title ?? fw), kind: String(known.get(fw).kind ?? ""), confidence: LEVELS[c.level], reasons: c.reasons }));
  return {
    path: root,
    candidates,
    scanned: { directories: dirs, files: files.length, max_depth: DETECT.maxDepth, truncated },
    hint: candidates.length
      ? `Read the guide of the best candidate completely: get_guide {"framework": "${candidates[0].framework}"}.`
      : "No framework signals found. deeptip_overview explains how to pick a framework; without a guide, build DeepTip from get_algorithms (workflow 3 of the skill).",
  };
}

/* ================================================================== check_glossary */

/** The validator is a CLI with side effects (argv, process.exit), so it runs as a child process with --json. */
async function checkGlossary({ files, base, scan, core = true }, signal) {
  const paths = files.map((p) => clientPath(p));
  const scanDir = given(scan) ? clientPath(scan, "directory") : null;
  const baseLocale = given(base) ? String(base).trim() : null;
  if (baseLocale && !LOCALE_RE.test(baseLocale)) throw new ToolError(`"base" must be a locale like en, de or pt-BR, not "${base}"`);

  // Same file expansion and locale detection as the validator, to put the matching core files first.
  const seen = new Set();
  const locales = [];
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  for (const p of paths) {
    let list = [p];
    if (statSync(p).isDirectory()) {
      try {
        list = readdirSync(p).sort().filter((f) => extname(f) === ".json").map((f) => join(p, f));
      } catch {
        list = [];
      }
    }
    for (const file of list) {
      seen.add(norm(file));
      const json = readJson(file);
      const loc = isObject(json) && typeof json.$locale === "string" ? json.$locale : /(?:^|\.)([a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.exec(basename(file, ".json"))?.[1];
      if (loc && !locales.includes(loc)) locales.push(loc);
    }
  }
  const coreFiles = core === false ? [] : locales.map((l) => join(ROOT, "glossary", "core", `${l}.json`)).filter((f) => existsSync(f) && !seen.has(norm(f)));

  const args = [CHECK, "--json"];
  if (baseLocale) args.push("--base", baseLocale);
  if (scanDir) args.push("--scan", scanDir);
  args.push(...coreFiles, ...paths);
  const run = await new Promise((done) => {
    execFile(process.execPath, args, { cwd: ROOT, timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, signal }, (err, stdout, stderr) =>
      done({ err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
    );
  });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    const why = run.err?.killed ? "it was stopped (time limit 120 s)" : `exit code ${run.err?.code ?? 0}`;
    throw new ToolError(`The validator did not report (${why}): ${(run.stderr || run.stdout).trim().slice(0, 2000)}`);
  }
  const findings = Array.isArray(report.findings) ? report.findings : [];
  if (baseLocale && Array.isArray(report.locales) && !report.locales.includes(baseLocale)) {
    findings.push({ level: "warn", where: "check_glossary", msg: `no file has the base locale "${baseLocale}", so translations and keys in code were not checked` });
  }
  const result = {
    ok: report.errors === 0,
    errors: report.errors ?? 0,
    warnings: findings.filter((f) => f.level === "warn").length,
    entries: report.entries ?? 0,
    locales: report.locales ?? [],
    files: [...coreFiles, ...paths],
    findings,
  };
  if (typeof report.base === "string") result.base = report.base;
  if (scanDir) result.scan = scanDir;
  return dataResult(result);
}

/* ================================================================== new_glossary_entry */

function draftEntry({ key, title, short, body, aliases, see, note, locale }) {
  const problems = [];
  const problem = (level, field, msg) => problems.push({ level, field, msg });
  const k = String(key).trim();
  const loc = given(locale) ? String(locale).trim() : "en";

  if (!KEY_RE.test(k)) problem("error", "key", `"${k}" is not a key: parts of letters, digits, _ and - separated by dots, e.g. shop.cart`);
  else {
    if (!k.includes(".")) problem("warn", "key", 'prefix the key with the project, e.g. "myapp.term", so it never clashes with the core glossary');
    if (k.split(".").some((part) => /^\d+$/.test(part))) problem("warn", "key", "avoid parts made only of digits");
  }
  if (!LOCALE_RE.test(loc)) problem("error", "locale", `"${loc}" is not a locale like en, de or pt-BR`);

  const entry = {};
  const t = String(title).trim();
  if (!t) problem("error", "title", 'needs a "title"');
  entry.title = t;
  const s = String(short).trim();
  const b = given(body) ? String(body).trim() : "";
  if (s) entry.short = s;
  if (b) entry.body = b;
  if (!s && !b) problem("error", "short", 'needs "short" or "body"');
  else if (!s) problem("warn", "short", 'no "short" (one line, used in lists and simple tooltips)');
  if (s.length > MAX_SHORT) problem("error", "short", `"short" has ${s.length} characters (max ${MAX_SHORT}); move details into "body"`);
  if (/\n/.test(s)) problem("warn", "short", '"short" is one line');

  if (given(aliases)) {
    const list = aliases.map((a) => String(a).trim());
    if (list.some((a) => !a)) problem("warn", "aliases", "empty alias");
    if (list.filter(Boolean).length) entry.aliases = list.filter(Boolean);
  }
  if (given(see)) {
    const list = see.map((x) => String(x).trim()).filter(Boolean);
    for (const x of list) if (!KEY_RE.test(x)) problem("error", "see", `"${x}" is not a key`);
    if (list.length) entry.see = list;
  }
  if (given(note)) entry.note = String(note).trim();

  // Links and live values, checked like tools/deeptip-check.mjs does.
  const links = [];
  const vars = [];
  for (const [field, src] of [["short", s], ["body", b]]) {
    if (!src) continue;
    const refs = collectRefs(src);
    links.push(...refs.links);
    vars.push(...refs.vars);
    const plainText = [];
    const walk = (nodes) => nodes.forEach((n) => (n.t === "text" ? plainText.push(n.v) : n.c && walk(n.c)));
    for (const blk of parseText(src)) (blk.type === "ul" ? blk.items : [blk.c]).forEach(walk);
    if (/\[\[|\]\]/.test(plainText.join(" "))) problem("warn", field, "unparsed [[ or ]]: a link key is invalid (letters, digits, _ - and dots only)");
  }
  for (const x of entry.see ?? []) if (KEY_RE.test(x)) links.push(x);
  if (links.includes(k)) problem("warn", "body", "links to itself");
  for (const [field, value] of [["title", t], ["short", s], ["body", b], ["note", entry.note ?? ""]]) {
    if (/<\/?[A-Za-z][A-Za-z0-9-]*(\s[^<>]*)?\/?>/.test(value)) problem("warn", field, "looks like HTML; glossary texts use **bold**, *italic*, `code` and [[links]] only");
  }

  const inner = JSON.stringify(entry, null, 2).split("\n").join("\n  ");
  return {
    valid: !problems.some((p) => p.level === "error"),
    key: k,
    locale: loc,
    entry,
    snippet: `  ${JSON.stringify(k)}: ${inner}`,
    file: `${JSON.stringify({ $schema: SCHEMA_URL, $locale: loc, [k]: entry }, null, 2)}\n`,
    links: [...new Set(links)],
    live_values: [...new Set(vars)],
    problems,
  };
}

/* ================================================================== tools */

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const strList = (description, extra = {}) => ({ type: "array", items: { type: "string" }, description, ...extra });
const noArgs = () => ({ type: "object", properties: {}, additionalProperties: false });
const withEnum = (schema, values) => (values.length ? { ...schema, enum: values } : schema);

const FRAMEWORKS_OUT = {
  type: "object",
  properties: {
    frameworks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "folder name, the argument of get_guide" },
          title: { type: "string" },
          language: { type: "string" },
          tier: { type: "integer" },
          kind: { type: "string", description: "runtime or adapter: ready code; guide: exact build guide" },
          status: { type: "string" },
          version: { type: "string" },
          uses: { type: "array", items: { type: "string" }, description: "frameworks it builds on (web = the web runtime)" },
          guide: { type: "string", description: "resource URI of the guide" },
          implementation: { type: "string", description: "where the code lives when it is not in this repository" },
        },
        required: ["name", "title", "language", "tier", "kind", "status", "uses", "guide"],
      },
    },
  },
  required: ["frameworks"],
};
const DETECT_OUT = {
  type: "object",
  properties: {
    path: { type: "string" },
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          framework: { type: "string" },
          title: { type: "string" },
          kind: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["framework", "title", "kind", "confidence", "reasons"],
      },
    },
    scanned: {
      type: "object",
      properties: { directories: { type: "integer" }, files: { type: "integer" }, max_depth: { type: "integer" }, truncated: { type: "boolean" } },
      required: ["directories", "files", "max_depth", "truncated"],
    },
    hint: { type: "string" },
  },
  required: ["path", "candidates", "scanned", "hint"],
};
const CHECK_OUT = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "true when the validator found no errors" },
    errors: { type: "integer" },
    warnings: { type: "integer" },
    entries: { type: "integer", description: "entries of the base locale" },
    locales: { type: "array", items: { type: "string" } },
    base: { type: "string" },
    files: { type: "array", items: { type: "string" }, description: "files and folders checked, in layer order" },
    scan: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: { level: { type: "string", enum: ["error", "warn", "info"] }, where: { type: "string" }, msg: { type: "string" } },
        required: ["level", "where", "msg"],
      },
    },
  },
  required: ["ok", "errors", "warnings", "entries", "locales", "files", "findings"],
};
const ENTRY_OUT = {
  type: "object",
  properties: {
    valid: { type: "boolean", description: "no problem of level error" },
    key: { type: "string" },
    locale: { type: "string" },
    entry: {
      type: "object",
      properties: {
        title: { type: "string" },
        short: { type: "string" },
        body: { type: "string" },
        aliases: { type: "array", items: { type: "string" } },
        see: { type: "array", items: { type: "string" } },
        note: { type: "string" },
      },
      required: ["title"],
    },
    snippet: { type: "string", description: '"key": {…} to paste into the top level of deeptip/<locale>.json' },
    file: { type: "string", description: "a complete glossary file with only this entry" },
    links: { type: "array", items: { type: "string" }, description: "keys this entry links to; each must exist in the glossary" },
    live_values: { type: "array", items: { type: "string" }, description: "{name} values the host fills in" },
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: { level: { type: "string", enum: ["error", "warn"] }, field: { type: "string" }, msg: { type: "string" } },
        required: ["level", "field", "msg"],
      },
    },
  },
  required: ["valid", "key", "locale", "entry", "snippet", "file", "links", "live_values", "problems"],
};

const TOOLS = [
  {
    name: "deeptip_overview",
    title: "DeepTip overview",
    description: "What DeepTip is, its rules and how to pick a framework (from the Agent Skill). Call it first when DeepTip, nested tooltips or Paradox-style tooltips come up.",
    input: noArgs,
    run: () => textResult(overview()),
  },
  {
    name: "list_frameworks",
    title: "List DeepTip frameworks",
    description: "Every framework DeepTip supports (frameworks/*/deeptip.json): name, title, language, tier, kind (runtime or adapter = ready code, guide = exact build guide) and status.",
    input: noArgs,
    output: FRAMEWORKS_OUT,
    run: () =>
      dataResult({
        frameworks: frameworks().map((f) => {
          const item = {
            name: f.dir,
            title: String(f.title ?? f.dir),
            language: String(f.language ?? ""),
            tier: Number.isInteger(f.tier) ? f.tier : 0,
            kind: String(f.kind ?? ""),
            status: String(f.status ?? ""),
            version: String(f.version ?? ""),
            uses: Array.isArray(f.uses) ? f.uses.map(String) : [],
            guide: `deeptip://frameworks/${f.dir}`,
          };
          if (typeof f.implementation === "string") item.implementation = f.implementation;
          return item;
        }),
      }),
  },
  {
    name: "get_guide",
    title: "Read a framework guide",
    description: "A framework's guide (frameworks/<name>/README.md), whole or one section. Read the whole guide before writing DeepTip code for that framework.",
    input: () => ({
      type: "object",
      properties: {
        framework: withEnum(str("Framework name as in list_frameworks"), frameworks().map((f) => f.dir).sort()),
        section: str('Only this section: its number or heading text, e.g. "7.1" or "Placement". Omit for the whole guide.'),
      },
      required: ["framework"],
      additionalProperties: false,
    }),
    run: ({ framework, section }) => {
      const { hit, matches, all } = findFramework(framework);
      if (!hit) {
        throw new ToolError(
          matches.length > 1
            ? `"${framework}" matches ${matches.map((f) => f.dir).join(", ")}; name one of them.`
            : `Unknown framework "${framework}". Frameworks: ${all.map((f) => f.dir).join(", ")}.`,
        );
      }
      const file = `frameworks/${hit.dir}/README.md`;
      return textResult(pickSection(readRepo(file), section, file));
    },
  },
  {
    name: "get_spec",
    title: "Read the DeepTip specification",
    description: "The contract (SPEC.md), whole or one section: data format §2, behaviour §3, placement §4, input §5, accessibility §6, options §7, styling §8, porting §9.",
    input: () => ({
      type: "object",
      properties: { section: str('Only this section: its number or heading text, e.g. "2.4", "§3" or "Placement". Omit for the whole document.') },
      additionalProperties: false,
    }),
    run: ({ section }) => textResult(pickSection(readRepo("SPEC.md"), section, "SPEC.md")),
  },
  {
    name: "get_algorithms",
    title: "Read the DeepTip algorithms",
    description: "Every algorithm of the reference as language-neutral pseudo-code (docs/algorithms.md), whole or one section: §1 data, §2 markup parser … §8 placement … §12 encyclopedia.",
    input: () => ({
      type: "object",
      properties: { section: str('Only this section: its number or heading text, e.g. "§8", "9.3" or "Placement". Omit for the whole document.') },
      additionalProperties: false,
    }),
    run: ({ section }) => textResult(pickSection(readRepo("docs/algorithms.md"), section, "docs/algorithms.md")),
  },
  {
    name: "detect_framework",
    title: "Detect a project's framework",
    description: "Which DeepTip guide fits a project: looks through that folder (4 levels deep, without dependencies, build output and hidden folders) for marker files and dependencies and returns ranked candidates with reasons. Only reads.",
    input: () => ({
      type: "object",
      properties: { path: str("The project's folder, best as an absolute path (a relative one is resolved against the server's working directory)") },
      required: ["path"],
      additionalProperties: false,
    }),
    output: DETECT_OUT,
    run: ({ path }) => dataResult(detect(clientPath(path, "directory"))),
  },
  {
    name: "check_glossary",
    title: "Check glossary files",
    description: "Validate DeepTip glossary files with the repository's validator (tools/deeptip-check.mjs): broken links, missing translations, invalid keys, missing or too long short texts and, with scan, keys used in code but not defined. Returns the findings; the goal is 0 errors.",
    input: () => ({
      type: "object",
      properties: {
        files: strList("Glossary JSON files or folders of them, best as absolute paths; files of one locale are layers in this order", { minItems: 1 }),
        base: str("Reference locale for the translation checks, e.g. en (default: the locale of the first file)"),
        scan: str('Source folder to scan for keys used in code (data-deeptip="key", deeptip("key"), [[key]] …)'),
        core: { type: "boolean", description: "Put DeepTip's core glossary (glossary/core/<locale>.json: the deeptip.* help and general terms) first for each locale, as the runtimes load it (default true)" },
      },
      required: ["files"],
      additionalProperties: false,
    }),
    output: CHECK_OUT,
    run: (args, ctx) => checkGlossary(args, ctx.signal),
  },
  {
    name: "new_glossary_entry",
    title: "Draft a glossary entry",
    description: 'Build one glossary entry and check it: key format, "short" on one line with at most 140 characters, link and markup syntax, no HTML. Returns the entry, a snippet for deeptip/<locale>.json, a minimal file and the problems found. Writes nothing.',
    input: () => ({
      type: "object",
      properties: {
        key: str("Dotted, language-neutral key prefixed with the project, e.g. shop.cart"),
        title: str("The term as the UI shows it"),
        short: str("One line, at most 140 characters"),
        body: str("2-5 sentences with [[key]] or [[key|text]] links, **bold**, *italic*, `code`, {live_value} and lines starting with '- '"),
        aliases: strList("Other names of the term as the UI or texts use them"),
        see: strList('Keys shown as "See also"'),
        note: str("For writers and translators; never shown"),
        locale: str("Locale of the glossary file, e.g. en or de (default en)"),
      },
      required: ["key", "title", "short"],
      additionalProperties: false,
    }),
    output: ENTRY_OUT,
    run: (args) => dataResult(draftEntry(args)),
  },
  {
    name: "get_example_glossary",
    title: "Example glossary",
    description: "The example glossary every framework example uses (glossary/example/<locale>.json): a complete file in the DeepTip format with links, live values and fallback.",
    input: () => ({
      type: "object",
      properties: { locale: withEnum(str("Locale of the example glossary"), exampleLocales()) },
      required: ["locale"],
      additionalProperties: false,
    }),
    run: ({ locale }) => {
      const available = exampleLocales();
      const loc = String(locale).trim();
      if (!available.includes(loc)) throw new ToolError(`No example glossary for "${loc}". Locales: ${available.join(", ")}.`);
      return textResult(readRepo(`glossary/example/${loc}.json`));
    },
  },
];

const ANNOTATIONS = { readOnlyHint: true, openWorldHint: false };
const toolInfo = (t) => ({
  name: t.name,
  title: t.title,
  description: t.description,
  inputSchema: t.input(),
  ...(t.output ? { outputSchema: t.output } : {}),
  annotations: { title: t.title, ...ANNOTATIONS },
});

/** Checks the arguments against the tool's input schema (the subset these schemas use). */
function checkArgs(schema, args) {
  const problems = [];
  const props = schema.properties ?? {};
  for (const name of schema.required ?? []) if (args[name] === undefined || args[name] === null) problems.push(`"${name}" is required`);
  for (const [name, value] of Object.entries(args)) {
    const p = props[name];
    if (!p) {
      problems.push(`unknown argument "${name}" (arguments: ${Object.keys(props).join(", ") || "none"})`);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (p.type === "string" && typeof value !== "string") problems.push(`"${name}" must be a string`);
    if (p.type === "boolean" && typeof value !== "boolean") problems.push(`"${name}" must be true or false`);
    if (p.type === "array") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) problems.push(`"${name}" must be a list of strings`);
      else if (p.minItems && value.length < p.minItems) problems.push(`"${name}" needs at least ${p.minItems} item(s)`);
    }
  }
  return problems;
}

async function callTool(params, ctx) {
  if (typeof params.name !== "string") throw new RpcError(CODE.params, 'Invalid params: "name" must be a string');
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) throw new RpcError(CODE.params, `Unknown tool: ${params.name}`);
  const args = params.arguments ?? {};
  if (!isObject(args)) throw new RpcError(CODE.params, 'Invalid params: "arguments" must be an object');
  const problems = checkArgs(tool.input(), args);
  if (problems.length) return errorResult(`Invalid arguments for ${tool.name}: ${problems.join("; ")}.`);
  try {
    return await tool.run(args, ctx);
  } catch (e) {
    if (e instanceof ToolError) return errorResult(e.message);
    if (e?.name === "AbortError") throw e;
    process.stderr.write(`deeptip-mcp: ${tool.name} failed: ${e?.stack ?? e}\n`);
    return errorResult(`${tool.name} failed: ${e?.message ?? e}`);
  }
}

/* ================================================================== resources */

function resources() {
  const kindText = (f) => (isCode(f) ? "ready code" : onWebRuntime(f) ? "guide on the web runtime" : "exact build guide");
  return [
    { uri: "deeptip://spec", file: "SPEC.md", name: "deeptip-spec", title: "DeepTip specification", mimeType: "text/markdown", description: "The contract (SPEC.md): data format §2, behaviour §3, placement §4, input §5, accessibility §6, options §7, styling §8, porting §9." },
    { uri: "deeptip://algorithms", file: "docs/algorithms.md", name: "deeptip-algorithms", title: "DeepTip algorithms", mimeType: "text/markdown", description: "Every algorithm of the reference as language-neutral pseudo-code (docs/algorithms.md), §1 data … §12 encyclopedia." },
    { uri: "deeptip://skill", file: "skill/deeptip/SKILL.md", name: "deeptip-skill", title: "DeepTip Agent Skill", mimeType: "text/markdown", description: "The Agent Skill (SKILL.md): rules, behaviour, glossary format, workflows, framework table and checklist." },
    { uri: "deeptip://schema", file: "schema/deeptip.schema.json", name: "deeptip-schema", title: "DeepTip glossary JSON Schema", mimeType: "application/schema+json", description: "JSON Schema of one glossary file (schema/deeptip.schema.json)." },
    ...frameworks().map((f) => ({
      uri: `deeptip://frameworks/${f.dir}`,
      file: `frameworks/${f.dir}/README.md`,
      name: `deeptip-guide-${f.dir}`,
      title: `DeepTip guide: ${f.title ?? f.dir}`,
      mimeType: "text/markdown",
      description: `${f.title ?? f.dir} (${f.language ?? "?"}): ${kindText(f)}, frameworks/${f.dir}/README.md.`,
    })),
  ].filter((r) => existsSync(join(ROOT, r.file)));
}

function listResources() {
  return {
    resources: resources().map(({ file, ...r }) => {
      try {
        return { ...r, size: statSync(join(ROOT, file)).size };
      } catch {
        return r;
      }
    }),
  };
}

function readResource(params, ctx) {
  if (typeof params.uri !== "string") throw new RpcError(CODE.params, 'Invalid params: "uri" must be a string');
  const uri = params.uri.replace(/#.*$/, ""); // the fragment is not part of the resource (RFC 3986)
  const r = resources().find((x) => x.uri === uri);
  if (!r) throw new RpcError(ctx.era === "legacy" ? CODE.notFoundLegacy : CODE.params, "Resource not found", { uri: params.uri });
  return { contents: [{ uri: r.uri, mimeType: r.mimeType, text: readRepo(r.file) }] };
}

/* ================================================================== prompts */

const PROMPT = {
  name: "add-deeptip",
  title: "Add DeepTip to this project",
  description: "Steps to add DeepTip to the current project with this server's tools: framework, guide, glossary, marked elements, validation, checklist.",
  arguments: [
    { name: "framework", title: "Framework", description: "Framework name as in list_frameworks (e.g. web, react, unity, godot); omit to detect it", required: false },
    { name: "locale", title: "Language", description: "Locale of the first glossary, e.g. en or de; default: the user's language", required: false },
  ],
};

function getPrompt(params) {
  if (typeof params.name !== "string") throw new RpcError(CODE.params, 'Invalid params: "name" must be a string');
  if (params.name !== PROMPT.name) throw new RpcError(CODE.params, `Unknown prompt: ${params.name}`);
  const args = params.arguments ?? {};
  if (!isObject(args)) throw new RpcError(CODE.params, 'Invalid params: "arguments" must be an object');
  for (const [k, v] of Object.entries(args)) {
    if (!PROMPT.arguments.some((a) => a.name === k)) throw new RpcError(CODE.params, `Invalid params: unknown argument "${k}" (framework, locale)`);
    if (v !== null && v !== undefined && typeof v !== "string") throw new RpcError(CODE.params, `Invalid params: argument "${k}" must be a string`);
  }
  let fw = null;
  if (given(args.framework)) {
    const { hit, all } = findFramework(args.framework);
    if (!hit) throw new RpcError(CODE.params, `Invalid params: unknown framework "${args.framework}"`, { frameworks: all.map((f) => f.dir) });
    fw = hit;
  }
  const locale = given(args.locale) ? args.locale.trim() : null;
  if (locale && !LOCALE_RE.test(locale)) throw new RpcError(CODE.params, `Invalid params: "${locale}" is not a locale like en, de or pt-BR`);
  const loc = locale ?? "<locale>";

  const sync = `\`node "${join(ROOT, "tools", "deeptip-sync.mjs")}" "<project>/src/deeptip"\``;
  const ways = {
    web: `copy deeptip.js and deeptip.css into the project with ${sync} (it also copies the core glossary) or load them from ${CDN}; never edit the copies, update them from the repository.`,
    code: `use it exactly as the guide says (it is in ${join(ROOT, "frameworks")}), never rewrite it.`,
    onWeb: `the web runtime (deeptip.js and deeptip.css, copied with ${sync} or loaded from ${CDN}) plus the integration exactly as the guide says.`,
    native: `implement DeepTip inside the project as the guide maps it, in this order: glossary loading and the markup parser, placement (pure functions first; they must pass the parity cases in ${join(ROOT, "test", "cases")}), window tree, hot set, grace, tendency and suppression, arming and delays, timer lock, input, accessibility, look, encyclopedia.`,
  };
  const wayOf = (f) =>
    isCode(f) ? `Ready code: ${f.dir === "web" ? ways.web : ways.code}` : onWebRuntime(f) ? `Guide on the web runtime: ${ways.onWeb}` : `Guide for a native build: ${ways.native}`;
  const titles = (pick) => frameworks().filter(pick).map((f) => f.title ?? f.dir).join(", ");
  const done = (findSection(readRepo("skill/deeptip/SKILL.md"), "Done when").text ?? "").replace(/^#.*\n+/, "").trim();

  const lines = [
    "Add DeepTip to the project in the current working directory. DeepTip = explanation windows with depth: resting the pointer on a UI element opens a window that explains it, terms inside open further windows, a click pins them; all texts live in one JSON glossary per language. Use the tools of the DeepTip MCP server.",
    "",
    fw
      ? `1. Framework: ${fw.title ?? fw.dir} (\`${fw.dir}\`). Confirm it with detect_framework on the project's root folder if the project could also be something else.`
      : "1. Framework: call detect_framework with the project's root folder and take the best candidate (check its reasons). No candidate: call deeptip_overview and build DeepTip from get_algorithms (workflow 3 of the skill).",
    `2. Read the guide completely before writing code: get_guide {"framework": "${fw ? fw.dir : "<name>"}"}. Look up details with get_spec and get_algorithms (whole or one section).`,
    "3. Build it the way the guide's kind says:",
    ...(fw
      ? [`   - ${wayOf(fw)}`]
      : [
          `   - Ready code, web: ${ways.web}`,
          `   - Ready code, ${titles((f) => isCode(f) && f.dir !== "web")}: ${ways.code}`,
          `   - Guide on the web runtime (${titles(onWebRuntime)}, also Tauri and Electron): ${ways.onWeb}`,
          `   - Guide for a native build (${titles((f) => !isCode(f) && !onWebRuntime(f))}): ${ways.native}`,
        ]),
    `4. Write the glossary deeptip/${loc}.json ${locale ? `in ${locale} first` : "in the user's language first"}, then the other languages with the same keys. Keys "<project>.<term>"; "title" is the term as the UI shows it; "short" one line (at most 140 characters); "body" 2-5 sentences linking every concept that has its own entry as [[key]] or [[key|text]]. Never HTML, never explanation text in code. get_example_glossary shows a complete file; new_glossary_entry builds and checks one entry.`,
    '5. Mark every UI element that needs an explanation with its key (web: data-deeptip="key"; other frameworks: see the guide).',
    `6. Validate: check_glossary {"files": [<the project's glossary files>], "base": "${loc}", "scan": "<source folder>"} must report 0 errors.`,
    "7. Check the behaviour against this list:",
    "",
    done,
  ];
  return {
    description: fw ? `Add DeepTip to this ${fw.title ?? fw.dir} project` : "Add DeepTip to this project",
    messages: [{ role: "user", content: { type: "text", text: `${lines.join("\n")}\n` } }],
  };
}

/* ================================================================== protocol */

const session = { version: null }; // legacy era: the version negotiated by initialize on this connection
const inflight = new Map(); // JSON id -> { cancelled, abort }

const noCursor = (params) => {
  if (params.cursor !== undefined && params.cursor !== null) throw new RpcError(CODE.params, "Invalid params: unknown cursor (every list fits on one page)");
};
const METHODS = {
  "server/discover": () => ({ supportedVersions: SUPPORTED, capabilities: CAPABILITIES, instructions: INSTRUCTIONS }),
  ping: () => ({}),
  "tools/list": (p) => (noCursor(p), { tools: TOOLS.map(toolInfo) }),
  "tools/call": callTool,
  "resources/list": (p) => (noCursor(p), listResources()),
  "resources/templates/list": (p) => (
    noCursor(p),
    {
      resourceTemplates: [
        { uriTemplate: "deeptip://frameworks/{name}", name: "deeptip-guide", title: "DeepTip framework guide", description: "The guide of one framework; {name} as in list_frameworks.", mimeType: "text/markdown" },
      ],
    }
  ),
  "resources/read": readResource,
  "prompts/list": (p) => (noCursor(p), { prompts: [PROMPT] }),
  "prompts/get": getPrompt,
};
const MODERN_ONLY = new Set(["server/discover"]);
const LEGACY_ONLY = new Set(["ping"]); // 2026-07-28 removed ping

function initialize(params) {
  // Legacy negotiation: the requested version when supported, otherwise the latest legacy version.
  session.version = LEGACY.includes(params.protocolVersion) ? params.protocolVersion : LEGACY[0];
  return { protocolVersion: session.version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS };
}

/** One request. A request with _meta[protocolVersion] is served statelessly (2026-07-28); otherwise initialize decides. */
async function request(method, rawParams, signal) {
  if (rawParams !== undefined && !isObject(rawParams)) throw new RpcError(CODE.params, "Invalid params: params must be an object");
  const params = rawParams ?? {};
  if (method === "initialize") return initialize(params);
  const meta = isObject(params._meta) ? params._meta : {};
  let era;
  const v = meta[META_VERSION];
  if (v !== undefined && typeof v !== "string") throw new RpcError(CODE.params, `Invalid params: _meta["${META_VERSION}"] must be a string`);
  if (MODERN.includes(v)) {
    if (!isObject(meta[META_CAPS])) throw new RpcError(CODE.params, `Invalid params: _meta["${META_CAPS}"] is required ({} for none)`);
    era = "modern";
  } else if (v !== undefined && !(session.version && LEGACY.includes(v))) {
    // A legacy version in _meta is only extra metadata inside an initialize session; elsewhere it is unsupported.
    const why = LEGACY.includes(v) ? ` (${v} starts with initialize)` : "";
    throw new RpcError(CODE.version, `Unsupported protocol version${why}`, { supported: SUPPORTED, requested: v });
  } else if (session.version || method === "ping") era = "legacy";
  else {
    throw new RpcError(
      CODE.params,
      `Invalid params: no protocol version. Send _meta["${META_VERSION}"] and _meta["${META_CAPS}"] with every request (MCP ${MODERN[0]}) or start with initialize (MCP ${LEGACY[0]} and earlier).`,
    );
  }
  const handler = Object.hasOwn(METHODS, method) ? METHODS[method] : null;
  if (!handler || (era === "modern" && LEGACY_ONLY.has(method)) || (era === "legacy" && MODERN_ONLY.has(method))) {
    throw new RpcError(CODE.method, `Method not found: ${method}`);
  }
  const result = await handler(params, { era, signal });
  if (era === "legacy") return result;
  return {
    resultType: "complete",
    ...result,
    ...(Object.hasOwn(TTL, method) ? { ttlMs: TTL[method], cacheScope: "public" } : {}),
    _meta: { ...result._meta, [META_SERVER]: SERVER_INFO },
  };
}

function errorObject(e) {
  if (e instanceof RpcError) return e.data === undefined ? { code: e.code, message: e.message } : { code: e.code, message: e.message, data: e.data };
  process.stderr.write(`deeptip-mcp: internal error: ${e?.stack ?? e}\n`);
  return { code: CODE.internal, message: `Internal error: ${e?.message ?? e}` };
}
// The id is left out when it could not be read (MCP: JSONRPCErrorResponse.id is optional).
const failure = (id, code, message) => (id === undefined ? { jsonrpc: "2.0", error: { code, message } } : { jsonrpc: "2.0", id, error: { code, message } });

/** One JSON-RPC message; returns the response, or null for notifications, responses and cancelled requests. */
async function handleMessage(msg) {
  if (!isObject(msg)) return failure(undefined, CODE.request, "Invalid Request: a message is a JSON-RPC 2.0 object");
  const idOk = typeof msg.id === "string" || (typeof msg.id === "number" && Number.isFinite(msg.id));
  const id = idOk ? msg.id : undefined;
  if (msg.jsonrpc !== "2.0") return failure(id, CODE.request, 'Invalid Request: "jsonrpc" must be "2.0"');
  if (typeof msg.method !== "string") {
    if ("id" in msg && ("result" in msg || "error" in msg)) return null; // a response: this server sends no requests
    return failure(id, CODE.request, 'Invalid Request: "method" must be a string');
  }
  if (!("id" in msg)) {
    if (msg.method === "notifications/cancelled" && isObject(msg.params)) {
      const job = inflight.get(JSON.stringify(msg.params.requestId));
      if (job) {
        job.cancelled = true;
        job.abort.abort();
      }
    }
    return null; // notifications/initialized and all others need no action
  }
  if (!idOk) return failure(undefined, CODE.request, "Invalid Request: the id must be a string or a number");
  const key = JSON.stringify(id);
  const job = { cancelled: false, abort: new AbortController() };
  inflight.set(key, job);
  try {
    const result = await request(msg.method, msg.params, job.abort.signal);
    return job.cancelled ? null : { jsonrpc: "2.0", id, result };
  } catch (e) {
    return job.cancelled ? null : { jsonrpc: "2.0", id, error: errorObject(e) };
  } finally {
    if (inflight.get(key) === job) inflight.delete(key);
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`); // JSON.stringify never emits a raw newline
}

async function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send(failure(undefined, CODE.parse, "Parse error: a line must be one JSON-RPC message"));
    return;
  }
  try {
    if (Array.isArray(msg)) {
      // JSON-RPC batch (only MCP 2025-03-26 had them); answered as a batch
      if (!msg.length) return send(failure(undefined, CODE.request, "Invalid Request: empty batch"));
      const out = (await Promise.all(msg.map(handleMessage))).filter(Boolean);
      if (out.length) send(out);
    } else {
      const out = await handleMessage(msg);
      if (out) send(out);
    }
  } catch (e) {
    send(failure(undefined, CODE.internal, `Internal error: ${e?.message ?? e}`));
  }
}

const MAX_LINE = 16 * 1024 * 1024;
let buffer = "";
let skipping = false; // inside a line that was too long
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (skipping) skipping = false;
    else onLine(line);
  }
  if (buffer.length > MAX_LINE) {
    buffer = "";
    skipping = true;
    send(failure(undefined, CODE.request, "Invalid Request: message larger than 16 MB"));
  }
});
// End of input is the shutdown signal: answer what is still running, then the process ends by itself.
process.stdin.on("end", () => {
  if (!skipping && buffer.trim()) onLine(buffer);
  buffer = "";
});
process.stdin.on("error", () => process.exit(0));
process.stdout.on("error", () => process.exit(0)); // the client closed the pipe
process.on("uncaughtException", (e) => process.stderr.write(`deeptip-mcp: ${e?.stack ?? e}\n`));
process.on("unhandledRejection", (e) => process.stderr.write(`deeptip-mcp: ${e?.stack ?? e}\n`));
if (process.stdin.isTTY) {
  process.stderr.write(`DeepTip MCP server ${VERSION}: an MCP client starts it and talks JSON-RPC over stdin and stdout (see mcp/README.md). Ctrl+C quits.\n`);
}
