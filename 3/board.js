// Procedural skateboard built to real dimensions (metres): 32" x 8.25" popsicle deck,
// 14.25" wheelbase, 144 mm trucks, 54 mm wheels.
// Local frame: +X = nose, +Y = up (grip side), +Z = toe side (regular stance).
// Origin: deck top surface, midway between the trucks.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js";

export const DIM = {
	tailEnd: -0.4,
	noseEnd: 0.413,
	width: 0.2095,
	thickness: 0.0112,
	plateX: 0.208, // baseplate centre (bolt pattern centre)
	axleX: 0.214, // axle sits slightly outboard of the baseplate centre
	truckH: 0.053, // deck underside → axle centre
	wheelR: 0.027,
	wheelW: 0.031,
	wheelLip: 0.0062,
	wheelZ: 0.085,
	hangerHalf: 0.072,
	axleHalf: 0.1048
};
DIM.axleY = -(DIM.thickness + DIM.truckH);
DIM.groundOffset = DIM.thickness + DIM.truckH + DIM.wheelR; // deck top → ground at rest

// approximate centre of mass: trucks and wheels pull it below the deck
export const COM = new THREE.Vector3(0, -0.03, 0);

const deg = THREE.MathUtils.degToRad;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => {
	const t = clamp01((x - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/* ---------- deck shape ---------- */

const NOSE = { len: 0.166, pow: 2.35, kickStart: 0.243, angle: deg(21), radius: 0.085 };
const TAIL = { len: 0.152, pow: 2.55, kickStart: 0.241, angle: deg(19.5), radius: 0.085 };
const CONCAVE = 0.0062;

function halfWidth(x) {
	const W = DIM.width / 2;
	let d = 0;
	let p = 2;
	if (x > DIM.noseEnd - NOSE.len) {
		d = (x - (DIM.noseEnd - NOSE.len)) / NOSE.len;
		p = NOSE.pow;
	} else if (x < DIM.tailEnd + TAIL.len) {
		d = (DIM.tailEnd + TAIL.len - x) / TAIL.len;
		p = TAIL.pow;
	}
	if (d <= 0) return W;
	return W * Math.pow(1 - Math.pow(Math.min(1, d), p), 1 / p);
}

// kick: a circular-ish blend into a straight ramp
function kick(x) {
	const k = x >= 0 ? NOSE : TAIL;
	const d = Math.abs(x) - k.kickStart;
	if (d <= 0) return { y: 0, blend: 0 };
	const tan = Math.tan(k.angle);
	const y = d < k.radius ? (tan * d * d) / (2 * k.radius) : tan * (d - k.radius / 2);
	return { y, blend: clamp01(d / 0.1) };
}

// top surface height field: kick along the length + concave across the width
function heightAt(x, z) {
	const k = kick(x);
	const r = Math.min(1, Math.abs(z) / (DIM.width / 2));
	return k.y + CONCAVE * Math.pow(r, 2.2) * (1 - 0.5 * k.blend);
}

function topPoint(x, zn, out) {
	const z = zn * halfWidth(x);
	return out.set(x, heightAt(x, z), z);
}

function topNormal(x, zn, out) {
	const e = 0.0005;
	const z = zn * halfWidth(x);
	const dydx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
	const dydz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
	return out.set(-dydx, 1, -dydz).normalize();
}

/* ---------- geometry helpers ---------- */

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = new THREE.Vector3(0, 1, 0);

// move a geometry in place: position + optional euler rotation
function at(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
	_m4.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
	return geo.applyMatrix4(_m4);
}

// capped cylinder/cone running from point a to point b
function rod(a, b, ra, rb = ra, seg = 20) {
	const dir = new THREE.Vector3().subVectors(b, a);
	const len = dir.length();
	const geo = new THREE.CylinderGeometry(rb, ra, len, seg);
	_m4.compose(a.clone().add(b).multiplyScalar(0.5), _q.setFromUnitVectors(Y, dir.normalize()), new THREE.Vector3(1, 1, 1));
	return geo.applyMatrix4(_m4);
}

// merge geometries into one; `groups` = array of geometry lists, one draw group per list
function merge(groups) {
	const sources = groups.flat();
	let vertices = 0, elements = 0;
	for (const geo of sources) {
		vertices += geo.attributes.position.count;
		elements += geo.index?.count ?? geo.attributes.position.count;
	}
	const pos = new Float32Array(vertices * 3);
	const nor = new Float32Array(vertices * 3);
	const uv = new Float32Array(vertices * 2);
	const indices = vertices > 65536 ? new Uint32Array(elements) : new Uint16Array(elements);
	const out = new THREE.BufferGeometry();
	let v = 0, e = 0;
	groups.forEach((list, group) => {
		const start = e;
		for (const geo of list) {
			const attr = geo.attributes;
			const count = attr.position.count;
			pos.set(attr.position.array, v * 3);
			nor.set(attr.normal.array, v * 3);
			if (attr.uv) uv.set(attr.uv.array, v * 2);
			const index = geo.index?.array;
			const length = index?.length ?? count;
			for (let i = 0; i < length; i++) indices[e++] = v + (index ? index[i] : i);
			v += count;
		}
		if (groups.length > 1) out.addGroup(start, e - start, group);
	});
	out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
	out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
	out.setIndex(new THREE.BufferAttribute(indices, 1));
	return out;
}

/* ---------- canvas textures ---------- */

function makeCanvas(w, h) {
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	return c;
}

function mulberry(seed) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function gripTexture() {
	const size = 256;
	const c = makeCanvas(size, size);
	const g = c.getContext("2d");
	const img = g.createImageData(size, size);
	const rnd = mulberry(7);
	for (let i = 0; i < size * size; i++) {
		const r = rnd();
		let v = 30 + r * 20;
		if (r > 0.975) v = 95 + rnd() * 70; // silicon carbide glints
		img.data[i * 4] = v;
		img.data[i * 4 + 1] = v;
		img.data[i * 4 + 2] = v + 1;
		img.data[i * 4 + 3] = 255;
	}
	g.putImageData(img, 0, 0);
	const map = new THREE.CanvasTexture(c);
	map.colorSpace = THREE.SRGBColorSpace;
	map.wrapS = map.wrapT = THREE.RepeatWrapping;
	map.anisotropy = 4;
	return map;
}

// 7-ply maple edge: v runs top (0) → bottom (1), u runs along the rail
function plyTexture() {
	const w = 256;
	const h = 64;
	const c = makeCanvas(w, h);
	const g = c.getContext("2d");
	const plies = ["#e6cc9f", "#dcc08f", "#b24a2e", "#e2c696", "#d8b884", "#2f2c29", "#e4c99b"];
	const ph = h / plies.length;
	const rnd = mulberry(3);
	plies.forEach((col, i) => {
		g.fillStyle = col;
		g.fillRect(0, i * ph, w, ph + 1);
		for (let k = 0; k < 14; k++) {
			g.fillStyle = `rgba(90,55,20,${0.05 + rnd() * 0.07})`;
			g.fillRect(rnd() * w, i * ph + rnd() * ph, 20 + rnd() * 90, 1);
		}
		g.fillStyle = "rgba(70,40,15,0.5)";
		g.fillRect(0, i * ph, w, 1);
	});
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.wrapS = THREE.RepeatWrapping;
	t.anisotropy = 4;
	return t;
}

// Underside graphic: the supplied artwork (deck-graphic.webp, next to this file), drawn upright
// across the deck and along its whole length. Until the image loads, or if it cannot be loaded,
// the deck shows plain maple.
const GRAPHIC_URL = new URL("./deck-graphic.webp", import.meta.url).href;

function graphicTexture(onReady) {
	const W = 2048;
	const H = 528;
	const c = makeCanvas(W, H);
	const g = c.getContext("2d", { willReadFrequently: true });
	const rnd = mulberry(11);
	g.fillStyle = "#e3cda3";
	g.fillRect(0, 0, W, H);
	for (let i = 0; i < 300; i++) {
		const y = rnd() * H;
		g.strokeStyle = `rgba(120,78,35,${0.03 + rnd() * 0.07})`;
		g.lineWidth = 0.6 + rnd() * 1.4;
		g.beginPath();
		g.moveTo(0, y);
		for (let x = 0; x <= W; x += 128) g.lineTo(x, y + Math.sin(x * 0.004 + i) * 3 + (rnd() - 0.5) * 2);
		g.stroke();
	}
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;

	const img = new Image();
	img.crossOrigin = "anonymous";
	img.onload = () => {
		const k = W / img.width; // image pixels → canvas pixels, if it is made as long as the deck
		const h = img.height * k;
		if (h >= H) {
			// Wide artwork: it runs the whole length of the deck. What does not fit across the width
			// is cropped, mostly from the bottom, so the top of the picture is kept.
			g.drawImage(img, 0, -(h - H) * 0.15, W, h);
		} else {
			// Narrower artwork: as wide as the deck, centred along it, with its background carried out
			// to the nose and tail by stretching the outermost columns.
			const k2 = H / img.height;
			const w = img.width * k2;
			const x0 = (W - w) / 2;
			g.drawImage(img, 0, 0, 2, img.height, 0, 0, x0 + 2, H);
			g.drawImage(img, img.width - 2, 0, 2, img.height, x0 + w - 2, 0, W - x0 - w + 2, H);
			g.drawImage(img, x0, 0, w, H);
		}
		tex.needsUpdate = true;
		if (onReady) onReady();
	};
	img.src = GRAPHIC_URL;
	return tex;
}

/* ---------- deck ---------- */

const RAIL_BULGE = 0.0026;

function buildDeck() {
	const NX = 96;
	const NZ = 16;
	const xs = [];
	for (let i = 0; i <= NX; i++) {
		const s = i / NX;
		const u = 0.5 - 0.5 * Math.cos(Math.PI * s); // denser at the nose and tail tips
		xs.push(DIM.tailEnd + (DIM.noseEnd - DIM.tailEnd) * THREE.MathUtils.lerp(s, u, 0.75));
	}
	const T = DIM.thickness;
	const L = DIM.noseEnd - DIM.tailEnd;
	const P = new THREE.Vector3();
	const N = new THREE.Vector3();
	const top = { pos: [], nor: [], uv: [] };
	const bot = { pos: [], nor: [], uv: [] };
	const row = NZ + 1;
	for (let i = 0; i <= NX; i++) {
		for (let j = 0; j <= NZ; j++) {
			const zn = -1 + (2 * j) / NZ;
			topPoint(xs[i], zn, P);
			topNormal(xs[i], zn, N);
			top.pos.push(P.x, P.y, P.z);
			top.nor.push(N.x, N.y, N.z);
			top.uv.push(P.x / 0.09, P.z / 0.09);
			bot.pos.push(P.x - N.x * T, P.y - N.y * T, P.z - N.z * T);
			bot.nor.push(-N.x, -N.y, -N.z);
			bot.uv.push((P.x - DIM.tailEnd) / L, 0.5 + P.z / DIM.width);
		}
	}
	const idxTop = [];
	const idxBot = [];
	for (let i = 0; i < NX; i++) {
		for (let j = 0; j < NZ; j++) {
			const a = i * row + j;
			const b = a + row;
			idxTop.push(a, a + 1, b, b, a + 1, b + 1);
			idxBot.push(a, b, a + 1, b, b + 1, a + 1);
		}
	}
	const mk = (s, idx) => {
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(s.pos, 3));
		geo.setAttribute("normal", new THREE.Float32BufferAttribute(s.nor, 3));
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(s.uv, 2));
		geo.setIndex(idx);
		return geo;
	};

	// rounded rail around the outline (toe side tail → nose, heel side nose → tail)
	const outline = [];
	for (let i = 0; i <= NX; i++) outline.push({ i, j: NZ });
	for (let i = NX - 1; i >= 1; i--) outline.push({ i, j: 0 });
	const K = 6;
	const rail = { pos: [], nor: [], uv: [] };
	const n = outline.length;
	const get = (o, arr) => {
		const k = (o.i * row + o.j) * 3;
		return new THREE.Vector3(arr[k], arr[k + 1], arr[k + 2]);
	};
	const midX = (DIM.tailEnd + DIM.noseEnd) / 2;
	let arc = 0;
	for (let m = 0; m <= n; m++) {
		const o = outline[m % n];
		const prev = outline[(m - 1 + n) % n];
		const next = outline[(m + 1) % n];
		const pt = get(o, top.pos);
		const pb = get(o, bot.pos);
		const tan = get(next, top.pos).sub(get(prev, top.pos));
		tan.y = 0;
		tan.normalize();
		const out = new THREE.Vector3(tan.z, 0, -tan.x);
		if (out.x * (pt.x - midX) + out.z * pt.z < 0) out.negate();
		if (m > 0) arc += pt.distanceTo(get(prev, top.pos));
		const vert = pt.clone().sub(pb).normalize();
		for (let k = 0; k <= K; k++) {
			const a = k / K;
			const bulge = Math.sin(Math.PI * a);
			const p = pt.clone().lerp(pb, a).addScaledVector(out, RAIL_BULGE * bulge);
			const nrm = out
				.clone()
				.multiplyScalar(bulge + 0.12)
				.addScaledVector(vert, Math.cos(Math.PI * a))
				.normalize();
			rail.pos.push(p.x, p.y, p.z);
			rail.nor.push(nrm.x, nrm.y, nrm.z);
			rail.uv.push(arc / 0.2, a);
		}
	}
	const idxRail = [];
	for (let m = 0; m < n; m++) {
		for (let k = 0; k < K; k++) {
			const a = m * (K + 1) + k;
			const b = a + K + 1;
			idxRail.push(a, a + 1, b, a + 1, b + 1, b);
		}
	}
	return { top: mk(top, idxTop), bottom: mk(bot, idxBot), rail: mk(rail, idxRail) };
}

/* ---------- trucks ---------- */

function roundedRect(w, h, r) {
	const s = new THREE.Shape();
	const x = -w / 2;
	const y = -h / 2;
	s.moveTo(x + r, y);
	s.lineTo(x + w - r, y);
	s.quadraticCurveTo(x + w, y, x + w, y + r);
	s.lineTo(x + w, y + h - r);
	s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	s.lineTo(x + r, y + h);
	s.quadraticCurveTo(x, y + h, x, y + h - r);
	s.lineTo(x, y + r);
	s.quadraticCurveTo(x, y, x + r, y);
	return s;
}

// The hanger turns about the line through the pivot cup and the yoke on the kingpin. A point on
// that line and its direction, in the truck's own frame (see truckParts): the same numbers the
// truck is drawn with, so a simulated articulation and the drawn one share one axis.
export const PIVOT = (() => {
	const yx = 0.004 + Math.sin(deg(42)) * 0.022, yy = -0.004 - Math.cos(deg(42)) * 0.022; // yoke centre on the kingpin
	const dx = yx + 0.027, dy = yy + 0.0085, l = Math.hypot(dx, dy); // from the cup at (-0.027, -0.0085)
	return { x: yx, y: yy, ux: dx / l, uy: dy / l };
})();

// Truck in its own frame: +x points to the deck centre (kingpin side), y = 0 is the deck
// underside, z runs along the axle. Returns geometry lists per material; the parts that turn
// with the hanger (yoke, hanger, pivot arm, axle and its nuts) are listed separately.
function truckParts() {
	const alu = [];
	const steel = [];
	const bushing = [];
	const hAlu = [];
	const hSteel = [];
	const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

	const A = V(-0.006, -DIM.truckH); // axle centre
	const kHead = V(0.004, -0.004); // kingpin seat in the baseplate
	const kDir = V(Math.sin(deg(42)), -Math.cos(deg(42))); // kingpin leans inward
	const onK = (d) => kHead.clone().addScaledVector(kDir, d);
	const yoke = onK(0.022);
	const e1 = yoke.clone().sub(A).normalize(); // hanger web direction (axle → yoke)
	const e2 = V(e1.y, -e1.x);
	const cup = V(-0.027, -0.0085); // pivot cup

	// baseplate
	const plate = new THREE.ExtrudeGeometry(roundedRect(0.078, 0.058, 0.007), {
		depth: 0.0042,
		bevelEnabled: true,
		bevelSize: 0.0008,
		bevelThickness: 0.0008,
		bevelSegments: 1,
		curveSegments: 4
	});
	plate.rotateX(Math.PI / 2);
	alu.push(at(plate, 0, -0.0008, 0));
	alu.push(rod(onK(-0.006), onK(0.008), 0.0165, 0.0135, 20)); // kingpin boss
	const pivAxis = cup.clone().sub(yoke).normalize();
	alu.push(rod(cup.clone().addScaledVector(pivAxis, -0.007), cup.clone().addScaledVector(pivAxis, 0.008), 0.0105, 0.0095, 18)); // pivot housing
	alu.push(at(new THREE.BoxGeometry(0.024, 0.01, 0.024), -0.027, -0.0085, 0));

	// kingpin stack
	steel.push(rod(onK(0), onK(0.0495), 0.0042, 0.0042, 10));
	bushing.push(rod(onK(0.008), onK(0.018), 0.0112, 0.0126, 20)); // boardside (cone)
	hAlu.push(rod(onK(0.0175), onK(0.0265), 0.0158, 0.0158, 24)); // hanger yoke
	bushing.push(rod(onK(0.026), onK(0.037), 0.0126, 0.0114, 20)); // roadside (barrel)
	steel.push(rod(onK(0.037), onK(0.0386), 0.0128, 0.0128, 20)); // cup washer
	steel.push(rod(onK(0.0386), onK(0.0456), 0.0078, 0.0078, 6)); // lock nut

	// hanger: lofted along the axle. Capsule cross-section that grows from the round axle
	// housing at the ends into the tall web under the yoke.
	const NS = 30;
	const half = 8;
	const ring = (half + 1) * 2;
	const pos = [];
	for (let s = 0; s <= NS; s++) {
		const z = THREE.MathUtils.lerp(-DIM.hangerHalf, DIM.hangerHalf, s / NS);
		const az = Math.abs(z);
		const h = 0.0335 * (1 - sstep(0.013, 0.061, az));
		const r = 0.0086 + 0.0022 * (1 - sstep(0, 0.05, az));
		for (let k = 0; k <= half; k++) {
			const phi = (k / half) * Math.PI; // upper half, lifted by h
			const p = A.clone()
				.addScaledVector(e2, r * Math.cos(phi))
				.addScaledVector(e1, r * Math.sin(phi) + h);
			pos.push(p.x, p.y, z);
		}
		for (let k = 0; k <= half; k++) {
			const phi = Math.PI + (k / half) * Math.PI; // lower half
			const p = A.clone()
				.addScaledVector(e2, r * Math.cos(phi))
				.addScaledVector(e1, r * Math.sin(phi));
			pos.push(p.x, p.y, z);
		}
	}
	const idx = [];
	for (let s = 0; s < NS; s++) {
		for (let k = 0; k < ring; k++) {
			const a = s * ring + k;
			const b = s * ring + ((k + 1) % ring);
			const c = a + ring;
			const d = b + ring;
			idx.push(a, c, b, b, c, d);
		}
	}
	const web = new THREE.BufferGeometry();
	web.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	web.setIndex(idx);
	web.computeVertexNormals();
	web.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
	hAlu.push(web);
	[-1, 1].forEach((s) => hAlu.push(rod(V(A.x, A.y, s * (DIM.hangerHalf - 0.006)), V(A.x, A.y, s * DIM.hangerHalf), 0.0088, 0.0088, 18)));

	// pivot arm into the cup
	hAlu.push(rod(A.clone().addScaledVector(e1, 0.03), cup, 0.0078, 0.0048, 14));

	// axle, speed washers, lock nuts
	hSteel.push(rod(V(A.x, A.y, -DIM.axleHalf), V(A.x, A.y, DIM.axleHalf), 0.004, 0.004, 10));
	[-1, 1].forEach((s) => {
		const z = (d) => V(A.x, A.y, s * d);
		hSteel.push(rod(z(DIM.hangerHalf), z(DIM.hangerHalf + 0.001), 0.0062, 0.0062, 14));
		hSteel.push(rod(z(0.097), z(0.098), 0.0062, 0.0062, 14));
		hSteel.push(rod(z(0.098), z(0.1042), 0.0066, 0.0066, 6));
	});

	// mounting nuts under the baseplate
	[-0.027, 0.027].forEach((dx) =>
		[-0.0205, 0.0205].forEach((dz) => steel.push(rod(V(dx, -0.005, dz), V(dx, -0.0092, dz), 0.0046, 0.0046, 6)))
	);
	return { alu, steel, bushing, hAlu, hSteel };
}

/* ---------- wheels ---------- */

function wheelGeometry() {
	const R = DIM.wheelR;
	const hw = DIM.wheelW / 2;
	const face = 0.012; // bearing seat plane
	const er = DIM.wheelLip; // lip radius
	const flat = hw - er;
	const pts = [];
	const P = (r, y) => pts.push(new THREE.Vector2(r, y));
	P(0.0111, -face);
	P(0.0128, -face);
	P(0.0206, -hw); // dished sidewall
	for (let k = 0; k <= 6; k++) {
		const a = -Math.PI / 2 + (k / 6) * (Math.PI / 2);
		P(R - er + Math.cos(a) * er, -flat + Math.sin(a) * er);
	}
	for (let k = 0; k <= 6; k++) {
		const a = (k / 6) * (Math.PI / 2);
		P(R - er + Math.cos(a) * er, flat + Math.sin(a) * er);
	}
	P(0.0206, hw);
	P(0.0128, face);
	P(0.0111, face);
	const urethane = new THREE.LatheGeometry(pts, 40);
	urethane.rotateX(Math.PI / 2);

	// bearings: outer race + dark shield + inner race, both faces
	const steel = [];
	const shield = [];
	[-1, 1].forEach((s) => {
		const ringAt = (ri, ro, off) => {
			const g = new THREE.RingGeometry(ri, ro, 28);
			if (s < 0) g.rotateY(Math.PI);
			return g.translate(0, 0, s * (face + off));
		};
		steel.push(ringAt(0.0096, 0.0112, 0.0001));
		shield.push(ringAt(0.0058, 0.0096, 0.0001));
		steel.push(ringAt(0.004, 0.0058, 0.0003));
	});

	// printed arc on the outer sidewall makes the wheel's rotation legible
	const ink = new THREE.LatheGeometry([new THREE.Vector2(0.0146, face + 0.0009), new THREE.Vector2(0.0192, hw - 0.0004)], 24, 0, Math.PI * 1.15);
	ink.rotateX(Math.PI / 2);
	ink.translate(0, 0, 0.0003);

	return merge([[urethane], steel, shield, [ink]]);
}

/* ---------- materials ---------- */

export function createMaterials(onChange) {
	const grip = gripTexture();
	return {
		grip: new THREE.MeshStandardMaterial({ map: grip, roughness: 0.97 }),
		graphic: new THREE.MeshStandardMaterial({ map: graphicTexture(onChange), roughness: 0.38 }),
		ply: new THREE.MeshStandardMaterial({ map: plyTexture(), roughness: 0.6 }),
		alu: new THREE.MeshStandardMaterial({ color: 0xc4c7cb, metalness: 0.92, roughness: 0.4 }),
		steel: new THREE.MeshStandardMaterial({ color: 0x9da2a8, metalness: 1, roughness: 0.26 }),
		bushing: new THREE.MeshStandardMaterial({ color: 0xc8742a, roughness: 0.5 }),
		urethane: new THREE.MeshStandardMaterial({ color: 0xefe8d8, roughness: 0.42 }),
		shield: new THREE.MeshStandardMaterial({ color: 0x1c1c1d, roughness: 0.45 }),
		ink: new THREE.MeshStandardMaterial({ color: 0xcf4a24, roughness: 0.55, side: THREE.DoubleSide })
	};
}

/* ---------- assembly ---------- */

// onChange is called when something that affects the picture arrives late (the deck graphic)
export function createSkateboard(onChange) {
	const mats = createMaterials(onChange);
	const root = new THREE.Group();
	root.name = "skateboard";
	const mesh = (geo, mat) => {
		const m = new THREE.Mesh(geo, mat);
		m.castShadow = true;
		m.receiveShadow = true;
		root.add(m);
		return m;
	};

	const deck = buildDeck();
	mesh(deck.top, mats.grip);
	mesh(deck.bottom, mats.graphic);
	mesh(deck.rail, mats.ply);

	// The deck bends between the trucks under load: `flex.value` is the dip at the centre in
	// metres. Outside the trucks the nose and tail follow the bend and tip up slightly.
	// Where a truck is bolted on, the deck does not move at all: the baseplate, its four bolts and
	// the wood between them are one stiff piece, and none of the hardware is drawn bending. So the
	// bend is held at zero across each baseplate's whole footprint and eases in on either side.
	const MOUNT = 0.041; // half the length of deck a truck holds still: the 78 mm baseplate, and a little
	const EASE = 0.04; // length over which the nose and tail pick their tip-up back up beyond it
	// The dip between the trucks is drawn larger than it is calculated so that it can be seen (see
	// COUPLED.deckShow in tricks.js). The nose and tail tip up with it, and at that scale they rose
	// more than the middle dipped, so the whole deck seemed to flap. They follow at a fifth, which
	// is their own true size for a dip drawn five times too large.
	const TIP_SHARE = 0.2;
	const inner = DIM.plateX - MOUNT, outer = DIM.plateX + MOUNT; // the held stretch, along the deck
	const flex = { value: 0 };
	// how much of their full tip-up the nose and tail show: 1 when the bend is drawn at its
	// calculated size, and 1/scale when it is drawn `scale` times larger (set for each run)
	const flexTip = { value: TIP_SHARE };
	// A broken deck: the two halves stay joined at the grip tape and fold there. `fold`
	// is the angle of each half, `sagU` how far the fold has dropped. Each half turns about the
	// fold line, so the wheels stay on the floor and roll apart a little.
	const fold = { value: 0 }, sagU = { value: 0 };
	const FOLD_HEAD = "uniform float uFold;\nuniform float uSag;\nvarying vec3 vRest;\nvarying float vW;\n";
	const FOLD_POS = "\n\tvRest = position;\n\tvW = clamp(position.x / 0.018, -1.0, 1.0);\n\tfloat fa = uFold * vW;\n\tfloat fc = cos(fa), fs = sin(fa);\n\ttransformed.xy = vec2(fc * transformed.x - fs * transformed.y, fs * transformed.x + fc * transformed.y - uSag);\n";
	const FOLD_NORMAL = "#include <beginnormal_vertex>\n\t{ float na = uFold * clamp(position.x / 0.018, -1.0, 1.0); float nc = cos(na), ns = sin(na); objectNormal.xy = vec2(nc * objectNormal.x - ns * objectNormal.y, ns * objectNormal.x + nc * objectNormal.y); }\n";
	// the broken wood: a ragged pale band across the underside and up the rails (drawn, not calculated)
	const CRACK = "#include <color_fragment>\n\tif (uFold > 0.0) {\n\t\tfloat teeth = 0.6 * abs(fract(vRest.z * 41.0) * 2.0 - 1.0) + 0.4 * abs(fract(vRest.z * 173.0 + 0.3) * 2.0 - 1.0);\n\t\tif (abs(vW) < max(0.3, teeth)) discard;\n\t\tif (!gl_FrontFacing) diffuseColor.rgb = mix(vec3(0.84, 0.69, 0.47), vec3(0.62, 0.46, 0.28), abs(fract(vRest.z * 330.0) * 2.0 - 1.0));\n\t}\n";
	const CRACK_RAIL = "#include <color_fragment>\n\tif (uFold > 0.0) {\n\t\tfloat ply = floor(clamp(vMapUv.y, 0.0, 0.999) * 7.0);\n\t\tfloat side = vW < 0.0 ? 1.7 : 0.0;\n\t\tfloat far = fract(sin((ply + side + step(0.0, vRest.z) * 3.1) * 12.9898) * 43758.5453);\n\t\tif (ply > 0.5 && abs(vW) < 0.2 + 0.8 * far) discard;\n\t}\n";
	const folding = (mat) => {
		mat.onBeforeCompile = (shader) => {
			shader.uniforms.uFold = fold;
			shader.uniforms.uSag = sagU;
			shader.vertexShader = FOLD_HEAD + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>" + FOLD_POS).replace("#include <beginnormal_vertex>", FOLD_NORMAL);
		};
		mat.customProgramCacheKey = () => "fold";
		return mat;
	};
	const aluFixed = folding(mats.alu.clone()), steelFixed = folding(mats.steel.clone());
	folding(mats.bushing);
	// the broken ends are open, so the inside of the deck can be seen
	[mats.graphic, mats.ply].forEach((m) => {
		m.side = THREE.DoubleSide;
		m.shadowSide = THREE.BackSide;
	});
	const BEND_HEAD = `uniform float uFlex;
uniform float uTip;
float bendAt(float x) {
	float ax = abs(x);
	if (ax < ${inner.toFixed(4)}) {
		float s2 = (ax * ax) / ${(inner * inner).toFixed(6)};
		return -(1.0 - s2) * (1.0 - s2 * s2 * s2);
	}
	if (ax > ${outer.toFixed(4)}) {
		float d = ax - ${outer.toFixed(4)};
		return uTip * ${(2 / DIM.plateX).toFixed(4)} * d * d / (d + ${EASE.toFixed(4)});
	}
	return 0.0;
}
`;
	const BEND_POS = "\n\ttransformed.y += uFlex * bendAt(position.x);\n";
	const BEND_NORMAL = "\n\tobjectNormal.x -= objectNormal.y * uFlex * (bendAt(position.x + 0.0001) - bendAt(position.x - 0.0001)) / 0.0002;\n";
	const tuneDeck = (mat, kind, uniforms, depth = false) => {
		mat.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, uniforms);
			shader.vertexShader = BEND_HEAD + FOLD_HEAD + shader.vertexShader
				.replace("#include <begin_vertex>", "#include <begin_vertex>" + BEND_POS + FOLD_POS)
				.replace("#include <beginnormal_vertex>", FOLD_NORMAL.replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>" + BEND_NORMAL));
			const crack = kind === "rail" ? CRACK_RAIL : kind === "under" ? CRACK : null;
			if (crack) {
				const declarations = "uniform float uFold;\nvarying vec3 vRest;\nvarying float vW;\n";
				const cutout = crack.replace(/\t\tif \(!gl_FrontFacing\)[^\n]*\n/, "");
				shader.fragmentShader = declarations + (depth
					? shader.fragmentShader.replace("#include <alphatest_fragment>", cutout.replace("#include <color_fragment>", "#include <alphatest_fragment>"))
					: shader.fragmentShader.replace("#include <color_fragment>", crack));
			}
		};
		mat.customProgramCacheKey = () => `deck-${kind}-${depth ? "depth" : "visible"}`;
	};
	const deckUniforms = { uFlex: flex, uTip: flexTip, uFold: fold, uSag: sagU };
	["grip", "under", "rail"].forEach((kind, i) => {
		const surface = root.children[i];
		tuneDeck(surface.material, kind, deckUniforms);
		const depth = new THREE.MeshDepthMaterial({
			depthPacking: THREE.RGBADepthPacking,
			map: kind === "rail" ? mats.ply.map : null
		});
		tuneDeck(depth, kind, deckUniforms, true);
		surface.customDepthMaterial = depth;
	});
	const foldDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
	foldDepth.onBeforeCompile = (shader) => {
		shader.uniforms.uFold = fold;
		shader.uniforms.uSag = sagU;
		shader.vertexShader = FOLD_HEAD + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>" + FOLD_POS);
	};
	// Each hanger, with its axle and wheels, is a group of its own that can turn about the truck's
	// pivot (see PIVOT). At rest it sits exactly where a rigid truck's would. [0] rear, [1] front.
	const hangers = [-1, 1].map((side) => {
		const g = new THREE.Group();
		g.position.set(side * (DIM.plateX - PIVOT.x), -DIM.thickness + PIVOT.y, 0);
		root.add(g);
		return g;
	});
	const hangerRest = hangers.map((g) => g.position.clone());
	const foldQ = hangers.map(() => new THREE.Quaternion());
	const pivotAxes = [-1, 1].map((side) => new THREE.Vector3(-side * PIVOT.ux, PIVOT.uy, 0));
	const bushings = [];
	const hung = (geo, mat, parent) => {
		const m = new THREE.Mesh(geo, mat);
		m.castShadow = true;
		m.receiveShadow = true;
		parent.add(m);
	};

	// the fixed parts of both trucks merged per material; the nose truck is the tail truck turned half a turn
	const alu = [];
	const steel = [];
	[-1, 1].forEach((side, ti) => {
		const parts = truckParts();
		const place = (g) => {
			if (side > 0) g.rotateY(Math.PI);
			return g.translate(side * DIM.plateX, -DIM.thickness, 0);
		};
		parts.alu.forEach((g) => alu.push(place(g)));
		parts.steel.forEach((g) => steel.push(place(g)));
		// The two bushings of this truck are a mesh of their own. Each is squeezed between a fixed
		// seat (the baseplate boss, or the washer under the nut) and the hanger's yoke, so when the
		// hanger turns, the face against the yoke goes with it and the fixed face stays: `w` is how
		// far each vertex follows the hanger, 0 at the fixed seat and 1 at the yoke.
		{
			const geo = merge([parts.bushing.map(place)]);
			const pos = geo.attributes.position;
			const rest = new Float32Array(pos.array);
			const w = new Float32Array(pos.count);
			const sn = Math.sin(deg(42)), cs = Math.cos(deg(42));
			for (let i = 0; i < pos.count; i++) {
				// back in the truck's own frame, how far along the kingpin this vertex is
				const tx = side * (side * DIM.plateX - rest[i * 3]), ty = rest[i * 3 + 1] + DIM.thickness;
				const d = (tx - 0.004) * sn - (ty + 0.004) * cs;
				w[i] = d < 0.022 ? Math.min(1, Math.max(0, (d - 0.008) / 0.01)) : Math.min(1, Math.max(0, (0.037 - d) / 0.011));
			}
			bushings.push({ pos, rest, w, angle: 0, mesh: mesh(geo, mats.bushing) });
		}
		// the turning parts, in their hanger's own frame
		const hp = hangers[ti].position;
		const inHanger = (g) => place(g).translate(-hp.x, -hp.y, -hp.z);
		hung(merge([parts.hAlu.map(inHanger)]), mats.alu, hangers[ti]);
		hung(merge([parts.hSteel.map(inHanger)]), mats.steel, hangers[ti]);
		// deck bolts, heads flush with the grip
		[-0.027, 0.027].forEach((dx) =>
			[-0.0205, 0.0205].forEach((dz) => {
				const x = side * DIM.plateX + dx;
				steel.push(at(new THREE.CylinderGeometry(0.005, 0.0052, 0.0012, 14), x, heightAt(x, dz) + 0.0002, dz));
			})
		);
	});
	mesh(merge([alu]), aluFixed);
	mesh(merge([steel]), steelFixed);

	const wheelGeo = wheelGeometry();
	const wheelMats = [mats.urethane, mats.steel, mats.shield, mats.ink];
	const wheels = [];
	[-1, 1].forEach((sx) =>
		[-1, 1].forEach((sz) => {
			const spin = new THREE.Group();
			const hanger = hangers[sx < 0 ? 0 : 1];
			spin.position.set(sx * DIM.axleX - hanger.position.x, DIM.axleY - hanger.position.y, sz * DIM.wheelZ);
			const w = new THREE.Mesh(wheelGeo, wheelMats);
			if (sz < 0) w.rotation.y = Math.PI;
			w.castShadow = true;
			w.receiveShadow = true;
			spin.add(w);
			hanger.add(spin);
			wheels.push(spin);
		})
	);

	// turn the hangers about their pivots, by angles in radians (zero is the rigid truck)
	const _v = new THREE.Vector3();
	const setTrucks = (rear, front) => {
		[rear || 0, front || 0].forEach((angle, ti) => {
			hangers[ti].quaternion.setFromAxisAngle(pivotAxes[ti], angle).premultiply(foldQ[ti]);
			// the bushings deform with the hanger: sheared round the same pivot, in proportion to `w`
			const b = bushings[ti];
			if (Math.abs(angle - b.angle) < 1e-5) return;
			b.angle = angle;
			const c = hangerRest[ti];
			for (let i = 0; i < b.w.length; i++) {
				_v.set(b.rest[i * 3] - c.x, b.rest[i * 3 + 1] - c.y, b.rest[i * 3 + 2] - c.z).applyAxisAngle(pivotAxes[ti], angle * b.w[i]);
				b.pos.setXYZ(i, _v.x + c.x, _v.y + c.y, _v.z + c.z);
			}
			b.pos.needsUpdate = true;
		});
	};
	// fold the board by how far its broken middle has dropped, in metres (0 = whole).
	// Call before setTrucks. The angle is the one that keeps both axles at their height.
	const _z = new THREE.Vector3(0, 0, 1);
	root.children.forEach((m) => {
		if (m.isMesh && !m.customDepthMaterial) m.customDepthMaterial = foldDepth; // the hangers and wheels are moved as groups
	});
	const setFold = (s) => {
		let th = s / DIM.axleX;
		for (let i = 0; i < 4; i++) th -= (DIM.axleX * Math.sin(th) - DIM.axleY * (1 - Math.cos(th)) - s) / (DIM.axleX * Math.cos(th) - DIM.axleY * Math.sin(th));
		fold.value = th;
		sagU.value = s;
		[-1, 1].forEach((side, ti) => {
			const a = side * th, r = hangerRest[ti];
			hangers[ti].position.set(Math.cos(a) * r.x - Math.sin(a) * r.y, Math.sin(a) * r.x + Math.cos(a) * r.y - s, r.z);
			foldQ[ti].setFromAxisAngle(_z, a);
		});
	};
	// Strobe exposures have their own articulation and flex state. Share static mesh data.
	const createExposure = (material) => {
		const copy = root.clone(true);
		const cloneOf = (source) => {
			const path = [];
			for (let node = source; node !== root; node = node.parent) path.push(node.parent.children.indexOf(node));
			return path.reverse().reduce((node, index) => node.children[index], copy);
		};
		copy.traverse((node) => {
			if (!node.isMesh) return;
			node.material = material;
			node.castShadow = node.receiveShadow = false;
		});
		const shownHangers = hangers.map(cloneOf);
		const shownWheels = wheels.map(cloneOf);
		const shownBushings = bushings.map((b) => {
			const mesh = cloneOf(b.mesh);
			mesh.geometry = b.mesh.geometry.clone();
			return mesh.geometry.getAttribute("position");
		});
		const uFlex = { value: 0 }, uTip = { value: 1 };
		const flexMaterial = material.clone();
		tuneDeck(flexMaterial, "ghost", { uFlex, uTip, uFold: { value: 0 }, uSag: { value: 0 } });
		copy.children.slice(0, 3).forEach((surface) => { surface.material = flexMaterial; });
		return {
			root: copy,
			setOpacity(opacity) { flexMaterial.opacity = opacity; },
			setPose(pose, scale) {
				copy.matrix.copy(pose.matrix);
				copy.matrixWorldNeedsUpdate = true;
				uFlex.value = Math.max(0, pose.flex);
				uTip.value = 1 / scale;
				shownWheels.forEach((w, i) => { w.rotation.z = i < 2 ? pose.wheelRear : pose.wheelFront; });
				shownHangers.forEach((hanger, i) => {
					const angle = i ? pose.truckFront : pose.truckRear;
					const c = hangerRest[i];
					hanger.position.copy(c);
					hanger.quaternion.setFromAxisAngle(pivotAxes[i], angle);
					const { rest, w } = bushings[i], pos = shownBushings[i];
					for (let j = 0; j < w.length; j++) {
						_v.set(rest[j * 3] - c.x, rest[j * 3 + 1] - c.y, rest[j * 3 + 2] - c.z)
							.applyAxisAngle(pivotAxes[i], angle * w[j]).add(c);
						pos.setXYZ(j, _v.x, _v.y, _v.z);
					}
					pos.needsUpdate = true;
				});
			}
		};
	};
	return { root, wheels, flex, flexTip, materials: mats, hangers, setTrucks, setFold, createExposure };
}

