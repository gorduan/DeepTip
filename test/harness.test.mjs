// tools/harness.mjs (the generated harness packs in skill/harnesses/) and tools/install.mjs (copying the skill and the
// packs into a project or a home folder). Every install runs in a temporary folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build, loadSource, skillVersion, renderEntry, renderText, variables, instructionsText, systemPromptText, LIMITS } from "../tools/harness.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = loadSource();
const version = skillVersion();
const read = (...p) => readFileSync(join(...p), "utf8");
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const install = (...args) => run(join(root, "tools", "install.mjs"), args);
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deeptip-harness-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const generated = (id, scope, path) => read(root, "skill", "harnesses", id, scope === "user" ? "home" : "project", ...path.split("/"));

// ---------------------------------------------------------------- tools/harness.mjs

test("harness: the generated files in skill/harnesses are up to date", () => {
  const r = run(join(root, "tools", "harness.mjs"), ["--check"]);
  assert.equal(r.status, 0, r.stderr);
});

test("harness: --check finds a changed and a stale file, writing repairs both", (t) => {
  const copy = temp(t);
  mkdirSync(join(copy, "tools"));
  mkdirSync(join(copy, "skill", "deeptip"), { recursive: true });
  cpSync(join(root, "tools", "harness.mjs"), join(copy, "tools", "harness.mjs"));
  cpSync(join(root, "skill", "deeptip", "SKILL.md"), join(copy, "skill", "deeptip", "SKILL.md"));
  cpSync(join(root, "skill", "harnesses"), join(copy, "skill", "harnesses"), { recursive: true });
  const script = join(copy, "tools", "harness.mjs");
  const pointer = join(copy, "skill", "harnesses", "kiro", "project", ".kiro", "steering", "deeptip.md");
  const original = readFileSync(pointer, "utf8");
  writeFileSync(pointer, original.replace("inclusion: auto", "inclusion: always"));
  writeFileSync(join(copy, "skill", "harnesses", "stale.md"), "old\n");

  const check = run(script, ["--check"]);
  assert.equal(check.status, 1);
  assert.match(check.stderr, /out of date: skill\/harnesses\/kiro\/project\/\.kiro\/steering\/deeptip\.md/);
  assert.match(check.stderr, /not generated any more: skill\/harnesses\/stale\.md/);

  assert.equal(run(script, []).status, 0);
  assert.equal(readFileSync(pointer, "utf8"), original);
  assert.equal(existsSync(join(copy, "skill", "harnesses", "stale.md")), false);
  assert.equal(run(script, ["--check"]).status, 0);
});

test("harness: texts stay within the limits of the products", () => {
  assert.ok(source.trigger.length <= LIMITS.description, "trigger");
  assert.ok(instructionsText(source, version).length <= LIMITS.instructions, "instructions.md");
  assert.ok(systemPromptText(source).length <= LIMITS.systemPrompt, "system-prompt.md");
  assert.ok(!instructionsText(source, version).includes("{{"), "instructions.md has no placeholders left");
  for (const h of source.harnesses) {
    for (const scope of ["project", "user"]) {
      for (const e of h.files?.[scope] ?? []) {
        const body = renderText(source, e.text, variables(source, scope, version));
        if (e.always) assert.ok(body.split("\n").length <= LIMITS.alwaysLines, `${h.id} ${e.path}: always on, at most 15 lines`);
      }
    }
  }
});

test("harness: every pointer leads to the canonical skill of its scope", () => {
  for (const h of source.harnesses) {
    for (const scope of ["project", "user"]) {
      const skill = scope === "user" ? "~/.agents/skills/deeptip" : ".agents/skills/deeptip";
      for (const e of h.files?.[scope] ?? []) {
        const content = renderEntry(source, e, scope, version);
        assert.equal(generated(h.id, scope, e.path), content, `${h.id} ${e.path} matches the generated file`);
        if (e.path === ".aider.conf.yml") {
          assert.match(content, /^read: CONVENTIONS\.md$/m);
          continue;
        }
        assert.ok(content.includes(`${skill}/SKILL.md`), `${h.id} ${e.path} names ${skill}/SKILL.md`);
        if (scope === "project") assert.ok(!content.includes("~/.agents"), `${h.id} ${e.path}: no home path in a project file`);
        if (e.path.endsWith("/SKILL.md")) {
          const name = e.path.split("/").at(-2);
          assert.match(content, new RegExp(`^---\\nname: ${name}\\ndescription: ".+"\\n---\\n`), `${h.id} ${e.path}: frontmatter`);
        }
      }
    }
  }
});

