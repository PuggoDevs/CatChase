## Loads the exported house: the model, physics (walls, furniture, floor slabs,
## stair ramps), lights, doors, hiding spots and item slots.
class_name House
extends Node3D

const LAYER_SOLID := 1
const LAYER_SIGHT := 2

## Light output per unit of the web game's intensity.
const LIGHT_ENERGY := 0.42
const SHADOW_TYPES := ["ceiling", "chandelier", "bulb", "tube", "lamp", "fire"]

var game
var data: Dictionary
var W := 0
var D := 0
var floor_count := 4
var base_y: Array = []
var ceil_h: Array = []
var HOLE := -2
var cells: Array = []          # per floor: PackedInt32Array of room index / HOLE / OUTSIDE
var stairs: Array = []
var stair_cells: Array = []    # per floor: PackedInt32Array stair index or -1 (lower floor)
var hole_cells: Array = []     # per floor: PackedInt32Array stair index or -1 (upper floor)
var rooms: Array = []
var doors := {}                # id -> Door
var door_list: Array = []
var hiding_spots: Array = []
var item_slots: Array = []
var lights: Array = []         # {light: OmniLight3D, data, on, energy, room, phase}
var switches: Array = []
var vents: Array = []
var power := true
var model: Node3D
var nav: HouseNav


func build(g, d: Dictionary) -> void:
	game = g
	data = d
	W = int(d.grid.W)
	D = int(d.grid.D)
	floor_count = int(d.grid.floors)
	base_y = d.grid.baseY
	ceil_h = d.grid.ceil
	HOLE = int(d.grid.HOLE)
	rooms = d.rooms
	for f in floor_count:
		var arr := PackedInt32Array()
		for v in d.cells[f]:
			arr.append(int(v))
		cells.append(arr)
		var s := PackedInt32Array()
		s.resize(W * D)
		s.fill(-1)
		stair_cells.append(s)
		var h := PackedInt32Array()
		h.resize(W * D)
		h.fill(-1)
		hole_cells.append(h)
	stairs = d.stairs
	for i in stairs.size():
		var st: Dictionary = stairs[i]
		for z in range(int(st.z0), int(st.z1)):
			for x in range(int(st.x0), int(st.x1)):
				stair_cells[int(st.lower)][z * W + x] = i
				hole_cells[int(st.lower) + 1][z * W + x] = i
	_load_model()
	_build_physics()
	_build_lights()
	for dd in d.doors:
		var door := Door.new()
		door.setup(game, dd, model)
		doors[door.id] = door
		door_list.append(door)
	for h in d.hidingSpots:
		hiding_spots.append({
			"id": h.id, "type": h.type, "f": int(h.f), "room": int(h.room),
			"entry": _v(h.entry), "inside": _v(h.inside), "exit": _v(h.exit), "look": _v(h.look),
			"yaw": float(h.yaw), "yaw_range": float(h.yawRange), "pitch_min": float(h.pitchMin), "pitch_max": float(h.pitchMax),
			"concealment": float(h.concealment),
		})
	item_slots = d.itemSlots
	vents = d.vents
	nav = HouseNav.new(self, d)


static func _v(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])


# ------------------------------------------------------------------ model
func _load_model() -> void:
	var scene: PackedScene = load("res://models/house.glb")
	model = scene.instantiate()
	add_child(model)
	# the exported house has no shadow settings; walls and furniture should cast
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON


# ------------------------------------------------------------------ physics
func _build_physics() -> void:
	var solid := StaticBody3D.new()
	solid.name = "Solids"
	solid.collision_layer = LAYER_SOLID
	solid.collision_mask = 0
	add_child(solid)
	var sight := StaticBody3D.new()
	sight.name = "SightBlockers"
	sight.collision_layer = LAYER_SIGHT
	sight.collision_mask = 0
	add_child(sight)
	for c in data.colliders:
		var size := Vector3(c.x1 - c.x0, c.y1 - c.y0, c.z1 - c.z0)
		var center := Vector3((c.x0 + c.x1) * 0.5, (c.y0 + c.y1) * 0.5, (c.z0 + c.z1) * 0.5)
		_add_box(solid, center, size)
		if c.sight:
			_add_box(sight, center, size)
	# floor slabs: one box per run of walkable cells in a row
	for f in floor_count:
		var y: float = base_y[f]
		for z in D:
			var x := 0
			while x < W:
				if not _slab_cell(f, x, z):
					x += 1
					continue
				var x0 := x
				while x < W and _slab_cell(f, x, z):
					x += 1
				var size := Vector3(x - x0, 0.3, 1.0)
				var center := Vector3((x0 + x) * 0.5, y - 0.15, z + 0.5)
				_add_box(solid, center, size)
				_add_box(sight, center, size)
	# stairs: one sloped slab each
	for st in stairs:
		var rise: float = data.grid.floorH
		var run: float = st.len
		var angle := atan2(rise, run)
		var hyp := sqrt(rise * rise + run * run)
		var w: float = (st.x1 - st.x0) if (st.dir == "N" or st.dir == "S") else (st.z1 - st.z0)
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		var thick := 0.2
		var mid := Vector3((st.x0 + st.x1) * 0.5, st.baseY + rise * 0.5, (st.z0 + st.z1) * 0.5)
		match st.dir:
			"N":
				box.size = Vector3(w, thick, hyp)
				shape.rotation.x = angle
			"S":
				box.size = Vector3(w, thick, hyp)
				shape.rotation.x = -angle
			"W":
				box.size = Vector3(hyp, thick, w)
				shape.rotation.z = -angle
			_:
				box.size = Vector3(hyp, thick, w)
				shape.rotation.z = angle
		shape.shape = box
		# sink the slab so its top face runs through the ramp's midline
		shape.position = mid - Vector3(0, thick * 0.5 / cos(angle), 0)
		solid.add_child(shape)


func _slab_cell(f: int, x: int, z: int) -> bool:
	var r: int = cells[f][z * W + x]
	return r >= 0 and stair_cells[f][z * W + x] < 0


func _add_box(body: StaticBody3D, center: Vector3, size: Vector3) -> void:
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	shape.position = center
	body.add_child(shape)


# ------------------------------------------------------------------ lights
func _build_lights() -> void:
	var holder := Node3D.new()
	holder.name = "Lights"
	add_child(holder)
	var shadows := 0
	for l in data.lights:
		var light := OmniLight3D.new()
		light.position = _v(l.pos)
		light.light_color = Color(l.color)
		light.omni_range = float(l.range) * 1.15
		light.omni_attenuation = 1.4
		light.light_energy = float(l.intensity) * LIGHT_ENERGY
		light.light_volumetric_fog_energy = 1.4
		light.distance_fade_enabled = true
		light.distance_fade_begin = 24.0
		light.distance_fade_length = 6.0
		if SHADOW_TYPES.has(l.type) and shadows < 40:
			light.shadow_enabled = true
			light.shadow_bias = 0.05
			shadows += 1
		holder.add_child(light)
		var rec := {"light": light, "data": l, "on": bool(l.on), "energy": light.light_energy, "room": int(l.room),
			"flicker": float(l.flicker), "needs_power": bool(l.needsPower), "phase": randf() * 100.0, "stutter": 0.0}
		lights.append(rec)
		light.visible = rec.on
	for i in data.interactables:
		if i.kind == "switch" or i.kind == "lamp":
			switches.append({"kind": i.kind, "id": i.id, "f": int(i.f), "room": int(i.room), "pos": _v(i.pos)})


## Flip every light in a room (a wall switch or a lamp next to you).
func toggle_room_lights(room: int, only_lamps := false) -> void:
	var any_on := false
	for rec in lights:
		if rec.room == room and (not only_lamps or rec.data.type in ["lamp", "sconce", "nightlight"]):
			any_on = any_on or rec.on
	for rec in lights:
		if rec.room == room and (not only_lamps or rec.data.type in ["lamp", "sconce", "nightlight"]):
			rec.on = not any_on


