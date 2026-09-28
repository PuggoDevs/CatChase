## On-screen display and menus, built in code: prompts, stamina / battery /
## breath meters, toasts, subtitles, the main menu, pause, death and ending screens.
class_name Hud
extends CanvasLayer

const BONE := Color(0.91, 0.886, 0.816)
const DIM := Color(0.62, 0.6, 0.56)
const BLOOD := Color(0.72, 0.08, 0.08)
const INK := Color(0.03, 0.025, 0.035)

var game
var font: Font
var root: Control
var crosshair: Label
var prompt_box: VBoxContainer
var prompt_title: Label
var prompt_keys: Label
var stamina_bar: ProgressBar
var battery_bar: ProgressBar
var battery_label: Label
var breath_bar: ProgressBar
var toast_label: Label
var hint_label: Label
var subtitle_label: Label
var room_label: Label
var held_label: Label
var inv_panel: PanelContainer
var inv_label: Label
var overlay: ColorRect
var vignette: ColorRect
var screen: Control
var struggle_bar: ProgressBar
var _toast_t := 0.0
var _hint_t := 0.0
var _sub_t := 0.0
var _room_t := 0.0


func setup(g) -> void:
	game = g
	layer = 10
	if ResourceLoader.exists("res://fonts/IMFellEnglish-Regular.ttf"):
		font = load("res://fonts/IMFellEnglish-Regular.ttf")
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	vignette = ColorRect.new()
	vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
