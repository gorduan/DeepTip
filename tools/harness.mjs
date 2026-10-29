#!/usr/bin/env node
// Builds the harness packs in skill/harnesses/ from skill/harnesses/source.json, so that every AI agent and assistant
// ("harness") finds the DeepTip Agent Skill. Most agents read the skill from .agents/skills/deeptip/ themselves; the
// others get a small pointer in their own format, and chat assistants and local front-ends get a knowledge pack.
//   skill/harnesses/<id>/project/<path>  copied into a project root
//   skill/harnesses/<id>/home/<path>     copied into the home folder
//   skill/harnesses/knowledge/           the knowledge pack (texts to paste, files to upload)
//   skill/harnesses/<id>/<file>          product files such as the Ollama Modelfile
//   skill/harnesses/README.md            the tables between the <!-- generated:… --> markers
//   node tools/harness.mjs          write the generated files (and remove generated files that are gone from the source)
//   node tools/harness.mjs --check  report differences only, exit code 1 if anything is out of date
// tools/install.mjs uses the same functions to install the packs.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = "skill/harnesses";
export const SCOPES = ["project", "user"];
export const LIMITS = { description: 1024, instructions: 8000, systemPrompt: 6000, alwaysLines: 15 };
const FOLDER = { project: "project", user: "home" };

export const loadSource = (base = root) => JSON.parse(readFileSync(join(base, DIR, "source.json"), "utf8"));

/** The skill's version from the metadata of skill/deeptip/SKILL.md. */
export function skillVersion(base = root) {
  const md = readFileSync(join(base, "skill", "deeptip", "SKILL.md"), "utf8");
  return /^\s*version:\s*"?([^"\s]+)"?/m.exec(md)?.[1] ?? "0.0.0";
}

/** Values for the {{placeholders}} of one install scope ("project" or "user"). */
export function variables(source, scope, version) {
  return { ...source.scopes[scope], version, trigger: source.trigger, systemPrompt: source.systemPrompt.join("\n") };
}

/** Replace {{name}} with a variable or a text of source.texts (rendered in turn); unknown names stay. */
export function fill(text, source, vars, depth = 0) {
  if (depth > 5) throw new Error("source.json: texts nest too deep");
  return text.replace(/\{\{([A-Za-z]+)\}\}/g, (all, name) => {
    if (name in vars) return vars[name];
    if (source.texts[name]) return fill(source.texts[name].join("\n"), source, vars, depth + 1);
    return all;
  });
}

export function renderText(source, name, vars) {
  if (!source.texts[name]) throw new Error(`source.json: there is no text "${name}"`);
  return fill(source.texts[name].join("\n"), source, vars);
}

