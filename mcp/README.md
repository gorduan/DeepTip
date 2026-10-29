# DeepTip MCP server

`deeptip-mcp.mjs` gives every MCP client (Claude Code, Claude Desktop, Cursor, VS Code with Copilot, Windsurf, Zed, Continue, Cline, Gemini CLI, OpenAI Codex …) direct access to DeepTip: the pattern and its rules, the specification, the algorithms, every framework guide, framework detection for a project, the glossary validator and an entry builder.

- One file, JavaScript (ES module), Node 18 or newer, **no dependencies**.
- **Read-only**: it reads the DeepTip repository it sits in (the parent folder of `mcp/`) and the folders a client names. It never writes files and never uses the network.
- Transport: stdio, one JSON-RPC 2.0 message per line.

```bash
node mcp/deeptip-mcp.mjs              # how MCP clients start it
node mcp/deeptip-mcp.mjs --version
node --test mcp/test/mcp.test.mjs     # the tests
```

It needs a clone of this repository: the tools serve the files in it. In the snippets below, `/path/to/DeepTip` stands for that clone.

## Protocol

The server follows the **MCP specification, revision [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)**, the current revision ([versioning](https://modelcontextprotocol.io/specification/versioning)). That revision made MCP stateless: there is no `initialize` handshake any more, every request carries its protocol version and the client's capabilities in `_meta`, and clients may ask `server/discover` first ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). Clients built for 2025-11-25 and earlier open with `initialize` (the official MCP Inspector still does by default, see [protocol eras](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/protocol-eras)), so the server is *dual-era* as the specification allows ([backward compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning#backward-compatibility-with-initialization-based-versions)):

| The client sends | The server answers |
|---|---|
| `initialize` | the [handshake](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle) of 2025-11-25, 2025-06-18, 2025-03-26 or 2024-11-05: the requested version, otherwise 2025-11-25; then every request of that connection, and `ping` |
| a request with `_meta["io.modelcontextprotocol/protocolVersion"]` and `_meta["io.modelcontextprotocol/clientCapabilities"]` | that request on its own as 2026-07-28: `server/discover`, results with `resultType: "complete"` and `_meta["io.modelcontextprotocol/serverInfo"]`, [caching hints](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) `ttlMs` and `cacheScope: "public"` on lists, reads and discovery |
| neither (no handshake, no `_meta`) | error `-32602` that says what to send; only `ping` works without both |

`server/discover` lists the versions `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` and the capabilities `tools`, `resources` and `prompts` (no list-change notifications, no subscriptions, no logging, no completions). The server sends no requests of its own (no sampling, elicitation or roots).

| Situation | Answer |
|---|---|
| a line is not JSON | `-32700`, without `id` |
| not a JSON-RPC 2.0 request, `id` is `null`, empty batch | `-32600` |
| unknown method; `ping` with 2026-07-28 `_meta` (that revision removed it); `server/discover` in an `initialize` session without `_meta` | `-32601` |
| `params` not an object, missing `_meta` field, unknown tool, `arguments` not an object, unknown prompt or prompt argument, any `cursor` (every list fits on one page) | `-32602` |
| `_meta` names an unknown version, or a version up to 2025-11-25 outside an `initialize` session (inside one it is only extra metadata) | `-32022` with `data: { supported, requested }` |
| unknown resource URI | `-32602` with 2026-07-28 `_meta`, `-32002` in an `initialize` session (the code of that era), with `data: { uri }` |
| unexpected failure | `-32603` |
| invalid tool arguments, a path that does not exist, an unknown framework or section | a tool result with `isError: true` and the reason, so the model can correct its call |

Notifications get no answer. `notifications/cancelled` stops a running `check_glossary` and its response is never sent. A JSON-RPC batch (only revision 2025-03-26 had them) is answered as a batch. Nothing is written to stdout except MCP messages; stderr only carries unexpected internal errors. The server ends when its stdin closes ([stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)).

## Tools

All tools only read (`readOnlyHint: true`). Tools marked *structured* return `structuredContent` that matches their `outputSchema`, and the same JSON as text ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)).

| Tool | Arguments | Returns |
|---|---|---|
| `deeptip_overview` | – | what DeepTip is, its rules and the framework table with the signals for picking one (from `skill/deeptip/SKILL.md`), plus the steps with this server |
| `list_frameworks` | – | *structured*: `frameworks[]` with `name`, `title`, `language`, `tier`, `kind` (`runtime`/`adapter` = ready code, `guide` = exact build guide), `status`, `version`, `uses`, `guide` (resource URI) |
| `get_guide` | `framework`, `section`? | `frameworks/<name>/README.md`, whole or one section |
| `get_spec` | `section`? | `SPEC.md`, whole or one section |
| `get_algorithms` | `section`? | `docs/algorithms.md`, whole or one section |
| `detect_framework` | `path` | *structured*: ranked `candidates[]` with `framework`, `title`, `kind`, `confidence` (`high`, `medium`, `low`) and `reasons`; `scanned`; `hint` |
| `check_glossary` | `files[]`, `base`?, `scan`?, `core`? | *structured*: `ok`, `errors`, `warnings`, `entries`, `locales`, `base`, `files`, `scan`, `findings[]` (`level`, `where`, `msg`) |
| `new_glossary_entry` | `key`, `title`, `short`, `body`?, `aliases`?, `see`?, `note`?, `locale`? | *structured*: `valid`, `entry`, `snippet` (to paste into `deeptip/<locale>.json`), `file` (a complete file with this entry), `links`, `live_values`, `problems[]` |
| `get_example_glossary` | `locale` | `glossary/example/<locale>.json` |

