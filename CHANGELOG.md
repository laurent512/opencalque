# Changelog

What changed in each version of OpenCalque. The app shows this list under About, and the text of
a version becomes the description of its release on GitHub. Newest first; one `## version — date`
heading per version, then `### New`, `### Improved` or `### Fixed` with one line per change.

## 1.2.0 — 2026-10-25

A change of the format that breaks with 1.0 on two points: what a component holds is no longer on a layer, and a placed component no longer has a stroke or fill of its own; and there are no wall types any more, each wall carrying what it is made of. Drawings made before are brought up to date as they open and look as they did, but for the rare cases listed under Improved. Scripts that set any of these are refused with a message saying what to do instead, and drawings saved by this version do not open in 1.0 and 1.1.

### New
- A PicoRunner manifest and launch badge for running the web editor locally. Drawings still use the browser’s file open/save workflow.
- Grid lines, with the text tools (G): the axes of the building, drawn by two clicks, each with its letter or number in a circle at its start, its end or both. Each one drawn takes the next label (B after A, 2 after 1, AA after Z), set beforehand in the properties while the tool is in use; double-click a bubble to change its label in place. A label too long for the circle stretches it into a pill. They are drawn in dash and dot unless given another line; the circle and the label take the line's colour but are never dashed, and the label stays upright however the line is turned.
- A selected wall shows what its ends hold to: a filled dot where it is joined to another wall, which is outlined faintly (what follows when the corner moves), a struck-through dot where it touches a wall without being joined to it, and an orange dot where it stops a few millimetres short of another wall's end, as traced plans often do. Its properties say the same for each end, with Detach (the end is joined to no wall, though others end there, and no longer follows them), Join again, and Join them (the end is brought exactly onto the other).
- The Components panel lists, beside the components, the objects placed from the library with their settings (not doors, windows, stairs or a north arrow, which make the building or the drawing): two placed with the same settings are one entry, and two with different ones two (a radiator of 80 cm and one of 1.20 m), named by what tells them apart, each with how many there are. A click places one more as it is; its pencil selects them all to change them together; it can be gone through one by one, replaced by any other entry, component or object, and deleted. The table of objects placed counts them the same way, each drawn with its settings.
- The instances of one component can be made instances of another, where they are and as they are turned and scaled: all of them from the Components panel (Replace its instances with another component), or those selected from their properties (Component). Two components drawn twice over and used here and there so become one, and the tables count them together; the one left is placed nowhere, to be deleted.
- Going through the instances of a component one by one: the framed eye beside it in the Components panel, or a right-click on an instance, shows each in turn, on its page or in the group or component that holds it, selected and in the middle of the view. A bar over the canvas says which of how many it is, steps to the one before or after (Alt+← and Alt+→), selects at once those where the editing is, and Escape closes it.
- A table of quantities can show only the rows chosen (Rows shown: All or Chosen, then Yes or No for each thing it counts), its total adding up only those, and goes on in blocks side by side past a number of rows (Rows per block), each block with its headings: a long legend stays on its sheet.
- A table of quantities can be vectorized (right-click, or Object › Vectorize): what it shows becomes a group of lines and texts, its symbols included, to be edited or laid out by hand. It no longer follows the drawing.
- The table of objects placed draws each object beside its name, as it is drawn on the plan (a Symbol column): placed from the object library, it is a legend of the plan that keeps up with it.
- A radiator in the object library, under Heating: placed against a wall by its back, made longer or deeper by its sides with its sections keeping their width, and its valve at the end chosen.
- Materials: a Materials panel lists what the drawing is built of (concrete, brick, insulation, plaster, a floor finish), one to a row, with a swatch of its colour and hatch that a click changes. A wall's properties, or a room's for its floor, pick one of them from a list showing each with its swatch, with a box to find one by name and a + to make a new one; "Add common materials", in the panel, brings a dozen usual ones, drawn as plans usually draw them. First in the panel is Default, what walls are made of until given another: change its fill or hatch and every wall of no material follows. It cannot be deleted, and the walls of a material deleted become of it.
- Walls of materials: a wall is drawn in the colour and hatch of its material, which is its fill (a wall has no fill of its own to set any more), and walls of one material that meet are drawn as one, while a line is drawn between walls of different materials that touch. A wall built of several materials, brick lined with insulation and plaster, is drawn as several walls side by side, each of one material and its own thickness: draw them by the face they share (the reference line) so that they stay flush. A door or window set in one of them goes through those laid against it, and a lining drawn from the corner of a room ends square against the other wall of the corner rather than being joined to it, as does a lining drawn up to a wall that stops against the wall it lines. The zigzag of an insulation runs along its wall from one face to the other. Select several walls to give them one material at once.
- Tables of quantities, placed from the object library (Drawing › Tables of quantities): the objects placed, floor areas by material, the rooms, the walls by material and thickness, the doors and windows. A table counts what is on its page and changes with it; what it counts, its columns and the words over them are set in its properties, and it is written in the language and with the decimal mark of whoever placed it.
- A room's floor may be of a material, whose colour and pattern it takes and under whose name it is counted.
- The quantities exported as CSV also give the material of each wall, and list the floors and the walls by material, and the objects placed.
- A Components panel, a tab beside Layers and Pages, lists the components of the drawing, one per line or as pictures side by side, with how many times each is placed and a search by name. Click one and then click on the drawing to place it, or drag it there; double-click its name to rename it. Selecting a placement highlights its component.
- A component placed nowhere is shown faint, and those can all be deleted at once, from the panel's ··· menu or with Delete unused components (Ctrl+K).
- Deleting a component asks first, saying how many placements go with it.