// YAML frontmatter: plain scalars where that is safe, JSON-style double quotes (valid YAML) everywhere else.
const PLAIN = /^[A-Za-z_][A-Za-z0-9_ ./-]*[A-Za-z0-9_/]$|^[A-Za-z_]$/;
function yamlValue(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(", ")}]`;
  const s = String(value);
  return PLAIN.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) ? s : JSON.stringify(s);
}
export function frontmatter(fields, source, vars) {
  if (!fields) return "";
  const expand = (v) => (typeof v === "string" ? fill(v, source, vars) : Array.isArray(v) ? v.map(expand) : v);
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${yamlValue(expand(value))}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/** The markers around a DeepTip block in a shared file (AGENTS.md, CONVENTIONS.md, .aider.conf.yml …). */
export const markers = (path) =>
  /\.ya?ml$/i.test(path)
    ? { begin: "# deeptip:begin", end: "# deeptip:end" }
    : { begin: "<!-- deeptip:begin -->", end: "<!-- deeptip:end -->" };

/** The content of one file entry of a harness for one scope; blocks come with their markers. */
export function renderEntry(source, entry, scope, version) {
  const vars = variables(source, scope, version);
  const body = renderText(source, entry.text, vars);
  if (entry.mode === "block") {
    const { begin, end } = markers(entry.path);
    return `${begin}\n${body}\n${end}\n`;
  }
  return `${frontmatter(entry.frontmatter, source, vars)}${body}\n`;
}

export const instructionsText = (source, version) => fill(source.instructions.join("\n"), source, variables(source, "project", version));
export const systemPromptText = (source) => source.systemPrompt.join("\n");
/** The text a knowledge pack pastes: "instructions" (≤ 8,000 chars) or "system-prompt" (small local models). */
export const knowledgeText = (source, h, version) => (h.knowledge.text === "system-prompt" ? systemPromptText(source) : instructionsText(source, version));
export const knowledgeFile = (h) => (h.knowledge.text === "system-prompt" ? "system-prompt.md" : "instructions.md");

/** Find a harness by id or alias. */
export const findHarness = (source, name) => source.harnesses.find((h) => h.id === name || (h.aliases ?? []).includes(name));

/** Everything that is wrong with the source; build() refuses to run while this list is not empty. */
export function validate(source, version) {
  const problems = [];
  const seen = new Set();
  for (const name of Object.keys(variables(source, "project", version))) if (source.texts[name]) problems.push(`texts.${name}: the name is taken by a variable`);
  if (source.scopes.project.skill !== source.skill || source.scopes.user.skill !== `~/${source.skill}`) problems.push("scopes: skill must be the canonical folder (and ~/ before it for user)");
  if (source.trigger.length > LIMITS.description || source.trigger.includes("\n")) problems.push(`trigger: one line, at most ${LIMITS.description} characters`);
  const instructions = instructionsText(source, version);
  if (instructions.length > LIMITS.instructions) problems.push(`instructions: ${instructions.length} characters, at most ${LIMITS.instructions}`);
  const prompt = systemPromptText(source);
  if (prompt.length > LIMITS.systemPrompt) problems.push(`systemPrompt: ${prompt.length} characters, at most ${LIMITS.systemPrompt} (about 1,500 tokens)`);
  if (prompt.includes('"""')) problems.push('systemPrompt: must not contain """ (it ends the Modelfile SYSTEM string)');
  for (const h of source.harnesses) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.id)) problems.push(`${h.id}: ids are lower-case words joined by "-"`);
    for (const name of [h.id, ...(h.aliases ?? [])]) {
      if (seen.has(name)) problems.push(`${name}: id or alias used twice`);
      seen.add(name);
    }
    if (!h.title || !h.docs?.length) problems.push(`${h.id}: title and docs are required`);
    if (!h.knowledge && !h.trigger) problems.push(`${h.id}: trigger is required`);
    if (h.knowledge && !["instructions", "system-prompt"].includes(h.knowledge.text)) problems.push(`${h.id}: knowledge.text is "instructions" or "system-prompt"`);
    if (!h.knowledge && !SCOPES.some((s) => h.native?.includes(s) || h.copy?.[s] || h.files?.[s]?.length)) problems.push(`${h.id}: installs nothing`);
    for (const scope of SCOPES) {
      for (const entry of h.files?.[scope] ?? []) {
        const where = `${h.id} (${scope}): ${entry.path}`;
        const vars = variables(source, scope, version);
        const body = renderText(source, entry.text, vars);
        const content = renderEntry(source, entry, scope, version);
        if (/\{\{[A-Za-z]+\}\}/.test(content)) problems.push(`${where}: placeholder left over`);
        if (entry.always && body.split("\n").length > LIMITS.alwaysLines) problems.push(`${where}: always on, so at most ${LIMITS.alwaysLines} lines`);
        if (entry.skipIf) {
          try {
            new RegExp(entry.skipIf, "m");
          } catch {
            problems.push(`${where}: skipIf is not a valid regular expression`);
          }
        }
        if (entry.mode === "block" && entry.frontmatter) problems.push(`${where}: a block has no frontmatter`);
        const description = entry.frontmatter?.description && fill(entry.frontmatter.description, source, vars);
        if (description && description.length > LIMITS.description) problems.push(`${where}: description longer than ${LIMITS.description} characters`);
        if (posix.basename(entry.path) === "SKILL.md") {
          const folder = posix.basename(posix.dirname(entry.path));
          if (entry.frontmatter?.name !== folder) problems.push(`${where}: name must be the folder name "${folder}"`);
          if (!description) problems.push(`${where}: a skill needs a description`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- README tables
const code = (s) => `\`${s}\``;
const links = (docs) => docs.map(([label, url]) => `[${label}](${url})`).join(", ");
const cell = (s) => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");

function placesOf(h, scope) {
  const home = scope === "user" ? "~/" : "";
  const out = [];
  if (h.native?.includes(scope)) out.push(`${code(`${home}.agents/skills/deeptip/`)} (reads it)`);
  if (h.copy?.[scope]) out.push(`${code(`${home}${h.copy[scope]}/`)} (full copy)`);
  for (const e of h.files?.[scope] ?? []) out.push(`[${code(home + e.path)}](${h.id}/${FOLDER[scope]}/${e.path})${e.mode === "block" ? " (block)" : ""}`);
  return out.length ? out.join("<br>") : "—";
}

function agentsTable(source) {
  const rows = ["| Agent | Project | Home folder | Trigger | Install | Limits | Docs |", "|---|---|---|---|---|---|---|"];
  const notes = [];
  for (const h of source.harnesses.filter((x) => !x.knowledge)) {
    const ownFiles = SCOPES.some((s) => h.copy?.[s] || h.files?.[s]?.length);
    const install = (ownFiles ? code(`--harness ${h.id}`) : "default") + (h.install ? `, ${h.install}` : "");
    rows.push(`| ${cell(h.title)} | ${placesOf(h, "project")} | ${placesOf(h, "user")} | ${cell(h.trigger)} | ${cell(install)} | ${cell(h.limits)} | ${links(h.docs)} |`);
    if (h.note) notes.push(`- **${h.title}:** ${h.note}`);
  }
  return [...rows, "", ...notes].join("\n");
}

