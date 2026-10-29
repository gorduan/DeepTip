# DeepTip for GTK 4: build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a GTK 4 application, written in C (C11, GTK 4.10 or newer), with notes for Python (PyGObject) and Rust (gtk-rs).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for GTK 4. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with. No GTK toolchain was installed for this guide (it is too large for the test machine): statements marked *(checked)* were verified on 2026-10-29 by reading the GTK sources of the `main` branch (`gtkwidget.c`, `gtkwindow.c`, `gtkmain.c`, `gtkoverlay.c`, `gtkpopover.c`, `gtklabel.c`, `gtkaccessible.c`, `gtkgesturelongpress.c`), json-glib's `json-object.c` and GLib's `guniprop.c`, and by building and testing the Rust core named in section 11.2; nothing here was run in GTK. *(verify)* marks behaviour that only a running GTK can confirm.

## Quick start

**Recognise the project:** `dependency('gtk4')` in `meson.build` or `pkg_check_modules(… gtk4)` in CMake, `#include <gtk/gtk.h>` and `gtk_application_new()` in C; `gi.require_version("Gtk", "4.0")` in Python; `gtk4` (often `gtk = { package = "gtk4" }`) in `Cargo.toml`; `.ui` (GtkBuilder) or `.blp` (Blueprint) files.

