---
name: paintress
description: Read, query, edit, render and screenshot .pen/.ptr design documents through MCP tools, and drive the local viewer. Use when the user refers to a design file, a node in it, a board screenshot, or shorthand ids like #1.
---

# paintress

paintress is a design-document operation layer: JSON design files (`.pen`, and paintress's own `.ptr`) in, MCP tools and a CLI out. It does not draw anything itself — it reads and writes the file, and renders it to HTML for a browser.

## Check before installing

```bash
command -v paintress            # already on PATH?
npm ls -g --depth=0 paintress   # installed globally?
```

If either prints something, **do not install again**. Use the existing binary. `paintress doctor` shows which agents already have the MCP entry and whether it is current.

## Tools

| Tool | What it does |
| --- | --- |
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

1. **Query before you edit.** Node ids come from the file; never invent them.
2. **`#N` means a marker.** When the user writes `#1`, call `paintress_marks` and map `#1` to a real node id. Markers are per viewer session.
3. **Top-level nodes are boards.** Use `paintress_doc_info` to list them before guessing what "the second screen" means.
4. **After a batch, validate.** `paintress_validate` catches structural mistakes before the user opens the file.
5. **Screenshots are for you.** `paintress_screenshot` is how you look at the design; the HTML viewer is for the human.

## Viewer

The human-facing viewer is a separate process:

```bash
paintress web --daemon          # http://localhost:3316
paintress watch <name> <dir>    # register a directory
```

Ask the user to open the URL and click the nodes they mean; then read `paintress_marks` to learn which ids those clicks became.
