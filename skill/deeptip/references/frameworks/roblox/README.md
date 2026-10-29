# DeepTip for Roblox (Luau)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, into the client UI of a Roblox experience with Luau. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Luau implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to Roblox and Luau.

Statements marked (checked) were verified on 2026-10-29: Luau language behaviour with the official **Luau 0.744** command-line tools (`luau`, `luau-analyze`); Roblox engine members against the engine API reference in Roblox's own documentation sources ([Roblox/creator-docs](https://github.com/Roblox/creator-docs), `reference/engine/classes/*.yaml` and the UI and input guides, fetched that day); Rojo's file mapping against the [Rojo 7 documentation](https://rojo.space/docs/v7/sync-details/). A Luau port of [§1], [§2] and [§8] with the ordered JSON decoder of section 12 passed all 24 shared cases in the `luau` CLI and `luau-analyze --mode=strict` without findings. Roblox Studio was not available, so engine behaviour that the reference does not state (event order, what Escape does for scripts) is marked (verify). The closest complete implementation is the Rust crate in [frameworks/rust-egui](../rust-egui/README.md): its `src/engine.rs` (the window tree and every timer, no UI types) ports to Luau almost line by line.

**Download:** `DeepTip-roblox-1.0.0.zip` holds this guide with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** a place file (`*.rbxl`, `*.rbxlx`) or a Rojo project (`default.project.json` with `src/` folders of `.luau`/`.lua` files, often with `wally.toml`, `aftman.toml` or `rokit.toml`); client code in `StarterPlayerScripts` or `StarterGui`.

1. Create the ModuleScripts `DeepTip` (with `Core`, `Json`, `Engine`, `Layout`, `Ui` inside) in `ReplicatedStorage` (section 1).
2. Run the parity runner with the `luau` CLI until it prints `24/24 parity cases passed` (section 16).
3. Put `glossary/core/<locale>.json` and your glossary as JSON text into StringValues under `ReplicatedStorage.DeepTip.Glossary` (Rojo: copies with the `.txt` extension, section 12).
4. Start DeepTip in one LocalScript in `StarterPlayerScripts` and mark GuiObjects with `dt:mark(guiObject, key)`.
5. Validate the JSON sources: `node <DeepTip>/tools/deeptip-check.mjs --base en glossary/core/en.json glossary/en.json`.

```lua
-- StarterPlayerScripts/DeepTipClient.client.luau
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DeepTip = require(ReplicatedStorage.DeepTip)

local dt = DeepTip.new({ locale = "en", fallback = { "en" }, sources = { "core/{locale}", "{locale}" } })

local gui = Instance.new("ScreenGui")
gui.ResetOnSpawn = false
local help = Instance.new("TextButton")
help.Text = "?"
help.Size = UDim2.fromOffset(40, 32)
help.Position = UDim2.fromOffset(20, 20)
help.Parent = gui
gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")

dt:mark(help, "deeptip.about") -- rest the mouse on it: its window opens
```

**Done when:** the parity runner prints `24/24 parity cases passed`, in a play test resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Backspace` or gamepad B closes the newest, the validator reports 0 errors.

## 1. Parts to build

| ModuleScript (under `ReplicatedStorage.DeepTip`) | Content | Algorithms |
|---|---|---|
| `Core` | pure functions, no instances: `flatten(obj)`, `parseText(src)`, `collectRefs(blocks)`, `computePlacement(size, anchor, sides, vp, gap)` | [§1.1], [§2], [§8] |
| `Json` | ordered JSON decoding (section 12) | [§1.1] |
| `Engine` | the window tree and its timers as a state machine: open, close, pin, hot set, grace, tendency, suppression, arming, timer lock; time, boxes and the hover state are passed in | [§4]–[§7] |
| `Layout` | markup AST → styled runs → lines with the rectangles of every term fragment | [§3] |
| `Ui` | the ScreenGui, window Frames, term buttons, input bindings, selection, the frame loop | [§9] |
| `DeepTip` (the parent module) | `DeepTip.new(options)`: glossary layers, locale chain, the API of section 15 | [§1.2] |
| `Glossary` (Folder of StringValues) | `core/en`, `core/de`, `en`, `de` …: the JSON text of `glossary/core/` and your project glossary | |

Outside Roblox: `tests/parity.luau` and `tests/make_cases.py` for the `luau` CLI (section 16). Keep `Core`, `Json` and `Engine` free of Roblox APIs: they then run unchanged in the CLI, in Studio and in any Luau test runner.

## 2. SPEC concept → Roblox primitive

| DeepTip | Roblox |
|---|---|
| Controller | one object created by one LocalScript in `StarterPlayerScripts`; client only (UI and input do not exist on the server) |
| Top layer | an own `ScreenGui` in `PlayerGui`: `DisplayOrder` higher than every game ScreenGui, `ResetOnSpawn = false` (default `true` would delete it on respawn, checked), `ZIndexBehavior = Enum.ZIndexBehavior.Sibling`, `IgnoreGuiInset = false` (section 8) |
| Window order | one `Frame` (or `ImageButton`, section 9) per window, `ZIndex` = open order, so the newest lies on top |
| Window ([§3]) | `UICorner` (8 px), `UIStroke` with `ApplyStrokeMode = Enum.ApplyStrokeMode.Border` (frame instead of text outline, checked), `UIPadding`; header Frame [title, badge, pin and close `ImageButton`s], body `ScrollingFrame`, "See also", hint, lock bar |
| Rich text | `TextLabel.RichText = true` with `<b>`, `<i>`, `<u>`, `<font color="#RRGGBB">`, `<font weight="SemiBold">`, `<mark color="#…" transparency="0.84">` (background) and `<br/>` (all checked); escape `&` `<` `>` `"` `'` as `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` (checked) |
| Term | A `TextLabel` has no per-run boxes, so the layout measures every run (section 6), draws each line as one RichText `TextLabel`, and puts one transparent `TextButton` over each line fragment of a term. The buttons give hover (`MouseEnter`, `MouseLeave`), click and touch (`Activated`), and gamepad selection for free. |
| Marked UI element (web: `data-deeptip`) | any `GuiObject`, registered once with `dt:mark(guiObject, key, opts)`; its box is read every frame from `AbsolutePosition` and `AbsoluteSize`; `opts.delay` and `opts.place` are the per-element overrides |
| Element under the pointer | `PlayerGui:GetGuiObjectsAtPosition(x, y)` lists the GuiObjects at a point from top to bottom (checked); the first marked one counts, only when the pointer is neither in a window nor on a term |
| Window under the pointer | own rectangle test over the window Frames, newest first |
| Pointer, samples ([§5]) | `UserInputService.InputChanged` with `Enum.UserInputType.MouseMovement`: `input.Position` |
| `now()`, `schedule()` | `os.clock() * 1000`; due times in the records, checked every frame in `RunService.Heartbeat` (or `task.delay` + `task.cancel`) |
| Consuming keys | `ContextActionService:BindActionAtPriority(name, fn, false, priority, keys...)`: a higher priority runs first whatever the binding order, and a handler that returns `Enum.ContextActionResult.Sink` (or `nil`) stops the lower handlers; `Pass` hands the input on (checked). Games on the newer input action system (`InputContext` with `Priority` and `Sink`, checked) get a DeepTip `InputContext` with a high priority instead. |
| Escape | opens the Roblox menu (`GuiService.MenuOpened`, `MenuClosed`, checked); DeepTip cannot rely on it (section 9) and closes with `Backspace` and gamepad B |
| Touch | `UserInputService.TouchLongPress(touchPositions, state, gameProcessedEvent)` (checked) for the long-press; `Activated` of term buttons for taps |
| Gamepad | `Enum.KeyCode.ButtonY`, `ButtonA`, `ButtonB`, `ButtonL1`, `ButtonR1`, `DPadUp`… through `ContextActionService`; selection with `GuiService.SelectedObject` (section 10); `HapticService:SetMotor(Enum.UserInputType.Gamepad1, motor, value)` (checked) |
| Rest progress (`data-dt-arming`) | `dt:arming(guiObject)` → 0‥1 or `nil` |
| Open state (`data-dt-open`) | `dt:isOpen(guiObject)` |
| `onOpen`, `onClose`, `onPin` | options `onOpen`, `onClose`, `onPin` (functions taking the key) |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | none found in the engine reference for experiences (verify) |

## 3. Data structures

Records are tables compared by reference. Anchors need value equality (a term laid out again after a language switch must stay the same anchor), so an anchor is either the marked `GuiObject` itself (instances compare by identity) or a string:

| Anchor | Value |
|---|---|
| marked element | the `GuiObject` |
| term in a window | `"t:" .. win.id .. ":" .. key .. ":" .. n` (n = occurrence of that key in the window, 0 = first) |
| term on a page (`dt:text`) | `"p:" .. textId .. ":" .. n` |

```lua
export type Box = { left: number, top: number, right: number, bottom: number }
export type Win = {
	id: number,
	key: string,
	parent: Win?, -- the window that contains the term it came from; nil for roots
	anchor: GuiObject | string,
	children: { Win }, -- windows opened from terms in this one, oldest first
	pinned: boolean,
	frozen: boolean, -- a pinned root whose anchor vanished (§4.5)
	via: string, -- "hover", "click", "key", "touch", "pad", "api"
	leaveSince: number?, -- grace (§5): when the pointer left
	checkAt: number?, -- next grace check
	flashAt: number?, -- the flash ends 700 ms later
	rect: Box?, -- as last placed
	anchorRect: Box?, -- the root's anchor box as last seen
	view: Frame?, -- the window's instances
}
```

Controller state: `data` (locale → `{map = {[key]: entry}, keys = {string}}`), `labels` (locale → `{[name]: text}`), `wins` (oldest first), `hover = {win, link, trig}`, `hot` (set), `pending` ([§6]: anchor, key, parent, isLink, delay, since, fireAt), `quiet`, `samples` (`{x, y, t}`), `lock` (`{win, since}`, [§7]), `marks` (`{[GuiObject]: {key, opts}}`), `press`, `swipe`, `swallowUntil`, `padBAt`, `selectedBefore` (the selection before a window took it, section 10), `connections` (to disconnect on `destroy()`).

## 4. Look (from `frameworks/web/deeptip.css`)

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| text `--dt-fg` | `#1F2328` | `#E6E8EC` |
| frame, hint separator `--dt-border` | `#C8CDD5` | `#3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `#0B69D4` | `#58A6FF` |
| term `--dt-link` | `#0B69D4` | `#6CB6FF` |
| term under the pointer `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| open term background | `<mark>` in the term colour, `transparency="0.84"` (16 % opaque) | same |
| missing term `--dt-missing` | `#DD3333` | same |

`Color3.fromHex("#58A6FF")`. Sizes: font size 14, line height 1.5 (21 px rows; a single `TextLabel` would use `LineHeight = 1.5`, a multiple of the font's em, valid 1.0–3.0, checked), padding 12 left and right (`UIPadding`), header padding 6 6 2 12, title `<font weight="SemiBold">`, body bottom padding 10, window width 240–384, max height 480 (the body scrolls beyond it), gap 8, `UICorner.CornerRadius = UDim.new(0, 8)`, `UIStroke.Thickness = 1`, pinned stroke in the accent colour, a soft shadow (an `ImageLabel` with a blurred 9-slice image behind the window, or none), pin and close buttons 26×26 with 15 px icons (40×40 when `UserInputService.PreferredInput` reports touch, checked as a property), hint line at size 10.5 and 60 % opacity with a 1 px separator, "See also" at 12.6, fallback badge at 9.8 with a 1 px stroke. Motion: fade in over 150 ms with a 4 px slide (`TweenService`), lock bar 2 px at the bottom edge filling linearly over `lockAfter`, flash = the accent stroke at 3 px for 600 ms.

## 5. Order of operations per frame

1. **Input events** (between frames, in the order Roblox delivers them, verify): `InputChanged` (mouse movement → sample, drop samples older than 120 ms while more than 2 remain, [§5]), `InputBegan` / `InputEnded` (presses: outside every window → `outsideClickCloses`; on a mark → `hush`), the `ContextActionService` handlers for keys and gamepad buttons (section 9), `Activated` of term, pin, close and window buttons (section 9), `TouchLongPress`.
2. **`RunService.Heartbeat`**, the DeepTip step:
   1. `now = os.clock() * 1000`.
   2. Marks gone ([§4.5]): a mark whose `GuiObject` left the game (`Parent == nil`), is not visible (`Visible == false` on it or an ancestor, or its ScreenGui is disabled) or was unmarked: its preview closes, a pinned root freezes at its last box. Root anchor boxes from `AbsolutePosition` / `AbsoluteSize`.
   3. Hover ([§6] "on pointer over"): `win` = the newest window whose rectangle contains the pointer; `link` = the term button under the pointer (its `MouseEnter`/`MouseLeave` keep `hoveredTerm`); `trig` = the first marked GuiObject in `GetGuiObjectsAtPosition(x, y)`, only when there is neither. If `{win, link, trig}` differs from the last frame: reset `quiet`, `refreshHot()`, `lockTrack()`, then `arm()` or `disarm()`. Skip this while the last input was touch.
   4. Due times, in this order: the pending arm (open, or wait another 90 ms while the pointer heads into another preview); each unpinned window's grace check ([§5]: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the timer lock ([§7]); the end of the swallow; gamepad B held ≥ 600 ms (`UserInputService:IsGamepadButtonDown(Enum.UserInputType.Gamepad1, Enum.KeyCode.ButtonB)`, checked); the end of a flash.
   5. Windows whose content changed are laid out again (section 6); windows whose content, anchor box or viewport changed are placed again (section 7); lock and flash visuals are updated.

Text measurement with `TextService:GetTextBoundsAsync` yields (checked: tagged `Yields`), so it must not run inside `Heartbeat`: lay out a new window in a `task.spawn`ed function and place it when the measurement is done (one or more frames later; keep it invisible until then), or measure synchronously with `TextService:GetTextSize` (section 6).

## 6. Text: markup → runs → lines with term buttons [§3]

1. Parse the entry's text with `Core.parseText` ([§2]). Walk the AST and emit **runs** `{text, bold, italic, code, kind, term}`: `kind` is text, term, own (a link to the window's own key: bold, not interactive), missing (dimmed, not interactive, one warning per key), value (a live value, bold). Paragraphs are separated by one empty line, list items start with `• ` and are indented by 1.2 em, `br` breaks the line ([§3]).
2. **Measure:** split runs into words and the spaces between them; measure each piece once per style and cache it. `TextService:GetTextBoundsAsync(params)` takes a `GetTextBoundsParams` with `Text`, `Font` (a `Font` with weight and style), `Size`, `Width` and `RichText` (checked) and returns a `Vector2`; `TextService:GetTextSize(text, fontSize, font, frameSize)` is synchronous but takes an `Enum.Font` (checked), so it fits when your fonts exist as `Enum.Font` items (for example `SourceSans`, `SourceSansBold`, `SourceSansItalic`, `RobotoMono`).
3. **Lines:** put pieces on a line while they fit into the content width; drop a space at the start of a line; break a word wider than the line by UTF-8 characters (`utf8.offset`). Lines are 21 px apart. Summing the widths of separately measured pieces ignores kerning across their boundaries; keep a pixel of slack in hit boxes.
4. **Draw a line** as one `TextLabel` (`RichText = true`, `TextXAlignment = Left`, `BackgroundTransparency = 1`, `Size = UDim2.new(1, 0, 0, 21)`): every piece escaped (`&amp;` first, then `&lt;`, `&gt;`, `&quot;`, `&apos;`) and wrapped in its tags: bold `<b>`, italic `<i>`, code `<font face="RobotoMono">`, value `<b>`, term `<font color="#6CB6FF"><u>…</u></font>`, an open term additionally `<mark color="#6CB6FF" transparency="0.84">`, a missing term `<font color="#DD3333"><u>…</u></font>`.
5. **Term fragments:** for every line part of a term, add a `TextButton` with `Text = ""`, `BackgroundTransparency = 1`, `AutoButtonColor = false`, `Selectable = true`, positioned over the fragment (x from the measured widths, y = line top, height 21). All fragments of one term belong to one anchor; `MouseEnter` on any of them is hover, `Activated` is follow.
6. **Natural width** ([§8] step 3): lay out with a maximum of 384 − 24, take the widest line plus 24, clamp to 240‥384 and to the viewport width minus 16, and lay out again with the final width.

A simpler alternative for short bodies: one `TextButton` per word inside a Frame with a horizontal `UIListLayout` whose `Wraps = true` (siblings wrap to the next line when they exceed the container, checked); Roblox then wraps for you, at the cost of many instances and no control over line height.

## 7. Windows: build, measure, place [§8]

Window content, in the order of [§3]: header (title; fallback badge with the source locale in upper case when the entry came from a fallback locale, a small hover label with `label("fallback")`; pin button if `pinButton`; close button if `closeButtons`), body (`body`, else `short`, else `label("missing")`), "See also" line (`label("seeAlso")` and one term per key), hint line `label("hint")` when `hints` is on and the window is a preview, lock bar.

```lua
local MAX_W, MAX_H, GAP = 384, 480, 8

local function place(dt, w)
	local vs = dt.screenGui.AbsoluteSize -- the viewport in the inset coordinate system (section 8)
	local maxW, maxH = math.min(MAX_W, vs.X - 2 * GAP), math.min(MAX_H, vs.Y - 2 * GAP)
	local size = { w = w.naturalW, h = math.min(w.contentH, maxH) }
	local a = if w.parent then w.parent.rect else w.anchorRect -- children sit beside the parent window
	local vp = { w = vs.X, h = vs.Y }
	local p = Core.computePlacement(size, a, dt:sides(w), vp, GAP)
	if p.maxW ~= 0 or p.maxH ~= 0 then -- 0 is truthy in Luau: compare explicitly
		if p.maxW ~= 0 then dt:relayout(w, math.min(maxW, p.maxW)) end
		size = { w = w.naturalW, h = math.min(w.contentH, if p.maxH ~= 0 then math.min(maxH, p.maxH) else maxH) }
		p = Core.computePlacement(size, a, { p.side }, vp, GAP)
	end
	w.view.Position = UDim2.fromOffset(p.x, p.y)
	w.view.Size = UDim2.fromOffset(size.w, size.h)
	w.rect = { left = p.x, top = p.y, right = p.x + size.w, bottom = p.y + size.h }
end
```

`dt:sides(w)`: roots use their mark's `opts.place` (like `{"top", "bottom"}`) if set, else `root` (`bottom, top, right, left`); children use `child` (`left, right, top, bottom`). The body is a `ScrollingFrame` (`CanvasSize` = content height, `ScrollBarThickness` 4, `ScrollingDirection = Y`), so long entries scroll with the wheel, touch and the gamepad. Because a window is placed beside the box it came from, a child never covers its parent; it may cover older windows. Re-place when the viewport changes (`screenGui:GetPropertyChangedSignal("AbsoluteSize")`), when a root's anchor box moves, or when a window's content changes size.

## 8. Coordinates, insets and UI scale

- `GuiBase2d.AbsolutePosition` of anything inside a ScreenGui is given in the coordinate system of `Enum.ScreenInsets.CoreUISafeInsets`, whose origin is the bottom-left corner of the Roblox top bar, and `InputObject.Position` uses the same system (checked). `UserInputService:GetMouseLocation()` does **not** account for the insets; subtract the top-left inset of `GuiService:GetGuiInset()` to convert (checked).
- So DeepTip computes everything in that system: pointer = `input.Position` of the input events, anchor boxes = `AbsolutePosition` + `AbsoluteSize`, viewport = the `AbsoluteSize` of DeepTip's own ScreenGui with `IgnoreGuiInset = false` (its default keeps the bounds below the top bar, checked), so a window's `Position = UDim2.fromOffset(x, y)` lands exactly at `(x, y)` of [§8].
- `AbsolutePosition` and `AbsoluteSize` are the real rendered pixels "as a result of its ancestors' sizes and positions" (checked), so game UIs scaled with `UIScale` or `Scale` sizes give correct anchor boxes. Do not put a `UIScale` into DeepTip's own ScreenGui, or divide every computed offset by it.
- Phones: `ScreenInsets` keeps content out of notches (checked); leave DeepTip's ScreenGui at its default so windows stay inside the safe area.

## 9. Input details [§9]

| Reference | Roblox |
|---|---|
| pointer leaves the window | `UserInputService.WindowFocusReleased` (exists, checked): `hover = {}`, `disarm()`, `lockTrack(nil)`, `refreshHot()` |
| click ([§9.1]) | term buttons: `Activated` → `follow(term, win, false)`; pin and close `ImageButton`s: `Activated` → toggle, `close(w, true)`; the window root is an `ImageButton` (`AutoButtonColor = false`, transparent image): its `Activated` is `clickInsidePins`. Buttons stop clicks from reaching game UI behind them; inside a button the topmost button gets the click (verify for nested buttons). `Activated` fires for a click, a touch release and A in UI navigation (checked). |
| hush, outside press ([§9.2]) | `UserInputService.InputBegan` with `MouseButton1`: on a marked GuiObject → `hush`; outside every window and `outsideClickCloses == "always"` → close all. `Enum.UserInputType.Touch` outside every window → close all (`"touch"`, the default). |
| touch ([§9.2]) | `TouchLongPress(touchPositions, state, gameProcessedEvent)` with `state == Enum.UserInputState.Begin` on a marked GuiObject (found with `GetGuiObjectsAtPosition`) → open pinned (via `"touch"`), set `swallowUntil = now + 1500` and ignore that element's `Activated` until then; the length of a long-press is the engine's, not `longPress`. A swipe down on a header: track `InputBegan`/`InputChanged`/`InputEnded` of that touch (dy > 60, \|dx\| < 60 → close all). |
| Esc, Shift+Esc, hold Esc | Escape toggles the Roblox menu. Whether scripts still receive it is not stated in the reference (verify); do not build on it. Close the newest window with `Backspace` (Shift+Backspace closes all) and gamepad B, bound with `ContextActionService` while windows are open; close all windows when `GuiService.MenuOpened` fires. `Backspace` drops tools in default Roblox controls (verify): binding it at a higher priority and returning `Sink` keeps it from lower bindings while DeepTip windows are open. |
| F6, Shift+F6 | `Enum.KeyCode.F6` through the same binding: focus the next older (newer) window |
| open keys F1, `?` | `Enum.KeyCode.F1`; `Enum.KeyCode.Question` exists (checked), but on many layouts `?` arrives as `Slash` with Shift (verify): bind both. On a selected term → `follow(term, its window, true)`; on a selected marked element → open its window pinned with the selection inside (via `"key"`). Not while a TextBox has focus (`UserInputService:GetFocusedTextBox()`, checked). |
| typing into a marked TextBox | `TextBox:GetPropertyChangedSignal("Text")` while it is focused → `hush(textBox)` |
| gamepad ([§9.4]) | `ButtonY` open / follow (selected element or term); `ButtonA` is native (`Activated` of the selected button); `ButtonB` tap closes the newest, held ≥ 600 ms closes all (checked in Heartbeat); `ButtonL1` / `ButtonR1` focus the newer / older window; the d-pad and thumbstick move the selection natively inside the window (section 10). Bind Y, B, L1 and R1 only while a DeepTip window is open or a marked element is selected, and return `Pass` otherwise, so the game keeps its buttons. B normally cancels a GUI selection (checked); DeepTip's binding must run first (priority) while its window has the selection (verify that a `Sink` also stops the engine's own deselect). |

