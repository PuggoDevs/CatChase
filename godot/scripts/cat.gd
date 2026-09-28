## The cat: your model (models/cat.glb), moved and posed procedurally, and its
## brain. States: dormant, patrol, investigate, chase, search, check, stare,
## ambush, attack, recoil. Ported (and trimmed) from src/cat/cat.js.
class_name Cat
extends Node3D

## Height of the model in metres (the glb is 1 unit tall, feet at -0.5).
const MODEL_HEIGHT := 1.95
## Where the eyes sit on the model, in the glb's own units (front is +Z).
const EYE_L := Vector3(-0.022, 0.303, 0.062)
const EYE_R := Vector3(0.022, 0.303, 0.062)

var game
var house: House
var nav: HouseNav
var learn: PlayerModel

var body: Node3D          # yaw
var pose_root: Node3D     # lean / crawl / flip
var model: Node3D
var eyes: Array = []
var glows: Array = []
var eye_light: OmniLight3D

var floor_index := 1
var yaw := 0.0
var state := "dormant"
var st_t := 0.0
var sd := {}              # state data
var path: Array = []
var path_i := 0
var move_speed := 1.6
var pose := "stand"
var speed := 0.0
var detection := 0.0
var sees_player := false
var visible_to_player := false
var last_seen = null      # {pos, f, time}
var perc_t := 0.0
var step_phase := 0.0
var vocal_t := 5.0
var twitch := Vector3.ZERO
var twitch_t := 2.0
var ceiling := false
var flip := 0.0
var in_vent := false
var vent_t := 0.0
var vent_to = null
var door_wait = null      # {door, t, hits}
var stun := 0.0
var disabled := false
var silent_until := 0.0
var ambush_cd := 30.0
var chases := 0


func setup(g) -> void:
	game = g
	house = g.house
	nav = house.nav
	body = Node3D.new()
	add_child(body)
	pose_root = Node3D.new()
	body.add_child(pose_root)
	var scene: PackedScene = load("res://models/cat.glb")
	model = scene.instantiate()
	model.scale = Vector3.ONE * MODEL_HEIGHT
	model.position.y = 0.5 * MODEL_HEIGHT
	pose_root.add_child(model)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	# glowing eyes over the model's own
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1.0, 0.95, 0.35)
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.9, 0.3)
	mat.emission_energy_multiplier = 6.0
	# a soft halo so the eyes read from the far end of a dark hall
	var tex := GradientTexture2D.new()
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 1, 0.8, 1))
	grad.set_color(1, Color(1, 0.9, 0.3, 0))
	grad.add_point(0.25, Color(1, 0.92, 0.45, 0.45))
	tex.gradient = grad
	var halo := StandardMaterial3D.new()
	halo.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	halo.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	halo.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	halo.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	halo.albedo_texture = tex
	halo.albedo_color = Color(1.0, 0.92, 0.5, 0.8)
	halo.no_depth_test = false
	for p in [EYE_L, EYE_R]:
		var e := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = 0.0065
		s.height = 0.009
		e.mesh = s
		e.material_override = mat
		e.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		e.position = p
		model.add_child(e)
		eyes.append(e)
		var glow := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(0.045, 0.045)
		glow.mesh = q
		glow.material_override = halo
		glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		glow.position = p + Vector3(0, 0, 0.012)
		model.add_child(glow)
		glows.append(glow)
	eye_light = OmniLight3D.new()
	eye_light.light_color = Color(1.0, 0.9, 0.4)
	eye_light.light_energy = 0.25
	eye_light.omni_range = 1.2
	eye_light.position = (EYE_L + EYE_R) * 0.5 + Vector3(0, 0, 0.05)
	model.add_child(eye_light)
	visible = false


func reset() -> void:
	learn = PlayerModel.new(float(game.diff.learnRate))
	state = "dormant"
	st_t = 0.0
	sd = {"wake": _wake_delay()}
	path = []
	detection = 0.0
	sees_player = false
	last_seen = null
	in_vent = false
	ceiling = false
	flip = 0.0
	door_wait = null
	stun = 0.0
	silent_until = 0.0
	ambush_cd = 40.0
	chases = 0
	visible = false


func _wake_delay() -> float:
	match String(game.difficulty):
		"easy": return 75.0
		"hard": return 25.0
		"nightmare": return 10.0
	return 45.0


