// The house. Every floor is a 36 x 26 grid of 1m cells. Each character is a
// room code local to that floor; '.' is outside / solid ground. Walls are
// generated automatically on every edge between two different codes, then
// the OPENINGS list punches doors, arches, windows and secret passages into
// those walls.
//
// World coordinates: cell (x, z) spans [x, x+1] x [z, z+1]. +Y is up.
// Floor f has its floor surface at y = (f - 1) * FLOOR_H.

export const GRID_W = 36;
export const GRID_D = 26;
export const FLOOR_H = 3.2;
export const SLAB = 0.3;
export const WALL_T = 0.14;
export const EXT_WALL_T = 0.26;
export const DOOR_W = 0.9;
export const DOOR_H = 2.08;
export const floorBaseY = (f) => (f - 1) * FLOOR_H;

export const FLOOR_NAMES = ['Basement', 'Ground Floor', 'Upper Floor', 'Attic'];

// prettier-ignore
export const FLOOR_MAPS = [
  // ---------------------------------------------------------------- 0 BASEMENT
  [
    '....................................',
    '.........VVVVVVQQQQQQQQQQQQQQCCCCCC.',
    '.........VVVVVVQQQQQQQQQQQQQQCCCCCC.',
    '.........VVVVVVQQQQQQQQQQQQQQCCCCCC.',
    '.........VVVVVVOOOOOOvNNNNNNNxCCCCC.',
    '.........VVVVVVOOOOOOvNNNNNNNxCCCCC.',
    '.........VVVVVVOOOOOOvNNNNNNNxCCCCC.',
    '.........JJJJJJOOOOOOvNNNNNNNxCCCCC.',
    '.........JJJJJJOOOOOOvNNNNNNNxCCCCC.',
    '.........JJJJJJOOOOOOONNNNNNNCCCCCC.',
    '.........JJJJJJOOOOOOONNNNNNNCCCCCC.',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '...............................ZZ...',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
  ],
  // ------------------------------------------------------------ 1 GROUND FLOOR
  [
    '....................................',
    '.RRRRRRRRKKKKKKKKPPPPPDDDDDDDXSSSSS.',
    '.RRRRRRRRKKKKKKKKPPPPPDDDDDDDXSSSSS.',
    '.RRRRRRRRKKKKKKKKPPPPPDDDDDDDXSSSSS.',
    '.RRRRRRRRKKKKKKKKUUUUHDDDDDDDHSSSSS.',
    '.RRRRRRRRKKKKKKKKUUUUHDDDDDDDHSSSSS.',
    '.RRRRRRRRKKKKKKKKUUUUHDDDDDDDHSSSSS.',
    '.RRRRRRRRKKKKKKKKUUUUHDDDDDDDHSSSSS.',
    '.RRRRRRRRKKKKKKKKUUUUHDDDDDDDHSSSSS.',
    '.NNNNNNNNhhhhhhhhhhhhhhhhhhhhhhhhhh.',
    '.NNNNNNNNhhhhhhhhhhhhhhhhhhhhhhhhhh.',
    '.NNNNNNNNWWWWFFFF^^FFLLLLLLLLLLLLLL.',
    '.NNNNNNNNWWWWFFFF^^FFLLLLLLLLLLLLLL.',
    '.NNNNNNNNWWWWFFFF^^FFLLLLLLLLLLLLLL.',
    '.NNNNNNNNWWWWFFFF^^FFLLLLLLLLLLLLLL.',
    '.GGGGGGGGMMMMFFFF^^FFLLLLLLLLLLLLLL.',
    '.GGGGGGGGMMMMFFFFFFFFLLLLLLLLLLLLLL.',
    '.GGGGGGGGMMMMFFFFFFFFLLLLLLLLLLLLLL.',
    '.GGGGGGGGMMMMFFFFFFFFLLLLLLLLLLLLLL.',
    '.GGGGGGGGMMMMFFFFFFFFYYYYYYYTTTTTTT.',
    '.GGGGGGGGCCCCFFFFFFFFYYYYYYYTTTTTTT.',
    '.GGGGGGGGCCCCFFFFFFFFYYYYYYYTTTTTTT.',
    '.GGGGGGGGCCCCFFFFFFFFYYYYYYYTTTTTTT.',
    '.GGGGGGGGCCCCFFFFFFFFYYYYYYYTTTTTTT.',
    '.GGGGGGGGCCCCFFFFFFFFYYYYYYYTTTTTTT.',
    '....................................',
  ],
  // ------------------------------------------------------------- 2 UPPER FLOOR
  [
    '....................................',
    '.........eeeeeeeBBBgggggMMMMMMMMEEE.',
    '.........zeeeeeeBBBgggggMMMMMMMMEEE.',
    '.........zeeeeeeBBBgggggMMMMMMMMEEE.',
    '.........zeeeeeeBBBgggggMMMMMMMMEEE.',
    '.........zeeeeeeBBBgggggMMMMMMMMcca.',
    '.........zeeeeeeBBBgggggMMMMMMMMcca.',
    '.........eeeeeeeBBBgggggMMMMMMMMcca.',
    '.........eeeeeeeBBBgggggMMMMMMMMcca.',
    '.........uuuuuuuuuuuuuuuuuuuuuuuuua.',
    '.........uuuuuuuuuuuuuuuuuuuuuuuuuu.',
    '.........kkkkkkllHHllrrrrrrrwwwwwww.',
    '.........kkkkkkllHHllrrrrrrrwwwwwww.',
    '.........kkkkkkllHHllrrrrrrrwwwwwww.',
    '.........kkkkkkllHHllrrrrrrrwwwwwww.',
    '.........kkkkkkllHHllrrrrrrrwwwwwww.',
    '.........kkkkkkllllllrrrrrrrwwwwwww.',
    '.........kkkkkkllllllrrrrrrrwwwwwww.',
    '.........kkkkkkllllllrrrrrrrwwwwwww.',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
  ],
  // ------------------------------------------------------------------ 3 ATTIC
  [
    '....................................',
    '.........RRRRRRAAAAAAAAAAAAAAATTTTT.',
    '.........HRRRRRAAAAAAAAAAAAAAATTTTT.',
    '.........HRRRRRAAAAAAAAAAAAAAATTTTT.',
    '.........HRRRRRAAAAAAAAAAAAAAATTTTT.',
    '.........HRRRRRAAAAAAAAAAAAAAATTTTH.',
    '.........HRRRRRAAAAAAAAAAAAAAATTTTH.',
    '.........RRRRRRAAAAAAAAAAAAAAATTTTH.',
    '.........RRRRRRAAAAAAAAAAAAAAATTTTH.',
    '.........RRRRRRAAAAAAAAAAAAAAATTTTH.',
    '.........RRRRRRAAAAAAAAAAAAAAATTTTT.',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
    '....................................',
  ],
];

