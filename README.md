<div align="center">
  <img src="assets/icon-512-wordmark.webp" width="200" alt="paintress">
  <p>A UI design tool for AI agents</p>
  <p><a href="README.zh-CN.md">中文</a></p>
</div>

**To install: paste this repository's URL into your agent and ask it to install paintress.** Agents that need a precise procedure will find one at the [end of this file](#installation-guide-for-ai-agents).

## What it is

paintress is a UI design tool for AI agents. You describe a screen in chat, the agent draws it into a design file, and you watch it appear in your browser — no canvas to drag, no design app to learn.

You point instead of describing: click any element in the viewer and it gets a short number (`#1`), so "make #1 blue" changes exactly that element.

Designs are plain JSON files inside your project, so they diff and commit like code.

The agent does the reading and writing, through MCP tools or the CLI. The browser viewer is for looking, clicking and marking.

| Part | Purpose |
| --- | --- |
| MCP tools | ensure the viewer, create, query, read, update, insert, delete, move, batch, validate, render, screenshot |
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
paintress new <file> [--name n] [--width n] [--height n] [--fill c]
                      [--layout vertical|horizontal|none] [--padding n] [--gap n] [--force]
                                                           create a design file (one empty board)
paintress info <file>                                      document summary
paintress query <file> [--type t] [--name n|--regex]    find nodes
paintress get <file> <id> [--depth n]                   read a node subtree
paintress update <file> <id> '<patch-json>'             shallow-merge attributes
paintress insert <file> <parent> '<node-json>'          insert a child node
paintress delete <file> <id>                            remove a node
paintress move <file> <id> <parent> [--index n]         reparent a node
paintress batch <file> '<ops-json>'                     several operations at once
paintress validate <file>                               check against the format spec
paintress preset list|set|remove ...                    project presets (colors / radii)
paintress component list|insert ...                     project component library
paintress render <file> <out.html>                      write the canvas as HTML
paintress shot <file> <out.png> [--scale n] [--board id|name]  render to PNG (one board or the whole canvas)

paintress web [--port n] [--idle ms] [--daemon]         ensure the viewer is running (idempotent)
paintress ping | status | stop                          viewer control
paintress watch <name> <dir> | unwatch <name>           register a directory to browse
paintress attach <name>                                 keep the viewer alive while an agent works

paintress install [client...] [--dry-run]               write MCP config entries
paintress doctor                                        show client configuration state
paintress mcp-config <client>                           print the config snippet for one client
```

## Viewer

```bash
paintress web --daemon
paintress watch demo ./demo
# open http://localhost:3316/demo
```

`paintress web --daemon` is idempotent: if a viewer is already running it prints that process's `pid` / `port` / `http` and exits, so it is safe to run before every drawing session — there is never a second instance. The foreground form (`paintress web`) reuses a running viewer the same way instead of erroring; it only blocks when it had to start one. `paintress stop` is how you replace a running viewer (e.g. on another port).

Agents get the same guarantee from the MCP side: `paintress_viewer` ensures the viewer and registers the current project, and the MCP server re-checks it before every write, so the viewer is up before the first edit instead of after someone asks.

A design file that has a sibling Markdown file of the same name (`home.ptr` → `home.md`) gets a notes button in the top-left corner of the canvas. Click it and the canvas narrows to make room for the note, read-only: what the design is for, what is still open, which requirement it answers.

The rail in the top-right corner holds the project's design system. **Presets** are the project's colors and corner radii: the agent references them (`$color-brand`) instead of pasting values, and you can change one here and watch the canvas update — no more "a bit bluer". **Components** is a read-only gallery of everything reusable the agent has built so far, so you can see progress and the agent can look before rebuilding something that already exists.

Canvas navigation: wheel zooms at the pointer, space / middle button / empty area drags to pan, `Ctrl/Cmd+0` returns to 100%, `Shift+1` fits the window. Files with more than one board get a board strip. Edits made through the CLI or MCP are highlighted in the viewer, and clicks assign short ids that the agent can read back with `paintress_marks`.

Projects are named after their directory path (`c-thun/raybend`), so the URL reads like the path: `http://localhost:3316/c-thun/raybend?file=design/editor.pen`. Project rows have an **×** on hover that unbinds the project (design files are untouched; an agent re-registers on its next start), and **Stop server** in the sidebar footer shuts the viewer process down — both ask for confirmation first.

The viewer follows the agent instead of asking you to manage it. When an agent starts the viewer it opens the browser on its own project; projects appear and leave with a short animation as agents come and go; when the last project is gone a 10-second countdown closes the window and the process. A browser that nobody is looking at no longer keeps the process alive.

When npm has a newer release than the running one, the version badge in the header grows a second line in rust red; clicking it opens the upgrade prompt (one copyable sentence) and the GitHub link. The check is client-optional on the daemon side: if npm is unreachable, the badge simply stays as it is.

The toolbar's right side has two viewer-only controls. **Canvas background** switches Light / Gray / Dark for the design surface without touching the rest of the UI. **Language** switches the interface between 中文 and EN; on first load it follows the browser, and anything that is not Chinese gets English. Both are per-browser and remembered locally. Registering a project, or dropping a new design file into a watched directory, updates every open viewer without a reload.

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

`skills/paintress/SKILL.md` is a short instruction file for agents: when to reach for these tools, **to bring the viewer up before drawing** (idempotently), how `#1` markers map to node ids, and which tool to use for what. Copy it into your agent's skill directory if it supports one.

## Documentation

- `specs/PLAN.md` — roadmap and open questions
- `format/spec.yaml` — the design file format spec
- `format/README.md` — how the format layers relate
- `.agents/memory/ARCHITECTURE.md` — design decisions and their rationale
- `.agents/implementations/` — per-change records with measurements

paintress also opens existing `.pen` design files as-is.

## Release (maintainers)

Publishing is tag-driven: a `v*` tag makes `.github/workflows/publish.yml` first check that **ci passed for the same commit**, then build, verify the package contents and run `npm publish --provenance` through OIDC trusted publishing. Tests run once, in `ci.yml`; publishing does not re-run them. Do not publish from a laptop.

```bash
pnpm release patch             # 0.3.1 → 0.3.2
pnpm release minor             # 0.3.1 → 0.4.0
pnpm release major             # 0.3.1 → 1.0.0
pnpm release patch --dry-run   # print the plan only
pnpm release --retag           # after a failed release: move the unpublished tag and re-publish
```

The script refuses to run on a dirty worktree or a non-default branch, verifies the tag is free, runs typecheck (server + ui), the test suite, the build and the package-contents check, then commits `chore(release): vX.Y.Z`, tags it, pushes branch + tag, and finally waits until the version is actually on npm (a green run that published nothing is reported as a failure, not a success).

`--prepare-only` stops after the local commit and tag; `--no-wait` returns right after the push; `--local` publishes from this machine as an emergency path and skips the CI checks. `--retag` is the recovery path after a failed release: once it confirms the version is not on npm yet, it moves the existing tag to the current commit and re-publishes under the same version number; an already published version is refused.

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

The second command must answer with a `result` containing `"serverInfo": {"name": "paintress", …}`. After a session restart, `paintress_doc_info` on any design file is the end-to-end check.

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
