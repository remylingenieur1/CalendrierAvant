import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadIcons } from "./icons.js";
import { createPhysics } from "./physics.js";
import { createControls } from "./controls.js";

const CONFIG = {
  count: 70,
  spawnInterval: 0.12, // seconds between drips
  spawnSpeed: 9, // units/s toward the centre as each icon enters
  attraction: 6, // spring to the centre, accel per unit of distance
  maxPull: 14, // cap on that accel
  repelRadius: 1.5, // distance from the pointer ray that feels the push
  repelStrength: 400, // accel right on the ray, falling off squared to 0 at the radius
  repelSpin: 10, // random tumble added while pushed
  blastRadius: 5, // click blast reach, from where the click lands
  blastStrength: 16, // outward speed (units/s) given at the blast centre
  blastSpin: 8, // random tumble (rad/s) given at the blast centre
  linearDamping: 0.6,
  angularDamping: 0.4,
  restitution: 0.2,
  friction: 0.5,
  dt: 1 / 60,
  maxSubsteps: 3,
  framing: 1.9, // the shorter viewport side spans this many clump radii, each way
  look: {
    background: "#252525",
    clearcoat: 0.4,
    shadow: 0.18,
    environment: 0.9,
  },
};

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const motionScale = reduceMotion ? 0.4 : 1;

// renderer, scene, camera
const canvas = document.getElementById("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Neutral keeps the brand colours close to their SVG fills
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);

const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.castShadow = true;
// mapSize and the shadow camera are fitted to the view in fitShadow()
key.shadow.radius = 16;
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);

// catches the clump's shadow behind it
const shadowMaterial = new THREE.ShadowMaterial({ opacity: CONFIG.look.shadow });
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), shadowMaterial);
backdrop.receiveShadow = true;
scene.add(backdrop);

const swarm = new THREE.Group();
scene.add(swarm);

const [icons, physics] = await Promise.all([loadIcons(CONFIG), createPhysics(CONFIG)]);
const avgRadius = icons.reduce((s, i) => s + i.radius, 0) / icons.length;
const maxRadius = Math.max(...icons.map((i) => i.radius));

// rough radius of the settled clump: volume grows with count
const clumpRadius = () => avgRadius * 0.85 * Math.cbrt(CONFIG.count);

function frame() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;

  const r = clumpRadius();
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = (r * CONFIG.framing) / (tanHalf * Math.min(1, camera.aspect)) + r;
  camera.position.set(0, 0, dist);
  camera.far = dist + 100;
  camera.updateProjectionMatrix();

  backdrop.position.x = -1000;
  backdrop.position.y = -1000;
  backdrop.position.z = -(r + 2.5);
  key.position.copy(lightDir).multiplyScalar(dist + 10);
  fitShadow(tanHalf);
}

// Fit the shadow camera to the part of the backdrop in view, so a shadow
// lands anywhere on screen, and size the map to keep the texel density
const lightDir = new THREE.Vector3(-0.35, 0.6, 1).normalize();
const SHADOW_TEXELS = 2048; // along the shorter side of the shadow frustum
const corner = new THREE.Vector3();
function fitShadow(tanHalf) {
  const sc = key.shadow.camera;
  // the light aims its shadow camera like this every render; do it now to
  // measure in its space
  sc.position.copy(key.position);
  sc.lookAt(key.target.position);
  sc.updateMatrixWorld();

  const z = backdrop.position.z;
  const halfH = (camera.position.z - z) * tanHalf;
  const halfW = halfH * camera.aspect;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let far = 0;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      corner.set(sx * halfW, sy * halfH, z).applyMatrix4(sc.matrixWorldInverse);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
      far = Math.max(far, -corner.z);
    }
  // a margin so the blurred edge of a shadow isn't clipped at the frame
  const pad = maxRadius;
  sc.left = minX - pad;
  sc.right = maxX + pad;
  sc.bottom = minY - pad;
  sc.top = maxY + pad;
  sc.near = 0.5;
  sc.far = far + pad;
  sc.updateProjectionMatrix();

  const w = sc.right - sc.left;
  const h = sc.top - sc.bottom;
  const cap = Math.min(renderer.capabilities.maxTextureSize, SHADOW_TEXELS * 2);
  const mapW = Math.min(cap, Math.round((SHADOW_TEXELS * w) / Math.min(w, h)));
  const mapH = Math.min(cap, Math.round((SHADOW_TEXELS * h) / Math.min(w, h)));
  if (key.shadow.mapSize.x !== mapW || key.shadow.mapSize.y !== mapH) {
    key.shadow.mapSize.set(mapW, mapH);
    key.shadow.map?.dispose(); // reallocated at the new size on the next render
    key.shadow.map = null;
  }
}

function applyLook() {
  const { look } = CONFIG;
  scene.background = new THREE.Color(look.background);
  document.body.style.background = look.background;
  shadowMaterial.opacity = look.shadow;
  scene.environmentIntensity = look.environment;
  for (const icon of icons) icon.material.clearcoat = look.clearcoat;
}

// spawning: a shuffled bag of the icons, refilled when empty, so the mix stays even
const live = []; // { item, mesh }
let pending = 0;
let spawnTimer = 0;
let bag = [];

function nextIcon() {
  if (!bag.length) {
    bag = icons.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }
  return bag.pop();
}

const tmpQuat = new THREE.Quaternion();

