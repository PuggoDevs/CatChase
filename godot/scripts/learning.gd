## What the cat learns about you during a run. Ported from src/cat/learning.js.
class_name PlayerModel
extends RefCounted

var learn_rate := 1.0
var room_time := {}        # room index -> seconds
var spot_uses := {}        # hiding spot id -> count
var seen_entering := {}    # hiding spot ids the cat watched you use
var fooled: Array = []     # times distractions led nowhere
var locks := 0
var light_time := 0.0
var total_time := 0.0


func _init(rate := 1.0) -> void:
	learn_rate = rate


func tick(dt: float, player_room: int, flashlight_on: bool) -> void:
	total_time += dt
	if flashlight_on:
		light_time += dt
	if player_room >= 0:
		room_time[player_room] = float(room_time.get(player_room, 0.0)) + dt


func record_hide(spot_id: String, seen: bool) -> void:
	spot_uses[spot_id] = int(spot_uses.get(spot_id, 0)) + 1
	if seen:
		seen_entering[spot_id] = true


func record_fooled(t: float) -> void:
	fooled.append(t)


func record_lock() -> void:
	locks += 1


## Probability that the cat checks a hiding spot while searching.
func check_chance(spot: Dictionary, diff: Dictionary, ctx := {}) -> float:
	if seen_entering.has(spot.id) or ctx.get("saw", false):
		return minf(1.0, float(diff.checkSeenEntering))
	var uses: int = spot_uses.get(spot.id, 0)
	var p: float = float(diff.checkBase) + uses * float(diff.checkPerUse) * learn_rate
	if ctx.get("heard_noise", false):
		p += 0.35
	if ctx.get("last_seen_near", false):
		p += 0.2
	if float(spot.concealment) < 0.8:
		p += 0.15
	var same_type := 0
	for id in spot_uses:
		if String(id).ends_with(":" + String(spot.type)):
			same_type += int(spot_uses[id])
	p += minf(0.25, same_type * 0.04 * learn_rate)
	return clampf(p, 0.0, 0.98)


## How suspicious the cat is of a new distraction (0 = falls for it).
func distraction_suspicion(now: float, diff: Dictionary) -> float:
	var recent := 0
	for t in fooled:
		if now - t < 180.0:
			recent += 1
	var tol := float(diff.distractionTolerance)
	if recent < tol:
		return recent / (tol + 1.0) * 0.35
	return minf(1.0, 0.6 + (recent - tol) * 0.2 * learn_rate)


func room_weight(room: int) -> float:
	var t: float = room_time.get(room, 0.0)
	return 1.0 + (t / maxf(1.0, total_time)) * 6.0 * learn_rate


func favourite_rooms(n := 3) -> Array:
	var keys: Array = room_time.keys()
	keys.sort_custom(func(a, b): return room_time[a] > room_time[b])
	return keys.slice(0, n)


func light_reliance() -> float:
	return light_time / total_time if total_time > 30.0 else 0.5


func lock_habit() -> float:
	return minf(1.0, locks / 4.0)
