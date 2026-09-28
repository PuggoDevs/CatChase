## The Cat's House (Godot port): sets up the world, runs the night, routes
## noises to the cat, and handles death and escape.
extends Node3D

const DEATH_LINES := {
	"chase": ["It was faster than you.", "Long fingers closed around your shoulders.", "Its grin kept getting wider. And wider."],
	"hide": ["It knew where you were hiding. It always knows.", "The doors swung open. It was smiling.", "Found you."],
}
const FRONT_ENDING := "The chain falls away and the door swings open onto the rain.\nYou run down the path without looking back. You almost make it to the gate before you do.\nIn the window above the door, something tall is standing very still. Waving."

## Set before reloading the scene to jump straight into a new night.
static var pending_difficulty := ""

var data: Dictionary
var house: House
var items: Items
var player: Player
var cat: Cat
var sfx: Sfx
var hud: Hud
var env: WorldEnvironment
var settings := {"sensitivity": 1.0}
var state := "menu"          # menu | playing | paused | dying | struggle | ended | dead
var difficulty := "normal"
var diff: Dictionary
var rng := RandomNumberGenerator.new()
var time := 0.0
var run_time := 0.0
var last_room := -1
var visited := {}
var menu_t := 0.0
var director_t := 20.0
var scare := 0.0
var death := {}
var struggle := {}
var struggles_left := 0
var escaping := {}
var test_mode := false


func _ready() -> void:
	# menus keep working while the night is paused; the world does not
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_input()
	test_mode = OS.get_cmdline_user_args().has("--test")
	data = JSON.parse_string(FileAccess.get_file_as_string("res://data/house.json"))
	sfx = Sfx.new()
	add_child(sfx)
	_setup_environment()
	house = House.new()
	house.name = "House"
	add_child(house)
	house.build(self, data)
	items = Items.new()
	items.name = "Items"
	add_child(items)
	items.setup(self)
	player = Player.new()
	player.name = "Player"
	add_child(player)
	player.setup(self)
	cat = Cat.new()
	cat.name = "Cat"
	add_child(cat)
	cat.setup(self)
	hud = Hud.new()
	add_child(hud)
	hud.setup(self)
	for n in [house, items, player, cat, sfx]:
		n.process_mode = Node.PROCESS_MODE_PAUSABLE
	diff = data.difficulties.normal
	if pending_difficulty != "":
		var d := pending_difficulty
		pending_difficulty = ""
		_begin(d)
	else:
		_enter_menu()


func _setup_input() -> void:
	var keys := {
		"move_forward": [KEY_W, KEY_UP], "move_back": [KEY_S, KEY_DOWN], "move_left": [KEY_A], "move_right": [KEY_D],
		"turn_left": [KEY_LEFT], "turn_right": [KEY_RIGHT], "sprint": [KEY_SHIFT], "crouch": [KEY_C, KEY_CTRL],
		"prone": [KEY_Z, KEY_X], "interact": [KEY_E, KEY_ENTER], "flashlight": [KEY_F], "throw": [KEY_G],
		"slam": [KEY_R], "lock": [KEY_L], "barricade": [KEY_B], "breath": [KEY_SPACE], "pause": [KEY_ESCAPE, KEY_P],
		"inventory": [KEY_TAB, KEY_I],
	}
	for action in keys:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for k in keys[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
	var mb := InputEventMouseButton.new()
	mb.button_index = MOUSE_BUTTON_LEFT
	InputMap.action_add_event("throw", mb)


func _setup_environment() -> void:
	env = WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.01, 0.012, 0.02)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.32, 0.36, 0.5)
	e.ambient_light_energy = 0.12
	e.tonemap_mode = Environment.TONE_MAPPER_ACES
	e.tonemap_exposure = 1.1
	e.glow_enabled = true
	e.glow_intensity = 0.7
	e.glow_bloom = 0.05
	e.glow_hdr_threshold = 1.2
	e.ssao_enabled = true
	e.ssao_radius = 1.2
	e.ssao_intensity = 1.6
	e.volumetric_fog_enabled = true
	e.volumetric_fog_density = 0.028
	e.volumetric_fog_albedo = Color(0.55, 0.56, 0.6)
	e.volumetric_fog_emission = Color(0.0, 0.0, 0.0)
	e.volumetric_fog_length = 32.0
	e.adjustment_enabled = true
	e.adjustment_saturation = 0.82
	e.adjustment_contrast = 1.08
	env.environment = e
	add_child(env)
	# the moon through the windows
	var moon := DirectionalLight3D.new()
	moon.light_color = Color(0.55, 0.62, 0.85)
	moon.light_energy = 0.18
	moon.rotation = Vector3(deg_to_rad(-38), deg_to_rad(30), 0)
	moon.shadow_enabled = true
	moon.light_volumetric_fog_energy = 0.6
	add_child(moon)


