# OpenCalque

Free, open-source 2D floor plans, stored as plain JSON. This package is the command line and the [MCP](https://modelcontextprotocol.io) server of [OpenCalque](https://opencalque.com): an AI agent or a script draws, edits, checks and exports architectural plans with it (walls, doors, windows, rooms, furniture, dimensions, sheets). The same drawings open in the editor at [opencalque.com](https://opencalque.com) and in the desktop app.

## For an AI agent (MCP)

```sh
npx -y opencalque mcp
```

With Claude Code:

```sh
claude mcp add opencalque -- npx -y opencalque mcp
```

For Claude Desktop, Cursor, VS Code or any other MCP client, add this to its servers:

```json
{ "opencalque": { "command": "npx", "args": ["-y", "opencalque", "mcp"] } }
```

The agent opens or creates a `.opencalque` file with `open_drawing` (give it an absolute path), reads the guide once with `read_guide`, then edits with `apply_operations` and looks at the result with `describe_drawing`, `check_drawing`, `measure_drawing` and `view_drawing` (a picture of the plan). `npx -y opencalque mcp plan.opencalque` starts on one file.

## From the command line

```sh
npx opencalque new plan.opencalque "My flat"
npx opencalque apply plan.opencalque ops.json   # a JSON array of operations
npx opencalque check plan.opencalque            # rooms that do not close, walls drawn twice…
npx opencalque png plan.opencalque --out plan.png
npx opencalque pdf plan.opencalque --out plan.pdf
npx opencalque guide                            # the format and the operations, written for an AI agent
npx opencalque --help                           # every command
```

Also: `describe`, `quantities` (rooms and their areas, walls, doors), `svg`, `dxf`, `import` (DXF), `schema`, `validate`.

## The format

A drawing is JSON in millimetres, with a published JSON Schema: [document](https://opencalque.com/schema/document.schema.json), [operations](https://opencalque.com/schema/ops.schema.json). Every edit is a small JSON operation, the same ones the editor uses. A guide for language models is at [opencalque.com/llms-full.txt](https://opencalque.com/llms-full.txt). Drawings saved since version 1.0 keep opening in every later version.

PDF export of Chinese, Japanese or Korean text needs the fonts of a checkout or the desktop app; this package carries only Noto Sans.

MIT licence. Source, issues and the desktop app: [github.com/laurent512/opencalque](https://github.com/laurent512/opencalque).