function knowledgeTable(source) {
  const rows = ["| Product | Where | Text | Instructions limit | Files | Skills | Docs |", "|---|---|---|---|---|---|---|"];
  const notes = [];
  for (const h of source.harnesses.filter((x) => x.knowledge)) {
    const k = h.knowledge;
    const texts = [`[${knowledgeFile(h)}](knowledge/${knowledgeFile(h)})`, ...(k.extra ?? []).map((e) => `[${e.path}](${h.id}/${e.path})`)].join("<br>");
    rows.push(`| ${cell(h.title)} | ${cell(k.where)} | ${texts} | ${cell(k.instructions)} | ${cell(k.files)} | ${cell(k.skills)} | ${links(h.docs)} |`);
    if (k.note) notes.push(`- **${h.title}:** ${k.note}`);
  }
  return [...rows, "", ...notes].join("\n");
}

function unsupportedTable(source) {
  const rows = ["| Harness | Why | Docs |", "|---|---|---|"];
  for (const u of source.unsupported) rows.push(`| ${cell(u.title)} | ${cell(u.why)} | ${links(u.docs)} |`);
  return rows.join("\n");
}

const SECTIONS = { agents: agentsTable, knowledge: knowledgeTable, unsupported: unsupportedTable };

function readme(base, source) {
  const path = join(base, DIR, "README.md");
  if (!existsSync(path)) throw new Error(`${DIR}/README.md is missing: it holds the text around the generated tables`);
  let text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  for (const [name, render] of Object.entries(SECTIONS)) {
    const begin = `<!-- generated:${name} -->`;
    const end = `<!-- /generated:${name} -->`;
    const i = text.indexOf(begin);
    const j = text.indexOf(end);
    if (i < 0 || j < i) throw new Error(`${DIR}/README.md: the markers ${begin} and ${end} are missing`);
    text = `${text.slice(0, i + begin.length)}\n${render(source)}\n${text.slice(j)}`;
  }
  return text;
}

/** Every generated file: path relative to the repository root (with /) → content. */
export function build(base = root) {
  const source = loadSource(base);
  const version = skillVersion(base);
  const problems = validate(source, version);
  if (problems.length) throw new Error(`skill/harnesses/source.json:\n  ${problems.join("\n  ")}`);
  const out = new Map();
  for (const h of source.harnesses) {
    for (const scope of SCOPES) for (const e of h.files?.[scope] ?? []) out.set(`${DIR}/${h.id}/${FOLDER[scope]}/${e.path}`, renderEntry(source, e, scope, version));
    for (const e of h.knowledge?.extra ?? []) out.set(`${DIR}/${h.id}/${e.path}`, `${renderText(source, e.text, variables(source, "project", version))}\n`);
  }
  out.set(`${DIR}/knowledge/README.md`, `${renderText(source, "knowledgeReadme", variables(source, "project", version))}\n`);
  out.set(`${DIR}/knowledge/instructions.md`, `${instructionsText(source, version)}\n`);
  out.set(`${DIR}/knowledge/system-prompt.md`, `${systemPromptText(source)}\n`);
  out.set(`${DIR}/README.md`, readme(base, source));
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  let expected;
  try {
    expected = build();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const present = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else present.set(relative(root, p).split(sep).join("/"), p);
    }
  };
  walk(join(root, DIR));
  present.delete(`${DIR}/source.json`);
  const changed = [...expected].filter(([p, data]) => !present.has(p) || readFileSync(present.get(p), "utf8").replace(/\r\n/g, "\n") !== data).map(([p]) => p);
  const extra = [...present.keys()].filter((p) => !expected.has(p));
  if (check) {
    for (const p of changed) console.error(`out of date: ${p}`);
    for (const p of extra) console.error(`not generated any more: ${p}`);
    if (changed.length || extra.length) {
      console.error("Run: node tools/harness.mjs");
      process.exit(1);
    }
    console.log(`${DIR}: ${expected.size} files up to date`);
    return;
  }
  for (const p of extra) rmSync(join(root, p));
  for (const p of changed) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), expected.get(p));
  }
  console.log(`${DIR}: ${expected.size} files, ${changed.length} written, ${extra.length} removed`);
}

const invoked = process.argv[1] && resolve(process.argv[1]);
const self = fileURLToPath(import.meta.url);
if (invoked && (process.platform === "win32" ? invoked.toLowerCase() === self.toLowerCase() : invoked === self)) main();
