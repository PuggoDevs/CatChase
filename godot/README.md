# The Cat's House (Godot 4)

A Godot 4 port of the browser game in the repository root. You wake in a
stranger's house at night. Something in a striped hat lives in the walls.
Find a way out before it finds you.

## Opening it

1. Install Godot 4.2 or newer (the standard build, not .NET).
2. In the Project Manager choose **Import**, pick `godot/project.godot` from this
   repository, and open it. The first import takes a minute: it imports the
   house, the cat and about a hundred sounds.
3. Press **F5** (or the Play button) to run it.

The project uses the Forward+ renderer for volumetric fog. On a machine
without Vulkan support, switch **Project Settings > Rendering > Renderer** to
Compatibility. The game still runs, but without fog.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (← → turn) |
| Mouse | Look (click the window to capture the mouse) |
| Shift | Sprint |
| C / Ctrl | Crouch |
| Z / X | Crawl |
| E | Use, pick up, hide, leave a hiding place |
| Hold E | Open or close a door quietly |
| R | Slam a door |
| L | Bolt or unbolt a bathroom door |
| B | Barricade a closed door (needs a plank) |
| F | Flashlight |
| G / left mouse | Throw what you're holding |
| Space | Hold your breath while hiding |
| Tab / I | Inventory and goal |
| Esc / P | Pause |

## What's in this version

- **The whole house**: all four floors and 43 rooms, with the same furniture,
  wallpaper, lamps and stairs as the web version. Doors swing and can be
  locked, bolted, slammed and barricaded. Light switches work.
- **The cat**: your model (`models/cat.glb`), with glowing eyes and procedural
  motion. It leans forward to stalk, drops almost flat to crawl, bobs as it
  runs, twitches, and hangs upside down from ceilings when it ambushes you.
  Its brain is ported from the web game:
  - It patrols, favouring the rooms you spend time in.
  - It investigates noises, with walls and floors muffling them.
  - It chases you, and loses you if you break line of sight.
  - It searches rooms and checks hiding places, more often the ones you
    reuse. If it saw you get in, it comes straight for you.
  - It stares at you from the end of a hallway, then either charges or
    vanishes.
  - It opens doors, batters barricades apart and uses the vents between floors.
  - It learns to see through the bottles you throw.
- **Difficulty**: Easy, Normal, Hard and Nightmare, with the same tuning as the
  web game. On Easy and Normal you can struggle free when it grabs you by
  hammering E.
- **Randomized nights**: items come from one of 40 layouts that the web game's
  placer checked are solvable. Batteries, planks and throwables are scattered
  fresh each night.
- **One escape**: the front door. It needs the front door key and bolt cutters.
  Some rooms are locked and need their own keys.
- **Atmosphere**: volumetric fog, shadows from room lights and the
  flashlight, 3D sound, a heartbeat that rises as it gets close, and a small
  director that flickers lights, creaks doors open, whispers and walks on the
  floor above you.

### Not ported yet

The web version still has more than this port. Tell Claude which to bring over next:

- the car, attic window and flooded tunnel escapes
- the secret ending and the story notes
- Endless Survival
- the fuse box and power outages
- mirrors, TVs, the piano and most of the scripted horror events
- the dynamic music
- the unique death scenes

## How it's built

The house was not rebuilt by hand. `scripts/godot-export.mjs` (in the
repository root) runs the web game in a headless browser. It exports:

- `models/house.glb`: all static geometry and furniture. Each door is
  exported as a named node with a `pivot` child that the game swings.
- `models/items.glb`: every pickup model.
- `data/house.json`: rooms, collision boxes, doors, the pathfinding graph,
  vents, hiding spots, item slots, lights, difficulty tuning and 40 item
  layouts.
- `sounds/*.wav`: every synthesized sound effect.

The scripts in `scripts/` build the game from those files:

- `house.gd` adds collision, floor slabs, stair ramps and lights.
- `door.gd` runs each door.
- `nav.gd` does the cat's pathfinding across floors.
- `player.gd`, `cat.gd`, `items.gd`, `hud.gd` and `sfx.gd` run the rest.
- `game.gd` ties it together.

To regenerate the exports after changing the web house, run this from the
repository root:

```sh
npm install
node scripts/godot-export.mjs
```

## Tests

A headless playtest drives the real game through a set of checks:

- walking and climbing stairs
- pathfinding between floors
- the cat patrolling
- a chase that ends in death
- the cat finding you in a wardrobe
- escaping through the front door

```sh
godot --headless --path godot --import
godot --headless --path godot --fixed-fps 60 -s res://tests/playtest.gd
```

`tests/shots.gd` renders screenshots. It needs a display, or `xvfb-run` on
Linux.

## Credits

- The cat model is the one you supplied (`models/cat.glb`, made with Meshy AI).
  It's a likeness of the Cat in the Hat, so check the rights before releasing
  this game publicly.
- The typeface is IM FELL English by Igino Marini, used under the SIL Open
  Font License (`fonts/OFL.txt`).
