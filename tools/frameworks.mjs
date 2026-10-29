#!/usr/bin/env node
// Writes the framework lists of the documentation from the manifests frameworks/*/deeptip.json and the line
// "**Recognise the project:** …" at the start of each guide's Quick start, so the lists never drift from the folders:
//   README.md               "Works with" (one row per area) and "All frameworks in detail"
//   README.de.md            "Funktioniert mit" (one row per area)
//   skill/deeptip/SKILL.md  the framework table: kind, signals in a project, guide
//   llms.txt                the framework lists: ready code, then the guides
// Only the text between <!-- generated:<name> --> and <!-- /generated:<name> --> is replaced; everything around the
// markers is written by hand. Run it after adding a framework or changing a manifest or a "Recognise the project" line.
//   node tools/frameworks.mjs          write the lists
//   node tools/frameworks.mjs --check  report differences only, exit code 1 if anything is out of date
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = "https://raw.githubusercontent.com/gorduan/DeepTip/main";
// The manifest field "area": one row of the "Works with" grid each, in this order.
const AREAS = [
  { id: "web", en: "Web", de: "Web" },
  { id: "desktop", en: "Desktop", de: "Desktop" },
  { id: "mobile", en: "Mobile", de: "Mobil" },
  { id: "games", en: "Games, engines and mods", de: "Spiele, Engines und Mods" },
  { id: "terminal", en: "Terminal", de: "Terminal" },
];
const KINDS = ["runtime", "adapter", "guide"]; // runtime and adapter: ready code in this repository
const RECOGNISE = /^\*\*Recognise the project:\*\*[ \t]*(.+?)[ \t]*$/m;
const SIGNALS_MAX = 110; // characters of a cell "Signals in a project" in SKILL.md (the first clause is always kept)
// The last row of the grid: what has no folder of its own.
const EVERYTHING_ELSE = {
  en: "| **Everything else** | any language, engine or toolkit: your AI agent builds it with the skill from [docs/algorithms.md](docs/algorithms.md) and checks it against the shared test cases |",
  de: "| **Alles andere** | jede Sprache, Engine oder jedes Toolkit: Dein KI-Agent baut es mit dem Skill aus [docs/algorithms.md](docs/algorithms.md) und prüft es an den gemeinsamen Testfällen |",
};

const isCode = (f) => f.kind === "runtime" || f.kind === "adapter";
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const repo = (url) => url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/+$/, "");
const areaIndex = (f) => AREAS.findIndex((a) => a.id === f.area);

