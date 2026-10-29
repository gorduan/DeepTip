# DeepTip in Valheim (BepInEx mod)

Guide: how [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md) is built into a game that already has its own tooltips, using Valheim as the example. The finished mod is **DeepTip** on Thunderstore (plugin `GC_Valheim_DeepTip`, GUID `gorduan.deeptip`); its C# source lives in its own repository, https://github.com/gorduan/Valheim_DeepTip. This repository keeps only HTML, CSS, JS and Rust code, so the Valheim implementation is described here, not copied.

Read [docs/algorithms.md](../../docs/algorithms.md) for the shared algorithms; this guide covers what is specific to a Unity game with uGUI and TextMeshPro. The [Unity guide](../unity/README.md) covers a Unity project you own; here you only patch a finished game.

## Quick start

**Recognise the project:** a BepInEx plugin (a `[BepInPlugin]` class) whose `.csproj` references `assembly_valheim.dll`; DeepTip runs beside it as its own mod.

1. Install the mod **DeepTip** from Thunderstore (GUID `gorduan.deeptip`) into the profile you test with, and reference its `GC_Valheim_DeepTip.dll`.
2. Ship your entries as `deeptip/en.json` (and `deeptip/de.json` …) inside your plugin's folder under `BepInEx/plugins`: DeepTip loads every `deeptip/` folder there, no code needed.
3. Give entries `aliases` with the exact words of the game's texts: DeepTip links their first occurrence in Valheim's tooltips and Compendium pages.
4. Mark your own UI elements through the soft dependency below; the whole API is in [API for other mods](#api-for-other-mods).
5. Validate: `node <DeepTip>/tools/deeptip-check.mjs --base en deeptip/en.json deeptip/de.json`.

```csharp
using System.Runtime.CompilerServices;
using BepInEx;
using BepInEx.Bootstrap;
using UnityEngine;

[BepInPlugin("you.mymod", "My Mod", "1.0.0")]
[BepInDependency("gorduan.deeptip", BepInDependency.DependencyFlags.SoftDependency)]
public class MyMod : BaseUnityPlugin
{
    public static void Explain(GameObject button)           // call once your button exists
    {
        if (Chainloader.PluginInfos.ContainsKey("gorduan.deeptip")) Mark(button);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]              // compiled only when DeepTip is installed
    static void Mark(GameObject button) => DeepTip.Api.Mark(button, "deeptip.about");
}
```

**Done when:** with DeepTip installed resting the mouse on your button for 0.5 s opens the *DeepTip* window next to it, hovering *terms* in it opens *Highlighted term* beside it and never on top, a click pins both windows and `Esc` closes the newest, your entries appear on the lexicon page of the Compendium, without DeepTip your mod still loads.

## Architecture

| DeepTip part | In Valheim |
|---|---|
| Glossary (§1) | Pure C# (no Unity types): a small JSON reader (the game ships no JSON library), layers with priorities: built-in data (embedded resources), files from every `deeptip/` folder under `BepInEx/plugins` (any mod ships `deeptip/en.json`, `deeptip/de.json` without code), API calls, then the user's own files in `BepInEx/config/DeepTip/` (they win). |
| Locale chain | Valheim's language (`Localization.instance.GetSelectedLanguage()`, polled once a second) mapped to codes (`German` → `de`, `Portuguese_Brazilian` → `pt-br` …); chain `[code, its base language, en, de]`. |
| Markup (§2, §3) | Parsed to the AST and rendered to TextMeshPro rich text: terms as `<link="dt:key"><color=#F6C453>label</color></link>`, plain text wrapped in `<noparse>` when it contains `<`, `<b>`, `<i>`, colored code and values, `• ` bullets. The `dt:` prefix keeps other mods' links apart (EpicLoot uses `<link="elrare…">`). |
| Valheim's own tooltips | Not replaced but **adopted**: `UITooltip` still creates and fills its tooltip object (so EpicLoot's scrolling tooltip and other mods' additions stay), DeepTip only changes its behaviour (below). |
| Glossary windows | Own uGUI windows on a separate overlay `Canvas` (sorting order 30000), scaled like Valheim's GUI (copy `GuiScaler`'s `CanvasScaler.scaleFactor` every frame), look taken from Valheim's tooltip prefab (background sprite, TMP font and colors). Manual layout with `TMP_Text.GetPreferredValues`, header (title, fallback badge, pin, close), body, "See also", hint, a `RectMask2D` viewport for scrolling. |
| Terms under the pointer | `TMP_TextUtilities.FindIntersectingLink(text, pointer, camera)` every frame over the hovered window's texts; link boxes from `textInfo.characterInfo` for anchors of page terms. |
| Auto-linking (§10) | Glossary `aliases` (exact words of the game texts in that language) highlighted in Valheim's tooltip texts and Compendium pages: first occurrence per key, longest alias first, whole words, never inside tags or existing links. |
| Encyclopedia (§12) | A page "DeepTip lexicon" in Valheim's Compendium (`TextsDialog`), grouped by namespace, with a TMP input field for search. |

