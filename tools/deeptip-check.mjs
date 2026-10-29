#!/usr/bin/env node
// DeepTip glossary check (SPEC §2.8): broken links, missing translations, overlong texts, unused entries and
// keys used in source code that no glossary defines. Exit code 1 on errors (and on warnings with --strict).
//
//   node deeptip-check.mjs [options] <file.json | dir>...
//     --base <locale>    reference locale for translation checks (default: locale of the first file)
//     --locales a,b      only check these locales
//     --scan <dir>       also scan source files: keys used there must exist, entries used nowhere are reported
//     --max-short <n>    longest allowed "short" (default 140 characters)
//     --strict           warnings fail too
//     --json             machine-readable output
//
// Files of the same locale are layers in the order given (core first, project after); later ones override.
// The locale comes from "$locale" or the file name (de.json, myapp.de.json, en-US.json).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { flattenGlossary, parseText, collectRefs, KEY_RE } from "../frameworks/web/deeptip.js";

const args = process.argv.slice(2);
const opt = { base: null, locales: null, scan: [], maxShort: 140, strict: false, json: false, paths: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") opt.base = args[++i];
  else if (a === "--locales") opt.locales = args[++i].split(",").map((s) => s.trim());
  else if (a === "--scan") opt.scan.push(args[++i]);
  else if (a === "--max-short") opt.maxShort = +args[++i];
  else if (a === "--strict") opt.strict = true;
  else if (a === "--json") opt.json = true;
  else if (a === "-h" || a === "--help") {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).join("\n").replace(/^\/\/ ?/gm, ""));
    process.exit(0);
  } else opt.paths.push(a);
}
if (!opt.paths.length) {
  console.error("usage: deeptip-check.mjs [--base de] [--locales de,en] [--scan src] [--strict] <file|dir>...");
  process.exit(2);
}

const findings = [];
const add = (level, where, msg) => findings.push({ level, where, msg });

