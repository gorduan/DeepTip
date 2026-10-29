# DeepTip with Dear ImGui (C++)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, in C++ with [Dear ImGui](https://github.com/ocornut/imgui). This repository keeps code only in HTML, CSS, JavaScript and Rust, so the C++ implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers only what is specific to Dear ImGui and C++.

Every Dear ImGui name below was checked against the **v1.93.0** headers (`imgui.h`, `imgui_internal.h`, `backends/imgui_impl_null.h`). Names marked *(internal)* come from `imgui_internal.h`; they are stable in practice but not covered by Dear ImGui's API promise. Names marked *(docking)* exist only on the docking branch (checked against `v1.93.0-docking`).

**Download:** `DeepTip-cpp-imgui-1.0.0.zip` holds this guide together with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout, so every relative link below works. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** `imgui.h` and `ImGui::NewFrame()` in the render loop (Dear ImGui sources in the tree, or `imgui` in `vcpkg.json` or CMake).

1. Build the data core (glossary on `nlohmann::ordered_json`, `parseText`, `computePlacement`; sections 9 and 10) and pass the parity executable on `<DeepTip>/test/cases` (section 14).
2. Build the controller without ImGui types and test it with a fake clock (sections 3, 4 and 14).
3. Build the ImGui layer: text layout with terms, windows, placement and input (sections 5–8).
4. Copy `glossary/core/<locale>.json` to `deeptip/core/`; your own entries go to `deeptip/<locale>.json`.
5. Wrap your UI in `dt.BeginFrame()` and `dt.EndFrame()` and call `dt.Item(key)` after each widget to explain (below; API: section 11).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```cpp
deeptip::Glossary glossary;
glossary.addFile("deeptip/core/en.json");   // core first
glossary.addFile("deeptip/en.json");        // your entries after
glossary.setLocale("en");
deeptip::Options options;
deeptip::ImGuiDeepTip dt(glossary, options);

// every frame
ImGui::NewFrame();
dt.BeginFrame();
ImGui::Begin("HUD");
ImGui::Button("?");
dt.Item("deeptip.about");                   // marks the widget just submitted
ImGui::End();
dt.EndFrame();
ImGui::Render();
```

**Done when:** `ctest` passes the parity cases, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without reaching your own `IsKeyPressed(ImGuiKey_Escape)`, the validator reports 0 errors.

## 1. Architecture

| Layer | Contents | Depends on | Verified by |
|---|---|---|---|
| Data core | glossary layers and locale chain [§1], `parseText` [§2], `computePlacement` [§8] | C++17, nlohmann/json | the shared parity cases [§11] |
| Controller | window tree [§4], hot set, grace, tendency and suppression [§5], arming [§6], timer lock [§7], the input state machine [§9]; time, boxes and the hover state are passed in | C++17 only | scenario tests with a fake clock |
| ImGui layer | text layout and drawing [§3], windows, hit-testing, polling input, focus | Dear ImGui ≥ 1.92 | headless frames with `imgui_impl_null` |

Keep the controller free of ImGui types. It holds most of the rules, and without ImGui it can be driven step by step with exact times in tests.

## 2. SPEC concept → Dear ImGui