export const FLOOR_CEIL = [2.9, 2.9, 2.9, 2.55];

// Stairs live on the lower floor's grid (as their own room code) and appear
// as 'H' holes on the floor above. `dir` is the direction of ascent.
export const STAIRS = [
  { id: 'main', lower: 1, x: 17, z: 11, w: 2, len: 5, dir: 'N', style: 'grand' },
  { id: 'cellar', lower: 0, x: 21, z: 4, w: 1, len: 5, dir: 'S', style: 'rough' },
  { id: 'servant', lower: 0, x: 29, z: 4, w: 1, len: 5, dir: 'N', style: 'rough' },
  { id: 'attic', lower: 2, x: 34, z: 5, w: 1, len: 5, dir: 'N', style: 'rough' },
  { id: 'ellie', lower: 2, x: 9, z: 2, w: 1, len: 5, dir: 'N', style: 'narrow' },
];

// Opening types:
//   door      - hinged door (optional lock: 'bolt' or a key item id)
//   arch      - doorless opening with a lintel
//   open      - no wall at all
//   railing   - balustrade (blocks movement, not sight)
//   window    - exterior window (style: boarded | barred | clear)
//   secret    - hidden door that looks like a wall until discovered
//   bookshelf - the study's swinging bookcase
//   front     - the chained double front door (escape)
//   garage    - roll-up garage door (escape, needs power)
//   grate     - bolted tunnel grate (escape)
//   atticwin  - boarded attic window (escape)
//   tiny      - Ellie's tiny door (secret ending)
// `side` is relative to cell (x, z): N=-z, S=+z, W=-x, E=+x.
const O = [];
const add = (f, x, z, side, type, opts = {}) => O.push({ f, x, z, side, type, ...opts });