var now: float:
	get:
		return game.time


var diff: Dictionary:
	get:
		return game.diff


func head_pos() -> Vector3:
	return global_position + Vector3(0, MODEL_HEIGHT * (0.3 if pose == "crawl" else 0.78), 0)


func dist_to_player() -> float:
	var p: Vector3 = game.player.global_position
	return Vector2(p.x - global_position.x, p.z - global_position.z).length() + absf(p.y - global_position.y) * 1.5


func set_state(name: String, data := {}) -> void:
	var prev := state
	state = name
	st_t = 0.0
	sd = data
	if name == "chase" and prev != "chase":
		chases += 1
		game.on_chase_start(data.get("sudden", false))
	if prev == "chase" and name != "chase" and name != "attack":
		game.on_chase_end()


func teleport(f: int, p: Vector3, face := 0.0) -> void:
	floor_index = f
	global_position = Vector3(p.x, house.ground_y(f, p.x, p.z), p.z)
	yaw = face
	body.rotation.y = face
	path = []
	ceiling = false
	flip = 0.0
	in_vent = false
	visible = true


func hide_away() -> void:
	visible = false
	path = []


# ================================================================ movement
func go_to(f: int, target: Vector3, spd: float, how := "walk", opts := {}) -> bool:
	var o := {"vents": opts.get("vents", false), "break_doors": float(diff.doorBreak) > 0.0 and learn.lock_habit() * float(diff.doorBreak) > 0.2}
	var p := nav.find_path(floor_index, global_position, f, target, o)
	if p.is_empty() and not o.vents:
		o.vents = true
		p = nav.find_path(floor_index, global_position, f, target, o)
	if p.is_empty() and float(diff.doorBreak) > 0.0 and not o.break_doors:
		o.break_doors = true
		p = nav.find_path(floor_index, global_position, f, target, o)
	if p.is_empty():
		path = []
		return false
	path = p
	path_i = 0
	move_speed = spd
	pose = how
	door_wait = null
	return true


func stop() -> void:
	path = []


func arrived() -> bool:
	return path.is_empty()


func _move(dt: float) -> void:
	if stun > 0.0:
		speed = 0.0
		return
	if path.is_empty():
		speed = lerpf(speed, 0.0, minf(1.0, dt * 6.0))
		return
	var wp: Dictionary = path[path_i]
	# a door in the way?
	var door = wp.door
	if door != null and not door.is_passable():
		if _handle_door(door, dt):
			return
	if wp.vent:
		_enter_vent(wp)
		return
	var target: Vector3 = wp.pos
	var to := target - global_position
	var flat := Vector2(to.x, to.z)
	var d := flat.length()
	var step := move_speed * dt
	speed = lerpf(speed, move_speed, minf(1.0, dt * 5.0))
	if d <= step or d < 0.05:
		global_position = target
		floor_index = int(wp.f)
		path_i += 1
		if path_i >= path.size():
			path = []
		return
	var dir := flat / d
	var next := global_position + Vector3(dir.x, 0, dir.y) * step
	# height follows the ramp between waypoints
	next.y = lerpf(global_position.y, target.y, step / d)
	global_position = next
	yaw = _turn(yaw, atan2(dir.x, dir.y), dt * 7.0)


func _handle_door(door: Door, dt: float) -> bool:
	if door_wait == null or door_wait.door != door:
		door_wait = {"door": door, "t": 0.0, "hits": 0}
		# walk up to it first
	var side := door.side_of(global_position)
	var ap := door.approach_point(side, 0.55)
	var to := Vector2(ap.x - global_position.x, ap.z - global_position.z)
	if to.length() > 0.2:
		var step := move_speed * dt
		var dir := to.normalized()
		global_position += Vector3(dir.x, 0, dir.y) * minf(step, to.length())
		yaw = _turn(yaw, atan2(dir.x, dir.y), dt * 7.0)
		return true
	var face := atan2(door.center.x - global_position.x, door.center.z - global_position.z)
	yaw = _turn(yaw, face, dt * 8.0)
	door_wait.t += dt
	if door.can_be_opened_by(true):
		if door.target < 1.0:
			door.open_door("cat", "burst" if state == "chase" else ("quiet" if state == "ambush" else "normal"))
		return true
	if door.barricade > 0.0 or (door.locked and door.breakable and float(diff.doorBreak) > 0.0):
		pose = "pound"
		var every := 1.1 if door.barricade > 0.0 else maxf(0.6, float(diff.doorBreakTime) / 4.0)
		if door_wait.t > every:
			door_wait.t = 0.0
			door_wait.hits += 1
			if door.hit(1.0):
				door.open_door("cat", "burst")
		return true
	# can't get through: find another way
	door_wait = null
	var goal: Dictionary = path[path.size() - 1]
	path = []
	if not go_to(int(goal.f), goal.pos, move_speed, pose, {"vents": true}):
		_on_path_failed()
	return true


