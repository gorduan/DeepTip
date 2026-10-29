#!/usr/bin/env node
// Copy the DeepTip web runtime (+ the core glossary) into a project, e.g.
//   node deeptip-sync.mjs "../my-app/src/deeptip"
// Writes deeptip.js, deeptip.css and core/<locale>.json. Project glossaries in the target are never touched.
//   --no-core   only the runtime
//   --check     only report whether the target is up to date (exit 1 if not)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: deeptip-sync.mjs <target-dir> [--no-core] [--check]");
  process.exit(2);
}
const check = args.includes("--check");
const pairs = [
  [join(root, "frameworks", "web", "deeptip.js"), join(target, "deeptip.js")],
  [join(root, "frameworks", "web", "deeptip.css"), join(target, "deeptip.css")],
];
if (!args.includes("--no-core")) {
  const core = join(root, "glossary", "core");
  for (const f of readdirSync(core)) if (f.endsWith(".json")) pairs.push([join(core, f), join(target, "core", f)]);
}
let stale = 0;
for (const [from, to] of pairs) {
  // the core files point at the schema relative to this repo; in a project they point at nothing useful
  let src = readFileSync(from, "utf8");
  if (from.endsWith(".json")) src = src.replace(/\s*"\$schema":\s*"[^"]*",?/, "");
  const same = existsSync(to) && readFileSync(to, "utf8") === src;
  if (same) continue;
  stale++;
  if (check) console.log(`outdated: ${to}`);
  else {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, src);
    console.log(`copied  ${to}`);
  }
}
const version = /DeepTip (\d+\.\d+\.\d+)/.exec(readFileSync(pairs[0][0], "utf8"))?.[1];
console.log(stale ? `${check ? "outdated" : "synced"}: ${stale} file(s), DeepTip ${version}` : `up to date (DeepTip ${version})`);
process.exit(check && stale ? 1 : 0);
