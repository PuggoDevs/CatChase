# The Cat's House

A first-person survival horror game that runs in the browser. You wake up in a
guest bedroom of a huge old house, and you are not alone. Something that wears
a red-and-white striped hat and a red bow tie lives in the walls. It grins too
wide, it learns how you play, and it does not want you to leave.

There is one goal: **survive and get out.**

## Running it

Requires Node 20.19+ (or 22.12+) and a browser with WebGL 2.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run preview    # serve the build
```

Headphones are strongly recommended. The audio is positional, and footsteps,
vents and breathing are how you know where the cat is.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrow keys | Move (← → also turn) |
| Mouse | Look |
| Shift | Sprint (drains stamina) |
| C / Ctrl | Crouch |
| Z / X | Crawl (fit under tables, stay quiet) |
| E | Interact, open, pick up, hide, leave a hiding spot |
| Hold E | Open or close a door quietly |
| R | Slam a door shut (loud, but it buys time) |
| L | Lock or bolt a door |
| B | Barricade a closed door (needs a plank) |
| F | Flashlight (the battery drains) |
| Left mouse / G | Throw what you are holding |
| Space | Hold your breath while hiding |
| Tab / I | Journal and inventory |
| Esc / P | Pause |

Touch controls appear automatically on touch devices.

## How to survive

- **Noise carries.** Sprinting, slamming doors, knocking things over and
  gasping for breath all travel through the house. Walls, closed doors and
  floors muffle sound, but they don't block it.
- **Light gives you away.** The flashlight lets you see, and it also lets the
  cat see you. Batteries are scarce.
- **Hiding is not safe.** You can hide in closets, wardrobes, cabinets, under
  beds and behind furniture. The cat remembers where you hide and checks those
  places more often. If it watched you get in, it will come straight for you.
- **Doors are tools.** Close them quietly, slam them behind you, lock them or
  barricade them. The cat opens doors, pounds barricades apart, breaks locks on
  harder difficulties, and goes around through the vents.
- **Distractions wear thin.** Throw a bottle and it goes to look. Do it too
  often and it stops falling for it. Eventually it follows the throw back to
  you.
- **When it chases you**, break its line of sight, put doors between you, and
  hide once it loses you. Stamina runs out, and the cat doesn't get tired.

## The cat

The cat is a state machine driven by perception and a model of the player:

- It **sees** with a field of view and range that depend on light, your stance
  and how fast you move. It **hears** noises, which are occluded by walls, doors
  and floors.
- It **patrols**, **investigates** noises, **searches** rooms and hiding spots,
  **stalks** you from the dark, **stares** silently from the end of a hallway,
  **ambushes** the rooms you favour and the places it expects you to go next,
  **fakes leaving**, and **chases**.
- It walks on the **ceiling**, crawls through **vents** between floors, lies in
  wait **under beds** with only its eyes and grin showing, and sometimes appears
  right **behind you**.
- It lunges, grabs, drags you into the dark, drops on you from the ceiling,
  takes you from behind, and tears you out of your hiding place or pulls you
  out from under a bed. Crawl under the wrong bed and it is already there.
  Each attack has its own death.
- It **learns**: the rooms you spend time in, the routes you take, the spots
  you hide in, whether you keep locking doors, and how often your throws have
  fooled it. Its behaviour adapts during the run, so reusing the same spots and
  routes gets punished.

## The house

The house has four floors and more than forty rooms:

- **Basement:** wine cellar, coal cellar, boiler room, workshop, a room called
  The Collection, and a flooded tunnel.
- **Ground floor:** foyer, grand staircase, parlor, living room, den, dining
  room, kitchen, pantry, laundry, mudroom, sunroom, trophy room, Arthur's study
  and the garage.
- **Upstairs:** the guest bedroom you wake up in, the master bedroom with its
  bath and walk-in closet, Ellie's room, a sewing room, the library and the
  toymaker's workshop.
- **Attic:** the attic, attic storage and Ellie's playroom.

A hidden stair, a servants' passage and a bookcase that swings open connect
some rooms. Ducts run through the walls.

Every room is lit only by its own lamps. The power can fail, and the cat is
more aggressive in the dark until you get the fuse box working again. Over the
night the house changes behind your back. Writing appears on the walls of
rooms you have been in, doors creak open, lights flicker, the rocking chair
starts rocking and the piano plays by itself.

A **seed** decides where every key item, battery and note spawns, the cat's
patrols and the horror events. The item placement is always solvable. You can
type a seed on the New Night screen to replay a layout.

## Escapes and endings

Every night you can escape four ways, each needing its own items:

| Route | You need |
| --- | --- |
| The front door | The front door key and bolt cutters for the chain |
| The car in the garage | Car keys, a battery and a can of gas (and power for the garage door) |
| The attic window | A crowbar for the boards and a rope |
| The flooded tunnel | A pipe wrench and the valve wheel to drain it |

There is also a **secret ending** that tells the truth about the cat. The notes
scattered through the house point the way. Get caught and the night is over;
how it ends depends on how it got you.

**Endless Survival** removes the exits. You survive wave after wave, and each
night the hunt gets worse. Your best run is saved.

## Difficulty

| | |
| --- | --- |
| **Easy** | It moves slowly and loses track of you. You can struggle free twice. |
| **Normal** | It searches rooms, remembers where you were and sometimes waits for you. You can struggle free once. |
| **Hard** | Faster and sharper. It checks hiding spots, breaks through locked doors and punishes repeated tricks. |
| **Nightmare** | Relentless. It lies, it waits, it learns fastest, and it never lets you breathe. |

## Under the hood

- **Engine:** plain JavaScript modules on [three.js](https://threejs.org), built
  with Vite. There are no asset files: every texture, mesh, animation and sound
  is generated in code when the game starts. The only download is two Google
  Fonts for the interface.
- **World:** the house is written as ASCII floor plans (`src/world/layout.js`).
  Walls, doors, stairs, windows, trim, furniture, collision and the navigation
  graph are all built from those plans.
- **Lighting:** a custom shader patch confines each light to its room, which
  keeps light from bleeding through walls. The patch also adds light spill
  through open doors, moonlight through windows and a cheap bounce term.
  Post-processing adds bloom, grain, vignette, chromatic aberration and
  distortion that tracks your fear.
- **Audio:** the Web Audio API with HRTF panning, filtering by occlusion,
  convolution reverb, and a generative score that reacts to how close the cat
  is and what it is doing.
- **Cat:** a procedural rig with foot planting, gaits and twitch layers
  (`src/cat/catAnimator.js`), A* pathfinding across all floors, stairs, doors
  and vents (`src/cat/nav.js`), and the AI and learning in `src/cat/cat.js` and
  `src/cat/learning.js`.
- **Director:** controls tension and relief, power outages, house changes,
  endless waves and the scheduling of horror events (`src/horror/`).

## Testing

```sh
npm test                          # unit tests (layout, nav, item placement, learning)
npm run smoke                     # boots the game in headless Chromium and checks for errors
npm run smoke -- --dist           # the same against the production build (after npm run build)
node scripts/playtest.mjs         # scripted playtests: patrols, chases, hiding, escapes...
node scripts/playtest.mjs chase   # a single scenario
node scripts/planview.mjs         # draws the floor plans to screenshots/ for inspection
node scripts/menushot.mjs         # screenshots of the menu flow
node scripts/shot.mjs "autostart=normal&skipintro" out.png   # a screenshot of any URL state
```

The browser scripts use Playwright's Chromium. URL parameters useful for
debugging:

- `?autostart=normal` starts a run at that difficulty.
- `&seed=ABC` fixes the seed.
- `&skipintro` skips the opening.
- `&debug` shows the debug overlay (F3 also toggles it).
- `&god` makes you invulnerable.
- `&nocat` disables the cat.
- `&tp=f,x,z` teleports you.
- `&fixeddt` makes timing deterministic.
