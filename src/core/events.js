// Tiny synchronous event bus used to decouple systems (noise -> cat,
// pickups -> objectives, doors -> audio, etc.).
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) { const s = this.handlers.get(type); if (s) s.delete(fn); }
  emit(type, payload) {
    const s = this.handlers.get(type);
    if (!s) return;
    for (const fn of [...s]) fn(payload);
  }
  clear() { this.handlers.clear(); }
}