### Fixed
- A hatch no longer looks finer on a short wall than on a long one of the same material: a spacing too fine for a shape used to be widened shape by shape, by as much as it took. Each pattern now has a finest spacing (4 cm for dots, 5 mm for lines), the same for every shape, which the Spacing field shows; only a shape of hundreds of square metres has it widened.
- A point dragged level or upright with another (with Shift, an arrow key, or lined up with a point the pointer rested on) lands exactly level or upright with it, however many decimals that point has, as those of a traced plan do: it used to be a few ten-thousandths of a millimetre off, enough for a wall to be "not quite level: 0° off". The note now shows only for a real difference, with as many decimals as it takes, and Straighten makes a wall exactly level.
- Two walls making an L whose outer faces run on from one another no longer give one of them an outline running out under the other and back: its selection showed a line under the other wall, its hatch could spill there, and the exports drew that stretch of the corner twice.
- Where a wall crosses or overlaps a wall of another material, the one in front in the Structure panel is drawn in front, its hatch and its outline over the other, on screen and in the exports. The hatch of the wall behind used to show through it, and neither wall's outline was drawn where they overlapped.
- The line between walls of different materials was left out where one wall's face was a little off the other's, by a fraction of a millimetre or a slight lean, as in a plan traced by hand: it is drawn wherever the faces are within 5 mm and 1° of each other.
- Dissociating a component, ungrouping, and bringing forward or sending backward no longer fail where objects side by side in the stacking order share a place in it, which drawings can hold (objects placed one after the other, an older file).
- A component picked in the object library and not put down (Esc) no longer stays in the drawing: it comes in with its first placement, which one Ctrl+Z takes back whole.
- A component opened to be edited from the Components panel or the object library fills the view, in its middle, and leaving it brings back the drawing as it was on screen, as what is on every sheet already did.
- The left column opens wide enough for its three tabs, Layers, Pages and Components, in every language: Components was left behind the ··· in German, Spanish and Japanese, and on Linux.
- Panels keep their width and the drawing takes the difference: the line between two columns side by side resizes the outer one without widening the other, and a panel closed leaves its room to the drawing rather than making every column as wide as the others.

