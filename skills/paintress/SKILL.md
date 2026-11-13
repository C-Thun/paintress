---
name: paintress
description: Create, read, query, edit, render and screenshot design files through MCP tools, and drive the local viewer. Use when the user refers to a design file, wants a new design file created, a node in it, a board screenshot, or shorthand ids like #1.
---

# paintress

paintress is a design-document operation layer: JSON design files in, MCP tools and a CLI out. It does not draw anything itself — it reads and writes the file, and renders it to HTML for a browser.

## Files

Design files are JSON, and `paintress_new` picks the extension for you — never hand-write design JSON and never rename a file to change formats. If the user already has a `.pen` file, edit it in place instead of converting it.

## Check before installing

```bash
command -v paintress            # already on PATH?
npm ls -g --depth=0 paintress   # installed globally?
```

If either prints something, **do not install again**. Use the existing binary. `paintress doctor` shows which agents already have the MCP entry and whether it is current.

## Start the viewer before you draw

**Drawing means someone is watching.** Before the first write of a drawing session (creating, editing or showing a design), make sure the viewer is running — do not wait to be asked, and do not draw into the void first.

- MCP: call `paintress_viewer` — it ensures the viewer, registers this project, and returns the URL to hand over.
- CLI: run `paintress web --daemon` — it prints `pid` / `port` / `http` and returns immediately.

Both are **idempotent**: if a viewer is already up they reuse it and start nothing, so running them every time is safe and you will never end up with a second process. Never run plain `paintress web` in a shell call — the foreground form blocks until the process is stopped.

## Tools

| Tool | What it does |
| --- | --- |
| `paintress_viewer` | **ensure the viewer is up** and register the project; idempotent, returns the URL |
| `paintress_new` | **create a design file.** Writes a valid document with one empty board; returns the `boardId`. Refuses to overwrite; a `path` without an extension gets the default one |
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
| `paintress_screenshot` | render to PNG (headless Chromium); pass `board` (id or name) to capture one board instead of the whole canvas |
| `paintress_marks` | read the user's click markers (`#1 → node id`) |
| `paintress_preset` | project presets (colors / corner radii): `list`, `set`, `remove` |
| `paintress_component` | project component library: `list` reusable components, `insert` one as a copy |

## Design system: presets and components

Two project-level files keep a design consistent. Both are created automatically when the project is registered; the human never has to manage them.

**Presets (`__preset.ptr`) — colors and corner radii live in one place.**
- Before the first shape of a session, call `paintress_preset` with `action: "list"`. If it is empty, propose a small palette and a radius scale, then register each one with `action: "set"` (`type: "color"` or `type: "radius"`).
- In the design, **always reference a preset** (`"fill": "$color-brand"`), never paste a raw hex or radius when a preset exists. Raw values are how the design drifts.
- The human tunes preset values in the viewer and the canvas updates instantly. Do not overwrite a preset value unless asked — that is their knob.

**Components (`__components.ptr`) — look before you build.**
- Before drawing a button, card, input, etc., call `paintress_component` with `action: "list"`.
- If one fits, `action: "insert"` copies it into the design with fresh ids (a copy, not a live link) — then adjust the copy.
- After you build something reusable, register it in the component library (`paintress_insert` with `"reusable": true`), so the next session can find it. Never rebuild a component that already exists.

## Working rules

1. **Viewer first.** Start it (`paintress_viewer` / `paintress web --daemon`) before the first write — see above. It is idempotent, so there is no reason to skip it.
2. **Nothing to edit? Create it.** `paintress_new` is the only way to make a file; there is no "empty document" state to work around, and no need to hand-write JSON.
3. **Query before you edit.** Node ids come from the file; never invent them.
4. **`#N` means a marker.** When the user writes `#1`, call `paintress_marks` and map `#1` to a real node id. Markers are per viewer session.
5. **Top-level nodes are boards.** Use `paintress_doc_info` to list them before guessing what "the second screen" means.
6. **After a batch, validate.** `paintress_validate` catches structural mistakes before the user opens the file.
7. **Presets before pixels, components before building.** See above: colors and radii go through `paintress_preset`, and the component library is checked before anything new is drawn.
8. **Screenshots are for you.** `paintress_screenshot` is how you look at the design; the HTML viewer is for the human. When a document has several boards, pass `board` to get just that page — an ambiguous name errors out and lists the candidates rather than guessing.

## Node fields worth knowing

`type` and `id` are immutable after creation. Text nodes hold their string in **`content`** (not `text`). `update` is a shallow merge and does **not** validate field names — a typo silently creates a new key and the render does not change. When unsure of a field name, `paintress_get` the node and read the real one.

## Viewer

The human-facing viewer is a separate process:

```bash
paintress web --daemon          # idempotent: reuses the running one, else starts it
paintress watch <name> <dir>    # register a directory (only when it is outside the project)
```

Ask the user to open the URL and click the nodes they mean; then read `paintress_marks` to learn which ids those clicks became.

## Bind the project yourself — do not wait to be asked

When the user refers to a design, asks to see one, or asks to draw something in this project, **you** make it viewable — start with `paintress_viewer` / `paintress web --daemon` (both idempotent). The MCP server also auto-registers the working directory at startup and re-checks it before every write (its name is the last two path segments, slash included, e.g. `acme/shop`); if that already covers the request, just hand over the viewer URL:

- viewer: `http://localhost:3316/`
- deep link to a file: `http://localhost:3316/<name>?file=<relative/path>` (e.g. `http://localhost:3316/acme/shop?file=design/main.pen`)

Starting the viewer for the first time opens the browser on the agent's own project; you do not have to tell the user to visit anything.

If the design lives elsewhere (a design file outside the working directory, or a second project), bind it yourself:

```bash
paintress watch <name> <dir> [--depth 1..6]
```

Prefer the same auto-derived name when it applies, so the URL stays stable. Never ask the user to run `watch` — the goal is that "look at / draw a design" resolves to a viewable URL with zero extra steps. The project list in any open viewer window refreshes on its own once the registration lands.
