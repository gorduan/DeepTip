# DeepTip for GameMaker (GML)

Guide: how to build [DeepTip](../../README.md), nested and pinnable explanation windows, in a GameMaker game written in GML. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the GML implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers what is specific to GameMaker and GML.

Statements marked (checked) were verified on 2026-10-29 against the current GameMaker manual (manual.gamemaker.io, monthly branch): every function, constant, event and operator named with that mark has a manual page that says so. Every GML snippet below passed the syntax check of the GML parser of Stitch (`@bscotch/gml-parser` 1.17.2). The key-order scanner of section 12 was checked by a line-by-line JavaScript transliteration against the shared glossaries and case files (219 objects, all in file order). No GameMaker IDE or runtime was available, so no snippet was compiled or run in GameMaker, and points that depend on runtime behaviour rather than on the manual are marked (verify). The closest complete implementation is the Rust crate in [frameworks/rust-egui](../rust-egui/README.md): its `src/engine.rs` (the window tree and every timer, no UI types) ports to GML constructors almost line by line.

**Download:** `DeepTip-gamemaker-1.0.0.zip` holds this guide with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** a `<name>.yyp` project file with `objects/<name>/<name>.yy`, `scripts/` and `rooms/` folders, GML in `*.gml` event and script files, and included files in `datafiles/`.

1. Create the scripts `scr_deeptip_core`, `scr_deeptip_engine`, `scr_deeptip_layout`, `scr_deeptip_api` and the object `obj_deeptip` of section 1.
2. Run `deeptip_run_parity("deeptip_cases/")` until it prints `24/24 parity cases passed` (section 16).
3. Add `glossary/core/*.json` as Included Files under `deeptip/core/`; your own entries go to `deeptip/<locale>.json`.
4. Add font assets with the glyph ranges your glossaries use (section 4); the default range is 32–127.
5. Create `obj_deeptip` once at game start and mark elements with `deeptip_mark()` every step.
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en datafiles/deeptip/core/en.json datafiles/deeptip/en.json`.

```gml
// Room Creation Code of the first room: the controller, persistent across rooms
if (!instance_exists(obj_deeptip)) {
    instance_create_depth(0, 0, 0, obj_deeptip, {
        locale: "en", fallback: ["en"],
        sources: ["deeptip/core/{locale}.json", "deeptip/{locale}.json"],
    });
}

