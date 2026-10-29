# DeepTip skill for AI agents

`deeptip/` is an [Agent Skill](https://agentskills.io/specification): a folder with a `SKILL.md` that teaches an AI coding agent what DeepTip is and how to build it in any program or language. It covers all 48 frameworks of this repository, systems without a guide, glossary writing and checking. `deeptip/references/` carries the specification, the algorithms, every framework guide, the web runtime and its adapters, the glossaries, the parity cases and the validator, so the skill works offline once it is installed.

| Part | Content |
|---|---|
| [deeptip/SKILL.md](deeptip/SKILL.md) | the pattern and its rules, the behaviour every implementation keeps, the glossary format, three workflows (add DeepTip to a project, write glossaries, build it where no guide exists), the framework table (written by `npm run frameworks`), other agents, the MCP server, a checklist |
| [deeptip/references/](deeptip/references) | a copy of the repository's `SPEC.md`, `docs/algorithms.md`, `frameworks/*/README.md`, web runtime, adapters (RPG Maker MZ plugin, jQuery plugin, Phaser adapter, Bootstrap theme), glossaries, schema, `test/cases` and tools; made by `npm run skill`, never edited by hand |

## Install

Keep one copy of the whole folder `deeptip` (not only `SKILL.md`) where your agents look for skills. They load it when a task mentions DeepTip, nested tooltips or an in-app glossary.

| Copy to | Read by |
|---|---|
| `.agents/skills/deeptip/` in a project (commit it) | Codex, GitHub Copilot, Cursor, Gemini CLI, Antigravity, Devin Desktop (Windsurf), Devin, Kilo Code, Roo Code, Zed, Junie, OpenCode, goose, Amp, Qwen Code, Warp, Factory, Auggie, Replit Agent |
| `~/.agents/skills/deeptip/` in your home folder (all projects) | the same, except Antigravity, Devin and Replit Agent |
| `.claude/skills/deeptip/` or `~/.claude/skills/deeptip/` | Claude Code, which does not read `.agents/` |

The installer copies the folder and adds a small pointer for agents with their own format (Cline, TRAE, Kiro, Continue, Augment, JetBrains AI Assistant, Copilot in Visual Studio and JetBrains, Amazon Q, Tabnine, Aider, any agent that reads only `AGENTS.md`):

```bash
git clone --depth 1 https://github.com/gorduan/DeepTip
node DeepTip/tools/install.mjs <project>                               # .agents/skills/deeptip/
node DeepTip/tools/install.mjs <project> --harness claude-code,cline   # plus the files of these agents
node DeepTip/tools/install.mjs --user --harness claude-code            # into your home folder instead
node DeepTip/tools/install.mjs --list                                  # every agent and its files
```

It never replaces a file without keeping the old one as `<file>.bak`; `--dry-run` shows what it would do. Run it again to update. Every agent, chat assistant and local front-end with its files, trigger, limits and sources: [harnesses/README.md](harnesses/README.md).

Other ways:
- **Claude (claude.ai, desktop app):** download `DeepTip-skill-<version>.zip` from the releases (the zip holds the folder `deeptip/`, as Claude expects), upload it under *Customize → Skills* and turn it on.
- **Gemini CLI:** `gemini skills install https://github.com/gorduan/DeepTip.git --path skill/deeptip --consent`
- **Codex:** ask the built-in skill installer (`$skill-installer`) to install the skill from `https://github.com/gorduan/DeepTip/tree/main/skill/deeptip`.
- **Chat assistants and local models:** the knowledge pack in [harnesses/knowledge/](harnesses/knowledge), a condensed `SKILL.md` to paste and the files to upload; any model also takes the one-page briefing [docs/prompt.md](../docs/prompt.md).

The skill uses `node` only for the validator and the sync tool (Node 18+). Format: [Agent Skills specification](https://agentskills.io/specification).

## Maintain

Change the originals (`SPEC.md`, `docs/algorithms.md`, `frameworks/*`, `glossary/*`, `tools/*`), then run `npm run skill`. `npm test` fails while the copy is out of date. `SKILL.md` itself is written by hand: keep it under 500 lines and its frontmatter valid (`name: deeptip` like the folder, `description` at most 1024 characters).
