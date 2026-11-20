import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js";
import { createSkateboard } from "./board.js";
import { TRICKS, timing, variants, evaluate, rampSpeed, SPEED, setCoupled, attempt, breakRun, combo, comboPart } from "./tricks.js";

// The board is simulated with articulated trucks and the rider's sideways balance (see COUPLED in
// tricks.js). For comparison only, not part of the interface: adding ?trucks=0 to the address
// simulates it as it was before, with rigid trucks.
const coupled = new URLSearchParams(location.search).get("trucks") !== "0";
setCoupled(coupled);

const $ = (s) => document.querySelector(s);
const ui = {
	stage: $("#stage"),
	canvas: $("#scene"),
	fallback: $("#fallback"),
	list: $("#trickList"),
	tricks: $(".tricks"),
	select: $("#trickSelect"),
	presetList: $("#presetList"),
	presetSelect: $("#presetSelect"),
	viewNote: $("#viewNote"),
	attemptNew: $("#attemptNew"),
	attemptOff: $("#attemptOff"),
	attemptPrev: $("#attemptPrev"),
	attemptNext: $("#attemptNext"),
	attemptCombo: $("#attemptCombo"),
	attemptNote: $("#attemptNote"),
	toast: $("#toast"),
	toastBox: $("#toastBox"),
	tricksToggle: $("#tricksToggle"),
	infoToggle: $("#infoToggle"),
	info: $(".info"),
	viewsToggle: $("#viewsToggle"),
	views: $(".views"),
	name: $("#trickName"),
	note: $("#trickNote"),
	readout: $("#readout"),
	play: $("#playBtn"),
	scrub: $("#scrub"),
	markers: $("#markers"),
	phase: $("#phaseLabel"),
	time: $("#timeLabel"),
	speedBtns: [...document.querySelectorAll(".speed [data-speed]")],
	strobe: $("#strobeBtn"),
	reset: $("#resetBtn"),
	view: $("#viewBtn"),
	transport: $(".transport")
};

const NARROW = "(max-width: 760px)";
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
const setText = (el, text) => {
	if (el.textContent !== text) el.textContent = text;
};

/* ---------- state ---------- */

const state = {
	index: 0,
	trick: TRICKS[0],
	tm: timing(TRICKS[0]),
	t: 0,
	playing: false,
	speed: "ramp",
	strobe: false,
	strobeMix: 0,
	replays: 0, // times the current trick has been started; picks the jump variant
	own: { start: 0, end: 0 }, // Custom: where its slow motion starts and ends, s after the takeoff and after the catch
	vary: false, // Attempts: false = every run is the clean run, true = the run is a numbered attempt (a variation, or a combo)
	combo: false, // …and that attempt is a combo: two or three tricks in one run (only ever true with `vary`)
	before: null, // the speed and the mode as they were before a view was opened: leaving the view puts them back
	handCam: false, // the camera has been moved by hand while a view is in use
	pinned: null, // the one variation a view is showing, replayed as it is while that view is in use
	outro: 0, // seconds past the end of the recording, while the board rolls on and the view fades
	// The view, as offsets from the default camera: angle round the board, height, distance. `y`
	// lowers what the camera aims at and `follow` holds the board in the middle of the picture
	// (both used by the views below, for close looks at a landing). The t… values are where
	// each is heading; the others ease toward them.
	orbit: { az: 0, el: 0, zoom: 1, y: 0, follow: 0, taz: 0, tel: 0, tzoom: 1, ty: 0, tfollow: 0 },
	preset: -1, // the view in use, until the camera is moved by hand or the view is reset
	move: null, // a view's camera move, tied to the timeline; any manual change of view ends it
	dirty: true
};

/* ---------- views ---------- */

// A view sets up what is already there: a trick, one of its jump heights, a speed, a place on the
// timeline and a camera position. Nothing about the motion is changed, and every control keeps
// working afterwards. The values come from the simulated runs: which jump height shows most,
// and when (the truck angle and the deck's bend both peak about 0.05 s after touchdown).
// view(tm) -> az, el, zoom as offsets from the default camera; y and follow as above.
// move(tm) -> optional: the camera turns from `view` to `to` between two times of the run.
// Selections from the default coupled model. These keep the original search results
// without simulating every candidate in a click handler.
const LANDING_EXAMPLES = {
	"bs-180-kickflip": { truck: 31, flex: 100, break: { variant: 0, legs: 1 } },
	"extra-crosswire": { truck: 108, flex: 108, break: { variant: 0, legs: 1 } },
	"kickflip": { truck: 17, flex: 117, break: { variant: 0, legs: 1 } },
	"heelflip": { truck: 126, flex: 67, break: { variant: 0, legs: 1 } },
	"bs-pop-shuvit": { truck: 13, flex: 64, break: { variant: 0, legs: 1 } },
	"fs-pop-shuvit": { truck: 67, flex: 47, break: { variant: 1, legs: 1 } },
	"ollie": { truck: 137, flex: 25, break: { variant: 0, legs: 1 } },
	"varial-heelflip": { truck: 150, flex: 44, break: { variant: 1, legs: 1 } },
	"360-pop-shuvit": { truck: 70, flex: 142, break: { variant: 0, legs: 1 } },
	"360-flip": { truck: 78, flex: 114, break: { variant: 0, legs: 1 } },
	"hardflip": { truck: 37, flex: 56, break: { variant: 0, legs: 1 } },
	"fs-180-ollie": { truck: 139, flex: 130, break: { variant: 0, legs: 2 } },
	"bs-180-ollie": { truck: 58, flex: 136, break: { variant: 0, legs: 2 } },
	"bs-bigspin": { truck: 14, flex: 141, break: { variant: 0, legs: 1 } },
};
const landingStart = (tm) => Math.max(tm.land - 0.12, tm.contact ?? tm.catch);
const PRESETS = [
	{
		name: "Orbit View",
		note: "The whole trick. It starts in Ramp. The camera circles behind the board while it is in the air.",
		trick: "kickflip",
		variant: 0,
		speed: "ramp",
		speeds: ["ramp", "custom", "1", "0.25", "0.1"], // the speeds this view can be played at: all of them
		start: () => 0,
		view: () => ({ az: 0, el: 0, zoom: 0.9 }),
		// while the flight is in slow motion the camera circles from the front quarter to behind
		move: (tm) => ({ t0: tm.takeoff, t1: tm.catch, to: { az: -1.5, el: 0.08, zoom: 0.9 } })
	},
	{
		name: "Top View",
		note: "The whole trick, seen from above the front quarter. It starts in Ramp.",
		trick: "360-flip",
		variant: 0,
		speed: "ramp",
		speeds: ["ramp", "custom", "1", "0.25", "0.1"], // the speeds this view can be played at: all of them
		start: () => 0,
		view: () => ({ az: 0.35, el: 0.5, zoom: 1 }) // from above the front quarter: the flip and the spin read together
	},
	{
		name: "Truck Response",
		note: "Watch the hangers move relative to the deck as the wheels take the load. The landing, from low behind the board. It starts at ⅒×.",
		variant: 0,
		attempt: "truck",
		speed: "0.1",
		speeds: ["1", "0.25", "0.1"], // every steady speed. Ramp and Custom slow the flight, and this view starts after it: they would play as 1×
		start: landingStart,
		view: (tm) => ({ az: -1.75, el: -0.11, zoom: 0.42, y: -(tm.apex * 0.4 + 0.02), follow: 1 }) // from behind, low and close
	},
	{
		name: "Deck Flex",
		note: "Watch the middle of the deck dip and spring back, from the side. It starts at ⅒×. The bend is drawn at its calculated size.",
		variant: 0,
		attempt: "flex",
		speed: "0.1",
		speeds: ["1", "0.25", "0.1"], // every steady speed. Ramp and Custom slow the flight, and this view starts after it: they would play as 1×
		start: landingStart,
		view: (tm) => ({ az: -0.5, el: -0.12, zoom: 0.45, y: -(tm.apex * 0.4 + 0.02), follow: 1 }), // side-on and low
		fit: 0.47 // half the width the picture must show, m: the whole board, also on a narrow screen
	},
	{
		name: "Broken Deck",
		note: "The whole trick. It starts at the Custom speed: slow motion in the air, real speed for the landing and the break. Both feet come down together at the middle of the deck, and the wood is bent past its strength.",
		trick: "heelflip",
		variant: 1,
		attempt: "break",
		speed: "custom", // (on a narrow screen, where there is no Custom, the next in the list)
		speeds: ["custom", "ramp", "0.25", "0.1", "1"], // the speeds this view can be played at
		own: { start: 0.03, end: -0.05 }, // where Custom's two marks stand in this view: the slow motion starts a little later and ends a little sooner
		start: () => 0,
		view: () => ({ az: 0, el: 0, zoom: 0.9 }),
		// the same camera as Orbit View: it circles behind the board while it is in the air
		move: (tm) => ({ t0: tm.takeoff, t1: tm.catch, to: { az: -1.5, el: 0.08, zoom: 0.9 } })
	}
];

/* ---------- interface ---------- */

function buildList() {
	TRICKS.forEach((trick, i) => {
		const li = document.createElement("li");
		const b = document.createElement("button");
		b.type = "button";
		b.className = "trick-btn";
		b.dataset.index = i;
		const num = document.createElement("span");
		num.className = "trick-btn__num";
		num.textContent = String(i + 1).padStart(2, "0");
		const label = document.createElement("span");
		label.textContent = trick.name;
		b.append(num, label);
		b.addEventListener("click", () => chooseTrick(i));
		li.append(b);
		ui.list.append(li);
		// the same list as a native menu, used on narrow screens
		const opt = document.createElement("option");
		opt.value = i;
		opt.textContent = trick.name;
		ui.select.append(opt);
	});
	ui.select.addEventListener("change", () => chooseTrick(+ui.select.value));
}