/* ---------------------------------------------------------------- load */
const files = [];
for (const p of opt.paths) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p).sort()) if (extname(f) === ".json") files.push(join(p, f));
  } else files.push(p);
}
const layers = new Map(); // locale -> [{file, entries}]
for (const file of files) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    add("error", file, `invalid JSON: ${e.message}`);
    continue;
  }
  const { entries, meta, problems } = flattenGlossary(json);
  const m = /(?:^|\.)([a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.exec(basename(file, ".json"));
  const locale = typeof meta.$locale === "string" ? meta.$locale : m?.[1];
  if (!locale) {
    add("error", file, 'locale unknown: add "$locale" or name the file like de.json');
    continue;
  }
  for (const p of problems) add("error", `${file} ${p.key}`, p.msg);
  if (!layers.has(locale)) layers.set(locale, []);
  layers.get(locale).push({ file, entries });
}
let locales = [...layers.keys()];
if (opt.locales) locales = locales.filter((l) => opt.locales.includes(l));
const base = opt.base ?? locales[0];

const merged = new Map(); // locale -> Map<key, {e, file}>
for (const loc of locales) {
  const map = new Map();
  for (const { file, entries } of layers.get(loc)) for (const [k, e] of entries) map.set(k, { e, file });
  merged.set(loc, map);
}

/* ---------------------------------------------------------------- entries */
const linkedFrom = new Map(); // key -> Set of keys linking to it (all locales)
for (const [loc, map] of merged) {
  for (const [key, { e, file }] of map) {
    const at = `${file} ${key}`;
    for (const f of ["title", "short", "body"]) {
      if (e[f] != null && typeof e[f] !== "string") add("error", at, `"${f}" must be a string`);
    }
    if (typeof e.title !== "string" || !e.title.trim()) add("error", at, 'missing "title"');
    if (!e.short && !e.body) add("error", at, 'needs "short" or "body"');
    else if (!e.short) add("warn", at, 'no "short" (one-line summary, used in lists and simple tooltips)');
    if (typeof e.short === "string" && e.short.length > opt.maxShort) {
      add("warn", at, `"short" has ${e.short.length} characters (max ${opt.maxShort})`);
    }
    if (e.aliases != null && !(Array.isArray(e.aliases) && e.aliases.every((x) => typeof x === "string"))) {
      add("error", at, '"aliases" must be a list of strings');
    }
    const see = e.see ?? [];
    if (!Array.isArray(see) || !see.every((x) => typeof x === "string")) add("error", at, '"see" must be a list of keys');
    const known = new Set(Object.keys(e));
    for (const k of known) {
      if (!["title", "short", "body", "aliases", "see", "note"].includes(k)) add("warn", at, `unknown field "${k}"`);
    }
    const texts = [e.short ?? "", e.body ?? ""];
    const refs = [...texts.flatMap((t) => collectRefs(t).links), ...(Array.isArray(see) ? see : [])];
    for (const target of refs) {
      if (target === key) add("warn", at, `links to itself`);
      else if (!map.has(target)) {
        const elsewhere = [...merged].find(([l, m]) => l !== loc && m.has(target));
        if (elsewhere) add("warn", at, `[[${target}]] exists only in "${elsewhere[0]}" (shown via fallback)`);
        else add("error", at, `broken link [[${target}]]`);
      }
      if (!linkedFrom.has(target)) linkedFrom.set(target, new Set());
      linkedFrom.get(target).add(key);
    }
    const plain = [];
    const walkText = (nodes) => nodes.forEach((n) => (n.t === "text" ? plain.push(n.v) : n.c && walkText(n.c)));
    for (const t of texts) for (const b of parseText(t)) (b.type === "ul" ? b.items : [b.c]).forEach(walkText);
    if (/\[\[|\]\]/.test(plain.join(" "))) add("warn", at, "unparsed [[ or ]] (link key invalid?)");
  }
}

/* ---------------------------------------------------------------- translations */
const baseMap = merged.get(base);
if (baseMap) {
  for (const [loc, map] of merged) {
    if (loc === base) continue;
    const missing = [...baseMap.keys()].filter((k) => !map.has(k));
    const extra = [...map.keys()].filter((k) => !baseMap.has(k));
    if (missing.length) add("warn", loc, `${missing.length} entr${missing.length === 1 ? "y" : "ies"} not translated: ${missing.join(", ")}`);
    if (extra.length) add("warn", loc, `${extra.length} entr${extra.length === 1 ? "y" : "ies"} missing in "${base}": ${extra.join(", ")}`);
    for (const [k, { e }] of map) {
      const b = baseMap.get(k)?.e;
      if (!b) continue;
      const vars = (x) => [...new Set(collectRefs(`${x.short ?? ""}\n\n${x.body ?? ""}`).vars)].sort().join(",");
      if (vars(b) !== vars(e)) add("warn", `${loc} ${k}`, `live values differ from "${base}" ({${vars(b)}} vs {${vars(e)}})`);
    }
  }
}

/* ---------------------------------------------------------------- source scan */
if (opt.scan.length) {
  const used = new Map(); // key -> first place
  const exts = new Set([".html", ".htm", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".svelte", ".vue", ".cshtml", ".razor", ".gd", ".cs", ".py"]);
  const rx = /(?:data-deeptip|data-dt-key)\s*=\s*\{?\s*["'`]([^"'`{}$]+)["'`]|\bdeeptip\s*\(\s*["'`]([^"'`]+)["'`]|\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]*)?\]\]/g;
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f.startsWith(".") || f === "dist" || /^deeptip(\.min)?\.js$/.test(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.has(extname(f))) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(rx)) {
          const key = (m[1] ?? m[2] ?? m[3]).trim();
          if (KEY_RE.test(key) && !used.has(key)) used.set(key, `${p}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
  };
  opt.scan.forEach(walk);
  for (const [key, where] of used) {
    if (baseMap && !baseMap.has(key)) add("error", where, `key "${key}" is used in code but not defined`);
  }
  if (baseMap) {
    const unused = [...baseMap.keys()].filter((k) => !used.has(k) && !linkedFrom.has(k) && !k.startsWith("deeptip."));
    if (unused.length) add("info", base, `${unused.length} entr${unused.length === 1 ? "y is" : "ies are"} neither linked nor used in code: ${unused.join(", ")}`);
  }
}

/* ---------------------------------------------------------------- report */
const count = (l) => findings.filter((f) => f.level === l).length;
const errors = count("error");
const warns = count("warn");
if (opt.json) {
  console.log(JSON.stringify({ locales, base, entries: baseMap?.size ?? 0, errors, warnings: warns, findings }, null, 2));
} else {
  const icon = { error: "✖", warn: "⚠", info: "ℹ" };
  for (const f of findings) console.log(`${icon[f.level]} ${f.where}: ${f.msg}`);
  const sizes = locales.map((l) => `${l} ${merged.get(l).size}`).join(", ");
  console.log(`\nDeepTip check: ${files.length} file(s), entries ${sizes || "–"} · ${errors} error(s), ${warns} warning(s)`);
}
process.exit(errors || (opt.strict && warns) ? 1 : 0);
