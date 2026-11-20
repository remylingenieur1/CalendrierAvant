// Trick definitions and the motion system.
//
// The board is simulated as one rigid body: mass, an inertia tensor, gravity, and spring-damper
// contacts between the floor and the wheels, tail, nose and rails. Nothing about its flight is
// keyframed. What the unseen rider does is applied as explicit inputs:
//   - the weight of the rider standing on the deck, carried by the legs;
//   - a jump, and a back-foot stomp on the tail that lasts until the tail strikes the floor;
//   - one short burst from the feet just after the strike: the flick, the scoop and a press
//     that levels the board. For most tricks these are forces at the places the feet push;
//     for the 360 flip, the hardflip and the impossible they are plain torques about the
//     board's axes (see `cleanTorques`). On spin tricks the front foot also stays on a moment
//     longer and presses the deck level before the scoop;
//   - the front foot's grip on the deck for a moment after the strike, dragging the board
//     toward the foot's own speed;
//   - the catch: the feet come back down on the deck. They mostly push, but each contact can
//     also hold the deck up with a limited force, and has a small grip even when it is barely
//     loaded. Real feet cannot hold a board up like that; without it the modelled catch does
//     not keep the board under the feet. The catch therefore squares the board more than a
//     real one would;
//   - legs that act as a spring and damper between the rider's mass and the deck on landing.
// Between the burst and the catch the board is in free flight, so its rotation is carried by
// angular momentum alone. The size of each burst is solved so that the board arrives at the
// catch level, at the right heading and at the height of the feet: the tricks are made to
// succeed, they are not predictions of what a given rider input would do.
//
// Each trick is simulated once at a fixed time step and recorded; playback and scrubbing read
// the recording, so every position on the timeline is exact and repeatable.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js";
import { DIM, COM, PROBES, PIVOT } from "./board.js";

export const SPEED = 1.8; // rolling speed, m/s

/* Sign conventions (regular stance: nose = +X, up = +Y, toe side = +Z)
   roll : about the board's long axis. − = kickflip direction, + = heelflip direction
   yaw  : about the vertical.          − = backside (tail swings to the heel side), + = frontside */

// Rider inputs per trick
//   jump  : speed the rider leaves the ground at, m/s (sets the airtime and, with it, the height)
//   catch : when the feet come back down, as a fraction of the rider's airtime
//   delay : start of the flick/scoop burst relative to the tail strike, s (scoops start early)
//   hold  : how long the front foot stays on after the strike, pressing the deck level, s
//   roll / yaw : rotation the board must have completed at the catch, degrees
//   wrap  : the back foot stays hooked on the deck and carries it round. Only the Impossible used
//           it, and that trick is no longer in the lineup: the code for it, and the comments
//           below that mention it, are kept as they were.
//   catchYaw : the board's turn when the feet catch it, where they then bring it round the rest of
//              the way to `yaw` (bigspin, backside 180 kickflip)
export const TRICKS = [
	{
		id: "kickflip",
		name: "Kickflip",
		note: "After the pop, the toes of the front foot flick off the heel-side corner of the nose. The board flips once along its length.",
		input: { jump: 2.3, catch: 0.62, delay: 0.006, roll: -360 }
	},
	{
		id: "heelflip",
		name: "Heelflip",
		note: "After the pop, the front heel kicks out past the toe-side edge near the nose. The board flips once opposite a kickflip.",
		input: { jump: 2.3, catch: 0.62, delay: 0.006, roll: 360 }
	},
	{
		id: "bs-pop-shuvit",
		name: "Backside Pop Shuvit",
		note: "Pop and scoop the tail behind you with the back foot. The board turns 180° backside under the rider without a flip.",
		input: { jump: 2.0, catch: 0.81, delay: 0.004, hold: 0.075, yaw: -180, cleanDeck: true }
	},
	{
		id: "fs-pop-shuvit",
		name: "Frontside Pop Shuvit",
		note: "Pop and push the tail forward with the back foot. The board turns 180° frontside under the rider without a flip.",
		input: { jump: 2.0, catch: 0.71, delay: 0, hold: 0.075, yaw: 180, cleanDeck: true }
	},
	{
		id: "ollie",
		name: "Ollie",
		note: "Pop the tail and slide the front foot toward the nose to level the board in the air.",
		input: { jump: 2.0, catch: 0.62, delay: 0, hold: 0.12, cleanDeck: true }
	},
	{
		id: "varial-heelflip",
		name: "Varial Heelflip",
		note: "A frontside pop shuvit and a heelflip at once: the board spins 180° while it flips.",
		input: { jump: 2.3, catch: 0.64, delay: 0.04, hold: 0.07, roll: 360, yaw: 180 }
	},
	{
		id: "360-pop-shuvit",
		name: "360 Pop Shove-It",
		note: "The back foot pops and scoops the tail behind the rider. The board makes one full backside turn without flipping, then comes back under the feet.",
		input: { jump: 2.6, catch: 0.82, delay: 0.018, hold: 0.06, yaw: -360 }
	},
	{
		id: "360-flip",
		name: "360 Flip",
		note: "A 360° backside shuvit with a kickflip inside it, driven mostly by the scoop. Approximate here.",
		input: { jump: 2.5, catch: 0.68, delay: 0.04, hold: 0.07, roll: -360, yaw: -360 }
	},
	{
		id: "hardflip",
		name: "Hardflip",
		note: "A frontside pop shuvit with a kickflip. Approximate here: the board goes steep with the tail high, where a real one goes vertical with the nose up between the legs.",
		input: { jump: 2.5, catch: 0.66, delay: 0.04, hold: 0.07, roll: -360, yaw: 180 }
	},
	{
		id: "fs-180-ollie",
		name: "Frontside 180 Ollie",
		note: "The rider and board turn 180° frontside together. The rider is represented by a heading cue.",
		input: { jump: 2.2, catch: 0.67, delay: 0.006, hold: 0.12, yaw: 180, riderTurn: 180 }
	},
	{
		id: "bs-180-ollie",
		name: "Backside 180 Ollie",
		note: "The rider and board turn 180° backside together. The rider is represented by a heading cue.",
		input: { jump: 2.2, catch: 0.67, delay: 0.006, hold: 0.12, yaw: -180, riderTurn: -180 }
	},
	{
		id: "bs-bigspin",
		name: "Backside Bigspin",
		note: "Scoop the tail behind you. Catch over the bolts around halfway through the rider’s backside 180°, then finish the turn together.",
		input: { jump: 2.6, catch: 0.76, delay: 0.018, hold: 0.1, yaw: -360, riderTurn: -180, catchYaw: -270 }
	},
	{
		id: "bs-180-kickflip",
		name: "Backside 180 Kickflip",
		note: "Wind up for a backside 180, pop the tail behind you and flick a kickflip. The flip is finished a little past half the turn; the feet catch it there and bring it round the rest of the way.",
		input: { jump: 2.5, catch: 0.69, delay: 0.025, hold: 0.09, yaw: -180, roll: -360, riderTurn: -180, catchYaw: -105, cleanDeck: true }
	},
	{
		id: "extra-crosswire",
		name: "Crosswire 540 · Extra",
		note: "An invented frontside 540 with two heelflips in the same jump. The rider turns 180° frontside. Experimental.",
		input: { jump: 3.05, delay: 0.012, hold: 0.07, catch: 0.8, yaw: 540, roll: 720, cleanDeck: true, riderTurn: 180 }
	}
];

/* ---------- model ---------- */

const G = 9.81;
const DT = 0.00025; // simulation step, s
const REC_EVERY = 4; // one recorded sample per millisecond
const APPROACH = 0.4; // s of rolling before the pop
const ROLLOUT = 0.5; // s simulated after the landing; by then the board is simply rolling…
const COAST = 1.0; // …and the rest of the roll-out is that steady roll carried on

// board (complete, about 2.5 kg). Inertia about the centre of mass, kg·m² — estimates.
const MB = 2.5;
const IX = 0.012; // roll: about the long axis
const IY = 0.13; // yaw: about the vertical
const IZ = 0.122; // pitch: about the width axis

// floor contacts
const KW = 6e5; // wheel stiffness, N/m
const CW = 700; // wheel damping, N·s/m
const MU_W = 0.8; // sideways grip of a wheel
const KH = 1.2e6; // deck (tail, nose, rails) against the floor
const CH = 300;
const MU_H = 0.25;

// rider
const MR = 70; // kg
const STOMP = 1400; // back-foot force on the tail, N
const BURST = 0.035; // length of the flick/scoop burst, s
const FRONT = 0.06; // s the front foot stays on the grip after the strike (flip tricks)
const DRAG = 120; // the front foot rests on the deck: the board is held to the foot's speed, N per m/s…
const DRAG_MAX = 900; // …up to this much, N
// legs: a spring and damper between the rider's mass and each of the four sole contacts. A
// contact pushes on the deck and can also hold it up by a limited force (HOLD).
const KS = 3500; // N/m
const CS = 350; // N·s/m
const MU_S = 0.9; // shoe on grip tape
// The legs are stiff when the whole deck pushes up against the soles, but the feet give at the
// ankles when it tilts under them, so a board that arrives still turning is stopped over a few
// hundredths of a second, not at once.
const KT = 3000; // tilt stiffness per sole contact, N/m
const CT = 80; // tilt damping per sole contact, N·s/m (the softest that keeps every trick landing)
const HOLD = 150; // N each sole contact can hold the deck up by. Not something real feet can do: a
// modelling compromise that keeps the board under the feet through the catch.
const GRIP_MIN = 40; // N of sideways grip a sole contact has even when barely loaded (same compromise)
const TUCK = 0.15; // how far the feet are drawn up at the catch, m
const PRESS = 40; // light pressure the feet keep on the deck in the air, N
const KDECK = 4e5; // deck bending stiffness between the trucks, N/m
const CRR = 0.012; // rolling resistance of the wheels

// ---- Articulated trucks and the rider's sideways balance (development comparison) ----
// Off by default: the board then behaves exactly as before, with rigid trucks and a rider who
// has no sideways motion. When on:
//  - whenever the board is on the ground (rolling in, loading the tail, and from the first wheel
//    contact after the catch) each hanger turns about its pivot (the line through the pivot cup
//    and the yoke, as the truck is drawn), held by its bushings; its wheels' contact points and
//    grip direction turn with it, so a leaning deck steers. In free flight the trucks are rigid
//    and the board flies exactly as it does with the switch off;
//  - the rider has a sideways position and speed of their own. The rider leaves the ground moving
//    sideways with the board, as far as it will have drifted by the catch, and from the catch
//    rider and board act on each other sideways only through the grip of the soles;
// and from the first wheel contact after the catch:
//  - the rider's mass sways sideways over the feet, joined to them by legs that give;
//  - the feet stand on the deck and turn with it;
//  - the rider's weight comes down under their own mass, so a sway presses the deck to that side;
//  - after a reaction time the rider slowly moves that pressure across the deck against a lean
//    that lasts;
//  - the drawn bend of the deck is sized from each foot contact's load and where along the deck
//    it presses (a load over a truck hardly bends the deck; one between the trucks does), and
//    follows it through the deck's own response time, so a force that arrives in a few
//    thousandths of a second does not bend it at once.
// Every value here is an estimate, not a measurement.
export const COUPLED = {
	on: false,
	lean: 120, // bushing stiffness per truck, N·m per radian of deck lean
	damp: 0.4, // bushing damping per truck, N·m·s per radian of deck lean
	travel: 0.19, // deck lean at which a bushing bottoms out, rad (about 11°)
	stop: 4000, // stiffness of that stop, N·m/rad
	hanger: 0.0025, // turning inertia of a hanger with its wheels about the pivot, kg·m²
	sway: 2, // natural frequency of the rider's mass swaying sideways over the feet, Hz
	swayDamp: 0.7, // damping ratio of that sway
	feetTurn: 0.03, // s the planted feet take to turn with the board
	react: 0.15, // s before the rider responds to a lean
	shift: 1.2, // how fast the rider then moves that pressure across the deck, m/s per radian of lean
	shiftMax: 0.02, // and how far at most, m
	reach: 0.08, // how far to either side of the feet's middle the rider's weight can come down, m
	deckTime: 0.02, // s the deck takes to follow a change of load (its own mass and the feet on it)
	// Bending strength of the deck, Pa. Clear maple ply is roughly 80e6 to 120e6, and 100e6 was used at
	// first: the deck then bowed 27 mm, its ends curling up, before it broke, which looked exaggerated.
	// A deck is drilled for eight bolts and glued from plies, so it lets go before clear wood would;
	// how much earlier is not known here. 60e6 (a break at 16 mm of bend) is a judgement by eye.
	deckMOR: 60e6,
	deckE: 9.5e9, // stiffness of the deck's wood along its length, Pa: an estimate for maple ply (roughly 8e9 to 11e9)
	// How much larger than calculated the solved runs' bend is drawn. It was 5 for a while, so that
	// the bend could be seen at all: with the feet almost over the trucks it is under a millimetre.
	// But a deck drawn bending five times too far looked like rubber, most of all from behind. It
	// is 1 now: the solved runs land over the bolts and barely bend, and the visible bending is
	// left to the variations whose feet land between the trucks (see ATTEMPT.place).
	deckShow: 1,
	rollout: 1.0 // s simulated after the landing, so the lean has settled before the roll is carried on
};
export function setCoupled(on) {
	COUPLED.on = !!on;
	cache.clear();
	recentAttempts.clear();
}
// Pivot of each truck (0 rear, 1 front) in the board's frame, relative to the centre of mass: a
// point on the axis and the axis' direction, which lies in the board's lengthwise vertical plane.
const PIV = [-1, 1].map((s) => ({ x: s * (DIM.plateX - PIVOT.x) - COM.x, y: -DIM.thickness + PIVOT.y - COM.y, ux: -s * PIVOT.ux, uy: PIVOT.uy }));
// The deck between the trucks, taken as a plain beam resting on the two baseplate centres. It is
// used only to size the drawn bend (see `flex` in simulate), and it is an engineering
// approximation, not a measured skateboard: the section is a flat board of the deck's width and
// thickness (concave and plies ignored), the mounts are simple supports, and the wood's stiffness
// is an estimate (COUPLED.deckE).
const SPAN = 2 * DIM.plateX;
const DECK_I = (DIM.width * DIM.thickness ** 3) / 12; // second moment of the section, m^4
// How much a load at x (along the deck, from its middle) dips the middle of the span, as a share
// of what the same load would do placed at the middle. It falls to nothing at a truck, and beyond
// a truck it is negative: a load on an overhang lifts the middle.
const spanShare = (x) => {
	const ax = Math.abs(x);
	if (ax > DIM.plateX) return (-3 * (ax - DIM.plateX)) / SPAN;
	const b = DIM.plateX - ax;
	return (b * (3 * SPAN * SPAN - 4 * b * b)) / SPAN ** 3;
};
const bushing = (th, om, k, c, lim) => {
	let b = k * th + c * om;
	const over = Math.abs(th) - lim;
	if (over > 0) b += Math.sign(th) * COUPLED.stop * over; // the bushing bottoms out
	return b;
};

