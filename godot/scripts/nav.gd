## Cell A* over every floor: stairs, doors (with their live state), furniture-
## blocked cells and the vent network. Ported from src/cat/nav.js; the graph
## itself was exported from the web game.
class_name HouseNav
extends RefCounted

var house
var W := 0
var D := 0
var nodes := {}        # id -> {f, x, z, pos, room, blocked, stair, links}
var vent_by_node := {} # id -> vent dictionary


func _init(h, data: Dictionary) -> void:
	house = h
	W = int(data.grid.W)
	D = int(data.grid.D)
	for nd in data.nav:
		var links: Array = []
		for l in nd.links:
			links.append({"n": int(l.n), "c": float(l.c), "door": String(l.get("door", "")), "crawl": bool(l.get("crawl", false))})
		nodes[int(nd.n)] = {
			"f": int(nd.f), "x": int(nd.x), "z": int(nd.z), "pos": Vector3(nd.x + 0.5, nd.y, nd.z + 0.5),
			"room": int(nd.room), "blocked": bool(nd.blocked), "stair": bool(nd.stair), "links": links,
		}
	for v in data.vents:
		var vent: Dictionary = v.duplicate()
		vent.node = int(v.node)
		vent.mouth_v = Vector3(v.mouth[0], v.mouth[1], v.mouth[2])
		vent.pos_v = Vector3(v.pos[0], v.pos[1], v.pos[2])
		vent_by_node[vent.node] = vent


func id_of(f: int, x: int, z: int) -> int:
	return (f * D + z) * W + x


func node_at(f: int, p: Vector3) -> int:
	var x := int(floor(p.x))
	var z := int(floor(p.z))
	var hs = house.hole_stair(f, x, z)
	if hs:
		f = int(hs.lower)
	var n := id_of(f, x, z)
	return n if nodes.has(n) else -1


## Nearest unblocked cell to a world position, preferring the same room.
func nearest_free(f: int, p: Vector3, max_r := 3) -> int:
	var n0 := node_at(f, p)
	if n0 >= 0:
		if not nodes[n0].blocked:
			return n0
		f = nodes[n0].f
	var best := -1
	var bd := INF
	var cx := int(floor(p.x))
	var cz := int(floor(p.z))
	var room0: int = house.cell_raw(f, cx, cz)
	for dz in range(-max_r, max_r + 1):
		for dx in range(-max_r, max_r + 1):
			var n := id_of(f, cx + dx, cz + dz)
			if cx + dx < 0 or cz + dz < 0 or cx + dx >= W or cz + dz >= D or not nodes.has(n) or nodes[n].blocked:
				continue
			var d: float = pow(cx + dx + 0.5 - p.x, 2) + pow(cz + dz + 0.5 - p.z, 2) + (0.0 if nodes[n].room == room0 else 4.0)
			if d < bd:
				bd = d
				best = n
	return best


func _door_cost(door, opts: Dictionary) -> float:
	if door.is_passable():
		return 1.0
	if door.jammed:
		return -1.0
	if door.locked:
		return 14.0 if opts.get("break_doors", false) and door.breakable else -1.0
	if door.barricade > 0.0:
		return 9.0
	if not door.can_be_opened_by(true):
		return -1.0
	return 2.0


## A* between two world positions. Returns an Array of waypoints
## {pos: Vector3, f: int, door: Door or null, vent: bool}, or [] if there is no way.
## opts: vents (bool), break_doors (bool), vent_cost (float)
func find_path(fa: int, a: Vector3, fb: int, b: Vector3, opts := {}) -> Array:
	var start := nearest_free(fa, a)
	var goal := nearest_free(fb, b)
	if start < 0 or goal < 0:
		return []
	if start == goal:
		return [_wp(goal, null, false)]
	var g_score := {start: 0.0}
	var came := {}
	var closed := {}
	var heap := _Heap.new()
	var goal_node: Dictionary = nodes[goal]
	heap.push(start, _h(start, goal_node))
	var iter := 0
	var use_vents: bool = opts.get("vents", false)
	var vent_cost: float = opts.get("vent_cost", 0.6)
	while heap.size() > 0 and iter < 20000:
		iter += 1
		var cur: int = heap.pop()
		if cur == goal:
			break
		if closed.has(cur):
			continue
		closed[cur] = true
		var gc: float = g_score[cur]
		var nd: Dictionary = nodes[cur]
		for l in nd.links:
			var to: int = l.n
			if not nodes.has(to) or nodes[to].blocked:
				continue
			var cost: float = l.c
			var door = null
			if l.door != "":
				door = house.doors.get(l.door)
				if door == null:
					continue
				var dc := _door_cost(door, opts)
				if dc < 0.0:
					continue
				cost = dc
			var ng := gc + cost
			if ng < g_score.get(to, INF):
				g_score[to] = ng
				came[to] = {"from": cur, "door": door, "vent": false}
				heap.push(to, ng + _h(to, goal_node))
		if use_vents and vent_by_node.has(cur):
			var v: Dictionary = vent_by_node[cur]
			for w in vent_by_node.values():
				if w == v or absi(int(w.f) - int(v.f)) > 1:
					continue
				var to: int = w.node
				var d := Vector2(w.x - v.x, w.z - v.z).length() + absi(int(w.f) - int(v.f)) * 4.0
				var ng := gc + 3.0 + d * vent_cost
				if ng < g_score.get(to, INF):
					g_score[to] = ng
					came[to] = {"from": cur, "door": null, "vent": true}
					heap.push(to, ng + _h(to, goal_node))
	if not came.has(goal):
		return []
	var chain: Array = []
	var n := goal
	while n != start:
		var c: Dictionary = came[n]
		chain.push_front(_wp(n, c.door, c.vent))
		n = c.from
	return _smooth(_wp(start, null, false), chain)


