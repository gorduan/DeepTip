# DeepTip in Unreal Engine 5 (C++ plugin, Slate + UMG)

Guide: how to build [DeepTip](https://github.com/gorduan/DeepTip/blob/main/README.md), nested and pinnable explanation windows, as an Unreal Engine 5 plugin: a runtime module with the core in C++, Slate widgets for the windows, a subsystem for the window tree, UMG widgets and a Blueprint API for designers. This repository keeps code only in HTML, CSS, JavaScript and Rust, so the plugin is described here precisely instead of being shipped. The shared algorithms are in [docs/algorithms.md](../../docs/algorithms.md), cited as [§1] to [§12]; the contract is [SPEC.md](../../SPEC.md). This guide covers only what is specific to Unreal.

Every engine name below was checked against the source of **Unreal Engine 5.8.3** (`Engine/Source` of the binary release).

**Download:** `DeepTip-cpp-unreal-1.0.0.zip` holds this guide together with `SPEC.md`, `docs/algorithms.md`, `schema/`, the shared glossaries and the parity cases `test/cases/`, in the repository layout, so every relative link below works. **Status:** documented, not built in this repository.

## 1. Plugin layout

```
Plugins/DeepTip/
  DeepTip.uplugin
  Resources/Icon128.png, Pin.svg, Close.svg            icons: PIN_PATH and CLOSE_PATH of frameworks/web/deeptip.js
  Resources/Glossary/core/en.json, de.json             copy of glossary/core
  Resources/Glossary/example/en.json, de.json          copy of glossary/example
  Resources/TestCases/markup.json, placement.json, glossary.json   copy of test/cases
  Source/DeepTip/DeepTip.Build.cs
  Source/DeepTip/Public/    DeepTipSubsystem.h  DeepTipSettings.h  DeepTipText.h  DeepTipIndex.h
  Source/DeepTip/Private/   DeepTipModule.cpp
                            Core/   DeepTipGlossary  DeepTipMarkup  DeepTipPlacement  DeepTipController   (no Slate types)
                            Slate/  SDeepTipLayer  SDeepTipWindow  SDeepTipTerm  DeepTipStyle  DeepTipRichText
                            DeepTipInputProcessor
                            Tests/  DeepTipParityTests.cpp
```

```json
{
  "FileVersion": 3,
  "Version": 1,
  "VersionName": "1.0.0",
  "FriendlyName": "DeepTip",
  "Description": "Nested, pinnable explanation windows (Paradox-style tooltips) from JSON glossaries.",
  "Category": "UI",
  "Modules": [{ "Name": "DeepTip", "Type": "Runtime", "LoadingPhase": "Default" }]
}
```

```csharp
using System.IO;
using UnrealBuildTool;

public class DeepTip : ModuleRules
{
    public DeepTip(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore", "Slate", "SlateCore", "UMG", "DeveloperSettings" });
        PrivateDependencyModuleNames.AddRange(new[] { "Json", "Projects", "ApplicationCore" });
        // the glossaries are plain files: stage them so packaged games can read them through the Unreal file system
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "Resources/Glossary/core/*.json"), StagedFileType.UFS);
        RuntimeDependencies.Add(Path.Combine(PluginDirectory, "Resources/Glossary/example/*.json"), StagedFileType.UFS);
    }
}
```

## 2. Architecture

| Part | Unreal class | Job |
|---|---|---|
| Glossary, parser, placement | plain C++ in `Core/` with `FString`, `TArray`, `TMap` | [§1], [§2], [§8] |
| Controller | `FDeepTipController`, plain C++ | window tree [§4], hot set, grace, tendency, suppression [§5], arming [§6], timer lock [§7], input state machine [§9]; boxes in layer space, time in milliseconds |
| Subsystem | `UDeepTipSubsystem : UGameInstanceSubsystem` | owns glossary, controller, style set, layer and input processor; Blueprint API and events |
| Input | `FDeepTipInputProcessor : IInputProcessor` | sees every input event before any widget; per-frame tick after input |
| Layer | `SDeepTipLayer` (an `SCanvas` over the whole game viewport) | holds the windows in creation order, places them every frame |
| Window | `SDeepTipWindow : SCompoundWidget` | header, body, "See also", hint, lock bar, flash |
| Term | `SDeepTipTerm : SButton` | a focusable term that carries its key |
| Page text, encyclopedia | `UDeepTipText`, `UDeepTipIndex` (UMG `UWidget`s) | terms in designers' widgets; [§12] |
| Options | `UDeepTipSettings : UDeveloperSettings` | SPEC §7 options in Project Settings → Plugins → DeepTip |

Keep the controller free of Slate types. It holds most of the rules and can then be tested with a fake clock in plain automation tests.

**Where the windows live.** Game UI: one full-viewport layer added with `UGameViewportClient::AddViewportWidgetContent(Layer, ZOrder)`. UMG's `UUserWidget::AddToViewport(Z)` adds its widgets with `Z + 10`, so a layer Z-order of 10000 stays above ordinary HUDs. Editor tools (no game viewport): one popup `SWindow` per DeepTip window (`.Type(EWindowType::ToolTip)` for previews or `EWindowType::Menu`, `.IsPopupWindow(true)`, `.SizingRule(ESizingRule::Autosized)`, `.FocusWhenFirstShown(false)`, `.ActivationPolicy(EWindowActivationPolicy::Never)` for previews), added with `FSlateApplication::Get().AddWindowAsNativeChild(Window, Parent)` and moved with `SWindow::MoveWindowTo`; the window tree then belongs in a `UEditorSubsystem`. The rest of this guide describes the game layer.

## 3. SPEC concept → Unreal

| SPEC concept | Unreal primitive |
|---|---|
| UI element with a key (web: `data-deeptip`) | `UDeepTipSubsystem::Mark(UWidget* Widget, FString Key, int32 DelayMs, FString Place)` (Blueprint) or `MarkSlate(TSharedRef<SWidget>, ...)` (C++). Stored weakly: `TWeakObjectPtr<UWidget>`, `TWeakPtr<SWidget>`. Resolve the Slate widget of a UMG widget every time with `UWidget::GetCachedWidget()`, because UMG rebuilds Slate widgets. |
| Term | `SDeepTipTerm`, an `SButton` subclass: focusable, clicked by mouse, Enter or gamepad A, with the label in an `STextBlock`. It is created for `<dt key="...">label</>` runs by `SRichTextBlock::WidgetDecorator(TEXT("dt"), ...)` (section 6). |
| Window | `SDeepTipWindow`: `SBox` (width and height limits) → `SBorder` with an `FSlateRoundedBoxBrush` → header (title, badge, pin and close `SButton`s), body (`SScrollBox` of `SRichTextBlock`s), "See also", hint, lock bar. |
| Top layer | The layer's `SCanvas`: later slots are painted on top, so adding each new window as the last slot keeps creation order. The canvas is `EVisibility::SelfHitTestInvisible`, so it never blocks the game; windows are `Visible`. |
| Window tree, timers, events | `UDeepTipSubsystem` (one per game instance, so one per PIE session; Blueprints get it with the automatic "Get DeepTip Subsystem" node). |
| `schedule(ms, f)` | A due time in milliseconds against `FSlateApplication::Get().GetCurrentTime() * 1000.0`, checked once per frame in the input processor's `Tick`. Slate time is real time: DeepTip keeps working while the game is paused or time is dilated. Do not use `FTimerManager` (world time). |
| Pointer | `FSlateApplication::Get().GetCursorPos()` (absolute desktop pixels), `FPointerEvent::GetScreenSpacePosition()`, `FPointerEvent::IsTouchEvent()` (touch starts arrive as mouse-button-down events with that flag). |
| What is under the pointer (`closest()`) | `FWidgetPath Path = SlateApp.LocateWindowUnderMouse(SlateApp.GetCursorPos(), SlateApp.GetInteractiveTopLevelWindows());` then walk `Path.Widgets` from the last (deepest) entry to the first: the first `SDeepTipTerm` is the term, the first `SDeepTipWindow` the window, the first marked widget the element (used only when there is neither window nor term). Recognise widgets by `SWidget::GetType()` or by a set of live pointers. |
| Input before the application | `FDeepTipInputProcessor`, registered with `FSlateApplication::Get().RegisterInputPreProcessor(Processor, EInputPreProcessorType::PreGame)` (runs before the default `Game` bucket). `HandleKeyDownEvent` returning `true` consumes the key: neither widgets nor the game see it. |
| Coordinates and DPI scale | All DeepTip math in the layer's local space (Slate units, y down): points with `LayerGeometry.AbsoluteToLocal(...)`, boxes from both corners (section 7), viewport = `LayerGeometry.GetLocalSize()`. The DPI scale is part of the geometries; values in viewport pixels convert with `UWidgetLayoutLibrary::GetViewportScale(WorldContext)`. |
| Window size | `View->SlatePrepass(LayerGeometry.Scale)` then `View->GetDesiredSize()`. Limits through the window's `SBox` (`SetMaxDesiredWidth`, `SetMaxDesiredHeight`) and `SRichTextBlock::SetWrapTextAt`. |
| Focus [§9] | `FSlateApplication::Get().SetUserFocus(UserIndex, Widget, EFocusCause::Navigation)`. The focused window is the one whose `HasAnyUserFocusOrFocusedDescendants()` is true. |
| Gamepad navigation | Slate's own: A (`EKeys::Gamepad_FaceButton_Bottom`, "Accept") clicks the focused term, d-pad and stick move the focus. `SDeepTipWindow::OnNavigation` returns `FNavigationReply::Wrap()` so focus stays in the window and wraps at its edges. |
| `data-dt-open` (hide your own tooltip) | `IsOpenFor(UWidget*)` (BlueprintPure): hide the widget's own `ToolTipText` while it is true. |
| `data-dt-arming` (rest progress) | `GetArmingProgress(UWidget*)` (0 to 1) for the host's own feedback; optionally the layer draws a 2 px line under the anchor box. |
| Timer lock bar [§7], flash [§4] | Lock: a 2 px bar at the window's bottom edge whose width follows the elapsed fraction. Flash: a 3 px accent outline for 600 ms (a second brush or `FSlateDrawElement::MakeBox` in `OnPaint`). |
| Live values [§1] | `SetValue(FName, FText)` into a map, read when a window is built; call `Refresh()` after changes (rebuilds open windows, [§4]). |
| Encyclopedia [§12] | `UDeepTipIndex`: an `SSearchBox` and one row per entry (term, short line, backlinks). Sort with `FText::CompareTo(Other, ETextComparisonLevel::Primary)` (base letters: ignores case and accents; uses the game's current culture). |
| Accessibility (SPEC §6) | Slate accessibility where the platform supports it (`WITH_ACCESSIBILITY`): `SetAccessibleBehavior(EAccessibleBehavior::Custom, Text)` on the window with title and body as plain text; terms are buttons with their label. |

## 4. Data structures

```cpp
#include "Internationalization/LocKeyFuncs.h"   // FLocKeyMapFuncs: case-sensitive FString map keys

struct FDeepTipEntry { FString Title, Short, Body; bool bHasTitle = false, bHasShort = false, bHasBody = false;
                       TArray<FString> Aliases, See; };
using FDeepTipEntryMap = TMap<FString, FDeepTipEntry, FDefaultSetAllocator, FLocKeyMapFuncs<FDeepTipEntry>>;

struct FDeepTipGlossary {                                  // [§1]
  TMap<FString, FDeepTipEntryMap> Data;                    // locale -> key -> entry
  TMap<FString, TMap<FString, FString>> Labels;            // locale -> $ui
  FString Locale = TEXT("en");
  TArray<FString> Fallback = { TEXT("en") };
};

struct FDeepTipInline {                                    // [§2], the shapes of test/cases/markup.json
  enum class EKind : uint8 { Text, Br, Bold, Italic, Code, Link, Var };
  EKind Kind = EKind::Text;
  FString V;                                               // text, code, link key or variable name
  TOptional<FString> Label;                                // link text; unset = "text": null
  TArray<FDeepTipInline> C;                                // children of Bold and Italic
};
struct FDeepTipBlock { bool bList = false; TArray<FDeepTipInline> C; TArray<TArray<FDeepTipInline>> Items; };

struct FDeepTipAnchor {                                    // what a window belongs to
  TWeakObjectPtr<UWidget> Widget;                          // a marked UMG widget, or
  TWeakPtr<SWidget> Slate;                                 // a marked Slate widget or a page term, or
  int32 TermWindow = 0; FString TermKey;                   // a term in window TermWindow: re-attaches by key [§4]
};
enum class EDeepTipVia : uint8 { Api, Hover, Click, Key, Pad, Touch };
struct FDeepTipWindow {                                    // [§4]
  int32 Id = 0; FString Key; int32 Parent = 0; TArray<int32> Children; FDeepTipAnchor Anchor;
  bool bPinned = false, bFrozen = false; EDeepTipVia Via = EDeepTipVia::Api;
  double CloseDue = 0, LeaveSince = 0, FlashUntil = 0;     // milliseconds; 0 = not running
  FSlateRect Box;                                          // layer space, last placement
  FVector2D Position, Size;                                // read by the canvas slot attributes
  TSharedPtr<SDeepTipWindow> View;
  bool bFocusRequest = false;                              // applied after the window was painted once
};
```

The controller keeps the windows in one `TArray`, oldest first, plus the hover triple `{Window, Term, Element}`, the pending hover `{Anchor, bIsTerm, Parent, Key, Since, Due, Delay}`, the pointer samples `{X, Y, T}` in layer space, and the press, swipe, swallow, lock and hold states of [§6], [§7] and [§9].

## 5. Order of operations

**Startup** (`UDeepTipSubsystem::Initialize`):

1. Copy the options from `GetDefault<UDeepTipSettings>()`.
2. Load the glossaries [§1]: for each locale of the chain, for each entry of `Sources` (templates with `{locale}`, relative to the plugin's base dir `IPluginManager::Get().FindPlugin(TEXT("DeepTip"))->GetBaseDir()`), in order: core first, project after.
3. Build the `FSlateStyleSet` (text styles and brushes, section 8) and register it with `FSlateStyleRegistry::RegisterSlateStyle`.
4. If `FSlateApplication::IsInitialized()` (not on dedicated servers or in commandlets): create the input processor and register it with `EInputPreProcessorType::PreGame`.
5. The layer is added lazily, in the first frame where `GetGameInstance()->GetGameViewportClient()` exists: `AddViewportWidgetContent(Layer, Settings->LayerZOrder)`.

**Shutdown** (`Deinitialize`): close all windows, `UnregisterInputPreProcessor`, `RemoveViewportWidgetContent`, `FSlateStyleRegistry::UnRegisterSlateStyle`. Live Coding and hot reload re-run both, so nothing may stay registered twice.

**Every Slate frame**, inside `FSlateApplication::Tick`:

```
TickPlatform            OS messages → FDeepTipInputProcessor::Handle...Event   (events, below)
FinishedInputThisFrame  → FDeepTipInputProcessor::Tick                          (steps 1-5)
TickAndDrawWidgets      prepass → SDeepTipLayer::Tick (step 6) → arrange → paint
```

| Event (input processor) | DeepTip | Returns |
|---|---|---|
| `HandleMouseMoveEvent` | not touch: append a sample [§5] (converted to layer space); a long-press of this pointer that drifted more than 10 px ends | `false` |
| `HandleMouseButtonDownEvent` | resolve the target at `GetScreenSpacePosition()` (same walk as step 2); pointer down [§9]: hush, outside click, long-press start, swipe start; remember the window for "click inside a preview" | `false` |
| `HandleMouseButtonUpEvent` | end the press of this pointer; finish a swipe; a release inside the same preview, not on a control, pins it | `false` |
| `HandleKeyDownEvent` | Esc, F6, F1, gamepad Y, B, LB, RB (section 9) | `true` when DeepTip acted |
| `HandleKeyUpEvent` | gamepad B released before 600 ms: close the newest window | `true` if its key down was consumed |

`FDeepTipInputProcessor::Tick`, after all input of the frame:

1. `Now = SlateApp.GetCurrentTime() * 1000.0`; add the layer if it is still missing.
2. Hover: unless the last pointer was touch or the cursor is hidden, find the path under the cursor and walk it (section 3). Only a path in this game instance's window counts (`Path.GetWindow()` equals `GetGameViewportClient()->GetWindow()`), otherwise several PIE windows react to each other's pointer. If the triple differs from the previous frame, run "on pointer over" [§6]; an invalid path runs "pointer leaving the application surface".
3. Anchors that disappeared [§4]: a root anchor whose widget is gone (`!Widget.IsValid()`, `GetCachedWidget()` null, or `FSlateApplication::Get().FindWidgetWindow(...)` null) closes the window if it is a preview and freezes it if it is pinned.
4. Due timers: grace ticks [§5], the pending hover [§6], the long-press [§9], the lock [§7], the Esc and B holds.
5. Focus requests of windows that have been painted at least once: `SetUserFocus` on the first term, else on the window (section 9).

`SDeepTipLayer::Tick` (step 6), which Slate calls after the prepass and right before arranging and painting; for every window, oldest first:

1. Target box in layer space: the parent's `Box` for children; for roots the anchor's geometry (section 7); a frozen root keeps its box.
2. Size = `View->GetDesiredSize()`.
3. Place it [§8]; with `maxW` or `maxH` set the limits, `View->SlatePrepass(AllottedGeometry.Scale)`, read the size again and place again with the chosen side only.
4. Write `Position`, `Size` and `Box` into the window record. The canvas slot reads them through attributes: `Canvas->AddSlot().Position(TAttribute<FVector2D>::CreateLambda(...)).Size(...)[View]`.

**Opening** a window maps [§4] like this: build the `SDeepTipWindow` (section 6) → add it as the last canvas slot → mark the anchor open (`IsOpenFor`) → pin it before its first placement (pinned windows have no hint line) or set the preview state → `SetAccessibleBehavior` → request focus if asked → refresh the hot set → `OnOpen.Broadcast(Key)`. **Closing**: children first, cancel the timers, `Canvas->RemoveSlot(View.ToSharedRef())`, unmark the anchor, focus back to the anchor with `SetUserFocus` when the focus was inside, `OnClose.Broadcast(Key)`.

## 6. Rendering the AST in Slate [§3]

Every block becomes one `SRichTextBlock` (lists: an `SHorizontalBox` with a "•" `STextBlock` in a 1.2 em column and the item's `SRichTextBlock`). The text of each block is Unreal's rich-text markup, built from the AST:

| AST node | Unreal rich-text markup |
|---|---|
| text | the escaped text; inside bold or italic `<dt.b>…</>`, `<dt.i>…</>` or `<dt.bi>…</>` |
| br | a newline |
| code | `<dt.code>…</>` |
| var | `<dt.var>value</>`, the value escaped |
| link to the window's own key | `<dt.b>label</>` (`dt.bi` inside italic) |
| link to a missing key | `<dt.missing>label</>`, one warning |
| link | `<dt key="demo.taxes">label</>`, made into an `SDeepTipTerm` by the decorator |

- **Tags do not nest.** The default parser (`FDefaultRichTextMarkupParser`) matches `<name attr="v">content</>` lazily up to the first `</>`, so emit one run per text node with the combined style name.
- **Escape** every piece of glossary text and every value: `&` → `&amp;`, `"` → `&quot;`, `<` → `&lt;`, `>` → `&gt;` (the parser's escape table). Keys never need escaping (`[A-Za-z0-9_.-]`).
- **Styles:** `.TextStyle(&Normal)` and `.DecoratorStyleSet(&DeepTipStyle)`; runs named `dt.b`, `dt.i`, `dt.bi`, `dt.code`, `dt.var`, `dt.missing` take the `FTextBlockStyle` of that name from the style set.
- **Wrapping:** `.WrapTextAt(ContentWidth)` with the width computed in section 7. `AutoWrapText` wraps at the width of the previous frame, which makes an autosizing window jitter.

The term decorator. The baseline is requested lazily, as UMG's `FRichTextDecorator` does, because the font may not be loaded yet:

```cpp
TSharedRef<ITextDecorator> MakeTermDecorator(TWeakPtr<FDeepTipController> Controller, int32 WindowId, const FTextBlockStyle* LinkStyle)
{
  return SRichTextBlock::WidgetDecorator(TEXT("dt"), FWidgetDecorator::FCreateWidget::CreateLambda(
    [Controller, WindowId, LinkStyle](const FTextRunInfo& Run, const ISlateStyle*) -> FSlateWidgetRun::FWidgetRunInfo
    {
      TSharedRef<SDeepTipTerm> Term = SNew(SDeepTipTerm).Controller(Controller).Window(WindowId)
        .Key(Run.MetaData.FindRef(TEXT("key"))).Label(Run.Content).TextStyle(LinkStyle);
      const FSlateFontInfo Font = LinkStyle->Font;
      return FSlateWidgetRun::FWidgetRunInfo(Term, TAttribute<int16>::CreateLambda([Font]
      {
        return FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->GetBaseline(Font);
      }));
    }));
}
```

`SDeepTipTerm`: a custom `FButtonStyle` with `FSlateNoResource` brushes, zero padding and no sounds, `.ContentPadding(0)` (the default `SButton` adds `FMargin(4, 2)` and a button frame), `.ClickMethod(EButtonClickMethod::DownAndUp)`; `OnClicked` calls `follow` [§9]. It overrides `OnKeyDown` to note that a click comes from the keyboard or gamepad (`FSlateApplication::Get().GetNavigationActionFromKey(Event) == EUINavigationAction::Accept`) before calling `SButton::OnKeyDown`, so `follow` moves the focus in; and `OnKeyChar` to treat "?" like F1. Its hover, open and focus states only change the text colour, the underline and a background (section 8).

**The built-in hyperlink decorator.** `SRichTextBlock::HyperlinkDecorator(TEXT("dt"), FSlateHyperlinkRun::FOnClick)` handles `<a id="dt" key="..." style="...">label</>`; it wraps like text, and its `FOnClick` receives the run's attributes (`Metadata["key"]`). But it has no hover callback, and the `SRichTextHyperlink` widgets it creates carry no key that the pointer walk could read (its tooltip delegates run when the run is laid out, not on hover). It suits a click-only first version. Full behaviour needs the widget decorator above; the price is that a term never breaks across lines.

**Window content** in [§3] order: header row (title `STextBlock` in bold, `WrapTextAt` = the content width minus badge and buttons, as the web title wraps; fallback badge `SBorder` with `.ToolTipText(label("fallback"))`, pin button, close button), body `SScrollBox` with the blocks, "See also" (`label("seeAlso")` and the terms separated by ", " in one `SRichTextBlock`), hint `STextBlock` (hidden when pinned or after touch input), lock bar.

## 7. Placement [§8], DPI and geometry

- **Space:** the layer's local space (`AllottedGeometry` in `SDeepTipLayer::Tick`): Slate units, y down, the DPI scale already applied. The viewport is `AllottedGeometry.GetLocalSize()`.
- **Anchor box of a UMG or Slate widget:** `const FGeometry& G = Widget->GetTickSpaceGeometry();` then `TopLeft = AllottedGeometry.AbsoluteToLocal(G.LocalToAbsolute(FVector2f(0, 0)))` and `BottomRight = AllottedGeometry.AbsoluteToLocal(G.LocalToAbsolute(G.GetLocalSize()))`. Widgets inside a retainer box or with a render transform: use `GetPaintSpaceGeometry()`.
- **Pointer samples:** `LayerGeometry.AbsoluteToLocal(Event.GetScreenSpacePosition())` with the layer's `GetTickSpaceGeometry()`, so samples and boxes share one space [§5].
- **Compute in `double`** (the parity cases compare exact values); `GAP` 8 and `MIN_SHRINK` 120 are Slate units.
- **Natural size:** prepass with `WrapTextAt(0)` to get the unwrapped width, clamp it to [240, 384] plus paddings, set `WrapTextAt` to the resulting content width, prepass again. With `maxW`: wrap at `maxW` minus paddings; with `maxH`: `SBox::SetMaxDesiredHeight`, the body scrolls in its `SScrollBox`.
- **Every frame:** the layer re-places every window that is not frozen, so windows follow moving anchors and viewport resizes.

## 8. Look (from `frameworks/web/deeptip.css`)

Slate units equal pixels at DPI scale 1. Slate font sizes are points at 96 DPI (px = pt × 96 / 72), so the reference's 14 px text is size 10.5.

| Part | Value |
|---|---|
| Window | min width 240, max width 384, max height 480; `FSlateRoundedBoxBrush(Background, 8.0f, Border, 1.0f)`; pinned: the same brush with the accent as outline colour; shadow optional |
| Text | `FCoreStyle::GetDefaultFontStyle("Regular", 10.5f)` (Roboto); line height 1.5 (`SRichTextBlock::LineHeightPercentage` 1.5) |
| Styles | `dt.b` "Bold", `dt.i` "Italic", `dt.bi` "BoldItalic", `dt.code` "Mono" (DroidSansMono) at 0.92 em, `dt.var` "Bold", `dt.missing` regular in the missing colour; all typefaces of the engine's default font |
| Header | padding 12 6 6 2 (left top right bottom); title "Bold"; badge 0.7 em, 1 px outline, radius 3, opacity 0.65 |
| Buttons | 26 × 26 (40 × 40 on touch), icon 15 (18 on touch) from `Pin.svg` and `Close.svg` as `FSlateVectorImageBrush`; opacity 0.6, 1 on hover or focus; the pin icon in the accent colour when pinned |
| Body | padding 12 0 12 10; 0.5 em after each block; lists indented 1.2 em |
| "See also" | padding 12 0 12 10; 0.9 em; label opacity 0.7 |
| Hint | padding 12 4 12 6; 0.75 em; opacity 0.6; 1 px line above |
| Lock bar | 2 px at the bottom edge, accent colour |
| Colours (light / dark) | background `#ffffff` / `#1b1e24`, text `#1f2328` / `#e6e8ec`, border `#c8cdd5` / `#3b414d`, accent (pinned, focus) `#0b69d4` / `#58a6ff`, link `#0b69d4` / `#6cb6ff`, link hover `#084f9f` / `#9ccfff`, missing `#dd3333`. Hex colours are sRGB: convert with `FColor::FromHex(...)` or `FLinearColor::FromSRGBColor`, not `FLinearColor(r, g, b)` |
| Motion | open: opacity 0 → 1 over 150 ms (`SetRenderOpacity` driven by an `FCurveSequence`); none with the option `bReducedMotion` |

## 9. Input details [§9]

- **Esc** (`EKeys::Escape`), only while windows are open: with `IsShiftDown()` close all; an `IsRepeat()` event at least 600 ms after the first press closes all; a first press closes the newest window below the focused one (`SlateApp.GetUserFocusedWidget(Event.GetUserIndex())` → its window). Return `true`: Slate's own "Back" navigation and the game never see that Esc.
- **F6** (`EKeys::F6`), Shift+F6: cycle the windows; consumed while windows are open.
- **F1** (`EKeys::F1`): the focused widget is a term → `follow` with focus; a marked widget outside windows → open it pinned with focus. Consumed only then. **"?"**: `IInputProcessor` receives no character events, so "?" works on terms (`SDeepTipTerm::OnKeyChar`) but not on host widgets; there F1 and gamepad Y remain.
- **Gamepad:** Y (`EKeys::Gamepad_FaceButton_Top`) like F1. B (`EKeys::Gamepad_FaceButton_Right`): on the first key down with windows open remember the time and consume it; held 600 ms (checked in `Tick`) closes all; released earlier closes the newest. LB, RB (`EKeys::Gamepad_LeftShoulder`, `EKeys::Gamepad_RightShoulder`): cycle, consumed while windows are open. A and the d-pad are Slate navigation (section 3).
- **Mouse:** terms and buttons click through their `SButton`; "click inside a preview" through the down and up events (section 5).
- **Touch:** no hover and no samples. The long-press fires after `longPress`: call `FSlateApplication::Get().ReleaseAllPointerCapture()`, so the pressed `SButton` gets `OnMouseCaptureLost`, releases itself and does not click on the following release (the swallow of [§9]); then open the window pinned. Vibration: platform force feedback, for example `APlayerController::PlayDynamicForceFeedback` on the local player controller, if the platform maps it to the device.
- **Focus:** opening by keyboard or gamepad focuses the first term, else the window (`SupportsKeyboardFocus` must be true). Slate can only focus a widget it can find a path to, so apply the request after the window has been painted once (step 5 of the frame).
- **Input mode:** the player controller must show the cursor and route the mouse to the UI (`bShowMouseCursor = true`, `SetInputMode_GameAndUIEx` or `SetInputMode_UIOnlyEx`). In game-only mode, or while the viewport captures the mouse, there is no hover.

## 10. Loading the JSON [§1]

The engine's Json module reads the files; `FFileHelper::LoadFileToString` decodes files without a byte order mark as UTF-8.

```cpp
bool UDeepTipSubsystem::LoadGlossary(const FString& FilePath, const FString& InLocale)
{
  FString Text;
  TSharedPtr<FJsonObject> Root;
  if (!FFileHelper::LoadFileToString(Text, *FilePath)
      || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root.IsValid())
  {
    UE_LOG(LogDeepTip, Warning, TEXT("DeepTip: cannot load %s"), *FilePath);
    return false;
  }
  const FString Locale = InLocale.IsEmpty() ? LocaleOf(*Root, FilePath) : InLocale;   // $locale, else the file name
  Glossary.Add(Locale, *Root);       // flatten [§1] over Root->Values, set the entries, merge $ui
  Controller->Refresh();
  return true;
}
```

- **Order:** [§1] walks objects in file order. `FJsonObject::Values` is a `TMap`; a `TMap` that never had an element removed iterates in insertion order, and the reader inserts in file order. A duplicate key keeps its first position with the last value, like JavaScript.
- **Case:** `FJsonObject` keys compare case-insensitively (since 5.8 they are `UE::FSharedString`, before that `FString`; both ignore case). Two keys that differ only in case become one entry, where the reference keeps two. Keep keys unique regardless of case, or read the files with your own small JSON reader.
- **Storage:** `FString`'s `==` and the default `TMap<FString, ...>` hashing also ignore case; store entries in a map with `FLocKeyMapFuncs` (section 4) and compare keys with `Equals(Other, ESearchCase::CaseSensitive)`.
- **Text:** glossary texts are data: create `FText` with `FText::FromString`, never `LOCTEXT`, and keep them out of the localization gatherer.
- **Locale from the file name:** the last dot-separated part before `.json` (`de.json` → `de`, `myapp.de.json` → `de`).
- **Packaging:** files in `Resources/Glossary` are staged by the `RuntimeDependencies` lines (section 1). A project's own glossary in `Content/DeepTip/` needs **Project Settings → Packaging → Additional Non-Asset Directories to Package** (`DirectoriesToAlwaysStageAsUFS`, path `DeepTip`) and is found at `FPaths::ProjectContentDir() / TEXT("DeepTip")`.

## 11. Porting the parser to `FString` [§2]

| Reference (JavaScript) | Unreal |
|---|---|
| string indices (UTF-16 code units) | identical: `TCHAR` is 16 bits on Windows, Linux, Mac, Android and iOS, unless a project switches to UTF-8 `TCHAR` (`PLATFORM_TCHAR_IS_UTF8CHAR`) |
| `\s` and `trim()` | an own `IsJsSpace(TCHAR)`: U+0009 to U+000D, U+0020, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Not `FChar::IsWhitespace` (it calls `iswspace`) and not `FString::TrimStartAndEnd` |
| `indexOf` | `Find(TEXT("]]"), ESearchCase::CaseSensitive, ESearchDir::FromStart, From)`; the default of `Find`, `StartsWith` and `Contains` is `IgnoreCase` |
| `KEY_RE`, `VAR_RE` | hand-written character checks; avoid `FRegexPattern` (ICU syntax, its `\s` differs from JavaScript) |
| `text: null` | `TOptional<FString>` |

## 12. Blueprint and C++ API

Functions of `UDeepTipSubsystem` (`UFUNCTION(BlueprintCallable, Category = "DeepTip")` unless marked pure):

| Function | Does |
|---|---|
| `LoadGlossary(FilePath, Locale = "")` → bool | add one file as a layer [§1] |
| `AddGlossaryJson(Locale, Json)` → bool | the same from a string (a data asset, a download) |
| `SetLocale(Locale, Fallback)` | the chain; rebuilds open windows |
| `Mark(Widget, Key, DelayMs = -1, Place = "")`, `Unmark(Widget)` | mark a UMG widget; `Place` like `"top,bottom"` |
| `Open(Key, Anchor, bPinned = false, bFocus = false)` → window id | open from code |
| `Close(WindowId)`, `CloseAll()`, `Pin(WindowId)`, `Unpin(WindowId)` | window control [§4] |
| `SetValue(Name, Value)`, `Refresh()` | live values `{name}` |
| `IsOpenFor(Widget)`, `GetArmingProgress(Widget)` (pure) | hooks for the host widget |
| `HasEntry(Key)`, `GetTitle(Key)`, `GetShort(Key)` (pure) | simple tooltips and lists from the same data |
| events `OnOpen(Key)`, `OnClose(Key)`, `OnPin(Key)` | `UPROPERTY(BlueprintAssignable)`, `DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FDeepTipKeyEvent, const FString&, Key)` |

UMG widgets: **DeepTip Text** (`UDeepTipText`, property `Markup`: page text with terms; its `RebuildWidget` creates the same `SRichTextBlock` setup as a window body) and **DeepTip Index** (`UDeepTipIndex`, the encyclopedia). For existing `URichTextBlock`s, a `URichTextBlockDecorator` subclass whose `FRichTextDecorator::CreateDecoratorWidget` returns an `SDeepTipTerm` gives the same terms (their styles then come from the block's `TextStyleSet` data table).

`UDeepTipSettings` (`UCLASS(config = Game, defaultconfig)`): every SPEC §7 option under its reference name and default (`DelayMs` 800, `LinkDelayMs` 80, `CloseDelayMs` 300, `LockAfterMs` 0, `LongPressMs` 500, `bCloseButtons`, `bPinButton`, `bHints`, `bClickInsidePins`, `OutsideClickCloses` Never/Touch/Always, `RootSides`, `ChildSides`, `bGamepad`, `bVibrate`), plus `Sources`, `Locale`, `Fallback`, `LayerZOrder` (10000) and `bReducedMotion`.

## 13. Example

A HUD widget like the web example (`frameworks/web/example/index.html`), with the shared glossaries from `Resources/Glossary` loaded through `Sources = ["Resources/Glossary/core/{locale}.json", "Resources/Glossary/example/{locale}.json"]`:

```cpp
void UDeepTipDemoWidget::NativeConstruct()       // a UUserWidget with buttons bound by name (meta = (BindWidget))
{
  Super::NativeConstruct();
  UDeepTipSubsystem* DeepTip = GetGameInstance()->GetSubsystem<UDeepTipSubsystem>();
  DeepTip->SetLocale(TEXT("en"), { TEXT("de"), TEXT("en") });   // English shows prestige and gold from German, with a DE badge
  DeepTip->Mark(RealmButton, TEXT("demo.realm"));
  DeepTip->Mark(StabilityButton, TEXT("demo.stability"));
  DeepTip->Mark(TaxesButton, TEXT("demo.taxes"));
  DeepTip->Mark(NoblesButton, TEXT("demo.nobles"));
  DeepTip->Mark(GoldButton, TEXT("demo.gold"));
  DeepTip->Mark(HelpButton, TEXT("deeptip.about"), /*DelayMs=*/0);
  DeepTip->Mark(ProvinceButton, TEXT("demo.province"));          // the four corner buttons test placement at the edges
  DeepTip->Mark(PrestigeButton, TEXT("demo.prestige"));
  DeepTip->Mark(RevoltButton, TEXT("demo.revolt"));
  DeepTip->Mark(UnrestButton, TEXT("demo.unrest"));
  StabilityButton->OnClicked.AddDynamic(this, &UDeepTipDemoWidget::CycleStability);   // the buttons keep their own action
  TaxesButton->OnClicked.AddDynamic(this, &UDeepTipDemoWidget::CycleTaxes);
  UpdateValues();
}

void UDeepTipDemoWidget::UpdateValues()
{
  UDeepTipSubsystem* DeepTip = GetGameInstance()->GetSubsystem<UDeepTipSubsystem>();
  DeepTip->SetValue(TEXT("stability"), FText::FromString(Stability > 0 ? FString::Printf(TEXT("+%d"), Stability) : FString::FromInt(Stability)));
  DeepTip->SetValue(TEXT("gold"), FText::AsNumber(Gold));        // grouping of the current culture
  DeepTip->Refresh();
}
```

Stability cycles −3 to +3; taxes cycle low, normal, high and add 50, 120 or 260 gold. The same in Blueprint: Event Construct → "Get DeepTip Subsystem" → "Set Locale" → one "Mark" per button; the buttons' On Clicked events change the values, then "Set Value" and "Refresh". Add a **DeepTip Text** with the web example's intro text and a **DeepTip Index**. The player controller shows the cursor and uses "Set Input Mode Game And UI".

## 14. Building and tests [§11]

**Compile the plugin** for the editor and the game targets, without a project of your own:

```
"<UE>\Engine\Build\BatchFiles\RunUAT.bat" BuildPlugin -Plugin="<abs>\DeepTip\DeepTip.uplugin" -Package="<abs>\Out\DeepTip" -TargetPlatforms=Win64
```

`-StrictIncludes` additionally builds without precompiled headers and unity files, which finds missing includes.

**Parity cases** as automation tests in `Private/Tests/DeepTipParityTests.cpp`, reading `Resources/TestCases` (or a folder given with `-DeepTipCases=<dir>` and `FParse::Value(FCommandLine::Get(), TEXT("DeepTipCases="), Dir)`):

```cpp
#if WITH_DEV_AUTOMATION_TESTS
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FDeepTipMarkupCases, "DeepTip.Parity.Markup",
  EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::EngineFilter)

bool FDeepTipMarkupCases::RunTest(const FString& Parameters)
{
  const TSharedPtr<FJsonObject> Doc = DeepTipTests::LoadCases(TEXT("markup.json"));
  for (const TSharedPtr<FJsonValue>& Case : Doc->GetArrayField(TEXT("cases")))
  {
    const TSharedPtr<FJsonObject>& C = Case->AsObject();
    const TSharedRef<FJsonValue> Got = DeepTip::ToJson(DeepTip::ParseText(C->GetStringField(TEXT("src"))));
    TestTrue(C->GetStringField(TEXT("name")), FJsonValue::CompareEqual(*Got, *C->TryGetField(TEXT("blocks"))));
  }
  return true;
}
#endif
```

`DeepTip.Parity.Placement` builds `{side, x, y, fits, maxW, maxH}` as an `FJsonObject` and compares it with `expect` (numbers compare as `double`, exactly); `DeepTip.Parity.Glossary` flattens `input` and compares the key list, the metadata keys and the number of problems. Controller scenarios run the same way against `FDeepTipController` with a fake clock and hand-made boxes: a preview opens after exactly `delay` on an element and `linkDelay` on a term; a second term in the same parent replaces the first preview (invariant 1); clicking a term deep in a chain pins every ancestor (invariant 2); closing a root closes its subtree (invariant 3); the same key further up flashes that window instead of opening (invariant 4); leaving closes after `closeDelay`, but samples heading into the window keep it (re-checked every 90 ms, at most 1.5 s); a term crossed on the way into a preview does not fire while the pointer heads there; with `lockAfter` 1500 resting inside a preview pins it at 1500 ms; Esc closes the newest window below the focused one, Shift+Esc and a 600 ms hold close all; a 500 ms long-press opens pinned and swallows the click, a 10 px drift cancels it.

Run them headless:

```
"<UE>\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "<Project>.uproject" -ExecCmds="Automation RunTests DeepTip" -TestExit="Automation Test Queue Empty" -ReportExportPath="<abs>\DeepTipReport" -unattended -nullrhi -nosplash -log
```

The report folder gets a JSON summary of the results. Behaviour the tests cannot cover is compared by hand with the web example (`npm run demo`).

## 15. Pitfalls

- `FString` `==`, `Find`, `StartsWith`, `Contains`, `TMap<FString, ...>` and `FJsonObject` keys ignore case by default; glossary keys must not (sections 10 and 11).
- UMG rebuilds Slate widgets (`TakeWidget`, removal and re-adding): never keep the `SWidget` of a `UWidget`, resolve it with `GetCachedWidget()` when needed.
- Rich-text tags do not nest, and text must be escaped (section 6).
- `AutoWrapText` in a window that sizes itself jitters by a frame; set `WrapTextAt` explicitly.
- The default `SButton` style adds padding, a frame and press sounds; terms need their own `FButtonStyle`.
- The engine fonts (Roboto, DroidSansMono, DroidSansFallback) may lack symbols the glossaries use (“ ” – − … → ✕ △ ○); check them on screen and add a fallback typeface to a composite font asset if boxes appear.
- With several PIE windows every subsystem's input processor sees all input; filter by the viewport's window (section 5).
- The editor binds F1 while playing in the editor; DeepTip consumes F1 only when it opened something, otherwise the editor gets it.
- Hex colours are sRGB; `FLinearColor(r, g, b)` with sRGB values comes out too light.
- Dedicated servers and commandlets have no Slate: check `FSlateApplication::IsInitialized()` before registering anything.
- Unity builds merge `.cpp` files: put helper functions in a namespace instead of making them `static` with common names.

## 16. Limitations

- A term inside a window is one inline widget and never breaks across lines (section 6).
- "?" opens windows only from terms; host widgets use F1 or gamepad Y (no character events in `IInputProcessor`).
- Vibration on long-press depends on the platform's force-feedback support.
- Screen-reader output depends on Slate's accessibility support on the target platform.
- Keys that differ only in case collapse when read with the engine's Json module (section 10).
- Auto-linking [§10] needs host texts that pass through DeepTip's markup (`UDeepTipText`); plain `UTextBlock`s are not scanned.

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