func set_power(on: bool) -> void:
	power = on


## 0..1 how lit a point is by the house lights (for the cat's eyes).
func light_at(room: int, p: Vector3) -> float:
	var total := 0.0
	for rec in lights:
		var light: OmniLight3D = rec.light
		if not light.visible or rec.room != room:
			continue
		var d := light.position.distance_to(p)
		total += clampf(1.0 - d / light.omni_range, 0.0, 1.0) * light.light_energy * 0.6
	return minf(1.5, total)


func update(dt: float, t: float) -> void:
	for door in door_list:
		door.update(dt)
	for rec in lights:
		var on: bool = rec.on and (power or not rec.needs_power)
		var light: OmniLight3D = rec.light
		light.visible = on
		if not on:
			continue
		var k := 1.0
		if rec.flicker > 0.0:
			var n := sin(t * 7.3 + rec.phase) * sin(t * 2.1 + rec.phase * 0.7) + sin(t * 23.0 + rec.phase) * 0.3
			if n > 1.0 - rec.flicker * 0.9:
				k = 0.15
		if rec.stutter > 0.0:
			rec.stutter -= dt
			k *= 0.1 if fmod(t * 17.0, 1.0) > 0.5 else 1.0
		light.light_energy = rec.energy * k


# ------------------------------------------------------------------ queries
func in_bounds(x: int, z: int) -> bool:
	return x >= 0 and z >= 0 and x < W and z < D


func cell_raw(f: int, x: int, z: int) -> int:
	if f < 0 or f >= floor_count or not in_bounds(x, z):
		return -1
	return cells[f][z * W + x]


func stair_at(f: int, x: int, z: int):
	if f < 0 or f >= floor_count or not in_bounds(x, z):
		return null
	var i: int = stair_cells[f][z * W + x]
	return stairs[i] if i >= 0 else null


func hole_stair(f: int, x: int, z: int):
	if f < 0 or f >= floor_count or not in_bounds(x, z):
		return null
	var i: int = hole_cells[f][z * W + x]
	return stairs[i] if i >= 0 else null


func stair_t(st: Dictionary, wx: float, wz: float) -> float:
	var t := 0.0
	match st.dir:
		"N": t = (st.z1 - wz) / st.len
		"S": t = (wz - st.z0) / st.len
		"W": t = (st.x1 - wx) / st.len
		_: t = (wx - st.x0) / st.len
	return clampf(t, 0.0, 1.0)


func ground_y(f: int, wx: float, wz: float) -> float:
	var st = stair_at(f, int(floor(wx)), int(floor(wz)))
	if st:
		return st.baseY + stair_t(st, wx, wz) * float(data.grid.floorH)
	return base_y[clampi(f, 0, floor_count - 1)]


## Which floor an agent at this height belongs to (stairs count as the lower floor).
func floor_at(p: Vector3, hint := 1) -> int:
	var x := int(floor(p.x))
	var z := int(floor(p.z))
	for f in range(floor_count - 1, -1, -1):
		if p.y < float(base_y[f]) - 0.6:
			continue
		var r := cell_raw(f, x, z)
		if r == HOLE:
			var st = hole_stair(f, x, z)
			if st:
				return int(st.lower)
			continue
		if r >= 0:
			return f
	return hint


func room_at(f: int, p: Vector3) -> int:
	var x := int(floor(p.x))
	var z := int(floor(p.z))
	var r := cell_raw(f, x, z)
	if r >= 0:
		return r
	if r == HOLE:
		var st = hole_stair(f, x, z)
		if st:
			return int(st.room)
	return -1


func room_name(r: int) -> String:
	return rooms[r].name if r >= 0 and r < rooms.size() else ""


## Straight-line visibility between two points (walls, closed doors, floors, tall furniture).
func line_clear(a: Vector3, b: Vector3, mask := LAYER_SIGHT) -> bool:
	var q := PhysicsRayQueryParameters3D.create(a, b, mask)
	return get_world_3d().direct_space_state.intersect_ray(q).is_empty()
