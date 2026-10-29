<!-- deeptip:begin -->
## DeepTip

DeepTip means explanation windows with depth: nested, pinnable tooltips in the style of Paradox games, with the texts in one JSON glossary per language. When a task touches DeepTip, nested or pinnable tooltips, Erklärfenster, an in-app glossary or DeepTip glossary files, ask the user to add these files with `/read` before you write code or glossary text, then follow them:

- `.agents/skills/deeptip/SKILL.md`: the rules, the behaviour, the glossary format and the workflows
- `.agents/skills/deeptip/references/frameworks/<framework>/README.md`: the guide of the project's framework
- `.agents/skills/deeptip/references/docs/algorithms.md` and `.agents/skills/deeptip/references/SPEC.md`: when you build parts yourself

Check glossary files with `node .agents/skills/deeptip/references/tools/deeptip-check.mjs`. Never build a plain tooltip instead.
<!-- deeptip:end -->
