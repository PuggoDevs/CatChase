## Sound bank: the web game's synthesized sounds (exported as WAV), played in
## 3D from a pool of players, with a random variant each time.
class_name Sfx
extends Node

const POOL := 24

var bank := {}          # name -> Array[AudioStream]
var pool: Array = []
var flat: Array = []    # non-positional players (stingers, heartbeat, your own breath)
var next := 0
var loops := {}


func _ready() -> void:
	var dir := DirAccess.open("res://sounds")
	if dir:
		for file in dir.get_files():
			# exported games list imported resources as "name.wav.import"
			var fname := file.trim_suffix(".import")
			if not fname.ends_with(".wav"):
				continue
			var stream = load("res://sounds/" + fname)
			if stream == null:
				continue
			var key := fname.get_basename()
			var cut := key.rfind("_")
			var sname := key.substr(0, cut) if cut > 0 else key
			if not bank.has(sname):
				bank[sname] = []
			if not bank[sname].has(stream):
				bank[sname].append(stream)
	for i in POOL:
		var p := AudioStreamPlayer3D.new()
		p.unit_size = 3.0
		p.max_distance = 40.0
		p.attenuation_filter_cutoff_hz = 5000.0
		p.attenuation_filter_db = -18.0
		add_child(p)
		pool.append(p)
	for i in 6:
		var p := AudioStreamPlayer.new()
		add_child(p)
		flat.append(p)


func has_sound(sname: String) -> bool:
	return bank.has(sname)


func _pick(sname: String) -> AudioStream:
	var list: Array = bank.get(sname, [])
	return list.pick_random() if list.size() > 0 else null


## Play a sound at a world position. volume is linear (0..1+).
func play(sname: String, pos: Vector3, volume := 1.0, pitch := 1.0) -> void:
	var s := _pick(sname)
	if s == null or volume <= 0.001:
		return
	var p: AudioStreamPlayer3D = pool[next]
	next = (next + 1) % POOL
	p.stream = s
	p.global_position = pos
	p.volume_db = linear_to_db(volume)
	p.pitch_scale = pitch * randf_range(0.94, 1.06)
	p.play()


## Play without position (your own breathing, stingers).
func play_flat(sname: String, volume := 1.0, pitch := 1.0) -> void:
	var s := _pick(sname)
	if s == null:
		return
	for p in flat:
		if not p.playing:
			p.stream = s
			p.volume_db = linear_to_db(volume)
			p.pitch_scale = pitch
			p.play()
			return


## A looping sound (heartbeat, rain) whose volume you keep adjusting.
func loop(sname: String, volume: float, pitch := 1.0) -> void:
	if not loops.has(sname):
		var s := _pick(sname)
		if s == null:
			return
		s = s.duplicate()
		if s is AudioStreamWAV:
			s.loop_mode = AudioStreamWAV.LOOP_FORWARD
			s.loop_end = int(s.data.size() / 2)
		var p := AudioStreamPlayer.new()
		p.stream = s
		add_child(p)
		p.play()
		loops[sname] = p
	var pl: AudioStreamPlayer = loops[sname]
	pl.volume_db = linear_to_db(maxf(volume, 0.0001))
	pl.pitch_scale = pitch
	if not pl.playing:
		pl.play()


func stop_all() -> void:
	for p in pool:
		p.stop()
	for p in flat:
		p.stop()
	for k in loops:
		loops[k].stop()
