// What the cat learns about you during a run. Everything here is pure data
// so the AI's adaptive choices can be unit tested.

export class PlayerModel {
  constructor(learnRate = 1) {
    this.learnRate = learnRate;
    this.roomTime = new Map();       // room index -> seconds
    this.spotUses = new Map();       // hiding spot id -> count
    this.seenEntering = new Set();   // hiding spot ids the cat watched you use
    this.fooled = [];                // times distractions led nowhere
    this.distractionsHeard = 0;
    this.transitions = new Map();    // "a>b" room transitions -> count
    this.escapeDoors = new Map();    // door id -> times used to break a chase
    this.locks = 0;                  // doors locked / barricaded by the player
    this.lightTime = 0;              // seconds with the flashlight on
    this.totalTime = 0;
    this.lastRoom = -1;
    this.caughtHiding = 0;
  }

  // ---------------------------------------------------------------- recording
  tick(dt, playerRoom, flashlightOn) {
    this.totalTime += dt;
    if (flashlightOn) this.lightTime += dt;
    if (playerRoom >= 0) {
      this.roomTime.set(playerRoom, (this.roomTime.get(playerRoom) || 0) + dt);
      if (this.lastRoom >= 0 && this.lastRoom !== playerRoom) {
        const k = this.lastRoom + '>' + playerRoom;
        this.transitions.set(k, (this.transitions.get(k) || 0) + 1);
      }
      this.lastRoom = playerRoom;
    }
  }

  recordHide(spotId, seen) {
    this.spotUses.set(spotId, (this.spotUses.get(spotId) || 0) + 1);
    if (seen) this.seenEntering.add(spotId);
  }

  recordFooled(time) { this.fooled.push(time); }
  recordDistraction() { this.distractionsHeard++; }
  recordLock() { this.locks++; }
  recordEscapeDoor(id) { this.escapeDoors.set(id, (this.escapeDoors.get(id) || 0) + 1); }

  // ---------------------------------------------------------------- queries
  /** Probability that the cat checks a given hiding spot while searching. */
  checkChance(spot, diff, context = {}) {
    if (this.seenEntering.has(spot.id) || context.saw) return Math.min(1, diff.checkSeenEntering);
    const uses = this.spotUses.get(spot.id) || 0;
    let p = diff.checkBase + uses * diff.checkPerUse * this.learnRate;
    if (context.heardNoise) p += 0.35;            // breathing, gasping, a thump
    if (context.lastSeenNear) p += 0.2;           // you vanished right here
    if (spot.concealment < 0.8) p += 0.15;        // poor hiding places
    // the same *type* of hiding place gets checked more once it's been a habit
    const sameType = [...this.spotUses.keys()].filter((id) => id.endsWith(':' + spot.type)).reduce((s, id) => s + this.spotUses.get(id), 0);
    p += Math.min(0.25, sameType * 0.04 * this.learnRate);
    return Math.max(0, Math.min(0.98, p));
  }

  /** How suspicious the cat is of a new distraction (0 = falls for it). */
  distractionSuspicion(now, diff) {
    const recent = this.fooled.filter((t) => now - t < 180).length;
    const tol = diff.distractionTolerance;
    if (recent < tol) return recent / (tol + 1) * 0.35;
    return Math.min(1, 0.6 + (recent - tol) * 0.2 * this.learnRate);
  }

  /** Weight for patrolling a room (your favourite rooms get visited more). */
  roomWeight(roomIndex) {
    const t = this.roomTime.get(roomIndex) || 0;
    const total = Math.max(1, this.totalTime);
    return 1 + (t / total) * 6 * this.learnRate;
  }

  /** Most used room transitions out of a room, as [{to, count}]. */
  likelyNextRooms(fromRoom) {
    const out = [];
    for (const [k, v] of this.transitions) {
      const [a, b] = k.split('>').map(Number);
      if (a === fromRoom) out.push({ to: b, count: v });
    }
    return out.sort((x, y) => y.count - x.count);
  }

  /** Top rooms by time spent (for ambushes). */
  favouriteRooms(n = 3) {
    return [...this.roomTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([r]) => r);
  }

  /** 0..1: how much the player relies on the flashlight. */
  lightReliance() {
    return this.totalTime > 30 ? this.lightTime / this.totalTime : 0.5;
  }

  /** Does the player keep locking doors? Then prefer vents / break them. */
  lockHabit() { return Math.min(1, this.locks / 4); }
}