test("harness: frontmatter of the rule formats", () => {
  const kiro = generated("kiro", "project", ".kiro/steering/deeptip.md");
  assert.match(kiro, /^---\ninclusion: auto\nname: deeptip\ndescription: "DeepTip: /);
  const cont = generated("continue", "project", ".continue/rules/deeptip.md");
  assert.match(cont, /\nglobs: \["\*\*\/deeptip\/\*\*"\]\nalwaysApply: false\n---\n/);
  assert.match(generated("augment", "project", ".augment/rules/deeptip.md"), /^---\ntype: agent_requested\ndescription: "/);
  assert.match(generated("augment", "user", ".augment/rules/deeptip.md"), /^---\ntype: always_apply\n---\n/);
  const agents = generated("agents-md", "project", "AGENTS.md");
  assert.ok(agents.startsWith("<!-- deeptip:begin -->\n## DeepTip\n") && agents.endsWith("<!-- deeptip:end -->\n"));
});

test("harness: knowledge pack and Modelfile", () => {
  const files = build();
  const modelfile = files.get("skill/harnesses/ollama/Modelfile");
  assert.match(modelfile, /^FROM \S+$/m);
  assert.match(modelfile, /^PARAMETER num_ctx \d+$/m);
  assert.equal(modelfile.split('"""').length, 3, 'exactly one SYSTEM """…""" string');
  assert.ok(modelfile.includes(systemPromptText(source)));
  assert.ok(files.get("skill/harnesses/knowledge/instructions.md").includes(`@v${version}/frameworks/web/`));
  const readme = files.get("skill/harnesses/README.md");
  for (const h of source.harnesses) assert.ok(readme.includes(`| ${h.title} |`), `README lists ${h.id}`);
});

// ---------------------------------------------------------------- tools/install.mjs

test("install: without --harness only the canonical skill is copied", (t) => {
  const project = temp(t);
  const r = install(project);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(project), [".agents"]);
  assert.equal(read(project, ".agents", "skills", "deeptip", "SKILL.md"), read(root, "skill", "deeptip", "SKILL.md"));
  assert.ok(existsSync(join(project, ".agents", "skills", "deeptip", "references", "SPEC.md")));
});

test("install: Claude Code gets a full copy, other harnesses their pointers", (t) => {
  const project = temp(t);
  const r = install(project, "--harness", "claude-code,cline", "--harness=kiro");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(project, ".claude", "skills", "deeptip", "SKILL.md"), read(root, "skill", "deeptip", "SKILL.md"));
  assert.equal(read(project, ".cline", "skills", "deeptip", "SKILL.md"), generated("cline", "project", ".cline/skills/deeptip/SKILL.md"));
  assert.equal(read(project, ".kiro", "steering", "deeptip.md"), generated("kiro", "project", ".kiro/steering/deeptip.md"));
});

test("install: aliases work and an unknown harness is an error", (t) => {
  const project = temp(t);
  assert.equal(install(project, "--harness", "claude").status, 0);
  assert.ok(existsSync(join(project, ".claude", "skills", "deeptip", "SKILL.md")));
  const r = install(project, "--harness", "no-such-agent");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown harness "no-such-agent"/);
});

test("install: a block keeps the rest of a shared file and is idempotent", (t) => {
  const project = temp(t);
  const mine = "# My agents\n\nBe nice.\n";
  writeFileSync(join(project, "AGENTS.md"), mine);
  assert.equal(install(project, "--harness", "agents-md").status, 0);
  const once = read(project, "AGENTS.md");
  assert.ok(once.startsWith(mine.trimEnd()));
  assert.equal(once.split("<!-- deeptip:begin -->").length, 2);
  assert.ok(once.endsWith(generated("agents-md", "project", "AGENTS.md")));
  assert.equal(read(project, "AGENTS.md.bak"), mine);

  const again = install(project, "--harness", "agents-md");
  assert.match(again.stdout, /AGENTS\.md {2}unchanged/);
  assert.equal(read(project, "AGENTS.md"), once);
  assert.equal(existsSync(join(project, "AGENTS.md.bak2")), false);

  writeFileSync(join(project, "AGENTS.md"), `${once.replace("## DeepTip", "## Old DeepTip")}\nMore of mine.\n`);
  assert.equal(install(project, "--harness", "agents-md").status, 0);
  const repaired = read(project, "AGENTS.md");
  assert.ok(repaired.includes("## DeepTip\n") && !repaired.includes("## Old DeepTip"));
  assert.ok(repaired.endsWith("More of mine.\n"));
  assert.ok(existsSync(join(project, "AGENTS.md.bak2")));
});