1. Port `flatten`, `parseText` and `computePlacement` (C: section 11.1; Python: the PySide6 guide's core; Rust: the DeepTip crate's core, section 11.2) and pass the parity cases (section 13.1).
2. Build `glossary`, `engine` and the controller with its event controllers on the window (sections 3 and 7).
3. Build the view `DeepTipWindow` and the overlay layer (section 4).
4. Copy `glossary/core/<locale>.json` to `deeptip/core/` (or into a `GResource`); your own entries go to `deeptip/<locale>.json` (section 10).
5. Install DeepTip once per window, after the window has its application, and mark widgets (below).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/core/en.json deeptip/en.json`.

```c
static void
activate (GtkApplication *app, gpointer user_data)
{
  GtkWidget *window = gtk_application_window_new (app);     /* has its application: section 7.3 */
  GtkWidget *help = gtk_button_new_with_label ("?");
  deeptip_mark (help, "deeptip.about");                     /* g_object_set_data_full (…, "deeptip", key, g_free) */
  gtk_window_set_child (GTK_WINDOW (window), help);
  const char *sources[] = { "deeptip/core/{locale}.json", "deeptip/{locale}.json", NULL };
  deeptip_install (GTK_WINDOW (window), "en", sources);     /* wraps the child in the overlay, adds the controllers */
  gtk_window_present (GTK_WINDOW (window));
}
```

**Done when:** the parity test passes 24 of 24, resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest without triggering your application's `Escape` accelerator, the validator reports 0 errors.

## 1. Parts to build

| Part | Does | GTK types |
|---|---|---|
| `deeptip-core.{h,c}` | `flatten` ([§1.1](../../docs/algorithms.md#11-flattening-one-glossary-file)), `parse_text` ([§2](../../docs/algorithms.md#2-markup-parser)), `collect_refs`, `compute_placement` ([§8](../../docs/algorithms.md#8-placement)) | GLib, json-glib |
| `deeptip-glossary.{h,c}` | layers, locale chain, `entry(key)`, `label(name)`, live values, loading ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)) | GLib, json-glib |
| `deeptip-engine.{h,c}` | window tree, hot set, grace, tendency, arming, lock ([§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock)) against a host interface (function pointers) and a clock, unit-testable | GLib |
| `deeptip.{h,c}` | the controller: overlay, event controllers, timers, focus, public API `deeptip_install`, `deeptip_mark`, `deeptip_open`, `deeptip_close`, `deeptip_close_all`, `deeptip_pin`, `deeptip_unpin`, `deeptip_refresh`, `deeptip_set_locale` | GTK |
| `deeptip-window.{h,c}` | `DeepTipWindow`, a `GtkWidget` subclass: header, body, "See also", hint, lock bar | GTK |
| `deeptip.css` | the look (section 5) | GTK CSS |
| `tests/parity.c` | GLib test runner for `test/cases` | GLib |

## 2. SPEC concept → GTK primitive

| SPEC | GTK 4 |
|---|---|
| Controller | one per `GtkWindow`; its event controllers live on the window in the capture phase (section 7) |
| Top layer | a `GtkOverlay` that wraps the window's child; every DeepTip window is an overlay child (`gtk_overlay_add_overlay`), later ones on top; the signal `get-child-position` gives each its box *(checked: the signal fills an allocation relative to the main child)* |
| Alternative: `GtkPopover` | its own surface, may leave the window, but brings its own placement (flip and slide) and, with `autohide`, a keyboard grab (section 4.3) |
| Rich text | a `GtkLabel` with Pango markup and `<a href="…">` links (wrapping on), or a read-only `GtkTextView` with tags |
| Term (a real button) | a label link: hover → `gtk_label_get_current_uri()`, click and Enter → `activate-link`; keyboard focus moves between the links of a label (`gtk_label_focus`) *(checked in `gtklabel.c`)* |
| Marked UI element (`data-deeptip`) | `g_object_set_data_full (G_OBJECT (w), "deeptip", g_strdup (key), g_free)`; optional `"deeptip-delay"`, `"deeptip-place"`; in `.ui` files set them from code after loading |
| State hooks (`data-dt-open`, `data-dt-arming`) | CSS classes on the anchor: `gtk_widget_add_css_class (w, "dt-open")`, `"dt-arming"` |
| Element under the pointer | `gtk_widget_pick (GTK_WIDGET (window), x, y, GTK_PICK_DEFAULT)`, then `gtk_widget_get_parent()` up *(picking is allocation-based: checked in `gtkwidget.c`)* |
| Pointer | `GtkEventControllerMotion` on the window, capture phase (`motion`, `enter`, `leave`) |
| Clicks, long-press | `GtkGestureClick`, `GtkGestureLongPress` (timeout = the `gtk-long-press-time` setting × `delay-factor` *(checked)*) |
| Keyboard, consuming `Esc` | `GtkEventControllerKey` on the window, capture phase, added after the window got its application (section 7.3) |
| `now()`, `schedule()` | `g_get_monotonic_time () / 1000`; `g_timeout_add (ms, cb, data)` → source id, cancel with `g_source_remove (id)` |
| Coordinates | logical pixels in the overlay: `gtk_widget_compute_bounds (anchor, overlay, &rect)`; the viewport is the overlay's size |
| Screen reader | `GtkAccessible`: role `GTK_ACCESSIBLE_ROLE_TOOLTIP` / `GTK_ACCESSIBLE_ROLE_DIALOG`, properties `LABEL` and `DESCRIPTION`, relation `DESCRIBED_BY` on the anchor (section 8) |
| Theme (`--dt-*`) | GTK CSS on the classes of section 5, one `GtkCssProvider` for the display |

## 3. Data structures

```c
typedef struct _Tip Tip;
struct _Tip {                     /* window record, algorithms §4 */
  int        id;
  char      *key;
  Tip       *parent;
  GPtrArray *children;            /* Tip *, insertion order */
  GtkWidget *anchor;              /* marked widget (weak pointer) or the parent's body label */
  int        term;                /* term anchors: number of the link in the parent's body, else -1 */
  int        occurrence;          /* n-th term with this key in the parent (refresh, §4.6) */
  const char *via;                /* "hover", "click", "key", "touch", "pad", "api" */
  gboolean   pinned, frozen, closing;
  guint      close_timer;         /* GLib source id, 0 = none */
  graphene_rect_t rect;           /* last placed box, overlay coordinates */
  graphene_rect_t anchor_rect;    /* last box of the anchor (frozen roots, §4.5) */
  GtkWidget *view;                /* DeepTipWindow, an overlay child */
};
```

Keep a weak pointer to the anchor (`g_object_add_weak_pointer (G_OBJECT (anchor), (gpointer *) &tip->anchor)`): it becomes `NULL` when the host destroys the widget, which is the test of [§4.5](../../docs/algorithms.md#45-anchors-that-disappear). Controller state: `GPtrArray *wins` (oldest first), `GHashTable *hot` (set of `Tip *`), the hover triple (`Tip *win`, the term `(Tip *, int)`, `GtkWidget *trig`), the pending arm (`GtkWidget *el`, `guint timer`), a ring of pointer samples `(x, y, t)`, `quiet`, `lock_win`, `esc_down`, `esc_at`, `kbd`. The engine talks to GTK only through a struct of function pointers (open the view, place, close, focus, set classes), so it can be tested without a display.

## 4. Windows and terms

### 4.1 The overlay layer

```c
static gboolean
child_position (GtkOverlay *overlay, GtkWidget *widget, GdkRectangle *alloc, gpointer data)
{
  Tip *tip = g_object_get_data (G_OBJECT (widget), "deeptip-tip");
  if (tip == NULL)
    return FALSE;                                   /* not ours: the default handler places it */
  alloc->x = (int) tip->rect.origin.x;
  alloc->y = (int) tip->rect.origin.y;
  alloc->width = (int) tip->rect.size.width;
  alloc->height = (int) tip->rect.size.height;
  return TRUE;
}