// The views: a short list beside the stage, and the same as a native menu on narrow screens.
function buildPresets() {
	if (!ui.presetList || !ui.presetSelect) return;
	const none = document.createElement("option");
	none.value = "";
	none.textContent = "Choose…";
	ui.presetSelect.append(none);
	PRESETS.forEach((p, i) => {
		const li = document.createElement("li");
		const b = document.createElement("button");
		b.type = "button";
		b.className = "trick-btn preset-btn";
		b.dataset.preset = i;
		b.textContent = p.name;
		b.title = p.note;
		b.disabled = !coupled && i >= 2;
		b.addEventListener("click", () => applyPreset(i));
		li.append(b);
		ui.presetList.append(li);
		const opt = document.createElement("option");
		opt.value = i;
		opt.textContent = p.name;
		opt.disabled = b.disabled;
		ui.presetSelect.append(opt);
	});
	ui.presetSelect.addEventListener("change", () => (ui.presetSelect.value === "" ? leaveView() : applyPreset(+ui.presetSelect.value)));
}

// A view is a preset: it sets the run, the speed, the moment the run starts from and the camera.
// While it is in use the run can be paused, scrubbed and replayed, the camera can be moved by
// hand, and another trick can be picked (the view carries over to it). The speed can be switched
// among the few the view allows; the other speeds, the mode and Strobe are switched off. Reset
// view and Reset leave the view, and leaving it puts the speed and the mode back as they were
// before it was opened.
function leaveView() {
	if (state.preset < 0) return;
	const b = state.before;
	const shown = state.pinned; // the view's own variation, if it had one
	state.before = null;
	state.handCam = false;
	markPreset(-1);
	if (b) {
		if (b.own) Object.assign(state.own, b.own); // the marks go back to where they were before the view
		setSpeed(b.speed);
		state.vary = b.vary;
		state.combo = !!b.combo;
		syncLocks(); // (Strobe is off in Combos)
	}
	// Back in Clean Run, the view's variation must not stay on the timeline: the clean run is put
	// up in its place, so the mode, the recording, the markers and the pose agree.
	if (state.vary && b) return showNumbered(); // back in Variations or Combos: the attempt this trick is at
	if (shown && state.tm === shown && (!state.vary || state.combo)) {
		state.tm = timing(state.trick);
		state.replays = 0;
		state.t = Math.min(state.t, state.tm.total);
		state.outro = 0;
		setText(ui.note, state.trick.note);
		renderMarkers();
		buildStrobe();
		invalidate();
		syncTransport();
	}
	markAttempt();
}

// the camera moved by hand: a view stays in use, but its own camera move ends
function handCamera() {
	state.move = null;
	state.handCam = true;
}

// a speed chosen by hand
function pickSpeed(v) {
	// The only speeds a view leaves out are Ramp and Custom in the two landing views, and it says why.
	if (state.preset >= 0 && !PRESETS[state.preset].speeds.includes(String(v))) return showToast(PRESETS[state.preset].name, "Ramp and Custom slow the flight, and this view starts after it. They would play as 1×.", "Reset View to leave it.");
	if (v === "custom" && state.speed !== "custom") showToast("Custom", "Ramp, with the slow motion where you put it. Drag the two marks on the timeline.", "Double-click a mark to put it back.");
	setSpeed(v);
}

// what a view switches off is said when it is asked for anyway (from the keyboard)
function viewLocked() {
	showToast(PRESETS[state.preset].name, "This is not available while a view is in use.", "Reset View to leave it.");
}

// the controls a view switches off, and back on when it is left
function syncLocks() {
	const p = state.preset >= 0 ? PRESETS[state.preset] : null;
	ui.speedBtns.forEach((b) => (b.disabled = !!p && !p.speeds.includes(b.dataset.speed)));
	[ui.attemptNew, ui.attemptOff, ui.attemptCombo].forEach((b) => b && (b.disabled = !!p));
	ui.strobe.disabled = !!p || !gl.ok || state.combo;
	syncView();
}

function markPreset(i) {
	state.preset = i;
	syncLocks();
	if (i < 0) {
		state.move = null;
		state.pinned = null;
	}
	document.querySelectorAll(".preset-btn").forEach((b) => b.setAttribute("aria-current", +b.dataset.preset === i ? "true" : "false"));
	if (ui.presetSelect) ui.presetSelect.value = i < 0 ? "" : i;
	// while a view is in use, a line under the trick's description says what it shows and where it starts
	if (ui.viewNote) {
		ui.viewNote.hidden = i < 0;
		const runNote = i >= 0 && PRESETS[i].attempt
			? !state.pinned ? " No qualifying example for this trick." : state.pinned.broke ? ` Leg stiffness ${state.pinned.legs}×.` : ""
			: "";
		setText(ui.viewNote, i < 0 ? "" : `${PRESETS[i].name}. ${PRESETS[i].note}${runNote}`);
	}
}

/* ---------- attempts ---------- */

// Attempts is a mode with two settings, and one of the two is always on.
//  - Clean run: every run is the trick as it was solved (its jump heights taking turns).
//  - Variations: the run is one of the trick's numbered attempts: the selected trick done again
//    with its pop, its flick, its scoop, where the feet come down and when, each a little or a lot
//    different (see `attempt` in tricks.js). Play shows the attempt on screen again; the arrows on
//    the Variations button go to the one before it and the one after it (see stepVariation).
// Choosing a setting starts nothing: it decides what the next run will be when one starts from
// the beginning. While a run is being watched it does not change: pausing, resuming and scrubbing
// show that same run.
// A view owns its run. Most show the solved trick, and choosing one puts the mode on Clean Run;
// Truck Response, Deck Flex and Broken Deck show a variation of their own choosing (see PRESETS). The mode cannot
// be changed while a view is in use.
const attemptCount = {}; // per trick: how many variations have been made
const comboCount = {}; // …and how many combos
const counts = () => (state.combo ? comboCount : attemptCount);
const numbered = (n) => (state.combo ? combo(state.trick, n) : attempt(state.trick, n));

const pct = (k) => `${k < 1 ? "−" : "+"}${Math.abs((k - 1) * 100).toFixed(1)}%`;

const landingRuns = new Map();
function landingExample(trick, kind) {
	const key = `${trick.id}/${kind}`;
	if (landingRuns.has(key)) return landingRuns.get(key);
	const example = LANDING_EXAMPLES[trick.id][kind];
	const run = kind === "break" ? breakRun(trick, example) : attempt(trick, example);
	const valid = kind === "break" ? run?.broke : run.landed && !run.rail && !run.broke && !run.attempt.together;
	landingRuns.set(key, valid ? run : null);
	return landingRuns.get(key);
}

function nextVariation() {
	const id = state.trick.id, made = counts();
	made[id] = (made[id] || 0) + 1;
	return numbered(made[id]);
}

// In Variations, Play repeats the attempt on screen and the two arrows go to the one before it and
// the one after it, at any moment: there is no need to wait for a run to end. (Play used to start
// a new attempt every time, so an attempt could not be seen twice, and the next one could only be
// reached by letting the run finish or dragging the timeline back to its start.)
function stepVariation(d) {
	if (!state.vary || state.preset >= 0) return;
	const id = state.trick.id;
	const shown = state.tm.attempt && !state.pinned ? state.tm.attempt.n : 0; // 0: the clean run is still on screen
	const n = Math.max(1, shown ? shown + d : (counts()[id] || 0) + (d > 0 ? 1 : 0));
	counts()[id] = n;
	state.playing = false;
	state.outro = 0;
	state.t = 0;
	state.again = numbered(n);
	play();
}