test("install: a changed pointer is backed up before it is replaced", (t) => {
  const project = temp(t);
  install(project, "--harness", "tabnine");
  const file = join(project, ".tabnine", "guidelines", "deeptip.md");
  writeFileSync(file, "edited\n");
  const r = install(project, "--harness", "tabnine");
  assert.match(r.stdout, /updated, old file kept as \.tabnine\/guidelines\/deeptip\.md\.bak/);
  assert.equal(read(file + ".bak"), "edited\n");
  assert.equal(read(file), generated("tabnine", "project", ".tabnine/guidelines/deeptip.md"));
});

test("install: aider leaves an existing read: key alone", (t) => {
  const project = temp(t);
  writeFileSync(join(project, ".aider.conf.yml"), "read: [NOTES.md]\n");
  const r = install(project, "--harness", "aider");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\.aider\.conf\.yml {2}skipped/);
  assert.equal(read(project, ".aider.conf.yml"), "read: [NOTES.md]\n");
  assert.ok(read(project, "CONVENTIONS.md").includes("`.agents/skills/deeptip/SKILL.md`"));

  const fresh = temp(t);
  install(fresh, "--harness", "aider");
  assert.equal(read(fresh, ".aider.conf.yml"), "# deeptip:begin\nread: CONVENTIONS.md\n# deeptip:end\n");
});

test("install: --dry-run writes nothing", (t) => {
  const project = temp(t);
  const r = install(project, "--all", "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run/);
  assert.deepEqual(readdirSync(project), []);
});

test("install: --all writes every project file of every harness", (t) => {
  const project = temp(t);
  assert.equal(install(project, "--all").status, 0);
  for (const h of source.harnesses) {
    if (h.copy?.project) assert.ok(existsSync(join(project, ...h.copy.project.split("/"), "SKILL.md")), h.id);
    for (const e of h.files?.project ?? []) assert.ok(existsSync(join(project, ...e.path.split("/"))), `${h.id}: ${e.path}`);
  }
  assert.equal(existsSync(join(project, "deeptip-chatgpt")), false, "--all installs no knowledge packs");
});

test("install: --user installs into the home folder with home paths", (t) => {
  const home = temp(t);
  const r = install("--user", "--home", home, "--harness", "claude-code,antigravity,augment");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(install("--user", home).status, 2, "a project folder together with --user is an error");
  assert.equal(install(home, "--home", home).status, 2, "--home needs --user");
  assert.ok(existsSync(join(home, ".agents", "skills", "deeptip", "SKILL.md")));
  assert.ok(existsSync(join(home, ".claude", "skills", "deeptip", "SKILL.md")));
  for (const p of [[".gemini", "config", "skills", "deeptip", "SKILL.md"], [".gemini", "antigravity-cli", "skills", "deeptip", "SKILL.md"]]) {
    assert.ok(read(home, ...p).includes("`~/.agents/skills/deeptip/SKILL.md`"), p.join("/"));
  }
  assert.match(read(home, ".augment", "rules", "deeptip.md"), /^---\ntype: always_apply\n/);
});

test("install: a knowledge pack holds the text, the core files and the framework guide", (t) => {
  const folder = temp(t);
  const r = install(folder, "--harness", "ollama,perplexity", "--framework", "web");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(folder, ".agents")), false, "no skill copy for knowledge packs only");
  const ollama = join(folder, "deeptip-ollama");
  assert.deepEqual(readdirSync(ollama).sort(), ["HOW-TO.md", "Modelfile", "SPEC.md", "algorithms.md", "deeptip.schema.json", "framework-web.md", "system-prompt.md"].sort());
  assert.equal(read(ollama, "SPEC.md"), read(root, "skill", "deeptip", "references", "SPEC.md"));
  assert.equal(read(ollama, "framework-web.md"), read(root, "skill", "deeptip", "references", "frameworks", "web", "README.md"));
  assert.ok(read(folder, "deeptip-perplexity", "instructions.md").length <= LIMITS.instructions + 1);
  assert.match(read(folder, "deeptip-perplexity", "HOW-TO.md"), /8,000 characters/);
  assert.equal(install(folder, "--harness", "ollama", "--framework", "no-such-framework").status, 2);
});

test("install: --list names every harness", () => {
  const r = install("--list");
  assert.equal(r.status, 0, r.stderr);
  for (const h of source.harnesses) assert.match(r.stdout, new RegExp(`^${h.id} `, "m"));
});
