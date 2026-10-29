# DeepTip skill for AI agents

`deeptip/` is an [Agent Skill](https://agentskills.io/specification): a folder with a `SKILL.md` that teaches an AI coding agent what DeepTip is and how to build it in any program or language. It covers all 19 frameworks of this repository, systems without a guide, glossary writing and checking. `deeptip/references/` carries the specification, the algorithms, every framework guide, the web runtime, the glossaries, the parity cases and the validator, so the skill works offline once it is installed.

| Part | Content |
|---|---|
| [deeptip/SKILL.md](deeptip/SKILL.md) | the pattern and its rules, the behaviour every implementation keeps, the glossary format, three workflows (add DeepTip to a project, write glossaries, build it where no guide exists), the framework table, a checklist |
| [deeptip/references/](deeptip/references) | a copy of the repository's `SPEC.md`, `docs/algorithms.md`, `frameworks/*/README.md`, web runtime, RPG Maker plugin, glossaries, schema, `test/cases` and tools; made by `npm run skill`, never edited by hand |

## Install

Copy the folder `deeptip` (the whole folder, not only `SKILL.md`) into the skills folder of your agent. Agents that follow the open standard find it there and load it when a task mentions DeepTip or nested tooltips.

| Agent | For you (all projects) | For one project (commit it) |
|---|---|---|
| Claude Code | `~/.claude/skills/deeptip/` | `.claude/skills/deeptip/` |
| OpenAI Codex (CLI, IDE, app) | `~/.agents/skills/deeptip/` | `.agents/skills/deeptip/` |
| GitHub Copilot (CLI, VS Code, cloud agent) | `~/.copilot/skills/deeptip/` or `~/.agents/skills/deeptip/` | `.github/skills/deeptip/` or `.agents/skills/deeptip/` |
| Cursor | `~/.cursor/skills/deeptip/` or `~/.agents/skills/deeptip/` | `.cursor/skills/deeptip/` or `.agents/skills/deeptip/` |
| Gemini CLI | `~/.gemini/skills/deeptip/` or `~/.agents/skills/deeptip/` | `.gemini/skills/deeptip/` or `.agents/skills/deeptip/` |

`~/.agents/skills/` (and `.agents/skills/` in a project) is read by Codex, Copilot, Cursor and Gemini CLI. Together with `~/.claude/skills/` it covers all agents above:

```bash
git clone --depth 1 https://github.com/gorduan/DeepTip
mkdir -p ~/.agents/skills ~/.claude/skills
cp -r DeepTip/skill/deeptip ~/.agents/skills/
cp -r DeepTip/skill/deeptip ~/.claude/skills/
```

Other ways:
- **Claude (claude.ai, desktop app):** download `DeepTip-skill-<version>.zip` from the releases (the zip holds the folder `deeptip/`, as Claude expects), upload it under *Customize → Skills* and turn it on.
- **Gemini CLI:** `gemini skills install https://github.com/gorduan/DeepTip.git --path skill/deeptip --consent`
- **Codex:** ask the built-in skill installer (`$skill-installer`) to install the skill from `https://github.com/gorduan/DeepTip/tree/main/skill/deeptip`.
- **Agents without skill support:** give them [AGENTS.md](../AGENTS.md) or paste the one-page briefing [docs/prompt.md](../docs/prompt.md); language models find the entry point in [llms.txt](../llms.txt).

Update by copying the folder again. The skill uses `node` only for the validator and the sync tool (Node 18+).

Sources for the folders: [Agent Skills specification](https://agentskills.io/specification), [Claude Code](https://code.claude.com/docs/en/skills), [Claude custom skills](https://claude.com/docs/skills/how-to), [Codex](https://learn.chatgpt.com/docs/build-skills), [GitHub Copilot](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills), [Cursor](https://cursor.com/docs/context/skills), [Gemini CLI](https://geminicli.com/docs/cli/skills/) (as of October 2026).

## Maintain

Change the originals (`SPEC.md`, `docs/algorithms.md`, `frameworks/*`, `glossary/*`, `tools/*`), then run `npm run skill`. `npm test` fails while the copy is out of date. `SKILL.md` itself is written by hand: keep it under 500 lines and its frontmatter valid (`name: deeptip` like the folder, `description` at most 1024 characters).