func _enter_vent(wp: Dictionary) -> void:
	in_vent = true
	visible = false
	var from := global_position
	vent_to = wp
	vent_t = maxf(1.5, from.distance_to(wp.pos) / 2.4)
	game.sfx.play("ventScratch", from + Vector3(0, 0.3, 0), 0.7)
	game.noise(from, 5.0, "vent", "cat")


func _update_vent(dt: float) -> void:
	vent_t -= dt
	if fmod(vent_t, 0.9) < dt:
		var mid: Vector3 = global_position.lerp(vent_to.pos, 0.5)
		game.sfx.play("ventScratch", mid + Vector3(0, 1.5, 0), 0.5)
	if vent_t <= 0.0:
		in_vent = false
		visible = true
		global_position = vent_to.pos
		floor_index = int(vent_to.f)
		game.sfx.play("rattle", global_position + Vector3(0, 0.3, 0), 0.7, 1.4)
		path_i += 1
		if path_i >= path.size():
			path = []


func _turn(a: float, b: float, max_step: float) -> float:
	var d := wrapf(b - a, -PI, PI)
	return a + clampf(d, -max_step, max_step)


# ================================================================ senses
func _perceive(dt: float) -> void:
	var p: Player = game.player
	if not visible or in_vent or state == "attack" or p.dead or p.hiding != null or state == "dormant":
		sees_player = false
		detection = maxf(0.0, detection - dt * 0.3)
		return
	var vis := _visibility()
	sees_player = vis > 0.0
	var mood := 1.0 if house.power else float(diff.outageAggro)
	if vis > 0.0:
		detection = minf(1.2, detection + vis * dt * 2.4 * float(diff.detectRate) * mood)
		if detection > 0.3:
			last_seen = {"pos": p.global_position, "f": p.floor_index, "time": now}
	else:
		detection = maxf(0.0, detection - dt * (0.12 if state == "chase" else 0.3))


func _visibility() -> float:
	var p: Player = game.player
	var eye := head_pos()
	var target: Vector3 = p.global_position + Vector3(0, p.eye * 0.8, 0)
	var to := target - eye
	var dist := to.length()
	if absf(p.global_position.y - global_position.y) > 2.4 and dist > 3.0:
		return 0.0
	var fwd := Vector2(sin(yaw + twitch.y * 0.5), cos(yaw))
	var cos_a := fwd.dot(Vector2(to.x, to.z).normalized())
	var half := deg_to_rad(float(diff.sightFov)) * 0.5
	var angle_k := 1.0 if cos_a > cos(half) else (0.3 if cos_a > cos(minf(PI * 0.85, half * 1.6)) else 0.0)
	if dist < 1.6:
		angle_k = maxf(angle_k, 0.8)
	if angle_k <= 0.0:
		return 0.0
	var light := 0.12 + house.light_at(p.room, p.global_position)
	if p.flash_on:
		light += 0.5
		var to_cat: Vector3 = (eye - p.cam.global_position).normalized()
		if to_cat.dot(-p.cam.global_transform.basis.z) > 0.85:
			light += 1.2 + learn.light_reliance()
	light = minf(2.0, light)
	var sight_range := float(diff.sightRange) * (0.35 + 0.65 * minf(1.0, light))
	if dist > sight_range:
		return 0.0
	if not house.line_clear(eye, target) and not house.line_clear(eye, p.global_position + Vector3(0, p.eye, 0)):
		return 0.0
	if dist < 1.8:
		return 3.0
	var stance_k := 0.3 if p.stance == "prone" else (0.55 if p.stance == "crouch" else 1.0)
	var move_k := 0.55 + minf(0.65, p.moving / 3.0)
	var near := pow(1.0 - dist / sight_range, 1.3)
	return angle_k * stance_k * move_k * (0.35 + light * 0.65) * (0.35 + near * 1.6)


