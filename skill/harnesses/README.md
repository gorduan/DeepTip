# DeepTip for every AI agent and assistant

The Agent Skill [`skill/deeptip`](../deeptip) teaches an AI agent what DeepTip is and how to build it. This folder makes sure every agent finds it: most agents read Agent Skills from `.agents/skills/` on their own, the others get a small pointer in their own format, and chat assistants and local front-ends get a knowledge pack to paste and upload.

## How it works

- **One canonical copy:** `.agents/skills/deeptip/` in the project (or `~/.agents/skills/deeptip/` in your home folder), a copy of `skill/deeptip`. Every agent in the first table that "reads it" loads the skill from there when a task matches its description.
- **Claude Code** reads skills only from `.claude/skills/`, so it gets a second full copy there.
- **Pointers** for agents with their own format: a few lines in that format saying that when DeepTip, nested tooltips, Erklärfenster or an in-app glossary come up, the agent reads `.agents/skills/deeptip/SKILL.md` and follows it, including its `references/`. They use the on-demand mode of each format (a skill description, `inclusion: auto`, `type: agent_requested`, `alwaysApply: false` with a description); where a format only has always-on rules, the pointer stays under 15 lines.
- **Shared files** (`AGENTS.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`, `.aider.conf.yml`) get a block between `deeptip:begin` and `deeptip:end` markers; the rest of the file stays as it is.
- **Knowledge pack** ([knowledge/](knowledge)) for products that cannot read your files: [instructions.md](knowledge/instructions.md) (a condensed `SKILL.md`, at most 8,000 characters), [system-prompt.md](knowledge/system-prompt.md) for small local models (under 1,000 tokens) and the list of files to upload.

## Install

```bash
git clone --depth 1 https://github.com/gorduan/DeepTip
node DeepTip/tools/install.mjs <project>                              # .agents/skills/deeptip/
node DeepTip/tools/install.mjs <project> --harness claude-code,cline  # plus the files of these agents
node DeepTip/tools/install.mjs <project> --all                        # plus the files of every agent below
node DeepTip/tools/install.mjs --user --harness claude-code           # into your home folder instead
node DeepTip/tools/install.mjs <folder> --harness chatgpt --framework react   # a knowledge pack to upload
node DeepTip/tools/install.mjs --list                                 # every harness and its files
```

The installer needs Node 18 or newer and nothing else. It never replaces a file without keeping the old one as `<file>.bak` (then `.bak2`, …), changes only its own block in shared files and never removes anything; `--dry-run` shows what it would do. Run it again after updating DeepTip: changed files are replaced (with a backup), unchanged ones stay.

Without the installer: copy `skill/deeptip` to `.agents/skills/deeptip`, then copy the contents of `skill/harnesses/<harness>/project/` into your project (or of `home/` into your home folder). For a shared file that already exists, paste the block into it.

## Coding agents and IDEs