function spawnOne() {
  const icon = nextIcon();

  // a point on a ring just outside the view at z = 0
  const halfH = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const ring = Math.hypot(halfH * camera.aspect, halfH) + maxRadius;
  const a = Math.random() * Math.PI * 2;
  const position = {
    x: Math.cos(a) * ring,
    y: Math.sin(a) * ring,
    z: (Math.random() - 0.5) * clumpRadius(),
  };

  // inward, with a little sideways drift so they don't all meet head-on
  const speed = CONFIG.spawnSpeed * motionScale * (0.8 + Math.random() * 0.4);
  const side = (Math.random() - 0.5) * 0.5;
  const linvel = {
    x: (-Math.cos(a) - Math.sin(a) * side) * speed,
    y: (-Math.sin(a) + Math.cos(a) * side) * speed,
    z: -position.z * 0.5,
  };
  const spin = 3 * motionScale;
  const angvel = {
    x: (Math.random() - 0.5) * spin * 2,
    y: (Math.random() - 0.5) * spin * 2,
    z: (Math.random() - 0.5) * spin * 2,
  };
  const { x, y, z, w } = tmpQuat.random();

  const item = physics.addBody(icon.hulls, {
    position,
    rotation: { x, y, z, w },
    linvel,
    angvel,
  });
  const mesh = new THREE.Mesh(icon.geometry, icon.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = icon.name;
  swarm.add(mesh);
  live.push({ item, mesh });
  sync(live[live.length - 1]);
}

function respawn() {
  for (const { item, mesh } of live) {
    physics.removeBody(item);
    swarm.remove(mesh);
  }
  live.length = 0;
  pending = CONFIG.count;
  spawnTimer = 0;
  frame();
}

function sync({ item, mesh }) {
  const p = item.body.translation();
  const q = item.body.rotation();
  mesh.position.set(p.x, p.y, p.z);
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
}

// pointer: rays from the camera through the cursor, while it's over the page.
// Every position it passed through since the last physics step goes in the
// trail (from getCoalescedEvents, with gaps filled in), so a fast swipe
// pushes everything it crossed, not just where it was each frame.
const TRAIL_STEP = 12; // CSS px between trail points along a fast move
const TRAIL_MAX = 48; // points kept between physics steps
const pointer = { x: 0, y: 0, active: false, trail: [] };
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function setNdc(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
}

function addSample(x, y) {
  if (pointer.active) {
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    const n = Math.min(Math.floor(Math.hypot(dx, dy) / TRAIL_STEP), TRAIL_MAX);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      pointer.trail.push([pointer.x + dx * t, pointer.y + dy * t]);
    }
  }
  pointer.trail.push([x, y]);
  pointer.x = x;
  pointer.y = y;
  pointer.active = true;
}

function onPointer(e) {
  const events = e.getCoalescedEvents?.();
  for (const ev of events?.length ? events : [e]) addSample(ev.clientX, ev.clientY);
  // thin a long trail evenly, keeping both ends
  const t = pointer.trail;
  if (t.length > TRAIL_MAX)
    pointer.trail = Array.from({ length: TRAIL_MAX }, (_, i) => t[Math.round((i * (t.length - 1)) / (TRAIL_MAX - 1))]);
}
// click blast: centred where the ray first hits an icon, or, on a miss, at
// the point on the ray closest to the clump's centre
const blastCenter = new THREE.Vector3();
function blast(e) {
  onPointer(e);
  if (e.button !== 0) return;
  setNdc(pointer.x, pointer.y);
  raycaster.setFromCamera(ndc, camera);
  const [hit] = raycaster.intersectObjects(swarm.children, false);
  if (hit) blastCenter.copy(hit.point);
  else raycaster.ray.closestPointToPoint(swarm.position, blastCenter);
  physics.explode(blastCenter, motionScale);
}

canvas.addEventListener("pointermove", onPointer);
canvas.addEventListener("pointerdown", blast);
function release() {
  pointer.active = false;
  pointer.trail.length = 0;
}
canvas.addEventListener("pointerleave", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "mouse") release(); // a lifted finger stops pushing
});

createControls(CONFIG, {
  onDamping: physics.setDamping,
  onSurface: physics.setSurface,
  onLook: applyLook,
  onRespawn: respawn,
});

window.addEventListener("resize", frame);
applyLook();
respawn();

// fixed-step physics with an accumulator, rendering every frame
let last = performance.now();
let acc = 0;
const rayPool = [];
const rays = [];

renderer.setAnimationLoop((now) => {
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;

  spawnTimer -= elapsed;
  while (pending > 0 && spawnTimer <= 0) {
    spawnOne();
    pending--;
    spawnTimer += CONFIG.spawnInterval;
  }

  // one ray per trail point; a still pointer keeps pushing where it sits
  rays.length = 0;
  if (pointer.active) {
    const samples = pointer.trail.length ? pointer.trail : [[pointer.x, pointer.y]];
    samples.forEach(([x, y], i) => {
      setNdc(x, y);
      raycaster.setFromCamera(ndc, camera);
      const ray = (rayPool[i] ??= { origin: new THREE.Vector3(), dir: new THREE.Vector3() });
      ray.origin.copy(raycaster.ray.origin);
      ray.dir.copy(raycaster.ray.direction);
      rays.push(ray);
    });
  }

  acc += elapsed;
  let steps = 0;
  while (acc >= CONFIG.dt && steps < CONFIG.maxSubsteps) {
    physics.step(rays.length ? rays : null, motionScale);
    acc -= CONFIG.dt;
    steps++;
  }
  if (steps === CONFIG.maxSubsteps) acc = 0; // fell behind: drop the backlog
  // keep the trail until a step has used it (no step runs on some frames
  // at high refresh rates)
  if (steps > 0) pointer.trail.length = 0;

  for (const entry of live) sync(entry);
  renderer.render(scene, camera);
});
