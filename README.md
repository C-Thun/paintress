<div align="center">
  <img src="assets/icon-512-wordmark.webp" width="200" alt="paintress">
  <p>Design-document operation layer for AI agents</p>
  <p><a href="README.zh-CN.md">中文</a></p>
</div>

**To install: paste this repository's URL into your agent and ask it to install paintress.** Agents that need a precise procedure will find one at the [end of this file](#installation-guide-for-ai-agents).

## What it is

paintress reads and writes structured design documents — JSON files with a documented schema (`.pen`, and its own `.ptr` for anything it writes). It renders them to HTML, serves a local viewer, and exposes the same operations as MCP tools and as a CLI.

It is not an editor. There is no canvas, no drag-and-drop, no property panel. A human looks at the design in a browser and clicks nodes to point at them; the agent does the reading and writing.

| Part | Purpose |
| --- | --- |
| MCP tools | query, read, update, insert, delete, move, batch, validate, render, screenshot |
| CLI | the same operations plus the viewer process, for use without an agent |
| Viewer | local web server: renders a document, highlights changes, hands back clicked nodes as `#1`, `#2`, … |
| Screenshot | PNG of a whole canvas, for agents that can look at images |

## Requirements

Node.js 22 or newer.

## Install

```bash
npm install -g paintress
```

Then register it with the agent(s) you use:

```bash
paintress doctor            # what is installed and which clients already have the entry
paintress install           # write the MCP entry into every detected client config
paintress install pi cursor # or only the ones you name
```

`install` merges a single entry, preserves everything else in the file, and writes a `*.bak-<timestamp>` backup before touching it. Running it twice changes nothing.

## CLI

```text
paintress mcp                                              start the stdio MCP server
paintress info <file>                                      document summary
paintress query <file> [--type t] [--name n|--regex]    find nodes
paintress get <file> <id> [--depth n]                   read a node subtree
paintress update <file> <id> '<patch-json>'             shallow-merge attributes
paintress insert <file> <parent> '<node-json>'          insert a child node
paintress delete <file> <id>                            remove a node
paintress move <file> <id> <parent> [--index n]         reparent a node
paintress batch <file> '<ops-json>'                     several operations at once
paintress validate <file>                               check against the format spec
paintress render <file> <out.html>                      write the canvas as HTML
paintress shot <file> <out.png> [--scale n]             render to PNG

paintress web [--port n] [--idle ms] [--daemon]         start the viewer
paintress ping | status | stop                          viewer control
paintress watch <name> <dir> | unwatch <name>           register a directory to browse
paintress attach <name>                                 keep the viewer alive while an agent works

paintress install [client...] [--dry-run]               write MCP config entries
paintress doctor                                        show client configuration state
paintress mcp-config <client>                           print the config snippet for one client
```

## Viewer

```bash
paintress web --daemon --idle 3600000
paintress watch demo ./demo
# open http://localhost:3316/?project=demo&file=hello.ptr
```

Canvas navigation: wheel zooms at the pointer, space / middle button / empty area drags to pan, `Ctrl/Cmd+0` returns to 100%, `Shift+1` fits the window. Files with more than one board get a board strip. Edits made through the CLI or MCP are highlighted in the viewer, and clicks assign short ids that the agent can read back with `paintress_marks`.

## MCP clients

`paintress install` writes these; the same entries can be added by hand.

| Client | Config file | Top-level key |
| --- | --- | --- |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `mcpServers` |
| Cursor | `~/.cursor/mcp.json` | `mcpServers` |
| VS Code | `~/.config/Code/User/mcp.json` | `servers` (with `"type": "stdio"`) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.paintress]` |
| pi | `~/.pi/agent/mcp.json` | `mcpServers` |
| OpenCode | `~/.config/opencode/opencode.json` | `mcp.servers` (current) or `mcp` (older; `command` is an array) |

```bash
paintress mcp-config cursor   # print the exact snippet instead of editing files
```

## Skill

`skills/paintress/SKILL.md` is a short instruction file for agents: when to reach for these tools, how `#1` markers map to node ids, and which tool to use for what. Copy it into your agent's skill directory if it supports one.

## Documentation

- `specs/PLAN.md` — roadmap and open questions
- `format/spec.yaml` — the document format spec (the `.pen` profile is frozen; `.ptr` evolves)
- `.agents/memory/ARCHITECTURE.md` — design decisions and their rationale
- `.agents/implementations/` — per-change records with measurements

## License

MIT

---

## Installation guide for AI agents

You are an agent asked to install paintress on this machine. Work through the steps in order and report what you found, what you reused, and what you changed.

