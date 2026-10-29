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
    json = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
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
// Files: markup, templates and data (TEXT), the languages of the first guides (OLD) and those of the later guides (CODE).
// [[key]] counts anywhere in TEXT and OLD files (as it always did) but only inside a one-line string literal in CODE
// files, where [[x]] is also a nested array, a C++ attribute ([[nodiscard]]), a Swift type or a Lua string.
const TEXT = [".html", ".htm", ".svelte", ".vue", ".cshtml", ".razor", ".json", ".php", ".erb", ".twig", ".jinja", ".j2", ".astro", ".xaml", ".axaml", ".uxml", ".fxml", ".ui"];
const OLD = [".js", ".mjs", ".ts", ".tsx", ".jsx", ".gd", ".cs", ".py"];
const CODE = [".dart", ".kt", ".kts", ".swift", ".java", ".go", ".rs", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".lua", ".luau", ".gml", ".rpy", ".qml", ".tscn"];
const JS = [".js", ".mjs", ".ts", ".tsx", ".jsx"];
const CPP = [".cpp", ".cc", ".cxx", ".h", ".hpp", ".hh"];
// Build output, dependencies and engine caches never hold the project's own keys.
const SKIP_DIRS = new Set(["node_modules", "bower_components", "dist", "build", "out", "target", "bin", "obj", "vendor", "Library", "Temp", "Logs", "Binaries", "Intermediate", "Saved", "DerivedDataCache", "Pods", "DerivedData", "__pycache__", "venv"]);
// DeepTip's own code files (runtime, type declarations, RPG Maker plugin, jQuery plugin, Phaser adapter) mention keys
// in their comments; a folder with a DeepTip manifest (deeptip.json with "kind") is a copy of a framework folder.
const OWN_FILES = /^(?:deeptip(?:\.min)?\.(?:js|d\.ts)|DeepTip\.js|jquery\.deeptip(?:\.min)?\.js|deeptip-phaser(?:\.min)?\.js)$/;
const LINK = /\[\[([A-Za-z0-9_.-]+)(?:\|[^\]]*)?\]\]/g;
const STRING = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
// Marks whose key is the first group. "weak": a generic name that other code uses too (how it is reported: see the scan).
const MARKS = [
  { re: /(?:data-deeptip|data-dt-key)\s*=\s*\{?\s*["'`]([^"'`{}$]+)["'`]/g }, // web; JSX data-deeptip={"key"}
  { re: /data-deeptip\s*=\s*"\s*'([A-Za-z0-9_.-]+)'\s*"/g }, // Vue :data-deeptip="'key'"
  { re: /<[A-Za-z][\w-]*\b[^<>;{}]*?\sdeeptip\s*=\s*"([A-Za-z0-9_.-]+)"/g, in: [".html", ".htm", ".ts"] }, // Angular directive deeptip="key"
  { re: /\[(?:deeptip|attr\.data-deeptip)\]\s*=\s*"\s*'([A-Za-z0-9_.-]+)'\s*"/g }, // Angular [deeptip]="'key'", [attr.data-deeptip]="'key'"
  { re: /\.deeptip\(\s*\{[^{}]*?\bkey\s*:\s*["'`]([A-Za-z0-9_.-]+)["'`]/g }, // jQuery .deeptip({ key: "key" })
  { re: /\\{1,2}DT\[([A-Za-z0-9_.-]+)(?:\|[^\]]*)?\]/g }, // RPG Maker MZ \DT[key] in texts (\\DT[…] in its JSON data)
  { re: /<DeepTip:\s*([A-Za-z0-9_.-]+)\s*>/g }, // RPG Maker MZ note tag
  { re: /\bDeepTip\.Key\s*=\s*"([^"{}]+)"/g }, // XAML (WPF, Avalonia, .NET MAUI) dt:DeepTip.Key="key"
  { re: /\bDeepTip\.key\s*:\s*["']([A-Za-z0-9_.-]+)["']/g }, // QML DeepTip.key: "key"
  { re: /<property\s+name="deeptip"[^>]*>\s*<string>([^<]+)<\/string>/g }, // Qt Designer dynamic property (.ui)
  { re: /<properties\b[^>]*?\sdeeptip\s*=\s*"([^"]+)"/g }, // FXML <properties deeptip="key"/>
  { re: /^[ \t]*metadata\/deeptip\s*=\s*"([^"]+)"/gm }, // Godot scene metadata
  { re: /\{a=dt:([A-Za-z0-9_.-]+)\}/g }, // Ren'Py {a=dt:key}
  { re: /<dt\s+key=\\?["']([A-Za-z0-9_.-]+)\\?["']/g, in: CPP }, // Unreal rich text <dt key="key"> in C++ (HTML has <dt> too)
  { re: /\bDeepTipKey\s*\{\s*key\s*:\s*"([^"]+)"/g, in: [".rs"] }, // Bevy component DeepTipKey { key: "key".into(), … }
  { re: /(?:\[|\{\{[<%]\s*)deeptip\s+key\s*=\s*["']([^"']+)["']/g }, // WordPress [deeptip key="key"], Hugo {{< deeptip key="key" >}}
  { re: /<(?:x-)?deeptip-term\b[^>]*?\skey\s*=\s*["']([^"']+)["']/g }, // Blade <x-deeptip-term key="key">, Razor <deeptip-term key="key">
  { re: /\bdeeptip_term\s*\(?\s*["']([^"']+)["']/g }, // Django, Jinja, Twig, Rails: deeptip_term "key" / deeptip_term('key')
  { re: /<Term\b[^>]*?\skey\s*=\s*["']([^"']+)["']/g, in: [".astro"], weak: true }, // Astro <Term key="key" />
  { re: /\b\w*[Aa]nchor\.Key\s*=\s*"([^"]+)"/g, in: [".cs"], weak: true }, // Unity uGUI anchor.Key = "key"
];
// Calls whose argument `arg` (0 = first) is the key as a string literal, or whose argument named key (key: / key =) is;
// `when`: another argument must be this string; `not`: strings that are no keys.
const JQUERY_METHODS = ["open", "close", "pin", "unpin", "remove", "text", "index", "removeIndex", "destroy", "refresh"];
const CALLS = [
  { re: /\bdeeptip\s*\(/g, arg: 0, not: JQUERY_METHODS }, // deeptip("key"), jQuery $(…).deeptip("key"), not its methods
  { re: /\buseDeepTip\s*\(/g, arg: 0 }, // React Native useDeepTip("key")
  { re: /\.deepTip\s*\(/g, arg: 0 }, // Compose Modifier.deepTip("key"), SwiftUI .deepTip("key")
  { re: /\bDeepTip\s*\(/g, arg: 0, in: [".dart"] }, // Flutter DeepTip('key', child: …)
  { re: /\bdeeptip_mark\s*\(/g, arg: 1 }, // GameMaker deeptip_mark(id, key, …), GTK deeptip_mark (widget, key)
  { re: /\bdeeptip_mark_instance\s*\(/g, arg: 1 }, // GameMaker
  { re: /\bdeeptip_open\s*\(/g, arg: 0 }, // GameMaker
  { re: /\bSetDeepTipKey\s*\(/g, arg: 1 }, // Windows Forms designer
  { re: /\bputClientProperty\s*\(/g, arg: 1, when: [0, "deeptip"] }, // Swing
  { re: /\.put\s*\(/g, arg: 1, when: [0, "deeptip"] }, // JavaFX getProperties().put("deeptip", "key")
  { re: /\bsetProperty\s*\(/g, arg: 1, when: [0, "deeptip"] }, // Qt and PySide6 setProperty("deeptip", "key")
  { re: /\bset_meta\s*\(/g, arg: 1, when: [0, "deeptip"] }, // Godot
  { re: /\bg_object_set_data(?:_full)?\s*\(/g, arg: 2, when: [1, "deeptip"] }, // GTK
  { re: /\bmark\s*\(/g, arg: 1, weak: true, in: [".py", ".gd", ".rs", ".lua", ".luau", ".java", ".swift"] }, // dt.mark(widget, "key"), dt:mark(obj, "key")
  { re: /\bmark_with\s*\(/g, arg: 1, weak: true, in: [".rs"] }, // Ratatui and egui dt.mark_with(area, "key", options)
  { re: /\.Mark\s*\(/g, arg: 0, weak: true, in: [".go"] }, // Bubble Tea dt.Mark("key", view)
  { re: /\.Mark\s*\(/g, arg: 2, weak: true, in: [".go"] }, // Gio dt.Mark(gtx, tag, "key", widget)
  { re: /(?:\.|->)Mark(?:Slate)?\s*\(/g, arg: 1, weak: true, in: CPP }, // Unreal DeepTip->Mark(Widget, TEXT("key"))
  { re: /(?:\.|->)Item\s*\(/g, arg: 0, weak: true, in: CPP }, // Dear ImGui dt.Item("key")
  { re: /\bSetKey\s*\(/g, arg: 1, weak: true, in: [".cs"] }, // Avalonia, WPF, Windows Forms, .NET MAUI, UI Toolkit
  { re: /\.explain\s*\(/g, arg: 1, weak: true, in: JS }, // Phaser tips.explain(object, "key")
  { re: /\.explainArea\s*\(/g, arg: 2, weak: true, in: JS }, // Phaser tips.explainArea(scene, rect, "key")
  { re: /\b(?:Hover|Unhover|Open)\s*\(/g, arg: 0, weak: true, in: [".rpy"] }, // Ren'Py dt.Hover("key")
];

/** End of the string literal that starts at src[i] (one line, or any length between backticks), or -1. */
function stringEnd(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length && j < i + 2000; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === q) return j;
    else if (src[j] === "\n" && q !== "`") return -1;
  }
  return -1;
}

/** The arguments of the call whose "(" is at src[open], as trimmed source text; null if it does not close nearby. */
function callArgs(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const end = stringEnd(src, i);
      if (end >= 0) i = end;
      else if (c !== "'") return null; // a lone ' is an apostrophe, a char or a Rust lifetime
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 1;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--depth === 0) {
        args.push(src.slice(start, i).trim());
        return args;
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

/** The text of a string-literal argument: "k", 'k', `k`, u"k"_s, @"k", TEXT("k"), QStringLiteral("k"), g_strdup ("k"), "k".into() … */
function literal(arg) {
  let s = arg?.trim() ?? "";
  for (let n = 0, w; n < 3 && (w = /^(?:TEXT|_T|QStringLiteral|QLatin1String(?:View)?|g_strdup|String::from)\s*\(([\s\S]*)\)$/.exec(s)); n++) s = w[1].trim();
  s = s.replace(/\.(?:into|to_string|to_owned)\(\)$/, "").replace(/_(?:s|L1)$/, "");
  const m = /^(?:u8|[uULr@])?(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1$/.exec(s);
  return m && !(m[1] === "`" && m[2].includes("${")) ? m[2] : null;
}

/** The key of one call: its argument named key, else the argument at spec.arg (not when that one is named). */
function callKey(args, spec) {
  for (const a of args) {
    const named = /^key\s*[:=](?!=)\s*([\s\S]+)$/.exec(a);
    if (named) return literal(named[1]);
  }
  const a = args[spec.arg];
  if (a == null || /^[A-Za-z_]\w*\s*[:=](?![:=])/.test(a)) return null;
  if (spec.when && literal(args[spec.when[0]]) !== spec.when[1]) return null;
  const key = literal(a);
  return key != null && spec.not?.includes(key) ? null : key;
}

/** Every key used in one file, with its offset and whether a strong (DeepTip-specific) mark found it. */
function keysInSource(src, ext) {
  const found = [];
  const at = (key, index, weak) => key != null && KEY_RE.test(key.trim()) && found.push({ key: key.trim(), index, weak: !!weak });
  const applies = (spec) => !spec.in || spec.in.includes(ext);
  if (CODE.includes(ext)) {
    for (const s of src.matchAll(STRING)) for (const m of s[0].matchAll(LINK)) at(m[1], s.index + m.index);
  } else for (const m of src.matchAll(LINK)) at(m[1], m.index);
  for (const spec of MARKS.filter(applies)) for (const m of src.matchAll(spec.re)) at(m[1], m.index, spec.weak);
  for (const spec of CALLS.filter(applies)) {
    for (const m of src.matchAll(spec.re)) {
      const args = callArgs(src, m.index + m[0].length - 1);
      if (args) at(callKey(args, spec), m.index, spec.weak);
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

if (opt.scan.length) {
  const used = new Map(); // key -> { where (first place), strong }
  const exts = new Set([...TEXT, ...OLD, ...CODE]);
  const isFramework = (dir) => {
    try {
      return typeof JSON.parse(readFileSync(join(dir, "deeptip.json"), "utf8")).kind === "string";
    } catch {
      return false;
    }
  };
  const walk = (dir, top) => {
    if (!top && isFramework(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f.startsWith(".") || SKIP_DIRS.has(f) || OWN_FILES.test(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, false);
      else if (exts.has(extname(f).toLowerCase())) {
        const src = readFileSync(p, "utf8");
        for (const { key, index, weak } of keysInSource(src, extname(f).toLowerCase())) {
          const u = used.get(key);
          if (!u) used.set(key, { where: `${p}:${src.slice(0, index).split("\n").length}`, strong: !weak });
          else if (!weak) u.strong = true;
        }
      }
    }
  };
  opt.scan.forEach((dir) => walk(dir, true));
  // A key found only by a generic call name (mark, SetKey, explain …) is reported when it is not defined but starts
  // with a namespace the glossary uses (shop.cartt): other libraries' strings like zone.Mark("button1") stay silent.
  const namespaces = new Set([...(baseMap?.keys() ?? [])].filter((k) => k.includes(".")).map((k) => k.split(".")[0]));
  for (const [key, { where, strong }] of used) {
    if (!baseMap || baseMap.has(key)) continue;
    if (strong || (key.includes(".") && namespaces.has(key.split(".")[0]))) add("error", where, `key "${key}" is used in code but not defined`);
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