func _check_visible_to_player() -> void:
	if not visible or in_vent:
		visible_to_player = false
		return
	var cam: Camera3D = game.player.cam
	var chest := head_pos() - Vector3(0, 0.3, 0)
	if cam.is_position_behind(chest):
		visible_to_player = false
		return
	var sp := cam.unproject_position(chest)
	var vp: Vector2 = game.get_viewport().get_visible_rect().size
	visible_to_player = sp.x > 0 and sp.y > 0 and sp.x < vp.x and sp.y < vp.y and house.line_clear(cam.global_position, chest)


## Every noise in the house comes through here.
func hear(n: Dictionary) -> void:
	if disabled or n.source == "cat" or state in ["attack", "recoil", "dormant"] and not (state == "dormant" and float(n.radius) >= 12.0):
		return
	var d := diff
	var mood := 1.0 if house.power else float(d.outageAggro)
	var eff: float = float(n.radius) * float(d.hearing) * mood
	var df := absi(int(n.f) - floor_index)
	eff -= df * 6.0
	if not house.line_clear(n.pos + Vector3(0, 0.5, 0), head_pos()):
		eff -= 3.5
	var dist := (n.pos as Vector3).distance_to(global_position)
	if eff <= 0.0 or dist > eff:
		return
	var strength := (eff - dist) / eff
	if state == "dormant":
		if strength > 0.2:
			_wake(n)
		return
	if state == "chase" and sees_player:
		return
	if n.kind == "distraction":
		var sus := learn.distraction_suspicion(now, d)
		if randf() < sus:
			if n.from != null and randf() < 0.4 + float(d.deception) * 0.5:
				_investigate(int(n.f), n.from, true, "sawThrough")
				game.hud.subtitle("[it did not fall for it]")
			elif randf() < 0.5:
				game.sfx.play("laugh", head_pos(), 0.6)
			return
	if state == "check":
		if n.kind == "gasp":
			sd.heard_gasp = true
		return
	if state == "chase":
		if strength > 0.2:
			last_seen = {"pos": n.pos, "f": n.f, "time": now}
		return
	if state in ["stare", "ambush"]:
		if strength > 0.5 and dist < 8.0:
			_investigate(int(n.f), n.pos, true, n.kind)
		return
	if state == "investigate" and sd.get("strength", 0.0) > strength + 0.2:
		return
	_investigate(int(n.f), n.pos, strength > 0.55 or float(n.radius) >= 14.0, n.kind, strength)


# ================================================================ brain
func update(dt: float) -> void:
	if disabled or game.state != "playing":
		return
	st_t += dt
	ambush_cd -= dt
	stun = maxf(0.0, stun - dt)
	perc_t -= dt
	if perc_t <= 0.0:
		perc_t = 0.1
		_perceive(0.1)
		_check_visible_to_player()
	if in_vent:
		_update_vent(dt)
	else:
		_think(dt)
		_move(dt)
	_vocalise(dt)
	_animate(dt)
	learn.tick(dt, game.player.room, game.player.flash_on)


func _think(dt: float) -> void:
	var p: Player = game.player
	if not state in ["attack", "recoil", "dormant", "check", "stare"] and detection >= 1.0 and p.hiding == null and state != "chase":
		_start_chase(state == "ambush")
		return
	match state:
		"dormant": _st_dormant()
		"patrol": _st_patrol(dt)
		"investigate": _st_investigate(dt)
		"chase": _st_chase(dt)
		"search": _st_search(dt)
		"check": _st_check(dt)
		"stare": _st_stare(dt)
		"ambush": _st_ambush(dt)
		"recoil": _st_recoil()


func _on_path_failed() -> void:
	if state == "chase":
		_start_search(last_seen.pos if last_seen else global_position)
	elif state == "check":
		_start_search(global_position, true)
	else:
		set_state("patrol")


# ---------------------------------------------------------------- dormant
func _st_dormant() -> void:
	if st_t > float(sd.get("wake", 45.0)):
		emerge()


func _wake(n: Dictionary) -> void:
	emerge(game.house.room_at(int(n.f), n.pos))
	_investigate(int(n.f), n.pos, false, n.kind, 0.5)


