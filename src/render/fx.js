// Short-lived visual effects: static bursts, flashes, glass shards.
import * as THREE from 'three';

export class FX {
  constructor(game) {
    this.game = game;
    this.staticAmt = 0;
    this.shardsList = [];
    this.shardGeo = new THREE.BoxGeometry(0.03, 0.005, 0.02);
  }

  static(amount = 0.6) { this.staticAmt = Math.max(this.staticAmt, amount); }

  shards(pos, color) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.1, metalness: 0.2 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.shardGeo, mat);
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      this.game.scene.add(m);
      this.shardsList.push({ m, v, t: 0, spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0), floor: this.game.world.grid.groundY(this.game.player.floor, pos.x, pos.z) });
    }
  }

  update(dt) {
    const u = this.game.post.u;
    this.staticAmt = Math.max(0, this.staticAmt - dt * 1.8);
    u.uStatic.value = Math.max(this.staticAmt, this.game.presenceStatic || 0);
    for (const s of [...this.shardsList]) {
      s.t += dt;
      s.v.y -= 9.8 * dt;
      s.m.position.addScaledVector(s.v, dt);
      if (s.m.position.y < s.floor + 0.01) { s.m.position.y = s.floor + 0.01; s.v.multiplyScalar(0.3); s.v.y = 0; }
      else { s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; }
      if (s.t > 25) {
        this.game.scene.remove(s.m);
        this.shardsList.splice(this.shardsList.indexOf(s), 1);
      }
    }
  }

  clear() {
    for (const s of this.shardsList) this.game.scene.remove(s.m);
    this.shardsList = [];
    this.staticAmt = 0;
  }
}
