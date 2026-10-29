#!/usr/bin/env node
// Runs the in-page checks of this folder (test/checks.js) in headless Chrome with real mouse and keyboard input:
// serves the repository root over HTTP, opens each test page, waits for window.deeptipTest and prints the results.
// Exit code 1 when a check fails. Needs Node 22+ (global WebSocket) and Chrome, Chromium or Edge.
//   node frameworks/phaser/test/run.mjs [--chrome <path>] [--port 5751] [--profile <dir>] [--shots <dir>]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const folder = basename(resolve(here, ".."));
const PAGES = [`frameworks/${folder}/example/index.html?test`, `frameworks/${folder}/example/index.html?test&phaser=3`];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(opt("port", 5751));
const shots = opt("shots", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (typeof WebSocket === "undefined") {
  console.error("run.mjs needs Node 22 or newer (global WebSocket).");
  process.exit(2);
}

function findChrome() {
  const given = opt("chrome", process.env.CHROME);
  if (given) return given;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => existsSync(p)) ?? "google-chrome";
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(root, `.${path}`);
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": `${TYPES[extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(port, "127.0.0.1", r));

const profile = opt("profile", null) ?? (await mkdtemp(join(tmpdir(), "deeptip-test-")));
await rm(join(profile, "DevToolsActivePort"), { force: true });
const chrome = spawn(findChrome(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });

let ws;
let id = 0;
const pending = new Map();
const listeners = new Set();
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// real input for the page: checks.js calls window.deeptipInput(JSON) and waits for window.__deeptipInputDone(id)
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "none", pointerType: "mouse", ...extra });
async function perform(cmd) {
  if (cmd.type === "move") {
    const [fx, fy] = cmd.from ?? [cmd.x, cmd.y];
    const steps = cmd.steps ?? 1;
    for (let i = 1; i <= steps; i++) await mouse("mouseMoved", fx + ((cmd.x - fx) * i) / steps, fy + ((cmd.y - fy) * i) / steps);
  } else if (cmd.type === "click") {
    await mouse("mouseMoved", cmd.x, cmd.y);
    await mouse("mousePressed", cmd.x, cmd.y, { button: "left", buttons: 1, clickCount: 1 });
    await mouse("mouseReleased", cmd.x, cmd.y, { button: "left", buttons: 0, clickCount: 1 });
  } else if (cmd.type === "key") {
    const modifiers = cmd.shift ? 8 : 0;
    const text = cmd.key.length === 1 ? cmd.key : undefined;
    await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: cmd.key, code: cmd.code ?? cmd.key, windowsVirtualKeyCode: cmd.vk ?? 0, modifiers, text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: cmd.key, code: cmd.code ?? cmd.key, windowsVirtualKeyCode: cmd.vk ?? 0, modifiers });
  }
  await evaluate(`window.__deeptipInputDone(${cmd.id})`);
}

let failed = 0;
try {
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      const file = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      const list = await (await fetch(`http://127.0.0.1:${file.split("\n")[0]}/json/list`)).json();
      page = list.find((t) => t.type === "page");
    } catch {
      await sleep(100);
    }
  }
  if (!page) throw new Error("Chrome did not start (use --chrome <path>)");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  const problems = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    for (const l of listeners) l(m);
    if (m.method === "Runtime.bindingCalled" && m.params.name === "deeptipInput") void perform(JSON.parse(m.params.payload)).catch((err) => problems.push(String(err)));
    if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) problems.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Runtime.addBinding", { name: "deeptipInput" });
  for (const path of PAGES) {
    problems.length = 0;
    const loaded = new Promise((ok) => {
      const l = (m) => {
        if (m.method === "Page.loadEventFired") {
          listeners.delete(l);
          ok();
        }
      };
      listeners.add(l);
    });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/${path}` });
    await loaded;
    let result = null;
    for (let i = 0; i < 300 && !result; i++) {
      result = await evaluate("window.deeptipTest ? 1 : 0").then((v) => (v ? evaluate("window.deeptipTest") : null));
      if (!result) await sleep(100);
    }
    if (!result) result = { pass: [], fail: [{ name: "page", detail: "window.deeptipTest never appeared" }] };
    if (shots) {
      await mkdir(shots, { recursive: true });
      const names = await evaluate("(window.deeptipShots ?? []).map((s) => s.name)");
      for (const [i, name] of names.entries()) {
        await evaluate(`window.deeptipShots[${i}].prepare()`);
        await sleep(400);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(shots, `${folder}-${name}.png`), Buffer.from(shot.data, "base64"));
      }
    }
    const unexpected = problems.filter((p) => !(result.allow ?? []).some((a) => p.includes(a)));
    console.log(`\n${path}`);
    for (const name of result.pass) console.log(`  ok    ${name}`);
    for (const f of result.fail) console.log(`  FAIL  ${f.name}: ${f.detail}`);
    for (const p of unexpected) console.log(`  FAIL  console: ${p}`);
    failed += result.fail.length + unexpected.length;
    if (result.info) console.log(`  info  ${JSON.stringify(result.info)}`);
  }
} catch (e) {
  console.error(e);
  failed++;
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  if (!opt("profile", null)) await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