### Improved
- The save dialog shows the type of the file being saved, OpenCalque (*.opencalque) for a drawing or PDF, SVG, DXF or CSV for an export, and adds its extension to a name typed without one (#3).
- The length of a wall or a line can be typed in its properties, where it was only shown: it grows or shrinks in its own direction from its start (from its end when only its start is free), the walls joined at the end that moves following it, and a curved wall keeps its shape (#4).
- With several objects selected, the properties show how wide and high they stand together, as the box drawn round them (#4).
- In the Properties panel, what is yes or no (a column of a table shown, the total row, the title block of a sheet, the line between two walls at a corner, a setting of an object or a modifier) is chosen between two tabs, Yes and No, in place of a checkbox.
- Tables of quantities count the rooms, walls, doors and windows inside the components placed on their page too, once for each placement and at the size it is drawn: a building whose floors are drawn as components, placed on a page, is measured there. A new table of walls heads its area "Face area", upright, so that it is never read as a floor's.
- The lines of walls are drawn on their faces, centred, as every other line is. They used to be drawn just outside the walls, so that something set against a wall (a basin, a rectangle, the edge of a floor) showed half a line off it, and the line between walls of two materials stepped where it met their outline. Drawings look the same, but their SVG and PDF exports are written differently for walls.
- A wall or a line shows its angle in its properties, to a thousandth of a degree, and says when it is nearly but not quite level or upright, as walls traced by hand often are, with a Straighten button beside. Typing an angle, or dragging it with Alt by whole degrees, turns it about its start, its length kept and the walls meeting its other end following; about its end when only its start is free, so that the walls meeting it stay put.
- The line across the end of a wall can be dragged where it meets another wall too, when that line is drawn, as at the step between a thick wall and a thinner one carrying on from it: the step moves along the walls, one getting longer and the other shorter, and they stay joined.
- A point being drawn or dragged (a corner, the end of a wall or a line) lines up with points the pointer rested on a moment, marked by a small cross: upright from one and level with another, it goes where the two lines cross, with a guide to each; upright or level with one, along it. The start of the line being drawn counts too, so a line comes level or upright with where it starts. Only those points: lining up with every point of a plan would happen almost anywhere.
- Shift on the end of a wall or a line, or on a corner, being dragged holds it to its own line as before, or to a level, upright or 45° line through its other end, whichever the pointer is nearer: a slanting wall is made level by dragging its end with Shift.
- A wall that stops against the side of another is cut along that side, wherever its line ends in the other wall: at an angle it now lies flat against it, with no gap left beside it. Drawings made before look the same, but their SVG and DXF exports are written a little differently where walls stop against others. Between walls of two materials, the order of the Structure panel decides: a wall over the other in the list keeps its length and is drawn over it (a brick pillar over an insulation), one under it is cut along its face. A wall just drawn is on top: send it under with [ for it to stop against the face.
- Changing a wall's reference line leaves the wall where it is: its line, and its corners, go onto the face or middle chosen, the walls joined there following, and a thickness given afterwards grows away from it. It used to keep the line where it was and move the wall across it.
- Wall types are gone, with their panel: a wall carries its own material, thickness, height and look, and walls are made alike by selecting them together. In a drawing made before, each wall type becomes a material of the same name, with its fill and hatch, which its walls are made of: they look as they did, change with the material in the Materials panel, and are counted under its name in the tables and the CSV. Each wall is given the rest of what its type gave it (its thickness, height and outline), so it measures as it did. The layers of a type, drawn as lines inside its walls, are let go: those lines are no longer drawn, and a wall of several materials is drawn as several walls. Where a wall of a type meets a wall of another type or of none, a line is now drawn between them, as between any two materials. The CSV export has no table of wall types.
- Removing a shared colour leaves the dimension styles and materials that used it in the colour they had, as it already did for objects and layers.
- The object library holds what can be brought in, and the Components panel what the drawing holds: the library no longer has an "In this drawing" section. Each time a component is taken from the library, or from a drawing on this computer, it comes in as a component of its own, numbered after one of the same name (Socket, Socket 2), rather than sometimes the copy already there and sometimes a new one; clicking several times on the drawing after taking it places that same one. To place more of one already there, take it from the Components panel.
- Words that keep things apart. The window that lists everything that can be placed is the Object library: it holds components, which you draw and edit from inside, and parametric objects, drawn from their sizes and options, which the properties now call so. Object › Create component is Object › Make into a component, since the selection is replaced by a placement of the new component.
- Vectorize turns a parametric object into a group of the shapes it draws, in its place, instead of a component: edit them at once, and make them into a component afterwards if it is to be reused. The white that hid what lay under the object comes along as a group of its own, White background, which can be deleted.
- What a component holds is on no layer: a component takes the layer of each place it is put, which decides whether it shows, whether it can be picked and the colour of what it leaves uncoloured. Making a component takes its shapes off their layers and puts it on theirs, ungrouping one puts its shapes on its layer, and the Layer field is gone from what is inside a component. Hiding a layer no longer hides part of a component placed on another layer. In a drawing made before, what was hidden or locked with its layer stays so, and what took its layer's colour (lines, shapes, texts, walls, rooms, dimensions) keeps that colour as its own, except where every placement of the component is on that same layer and still gives it. A parametric object inside a component takes the colour of the placement's layer instead.
- A placed component has no stroke or fill of its own any more, nor the button that took them off. In a drawing made before, a placement given one is turned into a placement of a copy of its component, named after it with a number, which carries that look. Three things can look slightly different: a hatch given to a placement starts from the component rather than the drawing, a component placed inside another on a layer of another colour takes the colour of the outer one, and a styled component inside another styled one keeps its own dashes.

## 1.1.0 — 2026-10-18

The desktop app now updates itself. Anyone on 1.0.0 downloads this version by hand once; from here on, new versions come by themselves.

### New
- The Windows setup and the Linux AppImage update themselves: a new version is downloaded in the background and installed when the app closes, and the menu bar offers to restart into it. On macOS and with the portable Windows app, the menu bar says when a new version is out and opens its page. Preferences › General turns the check at start off, and Preferences › Check for a new version… asks at any time.
- Every fill is chosen in one window, with a tab for no fill, a solid colour and a hatch; a hatch's colour, opacity, weight, spacing and angle are set there, with a preview. The same window serves shapes, walls, wall types, the floors of rooms and the bar above the tools.
- A picture copied in another program (a screenshot, an image copied in a browser) is pasted with Ctrl+V as a picture: on top of the drawing where you are looking, at the size it had on screen, its transparency kept.

### Improved
- The bar above the tools gives the next shapes the colour of their lines, shown as the layer's until another is chosen, and gives closed shapes a fill; line weights and kinds of line are set afterwards, in the properties. The eyedropper, with nothing selected, takes both from an object.
- Pictures are drawn where they are in the stacking order: a plan to trace stays under the floors and walls drawn over it, and a picture brought forward goes over them.
- A loading screen shows the logo while the app starts, instead of a blank window.

### Fixed
- A shape inside a component looks the same while the component is edited as where it is placed: left unfilled it is white in both, as its Fill field now says, and given no fill it stays see-through. A see-through group inside a component stays see-through where it is placed.
- In the bar above the tools, the line and fill windows open at the first click when going from one to the other, and the tabs of the fill window keep their names on one line.

## 1.0.0 — 2026-10-15

The first stable version of OpenCalque. From this version on, a drawing stays readable by every later version: what a newer version adds is kept when an older one opens and saves it, and a drawing an older version cannot read is refused with a message rather than half-read and saved back. This is what changed since 0.8.5; the notes of the release candidates, 1.0.0-rc.1 to rc.4, give the details.

### New
- The interface in Korean, chosen under Preferences › Language or followed from the system, with the component library, doors, windows and stairs named in Korean too. Korean text in an exported PDF prints in a Korean font that ships with the app.
- Unsaved work survives a crash: a moment after each change the drawing is copied aside, and the next start offers it back in the welcome window. The desktop app also keeps a copy of each drawing as it was before it first writes over it (File › Show backups of drawings), and saves by writing beside the file and then putting it in place, so a crash while saving never leaves a half-written file.
- A drawing written by hand or by a script that refers to something missing opens with the problem put right and a note saying so, instead of being refused or refusing every change.
- A wall can be drawn by one of its faces and keep it, so that walls of different thicknesses stay flush inside; made thicker or thinner from one side by dragging that face; and made longer or shorter by the line across its free end. Joined walls stay joined, walls that stop against it keep reaching it, and its doors and windows stay in its middle.
- Things are resized by their sides on the plan, the side opposite staying put: rectangles and ellipses, placed components (stretched one way, and given their proportions back from their properties), stairs in whole steps, the adjustable table, bed and shelving, and doors and windows by either of their ends.
- Washbasins of one or two bowls, a bathtub, a hob, a sink, a fridge and an American fridge are parametric objects whose bowls, zones and rims keep their size as they are resized; a corner sofa takes a seat for about every 65 cm of its sides; the bathroom library has a wall-hung toilet, and windows can have triple glazing. Those placed from a library before stay as they were.
- A parametric object can be vectorized into a component of the shapes it draws, and a component ungrouped back into objects of the drawing.
- The assistant knows what is selected: a label above the message box says what will be sent, and a click on its × leaves it out of one message.
- Colours can follow the colour of the layer and can be see-through; the colour window has an eyedropper; a group can be made see-through as a whole.
- Dimension styles, shared by the dimensions drawn in them; and the text of a vertical dimension can read from bottom to top, as ISO 129 asks, or from top to bottom.
- Paste in place (Ctrl+Shift+V). Inside a group or a component, the top-left corner of the drawing shows the way there from the page, each place on it one click back out, and the places just left one click back in.
- A card of the component library can be dragged onto the drawing, and is put down where the button is let go.
- On macOS, a drawing double-clicked in the Finder, or dropped on the app in the Dock, opens in the app.

### Improved
- Large drawings are much faster: a DXF of twenty thousand lines is imported in a fraction of a second instead of forty seconds, a plan of two thousand walls redraws in a few hundredths of a second while it is dragged, and the Structure panel lists any number of objects.
- Rooms are found from the walls as they are drawn: a room closes exactly when its walls touch, its floor runs along their faces, and it no longer depends on the order the walls were drawn in or which way round. A room's floor takes a colour and a pattern directly, and a selected room shows only its outline.
- The component library is larger, with its sections down its left side, the furniture listed by room, and every section searched at once; it opens on the section looked at last, adds a whole section at once, and its furniture and fittings are drawn in detail as seen from above.
- Paste puts things where you are looking, on top of what is there; something cut out of a component and pasted on the page lands where the component drew it.
- The points of dimensions, measurements and angles snap to what is drawn, never to the grid. With Shift a wall, a line or a dimension keeps to its direction and still stops on the lines it crosses and comes level with what is pointed at; something moved lines up with what is inside groups.
- The properties panel is lighter: arranging is in the toolbar's Arrange menu, renaming in the Structure panel, an angle typed turns an object about its middle, and line weights are six pen sizes shown with a sample.
- The Structure panel shows what is picked on the drawing, and its rows are dragged into and out of groups.
- The panels' tabs are quieter; a row of tabs too narrow for them all shows those that fit whole and lists the others behind a "···"; dragging a panel by its tab is steadier.
- The right-click menu shows only what applies to what was clicked.
- The assistant is told more precisely how drawings work and which properties it wrote mean nothing, can read chosen objects in large drawings, and offers Claude Haiku 5.5.
- The desktop app asks once before the assistant reaches an AI service that is not on this computer, its window can no longer be sent to another page, and the installed program can no longer be started as a plain Node program.
- The command line: new refuses to replace a file without --force, validate lists what opening a file would put right, apply warns about properties the format does not know, and --version prints the version.

### Fixed
- A drawing with a wall whose wall type was missing refused every change; copying a wall with a wall type, or a dimension with a style, into another drawing failed.
- An order such as "top", written by the assistant or a script, stopped anything more from being added to that page.
- A stair or a window given a huge number of steps or panes, or an extension object repeated a huge number of times, froze the app.
- Ctrl+X followed quickly by Esc cut nothing, and something pasted could go back under what had been drawn after it.
- What is stacked under the walls in the Structure panel was drawn over them.
- Ctrl+Z and the other shortcuts did nothing right after a slider was dragged or a box ticked in the properties panel.
- A component taken from the library is always the library's own: one placed before and changed in the drawing since stays as it is, and the library's comes in beside it.
- Drawings exported from the command line (as SVG, PDF or DXF) show the adjustable furniture, the plan annotations and the electrical symbols of the extensions that ship with the app, where they showed a placeholder box.

## 1.0.0-rc.4 — 2026-10-15

### New
- A wall is made longer or shorter by the line across its free end: select it and drag that line, and the end goes along the wall, which keeps its direction, the other end staying where it is. Its length is written as it changes. The point at the end still moves it anywhere, as before.
- A group can be made see-through: Opacity, under Appearance in its properties, fades everything in it, from 0 to 100 %, on top of the opacity of each thing (a group inside it fades again). The drawing follows the slider as it moves, a drag of it is one step to undo, and SVG and PDF exports keep it. A picture's opacity is set with the same slider.
- The kitchen's hob, sink and fridge are parametric objects, made wider or deeper by pulling their sides on the plan. The hob keeps the size of its zones: four on 60 cm, five from 75 cm, as on hobs of 80 and 90 cm, two one behind the other on a narrow one. The sink is a bowl alone, 80 cm wide, or two bowls, with a ribbed draining board on the left or the right if wanted; its bowls keep their size. Beside the fridge is an American fridge with two doors (910 × 730). Their width, depth, bowls, draining board and doors are also in their properties. A sink unit, a hob or a fridge placed from the library before stays as it was.
- A corner sofa, in the living room: its backs go along two walls, its corner on the left or the right, and pulling its sides makes it longer, each side taking a seat for about every 65 cm, with its back cushion. Its length, the length of its return and its depth are also in its properties.

### Improved
- Inside a group or a component, the top-left corner of the drawing shows the way there from the page (Page 1 › Kitchen › Sink), each place with its icon from the Structure panel, instead of a coloured bar in the middle naming only where you are. It grows to the right as you go further in, so nothing already shown moves. A click on any place along it goes straight back out to it, with what was gone into selected and the drawing where it was on screen; a long way folds its middle into a list. The places you came out of stay after it, faint, even back on the page: a click on one goes straight back in, as far down as you were, the drawing where it was then. They go when you go into something else, change page, or press Esc on the page with nothing selected. Esc goes out one step: from a component to where its placement is, a group or another component, no longer straight to the page. There is no Done button any more: every place on the way is one click out. What the red and green axes are in a component is said in the hints.
- The component library lists the furniture by room: Living room, Dining room, Bedroom and Office, each with the adjustable pieces that belong there (the table with chairs in the dining room, the bed in the bedroom). "Add all of these" copies what a section shows into the drawing at once.
- The component library is larger and lists its sections down its left side, under Rooms, Building and Drawing, each with how many things it holds, rather than as a row of buttons over the pictures: there is room for more sections and for more pictures at once. A search looks through every section, wherever the library was, each section counting what it found, and the library comes back to its section when the search is cleared. Each card is one picture with its name and its size on one line, the size of an adjustable object in the unit you work in; what else there is to know is in its tooltip. At the foot of the list, "From a file…" copies the components of another drawing into yours, then shows them under "In this drawing", and "From the web…" takes the address of a web catalog; the line of hints and buttons under the pictures is gone, "Add all of these" being beside the name of the section it adds. The window closes from the cross in its corner, as with Escape or a click beside it. In a narrow window the sections are a list to pick from, beside the search.
- The bathtub is a parametric object, like the washbasins: pulling its sides on the plan makes it longer or wider while its rim keeps its thickness and its drain its size, near its end. Its length, width and rim are also in its properties. A bathtub placed from the library before stays as it was.
- The component library opens on the section looked at last (Bathroom, Furniture…), even after the app was closed, instead of on All every time. It opens on All when that section has nothing to show, as "In this drawing" in a drawing with no component of its own.
- The furniture and fittings of the component library are drawn in detail, as seen from above: the desk's chair is an office chair with its backrest, armrests and casters (it was a circle), the chairs have a curved backrest, the sofa and armchair their arms and cushions, the beds their pillows and a turned-back duvet, the wardrobe its rail and hangers, the toilets their seat and cistern, the shower tray its slopes, the washing machine its drum and controls. The adjustable table and bed, the washbasins and the bathtub are drawn the same way. Their outlines are rounded where the real thing is, and what lies within them is in thin lines. A drawing that already holds one keeps the one it has.
- Shapes in an extension written as data can have rounded corners: a `path` with a `radius`.

### Fixed
- With Shift held, a wall, a line or a polyline being drawn keeps to its direction (level, upright or at 45°) and still lines up with what is around it: its end stops on a wall or a line it crosses near the pointer (the middle of a wall or one of its faces, the lines of a traced plan, the side of a shape), and comes level with a corner or an end pointed at elsewhere, a dotted line showing which. Before, Shift took it off everything and only went by the grid. Holding a direction with an arrow key stops on these lines too, not only on walls.
- What is stacked under the walls in the Structure panel is drawn under them, on the screen and in exports. Before, walls were always drawn first, so a shape placed beneath them came on top: seen from outside a component, a dashed boundary along a wall's face hid that face, the white a placed component puts inside its shapes covering the wall's line. Whatever is stacked over a wall, or between two walls, is drawn over the walls as before.
- Ctrl+Z and the other shortcuts work again right after a slider was dragged or a box ticked in the properties panel; the field kept them, as a text field does.
- Clicking the wall-hung toilet in the component library could place a double washbasin instead, in a drawing that had taken one from the library while 1.0.0-rc.3 was being made. The toilet now has a place of its own in the library. In a drawing that already holds it from 1.0.0-rc.3, placing it from the library again adds a second copy of it, drawn the same.

## 1.0.0-rc.3 — 2026-10-14

### New
- The washbasin is now a parametric object, beside a new double washbasin: pulling its sides on the plan makes its counter longer or deeper, and its bowls and taps keep their size, each bowl in the middle of its share of the counter. Its depth and number of bowls are also in its properties. A washbasin placed from the library before stays as it was.
- The bathroom library has a wall-hung toilet (360 × 540), with a straight back and a rounded front.
- A placed component, a bathtub from the library for instance, is stretched on the plan by a frame like a rectangle's: a side makes it wider or taller, the side opposite staying put, a corner both, Shift keeping its proportions, and the knob above still turns it. Its sizes are written beside it as it changes, and "Back to its own proportions" in its properties undoes the stretch. Ungrouped, a stretched component gives the shapes it draws, in a group.
- A parametric object can be vectorized into a component (Object › Vectorize into a component, or Vectorize in the right-click menu): the shapes it draws become a component of the drawing, placed where it was, to be edited one by one. A door or window made so no longer cuts its wall.
- Stairs are resized on the plan, by a frame like a rectangle's: pulling the top of a straight stair adds or takes away whole steps, its foot staying where it is, and pulling its side makes it wider. An L-shaped stair lengthens its first flight by its top and its second by its side; a U-shaped one adds a step to both flights, and widens the gap between them by its side; a spiral stays round. Its length and width are written beside it as it changes, and the knob above still turns it.
- The adjustable table, bed and shelving are resized on the plan by their sides and corners, like a rectangle: their length and width change and they are drawn again at that size (a bed takes a second pillow once wide enough), while the knob above still turns them. An extension written as data can say which of its lengths are its width and height to be resized the same way. An extension that ships with the app and was installed before is brought up to date by itself.
- In the Structure panel, a row dropped on the middle of a group's row goes into the group, which opens to show it; dropped above or below a row inside a group, it goes there; and a row inside a group, dropped among the rows of the page, comes out of it.
- Windows can have triple glazing, beside single and double. In German, Chinese and Japanese, single and double glazing were called by the words for a door of one or two leaves; they now have their own.
- A door or a window is made wider or narrower by dragging either of its ends along its wall: the other end stays where it is, and the width is written beside it as it changes. It no longer has a box around it that scaled the whole of it, frame and sill included. An extension's own objects can say which of their lengths is stretched this way.
- A wall can be drawn by one of its faces and keep it: the points clicked with the wall tool, when the bar above says "along the left face" or "along the right face", are the wall's corners on that face, instead of being turned into corners on its middle line. Walls of different thicknesses drawn by their inner face stay flush inside, the step showing outside, and making a wall thicker, by its field, its wall type or its other face, makes it grow outwards without moving anything else. The Properties panel shows a wall's Reference line (its left face, its middle or its right face) and changes it: the corners stay where they are and the wall moves to the other side of them, with its doors and windows; pointing at a face there shows it on the drawing. Drawings from before keep their walls as they were, on their middle lines.
- A wall gets thicker or thinner from one side: select it and drag one of its long faces. That face follows the pointer and the other stays where it is, so a wall can grow outwards without taking room from the rooms inside. The walls joined to it stay joined, walls that stop against it keep reaching it, and its doors and windows stay in its middle. The thickness is written beside the face as it changes; Ctrl (⌘ on a Mac) moves both faces at once, and Alt ignores snapping, as it does everywhere. A wall that carries straight on from the one made thicker is left where it is, the two then butting against each other, rather than turned a little. The face lights up along its whole length as it is drawn, to the corners at its ends, before it is dragged. Zoom in on a wall drawn too thin to grab a face.

### Improved
- The Structure panel lists every object again, however many, with no "Show more": only the rows in sight are drawn, so twenty thousand scroll like twenty.
- What is selected on the drawing is shown in the Structure panel: its row is scrolled to, however far down. Picking in the list itself does not move it.
- The angle typed in the properties panel turns an object about its middle, as the knob above it does. A rectangle swung about its corner and a component about its insertion point, which could be far from what it draws.
- The properties panel is lighter. The Mirror box is gone: it could only say left to right, so a thing mirrored top to bottom showed as mirrored and turned 180°; Shift+H and Shift+V, and the list beside the Rotate tool, mirror either way. The stacking order buttons and the align and spacing buttons moved to the toolbar's Arrange menu, which now opens with one object selected. The Name field is gone too: things are renamed in the Structure panel by double-clicking their row, except a room and a paper, whose name is drawn and keeps its field.
- A selected room no longer shows corners to scale it by and a knob to turn it by, which did nothing a room could use: it follows its walls, and only its name is moved, by dragging it. Clicking the floor of a selected room no longer takes hold of it either. Nor is it shown with a rectangle around it any more, which stood out from its outline for a room that is not a rectangle (under an arch, with a slanted wall): only its outline is lit.
- A room's properties come in two sections: Name, with the name, where it is written, its Text size, its Text colour and whether the area shows; and Floor, with its colour and now a pattern (tiles, planks, lines) chosen there directly, as for any filled shape, instead of through a Hatch modifier.
- The colour window says "Colour of the layer" without the layer's name, which the Layer field just above already shows.
- The component library lists parametric objects among the components of their kind, with a small badge in the corner of their card, instead of in a group of their own: the adjustable table with the furniture, sockets with the electrical symbols, doors, windows and stairs under Architecture, the north arrow and scale bar under Annotation.
- The right-click menu no longer says "selection" at every line: it is what was clicked that it acts on. It offers Zoom to it, Duplicate, Delete, Group together and Create a component; the menu bar and the command palette keep their full names. It no longer offers turning and mirroring, which are in the toolbar beside the Rotate tool, in the Object menu and on Shift+R, Shift+H and Shift+V.
- Line weights are six pen sizes, from 0.13 to 0.7 mm, each shown with a sample of its thickness beside its number, in the field and in the list. A weight of 1 or 1.4 mm already in a drawing stays as it is, and is still listed where it is used.

### Fixed
- Rooms are found from the walls as they are drawn: a room is the space its walls leave, its floor running along their faces. It closes exactly when its walls touch on the drawing, even at a corner drawn a few millimetres short, and it no longer depends on the order the walls were drawn in or which way round: before, two plans drawn alike could get different rooms, rooms whose walls touched all round could stay open, and floors could slant, go into a wall, or leak into the next room, around walls of different thicknesses that meet or butt, or a thick wall that stops close to the end of a thin one. A wall standing in a room, or a free-standing column, is no longer counted in its area. A plan's rooms are now checked against hundreds of plans drawn at random with each test run.
- Changing the colour of a room's name no longer draws an outline round its floor in that colour.
- Something moved lines up with the walls and shapes inside a group, not only with the box around the whole group: a washbasin dragged towards a wall of a plan whose walls are grouped now comes against its face.

## 1.0.0-rc.2 — 2026-10-14

### New
- Any colour can follow the layer: the colour window offers "Colour of the layer", for a fill, a text, a pattern, as a stroke without a colour of its own already does. Change the layer's colour and they all follow.
- An eyedropper in the colour window takes a colour from anywhere on the screen (in Chrome, Edge and the desktop app).
- Colours can be see-through: the colour window has an opacity slider under the hue, and its code takes two more digits for it (`#e5484d80` is half see-through). A shared colour can have one too, and the SVG and PDF exports keep it.
- Paste in place (Ctrl+Shift+V, and in the right-click menu): pasted exactly where it was copied from, to put the same thing at the same place on another page.

### Improved
- A rectangle or an ellipse is resized as a box: the middle of a side changes one size, a corner both (Shift keeps the proportions), the opposite side staying put, and the knob above turns it. A turned rectangle keeps this frame; its corners were points to drag before, and it lost them once turned.
- Something taken out of a component (double-click the component, cut what is inside, Esc, paste) lands on the page where the component drew it, turned, mirrored and sized as it was seen; and something copied on the page and pasted into a component opened from one of its placements lands where it was seen too.
- The colour window shows one row of recent colours, the last eight, instead of two, and unlinking from a shared colour is a button beside the eyedropper (its tooltip says what it does) rather than a row of its own: the ticked shared colour already shows the link.
- A shared colour is changed in the app's own colour window, with the recent colours, the eyedropper and the opacity, instead of the system's colour picker. Swatches show a see-through colour over a checkerboard.
- The Structure panel lists the first 300 objects and shows the rest on demand: after importing a large DXF, it took several seconds to list every line, and again after each change.
- Paste puts things where you are looking. A cut thing comes back exactly where it was; a copy goes beside its original when that is in view, and each further paste beside the last instead of on top of it; otherwise it lands in the middle of the view. Paste from the right-click menu puts it where you clicked.
- A placed component takes the colour of its layer for what the component itself leaves uncoloured, as blocks do in CAD programs: put furniture on a grey "Existing" layer and it is grey. It no longer offers a stroke and a fill of its own, which repainted the whole component and hid the changes made to it; one that has them from before keeps them, with a button to take them off. The eyedropper leaves components alone.
- The points of a dimension, and those of the measure and angle tools, snap to what is drawn (ends, corners, middles, crossings, the lines themselves) but no longer to the grid: a grid point near a corner gave a length that was not the drawing's, with nothing to show it. Holding Shift keeps the direction to 45° steps, and the point then stops on the drawn line the direction crosses near the pointer (the face of a wall, the side of a rectangle), or comes level with a corner pointed at elsewhere. The dimension line is still placed by grid steps.

### Fixed
- Ctrl+X followed quickly by Esc cut nothing: the selection was let go before the cut took it away, which made it a copy (and kept Esc from leaving a component).
- Something cut or copied, then pasted, took back its old place in the stacking order, often under what had been drawn after it: it now goes on top, as anything new does, keeping the order it had among the other things pasted with it.
- In the colour window, the first press on the slider or the colour area right after typing a code was lost: the code was saved again over it.
- Colour fields in the properties panel were cut to a few letters ("du ca…"): they take the width of the panel.
- A layer with no colour of its own showed a black swatch, as if it were black: it shows an empty, crossed-out one, and its tooltip says what the layer's colour does.
- A colour defined by a dimension style (its line, its text, its extension lines) could not be seen or chosen: once ticked, its row stayed empty.
- In the narrow panels at the side, the values of a dimension style or a wall type go under their names, whole, instead of being cut to a few letters ("Sans empatt…").

## 1.0.0-rc.1 — 2026-10-13

The release candidate for 1.0. From this version on, drawings are kept readable: what a newer version adds is kept by older ones, and nothing they cannot read is half-read and saved back.

### New
- The assistant knows what you have selected. A label above the message box says what will be sent ("Wall", "3 objects selected", "A wall corner"); the assistant gets those objects in full with what they measure (a wall's length, a room's area, where they lie), so "make this thicker" or "put these on a new layer" mean what you point at. Click the × on the label to leave the selection out of one message.
- Unsaved work survives a crash: a moment after each change the drawing is copied aside, and if the window stops without closing, the next start offers it back in the welcome window.
- The desktop app keeps a copy of each drawing as it was before the app first writes over it, in a backups folder (File › Show backups of drawings), the newest thirty.
- On macOS, a drawing double-clicked in the Finder, or dropped on the app in the Dock, opens in the app.
- A component can be ungrouped (Ctrl+Shift+G, or Ungroup in the right-click menu): it becomes objects of the drawing, where it was and as it was turned, mirrored and sized, that editing the component no longer changes.
- Dimension styles, as there are wall types: a style defines what is ticked in the new Dimension styles panel (ends, text, unit, colours…), the dimensions in it follow when it changes, and one can still differ from it where it sets a value of its own. Give a style to dimensions in their properties, or to the dimension tool for the next ones; "New style from this dimension…" makes one from how a dimension looks. Deleting a style leaves its dimensions looking the same.
- The text of a vertical dimension can read from bottom to top (head turned left, as ISO 129 asks) or from top to bottom (head turned right, as before): Vertical text, in the dimension's properties or its style.

### Improved
- Large drawings are much faster: a DXF of twenty thousand lines is imported in a fraction of a second instead of forty seconds, deleting thousands of objects is immediate, and a plan of two thousand walls with their doors redraws in a few hundredths of a second while it is dragged, instead of more than one.
- A drawing saved by a newer version keeps what this version does not know when it is opened and saved again, and one in a format this version cannot read is refused with a message that says so.
- A drawing written by hand or by a script that refers to something missing (a wall type, a layer, a parent) opens with the problem put right and a note saying so, instead of being refused or refusing every change.
- Saving in the desktop app writes the new drawing beside the old one and then puts it in place, so a crash or a full disk while saving never leaves a half-written file.
- If one part of the window fails, the rest carries on, and the drawing can still be saved from what shows in its place.
- The assistant is told more precisely how drawings work: groups, wall types, dimension styles, every operation, and which properties it wrote that mean nothing (a misspelling), so that it corrects them. It can read chosen objects by id in large drawings.
- Claude Haiku 5.5, faster and much cheaper, replaces Claude Haiku 4.5 among the assistant's models.
- The desktop app asks once before the assistant reaches an AI service that is not on this computer, and its window can no longer be sent to another page.
- The installed desktop program can no longer be started as a plain Node program or have scripts loaded into it from outside.
- The command-line tool: `new` refuses to replace an existing file without `--force`, `validate` lists what opening a file would put right, `apply` warns about properties the format does not know, and `--version` prints the version.
- The right-click menu shows only what can be done to what was clicked: no Ungroup on a wall, no Create component on a component.

### Fixed
- A drawing with a wall whose wall type was missing opened, but then refused every change with "Unknown wall type".
- An order such as "top", written by the assistant or a script, stopped anything more from being added to that page.
- A stair or a window given a huge number of steps or panes, or an extension object repeated a huge number of times, froze the app.
- The Claude Code CLI provider now runs the CLI in the same folder every time, which carrying a conversation on relies on, and no longer leaves a new temporary folder behind for each request.
- Copying a wall that has a wall type failed with "Unknown wall type". A copied wall now brings its type along to the drawing it is pasted into, and a dimension its style.

## 0.8.5 — 2026-10-12

### New
- Zoom to selection (Shift+2), first in the right-click menu: picked from the list of objects, a thing is brought into view, to see where it is.

### Improved
- Pages are put in order by dragging them in the Pages panel, in place of the up and down arrows.
- Dragging a selected row in the Structure panel takes the whole selection along: the objects arrive together, in the order they had.
- The Export dialog stays open while a PDF is made, saying what it is doing, and Cancel or Esc stops it while a font is still loading, so no file turns up later. Contributed by @Seeker-Star.

### Fixed
- Double-clicking a component to edit it no longer moves the view: it stays where and as large as it was drawn, only the rest of the drawing goes away, and leaving it (Esc or Done) puts everything back where it was.

## 0.8.4 — 2026-10-12

### New
- A button in the toolbar aligns the selected objects (left, centre, right, top, middle, bottom) and spaces them evenly across or up and down.

### Improved
- A paper's panel gives its position (X and Y) at the top and no longer has stacking order, which means nothing for a sheet that is always beneath the drawing.
- The File menu no longer offers the example drawing: it is on the welcome screen, and in the command palette (Ctrl+K).
- A selected paper shows only its scale above it, as "1:100", and the panel no longer lists its width and height in the drawing: its format and scale say what it is.
- The paper's panel no longer has an "Export this sheet as PDF" button: exporting is in the File menu (Ctrl+P), with the other formats.

### Fixed
- Typing a scale for a paper of a size of its own changed what printed instead of what the sheet covers: the frame stayed as it was. It now does what pulling a corner does, for a sheet of any size.

## 0.8.3 — 2026-10-12

### New
- "On every sheet": draw a title, a logo or a north arrow once and it shows on every paper of the drawing. It is drawn in millimetres of real paper, so it keeps its place and its printed size when a paper is moved or its scale changed, and on a sheet of another format each thing stays in the corner it was drawn nearest to. Open it from the panel of any paper; a paper can leave it out. Leaving it brings back the view and the paper one came from.
- New text fields: `{sheet}`, `{scale}` and `{format}` say the name, the scale and the format of each sheet in what is drawn on every sheet, and `{project}`, `{client}`, `{address}` and `{author}` what the drawing says about itself.

### Improved
- Layers no longer have "show on every page": what it put on every page stood at one place in the drawing and did not follow a paper or its scale. "On every sheet" does that job. In a drawing that used it, what was on such a layer now shows only on the page it was drawn on.

## 0.8.2 — 2026-10-12

### New
- A DXF laid out as a sheet, as AutoCAD's paper space and SketchUp LayOut write them, comes in as that sheet: a paper at its scale, what is drawn on it, and what each of its windows shows of the model, at its true size and cropped to the window. LayOut's own layers are found again.
- DXF import reads much more: blocks placed in the drawing (as groups), hatches (as fills, plain or patterned, joined to the outline they fill), curves, filled shapes, dimensions and leaders with their notes (as dimensions and annotations), and the colours, line weights, dashes, fonts and bold of what it reads.
- `opencalque import drawing.opencalque a.dxf b.dxf` on the command line makes one drawing of several DXF files, a page each, with the pictures they refer to.

### Improved
- A `{page}` or `{page-number}` written on a shared layer says the page it is seen on, so one title kept on a shared layer names every sheet.
- Moving a paper no longer moves what is drawn on it: the sheet slides over the drawing, so it can be put where it frames what to print. Copying and duplicating a paper still take along what lies on it.
- Pulling a corner of a paper changes its scale instead of its shape: an A4 stays an A4 and covers more or less of the drawing. The corner keeps to the diagonal, which is shown, and the scale goes by round values (1:20, 1:25, 1:50…). Hold Alt for a sheet of any size.
- A selected paper shows what it is above it, as "A4 · 1:100", instead of its width and height in the drawing.
- Changing the scale or the format of a paper keeps its middle in place, so what it frames stays in the middle of the sheet instead of ending up in a corner.

### Fixed
- Text from a DXF came in a quarter too small, and went out a third too large: a DXF gives the height of a capital letter, not the size of the font.
- Multi-line text from a DXF kept stray formatting codes such as "\l" in front of its words.

## 0.8.1 — 2026-10-12

### New
- The interface in Japanese, chosen under Preferences › Language or followed from the system. The component library, doors, windows and stairs are named in Japanese too.

### Improved
- Japanese text in an exported PDF is drawn with a Japanese font, so its kanji take their Japanese forms rather than the Chinese ones. A text is taken as Japanese when it has kana, or when the app is in Japanese.

## 0.8.0 — 2026-10-12

### New
- The interface in Chinese (Simplified), chosen under Preferences › Language or followed from the system. The component library, doors, windows and stairs are named in Chinese too.

### Fixed
- Exported PDFs print Chinese, Japanese kana, Greek, Cyrillic and the letters of Central and Eastern Europe and Vietnam, which came out as "?". The fonts ship with the app and a PDF carries only the letters it uses; the text can still be searched and copied. Korean is not covered yet.
- A DXF export writes letters beyond plain ASCII (accents included) in the form CAD programs read whatever the language of the computer, instead of letting them turn into other characters; a DXF written that way also imports with its letters intact.

## 0.7.0 — 2026-10-11

### New
- Feet and inches. A new unit in Preferences shows and reads lengths the way American plans do, as 7' 6 1/2", to the nearest half, quarter, eighth, sixteenth or thirty-second of an inch. Type them as you like: 7'6", 7' 6 1/2", 7-6, 90". Dimensions can be shown that way too, and whatever the unit in use, a length typed in feet and inches is understood.
- A Split tool in the toolbar (K): point at a wall, a line or a polyline and it shows where it would be cut, with the length of each part on either side, measured by a line with arrows from each end to the cut (following a curved wall); click to cut it there. The cut keeps to whole grid steps from the start, or to where another object lines up; Alt cuts exactly under the pointer.
- A Rotate tool (E): click the point to turn about, then a second point for the line the turn starts from, then the selection turns with the pointer, the angle shown between the two lines; click to apply, or type the angle. It shares a button with Mirror horizontally and Mirror vertically (the new names of the two flips), which act on the selection at once. The Transform section of the properties is gone: the box around a selection still scales from its corners.
- Split the wall in two, in the Object menu: the wall becomes two, with a corner in its middle (the Split tool cuts it wherever you point). Split it twice and the part in between is a wall of its own, to delete or to change.
- A tap on Space puts down the wall or shape being drawn and goes back to the Select tool, which is usually what comes next; held, Space still moves the view.

### Fixed
- Curved walls joined to another wall, curved or straight, no longer grow a spike, a triangle or a stray corner at the joint: the corner is found where the faces really meet ahead of the joint, not along a tangent nor where a curve crosses the other wall a second time. Two tightly curved walls that leave their joint almost the same way and bend apart (a wall cut in two, then each half curved) meet where their faces cross, and the line drawn between them runs there instead of doubling the cut-off corner.
- The line where two walls meet now takes the colour, weight and kind of line given to it from either wall; before, only one of the two walls was listened to, so a change made from the other seemed to do nothing. Picking a kind of line for an end that had none now shows it at once.
- A selected object with a patterned fill is outlined in blue, its pattern left as it is: the pattern was lit up too and hid the shape.
- The colour window no longer jumps above or below its field when what it shows changes; it stays where it opened and scrolls when it is too tall.
- A click outside the colour window on the name of its row (Colour, under Stroke or Fill) closes it for good: it used to close and open again at once.
- Copying an instance of a component and pasting it into the same drawing made a new component, a copy of the first; it now places another instance of the same component. Pasted into another drawing, separate copies of it share one component there too.
- Angles on the drawing (the angle tool's reading, a rotation) were written as if they were lengths: with lengths in metres, 36° read 0.036°. They are now in degrees whatever the unit.
- A key pressed while a list of the toolbar or a menu of the menu bar is open closes it; a shortcut still does its work, so W with the shapes list open closes it and takes the wall tool.
- Closing a run of walls with a double-click no longer draws a tiny extra wall when the pointer moves a pixel or two between the clicks (snapping could take it to the next grid point or to the face of the wall just drawn), and a slower double-click, as the system counts one, still closes the run.

### Improved
- The Dimension tool shares a button with Text and Annotation.
- The lists of the toolbar's buttons are as wide as their longest name, each on one line, and show the tool in use in the accent colour rather than with a tick in front.
- A double-click on a wall selects the walls joined to it end to end, around a room or along a run, stopping where three walls meet; a second double-click takes in every wall that holds together with it.
- The look of a shape is in two sections that say what they are about: Stroke (colour, weight, kind of line) and Fill. The fill's pattern has rows of its own under its colour: the kind from a row of pictures, "none" first, then its spacing, angle and stroke colour, so a hatched object shows it at a glance; the colour window is a colour window again, without the Plain and Pattern tabs. A wall shows a pattern from its type as inherited, like its other properties, and wall types tick a pattern apart from a fill. Only what applies is shown: a line has no fill, a polygon no ends.
- Closing or opening a polyline, and curving it through its points or straightening it, are commands in the Object menu and the right-click menu, not boxes among its measurements.
- One tool for lines, polylines and polygons. The line tool (L) goes on from point to point: Esc after one segment leaves a line, after several a polyline, and a double-click, or a click back on the first point, closes it into a polygon that can be filled. A click back on the last point, a pixel or two off, ends it rather than adding a tiny segment. The separate polyline tool is gone.
- The welcome window shows the language and the unit, to correct in one click. At a first start the unit follows the computer: feet and inches where plans are drawn in them, millimetres elsewhere.
- The look of a wall can be split line by line: the button beside Stroke in a wall's properties opens its two faces and the line across each end. Pointing at one of them rings that line on the drawing, where it is actually drawn (along the joint at a corner), leaving the line itself in sight. Each takes the wall's colour, weight and kind of line, marked as inherited, until it is given its own, which is marked too, with an arrow to go back to the wall's; "no line" is one of the kinds of line. A wall split in two simply has the line at its cut drawn, at any angle and however the halves are moved afterwards; choose no line there and the two read as one wall again. The corner of two walls has the same choice, Line between them.
- A corner now says what it does. Left alone it is Automatic: a sharp corner, cut off when the walls meet at less than 60°; its picture shows which of the two it is drawing. Sharp corner and Cut off are firm choices that hold at any angle, so a point can be kept on a sharp corner, or a right angle cut off. Drawings open as before: their corners were automatic all along.
- The joint of a corner is picked from small pictures, and a wall's own properties now show how it is finished at its start and at its end, from its own side: automatic, sharp, cut off, rounded, running past the other wall or stopping against it. Choosing there sets both walls of the corner, so they never disagree.
- The joint where "one wall runs past the other" is now right at every angle: the wall that stops is cut flat against the face of the one that passes, with no gap and nothing sticking out, and two walls that nearly carry on from one another meet at their corner with the line between them drawn through it. Before, it was only right at a right angle.
- A double-click now means one thing, going inside what was clicked (a component, a group, a text). It no longer cuts a wall: that is the Split tool.
- The quantities are exported in feet, square feet, cubic feet and inches when lengths are shown in feet or inches.
- The arrow keys hold a direction while dragging too, not only while drawing: with the button down on an object, a wall end, a corner or any point of a shape, the up or down arrow keeps the movement upright and the left or right arrow keeps it level. A point or a corner held this way stops level with whatever is pointed at elsewhere, as a wall being drawn does.

## 0.6.0 — 2026-10-10

### New
- Curved walls. Select a wall and drag the handle in its middle sideways, or type a Curve in its properties: the wall follows an arc through its two ends. It joins the walls at its ends, takes doors and windows, bounds rooms (their area follows the curve) and is measured round its curve in the quantities and in every export. Set Curve to 0 to straighten it.
- Snapping to more than points: the middle of a line, the place where two lines cross, the foot of a perpendicular from where the line being drawn started, and the line itself. A sign and a word beside the pointer say which one it is. The faces of walls and their corners can now be snapped to, so a dimension can be taken from face to face.
- Smart guides: an object being moved lines up with the sides and the middle of the others, and takes the same gap as its neighbours keep between them. Lines show what it is lined up with, and the equal gaps are marked with their size. Where nothing is near, it goes by the grid as before; Alt turns it off.
- Hold a direction while drawing: with a wall, a line, a divider or a polyline started, the up or down arrow keeps it upright and the left or right arrow keeps it level (the same key again lets go). The pointer then only says how far it goes: point at any point elsewhere on the drawing and the wall stops exactly level with it, a dotted line showing what it was taken from. Otherwise it goes by grid steps and stops on a wall it crosses.

### Improved
- The hatching of a fill is no longer something the pointer snaps to.
- Several objects selected together can be dragged from anywhere inside the box around them, the empty space between them included. A plain click there still lets the selection go.

### Fixed
- Windows: with the light theme chosen on a computer set to dark, the minimise and maximise buttons at the top right showed no highlight under the pointer, and dialogs came up dark. The window now always follows the theme of the app.

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
