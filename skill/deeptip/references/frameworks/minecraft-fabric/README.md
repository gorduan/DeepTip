# DeepTip for Minecraft (Fabric)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, as a client-side Fabric mod for Minecraft: Java Edition, in Java. Minecraft is a finished game with its own tooltips, like Valheim in the [Valheim guide](../valheim/README.md): DeepTip adds windows to screens and the HUD, and can adopt the vanilla item tooltip as the first window. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the Java implementation is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md).

**Versions (2026-10-29):** Minecraft **26.3** (latest stable release), Fabric Loader 0.20.1, Fabric API **0.165.0+26.3**, Loom 1.17 or newer with the plugin `net.fabricmc.fabric-loom`, Java 25 (Fabric meta and maven, Fabric blog). Since 26.1 the game is no longer obfuscated: its code uses Mojang's official names, Yarn is no longer supported by Fabric, and Fabric API renamed its own API to the official names (Fabric blog, "Fabric for Minecraft 26.1"). This guide uses those names. Three changes matter here: GUI drawing is an *extract* phase with `GuiGraphicsExtractor` (26.3), the current screen lives in `Minecraft.getInstance().gui` (26.2), and SDL replaced GLFW for windows and input, so key and mouse constants come from `InputConstants` (26.3).

Statements marked (checked) were verified on 2026-10-29 against the sources of the Fabric API 0.165.0+26.3 modules `fabric-screen-api-v1`, `fabric-rendering-v1`, `fabric-key-mapping-api-v1`, `fabric-item-api-v1`, `fabric-resource-loader-v1` and `fabric-lifecycle-events-v1` (their signatures and mixin targets name the Minecraft 26.3 classes and methods), against the Fabric blog posts for 26.1, 26.2 and 26.3, and by running Java: the Java port of [§1], [§2] and [§8] from the [Java Swing guide](../java-swing/README.md), fed through Gson 2.15.0, passed all 24 shared cases on JDK 25. No Minecraft or Fabric development environment was set up (it downloads the game), so Minecraft names that the Fabric sources do not show are marked (verify).

**Download:** `DeepTip-minecraft-fabric-1.0.0.zip` holds this guide with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout. **Status:** documented, not built in this repository.

## Quick start

**Recognise the project:** `src/main/resources/fabric.mod.json`, a `build.gradle` (or `.kts`) with the plugin `net.fabricmc.fabric-loom` (older: `fabric-loom`), and `gradle.properties` with `minecraft_version`, `loader_version` and `fabric_api_version`; client code in `src/client/java` or behind a `client` entrypoint.