// ---- Basement
add(0, 14, 2, 'E', 'door', { id: 'b_cellar_wine' });
add(0, 11, 6, 'S', 'door', { id: 'b_wine_collection', creaky: true });
add(0, 14, 9, 'E', 'door', { id: 'b_collection_boiler' });
add(0, 17, 3, 'S', 'door', { id: 'b_hall_boiler' });
add(0, 25, 3, 'S', 'door', { id: 'b_hall_workshop' });
add(0, 21, 9, 'E', 'door', { id: 'b_boiler_workshop' });
add(0, 28, 2, 'E', 'door', { id: 'b_hall_coal' });
add(0, 31, 10, 'S', 'grate', { id: 'tunnel_grate' });
add(0, 32, 10, 'S', 'grate', { id: 'tunnel_grate_b', part: true });
for (const x of [12, 18, 25, 32]) add(0, x, 1, 'N', 'window', { style: 'basement' });

// ---- Ground floor
add(1, 8, 4, 'E', 'door', { id: 'parlor_kitchen' });
add(1, 4, 8, 'S', 'arch');
add(1, 5, 8, 'S', 'arch');
add(1, 8, 10, 'E', 'door', { id: 'sunroom_hall', glass: true });
add(1, 11, 8, 'S', 'arch');
add(1, 12, 8, 'S', 'arch');
add(1, 16, 2, 'E', 'door', { id: 'kitchen_pantry', creaky: true });
add(1, 16, 6, 'E', 'door', { id: 'kitchen_laundry' });
add(1, 18, 8, 'S', 'door', { id: 'laundry_hall' });
add(1, 21, 8, 'S', 'door', { id: 'cellar_door', lock: 'key_cellar', heavy: true });
add(1, 24, 8, 'S', 'arch');
add(1, 25, 8, 'S', 'arch');
add(1, 28, 1, 'E', 'secret', { id: 'dining_panel', hint: 'A wainscot panel. It sounds hollow.' });
add(1, 29, 2, 'E', 'bookshelf', { id: 'study_bookshelf' });
add(1, 32, 8, 'S', 'door', { id: 'study_door', lock: 'key_study' });
add(1, 10, 10, 'S', 'door', { id: 'washroom_door', lock: 'bolt' });
add(1, 13, 10, 'S', 'arch');
add(1, 14, 10, 'S', 'arch');
add(1, 19, 10, 'S', 'arch');
add(1, 20, 10, 'S', 'arch');
add(1, 12, 17, 'E', 'door', { id: 'mud_foyer' });
add(1, 8, 17, 'E', 'door', { id: 'garage_mud', heavy: true });
add(1, 12, 22, 'E', 'door', { id: 'cloak_door' });
add(1, 20, 13, 'E', 'arch');
add(1, 20, 14, 'E', 'arch');
add(1, 30, 10, 'S', 'door', { id: 'living_hall' });
add(1, 24, 18, 'S', 'door', { id: 'living_den' });
add(1, 20, 22, 'E', 'door', { id: 'foyer_den' });
add(1, 31, 18, 'S', 'door', { id: 'living_trophy' });
add(1, 27, 21, 'E', 'door', { id: 'den_trophy', creaky: true });
add(1, 16, 24, 'S', 'front', { id: 'front_door' });
add(1, 17, 24, 'S', 'front', { id: 'front_door_b', part: true });
for (const x of [3, 4, 5, 6]) add(1, x, 24, 'S', 'garage', { id: x === 3 ? 'garage_door' : 'garage_door_' + x, part: x !== 3 });
for (let z = 11; z <= 15; z++) {
  add(1, 16, z, 'E', 'railing');
  add(1, 19, z, 'W', 'railing');
}
// ground windows
add(1, 3, 1, 'N', 'window', { style: 'clear' });
add(1, 6, 1, 'N', 'window', { style: 'boarded' });
add(1, 1, 4, 'W', 'window', { style: 'barred' });
add(1, 11, 1, 'N', 'window', { style: 'boarded' });
add(1, 14, 1, 'N', 'window', { style: 'clear' });
add(1, 19, 1, 'N', 'window', { style: 'barred' });
add(1, 24, 1, 'N', 'window', { style: 'clear' });
add(1, 26, 1, 'N', 'window', { style: 'boarded' });
add(1, 32, 1, 'N', 'window', { style: 'boarded' });
add(1, 34, 4, 'E', 'window', { style: 'clear' });
add(1, 34, 6, 'E', 'window', { style: 'barred' });
for (const z of [10, 11, 12, 13]) add(1, 1, z, 'W', 'window', { style: z === 12 ? 'boarded' : 'clear', tall: true });
add(1, 1, 18, 'W', 'window', { style: 'barred', small: true });
add(1, 1, 21, 'W', 'window', { style: 'barred', small: true });
add(1, 14, 24, 'S', 'window', { style: 'clear' });
add(1, 19, 24, 'S', 'window', { style: 'clear' });
add(1, 34, 13, 'E', 'window', { style: 'clear' });
add(1, 34, 16, 'E', 'window', { style: 'boarded' });
add(1, 23, 24, 'S', 'window', { style: 'boarded' });
add(1, 25, 24, 'S', 'window', { style: 'clear' });
add(1, 30, 24, 'S', 'window', { style: 'clear' });
add(1, 32, 24, 'S', 'window', { style: 'boarded' });
add(1, 34, 21, 'E', 'window', { style: 'barred' });
add(1, 34, 10, 'E', 'window', { style: 'clear' });
add(1, 10, 24, 'S', 'window', { style: 'boarded' });

