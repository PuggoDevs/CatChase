// Environmental storytelling: notes, journal pages, crayon drawings,
// photographs, writing on the walls, blood and claw marks - and a house
// that quietly changes behind your back.
import * as THREE from 'three';
import { drawingTexture, photoTexture, paperTexture, decalTexture } from '../world/art.js';
import { setObjectRoom } from '../world/roomLighting.js';
import { floorBaseY, WALL_T, EXT_WALL_T } from '../world/layout.js';

// ------------------------------------------------------------------ texts
export const DOCUMENTS = [
  {
    id: 'wake', title: 'A note on the nightstand', style: 'paper', rooms: ['2g'], near: 'start',
    text: `If you are reading this, it already knows you are here.

It likes games. Hide and seek, mostly. It will not stop until the game is over.

Don't let it see you. Don't let it hear you. Walk, don't run. Close doors slowly.

Don't hide in the same place twice - it remembers.

There are ways out of this house. I found one too late.

- R.V.`,
  },
  {
    id: 'arthur1', title: 'Journal of A. Whitlock - I', style: 'journal', rooms: ['1S'],
    text: `March 3rd, 1962.

Ellie's fever has come back. Dr. Hale says rest, only rest. She is so tired of resting.

Tonight she asked me for a friend who would never get tired of playing with her.

I have begun a new toy. A cat, as tall as I am, in a striped hat I sewed from her mother's old summer dresses, and a bow tie like the one I wore at our wedding. She laughed when I showed her the drawings. I had forgotten the sound.`,
  },
  {
    id: 'arthur2', title: 'Journal of A. Whitlock - II', style: 'journal', rooms: ['2w'],
    text: `May 19th, 1962.

He is finished. Ellie named him Mister Grin, because of the smile.

I made the smile too wide. She says that is so he can smile at her even from across the room.

The peddler at the county fair sold me the old book for a dollar. "A heart for your toy," he said, "so it never leaves her side." I did not believe him. I bought it anyway. A father will buy anything.`,
  },
  {
    id: 'arthur3', title: 'Journal of A. Whitlock - III', style: 'journal', rooms: ['2M', '2r'],
    text: `August 2nd, 1962.

I did what the book said. I stitched the heart in myself: lavender, a lock of her hair, and the little brass key from her music box, so he would always know her song.

In the morning he was sitting at the foot of her bed.

I did not put him there.`,
  },
  {
    id: 'arthur4', title: 'Journal of A. Whitlock - IV', style: 'journal', rooms: ['2r', '1S', '2M'],
    text: `October 30th, 1962.

They play hide and seek every night. Ellie is better. She laughs again.

He never gets tired. He never sleeps. At night I hear him walking the halls, opening wardrobes, looking under beds - even when she is asleep in her room.

Sometimes he looks at me the same way he looks at the wardrobes.`,
  },
  {
    id: 'arthur5', title: 'Journal of A. Whitlock - V', style: 'journal', rooms: ['3T', '3A', '3R'],
    text: `February 11th, 1964.

Ellie is gone. The fever took her in her sleep, the way Dr. Hale said it would.

He does not understand. He has searched the house every night for a week. Every cupboard. Every bed. He thinks she is hiding. He thinks the game is still going.

God help anyone who comes into this house. He will think they are playing too.`,
  },
  {
    id: 'truth', title: 'The last page', style: 'journal', rooms: ['0J', '1X', '0C'], truth: true,
    text: `If you have found this, then I could not end it.

The book says a heart made for someone can only rest when it hears that someone is at peace.

Her music box. The little winding key. Her red ribbon. Take them to her bed in the playroom and let him hear her song, and he will remember that she is gone. He will sit down. He will be what he was: only a toy.

I hid the pieces around the house where he would not think to look.

I could not do it myself. I could not bear to lose them both.

- A.W.

(Ellie's playroom has a tiny door she used to hide behind. It leads outside.)`,
  },
  {
    id: 'ellie1', title: 'A crayon note', style: 'crayon', rooms: ['2e'],
    text: `MISTER GRIN IS MY BEST FRIEND

HE ALWAYS FINDS ME

I HIDE IN THE WARDROBE AND HE FINDS ME
I HIDE UNDER THE BED AND HE FINDS ME
I HIDE IN THE BATH AND HE FINDS ME

HE IS THE BEST AT HIDE AND SEEK`,
  },
  {
    id: 'ellie2', title: 'A folded crayon note', style: 'crayon', rooms: ['2e', '2k'],
    text: `MY SECRET PLACE

behind the wallpaper by my bed there is a little door
and stairs all the way up to the attic

DADDY DOESNT KNOW
DONT TELL MISTER GRIN`,
  },
  {
    id: 'ellie3', title: 'Crayon on the back of a drawing', style: 'crayon', rooms: ['3R', '2e'],
    text: `mister grin doesnt like my music box

when i play it he sits down very still
and listens
and his eyes go sleepy

and he doesnt want to play anymore`,
  },
  {
    id: 'grady', title: 'Police notebook - Ofc. T. Grady, 1971', style: 'paper', rooms: ['0Q', '1G', '1M', '1h'], route: 'front',
    text: `Whitlock residence. Missing persons follow-up.

Front door chained from the INSIDE. Padlock and chain. Who chains a door from the inside of an empty house?

The lock itself takes a big brass key. The chain will need bolt cutters.

Something moving upstairs. Not a person. Going to check

`,
  },
  {
    id: 'voss', title: 'Realtor\'s notepad - R. Voss, 1987', style: 'paper', rooms: ['1K', '1D', '1U', '1L'], route: 'car',
    text: `WHITLOCK HOUSE - "as is"

- Old sedan in the garage. It would still run: needs a CAR BATTERY and GAS. Keys somewhere in the house.
- The garage door is electric. No POWER, no door.
- Fuse box is in the laundry room. The lights go out a lot. Spare fuses in the basement?

Note to self: do NOT show this one at night.`,
  },
  {
    id: 'danny', title: 'Torn page from a spiral notebook, 1996', style: 'paper', rooms: ['3A', '3T', '2u'], route: 'attic',
    text: `ok this was a stupid dare

the attic window is boarded but a CROWBAR would get the boards off. its a long way down, need ROPE.

i hear it on the stairs. it doesnt sound like walking. it sounds like crawling

IF ANYONE FINDS THIS
it climbs on the ceiling
LOOK UP`,
  },
  {
    id: 'walter', title: 'Work order - Pike Plumbing, 2003', style: 'paper', rooms: ['0N', '0O', '0C'], route: 'tunnel',
    text: `Job: basement flooding, Whitlock place.

Coal cellar grate opens onto the old storm tunnel - that's where the water comes in. Tunnel runs out under the yard to the street.

To get through: DRAIN it with the valve by the grate (valve wheel's gone missing - who takes a valve wheel?) and UNBOLT the grate with a big PIPE WRENCH.

Customer never showed. Van's still out front. Hearing scratching in the ducts.`,
  },
  {
    id: 'survive', title: 'Scrawled on a paper bag', style: 'blood', rooms: ['1P', '1C', '2B', '1W', '0V'],
    text: `IT HEARS EVERYTHING.
Crouch. Walk. Hold E to open doors slow.
If it chases you: break its line of sight, THEN hide.
Barricade doors. It gets through eventually.

Don't throw things too often. It learned.
The third time, it came straight for ME instead of the noise.`,
  },
  {
    id: 'dark', title: 'A note wedged in a door frame', style: 'paper', rooms: ['0O', '1U', '1G', '0Q'],
    text: `It's worse in the dark.

When the lights go out it goes wild - faster, hungrier, it hears you breathing.

The fuse box is in the laundry room. Sometimes a fuse is blown and you need a spare.

It likes to cut the power.`,
  },
];

