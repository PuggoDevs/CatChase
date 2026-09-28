## First-person player: movement and stances, stamina, flashlight, footsteps,
## interaction (doors, pickups, switches, hiding) and throwing.
## Ported from src/player/player.js and interaction.js.
class_name Player
extends CharacterBody3D

const RADIUS := 0.28
const SPEED := {"stand": 2.1, "sprint": 4.8, "crouch": 1.15, "prone": 0.62}
const HEIGHT := {"stand": 1.72, "crouch": 1.12, "prone": 0.5}
const EYE := {"stand": 1.6, "crouch": 1.0, "prone": 0.34}
const NOISE := {"stand": 5.5, "sprint": 14.0, "crouch": 1.8, "prone": 1.0}
const REACH := 2.1
const BREATH_MAX := 7.0
const GRAVITY := 18.0

var game
var cam: Camera3D
var flash: SpotLight3D
var capsule: CapsuleShape3D
var shape_node: CollisionShape3D

var yaw := 0.0
var pitch := 0.0
var stance := "stand"
var eye := 1.6
var sprinting := false
var stamina := 100.0
var exhausted := false
var breath := BREATH_MAX
var holding_breath := false
var has_flashlight := false
var flash_on := false
var battery := 100.0
var inventory := {}      # kind -> count
var held := ""           # a throwable in your hand
var hiding = null        # {spot, phase: "enter"|"in"|"exit", t}
var floor_index := 2
var room := -1
var dead := false
var frozen := false
var moving := 0.0
var step_acc := 0.0
var bob := 0.0
var shake := 0.0
var fear := 0.0
var target = null        # current interaction target
var hold_t := -1.0
var hold_done := false
var sens := 0.0022
var _breath_t := 0.0


func setup(g) -> void:
	game = g
	collision_layer = 4
	collision_mask = 1
	floor_max_angle = deg_to_rad(50)
	floor_snap_length = 0.45
	shape_node = CollisionShape3D.new()
	capsule = CapsuleShape3D.new()
	capsule.radius = RADIUS
	capsule.height = HEIGHT.stand
	shape_node.shape = capsule
	shape_node.position.y = HEIGHT.stand * 0.5
	add_child(shape_node)
	cam = Camera3D.new()
	cam.fov = 72
	cam.near = 0.05
	cam.far = 90
	add_child(cam)
	flash = SpotLight3D.new()
	flash.light_color = Color(1.0, 0.94, 0.86)
	flash.spot_range = 22.0
	flash.spot_angle = 26.0
	flash.spot_angle_attenuation = 0.9
	flash.spot_attenuation = 1.2
	flash.shadow_enabled = true
	flash.light_volumetric_fog_energy = 2.0
	flash.position = Vector3(0.16, -0.18, 0.05)
	cam.add_child(flash)
	flash.visible = false


func reset(start: Vector3, start_yaw: float) -> void:
	global_position = start
	yaw = start_yaw
	pitch = 0.0
	velocity = Vector3.ZERO
	stance = "stand"
	_apply_stance()
	eye = EYE.stand
	stamina = 100.0
	exhausted = false
	breath = BREATH_MAX
	has_flashlight = false
	flash_on = false
	battery = 100.0
	inventory = {}
	held = ""
	hiding = null
	dead = false
	frozen = false
	shake = 0.0
	fear = 0.0
	collision_layer = 4
	collision_mask = 1
	floor_index = game.house.floor_at(start + Vector3(0, 0.2, 0), 2)
	_update_camera(0.0)


func give(kind: String, n := 1) -> void:
	inventory[kind] = int(inventory.get(kind, 0)) + n


func has(kind: String) -> bool:
	return int(inventory.get(kind, 0)) > 0


func take(kind: String) -> bool:
	if not has(kind):
		return false
	inventory[kind] = int(inventory[kind]) - 1
	if inventory[kind] <= 0:
		inventory.erase(kind)
	return true


func add_shake(amount: float) -> void:
	shake = maxf(shake, amount)


# ------------------------------------------------------------------ input
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED and not frozen and not dead:
		var s: float = sens * game.settings.sensitivity
		yaw -= event.relative.x * s
		pitch = clampf(pitch - event.relative.y * s, -1.45, 1.45)