// ---- Upper floor
add(2, 12, 8, 'S', 'door', { id: 'ellie_door', creaky: true });
add(2, 9, 7, 'N', 'secret', { id: 'ellie_secret', child: true, hint: 'The wallpaper here is peeling in a neat rectangle.' });
add(2, 17, 8, 'S', 'door', { id: 'bath_door', lock: 'bolt' });
add(2, 21, 8, 'S', 'door', { id: 'guest_door' });
add(2, 27, 8, 'S', 'door', { id: 'master_door', lock: 'key_master' });
add(2, 31, 2, 'E', 'door', { id: 'ensuite_door', lock: 'bolt' });
add(2, 31, 6, 'E', 'door', { id: 'closet_door' });
add(2, 34, 10, 'N', 'door', { id: 'attic_door', lock: 'key_attic', heavy: true });
add(2, 11, 10, 'S', 'door', { id: 'sewing_door' });
add(2, 15, 10, 'S', 'open');
add(2, 16, 10, 'S', 'open');
add(2, 19, 10, 'S', 'open');
add(2, 20, 10, 'S', 'open');
add(2, 20, 17, 'E', 'door', { id: 'library_landing' });
add(2, 24, 10, 'S', 'door', { id: 'library_hall' });
add(2, 31, 10, 'S', 'door', { id: 'workshop_door', creaky: true });
add(2, 27, 14, 'E', 'door', { id: 'library_workshop' });
for (let z = 11; z <= 15; z++) {
  add(2, 16, z, 'E', 'railing');
  add(2, 19, z, 'W', 'railing');
}
add(2, 17, 15, 'S', 'railing');
add(2, 18, 15, 'S', 'railing');
// upper windows
add(2, 11, 1, 'N', 'window', { style: 'clear' });
add(2, 14, 1, 'N', 'window', { style: 'boarded' });
add(2, 9, 8, 'W', 'window', { style: 'clear' });
add(2, 17, 1, 'N', 'window', { style: 'frosted' });
add(2, 21, 1, 'N', 'window', { style: 'clear' });
add(2, 26, 1, 'N', 'window', { style: 'clear' });
add(2, 29, 1, 'N', 'window', { style: 'boarded' });
add(2, 33, 1, 'N', 'window', { style: 'frosted' });
add(2, 34, 2, 'E', 'window', { style: 'clear' });
add(2, 9, 9, 'W', 'window', { style: 'clear', tall: true });
add(2, 9, 10, 'W', 'window', { style: 'clear', tall: true });
add(2, 9, 13, 'W', 'window', { style: 'clear' });
add(2, 9, 16, 'W', 'window', { style: 'boarded' });
add(2, 11, 18, 'S', 'window', { style: 'clear' });
add(2, 17, 18, 'S', 'window', { style: 'clear', tall: true });
add(2, 18, 18, 'S', 'window', { style: 'clear', tall: true });
add(2, 23, 18, 'S', 'window', { style: 'boarded' });
add(2, 25, 18, 'S', 'window', { style: 'clear' });
add(2, 34, 13, 'E', 'window', { style: 'clear' });
add(2, 34, 16, 'E', 'window', { style: 'barred' });
add(2, 31, 18, 'S', 'window', { style: 'clear' });
add(2, 34, 7, 'E', 'window', { style: 'clear', small: true });

