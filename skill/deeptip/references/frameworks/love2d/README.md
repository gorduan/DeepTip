# DeepTip for LÖVE (Lua)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, in a [LÖVE](https://love2d.org) game written in Lua. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Lua implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to LÖVE and Lua.

Statements marked (checked) were verified on 2026-10-29 with **LÖVE 11.5** (LuaJIT 2.1, Lua 5.1 semantics) on Windows 11: headless runs of `lovec.exe` with `t.window = false` (no window is created), and the LÖVE 11.5 sources (`callbacks.lua`, the C++ wrappers of `love.graphics`, `love.window`, `love.joystick`, `love.event`). A Lua port of [§1], [§2] and [§8] passed all 24 shared cases inside LÖVE (24/24). Nothing was drawn (no window); drawing notes come from the 11.5 sources and the [wiki](https://love2d.org/wiki/Main_Page), and points that depend on behaviour rather than on an API are marked (verify). LÖVE has immediate-mode drawing like egui, so the closest complete implementation is the Rust crate in [frameworks/rust-egui](../rust-egui/README.md): its `src/engine.rs` (the window tree and every timer, no UI types) ports to Lua almost line by line.

**Download:** `DeepTip-love2d-1.0.0.zip` holds this guide with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** a `main.lua` at the game root that defines `love.load`, `love.update` and `love.draw` (usually with a `conf.lua` defining `love.conf`); packaged games are `.love` zip files.

1. Create `lib/deeptip/core.lua`, `json.lua` (with lunajson 1.2.3) and `init.lua` as in section 1, starting with `core.lua`.
2. Run the parity runner headless until it prints `24/24 parity cases passed` (section 16).
3. Copy `glossary/core/*.json` to `deeptip/core/`; your own entries go to `deeptip/<locale>.json`.
4. Call `dt:install()` once, `dt:update()` in `love.update` and `dt:draw()` as the last line of `love.draw`.
5. Mark every explained element with `dt:mark(id, key, x, y, w, h)` while you draw it.
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```lua
-- main.lua
local DeepTip = require("lib.deeptip")
local dt

function love.load()
  dt = DeepTip.new({ locale = "en", fallback = { "en" },
    sources = { "deeptip/core/{locale}.json", "deeptip/{locale}.json" } })
  dt:install()                                   -- input reaches DeepTip before your love.* callbacks
end

function love.update() dt:update() end

function love.draw()
  love.graphics.rectangle("line", 20, 20, 40, 32)
  love.graphics.print("?", 36, 28)
  dt:mark("help", "deeptip.about", 20, 20, 40, 32) -- rest on it: its window opens
  dt:draw()                                      -- last: the windows lie on top of everything
end
```

**Done when:** the parity runner prints `24/24 parity cases passed`, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without reaching your `love.keypressed`, the validator reports 0 errors.

## 1. Parts to build

| File in your game | Content | Algorithms |
|---|---|---|
| `lib/deeptip/core.lua` | pure functions, no `love.*`: `flatten(obj)`, `parse_text(src)`, `collect_refs(blocks)`, `compute_placement(size, anchor, sides, vp, gap)` | [§1.1], [§2], [§8] |
| `lib/deeptip/json.lua` | ordered JSON decoding on lunajson's SAX parser (section 12) | [§1.1] |
| `lib/lunajson.lua`, `lib/lunajson/` | [lunajson](https://github.com/grafi-tt/lunajson) 1.2.3 (MIT), pure Lua, runs on LuaJIT | |
| `lib/deeptip/engine.lua` | the window tree and its timers as a state machine: open, close, pin, hot set, grace, tendency, suppression, arming, timer lock; time, boxes and the hover state are passed in | [§4]–[§7] |
| `lib/deeptip/layout.lua` | markup AST → styled runs → lines with the rectangles of every term fragment | [§3] |
| `lib/deeptip/init.lua` | the controller `DeepTip.new(options)`: glossary layers, locale chain, `love.handlers` wrapper, hit-testing, drawing, focus | [§1.2], [§9] |
| `deeptip/core/<locale>.json`, `deeptip/<locale>.json` | copies of `glossary/core/` and your project glossary | |
| `tests/parity/main.lua` + `conf.lua` | the headless parity runner (section 16) | [§11] |

Keep `core.lua` and `engine.lua` free of `love.*` calls: the parity cases and scenario tests with exact times then run in any Lua 5.1 or in a headless LÖVE.

## 2. SPEC concept → LÖVE primitive

| DeepTip | LÖVE 11.5 |
|---|---|
| Controller | one Lua object `dt = DeepTip.new(options)` created in `love.load` |
| Top layer, window order | drawn by `dt:draw()` as the last call of `love.draw`, oldest window first, so the newest lies on top; inside `love.graphics.push("all")` … `pop()` after `love.graphics.origin()`, so the game's transform, colour, font, line width and scissor neither leak in nor out |
| Window ([§3]) | a record plus its laid-out content; background `love.graphics.rectangle("fill", x, y, w, h, 8, 8)` (the last two arguments are the corner radii), frame `rectangle("line", …)` with `setLineWidth(1)` |
| Rich text | own layout: one `Font` per style (regular, bold, italic, bold italic, mono), words measured with `Font:getWidth`, drawn with `love.graphics.print` (section 6). `Font:getWrap` returns plain line strings and drops colours (checked in `Font.cpp`), so it cannot give term boxes. |
| Term | a run of the layout with one rectangle per line fragment; hit-tested against the pointer every frame |
| Marked UI element (web: `data-deeptip`) | `dt:mark(id, key, x, y, w, h, opts)` while the game draws the element, every frame; `id` is a stable string, `opts.delay` and `opts.place` are the per-element overrides (`data-deeptip-delay`, `data-deeptip-place`) |
| Element under the pointer | the topmost mark of the last drawn frame whose rectangle contains the pointer (marks drawn later lie on top) |
| Window and term under the pointer | the window rectangles of the last frame, newest first; then that window's term fragments |
| Pointer samples ([§5]) | `love.mousemoved(x, y, dx, dy, istouch)` with `istouch == false` |
| `now()`, `schedule()` | `love.timer.getTime() * 1000`; due times stored in the records and compared in `dt:update()` |
| Event capture, consuming Esc | wrap `love.handlers.keypressed` and the other handlers once: `love.run` calls `love.handlers[name]` for every event, and the default handler calls `love.keypressed` (checked in `callbacks.lua`); a wrapper that returns without calling the original hides the event from the game (checked) |
| Touch | `love.touchpressed/moved/released(id, x, y, dx, dy, pressure)`; touches also arrive as mouse events with `istouch == true`, which hover logic ignores |
| Gamepad | `love.gamepadpressed/released(joystick, button)`, `love.gamepadaxis(joystick, axis, value)`, `Joystick:isGamepadDown(button)` |
| Vibration | `love.system.vibrate(seconds)` on phones (exists in 11.5, checked), `Joystick:setVibration(left, right, duration)` on gamepads |
| Rest progress (`data-dt-arming`) | `dt:arming(id)` → 0‥1 or `nil`; draw your own bar under the element |
| Open state (`data-dt-open`) | `dt:is_open(id)`; hide your own simple tooltip while it is true |
| `onOpen`, `onClose`, `onPin` | `options.on_open(key)`, `on_close(key)`, `on_pin(key)` |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | not available: LÖVE has no accessibility API |

## 3. Data structures

Records are tables compared by reference. Anchors need value equality (a term re-laid out after a language switch must still be the same anchor), so every anchor is a string:

| Anchor | String |
|---|---|
| marked element | `"m:" .. id` |
| term in a window | `"t:" .. win.id .. ":" .. key .. ":" .. n` (n = occurrence of that key in the window, 0 = first) |
| term on a page (`dt:text`) | `"p:" .. text_id .. ":" .. n` (n = ordinal of the term in that text) |

```lua
-- one open window (engine.lua)
local win = {
  id = 7, key = "demo.unrest",
  parent = nil,            -- the window that contains the term it came from; nil for roots
  anchor = "t:3:demo.unrest:0",
  children = {},           -- windows opened from terms in this one, oldest first
  pinned = false, frozen = false,
  via = "hover",           -- hover, click, key, touch, pad, api
  leave = nil,             -- {since = ms, check_at = ms} while the grace runs (§5)
  flash_at = nil,          -- ms; the flash ends FLASH ms later
  rect = nil,              -- {left, top, right, bottom} as last drawn (tendency, hit-testing)
  anchor_rect = nil,       -- the root's anchor box as last seen (frozen roots keep it)
}
```

Controller state (`init.lua`): `data` (locale → `{map = {key → entry}, order = {keys}}`), `labels` (locale → `{name → text}`), `wins` (array, oldest first), `hover = {win, link, trig}`, `hot` (set of windows), `pending` ([§6]: anchor, key, parent, is_link, delay, since, fire_at), `quiet` (hushed anchor), `samples` (`{x, y, t}`), `lock` (`{win, since}`, [§7]), `marks` and `marks_prev` (this frame's and the last frame's marks: id, key, rect, opts), `views` (per window: lines, term fragments, button rectangles, scroll offset, measured size), `press` (touch long-press: touch id, start, element), `swipe`, `swallow`, `esc_at`, `pad_b_at`, `focus` (window and index, section 10), `focused_mark` (the element the game's menu selected, `dt:set_focus(id)`).

## 4. Look (from `frameworks/web/deeptip.css`)

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| text `--dt-fg` | `#1F2328` | `#E6E8EC` |
| frame, hint separator `--dt-border` | `#C8CDD5` | `#3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `#0B69D4` | `#58A6FF` |
| term `--dt-link` | `#0B69D4` | `#6CB6FF` |
| term under the pointer `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| open term background | the term colour at 16 % alpha | same |
| missing term `--dt-missing` | `#DD3333` (wavy underline on the web) | same |

LÖVE 11 colours are floats 0‥1:

```lua
local function hex(s, a)   -- hex("#58A6FF") → {0.345, 0.651, 1, 1}
  return { tonumber(s:sub(2, 3), 16) / 255, tonumber(s:sub(4, 5), 16) / 255, tonumber(s:sub(6, 7), 16) / 255, a or 1 }
end
```

Sizes: font 14 px, line height 1.5 (21 px per line at 14 px), padding 12 left and right, header padding 6 6 2 12, title weight 650 (use the bold font), body bottom padding 10, paragraphs and lists 0.5 em apart, list indent 1.2 em, window width 240–384 px, max height 480 px (the body scrolls beyond it), gap 8, corner radius 8, frame 1 px, shadow `0 10 30` at 30 % black (draw two or three offset translucent rounded rectangles, or none), pin and close buttons 26×26 with 15 px icons (40×40 and 18 px after touch input), hint line 0.75 em at 60 % opacity with a 1 px separator above, "See also" 0.9 em, fallback badge 0.7 em with a 1 px frame at 65 % opacity. Motion: fade in over 150 ms with a 4 px slide, lock bar 2 px at the bottom edge filling linearly over `lockAfter`, flash = a 3 px accent ring for 600 ms; skip fade and slide when the player asked for reduced motion (your own setting).

Fonts: LÖVE's default font (Bitstream Vera Sans in 11.5) has `•`, `–`, `−`, `…`, `·` and `€`, but no arrows and no `△ ○ ✕ ✓` (checked with `Rasterizer:hasGlyphs`). Ship a font with the glyphs your glossaries use, and bold, italic and monospace files for the emphasis styles; `Font:setFallbacks(...)` chains extra fonts for missing glyphs (exists, checked). Draw the pin and close icons as lines, not as glyphs.

## 5. Order of operations per frame

`love.run` in 11.5 does, every frame (checked in `callbacks.lua`): pump and poll events, calling the handler `love.handlers[name]` with each event's arguments; `love.timer.step()`; `love.update(dt)`; `love.graphics.origin()`, `clear`, `love.draw()`, `present`; `love.timer.sleep(0.001)`. DeepTip fits into it like this:

1. **Events** (the wrappers of section 9, before the game's callbacks): pointer moves add samples ([§5]); presses and releases are hit-tested against the rectangles of the last drawn frame (window buttons, terms, window backgrounds, marks) and act at once ([§9.1], [§9.2]); keys and gamepad buttons act and are consumed when DeepTip used them ([§9.3], [§9.4]).
2. **`dt:update()`** at the start of `love.update`:
   1. `now = love.timer.getTime() * 1000`.
   2. Hover ([§6] "on pointer over"): `win` = the newest window whose rectangle contains the pointer; `link` = the term fragment under the pointer in that window (or on a page text); `trig` = the topmost mark of the last frame under the pointer, only when there is neither. If `{win, link, trig}` differs from the last frame: reset `quiet`, `refresh_hot()`, `lock_track()`, then `arm()` or `disarm()`. Skip this while the last pointer input was touch.
   3. Due times, in this order: the pending arm (`fire`: open, or wait another 90 ms while the pointer heads into another preview); each unpinned window's grace check ([§5] `tick`: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the timer lock ([§7]); the touch long-press; the end of the swallow; Esc held ≥ 600 ms (`love.keyboard.isDown("escape")` since `esc_at`); gamepad B held ≥ 600 ms (`joystick:isGamepadDown("b")`); the end of a flash.
   4. Windows whose content changed (opened, pinned or unpinned, language, live values, `refresh()`) are laid out again (section 6) and marked for placement.
3. **The game's `love.draw`** draws its scene and UI and calls `dt:mark(...)` and `dt:text(...)` for explained elements. `dt:mark` converts the rectangle through the current transform (`love.graphics.transformPoint`, exists in 11.5, checked), so marks inside `translate`/`scale` blocks are recorded in screen units.
4. **`dt:draw()`**, the last call of `love.draw`:
   1. Anchors gone ([§4.5]): a window whose mark was not drawn this frame closes when it is a preview; a pinned root freezes at its last box. Term anchors of windows exist as long as their window does.
   2. Root anchor boxes from this frame's marks; placement ([§8], section 7) for every window marked for placement and for every window whose anchor box or the screen size changed; parents before children (open order guarantees it).
   3. Draw every window, oldest first, and record its rectangle, its term fragments and its button rectangles for the next frame's hit-tests.
   4. Swap `marks` into `marks_prev`.

Hit-testing uses the rectangles of the last drawn frame, exactly what the player sees.

## 6. Text: markup → runs → lines with term rectangles [§3]

1. Parse the entry's text with `parse_text` ([§2]). Walk the AST and emit **runs** `{text, style, kind, term}`: `style` ∈ regular, bold, italic, bold italic, mono (`b` and `i` nest into bold italic, `code` is mono); `kind` ∈ text, term, own (a link to the window's own key: bold, not interactive), missing (dimmed, not interactive, one warning per key), value (a live value, bold); `term` = the target key and its occurrence number for term runs. Paragraphs are separated by one empty line (0.5 em in the web CSS), list items start with `• ` and are indented by 1.2 em, `br` breaks the line ([§3]).
2. **Line breaking:** split each run into tokens: words and the spaces between them. Measure a token with `font:getWidth(token)` of the run's font. Put tokens on the current line while `x + width ≤ max_width`; a space at the start of a line is dropped; a single word wider than the line is broken by UTF-8 characters (`utf8.offset`). Every line has the height `round(14 * 1.5) = 21` px; draw each token at `y + (21 - font:getHeight()) / 2` so fonts of different heights share the line.
3. **Term fragments:** while placing the tokens of a term run, extend the current fragment rectangle; when the term continues on the next line, start a new fragment. A term is one anchor with one or more fragments; hit-testing tests every fragment. Fragments are recorded relative to the window's content origin and offset by the scroll position when tested.
4. **Natural width** ([§8] step 3): lay out once with `max_width = 384 - 24`, take the widest line plus 24 (padding), clamp to 240‥384 and to the screen width minus 16; lay out again with the final width.
5. Draw: `love.graphics.setFont(font)`, `setColor(colour)`, `love.graphics.print(token, x, y)`; terms get a 1 px underline (`love.graphics.line`), dotted on the web, solid under the pointer; an open term gets the 16 % background behind its fragments; the term with the keyboard focus gets a 2 px accent outline.

Glossary text is never markup of LÖVE: `print` draws it literally, there is nothing to escape.

## 7. Windows: build, measure, place, draw [§8]

Window content, in the order of [§3]: header (title in the bold font; fallback badge with the source locale in upper case when the entry came from a fallback locale, its tooltip `label("fallback")` shown as a simple text on hover; pin button if `pin_button`; close button if `close_buttons`), body (`body`, else `short`, else `label("missing")`), "See also" line (`label("seeAlso")` and one term per key), hint line `label("hint")` when `hints` is on and the window is a preview, lock bar.

Placing one window:

```lua
local function place(dt, w, view)
  local sw, sh = love.graphics.getDimensions()
  local max_w, max_h = math.min(384, sw - 16), math.min(480, sh - 16)
  local size = { w = view.natural_w, h = math.min(view.content_h, max_h) }
  local a = w.parent and w.parent.rect or w.anchor_rect          -- children sit beside the parent window
  local vp = { w = sw, h = sh }
  local p = core.compute_placement(size, a, dt:sides(w), vp, 8)
  if p.maxW ~= 0 or p.maxH ~= 0 then                             -- 0 is true in Lua: compare explicitly
    if p.maxW ~= 0 then dt:relayout(w, math.min(max_w, p.maxW)) end
    size = { w = view.natural_w, h = math.min(view.content_h, p.maxH ~= 0 and math.min(max_h, p.maxH) or max_h) }
    p = core.compute_placement(size, a, { p.side }, vp, 8)
  end
  w.rect = { left = p.x, top = p.y, right = p.x + size.w, bottom = p.y + size.h }
end
```

`dt:sides(w)`: roots use their mark's `opts.place` (a list like `{"top", "bottom"}`) if set, else `options.root` (`bottom, top, right, left`); children use `options.child` (`left, right, top, bottom`). A window taller than its rectangle scrolls its body: draw the body inside `love.graphics.intersectScissor(...)` with `love.graphics.translate(0, -scroll)`, and change `scroll` with `love.wheelmoved` while the pointer is over that window. The scissor rectangle is not transformed by `translate`/`scale`, only multiplied by the DPI scale (checked in `Graphics::setScissor`): pass screen units.

Because a window is placed beside the box it came from, a child never covers its parent; it may cover older windows. Re-place when the screen size changes (`love.resize`), when a root's anchor box moves, or when a window's content changes size.

## 8. Coordinates, DPI and scaled games

- LÖVE 11 works in DPI-scaled units: mouse and touch event coordinates are converted with `windowToDPICoords` before the callbacks see them (checked in `Event.cpp`), and `love.graphics.getDimensions()` and drawing use the same units. DeepTip computes everything in these units, y down, which is the space of [§8]. `love.window.toPixels` / `fromPixels` convert to real pixels if you need them.
- High-DPI rendering is the `t.window.highdpi` flag of `love.conf` (macOS and iOS); `love.graphics.getDPIScale()` reports the factor (both exist, checked).
- Games with a fixed virtual resolution often draw into a `Canvas` and draw that canvas scaled to the window. Draw DeepTip **after** the scaled canvas, directly to the screen (crisp text at the real size), and convert mark rectangles from canvas units to screen units with the same scale and offset you draw the canvas with. Mouse positions stay screen units.
- Safe areas on phones: `love.window.getSafeArea()` (exists, checked) gives the inset rectangle; pass it as the viewport instead of the full screen.

## 9. Input details [§9]

Install once, after the game defined its callbacks or before, it does not matter: the wrappers sit in `love.handlers`, which `love.run` calls before any `love.*` callback.

```lua
function DeepTip:install()
  for _, name in ipairs({ "keypressed", "keyreleased", "textinput", "mousemoved", "mousepressed",
      "mousereleased", "wheelmoved", "touchpressed", "touchmoved", "touchreleased",
      "gamepadpressed", "gamepadreleased", "gamepadaxis", "mousefocus", "resize" }) do
    local game = love.handlers[name]
    love.handlers[name] = function(...)
      if self["on_" .. name](self, ...) then return end   -- true: DeepTip used it, the game never sees it
      return game(...)
    end
  end
end
```

| Reference | LÖVE |
|---|---|
| pointer move (mouse) | `mousemoved(x, y, dx, dy, istouch)`, `istouch == false`: add a sample `{x, y, now}`, drop samples older than 120 ms while more than 2 remain ([§5]) |
| pointer leaves the window | `love.mousefocus(false)` (handler `mousefocus`): `hover = {}`, `disarm()`, `lock_track(nil)`, `refresh_hot()` |
| click ([§9.1]) | `mousepressed`/`mousereleased(x, y, button, istouch, presses)`, button 1; act on the release over the same target as the press: close button → `close(w, true)`; pin button → toggle; a term → `follow(term, w, false)`; elsewhere inside a preview → pin it (`click_inside_pins`). Consume presses and releases inside windows, so the game behind does not react. |
| hush, outside press ([§9.2]) | press outside every window: on a mark (not touch) → `hush(mark)`; `outside_click_closes == "always"` closes all |
| touch ([§9.2]) | `touchpressed`: outside every window → close all (`"touch"`, the default); on a term → follow it on release; on a header (not a button) → start a swipe; on a mark → start the long-press. `touchmoved` beyond 10 px cancels the press; `touchreleased` ends it and checks the swipe (dy > 60, \|dx\| < 60 → close all). The long-press fires in `dt:update()`: open pinned (via `"touch"`), `love.system.vibrate(0.015)` if `vibrate`, set `swallow` for 1.5 s. Ignore mouse events with `istouch == true` (LÖVE's copies of touches) for hover and arming, and swallow the emulated `mousereleased` that ends a long-press so the game's button does not click. |
| Esc, Shift+Esc, hold Esc | `keypressed(key, scancode, isrepeat)` with `key == "escape"` while windows are open: `love.keyboard.isDown("lshift", "rshift")` → close all; else close `newest(focused window)` with focus back; remember `esc_at`; return true. Key repeat is off by default (checked: `hasKeyRepeat()` is false), so the 600 ms hold is checked in `dt:update()` with `isDown("escape")`. |
| F6, Shift+F6 | `key == "f6"` with windows open: focus the next older (newer) window, cycling |
| open keys F1, `?` | `key == "f1"`; `?` arrives as `textinput("?")` (layout independent; text input is on by default on desktop, checked). On a focused term → `follow(term, its window, true)`; with a focused element (`dt:set_focus(id)`) → open its window pinned with focus (via `"key"`). Return true. |
| typing into a marked text field | the game reports it with `dt:hush(id)` (LÖVE has no text widgets) |
| gamepad ([§9.4]) | `gamepadpressed(joystick, button)`: `"y"` open / follow, `"a"` activate the focused term or button, `"b"` remember the time (held ≥ 600 ms → close all in `dt:update()`, released earlier → close newest), `"leftshoulder"`/`"rightshoulder"` cycle windows, `"dpup"`/`"dpdown"`/`"dpleft"`/`"dpright"` move the focus inside the window. These names are valid gamepad names, `"lb"`/`"rb"` are not (checked with `setGamepadMapping`). `gamepadaxis(joystick, "leftx" or "lefty", value)` beyond ±0.6 counts as the d-pad; detect the edge yourself. Consume the buttons only while a DeepTip window has the focus or B closes a window. |

Applications that poll `love.keyboard.isDown("escape")` instead of using `love.keypressed` cannot be shielded; let them ask `dt:esc_used_this_frame()` (set when DeepTip closed a window on Esc in this frame) or `dt:has_windows()`.

## 10. Focus for keyboard and gamepad [§9.5]

LÖVE has no widget focus, so DeepTip keeps its own: `focus = {win = w, index = i}` over that window's focus list (its terms in text order, then pin and close). Opening by keyboard or gamepad focuses index 1 (the first term, else the pin button). While a window has the focus, `Tab`/`Shift+Tab` and the d-pad move the index with wrapping, `Enter`, `Space` and A follow the focused term or press the focused button, F1/`?`/Y on a focused term follows it; consume these keys so the game's menu does not move too. Draw the focused item with a 2 px accent outline. Closing the focused window gives the focus back to its anchor: for a term that is the parent window's index of that term, for a mark the game's own selection (`on_focus_back(id)` callback, because only the game knows how to select its element).

For F1 and Y on game elements, the game tells DeepTip what its own menu has selected: `dt:set_focus(id)` (or `nil`) whenever the selection changes.

## 11. Timers [§5]–[§7]

There are no cancellable timers in LÖVE; store due times. `schedule(ms, f)` becomes a field such as `pending.fire_at = now + delay`, `cancel` sets it to `nil`, and `dt:update()` runs whatever is due, in the order of section 5. `love.timer.getTime()` is a monotonic high-resolution clock in seconds (it advanced between frames in the headless run, checked). The `dt` argument of `love.update` is not needed. The lock bar's width is `(now - lock.since) / lock_after` of the window width, the arming bar's `(now - pending.since) / pending.delay` (`dt:arming(id)`).

## 12. Loading the JSON in file order [§1]

`flatten` needs the keys in file order ([§1.1]: a later duplicate of a key wins, and nested and flat forms of one key must resolve the same way in every runtime). Plain Lua tables have no order, and the usual libraries return plain tables: rxi `json.lua` 0.1.2 and `dkjson` 2.8 both return the keys of `glossary/core/en.json` in a different order than the file (checked). Use [lunajson](https://github.com/grafi-tt/lunajson) 1.2.3: its SAX parser reports keys in file order, and a few lines build tables that remember them (this decoder ran the parity cases, checked):

```lua
-- lib/deeptip/json.lua: objects remember their keys in file order; a duplicate key keeps its
-- first position and its last value, like JavaScript's JSON.parse
local lunajson = require("lunajson")
local M = { null = setmetatable({}, { __tostring = function() return "null" end }) }
local ARRAY = {}

function M.is_object(v) local mt = type(v) == "table" and getmetatable(v) return mt and mt.keys ~= nil or false end
function M.keys(obj) return getmetatable(obj).keys end

function M.decode(text)
  local stack, root = {}, nil
  local function put(v)
    local top = stack[#stack]
    if not top then root = v
    elseif top.keys then
      if top.t[top.k] == nil then top.keys[#top.keys + 1] = top.k end
      top.t[top.k] = v
    else top.t[#top.t + 1] = v end
  end
  local function open(t, keys) put(t) stack[#stack + 1] = { t = t, keys = keys } end
  local function close() stack[#stack] = nil end
  lunajson.newparser(text, {
    startobject = function() local keys = {} open(setmetatable({}, { keys = keys }), keys) end,
    key = function(k) stack[#stack].k = k end, endobject = close,
    startarray = function() open(setmetatable({}, ARRAY)) end, endarray = close,
    string = put, number = put, boolean = put, null = function() put(M.null) end,
  }).run()
  return root
end
return M
```

`flatten(obj)` walks `json.keys(node)` instead of `pairs(node)` and returns the entry keys in an `order` array next to the `entries` map. JSON `null` is the sentinel `json.null` (a `nil` would drop the key).

Loading ([§1.2]): `sources` are path templates with `{locale}`, e.g. `{"deeptip/core/{locale}.json", "deeptip/{locale}.json"}`. For each locale of the chain `unique({locale, ...fallback})`, read every template in order with `love.filesystem.read(path)` (it returns `nil` and a message for a missing file, checked; a missing file is a warning), decode, flatten, and add the entries to `data[locale]` (a later layer wins per key, a new key is appended to the order); merge `$ui` into `labels[locale]`. Remember read paths. `love.filesystem` reads the game folder or `.love` archive and the save directory, so mods and player overrides can live in the save directory under the same paths; absolute paths outside need `io.open` (desktop only). The locale of a file is its `$locale`, else the last dot part of its name (`myapp.de.json` → `de`).

## 13. Live values, language, refresh [§4.6]

- `options.vars`: a table name → value or `function(key) return … end` (called with the window's key), or one `function(name, key)`; `nil` keeps `{name}` visible ([§1.2]). Format numbers yourself: `tostring(1/3)` gives 14 significant digits, `string.format("%d", 192.0)` works (both checked).
- `dt:refresh()`: lay out every open window again with current values and labels, re-attach each child to the term with the same anchor string in its re-laid-out parent, re-place every window that is not frozen. Call it after your values changed (or compare the values a window showed with the current ones every 20 frames, as the RPG Maker plugin does).
- `dt:set_locale(locale)`: build the new chain, load the files not read yet, `refresh()`. LÖVE 11.5 has no `love.system.getPreferredLocales()` (checked: `nil`), `LANG` is not set on Windows and `os.setlocale()` returns `"C"` (checked): take the language from the game's own setting.

## 14. Porting the pure functions to Lua [§2] [§8]

`core.lua` follows the pseudo-code of algorithms.md line by line. Where Lua differs from JavaScript (all checked in LuaJIT 2.1 inside LÖVE 11.5):

- **Strings are bytes.** `#s` counts bytes (`#"Größe"` is 7), `utf8` is a module (`require("utf8")`, not a global) with `len`, `char`, `codepoint`, `offset`, `codes`; `utf8.codepoint` raises an error on invalid UTF-8, so decode code points yourself or call it with `pcall`. Index with byte positions and step over whole UTF-8 sequences.
- **Lua patterns are not regular expressions.** `%s` matches only the bytes 09–0D and 20; JavaScript's whitespace also includes U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Test code points:

```lua
local function js_space(c)
  return c ~= nil and ((c >= 0x09 and c <= 0x0D) or c == 0x20 or c == 0xA0 or c == 0x1680
    or (c >= 0x2000 and c <= 0x200A) or c == 0x2028 or c == 0x2029 or c == 0x202F
    or c == 0x205F or c == 0x3000 or c == 0xFEFF)
end

-- KEY_RE without regex; %w would depend on the C locale
local function is_key(s)
  if type(s) ~= "string" or s == "" then return false end
  for seg in (s .. "."):gmatch("([^.]*)%.") do
    if not seg:find("^[A-Za-z0-9_%-]+$") then return false end
  end
  return true
end
```

- `trim` removes `js_space` code points from both ends; the bullet pattern `^\s*[-•]\s+(.*)$` uses `js_space` as well, and a line whose text after the marker contains U+2028, U+2029 or `\r` is a paragraph line (`.` does not match line terminators in JavaScript). Split paragraphs with `find(src, "\n[ \t]*\n", pos)`; that pattern is plain ASCII and works as in JavaScript.
- `VAR_RE` looks at most 64 characters ahead; JavaScript counts UTF-16 units, Lua bytes. Names are ASCII, so only a `{` followed by more than 64 bytes of non-ASCII text could differ; none of the cases does.
- **Truthiness:** `0` and `""` are true in Lua. Write `if p.maxW ~= 0` where JavaScript writes `if (maxW)`.
- **Numbers:** `1/0` is `inf`, `0/0` is `nan`, `nan ~= nan` (checked), like JavaScript, so `room[s] / need(s)` in [§8] needs no special case. Lua 5.1 has no integer subtype: `3 == 3.0` and `tostring(192.0)` is `"192"` (checked).
- **Comparison and case** are byte-wise: `"Ä" < "Z"` is false and `("ÄÖÜ"):lower()` stays upper case (checked). The encyclopedia ([§12]) needs its own folding (lower-case ASCII plus a table for umlauts and accents).

## 15. API to offer

| Call | Does |
|---|---|
| `DeepTip.new(options)` | options of [SPEC §7](../../SPEC.md#7-configuration-reference-names) in snake_case: `delay`, `link_delay`, `close_delay`, `lock_after`, `long_press`, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `open_keys`, `gamepad`, `vibrate`; plus `theme` (`"dark"`, `"light"` or a table of colours), `fonts` (`regular`, `bold`, `italic`, `bold_italic`, `mono`), `on_open`, `on_close`, `on_pin`, `on_focus_back` |
| `dt:install()` | wrap `love.handlers` (section 9) |
| `dt:update()`, `dt:draw()` | once per frame, first in `love.update`, last in `love.draw` |
| `dt:mark(id, key, x, y, w, h, opts)` | an explained element in this frame |
| `dt:text(id, markup, x, y, width)` → height | markup with live terms on a normal screen (web: `renderText`) |
| `dt:index(x, y, w, h, query)` | the encyclopedia ([§12]); the search field is the game's |
| `dt:add(locale, obj)`, `dt:set_locale(locale)`, `dt:set_value(name, v)`, `dt:refresh()` | data ([§1.2], [§4.6]) |
| `dt:open(key, id, pinned)`, `dt:close_all()` | windows from code |
| `dt:set_focus(id)`, `dt:hush(id)` | the game's selection and typing (sections 9, 10) |
| `dt:has_windows()`, `dt:is_open(id)`, `dt:arming(id)`, `dt:esc_used_this_frame()` | for the game's own Esc handling, tooltips and rest bars |

## 16. Tests [§11]

Parity cases, headless inside LÖVE (no window, no graphics module); `lovec.exe` prints to the console on Windows, `love` elsewhere:

```lua
-- tests/parity/conf.lua
function love.conf(t)                    -- headless: no window, no graphics
  t.window = false
  for _, m in ipairs({ "window", "graphics", "audio", "sound", "video", "physics" }) do t.modules[m] = false end
end
```

```lua
-- tests/parity/main.lua   —   lovec tests/parity --cases <DeepTip>/test/cases
local lib = love.filesystem.getSource() .. "/../../lib/"
package.path = lib .. "?.lua;" .. lib .. "?/init.lua;" .. package.path
local core, json = require("deeptip.core"), require("deeptip.json")

local function same(want, got)           -- want: decoded case (JSON null = json.null), got: plain Lua tables
  if want == json.null then return got == nil end
  if type(want) ~= "table" then return type(got) == type(want) and got == want end
  if type(got) ~= "table" then return false end
  for k, v in pairs(want) do if not same(v, got[k]) then return false end end
  for k in pairs(got) do if want[k] == nil then return false end end
  return true
end

local function cases(dir, name)
  local f = assert(io.open(dir .. "/" .. name, "rb"))
  local text = f:read("*a")
  f:close()
  return json.decode(text).cases
end

function love.load(args)
  local dir
  for i, a in ipairs(args) do if a == "--cases" then dir = args[i + 1] end end
  local total, failed = 0, 0
  local function check(name, ok)
    total = total + 1
    if not ok then failed = failed + 1 print("FAIL " .. name) end
  end
  for _, c in ipairs(cases(dir, "markup.json")) do check(c.name, same(c.blocks, core.parse_text(c.src))) end
  for _, c in ipairs(cases(dir, "placement.json")) do
    check(c.name, same(c.expect, core.compute_placement(c.size, c.anchor, c.sides, c.viewport)))
  end
  for _, c in ipairs(cases(dir, "glossary.json")) do
    local r = core.flatten(c.input)
    check(c.name, same(c.expect, { keys = r.order, meta = r.meta_order, problems = #r.problems }))
  end
  print(("%d/%d parity cases passed"):format(total - failed, total))
  love.event.quit((failed == 0 and total > 0) and 0 or 1)
end
```

`parse_text` returns the AST of [§2] as plain tables (`text` is `nil` when absent, which `same` compares with `json.null`), `flatten` returns `{entries, order, meta, meta_order, problems}`, `compute_placement` returns `{side, x, y, fits, maxW, maxH}`. Expected: `24/24 parity cases passed`, exit code 0 (checked with exactly this runner).

Behaviour tests run the same way: `engine.lua` takes `now` as an argument, so a headless script can open windows, move a fake pointer through `on_mousemoved`, advance time and check the invariants of [§4] (one preview per parent, pinned chain, subtree close, flash instead of a second window), grace and tendency ([§5]) and suppression. `love.event.push("keypressed", "escape", "escape", false)` delivers events without a window (checked). Compare the feel with the web example (`npm run demo`).

## 17. The example to build

The scene of every DeepTip example, in `example/main.lua`, using the shared glossaries copied to `deeptip/core/` and `deeptip/example/`:

- A top bar of buttons drawn with `rectangle` + `print` and marked: Realm `demo.realm`, Stability `demo.stability` (a click cycles −3…+3, then `dt:refresh()`), Taxes `demo.taxes` (a click cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and `{delay = 0}`; a language button (de/en) calling `dt:set_locale()`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- A page text drawn with `dt:text()` containing the loop `[[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]` (needs a font with `→`).
- Options: `sources = {"deeptip/core/{locale}.json", "deeptip/example/{locale}.json"}`, `fallback = {"de", "en"}`, `delay = 1000`, `vars = {stability = function() return (stability > 0 and "+" or "") .. stability end, gold = function() return tostring(gold) end}`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.
- A smoke run: `love example` with `love.event.quit()` after 3 s when `--smoke` is passed.

## 18. Pitfalls

1. **Install the wrappers in `love.handlers`, not in `love.keypressed`.** Libraries that replace `love.keypressed` (state managers, UI kits) then still come after DeepTip. A library that also wraps `love.handlers` after `dt:install()` runs before DeepTip; install DeepTip last in that case.
2. **`Font:getWrap` and `printf`** wrap whole strings and drop the per-run information you need for terms (section 6); use them only for single-style text such as the hint line.
3. **The scissor ignores transforms** (checked in the source): compute screen rectangles before `translate`.
4. **Touch arrives twice**, as `touch*` and as mouse events with `istouch == true`; treating both opens windows twice or lets a long-press click the element.
5. **Key repeat is off** by default; do not rely on `isrepeat` for the Esc hold.
6. **`?` is text, not a key**: `keypressed` reports `"/"` (US layout) or `"ß"` (German layout); use `textinput`.
7. **Ordered JSON**: rxi `json.lua`, `dkjson` and other decoders that return plain tables lose the file order (section 12).
8. **Fonts**: the default font lacks arrows and symbols; bold and italic need their own font files; set the filter of pixel fonts to `"nearest"`, but use `"linear"` for text that is drawn at a DPI scale.
9. **Byte strings**: `#`, `sub`, comparisons and `lower` work on bytes (section 14).
10. **`0` is true**: every `if x then` copied from JavaScript where `x` can be `0` or `""` is a bug.
11. **Coordinates of scaled games**: marks must be screen units (section 8).
12. **Frame order**: hit-tests use the rectangles of the last drawn frame; do not hit-test against rectangles computed before a re-layout in the same frame.

## 19. Limitations

- No screen reader output: LÖVE has no accessibility API ([SPEC §6](../../SPEC.md#6-accessibility) is met for keyboard and gamepad only).
- No widgets: the game reports its elements (`mark`), its selection (`set_focus`) and typing (`hush`) itself.
- The focus inside windows is DeepTip's own index, not a system focus.
- Pollers of `love.keyboard.isDown("escape")` cannot be shielded from the Esc that closed a window (section 9).

## 20. Checklist

1. `core.lua` and `json.lua` with lunajson; the parity runner prints `24/24 parity cases passed` (section 16).
2. `engine.lua` ported from algorithms [§4]–[§7] (or from `frameworks/rust-egui/src/engine.rs`) with scenario tests.
3. `layout.lua`: runs, line breaking, term fragments (section 6); windows and placement (section 7).
4. `init.lua`: `love.handlers` wrappers, frame order, focus, gamepad, touch (sections 5, 9, 10).
5. The example (section 17); compare with the web example by hand.
6. The validator reports 0 errors for your glossaries; then list the framework with its state in the main README.

[§1]: ../../docs/algorithms.md#1-data
[§1.1]: ../../docs/algorithms.md#11-flattening-one-glossary-file
[§1.2]: ../../docs/algorithms.md#12-layers-locales-lookup
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§4.5]: ../../docs/algorithms.md#45-anchors-that-disappear
[§4.6]: ../../docs/algorithms.md#46-refresh
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§9.1]: ../../docs/algorithms.md#91-clicks
[§9.2]: ../../docs/algorithms.md#92-pointer-down-touch
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