const R_WHEEL = DIM.wheelR;
const TREAD_FLAT = DIM.wheelW / 2 - DIM.wheelLip;
const TREAD_RADIUS = R_WHEEL - DIM.wheelLip;
const wheelOffset = { x: 0, y: 0, z: 0 };
function treadContact(ax, ay, az) {
	// Support point of the rendered rounded tread. Near level, distribute the
	// contact over the flat band to keep the resultant continuous across zero lean.
	const radial = Math.sqrt(Math.max(0, 1 - ay * ay));
	const edge = TREAD_FLAT * clamp(ay / 0.015, -1, 1);
	const lateral = (radial > 1e-6 ? TREAD_RADIUS * ay / radial : 0) - edge;
	wheelOffset.x = lateral * ax;
	wheelOffset.y = -TREAD_RADIUS * radial - edge * ay - DIM.wheelLip;
	wheelOffset.z = lateral * az;
	return wheelOffset;
}
const REST_Y = DIM.groundOffset + COM.y; // centre of mass height, wheels just touching
const PEN_W = ((MB + MR) * G) / (4 * KW); // wheel squash under the standing rider
const PEN_S = (MR * G) / (4 * KS); // sole spring compression under the standing rider

// contact points, relative to the centre of mass
const WHEELS = [];
[-1, 1].forEach((sx) => [-1, 1].forEach((sz) => WHEELS.push([sx * DIM.axleX - COM.x, DIM.axleY - COM.y, sz * DIM.wheelZ - COM.z])));
const HULL = (() => {
	const first = 4 * (16 * 4 + 1) * 3; // deck points follow the wheel points in PROBES
	const pts = [];
	const n = (PROBES.length - first) / 3;
	for (let i = 0; i < n; i++) {
		const x = PROBES[first + i * 3];
		const nearEnd = x < DIM.tailEnd + 0.03 || x > DIM.noseEnd - 0.03;
		if (!nearEnd && Math.floor(i / 4) % 5 !== 0) continue; // all points at the ends, a fifth of those along the rails
		pts.push([x - COM.x, PROBES[first + i * 3 + 1] - COM.y, PROBES[first + i * 3 + 2] - COM.z]);
	}
	return pts;
})();
const STOMP_AT = [-0.345 - COM.x, 0.03 - COM.y, 0]; // back foot on the tail
// Where the feet push during the burst. All positions are in the board's frame (x toward the
// nose, y up through the deck, z toward the toe side) and relative to the centre of mass. None
// is at the centre of mass, so each push turns the board about more than one axis and moves
// it as well as turning it. Directions: the flick and the press act straight down in the world;
// the scoop acts along the board's z axis (sideways across the deck).
const FLICK_X = 0.28 - COM.x; // front foot leaving over the edge near the nose…
const FLICK_Z = 0.085; // …on the heel side for a kickflip, the toe side for a heelflip
const FOOT_Y = 0.03 - COM.y; // height at which the feet push: taken as 3 cm above the middle of the deck top
// for every foot position (about the height of the kicked nose and tail), an approximation
const SCOOP_X = -0.34 - COM.x; // back foot on the tail, pushing it sideways
const PIVOT_X = 0.2 - COM.x; // front foot, which resists the scoop…
const PIVOT_SHARE = 0.8; // …with this share of its force, so the board mostly spins and slides a little
const PRESS_X = 0.3 - COM.x; // where a foot presses to bring the nose (or, mirrored, the tail) down
const BACK_FOOT_LATE = 0; // s by which the back foot lands on the deck after the front foot
const HOOK_AT = [-0.08 - COM.x, 0.045 - COM.y, 0]; // where the back foot hooks the deck (impossible)
const SOLES = [
	[-0.2, -0.095],
	[-0.2, 0.095],
	[0.2, -0.095],
	[0.2, 0.095]
]; // sole contacts in the rider's frame: x along travel, z across (shoes span the deck's width)