## Bring the cat into the house somewhere away from the player (through a vent).
func emerge(near_room := -1) -> void:
	var p: Player = game.player
	var cands: Array = []
	for v in nav.vent_by_node.values():
		var m: Vector3 = v.mouth_v
		var d := Vector2(m.x - p.global_position.x, m.z - p.global_position.z).length() + absi(int(v.f) - p.floor_index) * 6.0
		if near_room >= 0:
			var r: Dictionary = house.rooms[near_room]
			if int(v.f) != int(r.floor) or Vector2(m.x - r.cx, m.z - r.cz).length() > 14.0:
				continue
		if d > 9.0 and not game.can_player_see(m + Vector3(0, 1, 0)):
			cands.append(v)
	if cands.is_empty():
		for v in nav.vent_by_node.values():
			cands.append(v)
	var v: Dictionary = cands.pick_random()
	var n: Vector3 = Vector3(v.normal[0], 0, v.normal[2])
	teleport(int(v.f), v.mouth_v, atan2(n.x, n.z))
	game.sfx.play("rattle", v.pos_v, 0.7, 1.4)
	set_state("patrol")


# ---------------------------------------------------------------- patrol
func _st_patrol(dt: float) -> void:
	if not arrived():
		return
	if not sd.has("wait"):
		sd.wait = randf_range(1.0, 4.0)
		pose = "stand"
	sd.wait -= dt
	if sd.wait > 0.0:
		return
	sd.erase("wait")
	if ambush_cd <= 0.0 and randf() < float(diff.ambush) * 2.0:
		_start_ambush()
		return
	if ambush_cd <= 0.0 and randf() < 0.25 and _start_stare():
		return
	# weighted towards the rooms you like
	var rooms: Array = house.rooms.filter(func(r): return r.kind != "stairs" and r.key != "0Z" and r.cells.size() > 1)
	var total := 0.0
	for r in rooms:
		total += learn.room_weight(int(r.index))
	var pick := randf() * total
	var room: Dictionary = rooms[0]
	for r in rooms:
		pick -= learn.room_weight(int(r.index))
		if pick <= 0.0:
			room = r
			break
	var pt := nav.random_point_in_room(int(room.index))
	if pt.is_empty() or not go_to(int(pt.f), pt.pos, float(diff.catWalk), "walk"):
		sd.wait = 1.0


# ---------------------------------------------------------------- investigate
func _investigate(f: int, pos: Vector3, urgent: bool, kind: String, strength := 0.5) -> void:
	var ok := go_to(f, pos, float(diff.catRun) * 0.92 if urgent else float(diff.catWalk) * 1.35, "run" if urgent else "stalk", {"vents": urgent and randf() < float(diff.ventUse) * 0.5})
	if not ok:
		return
	set_state("investigate", {"f": f, "pos": pos, "urgent": urgent, "kind": kind, "strength": strength, "look": 0.0})
	if urgent:
		game.sfx.play("growl", head_pos(), 0.8)


func _st_investigate(dt: float) -> void:
	if not arrived():
		return
	sd.look += dt
	pose = "sniff" if sd.look < 1.8 else "stand"
	if sd.look > 2.6:
		if sd.kind == "distraction":
			learn.record_fooled(now)
		_start_search(sd.pos, true, sd.kind in ["gasp", "breath", "hide"])


# ---------------------------------------------------------------- chase
func _start_chase(sudden := false) -> void:
	var p: Player = game.player
	detection = 1.0
	last_seen = {"pos": p.global_position, "f": p.floor_index, "time": now}
	set_state("chase", {"repath": 0.0, "lost": 0.0, "sudden": sudden})
	ceiling = false
	silent_until = 0.0


func _st_chase(dt: float) -> void:
	var p: Player = game.player
	var d := diff
	sd.repath -= dt
	var dist := dist_to_player()
	if sees_player:
		sd.lost = 0.0
	else:
		sd.lost += dt
	# grab
	if sees_player and dist < float(d.grabRange) and p.hiding == null:
		_start_attack("chase")
		return
	if p.hiding != null and sd.lost > 0.3:
		if sd.get("saw_hide", false):
			_start_check(p.hiding.spot, true)
			return
	if sd.lost > float(d.loseTrack):
		game.hud.subtitle("[it lost your trail]")
		_start_search(last_seen.pos if last_seen else global_position)
		return
	var spd := minf(float(d.catRunMax), float(d.catRun) + st_t * 0.05)
	var goal: Vector3 = p.global_position if sees_player else last_seen.pos
	var gf: int = p.floor_index if sees_player else int(last_seen.f)
	if sees_player and gf == floor_index and dist < 5.0 and house.line_clear(global_position + Vector3(0, 0.5, 0), p.global_position + Vector3(0, 0.5, 0), House.LAYER_SOLID):
		# straight at you
		path = [{"pos": Vector3(goal.x, house.ground_y(gf, goal.x, goal.z), goal.z), "f": gf, "door": null, "vent": false, "stair": false}]
		path_i = 0
		move_speed = spd
		pose = "run"
		return
	if sd.repath <= 0.0 or arrived():
		sd.repath = 0.4
		if not go_to(gf, goal, spd, "run"):
			_on_path_failed()


