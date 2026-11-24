import { controlsOn, elevationWall, heightInPlace, heightOf, lineOf, type Document, type NodeOf, type Op } from '@opencalque/core'
import {
  boundsOfNode,
  boxInRoom,
  centreOf,
  check,
  close,
  floorBox,
  gapBetween,
  isGrey,
  mountOfNode,
  noProblems,
  nothingChanged,
  numbersIn,
  objectsOf,
  openingIn,
  overlapShare,
  prop,
  roomNamed,
  roomsOf,
  said,
  sizeOf,
  stable,
  unchanged,
  unionOf,
  wallsOf,
  type Check,
  type Outcome,
  type RoomFound,
} from './grade'
import * as plans from './plans'
import { bedroomFurnitureOps, box, flatOps, object, PAGE, registry, room } from './plans'

/*
 * The tasks, each a request a person could make, the drawing it is made on, and what the result
 * must be. Every task carries a reference: operations (and for a question, a reply) that solve it.
 * The tests check that the reference passes every check and that the starting drawing does not,
 * so that a task cannot pass by doing nothing and cannot fail when it is done right.
 */

export interface Task {
  id: string
  /** What it tries, in a few words, for the report. */
  about: string
  start: () => Document
  /** What the person writes. */
  prompt: string
  /** What the person has selected (the assistant is told; an agent outside the app is not). */
  selection?: string[]
  /** The request for an agent that cannot be told the selection, when it differs from `prompt`. */
  outside?: string
  /** It cannot be done without looking at a picture. */
  pictures?: boolean
  reference: { ops?: (start: Document) => Op[]; reply?: (start: Document) => string }
  checks: (o: Outcome) => Check[]
}

const update = (id: string, patch: Record<string, unknown>): Op => ({ op: 'update_node', id, patch }) as Op
const KITCHEN_WALLS = ['k_top', 'k_right', 'k_bottom', 'k_left']

/** The floor of a room spans `x` and `y` (each [from, to], in mm), within `slack`. */
function floorSpans(found: RoomFound | null, x: [number, number], y: [number, number], slack = 40): Check {
  const box = floorBox(found)
  const fits = !!box && Math.abs(box.minX - x[0]) <= slack && Math.abs(box.maxX - x[1]) <= slack && Math.abs(box.minY - y[0]) <= slack && Math.abs(box.maxY - y[1]) <= slack
  return check(`its floor runs from x ${x[0]} to ${x[1]} and y ${y[0]} to ${y[1]}`, fits, box ? `x ${Math.round(box.minX)}–${Math.round(box.maxX)}, y ${Math.round(box.minY)}–${Math.round(box.maxY)}` : 'no floor')
}

/** The rooms of the flat and what they measure, from its reference drawing. */
const flatAreas = (() => {
  let found: Record<string, number> | null = null
  return () => (found ??= Object.fromEntries(roomsOf(plans.flat()).map((r) => [r.node.id, r.area])))
})()

/** What makes the flat right, drawn from scratch or traced, within `fraction` of its areas and `sizeFraction` of its size. */
function flatChecks(o: Outcome, fraction: number, sizeFraction: number): Check[] {
  const living = roomNamed(o.doc, /living/i)
  const first = roomNamed(o.doc, /bedroom\s*1\b/i)
  const second = roomNamed(o.doc, /bedroom\s*2\b/i)
  const areas = flatAreas()
  const walls = wallsOf(o.doc)
  const outside = unionOf(walls.map((wall) => boundsOfNode(o.doc, wall)))
  const size = outside ? sizeOf(outside) : null
  const middle = (r: RoomFound | null) => {
    const box = floorBox(r)
    return box ? centreOf(box) : null
  }
  const [l, b1, b2] = [middle(living), middle(first), middle(second)]
  return [
    check('three rooms named Living room, Bedroom 1 and Bedroom 2, each closed', !!living?.area && !!first?.area && !!second?.area, `${roomsOf(o.doc).map((r) => `${r.name || '(no name)'} ${r.area.toFixed(2)} m²`).join(', ') || 'no rooms'}`),
    check('the living room is below (south of) both bedrooms', !!l && !!b1 && !!b2 && l.y > b1.y && l.y > b2.y),
    check('the bedrooms are the same size', !!first?.area && !!second?.area && close(first.area, second.area, 0.05), `${said('Bedroom 1', first?.area, ' m²')}, ${said('Bedroom 2', second?.area, ' m²')}`),
    check(`the living room is about ${areas.living.toFixed(1)} m²`, !!living && close(living.area, areas.living, fraction), said('found', living?.area, ' m²')),
    check(`each bedroom is about ${areas.bedroom_1.toFixed(1)} m²`, !!first && !!second && close(first.area, areas.bedroom_1, fraction) && close(second.area, areas.bedroom_2, fraction)),
    check('the walls cover 10 × 8 m outside', !!size && close(size.width, 10000, sizeFraction) && close(size.height, 8000, sizeFraction), size ? `${Math.round(size.width)} × ${Math.round(size.height)} mm` : 'no walls'),
    noProblems(o),
  ]
}