function markAttempt() {
	const stepping = state.vary && state.preset < 0;
	if (ui.attemptPrev) ui.attemptPrev.disabled = !stepping || !(state.tm.attempt && state.tm.attempt.n > 1);
	if (ui.attemptNext) ui.attemptNext.disabled = !stepping;
	if (ui.attemptNew) ui.attemptNew.parentElement.classList.toggle("is-varying", stepping && !state.combo); // the arrows show as part of the button that is on
	if (ui.attemptNew) ui.attemptNew.parentElement.classList.toggle("is-combo", stepping && state.combo);
	if (ui.attemptNew) ui.attemptNew.setAttribute("aria-checked", state.vary && !state.combo ? "true" : "false");
	if (ui.attemptCombo) ui.attemptCombo.setAttribute("aria-checked", state.combo ? "true" : "false");
	if (ui.attemptOff) ui.attemptOff.setAttribute("aria-checked", state.vary ? "false" : "true");
	if (!ui.attemptNote) return;
	// while a variation is on screen, a line under the trick's description says what was changed
	// in that run and how it ended
	const a = state.tm.attempt;
	// The heading and the text under it. In Combos they are about the combo, not about one trick:
	// its number, then its tricks in order. No trick is explained there.
	const tm = state.tm;
	if (tm.segments) {
		setText(ui.name, `Combo ${a.n}`);
		setText(ui.note, tm.planned.map((t) => t.name).join(" → "));
	} else if (state.combo) {
		setText(ui.name, "Combos");
		setText(ui.note, `Two or three tricks in one run, opening with the ${state.trick.name}. Press Play.`);
	} else {
		setText(ui.name, state.trick.name);
		setText(ui.note, a || tm.landed ? state.trick.note : `${state.trick.note} (This run did not land.)`);
	}
	ui.attemptNote.hidden = !a;
	if (!a) return setText(ui.attemptNote, "");
	if (a.combo) return comboNote(state.tm);
	const input = state.trick.input;
	const ms = Math.round(a.late * 1000);
	const parts = [];
	if (a.highOllie) parts.push("high Ollie");
	else if (a.pop && Math.abs(a.pop - 1) >= 0.02) parts.push(`pop ${pct(a.pop)}`);
	if (a.level !== undefined) parts.push(`front-foot level ${pct(a.level)}`);
	if (a.wrap) parts.push(`wrap ${pct(a.flick)}`);
	if (a.roll) parts.push(`flick ${pct(a.flick)}`);
	if (a.yaw) {
		parts.push(`${input.riderTurn === input.yaw ? "turn" : "scoop"} ${pct(a.scoop)}`);
	}
	parts.push(ms ? `feet ${Math.abs(ms)} ms ${ms > 0 ? "late" : "early"}` : "feet on time");
	const off = Math.round((a.footOffset || 0) * 1000);
	if (Math.abs(off) >= 15) parts.push(`feet ${Math.abs(off)} mm off center`);
	const back = Math.round((a.backDelay || 0) * 1000);
	if (back >= 8) parts.push(`back foot follows ${back} ms later`);
	const mmR = Math.round((a.placeR || 0) * 1000), mmF = Math.round((a.placeF || 0) * 1000);
	if (mmR || mmF) parts.push(`back foot ${Math.abs(mmR)} mm ${mmR < 0 ? "out" : "in"}, front foot ${Math.abs(mmF)} mm ${mmF < 0 ? "out" : "in"}`);
	if (a.legs >= 1.1) parts.push("stiffer knees");
	if (a.legs <= 0.9) parts.push("softer knees");
	// what was changed, then how it ended: the outcome stands out, a miss most of all
	const outcome = document.createElement("strong");
	// A landing with the feet well between the trucks is a rough one: the deck takes it across its
	// middle and bends. From 3 mm the bend can be seen, and the landing is called what it is.
	const bend = Math.round((state.tm.flexPeak || 0) * 1000);
	const rough = state.tm.landed && bend >= 3;
	const rail = state.tm.landed && state.tm.rail; // down on its rail first, and only then onto the wheels
	outcome.className = !state.tm.landed ? "info__outcome is-miss" : rail || rough ? "info__outcome is-rough" : "info__outcome";
	outcome.textContent = state.tm.broke ? "The deck breaks." : !state.tm.landed ? "It does not land." : rail ? "It comes down on its rail before it settles on the wheels." : rough ? `It lands with ${bend} mm of deck flex.` : "It lands.";
	ui.attemptNote.replaceChildren(document.createTextNode(`Variation ${a.n}: ${parts.join(", ")}. `), ...(revealed() ? [outcome] : []));
}

// Sets the mode. Nothing is played or restarted: the run on screen stays until the next one starts.
// A short message over the picture says what the chosen mode means.
// The line under the description while a combo is on screen: its tricks, and how far it got.
function comboNote(tm) {
	const got = tm.segments.length, last = tm.segments[got - 1].tm;
	const which = ["first", "second", "third"][got - 1];
	const bend = Math.round((tm.flexPeak || 0) * 1000);
	const outcome = document.createElement("strong");
	outcome.className = !tm.landed ? "info__outcome is-miss" : tm.rail || bend >= 3 ? "info__outcome is-rough" : "info__outcome";
	outcome.textContent = tm.landed
		? `${tm.planned.length === 2 ? "Both land" : "All three land"}${tm.rail ? ", one of them on its rail first" : bend >= 3 ? `, with up to ${bend} mm of deck flex` : ""}.`
		: `${last.broke ? `The deck breaks on the ${which}` : `The ${which} does not land`}${got < tm.planned.length ? ", and the combo ends there" : ""}.`;
	ui.attemptNote.hidden = !revealed(); // (the tricks are in the text above: this line only says how it went, once it has)
	ui.attemptNote.replaceChildren(outcome);
}

// Puts the numbered attempt this trick is at (its first, to begin with) on the timeline, stopped
// at its start.
function showNumbered() {
	pause();
	const id = state.trick.id, made = counts();
	made[id] = made[id] || 1;
	state.tm = numbered(made[id]);
	state.again = null;
	renderMarkers();
	buildStrobe();
	setTime(0);
	markAttempt();
}

// How an attempt ended is not said before it has been seen: the line appears once the run has
// reached the moment that decides it (the landing, the miss, the break), and then stays.
const decidedAt = (tm) => (tm.broke ? tm.tBreak : !tm.landed ? (tm.floorImpact ?? (tm.touched ? tm.land : tm.total)) : tm.land);
const revealed = () => state.seen === state.tm || !!state.pinned; // (a view's own example says at once what it is)

// The three modes: "clean", "vary" (Variations) and "combo" (Combos). One is always on.
const mode = () => (state.combo ? "combo" : state.vary ? "vary" : "clean");
function setMode(m) {
	if (state.preset >= 0) return viewLocked(); // the views have their own run
	if (mode() === m) return; // already the mode: nothing changes, and its message is not shown again (a view does the same)
	const was = mode();
	state.vary = m !== "clean";
	state.combo = m === "combo";
	// A combo is watched at real speed first: its pace, and the wait between its tricks, are part of
	// it. The speed in use before comes back when Combos is left. Any speed can still be chosen.
	// Custom's two marks are kept apart for Combos as well: a zone stretched over a whole combo
	// means nothing on one trick.
	if (m === "combo") {
		state.speedBefore = state.speed;
		state.ownSingle = { ...state.own };
		Object.assign(state.own, state.ownCombo || { start: 0, end: 0 });
		setSpeed(1);
	} else if (was === "combo") {
		state.ownCombo = { ...state.own };
		Object.assign(state.own, state.ownSingle || { start: 0, end: 0 });
		if (state.speedBefore !== undefined) setSpeed(state.speedBefore);
		state.speedBefore = undefined;
		syncMarks();
	}
	if (state.combo) setStrobe(false); // Strobe lays out one flight: a combo has two or three
	// The run of the new mode is put up at once, stopped at its start, so the timeline and the text
	// above already show what Play will play: the clean run, or the attempt this trick is at.
	pause();
	if (m !== "clean") showNumbered();
	else if (state.tm.attempt) {
		state.tm = timing(state.trick);
		state.replays = 0;
		renderMarkers();
		setTime(0);
	}
	syncLocks();
	markAttempt();
	const steps = "Play repeats the one on screen. The arrows on the button go to the one before and the next.";
	if (m === "combo") showToast("Combos", "Two or three tricks in one run. Each starts from wherever the one before it left the board, so a rough landing costs the next trick. A miss or a broken deck ends the combo.", steps);
	else if (m === "vary") showToast("Variations", "Each attempt is the trick done a little differently, and sometimes badly. Some land clean, some land hard, some fail, some break the deck.", steps);
	else showToast("Clean Run", "Each run is the trick done perfectly. It lands clean every time.", "Starts with the next run.");
}
function comboLocked() {
	showToast("Combos", "Strobe lays out one flight, and a combo has two or three. It is not available in Combos.", "Choose Clean Run or Variations to use it.");
}

// A message in the middle of the picture. It goes after a few seconds, or as soon as anything
// else is done: a click or a touch anywhere, a key, the wheel, or a run starting.
let toastTimer = 0;

function showToast(title, text, small) {
	if (!ui.toastBox) return;
	const b = document.createElement("strong");
	b.textContent = title;
	const t = document.createElement("span");
	t.textContent = text;
	const m = document.createElement("small");
	m.textContent = small || "";
	ui.toastBox.replaceChildren(b, t, m);
	ui.toast.classList.add("is-on");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
	clearTimeout(toastTimer);
	if (ui.toast) ui.toast.classList.remove("is-on");
}

// Picking a trick while a view is in use keeps the view: the same speed, the same moment of the
// run and the same camera, on the new trick (see leaveView for what does leave a view).
function chooseTrick(i) {
	if (state.preset >= 0 && gl.ok) applyPreset(state.preset, i);
	else selectTrick(i, true);
}

