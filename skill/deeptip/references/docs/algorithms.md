# DeepTip algorithms

The exact algorithms of the reference runtime (`frameworks/web/deeptip.js`, version 1.0.0), written language-neutrally so DeepTip can be rebuilt in any language and toolkit. [SPEC.md](../SPEC.md) is the normative contract; this document is how the reference fulfils it, step by step. Every framework guide in `frameworks/<name>/README.md` maps these steps to its toolkit and links the sections below.

Pseudo-code conventions: `now()` is a monotonic clock in milliseconds; `schedule(ms, f)` runs `f` once after `ms` and returns a handle `cancel()` accepts; lists keep insertion order; "window" means a DeepTip window, "element" a UI element of the host application.

## Constants and defaults

| Name | Value | Meaning |
|---|---|---|
| `KEY_RE` | `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$` | valid glossary key |
| `ESCAPABLE` | `\ * ` `` ` `` ` [ ] { } \|` | characters a backslash makes literal |
| `VAR_RE` | `^\{([A-Za-z_][A-Za-z0-9_]*)\}` | live value, tested on at most 64 characters |
| `TENDENCY_MAX` | 1500 ms | longest extra time a window or an armed term waits while the pointer heads towards a window |
| `HOLD` | 600 ms | holding Esc or gamepad B this long closes every window |
| `MOVE_TOL` | 10 px | a long-press may drift this far |
| `SWIPE` | 60 px | downward swipe on a title bar that closes every window |
| `SAMPLE_WINDOW` | 120 ms | pointer history used for the tendency |
| `SAMPLE_STALE` | 80 ms | no tendency when the last pointer move is older |
| `MIN_MOVE` | 3 px | no tendency for smaller movements |
| `TENDENCY_PAD` | 12 px | the target box is enlarged by this much |
| `RETRY` | 90 ms | re-check interval while the pointer still heads somewhere |
| `FLASH` | 700 ms | a window flashes this long |
| `GAP` | 8 px | distance between a window and its anchor, and to the viewport edge |
| `MIN_SHRINK` | 120 px | a window is only shrunk into a side with at least this much room |
| `MIN_W` | 240 px (15rem) | narrowest window (`--dt-min-width`), never wider than the viewport minus 2·`GAP` |
| `MAX_W` | 384 px (24rem) | widest window (`--dt-max-width`), never wider than the viewport minus 2·`GAP` |
| `MAX_H` | 480 px (30rem) | tallest window (`--dt-max-height`), never taller than the viewport minus 2·`GAP`; longer content scrolls |

Options and defaults (SPEC §7): `delay` 800, `linkDelay` 80, `closeDelay` 300, `lockAfter` 0 (off), `longPress` 500, `closeButtons` true, `pinButton` true, `hints` true, `clickInsidePins` true, `outsideClickCloses` "touch" ("never" | "touch" | "always"), `root` [bottom, top, right, left], `child` [left, right, top, bottom], `locale` "en", `fallback` ["en"], `sources` [], `vars` none, `openKeys` [F1, ?], `gamepad` true, `vibrate` true, callbacks `onOpen(key, view)`, `onClose(key)`, `onPin(key, view)`.

## §1 Data

### 1.1 Flattening one glossary file

```
flatten(object):
  entries = ordered map, meta = map, problems = list
  walk(node, prefix):
    for (k, v) in node, in file order:
      if k starts with "$":
        if prefix is empty: meta[k] = v          # $schema, $locale, $ui, $comment
        continue
      key = prefix empty ? k : prefix + "." + k
      if v is an object (not an array, not null):
        if v.title or v.short or v.body is a string:
          if key does not match KEY_RE: problems.add(key, "invalid key")
          entries[key] = v                        # added even with an invalid key (the validator reports it)
        else: walk(v, key)                        # nested i18next style
      else: problems.add(key, "not an entry object")
  if object is a JSON object: walk(object, "") else problems.add("(file)", "a glossary file must be a JSON object")
  return entries, meta, problems