# ---------------------------------------------------------------- search
func _start_search(center: Vector3, short := false, heard_noise := false) -> void:
	set_state("search", {"center": center, "until": now + float(diff.searchTime) * (0.4 if short else 1.0), "checked": {}, "next": 0.0, "heard_noise": heard_noise})


func _st_search(dt: float) -> void:
	if now > sd.until:
		set_state("patrol")
		return
	if not arrived():
		return
	pose = "sniff"
	sd.next -= dt
	if sd.next > 0.0:
		return
	var best = null
	var best_p := 0.0
	for h in house.hiding_spots:
		if int(h.f) != floor_index or sd.checked.has(h.id) or (h.entry as Vector3).distance_to(sd.center) > 8.0:
			continue
		var near: bool = last_seen != null and (h.entry as Vector3).distance_to(last_seen.pos) < 3.5 and now - float(last_seen.time) < 15.0
		var pr := learn.check_chance(h, diff, {"heard_noise": sd.heard_noise, "last_seen_near": near}) * randf_range(0.8, 1.2)
		if pr > best_p:
			best_p = pr
			best = h
	if best != null:
		sd.checked[best.id] = true
		if randf() < best_p:
			_start_check(best, false, sd)
			return
	var room := house.room_at(floor_index, sd.center)
	if room >= 0:
		var pt := nav.random_point_in_room(room)
		if not pt.is_empty():
			go_to(int(pt.f), pt.pos, float(diff.catWalk) * 1.25, "stalk")
	sd.next = randf_range(0.6, 2.2)
	if randf() < 0.12:
		game.sfx.play("laugh" if randf() < 0.5 else "meow", head_pos(), 0.6)


# ---------------------------------------------------------------- check a hiding spot
func _start_check(spot: Dictionary, saw := false, search := {}) -> void:
	go_to(int(spot.f), spot.entry, float(diff.catRun) if saw else float(diff.catWalk) * 1.3, "run" if saw else "stalk")
	set_state("check", {"spot": spot, "phase": "approach", "saw": saw, "search": search, "t2": 0.0, "heard_gasp": false, "purr": 0.0})


func _st_check(dt: float) -> void:
	var spot: Dictionary = sd.spot
	var p: Player = game.player
	var inside: bool = p.hiding != null and p.hiding.spot == spot
	if sd.phase == "approach":
		if not inside and sees_player and detection > 0.6:
			_start_chase()
			return
		if arrived() or st_t > 14.0:
			sd.phase = "sniff"
			sd.t2 = 0.0
			sd.sniff = 0.4 if sd.saw else randf_range(1.2, 3.2)
		return
	yaw = _turn(yaw, atan2(spot.inside.x - global_position.x, spot.inside.z - global_position.z), dt * 6.0)
	sd.t2 += dt
	if sd.phase == "sniff":
		pose = "lookUnder" if spot.type == "bed" else "sniff"
		if inside:
			sd.purr -= dt
			if sd.purr <= 0.0:
				sd.purr = 1.6
				game.sfx.play("purr", head_pos(), 0.7)
			if p.holding_breath:
				sd.sniff += dt * 0.3
		if sd.t2 > sd.sniff:
			var open := true
			if not sd.saw and inside and p.holding_breath and not sd.heard_gasp:
				open = randf() < 0.55 + float(diff.deception) * 0.3
			if not open:
				sd.phase = "leave"
				return
			sd.phase = "open"
			sd.t2 = 0.0
			game.sfx.play(p._hide_sound(spot.type), spot.inside, 0.9, 0.8)
		return
	if sd.phase == "open":
		pose = "lookUnder" if spot.type == "bed" else "reach"
		if sd.t2 > 0.45:
			if inside:
				_start_attack("hide", spot)
				return
			sd.phase = "leave"
		return
	# nothing there
	if sd.search is Dictionary and sd.search.has("until"):
		var s: Dictionary = sd.search
		s.next = 0.5
		state = "search"
		sd = s
	else:
		_start_search(global_position, true)