func _h(n: int, g: Dictionary) -> float:
	var p: Dictionary = nodes[n]
	return Vector2(p.x - g.x, p.z - g.z).length() + absi(p.f - g.f) * 5.0


func _wp(n: int, door, vent: bool) -> Dictionary:
	var nd: Dictionary = nodes[n]
	return {"pos": nd.pos, "f": nd.f, "door": door, "vent": vent, "stair": nd.stair, "n": n}


## Drop waypoints that can be reached in a clear straight line.
func _smooth(start: Dictionary, pts: Array) -> Array:
	if pts.size() < 3:
		return pts
	var out: Array = []
	var anchor := start
	var i := 0
	while i < pts.size():
		var j := i
		while j + 1 < pts.size() and pts[j + 1].door == null and not pts[j + 1].vent and pts[j].door == null and not pts[j].vent \
				and pts[j + 1].f == anchor.f and not pts[j + 1].stair and not anchor.stair and _clear(anchor.pos, pts[j + 1].pos):
			j += 1
		out.append(pts[j])
		anchor = pts[j]
		i = j + 1
	return out


func _clear(a: Vector3, b: Vector3) -> bool:
	var d := b - a
	d.y = 0.0
	if d.length() < 0.01:
		return true
	var side := Vector3(-d.z, 0, d.x).normalized() * 0.3
	for off in [Vector3.ZERO, side, -side]:
		for h in [0.35, 1.2]:
			if not house.line_clear(a + off + Vector3(0, h, 0), b + off + Vector3(0, h, 0), House.LAYER_SOLID):
				return false
	return true


func random_point_in_room(room_index: int) -> Dictionary:
	var room: Dictionary = house.rooms[room_index]
	var cands: Array = []
	for c in room.cells:
		var n := id_of(int(room.floor), int(c[0]), int(c[1]))
		if nodes.has(n) and not nodes[n].blocked and not nodes[n].stair:
			cands.append(n)
	if cands.is_empty():
		return {}
	var n: int = cands.pick_random()
	var p: Vector3 = nodes[n].pos
	return {"f": int(room.floor), "pos": Vector3(p.x + randf_range(-0.2, 0.2), p.y, p.z + randf_range(-0.2, 0.2))}


class _Heap:
	var items: Array = []
	var prio: Array = []

	func size() -> int:
		return items.size()

	func push(item, p: float) -> void:
		items.append(item)
		prio.append(p)
		var i := items.size() - 1
		while i > 0:
			var parent := (i - 1) >> 1
			if prio[parent] <= prio[i]:
				break
			_swap(i, parent)
			i = parent

	func pop():
		var top = items[0]
		var last_i = items.pop_back()
		var last_p = prio.pop_back()
		if items.size() > 0:
			items[0] = last_i
			prio[0] = last_p
			var i := 0
			while true:
				var l := i * 2 + 1
				var r := l + 1
				var m := i
				if l < items.size() and prio[l] < prio[m]:
					m = l
				if r < items.size() and prio[r] < prio[m]:
					m = r
				if m == i:
					break
				_swap(i, m)
				i = m
		return top

	func _swap(a: int, b: int) -> void:
		var t = items[a]
		items[a] = items[b]
		items[b] = t
		var tp = prio[a]
		prio[a] = prio[b]
		prio[b] = tp