```lua
local ContextActionService = game:GetService("ContextActionService")
local PRIORITY = Enum.ContextActionPriority.High.Value + 100

local function onKey(_name: string, state: Enum.UserInputState, input: InputObject): Enum.ContextActionResult
	if state ~= Enum.UserInputState.Begin or not dt:hasWindows() then
		return Enum.ContextActionResult.Pass
	end
	local key = input.KeyCode
	if key == Enum.KeyCode.Backspace or key == Enum.KeyCode.ButtonB then
		if key == Enum.KeyCode.Backspace and UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) then
			dt:closeAllFocusBack()
		else
			dt:closeNewestFocusBack()
			if key == Enum.KeyCode.ButtonB then dt.padBAt = os.clock() * 1000 end
		end
		return Enum.ContextActionResult.Sink
	elseif key == Enum.KeyCode.F6 or key == Enum.KeyCode.ButtonR1 or key == Enum.KeyCode.ButtonL1 then
		dt:cycle(if key == Enum.KeyCode.ButtonL1 then -1 else 1)
		return Enum.ContextActionResult.Sink
	end
	return Enum.ContextActionResult.Pass
end

ContextActionService:BindActionAtPriority("DeepTipKeys", onKey, false, PRIORITY,
	Enum.KeyCode.Backspace, Enum.KeyCode.ButtonB, Enum.KeyCode.F6, Enum.KeyCode.ButtonL1, Enum.KeyCode.ButtonR1)
```