/** Every frameworks/<dir> with a deeptip.json, in the order of the lists: area, code first, tier, title. */
function load() {
  const problems = [];
  const list = [];
  for (const dir of readdirSync(join(root, "frameworks")).sort()) {
    const at = `frameworks/${dir}`;
    if (!existsSync(join(root, at, "deeptip.json"))) continue;
    let f;
    try {
      f = JSON.parse(readFileSync(join(root, at, "deeptip.json"), "utf8"));
    } catch (e) {
      problems.push(`${at}/deeptip.json: ${e.message}`);
      continue;
    }
    const readme = join(root, at, "README.md");
    const recognise = existsSync(readme) ? RECOGNISE.exec(readFileSync(readme, "utf8"))?.[1] : null;
    if (!existsSync(readme)) problems.push(`${at}: README.md is missing`);
    else if (!recognise) problems.push(`${at}/README.md: no line "**Recognise the project:** …" (the Quick start of AGENTS.md)`);
    if (f.name !== dir) problems.push(`${at}/deeptip.json: "name" must be "${dir}"`);
    for (const k of ["title", "language"]) if (typeof f[k] !== "string" || !f[k].trim()) problems.push(`${at}/deeptip.json: "${k}" is missing`);
    if (!Number.isInteger(f.tier)) problems.push(`${at}/deeptip.json: "tier" must be a whole number`);
    if (!AREAS.some((a) => a.id === f.area)) problems.push(`${at}/deeptip.json: "area" must be one of ${AREAS.map((a) => a.id).join(", ")}`);
    if (!KINDS.includes(f.kind)) problems.push(`${at}/deeptip.json: "kind" must be one of ${KINDS.join(", ")}`);
    if (f.uses != null && !Array.isArray(f.uses)) problems.push(`${at}/deeptip.json: "uses" must be a list of framework folders`);
    list.push({ ...f, dir, uses: Array.isArray(f.uses) ? f.uses : [], recognise });
  }
  const dirs = new Set(list.map((f) => f.dir));
  for (const f of list) {
    for (const u of f.uses) if (!dirs.has(u)) problems.push(`frameworks/${f.dir}/deeptip.json: "uses" names "${u}", which is no framework folder`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
  const rank = (f) => KINDS.indexOf(f.kind);
  return list.sort(
    (a, b) => areaIndex(a) - areaIndex(b) || rank(a) - rank(b) || a.tier - b.tier || a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
  );
}

/** The kind in words: "code" or "guide", what it builds on ("uses"; the web runtime wins) and the source of a guide. */
function kindOf(f, byDir) {
  let on = null;
  if (f.uses.includes("web")) on = "the web runtime";
  else if (f.uses.length) {
    const base = byDir.get(f.uses[0]);
    on = isCode(base) ? base.title : `the ${base.title} guide`;
  }
  let detail = null;
  if (f.kind === "runtime") detail = f.dir === "web" ? "the reference" : "a complete implementation";
  else if (f.kind === "adapter") detail = on ? `adapter on ${on}` : "adapter";
  else if (on) detail = `on ${on}`;
  return { word: isCode(f) ? "code" : "guide", detail, source: f.implementation ?? null };
}
const kindText = (k, source) => `${k.word}${k.detail ? `, ${k.detail}` : ""}${k.source ? `; source: ${source(k.source)}` : ""}`;

// ------------------------------------------------------------------ "Signals in a project", from "Recognise the project"

/** Splits at sep where it is outside `code` and outside (parentheses). */
function splitTop(s, sep) {
  const parts = [];
  let depth = 0;
  let code = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "`") code = !code;
    if (code || c === "`") continue;
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (!depth && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
      i = start - 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** [start, end) of each parenthesis outside `code`, outermost only. */
function parentheses(s) {
  const found = [];
  let depth = 0;
  let code = false;
  let open = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "`") code = !code;
    if (code || c === "`") continue;
    if (c === "(" && depth++ === 0) open = i;
    else if (c === ")" && depth > 0 && --depth === 0) found.push([open, i + 1]);
  }
  return found;
}

/**
 * Drops asides in parentheses, the last first, as long as the item keeps at least one `code` signal. A name of one or
 * two capitalised words stays: "(WordPress)", "(Razor Pages)" say which framework the signal belongs to.
 */
function compact(item) {
  let s = item;
  for (const [a, b] of parentheses(item).reverse()) {
    if (/^\([A-Z][\w.+-]*(?: [A-Z][\w.+-]*)?\)$/.test(s.slice(a, b))) continue;
    const shorter = `${s.slice(0, a).trimEnd()}${s.slice(b)}`.trim();
    if (/`[^`]+`/.test(shorter)) s = shorter;
  }
  return s;
}

/** The first clause of "Recognise the project" (up to ";"), without asides, cut after the items that fit. */
function signals(text) {
  const first = splitTop(text.replace(/[\s.]+$/, ""), ";")[0] ?? "";
  const items = splitTop(first, ", ").map(compact);
  let out = items[0] ?? "";
  for (const item of items.slice(1)) {
    if (out.length + 2 + item.length > SIGNALS_MAX) break;
    out += `, ${item}`;
  }
  return out;
}

// ------------------------------------------------------------------ the generated parts

function worksWith(list, lang) {
  const de = lang === "de";
  const rows = [de ? "| Bereich | Frameworks |" : "| Area | Frameworks |", "|---|---|"];
  for (const area of AREAS) {
    const items = list
      .filter((f) => f.area === area.id)
      .map((f) => {
        const link = `[${f.title}](frameworks/${f.dir})`;
        let s = isCode(f) ? `**${link}**` : link;
        if (f.dir === "web") s += de ? " (Referenz)" : " (the reference)";
        if (f.implementation) s += ` ([${de ? "Quelle" : "source"}](${f.implementation}))`;
        return s;
      });
    if (items.length) rows.push(`| **${cell(de ? area.de : area.en)}** | ${cell(items.join(" · "))} |`);
  }
  rows.push(EVERYTHING_ELSE[de ? "de" : "en"]);
  return rows.join("\n");
}

function frameworkTable(list, byDir) {
  const rows = ["| Framework | Language | Tier | Kind | Folder |", "|---|---|---|---|---|"];
  for (const f of list) {
    const kind = kindText(kindOf(f, byDir), (url) => `[${repo(url)}](${url})`);
    rows.push(`| ${cell(f.title)} | ${cell(f.language)} | ${f.tier} | ${cell(kind)} | [frameworks/${f.dir}](frameworks/${f.dir}) |`);
  }
  return rows.join("\n");
}

function skillTable(list, byDir) {
  const rows = ["| Framework | Kind | Signals in a project | Guide |", "|---|---|---|---|"];
  for (const f of list) {
    const kind = kindText(kindOf(f, byDir), repo);
    rows.push(`| ${cell(f.title)} | ${cell(kind)} | ${cell(signals(f.recognise))} | \`references/frameworks/${f.dir}/README.md\` |`);
  }
  return rows.join("\n");
}

