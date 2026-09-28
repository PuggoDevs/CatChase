## Headless playtest: drives the real game through scenarios and reports.
## godot --headless --path godot --fixed-fps 60 -s res://tests/playtest.gd
extends SceneTree

var game
var results: Array = []
var failures := 0
var frame := 0
var step := 0
var t0 := 0.0
var scenario := ""
var mem := {}

const GameScript := preload("res://scripts/game.gd")


func _initialize() -> void:
	GameScript.pending_difficulty = "normal"
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	current_scene = game


func _check(name: String, ok: bool, info := "") -> void:
	results.append(("PASS " if ok else "FAIL ") + name + ("  " + info if info != "" else ""))
	if not ok:
		failures += 1
	print(results[-1])


func _release_all() -> void:
	for a in ["move_forward", "move_back", "move_left", "move_right", "sprint", "interact"]:
		Input.action_release(a)


func _process(dt: float) -> bool:
	frame += 1
	if game == null or not is_instance_valid(game) or not game.is_inside_tree():
		game = current_scene
		frame = 0
		return false
	var p = game.player
	var cat = game.cat
	var t: float = game.time
	match step:
		0:
			if frame > 30:
				_check("boots into a night", game.state == "playing", "doors=%d pickups=%d spots=%d" % [game.house.door_list.size(), game.items.pickups.size(), game.house.hiding_spots.size()])
				_check("wakes in the guest bedroom", game.house.room_name(p.room) == "Guest Bedroom" or game.house.room_name(game.house.room_at(2, p.global_position)) == "Guest Bedroom", game.house.room_name(game.house.room_at(2, p.global_position)))
				mem.y0 = p.global_position.y
				mem.pos0 = p.global_position
				cat.disabled = true
				# the upstairs hall, walking east along it
				p.global_position = Vector3(14.5, 3.21, 9.5)
				mem.pos0 = p.global_position
				p.yaw = -PI * 0.5
				Input.action_press("move_forward")
				t0 = t
				step = 1
		1:
			if t - t0 > 2.0:
				_release_all()
				var moved: float = (p.global_position - mem.pos0).length()
				_check("walks on the floor", moved > 3.0 and absf(p.global_position.y - 3.2) < 0.2, "moved %.2f m, y=%.2f on_floor=%s" % [moved, p.global_position.y, p.is_on_floor()])
				# bottom of the grand staircase, facing up it (north)
				p.global_position = Vector3(18.0, 0.02, 15.6)
				p.velocity = Vector3.ZERO
				p.yaw = 0.0
				Input.action_press("move_forward")
				t0 = t
				step = 2
		2:
			if t - t0 > 4.5:
				_release_all()
				_check("climbs the stairs", p.global_position.y > 3.0 and p.floor_index == 2, "y=%.2f floor=%d at %s" % [p.global_position.y, p.floor_index, str(p.global_position)])
				var path: Array = game.house.nav.find_path(0, Vector3(12.5, -3.2, 8.5), 2, Vector3(22.5, 3.2, 4.5))
				_check("cat can path from basement to bedroom", path.size() > 2, "%d waypoints" % path.size())
				# every hiding spot can be used from where you'd stand to use it
				# (with nothing lying on it: an item on a bed is offered first, which is right)
				for pk in game.items.pickups.duplicate():
					game.items.remove(pk)
				var ok := 0
				var bad: Array = []
				for spot in game.house.hiding_spots:
					p.global_position = spot.entry
					p.floor_index = int(spot.f)
					var to: Vector3 = spot.inside - spot.entry
					p.yaw = atan2(-to.x, -to.z)
					p.pitch = -0.25
					p.cam.position = Vector3(0, 1.6, 0)
					p.cam.global_rotation = Vector3(p.pitch, p.yaw, 0)
					var tgt = p._find_target()
					if tgt != null and tgt.kind == "hide":
						ok += 1
					else:
						bad.append("%s->%s" % [spot.type, (tgt.kind + ":" + str(tgt.obj.get("kind", tgt.obj.get("type", ""))) if tgt is Dictionary and tgt.obj is Dictionary else (tgt.kind if tgt else "none"))])
				_check("hiding spots can be used", ok == game.house.hiding_spots.size(), "%d/%d, failed: %s" % [ok, game.house.hiding_spots.size(), str(bad)])
				# a door can be targeted and opened
				var door = null
				for dd in game.house.door_list:
					if dd.f == 2 and dd.type == "door" and not dd.locked and dd.barricade <= 0.0 and dd.room1 >= 0 and dd.room2 >= 0:
						door = dd
						break
				var ap: Vector3 = door.approach_point(1, 0.9)
				p.global_position = Vector3(ap.x, door.base_y + 0.01, ap.z)
				p.floor_index = 2
				var tod: Vector3 = door.center - p.global_position
				p.yaw = atan2(-tod.x, -tod.z)
				p.pitch = -0.1
				p.cam.global_rotation = Vector3(p.pitch, p.yaw, 0)
				var dt_ = p._find_target()
				_check("doors can be targeted", dt_ != null and dt_.kind == "door", str(dt_.kind if dt_ else null) + " " + door.id)
				p._door_toggle(door, "normal")
				mem.door = door
				# the cat wakes and patrols
				cat.disabled = false
				p.global_position = Vector3(22.35, 3.21, 3.3)
				cat.emerge()
				mem.cat0 = cat.global_position
				mem.states = {}
				t0 = t
				step = 3
		3:
			mem.states[cat.state] = true
			if t - t0 > 20.0:
				_check("doors swing open and stop blocking", mem.door.open > 0.95 and (mem.door.body.collision_layer & 1) == 0, "open=%.2f layer=%d" % [mem.door.open, mem.door.body.collision_layer])
				var moved: float = (cat.global_position - mem.cat0).length()
				_check("cat patrols the house", moved > 3.0 and cat.visible, "moved %.1f m, states %s" % [moved, str(mem.states.keys())])
				# chase: put it in the hall, lit, looking at you
				p.global_position = Vector3(14.5, 3.21, 9.5)
				p.yaw = -PI * 0.5
				p.flash_on = true
				p.has_flashlight = true
				cat.teleport(2, Vector3(19.5, 3.2, 9.5), -PI * 0.5)
				cat.set_state("patrol")
				cat.path = []
				mem.trace = []
				t0 = t
				step = 4
		4:
			if mem.trace.is_empty() or mem.trace[-1] != cat.state:
				mem.trace.append(cat.state)
			if game.state == "dead" or t - t0 > 25.0:
				_check("chase ends in death", game.state == "dead", "trace %s, game %s" % [str(mem.trace), game.state])
				# hiding: a fresh night
				GameScript.pending_difficulty = "hard"
				game.get_tree().reload_current_scene()
				game = null
				step = 5
				frame = 0
		5:
			game = current_scene
			if game != null and frame > 30 and game.state == "playing":
				p = game.player
				cat = game.cat
				var spot = null
				for h in game.house.hiding_spots:
					if game.house.rooms[h.room].key == "2g" and h.type == "wardrobe":
						spot = h
				if spot == null:
					spot = game.house.hiding_spots[0]
				p.global_position = spot.entry
				p.enter_hiding(spot)
				cat.teleport(2, Vector3(21.5, 3.2, 7.5), PI)
				cat.last_seen = {"pos": spot.entry, "f": 2, "time": game.time}
				cat._start_search(spot.entry)
				mem.trace = []
				mem.spot = spot
				t0 = game.time
				step = 6
		6:
			p.holding_breath = false
			if mem.trace.is_empty() or mem.trace[-1] != cat.state:
				mem.trace.append(cat.state)
			if game.state in ["dying", "dead"] or game.time - t0 > 40.0:
				_check("cat checks hiding spots and finds you", game.state in ["dying", "dead"], "spot %s trace %s" % [mem.spot.type, str(mem.trace)])
				GameScript.pending_difficulty = "normal"
				game.get_tree().reload_current_scene()
				game = null
				step = 7
				frame = 0
		7:
			game = current_scene
			if game != null and frame > 30 and game.state == "playing":
				game.cat.disabled = true
				game.player.give("key_front")
				game.player.give("bolt_cutters")
				game.try_escape(game.house.doors["front_door"])
				t0 = game.time
				step = 8
		8:
			if game.state == "ended" or game.time - t0 > 8.0:
				_check("escapes through the front door", game.state == "ended", game.state)
				step = 9
		9:
			print("\n%d checks, %d failed" % [results.size(), failures])
			return true
	return false