// The feet normally push at their places on the deck (see the burst in simulate). For a trick
// whose burst cannot be solved that way, the same burst is applied as plain torques about the
// board's axes instead: cleaner than a real rider, but the trick completes. The impossible
// always uses plain torques, because its back foot is modelled as a hook.
let cleanTorques = false;
const HIT = new Float64Array(28); // scratch space for the sole contacts, reused every step
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, x) => {
	const t = clamp((x - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};

/* ---------- simulation ---------- */

// Runs one trick from just before the pop. `th` = the feet's burst: [flick, scoop, press (each
// as the spin-up in rad/s² it would give on its own), front-foot rise speed (m/s)]. Stops at `until`, or after the rollout when
// `rec` (an array to fill with samples) is given.
function simulate(inp, th, until, rec) {
	const tp = APPROACH;
	const airtime = (2 * inp.jump) / G; // of the rider
	const tc = tp + inp.catch * airtime;
	const tDown = tp + airtime + 0.02;
	let t = rec ? 0 : tp - 0.002;

	// state
	let cx = SPEED * t, cy = REST_Y - PEN_W, cz = 0; // centre of mass
	let vx = SPEED, vy = 0, vz = 0;
	let qx = 0, qy = 0, qz = 0, qw = 1; // body → world
	let wx = 0, wy = 0, wz = 0; // angular velocity, body frame
	let yr = -PEN_W - PEN_S, vr = 0; // rider height (0 = standing), speed
	let xr = SPEED * t, vxr = SPEED; // rider along the travel: coasts, and is slowed through the feet
	let tuck = 0, heading = 0, headingPrev = 0, tStruck = Infinity, atCatch = null, feetX = 0, feetZ = 0;
	let attached = true, popped = false, struck = false, caught = false;
	let tStrike = NaN, tLand = NaN, tw = Infinity;
	let contact = null, floorImpact = null, wheelTouchdown = null, wasAirborne = false;
	let deckStrikeAfterPop = null;
	const catchMechanics = rec ? { firstCompression: null, tensileImpulse: 0, spinAtContact: null, spinAfter20ms: null } : null;
	let spinR = 0, spinF = 0, wR = -SPEED / R_WHEEL, wF = wR;
	let pitchAcc = 0;
	let rollAcc = 0, yawAcc = 0, flex = 0, apex = 0;
	let rearOnFloor = false, frontOnFloor = false;
	let hookX = 0, hookY = 0, hookY0 = 0, hookT0 = 0, hooked = false;
	const snap = {};
	let step = 0;
	// coupled model (see COUPLED): hanger angles and rates; the rider's sideways position and
	// speed and the feet's; how far the planted feet have turned; the rider's pressure shift
	const CO = COUPLED.on;
	const cK = COUPLED.lean * PIVOT.ux * PIVOT.ux, cC = COUPLED.damp * PIVOT.ux * PIVOT.ux, cLim = COUPLED.travel / PIVOT.ux;
	const kSpan = (48 * COUPLED.deckE * DECK_I) / SPAN ** 3; // the span's stiffness to a load at its middle
	let bendStand = MR * G * spanShare(SOLES[0][0]); // what a standing rider already bends it
	// A variation can bring a foot down a little further in from the truck than the stance the
	// rider stood in (see ATTEMPT.place). It is where the foot lands at the catch: until then the
	// feet are where they always were, so nothing is moved while it stands on the deck.
	const placeR = inp.placeR || 0, placeF = inp.placeF || 0;
	const legStiff = inp.legStiff || 1; // how much stiffer than usual the legs are held at the landing
	// The deck breaks when the wood at the middle of the span is bent past its strength. For a beam
	// loaded at its middle that is a dip of strength x span^2 / (6 x stiffness x thickness).
	const breakBend = (COUPLED.deckMOR * SPAN * SPAN) / (6 * COUPLED.deckE * DIM.thickness);
	const sagMax = DIM.truckH + DIM.wheelR; // the broken middle can drop until it lies on the floor
	let broken = false, tBreak = NaN, sag = 0, vsag = 0, flexWas = 0, sagAt = 0, pushAt = 0, sagDown = false;
	const show = inp.flexScale || COUPLED.deckShow; // how much larger than calculated the bend is drawn
	const legK = MR * (2 * Math.PI * COUPLED.sway) ** 2, legC = 2 * COUPLED.swayDamp * MR * 2 * Math.PI * COUPLED.sway;
	let th0 = 0, th1 = 0, om0 = 0, om1 = 0, zr = 0, vzr = 0, zf = 0, vzf = 0, psf = 0, psw = 0, shift = 0, leanF = 0, loadWas = 0, slipWas = 0, hitsWas = 0, legRest = 0, air = false;

	// A combo: this trick starts from the state the trick before it left, not from the standing
	// roll every other run starts from (see `relay` and `combo`). Nothing else changes: the same
	// pop, the same burst, at the same moments after this trick's own start.
	if (inp.from) ({ cx, cy, cz, vx, vy, vz, qx, qy, qz, qw, wx, wy, wz, yr, vr, xr, vxr, spinR, spinF, wR, wF, th0, th1, om0, om1, zr, vzr, zf, vzf, psf, psw, shift, leanF, loadWas, legRest, flex, rearOnFloor, frontOnFloor, feetX, feetZ } = inp.from);
	let handed = null;

	for (;;) {
		if (until !== undefined && t >= until) break;
		if (rec && ((tLand === tLand && t > tLand + (CO ? COUPLED.rollout : ROLLOUT)) || t > 3)) break;

		// rotation matrix from the quaternion
		const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wxq = qw * qx, wyq = qw * qy, wzq = qw * qz;
		const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wzq), r02 = 2 * (xz + wyq);
		const r10 = 2 * (xy + wzq), r11 = 1 - 2 * (xx + zz), r12 = 2 * (yz - wxq);
		const r20 = 2 * (xz - wyq), r21 = 2 * (yz + wxq), r22 = 1 - 2 * (xx + yy);
		// angular velocity in the world frame
		const ox = r00 * wx + r01 * wy + r02 * wz, oy = r10 * wx + r11 * wy + r12 * wz, oz = r20 * wx + r21 * wy + r22 * wz;

		if (rec && t >= 0 && step % REC_EVERY === 0) {
			// board origin (deck top centre) = centre of mass − R·COM
			rec.push(
				cx - (r00 * COM.x + r01 * COM.y + r02 * COM.z), cy - (r10 * COM.x + r11 * COM.y + r12 * COM.z), cz - (r20 * COM.x + r21 * COM.y + r22 * COM.z),
				qx, qy, qz, qw, spinR, spinF, broken ? -sag : show * flex, cy - REST_Y, rollAcc, yawAcc, inp.wrap ? pitchAcc : Math.asin(clamp(r10, -1, 1)), xr, th0, th1
			);
		}

		// events
		if (!popped && t >= tp) {
			popped = true;
			attached = false; // the feet unweight…
			vr = inp.jump;
		}
		if (popped && !struck && t > tp + 0.12) struck = true; // safety: never stomp forever
		if (tw === Infinity) {
			if (th.tw !== undefined) tw = th.tw; // burst start, found from the strike time of a first run
			else if (struck) tw = t + Math.max(0, inp.delay);
		}
		if (struck && tStruck === Infinity) tStruck = t;
		if (popped && !caught && t >= tc) {
			atCatch = { q: [qx, qy, qz, qw], pitchAcc, deckY: cy - (r10 * COM.x + r11 * COM.y + r12 * COM.z), soleY: DIM.groundOffset + yr + TUCK };
			caught = true;
			attached = true;
			hooked = false;
			tuck = TUCK;
			// the feet come down where the board is, even if the pushes have moved it under the rider
			feetX = cx - xr;
			feetZ = cz;
			if (inp.footOffset) {
				// Feet that come down to one side are to one side of the board as it lies at the catch.
				// (The offset used to be taken across the travel: on a board caught part-way through its
				// turn, a bigspin or a backside 180 kickflip, that was along the deck and cost nothing.)
				const across = Math.hypot(r02, r22) || 1;
				feetX += (inp.footOffset * r02) / across;
				feetZ += (inp.footOffset * r22) / across;
			}
			if (placeR || placeF) bendStand = (MR * G * (spanShare(SOLES[0][0] + placeR) + spanShare(SOLES[2][0] - placeF))) / 2;
			// coupled: the rider left the ground moving sideways with the board, so arrives over it at the
			// speed that carried them there; from here the feet are under the rider's own position
			if (CO) { zr = feetZ; vzr = cz / (tc - tp); air = true; }
		}

		let fx = 0, fy = -MB * G, fz = 0; // force on the board
		let tx = 0, ty = 0, tz = 0; // torque about the centre of mass, world frame
		let rearDown = false, frontDown = false, deckDown = false;

		// Coupled: the trucks, the give in the legs and the planted feet take over at the very step in
		// which a wheel first reaches the floor after the catch, so that first impact already goes
		// through the hanger. The feet are under the rider and moving with the rider, as they were, and the
		// legs' resting stance is set so that they carry exactly the sideways force the feet were
		// already passing on. The one thing that changes at this step is that the foot contacts, kept
		// square to the travel until now, are turned to stand square on the deck.
		if (CO && caught && tLand !== tLand) {
			for (let i = 0; i < 4; i++) {
				const p = WHEELS[i];
				const ax = r00 * p[0] + r01 * p[1] + r02 * p[2], ay = r10 * p[0] + r11 * p[1] + r12 * p[2], az = r20 * p[0] + r21 * p[1] + r22 * p[2];
				const offset = treadContact(r02, r12, r22);
				const pen = -(cy + ay + offset.y);
				if (pen > 0 && KW * pen - CW * (vy + oz * (ax + offset.x) - ox * (az + offset.z)) > 0) {
					tLand = t;
					zf = zr;
					vzf = vzr;
					legRest = -(900 * hitsWas * (slipWas - vzr)) / legK;
					// the rider has been standing on the deck since the catch, so the feet are already turned with it
					if (Math.hypot(r00, r20) > 0.5) psf = Math.atan2(r00 < 0 ? -r20 : r20, Math.abs(r00));
					break;
				}
			}
		}
		// wheels on the floor
		const on = CO && tLand === tLand;
		// the trucks articulate whenever the board is on the ground: until the tail strikes, and
		// again from touchdown. In free flight they are rigid, and any angle left dies away.
		const tr = CO && (on || !struck);
		if (CO && !tr && (th0 !== 0 || th1 !== 0)) {
			th0 *= 1 - DT / 0.02;
			th1 *= 1 - DT / 0.02;
			om0 = om1 = 0;
			if (th0 < 1e-9 && th0 > -1e-9) th0 = 0;
			if (th1 < 1e-9 && th1 > -1e-9) th1 = 0;
		}
		let hw0 = 0, hw1 = 0; // moment on each hanger about its pivot, from its wheels
		let wheelMask = 0;
		let floorR = 0, floorF = 0; // what the floor carries through each truck, N
		for (let i = 0; i < 4; i++) {
			const p = WHEELS[i];
			let p0 = p[0], p1 = p[1], p2 = p[2], d0 = 0, d1 = 0, d2 = 0, dvx = 0, dvy = 0, dvz = 0, a0 = 0, a1 = 0, a2 = 1, ux = 0, uy = 0;
			if (tr) {
				// the hanger carries the wheel round the truck's pivot
				const pv = PIV[i >> 1], th = i < 2 ? th0 : th1, om = i < 2 ? om0 : om1, sn = Math.sin(th), cs = Math.cos(th);
				ux = pv.ux; uy = pv.uy;
				const q0 = p[0] - pv.x, q1 = p[1] - pv.y, q2 = p[2], along = (ux * q0 + uy * q1) * (1 - cs);
				d0 = q0 * cs + uy * q2 * sn + ux * along; // wheel centre relative to the pivot point
				d1 = q1 * cs - ux * q2 * sn + uy * along;
				d2 = q2 * cs + (ux * q1 - uy * q0) * sn;
				p0 = pv.x + d0; p1 = pv.y + d1; p2 = d2;
				a0 = uy * sn; a1 = -ux * sn; a2 = cs; // the axle's direction
				const e0 = om * uy * d2, e1 = -om * ux * d2, e2 = om * (ux * d1 - uy * d0); // its extra velocity from the hanger turning
				dvx = r00 * e0 + r01 * e1 + r02 * e2; dvy = r10 * e0 + r11 * e1 + r12 * e2; dvz = r20 * e0 + r21 * e1 + r22 * e2;
			}
			let ahx = r00 * a0 + r01 * a1 + r02 * a2, ahz = r20 * a0 + r21 * a1 + r22 * a2;
			const offset = treadContact(ahx, r10 * a0 + r11 * a1 + r12 * a2, ahz);
			const ax = r00 * p0 + r01 * p1 + r02 * p2 + offset.x;
			const by = r10 * p0 + r11 * p1 + r12 * p2 + offset.y;
			const az = r20 * p0 + r21 * p1 + r22 * p2 + offset.z;
			const pen = -(cy + by);
			if (pen <= 0) continue;
			if (tr) {
				const om = i < 2 ? om0 : om1;
				const hx = om * (r00 * ux + r01 * uy);
				const hy = om * (r10 * ux + r11 * uy);
				const hz = om * (r20 * ux + r21 * uy);
				dvx += hy * offset.z - hz * offset.y;
				dvy += hz * offset.x - hx * offset.z;
				dvz += hx * offset.y - hy * offset.x;
			}
			const pvx = vx + oy * az - oz * by + dvx, pvy = vy + oz * ax - ox * az + dvy, pvz = vz + ox * by - oy * ax + dvz;
			const n = KW * pen - CW * pvy;
			if (n <= 0) continue;
			wheelMask |= 1 << i;
			if (i < 2) rearDown = true;
			else frontDown = true;
			if (i < 2) floorR += n;
			else floorF += n;
			// sideways grip along the axle; the wheel rolls freely the other way
			const al = Math.hypot(ahx, ahz);
			let lx = 0, lz = 0;
			if (al > 0.3) {
				ahx /= al;
				ahz /= al;
				const lat = clamp(-2000 * (pvx * ahx + pvz * ahz), -MU_W * n, MU_W * n);
				lx = lat * ahx;
				lz = lat * ahz;
			}
			const vh = Math.hypot(pvx, pvz);
			if (vh > 0.05) {
				lx -= (CRR * n * pvx) / vh;
				lz -= (CRR * n * pvz) / vh;
			}
			fx += lx; fy += n; fz += lz;
			const mx = by * lz - az * n, my = az * lx - ax * lz, mz = ax * n - by * lx;
			if (tr) {
				// The part of this wheel's moment that turns the hanger about its pivot goes to the
				// hanger; everything else reaches the deck through the truck.
				const uwx = r00 * ux + r01 * uy, uwy = r10 * ux + r11 * uy, uwz = r20 * ux + r21 * uy;
				const lvx = r00 * d0 + r01 * d1 + r02 * d2 + offset.x, lvy = r10 * d0 + r11 * d1 + r12 * d2 + offset.y, lvz = r20 * d0 + r21 * d1 + r22 * d2 + offset.z;
				const hm = (lvy * lz - lvz * n) * uwx + (lvz * lx - lvx * lz) * uwy + (lvx * n - lvy * lx) * uwz;
				if (i < 2) hw0 += hm;
				else hw1 += hm;
				tx += mx - hm * uwx; ty += my - hm * uwy; tz += mz - hm * uwz;
			} else {
				tx += mx; ty += my; tz += mz;
			}
		}
		let bu0 = 0, bu1 = 0;
		if (tr) {
			// each bushing pushes the deck toward its hanger, about that truck's pivot
			bu0 = bushing(th0, om0, cK, cC, cLim);
			bu1 = bushing(th1, om1, cK, cC, cLim);
			for (let j = 0; j < 2; j++) {
				const pv = PIV[j], bu = j ? bu1 : bu0;
				tx += bu * (r00 * pv.ux + r01 * pv.uy); ty += bu * (r10 * pv.ux + r11 * pv.uy); tz += bu * (r20 * pv.ux + r21 * pv.uy);
			}
		}

		// deck on the floor (tail strike, and anything else that touches)
		if (cy < 0.43) {
			for (let i = 0; i < HULL.length; i++) {
				const p = HULL[i];
				const ay = r10 * p[0] + r11 * p[1] + r12 * p[2];
				const pen = -(cy + ay);
				if (pen <= 0) continue;
				const ax = r00 * p[0] + r01 * p[1] + r02 * p[2], az = r20 * p[0] + r21 * p[1] + r22 * p[2];
				const pvx = vx + oy * az - oz * ay, pvy = vy + oz * ax - ox * az, pvz = vz + ox * ay - oy * ax;
				const n = KH * pen - CH * pvy;
				if (n <= 0) continue;
				deckDown = true;
				if (rec && wasAirborne && deckStrikeAfterPop === null) deckStrikeAfterPop = t;
				if (popped && !struck && p[0] < -0.3) {
					struck = true;
					tStrike = t;
				}
				const lx = 0; // the deck skids freely along the travel
				const lz = clamp(-400 * pvz, -MU_H * n, MU_H * n);
				fx += lx; fy += n; fz += lz;
				tx += ay * lz - az * n; ty += az * lx - ax * lz; tz += ax * n - ay * lx;
			}
		}

		// back foot stomps the tail until it strikes
		if (popped && !struck) {
			const p = STOMP_AT;
			const ax = r00 * p[0] + r01 * p[1] + r02 * p[2], az = r20 * p[0] + r21 * p[1] + r22 * p[2];
			fy -= STOMP;
			tx += az * STOMP; tz -= ax * STOMP;
			// The stomping foot also grips the deck, so the board keeps moving with the rider. Without
			// this the wheels' rolling resistance under the stomp would slow the board alone, and it
			// would fly the trick slower than it rolled in.
			const g = clamp(-900 * (vx - vxr), -MU_S * STOMP, MU_S * STOMP);
			fx += g;
			vxr -= (g / MR) * DT;
		}

		// The feet's burst: flick, scoop and levelling press.
		if (t >= tw && t < tw + BURST) {
			if (snap.w === undefined) {
				snap.w = [wx, wy, wz];
				snap.pitch = Math.asin(clamp(r10, -1, 1));
			}
			if (inp.wrap || cleanTorques) {
				// plain torques about the board's own axes (see `cleanTorques`)
				const bx = IX * th[0], bn = IY * th[1], bz = IZ * th[2];
				tx += r00 * bx + r01 * bn + r02 * bz; ty += r10 * bx + r11 * bn + r12 * bz; tz += r20 * bx + r21 * bn + r22 * bz;
			} else {
				// Forces from the feet. th[0], th[1] and th[2] set how hard the flick, the scoop and the
				// levelling press are (as the spin-up each would give alone on a level board).
				const flick = (IX * Math.abs(th[0])) / FLICK_Z; // front foot, pushing down…
				const side = th[0] < 0 ? -FLICK_Z : FLICK_Z; // …on the heel-side or the toe-side edge
				const scoop = (IY * th[1]) / (PIVOT_SHARE * PIVOT_X - SCOOP_X); // back foot, sideways on the tail
				const press = (IZ * Math.abs(th[2])) / PRESS_X; // a foot pressing the nose or the tail down
				const px = th[2] < 0 ? PRESS_X : -PRESS_X;
				// The flick and the press push straight down, wherever the board is pointing, at their
				// places on the deck: torque = r × F with r turned into the world frame.
				const ax1 = r00 * FLICK_X + r01 * FOOT_Y + r02 * side, az1 = r20 * FLICK_X + r21 * FOOT_Y + r22 * side;
				const ax2 = r00 * px + r01 * FOOT_Y, az2 = r20 * px + r21 * FOOT_Y;
				fy -= flick + press;
				tx += az1 * flick + az2 * press;
				tz -= ax1 * flick + ax2 * press;
				// The scoop pushes the tail sideways along the deck, and the front foot pushes back with
				// most of that force, so the board mostly spins and slides a little.
				// On a 180 Ollie, model the rider and deck turning together as a couple,
				// with no sideways shove between them.
				const turnsTogether = inp.riderTurn && inp.riderTurn === inp.yaw;
				const Fz = turnsTogether ? 0 : scoop * (1 - PIVOT_SHARE);
				const Tx = FOOT_Y * scoop * (1 - PIVOT_SHARE);
				const Ty = -SCOOP_X * scoop + PIVOT_X * PIVOT_SHARE * scoop;
				fx += r02 * Fz; fy += r12 * Fz; fz += r22 * Fz;
				tx += r00 * Tx + r01 * Ty; ty += r10 * Tx + r11 * Ty; tz += r20 * Tx + r21 * Ty;
			}
		}
		// A guiding foot is still on the grip tape for a moment after the strike. Its friction drags
		// the board toward the foot's own vertical speed (the rider's, plus the knee coming up):
		// up if the board lags, down if the pop sent it up faster than the rider.
		if (!inp.wrap && struck && !caught && t < tStruck + (inp.hold || FRONT)) fy += clamp(-DRAG * (vy - (vr + th[3])), -DRAG_MAX, DRAG_MAX);

		// The front foot briefly presses the deck level on spin tricks.
		if (inp.hold && struck && t < tw + inp.hold) {
			const pitch = Math.asin(clamp(r10, -1, 1));
			const pitchRate = oz * r00 - ox * r20;
			const lv = clamp(-320 * pitch - 11 * pitchRate, -80, 80); // N·m about the board's width
			tx += r02 * lv; ty += r12 * lv; tz += r22 * lv;
		}

		// impossible: the back foot stays hooked on the deck and carries it
		if (inp.wrap && t >= tw && !caught) {
			const p = HOOK_AT;
			const ax = r00 * p[0] + r01 * p[1] + r02 * p[2], ay = r10 * p[0] + r11 * p[1] + r12 * p[2], az = r20 * p[0] + r21 * p[1] + r22 * p[2];
			if (!hooked) {
				hooked = true;
				hookT0 = t;
				hookX = cx + ax - xr;
				hookY0 = cy + ay;
			}
			// the foot rises with the jump and the knee, and is back at catch height by the catch
			const k = (t - hookT0) / (tc - hookT0);
			const rise = 0.28 * Math.sin(Math.PI * clamp(k, 0, 1));
			const targetY = hookY0 + (DIM.groundOffset + yr + TUCK + 0.045 - hookY0) * sstep(0, 1, k) + rise;
			const pvx = vx + oy * az - oz * ay, pvy = vy + oz * ax - ox * az, pvz = vz + ox * ay - oy * ax;
			const hx = 20000 * (xr + hookX - (cx + ax)) - 260 * (pvx - vxr);
			const hy = 20000 * (targetY - (cy + ay)) - 260 * (pvy - vr);
			const hz = 20000 * (0 - (cz + az)) - 260 * pvz;
			hookY = targetY;
			fx += hx; fy += hy; fz += hz;
			tx += ay * hz - az * hy; ty += az * hx - ax * hz; tz += ax * hy - ay * hx;
		}

		// feet on the deck: standing before the pop, and from the catch on. Each sole contact pushes
		// down where the deck comes up against it (and can hold it up by HOLD at most), and grips
		// sideways in proportion to that force plus a small fixed amount.
		let load = 0, drag = 0, dragZ = 0, bend = 0;
		// After the catch the feet can lose the board: it tips away from under them (past the tilt at
		// which soles can stand on a deck), or the rider comes down without it (half a metre below
		// standing the rider is on the ground). From then on the rider is off it and the board is on its own. No
		// landed run comes near either, so this only decides how a failed one goes on.
		if (caught && attached && (r11 <= 0.35 || yr < -0.5)) attached = false;
		if (attached && r11 > 0.35) {
			// after the catch the legs straighten on schedule for the landing, and faster if needed
			// to keep the soles on the deck
			const tuckWas = tuck;
			if (caught) tuck = Math.min(tuck, TUCK * (1 - sstep(tc, tDown, t)));
			const h = DIM.groundOffset + yr + tuck; // sole height
			// On the way down the rider holds the board slightly tilted along the travel, one foot a
			// little lower than the other, so one pair of wheels touches first, and slightly to one
			// side, one edge of the feet a little lower (see LAND_SIDE). Both tilts build steadily from
			// the catch until the landing, so the board is still easing into them as it touches, and go
			// once the board is on the floor.
			const ramp = clamp((t - tc) / (tDown - 0.02 - tc), 0, 1), fade = tLand === tLand ? 1 - sstep(tLand, tLand + 0.06, t) : 1;
			const lean = caught && inp.lean ? inp.lean * ramp * fade : 0;
			const side = caught && inp.side ? inp.side * ramp * fade : 0;
			const hRate = vr + (tuck - tuckWas) / DT;
			const oX = cx - (r00 * COM.x + r01 * COM.y + r02 * COM.z), oY = cy - (r10 * COM.x + r11 * COM.y + r12 * COM.z), oZ = cz - (r20 * COM.x + r21 * COM.y + r22 * COM.z);
			// where the deck is under each sole, and how fast it is closing on it
			let hits = 0, penMean = 0, rateMean = 0, slip = 0;
			// coupled: the feet stand on the deck and have turned with it by `psf`
			const following = inp.catchYaw && caught && !Number.isFinite(tLand);
			const soleYaw = following ? -heading + rad(inp.yaw) : psf;
			const turned = on || following;
			const pc = turned ? Math.cos(soleYaw) : 1, ps = turned ? Math.sin(soleYaw) : 0;
			const pw = following ? oy : on ? -psw : 0;
			for (let i = 0; i < 4; i++) {
				const backFoot = (SOLES[i][0] < 0) !== Boolean(inp.riderTurn);
				if (caught && backFoot && t < tc + (inp.backDelay ?? BACK_FOOT_LATE)) continue;
				const soleX = SOLES[i][0];
				const reversed = caught && inp.riderTurn;
				const inset = !caught ? 0 : (soleX < 0) !== Boolean(reversed) ? placeR : placeF;
				const sxl = soleX - Math.sign(soleX) * inset; // where this foot stands along the deck
				const rxo = sxl * pc - SOLES[i][1] * ps, rzo = sxl * ps + SOLES[i][1] * pc;
				const sx = xr + feetX + rxo, sz = (on ? zf : air ? zr : feetZ) + rzo;
				const yb = oY - (r01 * (sx - oX) + r21 * (sz - oZ)) / r11; // deck top under this sole
				const dx = sx - oX, dy = yb - oY, dz = sz - oZ;
				const lx = dx * r00 + dy * r10 + dz * r20, lz = dx * r02 + dy * r12 + dz * r22;
				// In the air a sole edge past the rail still counts while at least half the shoe is over
				// the deck: it then presses at the rail (below). With less than half the shoe on, that
				// edge has nothing under it and is dropped, and the deck tips away from the other one.
				// (It used to be dropped 3 mm past the rail: feet 13 mm to one side then lost both
				// contacts of that side at once, and the other two tipped the deck 40° and more.)
				if (Math.abs(lx) > 0.39 || (!on && Math.abs(lz) > 0.1 + Math.abs(SOLES[i][1]))) continue;
				// a foot that overhangs the rail still presses on the deck, at its edge
				const out = Math.abs(lz) > 0.1 ? lz - Math.sign(lz) * 0.1 : 0;
				const ax = sx - r02 * out - cx, ay = yb - r12 * out - cy, az = sz - r22 * out - cz;
				const k = hits * 7;
				HIT[k] = ax; HIT[k + 1] = ay; HIT[k + 2] = az;
				HIT[k + 3] = vx + oy * az - oz * ay - pw * rzo; // velocity of the deck under the sole (against a foot turning with the board)
				HIT[k + 4] = vz + ox * ay - oy * ax + pw * rxo;
				slip += HIT[k + 4];
				HIT[k + 5] = yb - (h + lean * sxl + side * SOLES[i][1]); // the front foot higher, the back foot lower (or the reverse); one edge lower
				HIT[k + 6] = vy + oz * ax - ox * az - hRate;
				penMean += HIT[k + 5];
				rateMean += HIT[k + 6];
				hits++;
			}
			penMean /= hits || 1;
			slip /= hits || 1;
			// coupled: the feet have no mass of their own; they move sideways at the speed at which the
			// grip of the soles on the deck balances the pull of the legs toward the rider's mass
			if (on) vzf = hits ? (900 * hits * slip + legC * vzr - legK * (zf - zr - legRest)) / (900 * hits + legC) : vzr;
			else if (air) vzf = vzr;
			// coupled: the rider's weight comes down under their own mass, which sways over the feet, as far
			// as the deck's width allows; plus the pressure shifted on purpose against a lasting lean
			const cop = on ? clamp(zr - zf + shift, -COUPLED.reach, COUPLED.reach) : 0;
			slipWas = slip;
			hitsWas = hits;
			rateMean /= hits || 1;
			for (let i = 0; i < hits; i++) {
				const k = i * 7;
				// Negative values are the limited hold: without it the push that stops a flip knocks
				// the board away from the feet and it lands tilted.
				const n = Math.max(-HOLD, (caught ? legStiff : 1) * (KS * penMean + CS * rateMean) + KT * (HIT[k + 5] - penMean) + CT * (HIT[k + 6] - rateMean) + (on ? (Math.sign(HIT[k + 2]) * loadWas * cop) / (hits * 0.095) : 0));
				if (catchMechanics && caught && n !== 0) {
					if (contact === null) {
						contact = t;
						catchMechanics.spinAtContact = oy;
					}
					if (n > 0) catchMechanics.firstCompression ??= t;
					else if (tLand !== tLand) catchMechanics.tensileImpulse -= n * DT;
				}
				const grip = MU_S * Math.abs(n) + GRIP_MIN;
				const gx = clamp(-900 * (HIT[k + 3] - vxr), -grip, grip), gz = clamp(-900 * (HIT[k + 4] - (air ? vzf : 0)), -grip, grip);
				const ax = HIT[k], ay = HIT[k + 1], az = HIT[k + 2];
				fx += gx; fy -= n; fz += gz;
				tx += ay * gz + az * n; ty += az * gx - ax * gz; tz += -ax * n - ay * gx;
				load += n;
				bend += n * spanShare(HIT[k] * r00 + HIT[k + 1] * r10 + HIT[k + 2] * r20 + COM.x); // this contact's share in bending the span
				drag += gx;
				dragZ += gz;
			}
			// if the deck drops away from the soles the legs reach after it, at up to 3 m/s
			if (caught && load < PRESS && tuck > -0.03) tuck -= 3 * (1 - load / PRESS) * DT;
		}

		if (air) {
			// the rider's mass is moved sideways only by what the feet grip
			vzr -= (dragZ / MR) * DT;
			zr += vzr * DT;
		}
		if (on) {
			zf += vzf * DT; // the feet go where grip and legs balance
			// the planted feet turn with the board
			const hl2 = Math.hypot(r00, r20);
			if (hl2 > 0.5) {
				psw = (Math.atan2(r00 < 0 ? -r20 : r20, Math.abs(r00)) - psf) / COUPLED.feetTurn;
				psf += psw * DT;
			}
			// the rider feels a lean after a reaction time, and moves that pressure across the deck against it
			leanF += ((Math.asin(clamp(r12, -1, 1)) * (r22 < 0 ? -1 : 1) - leanF) * DT) / COUPLED.react;
			shift = clamp(shift + COUPLED.shift * leanF * DT, -COUPLED.shiftMax, COUPLED.shiftMax);
		}
		// After the Bigspin catch the rider finishes turning with both feet over the bolts.
		if (inp.catchYaw && caught && !Number.isFinite(tLand) && hitsWas > 0) { // (while the soles are on the deck, loaded or not)
			const left = rad(inp.yaw) - heading - oy * BIGSPIN.lead; // (less what the turn covers while the board answers)
			// The turn that is left is spread over the time that is left: at a steady pace first, then
			// slowing evenly to a stop over the last `BIGSPIN.slow` seconds before the landing. (It used
			// to be finished 62 ms early at one and a half times the pace needed: the board sped up from
			// 800 to 1300°/s under the feet, overshot and was snapped back by the wheels.)
			const settle = Math.max(0.004, tp + airtime - t - BIGSPIN.early);
			// (a turn that has gone a little too far is stopped, not brought back)
			const targetRate = left * inp.yaw <= 0 ? 0 : clamp(settle > BIGSPIN.slow ? left / (settle - BIGSPIN.slow / 2) : (2 * left) / settle, -23, 23);
			ty += clamp(8 * (targetRate - oy), -80, 80);
		}
		loadWas = Math.max(0, load);
		// rider: carried by the legs, and slowed along the travel by whatever the feet drag against
		vr += (load / MR - G) * DT;
		yr += vr * DT;
		vxr -= (drag / MR) * DT;
		xr += vxr * DT;

		// board: linear
		if (broken && sagDown) {
			// The broken middle drags on the floor under whatever weight is on it. The soles grip the
			// deck harder than the wood grips the floor, so the rider does not slide over the board:
			// board and rider are slowed together, as one mass. (The drag was on the board alone at
			// first. It then lost a fifth of its speed in five thousandths of a second, slipping back
			// under the feet, which looked as if it had hit a wall.)
			const sp = Math.hypot(vx, vz);
			if (sp > 1e-3) {
				const f = Math.min(0.4 * Math.max(0, load), (sp * (MB + MR)) / DT) / (MB + MR);
				fx -= (f * MB * vx) / sp;
				fz -= (f * MB * vz) / sp;
				vxr -= ((f * vx) / sp) * DT;
			}
		}
		vx += (fx / MB) * DT; vy += (fy / MB) * DT; vz += (fz / MB) * DT;
		cx += vx * DT; cy += vy * DT; cz += vz * DT;
		// board: angular (Euler's equations in the body frame)
		const bx = r00 * tx + r10 * ty + r20 * tz, by2 = r01 * tx + r11 * ty + r21 * tz, bz = r02 * tx + r12 * ty + r22 * tz;
		const IXe = tr ? IX - 2 * COUPLED.hanger * PIVOT.ux * PIVOT.ux : IX; // coupled: the hangers no longer turn rigidly with the deck about its length
		const ax2 = (bx - (IZ - IY) * wy * wz) / IXe, ay2 = (by2 - (IXe - IZ) * wz * wx) / IY, az2 = (bz - (IY - IXe) * wx * wy) / IZ;
		wx += ax2 * DT; wy += ay2 * DT; wz += az2 * DT;
		if (tr) {
			// each hanger: turned by its wheels, held by its bushing, and left behind as the deck turns
			om0 += ((hw0 - bu0) / COUPLED.hanger - (ax2 * PIV[0].ux + ay2 * PIV[0].uy)) * DT;
			th0 += om0 * DT;
			om1 += ((hw1 - bu1) / COUPLED.hanger - (ax2 * PIV[1].ux + ay2 * PIV[1].uy)) * DT;
			th1 += om1 * DT;
			if (th0 < 1e-9 && th0 > -1e-9 && om0 < 1e-9 && om0 > -1e-9) th0 = om0 = 0;
			if (th1 < 1e-9 && th1 > -1e-9 && om1 < 1e-9 && om1 > -1e-9) th1 = om1 = 0;
		}
		const hx2 = 0.5 * DT;
		const nqx = qx + hx2 * (qw * wx + qy * wz - qz * wy), nqy = qy + hx2 * (qw * wy + qz * wx - qx * wz), nqz = qz + hx2 * (qw * wz + qx * wy - qy * wx), nqw = qw - hx2 * (qx * wx + qy * wy + qz * wz);
		const nl = 1 / Math.hypot(nqx, nqy, nqz, nqw);
		qx = nqx * nl; qy = nqy * nl; qz = nqz * nl; qw = nqw * nl;
		// Motion that has died away is set to exactly zero. Left alone it decays into denormal
		// numbers, which are far slower to compute with and made some tricks take seconds to prepare.
		if (vy < 1e-9 && vy > -1e-9) vy = 0;
		if (vz < 1e-9 && vz > -1e-9) vz = 0;
		if (vr < 1e-9 && vr > -1e-9) vr = 0;
		if (wx < 1e-9 && wx > -1e-9) wx = 0;
		if (wy < 1e-9 && wy > -1e-9) wy = 0;
		if (wz < 1e-9 && wz > -1e-9) wz = 0;
		if (flex < 1e-9) flex = 0;
		if (cz < 1e-12 && cz > -1e-12) cz = 0;
		if (qx < 1e-13 && qx > -1e-13) qx = 0;
		if (qy < 1e-13 && qy > -1e-13) qy = 0;
		if (qz < 1e-13 && qz > -1e-13) qz = 0;
		rollAcc += wx * DT;
		if (inp.wrap) pitchAcc += wz * DT;
		// heading of the board's long axis over the floor, unwrapped
		const hl = Math.hypot(r00, r20);
		if (hl > 0.2) {
			const hd = Math.atan2(-r20, r00);
			let dh = hd - headingPrev;
			if (dh > Math.PI) dh -= 2 * Math.PI;
			if (dh < -Math.PI) dh += 2 * Math.PI;
			// rolling through upside-down flips the long axis' handedness, not its heading
			if (Math.abs(dh) < 1) heading += dh;
			headingPrev = hd;
		}
		yawAcc = heading;

		// wheels: driven by the floor when they touch it, coasting on their own inertia in the air
		const fwd = (vx * r00 + vz * r20) / R_WHEEL; // travel along the board's own length
		const gripK = 1 - Math.exp(-DT / 0.004);
		wR = rearDown ? wR + (-fwd - wR) * gripK : wR * (1 - DT / 4);
		wF = frontDown ? wF + (-fwd - wF) * gripK : wF * (1 - DT / 4);
		spinR += wR * DT;
		spinF += wF * DT;
		// the deck's bend follows the load on it; shown relative to its shape under a standing rider,
		// so it is straight at rest and dips only under the extra load of an impact
		// (coupled: sized from where each foot contact presses, not from the total load alone, and
		// drawn COUPLED.deckShow times as large as calculated so that it can be seen. The span bends
		// against its two supports, so it is bent no harder than the less loaded truck pushes back:
		// with one truck still in the air the board turns about the other and does not bend.)
		flex += ((CO ? Math.max(0, Math.min(bend, 2 * Math.min(floorR, floorF)) - bendStand) / kSpan : Math.max(0, load - MR * G) / KDECK) - flex) * (1 - Math.exp(-DT / (CO ? COUPLED.deckTime : 0.006)));
		// only where the bend is at its calculated size: past the wood's strength the deck breaks
		if (CO && caught && !broken && flex + bendStand / kSpan > breakBend) {
			broken = true;
			tBreak = t;
			sag = flex; // carries on from the bend as it is drawn
			sagAt = sag;
			pushAt = bend; // the force of the legs that broke it is still on it
			vsag = Math.max(0, -vr, (flex - flexWas) / DT);
		}
		if (broken) {
			// How far the middle can drop before it is on the floor. On a level board that is `sagMax`.
			// A deck that breaks while it is tipped to one side has one edge of its middle lower than
			// the other, and that edge is what reaches the floor first: the drop is measured to it.
			// (It was `sagMax` whatever the tilt, and a board broken on its side then sank its lower
			// edge into the floor, by up to half the deck's width times the tilt.)
			const deckY = cy - (r10 * COM.x + r11 * COM.y + r12 * COM.z); // deck top at the middle
			const reach = Math.max(0, Math.min(sagMax, (deckY - r11 * DIM.thickness - (Math.abs(r12) * DIM.width) / 2) / Math.max(0.3, r11)));
			if (sag < reach) {
				// Nothing holds the middle up any more. The legs are still pressing with the force that broke
				// the deck, and now only the feet, the lower legs and the broken ends are in the way (about
				// 6 kg, an estimate), so the middle is driven to the floor in about a hundredth of a second.
				// The push eases off as the legs straighten. There is no bounce: the rider's weight is on it.
				const push = Math.max(0, pushAt - legStiff * KS * 4 * (sag - sagAt));
				vsag += (G + push / 6) * DT;
				sag = Math.min(reach, sag + vsag * DT);
			} else sag = reach;
			sagDown = sag >= reach;
		}
		flexWas = flex;
		if (cy - REST_Y > apex) apex = cy - REST_Y;
		if (caught && tLand !== tLand && (rearDown || frontDown)) tLand = t;
		if (catchMechanics && contact !== null && t >= contact + 0.02) catchMechanics.spinAfter20ms ??= oy;
		if (rec && struck) {
			if (!rearDown && !frontDown && !deckDown) wasAirborne = true;
			else if (wasAirborne && floorImpact === null) floorImpact = t;
			if (wasAirborne && wheelMask && wheelTouchdown === null) wheelTouchdown = { time: t, mask: wheelMask };
		}
		rearOnFloor = rearDown;
		frontOnFloor = frontDown;
		// A combo can take the board over before the roll-out is finished: the state at that moment is
		// kept as well, and the run goes on to its end so that the landing is judged as always.
		if (inp.handAt !== undefined && handed === null && tLand === tLand && t >= tLand + inp.handAt) handed = { t, state: { cx, cy, cz, vx, vy, vz, qx, qy, qz, qw, wx, wy, wz, yr, vr, xr, vxr, spinR, spinF, wR, wF, th0, th1, om0, om1, zr, vzr, zf, vzf, psf, psw, shift, leanF, loadWas, legRest, flex, rearOnFloor, frontOnFloor, feetX, feetZ } };

		t += DT;
		step++;
	}
	return {
		q: [qx, qy, qz, qw], w: [wx, wy, wz], deckY: cy - (2 * (qx * qy + qw * qz) * COM.x + (1 - 2 * (qx * qx + qz * qz)) * COM.y + 2 * (qy * qz - qw * qx) * COM.z),
		soleY: DIM.groundOffset + yr + TUCK, pitchAcc, rollAcc, yawAcc, tStrike, tLand, tc, tp, snap, apex, end: t, atCatch,
		rolling: rearOnFloor && frontOnFloor, // both trucks on the floor when the run ended
		broke: broken, tBreak, contact, floorImpact, wheelTouchdown, catchMechanics, deckStrikeAfterPop,
		riding: attached, // the rider is still on the board (a variation can lose it: see `attached`)
		state: { cx, cy, cz, vx, vy, vz, qx, qy, qz, qw, wx, wy, wz, yr, vr, xr, vxr, spinR, spinF, wR, wF, th0, th1, om0, om1, zr, vzr, zf, vzf, psf, psw, shift, leanF, loadWas, legRest, flex, rearOnFloor, frontOnFloor, feetX, feetZ }, // everything that moves, as the run ended: what a following trick starts from
		handed, // …or the same a little after the landing, when a combo asked for it (see inp.handAt)
			cz
	};
}

/* ---------- solving the feet's burst ---------- */

const rad = THREE.MathUtils.degToRad;
const qmul = (a, b) => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];