// `trick` (an index into TRICKS) is given when the view is carried over to another trick;
// Truck Response and Deck Flex otherwise keep the selected trick.
function applyPreset(i, trick) {
	const p = PRESETS[i];
	if (!p || !gl.ok || (!coupled && i >= 2)) return;
	const opened = state.preset !== i; // not when the view is carried to another trick or opened again
	// A view opens from any mode, Combos included. It takes over while it is open, and leaving it
	// gives back the mode and the speed that were in use (see leaveView).
	if (state.preset < 0) {
		state.before = { speed: state.speed, vary: state.vary, combo: state.combo, own: { ...state.own } };
		state.combo = false; // a view shows one trick
	}
	// carried over to another trick with the camera already moved by hand: the camera is left alone
	const keepCamera = trick !== undefined && state.preset === i && state.handCam;
	if (!keepCamera) state.handCam = false;
	const landingView = p.attempt === "truck" || p.attempt === "flex";
	selectTrick(trick ?? (landingView ? state.index : TRICKS.findIndex((t) => t.id === p.trick)), false);
	// the jump height: play() takes the next one in the cycle when a run starts from the beginning
	const list = variants(state.trick);
	const at = Math.max(0, list.indexOf(p.variant));
	// A view shows the trick as solved, unless it is made to show one particular variation. Carried
	// to a trick on which that variation does not land, it shows that trick's clean run.
	let tm = p.attempt === "break" || landingView ? landingExample(state.trick, p.attempt) : p.attempt ? attempt(state.trick, p.attempt) : null;
	if (tm && !tm.landed && !tm.broke) tm = null;
	state.pinned = tm;
	state.vary = !!tm;
	if (!tm) tm = timing(state.trick, list[at]);
	const start = Math.min(tm.total, Math.max(0, p.start(tm)));
	if (start > 0 || state.pinned) {
		// (a view's own variation is put up at once, so its markers and length show before Play)
		if (tm !== state.tm) {
			state.tm = tm;
			renderMarkers();
			buildStrobe();
		}
		state.replays = at + 1;
	} else {
		state.replays = at;
	}
	setStrobe(false);
	// a view that opens in Custom brings its own marks; on a narrow screen it opens at its next speed
	const first = p.speed === "custom" && window.matchMedia(NARROW).matches ? p.speeds.find((v) => v !== "custom") : p.speed;
	if (opened && p.own) Object.assign(state.own, p.own);
	setSpeed(!opened && p.speeds.includes(String(state.speed)) ? state.speed : first); // carried to another trick, the speed chosen in the view stays
	setTime(start);
	if (!keepCamera) {
		const v = p.view(tm);
		if (p.fit) {
			// no closer than shows the width this view needs (the same distance rule as cameraFor)
			const a = gl.camera.aspect, narrow = THREE.MathUtils.clamp(1.12 / a, 1, 1.9);
			const dist = (1.75 + tm.apex * 0.9 + (tm.endOverEnd ? 0.6 : 0)) * narrow;
			v.zoom = Math.max(v.zoom, p.fit / (dist * Math.tan(THREE.MathUtils.degToRad(gl.camera.fov / 2)) * a));
		}
		Object.assign(state.orbit, { taz: v.az, tel: v.el, tzoom: v.zoom, ty: v.y || 0, tfollow: v.follow || 0 });
		const m = p.move ? p.move(tm) : null;
		state.move = m ? { t0: m.t0, t1: m.t1, y0: m.y0, y1: m.y1, from: v, to: m.to } : null;
	}
	syncView();
	markPreset(i);
	markAttempt();
	if (opened) {
		// a view just opened says what it allows, and waits at its starting moment for Play
		const label = (v) => ui.speedBtns.find((b) => b.dataset.speed === v).textContent.trim();
		const narrow = window.matchMedia(NARROW).matches; // a narrow screen has no Custom
		const all = ui.speedBtns.every((b) => p.speeds.includes(b.dataset.speed) || (narrow && b.dataset.speed === "custom"));
		pause();
		showToast(
			p.name,
			`This view starts ${/×/.test(label(first)) ? "at" : "in"} ${label(first)}. ${all ? "Any other speed can be chosen." : "The steady speeds can be chosen; Ramp and Custom slow the flight, which is over when this view starts."} The camera can be moved and another trick picked.`,
			"Press Play to start. Reset View to leave it."
		);
	} else play();
	// The picture fades in, so that a new run is seen to begin. Without it, picking another trick
	// in a close landing view looks like the same landing carrying on.
	const c = ui.canvas.style;
	c.transition = "none";
	c.opacity = "0";
	void ui.canvas.offsetWidth; // the fade starts from here, not from wherever the last one was
	c.transition = "opacity 0.3s";
	c.opacity = ""; // fades in at once, also while the run waits for the view's message to go
	clearTimeout(applyPreset.fade);
	applyPreset.fade = setTimeout(() => c.transition === "opacity 0.3s" && (c.transition = ""), 400); // leave the end-of-run fade as it was
}

let markerEls = [];

const WHEEL_NAMES = ["heel-side wheel at the tail", "toe-side wheel at the tail", "heel-side wheel at the nose", "toe-side wheel at the nose"];
function touchdownText(touch) {
	return WHEEL_NAMES.filter((_, i) => touch.mask & (1 << i)).join(" + ");
}

function renderMarkers() {
	const { tm } = state;
	ui.markers.replaceChildren();
	markerEls = tm.markers.map((m) => {
		const el = document.createElement("span");
		el.className = "marker";
		const x = m.t / tm.total;
		el.style.left = `${x * 100}%`;
		el.dataset.label = m.label;
		el.title = m.label === "Land" && tm.wheelTouchdown ? `First contact: ${touchdownText(tm.wheelTouchdown)}` : m.label;
		el.dataset.t = m.t;
		ui.markers.append(el);
		return el;
	});
	let band = $(".timeline__air");
	if (!band) {
		band = document.createElement("div");
		band.className = "timeline__air";
		ui.scrub.before(band);
	}
	fitMarkerLabels();
	band.hidden = !!tm.segments; // (a combo has a flight for each trick: its markers show them)
	band.style.left = `${(tm.takeoff / tm.total) * 100}%`;
	band.style.width = `${(tm.airtime / tm.total) * 100}%`;
	syncMarks();
}

// Every event keeps its tick on the timeline. Its label is shown only where there is room for it:
// a label that would run into the one before it is left out. This is measured on the page, so it
// holds at any width and is done again when the window is resized. (It used to be decided by a
// fixed share of the timeline's length, and the labels overlapped on a short timeline.)
function fitMarkerLabels() {
	let edge = -Infinity;
	for (const el of markerEls) {
		el.textContent = el.dataset.label;
		const box = el.getBoundingClientRect();
		if (box.width && box.left < edge + 8) el.textContent = "";
		else if (box.width) edge = box.right;
	}
}

function phaseName() {
	if (state.tm.segments) {
		// a combo: the trick that is playing, and where it is in it
		const g = comboPart(state.tm, state.t);
		return `${g.trick.name} · ${phaseOf(g.tm, state.t - g.t0)}`;
	}
	return phaseOf(state.tm, state.t);
}
function phaseOf(tm, t) {
	if (t < tm.popStart) return "Approach";
	if (t < tm.takeoff) return "Pop";
	if (tm.broke && t >= tm.tBreak) return "Deck Broken";
	if (!tm.landed && t >= (tm.floorImpact ?? (tm.touched ? tm.land : tm.total))) return "Did Not Land";
	if (t < tm.land || !tm.landed) return `Airborne ${(t - tm.takeoff).toFixed(2)}${tm.landed ? ` / ${tm.airtime.toFixed(2)}` : ""} s`;
	return tm.rail ? "Landed on the Rail" : "Landed";
}

function syncTransport() {
	const { t, tm } = state;
	if (tm.attempt && state.seen !== tm && t >= decidedAt(tm) - 1e-4) {
		state.seen = tm;
		markAttempt(); // …and now it can be said how it went
	}
	const p = tm.total ? t / tm.total : 0;
	const step = String(Math.round(p * 1000));
	if (ui.scrub.value !== step) ui.scrub.value = step;
	ui.scrub.style.setProperty("--p", `${p * 100}%`);
	const phase = phaseName();
	const announced = `${t.toFixed(2)} seconds, ${phase}`;
	if (ui.scrub.getAttribute("aria-valuetext") !== announced) ui.scrub.setAttribute("aria-valuetext", announced);
	setText(ui.time, `${t.toFixed(2)} s / ${tm.total.toFixed(2)} s`);
	setText(ui.phase, phase);
	markerEls.forEach((m) => m.classList.toggle("is-passed", t >= +m.dataset.t - 1e-4));
	const done = t >= tm.total - 1e-4;
	const s = state.playing ? "pause" : done ? "replay" : "play";
	if (ui.play.dataset.state !== s) {
		ui.play.dataset.state = s;
		ui.play.setAttribute("aria-label", s === "pause" ? "Pause" : s === "replay" ? "Replay" : "Play");
	}
}

function selectTrick(i, autoplay) {
	markPreset(-1); // choosing a trick leaves any view; the camera stays where it is
	state.index = (i + TRICKS.length) % TRICKS.length;
	state.trick = TRICKS[state.index];
	state.tm = timing(state.trick);
	state.replays = 0;
	state.pinned = null;
	state.t = 0;
	state.playing = false;
	state.outro = 0;
	ui.canvas.style.opacity = "";
	document.querySelectorAll(".trick-btn").forEach((b) => b.setAttribute("aria-current", +b.dataset.index === state.index ? "true" : "false"));
	ui.select.value = state.index;
	setText(ui.name, state.trick.name);
	setText(ui.note, state.tm.landed ? state.trick.note : `${state.trick.note} (This run did not land.)`);
	renderMarkers();
	markAttempt();
	if (gl.ok) buildStrobe();
	// In Variations or Combos a trick picked from the list shows the attempt it is at, its first to
	// begin with. (It used to move on to the next one each time the trick was picked, so a trick
	// whose first attempt had only been put up, never played, started at its second.)
	if (autoplay && state.vary) showNumbered();
	if (autoplay) play();
	invalidate();
	syncTransport();
}

function play() {
	if (state.t >= state.tm.total - 1e-4) state.t = 0;
	if (state.t === 0) {
		// A run starting from the beginning. In Variations it is the attempt on screen again (or the
		// one an arrow asked for, or the first if the clean run is still showing). In Clean Run it is
		// the clean run at the next jump height in a fixed cycle (normal, a little higher, a little
		// lower), so replays are not identical. Resuming a paused run keeps its own.
		let tm;
		if (state.pinned && state.preset >= 0) tm = state.pinned; // a view's own variation, replayed as it is
		else if (state.vary) tm = state.again || (state.tm.attempt && !state.pinned ? state.tm : nextVariation()); // the attempt asked for, or the one on screen again, or the first
		else {
			const list = variants(state.trick);
			tm = timing(state.trick, list[state.replays % list.length]);
			state.replays++;
		}
		state.again = null;
		if (state.preset >= 0) state.t = Math.min(tm.total, Math.max(0, PRESETS[state.preset].start(tm)));
		if (tm !== state.tm) {
			state.tm = tm;
			renderMarkers();
			buildStrobe();
		}
		markAttempt();
	}
	ui.canvas.style.transition = "";
	state.playing = true;
	invalidate();
	hideToast();
	syncTransport();
}