```

"File order" is the order of the keys in the file, with one exception in the reference: JavaScript objects list keys that are array indices (digits only, "0" to "4294967294") first, in ascending numeric order. Other languages keep the file order. Glossaries should therefore avoid digit-only key parts, so every runtime sees the same order (the validator accepts them, `KEY_RE`).

### 1.2 Layers, locales, lookup

- `data[locale]` is a map key → entry; `add(locale, file)` flattens the file and sets every entry into `data[locale]` (a later call wins per key). `$ui` of the file is merged into `labels[locale]` (later wins per label). After `add`, open windows are re-rendered (§4.6).
- The locale of a file: its `$locale`, else its file name (`de.json`, `myapp.de.json`, `en-US.json`), else the caller's argument.
- **Chain** = `unique([locale] + fallback)`.
- **Loading** (`sources`, URL templates with `{locale}`): for each locale of the chain, for each template in order, fetch the URL once (remember fetched URLs); when all have arrived, `add` them in exactly that order (template order = layer order: core first, project after). A failed fetch is a warning, not an error.
- `entry(key)`: the first locale of the chain whose map has the key → `(entry, locale)`; else none. The **whole entry** comes from that locale, fields are never mixed.
- `label(name)`: for each locale of the chain: `labels[locale][name]`, else the built-in label of the locale's language (`de-AT` → `de`); finally the built-in English label, else the name itself.

Built-in labels:

| name | en | de |
|---|---|---|
| close | Close | Schließen |
| pin | Pin | Festhalten |
| unpin | Unpin | Loslassen |
| missing | No explanation for this term yet. | Zu diesem Begriff gibt es noch keine Erklärung. |
| fallback | Not translated yet | Noch nicht übersetzt |
| hint | Click to pin · Esc closes | Klick hält fest · Esc schließt |
| seeAlso | See also: | Siehe auch: |
| search | Search terms … | Begriffe suchen … |
| mentionedIn | Mentioned in | Erwähnt in |
| empty | No matches. | Keine Treffer. |

- **Live values** (`vars`): either a map name → value-or-function, or one function `(name, key) → value`; a function value is called with the window's key. `null`/missing → the text `{name}` stays visible.
- **Missing entry**: title = the key, text = `label("missing")`, one warning per key (never repeat a warning).

## §2 Markup parser

Output: a list of blocks. Block = `{type:"p", c:[inline]}` or `{type:"ul", items:[[inline]]}`. Inline = `{t:"text",v}`, `{t:"br"}`, `{t:"b",c:[inline]}`, `{t:"i",c:[inline]}`, `{t:"code",v}`, `{t:"link",key,text}` (text is null when not given), `{t:"var",name}`. These shapes are exactly what `test/cases/markup.json` contains.

```
parseText(src):
  src = string(src or ""), replace "\r\n" and "\r" by "\n"
  blocks = []
  for chunk in split(src, regex "\n[ \t]*\n"):          # blank line (spaces/tabs allowed) = new paragraph
    para = [], list = none
    for line in split(chunk, "\n"):
      m = match(line, regex "^\s*[-•]\s+(.*)$")
      if m:
        if para not empty: blocks.add({p, parseInline(join(para, "\n"), 0)}); para = []
        if list is none: list = {ul, items: []}; blocks.add(list)
        list.items.add(parseInline(m[1], 0))
      else if trim(line) not empty:
        list = none
        para.add(trim(line))
    if para not empty: blocks.add({p, parseInline(join(para, "\n"), 0)})
  return blocks

parseInline(s, depth):
  out = [], buf = ""
  flush(): if buf not empty: out.add({text, buf}); buf = ""
  i = 0
  while i < len(s):
    c = s[i]
    if c == "\\" and i+1 < len(s) and s[i+1] in ESCAPABLE: buf += s[i+1]; i += 2; continue
    if c == "\n": flush(); out.add({br}); i += 1; continue
    if c == "[" and s[i+1] == "[":
      end = indexOf(s, "]]", i+2)
      if end > 0:
        inner = s[i+2 .. end), bar = indexOf(inner, "|")
        key = trim(bar < 0 ? inner : inner[0 .. bar))
        if key matches KEY_RE:
          flush(); text = bar < 0 ? null : (trim(inner[bar+1 ..]) or null)
          out.add({link, key, text}); i = end + 2; continue
    if c == "`":
      end = indexOf(s, "`", i+1)
      if end > i+1: flush(); out.add({code, s[i+1 .. end)}); i = end + 1; continue
    if c == "*" and depth < 3:
      mark = s[i+1] == "*" ? "**" : "*"
      from = i + len(mark)
      if from < len(s) and s[from] is not whitespace:
        end = findClose(s, from, mark)
        if end > 0:
          flush(); out.add({mark == "**" ? b : i, c: parseInline(s[from .. end), depth+1)})
          i = end + len(mark); continue
    if c == "{":
      m = match(s[i .. i+64), VAR_RE)
      if m: flush(); out.add({var, m[1]}); i += len(m[0]); continue
    buf += c; i += 1
  flush(); return out

