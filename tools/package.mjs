#!/usr/bin/env node
// One download per framework: dist/DeepTip-<name>-<version>.zip for every frameworks/<name>/deeptip.json.
// The zip mirrors the repository layout, so relative paths in the examples keep working:
//   frameworks/<name>/ (+ frameworks it builds on, "uses"), glossary/core, glossary/example, schema/, test/cases,
//   SPEC.md, docs/algorithms.md, LICENSE, and the framework's README.md at the top.
//   node tools/package.mjs            all frameworks
//   node tools/package.mjs web svelte only these
//   node tools/package.mjs --list     table of frameworks, nothing written
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const list = args.includes("--list");
const only = args.filter((a) => !a.startsWith("--"));
const SHARED = ["glossary/core", "glossary/example", "schema", "test/cases", "SPEC.md", "docs/algorithms.md", "LICENSE"];
const SKIP = new Set(["node_modules", "bin", "obj", "build", "dist", "target", ".godot", ".gradle", "Library", "Temp", "Binaries", "Intermediate", ".vs", ".idea", "__pycache__", ".venv", "build-output"]);

const frameworks = readdirSync(join(root, "frameworks"))
  .filter((d) => existsSync(join(root, "frameworks", d, "deeptip.json")))
  .map((d) => ({ dir: d, ...JSON.parse(readFileSync(join(root, "frameworks", d, "deeptip.json"), "utf8")) }))
  .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

if (list) {
  console.log("| Framework | Language | Tier | Kind | Status | Version | Folder |");
  console.log("|---|---|---|---|---|---|---|");
  for (const f of frameworks) console.log(`| ${f.title} | ${f.language} | ${f.tier} | ${f.kind} | ${f.status} | ${f.version} | frameworks/${f.dir} |`);
  process.exit(0);
}

// ---------------------------------------------------------------- minimal zip writer (deflate, CRC-32)
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0x00210000, 10); // fixed time/date (1980-01-01): reproducible zips
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, packed);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(0x00210000, 12);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

function collect(path, into) {
  const full = join(root, path);
  if (!existsSync(full)) throw new Error(`missing: ${path}`);
  if (statSync(full).isFile()) {
    into.set(path.split(sep).join("/"), full);
    return;
  }
  for (const name of readdirSync(full)) {
    if (SKIP.has(name)) continue;
    collect(join(path, name), into);
  }
}

mkdirSync(join(root, "dist"), { recursive: true });
let problems = 0;
for (const f of frameworks) {
  if (only.length && !only.includes(f.dir)) continue;
  if (!existsSync(join(root, "frameworks", f.dir, "README.md"))) {
    console.error(`frameworks/${f.dir}: README.md missing`);
    problems++;
    continue;
  }
  const files = new Map();
  for (const dir of [f.dir, ...(f.uses ?? [])]) collect(join("frameworks", dir), files);
  for (const shared of SHARED) collect(shared, files);
  const base = `DeepTip-${f.dir}-${f.version}`;
  const entries = [{ name: `${base}/README.md`, data: readFileSync(join(root, "frameworks", f.dir, "README.md")) }];
  for (const [path, full] of [...files].sort(([a], [b]) => a.localeCompare(b))) entries.push({ name: `${base}/${path}`, data: readFileSync(full) });
  const out = join(root, "dist", `${base}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(root, out)}  ${entries.length} files, ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
process.exit(problems ? 1 : 0);
