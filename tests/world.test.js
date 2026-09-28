import { describe, it, expect, beforeAll } from 'vitest';
import { HouseGrid, HOLE } from '../src/world/grid.js';
import { NavGraph } from '../src/cat/nav.js';
import { furnish, mockWorld } from '../src/world/furnishing.js';
import { buildAccessGraph, placeItems, simulateAccess, KEY_ITEMS, ESCAPE_ITEMS, SECRET_ITEMS } from '../src/game/placement.js';
import { RNG } from '../src/core/rng.js';
import { PLAYER_START, VENTS, floorBaseY } from '../src/world/layout.js';

let grid, world, nav;

function stubDoors(g) {
  for (const e of g.edges.values()) {
    if (['door', 'secret', 'bookshelf', 'front', 'garage', 'grate', 'tiny'].includes(e.type)) {
      const escape = ['front', 'garage', 'grate', 'tiny'].includes(e.type);
      e.door = {
        isPassable: () => false,
        canBeOpenedBy: () => !escape,
        blocksSight: () => true,
        barricade: 0,
        breakable: e.type === 'door',
      };
    }
  }
}

beforeAll(() => {
  grid = new HouseGrid();
  stubDoors(grid);
  world = mockWorld(grid);
  furnish(world);
  // compute blocked cells like World._computeNavBlocked
  const blocked = [];
  for (let f = 0; f < grid.floorCount; f++) blocked.push(new Uint8Array(grid.W * grid.D));
  for (const c of world.furnitureColliders) {
    if (!c.nav) continue;
    for (let z = Math.floor(c.z0); z <= Math.floor(c.z1 - 1e-6); z++) {
      for (let x = Math.floor(c.x0); x <= Math.floor(c.x1 - 1e-6); x++) {
        const ox = Math.max(0, Math.min(x + 1, c.x1) - Math.max(x, c.x0));
        const oz = Math.max(0, Math.min(z + 1, c.z1) - Math.max(z, c.z0));
        if (ox * oz > 0.42) blocked[c.f][z * grid.W + x] = 1;
      }
    }
  }
  nav = new NavGraph(grid, blocked, VENTS);
});

describe('layout', () => {
  it('has no layout errors', () => {
    expect(grid.errors).toEqual([]);
  });

  it('has the expected floors and rooms', () => {
    expect(grid.floorCount).toBe(4);
    expect(grid.rooms.length).toBeGreaterThan(35);
    for (const r of grid.rooms) expect(r.cells.length).toBeGreaterThan(0);
  });

  it('marks every stair hole above a stair', () => {
    for (const st of grid.stairs) {
      for (const [x, z] of st.cells) {
        expect(grid.cellRaw(st.lower + 1, x, z)).toBe(HOLE);
        expect(grid.stairAt(st.lower, x, z)).toBe(st);
      }
    }
  });

  it('ramps stairs continuously between floors', () => {
    const st = grid.stairs.find((s) => s.id === 'main');
    const yBottom = grid.groundY(1, 17.5, 15.99);
    const yTop = grid.groundY(1, 17.5, 11.01);
    expect(yBottom).toBeCloseTo(0, 1);
    expect(yTop).toBeCloseTo(floorBaseY(2), 1);
    void st;
  });

  it('resolves floors from positions on and off stairs', () => {
    expect(grid.floorAt(17.5, 3.1, 11.2)).toBe(1); // top of the grand stair is still the stair
    expect(grid.floorAt(17.5, 3.2, 10.5)).toBe(2); // upper hallway
    expect(grid.floorAt(21.5, -3.2, 2.5)).toBe(0); // basement hall
  });

  it('places the player start inside the guest bedroom', () => {
    const r = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z);
    expect(r.key).toBe('2g');
  });
});

describe('furnishing', () => {
  it('creates colliders, hiding spots and item slots', () => {
    expect(world.furnitureColliders.length).toBeGreaterThan(200);
    expect(world.hidingSpots.length).toBeGreaterThan(15);
    expect(world.itemSlots.length).toBeGreaterThan(80);
  });

  it('keeps hiding spot entries out of walls', () => {
    for (const h of world.hidingSpots) {
      const r = grid.roomAtWorld(h.f, h.entry.x, h.entry.z);
      expect(r, `entry of ${h.id}`).toBeTruthy();
    }
  });

  it('never blocks a doorway with furniture', () => {
    for (const e of grid.edges.values()) {
      if (!['door', 'arch', 'secret', 'bookshelf'].includes(e.type)) continue;
      for (const [x, z] of [e.c1, e.c2]) {
        const f = e.f;
        if (grid.cellRaw(f, x, z) < 0) continue;
        expect(nav.isBlocked(f, x, z), `cell ${f}:${x},${z} next to ${e.opening?.id || e.type}`).toBe(false);
      }
    }
  });
});

describe('navigation', () => {
  it('reaches every room from the player start (doors openable)', () => {
    const start = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z);
    const reached = nav.reachableRooms(start, { doors: 'any' });
    const missing = grid.rooms.filter((r) => !reached.has(r.index) && r.key !== '0Z').map((r) => r.key);
    expect(missing).toEqual([]);
  });

  it('finds a path from the attic to the basement', () => {
    const path = nav.findPath(3, 20.5, 5.5, 0, 25.5, 7.5, { doors: 'any' });
    expect(path).toBeTruthy();
    expect(path[path.length - 1].f).toBe(0);
    const floors = new Set(path.map((p) => p.f));
    expect(floors.size).toBeGreaterThanOrEqual(3);
  });

  it('uses vents as shortcuts when allowed', () => {
    const a = nav.findPath(1, 13.5, 2.5, 2, 30.5, 9.5, { doors: 'any' });
    const b = nav.findPath(1, 13.5, 2.5, 2, 30.5, 9.5, { doors: 'any', vents: true, ventCost: 0.2 });
    expect(a && b).toBeTruthy();
    expect(b.totalCost).toBeLessThanOrEqual(a.totalCost);
  });
});

describe('item placement', () => {
  it('is always solvable for many seeds', () => {
    const graph = buildAccessGraph(grid);
    const startRoom = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z).index;
    const items = [...KEY_ITEMS, ...ESCAPE_ITEMS, ...SECRET_ITEMS];
    const tunnel = grid.roomByKey['0Z'].index;
    for (let seed = 1; seed <= 200; seed++) {
      const rng = new RNG(seed);
      const chosen = placeItems({ grid, graph, slots: world.itemSlots, rng, startRoom, items, forbidRooms: [tunnel] });
      expect(chosen.size).toBe(items.length);
      const placement = new Map([...chosen].map(([k, s]) => [k, s.room]));
      const { have } = simulateAccess(graph, startRoom, placement);
      for (const i of items) expect(have.has(i)).toBe(true);
      // the master key is never inside the master suite
      const mk = chosen.get('key_master');
      expect(['2M', '2E', '2c']).not.toContain(grid.rooms[mk.room].key);
    }
  });

  it('is deterministic for a seed', () => {
    const graph = buildAccessGraph(grid);
    const startRoom = grid.roomAtWorld(PLAYER_START.f, PLAYER_START.x, PLAYER_START.z).index;
    const items = [...KEY_ITEMS, ...ESCAPE_ITEMS];
    const a = placeItems({ grid, graph, slots: world.itemSlots, rng: new RNG(42), startRoom, items });
    const b = placeItems({ grid, graph, slots: world.itemSlots, rng: new RNG(42), startRoom, items });
    for (const i of items) expect(a.get(i)).toBe(b.get(i));
  });
});