The pure C# parts (JSON reader, glossary, markup parser, placement) use no Unity types, so a `dotnet` console or test project runs them against `test/cases/*.json` outside the game, as [§11](../../docs/algorithms.md#11-testing-with-testcases) describes; the [Avalonia guide](../avalonia/README.md#101-parity-cases-11) shows such tests in C#.

## Patches (Harmony)

| Target | Change |
|---|---|
| `UITooltip.OnHoverStart` (prefix) | While the pointer heads into the open tooltip (`heading`, §5), defer the new element's tooltip (suppression); when another element takes over Valheim's single tooltip object, drop the adopted window record first. |
| `UITooltip.LateUpdate` (prefix) | For the current tooltip: count the show timer with DeepTip's `delay` (cancel when the pointer left before), show it and **adopt** it as a root window; skip the original (no following the mouse, no hide on leave). |
| `UITooltip.LateUpdate` (postfix, after EpicLoot, lowest priority) | Re-apply DeepTip's placement every frame (EpicLoot moves the tooltip beside the cursor in its own postfix). |
| `UITooltip.OnPointerExit` (prefix) | Skip: DeepTip's grace time and tendency decide when to close. |
| `UITooltip.UpdateTextElements` (postfix) | Link the terms in the new text; close unpinned children of the adopted window. |
| `UITooltip.HideTooltip` (postfix) | Drop the adopted window record unless DeepTip itself is hiding it. |
| `ZInput.GetKeyDown(KeyCode, bool)` (prefix) | The first query for Esc in a frame lets DeepTip close the newest window; the game's queries in that frame see no Esc while a pinned window was open (with previews only, Esc also reaches the game). |
| `ZInput.GetKey/GetKeyUp/GetButton*` (prefix) | While the lexicon's search field has focus, the game sees no keys (typing "i" must not close the inventory). |
| `TextsDialog.UpdateTextsList` / `ShowText` (postfix) | Add the lexicon page; render it; link terms on the other pages; register the page text so its terms open windows. |

## The adopted tooltip

- Pinning it **copies** the tooltip object (`Object.Instantiate`) and hides the original, so Valheim can show the next tooltip while the pinned copy stays; runtime-added button listeners are not copied and must be wired again.
- On top of the tooltip's panel (first child of the tooltip object; with EpicLoot its scroll view) DeepTip adds a transparent blocker image (so clicks inside never reach the slot behind it), pin and close icons, an outline for the pinned frame and the lock bar, all with `LayoutElement.ignoreLayout`.
- Placement: compute next to the element's `RectTransform` (sides `right, left, bottom, top` suit inventory grids), convert screen boxes with `RectTransformUtility.WorldToScreenPoint` (y up → y down), move the tooltip object by the difference between the panel's current and target top-left corner.
- Gamepad and touch keep Valheim's own tooltip behaviour (the patches only act in mouse mode).

## Input

Mouse: rest (0.5 s like Valheim), hover terms, click pins (via an `IPointerClickHandler` on the windows and registered page texts), pin and close buttons. Keyboard: `F1` opens the window of what is under the mouse pinned (a term, a window, Valheim's tooltip, a marked element), `Esc` closes the newest, `Shift+Esc` or holding Esc closes all. Mouse wheel scrolls the window under the pointer.

## API for other mods

`DeepTip.Api`: `Register(owner, json, locale)`, `RegisterFolder(owner, folder)`, `Unregister(owner)`, `Mark(gameObject, key, sides, delay)`, `Open(key, rectTransform, pinned)`, `CloseAll()`, `Render(markup)`, `Link(tmpText)`, `AttachLinks(tmpText)`, `SetValue(name, provider)`, `Refresh()`, `Has/Title/Short(key)`, events `Opened`, `Closed`, `Pinned`, `Changed`. Mods use it softly (`[BepInDependency("gorduan.deeptip", SoftDependency)]` or reflection). All calls are safe on a dedicated server (no windows there).

## Pitfalls found on the way

- Valheim reuses one tooltip object for every element: a window record must be dropped (not destroyed) when Valheim retargets it.
- The game reads keys through `ZInput` (new Input System); use it, not `UnityEngine.Input`.
- `TMP_Text.textInfo` is updated after the text is rendered; link hit-testing works from the next frame on.
- Without a sprite, a `Filled` image does not fill: create a plain white sprite in code for bars.
- Dedicated servers have no graphics (`Application.isBatchMode`, `GraphicsDeviceType.Null`): load the glossary, skip the patches.
