# OpenCalque: features and roadmap

What the app does today, the ten big features chosen to do next and where each stands, and the longer backlog. For how things are built, see [ARCHITECTURE.md](ARCHITECTURE.md).

Last updated: 2026-11-06 (after 1.5.0).

## 1. What exists today

### Drawing
- Lines, rectangles, ellipses and arcs (an ellipse with a start and an end angle), polylines and polygons, straight or curved through their points, text. The Curved line tool draws the curve as its points are clicked; the Arc tool draws an arc by its two ends and a point it goes through, or a typed radius.
- **Offset**: a parallel copy of a line, a polyline, a curve, a rectangle, a circle or an arc, at a typed distance or where the pointer says.
- **Selecting by a box**, as in CAD: dragged to the right it takes what is wholly inside it; dragged to the left, green and dashed, what it touches, by what is drawn rather than by the box around it.
- Exact sizes while drawing: a bar above the tools takes typed lengths, angles, widths and heights, and the shape shows its sizes as you draw.
- Walls defined by a line and a thickness, joined cleanly at any angle where their ends meet. The line is the wall's middle, or one of its faces: walls drawn by their inner face keep it flush whatever their thicknesses, and grow outwards when made thicker. A run of walls closes with a double-click.
- **Thicker or thinner from one side**: drag a face of the selected wall and only that face moves; the other stays, joined walls stay joined, walls that stop against it keep reaching it, and its doors and windows stay in its middle. Ctrl (⌘) moves both faces; Alt ignores snapping, as everywhere. **Longer or shorter** by the line across a free end, the wall keeping its direction.
- **Curved walls**: a wall bent into an arc by dragging the handle in its middle or typing its curve. It joins its neighbours, takes doors and windows, bounds rooms and is measured round its curve.
- Doors and windows that snap onto a wall, cut the opening, adapt to the wall's thickness and slide along it, and are made wider or narrower by dragging either end. Door type, hinge side, angle; window panes, glazing, sill.
- Stairs: straight, L-shaped, U-shaped, spiral, each with its own parameters, and resized on the plan by their sides in whole steps: pull the top of a straight stair and it gains steps, its side and it widens. A compass rose for north.
- Washbasins with one bowl or two, whose counter is made longer or deeper by pulling its sides while the bowls and taps keep their size; and a bathtub made longer or wider the same way, its rim keeping its thickness and its drain its size.
- In the kitchen, a hob, a sink and a fridge made wider by their sides: the hob keeps the size of its zones (five from 75 cm, for hobs of 80 and 90), the sink its bowls, with a draining board on either side or none, and an American fridge with two doors stands beside the plain one. In the living room, a corner sofa, its corner on the left or the right, taking a seat for about every 65 cm of each side. Under Heating, a radiator made longer by its sides, its sections keeping their width, its valve at either end.
- Dimensions with configurable line, end markers, extension lines, text, font, unit and decimals, and vertical text that reads from bottom to top or from top to bottom; and a separate measure tool that only reads a distance.
- **Dimension styles**: whichever of those settings a style defines, shared by the dimensions drawn in it, each of which may still differ from it.
- Text typed directly on the drawing, on several lines; double-click a text to change it. **Fields** (`{date}`, `{page}`, `{page-number}`, `{pages}`, `{document}`) are filled in when drawn and exported.
- **Line style**: weight chosen as printed millimetres, kinds of line (dashes, dots), and arrows or other ends on lines and polylines; a bar above the tools sets the colour of the lines of the next shapes (the layer's until another is chosen) and the fill of the next closed shapes.
- **Eyedropper**: copy the look of an object to the selection or to the next shapes.
- **Arrange** from the toolbar: stacking order, align and space evenly. The common properties of several selected objects are edited together.
- **Properties panel**: sections that fold and stay folded; the name, layer (picked by its colour) and status (locked, hidden) of what is selected; X and Y, and width and height, on one row, with a lock that keeps the proportions when a size is typed.
- A guide line across the view while a segment is exactly horizontal or vertical, and a hint bar with the keys that matter for the tool in use.
- Lengths shown and typed in millimetres, centimetres, metres, inches, feet, or feet and inches (7' 6 1/2"); numbers in the panels with a decimal point or comma, as the language writes them or as chosen. **Drawing settings**: each drawing says whether its areas and quantities are metric or imperial and which decimal mark its rooms, tables, dimensions and CSV export write, with the project information of its title blocks.
- **Papers**: sheets like frames, drawn at a standard format (A5 to A0, upright or lying, at a drawing scale) or any size, named above their corner, moved on their own over the drawing to frame it, and copied or duplicated with what is drawn on them.
- Walls stay joined: moving a wall or a corner stretches the walls that meet it, and its doors and windows follow; they follow it however a straight wall is changed (an end dragged, a length or angle typed, trimmed), at their distance from the end that stayed.
- Numbers in the panels change by holding Alt and dragging sideways.
- **Transforming** any selection: turn about a clicked point with the Rotate tool (by a base line, or a typed angle), mirror horizontally or vertically, scale and nudge, by dragging the grips of the selection box, from the menus or the keyboard. A rectangle or an ellipse is resized like a box, by its corners and the middles of its sides, turned or not, Shift keeping its proportions.
- **Annotations**: a note with a curved, straight or elbowed leader to what it is about, typed in place, with a choice of symbol at each end.
- **Grid lines**: the axes of a building, drawn by two clicks from the text button (G), each with its letter or number in a bubble at one end or both, labelled one after the other (A, B, C or 1, 2, 3) and relabelled by double-clicking a bubble, in dash and dot or any other line. Other lines snap onto them.
- **Corners**: a wall end is a selectable corner shared by the walls that meet there; drag it and they all follow. A corner of two walls can be mitred, rounded, cut off, or have one wall run through. Each line of a wall (its faces, its ends) can have its own look. A wall is cut in two with the Split tool; the two halves show the line between them. A selected wall shows which of its ends are joined, touch a wall without being joined, or nearly meet another; an end can be detached (joined to nothing) or brought onto the end it nearly meets.
- **Rooms**: click inside closed walls to name a space; its floor, outline, area and perimeter follow the walls. **Dividers** split an open space into rooms without a wall.
- **Fills**: no fill, a solid colour, or a hatch (lines, cross-hatch, planks, tiles, concrete, insulation) over a background colour, chosen in one fill window with a tab for each and a preview of the hatch, whose colour, opacity, weight, spacing and angle are set there. The same window serves shapes, walls, materials, the floors of rooms and the bar above the tools; the Hatch modifier does the same as a modifier.
- **Shared colours**: named colours that objects and layers link to; change one and everything linked follows. Any colour may be see-through (an opacity in the colour window), and may follow the colour of the object's layer.
- **Materials**: the drawing's materials (concrete, brick, insulation, plaster, floor finishes), each with a fill and a hatch, and a default one for walls of no material that cannot be deleted. A wall is of one material, drawn in its look; walls of one material are drawn as one, with a line between walls of different materials; a wall of several materials is several walls side by side, a door or window going through them all. A room's floor may be of a material.
- **Tables of quantities** placed on the drawing, kept up to date: the objects placed, floor areas by material, rooms, walls by material and thickness, doors and windows; columns and their words chosen per table.
- **Dimension chains** along a wall through its doors and windows, made on demand.
- **Quantities** exported as CSV: room areas, wall lengths, faces less openings and volumes, doors and windows by kind, floors and walls by material, the objects placed.
- **Modifiers**: non-destructive changes to how an object is drawn, stacked and applied in order, that can be switched off or removed at any time: crop, hatch, and repeat (copies in rows and columns); extensions can add more.
- Text can be bold and aligned left, centred or right.
- Hints and size fields that follow what you are doing: only the next step and the keys usable right now are shown.
- **Snapping** to the points of objects, the middle of a line, the crossing of two lines, the foot of a perpendicular, the line itself (wall faces and their corners included), and to the grid; angle constraint, drag handles, exact values in the properties panel.
- **Holding a direction**: while drawing or dragging, an arrow key keeps the wall, line, object or point upright or level, and pointing at a point elsewhere ends it level with that point.
- **Splitting** a wall, a line or a polyline with the Split tool, which shows the length on either side of the cut, so a part can be deleted or changed on its own.
- **Smart guides**: what is moved lines up with the sides and middles of other objects and keeps equal gaps with its neighbours, with lines and gap sizes shown while moving.

### Organising a drawing
- Pages, which can be duplicated with their contents and reordered by dragging, and layers with colour, visibility and lock. **On every sheet**: a title, a logo or a north arrow drawn once, in millimetres of paper, shows on every paper at its own scale, in the corner it was drawn nearest to, with fields (`{sheet}`, `{scale}`, `{page}`, `{project}`…) filled in for each sheet.
- **Groups**: several objects treated as one (`Ctrl+G`, `Ctrl+Shift+G`), nestable; double-click to edit inside. While inside groups and components, a breadcrumb in the top-left corner shows the way there from the page, and any place on it is one click back out; the places just left stay after it, faint, to go back in with one click. A group can be made see-through as a whole, with the Opacity slider in its properties.
- **Components**: a reusable definition with instances that all update together, each instance on its own layer (what the component holds is on none); double-click an instance to edit the component, or ungroup it (`Ctrl+Shift+G`) to turn it back into objects of the drawing. A placed component is stretched wider or taller by the sides of its frame on the plan (Shift on a corner keeps its proportions), and a parametric object can be vectorized into a group of its shapes.
- **Stacking order**: what is drawn over what, pictures included (a plan to trace stays under the floors and walls drawn over it); bring forward or send backward one step or all the way, from the properties panel, the right-click menu, shortcuts, or by dragging rows in the object list (several at once when they are selected).
- A Components panel listing the components of the drawing, with a search, as a list or as pictures, with how many times each is placed: place one by a click or a drag, rename it, open it to edit it (it fills the view, and leaving it brings the view back), delete it after a question; those placed nowhere are faint and can be deleted at once.
- A Structure panel listing the objects, with an icon per kind of object, expandable groups, lock and hide per object. Rows are dragged to change the stacking order, onto a group to put objects in it, and out of a group the same way.
- Cut, copy and paste, including between drawings and windows.

### Reusing and extending
- **Object library**: one searchable, illustrated grid of everything that can be placed: doors, windows, stairs and other parametric objects, and the warehouse libraries, each component taken from one a component of the drawing's own. What the drawing already holds is in the Components panel. Its sections are listed down its left side under Rooms, Building and Drawing, each counting what it holds or what a search found in it; a search looks through all of them. Door and window also have their own toolbar buttons.
- **Component warehouse**: browse libraries of ready-made symbols (furniture, bathroom, kitchen and electrical ship with the app, named in the app's seven languages; the furniture is listed by room: living room, dining room, bedroom, office; each symbol drawn in detail as seen from above), search, and click or drag onto the drawing to place. What is placed is always the library's symbol: one changed in the drawing since it was brought in stays as it is, beside it. Parametric objects are listed among the components of their kind, marked with a badge. More libraries can come from a catalog published on the web.
- **Extension warehouse**: install extensions that add new parametric objects (electrical symbols, plan annotations and adjustable furniture ship with the app), from the catalog, a web catalog or a file. The adjustable table, bed and shelving are resized on the plan by their sides, like a rectangle. These extensions are data, not programs, so installing one cannot run code.
- Any drawing can be imported as a component library.

### Working from an existing plan
- Drop a picture, a PDF, a drawing or an extension onto the window and it goes to the right place. A picture copied in another program (a browser, a screenshot) is pasted as a picture, on top of the drawing where you are looking, its transparency kept.
- Import a PDF (any one of its pages) or a picture as a background, set its scale from one known distance, and trace over it.
- Import a DXF: lines, polylines, circles, arcs, ellipses, curves and text on their layers, with their colours and weights; blocks as groups, hatches as fills, dimensions and leaders as dimensions and annotations. A DXF laid out as a sheet (from AutoCAD's paper space or SketchUp LayOut) comes in as a paper at its scale, with what each of its windows shows.

### Assistant
- A chat panel that changes the drawing from a description, through the same validated operations as the rest of the app; one undo per request.
- **It knows what is selected**: the selected objects (or wall corner) go with each message, in full and with what they measure, so "this" means what you point at; a label above the message box says what will be sent, and can leave it out.
- Conversations are kept and can be reopened from the selector at the top or with `/resume`; pictures can be pasted or attached; the model is chosen below the message; `/new`, `/model`, `/clear`, `/help`.
- Providers: Claude with an API key, Claude through the Claude Code CLI on the computer (desktop), a local model through Ollama, or any OpenAI-compatible service.
- **It checks its own work**: each edit comes back with what it left wrong (a room that does not close, a wall drawn twice, a door outside its wall), and it can look at the drawing and measure it.

### Agents
- An **MCP server** with the assistant's tools. The installed desktop app is one (`--mcp`), for the drawing open in it, where each edit can be undone: off until turned on in Preferences › AI, which gives the command that connects Claude Code. From a checkout, `opencalque mcp` also works on files.
- In the CLI: `check`, `quantities`, `png` and `guide`. An edit applied there makes the same drawing as in the editor.

### Application
- Desktop app (Windows, macOS, Linux) and web app from the same code, with **installers** built and attached to a GitHub release for each version tag.
- A **welcome window** at start (new drawing, open, recent drawings on desktop, or the bundled example) and an **About** window with the release notes, read from `CHANGELOG.md`.
- In the desktop app on Windows and macOS the menu bar is the window's title bar.
- A view bar in the corner of the drawing, opened by pointing at it: zoom slider and buttons, the scale seen on screen (1:50), zoom to fit, and the grid, snapping and temporary dimensions switched on and off.
- Menu bar, dockable panels that can be moved, tabbed, floated and closed, a command list (`Ctrl+K`) with every command and rebindable shortcuts, which can be exported to a file and imported back, a right-click menu, preferences.
- Autosave to the drawing's file, which can be switched off. Saving never leaves a half-written file (desktop).
- **Crash recovery**: unsaved work is copied aside as it changes and offered back after a crash. **Backups** (desktop): each drawing is copied before the app first writes over it.
- **Drawings stay readable**: what a newer version adds is kept; a newer format is refused with a message; a drawing with a broken reference opens repaired, with a note.
- A fault in one panel leaves the rest of the window working, and the drawing can always be saved.
- English, French, Spanish, German, Chinese, Japanese and Korean.
- Files are readable JSON with a published schema; a command-line tool creates, validates, edits and exports drawings.
- Export to PDF at true scale (one page per paper, with a title block), to SVG, to PNG (2000 to 8000 pixels wide) and to DXF. Chinese, Japanese, Korean, Greek, Cyrillic and Central European text prints in the PDF, in fonts shipped with the app, only the glyphs used embedded.

## 2. The next ten big features

Ranked by how much each one moves the app from "promising" to "usable for real work". Status is as of the date above.

| # | Feature | Status |
| --- | --- | --- |
| 1 | **Component warehouse** | **Done.** Bundled libraries, search, click or drag to place, web catalogs. |
| 2 | **Extension warehouse** | **Done** for data-only extensions (new parametric objects). Extensions that add tools or commands still have to be compiled in. |
| 3 | **Groups, stacking order, right-click menu** | **Done.** |
| 4 | **Cut, copy, paste** | **Done**, including across drawings. |
| 5 | **DXF export** | **Done** (lines, circles, text, layers), and DXF import: geometry, blocks (as groups), hatches, dimensions, leaders, and sheets laid out in paper space. Blocks do not become components yet. |
| 6 | **Sheets and printing**: paper size, drawing scale, title block, PDF export to scale | **Done**: papers with format, direction, scale and a title block; vector PDF export at true scale, one page per paper. Views of the plan at another scale on a sheet are in the ideas below. |
| 7 | **More drawing tools**: polyline and polygon tool, arcs and curves, typed lengths while drawing, room areas | **Mostly done**: one line tool for lines, polylines and polygons (a double-click closes the shape), typed sizes, room areas, arcs (by three points, a typed radius, or angles) and curves drawn as they are clicked, snapping to middles, crossings, perpendiculars and lines. An arc is still changed afterwards by its frame and angles, not by dragging its ends. |
| 8 | **Transforming**: rotate and scale handles, align and distribute, mirror, array | **Mostly done**: rotate (a tool, about a clicked point), mirror, uniform scale and nudge for any selection, from grips on the selection box, menus and shortcuts. Align, distribute, a repeat (array) modifier and smart guides while moving are done. One object is made wider or taller by the sides of its frame (a rectangle, an ellipse, a placed component, a stair, a washbasin, a bathtub, a hob, a sink, a fridge, a corner sofa, a radiator, the adjustable furniture); several selected together are stretched by their far side when a width or height is typed (walls keep their thickness and stay joined), and scaled evenly by the box's corners. |
| 9 | **Walls as a system**: openings that follow their wall, walls trimmed where they meet mid-span, moving a wall drags its neighbours, rooms detected from walls | **Done**, with selectable corners, joint types, walls of layers and curved walls; temporary dimensions to the walls around a selected wall, door, window or object, typed to move it; flipping a wall or a door with `Shift+Space`; a trim tool. |
| 10 | **Hosted version**: accounts, cloud storage, sharing by link, realtime collaboration | Not started. The data model is prepared for it (see ARCHITECTURE §10). |

## Ideas, in the order they seem worth doing

Agreed with the owner in October 2026. The first was built straight away.

**Walls and structure**
- ~~Corners as selectable nodes, joint types~~ (done)
- ~~Reusable wall types with thickness, fill and layers~~ (done, then taken out in 1.2: each wall carries its own material); ~~walls of materials~~ (done; layers inside a wall were tried and taken out for walls side by side, each of one material)
- ~~Curved walls~~ (done: bent from a straight wall; not yet drawn as an arc with the wall tool, extended or trimmed, or given a dimension chain)
- ~~Automatic dimensions for a run of walls~~ (done, not live); dimensions that follow the wall
- IFC export (walls, slabs from rooms, openings), now that walls have heights and types

**Sheets and output**
- ~~PDF export to scale, with a title block~~ (done)
- Views on a paper: part of the plan, cropped and at another scale (details)
- ~~Quantities as CSV~~ (done); ~~the same tables placed on a sheet~~ (done: tables of quantities, kept up to date)
- Levels (storeys), with the one below shown faintly

**Drawing comfort**
- ~~Smart guides: alignment and equal spacing against other objects while moving~~ (done); the same guides while drawing and resizing
- ~~Align, distribute, a repeat ("array") modifier~~ (done); a live mirror modifier
- ~~Snapping to midpoints, perpendiculars and intersections~~ (done, with the nearest point on a line); tangents and the quarter points of circles
- ~~Eyedropper~~ (done)
- Fills made of a picture, or of a texture (wood, concrete, grass), as more tabs of the fill window
- ~~Trim for lines~~ (done: the trim tool, for walls, lines and polylines); extend and fillet for lines
- ~~Offset~~ (done: the offset tool, for lines, polylines, curves, rectangles, circles and arcs; not walls, groups or other ellipses, and a shape that would fold over itself is refused rather than trimmed)

**Import and sharing**
- ~~DXF import~~ (done, with blocks as groups); blocks as components
- ~~PNG export~~ (done)
- A live demo on GitHub Pages; ~~downloadable installers~~ (done, unsigned by choice); ~~automatic updates~~ (done on Windows and Linux; macOS is told of a new version)

**Assistant**
- A preview of its changes to accept or refuse before they are applied
- "Trace this scanned plan": finding the walls in a picture
- ~~An MCP server, so outside agents can drive a drawing~~ (done, on files and on the open drawing)

## 3. Backlog, by area

Not ranked within an area.

**Drawing and editing**
- Rich text; angular and radius dimensions; dimensions that follow what they measure.
- Extend and fillet for plain lines (walls have extend, and everything the trim tool); boolean operations on shapes.
- Smart guides while drawing and resizing; snapping to tangents and the quarter points of circles.
- ~~Select similar; select by layer or type~~ (done, and by material); find and replace text.
- ~~Lock aspect ratio; non-uniform scaling~~ (done for rectangles and ellipses; a selection of several is stretched by a size typed, scaled in proportion by its corners); numeric move and copy.

**Architecture**
- Columns, beams, slabs, roofs in plan; curtain walls.
- Curved walls drawn directly with the wall tool, extended and trimmed, and dimensioned along their curve.
- ~~Schedules of doors, windows and rooms placed on a sheet~~ (done, with floors, walls and materials); a table of each wall or each door one by one, with a mark drawn beside each on the plan.
- Walls of materials: a command that lays a lining against a face of the selected wall; walls laid against one another moved together.
- Sections and elevations linked to the plan.
- More stairs: winders, landings of any shape, handrails, break line.

**Components and extensions**
- A richer library, drawn like the furniture already there (ARCHITECTURE, "How the symbols are drawn"); sized pieces as parametric objects. Living: three-seat sofa, rectangular coffee table, TV unit, rugs, plants, piano, fireplace. Dining: round table with chairs, chairs at the ends of a table, sideboard, bench, bar stool. Kitchen: units of any width, corner, wall and tall units, dishwasher, oven, hood, gas or induction hobs, island with stools. Bathroom: shower with screen and drain (tray, walk-in, quadrant), glass screen, corner and freestanding baths, vanity unit, towel radiator, bidet, urinal. Bedroom: bedside table, chest of drawers, wardrobe with hinged or sliding doors, dressing table. New rooms: children's room (cot, bunk bed), entrance (coat stand, shoe cabinet), laundry (dryer, stacked washer-dryer, utility sink, water heater, boiler), heating and plumbing (radiator, floor drain, air conditioning), outdoor (trees, shrubs, hedge, garden table, sun lounger, parasol, barbecue, pool), garage (cars, parking space). Office: office chair on its own, desk and L-shaped desk, drawer unit, meeting table. Architecture: columns, shaft, lift, ramp; pocket, folding and garage doors; skylights. People seen from above, and the 1500 mm turning circle of a wheelchair.
- Component properties that vary per instance (text, sizes, visibility of parts); swap one component for another.
- Favourites in the object library.
- Publishing: package a library or extension and submit it to a public catalog; versioning and updates for installed extensions.
- Extensions that add tools, commands, panels and import/export formats, loaded at runtime in a sandbox with declared permissions.
- Translations of the extensions' own texts beyond what they carry.

**Import and export**
- DWG import; IFC export; ~~PNG export at a chosen resolution~~ (done).
- Straighten and crop a scan; trace a scan automatically.

**Assistant**
- Approval before applying changes, with a preview; edit history per request.
- Rendering of formatted replies.
- Tracing an imported plan into walls with a review step; checking a plan against rules (door widths, room sizes).

**Application**
- ~~Dark theme~~ (done); touch and pen input; high-contrast mode.
- ~~Crash recovery~~ (done); version history.
- ~~Automatic updates~~ (done on Windows and Linux; macOS, unsigned, is told of a new version and offered its page); ~~file association for `.opencalque`~~ (done, macOS included).
- Performance on drawings with tens of thousands of objects (caching per object, then GPU rendering).
- ~~Automated interface tests~~ (done for the main paths, `pnpm e2e`); more of the panels.
- More languages, right-to-left support.