findClose(s, from, mark):
  j = from
  while j < len(s):
    if s[j] == "\\": j += 2; continue
    if s[j] == "`": e = indexOf(s, "`", j+1); if e > j: j = e + 1; continue
    if s starts with "[[" at j: e = indexOf(s, "]]", j+2); if e > j: j = e + 2; continue
    if mark == "*" and s starts with "**" at j: e = findClose(s, j+2, "**"); if e > 0: j = e + 2; continue
    if s starts with mark at j and j > from and s[j-1] is not whitespace: return j
    j += 1
  return -1
```

(The reference loop advances with `j++` after each skip; the pseudo-code above shows the resulting positions.)

`collectRefs(text)`: walk the blocks and return every `link.key` and every `var.name` in order (the validator and the encyclopedia use it).

## §3 Rendering the AST

| Node | Rendering |
|---|---|
| p | a paragraph; blocks are separated like paragraphs (one empty line) |
| ul | a bullet list, one item per entry |
| text | plain text, escaped for the toolkit (glossary text is never markup of the toolkit) |
| br | a line break |
| b, i | strong, emphasis (may nest) |
| code | inline code style |
| var | the live value (§1.2) in a value style |
| link | see below |

Link rendering, in this order:
1. `key == key of the window being rendered` → the label in **bold**, not interactive.
2. no entry for `key` in the chain → the label marked as missing (dimmed), not interactive, one warning.
3. otherwise an interactive **term** carrying `key` (a real button, focusable, reachable with Tab), label = `text` or the target's `title` or the key.

Window content, in this order: header (title of the entry or the key; a badge with the source locale in upper case when the entry came from a fallback locale, its tooltip `label("fallback")`; pin button if `pinButton`; close button if `closeButtons`), body (`body`, else `short`, else `label("missing")`), "See also" line when the entry has `see` (`label("seeAlso")` then one term per key, comma separated), hint line `label("hint")` when `hints` and the window is not pinned. The pin button shows `label("pin")` or `label("unpin")` and reflects the state.

## §4 Window tree and invariants

A window record: `id`, `key`, `parent` (window or none), `anchor` (element or term), `children` (set), `pinned`, `closeTimer`, `via` ("hover", "click", "key", "touch", "pad", "api"), `rect` (last measured box), `frozen`.

### 4.1 open(key, anchor, parent = none, pinned = false, focus = false)

```
if key missing or anchor missing/detached or (parent and parent not open): return none
same = open window whose anchor == anchor
if same: if pinned: pin(same); if focus: focusWindow(same); return same            # invariant 5
for x = parent; x; x = x.parent:
  if x.key == key: flash(x); if focus: focusWindow(x); return x                     # invariant 4
for w in windows where w.parent == parent and not w.pinned: close(w)                # invariant 1
w = new window(id = ++seq, key, parent, anchor, via)
build view; add to the top layer; windows.add(w); parent?.children.add(w)
mark anchor as open (web: data-dt-open)
if pinned: pin(w) else setState(w)                 # pinned windows have no hint line, so pin before placing
place(w)                                           # §8
describe(anchor ↔ body) for assistive technology (roots only)
if focus: focusWindow(w)
refreshHot()                                       # §5
onOpen(key, view)
return w
```

### 4.2 close(w, focusBack = false)

```
if w not open: return
hadFocus = focus is inside w or any of its descendants
for c in copy(w.children): close(c)                # invariant 3: the whole subtree
cancel(w.closeTimer); if lockWindow == w: stopLock()
windows.remove(w); w.parent?.children.remove(w); hot.remove(w)
unmark anchor; remove description; remove view (after its closing animation, if any)
if focusBack and hadFocus and anchor still exists: focus(anchor)
onClose(w.key)
```

`closeAll()`: close every window without a parent.

### 4.3 pin(w) and unpin(w)

```
pin(w):   for x = w; x and not x.pinned; x = x.parent:      # invariant 2: the chain above is pinned too
            x.pinned = true; cancel(x.closeTimer); setState(x); onPin(x.key, view)
          if lockWindow and lockWindow.pinned: stopLock()
