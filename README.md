<h1 align="center">OpenCalque</h1>

<p align="center">
  <strong>Open-source 2D architectural editor.</strong><br>
  Floor plans and layouts with a Figma-like interface, a local CLI, and a plain JSON format made for scripts and AI agents. Free, and yours to run.
</p>

<p align="center">
  <a href="https://github.com/laurent512/opencalque/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/laurent512/opencalque?color=0d99ff"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="Runs on Windows, macOS, Linux and the web" src="https://img.shields.io/badge/runs%20on-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux%20%C2%B7%20web-4b5563">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white">
  <img alt="Languages: English, French, Spanish, German, Chinese, Japanese, Korean, Turkish" src="https://img.shields.io/badge/languages-EN%20%C2%B7%20FR%20%C2%B7%20ES%20%C2%B7%20DE%20%C2%B7%20ZH%20%C2%B7%20JA%20%C2%B7%20KO%20%C2%B7%20TR-0d99ff">
  <a href="#contributing"><img alt="Contributions welcome" src="https://img.shields.io/badge/contributions-welcome-22c55e"></a>
</p>

![A kitchen drawn in OpenCalque from nothing: four walls drawn by their corners, a window and a door put in them, then from the Kitchen section of the object library a tall unit, base units, a sink, a dishwasher and a hob, given drawers below rather than a second oven, set edge to edge along the wall, the last unit stretched by its side up to the corner, and a table with chairs; the elevation of the kitchen wall put under the plan with its dimensions, where the window is raised off the worktop and made wider; then a viewpoint placed in the room, its 3D view moved beside the plan and made larger, a look around by dragging in it, and the view shaded; its prompt copied from Properties, to send with the picture to an AI image generator, and the photorealistic render that comes back pasted under the view](docs/first-look.gif)

*Calque* is French for tracing paper, and for a layer. OpenCalque is a drafting table for buildings: draw walls that join themselves, drop in doors, windows, stairs and furniture that know how to behave, name rooms and get their area, see it in elevation and in 3D, then frame it all on a sheet. It is a desktop app and a web app from the same code, and everything it saves is a file you can read.