1. Write the pure classes `DeepTipCore` and `DeepTipEngine` and pass the 24 parity cases with `./gradlew test` (section 16).
2. Copy `glossary/core/<locale>.json` to `src/main/resources/assets/deeptip/deeptip/core/`; your entries go to `assets/<modid>/deeptip/<locale>.json` (section 12).
3. Write `DeepTipClient` (a `ClientModInitializer`, registered as the `client` entrypoint in `fabric.mod.json`), which hooks screens, keys and resource reloads (sections 5, 9, 12).
4. Mark widgets with `DeepTip.mark(widget, key)` in your screen's `init()`.
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en src/main/resources/assets/deeptip/deeptip/core/en.json src/main/resources/assets/<modid>/deeptip/en.json`.

```java
// In your Screen subclass (client code). Widget names: Minecraft 26.3, see section 2.
@Override
protected void init() {
    Button help = Button.builder(Component.literal("?"), button -> {}).bounds(20, 20, 40, 20).build();
    addRenderableWidget(help);
    DeepTip.mark(help, "deeptip.about"); // rest the mouse on it: its window opens
}
```

**Done when:** `./gradlew test` passes 24 of 24 parity cases, in that screen resting on `?` for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest window without closing the screen, the validator reports 0 errors.

## 1. Parts to build

| Class | Content | Algorithms |
|---|---|---|
| `DeepTipCore` | pure Java, no Minecraft imports: `flatten(JsonObject)`, `parseText(String)`, `collectRefs`, `computePlacement(...)` | [§1.1], [§2], [§8] |
| `DeepTipEngine` | the window tree and its timers as a state machine: open, close, pin, hot set, grace, tendency, suppression, arming, timer lock; time, boxes and the hover state are passed in | [§4]–[§7] |
| `DeepTipText` | markup AST → styled runs → lines with the rectangles of every term fragment, measured with `Font` | [§3] |
| `DeepTipClient` | `ClientModInitializer`: screen events, the HUD element, the key mapping, the resource reload listener, the item tooltip callback | [§9] |
| `DeepTip` | the static API mods call (section 15) | |
| `DeepTipGlossary` | layers from resource packs, locale chain, `$ui` labels | [§1.2] |
| `assets/deeptip/deeptip/core/<locale>.json`, `assets/<modid>/deeptip/<locale>.json` | the core glossary and every mod's glossary | |

`fabric.mod.json` declares `"environment": "client"` (or puts DeepTip only behind the `client` entrypoint) and depends on `fabric-api`; DeepTip has nothing to do on a dedicated server. Keep `DeepTipCore` and `DeepTipEngine` free of Minecraft classes, so they run in plain JUnit tests.

## 2. SPEC concept → Fabric and Minecraft primitive

| DeepTip | Minecraft 26.3 + Fabric API 0.165.0 |
|---|---|
| Controller | one `DeepTip` object created in `DeepTipClient.onInitializeClient()` |
| Top layer in screens | `ScreenEvents.afterExtract(screen).register((screen, graphics, mouseX, mouseY, tickProgress) -> …)`, registered for every screen in `ScreenEvents.AFTER_INIT` (both checked). Fabric fires it around `Screen.extractRenderStateWithTooltipAndSubtitles(GuiGraphicsExtractor, int, int, float)` (checked in `GuiMixin`), so it runs after the screen's own tooltip and subtitles. |
| Top layer without a screen | `HudElementRegistry.addLast(id, element)`, "render after everything" (checked); `HudElement.extractRenderState(GuiGraphicsExtractor, DeltaTracker)` (checked) |
| Window order | windows drawn oldest first, the newest last; GUI drawing in 26.x collects a render state in strata, so start DeepTip's windows in a new stratum above the vanilla tooltip (`graphics.nextStratum()`, verify) |
| Drawing | `GuiGraphicsExtractor.fill(x1, y1, x2, y2, argb)`, `text(font, component, x, y, argb, shadow)`, `pose().pushMatrix()`, `pose().translate(x, y)`, `pose().popMatrix()` (all checked by their use in Fabric API) |
| Window ([§3]) | rectangles from `fill` (background, 1 unit frame); rounded corners need a nine-slice GUI sprite (verify the sprite call in 26.3) |
| Rich text | `Component.literal(text).withStyle(...)` (checked: `withStyle(ChatFormatting.GRAY)`), `Font.width(...)`, `font.lineHeight`, `font.split(text, width)` → `List<FormattedCharSequence>` (all checked); DeepTip lays out styled runs itself to know where every term is (section 6) |
| Chat events instead? | `Style` with `HoverEvent` and `ClickEvent` gives chat text one plain hover tooltip and a click action: it cannot nest, pin or be reached with the keyboard, so DeepTip draws its own terms |
| Term | a run of the layout with one rectangle per line fragment, hit-tested against the GUI mouse position |
| Marked UI element (web: `data-deeptip`) | `DeepTip.mark(AbstractWidget, key)`; its box from the widget's position and size (verify the getters); `Screens.getWidgets(screen)` lists a screen's widgets (checked), which also tells whether a marked widget is still there ([§4.5]) |
| Item tooltips | `ItemTooltipCallback.EVENT`: `getTooltip(ItemStack, Item.TooltipContext, TooltipFlag, List<Component> lines)` (checked); `GuiGraphicsExtractor.setTooltipForNextFrame(Font, List<Component>, Optional<TooltipComponent>, int, int)` is how a screen shows a tooltip (checked) |
| Pointer | `mouseX`, `mouseY` of `afterExtract` every frame, in GUI units |
| Clicks, wheel | `ScreenMouseEvents.allowMouseClick(screen)` → `boolean allowMouseClick(Screen, MouseButtonEvent)`, `allowMouseRelease`, `allowMouseScroll(Screen, double, double, double, double)`: returning `false` means the screen never processes it (checked) |
| Keys | `ScreenKeyboardEvents.allowKeyPress(screen)` → `boolean allowKeyPress(Screen, KeyEvent)` (checked); Fabric wraps the call of `Screen.keyPressed(KeyEvent)` in `KeyboardHandler.keyPress` (checked), so `false` hides Esc from the screen, which would otherwise close |
| Key mapping (F1 in the world) | `KeyMappingHelper.registerKeyMapping(new KeyMapping("key.deeptip.open", InputConstants.Type.KEYBOARD, InputConstants.KEY_…, KeyMapping.Category.MISC))` (pattern checked in the javadoc) and `ClientTickEvents.END_CLIENT_TICK` (checked) |
| `now()`, `schedule()` | `System.nanoTime() / 1e6` in every `afterExtract` frame; due times in the records. Client ticks (20 per second) are too coarse for the 80 ms term delay. |
| Coordinates | GUI-scaled units, y down: what screens, widgets and `mouseX`/`mouseY` use; the viewport is the screen's `width` × `height` (verify) |
| Gamepad, touch | none in vanilla Minecraft; controller mods (for example Controlify) map a gamepad to screen navigation (verify per mod) |
| Glossaries | resource packs: `ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloadListener(Identifier, PreparableReloadListener)` with a `ResourceManagerReloadListener` (`onResourceManagerReload(ResourceManager)`) (both checked) |
| Screen reader | Minecraft's narrator reads widgets; DeepTip windows are drawn, not widgets, so narrate the window title and short text yourself when one opens (verify the narrator API) |

## 3. Data structures

```java
// DeepTipEngine
public final class Win {
    final int id;
    final String key;
    final Win parent;                  // the window that contains the term it came from; null for roots
    final Object anchor;               // an AbstractWidget, a TermAnchor, or a SlotAnchor (section 7)
    final List<Win> children = new ArrayList<>();
    boolean pinned, frozen;
    String via;                        // "hover", "click", "key", "api"
    double leaveSince = -1, checkAt = -1, flashAt = -1;
    double left, top, right, bottom;   // as last placed, GUI units
    double anchorLeft, anchorTop, anchorRight, anchorBottom;
    Win(int id, String key, Win parent, Object anchor, String via) {
        this.id = id; this.key = key; this.parent = parent; this.anchor = anchor; this.via = via;
    }
}