- **Sections**: a number (`"2.4"`, `"§8"`, `"7"`) or heading text (`"Placement"`; exact title first, then the start of a title, then any part). The section comes with its subsections; headings inside code blocks do not count. An unknown section returns the list of sections as a tool error.
- **Framework names** are the folder names of `frameworks/` (offered as `enum`); the server also accepts a unique part or title (`egui`, `Unity`, `rpg maker mz`). Only folders with `deeptip.json` and `README.md` count.
- **Paths** should be absolute. Relative paths are resolved against the server's working directory, which the client chooses. `~/…`, `file://…` and, on Windows, `/c/…` work too. A path that does not exist is a tool error.
- **`detect_framework`** looks at the folder and four levels below it. It skips hidden folders, `node_modules`, `dist`, `build`, `out`, `target`, `bin`, `obj`, Unity's and Unreal's generated folders and Python environments, follows no symbolic links, visits at most 20 000 entries and reads at most 400 files of up to 512 KB. Its signals are those of the framework table in `skill/deeptip/SKILL.md` plus its close relatives (WPF, MAUI, PyQt6, Android Compose, RPG Maker MV), and `<UseWPF>`, `<UseWindowsForms>` and `ratatui` for the WPF, Windows Forms and ratatui folders once they have a guide: for example `project.godot`, `*.uproject`, `ProjectSettings/ProjectVersion.txt`, `js/rmmz_core.js`, `egui`/`eframe` in `Cargo.toml`, `gioui.org` in `go.mod`, `org.jetbrains.compose` in Gradle files, an `Avalonia` package or `assembly_valheim` in a `.csproj`, `.razor`, `.svelte` and `.vue` files, `react`/`vue`/`svelte`/`electron`/`@tauri-apps` in `package.json`, `tsconfig.json`, imports of `PySide6`, `javax.swing` and `SwiftUI`, `imgui.h`.
- **`check_glossary`** runs `tools/deeptip-check.mjs --json` with the same Node in a child process (time limit 120 s). With `core` (default `true`) the core glossary `glossary/core/<locale>.json` comes first for every locale of the given files, as the runtimes load it and as the documented check does; set `core: false` when the project does not ship it. `scan` is a source folder: keys used there must exist.
- **`new_glossary_entry`** checks the key (`^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$`, project prefix, no parts made only of digits), `short` (one line, at most 140 characters), link and markup syntax with the reference parser, links to itself and HTML. Once the entry is in a file, `check_glossary` shows whether the keys it links to exist.

## Resources and prompt

| Resource | Content |
|---|---|
| `deeptip://spec` | `SPEC.md` |
| `deeptip://algorithms` | `docs/algorithms.md` |
| `deeptip://skill` | `skill/deeptip/SKILL.md` |
| `deeptip://schema` | `schema/deeptip.schema.json` (`application/schema+json`) |
| `deeptip://frameworks/<name>` | `frameworks/<name>/README.md`, one resource per framework; also the template `deeptip://frameworks/{name}` |

A fragment (`deeptip://algorithms#9-input`) is ignored; the whole document comes back.

The prompt **`add-deeptip`** (arguments `framework`? and `locale`?, both optional) gives the model the steps to add DeepTip to the current project: detect the framework, read its guide, build it the way the guide's kind says, write the glossary, mark the elements, run `check_glossary`, and the checklist of the skill.

