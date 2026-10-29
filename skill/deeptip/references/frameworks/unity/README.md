# DeepTip for Unity (uGUI + TextMeshPro): build guide

How to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) (explanation windows with depth: nested, pinnable, Paradox-style tooltips) in a Unity project you own, with uGUI and TextMeshPro, Unity 6 or newer. A runtime UI made with UI Toolkit (`UIDocument`, UXML, USS) has its own guide: [Unity (UI Toolkit)](../unity-uitoolkit/README.md).

This folder holds no code: DeepTip code exists only as HTML, CSS, JS and Rust. This guide is the exact recipe for Unity. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md) and are linked by section (§) instead of repeated; [SPEC.md](../../SPEC.md) is the contract, and the web runtime ([frameworks/web](../web/README.md)) is the reference to compare behaviour with.

**Real-world reference:** a complete C# implementation with uGUI and TextMeshPro runs in the Valheim mod **DeepTip** (BepInEx plugin `GC_Valheim_DeepTip`): source in its own repository, https://github.com/gorduan/Valheim_DeepTip, described in the [Valheim guide](../valheim/README.md). It patches a finished game; this guide is for a project whose code you control, so it needs no patches.

Statements marked *(checked)* were verified on 2026-10-29 against **Unity 6000.3.24f1**: API names by decompiling the engine modules and the `UnityEngine.UI` and `Unity.TextMeshPro` assemblies the editor compiled; every snippet compiled as C# 9 against them, for the Input Manager and for the Input System (against a compiled `Unity.InputSystem` 1.x); a C# 9 port of §1, §2 and §8 passed all 24 shared cases. No player was run for this guide; behaviour notes come from the implementations of the APIs and from the Valheim mod.

## Quick start

**Recognise the project:** `Assets/`, `ProjectSettings/ProjectVersion.txt` and `com.unity.ugui` in `Packages/manifest.json` (uGUI with TextMeshPro).

1. Create `DeepTip.Core` (`Glossary`, `Markup.Parse`, `Placement.Compute`, no engine references) and pass the 24 parity cases with `dotnet test` (sections 1 and 10.1).
2. Build `TipWindowView`, `TmpMarkup`, `DeepTipAnchor` and `DeepTipHost` in the `DeepTip` assembly (sections 4–7).
3. Copy `glossary/core/<locale>.json` to `Assets/StreamingAssets/deeptip/core/`; your own entries go to `Assets/StreamingAssets/deeptip/<locale>.json` (section 8).
4. Add one `DeepTipHost` in the first scene and a `DeepTipAnchor` to each element to explain (below).
5. Let your own Esc handling ask `DeepTipHost.EscapeConsumedThisFrame` first (section 7.3).
6. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en Assets/StreamingAssets/deeptip/core/en.json Assets/StreamingAssets/deeptip/en.json`.

```csharp
// once, in the first scene: overlay canvas, window tree and input; it survives scene loads
new GameObject("DeepTip").AddComponent<DeepTipHost>();