| SPEC concept | Dear ImGui primitive |
|---|---|
| UI element with a key (web: `data-deeptip`) | `dt.Item("key")` right after the widget. It reads `ImGui::GetItemID()` as anchor id (items without an id, such as `Text`, use `ImGui::GetID(key)`), `GetItemRectMin()`/`GetItemRectMax()` as the box, `IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)` (disabled controls explain themselves too) and `IsItemFocused()`. The element's own delay and side order are arguments. |
| Term (a link in a text) | A span in DeepTip's own text layout (section 5). Every fragment of the term (one word piece on one line) is an `ImGui::InvisibleButton` covering the fragment. The first fragment gets `ImGuiButtonFlags_EnableNav`, because `InvisibleButton` is not reachable by Tab or gamepad otherwise; the other fragments are wrapped in `PushItemFlag(ImGuiItemFlags_NoNav, true)` so a term is one Tab stop. |
| Term anchor id | Inside a window: `ImGui::PushID(window.id); ImGui::GetID(key)`. A child is then re-attached to "the term with the same key" automatically after a refresh [§4]. On a page (`dt.Text`): `GetID(key)` under `PushID(occurrence)`. |
| Window | A top-level window: `SetNextWindowPos` and `SetNextWindowSize` from the placement, then `Begin("##dt<id>", nullptr, flags)` with `ImGuiWindowFlags_NoTitleBar \| NoResize \| NoMove \| NoCollapse \| NoSavedSettings \| NoFocusOnAppearing \| NoScrollbar \| NoScrollWithMouse`, plus `NoNav` for previews and `NoDocking` *(docking)*. Title bar, buttons and content are drawn by DeepTip; a body with limited height scrolls in a child window (section 7). |
| Top layer (web: popover) | In every DeepTip window, every frame, oldest first: `ImGui::BringWindowToDisplayFront(ImGui::GetCurrentWindow())` *(internal)*. Without it, clicking any host window covers the DeepTip windows. |
| Preview, pinned | A flag in the window record. Pinned: border in the accent colour (`ImGuiCol_Border`), filled pin, no hint line, keyboard navigation allowed. |
| `schedule(ms, f)` | A due time in milliseconds against `ImGui::GetTime() * 1000.0` (the sum of `io.DeltaTime`), checked once per frame. Timers therefore have frame granularity (about 16 ms at 60 Hz). |
| Pointer position and type | `io.MousePos`, valid when `ImGui::IsMousePosValid()`; `io.MouseSource` is `ImGuiMouseSource_Mouse`, `ImGuiMouseSource_TouchScreen` or `ImGuiMouseSource_Pen` (backends report it with `io.AddMouseSourceEvent`). |
| Pointer history for the tendency | Append `{io.MousePos, now}` when the position changed since the previous frame and the source is not touch; trim as in [§5]. |
| "pointer over" | Recomputed every frame: window = `IsWindowHovered(ImGuiHoveredFlags_ChildWindows)` inside each DeepTip window, term = a fragment's `IsItemHovered()`, element = the `IsItemHovered()` seen by `dt.Item()`. The [§6] handler runs only when the triple changed. |
| Click | `InvisibleButton` returns `true` on a mouse release over the same item and on Enter, Space or gamepad A through navigation. It came from the keyboard when it fired while `!ImGui::IsMouseReleased(ImGuiMouseButton_Left)`. |
| Pointer down, up | `ImGui::IsMouseClicked(ImGuiMouseButton_Left)` and `IsMouseReleased(ImGuiMouseButton_Left)` with this frame's hover target. |
| Keys | `IsKeyPressed(ImGuiKey_Escape, false)`, `ImGuiKey_F6`, `ImGuiKey_F1`, `io.KeyShift`. "?" comes from `io.InputQueueCharacters` (independent of the keyboard layout) and is ignored while `io.WantTextInput`. How long Esc is held: `ImGui::GetKeyData(ImGuiKey_Escape)->DownDuration` *(internal accessor of the public `ImGuiKeyData`)*. |
| Consuming Esc [§9] | Handle Esc right after `ImGui::NewFrame()`, then `ImGui::SetKeyOwner(ImGuiKey_Escape, owner, ImGuiInputFlags_LockUntilRelease)` *(internal)*: the host's `IsKeyPressed(ImGuiKey_Escape)` stays false until the key is released. Shortcut routing (`ImGui::Shortcut`) is not enough, it only arbitrates between `Shortcut()` callers. |
| Gamepad | Named keys from the platform backend (`ImGuiBackendFlags_HasGamepad`): Y = `ImGuiKey_GamepadFaceUp`, B = `ImGuiKey_GamepadFaceRight`, LB/RB = `ImGuiKey_GamepadL1`/`ImGuiKey_GamepadR1`. A (`ImGuiKey_GamepadFaceDown`) and the d-pad are Dear ImGui's own navigation (`ImGuiConfigFlags_NavEnableGamepad`). |
| Focus [§9] | Into a window: inside its `Begin`, `ImGui::SetWindowFocus()` and `ImGui::SetKeyboardFocusHere()` directly before the first term's button. Back to an element: in its next `dt.Item()`, `ImGui::SetWindowFocus()` and `ImGui::SetKeyboardFocusHere(-1)` (−1 = the widget just submitted). The focused DeepTip window: `IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows)`. |
| `data-dt-open` (hide your own tooltip) | `dt.Item()` returns `true` while a window is open for that element: `if (!dt.Item("x")) ImGui::SetItemTooltip("...");` |
| `data-dt-arming` (rest progress) | `dt.Item()` draws a 2 px line under the element that grows over the delay (option `armingBar`, default on). The same for a running long-press. |
| Timer lock bar [§7] | A 2 px bar at the window's bottom edge, `ImDrawList::AddRectFilled`, width = elapsed / `lockAfter`. |
| Flash [§4] | A 3 px accent outline (`AddRect`) for 600 ms, strongest at 30 % (the web keyframe). With `reducedMotion`: a static outline for the same time. |
| Live values [§1] | Read every frame anyway (immediate mode). `Refresh()` only clears caches, such as parsed ASTs, after `SetLocale` or `add`. |
| Missing entry, fallback badge | As in [§1] and [§3]. The badge's tooltip: `ImGui::SetItemTooltip(label("fallback"))` after an item covering the badge. |
| Encyclopedia [§12] | `dt.Index()` inside any host window: `ImGui::InputTextWithHint` for the search, rows drawn with page terms. |
| Accessibility (SPEC §6) | Not available: Dear ImGui has no accessibility tree. Keyboard and gamepad paths are complete. |

## 3. Data structures

The controller uses no ImGui types. Boxes and pointer samples share one coordinate system, Dear ImGui's screen coordinates (pixels, y down); only `computePlacement` gets them relative to the work area (section 7). Times are in milliseconds.