func player_start_pos() -> Vector3:
	var s: Dictionary = data.playerStart
	return Vector3(s.x, house.ground_y(int(s.f), s.x, s.z), s.z)


# ------------------------------------------------------------------ flow
func _enter_menu() -> void:
	state = "menu"
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	player.reset(Vector3(17.5, house.ground_y(2, 17.5, 9.0), 9.0), PI * 0.5)
	cat.reset()
	cat.teleport(2, Vector3(27.5, 3.2, 9.5), -PI * 0.5)
	cat.pose = "stare"
	hud.set_playing(false)
	hud.show_menu()


func to_menu() -> void:
	get_tree().paused = false
	pending_difficulty = ""
	get_tree().reload_current_scene()


func start_run(d: String) -> void:
	# a fresh house every night: reload the scene and begin straight away
	get_tree().paused = false
	pending_difficulty = d
	get_tree().reload_current_scene()


func _begin(d: String) -> void:
	difficulty = d
	diff = data.difficulties[d]
	rng.randomize()
	time = 0.0
	run_time = 0.0
	struggles_left = int(diff.struggles)
	var s: Dictionary = data.playerStart
	player.reset(player_start_pos(), float(s.yaw))
	cat.reset()
	items.populate(rng, diff)
	hud.hide_screen()
	hud.set_playing(true)
	state = "playing"
	if not test_mode:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	hud.hint("You wake in a stranger's house. Find a way out. Something else is awake too.")
	sfx.loop("water", 0.05)


func pause() -> void:
	if state != "playing":
		return
	state = "paused"
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	hud.show_pause()


func resume() -> void:
	get_tree().paused = false
	hud.hide_screen()
	state = "playing"
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if state == "playing":
		if event.is_action_pressed("pause"):
			pause()
		elif event.is_action_pressed("inventory"):
			hud.toggle_inventory()
		elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif state == "paused" and event.is_action_pressed("pause"):
		resume()
	elif state == "struggle" and event.is_action_pressed("interact"):
		struggle.meter = minf(1.0, struggle.meter + 0.11)


func _physics_process(dt: float) -> void:
	if get_tree().paused:
		return
	time += dt
	match state:
		"menu":
			_update_menu(dt)
		"playing":
			run_time += dt
			house.update(dt, time)
			cat.update(dt)
			_director(dt)
			_update_fear(dt)
			if player.room != last_room and player.room >= 0:
				last_room = player.room
				if not visited.has(player.room):
					visited[player.room] = true
					hud.show_room(house.room_name(player.room))
		"dying":
			house.update(dt, time)
			_update_death(dt)
		"struggle":
			_update_struggle(dt)
		"escaping":
			house.update(dt, time)
			_update_escape(dt)
	hud.update(dt)


func _update_menu(dt: float) -> void:
	menu_t += dt
	house.update(dt, time)
	# a slow drift down the upstairs hall, towards the thing at the end of it
	var cam := player.cam
	cam.global_position = Vector3(18.0 + sin(menu_t * 0.07) * 0.3 + menu_t * 0.02, 4.7, 9.5)
	cam.global_rotation = Vector3(-0.05, -PI * 0.5 + sin(menu_t * 0.11) * 0.06, 0)
	cat._animate(dt)


# ------------------------------------------------------------------ noises
## Something made a sound. `source` is "player", "cat", "house" or "distraction".
func noise(pos: Vector3, radius: float, kind: String, source := "player", from = null) -> void:
	if state != "playing":
		return
	var f := house.floor_at(pos + Vector3(0, 0.3, 0), player.floor_index)
	# a thrown object is the player's noise, but the cat may learn to see through it
	var n := {"pos": pos, "radius": radius, "kind": "distraction" if source == "distraction" else kind, "source": "player" if source == "distraction" else source, "f": f, "from": from, "time": time}
	cat.hear(n)


func can_player_see(p: Vector3) -> bool:
	var cam := player.cam
	if cam.is_position_behind(p):
		return false
	var sp := cam.unproject_position(p)
	var vp := get_viewport().get_visible_rect().size
	if sp.x < -40 or sp.y < -40 or sp.x > vp.x + 40 or sp.y > vp.y + 40:
		return false
	return house.line_clear(cam.global_position, p)


