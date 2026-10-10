# Changelog

What changed in each version of OpenCalque. The app shows this list under About, and the text of
a version becomes the description of its release on GitHub. Newest first; one `## version — date`
heading per version, then `### New`, `### Improved` or `### Fixed` with one line per change.

## 0.5.0 — 2026-10-10

### New
- OpenCalque in a browser, with nothing to install: https://opencalque.com always runs the latest version.
- Quantities: File → Export → CSV writes a table for a spreadsheet with the rooms and their areas, the walls (length, ground covered and, once a wall height is given, the area of their face less doors and windows, and their volume), the doors and windows counted by kind and size, and the wall types layer by layer.
- Wall types, in their own panel. A type defines what you tick, and only that: what the wall is made of ("Plaster 15, Brick 200", or just a material), its thickness, height, fill, outline colour, weight and kind of line. Give a type to walls in their properties or choose it in the bar above the tools; its walls take what it defines, and changing the type changes them all. A wall can still be given a value of its own: it is marked as an exception, with a button to go back to the type. Measured layers are drawn as lines inside the wall.
- Dimension the selected walls (Object menu): a chain of dimensions along each wall, through each side of its doors and windows, with the whole length beyond, on the outside of the plan.
- Patterned fills. The window that chooses a fill now starts with Plain or Pattern: lines, cross-hatch, planks, tiles, dots for concrete, zigzag for insulation, each with its spacing, angle and stroke colour, over the fill's colour. A wall type can define one, so a material is read from its hatching.
- Measure an angle (the arrow beside the measure tool, or Shift+M): click the corner, then a point along each side, and read the angle between them.
- Walls can have a height, and doors and windows too. Nothing of the plan is drawn with them; they are what the quantities measure with.

### Improved
- One Export in the File menu (Ctrl+P or Ctrl+E): a window where you choose the format, PDF, SVG or DXF, then what goes in it, the sheets to print or the page to export.
- One Import in the File menu (Ctrl+I) for everything: a picture or a PDF to trace, a DXF, another drawing for its components, or an extension. The app sends the file where its kind belongs.

## 0.4.2 — 2026-10-10

### New
- A dark theme. Preferences › General › Theme chooses light, dark, or the same as the system (the default); View › Dark theme switches between them. The drawing is shown light on dark too, which can be turned off to keep its paper colours. Exports and printing are never affected.

### Improved
- Shift while dragging the end of a wall or a line now holds it firmly on the line it lies on, at any angle: the grid no longer pulls it off, a dashed line across the view shows the line it is kept on, and the end stops on walls that line crosses. Shift on a corner keeps it on the line of one of its walls.

## 0.4.1 — 2026-10-09

### New
- Walls can be drawn along a face: with the wall tool, the bar above the tools chooses whether the points you click run along the left face, the middle or the right face of the wall. Corners of a run still meet.
- Extend and trim: a wall end runs on to the next wall in its way, or what sticks out past a wall is cut back to it. From the Object menu for the selected walls, or from the right panel for a selected wall end.
- Shift while dragging the end of a wall or a line keeps it on course: the end slides along the line it already lies on, or swings to level, upright or 45°. Shift while dragging a corner moves it along one of its walls.

### Fixed
- macOS: the app no longer opens with "OpenCalque is damaged and can't be opened" on Apple-silicon Macs. It is still not signed by an identified developer, so the first time it has to be opened with a right-click, then Open. There is now a build for Intel Macs as well.

## 0.4.0 — 2026-10-09

### New
- A smarter title block. It is built from what there is to say: an entry left empty takes no room, and the block is only as tall as it needs to be. Each sheet ticks which entries it shows: project, client, address, sheet name, page name, author, scale, format, date, sheet number.
- Project, client, address and author are said once for the drawing and appear on all its sheets; the project is the drawing's name unless you give another. A text too long for its place is set smaller instead of running out of the block.

### Improved
- The example flat is laid out as a flat is: the entrance opens on a hall that serves the living room, the bedroom and the bathroom, and the kitchen is a corner of the living room.
- The points of a selected object (the ends of a wall or a line, the corners of a shape) are round and a little larger, so they read as points to drag; the corners of a selection box stay square.
- Components and library objects are solid: a chair, a table or a cabinet drawn as an outline hides the floor pattern under it instead of letting it show through. Give one a fill of its own to colour it.

### Fixed
- After undoing the move of a wall corner, the blue dot of the selected corner no longer stays where the corner had been dragged.

## 0.3.2 — 2026-10-09

### Improved
- Extensions are installed, removed and switched off on the Extensions page of Preferences; they no longer have a window of their own or an entry in the menu.
- Choosing a colour opens on a picker (a square for how vivid and how bright, a band for the hue, the colour's code to type), then the colours picked lately, then the shared colours, in one window.

## 0.3.1 — 2026-10-09

### Improved
- The ends of a line, a dimension or an annotation, and the kind of line (solid, dashed, dotted…), are picked from a row of pictures instead of a list of names, in the right panel and in the bar above the tools.
- The colour of a layer, and the colour of the next shapes in the bar above the tools, can be linked to a shared colour like any other colour.
- Shared colours have a panel of their own, Colours, beside Structure, instead of sitting under the layers.
- At start, nothing in the welcome window looks selected, and the window's own buttons no longer stand out in white while a window of the app is open.
- Walls meeting at a sharp angle (under 60°) get a chamfered corner by default instead of a long spike. Right angles and wider keep their sharp point.

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