```cpp
namespace deeptip {
using AnchorId = std::uint64_t;            // ImGuiID of the element or term, widened
struct Box { double left, top, right, bottom; };

struct Entry { std::string title, shortText, body; bool hasTitle = false, hasShort = false, hasBody = false;
               std::vector<std::string> aliases, see; };
struct Glossary {                                        // [§1]
  std::unordered_map<std::string, std::unordered_map<std::string, Entry>> data;         // locale -> key -> entry
  std::unordered_map<std::string, std::unordered_map<std::string, std::string>> labels;  // locale -> $ui
  std::string locale = "en";
  std::vector<std::string> fallback{"en"};
};

struct Inline {                                          // [§2], the shapes of test/cases/markup.json
  enum Kind { Text, Br, Bold, Italic, Code, Link, Var } kind;
  std::string v;                                         // text, code, link key or variable name
  std::optional<std::string> label;                      // link text; nullopt = "text": null
  std::vector<Inline> c;                                 // children of Bold and Italic
};
struct Block { bool list = false; std::vector<Inline> c; std::vector<std::vector<Inline>> items; };

enum class Via { Api, Hover, Click, Key, Pad, Touch };
struct Window {                                          // [§4]
  int id; std::string key; Window* parent = nullptr; AnchorId anchor; std::vector<Window*> children;
  bool pinned = false, frozen = false; Via via = Via::Api;
  double closeDue = 0, leaveSince = 0;                   // grace timer [§5]; 0 = not running
  double flashUntil = 0;
  Box box{};                                             // placed box: children and the tendency use it
  bool focusRequest = false;                             // applied when the window is submitted
};
struct Hover { Window* win = nullptr; AnchorId link = 0; Window* linkParent = nullptr; AnchorId trig = 0; };
struct Pending { AnchorId el; bool isLink; Window* parent; std::string key; double since, due, delay; };
struct Sample { double x, y, t; };
}
```

Windows live in one list, oldest first (`std::vector<std::unique_ptr<Window>>`); that order is the creation order the top layer needs. Per frame the ImGui layer keeps a table of the anchors submitted this frame: id, key, box, own delay, own side order, hovered, focused.

## 4. Order of operations per frame

```cpp
ImGui::NewFrame();
dt.BeginFrame();                      // steps 1-4
/* host UI: widgets followed by dt.Item(key), dt.Text(markup), dt.Index() */
dt.EndFrame();                        // steps 5-12
ImGui::Render();
```

`BeginFrame()`, before the host sees any input of this frame:

1. `now = ImGui::GetTime() * 1000.0`; clear the per-frame anchor table and the hover candidates.
2. Esc [§9]: if windows are open and `IsKeyPressed(ImGuiKey_Escape, false)`: with `io.KeyShift` close all and request focus for the anchor of the root that held the focus; otherwise `close(newest(focusedWindow), focusBack = true)`. Then lock the key with `SetKeyOwner(..., ImGuiInputFlags_LockUntilRelease)`. While Esc stays down and `DownDuration ≥ 0.6 s` (once per press): close all with focus back. F6 and Shift+F6 cycle the windows and are locked the same way.
3. Remember this frame's open keys: `F1` pressed, "?" in `io.InputQueueCharacters` (not while `io.WantTextInput`), gamepad Y pressed; and whether a printable character was typed without Ctrl, Alt or Super (used for "hush", [§6]).
4. Gamepad B, LB, RB [§9] with the window that had focus in the previous frame: B down starts its timer; held ≥ 600 ms closes all; released earlier closes `newest(focused)`; LB and RB cycle.

`dt.Item(key, delayMs = -1, place = nullptr)`, during the host UI:

- Register the anchor (id, key, box, delay, place) as seen this frame; a later call with the same id overwrites the box.
- `IsItemHovered(ImGuiHoveredFlags_AllowWhenDisabled)` makes it the element candidate of this frame.
- `IsItemFocused()` together with an open key from step 3 opens the element's window pinned with focus [§9].
- Pointer pressed on it (`IsMouseClicked` of any button, source not touch) or a typed character while `IsItemActive()`: hush [§6].
- A pending focus-back request for this anchor: `SetWindowFocus()` and `SetKeyboardFocusHere(-1)`.
- Draw the rest progress if this anchor is armed or long-pressed; return whether a window is open for it.

`dt.Text(markup)` lays out the text at `ImGui::GetContentRegionAvail().x`, draws it into the host window and registers every term as a page-term anchor whose box is the union of its fragments. A hovered fragment is the term candidate (no parent window), a pressed one queues `follow(term, none)`, a focused one with an open key follows it with focus.

`EndFrame()`:

5. Pointer: if the position is valid and changed and the source is not touch, append a sample [§5]. A long-press whose pointer drifted more than 10 px ends [§9].
6. For every window, oldest first:
   1. Target box: the parent's box from this frame for children, the anchor's box from this frame for roots. A root whose anchor was not submitted this frame keeps its last box (step 7 decides).
   2. Lay out header, body, "See also" and hint at the natural width (section 5) and measure the size.
   3. Place it [§8] (section 7); with `maxW` or `maxH` lay out again at the limited size and place again with the chosen side only.
   4. `SetNextWindowPos`, `SetNextWindowSize`, `Begin`, then `BringWindowToDisplayFront(GetCurrentWindow())`.
   5. Draw frame, header (title, badge, pin and close buttons), body fragments with their term buttons, "See also", hint, lock bar and flash. A pending focus request: `SetWindowFocus()` and `SetKeyboardFocusHere()` before the first term.
   6. Collect: `IsWindowHovered(ImGuiHoveredFlags_ChildWindows)` → window candidate; hovered term fragment → term candidate with this window as parent; pressed buttons and terms → click queue (with "from keyboard" as in section 2); `IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows)` → focused window; a focused term plus an open key → queue `follow` with focus.
   7. Store `GetWindowPos()` and `GetWindowSize()` as the window's box; `End()`.
7. Anchors that disappeared [§4]: a preview whose anchor was not submitted this frame closes; a pinned root freezes at its last box.
8. Hover triple = window candidate, term candidate, element candidate (the element only when there is neither window nor term). If it differs from the previous frame, run "on pointer over" [§6]. If `!IsMousePosValid()`, run "pointer leaving the application surface".
9. Pointer down and up [§9] with this frame's target: window, header, button, term, element, touch or not.
10. The click queue [§9], in submission order.
11. Due timers: grace ticks [§5], the pending hover [§6], the long-press [§9], the lock [§7].
12. Keep this frame's hover triple and boxes for the next frame.

Windows opened in steps 10 and 11 appear in the next frame. Because DeepTip measures its windows itself (section 5), a new window appears complete in its first frame.

## 5. Text layout, drawing and hit-testing [§3]

Dear ImGui has no rich text, so DeepTip lays out the AST itself.

- **Fonts:** five `ImFont*` at one size: regular, bold, italic, bold italic, monospace. A missing style is faked: bold = the text drawn again 1 px to the right; italic = after `ImDrawList::AddText`, shear the vertices it added: remember `VtxBuffer.Size` before, then for each new vertex `v.pos.x += (baselineY - v.pos.y) * 0.2f`.
- **Measuring:** `font->CalcTextSizeA(size, FLT_MAX, 0.0f, begin, end)` per fragment; draw with `ImDrawList::AddText(font, size, pos, col, begin, end)`. Measure and draw the same fragments, so kerning differences between a fragment and a whole line cannot shift anything.
- **Fragments:** split every text run at spaces into words that keep their trailing spaces; a word wider than the line is split between UTF-8 characters. Links, code and values are split the same way, so a long term can wrap.
- **Lines:** greedy line breaking; a trailing space at the end of a line does not count; `br` breaks; paragraphs are separated by 0.5 em; a list item puts "•" in a 1.2 em indent and wraps its text at that indent. Line height 1.5 × font size. Mixed fonts share a baseline: draw each fragment at `lineTop + (lineHeight - size) / 2 + (maxAscent - ascent)` with `ascent = font->GetFontBaked(size)->Ascent`.
- **Terms:** link colour with a dotted underline (short `AddLine` dashes); hovered: hover colour, solid underline; open (a window is open for it): a background of 16 % of the text colour and a solid underline; missing target: text colour with a wavy red underline (`AddPolyline`), not interactive; link to the window's own key: bold. Code: monospace at 0.92 em in the code colour. Values: semibold (use bold).
- **Hit-testing:** each term fragment is an `InvisibleButton` at the fragment's box (`SetCursorScreenPos` first). A term is hovered when any fragment is hovered; draw all its fragments in the hover style. Give every fragment its own id (`PushID(fragmentIndex)`), so `io.ConfigDebugHighlightIdConflicts` stays quiet.
- **Content size:** after the last block, `SetCursorScreenPos` to the block's end and `Dummy({width, 0})`, so a window with limited height knows its scroll range.

## 6. Look (from `frameworks/web/deeptip.css`)

Pixels at scale 1; multiply every value by your UI scale (the factor you also give to `ImGuiStyle::ScaleAllSizes` and `style.FontScaleDpi`).

