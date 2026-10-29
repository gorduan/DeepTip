// DeepTip for RPG Maker MZ: 26 checks inside the running game. Evaluate this file in the game page; the result is an
// object whose "fail" list must be empty. It plays with the running game (title, new game, map, item menu), so use a
// fresh test project with the example installed (example/install.mjs), never a save you care about.
//   Playtest: F8 opens the DevTools, paste this file into the Console.
//   Browser:  serve the project folder (e.g. python -m http.server), open index.html, paste into the DevTools Console.
// The game loop is driven by hand (Graphics._onTick), so the checks also run in hidden or unfocused windows; the
// placement checks need a page at least as large as the game screen.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yieldTask = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const tick = async (frames, until) => { for (let i = 0; i < frames; i++) { Graphics._onTick(1); await yieldTask(); if (until && until()) return i + 1; } return frames; };
  const sceneIs = (name) => !!(SceneManager._scene && SceneManager._scene.constructor.name === name && SceneManager._scene.isStarted());
  const pe = (type, target, x, y, pointerType) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerType: pointerType || "mouse", pointerId: pointerType === "touch" ? 7 : 1, clientX: x, clientY: y }));
  const me = (type, target, x, y) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, view: window }));
  const key = (target, type, k, code) => target.dispatchEvent(new KeyboardEvent(type, { key: k, keyCode: code, bubbles: true, cancelable: true }));
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  const anchors = (kind) => Array.from(DeepTipMZ._anchors.values()).filter((a) => !kind || a.kind === kind);
  const sideOf = (w, a) => (w.l >= a.r ? "right" : w.r <= a.l ? "left" : w.t >= a.b ? "below" : w.b <= a.t ? "above" : "overlap");
  const out = { ua: navigator.userAgent.replace(/^.*?(Chrome\/[\d.]+).*$/, "$1") };
  const fail = [];
  const check = (name, ok, detail) => { out[name] = detail === undefined ? ok : detail; if (!ok) fail.push(name); };

  for (let i = 0; i < 100 && (typeof Graphics === "undefined" || !Graphics._app); i++) await sleep(100);
  SceneManager.isGameActive = () => true; // test harness: hidden windows never have focus
  const t0 = performance.now();
  while (performance.now() - t0 < 15000 && !sceneIs("Scene_Title")) {
    await tick(30);
    if (sceneIs("Scene_Splash") && !SceneManager._nextScene) SceneManager.goto(Scene_Title);
  }
  const dt = DeepTipMZ.controller;
  check("started", !!dt && DeepTipMZ._settled, { scene: SceneManager._scene && SceneManager._scene.constructor.name, controller: !!dt });
  if (!dt) return { fail, ...out };
  out.runtimeLoadedAs = Object.keys(DeepTipMZ.lib).indexOf("default") >= 0 ? "ES module (import)" : "classic fallback (XHR + Function)";
  out.cssAnchorPositioning = dt.css;
  out.nativeReplaceChildren = /\[native code\]/.test(String(Element.prototype.replaceChildren));
  check("glossaries", dt.data.get("en").size > 20 && dt.data.get("de").size > 20, { en: dt.data.get("en").size, de: dt.data.get("de").size, chain: dt.chain.join(",") });

  // title: rest on a command -> window beside or below it, never on it
  dt.add("en", { "command.newGame": { title: "New Game", short: "Start a new adventure.", body: "Starts your [[demo.realm|realm]] from the beginning. Your [[demo.nobles]] are waiting." } });
  const cw = SceneManager._scene._commandWindow;
  await tick(300, () => cw.isOpen());
  await tick(3);
  const cmd = anchors("item")[0];
  check("commandAnchor", !!cmd && cmd.key === "command.newGame", cmd && cmd.key);
  const a = box(cmd.el);
  pe("pointerover", cmd.el, a.cx, a.cy);
  await sleep(2200);
  const root = dt.wins[0];
  check("restOpens", !!root && root.key === "command.newGame" && !root.pinned, root && root.key);
  const rb = box(root.el);
  check("rootPlacement", sideOf(rb, a) !== "overlap" && rb.h > 60, { side: sideOf(rb, a), height: Math.round(rb.h), engine: root.el.dataset.dtEngine, popover: root.el.classList.contains("dt-no-popover") ? "fallback (no Popover API)" : "top layer" });
  const cs = getComputedStyle(root.el);
  check("theme", cs.backgroundColor === "rgba(16, 22, 40, 0.94)", { bg: cs.backgroundColor, opacity: cs.opacity, font: cs.fontFamily, size: cs.fontSize, lockBarHidden: getComputedStyle(root.el, "::after").transform });
  const link = root.el.querySelector('.dt-link[data-dt-key="demo.realm"]');
  const lb = box(link);
  pe("pointerover", link, lb.cx, lb.cy);
  await sleep(2200);
  const child = dt.wins.find((w) => w.parent === root);
  check("termOpensChild", !!child && sideOf(box(child.el), rb) !== "overlap", child && { key: child.key, side: sideOf(box(child.el), rb) });
  TouchInput.clear();
  me("mousedown", root.el.querySelector(".dt-body"), lb.cx, lb.cy);
  check("windowPressStaysOutOfGame", !TouchInput._mousePressed);
  me("mouseup", root.el.querySelector(".dt-body"), lb.cx, lb.cy);
  link.click();
  await sleep(100);
  check("clickPinsChain", dt.wins.length === 2 && dt.wins.every((w) => w.pinned), dt.wins.map((w) => w.key + (w.pinned ? "*" : "")).join(" > "));
  TouchInput.clear();
  me("mousedown", cmd.el, a.cx, a.cy);
  check("commandPressReachesGame", TouchInput._mousePressed);
  me("mouseup", cmd.el, a.cx, a.cy);
  TouchInput.clear();
  const n = dt.wins.length;
  key(document.body, "keydown", "Escape", 27);
  check("escClosesNewest", dt.wins.length === n - 1 && !Input._currentState.escape);
  key(document.body, "keyup", "Escape", 27);
  dt.closeAll();
  await sleep(50);
  key(document.body, "keydown", "F1", 112);
  await sleep(150);
  check("f1OpensSelected", dt.wins.length === 1 && dt.wins[0].pinned && dt.wins[0].via === "key" && DeepTipMZ.focusInside(), dt.wins.map((w) => w.key + " via " + w.via).join());
  const focused = document.activeElement;
  out.focusOutline = getComputedStyle(focused).outlineStyle + " " + getComputedStyle(focused).outlineWidth;
  const idx = cw.index();
  key(focused, "keydown", "ArrowDown", 40);
  await tick(3);
  check("gameMutedWhileFocused", cw.index() === idx);
  key(focused, "keyup", "ArrowDown", 40);
  key(document.activeElement, "keydown", "Escape", 27);
  await sleep(50);
  check("escClosesFocused", dt.wins.length === 0);

  // map: HUD areas, live values, language, message terms, gamepad help
  DataManager.setupNewGame();
  SceneManager.goto(Scene_Map);
  await tick(900, () => sceneIs("Scene_Map"));
  await tick(5);
  check("hudAreas", anchors("area").length === 6, anchors("area").map((x) => x.key).join(","));
  const help = anchors("area").find((x) => x.key === "deeptip.about");
  const hb = box(help.el);
  pe("pointerover", help.el, hb.cx, hb.cy);
  await sleep(2200);
  check("delayZeroArea", dt.wins.length === 1 && dt.wins[0].key === "deeptip.about");
  pe("pointerover", document.body, 2, 2);
  dt.closeAll();
  const stab = anchors("area").find((x) => x.key === "demo.stability");
  const sw = await dt.open("demo.stability", { anchor: stab.el, pinned: true });
  const read = () => (sw.el.querySelector(".dt-var") || {}).textContent;
  const before = read();
  $gameVariables.setValue(1, 3);
  await tick(45);
  check("liveValue", before === "+1" && read() === "+3", before + " -> " + read());
  await DeepTipMZ.setLocale("de");
  await tick(3);
  check("locale", dt.locale === "de" && sw.el.querySelector(".dt-title").textContent === "Stabilität" && SceneManager._scene._deepTipHud._signature.indexOf("de") === 0);
  await DeepTipMZ.setLocale("en");
  dt.closeAll();
  $gameMessage.add("Rebels: \\DT[demo.revolt] threatens your \\DT[demo.province|lands].");
  await tick(300, () => anchors("term").length >= 2);
  await tick(5);
  const terms = anchors("term");
  check("messageTerms", terms.length === 2, terms.map((t) => t.key + "@" + Math.round(t.left) + "," + Math.round(t.top)).join(" "));
  const term = terms[0];
  const tb = box(term.el);
  TouchInput.clear();
  me("mousedown", term.el, tb.cx, tb.cy);
  check("termPressStaysOutOfGame", !TouchInput._mousePressed);
  me("mouseup", term.el, tb.cx, tb.cy);
  term.el.click();
  await sleep(100);
  await tick(20);
  const mw = SceneManager._scene._messageWindow;
  check("termClickPins", dt.wins.length === 1 && dt.wins[0].pinned && $gameMessage.isBusy() && mw.isOpen(), dt.wins.map((w) => w.key).join());
  dt.closeAll();
  DeepTipMZ._helpSig = "";
  Input._gamepadStates = [[false, false, false, true]];
  await tick(1);
  check("gamepadHelp", dt.wins.length === 1 && dt.wins[0].via === "pad" && !Input.isTriggered("menu"), dt.wins.map((w) => w.key + " via " + w.via).join());
  Input._gamepadStates = [[false, false, false, false]];
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  dt.closeAll();
  $gameMessage.clear();
  mw.terminateMessage();
  await tick(30);

  // items: note tag, touch long-press, scene change
  $gameParty.gainItem($dataItems[1], 3);
  $dataItems[1].meta.DeepTip = "demo.gold";
  const keep = await dt.open("demo.realm", { anchor: help.el, pinned: true });
  SceneManager.push(Scene_Item);
  await tick(900, () => sceneIs("Scene_Item"));
  check("sceneChangeCloses", dt.wins.length === 0 && !!keep);
  const s = SceneManager._scene;
  s._categoryWindow.deactivate();
  s._itemWindow.activate();
  s._itemWindow.select(0);
  await tick(5);
  const item = anchors("item")[0];
  check("noteTag", !!item && item.key === "demo.gold", item && item.key);
  if (item) {
    const ib = box(item.el);
    TouchInput.clear();
    pe("pointerdown", item.el, ib.cx, ib.cy, "touch");
    TouchInput._screenPressed = true;
    TouchInput._onTrigger(Graphics.pageToCanvasX(ib.cx), Graphics.pageToCanvasY(ib.cy));
    await sleep(2200);
    const opened = dt.wins.length === 1 && dt.wins[0].via === "touch" && dt.wins[0].pinned;
    pe("pointerup", item.el, ib.cx, ib.cy, "touch");
    TouchInput._screenPressed = false;
    TouchInput._onRelease(Graphics.pageToCanvasX(ib.cx), Graphics.pageToCanvasY(ib.cy));
    TouchInput.update();
    check("longPressNoClick", opened && !TouchInput.isClicked(), { opened, clicked: TouchInput.isClicked() });
  }
  dt.closeAll();
  SceneManager.pop();
  await tick(900, () => sceneIs("Scene_Map"));
  const interp = new Game_Interpreter();
  PluginManager.callCommand(interp, "DeepTip", "open", { key: "demo.taxes", pinned: "true", wait: "true" });
  await sleep(150);
  const waiting = interp.updateWait();
  dt.closeAll();
  check("commandWait", waiting && !interp.updateWait() && true, { waiting, after: interp.updateWait() });
  const printer = document.getElementById("errorPrinter");
  out.errorPrinter = printer ? printer.innerText : "";
  out.anchorsDisabled = DeepTipMZ._broken;
  return { fail, ...out };
})()