func _physics_process(dt: float) -> void:
	if game == null or game.state != "playing":
		return
	if dead or frozen:
		velocity = Vector3.ZERO
		_update_camera(dt)
		return
	if hiding != null:
		_update_hiding(dt)
		_update_flashlight(dt)
		_update_camera(dt)
		return
	_update_stance()
	var input := Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var turn := Input.get_axis("turn_right", "turn_left")
	yaw += turn * 2.2 * dt
	var want_sprint := Input.is_action_pressed("sprint") and stance == "stand" and input.y < -0.1 and not exhausted
	sprinting = want_sprint and stamina > 0.0
	var speed: float = SPEED.sprint if sprinting else SPEED[stance]
	var basis := Basis(Vector3.UP, yaw)
	var dir := basis * Vector3(input.x, 0, input.y)
	var horiz := dir * speed
	velocity.x = lerpf(velocity.x, horiz.x, minf(1.0, dt * 10.0))
	velocity.z = lerpf(velocity.z, horiz.z, minf(1.0, dt * 10.0))
	if is_on_floor():
		velocity.y = 0.0
	else:
		velocity.y -= GRAVITY * dt
	move_and_slide()
	moving = Vector2(velocity.x, velocity.z).length()
	# stamina
	var d: Dictionary = game.diff
	if sprinting and moving > 1.0:
		stamina = maxf(0.0, stamina - 13.0 * float(d.staminaDrain) * dt)
		if stamina <= 0.0:
			exhausted = true
			game.sfx.play_flat("gasp", 0.5)
	else:
		stamina = minf(100.0, stamina + (17.0 if moving < 0.2 else 11.0) * dt)
	if exhausted and stamina >= 35.0:
		exhausted = false
	if stamina < 20.0:
		_breath_t -= dt
		if _breath_t <= 0.0:
			_breath_t = 1.4
			game.sfx.play_flat("breath", 0.35)
			game.noise(global_position, 4.5, "breath", "player")
	# footsteps
	step_acc += moving * dt
	var stride := 0.9 if sprinting else (0.75 if stance == "stand" else 0.6)
	if step_acc > stride and is_on_floor():
		step_acc = 0.0
		var surface := _surface()
		var vol := 0.55 if sprinting else (0.3 if stance == "stand" else 0.1)
		game.sfx.play("step_" + surface, global_position + Vector3(0, 0.05, 0), vol)
		var loud: float = NOISE.sprint if sprinting else NOISE[stance]
		game.noise(global_position, loud, "step", "player")
	bob += moving * dt * (1.9 if sprinting else 1.6)
	floor_index = game.house.floor_at(global_position + Vector3(0, 0.2, 0), floor_index)
	room = game.house.room_at(floor_index, global_position)
	_update_flashlight(dt)
	_update_interaction(dt)
	if Input.is_action_just_pressed("throw") and held != "":
		_throw()
	_update_camera(dt)


func _surface() -> String:
	if room < 0:
		return "wood"
	var mat: String = String(game.house.rooms[room].meta.get("floor", "woodFloor"))
	if mat.begins_with("carpet") or mat.begins_with("rug"):
		return "carpet"
	if mat.begins_with("tile") or mat == "marble":
		return "tile"
	if mat in ["stone", "concrete", "dirt", "wetStone"]:
		return "stone"
	return "wood"


# ------------------------------------------------------------------ stances
func _update_stance() -> void:
	if Input.is_action_just_pressed("crouch"):
		_set_stance("stand" if stance == "crouch" else "crouch")
	if Input.is_action_just_pressed("prone"):
		_set_stance("crouch" if stance == "prone" else "prone")


func _set_stance(s: String) -> void:
	if HEIGHT[s] > HEIGHT[stance] and not _room_above(HEIGHT[s]):
		game.hud.toast("Not enough room to get up here")
		return
	stance = s
	_apply_stance()


func _apply_stance() -> void:
	capsule.height = maxf(HEIGHT[stance], RADIUS * 2.0 + 0.01)
	shape_node.position.y = capsule.height * 0.5


func _room_above(h: float) -> bool:
	var q := PhysicsShapeQueryParameters3D.new()
	var c := CapsuleShape3D.new()
	c.radius = RADIUS - 0.04
	c.height = h
	q.shape = c
	q.transform = Transform3D(Basis.IDENTITY, global_position + Vector3(0, h * 0.5 + 0.05, 0))
	q.collision_mask = 1
	q.exclude = [get_rid()]
	return get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty()