function pause() {
	state.playing = false;
	state.outro = 0;
	ui.canvas.style.opacity = "";
	invalidate();
	syncTransport();
}

function togglePlay() {
	state.playing ? pause() : play();
}

function setTime(t) {
	state.outro = 0;
	ui.canvas.style.opacity = "";
	state.t = Math.min(state.tm.total, Math.max(0, t));
	invalidate();
	syncTransport();
}

function setSpeed(v) {
	state.speed = v === "ramp" || v === "custom" ? v : +v;
	ui.speedBtns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.speed === String(v))));
	syncMarks();
}

function setStrobe(on) {
	if (on && !gl.ok) return;
	// Strobe has a framing of its own (the whole flight, from the side, standing still), so
	// switching it on leaves a chosen view and that view's camera. A view moved by hand is kept.
	if (on && state.preset >= 0) return viewLocked(); // Strobe has a framing of its own
	if (on && state.combo) return comboLocked();
	state.strobe = on;
	if (on) buildStrobe();
	ui.strobe.setAttribute("aria-pressed", String(on));
	invalidate();
}

// Reset puts everything back as the page opens, for the trick that is selected: the clean run at
// its start, Ramp, Custom's two marks where they began, Clean Run, no view, no Strobe, the default
// camera. (It used to leave the speed, the marks and the mode as they were.)
function resetAll() {
	pause();
	leaveView();
	state.vary = false;
	state.combo = false;
	state.ownCombo = state.ownSingle = undefined;
	syncLocks();
	Object.assign(state.own, { start: 0, end: 0 });
	setSpeed("ramp");
	if (state.tm !== timing(state.trick)) {
		state.tm = timing(state.trick);
		setText(ui.note, state.trick.note);
		renderMarkers();
	}
	state.replays = 0;
	setTime(0);
	markAttempt();
	Object.assign(state.orbit, { taz: 0, tel: 0, tzoom: 1, ty: 0, tfollow: 0 });
	syncView();
	setStrobe(false);
	hideToast();
}

/* ---------- WebGL ---------- */

const gl = { ok: false };

function graphicsUnavailable(error) {
	console.warn("Board Motion graphics unavailable:", error);
	gl.ok = false;
	ui.fallback.hidden = false;
	ui.canvas.hidden = true;
	ui.strobe.disabled = true;
	ui.view.disabled = true;
	ui.presetSelect.disabled = true;
	document.querySelectorAll(".preset-btn").forEach((button) => { button.disabled = true; });
}

function initGL() {
	const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: "high-performance" });
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.0;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.autoUpdate = false;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const backdrop = new THREE.Color(0xe8e8e6);
	const scene = new THREE.Scene();
	scene.background = backdrop;
	scene.fog = new THREE.Fog(backdrop, 9, 26); // only fades the far floor into the backdrop; the board is never in it

	// studio environment for reflections: a pale room with three soft boxes
	const envScene = new THREE.Scene();
	envScene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0xa1a1a0, side: THREE.BackSide })));
	const box = (w, h, x, y, z, c) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c), side: THREE.DoubleSide }));
		m.position.set(x, y, z);
		m.lookAt(0, 0, 0);
		envScene.add(m);
	};
	box(8, 3, 0, 4.8, 0, 0xffffff);
	box(3, 6, -9, 2, 3, 0xfff8ee);
	box(3, 5, 8, 1.5, -6, 0xeaf0ff);
	const pmrem = new THREE.PMREMGenerator(renderer);
	scene.environment = pmrem.fromScene(envScene, 0.035).texture;
	scene.environmentIntensity = 0.7;
	pmrem.dispose();

	scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b0ae, 0.55));
	const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
	key.castShadow = true;
	key.shadow.mapSize.set(1024, 1024);
	const sc = key.shadow.camera;
	sc.left = -0.85;
	sc.right = 0.85;
	sc.top = 0.85;
	sc.bottom = -0.85;
	sc.near = 0.5;
	sc.far = 9;
	key.shadow.bias = -0.0003;
	key.shadow.normalBias = 0.008;
	key.shadow.radius = 3;
	scene.add(key, key.target);
	const rim = new THREE.DirectionalLight(0xe2e8ff, 1.1);
	scene.add(rim, rim.target);

	// Floor: poured concrete slabs. The joints (every 0.6 m), the speckle of the aggregate and a
	// few faint stains are fixed in the world, so they stream past the travelling camera and show
	// how fast and how far the board moves. One texture tile covers 2.4 m.
	const TILE = 2.4;
	const gc = document.createElement("canvas");
	gc.width = gc.height = 1024;
	const g = gc.getContext("2d");
	g.fillStyle = "#d6d6d3";
	g.fillRect(0, 0, 1024, 1024);
	let seed = 5;
	const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
	for (let i = 0; i < 26; i++) {
		// faint stains
		const x = rnd() * 1024, y = rnd() * 1024, r = 40 + rnd() * 120;
		const st = g.createRadialGradient(x, y, 0, x, y, r);
		const dark = rnd() > 0.5;
		st.addColorStop(0, dark ? "rgba(70,70,66,0.07)" : "rgba(255,255,255,0.09)");
		st.addColorStop(1, "rgba(128,128,128,0)");
		g.fillStyle = st;
		for (let dx = -1024; dx <= 1024; dx += 1024) for (let dy = -1024; dy <= 1024; dy += 1024) g.fillRect(x - r + dx, y - r + dy, r * 2, r * 2);
	}
	for (let i = 0; i < 5200; i++) {
		// aggregate
		const v = rnd();
		g.fillStyle = v > 0.55 ? `rgba(60,60,56,${0.1 + rnd() * 0.22})` : `rgba(255,255,255,${0.15 + rnd() * 0.25})`;
		const r = 0.6 + rnd() * rnd() * 2.6;
		g.beginPath();
		g.arc(rnd() * 1024, rnd() * 1024, r, 0, Math.PI * 2);
		g.fill();
	}
	g.fillStyle = "rgba(50,50,48,0.34)";
	for (let k = 0; k < 4; k++) {
		g.fillRect(k * 256, 0, 2.5, 1024); // joints across the travel
		g.fillRect(0, k * 256, 1024, 2.5); // and along it
	}
	const gtex = new THREE.CanvasTexture(gc);
	gtex.colorSpace = THREE.SRGBColorSpace;
	gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
	gtex.repeat.set(80 / TILE, 80 / TILE);
	gtex.anisotropy = renderer.capabilities.getMaxAnisotropy();
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.92 }));
	ground.rotation.x = -Math.PI / 2;
	ground.position.x = 20;
	ground.receiveShadow = true;
	scene.add(ground);

	// soft contact shadow that fades as the board rises
	const bc = document.createElement("canvas");
	bc.width = bc.height = 128;
	const bg = bc.getContext("2d");
	const grad = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
	grad.addColorStop(0, "rgba(16,16,16,0.55)");
	grad.addColorStop(1, "rgba(16,16,16,0)");
	bg.fillStyle = grad;
	bg.fillRect(0, 0, 128, 128);
	const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false }));
	blob.rotation.x = -Math.PI / 2;
	blob.position.y = 0.0015;
	blob.renderOrder = 1;
	scene.add(blob);

	const board = createSkateboard(invalidate);
	board.root.matrixAutoUpdate = false;
	scene.add(board.root);

	// strobe exposures are built the first time Strobe is switched on
	const ghostMat = new THREE.MeshStandardMaterial({ color: 0xc6c6c3, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
	const pathMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0 });
	const path = new THREE.Line(new THREE.BufferGeometry(), pathMat);
	path.frustumCulled = false;
	scene.add(path);

	const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
	Object.assign(gl, { ok: true, renderer, scene, camera, key, rim, board, blob, ghosts: [], ghostMat, path, pathMat, pose: { matrix: new THREE.Matrix4() } });
	return true;
}