func learn_lock() -> void:
	cat.learn.record_lock()


# ------------------------------------------------------------------ events from the player / cat
func on_player_hide(spot: Dictionary) -> void:
	if cat.notice_hide(spot) and float(diff.checkSeenEntering) >= 1.0:
		hud.subtitle("[it saw you]")


func on_player_unhide() -> void:
	pass


func on_pickup(kind: String) -> void:
	match kind:
		"key_front":
			hud.hint("The front door key. The door is chained too - you'll need something to cut it.")
		"bolt_cutters":
			hud.hint("Bolt cutters. Strong enough for a chain. Loud enough to wake anything.")
		"plank":
			hud.hint("B at a closed door to barricade it. It won't hold forever.")
		"battery":
			if not player.has_flashlight:
				hud.hint("Batteries. For a flashlight, if you can find one.")


func on_chase_start(sudden: bool) -> void:
	sfx.play_flat("stinger", 0.9 if sudden else 0.6)
	player.add_shake(0.05)
	scare = 1.0
	if cat.chases == 1:
		hud.hint("RUN. Break its line of sight, slam doors behind you, then hide.")


func on_chase_end() -> void:
	pass


func on_ambush() -> void:
	sfx.play_flat("stinger", 1.0)
	player.add_shake(0.08)
	scare = 1.0


func _update_fear(dt: float) -> void:
	var d := cat.dist_to_player() if cat.visible and not cat.in_vent else 99.0
	var chase := 1.0 if cat.state == "chase" else 0.0
	var near := clampf(1.0 - d / 12.0, 0.0, 1.0)
	scare = maxf(0.0, scare - dt * 0.4)
	var target := maxf(maxf(chase * 0.8, near * 0.9), scare)
	player.fear = lerpf(player.fear, target, minf(1.0, dt * 2.0))
	sfx.loop("heartbeat", player.fear * 0.8, 0.9 + player.fear * 0.5)
	if player.fear > 0.6:
		player.add_shake(0.004 * player.fear)


# ------------------------------------------------------------------ director
func _director(dt: float) -> void:
	director_t -= dt
	if director_t > 0.0 or cat.state == "chase":
		return
	director_t = rng.randf_range(18.0, 40.0) / maxf(0.5, float(diff.eventRate))
	var roll := rng.randf()
	if roll < 0.3:
		# the lights in your room sputter
		for rec in house.lights:
			if rec.room == player.room:
				rec.stutter = rng.randf_range(0.6, 1.6)
		sfx.play("click", player.global_position + Vector3(0, 2.4, 0), 0.3)
	elif roll < 0.5:
		# a door nearby creaks open by itself
		for door in house.door_list:
			if door.f == player.floor_index and door.is_closed() and not door.locked and door.barricade <= 0.0 and not door.escape \
					and door.center.distance_to(player.global_position) < 9.0:
				door.target = 0.3
				door.speed = 0.12
				door.mode = "quiet"
				sfx.play("creak", door.center, 0.6, 0.7)
				break
	elif roll < 0.68:
		var away := player.global_position + Vector3(rng.randf_range(-8, 8), 0, rng.randf_range(-8, 8))
		sfx.play(["whisper", "laugh", "scratch"][rng.randi_range(0, 2)], away, 0.5)
		hud.subtitle(["[whispering]", "[distant laughter]", "[something scratching in the walls]"][rng.randi_range(0, 2)])
	elif roll < 0.8 and cat.state in ["patrol", "dormant"]:
		# footsteps on the floor above
		var above := player.global_position + Vector3(rng.randf_range(-3, 3), 3.0, rng.randf_range(-3, 3))
		for i in 4:
			get_tree().create_timer(0.55 * i).timeout.connect(func(): sfx.play("catStepRun", above + Vector3(i * 0.7, 0, 0), 0.7))
	elif cat.state == "patrol" and cat.ambush_cd <= 0.0:
		cat._start_stare()


# ------------------------------------------------------------------ getting caught
func on_cat_attack(kind: String, spot) -> void:
	if OS.get_cmdline_user_args().has("--god"):
		cat.recoil()
		return
	player.target = null
	hud.set_prompt(null)
	if kind != "hide" and struggles_left > 0:
		state = "struggle"
		struggle = {"t": 0.0, "meter": 0.3}
		hud.subtitle("[it has you - hammer E to tear free]")
		sfx.play_flat("stinger", 1.0)
		return
	_die(kind, spot)


