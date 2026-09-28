// Randomised, always-solvable item placement.
//
// Rooms form a graph whose edges are openings. Locked doors need a key item;
// some secret doors only open one way. A placement is valid when, starting
// from the player's room and repeatedly collecting every reachable item,
// every placed item (and every room) ends up reachable.

const TRAVERSABLE = new Set(['door', 'arch', 'open', 'secret', 'bookshelf', 'crawl']);

/** Build a room-level access graph from the grid. */
export function buildAccessGraph(grid) {
  const edges = [];
  for (const e of grid.edges.values()) {
    if (!TRAVERSABLE.has(e.type)) continue;
    const a = grid.roomOfEdgeSide(e, 1), b = grid.roomOfEdgeSide(e, 2);
    if (a < 0 || b < 0 || a === b) continue;
    const op = e.opening || {};
    let lock = null;
    if (op.lock && op.lock !== 'bolt') lock = op.lock;
    // one-way secret panels: the dining panel only opens from the passage
    let oneWayFrom = null;
    if (op.id === 'dining_panel') oneWayFrom = grid.roomByKey['1X'].index;
    edges.push({ a, b, lock, oneWayFrom, id: op.id || null });
  }
  // stairs connect the lower-floor stair room with the rooms at both ends
  // (already covered: stair cells are a room on the lower floor whose
  // bottom/top edges are 'open' or doors).
  return { rooms: grid.rooms.length, edges };
}

/**
 * Compute reachable rooms given a start room and item placement.
 * placement: Map<itemId, roomIndex>. Returns { reachable:Set, have:Set }.
 */
export function simulateAccess(graph, startRoom, placement, extraHave = []) {
  const have = new Set(extraHave);
  const reachable = new Set([startRoom]);
  let changed = true;
  while (changed) {
    changed = false;
    // pick up everything in reachable rooms
    for (const [item, room] of placement) {
      if (!have.has(item) && reachable.has(room)) { have.add(item); changed = true; }
    }
    for (const e of graph.edges) {
      if (e.lock && !have.has(e.lock)) continue;
      const fwd = reachable.has(e.a) && !reachable.has(e.b) && (e.oneWayFrom == null || e.oneWayFrom === e.a);
      const back = reachable.has(e.b) && !reachable.has(e.a) && (e.oneWayFrom == null || e.oneWayFrom === e.b);
      if (fwd) { reachable.add(e.b); changed = true; }
      if (back) { reachable.add(e.a); changed = true; }
    }
  }
  return { reachable, have };
}

export const KEY_ITEMS = ['key_cellar', 'key_study', 'key_master', 'key_attic'];
export const ESCAPE_ITEMS = ['key_front', 'bolt_cutters', 'car_keys', 'car_battery', 'gas_can', 'crowbar', 'rope', 'wrench', 'valve_wheel'];
export const SECRET_ITEMS = ['music_box', 'music_key', 'ribbon'];

// Where certain items feel natural (room keys). Others go anywhere.
const PREFERENCES = {
  car_battery: ['garage', 'utility', 'cellar', 'workshop'],
  gas_can: ['garage', 'utility', 'cellar', 'storage'],
  wrench: ['cellar', 'garage', 'utility', 'workshop'],
  valve_wheel: ['cellar', 'garage', 'workshop', 'attic'],
  bolt_cutters: ['garage', 'cellar', 'workshop', 'storage', 'attic'],
  crowbar: ['garage', 'cellar', 'workshop', 'utility', 'attic'],
  rope: ['garage', 'attic', 'cellar', 'storage', 'closet'],
  music_box: ['bedroom', 'attic', 'study', 'playroom', 'closet'],
  music_key: ['bedroom', 'study', 'workshop', 'living', 'dining'],
  ribbon: ['bedroom', 'bathroom', 'living', 'closet', 'attic'],
};

/**
 * Choose a slot for every item. slots: [{room, ...}], rooms: grid.rooms.
 * Returns Map<itemId, slot> or throws after too many attempts.
 */
export function placeItems({ grid, graph, slots, rng, startRoom, items, forbidRooms = [] }) {
  const byRoom = new Map();
  for (const s of slots) {
    if (!byRoom.has(s.room)) byRoom.set(s.room, []);
    byRoom.get(s.room).push(s);
  }
  // rooms reachable once every key is in hand (escape-only rooms excluded)
  const full = simulateAccess(graph, startRoom, new Map(), KEY_ITEMS).reachable;
  const usable = [...byRoom.keys()].filter((r) => !forbidRooms.includes(r) && full.has(r));
  for (let attempt = 0; attempt < 400; attempt++) {
    const usedSlots = new Set();
    const roomCount = new Map();
    const placement = new Map();
    const chosen = new Map();
    let ok = true;
    for (const item of rng.shuffle([...items])) {
      const prefs = PREFERENCES[item];
      let candidates = usable.filter((r) => {
        if ((roomCount.get(r) || 0) >= (KEY_ITEMS.includes(item) ? 1 : 2)) return false;
        if (KEY_ITEMS.includes(item) && r === startRoom) return false;
        return true;
      });
      if (prefs && rng.chance(0.75)) {
        const pref = candidates.filter((r) => prefs.includes(grid.rooms[r].kind));
        if (pref.length) candidates = pref;
      }
      const room = rng.pick(candidates);
      if (room === undefined) { ok = false; break; }
      const free = byRoom.get(room).filter((s) => !usedSlots.has(s));
      if (!free.length) { ok = false; break; }
      const slot = rng.pick(free);
      usedSlots.add(slot);
      roomCount.set(room, (roomCount.get(room) || 0) + 1);
      placement.set(item, room);
      chosen.set(item, slot);
    }
    if (!ok) continue;
    const { reachable, have } = simulateAccess(graph, startRoom, placement);
    if (items.every((i) => have.has(i)) && reachable.size === full.size) return chosen;
  }
  throw new Error('could not find a solvable item placement');
}