The open keys (F1, `?`, ButtonY) have their own binding that also acts without open windows (a selected marked element).

## 10. Selection for keyboard and gamepad [§9.5]

Roblox's UI navigation already moves a selection between `Selectable` GuiObjects with the d-pad and thumbstick, and A activates the selected button; DeepTip uses it:

- Term buttons and the pin and close buttons are `Selectable = true`; the window root sets `SelectionGroup = true` and `SelectionBehaviorUp/Down/Left/Right = Enum.SelectionBehavior.Stop`, so the selection stays inside the window (the default `Escape` lets it leave, checked).
- Opening by keyboard or gamepad: remember `GuiService.SelectedObject`, then `GuiService:Select(window)` (selects a selectable descendant, checked) or set `GuiService.SelectedObject` to the first term button. The selected term is drawn with the 2 px accent outline (`SelectionImageObject`, or the default selection image).
- The selected window is the one that contains `GuiService.SelectedObject`; `F6`, `ButtonL1` and `ButtonR1` move the selection to the first term of the next window.
- Closing a window that holds the selection gives it back: for a term to the same term in the parent window, for a marked element to the remembered `SelectedObject`. `GuiService.SelectedObject` may reset to `nil` when an object goes off screen (checked).
- Keyboard users without a gamepad: Roblox's keyboard UI navigation is not universal (verify for your experience); `Tab`/`Shift+Tab` can be bound like F6 to step through the window's terms.