> **Status: stable.** Covered by unit and browser tests, and a drawing saved by it stays readable by every later version. See [what changed](CHANGELOG.md) and [what is not there yet](docs/GUIDE.md#what-is-not-there-yet).

## Why OpenCalque

| | |
| --- | --- |
| **Figma-like, not CAD-like** | A toolbar, panels you dock anywhere, every command on `Ctrl+K` with rebindable shortcuts, hints that show only the next step. No command line to memorise. |
| **Built for buildings** | Walls mitre at any angle and stay joined when you move one. Doors and windows snap into walls and cut them. Rooms are found from the walls. Elevations, sections and 3D views are drawn from the plan and follow every change. |
| **Non-destructive** | Components update everywhere at once. Modifiers such as crop and floor patterns change how something is drawn without changing it. |
| **Open by design** | A drawing is plain JSON with a published schema. Every edit is a small JSON operation, the same ones the editor, the CLI and AI agents use. |
| **Works with AI, or without** | A built-in assistant edits the drawing from a description, through Claude, a local model with Ollama, or any OpenAI-compatible service. The rest of the app never goes online. |
| **Free** | MIT licensed. No account, no subscription, no telemetry. |

## Download

Use it in a browser, with nothing to install: **[opencalque.com](https://opencalque.com)**. Or take the desktop app from the [releases page](https://github.com/laurent512/opencalque/releases/latest):

| System | File |
| --- | --- |
| Windows | `OpenCalque-…-windows-setup.exe`, or `…-windows-portable.exe` to run without installing |
| macOS | `OpenCalque-…-mac-arm64.dmg` (Apple silicon) or `…-mac-x64.dmg` (Intel) |
| Linux | `OpenCalque-…-linux-x86_64.AppImage`, or `…-linux-arm64.AppImage` (a Raspberry Pi 4 or 5 on a 64-bit system) |

When it starts, pick **Start with the example** to get a furnished flat to take apart.

<details>
<summary>The builds are not signed: what to do the first time</summary>

- **Windows**: choose "More info", then "Run anyway".
- **macOS**: open the app once, then go to System Settings → Privacy & Security, where an "Open Anyway" button for OpenCalque appears; on macOS 14 and earlier, right-click the app and choose Open.
- **Linux**: make the AppImage executable (`chmod +x OpenCalque-*.AppImage`). AppImages need FUSE 2 (`sudo apt install libfuse2t64` on recent Ubuntu). If the app closes at once on Ubuntu 24.04 or later, start it with `--no-sandbox`.

The Windows setup and the AppImage update themselves. The macOS and Linux builds come from the same workflow as the Windows one but have not been tried on a real Mac or Linux machine by the maintainers: reports are welcome.

</details>

## What you can do

- **Walls** drawn along their middle or a face, joined at any angle, straight or curved, each of a material drawn with its hatch. Corners you drag, walls you extend and trim.
- **Doors, windows and stairs** that snap into walls: hinged, sliding and pocket doors, casement, tilt-and-turn, fixed and sliding windows, four kinds of stairs.
- **Rooms** found from the walls, with their name and area, and **tables of quantities** on the drawing that keep up to date; CSV export of areas, lengths and counts.
- **Elevations, sections and 3D views** drawn from the plan. A viewpoint shows what you see from where you stand, as lines, shaded or a depth map, saved as a picture with a description to hand to an image model.
- **An object library** of kitchen units, furniture, bathroom, heating and electrical symbols, resized by their sides; switches linked to the lights they control.
- **Drafting**: lines, polylines, curves, arcs, dimensions and chains of them, text with fields, notes with leaders, hatches, exact sizes typed in mm, cm, m, inches or feet and inches.
- **Sheets**: papers at standard formats and scales with a title block, exported as a vector PDF at true scale, and SVG, DXF and PNG.
- **Bring in** a PDF or a picture to trace at its scale, or a DXF from another CAD program, sheets laid out in paper space included.
- **Organise** with pages, layers, groups, components, shared colours, and modifiers that crop, repeat or fill without changing what they apply to.

Every tool and shortcut is in **[the guide](docs/GUIDE.md)**; everything the app does, and what comes next, in [FEATURES.md](docs/FEATURES.md).

## Scripts and the command line

Everything the editor does to a drawing, a script can do too. With Node 22 or later, the CLI runs from npm with nothing to install:

```sh
npx opencalque new plan.opencalque "My plan"
npx opencalque apply plan.opencalque edits.json      # a JSON array of operations
npx opencalque check plan.opencalque                 # what is wrong with it, as JSON
npx opencalque pdf plan.opencalque --out plan.pdf    # every paper as a page, at its real scale
npx opencalque png plan.opencalque --out plan.png
```

A wall is one operation:

```json
{ "op": "add_node", "node": { "type": "wall", "parent": "page_1", "a": { "x": 0, "y": 0 }, "b": { "x": 6000, "y": 0 }, "thickness": 200 } }
```

A batch is all-or-nothing and every result is validated, so a script or a model cannot leave a drawing broken. **[docs/FORMAT.md](docs/FORMAT.md)** has the file format, every command and operation, what stays stable between versions, and how to add kinds of object.

## AI agents

OpenCalque serves drawings to an agent over [MCP](https://modelcontextprotocol.io), with the tools the assistant uses: edit with operations, read, measure, check what came out wrong, and look at a picture of the result. A model with no tools can read [opencalque.com/llms.txt](https://opencalque.com/llms.txt).

**The drawing open in the desktop app**: turn on *Let agents on this computer work on the open drawing* under Preferences › AI, which gives the command to run once with the real path of your app. With Claude Code:

```sh
claude mcp add opencalque-live -- "C:\Users\you\AppData\Local\Programs\OpenCalque\OpenCalque.exe" --mcp
```

**Drawings on disk**, with Node 22 or later:

```sh
claude mcp add opencalque -- npx -y opencalque mcp
```

For any other MCP client (Claude Desktop, Cursor, VS Code, Gemini CLI…), the command is the app with `--mcp`, or `npx` with `-y opencalque mcp`. Give the agent absolute paths. Edits to the open drawing appear on the canvas and are undone with `Ctrl+Z`; edits to a file are written at once, so do not have the app and an agent work on the same file ([more](docs/FORMAT.md#agents-a-file-or-the-open-drawing)). While it is on, the desktop app listens on this computer only, behind a token kept in `.opencalque/bridge.json` in your home folder: turn it off when you are not using it.

## The assistant and your data

The assistant (`Ctrl+J`) works with Claude (an API key, or in the desktop app the Claude Code CLI signed in on your computer), a local model through Ollama (in a browser, Ollama must be told to accept the page with `OLLAMA_ORIGINS`), or any service that speaks the OpenAI chat-completions format with tool calling.

- When you send a request, the drawing goes to the provider you chose as JSON, with what you have selected. Imported pictures are left out unless the assistant asks to look at one. Pictures you attach are sent with their message, and so is a picture of the drawing when the assistant asks for one to check its work.
- An API key is stored on your computer and sent only to its provider; the desktop app has the system encrypt it, a browser cannot.
- The desktop app asks once before the assistant reaches a service that is not on your computer. Conversations stay on your computer until you delete them.
- Nothing is sent anywhere unless you use the assistant or let an agent in. The rest of the app works offline.

## Run from source

Requires [Node](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io) 9.

```sh
git clone https://github.com/laurent512/opencalque.git
cd opencalque
pnpm install
pnpm dev          # the desktop app, with hot reload
pnpm dev:web      # the same editor in a browser
pnpm test         # unit tests (Vitest)
pnpm e2e          # build the web app and drive it in a browser (Playwright)
pnpm dist         # the installer for the system you are on, in apps/desktop/dist
```

## Contributing

Issues and pull requests are welcome. Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the design, the rules that keep the model open (documents change only through operations, the core has no UI), and how a version is released. [`CLAUDE.md`](CLAUDE.md) holds the same rules in short for AI coding agents.

Good first contributions: a component library for your trade, a translation, an extension written as data ([how](docs/FORMAT.md#the-warehouse)), or one of the things [not there yet](docs/GUIDE.md#what-is-not-there-yet).

## License

[MIT](LICENSE). The software and fonts of others that the app includes are listed with their licences in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), also shown in the app under About › Licences.