unpin(w): set pinned = false on w and every descendant, update their state; refreshHot()
```

`setState(w)`: pinned windows are dialogs (non-modal), previews are tooltips; the pin button's label and pressed state follow; pinned windows show their frame in the pinned color and no hint line.

### 4.4 flash(w)

Restart a short highlight of the window for `FLASH` ms (no animation with reduced motion; the reference toggles a CSS class).

### 4.5 Anchors that disappear

When the host removes an anchor element (re-render): unpinned windows on it close; a pinned **root** window freezes at its last measured box (`frozen = true`) and is no longer re-placed. Children keep their parent as reference.

### 4.6 refresh()

Re-render the content of every open window (language switched, live values or glossary changed); for each child, re-attach its anchor to the term of the same key in the re-rendered parent; then re-place every window that is not frozen; re-render every encyclopedia (§12).

## §5 Hot set, grace, tendency, suppression

Hover state `{win, link, trig}`: `win` = the window under the pointer; `link` = the term under the pointer (inside a window, or on a page rendered with `renderText`); `trig` = the marked element under the pointer, only when the pointer is neither inside a window nor on a term.

```
refreshHot():
  hot = {}
  for x = hover.win; x; x = x.parent: hot.add(x)
  a = hover.link or hover.trig
  if a: for w in windows where w.anchor == a: for x = w; x; x = x.parent: hot.add(x)
  for w in windows where not w.pinned:
    if w in hot: cancel(w.closeTimer); w.closeTimer = none
    else: leave(w)

leave(w):
  if w.closeTimer: return
  since = now()
  tick():
    w.closeTimer = none
    if w.pinned or w not open or w in hot: return
    if now() - since < TENDENCY_MAX and heading(w): w.closeTimer = schedule(RETRY, tick); return
    close(w)
  w.closeTimer = schedule(closeDelay, tick)
```

Pointer samples (mouse and pen only): on every pointer move, append `{x, y, t: now()}`; then remove the oldest sample while there are more than 2 and the oldest is older than `SAMPLE_WINDOW`.

```
heading(w):                                    # mouse tendency (Europa Universalis V)
  if samples < 2 or now() - last.t > SAMPLE_STALE: return false
  v = last - first                             # direction of the recent movement
  if length(v) < MIN_MOVE: return false
  r = box of w, enlarged by TENDENCY_PAD on every side
  t0 = 0, t1 = +infinity                       # ray from the last point: last + t·v, t ≥ 0
  for axis in (x, y):
    if |v.axis| < 1e-9:
      if last.axis < r.min(axis) or last.axis > r.max(axis): return false
      continue
    ta = (r.min(axis) - last.axis) / v.axis, tb = (r.max(axis) - last.axis) / v.axis
    if ta > tb: swap
    t0 = max(t0, ta), t1 = min(t1, tb)
    if t0 > t1: return false
  return true

headingAway(parent):                           # suppression (the Victoria 3 problem)
  return any unpinned window w that is not parent or an ancestor of parent, with heading(w)
```

Use the same coordinate system (y down, viewport pixels) for samples and boxes.

## §6 Arming and delays

```
on pointer over (not touch):
  win = window under pointer, link = term under pointer (ignored inside a window that is closing)
  trig = (not win and not link) ? marked element under pointer : none
  hover = {win, link, trig}
  if quiet and quiet != trig: quiet = none
  refreshHot()
  lockTrack(win if win and not win.pinned else none)          # §7
  if link (and its window is open, or it is on a page): arm(link, "link", win)
  else if trig: arm(trig, "trig", none)
  else: disarm()

on pointer leaving the application surface (not touch): hover = {}; disarm(); lockTrack(none); refreshHot()