<!-- generated:agents -->
| Agent | Project | Home folder | Trigger | Install | Limits | Docs |
|---|---|---|---|---|---|---|
| Claude Code | `.claude/skills/deeptip/` (full copy) | `~/.claude/skills/deeptip/` (full copy) | by description; `/deeptip` | `--harness claude-code` | skill list: `description` + `when_to_use` ≤ 1,536 chars; keep `SKILL.md` under 500 lines | [skills](https://code.claude.com/docs/en/skills), [memory](https://code.claude.com/docs/en/memory) |
| OpenAI Codex (CLI, IDE, app) | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `$deeptip` | default | skill list ≤ 2 % of the context window (8,000 chars if unknown) | [skills](https://learn.chatgpt.com/docs/build-skills) |
| GitHub Copilot (cloud agent, CLI, VS Code) | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | not documented | [skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills) |
| GitHub Copilot repository instructions (Visual Studio, JetBrains, github.com) | [`.github/copilot-instructions.md`](copilot-instructions/project/.github/copilot-instructions.md) (block) | — | always (repository-wide instructions) | `--harness copilot-instructions` | not documented | [repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions), [support](https://docs.github.com/en/copilot/reference/custom-instructions-support), [VS Code](https://code.visualstudio.com/docs/agent-customization/custom-instructions) |
| Cursor | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | not documented | [skills](https://cursor.com/docs/skills) |
| Gemini CLI | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | not documented | [skills](https://geminicli.com/docs/cli/skills/) |
| Google Antigravity (app, IDE, CLI) | `.agents/skills/deeptip/` (reads it) | [`~/.gemini/config/skills/deeptip/SKILL.md`](antigravity/home/.gemini/config/skills/deeptip/SKILL.md)<br>[`~/.gemini/antigravity-cli/skills/deeptip/SKILL.md`](antigravity/home/.gemini/antigravity-cli/skills/deeptip/SKILL.md) | by description; `/deeptip` | `--harness antigravity` | not documented for skills | [skills](https://antigravity.google/docs/skills/) |
| Devin Desktop (formerly Windsurf) | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `@deeptip` | default | not documented for skills | [skills](https://docs.devin.ai/desktop/cascade/skills), [rename](https://docs.devin.ai/desktop/devin-desktop-faq) |
| Cline | [`.cline/skills/deeptip/SKILL.md`](cline/project/.cline/skills/deeptip/SKILL.md) | [`~/.cline/skills/deeptip/SKILL.md`](cline/home/.cline/skills/deeptip/SKILL.md) | by description; `/deeptip` | `--harness cline` | `description` ≤ 1,024 chars; `SKILL.md` under 5k tokens | [skills](https://docs.cline.bot/customization/skills) |
| Roo Code | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | `description` ≤ 1,024 chars | [skills](https://roocodeinc.github.io/Roo-Code/features/skills/), [repository](https://github.com/RooCodeInc/Roo-Code) |
| Kilo Code | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | `name` ≤ 64, `description` ≤ 1,024 chars | [skills](https://kilo.ai/docs/customize/skills) |
| Continue | [`.continue/rules/deeptip.md`](continue/project/.continue/rules/deeptip.md) | — | `alwaysApply: false` with `description` (the agent decides) or `globs` `**/deeptip/**` | `--harness continue` | not documented | [rules](https://docs.continue.dev/customize/deep-dives/rules) |
| TRAE | [`.trae/skills/deeptip/SKILL.md`](trae/project/.trae/skills/deeptip/SKILL.md) | [`~/.trae/skills/deeptip/SKILL.md`](trae/home/.trae/skills/deeptip/SKILL.md) | by description | `--harness trae` | not documented | [skills](https://docs.trae.ai/ide/skills), [rules](https://docs.trae.ai/ide/rules) |
| Augment Code (IDE extensions) | [`.augment/rules/deeptip.md`](augment/project/.augment/rules/deeptip.md) | [`~/.augment/rules/deeptip.md`](augment/home/.augment/rules/deeptip.md) | `type: agent_requested` (by description); home: always | `--harness augment` | workspace guidelines + rules ≤ 49,512 chars; user guidelines ≤ 24,576 | [rules](https://docs.augmentcode.com/setup-augment/guidelines), [CLI rules](https://docs.augmentcode.com/cli/rules) |
| Augment Auggie CLI | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | `description` ≤ 1,024 chars | [skills](https://docs.augmentcode.com/cli/skills) |
| Kiro (IDE, CLI) | [`.kiro/steering/deeptip.md`](kiro/project/.kiro/steering/deeptip.md) | [`~/.kiro/steering/deeptip.md`](kiro/home/.kiro/steering/deeptip.md) | `inclusion: auto` (by description) | `--harness kiro` | not documented for steering | [steering](https://kiro.dev/docs/steering/) |
| JetBrains AI Assistant (chat) | [`.aiassistant/rules/deeptip.md`](jetbrains-ai/project/.aiassistant/rules/deeptip.md) | — | *By model decision*, set in the IDE | `--harness jetbrains-ai`, then Settings → Tools → AI Assistant → Rules: set *Rule type* of `deeptip` to *By model decision* with the trigger as *Instruction* | not documented | [rules](https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html) |
| JetBrains Junie | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `/deeptip` | default | not documented | [skills](https://junie.jetbrains.com/docs/agent-skills.html) |
| Amazon Q Developer (IDE plugins) | [`.amazonq/rules/deeptip.md`](amazon-q/project/.amazonq/rules/deeptip.md) | — | always (every rule in the folder; can be switched off per chat) | `--harness amazon-q` | not documented | [project rules](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/context-project-rules.html), [end of support](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/q-developer-ide-end-of-support.html) |
| Zed | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `/deeptip`, `@skill` | default | not documented | [skills](https://zed.dev/docs/ai/skills) |
| OpenCode | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | `description` ≤ 1,024 chars | [skills](https://opencode.ai/docs/skills/) |
| goose | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | not documented | [skills](https://goose-docs.ai/docs/guides/context-engineering/using-skills/) |
| Amp | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description | default | local skill folders are searched 5 levels deep | [skills](https://ampcode.com/docs/customize/skills) |
| Qwen Code | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `/deeptip` | default | not documented | [skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/) |
| Warp | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `/deeptip` | default | not documented | [skills](https://docs.warp.dev/agents/capabilities/skills/) |
| Factory (Droid) | `.agents/skills/deeptip/` (reads it) | `~/.agents/skills/deeptip/` (reads it) | by description; `/deeptip` | default | not documented | [skills](https://docs.factory.com/harness/skills) |
| Devin (cloud) | `.agents/skills/deeptip/` (reads it) | — | by description; `@skills:deeptip` | default | not documented | [skills](https://docs.devin.ai/product-guides/skills) |
| Replit Agent | `.agents/skills/deeptip/` (reads it) | — | by description; `/deeptip` | default | not documented | [skills](https://docs.replit.com/features/agent/skills) |
| Tabnine Agent | [`.tabnine/guidelines/deeptip.md`](tabnine/project/.tabnine/guidelines/deeptip.md) | [`~/.tabnine/guidelines/deeptip.md`](tabnine/home/.tabnine/guidelines/deeptip.md) | always (guidelines) | `--harness tabnine` | keep guidelines to 500 lines or less | [guidelines](https://docs.tabnine.com/main/getting-started/tabnine-agent/guidelines) |
| Aider | [`CONVENTIONS.md`](aider/project/CONVENTIONS.md) (block)<br>[`.aider.conf.yml`](aider/project/.aider.conf.yml) (block) | — | always (loaded with `read:`); the model asks you to `/read` the skill | `--harness aider` | not documented | [conventions](https://aider.chat/docs/usage/conventions.html), [config](https://aider.chat/docs/config/aider_conf.html) |
| AGENTS.md (Google Jules, Lovable and any agent that reads only AGENTS.md) | [`AGENTS.md`](agents-md/project/AGENTS.md) (block) | — | always | `--harness agents-md` | Codex reads 32 KiB of AGENTS.md files, Devin the first 16 KiB of each | [Jules](https://jules.google/docs/), [Lovable](https://docs.lovable.dev/features/knowledge), [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [format](https://agents.md/) |

- **Claude Code:** Reads skills only from `.claude/skills/` (not `.agents/`), so it gets a full copy.
- **GitHub Copilot (cloud agent, CLI, VS Code):** Visual Studio and JetBrains chat use custom instructions: `copilot-instructions`.
- **GitHub Copilot repository instructions (Visual Studio, JetBrains, github.com):** For Copilot chat without skills. Path-specific `*.instructions.md` files load on demand only in VS Code and otherwise need matching files in the chat, so the pointer goes into `.github/copilot-instructions.md`, which every Copilot surface reads.
- **Gemini CLI:** GEMINI.md and extensions are not needed. Since June 2026 Gemini CLI serves Gemini Code Assist and paid API keys; individuals use Antigravity CLI.
- **Google Antigravity (app, IDE, CLI):** Global skills live in `~/.gemini/config/skills/` (app, IDE) and `~/.gemini/antigravity-cli/skills/` (CLI), not in `~/.agents/skills/`.
- **Devin Desktop (formerly Windsurf):** Windsurf became Devin Desktop on 2 June 2026; `.windsurf/` folders still work.
- **Cline:** Reads skills from `.cline/skills/`, `.clinerules/skills/` and `.claude/skills/`, not from `.agents/skills/`.
- **Roo Code:** The GitHub repository is archived (last change on 15 May 2026).
- **TRAE:** TRAE reads `.agents/skills/` only after Settings → Skills & Commands → turning it on; the pointer works without that.
- **Augment Code (IDE extensions):** User rules in `~/.augment/rules/` always apply, so that pointer stays short.
- **Kiro (IDE, CLI):** Kiro CLI V1 and V2 load only `inclusion: always`; V3 supports all four modes. Kiro CLI was Amazon Q Developer CLI.
- **JetBrains AI Assistant (chat):** The rule type is set in the IDE; the docs do not say how it is stored, so the file stays short in case it is always on. Agents hosted in AI Assistant (Codex, Claude Agent) read their own skill folders.
- **JetBrains Junie:** Reads `.agents/skills/` in trusted projects.
- **Amazon Q Developer (IDE plugins):** Support for the IDE plugins ends on 30 April 2027; the successor is Kiro, which also reads `.amazonq/rules`.
- **Tabnine Agent:** The Tabnine CLI is in maintenance mode; its successor is the Tabnine plugin for OpenCode (see OpenCode).
- **Aider:** When `.aider.conf.yml` already has a `read:` key, the installer leaves it alone: add `CONVENTIONS.md` to it yourself.
- **AGENTS.md (Google Jules, Lovable and any agent that reads only AGENTS.md):** Added as a block between `deeptip:begin` and `deeptip:end` markers; the rest of AGENTS.md is kept.
<!-- /generated:agents -->

## Chat assistants and local front-ends

Paste the text, upload the files listed in [knowledge/README.md](knowledge/README.md) (`SPEC.md`, `algorithms.md`, your framework's guide, the glossary schema) and stay within the product's limits. Where a product accepts Agent Skills, upload `DeepTip-skill-<version>.zip` from the [releases](https://github.com/gorduan/DeepTip/releases) instead.

<!-- generated:knowledge -->
| Product | Where | Text | Instructions limit | Files | Skills | Docs |
|---|---|---|---|---|---|---|
| Claude Projects (claude.ai) | Projects → New project → *Set project instructions*; add the files with + in the project knowledge | [instructions.md](knowledge/instructions.md) | not documented | no count limit, 30 MB per file; on paid plans retrieval (RAG) starts when the knowledge outgrows the context | Customize → Skills → + → Create skill → Upload a skill: `DeepTip-skill-<version>.zip` (all plans, code execution on) | [projects](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects), [files](https://support.claude.com/en/articles/8241126-upload-files-to-claude), [skills](https://support.claude.com/en/articles/12512180-use-skills-in-claude) |
| ChatGPT Projects | New project → ••• → Project settings → Instructions; add the files in the project | [instructions.md](knowledge/instructions.md) | not documented | Free 5, Go and Plus 25, Pro, Business, Enterprise and Edu 40 files per project; documents up to 512 MB | Business, Enterprise, Healthcare and Edu: Plugins → Skills → Create → Upload from your computer | [projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt), [skills](https://help.openai.com/en/articles/20001066-skills-in-chatgpt), [GPT retirement](https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq) |
| Gemini app (skills, Gems) | Gems (work and school accounts until 2027): Gems → New Gem → instructions → Knowledge → Add files | [instructions.md](knowledge/instructions.md) | not documented | a Gem takes 10 files (Workspace blog, 2024) | Customize → Skills → Create → upload `SKILL.md`, a folder or a .zip (≤ 100 MB; personal accounts, 18+) | [Gems to skills](https://support.google.com/gemini/answer/18560919), [Gem files](https://workspace.google.com/blog/product-announcements/new-gemini-gems-deeper-knowledge-and-business-context) |
| Mistral Vibe (formerly Le Chat) | New Project → Customize (instructions) → Upload files | [instructions.md](knowledge/instructions.md) | not documented | project limits not documented; Libraries take 100 files per upload, 100 MB each | Vibe Work skills follow the Agent Skills standard: Context → Skills → New Skill | [projects](https://docs.mistral.ai/vibe/work/projects), [skills](https://docs.mistral.ai/vibe/work/skills), [rename](https://help.mistral.ai/en/articles/682992-le-chat-is-now-vibe) |
| Perplexity Projects (formerly Spaces) | Projects → New project → Project settings: instructions and files | [instructions.md](knowledge/instructions.md) | ≤ 8,000 characters | ≤ 10,000 files, 5 GB in total, 100 MB per file, on every plan | a .zip with `SKILL.md` at its root (≤ 20 MB, ≤ 100 files; plans with Computer): zip the contents of the folder `deeptip` | [projects](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-projects), [skills](https://www.perplexity.ai/help-center/en/articles/13914413-how-to-use-computer-skills) |
| Microsoft 365 Copilot (Agent Builder, Notebooks) | Agent Builder: New agent → Configure → Instructions and Knowledge; or a Copilot Notebook: ••• → Instructions, add references | [instructions.md](knowledge/instructions.md) | ≤ 8,000 characters (Agent Builder) | Agent Builder 20 files (Copilot licence or pay-as-you-go); Notebooks 50 references with Copilot Chat, 300 with Microsoft 365 Copilot | Agent Builder skills allow a folder depth of 3; the DeepTip skill is deeper, so use this pack | [Agent Builder](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-builder-build-agents), [knowledge](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-builder-add-knowledge), [skills](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/agent-builder-add-skills), [Notebooks](https://support.microsoft.com/en-us/microsoft-365-copilot/add-references-to-your-microsoft-365-copilot-notebook) |
| Lovable | Project settings → Instructions; or commit `.agents/skills/deeptip/` and the AGENTS.md block (`--harness agents-md`): Lovable always reads a root AGENTS.md | [instructions.md](knowledge/instructions.md) | ≤ 10,000 characters (project and workspace) | — | Workspace settings → Skills → Add → Upload ZIP (≤ 50 MB, ≤ 200 files, 1 MB per file) | [instructions](https://docs.lovable.dev/features/knowledge), [skills](https://docs.lovable.dev/features/skills) |
| Bolt (bolt.new) | Project settings → Knowledge | [instructions.md](knowledge/instructions.md) | not documented | — | Settings → Skills library → Add skill → Import file: `DeepTip-skill-<version>.zip` (≤ 2 MB, skill file ≤ 256 KB) | [knowledge](https://support.bolt.new/prompting/manage-context), [skills](https://support.bolt.new/building/skills) |
| v0 (Vercel) | + in the prompt bar → Instructions → New Instruction (title and rule); tick it to apply it | [instructions.md](knowledge/instructions.md) | not documented | not documented | not documented for uploads | [instructions](https://v0.app/docs/instructions) |
| Ollama | edit `FROM` in the `Modelfile`, then `ollama create deeptip -f Modelfile` and `ollama run deeptip` | [system-prompt.md](knowledge/system-prompt.md)<br>[Modelfile](ollama/Modelfile) | `SYSTEM """…"""` in the Modelfile | no knowledge base: paste a file into the chat, or use a front-end such as Open WebUI; default context 4k tokens below 24 GiB VRAM (`num_ctx`) | — | [Modelfile](https://docs.ollama.com/modelfile), [context length](https://docs.ollama.com/context-length) |
| LM Studio | paste the text as the chat's system prompt and save it as a preset | [system-prompt.md](knowledge/system-prompt.md) | not documented | attach .pdf, .docx or .txt to a chat: in full when it fits the context, else retrieval; default context 8k tokens | — | [presets](https://lmstudio.ai/docs/app/presets), [documents](https://lmstudio.ai/docs/app/basics/rag), [8k default](https://lmstudio.ai/changelog/lmstudio/lmstudio-v0.4.16) |
| Open WebUI | Workspace → Models → Create: base model and system prompt; Workspace → Knowledge → Create → upload, then attach it to the model | [system-prompt.md](knowledge/system-prompt.md) | not documented | retrieval by default, or *Full Context* per knowledge item; `#` references knowledge in a chat | — | [models](https://docs.openwebui.com/features/workspace/models/), [knowledge](https://docs.openwebui.com/features/workspace/knowledge/) |
| AnythingLLM | workspace gear → Chat Settings → System Prompt; upload and embed the files, then pin `SPEC.md` and `algorithms.md` | [system-prompt.md](knowledge/system-prompt.md) | not documented | embedded files are searched; pinned files go into the context in full | — | [chat settings](https://docs.anythingllm.com/features/chat-modes), [documents](https://docs.anythingllm.com/chatting-with-documents/introduction) |
| Jan | Settings → Assistants → + → Instructions; add the files to a project's Files | [system-prompt.md](knowledge/system-prompt.md) | not documented | project files are chunked and indexed for every chat in the project | — | [assistants](https://docs.jan.ai/desktop/assistants), [files](https://docs.jan.ai/desktop/file-upload) |

- **ChatGPT Projects:** Custom GPTs retire on 11 December 2026 and can no longer be created on personal plans.
- **Gemini app (skills, Gems):** Gems of personal accounts become read-only on 17 November 2026 and turn into skills.
- **Mistral Vibe (formerly Le Chat):** Le Chat became Vibe on 12 August 2026; Agents are a legacy feature.
- **Perplexity Projects (formerly Spaces):** Spaces became Projects on 30 July 2026.
- **Lovable:** Knowledge was renamed Instructions on 27 October 2026.
<!-- /generated:knowledge -->

## Not covered

<!-- generated:unsupported -->
| Harness | Why | Docs |
|---|---|---|
| Sourcegraph Cody | Free, Pro and Enterprise Starter ended on 23 July 2025. Cody Enterprise has only an admin-wide pre-instruction and a prompt library, no instruction files in the repository. Its successor Amp reads `.agents/skills/`. | [FAQ](https://sourcegraph.com/docs/cody/faq), [Enterprise features](https://sourcegraph.com/docs/cody/enterprise/features) |
| Microsoft Copilot (free consumer app) | No documented custom instructions, custom assistants or knowledge files, only memory. With a Microsoft 365 subscription use Copilot Notebooks (`m365-copilot`). | [privacy controls](https://support.microsoft.com/en-us/microsoft-copilot/microsoft-copilot-privacy-controls) |
| ChatGPT Custom GPTs | Retire on 11 December 2026; personal plans can no longer create them. Use ChatGPT Projects or skills (`chatgpt`). | [retirement](https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq) |
| Gemini CLI GEMINI.md and extensions | Not needed: Gemini CLI reads `.agents/skills/`. A GEMINI.md or an extension context file would be always on. | [GEMINI.md](https://geminicli.com/docs/cli/gemini-md/) |
| GitHub Copilot prompt files | Not needed: in VS Code skills appear as slash commands too, and prompt files run only in Local harness sessions. | [prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files) |
| Google Antigravity workflows | Stopped working on 19 October 2026; skills replace them. | [workflows](https://antigravity.google/docs/ide/workflows/) |
<!-- /generated:unsupported -->

## Maintain

Everything in this folder except `source.json` and the text of this README around the generated tables is made by `node tools/harness.mjs` from [source.json](source.json); `node tools/harness.mjs --check` exits with 1 while anything is out of date. When `skill/deeptip/SKILL.md` changes behaviour, update `instructions` and `systemPrompt` in `source.json` too. File names, triggers and limits were checked against the official documentation linked in the tables on 29 October 2026. Agents change these often, so follow the links before relying on a limit.