// Draw GUI event of your HUD object: a help button, marked in GUI coordinates every step
draw_rectangle(20, 20, 60, 52, true);
draw_text(36, 26, "?");
deeptip_mark("help", "deeptip.about", 20, 20, 40, 32);   // rest on it: its window opens
```

**Done when:** the parity runner prints `24/24 parity cases passed`, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without opening your pause menu, the validator reports 0 errors.

## 1. Parts to build

| Asset | Kind | Content | Algorithms |
|---|---|---|---|
| `scr_deeptip_core` | Script | pure functions, no instances, no drawing: `deeptip_json_key_order(text)`, `deeptip_flatten(obj, order, path)`, `deeptip_parse_text(src)`, `deeptip_collect_refs(blocks)`, `deeptip_compute_placement(size, anchor, sides, vp, gap)`, `deeptip_is_key(s)` | [§1.1], [§2], [§8] |
| `scr_deeptip_engine` | Script | constructor `DeepTipEngine(options)`: window tree, hot set, grace, tendency, suppression, arming, timer lock; time, boxes and the hover state are passed in | [§4]–[§7] |
| `scr_deeptip_layout` | Script | markup AST → styled runs → lines with the rectangles of every term fragment | [§3] |
| `scr_deeptip_api` | Script | the global functions games call: `deeptip_mark`, `deeptip_text`, `deeptip_open`, `deeptip_set_locale` … (section 15) | |
| `obj_deeptip` | Object, persistent | Create (options, glossaries), Begin Step (input, hover, timers), Draw GUI End (place, draw, record rectangles), Clean Up | [§1.2], [§9] |
| `fnt_deeptip`, `fnt_deeptip_b`, `fnt_deeptip_i`, `fnt_deeptip_bi`, `fnt_deeptip_mono` | Fonts | 14 px regular, bold, italic, bold italic, monospace | [§3] |
| `datafiles/deeptip/core/<locale>.json`, `datafiles/deeptip/<locale>.json` | Included Files | copies of `glossary/core/` and your project glossary | |
| `datafiles/deeptip_cases/*.json` + `deeptip_run_parity` | Included Files + function | copies of `test/cases/*.json` and the parity runner (section 16) | [§11] |

Keep `scr_deeptip_core` and `scr_deeptip_engine` free of drawing and input calls: the parity cases and scenario tests with exact times then run from any event.

## 2. SPEC concept → GameMaker primitive

| DeepTip | GameMaker |
|---|---|
| Controller | one persistent instance of `obj_deeptip` (`persistent` carries it from room to room, checked), created before the game's own objects; its controller struct is `global.deeptip` |
| Top layer, window order | the **Draw GUI End** event of `obj_deeptip`: Draw GUI Begin runs for all instances, then Draw GUI for all, then Draw GUI End (checked), and UI layers are drawn before any Draw GUI event (checked), so DeepTip lies above the whole GUI. Windows are drawn oldest first, the newest on top. |
| Coordinates | GUI units: viewport `display_get_gui_width()` × `display_get_gui_height()`, pointer `device_mouse_x_to_gui(0)` / `device_mouse_y_to_gui(0)` (checked) |
| Window ([§3]) | a record plus its laid-out content; background and frame `draw_roundrect_colour_ext(x1, y1, x2, y2, 8, 8, col, col, outline)` (checked), or a nine-slice sprite |
| Rich text | own layout: one font asset per style, words measured with `string_width` after `draw_set_font` (checked: it measures with the current font), drawn with `draw_text` per word (section 6). `draw_text_ext(x, y, string, sep, w)` wraps one style only and reports no word positions. |
| Term | a run of the layout with one rectangle per line fragment; hit-tested against the pointer |
| Marked UI element (web: `data-deeptip`) | `deeptip_mark(id, key, x, y, w, h, [opts])` in GUI units every step, from the Step or Draw GUI event that draws the element; `opts.delay` and `opts.place` are the per-element overrides (`data-deeptip-delay`, `data-deeptip-place`); `deeptip_mark_instance(inst, key)` for instances in the room (section 8) |
| Element, window, term under the pointer | rectangles of the last drawn step: windows newest first, then that window's term fragments, then the topmost mark (marks reported later lie on top) |
| `now()`, `schedule()` | `current_time`, milliseconds since the game started (checked); due times stored in the records and compared in Begin Step |
| Consuming Esc | `keyboard_clear(vk_escape)` after DeepTip used the key: a held key is then not recognised again until it is released and pressed again, and no Key Released event follows (checked). Begin Step runs for all instances before any Step event (checked), but the order of instances inside one event is not guaranteed (checked): the game reads Esc in Step or End Step, or asks `deeptip_esc_used()`. |
| Consuming clicks | `mouse_clear(mb_left)` after a press on a window: the held state is cleared, the release is still reported (checked) |
| Touch | `device_mouse_check_button_pressed(device, mb_left)` for devices 0‥4 (at least 4 fingers on most devices, checked); `device_mouse_dbclick_enable(false)`: by default a double tap reports `mb_right` (checked) |
| Gamepad | `gamepad_button_check_pressed(device, button)` with `gp_face4` (Y), `gp_face1` (A), `gp_face2` (B), `gp_shoulderl`, `gp_shoulderr`, `gp_padu`/`gp_padd`/`gp_padl`/`gp_padr`, `gamepad_axis_value(device, gp_axislh)` / `gp_axislv` (checked) |
| Vibration | `gamepad_set_vibration(device, left, right)` (checked); no phone vibration is named in the manual pages read |
| Rest progress (`data-dt-arming`) | `deeptip_arming(id)` → 0‥1 or `undefined`; draw your own bar under the element |
| Open state (`data-dt-open`) | `deeptip_is_open(id)` |
| `onOpen`, `onClose`, `onPin` | options `on_open`, `on_close`, `on_pin` (methods taking the key) |
| Screen reader ([SPEC §6](../../SPEC.md#6-accessibility)) | no accessibility API in the manual pages read (verify) |

## 3. Data structures

Records are structs; `==` on two structs compares references (verify), which is what records need. Anchors need value equality (a term laid out again after a language switch is the same anchor), so every anchor is a string:

| Anchor | String |
|---|---|
| marked element | `"m:" + id` |
| term in a window | `"t:" + string(win.id) + ":" + key + ":" + string(n)` (n = occurrence of that key in the window, 0 = first) |
| term on a page (`deeptip_text`) | `"p:" + text_id + ":" + string(n)` |

```gml
function DeepTipWindow(_id, _key, _parent, _anchor, _via) constructor {
    id = _id;                 // 1, 2, 3 …
    key = _key;
    parent = _parent;         // the window that contains the term it came from; undefined for roots
    anchor = _anchor;         // anchor string, see above
    via = _via;               // "hover", "click", "key", "touch", "pad", "api"
    children = [];            // windows opened from terms in this one, oldest first
    pinned = false;
    frozen = false;           // pinned root whose anchor vanished (§4.5)
    leave_since = -1;         // grace (§5): when the pointer left, -1 = hot
    check_at = -1;            // next grace check
    flash_at = -1;            // the flash ends 700 ms later
    rect = undefined;         // {left, top, right, bottom} as last drawn
    anchor_rect = undefined;  // the root's anchor box as last seen
    view = undefined;         // laid-out content: lines, term fragments, buttons, size, scroll
}
```

Controller state (`global.deeptip`): `data` (locale → `{map: struct key → entry, keys: [keys in order]}`), `labels` (locale → struct), `wins` (array, oldest first), `hover` (`{win, link, trig}`), `hot` (array of windows), `pending` ([§6]: anchor, key, parent, is_link, delay, since, fire_at), `quiet`, `samples` (array of `{x, y, t}`), `lock` (`{win, since}`, [§7]), `marks` and `marks_prev` (this step's and the last step's marks: id, key, rect, opts), `press` (touch long-press), `swipe`, `swallow_until`, `esc_at`, `pad_b_at`, `focus` (`{win, index}`, section 10), `focused_mark` (`deeptip_set_focus(id)`), `esc_step` (the step in which Esc closed a window).

## 4. Look (from `frameworks/web/deeptip.css`)

GML accepts CSS colour literals `#RRGGBB` next to `$BBGGRR` (checked); alpha is separate (`draw_set_alpha`).

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `#FFFFFF` | `#1B1E24` |
| text `--dt-fg` | `#1F2328` | `#E6E8EC` |
| frame, hint separator `--dt-border` | `#C8CDD5` | `#3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `#0B69D4` | `#58A6FF` |
| term `--dt-link` | `#0B69D4` | `#6CB6FF` |
| term under the pointer `--dt-link-hover` | `#084F9F` | `#9CCFFF` |
| open term background | the term colour at alpha 0.16 | same |
| missing term `--dt-missing` | `#DD3333` | same |

Sizes: font 14 px, line height 1.5 (21 px per line), padding 12 left and right, header padding 6 6 2 12, title in the bold font, body bottom padding 10, paragraphs 0.5 em apart, list indent 1.2 em, window width 240–384, max height 480 (the body scrolls beyond it), gap 8, corner radius 8, frame 1 px, shadow `0 10 30` at 30 % black (a blurred nine-slice sprite, or none), pin and close buttons 26×26 with 15 px icons (40×40 after touch input), hint line 0.75 em at alpha 0.6 with a 1 px separator, "See also" 0.9 em, fallback badge 0.7 em with a 1 px frame at alpha 0.65. Motion: fade in over 150 ms with a 4 px slide, lock bar 2 px at the bottom edge filling linearly over `lockAfter`, flash = a 3 px accent ring for 600 ms.

Fonts: a font asset contains only its glyph ranges, by default the characters 32–127 (checked). Add Latin-1 (160–255), General Punctuation (8192–8303: `–`, `…`, `•`) and Arrows (8592–8703) or exactly the characters your glossaries use, for every one of the five fonts, or the shared glossaries lose umlauts and dashes. `font_add(name, size, bold, italic, first, last)` loads an included TTF at runtime with one range (checked). Draw the pin and close icons as lines or sprites.

## 5. Order of operations per step

1. **Begin Step of `obj_deeptip`** (before every Step event of the game):
   1. `now = current_time`; the pointer: `device_mouse_x_to_gui(0)`, `device_mouse_y_to_gui(0)`; when it moved and the last input was the mouse, add a sample `{x, y, t: now}` and drop samples older than 120 ms while more than 2 remain ([§5]).
   2. Mouse buttons, hit-tested against the rectangles of the last drawn step ([§9.1], [§9.2]): a press inside a window → remember the target, `mouse_clear(mb_left)`; the release over the same target → close button `close(w, true)`, pin button toggle, a term `follow(term, w, false)`, elsewhere `click_inside_pins`; a press outside every window → `hush` the mark under it, `outside_click_closes == "always"` closes all.
   3. Touch devices 0‥4 (section 9), keys (section 9), gamepad (section 9).
   4. Hover ([§6] "on pointer over"): `win` = the newest window containing the pointer; `link` = the term fragment under the pointer in that window or on a page text; `trig` = the topmost mark of the last step under the pointer, only when there is neither. When `{win, link, trig}` differs from the last step: reset `quiet`, `refresh_hot()`, `lock_track()`, then `arm()` or `disarm()`. Skip this while the last pointer input was touch.
   5. Due times, in this order: the pending arm (open, or wait another 90 ms while the pointer heads into another preview); each unpinned window's grace check ([§5]: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the timer lock ([§7]); the touch long-press; the end of the swallow; Esc held ≥ 600 ms; gamepad B held ≥ 600 ms; the end of a flash.
   6. Windows whose content changed (opened, pinned or unpinned, language, live values, `deeptip_refresh()`) are laid out again (section 6) and marked for placement.
2. **The game's Step, End Step, Draw and Draw GUI events** draw the game and report marks with `deeptip_mark()` and page texts with `deeptip_text()`.
3. **Draw GUI End of `obj_deeptip`**:
   1. Anchors gone ([§4.5]): a window whose mark was not reported this step closes when it is a preview; a pinned root freezes at its last box.
   2. Root anchor boxes from this step's marks; placement ([§8], section 7) for windows marked for placement and for windows whose anchor box or the GUI size changed; parents before children.
   3. Draw the windows, oldest first, and record their rectangles, term fragments and button rectangles for the next Begin Step.
   4. `marks_prev = marks; marks = [];`.

Room changes: `obj_deeptip` survives (persistent), the marks of the old room are not reported any more, so previews close and pinned roots freeze. Offer `close_on_room_change` (close all in the Room Start event) for games that want a clean screen.

## 6. Text: markup → runs → lines with term rectangles [§3]

1. Parse the entry's text with `deeptip_parse_text` ([§2]). Walk the AST and emit **runs** `{text, font, kind, term}`: `font` is one of the five fonts (`b` inside `i` and the other way round is bold italic, `code` is mono); `kind` is text, term, own (a link to the window's own key: bold, not interactive), missing (dimmed, not interactive, one warning per key), value (a live value, bold). Paragraphs are separated by one empty line, list items start with `• ` and are indented, `br` breaks the line ([§3]).
2. **Line breaking:** split each run into words and the spaces between them. Measure with `draw_set_font(run.font)` and `string_width(word)` (cache widths per font and word). Put words on the line while they fit; drop a space at the start of a line; break a word wider than the line by characters (`string_copy`). Every line is 21 px high; draw each word at `y + (21 - string_height("M")) / 2` so fonts of different heights share the line.
3. **Term fragments:** while placing the words of a term, extend the current fragment rectangle; when the term continues on the next line, start a new fragment. A term is one anchor with one or more fragments; hit-testing tests every fragment. Fragments are stored relative to the window's content origin and offset by the scroll position when tested.
4. **Natural width** ([§8] step 3): lay out once with a maximum of 384 − 24, take the widest line plus 24 (padding), clamp to 240‥384 and to the GUI width minus 16, lay out again with the final width.
5. Draw: `draw_set_font`, `draw_set_colour`, `draw_text(x, y, word)`; a term gets a 1 px underline (`draw_line`), an open term the alpha 0.16 background behind its fragments, the term with the keyboard focus a 2 px accent outline.

`draw_text` draws glossary text literally; there is nothing to escape.

## 7. Windows: build, measure, place, draw [§8]

Window content, in the order of [§3]: header (title in the bold font; fallback badge with the source locale in upper case when the entry came from a fallback locale, its tooltip `label("fallback")` drawn as a small text on hover; pin button if `pin_button`; close button if `close_buttons`), body (`body`, else `short`, else `label("missing")`), "See also" line (`label("seeAlso")` and one term per key), hint line `label("hint")` when `hints` is on and the window is a preview, lock bar.

```gml
/// Place one window next to its anchor (roots) or its parent window (children).
function deeptip_place(_dt, _w) {
    var _vw = display_get_gui_width(), _vh = display_get_gui_height();
    var _max_w = min(384, _vw - 16), _max_h = min(480, _vh - 16);
    var _v = _w.view;
    var _size = { w: _v.natural_w, h: min(_v.content_h, _max_h) };
    var _a = is_undefined(_w.parent) ? _w.anchor_rect : _w.parent.rect;
    var _vp = { w: _vw, h: _vh };
    var _p = deeptip_compute_placement(_size, _a, _dt.sides(_w), _vp, 8);
    if (_p.maxW != 0 || _p.maxH != 0) {
        if (_p.maxW != 0) deeptip_relayout(_dt, _w, min(_max_w, _p.maxW));
        _size = { w: _v.natural_w, h: min(_v.content_h, (_p.maxH != 0) ? min(_max_h, _p.maxH) : _max_h) };
        _p = deeptip_compute_placement(_size, _a, [_p.side], _vp, 8);
    }
    _w.rect = { left: _p.x, top: _p.y, right: _p.x + _size.w, bottom: _p.y + _size.h };
}
```

`_dt.sides(_w)`: roots use their mark's `opts.place` (an array like `["top", "bottom"]`) if set, else `root` (`bottom, top, right, left`); children use `child` (`left, right, top, bottom`). A window taller than its rectangle scrolls its body with `mouse_wheel_up()` / `mouse_wheel_down()` while the pointer is over it (checked), drawn inside a scissor. In Draw GUI events the scissor works on the window's back buffer, not in GUI units (checked: with a 960×540 GUI in a 1920×1080 window it addresses 1920×1080), so convert:

```gml
// Draw GUI End: clip the body of a window; _bx, _by, _bw, _bh are GUI units
var _kx = window_get_width() / display_get_gui_width();
var _ky = window_get_height() / display_get_gui_height();
var _old = gpu_get_scissor();
gpu_set_scissor(_bx * _kx, _by * _ky, _bw * _kx, _bh * _ky);
// … draw the body lines, moved up by the scroll offset …
gpu_set_scissor(_old);
```

`gpu_get_scissor()` returns a struct `{x, y, w, h}` and `gpu_set_scissor` accepts that struct (checked). With `display_set_gui_maximise` offsets, add the offset as well. Because a window is placed beside the box it came from, a child never covers its parent; it may cover older windows. Re-place when the GUI size changes, when a root's anchor box moves, or when a window's content changes size.

## 8. Coordinates and UI scale

- DeepTip computes in GUI units, y down, the space of [§8]: the GUI layer is stretched to the window whatever its size (checked), `display_set_gui_size(w, h)` fixes its size and overrides `display_set_gui_maximise` (checked), `device_mouse_x_to_gui` converts the pointer (checked).
- Marks must be GUI units. HUDs drawn in Draw GUI already are. Instances in the room need the camera transform:

```gml
/// Mark an instance in the room by its bounding box (view 0); room coordinates → GUI units.
function deeptip_mark_instance(_inst, _key, _opts = undefined) {
    var _cam = view_camera[0];
    var _sx = display_get_gui_width() / camera_get_view_width(_cam);
    var _sy = display_get_gui_height() / camera_get_view_height(_cam);
    var _vx = camera_get_view_x(_cam), _vy = camera_get_view_y(_cam);
    with (_inst) {
        deeptip_mark(string(id), _key, (bbox_left - _vx) * _sx, (bbox_top - _vy) * _sy,
            (bbox_right - bbox_left) * _sx, (bbox_bottom - bbox_top) * _sy, _opts);
    }
}
```

Rooms without views and rotated cameras need their own conversion (verify for your setup).

## 9. Input details [§9]

| Reference | GameMaker (Begin Step of `obj_deeptip`) |
|---|---|
| pointer leaves the window | `window_has_focus()` turns false (checked): `hover = {}`, `disarm()`, `lock_track(undefined)`, `refresh_hot()` |
| click ([§9.1]) | `mouse_check_button_pressed(mb_left)` / `mouse_check_button_released(mb_left)` with the hit-tests of section 5; `mouse_clear(mb_left)` after a press inside a window. The game should still ignore releases while `deeptip_pointer_over()` is true, because `mouse_clear` keeps the release (checked). |
| touch ([§9.2]) | per device 0‥4: `device_mouse_check_button_pressed(d, mb_left)` outside every window → close all (`"touch"`, the default); on a term → follow it on release; on a header (not a button) → start a swipe; on a mark → start the long-press. Moving more than 10 px (`device_mouse_x_to_gui(d)`) cancels the press; releasing ends it and checks the swipe (dy > 60, \|dx\| < 60 → close all). The long-press fires in the due-time step: open pinned (via `"touch"`), swallow the release that follows (`mouse_clear`). Tell touch from mouse by the platform (`os_type`) or by device numbers above 0. |
| Esc, Shift+Esc, hold Esc | below |
| F6, Shift+F6 | `keyboard_check_pressed(vk_f6)` with windows open: focus the next older (newer) window |
| open keys F1, `?` | `keyboard_check_pressed(vk_f1)`; `?` from `keyboard_lastchar == "?"` (layout independent; the variable is writable, so set it to `""` after handling, checked). On a focused term → `follow(term, its window, true)`; with a focused element (`deeptip_set_focus(id)`) → open its window pinned with focus (via `"key"`); `keyboard_clear(vk_f1)` |
| typing into a marked text field | the game reports it with `deeptip_hush(id)` |
| gamepad ([§9.4]) | the first connected device (`gamepad_get_device_count()`, `gamepad_is_connected(i)`, checked): `gp_face4` open / follow, `gp_face1` activate the focused term or button, `gp_face2` remember the time (held ≥ 600 ms with `gamepad_button_check(d, gp_face2)` → close all; released earlier → close newest), `gp_shoulderl` / `gp_shoulderr` cycle windows, `gp_padu`/`gp_padd`/`gp_padl`/`gp_padr` and the left stick beyond ±0.6 move the focus inside the window (detect the stick's edge yourself). GameMaker has no gamepad clear function in the pages read: the game asks `deeptip_has_focus()` before it acts on A and B. |

```gml
// Begin Step of obj_deeptip: Esc (§9.3)
var _dt = global.deeptip;
if (keyboard_check_pressed(vk_escape) && _dt.has_windows()) {
    if (keyboard_check(vk_shift)) _dt.close_all_focus(); else _dt.close_newest_focus();
    _dt.esc_at = current_time;
    _dt.esc_step = _dt.step;
    keyboard_clear(vk_escape);                         // later Step events see no Esc
}
if (_dt.esc_at >= 0) {                                 // holding Esc 600 ms closes every window
    if (!keyboard_check_direct(vk_escape)) _dt.esc_at = -1;
    else if (current_time - _dt.esc_at >= 600) { _dt.close_all_focus(); _dt.esc_at = -1; }
}
```

`keyboard_check_direct` reads the hardware and works this way only on the standard Windows target; elsewhere it behaves like `keyboard_check` (checked), which stays false after `keyboard_clear` until the key is pressed again, so the hold is a Windows feature and `Shift+Esc` (and holding B) close all everywhere.

## 10. Focus for keyboard and gamepad [§9.5]

GameMaker has no widget focus, so DeepTip keeps its own: `focus = {win, index}` over that window's focus list (its terms in text order, then pin and close). Opening by keyboard or gamepad focuses index 0 (the first term, else the pin button). While a window has the focus, `vk_tab` (with `vk_shift` backwards) and the d-pad move the index with wrapping, `vk_enter`, `vk_space` and `gp_face1` follow the focused term or press the focused button, F1/`?`/`gp_face4` on a focused term follows it; `keyboard_clear` those keys so the game's menu does not move as well. Draw the focused item with a 2 px accent outline. Closing the focused window gives the focus back to its anchor: for a term the parent window's index of that term; for a mark the game's own selection, through the `on_focus_back(id)` option. For F1 and Y on game elements the game reports its selection with `deeptip_set_focus(id)` (or `undefined`).

## 11. Timers [§5]–[§7]

Store due times and compare them with `current_time` in Begin Step; `schedule(ms, f)` becomes a field such as `pending.fire_at = now + delay`, `cancel` sets it to `-1`. Time sources (`time_source_create(parent, period, units, callback, ...)`, `call_later`, checked) and alarms also work, but due times keep the fixed order of section 5 and need no clean-up. `get_timer()` gives microseconds if you need more precision (checked). The lock bar's width is `(now - lock.since) / lock_after` of the window width, the arming bar's `(now - pending.since) / pending.delay`.

## 12. Loading the JSON in file order [§1]

`deeptip_flatten` needs the keys in file order ([§1.1]: a later duplicate wins, and nested and flat forms of one key must resolve the same way in every runtime). `json_parse` returns structs, and `struct_get_names` returns names in an order that "is not guaranteed" (checked). The filter function of `json_parse(json, [filter_func], [inhibit_string_convert])` runs once per value (checked), but the manual does not promise an order. So read the values with `json_parse` and the order with a small scanner that walks the text once (`string_foreach` calls a function per character, checked):

```gml
/// Key order of every JSON object in _text: a struct path -> array of keys in file order.
/// A path joins the keys (and array indices) from the root with chr(31); the root object is "".
function deeptip_json_key_order(_text) {
    var _s = { order: {}, stack: [], in_str: false, esc: false, uni: 0, code: 0, buf: "", is_key: false };
    string_foreach(_text, method(_s, function(_c, _pos) {
        if (in_str) {
            if (uni > 0) {                                     // \uXXXX
                code = code * 16 + string_pos(string_lower(_c), "0123456789abcdef") - 1;
                uni -= 1;
                if (uni == 0) buf += chr(code);
                return;
            }
            if (esc) {
                esc = false;
                switch (_c) {
                    case "n": buf += "\n"; break;
                    case "t": buf += "\t"; break;
                    case "r": buf += "\r"; break;
                    case "b": buf += chr(8); break;
                    case "f": buf += chr(12); break;
                    case "u": uni = 4; code = 0; break;
                    default: buf += _c;                        // \" \\ \/
                }
                return;
            }
            if (_c == "\\") { esc = true; return; }
            if (_c == "\"") {
                in_str = false;
                if (is_key) {
                    var _t = stack[array_length(stack) - 1];
                    var _keys = order[$ _t.path];
                    if (!array_contains(_keys, buf)) array_push(_keys, buf);   // a duplicate keeps its place
                    _t.key = buf;
                }
                return;
            }
            buf += _c;
            return;
        }
        var _n = array_length(stack);
        var _top = (_n > 0) ? stack[_n - 1] : undefined;
        switch (_c) {
            case "\"":
                in_str = true;
                buf = "";
                is_key = !is_undefined(_top) && _top.kind == "o" && _top.want_key;
                break;
            case "{":
            case "[":
                var _path = "";
                if (!is_undefined(_top)) {
                    var _seg = (_top.kind == "o") ? _top.key : string(_top.index);
                    _path = (_n == 1) ? _seg : _top.path + chr(31) + _seg;
                }
                array_push(stack, { kind: (_c == "{") ? "o" : "a", path: _path, key: "", index: 0, want_key: true });
                if (_c == "{") order[$ _path] = [];
                break;
            case "}":
            case "]":
                array_pop(stack);
                break;
            case ":":
                if (!is_undefined(_top)) _top.want_key = false;
                break;
            case ",":
                if (!is_undefined(_top)) {
                    if (_top.kind == "o") _top.want_key = true; else _top.index += 1;
                }
                break;
        }
    }));
    return _s.order;
}

/// Flatten one glossary (§1.1) with the key order of its text; _path is the object's path in that text.
function deeptip_flatten(_obj, _order, _path = "") {
    var _r = { entries: {}, keys: [], meta: {}, meta_keys: [], problems: [] };
    if (is_struct(_obj)) deeptip_flatten_walk(_obj, "", _path, _order, _r);
    else array_push(_r.problems, { key: "(file)", msg: "a glossary file must be a JSON object" });
    return _r;
}

function deeptip_flatten_walk(_node, _prefix, _path, _order, _r) {
    var _names = _order[$ _path] ?? struct_get_names(_node);
    for (var _i = 0; _i < array_length(_names); _i++) {
        var _k = _names[_i];
        if (!struct_exists(_node, _k)) continue;
        var _v = _node[$ _k];
        if (string_char_at(_k, 1) == "$") {
            if (_prefix == "") {
                if (!struct_exists(_r.meta, _k)) array_push(_r.meta_keys, _k);
                _r.meta[$ _k] = _v;
            }
            continue;
        }
        var _key = (_prefix == "") ? _k : _prefix + "." + _k;
        var _child = (_path == "") ? _k : _path + chr(31) + _k;
        if (is_struct(_v)) {
            if (is_string(_v[$ "title"]) || is_string(_v[$ "short"]) || is_string(_v[$ "body"])) {
                if (!deeptip_is_key(_key)) array_push(_r.problems, { key: _key, msg: "invalid key" });
                if (!struct_exists(_r.entries, _key)) array_push(_r.keys, _key);
                _r.entries[$ _key] = _v;
            } else {
                deeptip_flatten_walk(_v, _key, _child, _order, _r);
            }
        } else {
            array_push(_r.problems, { key: _key, msg: "not an entry object" });
        }
    }
}
```

A duplicate key keeps its first position and its last value, like JavaScript's `JSON.parse` (checked in the transliteration); that `json_parse` keeps the last value of a duplicate is not stated in the pages read (verify). JSON `null` becomes `undefined`, `true`/`false` stay booleans, numbers are reals (checked).

Loading ([§1.2]): `sources` are path templates with `{locale}`. For each locale of the chain `unique([locale, ...fallback])`, read every template in order (`string_replace_all(template, "{locale}", locale)`), `json_parse` it inside `try`/`catch` (invalid JSON throws, checked; a missing or broken file is a warning), flatten it with its key order, and add the entries to `data[locale]` (a later layer wins per key, a new key is appended to `keys`); merge `$ui` into `labels[locale]`. Remember read paths.

```gml
/// A UTF-8 text file from the Included Files (or the save area), or undefined.
function deeptip_read_text(_path) {
    if (!file_exists(_path)) return undefined;
    var _buf = buffer_load(_path);
    var _text = buffer_read(_buf, buffer_string);
    buffer_delete(_buf);
    if (string_char_at(_text, 1) == chr(65279)) _text = string_delete(_text, 1, 1);   // byte order mark
    return _text;
}
```

The locale of a file is its `$locale`, else the last dot part of its name (`myapp.de.json` → `de`). The included files must be enabled for every target platform you export to (Included File Properties, checked).

## 13. Live values, language, refresh [§4.6]

- `vars`: a struct name → value or method taking the window's key, or one method `(name, key)`; `undefined` keeps `{name}` visible ([§1.2]). Turn reals into text with `string()`; `string(1250)` has no thousands separator.
- `deeptip_refresh()`: lay out every open window again with current values and labels, re-attach each child to the term with the same anchor string in its re-laid-out parent, re-place every window that is not frozen. Call it after your values changed, or compare the values a window showed with the current ones every 20 steps.
- `deeptip_set_locale(locale)`: build the new chain, load the files not read yet, refresh. The system language is `os_get_language()`, a two-letter ISO 639 code, `""` or `"en"` when unknown (checked).

## 14. Porting the pure functions to GML [§2] [§8]

`scr_deeptip_core` follows the pseudo-code of algorithms.md line by line. Where GML differs from JavaScript:

- **Strings are 1-based**: `string_char_at(s, i)` returns `""` past the end, but the **first** character for `i <= 0` (checked), so a look-behind `s[i - 1]` at `i == 1` must be guarded. `string_length` counts characters (checked); JavaScript counts UTF-16 units, which only differs for characters outside the Basic Multilingual Plane (emoji). `string_ord_at` returns −1 past the end (checked).
- **No regular expressions**: write `KEY_RE`, the bullet pattern and the paragraph split as character loops.
- **Whitespace**: `string_trim` removes space, tab, CR, LF, FF and VT by default (checked), and GameMaker's list of whitespace includes U+0085 and U+180E (checked), which JavaScript's `\s` does not. Use one explicit set:

```gml
/// JavaScript's \s and String.prototype.trim(): whitespace and line terminators.
function deeptip_js_space(_c) {
    if (_c == "") return false;
    var _u = ord(_c);
    return (_u >= 9 && _u <= 13) || _u == 32 || _u == 160 || _u == 5760 || (_u >= 8192 && _u <= 8202)
        || _u == 8232 || _u == 8233 || _u == 8239 || _u == 8287 || _u == 12288 || _u == 65279;
}

/// KEY_RE ^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$ without regular expressions.
function deeptip_is_key(_s) {
    if (!is_string(_s) || _s == "") return false;
    var _len = string_length(_s), _seg = 0;
    for (var _i = 1; _i <= _len; _i++) {
        var _u = ord(string_char_at(_s, _i));
        if (_u == 46) {                                    // "."
            if (_seg == 0) return false;
            _seg = 0;
        } else if ((_u >= 48 && _u <= 57) || (_u >= 65 && _u <= 90) || (_u >= 97 && _u <= 122) || _u == 95 || _u == 45) {
            _seg += 1;
        } else {
            return false;
        }
    }
    return _seg > 0;
}

/// JavaScript's x / y in computePlacement's room / need, also for y == 0.
function deeptip_ratio(_x, _y) {
    if (_y != 0) return _x / _y;
    return (_x > 0) ? infinity : ((_x < 0) ? -infinity : NaN);
}
```

- **Numbers**: reals are doubles; a division of two reals by zero gives infinity without an error, a division of two integers (int32/int64) by zero is an error (checked), so keep placement values reals. Comparisons of reals use an epsilon (default 0.00001, `math_set_epsilon`, checked); the parity cases are not affected.
- **Truthiness**: reals above 0.5 count as `true` (checked); write `if (_p.maxW != 0)` where JavaScript writes `if (maxW)`.
- **Missing values**: JSON `null` is `undefined`; build absent link texts as `text: undefined` so the struct still has the member.
- **Sorting**: `array_sort` sorts strings by the English alphabet (checked); the encyclopedia ([§12]) needs its own folding of umlauts and accents.

## 15. API to offer

| Call | Does |
|---|---|
| `instance_create_depth(0, 0, 0, obj_deeptip, options)` | the controller; options of [SPEC §7](../../SPEC.md#7-configuration-reference-names) in snake_case (`delay`, `link_delay`, `close_delay`, `lock_after`, `long_press`, `close_buttons`, `pin_button`, `hints`, `click_inside_pins`, `outside_click_closes`, `root`, `child`, `locale`, `fallback`, `sources`, `vars`, `open_keys`, `gamepad`, `vibrate`) plus `theme`, `fonts`, `close_on_room_change`, `on_open`, `on_close`, `on_pin`, `on_focus_back`; the optional struct of `instance_create_depth` sets them before the Create event (checked) |
| `deeptip_mark(id, key, x, y, w, h, [opts])`, `deeptip_mark_instance(inst, key, [opts])` | an explained element in this step |
| `deeptip_text(id, markup, x, y, width)` → height | markup with live terms on a normal screen (web: `renderText`), drawn in Draw GUI |
| `deeptip_index(x, y, w, h, query)` | the encyclopedia ([§12]); the search field is the game's |
| `deeptip_add(locale, text)`, `deeptip_set_locale(locale)`, `deeptip_set_value(name, value)`, `deeptip_refresh()` | data ([§1.2], [§4.6]) |
| `deeptip_open(key, id, pinned)`, `deeptip_close_all()` | windows from code |
| `deeptip_set_focus(id)`, `deeptip_hush(id)` | the game's selection and typing (sections 9, 10) |
| `deeptip_has_windows()`, `deeptip_has_focus()`, `deeptip_pointer_over()`, `deeptip_is_open(id)`, `deeptip_arming(id)`, `deeptip_esc_used()` | for the game's own input, tooltips and rest bars |

## 16. Tests [§11]

Copy `test/cases/*.json` into the Included Files as `deeptip_cases/` and run the runner from a test room, or at start-up when a command-line parameter asks for it (`parameter_count()`, `parameter_string(n)`, checked). `game_end()` ends the game at the end of the step (checked).

```gml
/// Run the shared parity cases; prints "24/24 parity cases passed".
function deeptip_run_parity(_dir) {
    var _sets = ["markup", "placement", "glossary"];
    var _total = 0, _fails = 0;
    for (var _s = 0; _s < 3; _s++) {
        var _text = deeptip_read_text(_dir + _sets[_s] + ".json");
        var _cases = json_parse(_text).cases;
        var _order = deeptip_json_key_order(_text);
        for (var _i = 0; _i < array_length(_cases); _i++) {
            var _c = _cases[_i];
            var _ok = false;
            if (_s == 0) {
                _ok = deeptip_same(_c.blocks, deeptip_parse_text(_c.src));
            } else if (_s == 1) {
                _ok = deeptip_same(_c.expect, deeptip_compute_placement(_c.size, _c.anchor, _c.sides, _c.viewport, 8));
            } else {
                var _r = deeptip_flatten(_c.input, _order, "cases" + chr(31) + string(_i) + chr(31) + "input");
                _ok = deeptip_same(_c.expect, { keys: _r.keys, meta: _r.meta_keys, problems: array_length(_r.problems) });
            }
            _total += 1;
            if (!_ok) { _fails += 1; show_debug_message("FAIL " + _sets[_s] + ": " + _c.name); }
        }
    }
    show_debug_message(string(_total - _fails) + "/" + string(_total) + " parity cases passed");
    return _fails == 0 && _total > 0;
}

/// Deep equality of parsed JSON and computed results (structs by members, arrays by items).
function deeptip_same(_a, _b) {
    if (is_struct(_a)) {
        if (!is_struct(_b)) return false;
        var _names = struct_get_names(_a);
        if (array_length(_names) != array_length(struct_get_names(_b))) return false;
        for (var _i = 0; _i < array_length(_names); _i++) {
            var _k = _names[_i];
            if (!struct_exists(_b, _k) || !deeptip_same(_a[$ _k], _b[$ _k])) return false;
        }
        return true;
    }
    if (is_array(_a)) {
        if (!is_array(_b) || array_length(_a) != array_length(_b)) return false;
        for (var _i = 0; _i < array_length(_a); _i++) {
            if (!deeptip_same(_a[_i], _b[_i])) return false;
        }
        return true;
    }
    if (is_undefined(_a) || is_undefined(_b)) return is_undefined(_a) && is_undefined(_b);
    if (is_string(_a) || is_string(_b)) return is_string(_a) && is_string(_b) && _a == _b;
    return _a == _b;
}
```

`deeptip_parse_text` returns the AST of [§2] as structs and arrays (`text: undefined` when absent), `deeptip_compute_placement` returns `{side, x, y, fits, maxW, maxH}`. The glossary cases take their key order from the cases file itself (the path of each case's `input`). Expected: `24/24 parity cases passed`.

Behaviour tests: the engine takes `now` as an argument, so a test room can open windows, move a fake pointer, advance time and check the invariants of [§4] (one preview per parent, pinned chain, subtree close, flash instead of a second window), grace and tendency ([§5]) and suppression. Compare the feel with the web example (`npm run demo`).

## 17. The example to build

The scene of every DeepTip example, in a room `rm_deeptip_example` with a HUD object drawing in Draw GUI and the shared glossaries as Included Files `deeptip/core/` and `deeptip/example/`:

- A top bar of buttons drawn with `draw_rectangle` + `draw_text` and marked with `deeptip_mark`: Realm `demo.realm`, Stability `demo.stability` (a click cycles −3…+3, then `deeptip_refresh()`), Taxes `demo.taxes` (a click cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and `{delay: 0}`; a language button (de/en) calling `deeptip_set_locale()`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- A page text drawn with `deeptip_text()` containing the loop `[[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]` (the font needs the arrow).
- Options: `sources: ["deeptip/core/{locale}.json", "deeptip/example/{locale}.json"]`, `fallback: ["de", "en"]`, `delay: 1000`, `vars: { stability: function(_key) { return (global.stability > 0 ? "+" : "") + string(global.stability); }, gold: function(_key) { return string(global.gold); } }`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.

## 18. Pitfalls

1. **Event order between instances is not guaranteed** inside one event (checked). DeepTip acts in Begin Step; the game must read Esc, clicks and gamepad buttons in Step or later, or ask DeepTip.
2. **`keyboard_clear` ends the key's state until it is pressed again** (checked): the Esc hold needs `keyboard_check_direct` (Windows only).
3. **`mouse_clear` keeps the release** (checked): game buttons that act on release must check `deeptip_pointer_over()`.
4. **The scissor in Draw GUI uses window pixels**, not GUI units (checked).
5. **Font ranges**: 32–127 by default (checked); umlauts, dashes, bullets and arrows need extra ranges in every font asset.
6. **Double tap = right click** on touch devices unless `device_mouse_dbclick_enable(false)` (checked).
7. **Struct names have no order** (checked): never iterate a glossary with `struct_get_names`; use the key order of section 12.
8. **`string_char_at(s, 0)` returns the first character** (checked), not `""`.
9. **Real comparisons use an epsilon** (checked): do not use `==` on computed pixel values to detect changes; compare with a tolerance of your own or store integers.
10. **Persistent controller, rooms without marks**: previews close and pinned roots freeze on a room change (section 5); close all if your game prefers.
11. **`game_end()` on mobile**: does not close the app on Android and does nothing on iOS (checked); the parity runner is for desktop builds.

## 19. Limitations

- No screen reader output ([SPEC §6](../../SPEC.md#6-accessibility) is met for keyboard and gamepad only).
- No widgets: the game reports its elements (`deeptip_mark`), its selection (`deeptip_set_focus`) and typing (`deeptip_hush`).
- Esc, clicks and gamepad buttons cannot be hidden from code that reads them in the same event as DeepTip or ignores DeepTip's state; holding Esc closes all only on Windows.
- Not compiled in GameMaker for this guide (see the intro).

## 20. Checklist

1. `scr_deeptip_core` with the key-order scanner, flatten, parser and placement; `deeptip_run_parity` prints `24/24 parity cases passed` (section 16).
2. `scr_deeptip_engine` ported from algorithms [§4]–[§7] (or from `frameworks/rust-egui/src/engine.rs`) with scenario tests.
3. `scr_deeptip_layout`: runs, line breaking, term fragments, fonts with the right glyph ranges (sections 4, 6); windows and placement (section 7).
4. `obj_deeptip`: Begin Step input and timers, Draw GUI End drawing, Esc and mouse consumption, focus, gamepad, touch (sections 5, 9, 10).
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