# ------------------------------------------------------------------ flashlight
func _update_flashlight(dt: float) -> void:
	if Input.is_action_just_pressed("flashlight") and has_flashlight:
		if battery <= 0.0 and not _use_battery():
			game.hud.toast("The flashlight is dead. Find batteries.")
		else:
			flash_on = not flash_on
			game.sfx.play_flat("click", 0.4)
			game.noise(global_position, 1.2, "click", "player")
	if flash_on:
		battery -= 0.28 * float(game.diff.batteryDrain) * dt
		if battery <= 0.0:
			battery = 0.0
			if not _use_battery():
				flash_on = false
				game.hud.toast("The flashlight died.")
	var b := battery / 100.0
	flash.visible = flash_on
	var flicker := 1.0
	if b < 0.12 and randf() < 0.08:
		flicker = 0.2
	flash.light_energy = (2.6 if b > 0.25 else 1.2 + b * 5.6) * flicker


func _use_battery() -> bool:
	if take("battery"):
		battery = 100.0
		game.hud.toast("You swap in a fresh battery.")
		return true
	return false


# ------------------------------------------------------------------ camera
func _update_camera(dt: float) -> void:
	if hiding != null:
		return
	eye = lerpf(eye, EYE[stance], minf(1.0, dt * 10.0))
	var bob_y := sin(bob * 2.0 * PI) * 0.035 * minf(1.0, moving / 2.0)
	var bob_x := cos(bob * PI) * 0.02 * minf(1.0, moving / 2.0)
	cam.position = Vector3(bob_x, eye + bob_y, 0)
	shake = maxf(0.0, shake - dt * 0.6)
	var sx := (randf() - 0.5) * shake
	var sy := (randf() - 0.5) * shake
	if game.state == "playing" and not dead:
		cam.global_rotation = Vector3(pitch + sy, yaw + sx, 0.0)
	var fov_t := 72.0 + (7.0 if sprinting else 0.0)
	cam.fov = lerpf(cam.fov, fov_t, minf(1.0, dt * 5.0))


# ------------------------------------------------------------------ hiding
func enter_hiding(spot: Dictionary) -> void:
	hiding = {"spot": spot, "phase": "enter", "t": 0.0, "from": cam.global_position, "yaw0": yaw, "pitch0": pitch}
	collision_layer = 0
	collision_mask = 0
	velocity = Vector3.ZERO
	target = null
	game.hud.set_prompt(null)
	game.sfx.play(_hide_sound(spot.type), spot.inside, 0.4, 1.2)
	game.noise(spot.inside, 2.5, "hide", "player")
	game.on_player_hide(spot)


func _hide_sound(t: String) -> String:
	if t in ["wardrobe", "cabinet", "chest"]:
		return "creak"
	if t in ["bed", "coats", "curtain", "tub"]:
		return "whoosh"
	return "thud"


func exit_hiding() -> void:
	if hiding == null or hiding.phase != "in":
		return
	hiding.phase = "exit"
	hiding.t = 0.0
	game.sfx.play(_hide_sound(hiding.spot.type), hiding.spot.inside, 0.4, 1.2)
	game.noise(hiding.spot.inside, 2.5, "hide", "player")


func _update_hiding(dt: float) -> void:
	var h: Dictionary = hiding
	var spot: Dictionary = h.spot
	h.t += dt
	var base_yaw: float = spot.yaw
	if h.phase == "enter":
		var k := clampf(h.t / 0.6, 0.0, 1.0)
		cam.global_position = (h.from as Vector3).lerp(spot.inside, k)
		cam.global_rotation = Vector3(lerp_angle(h.pitch0, 0.0, k), lerp_angle(h.yaw0, base_yaw, k), 0)
		if k >= 1.0:
			h.phase = "in"
			yaw = base_yaw
			pitch = 0.0
		return
	if h.phase == "exit":
		var k := clampf(h.t / 0.5, 0.0, 1.0)
		cam.global_position = (spot.inside as Vector3).lerp(spot.exit + Vector3(0, EYE.stand, 0), k)
		if k >= 1.0:
			global_position = spot.exit
			yaw = cam.global_rotation.y
			hiding = null
			stance = "stand"
			_apply_stance()
			collision_layer = 4
			collision_mask = 1
			game.on_player_unhide()
		return
	# inside: look around a little, hold your breath
	yaw = base_yaw + clampf(wrapf(yaw - base_yaw, -PI, PI), -spot.yaw_range, spot.yaw_range)
	pitch = clampf(pitch, spot.pitch_min, spot.pitch_max)
	cam.global_position = spot.inside
	cam.global_rotation = Vector3(pitch, yaw, 0)
	holding_breath = Input.is_action_pressed("breath") and breath > 0.0
	if holding_breath:
		breath = maxf(0.0, breath - dt)
		if breath <= 0.0:
			game.sfx.play_flat("gasp", 0.8)
			game.noise(spot.inside, 7.0, "gasp", "player")
			holding_breath = false
	else:
		breath = minf(BREATH_MAX, breath + dt * 0.8)
		# your breathing gives you away if it's right outside
		_breath_t -= dt
		if _breath_t <= 0.0:
			_breath_t = 2.2
			game.noise(spot.inside, 1.6, "breath", "player")
	game.hud.set_prompt({"title": "Hiding", "keys": [["E", "Leave"], ["Hold Space", "Hold your breath"]]})
	if Input.is_action_just_pressed("interact"):
		exit_hiding()