## 11. Timers [§5]–[§7]

Store due times and compare them with `os.clock() * 1000` in `Heartbeat`; `schedule(ms, f)` becomes a field such as `pending.fireAt = now + delay`, `cancel` sets it to `nil`. `task.delay(seconds, f)` returns a thread that `task.cancel` stops, which also works, but due times keep the fixed order of section 5 in one place. The lock bar's width is `(now - lock.since) / lockAfter` of the window width, the arming bar's `(now - pending.since) / pending.delay`. `RunService:BindToRenderStep(name, priority, fn)` (client only, checked) is an alternative to `Heartbeat` when DeepTip must run before or after the game's own render-step functions.

## 12. Loading the JSON in file order [§1]

`flatten` needs the keys in file order ([§1.1]: a later duplicate wins, and nested and flat forms of one key must resolve the same way in every runtime). Luau tables do not keep insertion order: keys inserted as `zeta, alpha, mu, beta, demo.realm, demo.gold, $schema` iterate as `zeta, $schema, demo.gold, demo.realm, mu, alpha, beta` (checked). `HttpService:JSONDecode` returns such tables (checked), and Rojo syncs a `.json` file as a ModuleScript that returns a table (checked), so both lose the order. Keep the JSON **text** instead (Rojo syncs `.txt` files as `StringValue`s, checked; in Studio paste the text into a `StringValue`) and decode it with an ordered decoder:

```lua
--!strict
-- Json: objects become { keys = {...in file order}, map = {...} }; JSON null is Json.null
local Json = {}
export type Object = { keys: { string }, map: { [string]: any } }
Json.null = newproxy(false)

local ESC: { [string]: string } = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
local WORDS: { [string]: any } = { ["true"] = true, ["false"] = false, ["null"] = Json.null }

local function skip(s: string, i: number): number
	local _, e = string.find(s, "^[ \t\r\n]*", i)
	return (e :: number) + 1
end

local function str(s: string, i: number): (string, number) -- i: the opening quote
	local out: { string }, j = {}, i + 1
	while true do
		local c = string.sub(s, j, j)
		assert(c ~= "", "JSON: unterminated string")
		if c == '"' then return table.concat(out), j + 1 end
		if c == "\\" then
			local e = string.sub(s, j + 1, j + 1)
			if e == "u" then
				table.insert(out, utf8.char(tonumber(string.sub(s, j + 2, j + 5), 16) :: number))
				j += 6
			else
				local r = ESC[e] -- not assert(...): it returns its message too, and insert would take three arguments
				assert(r, "JSON: bad escape")
				table.insert(out, r)
				j += 2
			end
		else
			local k = string.find(s, '[\\"]', j) :: number
			table.insert(out, string.sub(s, j, k - 1))
			j = k
		end
	end
end

local function value(s: string, i: number): (any, number)
	i = skip(s, i)
	local c = string.sub(s, i, i)
	if c == "{" or c == "[" then
		local obj: Object, arr: { any } = { keys = {}, map = {} }, {}
		local close = if c == "{" then "}" else "]"
		i = skip(s, i + 1)
		if string.sub(s, i, i) == close then return if c == "{" then obj else arr, i + 1 end
		while true do
			local k: string, v: any = "", nil
			if c == "{" then
				k, i = str(s, skip(s, i))
				i = skip(s, i)
				assert(string.sub(s, i, i) == ":", "JSON: ':' expected")
				i += 1
			end
			v, i = value(s, i)
			if c == "[" then
				table.insert(arr, v)
			else
				if obj.map[k] == nil then table.insert(obj.keys, k) end -- a duplicate keeps its first position
				obj.map[k] = v
			end
			i = skip(s, i)
			local d = string.sub(s, i, i)
			if d == close then return if c == "{" then obj else arr, i + 1 end
			assert(d == ",", "JSON: ',' expected")
			i += 1
		end
	elseif c == '"' then
		return str(s, i)
	end
	for word, v in WORDS do
		if string.sub(s, i, i + #word - 1) == word then return v, i + #word end
	end
	local num = string.match(s, "^-?%d+%.?%d*[eE]?[-+]?%d*", i) :: string
	assert(num and num ~= "", "JSON: value expected")
	return tonumber(num), i + #num
end

function Json.decode(s: string): any
	return (value(s, 1))
end

function Json.isObject(v: any): boolean
	return type(v) == "table" and type(v.keys) == "table" and type(v.map) == "table"
end

return Json
```