function solveLinear(A, b) {
	const n = b.length;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
		[M[c], M[p]] = [M[p], M[c]];
		if (Math.abs(M[c][c]) < 1e-14) return null;
		for (let r = 0; r < n; r++) {
			if (r === c) continue;
			const k = M[r][c] / M[c][c];
			for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
		}
	}
	return M.map((row, i) => row[n] / row[i]);
}

// How far the board is, at the catch, from the pose the rider needs: heading and roll at the
// share `s` of the trick's rotation (s = 1 is the real target: level, turned the right way),
// and level with the feet.
function miss(inp, th, tc, s) {
	// The pose is judged as the feet arrive. On the real target the heading is judged a moment
	// later, once the feet have stopped what spin was left, so the board ends up pointing straight.
	// Calibrated runs can also give the heading at first catch some weight.
	const sim = simulate(inp, th, s === 1 && inp.yaw && !inp.catchYaw ? tc + 0.12 : tc);
	const at = sim.atCatch || sim;
	const h = (rad(inp.catchYaw ?? inp.yaw ?? 0) * s) / 2;
	const r = (rad(inp.roll || 0) * s) / 2;
	const target = qmul([0, Math.sin(h), 0, Math.cos(h)], [Math.sin(r), 0, 0, Math.cos(r)]);
	let e = qmul([-target[0], -target[1], -target[2], target[3]], at.q);
	if (e[3] < 0) e = e.map((v) => -v);
	const vl = Math.hypot(e[0], e[1], e[2]);
	const ang = vl < 1e-9 ? 0 : (2 * Math.atan2(vl, e[3])) / vl;
	const out = [e[0] * ang, e[1] * ang, e[2] * ang];
	if (sim.atCatch) {
		const [x, y, z, w] = sim.q;
		let dh = Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)) - rad(inp.yaw || 0);
		dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
		out[1] = inp.includeCatchHeading ? 0.30 * out[1] + 0.70 * dh : dh;
	}
	// Quaternion alignment alone treats zero and one complete wrap as the same pose.
	if (inp.wrap) out[2] = at.pitchAcc + 2 * Math.PI;
	if (!inp.wrap) out.push((at.deckY - at.soleY) * 8);
	return out;
}

