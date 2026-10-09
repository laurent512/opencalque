# OpenCalque

Free, open-source 2D architectural editor (plans and layouts) with a Figma-like UI. It was called OpenCAD until October 2026: drawings with `"format": "opencad"`, the `.opencad` extension and settings stored under the old name are still read (`FORMER_FORMAT`, `DRAWING_EXTENSIONS`, `apps/web/src/migrate.ts`). Web app first, Electron shell around it.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything.** It holds the design, the rules that are easy to break, what is untested, and the next steps. Keep it current when you change the design.

## Commands

```sh
pnpm dev          # desktop app
pnpm dev:web      # editor in a browser
pnpm test         # core tests
pnpm typecheck
pnpm build && pnpm smoke   # scripted interaction test; prints a folder of screenshots to inspect
pnpm dist         # package the installer for this system (apps/desktop/dist)
pnpm schema       # regenerate schema/*.json after changing packages/core/src/schema.ts
```

Agent terminals have `ELECTRON_RUN_AS_NODE=1`, which breaks Electron. Prefix Electron commands with `env -u ELECTRON_RUN_AS_NODE`.

## Rules

- Documents are immutable and change only through `applyOps` (`packages/core/src/ops.ts`). In the editor, go through `apply`, `preview`/`commit`, or `replaceDoc` in `apps/web/src/store.ts`.
- `packages/core` has no UI or DOM dependency. Keep it that way: the CLI and a future server use it.
- The editor talks to its host only through `Platform` (`apps/web/src/platform.ts`). No Electron or Node APIs in `apps/web`.
- Node types draw themselves as primitives (`packages/core/src/kinds.ts`). Do not add type-specific code to the renderers.
- Units are millimetres, Y points down, rotation is in degrees. The tree is `parent` + fractional `order`; there are no child arrays. Groups nest to any depth: move nodes with `moveOps`, and use `rootOf` / `leavesOf` / `holdsChildren` rather than assuming a node's parent is a page.
- The roadmap and feature inventory are in `docs/FEATURES.md`; update the status table there when a feature lands.
- Every text the user sees goes through `t()` from `apps/web/src/i18n.ts` (or `msg()` in tables built at import), written in English, and gets an entry in each file under `apps/web/src/locales/`. `pnpm test` fails if a language is missing one.
- To show or toggle a panel, import from `apps/web/src/dock.ts`, never from `Layout.tsx`.
- Anything only the desktop app can do goes through an optional capability on `Platform` and is checked for (`platform.claudeCli`), so the web build keeps working.
- Every user-triggerable action is a command in `apps/web/src/commands.ts`. Do not add keyboard handling elsewhere (the canvas keeps only Escape, Enter and Space).
- New object types should be parametric objects in an extension unless they need custom editing behaviour. Prefer a declarative (JSON) extension in `apps/web/src/warehouse/extensions` when expressions can describe the geometry; never make the app download and run extension code.
- Read a drawing for AI or tooling purposes with `withoutAssets(doc)`: assets are megabytes of base64.
- The assistant's agent loop (`apps/web/src/ai/agent.ts`) must stay free of store and DOM imports so it remains unit-testable. Claude is called through the official `@anthropic-ai/sdk`; other providers go through `compatible.ts`.
- Lengths are millimetres in documents and in the store. Convert only at the edge, with `apps/web/src/units.ts` (`formatLength`, `parseLength`, `Field`'s `length` prop); mark length parameters of parametric objects with `unit: 'length'`.
- A provider's `ChatSession` must implement `snapshot()` and accept it back as `history`, without picture data, so conversations can be stored and resumed.
- A paper has no children: what lies inside its rectangle is on it, by position (`paperContents`). Anything that moves or copies nodes for the user goes through `withPaperContents` in `apps/web/src/actions.ts`. Moves on the canvas also add `wallFollowOps` so joined walls stay joined.
- A room stores a point, never an outline: its floor comes from `roomAt` (`packages/core/src/rooms.ts`) each time it is drawn. Do not cache a room's shape in the document.
- A colour property may be a reference to a shared colour, `var(--<id>)`. Resolve it with `resolveColor` before using it as a colour; never write the resolved value back into a node.
- Modifiers (`packages/core/src/modifiers.ts`) are pure functions from primitives to primitives, run in list order at the end of `nodePrimitives`. Positions in a modifier are relative to its `frame`, which is all that moving and transforming code touches. Never make a modifier read or change the document.
- Hints and the size fields depend on `drawStep` in the store; show nothing that cannot be used at the current step.
- Rotate, mirror and scale nodes with `transformOps` (`packages/core/src/transform.ts`), which knows what each type means; a new node type needs a case there.
- There is no Assets panel: everything that can be placed is in the component library (`WarehouseDialog.tsx`).
- Exports (SVG, DXF, PDF) draw from primitives through `paintOrder`; a new kind of primitive or style needs handling in `svg.ts`, `dxf.ts`, `pdf.ts` and `apps/web/src/canvas/draw.ts`.
- A wall corner is a position, not a node. Use `wallEndsAt`, `moveCornerOps`, `cornerJoin` and `cornerJoinOps` (`packages/core/src/walls.ts`); how a corner is joined lives on each wall end, in `joins`.
- Every change a user would notice gets a line in `CHANGELOG.md`, under the version being worked on. To release: new `## x.y.z — date` section, same version in the `package.json` files, then push a `vx.y.z` tag; the workflow builds the installers and publishes the GitHub release with that section as its text.
- The desktop menu bar is the window's title bar. Keep its height in step with `titleBarOverlay` in `apps/desktop/src/main/index.ts`.
- An arc is an `ellipse` with `from`/`to`, a curve is a `polyline` with `smooth`: do not add node types for them. Use `arcOf` to know whether an ellipse is an arc.
- Doors and windows are tied to walls by position, not by reference. Wall geometry lives in `packages/core/src/walls.ts`.

## Open questions for the owner

- Licence: published as MIT. The owner has not said so in as many words; ask before changing anything that depends on it.
- The owner wants a hosted, collaborative version to stay possible. Do not introduce designs that block it (see ARCHITECTURE §10).