`Core.flatten(obj)` walks `obj.keys` and reads `obj.map[k]`, returns the entries with their keys in an ordered array, and turns each entry into a plain table (`title`, `short`, `body`, `see`, `aliases`) for the rest of the code. A `\u` escape outside the Basic Multilingual Plane (surrogate pairs) is not combined by this short decoder; glossary keys never need it.

Loading ([§1.2]): `sources` are name templates with `{locale}` (`"core/{locale}"`, `"{locale}"`) resolved against the `Glossary` folder (`FindFirstChild` per path part). For each locale of the chain `unique({locale, ...fallback})`, read every template in order, decode it inside `pcall` (a missing or broken file is a warning), flatten, and add the entries to `data[locale]` (a later layer wins per key, a new key is appended); merge `$ui` into `labels[locale]`. Keep the `.json` files as the source for the validator and copy them to `.txt` (or into StringValues) as a build step. The locale of a file is its `$locale`.

## 13. Live values, language, refresh [§4.6]

- `vars`: a table name → value or `function(key: string): string?`, or one `function(name, key)`; `nil` keeps `{name}` visible ([§1.2]). `tostring(1/3)` gives 17 significant digits in Luau (checked): format numbers yourself (`string.format("%d", n)`).
- `dt:refresh()`: lay out every open window again with current values and labels, re-attach each child to the term with the same anchor string in its re-laid-out parent, re-place every window that is not frozen. Call it after your values changed.
- `dt:setLocale(locale)`: build the new chain, load the StringValues not read yet, refresh. The player's language: `Players.LocalPlayer.LocaleId` (the account's locale) or `LocalizationService.RobloxLocaleId` (the locale of core UI), both like `"en-us"` (checked): take the part before `-` for the chain (`"de-de"` → `{"de", "en"}`).