| Part | Value |
|---|---|
| Window | min width 240, max width 384, max height 480, border 1, radius 8, shadow `0 10 30` black at 30 % (draw two or three translucent rounded rects behind the window, or skip it) |
| Text | 14 px, line height 1.5 |
| Header | padding 6 6 2 12 (top right bottom left); title bold; badge 0.7 em with a 1 px border, radius 3, opacity 0.65, margin 0 4 |
| Buttons | 26 × 26 (40 × 40 on touch), icon 15 px (18 on touch), stroke 2, opacity 0.6 and 1 on hover or focus; hover background black 7 % (light) or white 9 % (dark) |
| Body | padding 0 12 10; 0.5 em after each block; lists indented 1.2 em |
| "See also" | padding 0 12 10; 0.9 em; label opacity 0.7 |
| Hint | padding 4 12 6; 0.75 em; opacity 0.6; 1 px line above; hidden when pinned and after touch input |
| Lock bar | 2 px at the bottom edge, accent colour |
| Colours (light / dark) | background `#ffffff` / `#1b1e24`, text `#1f2328` / `#e6e8ec`, border `#c8cdd5` / `#3b414d`, accent (pinned, focus) `#0b69d4` / `#58a6ff`, link `#0b69d4` / `#6cb6ff`, link hover `#084f9f` / `#9ccfff`, missing `#dd3333` |
| Icons | `PIN_PATH` and `CLOSE_PATH` in `frameworks/web/deeptip.js` (24 × 24 view box). The close icon is two lines; draw a simplified pushpin with lines and a filled head, or render both SVGs into a small texture. |
| Motion | open: opacity 0 → 1 over 150 ms (`ImGuiStyleVar_Alpha` around `Begin`); nothing with `reducedMotion` |

Push `ImGuiStyleVar_WindowPadding` (0, 0), `ImGuiStyleVar_WindowRounding`, `ImGuiStyleVar_WindowBorderSize` and the colours `ImGuiCol_WindowBg`, `ImGuiCol_Border` around each `Begin`, and draw the paddings yourself; the measured size then equals the window size.

## 7. Placement [§8]

- **Coordinates:** screen space, y down. The viewport is `ImGui::GetMainViewport()->WorkPos` and `WorkSize` (without the main menu bar). Pass boxes relative to `WorkPos` into `computePlacement` and add `WorkPos` to the result.
- **Natural size:** width = the widest unwrapped line of header, body, "See also" and hint plus paddings, clamped to [min width, max width]; lay out at that width; height capped at the max height (the body scrolls).
- **Compute in `double`.** `ImVec2` is `float`; convert only when calling `SetNextWindowPos` and `SetNextWindowSize`. The parity cases compare exact values.
- **Shrinking:** with `maxW` lay out again at `maxW` (the window gets taller), with `maxH` limit the height and let the body scroll inside a child window (`ImGui::BeginChild`), so the header stays visible and the mouse wheel scrolls the body. Then place again with `[side]`.
- **Every frame:** immediate mode places every window again in every frame, so windows follow anchors that move or resize; frozen roots keep their box. `GAP` (8) and `MIN_SHRINK` (120) are pixels at scale 1.
- **Multi-viewport** *(docking)*, with `ImGuiConfigFlags_ViewportsEnable`: in `dt.Item()` remember the host window's viewport (`ImGui::GetWindowViewport()`), place inside its `WorkPos`/`WorkSize` and call `ImGui::SetNextWindowViewport(viewport->ID)` before `Begin`. `ImGui::GetWindowDpiScale()` gives that viewport's DPI scale.

## 8. Input details [§9]

- **Mouse:** rest on an element for `delay` (per element: the `delayMs` argument), hover a term for `linkDelay`, click a term to pin the chain, click inside a preview to pin it. For "click inside a preview" remember the window under a pointer-down that was not on a button or term, and pin when the release happens inside the same window.
- **Touch** (`io.MouseSource == ImGuiMouseSource_TouchScreen`): no hover arming and no tendency samples. A press on an element starts the long-press; when it fires, call `ImGui::ClearActiveID()` *(internal)* so the host's button does not click on release (the "swallow" of [§9]), then open the window pinned. Drift beyond 10 px cancels. A tap outside every window closes all (`outsideClickCloses = "touch"`), a downward swipe of 60 px on a header closes all. Dear ImGui has no vibration API: offer a callback.
- **Keyboard:** requires `ImGuiConfigFlags_NavEnableKeyboard` for Tab and Enter on terms. F1 or "?" on a focused element opens it pinned and moves the focus into the window; Esc, Shift+Esc, holding Esc and F6 as in section 4.
- **Gamepad:** requires `ImGuiConfigFlags_NavEnableGamepad` and a backend with gamepad support. Dear ImGui's directional navigation is spatial rather than the reference's linear order; to wrap at the edges, call `ImGui::NavMoveRequestTryWrapping(ImGui::GetCurrentWindow(), ImGuiNavMoveFlags_LoopX | ImGuiNavMoveFlags_LoopY)` *(internal)* inside each window before `End()`.
- **Focus back:** when a window with focus inside closes, the focus request goes to its anchor and is applied in that anchor's next `dt.Item()` or `dt.Text()`.

## 9. Loading the JSON [§1]

