## Renders a few screenshots of the running game (needs a display / xvfb).
## godot --path godot --fixed-fps 30 -s res://tests/shots.gd -- <out_dir>
extends SceneTree

const GameScript := preload("res://scripts/game.gd")

var game
var frame := 0
var step := 0
var wait := 0
var out := "user://"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	current_scene = game


func _shot(name: String) -> void:
	var img := root.get_texture().get_image()
	img.save_png(out.path_join(name + ".png"))
	print("saved ", name)


func _process(_dt: float) -> bool:
	frame += 1
	wait -= 1
	if wait > 0:
		return false
	match step:
		0:
			if frame > 20:
				wait = 40
				step = 1
		1:
			_shot("g_menu")
			game.start_run("normal")
			game = null
			frame = 0
			step = 2
		2:
			game = current_scene
			if game != null and frame > 15 and game.state == "playing":
				game.cat.disabled = true
				var p = game.player
				p.has_flashlight = true
				p.flash_on = true
				p.yaw = PI * 0.5 + 0.9
				p.pitch = -0.15
				wait = 40
				step = 3
		3:
			_shot("g_wake")
			var p = game.player
			# the upstairs hall, with it standing at the far end
			p.global_position = Vector3(14.5, 3.21, 9.5)
			p.yaw = -PI * 0.5
			p.pitch = 0.0
			p.flash_on = true
			game.cat.disabled = true
			game.cat.teleport(2, Vector3(21.5, 3.2, 9.5), -PI * 0.5)
			game.cat.pose = "stare"
			wait = 40
			step = 4
		4:
			_shot("g_hall")
			var p = game.player
			game.cat.teleport(2, Vector3(16.3, 3.2, 9.5), -PI * 0.5)
			game.cat.pose = "stand"
			p.pitch = 0.12
			wait = 40
			step = 5
		5:
			_shot("g_close")
			# right up against its face
			var p = game.player
			p.global_position = Vector3(15.55, 3.21, 9.5)
			p.pitch = 0.22
			wait = 30
			step = 6
		6:
			_shot("g_face")
			return true
	return false