## Called when the player gets into a hiding spot.
func notice_hide(spot: Dictionary) -> bool:
	if not visible or in_vent:
		learn.record_hide(spot.id, false)
		return false
	var seen: bool = sees_player or (state == "chase" and sd.lost < 0.6 and dist_to_player() < 9.0)
	var caught: bool = seen and randf() < float(diff.checkSeenEntering)
	learn.record_hide(spot.id, caught)
	if caught and state == "chase":
		sd.saw_hide = true
	elif caught:
		_start_check(spot, true)
	return caught


# ---------------------------------------------------------------- stare
## Stand at the end of a hallway in the dark, watching. Then either charge or vanish.
func _start_stare() -> bool:
	var p: Player = game.player
	var cam: Camera3D = p.cam
	var fwd := -cam.global_transform.basis.z
	fwd.y = 0
	fwd = fwd.normalized()
	for d in [9.0, 8.0, 7.0, 6.0, 10.0, 11.0]:
		var at: Vector3 = p.global_position + fwd * d
		var n := nav.node_at(p.floor_index, at)
		if n < 0 or nav.nodes[n].blocked or nav.nodes[n].stair:
			continue
		var pos: Vector3 = nav.nodes[n].pos
		if not house.line_clear(cam.global_position, pos + Vector3(0, 1.4, 0)):
			continue
		teleport(p.floor_index, pos, atan2(p.global_position.x - pos.x, p.global_position.z - pos.z))
		stop()
		set_state("stare", {"dur": randf_range(3.5, 9.0), "lit": 0.0})
		silent_until = now + 30.0
		ambush_cd = 60.0
		return true
	return false


func _st_stare(dt: float) -> void:
	var p: Player = game.player
	pose = "stare"
	yaw = _turn(yaw, atan2(p.global_position.x - global_position.x, p.global_position.z - global_position.z), dt * 1.5)
	var dist := dist_to_player()
	if p.flash_on and visible_to_player:
		sd.lit += dt
	var provoke: bool = dist < 5.5 or sd.lit > 0.9
	if provoke or st_t > sd.dur:
		if provoke and randf() < 0.35 + float(diff.deception) * 0.5:
			_start_chase(true)
			return
		if not visible_to_player or randf() < 0.5:
			hide_away()
			set_state("dormant", {"wake": randf_range(6.0, 14.0)})
		else:
			set_state("patrol")


# ---------------------------------------------------------------- ambush
func _start_ambush() -> void:
	ambush_cd = 45.0 / (0.5 + float(diff.ambush))
	var p: Player = game.player
	var favs := learn.favourite_rooms(4).filter(func(r): return r != p.room and house.rooms[r].key != "0Z")
	if favs.is_empty():
		return
	var room: int = favs.pick_random()
	var pt := nav.random_point_in_room(room)
	if pt.is_empty() or not go_to(int(pt.f), pt.pos, float(diff.catWalk) * 1.5, "crawl", {"vents": randf() < float(diff.ventUse)}):
		return
	set_state("ambush", {"room": room, "ceiling": randf() < 0.35 + float(diff.deception) * 0.3, "wait": randf_range(25.0, 45.0), "lurking": false})
	silent_until = now + 60.0


func _st_ambush(dt: float) -> void:
	var p: Player = game.player
	if not arrived():
		pose = "crawl"
		return
	if not sd.lurking:
		sd.lurking = true
		ceiling = sd.ceiling
	pose = "crawl" if ceiling else "lookUnder"
	sd.wait -= dt
	var dist := dist_to_player()
	if (dist < 3.2 and p.hiding == null and absf(p.global_position.y - global_position.y) < 2.5) or (visible_to_player and dist < 9.0):
		ceiling = false
		game.on_ambush()
		_start_chase(true)
		return
	if sd.wait <= 0.0:
		ceiling = false
		set_state("patrol")