function buildStrobe() {
	if (!gl.ok || !state.strobe) return;
	while (gl.ghosts.length < 5) {
		const exposure = gl.board.createExposure(gl.ghostMat);
		exposure.root.visible = false;
		gl.scene.add(exposure.root);
		gl.ghosts.push(exposure);
	}
	const { trick, tm } = state;
	const tmp = { matrix: new THREE.Matrix4() };
	const end = tm.takeoff + tm.airtime;
	gl.ghosts.forEach((exposure, i) => {
		const time = tm.takeoff + (tm.airtime * (i + 0.5)) / gl.ghosts.length;
		evaluate(trick, tm, time, tmp);
		exposure.setPose(tmp, tm.flexScale || 1);
	});
	const pts = [];
	for (let i = 0; i <= 80; i++) {
		evaluate(trick, tm, tm.popStart + ((end - tm.popStart) * i) / 80, tmp);
		pts.push(new THREE.Vector3(0, -0.03, 0).applyMatrix4(tmp.matrix));
	}
	gl.path.geometry.dispose();
	gl.path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

/* ---------- camera ---------- */

const layout = { desktop: true, w: 1, h: 1, shiftX: 0, shiftY: 0 };
const _target = new THREE.Vector3();

// The camera is a steady dolly: it moves along the floor at one constant speed and never changes
// height, angle or distance during a trick. It travels slower than the board, so the board
// moves steadily across the picture from left to right and its forward travel stays visible,
// in the slow-motion flight and in the fall to the landing. The board is centred at the middle
// of its flight. On a wide window it rolls out of the picture shortly before the timeline ends.
function cameraFor(time, boardX, lift, boardZ = 0) {
	const { tm, orbit } = state;
	let az = 0.5;
	let el = 0.17;
	const narrow = THREE.MathUtils.clamp(1.12 / gl.camera.aspect, 1, 1.9); // keep the board in frame on narrow stages
	let dist = (1.75 + tm.apex * 0.9 + (tm.endOverEnd ? 0.6 : 0)) * narrow;
	const halfWidth = dist * Math.tan(THREE.MathUtils.degToRad(gl.camera.fov / 2)) * gl.camera.aspect;
	const tMid = (tm.takeoff + tm.land) / 2;
	// How much slower than the board the camera travels, m/s: as much as the picture's width
	// allows with the whole board in view when the clip starts, and never less than what brings
	// the board to the picture's edge as the timeline ends. At most half the board's speed.
	const lag = Math.min(0.5 * SPEED, Math.max((0.95 * halfWidth) / (tm.total - tMid), (halfWidth - 0.45) / tMid));
	_target.set(SPEED * tMid + (SPEED - lag) * (time - tMid) + 0.05, 0.1 + tm.apex * 0.4, 0);

	// A combo travels two or three times as far as one trick: the camera keeps pace with the board
	// all the way, with the board in the middle of the picture.
	if (tm.segments) {
		_target.x = boardX;
		// …until the deck breaks. From that moment the camera stops (over a few centimetres, not dead),
		// so the broken board is seen to slide on and come to rest. Held on the board, that slide
		// showed only as the floor shifting a little under it.
		if (tm.broke && time > tm.tBreak) {
			if (!tm.hold) {
				const at = (t) => evaluate(state.trick, tm, t).matrix.elements[12];
				const x = at(tm.tBreak);
				tm.hold = { x, v: (x - at(tm.tBreak - 0.02)) / 0.02 };
			}
			const ease = 0.03; // s
			_target.x = tm.hold.x + tm.hold.v * ease * (1 - Math.exp(-(time - tm.tBreak) / ease));
		}
	}

	// strobe frames the whole flight from the side, standing still
	const s = state.strobeMix;
	if (s > 0) {
		_target.x = lerp(_target.x, SPEED * (tm.takeoff + tm.airtime / 2), s);
		_target.y = lerp(_target.y, tm.apex * 0.55, s);
		az = lerp(az, 0.04, s);
		el = lerp(el, 0.06, s);
		dist = lerp(dist, (2.5 + tm.apex * 1.7) * narrow, s);
	}

	// a view can aim lower than the default (at the board on the floor, not at the middle of the
	// jump) and hold the board in the middle of the picture instead of letting it travel across
	// (not in strobe, which frames the whole flight standing still)
	_target.x = lerp(_target.x, boardX, orbit.follow * (1 - s));
	// …also sideways: a trick that spins can come down well off the line it left on (the Crosswire
	// 0.4 m), which put it at the edge of a close view or outside it
	// (The default camera follows most of the way too. A trick that comes down well off its line,
	// or a failed attempt that drifts, otherwise slid to the bottom of the picture or out of it.)
	_target.z = boardZ * Math.max(orbit.follow, 0.75) * (1 - s);
	// …and, while the board is still coming down, looks part of the way up toward it, so it is in
	// the picture before it lands; once it is on the floor the camera is where the view put it
	_target.y += (orbit.y + orbit.follow * 0.85 * lift) * (1 - s);

	az += orbit.az;
	el = THREE.MathUtils.clamp(el + orbit.el, 0.03, 1.35);
	dist *= orbit.zoom;
	gl.camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(_target);
	gl.camera.lookAt(_target);
}

// Render resolution is fixed: the device's pixel ratio, capped at 2 and at a pixel budget that
// limits supersampling. Native 1× is the floor even on larger windows.
const PIXEL_BUDGET = 3.4e6;

function applyResolution() {
	const { w, h } = layout;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const ratio = Math.max(1, Math.min(dpr, Math.sqrt(PIXEL_BUDGET / (w * h))));
	if (gl.renderer.getPixelRatio() !== ratio) gl.renderer.setPixelRatio(ratio);
	gl.renderer.setSize(w, h, false);
}

function onResize() {
	fitMarkerLabels();
	if (!gl.ok) return;
	const rect = ui.stage.getBoundingClientRect();
	layout.w = Math.max(1, rect.width);
	layout.h = Math.max(1, rect.height);
	layout.desktop = !matchMedia(NARROW).matches;
	applyResolution();
	gl.camera.aspect = layout.w / layout.h;
	if (layout.desktop) {
		// centre the board in the space left free by the trick list and the transport bar. The
		// list's place is used whether it is showing or slid away, so hiding it does not move the scene.
		layout.shiftX = ui.tricks.getBoundingClientRect().right / 2;
		layout.shiftY = -(ui.transport.getBoundingClientRect().height + 16) / 2;
	}
	applyOffset();
}

function applyOffset() {
	if (layout.desktop) gl.camera.setViewOffset(layout.w, layout.h, -layout.shiftX, -layout.shiftY, layout.w, layout.h);
	else gl.camera.clearViewOffset();
	gl.camera.updateProjectionMatrix();
	invalidate();
}

// The lists at the sides can be slid out of the picture, to leave it to the board, and back.
// On narrow screens they are menus above the picture and are always there.
function togglePanel(button, panel) {
	const open = button.getAttribute("aria-expanded") !== "true";
	button.setAttribute("aria-expanded", String(open));
	panel.classList.toggle("is-closed", !open);
}

/* ---------- Custom: the two marks on the timeline ---------- */

// Custom is Ramp with the slow motion where the viewer puts it. Two marks on the timeline are
// dragged: from the first the speed is 1/10, from the second it is real again (the board gathers
// pace over the tenth of a second before it). They are kept as offsets from the takeoff and from
// the catch (state.own), so they carry over to every trick and jump height. The marks show only
// while Custom is the speed, and Custom is left out on narrow screens.
const marks = { zone: null, start: null, end: null, sStart: null, sEnd: null, narrow: window.matchMedia(NARROW) };
// where the two marks stand in the run on screen: the slow motion is complete 0.015 s after it begins
// (In a combo the two marks start on its first trick's flight, like on any trick, and can be
// dragged anywhere along the whole combo: Custom is one slow zone, wherever it is put.)
const markTimes = () => ({ total: state.tm.total, start: state.tm.takeoff + 0.015, end: state.tm.catch, limit: state.tm.total });
// The marks as they apply to the run on screen. They are kept as offsets, so a pair set on a trick
// with a long flight can cross on one with a short flight, and a mark put back by a double-click
// can land past the other. The first mark then gives way: the slow motion always has its 0.12 s
// and both marks stay inside the run. (Without this, crossed marks played the whole run at 1×.)
const _own = { start: 0, end: 0 };
function ownNow() {
	const r = markTimes();
	const end = THREE.MathUtils.clamp(r.end + state.own.end, 0.14, r.limit);
	const start = THREE.MathUtils.clamp(r.start + state.own.start, 0.02, end - 0.12);
	_own.start = start - r.start;
	_own.end = end - r.end;
	return _own;
}

function buildMarks() {
	const btn = $('.speed [data-speed="custom"]'), line = $(".timeline");
	if (!btn || !line) return; // (the recorder's page has no Custom)
	const mark = (title, speed) => {
		const h = document.createElement("div"), l = document.createElement("span"), moved = document.createElement("small");
		h.className = "ramp-mark";
		h.title = title;
		h.tabIndex = 0;
		h.setAttribute("role", "slider");
		h.setAttribute("aria-label", speed === "⅒×" ? "Slow motion starts" : "Real speed resumes");
		h.setAttribute("aria-valuemin", "0");
		l.className = "ramp-mark__label";
		l.append(speed, moved); // its speed, and in smaller type how far it has been moved
		h.append(l);
		return [h, moved];
	};
	marks.zone = document.createElement("div");
	marks.zone.className = "ramp-zone";
	[marks.start, marks.sStart] = mark("Drag: from here the speed is ⅒×. Double-click to put it back.", "⅒×");
	[marks.end, marks.sEnd] = mark("Drag: from here the speed is 1× again; the board gathers pace over the tenth of a second before it. Double-click to put it back.", "1×");
	line.append(marks.zone, marks.start, marks.end);
	const drag = (handle, key) => {
		handle.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			Object.assign(state.own, ownNow()); // a drag starts from where the marks are shown
			const move = (ev) => {
				const r = markTimes(), box = ui.scrub.getBoundingClientRect();
				const t = THREE.MathUtils.clamp((ev.clientX - box.left) / box.width, 0, 1) * r.total;
				state.own[key] = Math.round((t - r[key]) * 200) / 200; // steps of 5 ms
				// real speed cannot be back before the slow motion has begun and had time to end
				if (r.end + state.own.end < r.start + state.own.start + 0.12) {
					if (key === "end") state.own.end = r.start + state.own.start + 0.12 - r.end;
					else state.own.start = r.end + state.own.end - 0.12 - r.start;
				}
				syncMarks();
			};
			const up = () => {
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", up);
				handle.removeEventListener("pointercancel", up);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up);
			handle.addEventListener("pointercancel", up);
		});
		const reset = () => { state.own[key] = 0; syncMarks(); };
		handle.addEventListener("dblclick", reset);
		handle.addEventListener("keydown", (e) => {
			if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home"].includes(e.key)) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.key === "Home") return reset();
			Object.assign(state.own, ownNow());
			const delta = (e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 1) * (e.shiftKey ? 0.05 : 0.005);
			const r = markTimes();
			const start = r.start + state.own.start, end = r.end + state.own.end;
			const value = key === "start"
				? THREE.MathUtils.clamp(start + delta, 0.02, end - 0.12)
				: THREE.MathUtils.clamp(end + delta, start + 0.12, r.limit);
			state.own[key] = value - r[key];
			syncMarks();
		});
	};
	drag(marks.start, "start");
	drag(marks.end, "end");
	// on a narrow screen there is no Custom: if it was the speed, Ramp takes over
	marks.narrow.addEventListener("change", () => marks.narrow.matches && state.speed === "custom" && setSpeed("ramp"));
}

