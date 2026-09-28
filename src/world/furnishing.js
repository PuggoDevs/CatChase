// Room-by-room furnishing of the house. Positions are in world metres
// (cell x,z spans [x,x+1]); `wall()` places a piece flush against a wall.
import * as THREE from 'three';
import { placeFurniture } from './furniture.js';
import { WALL_T, EXT_WALL_T } from './layout.js';
import { GeoBuilder } from './geo.js';
import { CollisionWorld } from './collision.js';
import { RNG } from '../core/rng.js';

export function furnish(world) {
  const g = world.grid;
  const R = (key) => {
    const r = g.roomByKey[key];
    if (!r) throw new Error('no room ' + key);
    return r;
  };
  const put = (type, key, x, z, facing = 'S', opts = {}) => placeFurniture(world, type, R(key), x, z, facing, opts);

  /** Place against the wall on `side` of room `key`, centred at `along`. */
  const wall = (type, key, side, along, depth, opts = {}) => {
    const room = R(key);
    const a = Math.floor(along);
    let x, z, facing;
    const gap = opts.gap ?? 0.02;
    const thick = (cx, cz, s) => {
      const e = g.edgeAt(room.floor, cx, cz, s);
      return e ? (e.exterior ? EXT_WALL_T : WALL_T) / 2 : 0;
    };
    if (side === 'N' || side === 'S') {
      const zs = room.cells.filter(([cx]) => cx === a).map(([, cz]) => cz);
      if (!zs.length) throw new Error(`${key}: no cells at x=${along}`);
      if (side === 'N') { const cz = Math.min(...zs); z = cz + thick(a, cz, 'N') + depth / 2 + gap; facing = 'S'; }
      else { const cz = Math.max(...zs); z = cz + 1 - thick(a, cz, 'S') - depth / 2 - gap; facing = 'N'; }
      x = along;
    } else {
      const xs = room.cells.filter(([, cz]) => cz === a).map(([cx]) => cx);
      if (!xs.length) throw new Error(`${key}: no cells at z=${along}`);
      if (side === 'W') { const cx = Math.min(...xs); x = cx + thick(cx, a, 'W') + depth / 2 + gap; facing = 'E'; }
      else { const cx = Math.max(...xs); x = cx + 1 - thick(cx, a, 'E') - depth / 2 - gap; facing = 'W'; }
      z = along;
    }
    return placeFurniture(world, type, room, x, z, facing, opts);
  };

  // ================================================================ BASEMENT
  // Wine cellar
  wall('wineRack', '0V', 'W', 2.3, 0.4, { w: 2.0 });
  wall('wineRack', '0V', 'W', 4.7, 0.4, { w: 2.0 });
  wall('wineRack', '0V', 'N', 12.9, 0.4, { w: 2.0 });
  put('table', '0V', 12.4, 4.2, 'E', { w: 1.3, d: 0.75, wood: 'woodPlanks' });
  put('barrel', '0V', 14.3, 6.3);
  put('barrel', '0V', 13.6, 6.4);
  put('crate', '0V', 14.3, 1.6);
  put('chair', '0V', 11.5, 4.3, 'E', { wood: 'woodPlanks', seat: 'woodPlanks' });
  // The Collection - where it keeps its playmates' things
  wall('hooks', '0J', 'S', 12, 0.1, { w: 4 });
  wall('hooks', '0J', 'W', 9.3, 0.1, { w: 2.2 });
  put('cage', '0J', 10.0, 8.1, 'E');
  put('clothesPile', '0J', 12.8, 8.3);
  put('clothesPile', '0J', 13.6, 10.1);
  wall('desk', '0J', 'N', 13.4, 0.7, { w: 1.2, wood: 'woodPlanks', leather: false });
  put('chair', '0J', 13.1, 9.0, 'N', { tipped: false, wood: 'woodPlanks', seat: 'woodPlanks' });
  wall('photoWall', '0J', 'E', 8.6, 0.04, { n: 8 });
  // Basement hall
  wall('shelves', '0Q', 'N', 16.6, 0.45, { w: 1.8, metal: true });
  wall('shelves', '0Q', 'N', 24.0, 0.45, { w: 1.8, metal: true });
  wall('waterHeater', '0Q', 'N', 27.9, 0.6);
  put('boxes', '0Q', 19.3, 1.7, 'S', { n: 4 });
  put('crate', '0Q', 26.3, 2.9);
  put('boxes', '0Q', 15.8, 3.4, 'S', { n: 2 });
  // Boiler room
  put('boiler', '0O', 18.2, 7.2);
  wall('wardrobe', '0O', 'W', 5.1, 0.68, { wood: 'metal', clothes: 'fabricBlue' });
  wall('shelves', '0O', 'N', 19.4, 0.45, { w: 1.4, metal: true, h: 1.6 });
  put('boxes', '0O', 16.0, 9.9, 'S', { n: 3 });
  put('barrel', '0O', 20.4, 10.3);
  // Basement workshop
  wall('workbench', '0N', 'E', 6.3, 0.7, { w: 2.0 });
  wall('shelves', '0N', 'S', 25.2, 0.45, { w: 2.0, metal: true });
  wall('shelves', '0N', 'N', 23.1, 0.45, { w: 1.4 });
  put('table', '0N', 24.8, 7.0, 'S', { w: 1.6, d: 0.8, wood: 'woodPlanks' });
  put('stool', '0N', 24.2, 7.9);
  put('crate', '0N', 22.6, 9.9);
  put('crate', '0N', 22.6, 9.0, 'S', { s: 0.55 });
  // Coal cellar
  wall('pipeValve', '0C', 'S', 33.7, 0.24);
  put('sheeted', '0C', 32.5, 3.0, 'S', { w: 2.2, d: 1.6, h: 0.7 });
  put('barrel', '0C', 34.3, 7.4);
  put('barrel', '0C', 33.6, 7.6);
  put('crate', '0C', 30.6, 1.6);
  put('boxes', '0C', 30.7, 7.5, 'E', { n: 3, mat: 'woodPlanks' });

  // ================================================================ GROUND FLOOR
  // Parlor
  wall('piano', '1R', 'N', 4.5, 0.6);
  wall('clock', '1R', 'E', 1.8, 0.38);
  wall('bookshelf', '1R', 'W', 7.0, 0.36, { w: 1.2 });
  put('rug', '1R', 4.6, 5.6, 'S', { w: 3.2, d: 2.4 });
  put('armchair', '1R', 3.3, 5.3, 'E', { mat: 'fabricRed' });
  put('armchair', '1R', 5.9, 5.3, 'W', { mat: 'fabricRed' });
  put('coffeeTable', '1R', 4.6, 5.4, 'S');
  put('rockingChair', '1R', 2.1, 2.2, 'S');
  put('lampTable', '1R', 7.9, 7.6);
  wall('curtains', '1R', 'W', 4.5, 0.6, { w: 1.3, hide: true });
  wall('painting', '1R', 'S', 7.0, 0.06, { w: 1.0, h: 0.75, kind: 'portrait' });
  wall('painting', '1R', 'W', 2.2, 0.06, { w: 0.7, h: 0.9, kind: 'hat' });
  // Kitchen
  wall('counter', '1K', 'N', 10.75, 0.64, { len: 3.1, sink: true });
  wall('stove', '1K', 'N', 12.7, 0.66);
  wall('counter', '1K', 'N', 14.3, 0.64, { len: 2.2 });
  wall('fridge', '1K', 'N', 16.35, 0.72);
  wall('counter', '1K', 'W', 6.6, 0.64, { len: 2.6, upper: true });
  put('island', '1K', 13.4, 5.2, 'S', { w: 2.0 });
  put('table', '1K', 11.3, 5.0, 'S', { w: 1.0, d: 0.8, cloth: true });
  put('chair', '1K', 11.3, 5.75, 'N', { seat: 'fabricGreen' });
  put('chair', '1K', 11.3, 4.25, 'S', { seat: 'fabricGreen' });
  wall('shelves', '1K', 'E', 4.3, 0.35, { w: 1.2, d: 0.35, h: 1.6, levels: 4 });
  // Pantry
  wall('shelves', '1P', 'N', 18.2, 0.42, { w: 1.9, d: 0.42 });
  wall('shelves', '1P', 'N', 20.6, 0.42, { w: 1.7, d: 0.42 });
  wall('shelves', '1P', 'S', 19.2, 0.42, { w: 2.0, d: 0.42 });
  put('barrel', '1P', 21.5, 3.5);
  // Laundry
  wall('washer', '1U', 'N', 17.5, 0.62);
  wall('washer', '1U', 'N', 18.2, 0.62);
  wall('counter', '1U', 'N', 19.7, 0.64, { len: 1.2, top: 'woodPlanks', wood: 'woodPainted' });
  wall('fusebox', '1U', 'E', 5.6, 0.22);
  wall('shelves', '1U', 'W', 7.9, 0.4, { w: 1.4, d: 0.4, h: 1.7 });
  put('boxes', '1U', 20.3, 8.4, 'S', { n: 2 });
  // Dining room
  put('rug', '1D', 25.5, 4.8, 'E', { w: 4.6, d: 3.0, mat: 'carpetRed' });
  put('table', '1D', 25.5, 4.8, 'E', { w: 3.0, d: 1.15, cloth: true });
  for (const dz of [-1.0, 0, 1.0]) {
    put('chair', '1D', 24.6, 4.8 + dz, 'E', { seat: 'fabricRed' });
    put('chair', '1D', 26.4, 4.8 + dz, 'W', { seat: 'fabricRed' });
  }
  put('chair', '1D', 25.5, 6.75, 'N', { seat: 'fabricRed' });
  put('chair', '1D', 25.5, 2.85, 'S', { seat: 'fabricRed', tipped: true });
  wall('displayCase', '1D', 'W', 3.0, 0.46, { w: 1.2 });
  wall('dresser', '1D', 'E', 5.5, 0.53, { w: 1.5, wood: 'woodFurnitureDark' });
  wall('painting', '1D', 'W', 6.5, 0.06, { w: 1.2, h: 0.9, kind: 'family' });
  wall('curtains', '1D', 'N', 24.5, 0.6, { w: 1.3, hide: true, mat: 'fabricGreen' });
  // Arthur's study
  put('desk', '1S', 32.5, 2.75, 'S', { w: 1.5 });
  put('chair', '1S', 32.5, 3.55, 'N', { seat: 'leather' });
  wall('bookshelf', '1S', 'N', 30.8, 0.36, { w: 1.2 });
  wall('bookshelf', '1S', 'N', 33.9, 0.36, { w: 1.4 });
  wall('bookshelf', '1S', 'W', 5.5, 0.36, { w: 1.2, gaps: [2] });
  wall('bookshelf', '1S', 'W', 6.9, 0.36, { w: 1.2 });
  put('armchair', '1S', 33.6, 6.8, 'W', { mat: 'leather' });
  put('lampTable', '1S', 33.9, 7.9);
  put('rug', '1S', 32.4, 5.6, 'S', { w: 2.6, d: 3.0, mat: 'carpetBlue' });
  wall('painting', '1S', 'E', 2.3, 0.06, { w: 0.8, h: 1.0, kind: 'arthur' });
  // Main hallway
  put('rug', '1h', 21.5, 10.0, 'E', { w: 22, d: 1.1, mat: 'carpetRed' });
  wall('bench', '1h', 'N', 15.0, 0.4, { w: 1.2 });
  wall('dresser', '1h', 'N', 28.0, 0.53, { w: 1.0, wood: 'woodFurnitureDark' });
  wall('painting', '1h', 'N', 19.5, 0.06, { w: 0.8, h: 1.0, kind: 'portrait' });
  wall('painting', '1h', 'S', 26.5, 0.06, { w: 1.1, h: 0.7, kind: 'landscape' });
  wall('painting', '1h', 'S', 33.0, 0.06, { w: 0.6, h: 0.8, kind: 'hat' });
  wall('plant', '1h', 'E', 9.5, 0.36);
  // Sunroom
  for (const [x, z] of [[1.6, 9.5], [1.6, 14.4], [7.6, 14.4], [5.5, 9.5]]) put('plant', '1N', x, z);
  put('plant', '1N', 3.2, 14.5, 'S', { dead: true });
  put('armchair', '1N', 4.2, 12.3, 'W', { mat: 'fabricBeige' });
  put('armchair', '1N', 5.8, 11.0, 'S', { mat: 'fabricBeige' });
  put('coffeeTable', '1N', 5.0, 12.4, 'E', { wood: 'woodPlanks' });
  put('rockingHorse', '1N', 6.8, 13.7, 'W');
  wall('curtains', '1N', 'W', 11.5, 0.6, { w: 1.9, hide: true, mat: 'fabricBeige' });
  // Washroom
  wall('toilet', '1W', 'S', 11.5, 0.62);
  wall('bathSink', '1W', 'W', 12.5, 0.46);
  wall('shelves', '1W', 'E', 12.8, 0.3, { w: 0.8, d: 0.3, h: 1.4, levels: 3 });
  // Foyer
  put('rug', '1F', 16.9, 20.2, 'S', { w: 3.4, d: 5.0, mat: 'carpetRed' });
  wall('dresser', '1F', 'W', 19.5, 0.53, { w: 1.2, mirror: false });
  wall('bench', '1F', 'E', 17.4, 0.4, { w: 1.4 });
  wall('plant', '1F', 'S', 15.3, 0.36);
  wall('plant', '1F', 'S', 18.7, 0.36);
  wall('clock', '1F', 'E', 23.9, 0.38);
  wall('painting', '1F', 'W', 16.0, 0.06, { w: 1.0, h: 1.3, kind: 'arthur' });
  wall('painting', '1F', 'E', 20.2, 0.06, { w: 1.0, h: 0.8, kind: 'landscape' });
  wall('coats', '1F', 'W', 24.0, 0.56, { w: 1.2 });
  // Living room
  wall('fireplace', '1L', 'E', 15.5, 0.6);
  put('sofa', '1L', 31.3, 15.5, 'E', { w: 2.2, mat: 'fabricRed', hideBehind: true });
  put('armchair', '1L', 33.0, 13.4, 'S', { mat: 'fabricRed' });
  put('armchair', '1L', 33.0, 17.6, 'N', { mat: 'fabricRed' });
  put('coffeeTable', '1L', 32.8, 15.5, 'E');
  put('rug', '1L', 32.3, 15.5, 'E', { w: 4.0, d: 3.0, mat: 'carpetBlue' });
  put('lampTable', '1L', 33.9, 12.0);
  put('sofa', '1L', 24.5, 15.2, 'N', { w: 2.2, mat: 'fabricGreen' });
  put('sheeted', '1L', 23.0, 12.5, 'S', { w: 1.3, d: 0.9, h: 1.1 });
  put('sheeted', '1L', 26.8, 12.3, 'S', { w: 0.9, d: 0.9, h: 1.6 });
  wall('bookshelf', '1L', 'S', 22.3, 0.36, { w: 1.2 });
  wall('displayCase', '1L', 'S', 28.0, 0.46, { w: 1.3 });
  put('piano', '1L', 23.2, 17.6, 'N');
  wall('curtains', '1L', 'E', 13.5, 0.6, { w: 1.3, hide: true });
  wall('painting', '1L', 'N', 25.5, 0.06, { w: 1.4, h: 0.9, kind: 'family' });
  // Mudroom
  wall('bench', '1M', 'N', 10.8, 0.4, { w: 1.4 });
  wall('hooks', '1M', 'S', 11.0, 0.1, { w: 2.6 });
  put('boxes', '1M', 9.6, 18.9, 'S', { n: 2 });
  // Garage
  put('car', '1G', 4.6, 20.0, 'S');
  wall('workbench', '1G', 'E', 22.2, 0.7, { w: 2.0 });
  wall('shelves', '1G', 'N', 2.4, 0.45, { w: 1.8, metal: true });
  wall('shelves', '1G', 'N', 6.9, 0.45, { w: 1.6, metal: true });
  put('barrel', '1G', 1.6, 23.9);
  put('boxes', '1G', 1.9, 17.4, 'E', { n: 3 });
  put('crate', '1G', 7.6, 16.4);
  // Cloakroom
  wall('coats', '1C', 'W', 22.3, 0.56, { w: 2.4 });
  put('boxes', '1C', 12.2, 24.3, 'S', { n: 2 });
  put('clothesPile', '1C', 11.6, 20.8);
  // Den
  wall('tv', '1Y', 'S', 24.5, 0.8);
  put('sofa', '1Y', 24.5, 21.0, 'S', { w: 2.0, mat: 'fabricBeige' });
  put('coffeeTable', '1Y', 24.5, 22.3, 'S');
  put('armchair', '1Y', 26.8, 22.0, 'W', { mat: 'leather' });
  put('lampTable', '1Y', 21.6, 19.6);
  wall('bookshelf', '1Y', 'W', 24.0, 0.36, { w: 1.2 });
  put('rug', '1Y', 24.5, 22.0, 'S', { w: 3.0, d: 2.4 });
  // Trophy room
  put('billiards', '1T', 31.2, 22.0, 'S');
  wall('displayCase', '1T', 'N', 29.4, 0.46, { w: 1.2 });
  wall('displayCase', '1T', 'N', 33.6, 0.46, { w: 1.2 });
  put('armchair', '1T', 34.0, 24.2, 'N', { mat: 'leather' });
  wall('painting', '1T', 'W', 22.0, 0.06, { w: 1.1, h: 0.8, kind: 'hat' });

  // ================================================================ UPPER FLOOR
  // Ellie's room
  wall('bed', '2e', 'N', 13.0, 1.88, { size: 'child', hideSide: -1 });
  wall('nightstand', '2e', 'N', 14.35, 0.43);
  wall('wardrobe', '2e', 'E', 4.3, 0.68, { wood: 'woodPainted', clothes: 'fabricPink' });
  wall('dollhouse', '2e', 'W', 4.0, 0.48);
  put('rockingHorse', '2e', 12.2, 6.4, 'W');
  put('table', '2e', 13.8, 6.9, 'S', { w: 0.8, d: 0.8, h: 0.5, wood: 'woodPainted' });
  put('teddy', '2e', 13.2, 6.9, 'E', { y: 0.0 });
  put('toys', '2e', 11.5, 4.8, 'S', { n: 8 });
  put('rug', '2e', 12.6, 4.8, 'S', { w: 2.4, d: 2.0, mat: 'carpetPink' });
  wall('chest', '2e', 'S', 14.7, 0.56, { w: 0.9, mat: 'woodPainted' });
  // Bathroom
  wall('bathtub', '2B', 'N', 17.45, 0.8);
  wall('toilet', '2B', 'W', 4.4, 0.62);
  wall('bathSink', '2B', 'E', 5.6, 0.46);
  wall('shelves', '2B', 'W', 6.6, 0.3, { w: 0.8, d: 0.3, h: 1.5, levels: 3 });
  // Guest bedroom (you wake up here)
  wall('bed', '2g', 'W', 3.2, 2.18, { size: 'double', blanket: 'fabricBlue', hideSide: -1 });
  wall('nightstand', '2g', 'W', 4.65, 0.43);
  wall('wardrobe', '2g', 'E', 3.0, 0.68);
  wall('dresser', '2g', 'S', 20.1, 0.53, { w: 1.1, mirror: true });
  put('chair', '2g', 22.9, 6.8, 'W');
  put('rug', '2g', 21.8, 5.6, 'S', { w: 2.0, d: 1.4, mat: 'carpetBlue' });
  // Master bedroom
  wall('bed', '2M', 'N', 28.0, 2.18, { size: 'double', blanket: 'fabricRed' });
  wall('nightstand', '2M', 'N', 26.4, 0.43);
  wall('nightstand', '2M', 'N', 29.6, 0.43);
  wall('wardrobe', '2M', 'W', 4.2, 0.68);
  wall('wardrobe', '2M', 'W', 5.5, 0.68, { hide: false });
  wall('dresser', '2M', 'S', 29.6, 0.53, { w: 1.4, mirror: true });
  put('armchair', '2M', 25.2, 7.7, 'E', { mat: 'fabricRed' });
  wall('chest', '2M', 'N', 28.0, 0.56, { gap: 2.25, w: 1.2, mat: 'woodFurnitureDark' });
  put('rug', '2M', 28.0, 5.2, 'S', { w: 3.0, d: 2.2, mat: 'carpetRed' });
  wall('painting', '2M', 'E', 7.5, 0.06, { w: 0.8, h: 1.0, kind: 'portrait' });
  // Master bath
  wall('bathtub', '2E', 'S', 33.5, 0.8);
  wall('bathSink', '2E', 'W', 3.6, 0.46);
  wall('toilet', '2E', 'N', 32.5, 0.62);
  // Walk-in closet
  wall('coats', '2c', 'E', 7.0, 0.56, { w: 2.2 });
  put('boxes', '2c', 32.5, 8.5, 'S', { n: 2 });
  // Upper hallway
  put('rug', '2u', 21.5, 10.0, 'E', { w: 22, d: 1.0, mat: 'carpetRed' });
  wall('dresser', '2u', 'N', 14.4, 0.53, { w: 1.0, wood: 'woodFurnitureDark' });
  put('chair', '2u', 25.6, 9.4, 'S', { tipped: true });
  wall('painting', '2u', 'N', 19.6, 0.06, { w: 0.8, h: 1.0, kind: 'ellie' });
  wall('painting', '2u', 'S', 27.0, 0.06, { w: 0.9, h: 0.7, kind: 'portrait' });
  wall('painting', '2u', 'N', 31.8, 0.06, { w: 0.6, h: 0.8, kind: 'hat' });
  // Sewing room
  wall('bed', '2k', 'W', 14.95, 2.18, { size: 'single', blanket: 'fabricGreen' });
  wall('sewingMachine', '2k', 'N', 13.0, 0.55);
  put('chair', '2k', 13.0, 12.3, 'N', { seat: 'fabricBeige' });
  wall('wardrobe', '2k', 'E', 13.5, 0.68);
  put('mannequin', '2k', 12.4, 16.8, 'N', { head: false });
  put('mannequin', '2k', 13.7, 17.6, 'W', { head: true, mat: 'fabricRed' });
  put('mannequin', '2k', 11.2, 17.9, 'N', { head: false, mat: 'sheet' });
  wall('shelves', '2k', 'E', 16.6, 0.4, { w: 1.5, d: 0.4, h: 1.8 });
  // Landing
  put('armchair', '2l', 16.3, 17.8, 'N', { mat: 'fabricGreen' });
  put('armchair', '2l', 19.2, 17.8, 'N', { mat: 'fabricGreen' });
  put('lampTable', '2l', 15.55, 18.4);
  put('coffeeTable', '2l', 17.75, 17.2, 'S');
  wall('bookshelf', '2l', 'W', 16.4, 0.36, { w: 1.1 });
  put('rug', '2l', 17.8, 17.5, 'S', { w: 3.4, d: 1.8, mat: 'carpetBlue' });
  // Library
  for (const x of [21.7, 22.95, 25.7, 26.95]) wall('bookshelf', '2r', 'N', x, 0.36, { w: 1.2 });
  for (const z of [12.2, 13.45, 14.7]) wall('bookshelf', '2r', 'W', z, 0.36, { w: 1.2, gaps: z === 13.45 ? [1] : [] });
  wall('bookshelf', '2r', 'E', 12.3, 0.36, { w: 1.2 });
  wall('bookshelf', '2r', 'E', 16.5, 0.36, { w: 1.2 });
  put('table', '2r', 24.2, 14.6, 'S', { w: 1.8, d: 1.0 });
  put('chair', '2r', 23.6, 15.45, 'N');
  put('chair', '2r', 24.8, 13.75, 'S');
  wall('desk', '2r', 'S', 26.95, 0.7, { w: 1.4 });
  put('chair', '2r', 26.95, 17.6, 'S', { seat: 'leather' });
  put('armchair', '2r', 22.0, 17.6, 'N', { mat: 'leather' });
  put('rug', '2r', 24.2, 14.6, 'S', { w: 3.0, d: 2.4, mat: 'carpetRed' });
  // Toymaker's workshop
  wall('workbench', '2w', 'E', 14.95, 0.7, { w: 2.0, dolls: true });
  wall('workbench', '2w', 'N', 29.5, 0.7, { w: 2.0 });
  wall('shelves', '2w', 'S', 33.3, 0.45, { w: 2.0 });
  put('table', '2w', 31.0, 15.4, 'S', { w: 1.8, d: 1.0, wood: 'woodPlanks' });
  put('mannequin', '2w', 29.2, 17.4, 'E', { head: true, mat: 'fur' });
  put('mannequin', '2w', 28.8, 15.8, 'E', { head: false, mat: 'fabricRed' });
  put('stool', '2w', 31.0, 14.4);
  put('boxes', '2w', 34.2, 17.8, 'W', { n: 3 });

  // ================================================================ ATTIC
  // Ellie's playroom
  wall('altar', '3R', 'E', 2.5, 1.88);
  put('table', '3R', 11.5, 6.0, 'S', { w: 0.9, d: 0.9, h: 0.5, wood: 'woodPainted', cloth: true });
  for (const [dx, dz, face] of [[-0.7, 0, 'E'], [0.7, 0, 'W'], [0, 0.7, 'N'], [0, -0.7, 'S']]) {
    put('teddy', '3R', 11.5 + dx, 6.0 + dz, face, { mat: dz > 0 ? 'fur' : 'fabricBeige' });
  }
  wall('chest', '3R', 'S', 12.3, 0.56, { w: 1.1, hide: true });
  put('rockingHorse', '3R', 13.6, 8.2, 'W');
  put('armchair', '3R', 11.6, 3.1, 'E', { mat: 'fabricRed' });
  put('toys', '3R', 12.5, 8.8, 'S', { n: 10 });
  put('rug', '3R', 12.0, 6.0, 'S', { w: 3.0, d: 3.0, mat: 'carpetPink' });
  // Attic main - clutter with lanes
  for (const [x, z, w, d, h] of [[16.5, 2.2, 1.6, 0.9, 1.0], [19.3, 8.7, 1.2, 1.2, 1.4], [23.8, 2.3, 2.0, 1.0, 0.9], [27.5, 8.6, 1.4, 0.8, 1.7], [21.6, 6.2, 1.0, 1.0, 1.1]]) {
    put('sheeted', '3A', x, z, 'S', { w, d, h });
  }
  put('boxes', '3A', 17.3, 5.6, 'S', { n: 4 });
  put('boxes', '3A', 25.4, 5.4, 'S', { n: 5 });
  put('boxes', '3A', 29.2, 2.1, 'S', { n: 3 });
  put('chest', '3A', 26.2, 1.6, 'S', { hide: true, mat: 'woodFurnitureDark' });
  put('mannequin', '3A', 20.3, 2.2, 'S', { head: true });
  put('mannequin', '3A', 22.9, 9.4, 'N', { head: false, mat: 'fabricRed' });
  put('mannequin', '3A', 28.8, 5.2, 'W', { head: true, mat: 'fur' });
  put('wardrobe', '3A', 15.6, 8.8, 'E', { wood: 'woodFurniture' });
  put('rockingChair', '3A', 24.2, 7.6, 'W');
  put('crate', '3A', 18.4, 3.6);
  // Attic storage
  wall('shelves', '3T', 'N', 31.3, 0.45, { w: 2.0 });
  wall('wardrobe', '3T', 'W', 3.2, 0.68);
  put('boxes', '3T', 32.8, 9.2, 'S', { n: 4 });
  put('boxes', '3T', 30.8, 9.6, 'S', { n: 3 });
  put('sheeted', '3T', 32.4, 6.8, 'S', { w: 1.2, d: 1.8, h: 0.6 });
}

