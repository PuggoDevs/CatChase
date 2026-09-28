import { describe, it, expect } from 'vitest';
import { PlayerModel } from '../src/cat/learning.js';
import { DIFFICULTIES } from '../src/config.js';

const spot = (id, type = 'closet', concealment = 0.9) => ({ id, type, concealment });

describe('PlayerModel: hiding spots', () => {
  const d = DIFFICULTIES.normal;

  it('checks a fresh spot at the base rate', () => {
    const m = new PlayerModel(d.learnRate);
    expect(m.checkChance(spot('a:closet'), d)).toBeCloseTo(d.checkBase);
  });

  it('checks a spot more often every time you reuse it', () => {
    const m = new PlayerModel(d.learnRate);
    const s = spot('a:closet');
    const before = m.checkChance(s, d);
    m.recordHide(s.id, false);
    const once = m.checkChance(s, d);
    m.recordHide(s.id, false);
    m.recordHide(s.id, false);
    const thrice = m.checkChance(s, d);
    expect(once).toBeGreaterThan(before);
    expect(thrice).toBeGreaterThan(once);
    expect(thrice).toBeLessThanOrEqual(0.98);
  });

  it('grows wary of a whole type of hiding place, not just one spot', () => {
    const m = new PlayerModel(d.learnRate);
    for (let i = 0; i < 4; i++) m.recordHide('w' + i + ':wardrobe', false);
    expect(m.checkChance(spot('new:wardrobe', 'wardrobe'), d)).toBeGreaterThan(m.checkChance(spot('new:bed', 'bed'), d));
  });

  it('goes straight for a spot it watched you enter', () => {
    const m = new PlayerModel(d.learnRate);
    m.recordHide('a:closet', true);
    expect(m.checkChance(spot('a:closet'), d)).toBe(d.checkSeenEntering);
    expect(m.checkChance(spot('b:closet'), d, { saw: true })).toBe(d.checkSeenEntering);
  });

  it('adds suspicion for noise, a nearby sighting and poor concealment', () => {
    const m = new PlayerModel(d.learnRate);
    const s = spot('a:closet');
    const base = m.checkChance(s, d);
    expect(m.checkChance(s, d, { heardNoise: true })).toBeGreaterThan(base);
    expect(m.checkChance(s, d, { lastSeenNear: true })).toBeGreaterThan(base);
    expect(m.checkChance(spot('a:closet', 'closet', 0.5), d)).toBeGreaterThan(base);
  });

  it('never makes hiding certain death unless it saw you', () => {
    for (const diff of Object.values(DIFFICULTIES)) {
      const m = new PlayerModel(diff.learnRate);
      for (let i = 0; i < 30; i++) m.recordHide('a:closet', false);
      expect(m.checkChance(spot('a:closet', 'closet', 0.5), diff, { heardNoise: true, lastSeenNear: true })).toBeLessThanOrEqual(0.98);
    }
  });

  it('learns faster on harder difficulties', () => {
    const easy = new PlayerModel(DIFFICULTIES.easy.learnRate);
    const nm = new PlayerModel(DIFFICULTIES.nightmare.learnRate);
    for (const m of [easy, nm]) for (let i = 0; i < 2; i++) m.recordHide('a:closet', false);
    expect(nm.checkChance(spot('a:closet'), DIFFICULTIES.nightmare)).toBeGreaterThan(easy.checkChance(spot('a:closet'), DIFFICULTIES.easy));
  });
});

describe('PlayerModel: distractions', () => {
  it('falls for the first throw', () => {
    for (const diff of Object.values(DIFFICULTIES)) {
      expect(new PlayerModel(diff.learnRate).distractionSuspicion(0, diff)).toBe(0);
    }
  });

  it('gets more suspicious each time it is fooled, and stops falling for it', () => {
    const d = DIFFICULTIES.normal;
    const m = new PlayerModel(d.learnRate);
    let last = m.distractionSuspicion(10, d);
    for (let i = 0; i < d.distractionTolerance; i++) {
      m.recordFooled(10 + i);
      const s = m.distractionSuspicion(20, d);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
    expect(last).toBeGreaterThanOrEqual(0.6);
    for (let i = 0; i < 4; i++) m.recordFooled(20);
    expect(m.distractionSuspicion(21, d)).toBe(1);
  });

  it('forgets old tricks after a few minutes', () => {
    const d = DIFFICULTIES.normal;
    const m = new PlayerModel(d.learnRate);
    for (let i = 0; i < 5; i++) m.recordFooled(i);
    expect(m.distractionSuspicion(10, d)).toBeGreaterThan(0.5);
    expect(m.distractionSuspicion(400, d)).toBe(0);
  });

  it('sees through throws sooner on harder difficulties', () => {
    const suspicionAfter = (diff, n) => {
      const m = new PlayerModel(diff.learnRate);
      for (let i = 0; i < n; i++) m.recordFooled(i);
      return m.distractionSuspicion(n, diff);
    };
    expect(suspicionAfter(DIFFICULTIES.nightmare, 1)).toBeGreaterThan(suspicionAfter(DIFFICULTIES.easy, 1));
    expect(suspicionAfter(DIFFICULTIES.hard, 2)).toBeGreaterThan(suspicionAfter(DIFFICULTIES.normal, 2));
  });
});

describe('PlayerModel: habits', () => {
  it('weights the rooms you spend time in', () => {
    const m = new PlayerModel(1);
    m.tick(50, 3, false);
    m.tick(5, 7, false);
    expect(m.roomWeight(3)).toBeGreaterThan(m.roomWeight(7));
    expect(m.roomWeight(99)).toBe(1);
    expect(m.favouriteRooms(1)).toEqual([3]);
  });

  it('remembers the routes you take', () => {
    const m = new PlayerModel(1);
    const path = [1, 2, 1, 2, 1, 4];
    for (const r of path) m.tick(1, r, false);
    const next = m.likelyNextRooms(1);
    expect(next[0]).toEqual({ to: 2, count: 2 });
    expect(next[1]).toEqual({ to: 4, count: 1 });
    expect(m.likelyNextRooms(9)).toEqual([]);
  });

  it('notices a player who keeps locking doors', () => {
    const m = new PlayerModel(1);
    expect(m.lockHabit()).toBe(0);
    m.recordLock(); m.recordLock();
    expect(m.lockHabit()).toBe(0.5);
    for (let i = 0; i < 10; i++) m.recordLock();
    expect(m.lockHabit()).toBe(1);
  });

  it('tracks flashlight reliance once it has seen enough', () => {
    const m = new PlayerModel(1);
    m.tick(10, 0, true);
    expect(m.lightReliance()).toBe(0.5);
    m.tick(30, 0, false);
    expect(m.lightReliance()).toBeCloseTo(10 / 40);
  });
});