// ---- Attic
add(3, 14, 5, 'E', 'door', { id: 'playroom_door', creaky: true, child: false });
add(3, 29, 7, 'E', 'door', { id: 'storage_door' });
add(3, 22, 10, 'S', 'atticwin', { id: 'attic_window' });
add(3, 9, 9, 'W', 'tiny', { id: 'tiny_door' });
add(3, 12, 1, 'N', 'window', { style: 'round' });
add(3, 20, 1, 'N', 'window', { style: 'boarded' });
add(3, 26, 1, 'N', 'window', { style: 'clear' });
add(3, 32, 1, 'N', 'window', { style: 'boarded' });
add(3, 18, 10, 'S', 'window', { style: 'clear' });
add(3, 27, 10, 'S', 'window', { style: 'boarded' });
add(3, 34, 2, 'E', 'window', { style: 'round' });

export const OPENINGS = O;

// Ventilation grilles - the cat's private highways. They sit low on a wall.
export const VENTS = [
  { id: 'v_kitchen', f: 1, x: 13, z: 1, side: 'N' },
  { id: 'v_hall_g', f: 1, x: 22, z: 10, side: 'S' },
  { id: 'v_living', f: 1, x: 34, z: 15, side: 'E' },
  { id: 'v_foyer', f: 1, x: 13, z: 20, side: 'W' },
  { id: 'v_parlor', f: 1, x: 1, z: 6, side: 'W' },
  { id: 'v_study', f: 1, x: 34, z: 2, side: 'E' },
  { id: 'v_garage', f: 1, x: 8, z: 21, side: 'E' },
  { id: 'v_dining', f: 1, x: 22, z: 5, side: 'W' },
  { id: 'v_den', f: 1, x: 21, z: 23, side: 'W' },
  { id: 'v_hall_u', f: 2, x: 30, z: 9, side: 'N' },
  { id: 'v_ellie', f: 2, x: 15, z: 3, side: 'E' },
  { id: 'v_master', f: 2, x: 24, z: 4, side: 'W' },
  { id: 'v_guest', f: 2, x: 23, z: 6, side: 'E' },
  { id: 'v_bath_u', f: 2, x: 18, z: 3, side: 'E' },
  { id: 'v_library', f: 2, x: 21, z: 16, side: 'W' },
  { id: 'v_workshop', f: 2, x: 34, z: 15, side: 'E' },
  { id: 'v_sewing', f: 2, x: 9, z: 12, side: 'W' },
  { id: 'v_boiler', f: 0, x: 15, z: 6, side: 'W' },
  { id: 'v_bworkshop', f: 0, x: 28, z: 6, side: 'E' },
  { id: 'v_bhall', f: 0, x: 16, z: 1, side: 'N' },
  { id: 'v_collection', f: 0, x: 9, z: 9, side: 'W' },
  { id: 'v_coal', f: 0, x: 34, z: 5, side: 'E' },
  { id: 'v_attic', f: 3, x: 22, z: 1, side: 'N' },
  { id: 'v_playroom', f: 3, x: 11, z: 10, side: 'S' },
  { id: 'v_storage', f: 3, x: 32, z: 10, side: 'S' },
];