# ------------------------------------------------------------------ interaction
func _update_interaction(dt: float) -> void:
	var t = _find_target()
	target = t
	if t == null:
		game.hud.set_prompt(null)
		hold_t = -1.0
		return
	game.hud.set_prompt(_prompt(t))
	match t.kind:
		"door":
			_door_input(t.door, dt)
		_:
			if Input.is_action_just_pressed("interact"):
				_use(t)


func _find_target():
	# (a Dictionary, because GDScript lambdas can't reassign captured locals)
	var acc := {"best": null, "score": -INF, "eye": cam.global_position, "fwd": -cam.global_transform.basis.z}
	for p in game.items.pickups:
		_consider(acc, "pickup", p.pos + Vector3(0, 0.05, 0), p, REACH)
	for door in game.house.door_list:
		if door.f != floor_index and absf(door.center.y - acc.eye.y) > 2.0:
			continue
		var c: Vector3 = door.center
		_consider(acc, "door", Vector3(c.x, clampf(acc.eye.y, door.base_y + 0.4, door.base_y + 1.8), c.z), door, 1.9)
	for spot in game.house.hiding_spots:
		# hiding places are furniture you walk up to; their own bulk would block the ray
		if spot.f == floor_index and global_position.distance_to(spot.entry) < 1.2:
			# aim at the furniture itself, not at the floor under a bed
			var aim: Vector3 = (spot.inside as Vector3).lerp(spot.entry, 0.35)
			aim.y = maxf(aim.y, (spot.entry as Vector3).y + 0.6)
			_consider(acc, "hide", aim, spot, 2.2, false, 0.6)
	for sw in game.house.switches:
		_consider(acc, "switch", sw.pos, sw, 1.6)
	var best = acc.best
	if best and best.kind == "door":
		best.door = best.obj
	return best


func _consider(acc: Dictionary, kind: String, pos: Vector3, obj, reach: float, los := true, min_dot := -1.0) -> void:
	var to: Vector3 = pos - acc.eye
	var d := to.length()
	if d > reach or d < 0.01:
		return
	var dot := to.normalized().dot(acc.fwd)
	if dot < (min_dot if min_dot > 0.0 else (0.55 if d < 1.0 else 0.8)):
		return
	var score := dot * 2.0 - d * 0.35
	if score <= acc.score:
		return
	if los and not game.house.line_clear(acc.eye, pos - to.normalized() * 0.15, House.LAYER_SIGHT):
		return
	acc.score = score
	acc.best = {"kind": kind, "pos": pos, "obj": obj}


func _prompt(t: Dictionary) -> Dictionary:
	match t.kind:
		"pickup":
			return {"title": game.items.item_name(t.obj.kind), "keys": [["E", "Take"]]}
		"hide":
			return {"title": String(t.obj.type).capitalize(), "keys": [["E", "Hide"]]}
		"switch":
			return {"title": "Lamp" if t.obj.kind == "lamp" else "Light switch", "keys": [["E", "Switch"]]}
		"door":
			var door: Door = t.door
			return {"title": _door_title(door), "keys": _door_keys(door)}
	return {}


func _door_title(door: Door) -> String:
	if door.type == "front":
		return "Front Door"
	if door.broken:
		return "Broken door"
	if door.barricade > 0.0:
		return "Barricaded door"
	if door.locked:
		return "Locked door"
	return "Door"


