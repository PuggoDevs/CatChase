## One door: its swinging panel (from house.glb), lock, barricade and collider.
## Ported from src/world/doors.js.
class_name Door
extends RefCounted

const MAX_ANGLE := PI * 0.56

var game
var id: String
var type: String
var f: int
var lock = null            # null, "bolt" or a key item id
var locked := false
var jammed := false        # escape doors only open through objectives
var heavy := false
var creaky := false
var discovered := true
var breakable := false
var escape := false
var broken := false
var barricade := 0.0
var max_barricade := 3.0
var barricade_side := 1
var open := 0.0
var target := 0.0
var speed := 1.6
var mode := "normal"
var last_user := ""
var center := Vector3.ZERO
var orient := "H"
var edge_a := 0.0
var edge_b := 0.0
var room1 := -1
var room2 := -1
var base_theta := 0.0
var swing_sign := 1.0
var base_y := 0.0
var panel_h := 2.0
var pivot: Node3D
var barricade_nodes := {}
var body: StaticBody3D
var _pivot_base_y := 0.0


func setup(g, d: Dictionary, house_root: Node) -> void:
	game = g
	id = d.id
	type = d.type
	f = int(d.f)
	lock = d.lock
	locked = d.locked
	jammed = d.jammed
	heavy = d.heavy
	creaky = d.creaky
	discovered = d.discovered
	breakable = d.breakable
	escape = d.escape
	center = Vector3(d.center[0], d.center[1], d.center[2])
	orient = d.orient
	edge_a = d.edgeA
	edge_b = d.edgeB
	room1 = int(d.room1)
	room2 = int(d.room2)
	base_theta = d.theta
	swing_sign = d.swingSign
	base_y = d.baseY
	panel_h = d.panelH
	var node := house_root.find_child("door_" + id, true, false)
	if node:
		pivot = node.find_child("pivot", false, false)
		for side in [1, 2]:
			var b = node.find_child("barricade%d" % side, false, false)
			if b:
				barricade_nodes[side] = b
				b.visible = false
	if pivot:
		_pivot_base_y = pivot.position.y
	# physics: a thin box across the doorway
	var c: Dictionary = d.collider
	body = StaticBody3D.new()
	body.name = "DoorBody_" + id
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(c.x1 - c.x0, c.y1 - c.y0, c.z1 - c.z0)
	shape.shape = box
	body.add_child(shape)
	body.position = Vector3((c.x0 + c.x1) * 0.5, (c.y0 + c.y1) * 0.5, (c.z0 + c.z1) * 0.5)
	body.set_meta("door", self)
	game.add_child(body)
	_update_collider()


# ------------------------------------------------------------------ state
func is_passable() -> bool:
	return broken or open > 0.72


func blocks_sight() -> bool:
	return not broken and open < 0.25


func is_closed() -> bool:
	return not broken and open < 0.05 and target == 0.0


func can_be_opened_by(cat := false) -> bool:
	if broken:
		return true
	if jammed or barricade > 0.0 or locked:
		return false
	if not discovered and not cat:
		return false
	return true


func side_of(p: Vector3) -> int:
	if orient == "H":
		return 1 if p.z < edge_b else 2
	return 1 if p.x < edge_a else 2


func approach_point(side: int, dist := 0.7) -> Vector3:
	var s := -1.0 if side == 1 else 1.0
	if orient == "H":
		return Vector3(center.x, base_y, center.z + s * dist)
	return Vector3(center.x + s * dist, base_y, center.z)


func open_door(by: String, how := "normal") -> bool:
	if broken or jammed or barricade > 0.0 or locked:
		return false
	var was_closed := open < 0.05
	target = 1.0
	last_user = by
	mode = how
	speed = 0.32 if how == "quiet" else (5.5 if how == "burst" else (1.1 if heavy else 1.6))
	if was_closed:
		if how == "burst":
			game.sfx.play("slam", center, 0.9, 0.9)
			game.noise(center, 16.0, "door", by)
		elif how != "quiet":
			game.sfx.play("creak", center, 0.5 if creaky else 0.3)
			game.noise(center, 9.0 if creaky else 6.0, "door", by)
	return true


func close_door(by: String, how := "normal") -> bool:
	if broken:
		return false
	target = 0.0
	last_user = by
	mode = how
	speed = 7.0 if how == "slam" else (0.35 if how == "quiet" else (1.2 if heavy else 1.8))
	return true


func toggle_lock() -> bool:
	if lock == null or broken or open > 0.05:
		return false
	locked = not locked
	game.sfx.play("unlock", center, 0.6)
	game.noise(center, 4.0, "lock", "player")
	return true


func add_barricade(side: int) -> bool:
	if broken or open > 0.05:
		return false
	if barricade > 0.0 and side != barricade_side:
		return false
	barricade_side = side
	barricade = minf(max_barricade, barricade + 3.0)
	_refresh_barricade()
	return true


## The cat batters the door. Returns true once it gives way.
func hit(power := 1.0) -> bool:
	game.sfx.play("bang", center, 1.0, randf_range(0.85, 1.1))
	game.noise(center, 14.0, "bang", "cat")
	if barricade > 0.0:
		barricade = maxf(0.0, barricade - power)
		_refresh_barricade()
		if barricade > 0.0:
			return false
		game.sfx.play("clatter", center, 1.0)
		return not locked
	if locked and breakable:
		break_down()
		return true
	return false


func break_down() -> void:
	broken = true
	locked = false
	barricade = 0.0
	_refresh_barricade()
	target = 1.0
	speed = 6.0
	game.sfx.play("slam", center, 1.0, 0.7)
	game.noise(center, 18.0, "slam", "cat")


func _refresh_barricade() -> void:
	for side in barricade_nodes:
		var n: Node3D = barricade_nodes[side]
		n.visible = barricade > 0.0 and side == barricade_side
		if n.visible:
			var left := int(ceil(barricade))
			var i := 0
			for plank in n.get_children():
				(plank as Node3D).visible = i < left
				i += 1
			n.rotation.z = (max_barricade - barricade) * 0.04


func _update_collider() -> void:
	var solid := not broken and open < 0.45
	body.collision_layer = (1 if solid else 0) | (2 if blocks_sight() else 0)


func update(dt: float) -> void:
	if open == target:
		return
	var prev := open
	var d := target - open
	open += signf(d) * minf(absf(d), speed * dt)
	if pivot:
		if type == "garage":
			pivot.position.y = _pivot_base_y + open * (panel_h - 0.2)
		else:
			pivot.rotation.y = base_theta + swing_sign * open * MAX_ANGLE * (1.12 if broken else 1.0)
	if prev > 0.0 and open == 0.0:
		if mode == "slam":
			game.sfx.play("slam", center, 1.0)
			game.noise(center, 15.0, "slam", last_user)
		elif mode != "quiet":
			game.sfx.play("thud", center, 0.45)
			game.noise(center, 6.0, "door", last_user)
	_update_collider()