record TermAnchor(int window, String key, int occurrence) {}   // value equality survives a language switch
```

Controller state: `glossary` (locale → `LinkedHashMap` key → entry), `labels`, `wins` (oldest first), `hover` (`win`, `link`, `trig`), `hot`, `pending` ([§6]), `quiet`, `samples` (`x`, `y`, `t`), `lock` ([§7]), `marks` (`WeakHashMap<AbstractWidget, Mark>`: key, delay, sides), `views` (per window: laid-out lines, term fragments, button boxes, scroll offset), `escUsed`, `focus` (window and index, section 10), `screen` (the screen the windows belong to).

## 4. Look (from `frameworks/web/deeptip.css`)

Colours are ARGB ints (`0xFF1B1E24`):

| Token | Light | Dark |
|---|---|---|
| background `--dt-bg` | `0xFFFFFFFF` | `0xFF1B1E24` |
| text `--dt-fg` | `0xFF1F2328` | `0xFFE6E8EC` |
| frame, hint separator `--dt-border` | `0xFFC8CDD5` | `0xFF3B414D` |
| accent: pinned frame, pin, lock bar, focus `--dt-accent` | `0xFF0B69D4` | `0xFF58A6FF` |
| term `--dt-link` | `0xFF0B69D4` | `0xFF6CB6FF` |
| term under the pointer `--dt-link-hover` | `0xFF084F9F` | `0xFF9CCFFF` |
| open term background | the term colour at alpha `0x29` (16 %) | same |
| missing term `--dt-missing` | `0xFFDD3333` | same |

Minecraft's font has one size (`font.lineHeight`, checked as a field) and every GUI value is in GUI-scaled units. The web's 14 px text with a 21 px line becomes one vanilla line of `lineHeight + 1`; scale every other CSS value by the same factor, about 0.5: padding 6, header padding 3 3 1 6, window width 120–192, max height 240 (the body scrolls beyond it), gap 4, frame 1, pin and close buttons 13×13, hint and "See also" in a dimmed colour (vanilla has no smaller font), lock bar 1 unit. Bold and italic come from `Style` (`withStyle(ChatFormatting.BOLD)`), code from a monospace font only if your resource pack provides one. The fade-in is an alpha ramp over 150 ms; the flash is the accent frame for 600 ms.

## 5. Order of operations per frame

1. **Input callbacks** (between frames, before the screen sees them): `allowMouseClick`, `allowMouseRelease`, `allowMouseScroll`, `allowKeyPress` hit-test against the rectangles DeepTip drew in the last frame (windows, buttons, terms, marks) and act at once ([§9.1], [§9.3]); they return `false` when DeepTip used the input.
2. **`afterExtract(screen, graphics, mouseX, mouseY, tickProgress)`**, every frame while a screen is open:
   1. `now = System.nanoTime() / 1e6`; when `(mouseX, mouseY)` changed, add a sample and drop samples older than 120 ms while more than 2 remain ([§5]).
   2. Marks gone ([§4.5]): a marked widget no longer in `Screens.getWidgets(screen)` or not visible: its preview closes, a pinned root freezes at its last box. Root anchor boxes from the widgets.
   3. Hover ([§6] "on pointer over"): `win` = the newest window containing the pointer; `link` = the term fragment under it in that window (or on a page text drawn with `DeepTip.text`); `trig` = the marked widget under the pointer, only when there is neither. If `{win, link, trig}` changed: reset `quiet`, `refreshHot()`, `lockTrack()`, then `arm()` or `disarm()`.
   4. Due times, in this order: the pending arm (open, or wait another 90 ms while the pointer heads into another preview); each unpinned window's grace check ([§5]: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the timer lock ([§7]); Esc held ≥ 600 ms; the end of a flash.
   5. Lay out changed windows (section 6), place them (section 7), draw them oldest first, record their rectangles.
3. **`ScreenEvents.remove(screen)`** (checked): the screen closed, every anchor in it is gone; close the previews and keep or close the pinned windows (DeepTip closes them: their anchors cannot return).
4. **Without a screen**, the HUD element does steps 2.1–2.5 for windows opened in the world (F1 on what the crosshair targets, `DeepTip.open` from code), with the mouse grabbed by the game: such windows are keyboard-only (section 10).

## 6. Text: markup → runs → lines with term rectangles [§3]

1. Parse the entry with `DeepTipCore.parseText` ([§2]) and walk the AST into **runs** `(text, style, kind, term)`: `style` is a `Style` with bold and italic (`b` inside `i` is both), `kind` is text, term, own (a link to the window's own key: bold, not interactive), missing (red, not interactive, one warning per key), value (a live value, bold). Paragraphs are separated by one empty line, list items start with `• ` and are indented, `br` breaks the line.
2. **Line breaking:** split runs into words and spaces; measure each piece with `font.width(Component.literal(piece).withStyle(style))` (bold is wider); put pieces on a line while they fit; drop a space at a line start; break a word wider than the line by characters. Lines are `font.lineHeight + 1` apart.
3. **Term fragments:** while placing a term's pieces, extend the current fragment rectangle; a term that continues on the next line starts a new fragment. One term = one anchor with one or more fragments.
4. **Natural width** ([§8] step 3): lay out once with a maximum of 192 − 12, take the widest line plus 12, clamp to 120‥192 and to the viewport width minus 8, lay out again at that width.
5. **Draw:** `graphics.text(font, Component.literal(piece).withStyle(style), x, y, colour, false)` per piece; terms in the term colour with `ChatFormatting.UNDERLINE`, an open term with a `fill` of the 16 % colour behind its fragments, the keyboard-focused term with a 1 unit accent frame.

Glossary text is never a Minecraft format code: build components with `Component.literal`, never parse `§` codes from glossary text.

## 7. Windows, placement and the adopted item tooltip [§8]

Window content, in the order of [§3]: header (title in bold; fallback badge with the source locale in upper case when the entry came from a fallback locale; pin and close buttons drawn as small icons with hit boxes, not as widgets, so they never enter the screen's widget list), body (`body`, else `short`, else `label("missing")`), "See also" (`label("seeAlso")` and one term per key), hint `label("hint")` when `hints` is on and the window is a preview, lock bar.

```java
void place(Win w, View v, int screenWidth, int screenHeight) {
    double gap = 4, maxW = Math.min(192, screenWidth - 2 * gap), maxH = Math.min(240, screenHeight - 2 * gap);
    double h = Math.min(v.contentHeight(), maxH);
    double[] a = w.parent != null
        ? new double[] {w.parent.left, w.parent.top, w.parent.right, w.parent.bottom}   // children sit beside the parent
        : new double[] {w.anchorLeft, w.anchorTop, w.anchorRight, w.anchorBottom};
    Map<String, Object> p = DeepTipCore.computePlacement(v.naturalWidth(), h, a[0], a[1], a[2], a[3], sides(w), screenWidth, screenHeight, gap);
    double pw = ((Number) p.get("maxW")).doubleValue(), ph = ((Number) p.get("maxH")).doubleValue();
    if (pw != 0 || ph != 0) {                          // no side had room: shrink into the best one
        if (pw != 0) v.relayout(Math.min(maxW, pw));
        h = Math.min(v.contentHeight(), ph != 0 ? Math.min(maxH, ph) : maxH);
        p = DeepTipCore.computePlacement(v.naturalWidth(), h, a[0], a[1], a[2], a[3], List.of((String) p.get("side")), screenWidth, screenHeight, gap);
    }
    w.left = ((Number) p.get("x")).doubleValue();
    w.top = ((Number) p.get("y")).doubleValue();
    w.right = w.left + v.naturalWidth();
    w.bottom = w.top + h;
}
```

`sides(w)`: roots use the mark's own order if set (`DeepTip.mark(widget, key, Mark.place("top", "bottom"))`), else `root` (`bottom, top, right, left`); children use `child` (`left, right, top, bottom`). A window taller than its box scrolls its body with the wheel (`allowMouseScroll`) and draws inside a scissor (`graphics.enableScissor(x1, y1, x2, y2)` / `disableScissor()`, verify in 26.3). Because a window is placed beside the box it came from, a child never covers its parent; it may cover older windows.

**Adopting the vanilla item tooltip** (as the Valheim mod adopts Valheim's tooltip, see [The adopted tooltip](../valheim/README.md#the-adopted-tooltip)): an item with a glossary entry (by convention the key `item.<namespace>.<path>`, or the `aliases` of [§10] matched against the item name) gets DeepTip's root window instead of the plain tooltip:

1. `ItemTooltipCallback.EVENT` collects the vanilla lines of the hovered stack (checked); the callback runs for every tooltip build, so remember the lines per stack for this frame only.
2. The anchor is the hovered slot's box in the container screen (verify how 26.3 exposes the hovered slot); the window shows the vanilla lines first (as plain components, terms auto-linked with the entry's `aliases`, [§10]) and then the entry's text.
3. Suppress the vanilla tooltip for that slot with a mixin into the container screen's tooltip extraction (it ends in `setTooltipForNextFrame`, checked; verify the exact method of `AbstractContainerScreen` in 26.3), only while DeepTip shows the adopted window; items without an entry keep the vanilla tooltip.
4. Pinning copies the lines into the window record, so the next hovered slot gets the next tooltip while the pinned window stays.

## 8. Coordinates and GUI scale

- Screens, widgets, `mouseX`/`mouseY` of the extract events and `GuiGraphicsExtractor` all use GUI-scaled units, y down, the space of [§8]. Convert nothing: the viewport is the screen's size in the same units.
- The GUI scale is a whole number chosen by the player (or "auto"); DeepTip's sizes of section 4 are in GUI units, so windows scale with the vanilla GUI.
- Window positions are doubles in the engine and rounded to whole units for drawing; round hit boxes the same way.

## 9. Input details [§9]

```java
// DeepTipClient.onInitializeClient(): every screen gets DeepTip's listeners when it is initialised
ScreenEvents.AFTER_INIT.register((client, screen, scaledWidth, scaledHeight) -> {
    ScreenEvents.afterExtract(screen).register((s, graphics, mouseX, mouseY, tickProgress) ->
        DeepTip.instance().frame(s, graphics, mouseX, mouseY));
    ScreenKeyboardEvents.allowKeyPress(screen).register((s, event) -> !DeepTip.instance().keyPressed(s, event));
    ScreenMouseEvents.allowMouseClick(screen).register((s, event) -> !DeepTip.instance().mousePressed(s, event));
    ScreenMouseEvents.allowMouseRelease(screen).register((s, event) -> !DeepTip.instance().mouseReleased(s, event));
    ScreenMouseEvents.allowMouseScroll(screen).register((s, x, y, h, v) -> !DeepTip.instance().scrolled(x, y, v));
    ScreenEvents.remove(screen).register(s -> DeepTip.instance().screenClosed(s));
});
```

All these signatures are checked against Fabric API 0.165.0+26.3; `DeepTip.instance()` methods return `true` when DeepTip used the input.

| Reference | Minecraft / Fabric |
|---|---|
| pointer leaves the game window | no event in the APIs read; a missing `afterExtract` frame (screen closed) or a mouse position outside the screen ends hover (verify) |
| click ([§9.1]) | `mousePressed`: inside a window → remember the target, consume; the release over the same target → close button `close(w, true)`, pin toggle, a term `follow(term, w, false)`, elsewhere `clickInsidePins`. Outside every window: `hush` the marked widget under the pointer and let the click through (the widget keeps its own action); `outsideClickCloses == "always"` closes all. |
| Esc, Shift+Esc, hold Esc | `keyPressed` with the Escape key code (compare with the escape constant of `InputConstants`; the `KeyEvent` record carries key code, scancode and modifiers, checked; its accessor names: verify) while windows are open: Shift (the shift bit of `InputConstants`' modifier constants, checked as `MOD_SHIFT` in the javadoc) → close all; else close the newest with focus back; return `true` (consumed: the screen does not close). Hold: repeated key presses after 600 ms close all (verify that 26.3 with SDL still reports key repeats as presses). |
| F6, Shift+F6 | the F6 key code with windows open: focus the next older (newer) window, consume |
| open keys F1, `?` | in screens: F1 or `allowCharType` with `?` (`CharacterEvent`, checked) while a marked widget or a term has DeepTip's focus → open pinned with focus, consume. In the world: the `key.deeptip.open` key mapping (F1 by default; vanilla's F1 hides the HUD, so offer another default or document the clash) checked in `ClientTickEvents.END_CLIENT_TICK` with `consumeClick()` (verify). |
| typing into a marked text field | `allowCharType` while a marked `EditBox` has the screen's focus → `hush(widget)` |
| gamepad, touch | not in vanilla; with a controller mod, its virtual cursor arrives as mouse events, and its "back" button often as Escape (verify per mod) |

## 10. Focus for the keyboard [§9.5]

Vanilla screens move focus between widgets with Tab and the arrow keys; DeepTip's windows are drawn, not widgets, so DeepTip keeps its own focus `(window, index)` over the window's terms (text order) and its pin and close icons. Opening by keyboard (F1, Enter on a term) focuses the first term; while a DeepTip window has the focus, `allowKeyPress` takes Tab, Shift+Tab, the arrows, Enter and Space (step, follow, press) and returns `false` for them, so the screen's own focus does not move as well. Closing a focused window returns DeepTip's focus to the parent window's term, or, for a root, the screen's focus to the marked widget (`screen.setFocused(widget)`, verify). The focused term gets a 1 unit accent frame.

## 11. Timers [§5]–[§7]

Due times compared with `System.nanoTime() / 1e6` in every `afterExtract` (or HUD) frame; `schedule(ms, f)` becomes a field like `pending.fireAt = now + delay`, `cancel` sets it to `-1`. Frames come at the display rate, so a due time is late by at most one frame. The lock bar's width is `(now - lock.since) / lockAfter` of the window width.

## 12. Loading the glossaries from resource packs [§1]

Glossaries are client resources, so resource packs can add and override them like translations: `assets/<namespace>/deeptip/<locale>.json` in every mod jar and pack. Minecraft's language codes are `en_us`, `de_de` …; DeepTip's chain uses the part before `_` (`de_de` → `de`, then the fallbacks).

- Register a reload listener: `ResourceLoader.get(PackType.CLIENT_RESOURCES).registerReloadListener(Identifier.fromNamespaceAndPath("deeptip", "glossary"), listener)` with a `ResourceManagerReloadListener` (checked); `addListenerOrdering(ResourceReloaderKeys.Client.LANGUAGES, id)` runs it after the languages (both checked).
- In `onResourceManagerReload(ResourceManager manager)`: for each locale of the chain, read `deeptip/core/<locale>.json` of the namespace `deeptip` first (the core layer), then `deeptip/<locale>.json` of every other namespace, and for each file every pack that has it, lowest priority first (`manager.getResourceStack(id)`, verify), so a resource pack overrides a mod per key. A missing file is not an error; a broken one is a warning.
- Parse with Gson (`JsonParser.parseReader(reader)`): a `JsonObject` keeps the keys in file order (its entry map is a `LinkedTreeMap`), and a duplicate key keeps its first position with its last value, like JavaScript (checked with Gson 2.15.0; Minecraft bundles its own Gson version, verify). So `flatten` walks `entrySet()` in order:

```java
// DeepTipCore.flatten (§1.1) on Gson
public record Flat(Map<String, JsonObject> entries, Map<String, JsonElement> meta, List<String> problems) {}

