#!/usr/bin/env node
// Builds the reference folder of the Agent Skill skill/deeptip: a copy of everything an agent needs to build DeepTip in
// any program or language, so the skill works on its own once copied into an agent's skills folder.
// The copy keeps the repository layout below skill/deeptip/references/, so relative links and the tools keep working.
// Links to files that are not copied become links to GitHub.
//   node tools/skill.mjs          write skill/deeptip/references/ and skill/deeptip/LICENSE
//   node tools/skill.mjs --check  report differences only, exit code 1 if the copy is out of date
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "skill", "deeptip");
const out = join(skill, "references");
const check = process.argv.includes("--check");
const GITHUB = "https://github.com/gorduan/DeepTip";
const SKIP = new Set(["node_modules", "bin", "obj", "build", "dist", "target", "example", "test"]);

const files = (dir) => {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [dir];
  return readdirSync(full).filter((n) => !SKIP.has(n)).flatMap((n) => files(posix.join(dir, n)));
};

// What the skill carries: the contract, the algorithms, every framework README, the JavaScript code (web runtime and the
// RPG Maker plugin), the data and the tools. The Rust crate stays on GitHub (its README says how to depend on it).
const frameworks = readdirSync(join(root, "frameworks")).filter((d) => existsSync(join(root, "frameworks", d, "deeptip.json"))).sort();
const wanted = [
  "SPEC.md",
  "docs/algorithms.md",
  ...frameworks.map((d) => `frameworks/${d}/README.md`),
  ...files("frameworks/web"),
  ...files("frameworks/rpgmaker-mz/js"),
  ...files("glossary/core"),
  ...files("glossary/example"),
  ...files("schema"),
  ...files("test/cases"),
  "tools/deeptip-check.mjs",
  "tools/deeptip-sync.mjs",
];
const copied = new Set(wanted);
const copiedDirs = new Set(wanted.flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));

// Relative links in Markdown outside code fences: keep them when the target is copied, else point them at GitHub.
function rewrite(path, text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```|~~~)/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      return line.replace(/\]\(([^)\s]+)\)/g, (all, target) => {
        if (/^(https?:|mailto:|#)/.test(target)) return all;
        const [file, hash = ""] = target.split(/(?=#)/);
        const resolved = posix.normalize(posix.join(posix.dirname(path), file)).replace(/\/$/, "");
        if (resolved.startsWith("..")) return all;
        if (copied.has(resolved) || copiedDirs.has(resolved)) return all;
        const isDir = existsSync(join(root, resolved)) && statSync(join(root, resolved)).isDirectory();
        return `](${GITHUB}/${isDir ? "tree" : "blob"}/main/${resolved === "." ? "" : resolved}${hash})`;
      });
    })
    .join("\n");
}

const expected = new Map();
for (const p of wanted) {
  const data = readFileSync(join(root, p));
  expected.set(`references/${p}`, p.endsWith(".md") ? Buffer.from(rewrite(p, data.toString("utf8")), "utf8") : data);
}
expected.set(
  "references/README.md",
  Buffer.from(
    "# references\n\nA copy of the DeepTip repository's specification, algorithms, framework guides, code, data and tools, made by " +
      "`tools/skill.mjs` so this skill works offline. Do not edit it here: change the originals in " +
      `${GITHUB} and run \`npm run skill\`. Links to files that are not part of the copy point to GitHub.\n`,
    "utf8",
  ),
);
expected.set("LICENSE", readFileSync(join(root, "LICENSE")));

const present = new Map();
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p);
    else present.set(relative(skill, p).split(sep).join("/"), p);
  }
};
walk(out);
if (existsSync(join(skill, "LICENSE"))) present.set("LICENSE", join(skill, "LICENSE"));

const changed = [...expected].filter(([p, data]) => !present.has(p) || !readFileSync(present.get(p)).equals(data)).map(([p]) => p);
const extra = [...present.keys()].filter((p) => !expected.has(p));

if (check) {
  for (const p of changed) console.error(`out of date: skill/deeptip/${p}`);
  for (const p of extra) console.error(`not in the repository any more: skill/deeptip/${p}`);
  if (changed.length || extra.length) {
    console.error("Run: npm run skill");
    process.exit(1);
  }
  console.log(`skill/deeptip: ${expected.size} files up to date`);
} else {
  for (const p of extra) rmSync(join(skill, p));
  for (const [p, data] of expected) {
    mkdirSync(dirname(join(skill, p)), { recursive: true });
    writeFileSync(join(skill, p), data);
  }
  console.log(`skill/deeptip: ${expected.size} files, ${changed.length} written, ${extra.length} removed`);
}