// any uGUI element with a raycast target, e.g. a Button (or add the component in the Inspector)
var anchor = helpButton.gameObject.AddComponent<DeepTipAnchor>();
anchor.Key = "deeptip.about";                               // web: data-deeptip="deeptip.about"
```

**Done when:** `dotnet test` passes 24 of 24 cases, in Play mode resting on the button for 800 ms opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows, `Esc` closes the newest window without opening your pause menu.

## 1. Parts to build

| Part | Kind | Does | Algorithms |
|---|---|---|---|
| `Glossary`, `Markup.Parse`, `Placement.Compute` | assembly `DeepTip.Core`, `"noEngineReferences": true` | plain C# 9 | [§1](../../docs/algorithms.md#1-data), [§2](../../docs/algorithms.md#2-markup-parser), [§8](../../docs/algorithms.md#8-placement) |
| `DeepTipAnchor` | `MonoBehaviour` | marks a UI element (key, delay, sides); reports hover, press and selection | SPEC §3.3 |
| `DeepTipHost` | `MonoBehaviour`, one, `DontDestroyOnLoad` | overlay canvas, window tree, hover state, due times, input, all in `Update` | [§4](../../docs/algorithms.md#4-window-tree-and-invariants)–[§7](../../docs/algorithms.md#7-timer-lock), [§9](../../docs/algorithms.md#9-input) |
| `TipWindowView` | built in code | one window | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `TmpMarkup` | static | AST → TextMeshPro rich text | [§3](../../docs/algorithms.md#3-rendering-the-ast) |
| `DeepTipText`, `DeepTipIndex` | `MonoBehaviour` | terms in a normal TMP text; the encyclopedia | [§12](../../docs/algorithms.md#12-encyclopedia) |
| `AutoLink` (optional) | static | aliases in texts you do not write yourself | [§10](../../docs/algorithms.md#10-auto-linking-aliases) |

Assembly definitions: `Assets/DeepTip/Core/DeepTip.Core.asmdef`

```json
{ "name": "DeepTip.Core", "noEngineReferences": true }
```

and `Assets/DeepTip/Runtime/DeepTip.asmdef`

```json
{
  "name": "DeepTip",
  "references": ["DeepTip.Core", "Unity.TextMeshPro", "UnityEngine.UI", "Unity.InputSystem"],
  "versionDefines": [{ "name": "com.unity.inputsystem", "expression": "1.0.0", "define": "DEEPTIP_INPUT_SYSTEM" }]
}
```

In Unity 6, TextMeshPro ships inside the uGUI package; its assemblies are `Unity.TextMeshPro` and `UnityEngine.UI` *(checked)*. Guard all Input System code with `#if DEEPTIP_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM`, so the package can be absent and the player's active input handling decides. The pure `DeepTip.Core` assembly also compiles outside Unity, which is how its tests run fastest (section 10).

## 2. SPEC concept → Unity primitive