// The controls update when the recording, speed, or custom offsets change.
function syncMarks() {
	if (!marks.zone) return;
	const on = state.speed === "custom" && !marks.narrow.matches && state.tm;
	marks.zone.hidden = marks.start.hidden = marks.end.hidden = !on;
	if (!on) return;
	const r = markTimes(), own = ownNow(), a = (r.start + own.start) / r.total, b = (r.end + own.end) / r.total;
	const moved = (v) => (Math.abs(v) < 0.0025 ? "" : ` ${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)} s`);
	marks.start.style.left = `${a * 100}%`;
	marks.end.style.left = `${b * 100}%`;
	marks.zone.style.left = `${a * 100}%`;
	marks.zone.style.width = `${Math.max(0, b - a) * 100}%`;
	setText(marks.sStart, moved(own.start));
	setText(marks.sEnd, moved(own.end));
	for (const [handle, time, min, max] of [
		[marks.start, a * r.total, 0.02, b * r.total - 0.12],
		[marks.end, b * r.total, a * r.total + 0.12, r.limit]
	]) {
		handle.setAttribute("aria-valuemin", min.toFixed(3));
		handle.setAttribute("aria-valuemax", max.toFixed(3));
		handle.setAttribute("aria-valuenow", time.toFixed(3));
		handle.setAttribute("aria-valuetext", `${time.toFixed(3)} seconds`);
	}
}

/* ---------- loop ---------- */

const OUTRO = 0.9; // s the board keeps rolling after the end of the timeline while the view fades

let last = null;
let pendingFrame = 0;
function scheduleFrame() {
	if (pendingFrame || (!gl.ok && !state.playing)) return;
	pendingFrame = requestAnimationFrame(frame);
}
function invalidate() {
	state.dirty = true;
	scheduleFrame();
}

function frame(now) {
	pendingFrame = 0;
	const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
	last = now;
	if (state.playing) {
		// Advance in small steps. In Ramp the speed changes within a few hundredths of a second, so
		// one step per screen frame could jump straight over the pop when a frame came late.
		if (typeof state.speed === "number") state.t += dt * state.speed;
		else {
			const own = state.speed === "custom" ? ownNow() : undefined;
			for (let left = dt; left > 1e-9 && state.t < state.tm.total; ) {
				const h = Math.min(left, 0.002);
				state.t += h * rampSpeed(state.tm, state.t, own);
				left -= h;
			}
		}
		if (state.t >= state.tm.total) {
			// The recording is over but the board is still rolling: let it roll on while the view
			// fades out, then return to the start, ready to play again.
			state.t = state.tm.total;
			state.outro += dt;
			if (state.outro >= OUTRO) {
				state.playing = false;
				state.outro = 0;
				state.t = 0;
				ui.canvas.style.transition = "opacity 0.35s"; // the start pose fades back in
			}
		}
		ui.canvas.style.opacity = state.outro ? String(1 - smooth(0.25, OUTRO, state.outro)) : "";
		syncTransport();
		state.dirty = true;
	}

	if (!gl.ok) {
		if (state.playing) scheduleFrame();
		else last = null;
		return;
	}

	// view damping (orbit and strobe framing) runs on wall-clock time, not the trick timeline
	const o = state.orbit;
	// a view's camera move: where the camera should be for this moment of the run, so it follows
	// playback, scrubbing and any speed. It only sets where the view is heading.
	if (state.move) {
		const m = state.move, u = smooth(m.t0, m.t1, state.t);
		o.taz = lerp(m.from.az, m.to.az, u);
		o.tel = lerp(m.from.el, m.to.el, u);
		o.tzoom = lerp(m.from.zoom, m.to.zoom, u);
		if (m.to.y !== undefined) o.ty = lerp(m.from.y || 0, m.to.y, m.y0 !== undefined ? smooth(m.y0, m.y1, state.t) : u); // the move can also lower the camera's aim
	}
	const k = 1 - Math.exp(-dt * 10);
	let easing = false;
	const step = (value, target, amount) => {
		if (value === target) return value;
		state.dirty = true;
		const next = lerp(value, target, amount);
		if (Math.abs(next - target) < 1e-4) return target;
		easing = true;
		return next;
	};
	o.az = step(o.az, o.taz, k);
	o.el = step(o.el, o.tel, k);
	o.zoom = step(o.zoom, o.tzoom, k);
	o.y = step(o.y, o.ty, k);
	o.follow = step(o.follow, o.tfollow, k);
	state.strobeMix = step(state.strobeMix, state.strobe ? 1 : 0, 1 - Math.exp(-dt * 5));

	if (state.dirty) {
		state.dirty = false;
		try { render(); } catch (error) { graphicsUnavailable(error); }
	}
	if (state.playing || easing) scheduleFrame();
	else last = null;
}

function render() {
	const time = state.t + state.outro;
	const changed = gl.renderedRun !== state.tm || gl.renderedTime !== time;
	const pose = changed ? evaluate(state.trick, state.tm, time, gl.pose) : gl.pose;
	const { board, blob, key, rim } = gl;
	const h = pose.lift;
	if (changed) {
		gl.renderedRun = state.tm;
		gl.renderedTime = time;
		gl.renderer.shadowMap.needsUpdate = true;
		board.root.matrix.copy(pose.matrix);
		board.root.matrixWorldNeedsUpdate = true;
		board.wheels.forEach((w, i) => (w.rotation.z = i < 2 ? pose.wheelRear : pose.wheelFront)); // 0–1 rear, 2–3 front
		board.flex.value = Math.max(0, pose.flex);
		board.setFold(Math.max(0, -pose.flex)); // a negative value is how far a broken deck's middle has dropped
		board.flexTip.value = 1 / (state.tm.flexScale || 1); // nose and tail in proportion to the bend as calculated
		board.setTrucks(pose.truckRear, pose.truckFront); // zero with rigid trucks

		// The lights follow the board so the shadow map stays tight. They move in whole shadow-map
		// texels, so the shadow's edge does not shimmer and stays put on the floor.
		const texel = 1.7 / 1024;
		// They follow it sideways as well. A trick that spins, or a failed attempt, can come down well
		// off its line; with the lights on the line the board left the shadow map's 1.7 m square and
		// its shadow was cut in half, and the soft contact shadow stayed behind on the line, so the
		// board looked as if it floated.
		const lx = Math.round(pose.x / texel) * texel;
		const lz = Math.round(pose.matrix.elements[14] / texel) * texel;
		key.target.position.set(lx, 0, lz);
		key.position.set(lx - 1.6, 3.6, lz + 2.2);
		rim.target.position.set(lx, 0.2, lz);
		rim.position.set(lx + 2.5, 1.6, lz - 3);

		blob.position.x = pose.matrix.elements[12];
		blob.position.z = pose.matrix.elements[14];
		blob.rotation.z = -pose.yaw;
		blob.scale.set(0.95 + h * 1.4, 0.32 + h * 1.4, 1);
		blob.material.opacity = Math.max(0.12, 0.85 - h * 1.6);
	}
	const s = state.strobeMix;
	gl.ghosts.forEach((g) => {
		g.root.visible = s > 0.01;
		g.setOpacity(0.5 * s);
	});
	gl.ghostMat.opacity = 0.5 * s;
	gl.pathMat.opacity = 0.5 * s;
	gl.path.visible = s > 0.01;

	cameraFor(time, pose.matrix.elements[12], pose.lift, pose.matrix.elements[14]);
	gl.renderer.render(gl.scene, gl.camera);

	const input = (pose.trick || state.trick).input; // (in a combo, the trick that is playing)
	const side = (angle) => angle < 0 ? "BS" : "FS";
	const spin = Math.round(THREE.MathUtils.radToDeg(pose.yaw));
	const nose = Math.round(THREE.MathUtils.radToDeg(pose.pitch));
	const labels = [
		input.roll && `Flip ${(Math.abs(THREE.MathUtils.radToDeg(pose.roll)) * flipScale(pose.trick || state.trick)).toFixed(0)}°`,
		input.yaw && `Board spin ${Math.abs(spin)}° ${spin ? side(spin) : ""}`.trim(),
		`Nose ${nose === 0 ? "level" : `${nose > 0 ? "up" : "down"} ${Math.abs(nose)}°`}`,
		`Height ${Math.round(h * 100)} cm`
	].filter(Boolean);
	if (input.riderTurn) {
		const progress = input.riderTurn === input.yaw ? spin / input.yaw // rider and board turn together
			: input.catchYaw && spin < input.catchYaw
			? 0.5 + 0.5 * (spin - input.catchYaw) / (input.yaw - input.catchYaw)
			: input.catchYaw ? 0.5 * spin / input.catchYaw : spin / input.yaw;
		const fraction = THREE.MathUtils.clamp(progress, 0, 1);
		const turn = Math.round(Math.abs(input.riderTurn) * fraction);
		labels.push(`Rider turn cue ${turn}° ${side(input.riderTurn)}`);
	}
	const view = PRESETS[state.preset]?.attempt;
	if (view === "truck") {
		const angle = (value) => Math.abs(THREE.MathUtils.radToDeg(value)).toFixed(1);
		labels.push(`Nose truck ${angle(pose.truckFront)}°`, `Tail truck ${angle(pose.truckRear)}°`);
	} else if (view === "flex") {
		labels.push(`Deck flex ${(pose.flex * 1000).toFixed(1)} mm`);
	}
	setText(ui.readout, labels.join(" · "));
}

