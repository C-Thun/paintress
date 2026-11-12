---
name: paintress
description: Create, read, query, edit, render and screenshot `.ptr` (paintress standard format) and `.pen` (compatible) design documents through MCP tools, and drive the local viewer. Use when the user refers to a design file, wants a new design file created, a node in it, a board screenshot, or shorthand ids like #1.
---

# paintress

paintress is a design-document operation layer: JSON design files in, MCP tools and a CLI out. It does not draw anything itself — it reads and writes the file, and renders it to HTML for a browser.

## Formats

- **`.ptr` is paintress's standard format.** Create this by default for anything new. It carries the `x-paintress` block (`spec`, `generator`, timestamps) and is the layer that evolves.
- **`.pen` is compatible**: read, queried, edited and rendered exactly the same way. Do not convert a `.pen` the user is still working with — edit it in place.
- Both render identically; the difference is only which layer owns future format changes.

## Check before installing

```bash
command -v paintress            # already on PATH?
npm ls -g --depth=0 paintress   # installed globally?
```

If either prints something, **do not install again**. Use the existing binary. `paintress doctor` shows which agents already have the MCP entry and whether it is current.

## Tools

| Tool | What it does |
| --- | --- |
| `paintress_new` | **create a document.** Writes a valid `.ptr` with one empty board; returns the `boardId`. Refuses to overwrite; `path` without an extension gets `.ptr` |
| `paintress_doc_info` | document summary: version, format flavor, node counts, variables, top-level nodes |
| `paintress_query` | find nodes by type / name (exact or regex) / id / reusable |
| `paintress_get` | fetch one node's subtree; `depth` controls how far down |
| `paintress_update` | shallow-merge attributes on one node (`id` and `type` are immutable) |
| `paintress_insert` | insert a child node; returns the generated `id` |
| `paintress_delete` | remove a node |
| `paintress_move` | reparent a node, optional index |
| `paintress_batch` | several operations in one call |
| `paintress_validate` | check the document against the format spec |
| `paintress_render` | write the canvas as a standalone HTML file |
| `paintress_screenshot` | render to PNG (headless Chromium) |
| `paintress_marks` | read the user's click markers (`#1 → node id`) |

## Working rules

1. **Nothing to edit? Create it.** `paintress_new` is the only way to make a file; there is no "empty document" state to work around, and no need to hand-write JSON.
2. **Query before you edit.** Node ids come from the file; never invent them.
3. **`#N` means a marker.** When the user writes `#1`, call `paintress_marks` and map `#1` to a real node id. Markers are per viewer session.
4. **Top-level nodes are boards.** Use `paintress_doc_info` to list them before guessing what "the second screen" means.
5. **After a batch, validate.** `paintress_validate` catches structural mistakes before the user opens the file.
6. **Screenshots are for you.** `paintress_screenshot` is how you look at the design; the HTML viewer is for the human.

## Node fields worth knowing

`type` and `id` are immutable after creation. Text nodes hold their string in **`content`** (not `text`). `update` is a shallow merge and does **not** validate field names — a typo silently creates a new key and the render does not change. When unsure of a field name, `paintress_get` the node and read the real one.

## Viewer

The human-facing viewer is a separate process:

```bash
paintress web --daemon          # http://localhost:3316
paintress watch <name> <dir>    # register a directory
```

Ask the user to open the URL and click the nodes they mean; then read `paintress_marks` to learn which ids those clicks became.

## Bind the project yourself — do not wait to be asked

When the user refers to a design, asks to see one, or asks to draw something in this project, **you** make it viewable. The MCP server auto-registers the working directory at startup (its name is derived from the last two path segments, e.g. `acme-shop`); if that already covers the request, just hand over the viewer URL:

- viewer: `http://localhost:3316/`
- deep link to a file: `http://localhost:3316/?project=<name>&file=<relative/path>`

If the design lives elsewhere (a `.pen`/`.ptr` outside the working directory, or a second project), bind it yourself:

```bash
paintress watch <name> <dir> [--depth 1..6]
```

Prefer the same auto-derived name when it applies, so the URL stays stable. Never ask the user to run `watch` — the goal is that "look at / draw a design" resolves to a viewable URL with zero extra steps. The project list in any open viewer window refreshes on its own once the registration lands.