func _update_struggle(dt: float) -> void:
	struggle.t += dt
	struggle.meter = maxf(0.0, struggle.meter - dt * 0.18)
	hud.set_struggle(struggle.meter)
	player.add_shake(0.03)
	var head := cat.head_pos()
	var cam := player.cam
	cam.look_at(head, Vector3.UP)
	if struggle.meter >= 1.0:
		hud.set_struggle(null)
		struggles_left -= 1
		state = "playing"
		cat.recoil()
		player.stamina = 100.0
		player.exhausted = false
		hud.toast("You tore free! RUN! (%d escape%s left)" % [struggles_left, "" if struggles_left == 1 else "s"])
	elif struggle.t > 3.0:
		hud.set_struggle(null)
		_die("chase", null)


func _die(kind: String, spot) -> void:
	state = "dying"
	player.dead = true
	player.flash_on = false
	player.flash.visible = false
	hud.set_playing(false)
	var cam := player.cam
	var eye := cam.global_position
	var fwd := -cam.global_transform.basis.z
	fwd.y = 0
	fwd = fwd.normalized()
	if spot != null and kind == "hide":
		# the doors open and it's right there
		eye = spot.inside
		var out: Vector3 = (spot.entry - spot.inside)
		out.y = 0
		fwd = out.normalized()
	var at := eye + fwd * 0.9
	cat.teleport(player.floor_index, Vector3(at.x, 0, at.z), atan2(-fwd.x, -fwd.z))
	cat.pose = "reach"
	death = {"t": 0.0, "eye": eye, "kind": kind, "crunched": false}
	sfx.play_flat("stinger", 1.0)


func _update_death(dt: float) -> void:
	death.t += dt
	var cam := player.cam
	var head := cat.head_pos() - Vector3(0, 0.12, 0)
	var t: float = death.t
	# it lunges into your face
	var k := clampf(t / 0.45, 0.0, 1.0)
	var to: Vector3 = (death.eye as Vector3).direction_to(head)
	cam.global_position = death.eye
	cat.global_position = cat.global_position.move_toward(Vector3(death.eye.x, cat.global_position.y, death.eye.z) + Vector3(to.x, 0, to.z) * 0.35, dt * 1.2)
	cam.look_at(head, Vector3.UP)
	player.add_shake(0.06 * k)
	hud.set_red(k * 0.8)
	cat._animate(dt)
	if t > 0.9 and not death.crunched:
		death.crunched = true
		sfx.play_flat("slam", 1.0, 0.6)
		sfx.play_flat("growl", 1.0)
	hud.set_black(clampf((t - 0.9) * 4.0, 0.0, 1.0))
	if t > 2.2:
		state = "dead"
		sfx.stop_all()
		hud.set_red(0.0)
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		var lines: Array = DEATH_LINES.get(death.kind, DEATH_LINES.chase)
		hud.show_death(lines[rng.randi_range(0, lines.size() - 1)])


# ------------------------------------------------------------------ escaping
func try_escape(door: Door) -> void:
	if door.type != "front":
		sfx.play("rattle", door.center, 0.7)
		hud.toast("It won't budge. This way out isn't open in this version yet.")
		return
	var need: Array = []
	if not player.has("key_front"):
		need.append("the front door key")
	if not player.has("bolt_cutters"):
		need.append("something to cut the chain")
	if need.size() > 0:
		sfx.play("rattle", door.center, 0.8)
		noise(door.center, 6.0, "rattle", "player")
		hud.toast("Locked and chained. You need " + " and ".join(need) + ".")
		return
	state = "escaping"
	escaping = {"t": 0.0, "door": door}
	hud.set_playing(false)
	sfx.play("cutting", door.center, 1.0)
	noise(door.center, 20.0, "slam", "player")


func _update_escape(dt: float) -> void:
	escaping.t += dt
	var door: Door = escaping.door
	if escaping.t > 1.6 and door.jammed:
		door.jammed = false
		door.open_door("player", "normal")
		sfx.play("unlock", door.center, 1.0)
	hud.set_black(clampf((escaping.t - 2.6) / 1.2, 0.0, 1.0))
	if escaping.t > 4.0:
		state = "ended"
		sfx.stop_all()
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		hud.show_ending("Out the Front Door", FRONT_ENDING)