const norm = (r) => Math.hypot(...r);

function solveBurst(inp) {
	const tc = APPROACH + (inp.catch * 2 * inp.jump) / G;
	// which parts of the burst are solved for: roll, spin, pitch, lift (the hooked foot of an
	// impossible does the lifting itself)
	const free = inp.wrap ? [0, 1, 2] : [0, 1, 2, 3];

	// a first run without any burst shows when the tail strikes and what the pop leaves behind
	const tStrike = simulate(inp, [0, 0, 0, 0], APPROACH + 0.1).tStrike || APPROACH + 0.04;
	const tw = tStrike + inp.delay;
	const span = tc - tw - BURST / 2;
	const peek = simulate(inp, Object.assign([0, 0, 0, 0], { tw, ts: tStrike }), tw + BURST / 2).snap;
	const guess = [
		(rad(inp.roll || 0) / span - peek.w[0]) / BURST,
		(rad(inp.catchYaw ?? inp.yaw ?? 0) / span - peek.w[1]) / BURST,
		inp.hold ? 0 : ((inp.wrap ? -2 * Math.PI - peek.pitch : -peek.pitch * 1.3) / span - peek.w[2]) / BURST,
		0
	];

	// The target is approached in stages (a third of the rotation, two thirds, all of it) so the
	// solution stays on the branch with the intended number of turns.
	const th = Object.assign([0, 0, 0, 0], { tw, ts: tStrike });
	if (inp.catchYaw && !inp.roll) {
		guess[0] = 0;
		guess[1] = -345;
		guess[2] = -650;
		guess[3] = 0.87;
	}
	const stages = inp.wrap || (inp.catchYaw && !inp.roll) || !(inp.roll || inp.yaw) ? [1] : [0.34, 0.67, 1];
	let res = Infinity;
	stages.forEach((s, si) => {
		const prev = si ? stages[si - 1] : 0;
		// start each stage from the last, scaled up; pitch and lift do not scale with the rotation
		th[0] = prev ? (th[0] * s) / prev : guess[0] * s;
		th[1] = prev ? (th[1] * s) / prev : guess[1] * s;
		if (!prev) {
			th[2] = guess[2];
			th[3] = guess[3];
		}
		let cur = miss(inp, th, tc, s);
		let lambda = 1e-6;
		// Stop once the board would arrive within about a degree and a centimetre of square. A rider
		// is not more exact than that, and the catch has to deal with what is left.
		for (let it = 0; it < 12 && norm(cur) > (s === 1 ? 0.02 : 0.002); it++) {
			const m = cur.length;
			const J = [];
			for (let i = 0; i < m; i++) J.push(new Array(free.length).fill(0));
			free.forEach((p, j) => {
				const d = Math.max(Math.abs(th[p]) * 0.02, p === 3 ? 1 : 6);
				const t2 = Object.assign([...th], { tw, ts: tStrike });
				t2[p] += d;
				const mm = miss(inp, t2, tc, s);
				for (let i = 0; i < m; i++) J[i][j] = (mm[i] - cur[i]) / d;
			});
			// damped least squares: (JᵀJ + λ·diag) Δ = −Jᵀr
			const n = free.length;
			const JTJ = [];
			const JTr = new Array(n).fill(0);
			for (let a = 0; a < n; a++) {
				JTJ.push(new Array(n).fill(0));
				for (let b = 0; b < n; b++) for (let i = 0; i < m; i++) JTJ[a][b] += J[i][a] * J[i][b];
				for (let i = 0; i < m; i++) JTr[a] -= J[i][a] * cur[i];
			}
			let stepped = false;
			for (let tries = 0; tries < 7 && !stepped; tries++) {
				const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
				const dx = solveLinear(A, JTr);
				if (dx) {
					const t2 = Object.assign([...th], { tw, ts: tStrike });
					free.forEach((p, j) => (t2[p] += dx[j]));
					const mm = miss(inp, t2, tc, s);
					if (norm(mm) < norm(cur)) {
						free.forEach((p) => (th[p] = t2[p]));
						cur = mm;
						lambda = Math.max(1e-7, lambda / 4);
						stepped = true;
						continue;
					}
				}
				lambda = lambda * 10 + 1e-4;
			}
			if (!stepped) break;
		}
		res = norm(cur);
	});
	return { th, miss: res, tw, tc, tStrike };
}

/* ---------- baked motion ---------- */