## 14. Porting the pure functions to Luau [§2] [§8]

`Core` follows the pseudo-code of algorithms.md line by line. Where Luau differs from JavaScript (all checked with the `luau` CLI):

- **Strings are bytes**: `#"Größe"` is 7, `utf8.len` gives 5; `utf8.codepoint` raises an error on invalid UTF-8, so decode code points yourself or use `pcall`. Index with byte positions and step over whole UTF-8 sequences.
- **Patterns are not regular expressions**: `%s` matches only the bytes 09–0D and 20; JavaScript's whitespace also includes U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. Test code points:

```lua
local function jsSpace(c: number?): boolean
	return c ~= nil and ((c >= 0x09 and c <= 0x0D) or c == 0x20 or c == 0xA0 or c == 0x1680
		or (c >= 0x2000 and c <= 0x200A) or c == 0x2028 or c == 0x2029 or c == 0x202F
		or c == 0x205F or c == 0x3000 or c == 0xFEFF)
end

-- KEY_RE without regular expressions; %w would accept more than A-Z a-z 0-9
local function isKey(s: any): boolean
	if type(s) ~= "string" or s == "" then return false end
	for seg in string.gmatch(s .. ".", "([^.]*)%.") do
		if not string.find(seg, "^[A-Za-z0-9_%-]+$") then return false end
	end
	return true
end
```