arm(el, kind, parent):
  if pending and pending.el == el: return
  disarm()
  if quiet == el: return                      # the element is being used, not asked about
  if an open window has anchor el: return
  key = kind == "link" ? term key of el : element key of el
  delay = kind == "link" ? linkDelay : (element's own delay if set, else delay)
  since = now()
  fire():
    if not pending or pending.el != el: return
    if now() - since < delay + TENDENCY_MAX and headingAway(parent): pending.timer = schedule(RETRY, fire); return
    disarm(); open(key, el, parent, via = "hover")
  pending = {el, timer: schedule(max(0, delay), fire)}
  if kind == "trig": show the rest progress on el (duration = delay)

disarm(): cancel pending.timer; remove the rest progress; pending = none

hush(trig):                                   # pointer down on a marked element (not touch), or typing a printable key into it
  if trig: quiet = trig; if pending and pending.el == trig: disarm()
```

## §7 Timer lock

Only when `lockAfter > 0`. `lockTrack(win)`: if `win` differs from the current lock window, stop the old progress and start a progress bar of `lockAfter` ms on `win` (none = stop). When the bar completes while it is still the lock window: `stopLock(); pin(win)`. Moving into another unpinned window restarts it; pinned windows never lock.

## §8 Placement

```
computePlacement(size {w,h}, a {left,top,right,bottom}, sides, vp {w,h}, gap = GAP):
  horiz(s) = s in {left, right}
  room = { left: a.left - 2·gap, right: vp.w - a.right - 2·gap, top: a.top - 2·gap, bottom: vp.h - a.bottom - 2·gap }
  need(s) = horiz(s) ? size.w : size.h
  order = sides filtered to {left, right, top, bottom}; if empty: [bottom]
  side = first s in order with room[s] ≥ need(s); fits = side exists
  maxW = 0, maxH = 0
  if not fits:
    side = the s in order with the largest room[s] / need(s) (first one wins ties)
    if room[side] ≥ MIN_SHRINK: (horiz(side) ? maxW : maxH) = room[side]
  w = maxW ? min(size.w, maxW) : size.w
  h = maxH ? min(size.h, maxH) : size.h
  clamp(v, lo, hi) = max(lo, min(v, max(lo, hi)))
  if horiz(side): x = side == left ? a.left - gap - w : a.right + gap;  y = a.top + (a.bottom - a.top)/2 - h/2
  else:           y = side == top ? a.top - gap - h : a.bottom + gap;    x = a.left + (a.right - a.left)/2 - w/2
  x = clamp(x, gap, vp.w - gap - w); y = clamp(y, gap, vp.h - gap - h)
  return {side, x, y, fits, maxW, maxH}
```

Placing a window:
1. Target box = the parent window's box for children, the anchor's box for roots (all in viewport pixels, y down).
2. Sides = the element's own order (roots only, e.g. `data-deeptip-place`), else `child` for children, `root` for roots.
3. Measure the window's natural size within its size limits first: width between min(`MIN_W`, vp.w − 2·`GAP`) and min(`MAX_W`, vp.w − 2·`GAP`), height at most min(`MAX_H`, vp.h − 2·`GAP`) (the reference does this with CSS `min-width`, `max-width`, `max-height`; without it a long entry runs past the viewport edge). Then compute; if `maxW` or `maxH` is set, limit the window to it (it scrolls inside), measure again and compute once more with `[side]` only.
4. Put the window's top-left corner at `(x, y)`. Remember its box.
5. Re-place non-frozen windows when the viewport resizes, the page scrolls or a window's content changes size.

Because the window is placed beside the box it came from, a child never covers its parent; it may cover older windows. Toolkits with y-up coordinates, DPI scaling or scaled canvases convert into viewport pixels (y down) before computing and back afterwards.

## §9 Input

### 9.1 Clicks

```
on click (target t):
  if a long-press just opened a window on this element (swallow, ≤ 1.5 s): consume, return
  win = window containing t (ignore windows that are closing)
  if t is the close button of win: close(win, focusBack = true); return
  if t is the pin button of win: win.pinned ? unpin(win) : pin(win); return
  if t is a term: follow(term, win, focus = click came from the keyboard); return
  if win and clickInsidePins and not win.pinned: pin(win)

follow(term, parent, focus):
  disarm()
  if parent: pin(parent)
  open = window whose anchor == term
  if open: pin(open); if focus: focusWindow(open); return open
  return open(term key, term, parent, pinned = true, focus, via = "click")
```

A normal click on a marked element is never consumed by DeepTip (it belongs to the application).

### 9.2 Pointer down, touch

```
on pointer down (target t):
  win = window containing t
  if not win and pointer is not touch: hush(marked element containing t)
  if not win:
    if windows exist and (outsideClickCloses == "always" or (== "touch" and pointer is touch)): closeAll()
    if pointer is touch and t is not a term and t is inside a marked element: pressStart(element)
  else if pointer is touch and t is in win's header but not a button: swipe = {pointer id, x, y}

pressStart(el): after longPress ms → pressEnd(); vibrate 15 ms (if vibrate); swallow = {el, until: now()+1500};
                open(key of el, el, pinned = true, via = "touch")
                show the rest progress on el; cancel (pressEnd) when the pointer moves more than MOVE_TOL or is released
on pointer up: end a press of that pointer;
               a swipe of that pointer with dy > SWIPE and |dx| < SWIPE closes every window
on context menu: suppress it while a press runs on the element or while its swallow is active
```

### 9.3 Keyboard

```
on key down (target t = focused element), handled before the application sees it:
  Escape:
    if no windows: let it pass
    if Shift or (auto-repeat and held ≥ HOLD): closeAll(), focus the anchor of the root that contained the focus
    else if not auto-repeat: close(newest(t), focusBack = true)
    consume the key
  F6 (Shift+F6) with windows open: consume; move focus to the next older (newer) window, cycling
  key in openKeys (F1, "?"):
    "?" inside a text input does nothing
    t is a term: consume; follow(term, its window, focus = true)
    t is a marked element outside windows: consume; open it pinned with focus (via "key")
  printable character without Ctrl/Meta/Alt typed into a marked element: hush(element)

newest(t): the newest window opened from the window containing t (its descendants, newest first),
           else that window itself, else the newest window overall
```

Applications that also react to Esc (closing a menu) must not see the Esc that closed a window. Implementations without an event capture phase consume Esc in the earliest handler they get, or filter the application's key query while a window was closed in the same frame.

### 9.4 Gamepad

Polled every frame while a gamepad is connected and the application has focus. Buttons: 0 A, 1 B, 3 Y, 4 LB, 5 RB, 12–15 d-pad up/down/left/right; the left stick beyond ±0.6 counts as the d-pad. Act on presses (pressed now, not in the previous frame):
- B: remember the press time; held ≥ `HOLD` → close every window (focus back to the root's anchor); released earlier → close `newest(focused)` with focus back.
- Y: on a focused term → `follow(term, its window, focus)`; on a focused marked element outside windows → open it pinned with focus (via "pad").
- A: inside a window, activate the focused term or button.
- LB / RB: focus the newer / older window (cycling).
- d-pad / stick inside a window: move the focus through its terms and buttons (wrapping).

### 9.5 Focus

Opening by keyboard or gamepad focuses the window's first term (else the window itself). Closing returns the focus to the anchor if it was inside the closed subtree.

## §10 Auto-linking (aliases)

Optional: runtimes whose host texts come from elsewhere (a game's own tooltips) highlight terms automatically. The web runtime uses `aliases` only for search. The Valheim runtime does this:

1. Index: for every entry of the current chain, every alias with at least 3 characters (trimmed) maps to its key; the first entry that claims an alias keeps it; comparison is case-insensitive.
2. One pattern: all aliases, escaped, longest first, joined with `|`, wrapped in whole-word guards: not preceded and not followed by a letter, digit or `_` (Unicode-aware), case-insensitive.
3. Process a host text: split it into the toolkit's tags and plain text; never change tags, text inside existing links, or text the toolkit marks as literal (e.g. TextMeshPro `<noparse>`). In plain text, first replace explicit `[[key]]` / `[[key|text]]` markup by terms, then replace the **first** occurrence of each key's aliases by a term with the matched text as label; a key already linked in this text (explicitly or before) is not linked again; never link the key of the window that shows the text.

## §11 Testing with test/cases

Every implementation with its own parser, placement or glossary loading runs the shared cases and must produce identical results:

| File | For each case |
|---|---|
| `test/cases/markup.json` | `parseText(src)` equals `blocks` (the AST shapes of §2, `text` null when absent) |
| `test/cases/placement.json` | `computePlacement(size, anchor, sides, viewport)` with gap 8 equals `expect` `{side, x, y, fits, maxW, maxH}` |
| `test/cases/glossary.json` | `flatten(input)` gives `expect.keys` (entry keys in order), `expect.meta` (metadata keys), `expect.problems` (number of problems) |

Compare numbers exactly (the cases contain values that are exact in binary floating point). The cases are generated from the reference with `npm run cases`; regenerate them only after a deliberate behaviour change, and update every implementation.

Behaviour that the cases cannot cover (timers, pointer, focus) is checked against the reference by hand: open the web example (`npm run demo`) and compare.

## §12 Encyclopedia

```
renderIndex(container, search = true):
  keys = every key of every locale in the chain
  rows = keys mapped to entry(key), sorted by title (locale-aware, case- and accent-insensitive)
  backlinks: for each row k: refs = collectRefs(short + "\n\n" + body).links + see; for each ref r != k: back[r].add(k)
  render: optional search field (placeholder label("search")), then one item per row:
          the term (title), the short line rendered as markup, and "label(mentionedIn): " + the backlinks as terms
  filter on input: query = lower(trim(text)); an item is visible when lower(title + key + aliases + short) contains it;
          show label("empty") when nothing is visible
  keep the query when the index re-renders (refresh)
```
