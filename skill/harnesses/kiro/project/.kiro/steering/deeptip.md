---
inclusion: auto
name: deeptip
description: "DeepTip: explanation windows with depth, the nested and pinnable tooltips of Paradox games (Crusader Kings III, Victoria 3, Europa Universalis V), with one JSON glossary per language and [[key]] links. Use whenever a task mentions DeepTip, DeepTooltip, 3DTooltip, DimTip, nested or pinnable tooltips, tooltips in tooltips, Paradox-style tooltips, Erklärfenster or verschachtelte Tooltips, hover explanations, an in-app glossary or encyclopedia, or DeepTip glossary files (deeptip/<locale>.json), in any language, framework or engine."
---

# DeepTip

DeepTip means explanation windows with depth: nested, pinnable tooltips in the style of Paradox games, with the texts in one JSON glossary per language. When a task touches DeepTip, nested or pinnable tooltips, Erklärfenster, an in-app glossary or DeepTip glossary files:

1. Read `.agents/skills/deeptip/SKILL.md` completely before you write code or glossary text, and follow it.
2. Paths in that file are relative to `.agents/skills/deeptip/`. Read the files in its `references/` folder when it says so: the guide of the project's framework, `docs/algorithms.md`, `SPEC.md`.
3. Check glossary files with `node .agents/skills/deeptip/references/tools/deeptip-check.mjs` (Node 18+); it must report 0 errors.

Never build a plain tooltip instead. If `.agents/skills/deeptip/` is missing, install it from https://github.com/gorduan/DeepTip (`node tools/install.mjs <project>`).
