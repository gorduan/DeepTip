#!/usr/bin/env node
// Installs the DeepTip Agent Skill into a project or your home folder, plus the files that point the agents you name
// ("harnesses", see skill/harnesses/README.md) to it, or writes a knowledge pack to upload to a chat assistant.
//   node tools/install.mjs <project>                               .agents/skills/deeptip, read by most agents
//   node tools/install.mjs <project> --harness claude-code,cline   plus the files of these harnesses
//   node tools/install.mjs <project> --all                         plus the files of every harness for projects
//   node tools/install.mjs --user [--harness …|--all]              into your home folder (~/.agents/skills/deeptip …)
//   node tools/install.mjs <folder> --harness chatgpt [--framework react]   knowledge pack in <folder>/deeptip-chatgpt/
//   node tools/install.mjs --list                                  every harness and what it installs
//   --dry-run                                                      show what would happen, write nothing
//   --home <folder>                                                with --user: use this folder as the home folder
// A file that exists with other content is kept as <file>.bak (then .bak2, …) before it is replaced. In shared files
// (AGENTS.md, CONVENTIONS.md, .aider.conf.yml, .github/copilot-instructions.md) only the block between the
// deeptip:begin and deeptip:end markers is added or replaced. Nothing is ever removed.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  root,
  loadSource,
  skillVersion,
  renderEntry,
  renderText,
  variables,
  markers,
  knowledgeText,
  knowledgeFile,
  findHarness,
  validate,
} from "./harness.mjs";

const USAGE = `usage: node tools/install.mjs <project> [--harness a,b | --all] [--dry-run]
       node tools/install.mjs --user [--home <folder>] [--harness a,b | --all] [--dry-run]
       node tools/install.mjs <folder> --harness <knowledge pack> [--framework <name>]
       node tools/install.mjs --list`;

function fail(message, code = 2) {
  console.error(`${message}\n${USAGE}`);
  process.exit(code);
}