func _door_keys(door: Door) -> Array:
	if door.escape:
		return [["E", "Try it"]]
	var keys: Array = []
	if door.barricade > 0.0:
		return [["E", "Pull the planks off"]]
	if door.locked:
		if door.lock == "bolt":
			keys.append(["L", "Unbolt"] if door.side_of(global_position) == _bolt_side(door) else ["", "Bolted from the other side"])
		elif has(String(door.lock)):
			keys.append(["E", "Unlock with " + game.items.item_name(String(door.lock))])
		else:
			keys.append(["", "Needs a key"])
		return keys
	if door.open > 0.4:
		keys.append_array([["E", "Close"], ["Hold E", "Close quietly"], ["R", "Slam"]])
	else:
		keys.append_array([["E", "Open"], ["Hold E", "Open quietly"]])
		if door.lock == "bolt":
			keys.append(["L", "Bolt"])
		if has("plank"):
			keys.append(["B", "Barricade"])
	return keys


func _bolt_side(door: Door) -> int:
	# bolts are on the side of the smaller room (the bathroom side)
	var r1: int = door.room1
	var r2: int = door.room2
	if r1 < 0:
		return 2
	if r2 < 0:
		return 1
	return 1 if game.house.rooms[r1].cells.size() <= game.house.rooms[r2].cells.size() else 2


func _door_input(door: Door, dt: float) -> void:
	if door.escape:
		if Input.is_action_just_pressed("interact"):
			game.try_escape(door)
		return
	if Input.is_action_just_pressed("slam") and door.open > 0.2:
		door.close_door("player", "slam")
		add_shake(0.02)
		return
	if Input.is_action_just_pressed("lock") and door.lock == "bolt" and door.side_of(global_position) == _bolt_side(door):
		door.toggle_lock()
		game.learn_lock()
		return
	if Input.is_action_just_pressed("barricade") and door.is_closed() and has("plank") and door.barricade <= 0.0:
		take("plank")
		door.add_barricade(door.side_of(global_position))
		game.sfx.play("hammer", door.center, 0.9)
		game.noise(door.center, 16.0, "barricade", "player")
		game.learn_lock()
		return
	if Input.is_action_just_pressed("interact"):
		if door.barricade > 0.0:
			door.barricade = 0.0
			door._refresh_barricade()
			give("plank")
			game.sfx.play("clatter", door.center, 0.6)
			game.noise(door.center, 8.0, "barricade", "player")
			return
		if door.locked:
			if door.lock != "bolt" and has(String(door.lock)):
				door.locked = false
				game.sfx.play("unlock", door.center, 0.7)
				game.hud.toast("Unlocked.")
			else:
				game.sfx.play("rattle", door.center, 0.6)
				game.noise(door.center, 3.0, "rattle", "player")
				game.hud.toast("Locked.")
			return
		hold_t = 0.0
		hold_done = false
	if hold_t >= 0.0:
		if Input.is_action_pressed("interact"):
			hold_t += dt
			if not hold_done and hold_t > 0.28:
				hold_done = true
				_door_toggle(door, "quiet")
		else:
			if not hold_done:
				_door_toggle(door, "normal")
			hold_t = -1.0


func _door_toggle(door: Door, how: String) -> void:
	if door.open > 0.4 or door.target > 0.5:
		door.close_door("player", how)
	else:
		door.open_door("player", how)


func _use(t: Dictionary) -> void:
	match t.kind:
		"pickup":
			var p: Dictionary = t.obj
			var kind: String = p.kind
			if kind in Items.THROWABLES:
				if held != "":
					game.hud.toast("Your hands are full. [G] to throw what you're holding.")
					return
				held = kind
			elif kind == "flashlight":
				has_flashlight = true
				game.hud.hint("F: flashlight. Light helps you see - and helps it see you.")
			else:
				give(kind)
			game.items.remove(p)
			game.sfx.play("click", p.pos, 0.4)
			game.noise(p.pos, 2.0, "pickup", "player")
			game.hud.toast("Picked up: " + game.items.item_name(kind))
			game.on_pickup(kind)
		"hide":
			enter_hiding(t.obj)
		"switch":
			game.house.toggle_room_lights(int(t.obj.room), t.obj.kind == "lamp")
			game.sfx.play("click", t.obj.pos, 0.5)
			game.noise(t.obj.pos, 3.0, "switch", "player")


func _throw() -> void:
	var kind := held
	held = ""
	var fwd := -cam.global_transform.basis.z
	game.items.throw_item(kind, cam.global_position + fwd * 0.4, fwd, global_position)
	game.sfx.play("whoosh", cam.global_position, 0.4, 1.4)
	game.noise(global_position, 3.5, "throw", "player")