In Claude Code, resources are referenced as `@deeptip:deeptip://spec`, and the prompt is listed as `/deeptip:add-deeptip` (`/mcp__deeptip__add-deeptip` runs it too) ([source](https://code.claude.com/docs/en/mcp)). Which clients show resources and prompts differs; the tools work in every client.

## Install

Every client starts the server with `node /path/to/DeepTip/mcp/deeptip-mcp.mjs`. `node` must be on the `PATH`, otherwise write its full path. On Windows write paths with forward slashes (`C:/Users/you/DeepTip/mcp/deeptip-mcp.mjs`) or with doubled backslashes inside JSON and TOML strings. Sources as of October 2026.

### Claude Code

```bash
claude mcp add --transport stdio --scope user deeptip -- node /path/to/DeepTip/mcp/deeptip-mcp.mjs
```

`--scope user` makes it available in all your projects, `--scope local` (the default) only in the current one for you, `--scope project` writes `.mcp.json` into the project root to share with the team. `.mcp.json` by hand:

```json
{
  "mcpServers": {
    "deeptip": { "type": "stdio", "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

Source: [Claude Code, MCP](https://code.claude.com/docs/en/mcp).

### Claude Desktop

Settings → Developer → Edit Config opens `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`). Add the server, with an absolute path, then quit and restart Claude Desktop:

```json
{
  "mcpServers": {
    "deeptip": { "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

Source: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

### Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json` for all projects:

```json
{
  "mcpServers": {
    "deeptip": { "type": "stdio", "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

Source: [Cursor, MCP](https://cursor.com/docs/context/mcp).

### VS Code (GitHub Copilot)

`.vscode/mcp.json` in the workspace (VS Code's own format: the top-level key is `servers`):

```json
{
  "servers": {
    "deeptip": { "type": "stdio", "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

Or into your user profile from the command line:

```bash
code --add-mcp '{"name":"deeptip","type":"stdio","command":"node","args":["/path/to/DeepTip/mcp/deeptip-mcp.mjs"]}'
```

Copilot's portable user file `~/.copilot/mcp-config.json` takes the `mcpServers` form shown for Cursor. Sources: [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), [MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers).

### Windsurf (Devin Desktop)

Windsurf has been called Devin Desktop since 2 June 2026 ([FAQ](https://docs.devin.ai/desktop/devin-desktop-faq)). In the Cascade panel, open the `…` menu at the top right and click *Open MCP config file* in the MCPs section, then add:

```json
{
  "mcpServers": {
    "deeptip": { "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

The MCP page names the file `~/.config/devin/mcp_config.json` (Windows: `%APPDATA%\devin\mcp_config.json`), the FAQ `~/.codeium/mcp_config.json`; opening it from the panel finds the one your installation reads. Sources: [Cascade MCP](https://docs.devin.ai/desktop/cascade/mcp) (the former `docs.windsurf.com/windsurf/cascade/mcp` redirects there), [Devin Desktop FAQ](https://docs.devin.ai/desktop/devin-desktop-faq).

### Zed

In `settings.json` (command palette: `zed: open settings file`), or Settings → AI → MCP Servers → Add Server → Add Local Server:

```json
{
  "context_servers": {
    "deeptip": { "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"], "env": {} }
  }
}
```

Source: [Zed, Model Context Protocol](https://zed.dev/docs/ai/mcp).

### Continue

`.continue/mcpServers/deeptip.yaml` in the workspace:

```yaml
name: DeepTip
version: 1.0.0
schema: v1
mcpServers:
  - name: deeptip
    type: stdio
    command: node
    args:
      - /path/to/DeepTip/mcp/deeptip-mcp.mjs
```

A JSON file in the Claude Desktop or Cursor format in the same folder works too. Continue uses MCP only in agent mode. Source: [Continue, MCP](https://docs.continue.dev/customize/deep-dives/mcp).

### Cline

The MCP Servers icon in the Cline panel → Configure → *Configure MCP Servers* opens `cline_mcp_settings.json` (Cline CLI: `~/.cline/data/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "deeptip": { "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"], "disabled": false, "autoApprove": [] }
  }
}
```

Source: [Cline, configuring MCP servers](https://docs.cline.bot/mcp/configuring-mcp-servers).

### Gemini CLI

```bash
gemini mcp add --scope user deeptip node /path/to/DeepTip/mcp/deeptip-mcp.mjs
```

Without `--scope user` it goes into the project's `.gemini/settings.json`. By hand, in `~/.gemini/settings.json` or `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "deeptip": { "command": "node", "args": ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"] }
  }
}
```

Source: [Gemini CLI, MCP servers](https://geminicli.com/docs/tools/mcp-server/).

### OpenAI Codex

```bash
codex mcp add deeptip -- node /path/to/DeepTip/mcp/deeptip-mcp.mjs
```

Or in `~/.codex/config.toml` (or `.codex/config.toml` of a trusted project); the CLI, the IDE extension and the app share it:

```toml
[mcp_servers.deeptip]
command = "node"
args = ["/path/to/DeepTip/mcp/deeptip-mcp.mjs"]
```

Source: [Codex, MCP](https://developers.openai.com/codex/mcp) (redirects to `learn.chatgpt.com/docs/extend/mcp`).

## Tests

```bash
node --test mcp/test/mcp.test.mjs
```

The tests start the server like a client does and talk to it over stdio: the `initialize` handshake and `ping`; every tool with valid and invalid arguments, its structured result checked against its `outputSchema`; `detect_framework` on generated projects (React with TypeScript, Godot 4 and 3, Unity, egui, WPF, PySide6, Valheim, depth limit, `node_modules` skipped); `check_glossary` on the example glossaries and on broken files; every resource, the template and the prompt; the stateless 2026-07-28 requests with `server/discover`, caching hints and their errors; malformed JSON-RPC, batches, notifications, cancellation, and the exit when stdin closes.