const WALL_WRITING = ['COME OUT COME OUT', 'HE CHECKS THE WARDROBES', 'IT LEARNS', "WE'RE STILL PLAYING", 'NOT UNDER THE BED', 'FOUND YOU', 'LOOK UP', 'DONT HIDE TWICE', 'SHE IS HIDING', 'ELLIE?'];

export class Story {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.objects = [];
    this.read = this.read.bind(this);
    this.readSet = new Set();
    this.open = null;
  }

  clear() {
    for (const o of this.objects) o.removeFromParent();
    this.objects = [];
    this.world.interactables = this.world.interactables.filter((i) => i.kind !== 'note');
    this.readSet = new Set();
    this.docs = [];
    this.changes = 0;
    this.changeT = 60;
  }

  // ---------------------------------------------------------------- setup
  populate(run) {
    this.clear();
    const rng = run.rng.fork('story');
    const g = this.world.grid;
    const usedSlots = new Set();
    const slotsIn = (key) => this.world.itemSlots.filter((s) => g.rooms[s.room].key === key && !usedSlots.has(s) && s.surface !== 'top');
    for (const doc of DOCUMENTS) {
      if (run.mode === 'endless' && (doc.route || doc.truth)) continue;
      let slot = null;
      if (doc.near === 'start') {
        const cands = slotsIn('2g').sort((a, b) => Math.hypot(a.x - run.start.x, a.z - run.start.z) - Math.hypot(b.x - run.start.x, b.z - run.start.z));
        slot = cands[1] || cands[0];
      } else {
        const rooms = rng.shuffle([...doc.rooms]);
        for (const key of rooms) {
          const c = slotsIn(key);
          if (c.length) { slot = rng.pick(c); break; }
        }
      }
      if (!slot) continue;
      usedSlots.add(slot);
      this._placeNote(doc, slot, rng);
    }
    this._decorate(rng, run);
  }

  _placeNote(doc, slot, rng) {
    const room = this.world.grid.rooms[slot.room];
    const tex = paperTexture(rng.int(0, 1e6), doc.style === 'crayon' ? 'crayon' : doc.style === 'journal' ? 'journal' : 'paper');
    const mat = this.world.materials.custom({ map: tex, roughness: 0.9 }, 'note');
    setObjectRoom(mat, room.lightSlot);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.25), mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rng.float(-0.6, 0.6);
    m.position.set(slot.x, slot.y + 0.004, slot.z);
    m.receiveShadow = true;
    this.world.addDynamicObject(m, room.floor);
    this.objects.push(m);
    const it = { kind: 'note', id: 'note_' + doc.id, f: room.floor, room: room.index, pos: new THREE.Vector3(slot.x, slot.y + 0.02, slot.z), radius: 0.35, prompt: doc.title, doc, mesh: m };
    this.world.interactables.push(it);
  }

  /** A spot on an interior wall of a room: {pos, normal, yaw}. */
  wallSpot(room, rng, h = 1.5) {
    const g = this.world.grid;
    const faces = [];
    for (const e of g.edges.values()) {
      if (e.f !== room.floor || e.type !== 'wall') continue;
      for (const which of [1, 2]) {
        const r = which === 1 ? e.r1 : e.r2;
        if (r !== room.index) continue;
        const t = (e.exterior ? EXT_WALL_T : WALL_T) / 2 + 0.012;
        const dir = which === 1 ? -1 : 1;
        const pos = e.orient === 'V' ? new THREE.Vector3(e.a + dir * t, 0, e.b + 0.5) : new THREE.Vector3(e.a + 0.5, 0, e.b + dir * t);
        const normal = e.orient === 'V' ? new THREE.Vector3(dir, 0, 0) : new THREE.Vector3(0, 0, dir);
        faces.push({ pos, normal });
      }
    }
    if (!faces.length) return null;
    const f = rng.pick(faces);
    f.pos.y = floorBaseY(room.floor) + h;
    f.yaw = Math.atan2(f.normal.x, f.normal.z);
    return f;
  }

  _decal(tex, room, pos, yaw, w, h, floorDecal = false, opacity = 1) {
    const mat = this.world.materials.custom({ map: tex, transparent: true, opacity, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 }, 'decal');
    setObjectRoom(mat, room.lightSlot);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.copy(pos);
    if (floorDecal) { m.rotation.x = -Math.PI / 2; m.rotation.z = yaw; }
    else m.rotation.y = yaw;
    m.renderOrder = 3;
    this.world.addDynamicObject(m, room.floor);
    this.objects.push(m);
    return m;
  }

  _decorate(rng, run) {
    const g = this.world.grid;
    const R = (k) => g.roomByKey[k];
    // crayon drawings pinned around Ellie's room and the playroom
    for (const [key, n] of [['2e', 4], ['3R', 7], ['2u', 1], ['1N', 1]]) {
      const room = R(key);
      for (let i = 0; i < n; i++) {
        const s = this.wallSpot(room, rng, rng.float(1.0, 1.6));
        if (!s) continue;
        const cap = rng.pick(['ME AND MR GRIN', 'HIDE AND SEEK', 'MY FRIEND', 'HE FOUND ME', 'MR GRIN', 'PLAY WITH ME']);
        this._decal(drawingTexture(rng.int(0, 1e6), cap), room, s.pos, s.yaw, 0.42, 0.33);
      }
    }
    // photographs
    for (const [key, kind] of [['1S', 'family'], ['2u', 'hallway'], ['2M', 'bedroom'], ['0J', 'victim'], ['0J', 'victim'], ['0J', 'victim'], ['1h', 'family']]) {
      const room = R(key);
      const s = this.wallSpot(room, rng, rng.float(1.3, 1.7));
      if (s) this._decal(photoTexture(kind, rng.int(0, 1e6)), room, s.pos, s.yaw, 0.2, 0.24);
    }
    // blood and claw marks
    const bloodRooms = ['0J', '0J', '0O', '1K', '2B', '1G', '0C', '3A'];
    for (const key of bloodRooms) {
      const room = R(key);
      const pt = this.game.cat.nav.randomPointInRoom(room, rng);
      if (pt) this._decal(decalTexture('blood', rng.int(0, 1e6)), room, new THREE.Vector3(pt.x, floorBaseY(room.floor) + 0.006, pt.z), rng.float(0, 6), rng.float(0.6, 1.3), rng.float(0.6, 1.3), true, 0.9);
    }
    // drag marks toward the cellar door
    for (let x = 23.5; x > 21.2; x -= 1.1) {
      this._decal(decalTexture('drag', rng.int(0, 1e6)), R('1h'), new THREE.Vector3(x, 0.006, 9.6), Math.PI / 2, 1.2, 0.5, true, 0.85);
    }
    for (const key of ['2u', '1h', '2e', '0Q', '3A', '2w', '1F']) {
      const room = R(key);
      const s = this.wallSpot(room, rng, rng.float(0.6, 1.9));
      if (s) this._decal(decalTexture(rng.chance(0.3) ? 'hand' : 'claws', rng.int(0, 1e6)), room, s.pos, s.yaw, 0.55, 0.55);
    }
    // writing on the walls
    for (const key of rng.shuffle(['0J', '2u', '1h', '3A']).slice(0, run.mode === 'endless' ? 4 : 3)) {
      const room = R(key);
      const s = this.wallSpot(room, rng, rng.float(1.4, 2.0));
      if (s) this._decal(decalTexture('writing', rng.int(0, 1e6), rng.pick(WALL_WRITING)), room, s.pos, s.yaw, 1.6, 0.5);
    }
  }

  // ---------------------------------------------------------------- the house changes
  /** New writing appears somewhere you've been, while you aren't looking. */
  changeHouse(rng) {
    const g = this.world.grid;
    const p = this.game.player;
    const visited = [...p.roomTime.keys()].map((i) => g.rooms[i]).filter((r) => r && r !== p.room && r.kind !== 'stairs');
    if (!visited.length) return false;
    const room = rng.pick(visited);
    const s = this.wallSpot(room, rng, rng.float(1.3, 2.0));
    if (!s || this.game.canPlayerSee(s.pos, 0)) return false;
    const text = rng.pick(WALL_WRITING);
    this._decal(decalTexture('writing', rng.int(0, 1e6), text), room, s.pos, s.yaw, 1.6, 0.5);
    this.changes++;
    return room;
  }

  // ---------------------------------------------------------------- reading
  read(doc, it = null, fromJournal = false) {
    this.open = doc;
    this.game.ui.showNote(doc);
    if (!this.readSet.has(doc.id)) {
      this.readSet.add(doc.id);
      this.docs.push(doc);
      this.game.audio.click(0.5);
      this.game.onDocumentRead(doc);
    }
    this.fromJournal = fromJournal;
    void it;
  }

  closeNote() {
    this.open = null;
    this.game.ui.hideNote();
    if (this.fromJournal) this.game.ui.showJournal();
  }

  readDocs() { return this.docs || []; }
}
