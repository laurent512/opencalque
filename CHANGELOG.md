# Changelog

What changed in each version of OpenCalque. The app shows this list under About, and the text of
a version becomes the description of its release on GitHub. Newest first; one `## version — date`
heading per version, then `### New`, `### Improved` or `### Fixed` with one line per change.

## 0.3.0 — 2026-10-09

### New
- Import DXF (File menu, or drop the file): lines, polylines, circles, arcs, ellipses and text come in on their layers, in millimetres.
- Arcs: give an ellipse a start and an end angle in the right panel and it is drawn as an arc.
- Curves: tick Curved on a polyline and it flows through its points.
- Repeat (Object menu, or Modifiers): draws an object again in a row, or in rows and columns, without adding objects.
- Text can be bold, and aligned left, centred or right.
- A PDF with several pages asks which page to import.

### Improved
- PDF export includes PNG pictures as well as JPEG ones.
- PDF export prints text in the font that matches its own: sans-serif, serif or monospace, plain or bold, condensed.
- DXF export draws walls that meet in a T as one outline: no line across the end of the wall that stops, and the side it meets is open.

## 0.2.1 — 2026-10-09

### New
- Compass (north) in the component library: a compass rose to place and turn, with its size and letter.

### Improved
- A component or an object is picked by clicking anywhere inside it, even when it is drawn as an outline; a floor pattern underneath no longer takes the click.
- Menus are light, like the rest of the app.
- A lighter toolbar: the zoom reading is in the corner of the drawing beside the pointer's position, the command list is under Preferences (Ctrl+K), and the eyedropper is in the Style section of the right panel (still I on the keyboard).
- The list of a colour field has a width of its own, so its choices are read whole; it opens above the field when there is no room below and stays inside the window.
- Resetting the keyboard shortcuts is offered on the shortcuts page of Preferences only, not in the menu.
- The Objects panel is called Structure and no longer repeats its name under its tab.
- The cross that closes a panel tab is smaller and shows only under the pointer.

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