function llmsLists(list, byDir) {
  const line = (f) => {
    const k = kindOf(f, byDir);
    const note = [f.area, k.detail].filter(Boolean).join(", ") + (k.source ? `; source: ${k.source}` : "");
    return `- [${f.title}](${RAW}/frameworks/${f.dir}/README.md): ${note}`;
  };
  return [
    "Ready code (use it as it is, never rewrite it):",
    "",
    ...list.filter(isCode).map(line),
    "",
    "Exact guides, no code (build DeepTip inside the project exactly as the guide says):",
    "",
    ...list.filter((f) => !isCode(f)).map(line),
  ].join("\n");
}

// ------------------------------------------------------------------ files

/** Replaces the text between the markers <!-- generated:name --> and <!-- /generated:name --> of one file. */
function between(text, file, name, body) {
  const begin = `<!-- generated:${name} -->`;
  const end = `<!-- /generated:${name} -->`;
  const i = text.indexOf(begin);
  const j = text.indexOf(end);
  if (i < 0 || j < i) throw new Error(`${file}: the markers ${begin} and ${end} are missing`);
  return `${text.slice(0, i + begin.length)}\n${body}\n${text.slice(j)}`;
}

/** Every file this tool writes: path relative to the repository root → its expected content. */
function build() {
  const list = load();
  const byDir = new Map(list.map((f) => [f.dir, f]));
  const parts = {
    "README.md": { "works-with": worksWith(list, "en"), "framework-table": frameworkTable(list, byDir) },
    "README.de.md": { "works-with": worksWith(list, "de") },
    "skill/deeptip/SKILL.md": { "framework-table": skillTable(list, byDir) },
    "llms.txt": { "framework-lists": llmsLists(list, byDir) },
  };
  const out = new Map();
  for (const [file, sections] of Object.entries(parts)) {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`${file} is missing`);
    let text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    for (const [name, body] of Object.entries(sections)) text = between(text, file, name, body);
    out.set(file, text);
  }
  return { out, count: list.length };
}

function main() {
  const check = process.argv.includes("--check");
  let result;
  try {
    result = build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const changed = [...result.out].filter(([file, text]) => readFileSync(join(root, file), "utf8") !== text).map(([file]) => file);
  if (check) {
    for (const file of changed) console.error(`out of date: ${file}`);
    if (changed.length) {
      console.error("Run: npm run frameworks");
      process.exit(1);
    }
    console.log(`frameworks: ${result.count} frameworks, ${result.out.size} files up to date`);
    return;
  }
  for (const file of changed) writeFileSync(join(root, file), result.out.get(file));
  console.log(`frameworks: ${result.count} frameworks, ${changed.length} of ${result.out.size} files written${changed.length ? ` (${changed.join(", ")})` : ""}`);
}

main();