// ------------------------------------------------------------------ headless
/**
 * Run the furnishing into a mock world (no GPU, no textures). Used by the
 * plan renderer and by tests to validate colliders and hiding spots.
 */
export function mockWorld(grid) {
  const mats = { static: () => new THREE.MeshBasicMaterial(), dynamic: () => new THREE.MeshBasicMaterial(), custom: () => new THREE.MeshBasicMaterial() };
  const world = {
    grid,
    materials: mats,
    staticGeo: new GeoBuilder(mats),
    collision: new CollisionWorld(grid.W, grid.D),
    furnitureColliders: [], itemSlots: [], hidingSpots: [], interactables: [],
    tvs: [], mirrors: [], paintings: [], fireplaces: [], soundSources: [], rockingChairs: [], animators: [],
    decorRng: new RNG(1234),
    addDynamicObject() {},
    scene: { add() {} },
  };
  return world;
}

export function planFurniture(grid) {
  const world = mockWorld(grid);
  furnish(world);
  const out = world.furnitureColliders.map((c) => ({ f: c.f, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1 }));
  for (const h of world.hidingSpots) out.push({ f: h.f, x0: h.entry.x - 0.1, x1: h.entry.x + 0.1, z0: h.entry.z - 0.1, z1: h.entry.z + 0.1, hide: true, label: h.type[0] });
  return out;
}