// Solved bursts, one per trick (see timing). They are inputs only: how well each one works is
// measured again every time it is used, against the simulation as it is now. After changing the
// model or a trick's input, regenerate them: empty this table, load the page, and copy
// `timing(trick).burst` for each trick.
const SOLVED = {
	"bs-180-kickflip": { th: [-721.8923284390305, -561.9275933853362, -123.65394797518394, 0.06271442642801957], tw: 0.46199999999999575, ts: 0.4369999999999957, clean: false },
	"extra-crosswire": { th: [1120.934385875439, 1146.6639069482203, -189.54845253390258, 0.3920449578008696], tw: 0.44899999999999574, ts: 0.4369999999999957, clean: false },
	"ollie": { th: [1.674790272120045e-05, 2.1039600653136566e-05, -617.0641653136634, -0.06306711860069492], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.62 },
	"ollie@1": { th: [1.3325644907042338e-05, 1.6272619252850654e-05, -604.5088965247508, -0.009543691971469759], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.62 },
	"ollie@2": { th: [2.0492379086226256e-05, 2.6090680878663366e-05, -632.0293820538848, -0.09735712935927299], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.62 },
	"fs-180-ollie": { th: [51.62687830394452, 380.4584669039167, -62.00878444531668, -0.27983088934906936], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"bs-180-ollie": { th: [-60.12269178043919, -377.4349996159817, -175.28652879446838, -0.21930818516684975], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"bs-180-ollie@2": { th: [-62.23635341365794, -402.4029431661079, -142.58039649854499, -0.2830939643746875], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"bs-bigspin": { th: [-150.44382806617466, -481.4182348386414, -44.237719337305364, -0.13637006961072973], tw: 0.45499999999999574, ts: 0.4369999999999957, clean: false },
	"bs-bigspin@1": { th: [-168.84950842956516, -414.1448325856603, -426.36487230389514, -0.14507868799012627], tw: 0.45499999999999574, ts: 0.4369999999999957, clean: true },
	"bs-bigspin@2": { th: [38.621388428721616, -326.46576849625586, -689.363039569082, -0.2181870500882729], tw: 0.45499999999999574, ts: 0.4369999999999957, clean: true },
	"360-pop-shuvit": { th: [2.5027238281918325, -453.0932803322725, -560.0314154609107, 0.6898043934774145], tw: 0.45499999999999574, ts: 0.4369999999999957, clean: false },
	"360-pop-shuvit@1": { th: [34.714793145032814, -377.5401870797155, -650.8372283406665, 1.9505494695233636], tw: 0.46899999999999575, ts: 0.4369999999999957, clean: false, catchFraction: 0.88 },
	"bs-pop-shuvit": { th: [-67.25639296090661, -329.37078757699885, -863.5096911170293, 0.24609087281962616], tw: 0.44099999999999573, ts: 0.4369999999999957, clean: false, catchFraction: 0.81, includeCatchHeading: true },
	"fs-pop-shuvit": { th: [83.38759557418801, 385.39316095905485, -904.7953926190326, 0.23816873098389243], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.71, includeCatchHeading: true },
	"kickflip": { th: [-861.6676779913374, -48.53545457509826, -635.3561171919532, 0.6825118312924686], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"heelflip": { th: [861.6958292168713, 48.52828561159951, -635.2334647616167, 0.6824999849504242], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },

	"varial-heelflip": { th: [790.37932614, 580.118227916, 328.696262582, 1.35673887028], tw: 0.477, ts: 0.437, clean: false },
	"360-flip": { th: [-1039.8917639941744, -858.1014214479611, -357.4322036148751, -0.37290656278548395], tw: 0.4769999999999957, ts: 0.4369999999999957, clean: true },
	"hardflip": { th: [-858.45463932, -101.90238217, -525.883142424, -0.378327207101], tw: 0.477, ts: 0.437, clean: true },

	// jump variants (see JUMP_VARIANTS): "trick@1" is the higher jump, "trick@2" the lower
	"kickflip@1": { th: [-778.2347810196378, -43.76200031544205, -647.8610742386302, 0.7162198546788594], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"kickflip@2": { th: [-919.8955270530627, -51.880220993531516, -626.7015441400905, 0.6601315735367026], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"heelflip@1": { th: [778.2561357398303, 43.75192251554773, -647.7509711151297, 0.7161858031458544], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },
	"heelflip@2": { th: [919.9288404846093, 51.87543222419639, -626.5702135632821, 0.6601364348155995], tw: 0.44299999999999573, ts: 0.4369999999999957, clean: false },


	"varial-heelflip@1": { th: [733.4276647542617, 550.7551305047419, 166.89474686396306, 0.8753249278438258], tw: 0.4769999999999957, ts: 0.4369999999999957, clean: false },
	"varial-heelflip@2": { th: [859.7936808636496, 635.2633468256768, 296.0506508383361, 1.2661961581660546], tw: 0.4769999999999957, ts: 0.4369999999999957, clean: false },
	"360-flip@1": { th: [-693.4089087592743, -767.7519037344669, 277.44376212374954, 1.3160119070344818], tw: 0.4769999999999957, ts: 0.4369999999999957, clean: false },
	"hardflip@1": { th: [-641.3058869419976, -181.51763927273473, -470.31399423962034, 1.8082669210036098], tw: 0.4769999999999957, ts: 0.4369999999999957, clean: false },
	"bs-pop-shuvit@1": { th: [-69.53625376565135, -316.3668377634804, -932.2981330944554, 0.29273237315118017], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.76, includeCatchHeading: true },
	"bs-pop-shuvit@2": { th: [-77.983311004587, -355.47126966243314, -923.869465823324, 0.22049322910458238], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.81, includeCatchHeading: true },
	"fs-pop-shuvit@1": { th: [64.7361173725999, 320.9664311394209, -864.4442717596197, 0.29173026877191466], tw: 0.44099999999999573, ts: 0.4369999999999957, clean: false, catchFraction: 0.76, includeCatchHeading: true },
	"fs-pop-shuvit@2": { th: [109.96222457421746, 428.45962867589714, -937.3822429239757, 0.24752800228404725], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.71, includeCatchHeading: true },
};

// Reference-tuned bursts for articulated trucks. Keep the rigid diagnostic model separate.
const SOLVED_COUPLED = {
	"360-flip": { th: [-803.0990171659919, -958.5689971923877, -289.9337897401983, 0.6076798191978076], tw: 0.46099999999999575, ts: 0.4369999999999957, catchFraction: 0.78, clean: false },

	"360-flip@1": { th: [-762.392495483434, -927.5753307586147, -196.45879237456998, 0.9517963568463682], tw: 0.4729999999999957, ts: 0.4369999999999957, includeCatchHeading: true, clean: false },
	"bs-pop-shuvit": { th: [-67.25639296090661, -329.37078757699885, -863.5096911170293, 0.24609087281962616], tw: 0.44099999999999573, ts: 0.4369999999999957, clean: false, catchFraction: 0.81, includeCatchHeading: true },
	"bs-pop-shuvit@1": { th: [-69.53625376565135, -316.3668377634804, -932.2981330944554, 0.29273237315118017], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.76, includeCatchHeading: true },
	"bs-pop-shuvit@2": { th: [-77.983311004587, -355.47126966243314, -923.869465823324, 0.22049322910458238], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.81, includeCatchHeading: true },
	"fs-pop-shuvit": { th: [83.38759557418801, 385.39316095905485, -904.7953926190326, 0.23816873098389243], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.71, includeCatchHeading: true },
	"fs-pop-shuvit@1": { th: [64.7361173725999, 320.9664311394209, -864.4442717596197, 0.29173026877191466], tw: 0.44099999999999573, ts: 0.4369999999999957, clean: false, catchFraction: 0.76, includeCatchHeading: true },
	"fs-pop-shuvit@2": { th: [109.96222457421746, 428.45962867589714, -937.3822429239757, 0.24752800228404725], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false, catchFraction: 0.71, includeCatchHeading: true },
	"hardflip": { th: [-855.6878072795355, -421.4064130709424, -668.761770421165, 1.2463529596348577], tw: 0.46099999999999575, ts: 0.4369999999999957, clean: false },
	"hardflip@1": { th: [-758.7733914282209, -395.6408364957247, -680.9874015323041, 1.5246738615371245], tw: 0.46499999999999575, ts: 0.4369999999999957, clean: false, includeCatchHeading: true },



	"varial-heelflip": { th: [883.6537581518198, 712.0561443222656, -145.71946380187202, 0.07349155303044996], tw: 0.44899999999999574, ts: 0.4369999999999957, includeCatchHeading: true, clean: false },
	"varial-heelflip@1": { th: [776.2215273314714, 633.3786300147653, -239.0871666867371, 0.19463133170811248], tw: 0.44899999999999574, ts: 0.4369999999999957, includeCatchHeading: true, clean: false },
	"varial-heelflip@2": { th: [947.3373808822295, 778.3025460804574, -169.4199799548785, 0.086660658119415], tw: 0.44899999999999574, ts: 0.4369999999999957, includeCatchHeading: true, clean: false },

};
const FIELDS = 17; // floats per sample: origin xyz, quaternion xyzw, rear spin, front spin, flex, lift, roll, yaw, pitch, rider x, rear and front hanger angle
const cache = new Map();
const recentAttempts = new Map();
const ATTEMPT_CACHE_LIMIT = 8;

// Replays of a trick are not all the same height: the rider's jump speed is varied by these
// amounts (m/s) on successive replays, in this fixed order, so nothing is random. Each variant
// has its own solved burst; a trick only offers the variants that were found to land.
// Baked against the same Ollie contact model as the normal runs.
const HIGH_OLLIE = { jump: 2.8, burst: { th: [0.008897155709900982, 0.010794893418799217, -625.0402998592353, 0.12160866766194826], tw: 0.4369999999999957, ts: 0.4369999999999957, clean: false } };
const JUMP_VARIANTS = [0, 0.2, -0.12];
// How the rider holds the board on the way down in each variant, as a slope along the travel
// (rise per metre): positive lands the trailing wheels first, negative the leading wheels.
const LAND_LEAN = [0.09, 0, -0.065]; // about 5° tail-end first, flat, about 3.7° nose-end first
// How the rider holds the board to one side on the way down in each run, as a slope across the deck
// (rise per metre; 0.05 is about 3 degrees). Each run has its own: its direction is the way that run's
// deck leans on its trucks after landing anyway, and its size was chosen by hand, small, with some
// runs left level. Without it the higher jumps, which have no tilt along the travel, came down
// motionless. A variation has the lean of its trick's normal jump.
const LAND_SIDE = {
	"kickflip": 0.04, "kickflip@1": 0.01, "kickflip@2": 0.03, "heelflip": -0.03,
	"heelflip@1": -0.05, "heelflip@2": 0, "bs-pop-shuvit": 0.05, "bs-pop-shuvit@1": 0.02,
	"bs-pop-shuvit@2": 0.04, "fs-pop-shuvit": -0.04, "fs-pop-shuvit@1": -0.06, "fs-pop-shuvit@2": -0.01,
	"varial-kickflip": 0.02, "varial-kickflip@1": 0.03, "varial-kickflip@2": 0.05, "varial-heelflip": -0.01,
	"varial-heelflip@1": -0.03, "varial-heelflip@2": 0, "360-flip": -0.04, "360-flip@1": 0.01,
	"hardflip": 0.03, "hardflip@1": 0.05, "inward-heelflip": 0.04, "inward-heelflip@1": -0.02,
	"double-kickflip": 0.02, "double-kickflip@1": 0.05, "double-kickflip@2": 0, "double-heelflip": -0.04,
	"double-heelflip@1": 0, "double-heelflip@2": -0.03, "impossible": 0, "impossible@1": 0.03
};
const SOLVE_VARIANTS = false; // set to true only to regenerate the stored variants

// which variants of a trick can be played, as indices into JUMP_VARIANTS
export function variants(trick) {
	return JUMP_VARIANTS.map((_, i) => i).filter((i) => i === 0 || SOLVED[`${trick.id}@${i}`]);
}

// Simulates the trick (once) and returns its recording and timings.
export function timing(trick, variant = 0, att = null) {
	const variantKey = variant ? `${trick.id}@${variant}` : trick.id;
	const key = variantKey + (att ? `#${att.n}` : "");
	const recordings = att ? recentAttempts : cache;
	if (recordings.has(key)) {
		const saved = recordings.get(key);
		if (att) {
			recordings.delete(key);
			recordings.set(key, saved);
		}
		return saved;
	}
	// A variant is the same trick with a slightly different jump. Variants are never solved while
	// the page is in use: one that has no stored burst, or whose stored burst does not land here,
	// simply falls back to the trick's normal jump.
	if (!att && variant && !SOLVED[key] && !SOLVE_VARIANTS) return timing(trick, 0);
	const inp = Object.assign({}, trick.input, { jump: trick.input.jump + JUMP_VARIANTS[variant], lean: LAND_LEAN[variant], side: LAND_SIDE[variant ? `${trick.id}@${variant}` : trick.id] || 0 });
	const tuned = (COUPLED.on && SOLVED_COUPLED[variantKey]) || SOLVED[variantKey];
	if (tuned) {
		if (tuned === SOLVED_COUPLED[variantKey] || trick.id === "360-pop-shuvit") inp.delay = tuned.tw - tuned.ts;
		inp.catch = tuned.catchFraction ?? inp.catch;
		inp.includeCatchHeading = tuned.includeCatchHeading;
	}
	if (att) {
		if (att.highOllie) inp.jump = HIGH_OLLIE.jump;
		else if (att.pop) inp.jump *= att.pop;
		inp.lean = att.lean ?? inp.lean;
		inp.side = att.side ?? inp.side;
		inp.footOffset = att.footOffset;
		inp.backDelay = att.backDelay;
		inp.catch += (att.late * G) / (2 * inp.jump); // an attempt: the feet come down a little early or late…
		inp.placeR = att.placeR; // …and each a little further in from its truck
		inp.placeF = att.placeF;
		inp.flexScale = 1; // its bend is drawn at the size it is calculated
		inp.legStiff = att.legStiff || 1;
		inp.from = att.from; // a combo's second or third trick: the state it starts from
		inp.handAt = att.handAt; // …and how soon after its landing this one is taken over by the next
	}
	const tc = APPROACH + (inp.catch * 2 * inp.jump) / G;
	// Run the trick with a given burst and judge the outcome. A run is accepted only if the
	// simulation itself shows all of this: the board arrived at the catch close to square, a wheel
	// touched the floor after the catch, and the run ended with both trucks on the floor, the
	// deck facing up and the board pointing along the travel.
	const runWith = (p, clean) => {
		cleanTorques = clean;
		const rec = [];
		const s = simulate(inp, p.th, undefined, rec);
		const [x, y, z, w] = s.q;
		const up = 1 - 2 * (x * x + z * z);
		let dh = Math.atan2(-2 * (x * z - w * y), 1 - 2 * (y * y + z * z)) - rad(inp.yaw || 0);
		dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
		const landed = s.tLand === s.tLand;
		const sound = landed && (!inp.cleanDeck || s.deckStrikeAfterPop === null) && s.riding && s.rolling && up > 0.99 && Math.abs(dh) < 0.35; // rider on it, on its wheels, rolling, pointing along the travel
		const ok = sound && p.miss < 0.25;
		return { p, rec, s, ok, sound, clean };
	};
	const attempt = (clean) => {
		cleanTorques = clean;
		return runWith(solveBurst(inp), clean);
	};
	// The solved burst for each trick is stored in SOLVED, so nothing normally has to be solved
	// while the page is in use. A stored burst is not trusted: its accuracy at the catch is
	// measured here, with the current simulation, and the run must pass the same test as any
	// other. If it does not (the model has changed, or this browser's arithmetic differs in the
	// last digits), the burst is solved afresh: first with the feet pushing at their places on
	// the deck, then, if that does not land, with plain torques.
	let run = null;
	if (att) {
		// An attempt is the trick's own burst with its strength changed a little, run once as it is:
		// nothing is solved again and nothing is corrected, and whatever comes out is what is shown.
		const th = Object.assign([...att.burst.th], { tw: att.burst.tw, ts: att.burst.ts });
		if (inp.wrap) th[2] *= att.flick; // the impossible has no flick or scoop: what carries it round varies
		if (inp.roll) th[0] *= att.flick;
		if (att.level !== undefined) th[2] *= att.level;
		if (inp.yaw) th[1] *= att.scoop;
		run = runWith({ th, miss: null, tw: att.burst.tw, tc, tStrike: att.burst.ts }, att.burst.clean);
	}
	const pre = !att && (tuned || SOLVED[key]);
	if (pre) {
		cleanTorques = pre.clean;
		const th = Object.assign([...pre.th], { tw: pre.tw, ts: pre.ts });
		run = runWith({ th, miss: norm(miss(inp, th, tc, 1)), tw: pre.tw, tc, tStrike: pre.ts }, pre.clean);
		if (!run.ok) run = null;
	}
	if (!run && !att && variant && !SOLVE_VARIANTS) return timing(trick, 0);
	if (!run) {
		run = attempt(false);
		if (!inp.wrap && !run.ok) {
			const other = attempt(true);
			if (other.ok || (!run.ok && other.p.miss < run.p.miss)) run = other;
		}
	}
	cleanTorques = false;
	if (!att && variant && !run.ok) return timing(trick, 0);
	const { p, rec, s } = run;
	p.clean = run.clean;
	let data = new Float32Array(rec);
	if (att) for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i])) { data = data.slice(0, Math.max(FIELDS, Math.floor(i / FIELDS) * FIELDS)); break; }
	// No landing is ever assumed. If no run passed, the best one is still shown, marked as not
	// landed, with no "Land" marker.
	const landed = (att ? run.sound : run.ok) && !s.broke; // an attempt is judged by its landing alone
	const touched = Number.isFinite(s.tLand); // a wheel reached the floor after the catch
	const down = touched ? s.tLand : att ? att.land : (data.length / FIELDS - 1) * DT * REC_EVERY;
	if (!landed && !att) console.warn(`Board Motion: "${trick.name}" did not land in this browser's simulation.`);
	const takeoff = s.tStrike === s.tStrike ? s.tStrike : p.tStrike;
	const count = data.length / FIELDS;
	let flexPeak = 0; // the deepest the deck is drawn bending in this run, m
	for (let i = 9; i < data.length; i += FIELDS) if (data[i] > flexPeak) flexPeak = data[i];
	// A landing on the rail: after the first wheel is down the deck stays tilted more than 25° for
	// longer than 60 ms. The board may still drop onto its wheels and roll away, so `landed` stays
	// as the simulation gave it; this says what the landing was.
	let railMs = 0;
	if (landed && touched) {
		for (let i = Math.round(down / (DT * REC_EVERY)) * FIELDS; i < data.length; i += FIELDS) {
			const qx = data[i + 3], qz = data[i + 5];
			if (1 - 2 * (qx * qx + qz * qz) < 0.9063) railMs += DT * REC_EVERY * 1000; // cos 25°
		}
	}
	const tm = {
		broke: !!s.broke,
		rail: railMs > 60,
		state: s.state, // how the run ended (see simulate): a combo carries it into its next trick
		handed: s.handed,
		tBreak: s.tBreak,
		contact: s.contact,
		catchMechanics: s.catchMechanics,
		floorImpact: s.floorImpact,
		wheelTouchdown: s.wheelTouchdown,
		deckStrikeAfterPop: s.deckStrikeAfterPop,
		flexPeak,
		data,
		count,
		recEnd: (count - 1) * DT * REC_EVERY, // end of the simulated part
		total: (count - 1) * DT * REC_EVERY + (landed ? COAST + ROLLOUT - (COUPLED.on ? COUPLED.rollout : ROLLOUT) : 0), // the same length either way
		popStart: s.tp,
		takeoff,
		landed,
		land: landed || att ? down : (count - 1) * DT * REC_EVERY, // first wheel contact after the catch
		airtime: Math.max(0, (s.floorImpact ?? (touched ? down : (count - 1) * DT * REC_EVERY)) - takeoff),
		touched,
		attempt: att ? { n: att.n, pop: att.pop, highOllie: !!att.highOllie, level: att.level, backDelay: att.backDelay, footOffset: att.footOffset, flick: inp.roll || inp.wrap ? att.flick : 1, scoop: inp.yaw ? att.scoop : 1, late: att.late, placeR: att.placeR, placeF: att.placeF, legs: att.legStiff || 1, together: !!att.together, roll: !!inp.roll, yaw: !!inp.yaw, wrap: !!inp.wrap } : null,
		flexScale: att ? 1 : COUPLED.on ? COUPLED.deckShow : 1, // how much larger than calculated the recorded bend is
		apex: REST_Y + s.apex,
		endOverEnd: !!inp.wrap,
		catch: p.tc, // scheduled descent, used by the playback ramp
		clean: !!p.clean, // true if the burst had to be applied as plain torques
		burst: { th: Array.from(p.th), tw: p.tw, ts: p.tStrike, clean: !!p.clean }, // what SOLVED stores
		jump: inp.jump, // the rider's jump speed in this run (it differs between variants)
		solved: p.miss, // how far the board was from square at the catch, measured in this run (rad / scaled m)
		markers: [
			{ t: s.tp, label: "Pop" },
			{ t: Math.max(p.tw, s.tp + 0.012), label: inp.wrap ? "Wrap" : inp.yaw && inp.roll ? "Flick + Scoop" : inp.riderTurn === inp.yaw && inp.riderTurn ? "Turn" : inp.yaw ? "Scoop" : inp.roll ? "Flick" : "Level" }
		]
	};
	if (s.contact !== null) tm.markers.push({ t: s.contact, label: "Catch" });
	if (!landed && s.floorImpact !== null) tm.markers.push({ t: s.floorImpact, label: "Impact" });
	if (landed) tm.markers.push({ t: s.tLand, label: "Land" });
	else if (s.broke) tm.markers.push({ t: s.tBreak, label: "Break" });
	else if (att && touched && s.floorImpact === null) tm.markers.push({ t: s.tLand, label: "Down" });
	tm.markers.sort((a, b) => a.t - b.t);
	recordings.set(key, tm);
	if (att && recordings.size > ATTEMPT_CACHE_LIMIT) recordings.delete(recordings.keys().next().value);
	return tm;
}

/* ---------- attempts ---------- */

// How far an attempt's inputs may differ from the trick as solved: the strength of the flick and
// of the scoop (as a share), and when the feet come back down on the deck (s, early or late).
// A trick is only varied in what it uses: the flick where the board flips, the scoop where it
// spins, and for the impossible the push that carries it round. That push is a foot carrying the
// board, not a flick, and the trick forgives much more of it: it is given a wider range (`wrap`),
// the smallest tried at which the trick is sometimes missed.
// `place`: how far in from its usual place over the truck each foot may come down, m, toward the
// middle of the deck. The solved runs always land with both feet 8 mm inside the truck bolts,
// where a deck hardly bends; a foot a few centimetres further in loads the span between the
// trucks, so the bend of a variation comes from where its feet landed. It is drawn at its
// calculated size, as the solved runs' bend now is too (see COUPLED.deckShow).
// (The ranges were narrower at first: 4% for the flick and the scoop, 12% for the hooked push and
// 12 ms for the feet. A trick could then be played many times without one miss.)
// `place` was 0.03 at first, which bent the deck 2 to 4 mm at most: real, but hard to see. At
// 0.08 a foot can land well between the trucks (a stance up to 16 cm narrower than the one the
// rider stood in), and the deck then bends 4 to 9 mm on the hardest of those landings.
// `near`: how strongly the feet favour their usual place over the bolts. A rider mostly lands
// there and only now and then well inside, so the distance in is not spread evenly: it is the
// even share raised to this power (1 would be even; higher keeps more landings near the bolts).
export const BIGSPIN = { slow: 0.045, early: 0.004, lead: 0.01 }; // how the last quarter of the Bigspin's turn is paced after the catch (see simulate)
export const ATTEMPT = { flick: 0.06, scoop: 0.05, wrap: 0.16, feet: 0.016, place: 0.08, near: 3, stiff: 2.5, middle: 0.17, firm: 0.6, hard: 0.6, popOllie: 0.2, pop: 0.085, popTurn: 0.06, offOllie: 0, feetOllie: 0.035, level: 0.3, levelOff: 0.45,
	hardOllie: 0.3, off: 0.5, offFlip: 0.3, offEasy: 0.2, offHard: 0.85, offNear: 0.05, offFar: 0.16, flickBig: 0.2, scoopBig: 0.08, popBig: 0.03, feetBig: 0.03, levelBig: 0.6 };
// `hard`: the share of variations that are not a hard landing. In the rest (and of those, the half
// with stiff legs: about one variation in 20) both feet come down together at the middle of the deck,
// `middle` in from the trucks or further, with the legs held stiffer than usual, by `firm` at least and
// `stiff` at most. Only such a landing can break the deck. (At first a quarter of all variations
// brought the feet together, most of them with ordinary legs: one landing in ten then bowed the deck
// by 10 to 23 mm and sprang back, which looked like rubber.)

// Three numbers between -1 and 1 for attempt `n` of a trick. They come from the trick and the
// number alone, so attempt 7 of a kickflip is the same attempt every time.
function attemptNumbers(index, n) {
	let a = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(n, 0x85ebca6b)) >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	};
	return [next(), next(), next(), next(), next(), next(), next(), next(), next(), next(), next(), next()]; // (the twelfth was added later: the first eleven are as they were)
}

// Attempt `n` (1, 2, 3…) of a trick: one of its solved runs with the flick, the scoop and the
// timing of the feet each changed by a small amount, then simulated like any other run. Whether
// it lands is whatever the simulation gives.
export function attempt(trick, n) {
	const { variant, att } = attemptInputs(trick, n);
	return timing(trick, variant, att);
}

// What attempt `n` of a trick changes: the jump height it starts from, and the inputs handed to
// `timing`. (Split from `attempt` so a combo can give the same kind of inputs to each of its tricks.)
function attemptInputs(trick, n) {
	const [a, b, c, d, e, f, g, h, i, j, k, m] = attemptNumbers(TRICKS.indexOf(trick), n);
	const list = variants(trick);
	const base = timing(trick, list[Math.floor((h + 1) * 0.5 * list.length)]); // sample the available jump heights per attempt
	let variant = 0;
	JUMP_VARIANTS.forEach((d, i) => {
		if (Math.abs(trick.input.jump + d - base.jump) < 1e-9) variant = i;
	});

	// two further numbers. In a few variations both feet come down together at the middle with the
	// legs held stiff (see ATTEMPT.hard). The rest are as they were.
	const ollie = trick.id === "ollie";
	const hardThreshold = ollie ? ATTEMPT.hardOllie : ATTEMPT.hard;
	const hard = g > hardThreshold && f > 0;
	const together = hard ? ATTEMPT.middle + (0.2 - ATTEMPT.middle) * ((g - hardThreshold) / (1 - hardThreshold)) : 0;
	const legStiff = hard ? 1 + ATTEMPT.firm + (ATTEMPT.stiff - ATTEMPT.firm) * f : 1 + 0.22 * k;
	const strength = trick.input.wrap ? ATTEMPT.wrap : ATTEMPT.flick; // how far the flick, or the hooked push, may differ
	const highOllie = ollie && i > 0.55 && !hard;
	// On the Ollie itself, practice different front-foot pressure and a slightly
	// wider or narrower landing stance. Keep the extreme flex attempts separate.
	const placeR = together || (ollie ? 0.015 + d * 0.04 : ATTEMPT.place * ((d + 1) / 2) ** ATTEMPT.near);
	const placeF = together || (ollie ? 0.015 + e * 0.04 : ATTEMPT.place * ((e + 1) / 2) ** ATTEMPT.near);
	// Try occasional late, offset catches, plus smaller biases on ordinary attempts.
	// How rare an off-centre catch is depends on what else can go wrong. A trick that flips and
	// spins at once already misses often on its own rotations; an Ollie, or a trick the feet carry
	// round, has little else to miss by, so more of its attempts come down to one side.
	const ti = trick.input;
	const combined = ti.roll && ti.yaw && !ti.catchYaw;
	const carried = ti.catchYaw || (ti.riderTurn && ti.riderTurn === ti.yaw);
	const offAt = ollie ? ATTEMPT.offOllie : combined ? ATTEMPT.offHard : carried ? ATTEMPT.offEasy : ti.roll ? ATTEMPT.offFlip : ATTEMPT.off;
	const offCentre = !hard && j > offAt;
	// (On the Ollie an off-centre catch is well to one side: up to about 100 mm the shoe is
	// still half on the deck and the landing can be saved; beyond that it is not. 50 to 140 mm.)
	const footOffset = offCentre ? (k < 0 ? -1 : 1) * (ATTEMPT.offNear + (ATTEMPT.offFar - ATTEMPT.offNear) * ((j - offAt) / (1 - offAt))) : 0.026 * k;
	// How hard the rider jumps, as a share of the trick's own jump. The burst stays the one solved
	// for that jump, so a harder or softer pop also leaves the board a little over or under its
	// rotation when the feet come back: the more a trick turns, the less room it has.
	const turns = trick.input.roll || (trick.input.yaw && trick.input.riderTurn !== trick.input.yaw);
	// Most attempts are a little off; now and then one is badly off. `big` is small for most of its
	// range and reaches 1 only near the ends, so a share of the attempts gets a real mistake: a flick
	// that turns the board half over, a scoop that leaves it sideways, feet that arrive much too late.
	// Without it every attempt was a small change on the same landing.
	const big = (x) => (combined ? 0 : x * x * x * x * x); // (not on the combined tricks: they need no help to miss)
	const pop = 1 + (ollie ? ATTEMPT.popOllie : turns ? ATTEMPT.popTurn : ATTEMPT.pop) * m + (turns ? ATTEMPT.popBig : 0) * big(m);
	const late = (ollie ? ATTEMPT.feetOllie : ATTEMPT.feet) * c + ATTEMPT.feetBig * big(c) + (offCentre ? 0.022 : 0);
	const backDelay = offCentre ? 0.018 + 0.016 * j : 0.008 * Math.max(0, j);
	const lean = 0.14 * d;
	const side = 0.095 * e;
	return { variant: highOllie ? 0 : variant, att: {
		n, flick: 1 + strength * a + ATTEMPT.flickBig * big(a), scoop: 1 + ATTEMPT.scoop * b + ATTEMPT.scoopBig * big(b),
		late, placeR, placeF, legStiff, footOffset, backDelay, lean, side, together: together > 0, pop: highOllie ? 1 : pop,
		highOllie, level: ollie ? 1 + (offCentre ? ATTEMPT.levelOff : ATTEMPT.level) * a + ATTEMPT.levelBig * big(a) : undefined,
		burst: highOllie ? HIGH_OLLIE.burst : base.burst, land: base.land
	} };
}

/* ---------- combos ---------- */

// A combo is two or three tricks in one run. Each trick after the first is simulated from the
// state the one before it left: the board's speed and heading as they really were after that
// landing, its lean, the trucks, where the rider is. Nothing is joined or blended. The tricks keep
// the bursts they were solved with for a standing roll, so how the second one goes depends on how
// the first one landed, and a miss or a broken deck ends the combo there.
//   three : the share of combos that have three tricks; the rest have two
//   clean : the share of combos in which every trick is given its clean inputs (those can be perfect)
//   mixed : in the others, the share of tricks that still get clean inputs; the rest get the
//           inputs of one of the trick's own variations
//   quick, slow : the next trick takes the board over between this long and this long after the
//           landing, s. Its own run-up of 0.4 s follows, so the pop comes 0.5 to 0.9 s after the
//           landing. A quick one finds the board less settled.
export const COMBO = { three: 0.6, clean: 0.3, mixed: 0.5, quick: 0.1, slow: 0.5 };

// The state a trick hands on, made ready for the next one. The feet step back to the middle of
// the board, as a rider's do between tricks. If the board came to rest pointing backwards (after
// a shuvit or a 180) it is taken as it rolls: the end that now trails is popped, as a skater
// would. The model's nose and tail are not quite the same shape, so that is an approximation.
// `turned` says the board is the other way round from how the simulation now names its ends, so
// that it can still be drawn the right way round.
function relay(st) {
	const o = { ...st };
	const { qx, qy, qz, qw } = st;
	const turned = 1 - 2 * (qy * qy + qz * qz) < 0; // the long axis points back along the travel
	if (turned) {
		// the same board, named from its other end: a half turn about its own vertical
		o.qx = -qz; o.qy = qw; o.qz = qx; o.qw = -qy;
		o.wx = -st.wx; o.wz = -st.wz;
		o.th0 = st.th1; o.th1 = st.th0; o.om0 = st.om1; o.om1 = st.om0;
		o.spinR = -st.spinF; o.spinF = -st.spinR; o.wR = -st.wF; o.wF = -st.wR;
		o.rearOnFloor = st.frontOnFloor; o.frontOnFloor = st.rearOnFloor;
	}
	o.feetX = o.cx - o.xr;
	o.feetZ = o.cz;
	return { state: o, turned };
}

const combos = new Map();
const COMBO_CACHE_LIMIT = 6;

// Combo `n` (1, 2, 3…) that opens with `first`. Which tricks follow, how many, and what each is
// given are fixed by the number; how it goes is whatever the simulation gives.
export function combo(first, n) {
	const key = `${first.id}#${n}`;
	if (combos.has(key)) return combos.get(key);
	const r = attemptNumbers(TRICKS.indexOf(first) + 1000, n);
	const count = (r[0] + 1) / 2 < COMBO.three ? 3 : 2;
	const allClean = (r[1] + 1) / 2 < COMBO.clean;
	const real = TRICKS.filter((t) => !t.id.startsWith("extra-")); // the invented trick only opens a combo
	const order = [first];
	for (let k = 1; k < count; k++) {
		const pool = real.filter((t) => t !== order[k - 1]);
		order.push(pool[Math.floor(((r[1 + k] + 1) / 2) * pool.length) % pool.length]);
	}
	const segments = [];
	let from = null, t0 = 0, flip = false;
	for (let k = 0; k < count; k++) {
		const trick = order[k];
		const clean = allClean || (r[4 + k] + 1) / 2 < COMBO.mixed;
		const base = timing(trick, 0);
		const given = clean
			? { variant: 0, att: { flick: 1, scoop: 1, late: 0, placeR: 0, placeF: 0, legStiff: 1, footOffset: 0, backDelay: 0, together: false, highOllie: false, pop: 1, burst: base.burst, land: base.land } }
			: attemptInputs(trick, 500 + n * 3 + k);
		const handAt = k < count - 1 ? COMBO.quick + (COMBO.slow - COMBO.quick) * ((r[7 + k] + 1) / 2) : undefined;
		const tm = timing(trick, given.variant, { ...given.att, n: `combo ${first.id} ${n}.${k}`, from, handAt });
		segments.push({ trick, tm, t0, flip, clean });
		if (!tm.landed || tm.broke || k === count - 1) break;
		const hand = tm.handed || { t: tm.recEnd, state: tm.state };
		const next = relay(hand.state);
		from = next.state;
		if (next.turned) flip = !flip;
		t0 += hand.t; // the next trick starts at the moment it took the board over
	}
	const last = segments[segments.length - 1];
	const at = (seg, t) => (t === null || t === undefined || t !== t ? t : seg.t0 + t);
	const made = segments.length === count && last.tm.landed && !last.tm.broke;
	const out = {
		combo: true,
		segments,
		planned: order,
		count: last.tm.count,
		total: last.t0 + last.tm.total,
		recEnd: last.t0 + last.tm.recEnd,
		landed: made,
		broke: last.tm.broke,
		tBreak: at(last, last.tm.tBreak),
		rail: segments.some((g) => g.tm.rail),
		touched: last.tm.touched,
		floorImpact: at(last, last.tm.floorImpact),
		contact: at(last, last.tm.contact),
		wheelTouchdown: last.tm.wheelTouchdown && { ...last.tm.wheelTouchdown, time: last.t0 + last.tm.wheelTouchdown.time },
		popStart: segments[0].tm.popStart,
		takeoff: segments[0].tm.takeoff,
		catch: segments[0].tm.catch,
		airtime: segments[0].tm.airtime,
		land: last.t0 + last.tm.land,
		apex: Math.max(...segments.map((g) => g.tm.apex)),
		flexPeak: Math.max(...segments.map((g) => g.tm.flexPeak)),
		flexScale: 1,
		endOverEnd: false,
		markers: segments.flatMap((g, k) => g.tm.markers.map((m) => ({ t: g.t0 + m.t, label: m.label === "Land" || m.label === "Catch" || m.label === "Pop" ? m.label : m.label, part: k }))),
		attempt: { n, combo: true }
	};
	combos.set(key, out);
	if (combos.size > COMBO_CACHE_LIMIT) combos.delete(combos.keys().next().value);
	return out;
}

// the part of a combo that is playing at time t
export function comboPart(tm, t) {
	let k = tm.segments.length - 1;
	while (k > 0 && t < tm.segments[k].t0) k--;
	return tm.segments[k];
}

const _half = new THREE.Matrix4().makeRotationY(Math.PI);

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/**
 * Board pose at time t (seconds), read from the recording. Writes the board matrix into
 * out.matrix and returns helper values for the camera, wheels, deck and readout.
 */
export function evaluate(trick, tm, t, out = { matrix: new THREE.Matrix4() }) {
	if (tm.segments) {
		const g = comboPart(tm, t);
		evaluate(g.trick, g.tm, t - g.t0, out);
		out.trick = g.trick; // the trick this part of the combo is
		if (g.flip) {
			// the board rolls the other way round from how the simulation names its ends: drawn as it is
			out.matrix.multiply(_half);
			[out.wheelRear, out.wheelFront] = [-out.wheelFront, -out.wheelRear];
			[out.truckRear, out.truckFront] = [out.truckFront, out.truckRear];
		}
		return out;
	}
	out.trick = trick;
	const d = tm.data;
	const f = clamp(t / (DT * REC_EVERY), 0, tm.count - 1);
	const i = Math.max(0, Math.min(tm.count - 2, Math.floor(f)));
	const k = f - i;
	const a = i * FIELDS;
	const b = Math.min((tm.count - 1) * FIELDS, a + FIELDS);
	const mix = (j) => d[a + j] + (d[b + j] - d[a + j]) * k;
	_p.set(mix(0), mix(1), mix(2));
	// neighbouring samples are a fraction of a degree apart, so a normalised blend is exact enough
	const sign = d[a + 3] * d[b + 3] + d[a + 4] * d[b + 4] + d[a + 5] * d[b + 5] + d[a + 6] * d[b + 6] < 0 ? -1 : 1;
	_q.set(d[a + 3] + (sign * d[b + 3] - d[a + 3]) * k, d[a + 4] + (sign * d[b + 4] - d[a + 4]) * k, d[a + 5] + (sign * d[b + 5] - d[a + 5]) * k, d[a + 6] + (sign * d[b + 6] - d[a + 6]) * k).normalize();
	out.wheelRear = mix(7);
	out.wheelFront = mix(8);
	out.x = mix(14); // where the rider is along the travel
	// Past the end of the simulated part the board is simply rolling: carry it on at the speed it
	// had, slowing a little with the wheels' rolling resistance.
	const over = t - tm.recEnd;
	if (over > 0 && tm.landed && tm.count > 25) {
		const e = (tm.count - 1) * FIELDS;
		const p = e - 25 * FIELDS;
		const k2 = over / (25 * DT * REC_EVERY);
		const vxEnd = (d[e] - d[p]) / (25 * DT * REC_EVERY);
		const slow = Math.min(0.5 * CRR * G * over * over, Math.abs(vxEnd) * over * 0.5) * Math.sign(vxEnd);
		const coast = (d[e] - d[p]) * k2; // distance at the final speed, before the slowing
		_p.x += coast - slow;
		_p.z += (d[e + 2] - d[p + 2]) * k2;
		// the wheels roll without slipping, so they turn for the distance actually covered
		const rolled = coast ? (coast - slow) / coast : 1;
		out.wheelRear += (d[e + 7] - d[p + 7]) * k2 * rolled;
		out.wheelFront += (d[e + 8] - d[p + 8]) * k2 * rolled;
		out.x += (d[e + 14] - d[p + 14]) * k2 - slow;
	}
	out.matrix.compose(_p, _q, _s);
	out.flex = mix(9);
	out.lift = Math.max(0, mix(10));
	out.roll = mix(11);
	out.yaw = mix(12);
	out.pitch = mix(13);
	out.truckRear = mix(15); // hanger angles about their pivots (zero unless the coupled model is on)
	out.truckFront = mix(16);
	return out;
}

// "Ramp" playback. Real time for the approach; the pop at 0.4×, slow enough to be seen (at
// real speed it lasts about two screen frames) but still a snap; deep slow motion from the tail
// strike through the flight; and back to real time by the catch, so the fall and the landing
// are seen at the speed gravity gives them.
// The board gathers pace again over the last tenth of a second of the flight, and is at real speed
// at the catch. (It used to start gathering pace at the catch and take until 0.09 s after it. The
// fall from the catch to the floor lasts about 0.15 s, so more than half of it was shown slower
// than real, and on screen it lasted over twice as long as it does. A run in which the deck breaks
// also slowed a second time for the break, and was hardly at real speed at all in between.)
const RAMP_POP = 0.4;
const RAMP_FLIGHT = 0.09;
const RAMP_EASE = 0.1; // s over which the board gathers pace again, ending where real speed is back
const RAMP_OWN = { start: 0, end: 0 };
const blend = (a, b, k) => a + (b - a) * k;
// `own` is the Custom speed: Ramp with the slow motion where the viewer puts it, as { start, end } in
// seconds after the takeoff and after the catch. Custom is at real speed up to its first mark (it
// does not slow the pop) and its slow motion is exactly 1/10, so that what its two marks say is true.
export function rampSpeed(tm, t, own) {
	if (tm.segments) {
		// A combo. Custom is one slow zone, wherever its two marks stand on the combo's timeline: a
		// tenth of real speed between them, whatever is happening there, and real speed outside.
		if (own) {
			const S = tm.takeoff + own.start, E = tm.catch + own.end;
			if (t >= E) return 1;
			const slow = blend(1, 0.1, sstep(S, S + 0.015, t));
			return slow * Math.pow(1 / slow, sstep(E - RAMP_EASE, E, t));
		}
		// Ramp slows each trick's own flight.
		const g = comboPart(tm, t);
		return rampSpeed(g.tm, t - g.t0);
	}
	const R = own || RAMP_OWN;
	const S = tm.takeoff + R.start, E = tm.catch + R.end;
	if (t >= E) return 1;
	const pre = own ? 1 : blend(1, RAMP_POP, sstep(tm.popStart - 0.04, tm.popStart, t));
	const flight = blend(pre, own ? 0.1 : RAMP_FLIGHT, sstep(S, S + 0.015, t));
	return flight * Math.pow(1 / flight, sstep(E - RAMP_EASE, E, t));
}

// A landing meant to break the deck: both feet come down together at the middle of the
// deck, on legs held stiffer than usual. The flight is the solved one. The legs are stiffened step
// by step and the first run in which the deck breaks is returned (null if none does).
export function breakRun(trick, selected = null) {
	if (!COUPLED.on) return null;
	const list = selected ? [selected.variant] : variants(trick);
	for (const legs of selected ? [selected.legs] : [1, 2, 3, 4, 5, 6, 8]) {
		for (const v of list) {
			const base = timing(trick, v);
			const tm = timing(trick, v, { n: `break${legs}`, flick: 1, scoop: 1, late: 0, placeR: 0.2, placeF: 0.2, legStiff: legs, burst: base.burst, land: base.land });
			if (tm.broke) {
				tm.legs = legs;
				tm.variant = v;
				return tm;
			}
		}
	}
	return null;
}