- `trim`, the emphasis rules and the bullet pattern `^\s*[-•]\s+(.*)$` use `jsSpace`; a line whose text after the marker contains U+2028, U+2029 or `\r` is a paragraph line (`.` does not match line terminators in JavaScript). The paragraph split `\n[ \t]*\n` is plain ASCII and works as a Luau pattern.
- **`findClose`**: a `` ` ``, `[[` or nested `**` without its end does not skip anything and falls through to the closing check, exactly as in the reference (the port that passed the cases checks the three skips one after another).
- `VAR_RE` looks at most 64 characters ahead; JavaScript counts UTF-16 units, Luau bytes. Names are ASCII, so only a `{` followed by more than 64 bytes of non-ASCII text could differ.
- **Truthiness**: `0` and `""` are true; write `if p.maxW ~= 0` where JavaScript writes `if (maxW)`.
- **Numbers**: `1/0` is `inf`, `0/0` is NaN and `NaN ~= NaN` (checked), like JavaScript, so `room[s] / need(s)` needs no special case; there is one number type (`3 == 3.0`).
- **Comparison and case** are byte-wise: `"Ä" < "Z"` is false and `string.lower` leaves `ÄÖÜ` unchanged (checked); the encyclopedia ([§12]) needs its own folding.
- Luau extras that help: `continue`, compound assignment (`+=`), `if … then … else` expressions, string interpolation, types (`--!strict`).

## 15. API to offer

| Call | Does |
|---|---|
| `DeepTip.new(options)` | options of [SPEC §7](../../SPEC.md#7-configuration-reference-names) in camelCase (`delay`, `linkDelay`, `closeDelay`, `lockAfter`, `longPress`, `closeButtons`, `pinButton`, `hints`, `clickInsidePins`, `outsideClickCloses`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `openKeys`, `gamepad`, `vibrate`) plus `theme`, `fonts`, `displayOrder`, `closeKeys`, `onOpen`, `onClose`, `onPin` |
| `dt:mark(guiObject, key, opts?)`, `dt:unmark(guiObject)` | an explained element; `opts.delay`, `opts.place` |
| `dt:text(parent, markup, width)` → Frame | markup with live terms on a normal screen (web: `renderText`) |
| `dt:index(parent)` | the encyclopedia ([§12]) with a `TextBox` for the search |
| `dt:add(locale, jsonText)`, `dt:setLocale(locale)`, `dt:setValue(name, v)`, `dt:refresh()` | data ([§1.2], [§4.6]) |
| `dt:open(key, guiObject, pinned)`, `dt:closeAll()` | windows from code |
| `dt:hasWindows()`, `dt:isOpen(guiObject)`, `dt:arming(guiObject)` | for the game's own input, tooltips and rest bars |
| `dt:destroy()` | disconnect everything, remove the ScreenGui, unbind the actions |

## 16. Tests [§11]

Parity cases with the `luau` CLI (no Roblox needed). The CLI has no file access, so a small script turns the case files into a module of long strings first:

```python
# tests/make_cases.py — python make_cases.py <DeepTip>/test/cases   (writes tests/cases.luau)
import pathlib, sys
src = pathlib.Path(sys.argv[1])
out = ["return {"]
for name in ("markup", "placement", "glossary"):
    out.append(f"\t{name} = [====[{(src / (name + '.json')).read_text(encoding='utf-8')}]====],")
out.append("}")
(pathlib.Path(__file__).parent / "cases.luau").write_text("\n".join(out) + "\n", encoding="utf-8")
```

```lua
--!strict
-- tests/parity.luau — luau tests/parity.luau   (Core and Json copied next to it, or required by path)
local Json = require("./json")
local Core = require("./core")
local Cases = require("./cases")

local function plain(v: any): any -- decoded JSON → plain tables; JSON null → nil
	if v == Json.null then return nil end
	if Json.isObject(v) then
		local t = {}
		for _, k in v.keys do t[k] = plain(v.map[k]) end
		return t
	end
	if type(v) == "table" then
		local t = {}
		for i, x in v do t[i] = plain(x) end
		return t
	end
	return v
end

local function same(want: any, got: any): boolean
	if type(want) ~= "table" then return type(got) == type(want) and got == want end
	if type(got) ~= "table" then return false end
	for k, v in want do
		if not same(v, got[k]) then return false end
	end
	for k in got do
		if want[k] == nil then return false end
	end
	return true
end

local total, failed = 0, 0
local function check(name: string, ok: boolean)
	total += 1
	if not ok then
		failed += 1
		print("FAIL " .. name)
	end
end

for _, c in plain(Json.decode(Cases.markup)).cases do
	check(c.name, same(c.blocks, Core.parseText(c.src)))
end
for _, c in plain(Json.decode(Cases.placement)).cases do
	check(c.name, same(c.expect, Core.computePlacement(c.size, c.anchor, c.sides, c.viewport)))
end
for _, c in Json.decode(Cases.glossary).map.cases do -- keep the decoded objects: flatten needs their key order
	local r = Core.flatten(c.map.input)
	check(c.map.name, same(plain(c.map.expect), { keys = r.keys, meta = r.metaKeys, problems = #r.problems }))
end
print(string.format("%d/%d parity cases passed", total - failed, total))
```

`Core.parseText` returns the AST of [§2] as plain tables (`text` is `nil` when absent), `Core.flatten` returns `{entries, keys, meta, metaKeys, problems}`, `Core.computePlacement` returns `{side, x, y, fits, maxW, maxH}`. Expected: `24/24 parity cases passed` (checked with exactly these files and the decoder of section 12). In Studio the same modules run under TestEZ or Jest-Lua with the case texts in StringValues.

Behaviour tests: `Engine` takes `now` as an argument, so CLI scripts can open windows, move a fake pointer, advance time and check the invariants of [§4] (one preview per parent, pinned chain, subtree close, flash instead of a second window), grace and tendency ([§5]) and suppression. In a Studio play test, compare the feel with the web example (`npm run demo`).

## 17. The example to build

The scene of every DeepTip example, built by one LocalScript, with the shared glossaries as StringValues `Glossary/core/en`, `core/de`, `example/en`, `example/de`:

- A top bar (a Frame with a horizontal `UIListLayout`) of `TextButton`s, each marked: Realm `demo.realm`, Stability `demo.stability` (a click cycles −3…+3, then `dt:refresh()`), Taxes `demo.taxes` (a click cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and `{delay = 0}`; a language button (de/en) calling `dt:setLocale()`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- A page text made with `dt:text()` containing the loop `[[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]`.
- Options: `sources = {"core/{locale}", "example/{locale}"}`, `fallback = {"de", "en"}`, `delay = 1000`, `vars = { stability = function() return (if stability > 0 then "+" else "") .. stability end, gold = function() return tostring(gold) end }`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.

## 18. Pitfalls

1. **Client only**: build DeepTip in a LocalScript; the server has no `PlayerGui` input or `UserInputService` events for players.
2. **`ResetOnSpawn`** is `true` by default (checked): DeepTip's ScreenGui disappears on respawn unless it is `false`.
3. **Insets**: `GetMouseLocation()` is in screen pixels, `AbsolutePosition` and `input.Position` below the top bar (checked); never mix them.
4. **Escape belongs to Roblox** (section 9); `Backspace` has a default meaning too.
5. **`GetTextBoundsAsync` yields** (checked): never call it from `Heartbeat` or a `RenderStepped` handler; cache measurements.
6. **Rich text escaping**: escape `&` first; an unescaped `<` in a glossary text breaks the whole label.
7. **Order of JSON keys** (section 12): `JSONDecode`, ModuleScripts returning tables and Rojo's `.json` mapping all lose it (checked).
8. **`gameProcessedEvent`**: `UserInputService` events carry it (checked); treat pointer movement regardless of it, but ignore key presses with `gameProcessedEvent == true` (a focused TextBox, a core UI).
9. **Selection groups**: without `SelectionBehavior… = Stop` the gamepad selection leaves the window and lands in the game UI behind it.
10. **ZIndex**: with `ZIndexBehavior.Global` children compete with other ScreenGuis by `ZIndex`; keep DeepTip's ScreenGui on `Sibling` and a high `DisplayOrder`.

## 19. Limitations

- **Escape** cannot close windows (Roblox menu); `Backspace`, gamepad B and the X button do.
- **Long-press** duration is the engine's (`TouchLongPress`), not the `longPress` option.
- **Screen readers**: none for experiences in the engine reference read for this guide (verify).
- **Vibration** only on gamepads (`HapticService`).
- Not run in Roblox Studio for this guide (see the intro).

## 20. Checklist

1. `Core` and `Json`; the parity runner prints `24/24 parity cases passed` (section 16).
2. `Engine` ported from algorithms [§4]–[§7] (or from `frameworks/rust-egui/src/engine.rs`) with scenario tests in the CLI.
3. `Layout`: runs, measurement, line labels, term buttons (section 6); windows and placement (sections 7, 8).
4. `Ui`: the frame loop, `ContextActionService` bindings, touch, selection (sections 5, 9, 10).
5. The example (section 17) in a Studio play test; compare with the web example by hand.
6. The validator reports 0 errors for your `.json` sources; then list the framework with its state in the main README.

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
[§9.4]: ../../docs/algorithms.md#94-gamepad
[§9.5]: ../../docs/algorithms.md#95-focus
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