| SPEC | Unity 6 (uGUI + TextMeshPro) |
|---|---|
| Top layer for windows | an own `Canvas`: `RenderMode.ScreenSpaceOverlay`, `sortingOrder = 32000` (the field is 16-bit, at most 32767), `CanvasScaler` (`ConstantPixelSize` with the game UI's scale factor), `GraphicRaycaster`, `DontDestroyOnLoad` *(compiled)* |
| Window | a `RectTransform` anchored top-left, an `Image` background with `raycastTarget = true` (clicks inside must not reach the game UI behind), an `Outline` for the pinned frame and the flash, a `RectMask2D` viewport; the newest window is the last sibling (`SetAsLastSibling()`) |
| Rich text | TMP rich text: `<b>`, `<i>`, `<u>`, `<color=#…>`, `<link="…">`, `<noparse>` |
| Term | `<link="dt:key">label</link>` inside a TMP text; hit-test with `TMP_TextUtilities.FindIntersectingLink(text, screenPoint, camera)`, the key from `text.textInfo.linkInfo[i].GetLinkID()` *(checked)*; a link that wraps is tested per line segment *(checked in TMP's implementation)* |
| Element with an explanation (`data-deeptip`) | `DeepTipAnchor` with `IPointerEnterHandler`, `IPointerExitHandler`, `IPointerDownHandler`, `ISelectHandler`, `IDeselectHandler`; the element needs a raycast target *(compiled)* |
| Pointer over windows and terms | tested every frame: `RectTransformUtility.RectangleContainsScreenPoint` on the window panels, newest first, then `FindIntersectingLink` on that window's texts *(compiled)* |
| Pointer type | `PointerEventData.pointerId`: mouse buttons are negative (−1, −2, −3), touches are finger ids ≥ 0; with the Input System UI module, `ExtendedPointerEventData.pointerType == UIPointerType.Touch` *(compiled)* |
| Clicks | `IPointerClickHandler` on the window root and on page texts (uGUI sends the click to the first ancestor with a handler); `Button.onClick` for pin and close |
| Keyboard | polled in `Update`: `Input.GetKeyDown(KeyCode.Escape)`, or `Keyboard.current.escapeKey.wasPressedThisFrame` *(compiled both)* |
| Consuming Esc | polled input has no propagation: DeepTip runs first and the game asks it (section 7.3) |
| `schedule` / `cancel` | due times compared in `Update` (`due = now + ms`, cancel = `due = -1`) |
| `now()` | `Time.unscaledTimeAsDouble * 1000` *(compiled)*: unscaled, so windows also work in a pause menu with `timeScale` 0 |
| Focus | `EventSystem.current.currentSelectedGameObject` for elements; terms are not `Selectable`s, so focus inside a window is an index DeepTip keeps (section 4.5) |
| Gamepad | Input System `Gamepad.current`: `buttonSouth` A, `buttonEast` B, `buttonNorth` Y, `leftShoulder`, `rightShoulder`, `dpad` *(compiled)*; Input Manager `KeyCode.JoystickButtonN`, whose numbering depends on platform and controller |
| Vibration | `Handheld.Vibrate()` on Android and iOS, fixed length *(compiled)* |
| Glossary files | `StreamingAssets` (through `UnityWebRequest` where they sit inside an archive: Android, WebGL) or `Resources` as `TextAsset` *(compiled)* |
| JSON | not `JsonUtility` (no objects with arbitrary keys); Newtonsoft (`com.unity.nuget.newtonsoft-json`): `JObject` keeps file order and, like `JSON.parse`, keeps the last value of a duplicate key at its first position *(checked)* |
| ARIA | uGUI has no screen reader support of its own; Unity 6's `UnityEngine.Accessibility` (`AccessibilityHierarchy`, `AccessibilityNode`, `AssistiveSupport`) feeds the platform screen readers it supports *(compiled)* |
| Theme | your own color set (serialized fields or a `ScriptableObject`); the web values are in section 5 |

## 3. Data structures

```csharp
public sealed class TipWindow                             // §4
{
    public int Id;
    public string Key = "";
    public TipWindow Parent;
    public readonly List<TipWindow> Children = new List<TipWindow>();
    public object Anchor;                                  // a DeepTipAnchor, or a TermRef
    public string Via = "api";                             // hover, click, key, touch, pad, api
    public bool Pinned, Frozen;
    public double CloseDue = -1, LeftAt;                   // §5 leave(): due time of the next check, time the pointer left
    public Box Box;                                        // last placed box, screen pixels, y down
    public TipWindowView View;
}

// A term inside a window or a page text; value equality, so a re-rendered text keeps its anchors (invariant 5)
public readonly struct TermRef : IEquatable<TermRef>
{
    public readonly TipWindow Host;                        // null for page texts
    public readonly TMP_Text Text;
    public readonly string Key;
    public readonly int Occurrence;                        // the n-th link with this key in the text
    // constructor, Equals, GetHashCode
}
```

| Host field | Type | For |
|---|---|---|
| `windows` | `List<TipWindow>`, oldest first (= sibling order) | §4 |
| `hot` | `HashSet<TipWindow>` | §5 |
| `hover` | `(TipWindow Win, TermRef? Link, DeepTipAnchor Trig)` | §5, §6 |
| `samples` | `List<(Vector2 P, double T)>` | §5 |
| `pending` | `(object El, string Key, TipWindow Parent, double Since, double Delay, double Due)?` | §6 |
| `quiet` | `DeepTipAnchor` | §6 `hush` |
| `lockWindow`, `lockDue` | | §7 |
| `escAt`, `escUsed` | `double`, `bool` | §9.3 |
| `press`, `swallow`, `swipe` | stored `PointerEventData`, due time, start position | §9.2 |
| `padPrev`, `padBAt` | buttons of the last frame, press time of B | §9.4 |

`Box` is a struct `Left, Top, Right, Bottom` in screen pixels with y down (the space of §8). Keep `DeepTipAnchor.Hovered` and similar statics resettable: with *Enter Play Mode* options that skip the domain reload, statics survive between play sessions; clear them in a `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]` method.

## 4. Windows and terms

### 4.1 The overlay canvas

```csharp
var go = new GameObject("DeepTip", typeof(RectTransform));
Object.DontDestroyOnLoad(go);
Canvas canvas = go.AddComponent<Canvas>();
canvas.renderMode = RenderMode.ScreenSpaceOverlay;
canvas.sortingOrder = 32000;
CanvasScaler scaler = go.AddComponent<CanvasScaler>();
scaler.uiScaleMode = CanvasScaler.ScaleMode.ConstantPixelSize;
scaler.scaleFactor = uiScale;                              // copy the game UI's scale factor every frame if it can change
go.AddComponent<GraphicRaycaster>();
```

The scene needs an `EventSystem` with the input module that matches the active input handling (`StandaloneInputModule` or `InputSystemUIInputModule`); create one if none exists.

### 4.2 The window

Built in code, all anchors and pivots top-left (`anchorMin = anchorMax = pivot = (0, 1)`); sizes in canvas units = CSS pixels at scale 1:

- Root: `Image` (background color, `raycastTarget = true`), `Outline` (`effectDistance (2, −2)`, `useGraphicAlpha = false`, enabled when pinned or flashing), an `IPointerClickHandler` for `clickInsidePins` and terms, and a `Selectable` with `transition = None` and `navigation.mode = None`, so the window can hold the EventSystem selection (section 4.5) *(compiled)*.
- Header: title TMP (semi-bold), fallback badge TMP (0.7 × size, dimmed), pin and close `Button`s with icon `Image`s (pin outline or filled, a cross); 26×26, 40×40 after touch input.
- Viewport with `RectMask2D`, a content child holding the body TMP, the "See also" TMP and the hint TMP; scroll the content with the mouse wheel (`Input.mouseScrollDelta.y` or `Mouse.current.scroll.ReadValue().y`) when it is taller than the viewport *(compiled)*.
- Lock bar: an `Image` of height 2–3 at the bottom, `type = Filled`, `fillMethod = Horizontal`, `fillAmount` = progress; a `Filled` image needs a sprite: create a plain white one in code (`Texture2D` + `Sprite.Create`) *(compiled)*.
- Layout: either by hand, measuring each text with `TMP_Text.GetPreferredValues(richText, maxWidth, 0)` and placing the children (as the Valheim mod does), or with layout groups plus `LayoutRebuilder.ForceRebuildLayoutImmediate(panel)` before every measurement *(compiled)*.
- TMP texts: `richText = true`, `textWrappingMode = TextWrappingModes.Normal` (`enableWordWrapping` is obsolete in Unity 6 *(checked)*), `overflowMode = TextOverflowModes.Overflow`, `raycastTarget = true`. TMP needs its essential resources (Window ▸ TextMeshPro ▸ Import TMP Essential Resources); without them `TMP_Settings.defaultFontAsset` is null and no text appears. Make sure the font asset or its fallbacks contain the characters your glossaries use (the shared ones use – → − … •).

### 4.3 Rendering the AST to TMP rich text

| Node ([§2](../../docs/algorithms.md#2-markup-parser)) | TMP |
|---|---|
| text | `Plain(v)`: the text, wrapped in `<noparse>…</noparse>` when it contains `<` (glossary text must never become tags) |
| br | `\n` |
| b, i | `<b>…</b>`, `<i>…</i>` |
| code | `<color=#…>…</color>` (optionally `<font="Mono SDF">` with a font asset in a Resources path) |
| var | `<color=#…><b>value</b></color>`, the value through `Plain` |
| link, own key | `<b>label</b>` |
| link, missing key | `<color=#…><u>label</u></color>`, no `<link>`, one warning |
| link | `<link="dt:key"><color=#…><u>label</u></color></link>` |
| p | blocks joined with `\n\n` |
| ul | items as `• ` + text, joined with `\n` |

```csharp
static string Plain(string t) => t.IndexOf('<') < 0 ? t : "<noparse>" + t.Replace("</noparse>", "</ noparse>") + "</noparse>";
static string Term(string key, string label, string color) => "<link=\"dt:" + key + "\"><color=" + color + "><u>" + Plain(label) + "</u></color></link>";
```

The `dt:` prefix keeps your links apart from other `<link>` users. Window content in the order of [§3](../../docs/algorithms.md#3-rendering-the-ast).

### 4.4 Terms under the pointer

```csharp
static string LinkAt(TMP_Text text, Vector2 screenPoint, out int index)
{
    index = -1;
    if (text == null || !text.isActiveAndEnabled || text.textInfo == null || text.textInfo.linkCount == 0) return null;
    index = TMP_TextUtilities.FindIntersectingLink(text, screenPoint, CameraOf(text));   // null camera for overlay canvases
    if (index < 0) return null;
    string id = text.textInfo.linkInfo[index].GetLinkID();
    return id.StartsWith("dt:", StringComparison.Ordinal) ? id.Substring(3) : null;
}

static Camera CameraOf(Component c)
{
    Canvas canvas = c.GetComponentInParent<Canvas>();
    canvas = canvas != null ? canvas.rootCanvas : null;
    return canvas == null || canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : canvas.worldCamera;
}
```

*(compiled)*. `textInfo` describes the text as last rendered: after setting `text`, call `ForceMeshUpdate()` before hit-testing in the same frame. The anchor box of a page term is the union of its characters' boxes (`linkTextfirstCharacterIndex`, `linkTextLength`, `characterInfo[i].bottomLeft.x`, `topRight.x`, `descender`, `ascender`, skipping invisible characters), transformed with `text.transform.TransformPoint` and converted like any world corner (section 6) *(compiled)*. Windows opened from a term inside a window are placed next to that window, not the term ([§8](../../docs/algorithms.md#8-placement)).

### 4.5 Keyboard and gamepad focus inside windows

TMP links are not `Selectable`, so emulate the focus ([§9.4](../../docs/algorithms.md#94-gamepad), [§9.5](../../docs/algorithms.md#95-focus)): when a window is opened by keyboard or gamepad, remember the selected `GameObject`, select the window root (`EventSystem.current.SetSelectedGameObject(windowRoot)`), and keep an index into the window's focus list (its terms in text order, then its buttons). Draw the focused term differently (re-render it with `<mark=#…>` around the label or another color). Tab or the d-pad moves the index (wrapping), Enter or A follows the term or presses the button, F1/Y on a focused term follows it. When the window closes with focus inside, select the anchor again if it still exists *(compiled)*. Because the window root's `Selectable` has no navigation, the EventSystem does not wander back into the game UI while a window has the focus.

## 5. Look: the values of `deeptip.css`

| Color (web token) | Light | Dark |
|---|---|---|
| Background (`--dt-bg`) | `#FFFFFF` | `#1B1E24` |
| Text (`--dt-fg`) | `#1F2328` | `#E6E8EC` |
| Border, hint line (`--dt-border`) | `#C8CDD5` | `#3B414D` |
| Accent: pinned frame, lock bar, focus (`--dt-accent`, `--dt-pinned`) | `#0B69D4` | `#58A6FF` |
| Term (`--dt-link`) | `#0B69D4` | `#6CB6FF` |
| Term on hover (`--dt-link-hover`) | `#084F9F` | `#9CCFFF` |
| Open term background | the term color at 16 % alpha | same |
| Missing term (`--dt-missing`) | `#DD3333` | `#DD3333` |

`ColorUtility.TryParseHtmlString("#0B69D4", out Color c)` *(compiled)*. Sizes: font 14, line height 1.5, padding 12, min width 240, max width 384, max height 480, gap 8, corner radius 8 (needs a sliced rounded sprite; a game usually takes the background sprite of its own tooltip, as the Valheim mod does), shadow `0 10 30` at 30 % black (a blurred sprite behind the window, or none). Motion: fade in over 150 ms, the lock bar fills linearly over `lockAfter`, the flash is the accent outline for 0.6 s.

## 6. Placement and coordinates

DeepTip computes in **screen pixels, origin top-left, y down** ([§8](../../docs/algorithms.md#8-placement)); Unity's screen space has y up.

```csharp
static readonly Vector3[] corners = new Vector3[4];

static Box ScreenBox(RectTransform rt)
{
    rt.GetWorldCorners(corners);
    Camera cam = CameraOf(rt);
    float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
    foreach (Vector3 w in corners)
    {
        Vector2 s = RectTransformUtility.WorldToScreenPoint(cam, w);
        minX = Mathf.Min(minX, s.x); maxX = Mathf.Max(maxX, s.x);
        minY = Mathf.Min(minY, s.y); maxY = Mathf.Max(maxY, s.y);
    }
    return new Box(minX, Screen.height - maxY, maxX, Screen.height - minY);   // y down
}

static void PlaceTopLeft(RectTransform win, float x, float y, float scaleFactor)
{
    win.anchorMin = win.anchorMax = new Vector2(0f, 1f);
    win.pivot = new Vector2(0f, 1f);
    win.anchoredPosition = new Vector2(x / scaleFactor, -y / scaleFactor);   // on the full-screen overlay canvas
}
```

*(compiled)*. The pointer: `Input.mousePosition` or `Pointer.current.position.ReadValue()`, then `y = Screen.height - y`. The viewport is `Screen.width × Screen.height`. Steps for one window:

1. Target box: the parent window's panel for children, `ScreenBox` of the anchor's `RectTransform` (or the page term's box) for roots.
2. Sides: the anchor's own `place` (roots only), else `child` or `root`.
3. Natural size in pixels = layout size in canvas units × `scaleFactor`; `Placement.Compute`; if `maxW` or `maxH` is set, limit the layout to `max / scaleFactor`, lay out again and compute once more with `[side]`; the viewport scrolls.
4. `PlaceTopLeft(x, y)`; remember the box.

Re-place every frame when the target box, the natural size or the screen size changed (the game UI may move or scale). Never mix canvas units and pixels in one computation.

## 7. The frame loop: exact order of operations

`DeepTipHost` carries `[DefaultExecutionOrder(-10000)]`, so its `Update` runs before your game scripts *(compiled)*. EventSystem callbacks (enter, exit, down, up, click, select) arrive during the EventSystem's own update; they record state (`DeepTipAnchor.Hovered`, `Selected`, the press) or act at once (clicks, section 7.2).

### 7.1 `Update`

1. `now = Time.unscaledTimeAsDouble * 1000`; read the pointer (convert to y down), the keys and the gamepad.
2. Mouse or pen moved → add a sample, drop old ones ([§5](../../docs/algorithms.md#5-hot-set-grace-tendency-suppression)).
3. Windows whose view was destroyed are removed. An anchor that was destroyed (`anchor == null`, Unity's overloaded check) or became inactive: previews close, a pinned root freezes at its box ([§4.5](../../docs/algorithms.md#45-anchors-that-disappear)).
4. Hit-test: `win` = the newest window whose panel contains the pointer; `link` = `LinkAt` over that window's texts (over registered page texts when there is no window); `trig` = `DeepTipAnchor.Hovered` when there is neither.
5. If `(win, link, trig)` differs from the last frame → "on pointer over" of [§6](../../docs/algorithms.md#6-arming-and-delays): hover, quiet reset, `refreshHot`, `lockTrack`, arm or disarm.
6. Due times, in this order: the pending arm (`fire`: open, or wait another 90 ms while the pointer heads into another preview); each window's close check (`tick` of §5: close, or another 90 ms while it is approached, up to 1.5 s after leaving); the lock (§7: pin); the long-press (section 7.2); the end of the swallow; the end of a flash.
7. Keys (section 7.3), then the gamepad ([§9.4](../../docs/algorithms.md#94-gamepad)).
8. Re-place changed windows (section 6); update the lock bar's `fillAmount` and the flash outline.

### 7.2 Pointer down, up and click ([§9.1](../../docs/algorithms.md#91-clicks), [§9.2](../../docs/algorithms.md#92-pointer-down-touch))

- `DeepTipAnchor.OnPointerDown`: mouse → `hush` (the element is being used); touch → store the `PointerEventData`, `pressDue = now + longPress`.
- Long-press due → open the element's window pinned, `Handheld.Vibrate()` on phones, and set `eventData.eligibleForClick = false` on the stored event: both the Input Manager module and the Input System UI module send the click on release only while it is true, so the element does not also click *(checked in both modules)*.
- `OnPointerUp` of that pointer ends the press; moving more than 10 px ends it too. Touch on a window header outside the buttons starts a swipe; released with dy > 60 and |dx| < 60 it closes all.
- Pointer down outside every window: `outsideClickCloses` (`"always"`, or `"touch"` for touches) closes all. With uGUI only objects with raycast targets receive presses: detect "outside" in the host by testing the pointer against the window panels when a mouse button or touch goes down.
- Window `OnPointerClick` (left button): a term under the click → `follow(term, this window, focus: false)`; elsewhere → `clickInsidePins`. Pin and close `Button.onClick` → toggle, or `close(window, focusBack: true)`. A `DeepTipText` page text forwards its link clicks the same way with no parent window.

### 7.3 Keys ([§9.3](../../docs/algorithms.md#93-keyboard))

```csharp
[DefaultExecutionOrder(-10000)]
public sealed class DeepTipHost : MonoBehaviour
{
    static int escapeFrame = -1;

    /// <summary>The game asks this before it reacts to Esc itself.</summary>
    public static bool EscapeConsumedThisFrame => escapeFrame == Time.frameCount;
    // …
}
```

- Esc pressed this frame with windows open: Shift held → close all, focus back to the root's anchor; else close `newest(focused window)` with focus back; record `escAt`; set `escapeFrame = Time.frameCount`. Esc still held after 600 ms → close all (once per press).
- Your game checks `DeepTipHost.EscapeConsumedThisFrame` before opening its pause menu. uGUI's own Cancel event (`ICancelHandler`, Esc by default) and Input System actions bound to Esc do not ask: check the flag there too, or disable such actions while DeepTip windows are open. Polled input cannot be consumed any other way.
- F6 / Shift+F6 cycle the focus between windows. F1 (or "?" in `Input.inputString` / `Keyboard.onTextInput`, not while an input field is selected) on a focused term → follow; on the selected `DeepTipAnchor` → open its window pinned with focus.
- Text typed while a `TMP_InputField` with a `DeepTipAnchor` is selected → `hush` it.

With the Input System active and the Input Manager disabled, any call into `UnityEngine.Input` throws `InvalidOperationException`; keep both branches behind `ENABLE_INPUT_SYSTEM` / `ENABLE_LEGACY_INPUT_MANAGER` *(both compiled)*.

### 7.4 Live values, locale, refresh

Live values are read when a window renders; after a change call `refresh()` ([§4.6](../../docs/algorithms.md#46-refresh)): re-render every window's TMP texts, re-attach children to the `TermRef` with the same key and occurrence, re-place. A locale switch reloads the files of the new chain (coroutine, section 8), then refreshes; register `refresh` with your game's own language switch.

## 8. Loading the glossaries

Order per [§1.2](../../docs/algorithms.md#12-layers-locales-lookup): for each locale of the chain, core first, project after.

```csharp
static IEnumerator ReadStreamingAsset(string relative, Action<string> done)
{
    string path = Path.Combine(Application.streamingAssetsPath, relative);
    if (path.Contains("://"))                                // inside an archive (Android) or on a server (WebGL)
    {
        using (UnityWebRequest req = UnityWebRequest.Get(path))
        {
            yield return req.SendWebRequest();
            done(req.result == UnityWebRequest.Result.Success ? req.downloadHandler.text : null);
        }
    }
    else done(File.Exists(path) ? File.ReadAllText(path) : null);
}
```

*(compiled)*. Alternatively ship them as `Resources/deeptip/en.json` and read `Resources.Load<TextAsset>("deeptip/en").text`. Parse with Newtonsoft `JObject.Parse` and walk `Properties()` in order (§1.1): entries are objects whose `title`, `short` or `body` is a `JTokenType.String`. Validate the same files with `tools/deeptip-check.mjs`.

## 9. Pitfalls

- **C# version**: Unity 6 compiles C# 9: no file-scoped namespaces, no `record` or `init` without an own `IsExternalInit`; nullable annotations only inside `#nullable enable`. The API level is .NET Standard 2.1.
- **Porting the pure functions** *(checked with the port that passed the 24 cases)*: JavaScript and .NET whitespace differ at U+0085 and U+FEFF (write an own `IsJsSpace`); .NET `$` matches before a final `\n` (use `\z`) and `.` matches U+2028; `IndexOf(string)` without `StringComparison.Ordinal` is culture-sensitive; placement in `double`. Details in the [Avalonia guide, section 9](../avalonia/README.md#9-porting-the-pure-functions-c-pitfalls-checked).
- **Stale `textInfo`** after setting `text`: `ForceMeshUpdate()` before hit-testing in the same frame (the Valheim mod hit-tests from the next frame on).
- **Wrong camera** for `FindIntersectingLink` and `WorldToScreenPoint`: null for overlay canvases, the root canvas's `worldCamera` otherwise.
- **Scaled time**: `Time.time` stops in a pause menu; use unscaled time.
- **Click after a long-press**: clear `eligibleForClick` (section 7.2); a component on the same object cannot stop the `Button`'s own click handler otherwise.
- **Selection**: without a `Selectable` on the window root, gamepad navigation keeps moving through the game UI while a window is focused; give pin and close buttons `Navigation.Mode.None` and walk them with the window's own focus index.
- **Sorting**: another overlay canvas with a higher `sortingOrder` covers the windows.
- **Domain reload off**: reset statics (section 3).
- **Distribution as a package**: a UPM package installed from a git URL is immutable, and Unity ignores assets in it that have no committed `.meta` file; commit the metas, or install from disk.

## 10. Testing

### 10.1 Parity cases ([§11](../../docs/algorithms.md#11-testing-with-testcases))

`DeepTip.Core` has no engine references, so its files also compile in a plain .NET test project: `<Compile Include="../Assets/DeepTip/Core/**/*.cs" />` with `<LangVersion>9.0</LangVersion>`, run with `dotnet test`, no editor needed. The tests themselves are the same as in the [Avalonia guide, section 10.1](../avalonia/README.md#101-parity-cases-11). In the Unity Test Runner (EditMode, NUnit) the same tests read the case files from the repository path (an environment variable, or a copy in a folder whose name ends with `~`, which Unity does not import). With Newtonsoft *(checked)*:

- the AST: `JToken.DeepEquals(expected, actual)` ignores key order; build `"text"` as `JValue.CreateNull()` for links without own text, a missing property is not equal to `null`;
- placement: compare numbers as `double` (`(double)expected["x"] == actual.X`): `DeepEquals` treats the integer `192` from the file and the double `192.0` as different;
- glossary: keys and metadata keys in file order, number of problems.

### 10.2 Behaviour

Drive `DeepTipHost` with an injected clock and pointer from PlayMode tests, or compare by hand with the web example (`npm run demo`): rest, previews, pinning chains, grace while moving into a window, suppression of crossed terms, Esc and Shift+Esc, F1 on a selected element.

## 11. The example to build

A script that builds the scene in code (no scene asset): an `EventSystem` with the matching input module, a game `Canvas` with a HUD row of TMP buttons, each with a `DeepTipAnchor`: `demo.realm`, `demo.stability` (click: −3 … +3, live value `{stability}`), `demo.taxes` (click: low/normal/high, adds gold), `demo.nobles`, `demo.gold` (live value `{gold}`), a help button `deeptip.about` with `delay = 0`, a language button (`de`, `en`; fallback chain `["de", "en"]`, so `demo.prestige` and `demo.gold` show the `DE` badge in English), four corner buttons (`demo.province`, `demo.prestige`, `demo.revolt`, `demo.unrest`) for placement at the screen edges, a page text with terms (`DeepTipText`) and the encyclopedia (`DeepTipIndex`: a scroll view with a `TMP_InputField` for the search). Glossaries copied to `StreamingAssets/deeptip/core/{locale}.json` and `StreamingAssets/deeptip/example/{locale}.json` from `glossary/core` and `glossary/example`.

## 12. Limitations compared with the web reference

- **Screen readers** only through Unity's accessibility hierarchy on the platforms Unity supports for it; uGUI elements are not accessible by themselves.
- **Esc** cannot be withheld from code that polls input itself; the game has to ask (section 7.3).
- **Touch**: no context menu exists to suppress; vibration has a fixed length.
- **Gamepad mapping** with the Input Manager differs per platform and controller; prefer the Input System.

## 13. Checklist

1. `DeepTip.Core` with `flatten`, `parseText`, `computePlacement`, the glossary and live values; pass `test/cases` (section 10.1).
2. Overlay canvas, `TipWindowView`, `TmpMarkup`, term hit-testing (section 4); placement (section 6).
3. `DeepTipHost` frame loop, clicks, long-press, keys, Esc flag, gamepad, focus (sections 7, 4.5).
4. The example (section 11); compare with the web example by hand; look at the Valheim mod for a complete implementation.
5. Then list the framework with its state in the main README.
