# Changelog

What changed in each version of OpenCalque. The app shows this list under About, and the text of
a version becomes the description of its release on GitHub. Newest first; one `## version — date`
heading per version, then `### New`, `### Improved` or `### Fixed` with one line per change.

## 0.2.0 — 2026-10-09

### New
- Welcome window when the app starts: begin a new drawing, open a file, reopen a recent one (desktop app), or start from the example apartment.
- About window with the version and these release notes.
- Installers: Windows (setup and portable), macOS and Linux builds are attached to each release on GitHub.
- Pages can be duplicated with everything on them, and moved up or down in the list.
- Shared layers: what is drawn on a shared layer shows on every page, for a frame, a logo or a title block.
- Text on several lines. Enter starts a new line; Esc or a click elsewhere finishes.
- Fields in text: {date}, {page}, {page-number}, {pages} and {document} are filled in by the drawing.
- Annotations can run straight or with a square elbow as well as curved.
- Line weights in printed millimetres (0.13 to 1.4 mm), kinds of line (dashed, dotted, dash and dot) and arrows at either end of lines and polylines.
- The bar above the tools sets the colour, weight and kind of line of the next shapes.
- Several objects selected: the properties they have in common are shown and changed together; values that differ read "Mixed".
- Eyedropper (I): click an object to give its look to the selection, or to the next shapes.
- Align and space evenly: six alignments and two distributions, in the right panel.

### Improved
- Preferences can switch the welcome window off.
- Links in the app open in your browser.

## 0.1.0 — 2026-10-09

### New
- First public version: walls that join at any angle, doors, windows and stairs, rooms with areas and floor patterns, dimensions, annotations, papers at scale, components and a component library.
- Selectable wall corners with a choice of joint.
- Shared colours.
- Export to PDF at true scale with a title block, to SVG and to DXF.
- An assistant that edits the drawing from a description, with Claude, a local model or any OpenAI-compatible service.
- English, French, Spanish and German.
- A command-line tool and a published JSON format.