/* ---------- reference points for the motion system ---------- */

export const POINTS = {
	rearAxle: new THREE.Vector3(-DIM.axleX, DIM.axleY, 0),
	backFoot: new THREE.Vector3(-0.17, 0.045, 0) // where the back foot sits during an impossible
};

// Points on the outer hull (wheel rims, deck edge, axle ends) used to keep the board
// above the floor. Flat array of x, y, z in board space.
export const PROBES = (() => {
	const out = [];
	[-1, 1].forEach((sx) =>
		[-1, 1].forEach((sz) => {
			for (let k = 0; k < 16; k++) {
				const a = (k / 16) * Math.PI * 2;
				const c = Math.cos(a);
				const s = Math.sin(a);
				[-0.0093, 0.0093].forEach((dz) => out.push(sx * DIM.axleX + c * DIM.wheelR, DIM.axleY + s * DIM.wheelR, sz * DIM.wheelZ + dz));
				[-0.0155, 0.0155].forEach((dz) => out.push(sx * DIM.axleX + c * 0.0206, DIM.axleY + s * 0.0206, sz * DIM.wheelZ + dz));
			}
			out.push(sx * DIM.axleX, DIM.axleY, sz * DIM.axleHalf);
		})
	);
	const P = new THREE.Vector3();
	const N = new THREE.Vector3();
	for (let i = 0; i <= 40; i++) {
		const s = i / 40;
		const u = 0.5 - 0.5 * Math.cos(Math.PI * s);
		const x = DIM.tailEnd + (DIM.noseEnd - DIM.tailEnd) * THREE.MathUtils.lerp(s, u, 0.75);
		[-1, 1].forEach((zn) => {
			topPoint(x, zn, P);
			topNormal(x, zn, N);
			const grow = 1 + RAIL_BULGE / Math.max(0.02, halfWidth(x));
			out.push(P.x, P.y, P.z * grow);
			out.push(P.x - N.x * DIM.thickness, P.y - N.y * DIM.thickness, (P.z - N.z * DIM.thickness) * grow);
		});
	}
	// nose and tail tips, including the rail bulge
	[DIM.noseEnd, DIM.tailEnd].forEach((x) => {
		topPoint(x, 0, P);
		topNormal(x, 0, N);
		const e = Math.sign(x) * RAIL_BULGE;
		out.push(P.x + e, P.y, 0, P.x + e - N.x * DIM.thickness, P.y - N.y * DIM.thickness, 0);
	});
	return new Float32Array(out);
})();
