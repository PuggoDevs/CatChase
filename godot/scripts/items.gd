## Pickups (placed from the web game's solvable layouts), the item models and
## thrown objects (real rigid bodies that make noise where they land).
class_name Items
extends Node3D

const THROWABLES := ["bottle", "can", "toy", "plate", "book"]
const THROW_BY_ROOM := {
	"kitchen": ["plate", "bottle", "can"], "dining": ["plate", "bottle"], "cellar": ["bottle", "can"],
	"storage": ["can", "bottle"], "study": ["book"], "bedroom": ["toy", "book"], "playroom": ["toy"],
	"living": ["book", "bottle"], "garage": ["can"], "utility": ["can", "bottle"], "workshop": ["toy", "can"],
	"attic": ["toy", "book"],
}

var game
var defs: Dictionary
var models := {}        # kind -> Node3D template
var pickups: Array = [] # {kind, node, pos, f, room}
var layout: Dictionary = {}


func setup(g) -> void:
	game = g
	defs = g.data.items
	var scene: PackedScene = load("res://models/items.glb")
	var root: Node = scene.instantiate()
	for child in root.get_children():
		models[String(child.name)] = child
	# keep the templates alive but out of the world
	root.visible = false
	add_child(root)


func clear() -> void:
	for p in pickups:
		p.node.queue_free()
	pickups.clear()
	for c in get_children():
		if c is RigidBody3D:
			c.queue_free()


func populate(rng: RandomNumberGenerator, diff: Dictionary) -> void:
	clear()
	var house: House = game.house
	var slots: Array = house.item_slots
	var used := {}
	var layouts: Array = game.data.layouts
	layout = layouts[rng.randi_range(0, layouts.size() - 1)]
	for kind in layout:
		var s: Dictionary = slots[int(layout[kind])]
		used[int(s.i)] = true
		spawn(kind, Vector3(s.x, s.y + 0.005, s.z), int(s.f), int(s.room), rng.randf() * TAU)
	# the flashlight waits on the nightstand beside you
	var start: Vector3 = game.player_start_pos()
	var best = null
	var bd := INF
	for s in slots:
		if int(s.room) == int(game.data.startRoom) and not used.has(int(s.i)) and s.surface != "top":
			var d := Vector2(s.x - start.x, s.z - start.z).length()
			if d < bd:
				bd = d
				best = s
	if best:
		used[int(best.i)] = true
		spawn("flashlight", Vector3(best.x, best.y + 0.005, best.z), int(best.f), int(best.room), 0.4)
	var free := func() -> Array:
		var out: Array = []
		for s in slots:
			if not used.has(int(s.i)) and s.surface != "top":
				out.append(s)
		return out
	var scatter := func(kind: String, n: int, prefer: Array) -> void:
		for i in n:
			var cands: Array = free.call()
			if prefer.size() > 0 and rng.randf() < 0.6:
				var pc: Array = cands.filter(func(s): return prefer.has(house.rooms[int(s.room)].kind))
				if pc.size() > 0:
					cands = pc
			if cands.is_empty():
				return
			var s: Dictionary = cands[rng.randi_range(0, cands.size() - 1)]
			used[int(s.i)] = true
			spawn(kind, Vector3(s.x, s.y + 0.005, s.z), int(s.f), int(s.room), rng.randf() * TAU)
	scatter.call("battery", roundi(9.0 / maxf(0.7, float(diff.batteryDrain))), [])
	scatter.call("plank", 6, ["garage", "cellar", "workshop", "attic", "utility", "storage"])
	for i in 26:
		var cands: Array = free.call()
		if cands.is_empty():
			break
		var s: Dictionary = cands[rng.randi_range(0, cands.size() - 1)]
		used[int(s.i)] = true
		var list: Array = THROW_BY_ROOM.get(house.rooms[int(s.room)].kind, ["book", "can", "bottle"])
		spawn(list[rng.randi_range(0, list.size() - 1)], Vector3(s.x, s.y + 0.005, s.z), int(s.f), int(s.room), rng.randf() * TAU)


func make_model(kind: String) -> Node3D:
	var tpl: Node3D = models.get(kind)
	if tpl == null:
		var m := MeshInstance3D.new()
		m.mesh = BoxMesh.new()
		(m.mesh as BoxMesh).size = Vector3(0.12, 0.08, 0.12)
		return m
	var n: Node3D = tpl.duplicate()
	n.transform = Transform3D.IDENTITY
	n.visible = true
	return n


func spawn(kind: String, pos: Vector3, f: int, room: int, yaw := 0.0) -> Dictionary:
	var node := make_model(kind)
	add_child(node)
	node.global_position = pos
	node.rotation.y = yaw
	var p := {"kind": kind, "node": node, "pos": pos, "f": f, "room": room}
	pickups.append(p)
	return p


func remove(p: Dictionary) -> void:
	pickups.erase(p)
	p.node.queue_free()


func item_name(kind: String) -> String:
	return defs[kind].name if defs.has(kind) else kind.capitalize()


## Throw a held item from the camera. It lands with a noise the cat can hear.
func throw_item(kind: String, from: Vector3, dir: Vector3, thrower: Vector3) -> void:
	var body := RigidBody3D.new()
	body.collision_layer = 8
	body.collision_mask = 1
	body.mass = 0.6
	body.contact_monitor = true
	body.max_contacts_reported = 2
	body.continuous_cd = true
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.07
	shape.shape = sphere
	body.add_child(shape)
	var model := make_model(kind)
	body.add_child(model)
	add_child(body)
	body.global_position = from
	body.linear_velocity = dir * 9.5 + Vector3(0, 1.6, 0)
	body.angular_velocity = Vector3(randf_range(-8, 8), randf_range(-4, 4), randf_range(-8, 8))
	var state := {"noised": false}
	var def: Dictionary = defs.get(kind, {})
	body.body_entered.connect(func(_other):
		if state.noised:
			return
		state.noised = true
		var pos := body.global_position
		var loud: float = def.get("noise", 10.0)
		game.sfx.play("glass" if def.get("breaks", false) else "clatter", pos, 1.0)
		game.noise(pos, loud, "thrown", "distraction", thrower)
		if def.get("breaks", false):
			body.queue_free()
		else:
			# it can be picked up again once it settles
			get_tree().create_timer(2.5).timeout.connect(func():
				if is_instance_valid(body):
					var at := body.global_position
					var fl: int = game.house.floor_at(at, game.player.floor_index)
					spawn(kind, at, fl, game.house.room_at(fl, at), body.rotation.y)
					body.queue_free()))
	# a throw that never touches anything still lands somewhere
	get_tree().create_timer(4.0).timeout.connect(func():
		if is_instance_valid(body) and not state.noised:
			state.noised = true
			game.noise(body.global_position, float(def.get("noise", 10.0)) * 0.6, "thrown", "distraction", thrower)
			body.queue_free())