// ---------------------------------------------------------------- arguments
const opts = { harness: [], all: false, user: false, dry: false, list: false, framework: null, target: null, home: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
  const key = eq > 0 ? arg.slice(0, eq) : arg;
  const value = () => {
    const v = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (v === undefined || v.startsWith("--")) fail(`${key} needs a value`);
    return v;
  };
  if (key === "--harness" || key === "--harnesses") opts.harness.push(...value().split(",").map((s) => s.trim()).filter(Boolean));
  else if (key === "--all") opts.all = true;
  else if (key === "--user") opts.user = true;
  else if (key === "--dry-run") opts.dry = true;
  else if (key === "--list") opts.list = true;
  else if (key === "--framework") opts.framework = value();
  else if (key === "--home") opts.home = value();
  else if (key === "--help" || key === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
  else if (opts.target) fail(`only one target folder, got "${opts.target}" and "${arg}"`);
  else opts.target = arg;
}

const source = loadSource();
const version = skillVersion();
const problems = validate(source, version);
if (problems.length) fail(`skill/harnesses/source.json:\n  ${problems.join("\n  ")}`, 1);
const SKILL_DIR = join(root, "skill", "deeptip");
if (!existsSync(join(SKILL_DIR, "SKILL.md"))) fail(`missing ${join(SKILL_DIR, "SKILL.md")}`, 1);

// ---------------------------------------------------------------- --list
function describe(h, scope) {
  const home = scope === "user" ? "~/" : "";
  if (h.knowledge) return scope === "project" ? `knowledge pack: ${knowledgeFile(h)}, core files to upload` : "—";
  const parts = [];
  if (h.native?.includes(scope)) parts.push(`reads ${home}.agents/skills/deeptip/`);
  if (h.copy?.[scope]) parts.push(`copy ${home}${h.copy[scope]}/`);
  for (const e of h.files?.[scope] ?? []) parts.push(`${home}${e.path}${e.mode === "block" ? " (block)" : ""}`);
  return parts.join(", ") || "—";
}

if (opts.list) {
  const width = Math.max(...source.harnesses.map((h) => h.id.length)) + 2;
  console.log(`DeepTip skill ${version}: harnesses for --harness (aliases in brackets). Details: skill/harnesses/README.md\n`);
  for (const h of source.harnesses) {
    const aliases = h.aliases?.length ? ` [${h.aliases.join(", ")}]` : "";
    console.log(`${h.id.padEnd(width)}${h.title}${aliases}`);
    console.log(`${"".padEnd(width)}project: ${describe(h, "project")}`);
    if (!h.knowledge) console.log(`${"".padEnd(width)}home:    ${describe(h, "user")}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- what to install
const scope = opts.user ? "user" : "project";
if (opts.user && opts.target) fail(`--user installs into your home folder, not into "${opts.target}" (use --home <folder> for another home folder)`);
if (opts.home && !opts.user) fail("--home needs --user");
if (!opts.target && !opts.user) fail("which project? Give its folder, or --user for your home folder.");
// a "~" the shell did not expand (PowerShell, cmd) still means the home folder
const expandHome = (p) => (p === "~" || /^~[\\/]/.test(p) ? join(homedir(), p.slice(1)) : p);
const base = resolve(expandHome(opts.user ? (opts.home ?? homedir()) : opts.target));
const chosen = [];
for (const name of opts.harness) {
  const h = findHarness(source, name);
  if (!h) fail(`unknown harness "${name}"; see: node tools/install.mjs --list`);
  if (!chosen.includes(h)) chosen.push(h);
}
if (opts.all) for (const h of source.harnesses) if (!h.knowledge && !chosen.includes(h)) chosen.push(h);
if (opts.framework && !chosen.some((h) => h.knowledge)) console.warn("--framework is only used for knowledge packs; ignored");
if (opts.framework && !existsSync(join(SKILL_DIR, "references", "frameworks", opts.framework, "README.md"))) {
  fail(`no framework guide "${opts.framework}"; known: ${readdirSync(join(SKILL_DIR, "references", "frameworks")).join(", ")}`);
}
const onlyKnowledge = chosen.length > 0 && chosen.every((h) => h.knowledge);

// ---------------------------------------------------------------- writing with backups
const counts = { new: 0, updated: 0, unchanged: 0, skipped: 0 };
const out = (label, path, state) => console.log(`  ${label.padEnd(22)}${path}  ${state}`);
const rel = (file) => relative(base, file).split(sep).join("/");

function backupName(file) {
  let n = 1;
  let name = `${file}.bak`;
  while (existsSync(name)) name = `${file}.bak${++n}`;
  return name;
}

/** Write data to base/path unless it is already there; keep a changed file as .bak first. */
function put(path, data) {
  const file = join(base, ...path.split("/"));
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  if (existsSync(file)) {
    if (statSync(file).isDirectory()) throw new Error(`${rel(file)} is a folder, expected a file`);
    if (readFileSync(file).equals(buf)) return { state: "unchanged" };
    const bak = backupName(file);
    if (!opts.dry) {
      copyFileSync(file, bak);
      writeFileSync(file, buf);
    }
    return { state: "updated", backup: rel(bak) };
  }
  if (!opts.dry) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
  }
  return { state: "new" };
}

function report(label, path, result) {
  counts[result.state]++;
  const state = result.state === "updated" ? `updated, old file kept as ${result.backup}` : result.state === "skipped" ? `skipped: ${result.note}` : result.state;
  out(label, path, state);
}

/** Add or replace the DeepTip block (with its markers) in a shared file; the rest of the file stays. */
function putBlock(entry, content) {
  const file = join(base, ...entry.path.split("/"));
  const { begin, end } = markers(entry.path);
  let block = content.replace(/\n$/, "");
  if (!existsSync(file)) return put(entry.path, `${block}\n`);
  const old = readFileSync(file, "utf8");
  if (old.includes("\r\n")) block = block.replace(/\n/g, "\r\n");
  const nl = old.includes("\r\n") ? "\r\n" : "\n";
  const i = old.indexOf(begin);
  const j = i >= 0 ? old.indexOf(end, i) : -1;
  const inside = i >= 0 && j > i;
  const outside = inside ? old.slice(0, i) + old.slice(j + end.length) : old;
  if (entry.skipIf && new RegExp(entry.skipIf, "m").test(outside)) return { state: "skipped", note: entry.skipNote ?? "the file has its own setting" };
  const next = inside ? old.slice(0, i) + block + old.slice(j + end.length) : old.trim() ? `${old.replace(/\s+$/, "")}${nl}${nl}${block}${nl}` : `${block}${nl}`;
  return put(entry.path, next);
}

const walk = (dir, prefix = "") =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, `${prefix}${name}/`) : [`${prefix}${name}`];
  });

/** Copy skill/deeptip to base/target; report files there that are not part of the skill, never remove them. */
function copySkill(label, target) {
  const files = walk(SKILL_DIR);
  const tally = { new: 0, updated: 0, unchanged: 0 };
  const backups = [];
  for (const f of files) {
    const r = put(`${target}/${f}`, readFileSync(join(SKILL_DIR, ...f.split("/"))));
    tally[r.state]++;
    counts[r.state]++;
    if (r.backup) backups.push(r.backup);
  }
  const summary = Object.entries(tally).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");
  out(label, `${target}/`, `${files.length} files: ${summary}`);
  for (const b of backups) out("", b, "backup of a changed file");
  const dest = join(base, ...target.split("/"));
  if (existsSync(dest)) {
    const known = new Set(files);
    for (const f of walk(dest)) if (!known.has(f) && !/\.bak\d*$/.test(f)) out("", `${target}/${f}`, "not part of DeepTip any more, left in place");
  }
}

/** A folder with everything to paste and upload into a chat assistant or a local front-end. */
function knowledgePack(h) {
  const dir = `deeptip-${h.id}`;
  const k = h.knowledge;
  const refs = join(SKILL_DIR, "references");
  const files = [
    [knowledgeFile(h), `${knowledgeText(source, h, version)}\n`],
    ...(k.extra ?? []).map((e) => [e.path, `${renderText(source, e.text, variables(source, "project", version))}\n`]),
    ["SPEC.md", readFileSync(join(refs, "SPEC.md"))],
    ["algorithms.md", readFileSync(join(refs, "docs", "algorithms.md"))],
    ["deeptip.schema.json", readFileSync(join(refs, "schema", "deeptip.schema.json"))],
  ];
  if (opts.framework) files.push([`framework-${opts.framework}.md`, readFileSync(join(refs, "frameworks", opts.framework, "README.md"))]);
  const extra = (k.extra ?? []).map((e) => e.path);
  const upload = files.filter(([name]) => name !== knowledgeFile(h) && !extra.includes(name)).map(([name]) => `\`${name}\``);
  const howTo = [
    `# DeepTip for ${h.title}`,
    "",
    `1. ${k.where.charAt(0).toUpperCase()}${k.where.slice(1)}.`,
    extra.length
      ? `2. ${extra.map((e) => `\`${e}\``).join(", ")} already contains the text of \`${knowledgeFile(h)}\`.`
      : `2. Paste \`${knowledgeFile(h)}\` into the instructions (limit: ${k.instructions}).`,
    `3. Upload or attach ${upload.join(", ")}${opts.framework ? "" : " and the guide of your framework (run the installer again with `--framework <name>`)"}. Files: ${k.files}.`,
    ...(k.skills && k.skills !== "—" ? ["", `Skills: ${k.skills}.`] : []),
    ...(k.note ? ["", k.note] : []),
    "",
    `Sources: ${h.docs.map(([label, url]) => `[${label}](${url})`).join(", ")}. All products: https://github.com/gorduan/DeepTip/blob/main/skill/harnesses/README.md`,
    "",
  ].join("\n");
  files.push(["HOW-TO.md", howTo]);
  for (const [name, data] of files) report(h.id, `${dir}/${name}`, put(`${dir}/${name}`, data));
}