// Room metadata keyed by floor index + code.
// light types: ceiling | chandelier | bulb | tube | lamp | sconce | candle
const W = 0xffd9a0; // warm incandescent
const C = 0xcfe3ff; // cold fluorescent
const R = 0xff7050; // reddish
export const ROOMS = {
  // Basement
  '0V': { name: 'Wine Cellar', kind: 'cellar', floor: 'stone', wall: 'brick', ceil: 'concreteCeil', lights: [{ type: 'bulb', x: 12, z: 3.5, color: W, i: 5, on: false }] },
  '0J': { name: 'The Collection', kind: 'cellar', floor: 'concrete', wall: 'concreteWall', ceil: 'concreteCeil', lights: [{ type: 'bulb', x: 12, z: 8.5, color: R, i: 4, on: true, flicker: 0.6 }] },
  '0Q': { name: 'Basement Hall', kind: 'cellar', floor: 'concrete', wall: 'brick', ceil: 'concreteCeil', lights: [{ type: 'bulb', x: 18.5, z: 2, color: W, i: 5, on: true, flicker: 0.2 }, { type: 'bulb', x: 25.5, z: 2, color: W, i: 5, on: false }] },
  '0O': { name: 'Boiler Room', kind: 'cellar', floor: 'concrete', wall: 'concreteWall', ceil: 'concreteCeil', lights: [{ type: 'bulb', x: 18, z: 7.5, color: W, i: 5, on: true, flicker: 0.3 }] },
  '0N': { name: 'Basement Workshop', kind: 'cellar', floor: 'concrete', wall: 'woodPlanks', ceil: 'concreteCeil', lights: [{ type: 'tube', x: 25, z: 7, color: C, i: 6, on: false, flicker: 0.5 }] },
  '0C': { name: 'Coal Cellar', kind: 'cellar', floor: 'dirt', wall: 'stoneWall', ceil: 'concreteCeil', lights: [{ type: 'bulb', x: 32, z: 5, color: W, i: 4, on: false }] },
  '0Z': { name: 'Flooded Tunnel', kind: 'tunnel', floor: 'wetStone', wall: 'stoneWall', ceil: 'stoneWall', lights: [] },
  '0v': { name: 'Cellar Stairs', kind: 'stairs', floor: 'woodPlain', wall: 'concreteWall', ceil: 'concreteCeil', lightFrom: '0Q' },
  '0x': { name: "Servants' Stair", kind: 'secret', floor: 'woodPlain', wall: 'woodPanelDark', ceil: 'concreteCeil', lightFrom: '0C' },
  // Ground floor
  '1R': { name: 'Parlor', kind: 'living', floor: 'woodDark', wall: 'wallpaperRed', ceil: 'plaster', lights: [{ type: 'chandelier', x: 5, z: 4.5, color: W, i: 9, on: false }] },
  '1K': { name: 'Kitchen', kind: 'kitchen', floor: 'tileChecker', wall: 'wallpaperKitchen', ceil: 'plaster', lights: [{ type: 'ceiling', x: 12.5, z: 4.5, color: W, i: 10, on: true, flicker: 0.15 }] },
  '1P': { name: 'Pantry', kind: 'storage', floor: 'woodPlain', wall: 'plasterWall', ceil: 'plaster', lights: [{ type: 'bulb', x: 19.5, z: 2, color: W, i: 4, on: false }] },
  '1U': { name: 'Laundry Room', kind: 'utility', floor: 'tileWhite', wall: 'plasterWall', ceil: 'plaster', lights: [{ type: 'tube', x: 18.8, z: 6.5, color: C, i: 6, on: true, flicker: 0.35 }] },
  '1D': { name: 'Dining Room', kind: 'dining', floor: 'woodParquet', wall: 'wallpaperGreen', ceil: 'plaster', lights: [{ type: 'chandelier', x: 25.5, z: 4.5, color: W, i: 10, on: false }] },
  '1X': { name: "Servants' Passage", kind: 'secret', floor: 'woodPlain', wall: 'woodPanelDark', ceil: 'plaster', lights: [] },
  '1S': { name: "Arthur's Study", kind: 'study', floor: 'woodDark', wall: 'woodPanel', ceil: 'plaster', lights: [{ type: 'lamp', x: 32.5, z: 2.35, y: 1.15, color: W, i: 3.5, on: true, flicker: 0.1 }, { type: 'ceiling', x: 32.5, z: 5, color: W, i: 8, on: false }] },
  '1h': { name: 'Main Hallway', kind: 'hallway', floor: 'woodFloor', wall: 'wallpaperDamask', ceil: 'plaster', lights: [{ type: 'ceiling', x: 13, z: 10, color: W, i: 7, on: true, flicker: 0.25 }, { type: 'ceiling', x: 22, z: 10, color: W, i: 7, on: false }, { type: 'ceiling', x: 30, z: 10, color: W, i: 7, on: true, flicker: 0.5 }] },
  '1N': { name: 'Sunroom', kind: 'living', floor: 'tileTerracotta', wall: 'plasterGreen', ceil: 'plaster', lights: [{ type: 'ceiling', x: 5, z: 12, color: W, i: 7, on: false }] },
  '1W': { name: 'Washroom', kind: 'bathroom', floor: 'tileWhite', wall: 'tileWall', ceil: 'plaster', lights: [{ type: 'ceiling', x: 11, z: 13, color: W, i: 6, on: false }] },
  '1F': { name: 'Foyer', kind: 'foyer', floor: 'marble', wall: 'wallpaperDamask', ceil: 'plaster', lights: [{ type: 'chandelier', x: 16.5, z: 20, color: W, i: 12, on: true, flicker: 0.12 }, { type: 'sconce', x: 13.2, z: 14, y: 1.9, color: W, i: 2.5, on: true }] },
  '1^': { name: 'Grand Staircase', kind: 'stairs', floor: 'carpetRed', wall: 'wallpaperDamask', ceil: 'plaster', lightFrom: '1F' },
  '1L': { name: 'Living Room', kind: 'living', floor: 'woodFloor', wall: 'wallpaperBlue', ceil: 'plaster', lights: [{ type: 'ceiling', x: 25, z: 14.5, color: W, i: 9, on: false }, { type: 'lamp', x: 33.9, z: 12.0, y: 1.6, color: W, i: 3.5, on: true, flicker: 0.2 }, { type: 'fire', x: 34.1, z: 15.5, y: 0.45, color: 0xff8a3a, i: 3, on: true }] },
  '1M': { name: 'Mudroom', kind: 'utility', floor: 'tileSlate', wall: 'woodPanel', ceil: 'plaster', lights: [{ type: 'ceiling', x: 11, z: 17, color: W, i: 5, on: false }] },
  '1G': { name: 'Garage', kind: 'garage', floor: 'concrete', wall: 'concreteWall', ceil: 'woodBeams', lights: [{ type: 'tube', x: 5, z: 17.5, color: C, i: 7, on: true, flicker: 0.6 }, { type: 'tube', x: 5, z: 21.5, color: C, i: 7, on: false }] },
  '1C': { name: 'Cloakroom', kind: 'closet', floor: 'woodFloor', wall: 'wallpaperDamask', ceil: 'plaster', lights: [{ type: 'bulb', x: 11, z: 22, color: W, i: 3, on: false }] },
  '1Y': { name: 'Den', kind: 'living', floor: 'carpetRed', wall: 'woodPanel', ceil: 'plaster', lights: [{ type: 'lamp', x: 21.6, z: 19.6, y: 1.55, color: W, i: 3, on: false }, { type: 'tv', x: 24.5, z: 23.6, y: 0.9, color: 0x9fb8ff, i: 0, on: false }] },
  '1T': { name: 'Trophy Room', kind: 'living', floor: 'woodDark', wall: 'wallpaperGreen', ceil: 'plaster', lights: [{ type: 'ceiling', x: 31, z: 21.5, color: W, i: 7, on: false }] },
  // Upper floor
  '2e': { name: "Ellie's Room", kind: 'bedroom', floor: 'carpetPink', wall: 'wallpaperChild', ceil: 'plaster', lights: [{ type: 'ceiling', x: 12.5, z: 4.5, color: W, i: 7, on: false }, { type: 'nightlight', x: 14.35, z: 1.5, y: 0.72, color: 0xffb0d0, i: 1.2, on: true, flicker: 0.05 }] },
  '2z': { name: 'Hidden Stair', kind: 'secret', floor: 'woodPlain', wall: 'woodPanelDark', ceil: 'plaster', lights: [] },
  '2B': { name: 'Bathroom', kind: 'bathroom', floor: 'tileWhite', wall: 'tileWall', ceil: 'plaster', lights: [{ type: 'ceiling', x: 17.5, z: 4.5, color: W, i: 6, on: false }] },
  '2g': { name: 'Guest Bedroom', kind: 'bedroom', floor: 'carpetBlue', wall: 'wallpaperFloral', ceil: 'plaster', lights: [{ type: 'ceiling', x: 21.5, z: 4.5, color: W, i: 3.2, on: true, flicker: 0.45 }, { type: 'lamp', x: 19.75, z: 8.72, y: 1.28, color: W, i: 2.6, on: true, flicker: 0.25 }] },
  '2M': { name: 'Master Bedroom', kind: 'bedroom', floor: 'carpetRed', wall: 'wallpaperRed', ceil: 'plaster', lights: [{ type: 'ceiling', x: 28, z: 4.5, color: W, i: 8, on: false }, { type: 'lamp', x: 26.35, z: 1.5, y: 1.0, color: W, i: 2.5, on: true, flicker: 0.1 }] },
  '2E': { name: 'Master Bath', kind: 'bathroom', floor: 'marble', wall: 'tileWall', ceil: 'plaster', lights: [{ type: 'ceiling', x: 33, z: 2.5, color: W, i: 5, on: false }] },
  '2c': { name: 'Walk-in Closet', kind: 'closet', floor: 'carpetRed', wall: 'woodPanel', ceil: 'plaster', lights: [{ type: 'bulb', x: 32.5, z: 6.5, color: W, i: 3, on: false }] },
  '2a': { name: 'Attic Stairs', kind: 'stairs', floor: 'woodPlain', wall: 'plasterWall', ceil: 'plaster', lights: [] },
  '2u': { name: 'Upper Hallway', kind: 'hallway', floor: 'woodFloor', wall: 'wallpaperDamask', ceil: 'plaster', lights: [{ type: 'ceiling', x: 13, z: 10, color: W, i: 6, on: true, flicker: 0.4 }, { type: 'ceiling', x: 22, z: 10, color: W, i: 6, on: false }, { type: 'ceiling', x: 31, z: 10, color: W, i: 6, on: true, flicker: 0.2 }] },
  '2k': { name: 'Sewing Room', kind: 'bedroom', floor: 'woodFloor', wall: 'wallpaperFloral', ceil: 'plaster', lights: [{ type: 'ceiling', x: 12, z: 14.5, color: W, i: 6, on: false }] },
  '2l': { name: 'Landing', kind: 'hallway', floor: 'woodFloor', wall: 'wallpaperDamask', ceil: 'plaster', lights: [{ type: 'chandelier', x: 17.5, z: 13, color: W, i: 8, on: false }, { type: 'lamp', x: 15.55, z: 18.4, y: 1.6, color: W, i: 2.5, on: true }] },
  '2r': { name: 'Library', kind: 'study', floor: 'woodDark', wall: 'woodPanel', ceil: 'plaster', lights: [{ type: 'ceiling', x: 24, z: 14.5, color: W, i: 7, on: false }, { type: 'lamp', x: 27.2, z: 18.45, y: 1.15, color: W, i: 2.5, on: true, flicker: 0.1 }] },
  '2w': { name: "Toymaker's Workshop", kind: 'workshop', floor: 'woodPlain', wall: 'plasterWall', ceil: 'plaster', lights: [{ type: 'bulb', x: 31, z: 14.5, color: W, i: 6, on: true, flicker: 0.45 }] },
  // Attic
  '3R': { name: "Ellie's Playroom", kind: 'playroom', floor: 'woodPlain', wall: 'wallpaperChildFaded', ceil: 'atticBoards', lights: [{ type: 'candle', x: 11.5, z: 6.0, y: 0.78, color: 0xffa060, i: 1.6, on: true, flicker: 0.3 }] },
  '3A': { name: 'Attic', kind: 'attic', floor: 'atticBoards', wall: 'atticBoards', ceil: 'atticBoards', lights: [{ type: 'bulb', x: 19, z: 5.5, color: W, i: 4, on: false }, { type: 'bulb', x: 26, z: 5.5, color: W, i: 4, on: true, flicker: 0.5 }] },
  '3T': { name: 'Attic Storage', kind: 'attic', floor: 'atticBoards', wall: 'atticBoards', ceil: 'atticBoards', lights: [{ type: 'bulb', x: 32, z: 3, color: W, i: 3.5, on: false }] },
};

// Rooms the player starts in and good "far away" places for the cat to lurk.
export const PLAYER_START = { f: 2, x: 22.35, z: 3.3, yaw: Math.PI / 2 };
export const CAT_START_ROOMS = ['0Q', '0O', '1K', '1D', '3A'];