/* deeptip_install(): wrap the window's child once */
GtkWidget *child = g_object_ref (gtk_window_get_child (window));
gtk_window_set_child (window, NULL);
GtkWidget *overlay = gtk_overlay_new ();
gtk_overlay_set_child (GTK_OVERLAY (overlay), child);
g_object_unref (child);
gtk_window_set_child (window, overlay);
g_signal_connect (overlay, "get-child-position", G_CALLBACK (child_position), dt);
```

Open: create the `DeepTipWindow`, `g_object_set_data (G_OBJECT (view), "deeptip-tip", tip)`, `gtk_overlay_add_overlay`, measure and place (section 6), `gtk_widget_queue_allocate (overlay)`. Close: `gtk_overlay_remove_overlay`. Raise an older window (F6): remove it (holding a reference) and add it again. Points outside every DeepTip window reach the application: GTK picks a widget only where its allocation contains the point, children first *(checked in `gtk_widget_pick`)*, so the empty part of the layer does not swallow clicks.

### 4.2 Terms in a `GtkLabel`

Render the AST ([§3](../../docs/algorithms.md#3-rendering-the-ast)) to Pango markup, escaping every glossary text with `g_markup_escape_text()` so glossary text never becomes markup:

| AST node | Markup |
|---|---|
| `text` | escaped text |
| `br` | `\n` |
| `b`, `i` | `<b>…</b>`, `<i>…</i>` |
| `code` | `<tt>…</tt>` (or `<span font_family="monospace" size="92%">`) |
| `var` | `<b>` + escaped value |
| link to the window's own key | `<b>` + label |
| link to a missing key | `<span underline="error" underline_color="#dd3333">` + label (Pango's wavy error underline) |
| term | `<a href="dt:N" class="dt-term">` + label; keep `keys[N]` beside the label |

One label per block, a list item as a box of a bullet label and a wrapping label (hanging indent); blocks in a vertical `GtkBox` with spacing 7. Labels: `gtk_label_set_wrap (TRUE)`, `gtk_label_set_xalign (0)`, `gtk_label_set_markup()`. GTK takes `href`, `title` and `class` from `<a>` and puts the class on the link's CSS node *(checked)*.

- **Click and Enter**: `g_signal_connect (label, "activate-link", G_CALLBACK (on_link), tip)`; the handler parses `N` from `dt:N`, calls `follow`, and **returns `TRUE`**, or GTK tries to open `dt:N` as a URI.
- **Hover**: `gtk_label_get_current_uri (label)` is the link under the pointer *(checked: documented in `gtklabel.c`)*. The label updates it in its own handlers, after DeepTip's capture-phase controller, so read it in a motion controller on the label itself (default bubble phase) and resolve the hover triple again from there *(verify the order)*.
- **Keyboard**: a label with links becomes focusable and `Tab` moves between its links (`gtk_label_ensure_select_info`, `gtk_label_focus` *(checked)*); `Enter` activates the focused link.
- **Term boxes**: `GtkLabel` exposes no link geometry. Anchor page terms to a small box around the pointer, or use the alternative:

**Alternative: `GtkTextView`** (read-only, `cursor-visible` off, wrap `GTK_WRAP_WORD_CHAR`): one tag per term with `g_object_set_data (tag, "deeptip-term", GINT_TO_POINTER (n + 1))`; hit-test with `gtk_text_view_window_to_buffer_coords (view, GTK_TEXT_WINDOW_WIDGET, x, y, &bx, &by)` and `gtk_text_view_get_iter_at_location (view, &iter, bx, by)` (it returns `FALSE` when the point is not over text), then `gtk_text_iter_get_tags()`; term boxes from `gtk_text_view_get_iter_location()` per character. This is the pattern of the `hypertext` demo in gtk4-demo. Terms are then not focusable by themselves (own focus index, as in the Swing guide).

### 4.3 Alternative: `GtkPopover`

A popover is its own surface (Wayland: an `xdg_popup`) and may extend beyond the window. For DeepTip: `gtk_popover_set_autohide (FALSE)` (an autohide popover grabs the keyboard and closes on outside clicks and `Esc` *(checked in its documentation comment)*), `gtk_popover_set_has_arrow (FALSE)`, parent it to the anchor (roots) or to the parent window's view (children) with `gtk_widget_set_parent`, and set the side from `computePlacement` with `gtk_popover_set_position` and the box with `gtk_popover_set_pointing_to`. GTK then flips on the main axis and slides on the other (`GDK_ANCHOR_FLIP_*`, `GDK_ANCHOR_SLIDE_*` in `gtkpopover.c` *(checked)*), which is close to, but not exactly, [§8](../../docs/algorithms.md#8-placement). Events in a popover propagate through its parent chain up to the window, but controllers with the default propagation limit (`GTK_LIMIT_SAME_NATIVE`) skip targets in another native: set `GTK_LIMIT_NONE` on DeepTip's window controllers, as GTK does for its own window controllers *(checked in `gtkmain.c` and `gtkwindow.c`)*. Prefer the overlay unless windows must leave the main window.

### 4.4 Window content (`DeepTipWindow`)

A `GtkWidget` subclass with a `GtkBoxLayout` (vertical) and CSS name `deeptip`: header box [title label (class `dt-title`, `hexpand`), fallback badge label (class `dt-badge`), pin `GtkToggleButton` and close `GtkButton` (class `flat`, 26 × 26, icons from the SVG paths `PIN_PATH` and `CLOSE_PATH` of `deeptip.js`, e.g. a `GtkPicture` of a `GdkTexture` made from the SVG, or a symbolic icon)], the body in a `GtkScrolledWindow` (`GTK_POLICY_NEVER` horizontally, `propagate-natural-height` on), the "See also" label, the hint label (class `dt-hint`, hidden when pinned), and a 2 px lock bar widget whose width follows the progress. Pin `toggled` → `pin`/`unpin`; close `clicked` → `close (tip, TRUE)`.

## 5. Look: the values of `deeptip.css`

```css
deeptip { background-color: #1b1e24; color: #e6e8ec; border: 1px solid #3b414d; border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); font-size: 14px; }
deeptip.dt-pinned { border-color: #58a6ff; }
deeptip .dt-header { padding: 6px 6px 2px 12px; }
deeptip .dt-body { padding: 0 12px 10px; }
deeptip label link { color: #6cb6ff; }
deeptip label link:hover { color: #9ccfff; }
deeptip label link:visited { color: #6cb6ff; }
deeptip .dt-hint { padding: 4px 12px 6px; font-size: 0.75em; opacity: 0.6; border-top: 1px solid #3b414d; }
deeptip.dt-flash { box-shadow: 0 0 0 3px #58a6ff, 0 10px 30px rgba(0, 0, 0, 0.3); }
```

Load it with `gtk_css_provider_load_from_string()` (GTK 4.12+; older: `…_from_data`) and `gtk_style_context_add_provider_for_display (display, provider, GTK_STYLE_PROVIDER_PRIORITY_APPLICATION)`. The light theme uses the light column:

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#1b1e24` |
| text | `#1f2328` | `#e6e8ec` |
| border, hint line | `#c8cdd5` | `#3b414d` |
| accent (pinned border, lock bar, flash, focus) | `#0b69d4` | `#58a6ff` |
| term | `#0b69d4` | `#6cb6ff` |
| term, hovered | `#084f9f` | `#9ccfff` |
| open term background | term colour at 16 % (`rgba(108,182,255,0.16)` dark) | same |
| button hover background | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.09)` |
| missing link underline | `#dd3333` | `#dd3333` |

Sizes: width 240–384 px, height at most 480 (the body scrolls), font 14 px, line height 1.5 (Pango: `gtk_label_set_attributes` with `pango_attr_line_height_new (1.5 * PANGO_SCALE)`, Pango 1.50+ *(verify)*), radius 8, border 1 px, buttons 26 × 26 with 15 px icons, badge 0.7 em, "See also" 0.9 em, hint 0.75 em at opacity 0.6, blocks 7 px apart, flash a 3 px accent ring for 0.6 s, lock bar 2 px over `lockAfter`. GTK CSS has no dotted underline; labels underline links themselves. Dark or light: follow the application's theme (`AdwStyleManager` with libadwaita, the `gtk-application-prefer-dark-theme` setting otherwise) *(verify for your GTK version)*.

## 6. Placement and coordinates

The overlay's coordinates are logical pixels with the origin top-left and y down: the space of [§8](../../docs/algorithms.md#8-placement). GTK 4 has no global screen coordinates (Wayland), so the viewport is the window's overlay; HiDPI and fractional scaling are handled by GDK and need no code.

1. Target box: a child uses its parent's `rect`; a root `gtk_widget_compute_bounds (anchor, overlay, &box)` (returns `FALSE` when the widgets share no ancestor); a page term in a `GtkTextView` its iter locations converted with `gtk_text_view_buffer_to_window_coords` and `gtk_widget_compute_point`.
2. Viewport: `gtk_widget_get_width (overlay)`, `gtk_widget_get_height (overlay)`.
3. Natural size: measure the plain text of the body with a Pango layout (`gtk_widget_create_pango_layout (label, text)`, `pango_layout_get_pixel_size`) for the unwrapped width, add 24 padding and 2 border, clamp to [240, 384] and to the viewport − 16; the height at that width: `gtk_widget_measure (view, GTK_ORIENTATION_VERTICAL, width, NULL, &natural_h, NULL, NULL)`, at most min(480, viewport − 16). A wrapping `GtkLabel` reports its natural width from `max-width-chars`, not from the text, so do not use the label's own natural width *(checked in the `gtklabel.c` documentation)*.
4. `compute_placement()`; when `maxW` or `maxH` is set, measure again with that width or height (the scrolled window scrolls) and compute once more with `[side]`.
5. Store the box in `tip->rect`, `gtk_widget_queue_allocate (overlay)`; `get-child-position` hands it out.
6. Re-place every window that is not frozen, parents before children: after pin and unpin, after `refresh()`, when the overlay's size changes (a `notify::default-width`/`default-height` on the window or a size check in a tick callback), and when an anchor moves (a `gtk_widget_add_tick_callback()` on the overlay while windows are open, comparing the anchor boxes).

## 7. Events: exact order of operations

All code runs in the GTK main loop (one thread).

### 7.1 Pointer

```c
GtkEventController *motion = gtk_event_controller_motion_new ();
gtk_event_controller_set_propagation_phase (motion, GTK_PHASE_CAPTURE);
gtk_event_controller_set_propagation_limit (motion, GTK_LIMIT_NONE);
g_signal_connect (motion, "motion", G_CALLBACK (on_motion), dt);      /* x, y relative to the window */
g_signal_connect (motion, "leave", G_CALLBACK (on_leave), dt);
gtk_widget_add_controller (GTK_WIDGET (window), motion);
```

GTK sets up its own resize-cursor controller on the window exactly like this *(checked in `gtkwindow.c`)*.

`on_motion (ctrl, x, y, dt)`:

1. add the sample `(x, y, now)` and trim ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)); the window's and the overlay's coordinates are the same when the overlay fills the window (otherwise translate with `gtk_widget_compute_point`);
2. `w = gtk_widget_pick (GTK_WIDGET (window), x, y, GTK_PICK_DEFAULT)`; walk up: the first widget with data `"deeptip-tip"` is `win`; the body label's current link (section 4.2) is `link`; when both are empty, the first widget with data `"deeptip"` is `trig`;
3. if the triple changed: "on pointer over" ([§6](../../docs/algorithms.md#6-arming-and-delays)): quiet, `refresh_hot()`, `lock_track()`, arm or disarm.

`on_leave`: the pointer left the window: hover `{}`, `disarm()`, `lock_track (NULL)`, `refresh_hot()`.

### 7.2 Clicks, touch

- A `GtkGestureClick` on the window in the capture phase (`gtk_gesture_single_set_button (…, 0)` for all buttons): `pressed` → "on pointer down" ([§9.2](../../docs/algorithms.md#92-pointer-down-touch)): hush, outside click (`gdk_device_get_source (gtk_gesture_get_device (…)) == GDK_SOURCE_TOUCHSCREEN` for touch); never claim the sequence, so the application's buttons keep their clicks.
- Clicks inside a preview that hit neither a link nor a button pin it (`clickInsidePins`): a `GtkGestureClick` on the `DeepTipWindow` (bubble phase; links and buttons handle their own clicks first).
- Terms: `activate-link` (section 4.2) → `follow (term, tip, focus = the activation came from the keyboard)`.
- Long-press: a `GtkGestureLongPress` with `gtk_gesture_single_set_touch_only (…, TRUE)` on each marked widget; `pressed` → open pinned (`via "touch"`); swallow the click that follows (the button sees the release otherwise) by claiming the sequence: `gtk_gesture_set_state (gesture, GTK_EVENT_SEQUENCE_CLAIMED)` *(verify)*. Its timeout is `gtk-long-press-time` × `delay-factor`; set the factor so it equals `longPress` *(checked: computed in `gtkgesturelongpress.c`)*.

### 7.3 Keyboard: consuming `Esc` before the application

```c
GtkEventController *keys = gtk_event_controller_key_new ();
gtk_event_controller_set_propagation_phase (keys, GTK_PHASE_CAPTURE);
gtk_event_controller_set_propagation_limit (keys, GTK_LIMIT_NONE);
g_signal_connect (keys, "key-pressed", G_CALLBACK (on_key_pressed), dt);   /* return TRUE = consumed */
g_signal_connect (keys, "key-released", G_CALLBACK (on_key_released), dt);
gtk_widget_add_controller (GTK_WIDGET (window), keys);                     /* after gtk_window_set_application() */
```

Why this order works *(checked in the GTK sources)*: a key event propagates from the window down to the focus widget, and the capture phase runs first, at the window. The window's own capture-phase controllers handle application accelerators (`gtk-application-shortcuts`, created in `gtk_window_set_application()`), the menu bar key and focus visibility. `gtk_widget_add_controller()` **prepends** to the widget's controller list and `gtk_widget_run_controllers()` walks that list from the front, stopping after the first non-gesture controller that handled the event. So a key controller added after the window got its application runs before all of them, and returning `TRUE` hides the key from accelerators, shortcuts and the focus widget. Shortcut controllers that widgets register on the window later (managed scope) would run before DeepTip's: re-add DeepTip's controller (`gtk_widget_remove_controller` + `gtk_widget_add_controller`) after the UI is built *(verify)*.

`on_key_pressed (ctrl, keyval, keycode, state, dt)` ([§9.3](../../docs/algorithms.md#93-keyboard)):

| Key | Steps |
|---|---|
| `GDK_KEY_Escape` | no windows → `FALSE`. `repeat = esc_down; esc_down = TRUE`. `state & GDK_SHIFT_MASK`, or `repeat` and `now − esc_at ≥ 600` → close all, focus back; else if not `repeat` → `esc_at = now`, close `newest (focus)` with focus back. Return `TRUE`. |
| `GDK_KEY_F6` with windows open | cycle (Shift: backwards); `TRUE` |
| `GDK_KEY_F1`, or `gdk_keyval_to_unicode (keyval) == '?'` while the focus is not a `GtkEditable` | focused term → `follow`; focused marked widget → open pinned with focus (`via "key"`); `TRUE` only when handled |
| printable, no `GDK_CONTROL_MASK` / `GDK_ALT_MASK` | `hush` (marked ancestor of `gtk_root_get_focus (GTK_ROOT (window))`); `FALSE` |

`on_key_released`: `GDK_KEY_Escape` → `esc_down = FALSE`; `TRUE` when the press was consumed. Whether a held key repeats `key-pressed` without `key-released` depends on the platform *(verify)*; the `esc_down` logic covers both.

### 7.4 Timers

| Timer | Started by | On fire |
|---|---|---|
| arm | `arm (el, kind, parent)` | `fire()` of [§6](../../docs/algorithms.md#6-arming-and-delays) (retries every 90 ms while heading away) |
| close | `leave (w)` | `tick()` of [§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression) (retries every 90 ms while heading towards `w`, at most 1.5 s) |
| lock | `lock_track (win)` with `lockAfter > 0` | `stop_lock(); pin (win)` ([§7](../../docs/algorithms.md#7-timer-lock)); a tick callback only draws the bar |
| flash | `flash (w)` | remove the class `dt-flash` after 700 ms ([§4.4](../../docs/algorithms.md#44-flashw)) |

`id = g_timeout_add (ms, cb, data)`; the callback sets its id to 0 and returns `G_SOURCE_REMOVE`; cancel with `g_clear_handle_id (&id, g_source_remove)`. Removing an id that already fired is a programmer error in GLib, so always clear ids. Animations (lock bar, flash) use `gtk_widget_add_tick_callback()`.

### 7.5 Focus

Opening by keyboard ([§9.5](../../docs/algorithms.md#95-focus)): `gtk_widget_grab_focus (body_label)` (the first link gets the focus), else the window; closing returns the focus to the anchor with `gtk_widget_grab_focus (anchor)` when `gtk_root_get_focus()` was inside the closed subtree (`gtk_widget_is_ancestor`).

### 7.6 Anchors that move or disappear

The weak anchor pointer turned `NULL`, or `!gtk_widget_get_mapped (anchor)`: previews close, a pinned root freezes at its last box ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)). Check in the tick callback of section 6 and on each pointer event.

## 8. Accessibility

- Window: `gtk_accessible_update_property (GTK_ACCESSIBLE (view), GTK_ACCESSIBLE_PROPERTY_LABEL, title, GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, plain_body, -1)`.
- **Roles cannot change after the accessible is realized**: `gtk_widget_set_accessible_role()` only works before that and logs a critical otherwise *(checked in `gtkwidget.c` and `gtkaccessible.c`)*. Create previews with `"accessible-role", GTK_ACCESSIBLE_ROLE_TOOLTIP` (`g_object_new`), and on pin move the content into a new `DeepTipWindow` created with `GTK_ACCESSIBLE_ROLE_DIALOG`.
- Root anchor while its window is open: `gtk_accessible_update_relation (GTK_ACCESSIBLE (anchor), GTK_ACCESSIBLE_RELATION_DESCRIBED_BY, view, NULL, -1)`; reset it on close (`gtk_accessible_reset_relation`).
- Label links are reachable with Tab (section 4.2); how screen readers announce them depends on the GTK version *(verify)*.

## 9. Live values, locales, refresh

`vars` as a `GHashTable` name → value, or one callback `char *(*) (const char *name, const char *key, gpointer data)`; `NULL` keeps `{name}` visible ([§1.2](../../docs/algorithms.md#12-layers-locales-lookup)). `deeptip_set_locale()` loads the missing files of the new chain, then `deeptip_refresh()` re-renders every window's labels, re-attaches children to the term with the same key and occurrence, re-places ([§4.6](../../docs/algorithms.md#46-refresh)). The language: `g_get_language_names()` (first entry, part before `_`) or the application's own setting.

## 10. Loading the glossary (JSON)

json-glib keeps the file order: an object stores its member names in insertion order, `json_object_get_members()` returns them in that order, and a duplicate name keeps its first position with the last value, as in JavaScript *(checked in `json-object.c`)*; iterate with `json_object_iter_init_ordered()` (json-glib 1.6+), not with `json_object_iter_init()`, which walks the hash table. Read files with `json_parser_load_from_file()` (UTF-8) or from a `GResource` (`g_resources_lookup_data`, then `json_parser_load_from_data`). `sources` are templates with `{locale}`, loaded per locale of the chain in template order (core first); a missing file is a warning.

## 11. Porting the pure functions

### 11.1 C with GLib

C strings are UTF-8, JavaScript strings UTF-16; the parser's output is the same as long as you walk the text by code points (`g_utf8_get_char`, `g_utf8_next_char`) and compare the syntax characters (`[ ] * \` { } | -`, all ASCII) bytewise. Differences to handle:

1. **Whitespace**: `g_unichar_isspace()` is tab, LF, CR, FF and the Unicode separator categories: without U+000B and U+FEFF, which JavaScript counts *(checked in `guniprop.c`)*; `g_strstrip()` is ASCII-only. Write `is_js_space (gunichar c)` (tab, LF, VT, FF, CR, space, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) and `js_trim`, and use them for the bullet test `^\s*[-•]\s+(.*)$` (the bullet `•` is three bytes in UTF-8), every trim and the emphasis checks.
2. **No regular expressions needed**: write the bullet test, `KEY_RE` (`[A-Za-z0-9_-]+` segments separated by single dots) and `VAR_RE` by hand. With `GRegex`, `$` also matches before a final newline unless `G_REGEX_DOLLAR_ENDONLY` is set.
3. **JavaScript's `.` stops at U+2028 and U+2029**: a line containing them after the bullet marker is a paragraph line.
4. **Paragraphs** split at `\n[ \t]*\n` (after `\r\n` and `\r` became `\n`).
5. **`findClose`** advances with `j++` after each skip; port it literally.
6. **Placement** in `double`; ties keep the first side; `x / 0` gives `inf` or `nan` as in JavaScript.
7. **Numbers in JSON**: json-glib keeps integers as `gint64` and fractions as `double`; read both as `double` for placement.

### 11.2 Python and Rust

- **PyGObject** (`gi.require_version("Gtk", "4.0")`): the pure Python core of the [PySide6 guide](../python-pyside6/README.md#the-pure-core-1-2-8) and its pytest runner apply unchanged; Python dicts keep the file order. The GTK calls map one to one (`Gtk.Overlay.add_overlay`, `Gtk.EventControllerKey.new()` with a `key-pressed` handler returning `True`, `GLib.timeout_add`, `GLib.source_remove`); how the `get-child-position` handler returns the rectangle from Python *(verify)*.
- **gtk-rs** (`gtk4` crate): use DeepTip's own Rust crate without egui: `deeptip = { git = "https://github.com/gorduan/DeepTip", tag = "v1.0.0", default-features = false }`. It brings the glossary, `parse_text`, `compute_placement` and the whole window tree with timers (`Engine`): feed it the pointer, hover and key events, and after every call schedule `glib::timeout_add_local_once` for the time `Engine::tick(now)` returns. *(checked: the crate's parity tests and its 25 engine tests pass with `cargo test --no-default-features`.)* Key handlers return `glib::Propagation::Stop` to consume *(verify the gtk-rs version)*.

## 12. GTK pitfalls

1. **Controller order is reverse adding order** on one widget (prepend + front-to-back run) *(checked)*: add DeepTip's window controllers after the window got its application.
2. **`activate-link` must return `TRUE`**, or GTK opens `dt:N` as a URI.
3. **`gtk_label_get_current_uri()` is updated by the label's own handlers**, after a capture-phase controller *(verify)*: read it in a controller on the label.
4. **A wrapping label's natural width comes from `max-width-chars`** *(checked)*: measure text width with Pango.
5. **Popovers with `autohide` grab the keyboard** and close on `Esc` *(checked)*; DeepTip popovers need `autohide` off.
6. **The default propagation limit skips other natives** (popovers) *(checked)*: `GTK_LIMIT_NONE` on window controllers.
7. **Roles are fixed once realized** *(checked)*: a new widget for the pinned dialog role.
8. **No screen coordinates** on Wayland: everything is relative to the window; DeepTip windows in the overlay cannot leave it.
9. **Escape glossary text** with `g_markup_escape_text()`; a stray `&` or `<` in a glossary otherwise makes `gtk_label_set_markup()` fail.
10. **GLib source ids**: never remove an id twice; clear ids when sources fire.

## 13. Testing

### 13.1 Parity cases

```c
/* tests/parity.c — DEEPTIP_CASES=<DeepTip>/test/cases meson test */
static void
test_markup (gconstpointer data)
{
  JsonObject *c = (JsonObject *) data;
  JsonNode *got = deeptip_ast_to_json (deeptip_parse_text (json_object_get_string_member (c, "src")));
  g_assert_true (same (got, json_object_get_member (c, "blocks")));   /* objects by member set, numbers as double */
  json_node_unref (got);
}

int
main (int argc, char **argv)
{
  g_test_init (&argc, &argv, NULL);
  /* for each case of markup.json: g_test_add_data_func ("/markup/<name>", case_object, test_markup);
     placement.json: compute_placement (size, anchor, sides, viewport, 8) == expect;
     glossary.json: {keys, meta, problems} of flatten (input) */
  return g_test_run ();
}
```

`same()` compares objects by member set (the AST's member order may differ from the file's), arrays by index, numbers as `double`, and keeps `"text": null` distinct from a missing member. Expected: 24 tests passed. PyGObject: the PySide6 guide's pytest runner. gtk-rs: the DeepTip crate's `cargo test`.

### 13.2 Behaviour

- Engine tests with a fake clock and host (as in the [Swing guide](../java-swing/README.md#112-behaviour)).
- GTK parts: `GDK_BACKEND=broadway` or a virtual X server (`xvfb-run`) runs the application without a visible screen; drive it with GTK's test utilities or by calling the controller's handlers with synthetic coordinates *(verify the setup)*.

### 13.3 By hand

Compare with the web example (`npm run demo`, `frameworks/web/example`): the same keys, the same glossary, the same reactions ([§11](../../docs/algorithms.md#11-testing-with-testcases)).

## 14. The example to build

The same screen as `frameworks/web/example`: a `GtkApplicationWindow` with a header bar of buttons marked `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`, then `refresh()`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), `?` marked `deeptip.about` with delay 0, a language `GtkDropDown` (`de`, `en`) calling `deeptip_set_locale()`; four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the edges (overlays with `halign`/`valign` start/end); a page text with terms, settings (delay, lock, buttons, hints) and the encyclopedia ([§12](../../docs/algorithms.md#12-encyclopedia): a `GtkSearchEntry` and a `GtkListBox`). Options: `sources = { "../../glossary/core/{locale}.json", "../../glossary/example/{locale}.json" }` (the download zip keeps the repository layout), fallback `de`, `en`, delay 1000; in English *Prestige* and *Gold* come from the German fallback and show the `DE` badge.

## 15. Limitations compared with the web reference

- **Gamepad** ([§9.4](../../docs/algorithms.md#94-gamepad)): no GTK API; libmanette is the GNOME library for game controllers *(verify)*.
- **Vibration**: none.
- **Reduced motion**: follow the `gtk-enable-animations` setting.
- **Windows stay inside the application window** with the overlay; popovers can leave it but place themselves (section 4.3).
- **Term geometry** in `GtkLabel` is not available (section 4.2).
- **Not run in GTK**: this guide was checked against the sources, not in a running GTK (see the introduction).

## 16. Checklist

1. Core (C port, Python core or the Rust crate) and 24 of 24 parity cases (sections 11, 13.1).
2. Glossary with json-glib's ordered members, layers, chain, `$ui` labels, live values; validate the same files with `tools/deeptip-check.mjs`.
3. Engine with fake clock and host, tested.
4. Overlay with `get-child-position`, `DeepTipWindow`, the window controllers of section 7 (capture phase, `GTK_LIMIT_NONE`, added after the application).
5. Accessibility, CSS, the example; compare with the web example by hand; then list the framework with its state in the main README.