# ---------------------------------------------------------------- attack
func _start_attack(kind: String, spot = null) -> void:
	set_state("attack", {"kind": kind})
	stop()
	ceiling = false
	game.on_cat_attack(kind, spot)


func recoil() -> void:
	stun = 2.6
	set_state("recoil")
	game.sfx.play("hiss", head_pos(), 0.9)
	var back: Vector3 = global_position - game.player.global_position
	back.y = 0
	global_position += back.normalized() * 0.8


func _st_recoil() -> void:
	pose = "crawl"
	if stun <= 0.0:
		_start_chase()


# ================================================================ presentation
func _vocalise(dt: float) -> void:
	if not visible or in_vent:
		return
	var silent := now < silent_until
	if speed > 0.3:
		var prev := step_phase
		step_phase = fmod(step_phase + dt * speed * 0.9, 1.0)
		if step_phase < prev and not silent:
			var running := speed > 3.0
			game.sfx.play("catStepRun" if running else "catStepSoft", global_position + Vector3(0, 0.1, 0), 0.85 if running else 0.35)
			if running:
				game.noise(global_position, 3.0, "step", "cat")
	vocal_t -= dt
	if vocal_t <= 0.0:
		vocal_t = randf_range(7.0, 16.0)
		if state == "patrol" and not silent and randf() < 0.4:
			game.sfx.play(["meow", "laugh", "whisper"].pick_random(), head_pos(), 0.6)
		elif state == "chase" and randf() < 0.6:
			game.sfx.play(["laugh", "growl", "hiss"].pick_random(), head_pos(), 0.9)


func _animate(dt: float) -> void:
	body.rotation.y = yaw
	var t := now
	var moving := speed > 0.2 and not path.is_empty()
	var ph := t * (speed * 2.4 + 0.5)
	var lean := 0.06
	var lift := 0.0
	var roll := 0.0
	var bob := 0.0
	match pose:
		"run":
			lean = 0.42
			bob = absf(sin(ph * 1.2)) * 0.1
			roll = sin(ph * 1.2) * 0.07
		"stalk":
			lean = 0.3
			bob = absf(sin(ph)) * 0.03
			roll = sin(ph) * 0.05
			lift = -0.12
		"crawl":
			lean = 1.32
			lift = -0.05
			bob = absf(sin(ph * 1.6)) * 0.04
			roll = sin(ph * 1.6) * 0.1
		"sniff", "lookUnder":
			lean = 0.55 if pose == "sniff" else 0.95
			lift = -0.1
			roll = sin(t * 2.3) * 0.08
		"reach", "pound":
			lean = 0.2 + (absf(sin(t * 9.0)) * 0.15 if pose == "pound" else 0.0)
		"stare":
			lean = 0.0
			roll = 0.16
		_:
			if moving:
				bob = absf(sin(ph)) * 0.04
				roll = sin(ph) * 0.05
			else:
				bob = sin(t * 1.6) * 0.01
	# unnatural twitches: sudden jerks that snap back
	twitch_t -= dt
	if twitch_t <= 0.0:
		twitch_t = randf_range(0.8, 3.5) / (2.0 if state == "chase" or state == "stare" else 1.0)
		twitch = Vector3(randf_range(-0.12, 0.12), randf_range(-0.35, 0.35), randf_range(-0.15, 0.15))
	twitch = twitch.lerp(Vector3.ZERO, minf(1.0, dt * 9.0))
	flip = lerpf(flip, 1.0 if ceiling else 0.0, minf(1.0, dt * 5.0))
	var target := Vector3(lean + twitch.x, twitch.y, roll + twitch.z)
	pose_root.rotation = pose_root.rotation.lerp(target, minf(1.0, dt * 8.0))
	pose_root.position.y = lift + bob
	# on the ceiling: hang upside down under it
	if flip > 0.01:
		var ceil_y: float = float(house.base_y[floor_index]) + float(house.ceil_h[floor_index])
		body.position.y = lerpf(0.0, ceil_y - global_position.y, flip)
		body.rotation.z = PI * flip
	else:
		body.position.y = 0.0
		body.rotation.z = 0.0
	var glow := 6.0 if state in ["chase", "stare", "ambush"] else 3.5
	(eyes[0] as MeshInstance3D).material_override.emission_energy_multiplier = glow
	(glows[0] as MeshInstance3D).material_override.albedo_color.a = 0.95 if glow > 4.0 else 0.6