**Detection comes first.** Several agents can share one machine. A previous agent may already have installed paintress globally and registered it for itself. Installing a second copy is a bug, not thoroughness.

### 0. Detect

| Check | Command | What it tells you |
| --- | --- | --- |
| Binary on PATH | `command -v paintress` | a usable install already exists |
| Global npm package | `npm ls -g --depth=0 paintress` | installed globally via npm |
| Project-local | `npm ls --depth=0 paintress` | installed inside the current project |
| Client configs | `paintress doctor` | which agents already have an entry, and its state |

Rules:

- **Any hit means reuse.** Do not install again; go to step 2.
- Report the resolved path and version: `paintress --version` prints the package version (or `npm ls -g --depth=0 paintress`).
- Only when every check is empty do you install (step 1).

If the install succeeded but `command -v paintress` still finds nothing (some version managers need a new shell), call it by full path — do not install a second copy:

```bash
"$(npm prefix -g)/bin/paintress" doctor
```

### 1. Install (only if step 0 found nothing)

```bash
npm install -g paintress
```

If global installs are not permitted in this environment:

```bash
npm install paintress          # project-local; call it through npx paintress ...
npx -y paintress@latest ...    # no install at all; slower on first run
```

Prefer the global install. It is what makes the entry in every client config reusable by the next agent.

### 2. Register the MCP server for the agent you are running in

```bash
paintress doctor                    # list detected clients and their state
paintress install --dry-run         # preview the writes
paintress install <client-id>       # write only the client you are running in
```

Client ids: `claude`, `cursor`, `vscode`, `windsurf`, `codex`, `pi`, `opencode`. Use `paintress install` without arguments to cover every detected client.

OpenCode has two config layouts in the wild. `install` follows whatever the existing file already uses and falls back to the current `mcp.servers` shape for a new file; force it with `--opencode-layout legacy` or `--opencode-layout v2`.

What the write does:

- adds or refreshes one entry named `paintress` (`mcpServers.paintress`, or `servers.paintress` for VS Code, or `[mcp_servers.paintress]` for Codex);
- leaves every other key, server and comment structure in the file alone;
- writes `*.bak-<timestamp>` next to the file before replacing it;
- is idempotent: an identical entry reports `noop` and nothing is written;
- uses the bare command `paintress` when it resolves on PATH, otherwise the absolute path of the binary.

### If your client is not in that list

The entry is small and nearly the same everywhere, so adapt it by hand:

1. Find where the client keeps its MCP servers — its own docs, an `/mcp` command, or a "configure MCP servers" menu item.
2. Match the shape. Most clients use a `mcpServers` object holding `command` + `args`; VS Code uses `servers` with `"type": "stdio"`; OpenCode puts a single `command` **array** under `mcp.servers` (older builds: under `mcp`) with `"type": "local"`; Codex uses a TOML table.
3. Print the closest snippet and edit it:

```bash
paintress mcp-config cursor     # JSON with mcpServers
paintress mcp-config vscode     # JSON with servers + type: stdio
paintress mcp-config opencode   # JSON with mcp.servers + command array
paintress mcp-config codex      # TOML table
```

To make a client first-class (so `doctor` and `install` cover it), add one spec to `src/integrations/clients.ts` — `id`, `label`, `format`, `rootPath`, optional `typeValue` / `commandForm` / `extraFields`, and `configPath(home, platform, env)` — plus one test in `test/integrations.spec.ts`. No other file needs to change.

### 3. Install the skill (recommended)

```bash
mkdir -p <your-skill-dir>/paintress
cp "$(npm root -g)/paintress/skills/paintress/SKILL.md" <your-skill-dir>/paintress/SKILL.md
```

Use the skill directory your harness actually reads (`~/.pi/agent/skills/`, `~/.claude/skills/`, `.cursor/skills/`, …). If your harness has no skill mechanism, load the file into context once and keep the tool list.

### 4. Verify

```bash
paintress doctor                                        # entry present, command resolvable
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}\n' | paintress mcp
```

The second command must answer with a `result` containing `"serverInfo": {"name": "paintress", …}`. After a session restart, `paintress_doc_info` on any `.pen` file is the end-to-end check.

### 5. Multi-agent rules

- One global install serves every agent on the machine. Do not create per-agent copies.
- Each agent adds **its own** config entry. Never rewrite another agent's file, and never remove entries you did not add.
- If `doctor` reports `noop`, another agent already registered it correctly — stop there and say so.
- Report the outcome as: reused / installed / registered (which client) / skipped (why).

### 6. Uninstall

```bash
npm uninstall -g paintress
```

Then delete the `paintress` entry from each client config, or restore the newest `*.bak-<timestamp>` next to it.