// The recorded flip angle is the turning about the board's long axis added up. On a trick that
// also spins or pitches steeply that sum runs ahead of the flips seen (a hardflip's one flip added
// up to 532°). The readout is scaled so that the trick's clean run shows its own flip, 360° or
// 720°, at the catch; a variation that flips short or too far still reads short or too far.
const flipScales = new Map();
function flipScale(trick) {
	if (!flipScales.has(trick.id)) {
		const tm = timing(trick);
		const at = Math.abs(THREE.MathUtils.radToDeg(evaluate(trick, tm, tm.catch + 0.04).roll));
		const k = at > 1 ? Math.abs(trick.input.roll) / at : 1;
		flipScales.set(trick.id, k > 0.5 && k < 1.5 ? k : 1);
	}
	return flipScales.get(trick.id);
}

/* ---------- input ---------- */

// "Reset view" is only available once the camera has been moved away from its default
function syncView() {
	invalidate();
	const o = state.orbit;
	// Reset view is also the way out of a view, so it is always there while one is in use
	ui.view.disabled = !gl.ok || state.preset < 0 && o.taz === 0 && o.tel === 0 && o.tzoom === 1 && o.ty === 0 && o.tfollow === 0;
}

function bindInput() {
	// anything done anywhere puts the message away (the listeners run before the control's own, so
	// a control that shows a message still shows it)
	for (const type of ["pointerdown", "keydown", "wheel"]) document.addEventListener(type, hideToast, { capture: true, passive: true });
	ui.play.addEventListener("click", togglePlay);
	ui.scrub.addEventListener("input", () => {
		state.playing = false;
		setTime((ui.scrub.value / 1000) * state.tm.total);
	});
	buildMarks();
	ui.speedBtns.forEach((b) => {
		b.addEventListener("click", () => pickSpeed(b.dataset.speed));
		b.addEventListener("keydown", (e) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			e.stopPropagation();
			const eligible = ui.speedBtns.filter((button) => !button.disabled && button.getClientRects().length);
			const index = eligible.indexOf(b);
			if (index < 0) return;
			const n = eligible[(index + (e.key === "ArrowRight" ? 1 : -1) + eligible.length) % eligible.length];
			pickSpeed(n.dataset.speed);
			n.focus();
		});
	});
	ui.strobe.addEventListener("click", () => setStrobe(!state.strobe));
	if (ui.attemptNew) ui.attemptNew.addEventListener("click", () => setMode("vary"));
	if (ui.attemptCombo) ui.attemptCombo.addEventListener("click", () => setMode("combo"));
	if (ui.tricksToggle) ui.tricksToggle.addEventListener("click", () => togglePanel(ui.tricksToggle, ui.tricks));
	if (ui.viewsToggle) ui.viewsToggle.addEventListener("click", () => togglePanel(ui.viewsToggle, ui.views));
	if (ui.infoToggle) {
		ui.infoToggle.addEventListener("click", () => togglePanel(ui.infoToggle, ui.info));
		// where there is little room beside the picture the description starts hidden, under its heading
		if (matchMedia("(min-width: 761px) and (max-width: 1000px)").matches) togglePanel(ui.infoToggle, ui.info);
	}
	if (ui.attemptOff) ui.attemptOff.addEventListener("click", () => setMode("clean"));
	if (ui.attemptPrev) ui.attemptPrev.addEventListener("click", () => stepVariation(-1));
	if (ui.attemptNext) ui.attemptNext.addEventListener("click", () => stepVariation(1));
	ui.reset.addEventListener("click", resetAll);

	// Orbit and zoom at any time, playing or not. The view is separate from the simulation: it
	// only changes where the camera sits around the travelling point it looks at.
	const pointers = new Map();
	let drag = null;
	let pinch = 0;
	const spread = () => {
		const [a, b] = [...pointers.values()];
		return Math.hypot(a.x - b.x, a.y - b.y);
	};
	ui.canvas.addEventListener("pointerdown", (e) => {
		if (!gl.ok) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		try {
			ui.canvas.setPointerCapture(e.pointerId);
		} catch (_) {
			/* the pointer is already gone */
		}
		if (pointers.size === 1) {
			drag = { x: e.clientX, y: e.clientY, az: state.orbit.taz, el: state.orbit.tel };
			ui.canvas.classList.add("is-dragging");
		} else if (pointers.size === 2) {
			drag = null;
			pinch = spread();
		}
	});
	ui.canvas.addEventListener("pointermove", (e) => {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (pointers.size === 2 && pinch) {
			const now = spread();
			state.orbit.tzoom = THREE.MathUtils.clamp((state.orbit.tzoom * pinch) / now, 0.3, 2.2);
			pinch = now;
			handCamera();
			syncView();
		} else if (drag) {
			handCamera();
			state.orbit.taz = drag.az - (e.clientX - drag.x) * 0.006;
			state.orbit.tel = THREE.MathUtils.clamp(drag.el + (e.clientY - drag.y) * 0.004, -0.15, 1.1);
			syncView();
		}
	});
	const end = (e) => {
		pointers.delete(e.pointerId);
		pinch = 0;
		drag = null;
		if (pointers.size === 1) {
			const [p0] = [...pointers.values()];
			drag = { x: p0.x, y: p0.y, az: state.orbit.taz, el: state.orbit.tel };
		} else {
			ui.canvas.classList.remove("is-dragging");
		}
	};
	ui.canvas.addEventListener("pointerup", end);
	ui.canvas.addEventListener("pointercancel", end);
	ui.canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			handCamera();
			state.orbit.tzoom = THREE.MathUtils.clamp(state.orbit.tzoom * Math.exp(e.deltaY * 0.0012), 0.3, 2.2);
			syncView();
		},
		{ passive: false }
	);
	const resetView = () => {
		leaveView(); // the view's camera is gone, so the view is no longer the one in use
		Object.assign(state.orbit, { taz: 0, tel: 0, tzoom: 1, ty: 0, tfollow: 0 });
		syncView();
	};
	ui.canvas.addEventListener("dblclick", resetView);
	ui.view.addEventListener("click", resetView); // does not touch playback

	// The features video: a recording of the experiment, in a dialog over the page. Opening it stops
	// the run that is playing; the page draws only when something changes, so nothing is drawn or
	// simulated behind the video while it is open. Close, Escape or a click outside closes it.
	const film = { btn: $("#videoBtn"), box: $("#videoDialog"), player: $("#videoPlayer"), close: $("#videoClose") };
	if (film.btn && film.box && film.box.showModal) {
		film.btn.addEventListener("click", () => {
			pause();
			hideToast();
			film.box.showModal();
			film.player.play().catch(() => {}); // (if the browser will not start it, its own Play button is there)
		});
		film.close.addEventListener("click", () => film.box.close());
		film.box.addEventListener("click", (e) => e.target === film.box && film.box.close()); // a click on the backdrop
		film.box.addEventListener("close", () => {
			film.player.pause();
			film.btn.focus();
		});
	} else if (film.btn) film.btn.hidden = true; // (a browser without dialogs: no button)

	document.addEventListener("keydown", (e) => {
		if (document.querySelector("dialog[open]")) return; // the keys belong to the video while it is open
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		// A focused form control keeps its own keys: the trick menu, the timeline and any other
		// field use arrows, Space, Home and letters themselves.
		const el = e.target;
		if (el.tagName === "SELECT" || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
		const onButton = e.target.tagName === "BUTTON";
		const step = (e.shiftKey ? 10 : 1) / 240; // one step ≈ 4 ms of trick time
		switch (e.key) {
			case " ":
				if (onButton) return;
				e.preventDefault();
				togglePlay();
				break;
			case "ArrowLeft":
			case "ArrowRight":
				e.preventDefault();
				pause();
				setTime(state.t + (e.key === "ArrowRight" ? step : -step));
				break;
			case "ArrowUp":
			case "ArrowDown": {
				e.preventDefault();
				const hadFocus = document.activeElement && document.activeElement.classList.contains("trick-btn");
				chooseTrick(state.index + (e.key === "ArrowDown" ? 1 : -1));
				if (hadFocus) $('.trick-btn[aria-current="true"]').focus();
				break;
			}
			case "s":
			case "S":
				setStrobe(!state.strobe);
				break;
			case "n":
			case "N":
				setMode({ clean: "vary", vary: "combo", combo: "clean" }[mode()]); // N goes round the three modes
				break;
			case "[":
				stepVariation(-1);
				break;
			case "]":
				stepVariation(1);
				break;
			case "v":
			case "V":
				resetView();
				break;
			case "Home":
				e.preventDefault();
				resetAll();
				break;
		}
	});
}

/* ---------- boot ---------- */

buildList();
buildPresets();
bindInput();
try {
	initGL();
} catch (error) {
	graphicsUnavailable(error);
}
ui.canvas.addEventListener("webglcontextlost", (event) => {
	graphicsUnavailable(event.statusMessage || "WebGL context lost");
});
selectTrick(0, false);
if (gl.ok) {
	new ResizeObserver(onResize).observe(ui.stage);
	window.addEventListener("resize", onResize);
	onResize(); // the page opens still, on the first trick: nothing plays until it is asked to
}

// Each trick is simulated the first time it is needed and kept. The rest are prepared one at a
// time when the browser is idle and nothing is playing, so later selections are instant and the
// work never lands in the middle of playback.
const whenIdle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 4000 }) : (fn) => setTimeout(fn, 600);
(function prepareNext(i, j = 0) {
	if (!gl.ok || i >= TRICKS.length) return;
	whenIdle(() => {
		if (state.playing) return setTimeout(() => prepareNext(i, j), 500);
		const list = variants(TRICKS[i]);
		timing(TRICKS[i], list[j]);
		if (j + 1 < list.length) prepareNext(i, j + 1);
		else prepareNext(i + 1);
	});
})(0);