// ---------------------------------------------------------------- run
const where = opts.user ? "home folder" : "project";
console.log(`DeepTip skill ${version} → ${base} (${where})${opts.dry ? "  [dry run: nothing is written]" : ""}`);
const readsItself = [];
const nothing = [];
try {
  if (!onlyKnowledge) copySkill("skill", source.skill);
  for (const h of chosen) {
    if (h.knowledge) {
      if (opts.user) out(h.id, "", "skipped: a knowledge pack is uploaded by hand, not installed into the home folder");
      else knowledgePack(h);
      continue;
    }
    let did = false;
    if (h.copy?.[scope]) {
      copySkill(h.id, h.copy[scope]);
      did = true;
    }
    for (const entry of h.files?.[scope] ?? []) {
      const content = renderEntry(source, entry, scope, version);
      report(h.id, entry.path, entry.mode === "block" ? putBlock(entry, content) : put(entry.path, content));
      did = true;
    }
    if (!did) (h.native?.includes(scope) ? readsItself : nothing).push(h.id);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
if (readsItself.length) console.log(`  Read ${source.scopes[scope].skill}/ themselves, nothing else to install: ${readsItself.join(", ")}`);
if (nothing.length && !opts.all) console.log(`  Nothing to install into a ${where}: ${nothing.join(", ")} (see skill/harnesses/README.md)`);
const total = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing to do";
console.log(`${opts.dry ? "Would be" : "Done"}: ${total}.${chosen.length ? "" : " Other agents: --harness <id> (list them with --list)."}`);
if (!opts.user && chosen.some((h) => h.id === "jetbrains-ai")) {
  console.log("JetBrains AI Assistant: set the Rule type of `deeptip` to *By model decision* in Settings → Tools → AI Assistant → Rules.");
}