export const TASKS: Task[] = [
  {
    id: 'room-from-scratch',
    about: 'Walls and a room on an empty page',
    start: plans.empty,
    prompt: 'Draw a bedroom 4 m by 3.5 m inside, with 200 mm walls, and name it Bedroom.',
    reference: { ops: () => [...box('w', 0, 0, 4200, 3700, 200), room('r', 'Bedroom', 2100, 1850)] },
    checks: (o) => {
      const bedroom = roomNamed(o.doc, /bedroom/i)
      const box = floorBox(bedroom)
      const floor = box ? sizeOf(box) : null
      const walls = wallsOf(o.doc)
      return [
        check('a room named Bedroom with a floor', !!bedroom?.area, said('area', bedroom?.area, ' m²')),
        check('its floor is 14 m²', !!bedroom && close(bedroom.area, 14, 0.02), said('area', bedroom?.area, ' m²')),
        check('its floor is 4 × 3.5 m', !!floor && ((close(floor.width, 4000, 0.015) && close(floor.height, 3500, 0.015)) || (close(floor.width, 3500, 0.015) && close(floor.height, 4000, 0.015))), floor ? `${Math.round(floor.width)} × ${Math.round(floor.height)} mm` : undefined),
        check('every wall is 200 mm thick', walls.length >= 4 && walls.every((w) => w.thickness === 200), `${walls.length} walls, ${[...new Set(walls.map((w) => w.thickness))].join(', ')} mm`),
        noProblems(o),
      ]
    },
  },
  {
    id: 'flat-from-scratch',
    about: 'A plan of three rooms from a description',
    start: plans.empty,
    prompt:
      'Draw a flat 10 m wide and 8 m deep, measured outside, with 250 mm outside walls and 100 mm inside walls. The living room takes the whole bottom (south) half; the top half is two bedrooms of the same size. Name the rooms Living room, Bedroom 1 and Bedroom 2.',
    reference: { ops: flatOps },
    checks: (o) => {
      const thicknesses = new Set(wallsOf(o.doc).map((w) => w.thickness))
      return [...flatChecks(o, 0.07, 0.015), check('walls of 250 mm and of 100 mm, and no others', thicknesses.has(250) && thicknesses.has(100) && thicknesses.size === 2, [...thicknesses].join(', '))]
    },
  },
  {
    id: 'door-in-wall',
    about: 'A door placed in a named wall',
    start: plans.kitchen,
    prompt: 'Add a 90 cm door in the middle of the top wall.',
    reference: { ops: () => [object('door', 'arch.door', 2050, 0)] },
    checks: (o) => {
      const doors = objectsOf(o.doc, 'arch.door')
      const opening = doors.length === 1 ? openingIn(o.doc, doors[0]) : null
      return [
        check('one door', doors.length === 1, `${doors.length}`),
        check('it is 90 cm wide', doors.length === 1 && prop(doors[0], 'width') === 900, doors.length === 1 ? String(prop(doors[0], 'width')) : undefined),
        check('it is in the top wall', opening?.wall.id === 'k_top', opening ? `in ${opening.wall.id}` : 'in no wall'),
        check('it is in the middle of it', !!opening && Math.abs(opening.middle.x - 2500) <= 100, opening ? `middle at x ${Math.round(opening.middle.x)}` : undefined),
        unchanged(o, [...KITCHEN_WALLS, 'kitchen'], 'the walls and the room are as they were'),
        noProblems(o),
      ]
    },
  },
  {
    id: 'windows-in-selected-wall',
    about: 'Two windows spaced along the selected wall',
    start: plans.kitchenWithDoor,
    prompt: 'Put two 1.2 m windows in this wall, evenly spaced.',
    selection: ['k_right'],
    outside: 'Put two 1.2 m windows in the right-hand wall of the kitchen, evenly spaced.',
    reference: { ops: () => [object('w1', 'arch.window', 5000, 566.67, 90), object('w2', 'arch.window', 5000, 2233.33, 90)] },
    checks: (o) => {
      const windows = objectsOf(o.doc, 'arch.window')
      const openings = windows.map((w) => openingIn(o.doc, w))
      // Along the wall, between its inner faces (y 100 to 3900).
      const spans = openings.flatMap((s) => (s ? [[Math.min(s.span[0].y, s.span[1].y), Math.max(s.span[0].y, s.span[1].y)]] : [])).sort((a, b) => a[0] - b[0])
      const gaps = spans.length === 2 ? [spans[0][0] - 100, spans[1][0] - spans[0][1], 3900 - spans[1][1]] : []
      return [
        check('two windows', windows.length === 2, `${windows.length}`),
        check('each 1.2 m wide', windows.length === 2 && windows.every((w) => prop(w, 'width') === 1200)),
        check('both in the selected wall', openings.length === 2 && openings.every((s) => s?.wall.id === 'k_right'), openings.map((s) => s?.wall.id ?? 'none').join(', ')),
        check('evenly spaced along it', gaps.length === 3 && Math.max(...gaps) - Math.min(...gaps) <= 200 && Math.min(...gaps) > 0, gaps.length ? `gaps ${gaps.map(Math.round).join(', ')} mm` : undefined),
        unchanged(o, [...KITCHEN_WALLS, 'door'], 'the walls and the door are as they were'),
        noProblems(o),
      ]
    },
  },
  {
    id: 'extend-room',
    about: 'Moving a wall without moving the door',
    start: plans.office,
    prompt: 'Make this room 1 m longer to the right, and keep the door where it is.',
    selection: ['office'],
    outside: 'Make the office 1 m longer to the right (towards larger x), and keep its door where it is.',
    reference: { ops: () => [update('o_right', { a: { x: 5000, y: 0 }, b: { x: 5000, y: 3000 } }), update('o_top', { b: { x: 5000, y: 0 } }), update('o_bottom', { a: { x: 5000, y: 3000 } })] },
    checks: (o) => {
      const office = roomNamed(o.doc, /office/i)
      const door = o.doc.nodes.door
      return [
        check('the office is 13.44 m²', !!office && close(office.area, 13.44, 0.02), said('area', office?.area, ' m²')),
        floorSpans(office, [100, 4900], [100, 2900]),
        unchanged(o, ['door'], 'the door is where it was'),
        check('the door is still in a wall', !!door && !!openingIn(o.doc, door)),
        noProblems(o),
      ]
    },
  },
  {
    id: 'thicken-selected-walls',
    about: 'Thicker outside walls, rooms the same size inside',
    start: plans.twoRooms,
    prompt: 'Make the selected walls 300 mm thick, keeping the rooms the same size inside.',
    selection: ['w_top', 'w_right', 'w_bottom', 'w_left'],
    outside: 'Make the four outside walls 300 mm thick, keeping the rooms the same size inside.',
    reference: {
      ops: () => [
        update('w_top', { a: { x: 100, y: 100 }, b: { x: 5900, y: 100 }, thickness: 300, justify: 'right' }),
        update('w_right', { a: { x: 5900, y: 100 }, b: { x: 5900, y: 3900 }, thickness: 300, justify: 'right' }),
        update('w_bottom', { a: { x: 5900, y: 3900 }, b: { x: 100, y: 3900 }, thickness: 300, justify: 'right' }),
        update('w_left', { a: { x: 100, y: 3900 }, b: { x: 100, y: 100 }, thickness: 300, justify: 'right' }),
      ],
    },
    checks: (o) => {
      const walls = wallsOf(o.doc)
      const [a, b] = [roomNamed(o.doc, /room a/i), roomNamed(o.doc, /room b/i)]
      return [
        check('the wall between the rooms is still 100 mm, every other wall 300 mm', walls.filter((w) => w.thickness === 100).length === 1 && walls.filter((w) => w.thickness !== 100).every((w) => w.thickness === 300) && walls.length >= 5, walls.map((w) => w.thickness).join(', ')),
        check('both rooms are still 10.83 m² inside', !!a && !!b && close(a.area, 10.83, 0.005) && close(b.area, 10.83, 0.005), `${said('A', a?.area, ' m²')}, ${said('B', b?.area, ' m²')}`),
        noProblems(o),
      ]
    },
  },
  {
    id: 'furnish-bedroom',
    about: 'Furniture against walls, clear of the door',
    start: plans.bedroom,
    prompt: 'Furnish the bedroom: a double bed with its head against the top wall, a bedside table on each side of it, and a wardrobe.',
    reference: { ops: bedroomFurnitureOps },
    checks: (o) => {
      const [beds, bedsides, wardrobes] = [objectsOf(o.doc, 'furn.bed'), objectsOf(o.doc, 'arch.bedside'), objectsOf(o.doc, 'arch.wardrobe')]
      const furniture = [...beds, ...bedsides, ...wardrobes]
      const boxes = furniture.map((node) => ({ node, box: boundsOfNode(o.doc, node)! }))
      const bedroom = roomNamed(o.doc, /bedroom/i)
      const bed = beds.length === 1 ? boundsOfNode(o.doc, beds[0]) : null
      const swing = boundsOfNode(o.doc, o.doc.nodes.door)!
      const sides = bed ? bedsides.map((n) => boundsOfNode(o.doc, n)!).map((side) => ({ left: centreOf(side).x < bed.minX, right: centreOf(side).x > bed.maxX, gap: gapBetween(side, bed) })) : []
      const overlapping = boxes.flatMap((p, i) => boxes.slice(i + 1).filter((q) => overlapShare(p.box, q.box) > 0.02).map((q) => `${p.node.kind} and ${q.node.kind}`))
      return [
        check('one double bed, two bedside tables, one wardrobe', beds.length === 1 && bedsides.length === 2 && wardrobes.length === 1, `${beds.length} bed, ${bedsides.length} bedside, ${wardrobes.length} wardrobe`),
        check('the bed stands against the top wall', beds.length === 1 && mountOfNode(o.doc, beds[0])?.wall.id === 'b_top', beds.length === 1 ? `against ${mountOfNode(o.doc, beds[0])?.wall.id ?? 'no wall'}` : undefined),
        check('a bedside table each side of the bed, beside it', sides.length === 2 && sides.some((s) => s.left) && sides.some((s) => s.right) && sides.every((s) => s.gap <= 150), sides.map((s) => `${s.left ? 'left' : s.right ? 'right' : 'over'} ${Math.round(s.gap)} mm`).join(', ')),
        check('all of it inside the room', !!bedroom?.region && boxes.every(({ box }) => boxInRoom(box, bedroom.region!)), boxes.filter(({ box }) => !bedroom?.region || !boxInRoom(box, bedroom.region)).map(({ node }) => node.kind).join(', ') || undefined),
        check('nothing stands on anything else', overlapping.length === 0, overlapping.join('; ') || undefined),
        check('the door can still open', boxes.every(({ box }) => overlapShare(box, swing) <= 0.01), boxes.filter(({ box }) => overlapShare(box, swing) > 0.01).map(({ node }) => node.kind).join(', ') || undefined),
        unchanged(o, ['b_top', 'b_right', 'b_bottom', 'b_left', 'door'], 'the walls and the door are as they were'),
        noProblems(o),
      ]
    },
  },
  {
    id: 'question-area',
    about: 'Answering from the drawing without changing it',
    start: plans.flat,
    prompt: 'What is the total floor area of the two bedrooms?',
    reference: { reply: () => `Together the two bedrooms have ${(flatAreas().bedroom_1 + flatAreas().bedroom_2).toFixed(2)} m² of floor.` },
    checks: (o) => {
      const expected = flatAreas().bedroom_1 + flatAreas().bedroom_2
      return [check(`the reply gives ${expected.toFixed(2)} m², within 0.3`, numbersIn(o.reply).some((n) => Math.abs(n - expected) <= 0.3), o.reply.slice(0, 160) || 'no reply'), nothingChanged(o)]
    },
  },
  {
    id: 'furniture-on-layer',
    about: 'A new layer, and the right objects moved to it',
    start: plans.furnishedBedroom,
    prompt: 'Put all the furniture on a new layer called Furniture, coloured grey.',
    reference: {
      ops: () => [{ op: 'add_layer', layer: { id: 'furniture', name: 'Furniture', color: '#888888' } } as Op, ...['bed', 'bedside_left', 'bedside_right', 'wardrobe'].map((id) => update(id, { layer: 'furniture' }))],
    },
    checks: (o) => {
      const added = Object.values(o.doc.layers).filter((layer) => !o.start.layers[layer.id] && /furniture/i.test(layer.name))
      const layer = added.length === 1 ? added[0] : null
      const furniture = ['bed', 'bedside_left', 'bedside_right', 'wardrobe']
      const others = ['b_top', 'b_right', 'b_bottom', 'b_left', 'door', 'bedroom']
      const where = (id: string) => (o.doc.nodes[id] as { layer?: string } | undefined)?.layer
      const placed = (id: string) => stable(['x', 'y', 'rotation', 'props'].map((k) => (o.doc.nodes[id] as Record<string, unknown> | undefined)?.[k]))
      const before = (id: string) => stable(['x', 'y', 'rotation', 'props'].map((k) => (o.start.nodes[id] as Record<string, unknown>)[k]))
      return [
        check('a new layer named Furniture', !!layer, Object.values(o.doc.layers).map((l) => l.name).join(', ')),
        check('it is grey', isGrey(layer?.color), layer?.color ?? 'no colour'),
        check('the bed, bedside tables and wardrobe are on it', !!layer && furniture.every((id) => where(id) === layer.id), furniture.map((id) => `${id}: ${where(id) ?? 'none'}`).join(', ')),
        check('the walls, the door and the room stay on their layer', others.every((id) => where(id) === (o.start.nodes[id] as { layer?: string }).layer)),
        check('the furniture did not move', furniture.every((id) => placed(id) === before(id))),
      ]
    },
  },
  {
    id: 'fix-open-room',
    about: 'Finding and closing a gap between walls',
    start: plans.openKitchen,
    prompt: 'The kitchen shows no area. Fix it.',
    reference: { ops: () => [update('k_right', { b: { x: 5000, y: 4000 } })] },
    checks: (o) => {
      const kitchen = roomNamed(o.doc, /kitchen/i)
      return [
        check('the kitchen has its 18.24 m² floor', !!kitchen && close(kitchen.area, 18.24, 0.01), said('area', kitchen?.area, ' m²')),
        check('by joining the walls there are, not adding one', wallsOf(o.doc).length === 4, `${wallsOf(o.doc).length} walls`, true),
        noProblems(o),
      ]
    },
  },
  {
    id: 'window-in-french',
    about: 'A request in French, answered in French',
    start: plans.kitchenWithDoor,
    prompt: 'Ajoute une fenêtre de 1,40 m au milieu du mur du bas.',
    reference: { ops: () => [object('window', 'arch.window', 3200, 4000, 180, { width: 1400 })], reply: () => "J'ai ajouté une fenêtre de 1,40 m au milieu du mur du bas." },
    checks: (o) => {
      const windows = objectsOf(o.doc, 'arch.window')
      const opening = windows.length === 1 ? openingIn(o.doc, windows[0]) : null
      return [
        check('one window', windows.length === 1, `${windows.length}`),
        check('1.40 m wide', windows.length === 1 && prop(windows[0], 'width') === 1400, windows.length === 1 ? String(prop(windows[0], 'width')) : undefined),
        check('in the bottom wall, in its middle', opening?.wall.id === 'k_bottom' && Math.abs(opening.middle.x - 2500) <= 100, opening ? `in ${opening.wall.id}, middle at x ${Math.round(opening.middle.x)}` : 'in no wall'),
        unchanged(o, [...KITCHEN_WALLS, 'door'], 'the walls and the door are as they were'),
        check('the reply is in French', /\b(fenêtre|ajouté|j'ai|mur)\b/i.test(o.reply), o.reply.slice(0, 120), true),
      ]
    },
  },
  {
    id: 'socket-on-wall',
    about: 'An object fixed on the inner face of a wall',
    start: plans.kitchenWithDoor,
    prompt: 'Add a double socket in the middle of the left wall, on the inside.',
    reference: { ops: () => [object('socket', 'elec.socket', 100, 2000, 270, { count: 2 })] },
    checks: (o) => {
      const sockets = objectsOf(o.doc, 'elec.socket')
      const mount = sockets.length === 1 ? mountOfNode(o.doc, sockets[0]) : null
      return [
        check('one socket', sockets.length === 1, `${sockets.length}`),
        check('a double one', sockets.length === 1 && Number(prop(sockets[0], 'count')) === 2, sockets.length === 1 ? `count ${String(prop(sockets[0], 'count'))}` : undefined),
        // The left wall runs up, from (0, 4000) to (0, 0): the kitchen is on its right face.
        check('fixed on the inner face of the left wall', mount?.wall.id === 'k_left' && mount.face === 'right', mount ? `${mount.wall.id}, ${mount.face} face` : 'on no wall'),
        check('in the middle of it', sockets.length === 1 && Math.abs(sockets[0].y - 2000) <= 150, sockets.length === 1 ? `y ${Math.round(sockets[0].y)}` : undefined),
        noProblems(o),
      ]
    },
  },
  {
    id: 'elevation-of-wall',
    about: 'An elevation of the inside face of a wall, drawn beside the plan',
    start: plans.kitchenWithDoor,
    prompt: 'Make an elevation of the inside of the top wall of the kitchen, and put it below the plan.',
    // Its line 1 m in front of the face (at y = 100), seeing up to it; the view's floor 3 m below the plan.
    reference: { ops: () => [{ op: 'add_node', node: { type: 'elevation', id: 'north', parent: PAGE, name: 'Kitchen, north', a: { x: 100, y: 1100 }, b: { x: 4900, y: 1100 }, depth: 1000, x: 100, y: 7000 } } as Op, { op: 'add_node', node: { type: 'autodimensions', id: 'north_dimensions', parent: 'north' } } as Op] },
    checks: (o) => {
      const views = Object.values(o.doc.nodes).filter((n): n is NodeOf<'elevation'> => n.type === 'elevation')
      const view = views.length === 1 ? views[0] : null
      const face = view ? elevationWall(o.doc, lineOf(o.doc, view)) : null
      const along = view ? Math.hypot(view.b.x - view.a.x, view.b.y - view.a.y) : 0
      return [
        check('one elevation', views.length === 1, `${views.length}`),
        // The top wall runs right, from (0, 0) to (5000, 0): the kitchen is on its right face.
        check('of the inside face of the top wall', face?.wall.id === 'k_top' && face.face === 'right', face ? `${face.wall.id}, ${face.face} face` : 'of no face'),
        check('the whole face, or nearly', along >= 4500, view ? `${Math.round(along)} mm` : undefined),
        // Drawn below the plan, clear of it: its top (2.5 m above its floor) under the bottom wall.
        check('below the plan, clear of it', !!view && view.y - 2500 > 4100, view ? `its floor at y ${Math.round(view.y)}` : undefined),
        // Dimensioned as the editor's tool would: it holds its automatic dimensions.
        check('with its automatic dimensions', !!view && Object.values(o.doc.nodes).some((n) => n.type === 'autodimensions' && n.parent === view.id)),
        noProblems(o),
      ]
    },
  },
  {
    id: 'tall-unit-sections',
    about: 'A tall unit of sections of its own, up to the ceiling',
    start: plans.kitchenWithDoor,
    prompt: 'In the right-hand corner against the top wall, put a 60 cm tall kitchen unit that goes up to the ceiling: three drawers at the bottom, 72 cm high together, a 60 cm oven above them, an open niche of 38 cm, a 40 cm door, and a filler panel the rest of the way up.',
    reference: {
      ops: () => [
        object('tall', 'arch.tallunit', 4300, 100, 0, {
          sections: [
            { type: 'Drawer', height: 240 },
            { type: 'Drawer', height: 240 },
            { type: 'Drawer', height: 240 },
            { type: 'Oven', height: 600 },
            { type: 'Open', height: 380 },
            { type: 'Door', height: 400 },
            { type: 'Filler' },
          ],
        }),
      ],
    },
    checks: (o) => {
      const units = objectsOf(o.doc, 'arch.tallunit')
      const unit = units.length === 1 ? units[0] : null
      const mount = unit ? mountOfNode(o.doc, unit) : null
      const rows = unit ? ((prop(unit, 'sections') as { type: string; height: number }[]) ?? []) : []
      const near = (row: { height: number } | undefined, mm: number) => !!row && Math.abs(row.height - mm) <= 30
      return [
        check('one tall unit', units.length === 1, `${units.length}`),
        check('against the inner face of the top wall, in the right-hand corner', mount?.wall.id === 'k_top' && !!unit && Math.abs(unit.x + Number(prop(unit, 'width')) - 4900) <= 150, mount && unit ? `${mount.wall.id}, its right side at x ${Math.round(unit.x + Number(prop(unit, 'width')))}` : 'on no wall'),
        check('up to the ceiling', !!unit && !!mount && heightInPlace(o.doc, unit, registry) === heightOf(o.doc, mount.wall), unit ? `${heightInPlace(o.doc, unit, registry) ?? prop(unit, 'height')} mm high` : undefined),
        check('three drawers, an oven, an open niche, a door and a filler, from the floor up', rows.map((row) => row.type).join(' ') === 'Drawer Drawer Drawer Oven Open Door Filler', rows.map((row) => row.type).join(', ') || 'no sections'),
        check('the drawers 72 cm high together, the oven 60 cm, the niche 38 cm, the door 40 cm', near({ height: rows.slice(0, 3).reduce((sum, row) => sum + row.height, 0) }, 720) && near(rows[3], 600) && near(rows[4], 380) && near(rows[5], 400), rows.map((row) => `${row.type} ${row.height}`).join(', ')),
        noProblems(o),
      ]
    },
  },
  {
    id: 'switch-controls-light',
    about: 'A light, a switch on a wall, and the link between them',
    start: plans.kitchenWithDoor,
    prompt: 'Add a ceiling light in the middle of the kitchen, and a switch on the wall next to the door that turns it on.',
    reference: {
      ops: () => [object('light', 'elec.light', 2500, 2000), object('switch', 'elec.switch', 1800, 160, 180), { op: 'add_node', node: { type: 'link', id: 'link', parent: PAGE, from: 'switch', to: 'light' } } as Op],
    },
    checks: (o) => {
      const [lights, switches] = [objectsOf(o.doc, 'elec.light'), objectsOf(o.doc, 'elec.switch')]
      const span = openingIn(o.doc, o.doc.nodes.door)?.span
      const doorLine = span ? { minX: Math.min(span[0].x, span[1].x), maxX: Math.max(span[0].x, span[1].x), minY: Math.min(span[0].y, span[1].y), maxY: Math.max(span[0].y, span[1].y) } : null
      const switchBox = switches.length === 1 ? boundsOfNode(o.doc, switches[0]) : null
      const controls = controlsOn(o.doc, registry, PAGE)
      const linked = lights.length === 1 && switches.length === 1 && !!controls.controllers.find((c) => c.id === switches[0].id)?.controls.some((c) => c.id === lights[0].id)
      return [
        check('one ceiling light, in the middle of the kitchen', lights.length === 1 && Math.hypot(lights[0].x - 2500, lights[0].y - 2000) <= 300, lights.length === 1 ? `at (${Math.round(lights[0].x)}, ${Math.round(lights[0].y)})` : `${lights.length} lights`),
        check('one switch, fixed on a wall', switches.length === 1 && !!mountOfNode(o.doc, switches[0]), `${switches.length} switches`),
        check('the switch is next to the door', !!switchBox && !!doorLine && gapBetween(switchBox, doorLine) <= 600, switchBox && doorLine ? `${Math.round(gapBetween(switchBox, doorLine))} mm from it` : undefined),
        check('the switch controls the light', linked),
        unchanged(o, [...KITCHEN_WALLS, 'door'], 'the walls and the door are as they were'),
        noProblems(o),
      ]
    },
  },
  {
    id: 'trace-scanned-plan',
    about: 'Walls and rooms traced from a picture',
    start: plans.scannedFlat,
    pictures: true,
    prompt: 'The picture is a scanned plan, placed at its real size. Trace it: draw its walls over it and name its rooms as the plan does.',
    reference: { ops: flatOps },
    checks: (o) => [...flatChecks(o, 0.08, 0.03), check('walls were drawn', wallsOf(o.doc).length >= 5, `${wallsOf(o.doc).length} walls`)],
  },
]

export const taskById = (id: string) => TASKS.find((task) => task.id === id)