Use [nlohmann/json](https://github.com/nlohmann/json) and parse with `nlohmann::ordered_json`, because [§1] walks every object in file order. A plain `nlohmann::json` sorts keys, and assigning a parsed `json` to an `ordered_json` does not restore the order.

```cpp
using ojson = nlohmann::ordered_json;

bool Glossary::addFile(const std::filesystem::path& file, std::string locale) {
  std::ifstream in(file, std::ios::binary);
  ojson j = ojson::parse(in, nullptr, /*allow_exceptions=*/false);
  if (j.is_discarded()) { warn("DeepTip: cannot parse " + file.string()); return false; }
  if (locale.empty()) locale = localeOf(j, file);   // $locale, else from the file name
  add(locale, j);                                   // flatten [§1], set entries, merge $ui
  return true;
}
```

- Locale from the file name: the last dot-separated part before `.json` (`de.json` → `de`, `myapp.de.json` → `de`, `en-US.json` → `en-US`).
- Duplicate keys: the parser assigns through `operator[]`, so the last value wins at the position of the first occurrence, the same as JavaScript's `JSON.parse`.
- Keys that look like integers (`"10"`) are listed first, in ascending order, by JavaScript objects; `ordered_json` keeps the file order. Only numeric keys are affected, and neither DeepTip glossaries nor the parity cases use them.
- Strings stay UTF-8 `std::string` (`\u` escapes are decoded). Open files through `std::filesystem::path`, so non-ASCII paths work on Windows.
- An entry is an object with `title`, `short` or `body` as a string; keep `aliases` and `see` only when they are arrays of strings; ignore `note`.

## 10. Porting the parser to UTF-8 [§2]

The reference works on UTF-16 strings, C++ on UTF-8 bytes. Port [§2] literally and change only these points:

| Reference (UTF-16) | C++ (UTF-8) |
|---|---|
| `\s` and `trim()` | exactly U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF; decode code points. `std::isspace` is ASCII-only and depends on the C locale. |
| `s[from]` is whitespace | decode the code point that starts at `from` |
| `s[j-1]` is whitespace | step back over continuation bytes (`(b & 0xC0) == 0x80`), then decode |
| `[-•]` in the bullet pattern | `-` or the bytes `E2 80 A2` (U+2022) |
| `(.*)$` in the bullet pattern | the rest after the whitespace run; no match when the rest contains U+2028 or U+2029 |
| `indexOf("]]")`, `` "`" ``, `"*"`, `"\\"` | byte search is correct: ASCII bytes never occur inside multi-byte characters |
| `VAR_RE` on at most 64 characters | identical on bytes, a match is ASCII only |
| skipping one unit after a backslash | may land inside a multi-byte character; continuation bytes never match a delimiter, so the result is the same |
| `text: null` | `std::optional<std::string>` |

## 11. API to offer

| Call | Does |
|---|---|
| `deeptip::Glossary g; g.addFile(path)` or `g.add(locale, json)` | add a layer; core first, project after [§1] |
| `g.setLocale("de"); g.setFallback({"de", "en"})` | the chain [§1] |
| `deeptip::ImGuiDeepTip dt(g, options)` | the runtime, one per ImGui context |
| `dt.BeginFrame()`, `dt.EndFrame()` | right after `ImGui::NewFrame()`, right before `ImGui::Render()` |
| `bool dt.Item(key, delayMs = -1, place = nullptr)` | mark the widget just submitted; `true` while its window is open |
| `dt.Text(markup)` | page text with live terms |
| `dt.Index()` | the encyclopedia [§12] |
| `dt.Open(key, anchor, pinned, focus)`, `Close(id)`, `CloseAll()`, `Pin(id)`, `Unpin(id)` | window control [§4] |
| `dt.Refresh()` | after a locale switch or glossary change |
| `bool dt.WantsFrames()` | `true` while a timer runs; event-driven render loops must keep producing frames |

Options use the reference names (SPEC §7): `delay`, `linkDelay`, `closeDelay`, `lockAfter`, `longPress`, `closeButtons`, `pinButton`, `hints`, `clickInsidePins`, `outsideClickCloses`, `root`, `child`, `openKeys`, `gamepad`, `vibrate`, `vars`, `onOpen`, `onClose`, `onPin`; ImGui extras: `armingBar`, `reducedMotion`, `scale`, the five fonts, light or dark colours.

## 12. Minimal use

```cpp
deeptip::Glossary glossary;
for (const char* loc : {"en", "de"}) {
  glossary.addFile(root / "glossary/core" / (std::string(loc) + ".json"));     // core first
  glossary.addFile(root / "glossary/example" / (std::string(loc) + ".json"));  // project after
}
glossary.setLocale("en");
glossary.setFallback({"de", "en"});

deeptip::Options options;
options.vars = [&](std::string_view name, std::string_view /*key*/) -> std::optional<std::string> {
  if (name == "gold") return std::to_string(gold);
  return std::nullopt;                         // unknown names stay visible as {name}
};
deeptip::ImGuiDeepTip dt(glossary, options);

// every frame
ImGui::NewFrame();
dt.BeginFrame();
ImGui::Begin("HUD");
if (ImGui::Button("Realm")) { /* the button keeps its own action */ }
dt.Item("demo.realm");
ImGui::SameLine();
ImGui::Button("?");
dt.Item("deeptip.about", /*delayMs=*/0);
dt.Text("Watch [[demo.stability]] and [[demo.taxes|your taxes]].");
ImGui::End();
dt.EndFrame();
ImGui::Render();
```

## 13. The example

Build the same strategy-game screen as the web example (`frameworks/web/example/index.html`), with the shared glossaries:

- A top bar with buttons for `demo.realm`, `demo.stability`, `demo.taxes`, `demo.nobles` and `demo.gold`, a "?" button for `deeptip.about` with delay 0, and a language switch (English, Deutsch). Four buttons in the screen corners (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) test placement at the edges.
- Live values: `{stability}` with a sign (`+1`), `{gold}` with the locale's thousands separator. Clicking "Stability" cycles −3 to +3; clicking "Taxes" cycles low, normal, high and adds 50, 120 or 260 gold. The buttons keep their own action; DeepTip only explains them.
- Locale chain `[locale, "de", "en"]` as in the web example, so the English screen shows `demo.prestige` and `demo.gold` from German with a `DE` badge.
- Panels: the intro and controls text of the web example rendered with `dt.Text`, the settings (delay slider 0 to 3 s, lock off, 1.5 s or 3 s, outside click, X buttons, pin button, hint line), the encyclopedia `dt.Index()` and an event log fed by `onOpen`, `onPin` and `onClose`.
- Glossary files: search upwards from the executable's folder for `glossary/core/en.json`. In the repository and in the download the shared glossaries are at `../../glossary/` relative to `frameworks/cpp-imgui/`.
- `--frames N` quits after N frames, for a smoke run in CI.

Backend: Win32 + DirectX 11 (`imgui_impl_win32.cpp`, `imgui_impl_dx11.cpp`; link `d3d11`, `dxgi`, `d3dcompiler`) on Windows, or GLFW + OpenGL 3 (`imgui_impl_glfw.cpp`, `imgui_impl_opengl3.cpp`) elsewhere. On Windows, load a TTF with the glyphs the glossaries use (for example Segoe UI with its bold and italic files, and Consolas for code); see the font pitfall below. CMake sketch:

```cmake
cmake_minimum_required(VERSION 3.24)
project(deeptip_imgui CXX)
set(CMAKE_CXX_STANDARD 17)
include(FetchContent)
FetchContent_Declare(imgui GIT_REPOSITORY https://github.com/ocornut/imgui.git GIT_TAG v1.93.0)
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz)
FetchContent_MakeAvailable(imgui json)   # imgui has no CMakeLists.txt: this only downloads it
add_library(imgui STATIC ${imgui_SOURCE_DIR}/imgui.cpp ${imgui_SOURCE_DIR}/imgui_draw.cpp
            ${imgui_SOURCE_DIR}/imgui_tables.cpp ${imgui_SOURCE_DIR}/imgui_widgets.cpp)
target_include_directories(imgui PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
# deeptip_core (data + controller, links nlohmann_json::nlohmann_json), deeptip_imgui (links imgui),
# the example (adds the backend sources), the three test executables; register them with add_test().
```

## 14. Tests [§11]

**Parity cases.** One executable reads `test/cases/*.json` (path as argument, `../../test/cases` from this folder) and compares:

```cpp
using json = nlohmann::json;           // sorted keys: == ignores key order
using ojson = nlohmann::ordered_json;  // file order, needed for the glossary.json input

template <class J> J load(const std::filesystem::path& file) { std::ifstream in(file); return J::parse(in); }

const json markup = load<json>(dir / "markup.json");           // keep the document alive while iterating
for (const auto& c : markup["cases"])
  expect(toJson(parseText(c["src"].get<std::string>())) == c["blocks"], c["name"].get<std::string>());

const json placement = load<json>(dir / "placement.json");
for (const auto& c : placement["cases"]) {
  auto p = computePlacement(size(c["size"]), box(c["anchor"]), sides(c["sides"]), size(c["viewport"]), 8.0);
  json got = {{"side", p.side}, {"x", p.x}, {"y", p.y}, {"fits", p.fits}, {"maxW", p.maxW}, {"maxH", p.maxH}};
  expect(got == c["expect"], c["name"].get<std::string>());   // 192 == 192.0 is true in nlohmann/json
}

const ojson glossary = load<ojson>(dir / "glossary.json");
for (const auto& c : glossary["cases"]) {
  auto r = flatten(c["input"]);                                 // keys and meta in file order
  expect(ojson(r.keys) == c["expect"]["keys"] && ojson(r.meta) == c["expect"]["meta"]
         && r.problems.size() == c["expect"]["problems"].get<std::size_t>(), c["name"].get<std::string>());
}
```

`toJson` writes the AST in the case format: `{"type":"p","c":[...]}`, `{"type":"ul","items":[[...]]}`, `{"t":"link","key":k,"text":null}` and so on. Numbers are compared exactly; compute placement in `double`.

**Controller scenarios.** With a fake clock and hand-made boxes (no ImGui), check the reference behaviour: a preview opens after exactly `delay` on an element and `linkDelay` on a term; a second term in the same parent replaces the first preview (invariant 1); clicking a term deep in a chain pins every ancestor (invariant 2); closing a root closes its subtree (invariant 3); the same key further up flashes that window instead of opening (invariant 4); leaving closes after `closeDelay`, but samples heading into the window keep it (re-checked every 90 ms, at most 1.5 s); a term crossed on the way into a preview does not fire while the pointer heads there (suppression); with `lockAfter` 1500 resting inside a preview pins it at 1500 ms; Esc closes the newest window below the focused one, Shift+Esc and a 600 ms hold close all; a 500 ms long-press opens pinned and swallows the click, a 10 px drift cancels it.

**Headless ImGui frames.** `ImGui::CreateContext()`, `ImGui_ImplNull_Init()`; per frame `ImGui_ImplNull_NewFrame()` (it sets a 1920 × 1080 display and `io.DeltaTime = 1/60`), input through `io.AddMousePosEvent`, `io.AddMouseButtonEvent`, `io.AddMouseSourceEvent` and `io.AddKeyEvent`, then `ImGui::NewFrame()`, the host UI with DeepTip, `ImGui::Render()` and `ImGui_ImplNullRender_RenderDrawData(ImGui::GetDrawData())`. Check open windows, pinned states and boxes: a child never overlaps its parent, every window stays inside the work area. `io.ConfigInputTrickleEventQueue` (on by default) spreads a press and its release over two frames: feed them in separate frames.

Run everything with `ctest --test-dir build -C Release --output-on-failure`. Behaviour the tests cannot cover is compared by hand with the web example (`npm run demo`).

## 15. Pitfalls

- `InvisibleButton` is not navigable unless you pass `ImGuiButtonFlags_EnableNav`; without it terms cannot be reached with Tab or the gamepad.
- Do not use `ImGuiWindowFlags_AlwaysAutoResize` for the windows: an auto-resizing window is invisible in its first frame and reports its size one frame late, so placement would jump. Measure the content yourself.
- `NoFocusOnAppearing` on every DeepTip window: a hover preview must never take the keyboard focus from the host.
- Host windows come to the front when clicked; re-front the DeepTip windows every frame (section 2). While a host popup is open (`ImGui::IsPopupOpen("", ImGuiPopupFlags_AnyPopup)`) you may skip that, so menus and combo lists stay on top.
- Window names: never reuse an id (`"##dt" + id` with a counter). Dear ImGui keeps the state of a closed window for a while, and a reused name inherits its scroll position.
- Fonts: the default font (ProggyClean) covers Latin-1 only, but the glossaries use “ ” – − … → ✕ △ ○. Load a TTF. Since 1.92 glyphs are loaded on demand when the renderer backend supports `ImGuiBackendFlags_RendererHasTextures` (all official backends do); with older versions add the glossary texts to the atlas with `ImFontGlyphRangesBuilder::AddText`.
- `PushFont(font)` with one argument is obsolete since 1.92; use `PushFont(font, size)` or draw with `ImDrawList::AddText(font, size, ...)`.
- `IsItemHovered()` is false for disabled widgets unless you pass `ImGuiHoveredFlags_AllowWhenDisabled`.
- Event-driven render loops that sleep until input stop the timers; render while `dt.WantsFrames()` is true.
- Dear ImGui's navigation also reacts to Esc (it clears the navigation cursor). That is harmless; what matters is that the host's `IsKeyPressed(ImGuiKey_Escape)` does not fire in the frame where DeepTip closed a window, hence the key lock.
- `io.WantCaptureMouse` is true while the pointer is over a DeepTip window; hosts that forward the mouse to a game must respect it, as usual with Dear ImGui.

## 16. Limitations

- No screen reader support: Dear ImGui exposes no accessibility tree (SPEC §6). No forced-colours mode and no system "reduced motion" query (an option instead).
- No vibration API; touch support depends on the backend reporting `ImGuiMouseSource_TouchScreen` (the Win32 and SDL backends do, GLFW has no touch).
- Only Esc and F6 are hidden from the host; F1 and "?" are read but stay visible to it.
- Placement stays inside one viewport unless the multi-viewport variant of section 7 is implemented.
- Auto-linking [§10] needs host texts that pass through `dt.Text`; plain `ImGui::Text` cannot be scanned.

[§1]: ../../docs/algorithms.md#1-data
[§2]: ../../docs/algorithms.md#2-markup-parser
[§3]: ../../docs/algorithms.md#3-rendering-the-ast
[§4]: ../../docs/algorithms.md#4-window-tree-and-invariants
[§5]: ../../docs/algorithms.md#5-hot-set-grace-tendency-suppression
[§6]: ../../docs/algorithms.md#6-arming-and-delays
[§7]: ../../docs/algorithms.md#7-timer-lock
[§8]: ../../docs/algorithms.md#8-placement
[§9]: ../../docs/algorithms.md#9-input
[§10]: ../../docs/algorithms.md#10-auto-linking-aliases
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
