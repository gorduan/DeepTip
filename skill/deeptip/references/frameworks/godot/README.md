# DeepTip for Godot 4

Guide: how [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) is built in a Godot 4 project with GDScript. This repository keeps code only in HTML, CSS, JS and Rust, so there is no addon to download here; this page is the exact recipe. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) (the § links below point into it), the contract is [SPEC.md](../../SPEC.md).

Checked against **Godot 4.2.2**: every class, method, signal, property and constant named here exists in its API (`--dump-extension-api`), the behaviour notes were reproduced in headless runs, and the parity runner below passed all shared cases (24/24) with a GDScript port of [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser) and [§8](../../docs/algorithms.md#8-placement). Use Godot 4.2 or later: 4.2 changed `mouse_entered` / `mouse_exited` to cover child controls.

## What you build

| File in your project | Content |
|---|---|
| `addons/deeptip/plugin.cfg` | `[plugin]` with `name`, `description`, `author`, `version`, `script="plugin.gd"` |
| `addons/deeptip/plugin.gd` | registers the autoload (below) |
| `addons/deeptip/deeptip_core.gd` | `extends RefCounted`, only `static func`: `flatten(obj)` ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)), `parse_text(src)` ([§2](../../docs/algorithms.md#2-markup-parser)), `collect_refs(src)`, `compute_placement(size, anchor, sides, vp, gap)` ([§8](../../docs/algorithms.md#8-placement)). No nodes; the parity cases test this file. |
| `addons/deeptip/deeptip.gd` | the controller, autoload `DeepTip`, `extends CanvasLayer` |
| `addons/deeptip/deeptip_window.gd` | one window, `extends PanelContainer`, built in code |
| `deeptip/core/<locale>.json`, `deeptip/<locale>.json` | copies of `glossary/core/` and your project glossary |
| `tests/parity.gd` | the parity runner (`extends SceneTree`, [Testing](#testing)) |

```gdscript
# addons/deeptip/plugin.gd
@tool
extends EditorPlugin

func _enter_tree() -> void:
	add_autoload_singleton("DeepTip", "res://addons/deeptip/deeptip.gd")

func _exit_tree() -> void:
	remove_autoload_singleton("DeepTip")
```

Reference the other scripts with `preload("deeptip_core.gd")` (relative to the script), not with `class_name`: global class names come from the editor's class cache, and a `--headless --script` run on a project that was never opened in the editor stops with "Identifier … not declared".

## SPEC → Godot

| DeepTip | Godot 4 |
|---|---|
| Controller | autoload `DeepTip`: `extends CanvasLayer`, `layer = 100`, `process_mode = PROCESS_MODE_ALWAYS` (windows keep working while the tree is paused) |
| Top layer, window order | the controller's CanvasLayer; windows are its children, the last child is drawn on top (`move_child(view, -1)` raises one) |
| Window ([§3](../../docs/algorithms.md#3-rendering-the-ast)) | `PanelContainer` with its own `StyleBoxFlat` → `VBoxContainer`: header `HBoxContainer` [title `Label`, badge `Label`, pin `Button`, close `Button`], body `RichTextLabel`, "See also" `RichTextLabel`, hint `Label`, lock bar `ColorRect` |
| Term | `RichTextLabel.push_meta(key)`; signals `meta_hover_started(meta)`, `meta_hover_ended(meta)`, `meta_clicked(meta)`, `meta` is the key as `String` |
| Marked UI element (`data-deeptip`) | any `Control` with metadata `deeptip` = key (Inspector → Add Metadata, or `set_meta("deeptip", key)`); optional `deeptip_delay` (int, ms) and `deeptip_place` (String, `"top,bottom"`) |
| Element under the pointer | the control's `mouse_entered` / `mouse_exited` (they respect occlusion and `mouse_filter`; since 4.2 they include child controls) |
| Window under the pointer | hit test: the last window child of the layer whose rect contains the pointer |
| Anchor box (viewport pixels, y down) | `control.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, control.size)` |
| Viewport | `get_viewport().get_visible_rect().size` |
| Pointer | `InputEventMouseMotion.position` in the controller's `_input` |
| `now()`, `schedule()` | `Time.get_ticks_msec()`; deadlines stored in the records and checked in `_process` (a `SceneTreeTimer` cannot be stopped, it only has `time_left`) |
| Rest progress (`data-dt-arming`) | signals `arming(control, delay_ms)` and `disarmed(control)` |
| Open state (`data-dt-open`) | `is_open(control)` plus the signals; hide the control's own `tooltip_text` while its window is open |
| `onOpen`, `onClose`, `onPin` | signals `opened(key, view)`, `closed(key)`, `pinned(key, view)` |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | not available: Godot 4.2 has no accessibility API. Keyboard and gamepad work as below. |

Public API of the autoload, named like the reference ([SPEC §7](../../SPEC.md#7-configuration-reference-names) options in snake_case: `delay`, `link_delay`, `close_delay`, `lock_after`, `long_press`, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `open_keys`, `gamepad`, `vibrate`):

| Call | Does |
|---|---|
| `configure(options: Dictionary)` | set options; `locale`, `sources` or `fallback` reload the glossaries |
| `add(locale, glossary: Dictionary)` | add or override one layer ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) |
| `set_locale(locale)` | switch the chain, load missing files, re-render open windows |
| `mark(control, key, delay_ms := -1, place := "")` | set the metadata and connect the control (same as setting it in the Inspector) |
| `open(key, anchor, parent = null, pinned = false, focus = false)` | [§4.1](../../docs/algorithms.md#41-openkey-anchor-parent--none-pinned--false-focus--false) |
| `close(win, focus_back = false)`, `close_all()`, `pin(win)`, `unpin(win)` | [§4.2](../../docs/algorithms.md#42-closew-focusback--false), [§4.3](../../docs/algorithms.md#43-pinw-and-unpinw) |
| `refresh()` | [§4.6](../../docs/algorithms.md#46-refresh), after live values changed |
| `render_text(label: RichTextLabel, text)` | terms on a normal screen (root windows) |
| `build_index() -> Control` | the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia)) |
| `has_windows()`, `is_open(control)` | for the game's own Esc handling and tooltips |

## Data

Window records must be objects. Godot 4 compares and hashes Dictionaries by content: `[a].has(b)` is true for two different Dictionaries with equal fields, and a Dictionary used as a key is no longer found after one of its fields changes. Use an inner class:

```gdscript
class Win extends RefCounted:
	var id := 0
	var key := ""
	var parent: Win = null
	var anchor = null              # a Control (UI element) or a Term
	var children: Array[Win] = []
	var pinned := false
	var via := "api"               # hover, click, key, touch, pad, api
	var close_at := 0              # grace deadline in ms, 0 = none (§5)
	var leave_since := 0
	var rect := Rect2()            # last placed box
	var anchor_rect := Rect2()     # last box of a Control anchor (frozen roots, §4.5)
	var frozen := false
	var view: PanelContainer
	var body: RichTextLabel
	var hovered_term := ""         # key of the term under the pointer, "" = none
	var focus_index := -1          # keyboard/gamepad cursor over terms and buttons (§9.5)
	var natural_w := 0.0           # body width measured when the content was built

class Term extends RefCounted:   # anchor of a window opened from a term
	var win: Win                   # the window (or null for a render_text() label) that contains it
	var label: RichTextLabel
	var key := ""
```

Controller state: `data` (locale → {key → entry}), `labels` (locale → {name → text}), `wins: Array[Win]` (oldest first), `hover = {win, link, trig}`, `hot: Dictionary` (Win → true), `pending` ([§6](../../docs/algorithms.md#6-arming-and-delays): anchor, kind, key, parent, `fire_at`, `since`, `delay`), `samples` ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression): `{x, y, t}`), `quiet` (hushed control), `lock_win` + `lock_start` ([§7](../../docs/algorithms.md#7-timer-lock)), `press` (touch long-press), `swipe`, `swallow`, `esc_at`, `pad_b_at`, `pointer: Vector2`, `touch_mode: bool`.

The same key twice in one body is one anchor: RichTextLabel reports only the meta value, so a term anchor is (window, key). Compare term anchors by `win` and `key`, not by object identity.

## Loading the glossaries (§1)

```gdscript
const Core = preload("deeptip_core.gd")

func add(locale: String, glossary: Dictionary) -> void:
	var r := Core.flatten(glossary)               # {entries, meta, problems}
	for p in r.problems:
		push_warning("DeepTip: %s %s: %s" % [locale, p.key, p.msg])
	var map: Dictionary = data.get(locale, {})
	map.merge(r.entries, true)                    # a later layer wins per key
	data[locale] = map
	if r.meta.get("$ui") is Dictionary:
		var l: Dictionary = labels.get(locale, {})
		l.merge(r.meta["$ui"], true)
		labels[locale] = l
	refresh()

func _read(path: String):                         # -> Dictionary or null
	if path.begins_with("res://"):
		var res = load(path) if ResourceLoader.exists(path) else null
		return res.data if res is JSON else null  # Godot loads .json as a JSON resource
	if not FileAccess.file_exists(path):          # user:// and absolute paths
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))
```

- `sources` are path templates with `{locale}`: `["res://deeptip/core/{locale}.json", "res://deeptip/{locale}.json"]`. For each locale of the chain, read every template in order and `add()` it (template order = layer order, core first); remember read paths; a missing or broken file is a warning.
- The glossary files must be inside the project to be exported: copy `glossary/core/*.json` and your own files into `res://deeptip/`. During development an absolute path into a DeepTip checkout also works in the editor and desktop builds: `ProjectSettings.globalize_path("res://").path_join("../DeepTip/glossary/core/{locale}.json").simplify_path()`. Mods and player overrides go to `user://deeptip/`.
- `JSON.parse_string()` returns `null` on invalid JSON and prints an engine error; for a readable warning use `var j := JSON.new()`, `j.parse(text)`, then `j.get_error_line()` / `j.get_error_message()`. Reading a missing file returns `""`, which also logs a parse error, so check `FileAccess.file_exists()` first.
- The locale of a file: `$locale`, else the last dot part of `path.get_file().get_basename()` (`myapp.de.json` → `de`).
- The game's language: `TranslationServer.get_locale()` returns `de_DE` (underscore); the chain uses `get_slice("_", 0)` → `de`. Follow language switches in the autoload's `_notification(what)` with `NOTIFICATION_TRANSLATION_CHANGED`.
- Live values (`vars`): a Dictionary name → value or `Callable` (called with the window's key), or one `Callable(name, key)`; `null` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)).

## Building a window (§3)

1. `view := PanelContainer.new()`, `focus_mode = FOCUS_ALL`; give each window its **own** `StyleBoxFlat` (`add_theme_stylebox_override("panel", style)`): StyleBoxes are shared Resources, so changing the border of one pinned window would otherwise change all. Reference look (`frameworks/web/deeptip.css`, dark): background `#1b1e24`, text `#e6e8ec`, border 1 px `#3b414d`, pinned border `#58a6ff`, radius 8, padding 12 left/right, terms `#6cb6ff`, missing terms `#dd3333`, font 14 px, width 240–384 px, max height 480 px.
2. Header: title `Label` (`size_flags_horizontal = SIZE_EXPAND_FILL`), fallback badge `Label` with `tooltip_text = label("fallback")` when the entry came from another locale, pin `Button` and close `Button` (`flat = true`, `tooltip_text` = `label("pin"/"unpin"/"close")`). Icons: the SVG paths `PIN_PATH` and `CLOSE_PATH` from `frameworks/web/deeptip.js` as files under the addon, or built at runtime with `Image.load_svg_from_string()` + `ImageTexture.create_from_image()`. The default font has no pin glyph.
3. Body `RichTextLabel`: `fit_content = true`, `scroll_active = false`, `autowrap_mode = TextServer.AUTOWRAP_WORD_SMART`, `mouse_filter = Control.MOUSE_FILTER_PASS` (so the panel also sees clicks on text), `custom_minimum_size.x` = the window width. Leave `bbcode_enabled` off and fill it with the push API (next section).
4. Width: measure the natural width with a second `RichTextLabel` set to `AUTOWRAP_OFF` + `fit_content` (its `get_combined_minimum_size().x` is the unwrapped width) or with `Font.get_string_size()` per line; clamp it so the window is 240–384 px wide, store it as `w.natural_w` and set it as the body's `custom_minimum_size.x` before anything else.
5. "See also" `RichTextLabel` (same settings) when the entry has `see`; hint `Label` with `label("hint")`, `visible = hints and not pinned`; lock bar `ColorRect` (2 px high, `size_flags_horizontal = SIZE_SHRINK_BEGIN`, width set every frame while locking).
6. `layer.add_child(view)`, then `view.reset_size()` and place it ([§8](../../docs/algorithms.md#8-placement), below). Connect:

```gdscript
w.body.meta_hover_started.connect(func(meta): _term_hover(w, str(meta), true))
w.body.meta_hover_ended.connect(func(meta): _term_hover(w, str(meta), false))
w.body.meta_clicked.connect(func(meta): _follow_term(w, str(meta), false))   # fires on release
w.view.gui_input.connect(func(e): _window_input(w, e))   # click inside pins (§9.1), touch swipe on the header
pin_button.pressed.connect(func(): unpin(w) if w.pinned else pin(w))
close_button.pressed.connect(func(): close(w, true))
w.view.minimum_size_changed.connect(func(): _dirty[w] = true)                # re-place in _process
```

`setState` ([§4.3](../../docs/algorithms.md#43-pinw-and-unpinw)): pinned → border colour `#58a6ff`, pin icon filled, hint hidden; the pin button's `tooltip_text` follows. Flash ([§4.4](../../docs/algorithms.md#44-flashw)): tween the window's own StyleBox `border_color` (or `modulate`) for 700 ms.

## Rendering the AST (§3)

Use the push API. `add_text()` never parses BBCode, so glossary text needs no escaping (checked: `add_text("[b]x[/b]")` shows the brackets).

| AST node | RichTextLabel calls |
|---|---|
| text | `add_text(v)` |
| br | `newline()` |
| p | blocks separated by `newline()` twice (one empty line) |
| ul | `push_list(0, RichTextLabel.LIST_DOTS, false)`, items separated by `newline()`, `pop()` |
| b, i | `push_bold()` / `push_italics()` … `pop()`; nested they become bold-italic on their own (4.2.2 source: `push_bold()` checks for an enclosing italics font) |
| code | `push_mono()` … `pop()` |
| var | `push_bold()`, `add_text(value)`, `pop()` |
| link to the window's own key | `push_bold()`, `add_text(label)`, `pop()` |
| link to a missing key | `push_color(missing)`, `push_hint(label("missing"))`, `add_text(label)`, `pop()`, `pop()` + one `push_warning` per key |
| term | `push_color(term_colour)`, `push_meta(key)`, `add_text(label)`, `pop()`, `pop()`; wrap in `push_bgcolor()` when its window is open or it has the keyboard focus |

Every `push_*` needs its font in the theme (`bold_font`, `italics_font`, `bold_italics_font`, `mono_font`); the default theme has them. With a custom theme that lacks one, the push fails with an error and the following `pop()` closes the wrong tag. If you build BBCode strings instead, escape `[` as `[lb]` in a single pass over the text.

Re-rendering (`refresh()`, open-term highlight, keyboard cursor): `clear()` and rebuild, then set the window's `hovered_term = ""` yourself. After a rebuild the label's hover edges are unreliable: a late `meta_hover_ended` for the old content arrives on the next motion, and `meta_hover_started` comes again only after the next layout.

## Order of operations

Godot calls `_input` on every node in **reverse tree order** (the scene, added after the autoloads, comes first), then the focused control's `_gui_input`, then `_unhandled_input` in reverse tree order (checked with a pushed key event). The controller therefore handles input in `_input`: it runs before every GUI control and before every `_unhandled_input`, and `get_viewport().set_input_as_handled()` hides a consumed key from them. A game that handles Esc in its own `_input` gets it first; let it use `_unhandled_input`, or check `DeepTip.has_windows()`.

```gdscript
func _input(e: InputEvent) -> void:
	if e is InputEventMouseMotion:
		if e.device == -1:              # mouse emulated from touch (engine constant DEVICE_ID_EMULATION, not exposed in 4.2)
			touch_mode = true
			return
		touch_mode = false
		pointer = e.position
		_sample(e.position)             # §5 pointer samples
		_update_hover()                 # §6 "on pointer over"
	elif e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if _swallowing(e):              # §9.2 the release after a long-press must not click the element
			get_viewport().set_input_as_handled()
		elif e.pressed and e.device != -1:
			_pointer_down(e.position)   # §9.2 hush, outside click
	elif e is InputEventScreenTouch or e is InputEventScreenDrag:
		touch_mode = true
		_touch(e)                       # §9.2 for touch: outside tap, long-press, swipe
	elif e is InputEventKey and e.pressed:
		if _key(e):                     # §9.3
			get_viewport().set_input_as_handled()
	elif e is InputEventJoypadButton or e is InputEventJoypadMotion:
		if _pad(e):                     # §9.4 presses; holds are checked in _process
			get_viewport().set_input_as_handled()

func _update_hover() -> void:           # §6
	var win := _window_at(pointer)      # last child of the layer whose rect has the point (skip closing windows)
	for w in wins:
		if w != win:
			w.hovered_term = ""         # do not wait for meta_hover_ended (see Pitfalls)
	var link = null
	if win and win.hovered_term != "":
		link = _term(win, win.hovered_term)
	elif page_term:                     # a term in a render_text() label
		link = page_term
	var trig = null if win or link else hovered_control   # kept by mouse_entered / mouse_exited
	_on_pointer_over(win, link, trig)   # §6: quiet, refresh_hot (§5), lock_track (§7), arm / disarm
```

After `_input`, during GUI processing of the same event:

- `meta_hover_started` / `meta_hover_ended` → `_term_hover(w, key, on)`: ignore while `touch_mode`; set or clear `w.hovered_term`, then `_update_hover()` again (this arms the term).
- `meta_clicked` (on release) → `follow(term, w, focus = false)` ([§9.1](../../docs/algorithms.md#91-clicks), pins the parent). A tap on a term arrives here too (emulated mouse), which is "tap → pinned".
- The panel's `gui_input`, left release → `if click_inside_pins and not w.pinned: pin(w)`; checked order: `meta_clicked` comes before the panel sees the release. Buttons stop the event, so clicks on pin and close never reach the panel.
- Marked controls: `mouse_entered` → `hovered_control = control`, `mouse_exited` → `null`, both followed by `_update_hover()`.

Every frame, `_process(_delta)`, in this order (`set_process(false)` while nothing is open, armed, pressed or held):

1. `t := Time.get_ticks_msec()`.
2. Arming ([§6](../../docs/algorithms.md#6-arming-and-delays)): `pending` due → if `t - since < delay + 1500` and `heading_away(parent)`: `fire_at = t + 90`; else `disarm()` and `open(key, anchor, parent, via = "hover")`.
3. Grace ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)): for a copy of `wins`, unpinned, `close_at` due → hot: clear; `t - leave_since < 1500` and `heading(w)`: `close_at = t + 90`; else `close(w)`.
4. Touch long-press ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)): due → `Input.vibrate_handheld(15)` if `vibrate`, set `swallow`, `open(key, control, pinned = true, via = "touch")`.
5. Gamepad B held ≥ 600 ms → close all, focus back ([§9.4](../../docs/algorithms.md#94-gamepad)).
6. Timer lock ([§7](../../docs/algorithms.md#7-timer-lock)): bar width = `clamp((t - lock_start) / lock_after, 0, 1) * view.size.x`; at 1: stop the lock, `pin(lock_win)`.
7. Flash end (700 ms).
8. Re-place every window in `_dirty`, and all of them after `get_viewport().size_changed`.
9. Anchors gone ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)): a Control anchor with `not is_instance_valid(a) or not a.is_inside_tree()` → unpinned window closes, a pinned root freezes at `rect` (or connect the anchor's `tree_exiting`).

## Placement (§8)

```gdscript
func _box(w: Win) -> Rect2:
	if w.parent:
		return w.parent.rect                  # children sit beside the parent window
	if w.anchor is Control and w.anchor.is_inside_tree():
		var c: Control = w.anchor
		w.anchor_rect = c.get_global_transform_with_canvas() * Rect2(Vector2.ZERO, c.size)
	return w.anchor_rect                      # frozen roots and page terms keep their last box

func _place(w: Win) -> void:
	var vs := get_viewport().get_visible_rect().size
	var vp := {"w": vs.x, "h": vs.y}
	# the reference CSS caps every window before it is measured:
	# max-width min(24rem, 100vw - 2·gap), max-height min(30rem, 100dvh - 2·gap)
	var max_w := minf(384.0, vs.x - 16.0)
	var max_h := minf(480.0, vs.y - 16.0)
	_limit(w, max_w, max_h)
	var a := _box(w)
	var box := {"left": a.position.x, "top": a.position.y, "right": a.end.x, "bottom": a.end.y}
	var p := Core.compute_placement({"w": w.view.size.x, "h": w.view.size.y}, box, _sides(w), vp, 8.0)
	if p.maxW or p.maxH:
		_limit(w, minf(max_w, p.maxW) if p.maxW else max_w, minf(max_h, p.maxH) if p.maxH else max_h)
		p = Core.compute_placement({"w": w.view.size.x, "h": w.view.size.y}, box, [p.side], vp, 8.0)
	w.view.position = Vector2(p.x, p.y)
	w.rect = Rect2(w.view.position, w.view.size)

const PAD_X := 24.0                           # left + right content margins of the window's StyleBox

func _limit(w: Win, max_w: float, max_h: float) -> void:
	w.body.fit_content = true
	w.body.scroll_active = false
	w.body.custom_minimum_size = Vector2(minf(w.natural_w, max_w - PAD_X), 0)
	var chrome_h := w.view.get_combined_minimum_size().y - w.body.get_combined_minimum_size().y
	if w.view.get_combined_minimum_size().y > max_h:   # too high: the body scrolls inside
		w.body.fit_content = false
		w.body.scroll_active = true
		w.body.custom_minimum_size.y = max_h - chrome_h
	w.view.reset_size()                       # without it the size follows only next frame
```

After `_limit()` the window's `size` is right at once (checked: 376×632, 376×244, 300×244); the body inside settles one frame later, and when a narrower body wraps into more lines the `minimum_size_changed` connection re-places the window.

`_sides(w)`: roots use the control's `deeptip_place` if set, else `root`; children use `child` ([§8](../../docs/algorithms.md#8-placement)). A term on a `render_text()` label has no rectangle of its own (RichTextLabel 4.2 exposes no character boxes): store a small box around the pointer at hover time as its `anchor_rect`. `_window_at()` compares the pointer with `w.rect`; the same coordinates come from `_input`, `get_visible_rect()` and `get_global_transform_with_canvas()`, also under the `canvas_items` stretch mode (checked).

## Input mapping (§9)

| Reference | Godot 4 |
|---|---|
| pointer leaves the application | `get_tree().root.mouse_exited` → `hover = {}`, `disarm()`, `lock_track(null)`, `refresh_hot()` |
| pointer down / click | `InputEventMouseButton` with `MOUSE_BUTTON_LEFT` in `_input`; terms `meta_clicked`; pin/close `pressed`; inside a window the panel's `gui_input` |
| hush (pointer down on a marked control, not touch) | in `_pointer_down`: `quiet = hovered_control` |
| touch | `InputEventScreenTouch` (`index`, `pressed`, `position`), `InputEventScreenDrag`; mouse events emulated from touch have `device == -1` (project setting `input_devices/pointing/emulate_mouse_from_touch`, on by default) |
| long-press drift `MOVE_TOL`, swipe `SWIPE` | from `InputEventScreenDrag.position` against the press position |
| Esc, hold Esc, Shift+Esc | `InputEventKey`, `keycode == KEY_ESCAPE`; `echo` + `t - esc_at >= 600` for the hold; `shift_pressed` |
| F6 / Shift+F6 | `keycode == KEY_F6`; focus the next older / newer window with `view.grab_focus()` |
| open keys F1, `?` | `keycode == KEY_F1`, `unicode == 63` for `?` (layout independent); the focused element is `get_viewport().gui_get_focus_owner()`; `?` does nothing in `LineEdit` / `TextEdit` |
| printable key typed into a marked control | `unicode >= 32` without `ctrl_pressed` / `alt_pressed` / `meta_pressed` → `hush(control)` |
| gamepad buttons | `InputEventJoypadButton.button_index`: `JOY_BUTTON_A` 0, `JOY_BUTTON_B` 1, `JOY_BUTTON_Y` 3, `JOY_BUTTON_LEFT_SHOULDER` 9, `JOY_BUTTON_RIGHT_SHOULDER` 10, `JOY_BUTTON_DPAD_UP/DOWN/LEFT/RIGHT` 11–14. The reference's W3C indices differ (LB 4, RB 5, d-pad 12–15): map by name. |
| left stick | `InputEventJoypadMotion` with `JOY_AXIS_LEFT_X` / `JOY_AXIS_LEFT_Y` beyond ±0.6 counts as the d-pad (edge-detect it yourself) |
| vibrate | `Input.vibrate_handheld(15)` (mobile) |

Keyboard focus ([§9.5](../../docs/algorithms.md#95-focus)): RichTextLabel terms cannot take focus one by one, so the window keeps it (`focus_mode = FOCUS_ALL`) and `focus_index` walks its items: the terms of body and "See also" in order, then pin and close. On a term the window re-renders with that term in `push_bgcolor()`; on a button call its `grab_focus()`. Tab / Shift+Tab and the d-pad move the index (consume them in `_input` while a window has focus, or Godot's own focus navigation leaves the window); Enter, Space or A on a term → `follow(term, w, focus = true)`. Opening by keyboard or gamepad: `view.grab_focus()` with `focus_index = 0` when there are terms. Closing returns focus with `anchor.grab_focus()` when the anchor is a focusable Control.

## The pure core (§1, §2, §8)

`deeptip_core.gd` follows the pseudo-code of algorithms.md line by line, with `static func`s that return plain Dictionaries and Arrays. Three helpers keep it identical to the JavaScript reference where GDScript differs:

```gdscript
# JavaScript's \s (whitespace and line terminators); RegEx \s and strip_edges() are ASCII-only
static func is_js_space(c: String) -> bool:
	var u := c.unicode_at(0)
	return (u >= 0x09 and u <= 0x0D) or u == 0x20 or u == 0xA0 or u == 0x1680 or (u >= 0x2000 and u <= 0x200A) \
		or u == 0x2028 or u == 0x2029 or u == 0x202F or u == 0x205F or u == 0x3000 or u == 0xFEFF

# KEY_RE without RegEx: segments of A-Z a-z 0-9 _ - separated by single dots
static func is_key(s: String) -> bool:
	if s.is_empty():
		return false
	for seg in s.split(".", true):
		if seg.is_empty():
			return false
		for i in seg.length():
			var u := seg.unicode_at(i)
			if not ((u >= 48 and u <= 57) or (u >= 65 and u <= 90) or (u >= 97 and u <= 122) or u == 95 or u == 45):
				return false
	return true

# JavaScript division: x / 0 is INF, -INF or NAN, never an error (computePlacement's room / need)
static func ratio(x: float, y: float) -> float:
	if y != 0.0:
		return x / y
	return INF if x > 0.0 else (-INF if x < 0.0 else NAN)
```

`trim` in [§2](../../docs/algorithms.md#2-markup-parser) removes `is_js_space()` characters from both ends; "whitespace" in the emphasis rules and in the bullet pattern `^\s*[-•]\s+(.*)$` means `is_js_space()` as well. In the bullet pattern `.` stops at U+2028 and U+2029, so a line whose text after the marker contains one of them is a paragraph line, not a bullet. Split paragraphs with a loop over `\n[ \t]*\n` (or `RegEx.search_all()`), and check bounds before every `s[i + 1]`.

## Pitfalls

1. **JSON numbers are floats.** `JSON.parse_string('{"z": 1}').z` is a `float`, and `{"a": 1} == {"a": 1.0}` is `false` while `1 == 1.0` is `true`. Never compare parsed JSON with `==` against computed Dictionaries; compare numbers by value (see the runner). Key order of JSON objects is kept, and updating a key keeps its position.
2. **Dictionaries compare and hash by content** (see [Data](#data)): records and anchors are objects.
3. **RegEx is PCRE2.** `$` also matches before a final `\n` (`^…$` accepts `"a.b\n"`), use `\z` or a character loop for `KEY_RE`. `\s` is ASCII-only (no U+00A0, no U+2003) and `String.strip_edges()` strips only characters ≤ 32: implement JavaScript's whitespace set for [§2](../../docs/algorithms.md#2-markup-parser) (`is_js_space()` in [The pure core](#the-pure-core-1-2-8)). `\p{L}` and `\p{N}` work on non-ASCII letters, but `(?i)` folds ASCII only: for [§10](../../docs/algorithms.md#10-auto-linking-aliases) auto-linking match on `to_lower()` copies (same length, so positions map back).
4. **Strings** are code points (`"😀".length()` is 1, in JavaScript 2): only the 64-character window of `VAR_RE` counts differently. `s[i]` past the end is an error (JavaScript gives `undefined`): check `i + 1 < s.length()` before peeking.
5. **Lambdas capture locals by value**: assigning to an outer local inside a `func():` changes nothing outside; use a member or an Array.
6. **RichTextLabel defaults**: `bbcode_enabled` false, `fit_content` false, `scroll_active` true, `autowrap_mode` WORD_SMART, `mouse_filter` STOP, `focus_mode` NONE. With autowrap on and no `custom_minimum_size.x` its minimum width collapses to 1 px (and the height explodes): set the width first.
7. **Sizes lag one frame.** After content changes, `get_combined_minimum_size()` is current at once, `size` only next frame: call `reset_size()` before measuring or placing.
8. **`meta_clicked` fires on release**; the label does not accept the click, but its default STOP filter keeps it from the panel. With `MOUSE_FILTER_PASS` the panel's `gui_input` sees press and release, and `meta_clicked` comes first.
9. **`meta_hover_ended`** comes when the pointer moves off the meta, and from the label's mouse-exit notification; after a rebuild the edges are unreliable. Clear `hovered_term` yourself when the pointer is no longer in that window.
10. **Default `mouse_filter`**: PanelContainer STOP, VBox/HBoxContainer PASS, Label IGNORE, RichTextLabel STOP, Button STOP. A marked `Label` needs `MOUSE_FILTER_PASS` or `STOP` to get `mouse_entered`.
11. **`get_global_rect()` ignores the CanvasLayer** offset and transform; `get_global_transform_with_canvas()` includes them (a control at (10, 10) on a layer with offset (100, 50): `get_global_rect()` (10, 10), with canvas (110, 60)).
12. **Not in 4.2**: `Viewport.gui_get_hovered_control()` and a script constant for emulated input (`device == -1`).
13. **Headless runs** (`--headless`, events from `get_tree().root.push_input()`): the root viewport is 64×64 (set `get_tree().root.size = Vector2i(1152, 648)`); `get_viewport().get_mouse_position()` stays (0, 0) (keep `pointer` from the motion events); `mouse_entered` / `mouse_exited` and the label's mouse-exit `meta_hover_ended` never fire (the window never gets a mouse-enter). `gui_input`, `meta_hover_started`, `meta_clicked` and button `pressed` do. Keep the hover logic in plain methods that tests can call.
14. **Input in a paused game**: only with `process_mode = PROCESS_MODE_ALWAYS` on the autoload.
15. **Sorting the encyclopedia**: there is no locale-aware collator; `nocasecmp_to()` orders by code point (`Ä` after `Z`). Fold accents yourself if the order matters.

## Testing

Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases)): one SceneTree script, run headless. JSON numbers come in as `float`, the cases' expectations as well; compare numbers by value and everything else by type.

```gdscript
# tests/parity.gd
# godot --headless --path <project> --script res://tests/parity.gd -- --cases <DeepTip>/test/cases
extends SceneTree

const Core = preload("res://addons/deeptip/deeptip_core.gd")


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var i := args.find("--cases")
	var dir: String = args[i + 1] if i >= 0 and i + 1 < args.size() else "res://tests/cases"
	var fails := 0
	var total := 0
	for c in _cases(dir, "markup.json"):
		total += 1
		fails += _check("markup: " + c.name, Core.parse_text(c.src), c.blocks)
	for c in _cases(dir, "placement.json"):
		total += 1
		fails += _check("placement: " + c.name, Core.compute_placement(c.size, c.anchor, c.sides, c.viewport), c.expect)
	for c in _cases(dir, "glossary.json"):
		total += 1
		var r := Core.flatten(c.input)
		fails += _check("glossary: " + c.name, {"keys": r.entries.keys(), "meta": r.meta.keys(), "problems": r.problems.size()}, c.expect)
	print("%d/%d parity cases passed" % [total - fails, total])
	quit(1 if fails or total == 0 else 0)


func _cases(dir: String, file: String) -> Array:
	var path := dir.path_join(file)
	var data = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	if typeof(data) != TYPE_DICTIONARY:
		printerr("cannot read ", path)
		return []
	return data.cases


func _check(name: String, got, want) -> int:
	if _same(got, want):
		return 0
	printerr("FAIL ", name, "\n  got:  ", JSON.stringify(got), "\n  want: ", JSON.stringify(want))
	return 1


func _same(a, b) -> bool:
	var num := [TYPE_INT, TYPE_FLOAT]
	if typeof(a) in num and typeof(b) in num:
		return float(a) == float(b)
	if typeof(a) != typeof(b):
		return false
	if a is Array:
		if a.size() != b.size():
			return false
		for k in a.size():
			if not _same(a[k], b[k]):
				return false
		return true
	if a is Dictionary:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not _same(a[k], b[k]):
				return false
		return true
	return a == b
```

`Core.parse_text()` returns exactly the AST shapes of [§2](../../docs/algorithms.md#2-markup-parser) (Dictionaries with `t`/`type` fields, `text` = `null` when absent), `Core.flatten()` returns `{"entries": …, "meta": …, "problems": […]}`, `Core.compute_placement()` returns `{"side", "x", "y", "fits", "maxW", "maxH"}`. Expected output: `24/24 parity cases passed`, exit code 0 (1 on a failure or when no case was read).

Behaviour tests run the same way: a SceneTree script that sets `get_tree().root.size`, instantiates `deeptip.gd`, builds a few marked Buttons, pushes `InputEventMouseMotion` / `InputEventMouseButton` / `InputEventKey` with `get_tree().root.push_input(event)` and calls the controller's methods with a replaceable clock (`func now() -> int` returning `Time.get_ticks_msec()` unless a test sets a fake time). Check the invariants of [§4](../../docs/algorithms.md#4-window-tree-and-invariants) (one preview per parent, pinned chain, subtree close, flash instead of a second window), grace and tendency ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)), and that windows never cover their parent. Compare the feel with the web example (`npm run demo`).

## Example to build

The scene of every DeepTip example, built in code (`example/main.gd` on a full-rect `Control`):

- A top bar (`HBoxContainer`) of `Button`s with metadata `deeptip`: Realm `demo.realm`, Stability `demo.stability` (click cycles −3…+3, then `DeepTip.refresh()`), Taxes `demo.taxes` (click cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and `deeptip_delay = 0`; a language `OptionButton` (de/en) calling `set_locale()`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- Options: `sources = ["res://deeptip/core/{locale}.json", "res://deeptip/example/{locale}.json"]` (copies of `glossary/core/` and `glossary/example/`), `fallback = ["de", "en"]`, `delay = 1000`, `vars = {"stability": func(_k): ("+" if stability > 0 else "") + str(stability), "gold": func(_k): str(gold)}`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.

## Limitations

- No screen reader output in Godot 4.2 ([SPEC §6](../../SPEC.md#6-accessibility) is met for keyboard and gamepad only).
- Terms inside a RichTextLabel are not separate focusable controls; the window's own cursor replaces Tab between buttons.
- A term on a `render_text()` label is anchored to the pointer position, not to the term's exact box.