uniform float fear = 0.0;
uniform float red = 0.0;
void fragment() {
	vec2 d = UV - 0.5;
	float v = smoothstep(0.35 - fear * 0.12, 0.85, length(d) * (1.25 + fear * 0.5));
	COLOR = vec4(mix(vec3(0.0), vec3(0.35, 0.0, 0.0), red), clamp(v * (0.75 + fear * 0.25) + red * 0.25, 0.0, 1.0));
}"""
	var sm := ShaderMaterial.new()
	sm.shader = sh
	vignette.material = sm
	root.add_child(vignette)
	crosshair = _label("·", 26, BONE)
	crosshair.set_anchors_preset(Control.PRESET_CENTER)
	crosshair.position -= Vector2(4, 16)
	root.add_child(crosshair)
	prompt_box = VBoxContainer.new()
	prompt_box.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	prompt_box.position = Vector2(-300, -170)
	prompt_box.size = Vector2(600, 80)
	prompt_box.alignment = BoxContainer.ALIGNMENT_END
	root.add_child(prompt_box)
	prompt_title = _label("", 22, BONE)
	prompt_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_keys = _label("", 16, DIM)
	prompt_keys.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_box.add_child(prompt_title)
	prompt_box.add_child(prompt_keys)
	stamina_bar = _bar(Color(0.8, 0.78, 0.7, 0.8))
	stamina_bar.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	stamina_bar.position = Vector2(28, -40)
	root.add_child(stamina_bar)
	battery_bar = _bar(Color(0.95, 0.85, 0.5, 0.85))
	battery_bar.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	battery_bar.position = Vector2(-208, -40)
	root.add_child(battery_bar)
	battery_label = _label("", 14, DIM)
	battery_label.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	battery_label.position = Vector2(-208, -64)
	root.add_child(battery_label)
	breath_bar = _bar(Color(0.55, 0.7, 0.85, 0.85))
	breath_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	breath_bar.position = Vector2(-90, -60)
	root.add_child(breath_bar)
	toast_label = _label("", 20, BONE)
	toast_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	toast_label.position = Vector2(-400, 40)
	toast_label.size = Vector2(800, 40)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(toast_label)
	room_label = _label("", 28, BONE)
	room_label.set_anchors_preset(Control.PRESET_TOP_LEFT)
	room_label.position = Vector2(32, 28)
	root.add_child(room_label)
	hint_label = _label("", 17, DIM)
	hint_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint_label.position = Vector2(-450, -44)
	hint_label.size = Vector2(900, 30)
	hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(hint_label)
	subtitle_label = _label("", 18, Color(0.85, 0.82, 0.74))
	subtitle_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	subtitle_label.position = Vector2(-400, -220)
	subtitle_label.size = Vector2(800, 30)
	subtitle_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(subtitle_label)
	held_label = _label("", 16, DIM)
	held_label.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	held_label.position = Vector2(-320, -96)
	held_label.size = Vector2(300, 24)
	held_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	root.add_child(held_label)
	inv_panel = PanelContainer.new()
	inv_panel.set_anchors_preset(Control.PRESET_CENTER)
	inv_panel.position = Vector2(-260, -200)
	inv_panel.custom_minimum_size = Vector2(520, 400)
	inv_panel.add_theme_stylebox_override("panel", _panel_style())
	inv_label = _label("", 17, BONE)
	inv_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	inv_panel.add_child(inv_label)
	inv_panel.visible = false
	root.add_child(inv_panel)
	struggle_bar = _bar(BLOOD)
	struggle_bar.set_anchors_preset(Control.PRESET_CENTER)
	struggle_bar.position = Vector2(-150, 60)
	struggle_bar.custom_minimum_size = Vector2(300, 14)
	struggle_bar.visible = false
	root.add_child(struggle_bar)
	overlay = ColorRect.new()
	overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	overlay.color = Color(0, 0, 0, 0)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(overlay)
	set_playing(false)


func _label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("shadow_offset_x", 1)
	l.add_theme_constant_override("shadow_offset_y", 2)
	if font:
		l.add_theme_font_override("font", font)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _bar(color: Color) -> ProgressBar:
	var b := ProgressBar.new()
	b.custom_minimum_size = Vector2(180, 6)
	b.size = Vector2(180, 6)
	b.show_percentage = false
	b.max_value = 1.0
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.45)
	var fg := StyleBoxFlat.new()
	fg.bg_color = color
	b.add_theme_stylebox_override("background", bg)
	b.add_theme_stylebox_override("fill", fg)
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return b


func _panel_style() -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = Color(0.03, 0.025, 0.035, 0.92)
	s.border_color = Color(0.35, 0.3, 0.26, 0.6)
	s.set_border_width_all(1)
	s.set_content_margin_all(28)
	return s


func set_playing(on: bool) -> void:
	for c in [crosshair, prompt_box, stamina_bar, battery_bar, battery_label, breath_bar, toast_label, hint_label, subtitle_label, room_label, held_label]:
		c.visible = on
	if not on:
		inv_panel.visible = false


# ------------------------------------------------------------------ messages
func set_prompt(p) -> void:
	if p == null or p.is_empty():
		prompt_title.text = ""
		prompt_keys.text = ""
		return
	prompt_title.text = p.title
	var parts: PackedStringArray = []
	for k in p.keys:
		parts.append(("[%s]  %s" % [k[0], k[1]]) if k[0] != "" else k[1])
	prompt_keys.text = "     ".join(parts)


func toast(text: String) -> void:
	toast_label.text = text
	_toast_t = 3.0


func hint(text: String) -> void:
	hint_label.text = text
	_hint_t = 7.0


func subtitle(text: String) -> void:
	subtitle_label.text = text
	_sub_t = 2.6


func show_room(name: String) -> void:
	room_label.text = name
	_room_t = 3.0


func toggle_inventory() -> void:
	inv_panel.visible = not inv_panel.visible
	if inv_panel.visible:
		var p: Player = game.player
		var lines: PackedStringArray = ["INVENTORY", ""]
		if p.has_flashlight:
			lines.append("Flashlight  (%d%%)" % int(p.battery))
		for k in p.inventory:
			lines.append("%s%s" % [game.items.item_name(k), (" x%d" % p.inventory[k]) if int(p.inventory[k]) > 1 else ""])
		if p.held != "":
			lines.append("In your hand: " + game.items.item_name(p.held))
		if lines.size() == 2:
			lines.append("Nothing yet.")
		lines.append("")
		lines.append("GETTING OUT")
		lines.append("The front door downstairs is locked and chained.")
		lines.append("Find the front door key  %s" % ("(have it)" if p.has("key_front") else ""))
		lines.append("Find something to cut the chain  %s" % ("(have it)" if p.has("bolt_cutters") else ""))
		lines.append("Some doors need keys of their own.")
		inv_label.text = "\n".join(lines)


func update(dt: float) -> void:
	var p: Player = game.player
	stamina_bar.value = p.stamina / 100.0
	stamina_bar.modulate.a = 0.25 if p.stamina > 98.0 else 1.0
	battery_bar.visible = p.has_flashlight and game.state == "playing"
	battery_label.visible = battery_bar.visible
	battery_bar.value = p.battery / 100.0
	var spare := int(p.inventory.get("battery", 0))
	battery_label.text = "Flashlight %d%%%s%s" % [int(p.battery), "  +%d" % spare if spare > 0 else "", "" if p.flash_on else "  (off)"]
	breath_bar.visible = p.hiding != null and game.state == "playing"
	breath_bar.value = p.breath / Player.BREATH_MAX
	held_label.text = ("Holding: %s   [G] throw" % game.items.item_name(p.held)) if p.held != "" else ""
	crosshair.modulate.a = 1.0 if p.target != null else 0.35
	_toast_t -= dt
	toast_label.modulate.a = clampf(_toast_t, 0.0, 1.0)
	_hint_t -= dt
	hint_label.modulate.a = clampf(_hint_t, 0.0, 1.0)
	_sub_t -= dt
	subtitle_label.modulate.a = clampf(_sub_t, 0.0, 1.0)
	_room_t -= dt
	room_label.modulate.a = clampf(_room_t, 0.0, 1.0)
	var sm: ShaderMaterial = vignette.material
	sm.set_shader_parameter("fear", p.fear)


func set_red(k: float) -> void:
	(vignette.material as ShaderMaterial).set_shader_parameter("red", k)


func set_black(k: float) -> void:
	overlay.color = Color(0, 0, 0, k)


func set_struggle(v) -> void:
	struggle_bar.visible = v != null
	if v != null:
		struggle_bar.value = v


# ------------------------------------------------------------------ screens
func _clear_screen() -> void:
	if screen:
		screen.queue_free()
		screen = null


func _screen_base(dark := 0.55) -> VBoxContainer:
	_clear_screen()
	screen = Control.new()
	screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(screen)
	var bg := ColorRect.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.color = Color(0, 0, 0, dark)
	screen.add_child(bg)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.add_theme_constant_override("margin_left", 80)
	margin.add_theme_constant_override("margin_top", 70)
	margin.add_theme_constant_override("margin_right", 80)
	margin.add_theme_constant_override("margin_bottom", 60)
	screen.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	margin.add_child(box)
	return box


func _button(text: String, cb: Callable, primary := false) -> Button:
	var b := Button.new()
	b.text = text
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.custom_minimum_size = Vector2(320, 44)
	b.add_theme_font_size_override("font_size", 22)
	if font:
		b.add_theme_font_override("font", font)
	var n := StyleBoxFlat.new()
	n.bg_color = Color(0.1, 0.02, 0.02, 0.7) if primary else Color(0, 0, 0, 0.35)
	n.border_color = BLOOD if primary else Color(0.4, 0.36, 0.32, 0.5)
	n.border_width_left = 3
	n.set_content_margin_all(10)
	var h := n.duplicate()
	h.bg_color = Color(0.25, 0.03, 0.03, 0.85)
	b.add_theme_stylebox_override("normal", n)
	b.add_theme_stylebox_override("hover", h)
	b.add_theme_stylebox_override("focus", h)
	b.add_theme_stylebox_override("pressed", h)
	b.add_theme_color_override("font_color", BONE)
	b.pressed.connect(cb)
	return b


func show_menu() -> void:
	var box := _screen_base(0.35)
	var t := _label("THE CAT'S HOUSE", 64, BONE)
	box.add_child(t)
	box.add_child(_label("survive the night", 22, BLOOD))
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 24)
	box.add_child(spacer)
	box.add_child(_label("Choose how bad tonight is:", 18, DIM))
	for key in ["easy", "normal", "hard", "nightmare"]:
		var d: Dictionary = game.data.difficulties[key]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 18)
		row.add_child(_button(d.label, func(): game.start_run(key), key == "normal"))
		var blurb := _label(d.blurb, 16, DIM)
		blurb.custom_minimum_size = Vector2(520, 0)
		blurb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		blurb.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		row.add_child(blurb)
		box.add_child(row)
	var sp2 := Control.new()
	sp2.custom_minimum_size = Vector2(0, 16)
	box.add_child(sp2)
	var controls := _label("WASD move · Mouse look · Shift sprint · C crouch · Z crawl · E use / hide (hold E: quiet door)\nF flashlight · G throw · R slam door · L bolt · B barricade · Space hold breath · Tab inventory · Esc pause", 15, DIM)
	box.add_child(controls)
	box.add_child(_button("Quit", func(): game.get_tree().quit()))


func show_pause() -> void:
	var box := _screen_base(0.6)
	box.add_child(_label("PAUSED", 48, BONE))
	box.add_child(_label("%s · %s" % [game.diff.label, game.house.room_name(game.player.room)], 18, DIM))
	box.add_child(_button("Resume", func(): game.resume(), true))
	box.add_child(_button("Restart the night", func(): game.start_run(game.difficulty)))
	box.add_child(_button("Main menu", func(): game.to_menu()))


func show_death(line: String) -> void:
	var box := _screen_base(0.82)
	box.add_child(_label("IT FOUND YOU", 58, BLOOD))
	box.add_child(_label(line, 22, BONE))
	box.add_child(_label("Survived %s" % _fmt(game.run_time), 18, DIM))
	box.add_child(_button("Try again", func(): game.start_run(game.difficulty), true))
	box.add_child(_button("Main menu", func(): game.to_menu()))


func show_ending(title: String, text: String) -> void:
	var box := _screen_base(0.9)
	box.add_child(_label("YOU ESCAPED", 20, BLOOD))
	box.add_child(_label(title, 52, BONE))
	var body := _label(text, 19, BONE)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.custom_minimum_size = Vector2(700, 0)
	box.add_child(body)
	box.add_child(_label("Time %s" % _fmt(game.run_time), 18, DIM))
	box.add_child(_button("Main menu", func(): game.to_menu(), true))


func hide_screen() -> void:
	_clear_screen()


func _fmt(t: float) -> String:
	return "%d:%02d" % [int(t) / 60, int(t) % 60]