static final Pattern KEY_RE = Pattern.compile("[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*");

public static Flat flatten(JsonElement root) {
    Flat out = new Flat(new LinkedHashMap<>(), new LinkedHashMap<>(), new ArrayList<>());
    if (root != null && root.isJsonObject()) walk(root.getAsJsonObject(), "", out);
    else out.problems().add("(file): a glossary file must be a JSON object");
    return out;
}

static void walk(JsonObject node, String prefix, Flat out) {
    for (Map.Entry<String, JsonElement> e : node.entrySet()) {   // file order
        String k = e.getKey();
        JsonElement v = e.getValue();
        if (k.startsWith("$")) {
            if (prefix.isEmpty()) out.meta().put(k, v);
            continue;
        }
        String key = prefix.isEmpty() ? k : prefix + "." + k;
        if (v.isJsonObject()) {
            JsonObject o = v.getAsJsonObject();
            if (isString(o, "title") || isString(o, "short") || isString(o, "body")) {
                if (!KEY_RE.matcher(key).matches()) out.problems().add(key + ": invalid key");
                out.entries().put(key, o);                         // an existing key keeps its position
            } else {
                walk(o, key, out);
            }
        } else {
            out.problems().add(key + ": not an entry object");
        }
    }
}

static boolean isString(JsonObject o, String field) {
    JsonElement e = o.get(field);
    return e != null && e.isJsonPrimitive() && e.getAsJsonPrimitive().isString();
}
```

`Matcher.matches()` checks the whole key; `find()` or a pattern with `$` would accept a trailing newline. Add each file's entries to `glossary[locale]` (a later layer wins per key) and merge `$ui` into `labels[locale]`.

## 13. Live values, language, refresh [§4.6]

- `DeepTip.setValue("name", key -> "…")` or one `BiFunction<String, String, String>`; `null` keeps `{name}` visible ([§1.2]). Values are read when a window lays out.
- `refresh()`: lay out every open window again, re-attach each child to the `TermAnchor` with the same key and occurrence in its parent, re-place what is not frozen. Call it after your values changed.
- A language switch reloads the resources (Minecraft reloads resource packs when the language changes, verify in 26.3), so the reload listener rebuilds the chain from the new language code and refreshes the open windows.

## 14. Porting the pure functions to Java [§2] [§8]

Java strings are UTF-16 like JavaScript's, so indexes, `VAR_RE`'s 64-unit window and surrogate pairs behave as in the reference. The remaining pitfalls are in the [Java Swing guide, section 10](../java-swing/README.md#10-porting-the-pure-functions-java-pitfalls-checked): `String.trim()` and `strip()` keep U+00A0 and `\s` does not match it (checked in this run as well), `split` drops trailing empty strings unless the limit is `-1` (checked), `$` matches before a final newline (use `matches()`), divisions of doubles by zero give `Infinity` or `NaN` like JavaScript. Gson gives JSON numbers as `JsonPrimitive`; read them with `getAsDouble()` and compare numbers by value in tests.

## 15. API to offer

| Call | Does |
|---|---|
| `DeepTip.instance()` | the controller; options of [SPEC §7](../../SPEC.md#7-configuration-reference-names) as a config file or `DeepTip.options()` (`delay`, `linkDelay`, `closeDelay`, `lockAfter`, `closeButtons`, `pinButton`, `hints`, `clickInsidePins`, `outsideClickCloses`, `root`, `child`, `fallback`, `openKeys`) |
| `DeepTip.mark(AbstractWidget, key)`, `DeepTip.mark(widget, key, Mark.delay(0).place("top", "bottom"))`, `DeepTip.unmark(widget)` | an explained widget |
| `DeepTip.text(graphics, font, markup, x, y, width)` → height | markup with live terms on a screen (web: `renderText`) |
| `DeepTip.index(...)` | the encyclopedia ([§12]) as a screen with an `EditBox` search |
| `DeepTip.setValue(name, fn)`, `DeepTip.refresh()` | live values ([§4.6]) |
| `DeepTip.open(key, anchorBox, pinned)`, `DeepTip.closeAll()` | windows from code |
| `DeepTip.hasWindows()`, `DeepTip.isOpen(widget)`, `DeepTip.arming(widget)` | for other mods' own input and tooltips |

Other mods use DeepTip softly: depend on it with `suggests` in `fabric.mod.json` and call it through a small adapter class that is loaded only when `FabricLoader.getInstance().isModLoaded("deeptip")`; their glossaries need no code at all (resource files, section 12).

## 16. Tests [§11]

Parity cases with JUnit 5 in the mod's `test` source set (`./gradlew test`, no game needed), with Gson on the test classpath (Minecraft's dependency, or `com.google.code.gson:gson`). Load each case file with `JsonParser.parseString(Files.readString(path))`, then:

- markup: `parseText(src)` equals `blocks` (convert the expected `JsonElement` and your AST to the same plain `Map`/`List`/`Double` values; `text` is `null` when absent);
- placement: `computePlacement(...)` equals `expect`, numbers compared as doubles;
- glossary: `flatten(input)` gives `expect.keys` (the entry keys in order), `expect.meta` and the number of problems.

The verification run used exactly this route: the Java port of the [Java Swing guide](../java-swing/README.md#111-parity-cases) with the case files read through Gson and its `JsonObject` order: `24 passed, 0 failed` on JDK 25 (checked). Behaviour: `DeepTipEngine` takes `now` as an argument, so plain JUnit tests check the invariants of [§4] (one preview per parent, pinned chain, subtree close, flash instead of a second window), grace and tendency ([§5]) and suppression. Fabric's client game tests (`fabric-client-gametest-api-v1`, part of Fabric API 0.165.0) can then drive a real client; compare the feel with the web example (`npm run demo`).

## 17. The example to build

A screen `DeepTipExampleScreen`, opened with a key mapping, with the shared glossaries as `assets/deeptip/deeptip/core/<locale>.json` and `assets/deeptip/deeptip/example/<locale>.json` (an extra layer of the example):

- A top row of `Button`s, each marked: Realm `demo.realm`, Stability `demo.stability` (a press cycles −3…+3, then `DeepTip.refresh()`), Taxes `demo.taxes` (a press cycles low/normal/high and adds gold), Nobles `demo.nobles`, Gold `demo.gold`, and `?` with `deeptip.about` and delay 0; a language button toggling DeepTip's own locale between `de` and `en`.
- Four corner buttons for placement at the screen edges: `demo.province` top left, `demo.prestige` top right, `demo.revolt` bottom left, `demo.unrest` bottom right.
- A page text drawn with `DeepTip.text` containing the loop `[[demo.stability]] → [[demo.unrest]] → [[demo.revolt]] → [[demo.stability]]`.
- Options: fallback `de`, `en`; delay 1000; values `stability` (`+1`) and `gold`. In English, Prestige and Gold come from the German fallback and show the `DE` badge.
- In a world: hover an item that has an `item.*` entry in the example glossary of your mod to see the adopted tooltip (section 7).

## 18. Pitfalls

1. **Names changed three times in a year**: 26.1 (official names, Fabric API renames), 26.2 (`Minecraft.getInstance().gui` holds the screen), 26.3 (`GuiGraphicsExtractor`, `extract…` methods, SDL input). Code from tutorials for 1.21.x does not compile; check names against the Fabric API sources of your exact version.
2. **No hard-coded key or mouse constants**: since 26.3 the constants come from `InputConstants`, and some values (all mouse buttons) changed (Fabric blog, checked).
3. **Text input focus**: a custom text field must tell `TextInputManager` about focus changes in 26.3, or character input breaks (Fabric blog, checked); DeepTip's encyclopedia search uses the vanilla `EditBox`.
4. **Client only**: never load DeepTip's classes on a dedicated server; the `client` entrypoint and `"environment": "client"` keep them out.
5. **Release without press**: a consumed press must also consume its release (`allowMouseRelease`), or the widget under the window gets a release without a press.
6. **Tooltip strata**: vanilla tooltips are drawn late; draw DeepTip after them (section 2) or the vanilla tooltip covers the window.
7. **Mixins** (only for the adopted item tooltip): target names change with every version; keep them in one small mixin and test it per version.
8. **F1** is vanilla's "hide GUI" key in the world.

## 19. Limitations

- No gamepad or touch in vanilla Minecraft.
- Windows are drawn, not widgets: vanilla narration and widget focus do not reach them (section 10).
- One font size; bold and italic only through `Style`; no rounded corners without a sprite.
- Not built against Minecraft for this guide (see the intro).

## 20. Checklist

1. `DeepTipCore` (Gson flatten, parser, placement); `./gradlew test` passes the 24 parity cases (section 16).
2. `DeepTipEngine` ported from algorithms [§4]–[§7] (or from `frameworks/rust-egui/src/engine.rs`) with JUnit scenario tests.
3. `DeepTipText`: runs, measuring with `Font`, term fragments (section 6); windows and placement (section 7).
4. `DeepTipClient`: screen events, key handling with consumption, HUD element, resource reload listener, item tooltip (sections 5, 9, 12).
5. The example (section 17) in a development client; compare with the web example by hand.
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
[§9.3]: ../../docs/algorithms.md#93-keyboard
[§9.5]: ../../docs/algorithms.md#95-focus
[§10]: ../../docs/algorithms.md#10-auto-linking-aliases
[§11]: ../../docs/algorithms.md#11-testing-with-testcases
[§12]: ../../docs/algorithms.md#12-encyclopedia
