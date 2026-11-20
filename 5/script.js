import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const CFG = {
  chunkLength: 16,
  chunkRadius: 5,
  grassPerChunk: 48,
  dustCount: 160,
  printCount: 96,
  seed: 7241,
  pixelRatio: Math.min(devicePixelRatio, 1.75)
};
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (t) => t * t * (3 - 2 * t);
const $ = (id) => document.getElementById(id);
const animalButtons = [...document.querySelectorAll("[data-animal]")];
const scene = new THREE.Scene();
scene.background = new THREE.Color("#bcd5d5");
scene.fog = new THREE.Fog("#bcd5d5", 38, 86);
const camera = new THREE.PerspectiveCamera(
  43,
  innerWidth / innerHeight,
  0.1,
  240
);
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });
} catch (error) {
  $("status").textContent =
    "This scene needs WebGL. Try a browser with hardware acceleration enabled.";
  throw error;
}
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(CFG.pixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
$("scene").appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 3.5;
controls.maxDistance = 48;
controls.maxPolarAngle = Math.PI * 0.485;
controls.minPolarAngle = 0.14;
controls.target.set(0, 1.25, 0.1);

// A closed, arc-length-parameterized course: long straights and broad bends.
const course = new THREE.CatmullRomCurve3(
  [
    [0, 0, 0],
    [0, 0, 48],
    [18, 0, 82],
    [52, 0, 104],
    [90, 0, 94],
    [112, 0, 57],
    [100, 0, 16],
    [116, 0, -24],
    [97, 0, -66],
    [52, 0, -87],
    [9, 0, -65],
    [-12, 0, -32]
  ].map((p) => new THREE.Vector3(...p)),
  true,
  "centripetal"
);
course.arcLengthDivisions = 2400;
course.updateArcLengths();

const courseLength = course.getLength();
const courseSamples = course.getSpacedPoints(Math.ceil(courseLength));
const world = new THREE.Group();
scene.add(world);

const runnerPosition = new THREE.Vector3(),
  runnerTangent = new THREE.Vector3();
const turnAxis = new THREE.Vector3(0, 1, 0),
  followOffset = new THREE.Vector3();
let heading = 0,
  previousHeading = 0;
let focusedId = "horse",
  focusShift = null;

// Cache nearest center-line distance for cells within 20 m of the route.
// Sampling segments rather than just points keeps the trail continuous.
const routeField = new Map();
for (let i = 0; i < courseSamples.length - 1; i++) {
  const a = courseSamples[i],
    b = courseSamples[i + 1],
    dx = b.x - a.x,
    dz = b.z - a.z,
    len2 = dx * dx + dz * dz;
  for (
    let z = Math.floor(Math.min(a.z, b.z) - 20);
    z <= Math.ceil(Math.max(a.z, b.z) + 20);
    z++
  )
    for (
      let x = Math.floor(Math.min(a.x, b.x) - 20);
      x <= Math.ceil(Math.max(a.x, b.x) + 20);
      x++
    ) {
      const t = clamp(
        ((x + 0.5 - a.x) * dx + (z + 0.5 - a.z) * dz) / len2,
        0,
        1
      );
      const d2 = (x + 0.5 - a.x - dx * t) ** 2 + (z + 0.5 - a.z - dz * t) ** 2;
      if (d2 < 400) {
        const key = x + "," + z,
          old = routeField.get(key);
        if (old === undefined || d2 < old) routeField.set(key, d2);
      }
    }
}

function routeDistance(x, z) {
  return Math.sqrt(routeField.get(Math.floor(x) + "," + Math.floor(z)) ?? 400);
}

function updateRunner(visualDt = 0) {
  const selected = runners.find((a) => a.id === focusedId);
  if (focusShift) {
    focusShift.time += visualDt;
    const t = smooth(Math.min(focusShift.time / 1.1, 1));
    runnerPosition.lerpVectors(focusShift.from, selected.position, t);
    const turn = Math.atan2(
      Math.sin(selected.heading - focusShift.heading),
      Math.cos(selected.heading - focusShift.heading)
    );
    heading = focusShift.heading + turn * t;
    if (t === 1) focusShift = null;
  } else {
    runnerPosition.copy(selected.position);
    heading = selected.heading;
  }
  const turn = Math.atan2(
    Math.sin(heading - previousHeading),
    Math.cos(heading - previousHeading)
  );
  // Keep the user's chosen orbit relative to the runner through each bend.
  camera.position
    .sub(controls.target)
    .applyAxisAngle(turnAxis, turn)
    .add(controls.target);
  if (cameraTween) {
    cameraTween.from.applyAxisAngle(turnAxis, turn);
    cameraTween.to.applyAxisAngle(turnAxis, turn);
  }
  previousHeading = heading;
  for (const animal of runners) {
    animal.mesh.position.copy(animal.position).sub(runnerPosition);
    animal.mesh.rotation.y = animal.heading;
  }
  world.position.set(-runnerPosition.x, 0, -runnerPosition.z);
}

const ambient = new THREE.HemisphereLight("#e1f1ff", "#79644c", 2.1);
scene.add(ambient);
const sun = new THREE.DirectionalLight("#ffdf9e", 3.3);
sun.position.set(-14, 22, 14);
sun.castShadow = true;
Object.assign(sun.shadow.camera, {
  left: -17,
  right: 17,
  top: 17,
  bottom: -17,
  near: 1,
  far: 65
});
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.035;
sun.shadow.bias = -0.00015;
scene.add(sun);
scene.add(new THREE.DirectionalLight("#c8ddff", 0.4));

function hash(x, z, s = 0) {
  let n =
    Math.imul(x | 0, 374761393) ^
    Math.imul(z | 0, 668265263) ^
    Math.imul(s + CFG.seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = smooth(x - ix),
    fz = smooth(z - iz);
  return lerp(
    lerp(hash(ix, iz), hash(ix + 1, iz), fx),
    lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz
  );
}

// World-space sampling makes every chunk boundary agree, including negatives.
function heightAtCell(x, z) {
  const worldX = x + 0.5,
    worldZ = z + 0.5;
  const verge = smooth(clamp((routeDistance(worldX, worldZ) - 4.2) / 13, 0, 1));
  const hills =
    0.6 +
    noise(worldX * 0.035, worldZ * 0.023) * 4.6 +
    noise(worldX * 0.11, worldZ * 0.07) * 1.1;
  return Math.floor(hills * verge * 2) * 0.5;
}

function ground(x, z) {
  return heightAtCell(Math.floor(x), Math.floor(z));
}

const cube = new THREE.BoxGeometry(1, 1, 1);
const flatMat = new THREE.MeshStandardMaterial({
  roughness: 1,
  vertexColors: true
});
const grassMat = new THREE.MeshStandardMaterial({
  color: "#84944a",
  roughness: 1
});
const rockMat = new THREE.MeshStandardMaterial({
  color: "#8b9280",
  roughness: 1
});
const barkMat = new THREE.MeshStandardMaterial({
  color: "#6b503a",
  roughness: 1
});
const leafMat = new THREE.MeshStandardMaterial({
  color: "#516f43",
  roughness: 1
});
const leafLightMat = new THREE.MeshStandardMaterial({
  color: "#6e8248",
  roughness: 1
});
const dummy = new THREE.Object3D();

function matrixAt(mesh, index, x, y, z, sx, sy, sz, yaw = 0) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, yaw, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}

const grassUniforms = { time: { value: 0 } };
grassMat.onBeforeCompile = (shader) => {
  shader.uniforms.windTime = grassUniforms.time;
  shader.vertexShader = "uniform float windTime;\n" + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    `
    #include <begin_vertex>
    float sway = sin(windTime * 2.0 + instanceMatrix[3].x * .6 + instanceMatrix[3].z * .4);
    transformed.x += sway * .2 * (position.y + .5);
  `
  );
};

const chunks = new Map();
const color = new THREE.Color();
const topColors = ["#879752", "#8d9a59", "#929e5c", "#7e914d", "#a1a567"];
const pathColors = ["#b4a47a", "#b9aa80", "#a7a06b", "#b2a77a"];

// Four corners ordered counter-clockwise as viewed from outside.
function makeChunk(column, row) {
  const group = new THREE.Group();
  group.position.set(column * CFG.chunkLength, 0, row * CFG.chunkLength);
  const pos = [],
    norm = [],
    colors = [];
  function quad(a, b, c, d, normal, hex) {
    color.set(hex);
    for (const p of [a, b, d, b, c, d]) {
      pos.push(...p);
      norm.push(...normal);
      colors.push(color.r, color.g, color.b);
    }
  }
  function side(x, z, y, low, direction, tint) {
    if (direction === 0)
      quad(
        [x, y, z + 1],
        [x, y, z],
        [x, low, z],
        [x, low, z + 1],
        [-1, 0, 0],
        tint
      );
    if (direction === 1)
      quad(
        [x + 1, y, z],
        [x + 1, y, z + 1],
        [x + 1, low, z + 1],
        [x + 1, low, z],
        [1, 0, 0],
        tint
      );
    if (direction === 2)
      quad(
        [x, y, z],
        [x + 1, y, z],
        [x + 1, low, z],
        [x, low, z],
        [0, 0, -1],
        tint
      );
    if (direction === 3)
      quad(
        [x + 1, y, z + 1],
        [x, y, z + 1],
        [x, low, z + 1],
        [x + 1, low, z + 1],
        [0, 0, 1],
        tint
      );
  }
  const rocks = [],
    trunks = [],
    leaves = [],
    grass = [];
  const startZ = row * CFG.chunkLength,
    startX = column * CFG.chunkLength;
  for (let z = 0; z < CFG.chunkLength; z++)
    for (let x = 0; x < CFG.chunkLength; x++) {
      const wx = startX + x,
        wz = startZ + z,
        y = heightAtCell(wx, wz),
        r = hash(wx, wz, 1);
      const routeGap = routeDistance(wx, wz);
      const isPath = routeGap < 3.1;
      const palette = isPath ? pathColors : topColors;
      const tint = palette[Math.floor(r * palette.length)];
      quad(
        [x, y, z],
        [x, y, z + 1],
        [x + 1, y, z + 1],
        [x + 1, y, z],
        [0, 1, 0],
        tint
      );
      const neighbors = [
        [wx - 1, wz],
        [wx + 1, wz],
        [wx, wz - 1],
        [wx, wz + 1]
      ];
      for (let dir = 0; dir < 4; dir++) {
        const below = heightAtCell(...neighbors[dir]);
        if (below < y) {
          side(x, z, y, Math.max(below, y - 0.17), dir, "#75864a");
          if (below < y - 0.17)
            side(x, z, y - 0.17, below, dir, r > 0.5 ? "#8a7050" : "#967b55");
        }
      }
      if (routeGap > 6 && r > 0.983) {
        const s = 0.25 + hash(wx, wz, 4) * 0.65;
        rocks.push([
          x + 0.5,
          y + s * 0.35,
          z + 0.5,
          s,
          s * 0.7,
          s * 0.8,
          r * TAU
        ]);
      }
      if (routeGap > 9 && hash(wx, wz, 17) > 0.9975) {
        const h = 2.2 + hash(wx, wz, 18) * 1.7;
        trunks.push([x + 0.5, y + h * 0.5, z + 0.5, 0.34, h, 0.34]);
        leaves.push([x + 0.5, y + h - 0.05, z + 0.5, 2.6, 1.2, 2.5]);
        leaves.push([x + 0.3, y + h + 0.8, z + 0.5, 1.9, 0.8, 1.9]);
        leaves.push([x + 0.5, y + h + 1.35, z + 0.4, 1, 0.4, 1.1]);
      }
    }
  for (let i = 0; i < CFG.grassPerChunk; i++) {
    const x = hash(i + column * 71, row, 21) * CFG.chunkLength;
    const z = hash(i + column * 71, row, 22) * CFG.chunkLength;
    if (routeDistance(startX + x, startZ + z) < 4.1) continue;
    const y = ground(startX + x, startZ + z),
      h = 0.16 + hash(i, row, 23) * 0.35;
    grass.push([x, y + h * 0.5, z, 0.065, h, 0.065, 0]);
    grass.push([x + 0.12, y + h * 0.35, z + 0.08, 0.065, h * 0.7, 0.065, 0.5]);
    grass.push([x - 0.1, y + h * 0.3, z - 0.07, 0.065, h * 0.6, 0.065, -0.4]);
  }
  
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  
  geo.computeBoundingSphere();
  const terrain = new THREE.Mesh(geo, flatMat);
  terrain.receiveShadow = true;
  group.add(terrain);
  
  function instances(list, material, cast = false) {
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(cube, material, list.length);
    list.forEach((p, i) => matrixAt(mesh, i, ...p));
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  instances(grass, grassMat);
  instances(rocks, rockMat, true);
  instances(trunks, barkMat, true);
  instances(leaves, row % 2 ? leafMat : leafLightMat, true);
  world.add(group);
  chunks.set(column + "," + row, group);
  return group;
}

let distance = 0;
let terrainColumn = Infinity, terrainRow = Infinity;

function streamTerrain() {
  const column = Math.floor(runnerPosition.x / CFG.chunkLength),
    row = Math.floor(runnerPosition.z / CFG.chunkLength),
    r = CFG.chunkRadius;
  if (column === terrainColumn && row === terrainRow) return;
  terrainColumn = column;
  terrainRow = row;
  for (let z = row - r; z <= row + r; z++)
    for (let x = column - r; x <= column + r; x++)
      if (!chunks.has(x + "," + z)) makeChunk(x, z);
  for (const [key, group] of chunks) {
    const [x, z] = key.split(",").map(Number);
    if (Math.abs(x - column) > r || Math.abs(z - row) > r) {
      world.remove(group);
      group.children.forEach((mesh) => {
        if (mesh.geometry !== cube) mesh.geometry.dispose();
        if (mesh.isInstancedMesh) mesh.dispose();
      });
      chunks.delete(key);
    }
  }
}

// Nearest-filtered, original pixel textures; no downloaded Minecraft textures.
function pixelMaterial(base, seed, patches = false) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d");
  const baseColor = new THREE.Color(base);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      color.copy(baseColor).multiplyScalar(0.9 + hash(x, y, seed) * 0.19);
      if (
        patches &&
        ((x > 5 && x < 15 && y > 5 && y < 24) ||
          (x > 20 && y > 18) ||
          (x > 9 && x < 19 && y > 12 && y < 20))
      )
        color.set("#dfd5b8").multiplyScalar(0.94 + hash(x, y, seed + 1) * 0.1);
      ctx.fillStyle = "#" + color.getHexString();
      ctx.fillRect(x, y, 1, 1);
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  
  return new THREE.MeshStandardMaterial({ map, roughness: 0.91 });
}

const coat = pixelMaterial("#885338", 41);
const pinto = pixelMaterial("#885338", 42, true);
const darkCoat = pixelMaterial("#70412d", 43);
const sock = pixelMaterial("#ded6bc", 44);
const muzzleMat = pixelMaterial("#b48c66", 45);
const maneMat = pixelMaterial("#352d29", 46);
const hoofMat = pixelMaterial("#48443d", 47);
const eyeMat = new THREE.MeshStandardMaterial({
  color: "#141b1b",
  roughness: 0.33
});
const glintMat = new THREE.MeshStandardMaterial({
  color: "#eee8ce",
  roughness: 0.5
});
const earMat = new THREE.MeshStandardMaterial({
  color: "#b07a60",
  roughness: 1
});

function box(parent, material, size, position, rotation) {
  const mesh = new THREE.Mesh(cube, material);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const horse = new THREE.Group();
scene.add(horse);

const body = new THREE.Group();
horse.add(body);

box(body, pinto, [0.73, 0.77, 1.5], [0, 0, 0]);
box(body, coat, [0.78, 0.67, 0.43], [0, 0.005, 0.54]);
box(body, pinto, [0.8, 0.72, 0.47], [0, 0.015, -0.55]);
box(body, darkCoat, [0.56, 0.11, 1.28], [0, 0.36, -0.03]);
box(body, coat, [0.52, 0.15, 1.07], [0, -0.37, 0.03]);

const neck = new THREE.Group();
neck.position.set(0, 0.23, 0.62);
body.add(neck);

neck.rotation.x = 0.43;
box(neck, coat, [0.47, 0.92, 0.45], [0, 0.35, 0]);
box(neck, pinto, [0.44, 0.3, 0.42], [0, 0.69, 0.015]);

for (let i = 0; i < 6; i++)
  box(neck, maneMat, [0.16, 0.18, 0.13], [0, 0.04 + i * 0.14, -0.255]);

const head = new THREE.Group();
head.position.set(0, 0.83, 0.055);
head.rotation.x = -0.28;
neck.add(head);
box(head, coat, [0.46, 0.48, 0.63], [0, 0, 0.05]);
box(head, muzzleMat, [0.47, 0.31, 0.36], [0, -0.16, 0.4]);
box(head, sock, [0.105, 0.39, 0.018], [0, 0.02, 0.374]);
box(head, sock, [0.13, 0.04, 0.32], [0, 0.246, 0.09]);
box(head, hoofMat, [0.33, 0.018, 0.025], [0, -0.24, 0.588]);

for (const side of [-1, 1]) {
  box(head, eyeMat, [0.026, 0.097, 0.105], [side * 0.238, 0.066, 0.087]);
  box(head, glintMat, [0.029, 0.031, 0.026], [side * 0.24, 0.087, 0.112]);
  box(head, hoofMat, [0.075, 0.065, 0.018], [side * 0.142, -0.115, 0.587]);
}

const ears = [];
for (const side of [-1, 1]) {
  const ear = new THREE.Group();
  ear.position.set(side * 0.17, 0.23, -0.12);
  ear.rotation.z = -side * 0.12;
  box(ear, coat, [0.12, 0.25, 0.14], [0, 0.12, 0]);
  box(ear, earMat, [0.067, 0.16, 0.015], [0, 0.13, 0.078]);
  head.add(ear);
  ears.push(ear);
}
box(head, maneMat, [0.23, 0.18, 0.22], [0, 0.22, -0.19], [-0.24, 0, 0]);

const tail = new THREE.Group();
tail.position.set(0, 0.19, -0.81);
body.add(tail);
const tailLinks = [];
let parentTail = tail;
for (let i = 0; i < 4; i++) {
  const link = new THREE.Group();
  if (i) link.position.y = -0.26;
  parentTail.add(link);
  box(link, maneMat, [0.18 + i * 0.025, 0.32, 0.18 + i * 0.018], [0, -0.14, 0]);
  tailLinks.push(link);
  parentTail = link;
}

// Four asymmetric contacts: right hind, left hind, right fore, left fore.
// Each stance foot travels backward at precisely the terrain's velocity.
const legs = [];
const hipVec = new THREE.Vector3();
const unitY = new THREE.Vector3(0, 1, 0),
  dirVec = new THREE.Vector3(),
  midVec = new THREE.Vector3();

function segment(parent, material, width, depth) {
  return box(parent, material, [width, 1, depth], [0, 0, 0]);
}

for (const config of [
  { name: "RH", side: -1, front: false, offset: 0 },
  { name: "LH", side: 1, front: false, offset: 0.12 },
  { name: "RF", side: -1, front: true, offset: 0.43 },
  { name: "LF", side: 1, front: true, offset: 0.55 }
]) {
  const g = new THREE.Group();
  horse.add(g);
  const leg = {
    ...config,
    group: g,
    upper: segment(g, coat, 0.235, 0.25),
    lower: segment(g, config.side === 1 ? sock : coat, 0.14, 0.16),
    joint: box(g, coat, [0.19, 0.19, 0.19], [0, 0, 0]),
    hoof: box(g, hoofMat, [0.19, 0.19, 0.25], [0, 0, 0]),
    wasDown: false,
    hip: new THREE.Vector3(),
    knee: new THREE.Vector3(),
    foot: new THREE.Vector3()
  };
  box(leg.hoof, glintMat, [0.7, 0.1, 0.02], [0, -0.08, 0.505]);
  legs.push(leg);
}

function placeSegment(mesh, a, b, width, depth) {
  dirVec.subVectors(b, a);
  const length = dirVec.length();
  midVec.addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(midVec);
  mesh.quaternion.setFromUnitVectors(unitY, dirVec.normalize());
  mesh.scale.set(width, length, depth);
}

function solveLeg(leg, phase, stride, emit) {
  const p = (phase - leg.offset + 1) % 1;
  const stance = 0.205,
    reach = 0.57;
  const back = reach - stride * stance;
  const down = p < stance;
  let z, y, pitch;
  if (down) {
    z = reach - p * stride;
    y = 0.1;
    pitch = 0;
  } else {
    const t = (p - stance) / (1 - stance);
    z = lerp(back, reach, smooth(t));
    y = 0.1 + Math.sin(Math.PI * t) * (0.63 + (leg.front ? 0.13 : 0));
    pitch = Math.sin(TAU * t) * 0.48;
  }
  hipVec
    .set(leg.side * 0.285, -0.255, leg.front ? 0.52 : -0.55)
    .applyMatrix4(body.matrix);
  leg.hip.copy(hipVec);
  leg.foot.set(
    leg.side * (0.285 + (down ? 0 : Math.sin(p * TAU) * 0.025)),
    y,
    (leg.front ? 0.52 : -0.55) + z
  );
  const dy = leg.foot.y - leg.hip.y,
    dz = leg.foot.z - leg.hip.z;
  const a = 0.61,
    b = 0.67,
    raw = Math.hypot(dy, dz),
    d = clamp(raw, 0.08, a + b - 0.001);
  const uy = dy / raw,
    uz = dz / raw;
  const along = (a * a - b * b + d * d) / (2 * d),
    bend = Math.sqrt(Math.max(0, a * a - along * along));
  const sign = leg.front ? -1 : 1;
  leg.knee.set(
    leg.hip.x,
    leg.hip.y + uy * along - uz * bend * sign,
    leg.hip.z + uz * along + uy * bend * sign
  );
  // Clamp unreachable targets to keep the bone lengths fixed.
  if (raw > d) leg.foot.set(leg.foot.x, leg.hip.y + uy * d, leg.hip.z + uz * d);
  placeSegment(
    leg.upper,
    leg.hip,
    leg.knee,
    leg.front ? 0.215 : 0.27,
    leg.front ? 0.22 : 0.3
  );
  placeSegment(leg.lower, leg.knee, leg.foot, 0.135, 0.15);
  leg.joint.position.copy(leg.knee);
  leg.hoof.position.copy(leg.foot);
  leg.hoof.rotation.x = pitch;
  if (down && !leg.wasDown && emit) hoofContact(leg.foot.x, leg.foot.z);
  leg.wasDown = down;
}

let gaitPhase = 0.17;

function animateHorse(dt, speed, emit = true) {
  const stride = 4.8 + speed * 0.07;
  gaitPhase = (gaitPhase + (dt * speed) / stride) % 1;
  const wave = TAU * gaitPhase;
  body.position.y =
    1.46 + 0.075 * Math.cos(wave + 0.55) + 0.018 * Math.sin(wave * 2);
  body.rotation.x = 0.055 * Math.sin(wave - 0.5);
  body.rotation.z = 0.022 * Math.sin(wave);
  body.updateMatrix();
  neck.rotation.x = 0.43 - 0.028 * Math.sin(wave - 0.65);
  head.rotation.x = -0.28 + 0.025 * Math.sin(wave - 1);
  ears.forEach((ear, i) => {
    ear.rotation.x =
      0.035 * Math.sin(gaitPhase * TAU * 2 + i) +
      0.07 * Math.sin(simTime * 0.63 + i * 2);
  });
  tail.rotation.x = 0.75 + 0.18 * Math.sin(wave - 1.2);
  tail.rotation.z = 0.09 * Math.sin(simTime * 2);
  tailLinks.forEach((link, i) => {
    link.rotation.x = 0.12 * Math.sin(wave - i * 0.7);
    link.rotation.z = 0.09 * Math.sin(simTime * 2.2 - i * 0.6);
  });
  for (const leg of legs) solveLeg(leg, gaitPhase, stride, emit);
}

// The farm runners have their own proportions, rigs, stride lengths and pace.
const pigPink = pixelMaterial("#da9290", 81),
  pigSnout = pixelMaterial("#c5797b", 82);
const cowPatch = pixelMaterial("#303430", 83, true),
  cowWhite = pixelMaterial("#e6ddc6", 84);
const wool = pixelMaterial("#ded9c5", 85),
  woolShade = pixelMaterial("#cac8b8", 86);
const sheepFace = pixelMaterial("#68675b", 87),
  birdWhite = pixelMaterial("#ece6ce", 88);
const yellow = pixelMaterial("#d9a044", 89),
  red = pixelMaterial("#b94938", 90);

function faceEyes(parent, width, y, z, size = 0.065) {
  for (const sign of [-1, 1]) {
    box(
      parent,
      glintMat,
      [0.018, size * 1.35, size * 1.35],
      [sign * (width / 2 + 0.006), y, z]
    );
    box(
      parent,
      eyeMat,
      [0.022, size, size * 0.68],
      [sign * (width / 2 + 0.013), y, z + 0.012]
    );
  }
}

function farmQuadruped(type) {
  const config = {
    pig: {
      width: 0.64,
      height: 0.54,
      length: 1.04,
      y: 0.73,
      upper: 0.27,
      lower: 0.29,
      hipDrop: 0.22,
      foot: 0.07,
      stride: 2.4,
      stance: 0.2,
      lift: 0.2,
      bob: 0.026,
      legWidth: 0.16,
      mat: pigPink,
      offsets: [0, 0.5, 0.5, 0]
    },
    cow: {
      width: 0.81,
      height: 0.73,
      length: 1.43,
      y: 1.1,
      upper: 0.43,
      lower: 0.45,
      hipDrop: 0.27,
      foot: 0.085,
      stride: 3.6,
      stance: 0.205,
      lift: 0.37,
      bob: 0.043,
      legWidth: 0.17,
      mat: cowWhite,
      offsets: [0, 0.12, 0.45, 0.57]
    },
    sheep: {
      width: 0.73,
      height: 0.63,
      length: 1.12,
      y: 0.89,
      upper: 0.33,
      lower: 0.35,
      hipDrop: 0.23,
      foot: 0.075,
      stride: 2.9,
      stance: 0.2,
      lift: 0.29,
      bob: 0.055,
      legWidth: 0.14,
      mat: sheepFace,
      offsets: [0, 0.08, 0.46, 0.54]
    }
  }[type];
  
  const root = new THREE.Group(), torso = new THREE.Group();
  root.add(torso);
  scene.add(root);
  
  const skin = type === "cow" ? cowPatch : type === "sheep" ? wool : pigPink;
  box(torso, skin, [config.width, config.height, config.length], [0, 0, 0]);
  const face = new THREE.Group();
  torso.add(face);
  const tailPivot = new THREE.Group();
  torso.add(tailPivot);
  const earPivots = [];
  
  if (type === "pig") {
    face.position.set(0, 0.015, 0.66);
    box(face, pigPink, [0.53, 0.45, 0.48], [0, 0, 0]);
    box(face, pigSnout, [0.33, 0.21, 0.18], [0, -0.07, 0.3]);
    for (const sign of [-1, 1]) {
      box(face, darkCoat, [0.052, 0.062, 0.014], [sign * 0.087, -0.07, 0.397]);
      const ear = new THREE.Group();
      ear.position.set(sign * 0.22, 0.19, -0.06);
      face.add(ear);
      box(
        ear,
        pigPink,
        [0.2, 0.17, 0.09],
        [sign * 0.035, 0.06, 0],
        [0, 0, -sign * 0.3]
      );
      earPivots.push(ear);
    }
    faceEyes(face, 0.53, 0.065, 0.065, 0.065);
    tailPivot.position.set(0, 0.08, -0.55);
    box(tailPivot, pigPink, [0.08, 0.08, 0.18], [0, 0, -0.07]);
    box(tailPivot, pigPink, [0.08, 0.16, 0.07], [0, 0.06, -0.15]);
    box(tailPivot, pigSnout, [0.12, 0.07, 0.07], [0.035, 0.14, -0.15]);
  } else if (type === "cow") {
    face.position.set(0, 0.06, 0.89);
    box(face, cowWhite, [0.49, 0.55, 0.48], [0, 0, 0]);
    box(face, pigSnout, [0.52, 0.24, 0.22], [0, -0.16, 0.27]);
    box(face, cowPatch, [0.23, 0.22, 0.03], [-0.1, 0.13, 0.25]);
    faceEyes(face, 0.49, 0.06, 0.11, 0.075);
    for (const sign of [-1, 1]) {
      box(face, hoofMat, [0.055, 0.045, 0.018], [sign * 0.14, -0.15, 0.39]);
      const ear = new THREE.Group();
      ear.position.set(sign * 0.24, 0.12, -0.06);
      face.add(ear);
      box(ear, cowPatch, [0.27, 0.11, 0.16], [sign * 0.11, 0, 0]);
      earPivots.push(ear);
      box(
        face,
        muzzleMat,
        [0.1, 0.22, 0.11],
        [sign * 0.18, 0.35, -0.09],
        [0, 0, -sign * 0.2]
      );
    }
    box(torso, pigSnout, [0.32, 0.2, 0.3], [0, -0.4, -0.31]);
    tailPivot.position.set(0, 0.2, -0.76);
    box(tailPivot, cowWhite, [0.075, 0.52, 0.075], [0, -0.22, -0.04]);
    box(tailPivot, hoofMat, [0.16, 0.2, 0.14], [0, -0.51, -0.04]);
  } else {
    // Irregular, layered fleece blocks preserve the voxel silhouette.
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 2; i++) {
        const z = (j - 1) * 0.36,
          x = (i - 0.5) * 0.39;
        box(
          torso,
          (i + j) % 2 ? wool : woolShade,
          [0.43, 0.17, 0.4],
          [x, 0.33, z]
        );
      }
    box(torso, wool, [0.78, 0.43, 0.93], [0, -0.035, 0]);
    face.position.set(0, 0.015, 0.7);
    box(face, sheepFace, [0.37, 0.43, 0.43], [0, 0, 0]);
    box(face, wool, [0.43, 0.18, 0.35], [0, 0.22, -0.035]);
    box(face, muzzleMat, [0.29, 0.15, 0.08], [0, -0.13, 0.235]);
    faceEyes(face, 0.37, 0.07, 0.075, 0.068);
    for (const sign of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(sign * 0.18, 0.12, -0.03);
      face.add(ear);
      box(ear, sheepFace, [0.2, 0.09, 0.14], [sign * 0.08, 0, 0]);
      earPivots.push(ear);
    }
    tailPivot.position.set(0, 0.05, -0.58);
    box(tailPivot, wool, [0.19, 0.27, 0.2], [0, -0.06, -0.04]);
  }
  
  const rigLegs = [];
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1,
      front = i >= 2;
    const g = new THREE.Group();
    root.add(g);
    rigLegs.push({
      side,
      front,
      offset: config.offsets[i],
      upper: segment(g, config.mat, config.legWidth, config.legWidth),
      lower: segment(
        g,
        config.mat,
        config.legWidth * 0.85,
        config.legWidth * 0.85
      ),
      hoof: box(
        g,
        type === "pig" ? pigSnout : hoofMat,
        [config.legWidth * 1.08, config.foot * 2, config.legWidth * 1.25],
        [0, 0, 0]
      ),
      hip: new THREE.Vector3(),
      knee: new THREE.Vector3(),
      foot: new THREE.Vector3(),
      wasDown: false
    });
  }
  
  let phase = type === "pig" ? 0.15 : type === "cow" ? 0.45 : 0.7;
  
  function animate(dt, speed, emit, runner) {
    phase = (phase + (dt * speed) / config.stride) % 1;
    const wave = phase * TAU;
    torso.position.y =
      config.y + config.bob * Math.cos(wave * (type === "pig" ? 2 : 1));
    torso.rotation.x = (type === "pig" ? 0.025 : 0.04) * Math.sin(wave);
    torso.updateMatrix();
    face.rotation.x = 0.035 * Math.sin(wave - 0.6);
    tailPivot.rotation.x = 0.18 * Math.sin(wave - 0.9);
    tailPivot.rotation.z = 0.13 * Math.sin(simTime * 3);
    earPivots.forEach((ear, i) => {
      ear.rotation.z = 0.07 * Math.sin(wave + i);
    });
    for (const leg of rigLegs) {
      const p = (phase - leg.offset + 1) % 1,
        down = p < config.stance,
        reach = (config.stride * config.stance) / 2;
      let z,
        y = config.foot;
      if (down) z = reach - p * config.stride;
      else {
        const t = (p - config.stance) / (1 - config.stance);
        z = lerp(-reach, reach, smooth(t));
        y += Math.sin(Math.PI * t) * config.lift;
      }
      const hipZ = (leg.front ? 1 : -1) * config.length * 0.33;
      leg.hip
        .set(leg.side * config.width * 0.34, -config.hipDrop, hipZ)
        .applyMatrix4(torso.matrix);
      leg.foot.set(leg.side * config.width * 0.34, y, hipZ + z);
      const dy = y - leg.hip.y,
        dz = leg.foot.z - leg.hip.z,
        raw = Math.hypot(dy, dz),
        d = clamp(raw, 0.03, config.upper + config.lower - 0.001);
      const uy = dy / raw,
        uz = dz / raw,
        a = (config.upper ** 2 - config.lower ** 2 + d * d) / (2 * d),
        bend = Math.sqrt(Math.max(0, config.upper ** 2 - a * a)),
        sign = leg.front ? -1 : 1;
      leg.knee.set(
        leg.hip.x,
        leg.hip.y + uy * a - uz * bend * sign,
        leg.hip.z + uz * a + uy * bend * sign
      );
      if (raw > d)
        leg.foot.set(leg.foot.x, leg.hip.y + uy * d, leg.hip.z + uz * d);
      placeSegment(
        leg.upper,
        leg.hip,
        leg.knee,
        config.legWidth,
        config.legWidth
      );
      placeSegment(
        leg.lower,
        leg.knee,
        leg.foot,
        config.legWidth * 0.8,
        config.legWidth * 0.85
      );
      leg.hoof.position.copy(leg.foot);
      leg.hoof.rotation.x = down ? 0 : 0.28 * Math.sin(p * TAU);
      if (down && !leg.wasDown && emit)
        hoofContact(leg.foot.x, leg.foot.z, runner, 2, 0.7);
      leg.wasDown = down;
    }
  }
  return { mesh: root, animate };
}

function makeChicken() {
  const root = new THREE.Group(), torso = new THREE.Group();
  root.add(torso);
  scene.add(root);
  root.scale.setScalar(0.8);
  box(torso, birdWhite, [0.38, 0.42, 0.51], [0, 0, 0]);
  box(torso, birdWhite, [0.22, 0.31, 0.23], [0, 0.24, 0.16]);
  
  const face = new THREE.Group();
  face.position.set(0, 0.4, 0.23);
  torso.add(face);
  box(face, birdWhite, [0.3, 0.3, 0.3], [0, 0, 0]);
  faceEyes(face, 0.3, 0.035, 0.04, 0.045);
  box(face, yellow, [0.17, 0.1, 0.19], [0, -0.025, 0.22]);
  box(face, red, [0.1, 0.14, 0.1], [0, -0.14, 0.15]);
  for (let i = 0; i < 3; i++)
    box(
      face,
      red,
      [0.075, 0.11 + (i % 2) * 0.04, 0.075],
      [0, 0.19, (i - 1) * 0.075]
    );
  box(torso, birdWhite, [0.24, 0.28, 0.19], [0, 0.13, -0.29], [0.55, 0, 0]);
  
  const wings = [];
  for (const sign of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(sign * 0.18, 0.04, -0.015);
    torso.add(wing);
    box(wing, birdWhite, [0.11, 0.29, 0.43], [sign * 0.06, -0.09, 0]);
    box(wing, woolShade, [0.12, 0.1, 0.39], [sign * 0.065, -0.23, -0.02]);
    wings.push(wing);
  }
  
  const birdLegs = [];
  for (const sign of [-1, 1]) {
    const pivot = new THREE.Group();
    root.add(pivot);
    box(pivot, yellow, [0.045, 0.32, 0.045], [0, -0.16, 0]);
    for (let i = 0; i < 3; i++)
      box(pivot, yellow, [0.026, 0.035, 0.17], [0.035 * (i - 1), -0.32, 0.055]);
    birdLegs.push({ pivot, sign, wasDown: false });
  }
  
  let phase = 0.2;
  const rig = {
    mesh: root,
    air: 0,
    animate(dt, speed, emit, runner) {
      phase = (phase + (dt * speed) / 1.65) % 1;
      const flightTime = (simTime + 1.25) % 6.2;
      rig.air =
        flightTime > 3.8 ? Math.sin((Math.PI * (flightTime - 3.8)) / 2.4) : 0;
      const height = 0.82 * rig.air;
      torso.position.y = 0.55 + height + 0.025 * Math.sin(phase * TAU * 2);
      torso.rotation.x = -0.12 * rig.air + 0.035 * Math.sin(phase * TAU);
      face.rotation.x = 0.055 * Math.sin(phase * TAU - 0.5);
      const flap = Math.sin(simTime * (rig.air > 0.05 ? 30 : 12));
      wings.forEach((wing, i) => {
        const sign = i ? 1 : -1;
        wing.rotation.z = sign * (0.13 + rig.air * (0.75 + 0.65 * flap));
      });
      for (const leg of birdLegs) {
        const p = (phase + (leg.sign > 0 ? 0.5 : 0)) % 1,
          down = p < 0.5 && rig.air < 0.03;
        leg.pivot.position.set(leg.sign * 0.1, 0.38 + height, 0);
        leg.pivot.rotation.x =
          rig.air > 0.05
            ? -0.45 + 0.22 * Math.sin(phase * TAU)
            : 0.65 * Math.sin(p * TAU);
        leg.pivot.position.y += Math.max(0, Math.sin(p * TAU)) * 0.045;
        if (down && !leg.wasDown && emit)
          hoofContact(leg.sign * 0.1, 0.08, runner, 1, 0.35);
        leg.wasDown = down;
      }
    }
  };
  return rig;
}

const pigRig = farmQuadruped("pig"),
  cowRig = farmQuadruped("cow"),
  sheepRig = farmQuadruped("sheep"),
  chickenRig = makeChicken();

const runners = [
  {
    id: "horse",
    name: "Horse",
    mesh: horse,
    factor: 1,
    lane: 0,
    start: 0,
    height: 1.25,
    zoom: 1,
    mapColor: "#e3b979",
    animate: animateHorse
  },
  {
    id: "pig",
    name: "Pig",
    ...pigRig,
    factor: 0.88,
    lane: -1.8,
    start: -2.4,
    height: 0.65,
    zoom: 0.76,
    mapColor: "#f1a8ad"
  },
  {
    id: "cow",
    name: "Cow",
    ...cowRig,
    factor: 0.91,
    lane: 1.6,
    start: -3.8,
    height: 1.0,
    zoom: 0.92,
    mapColor: "#f2ecd9"
  },
  {
    id: "sheep",
    name: "Sheep",
    ...sheepRig,
    factor: 0.94,
    lane: -0.85,
    start: -6.5,
    height: 0.82,
    zoom: 0.82,
    mapColor: "#c9d9d0"
  },
  {
    id: "chicken",
    name: "Chicken",
    ...chickenRig,
    factor: 0.84,
    lane: 2.55,
    start: 1.8,
    height: 0.72,
    zoom: 0.66,
    mapColor: "#f3d369"
  }
].map((a) => ({
  ...a,
  distance: 0,
  speed: 0,
  position: new THREE.Vector3(),
  heading: 0,
  tangent: new THREE.Vector3()
}));

const horseRunner = runners[0];

for (const animal of runners) animal.mesh.userData.runnerId = animal.id;

function advanceAnimals(dt, emit = true) {
  for (const animal of runners) {
    animal.speed =
      pace *
      animal.factor *
      (animal.id === "chicken" ? 1 + chickenRig.air * 0.12 : 1);
    animal.distance += animal.speed * dt;
    const u =
      ((((animal.distance + animal.start) % courseLength) + courseLength) %
        courseLength) /
      courseLength;
    course.getPointAt(u, animal.position);
    course.getTangentAt(u, animal.tangent);
    animal.heading = Math.atan2(animal.tangent.x, animal.tangent.z);
    animal.position.x += animal.tangent.z * animal.lane;
    animal.position.z -= animal.tangent.x * animal.lane;
    animal.animate(dt, animal.speed, emit, animal);
  }
  distance = horseRunner.distance;
}

function focusAnimal(id) {
  if (id === focusedId || !runners.some((a) => a.id === id)) return;
  focusShift = { from: runnerPosition.clone(), heading, time: 0 };
  focusedId = id;
  animalButtons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.animal === id))
  );
  resetView();
}

const dustMaterial = new THREE.MeshStandardMaterial({
  color: "#d0b48a",
  roughness: 1
});

const dustMesh = new THREE.InstancedMesh(cube, dustMaterial, CFG.dustCount);
dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
dustMesh.frustumCulled = false;
scene.add(dustMesh);

const dust = Array.from({ length: CFG.dustCount }, () => ({
  life: 0,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  size: 0,
  spin: 0
}));

let dustCursor = 0;
const printGeometry = new THREE.PlaneGeometry(0.18, 0.24);
printGeometry.rotateX(-Math.PI / 2);
const printMaterial = new THREE.MeshStandardMaterial({
  color: "#8a7b53",
  roughness: 1,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1
});
const printsMesh = new THREE.InstancedMesh(
  printGeometry,
  printMaterial,
  CFG.printCount
);
printsMesh.frustumCulled = false;
scene.add(printsMesh);
const prints = Array.from({ length: CFG.printCount }, () => ({
  active: false,
  x: 0,
  z: 0
}));

let printCursor = 0;
function hoofContact(x, z, animal = horseRunner, count = 5, scale = 1) {
  x *= animal.mesh.scale.x;
  z *= animal.mesh.scale.z;
  const c = Math.cos(animal.heading),
    s = Math.sin(animal.heading);
  const wx = animal.position.x + x * c + z * s,
    wz = animal.position.z - x * s + z * c;
  const mark = prints[printCursor++ % prints.length];
  mark.active = true;
  mark.x = wx;
  mark.z = wz;
  mark.yaw = animal.heading;
  mark.scale = scale;
  for (let i = 0; i < count; i++) {
    const p = dust[dustCursor++ % dust.length];
    const r = hash(dustCursor, printCursor, 40);
    const lateral = (hash(dustCursor, 0, 41) - 0.5) * 1.1,
      backward = -0.5 - r * 0.6;
    Object.assign(p, {
      life: 0.42 + r * 0.4,
      x: wx + (r - 0.5) * 0.12,
      y: 0.11,
      z: wz,
      vx: lateral * c + backward * s,
      vy: (0.65 + r * 0.7) * scale,
      vz: -lateral * s + backward * c,
      size: (0.035 + r * 0.055) * scale,
      spin: r * 6
    });
  }
}

function updateParticles(dt) {
  dust.forEach((p, i) => {
    p.life = Math.max(0, p.life - dt);
    if (p.life > 0) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 1.8 * dt;
      const s = p.size * Math.min(1, p.life * 4);
      dummy.position.set(
        p.x - runnerPosition.x,
        Math.max(0.03, p.y),
        p.z - runnerPosition.z
      );
      dummy.scale.setScalar(s);
      dummy.rotation.set(p.spin + simTime, p.spin, simTime * 0.7);
      dummy.updateMatrix();
      dustMesh.setMatrixAt(i, dummy.matrix);
    } else matrixAt(dustMesh, i, 0, -5, 0, 0, 0, 0);
  });
  
  prints.forEach((p, i) => {
    const x = p.x - runnerPosition.x,
      z = p.z - runnerPosition.z;
    if (p.active && Math.hypot(x, z) < 55)
      matrixAt(printsMesh, i, x, 0.008, z, p.scale, 1, p.scale, p.yaw);
    else {
      p.active = false;
      matrixAt(printsMesh, i, 0, -5, 0, 0, 0, 0);
    }
  });
  dustMesh.instanceMatrix.needsUpdate = true;
  printsMesh.instanceMatrix.needsUpdate = true;
}

// Drifting, stepped cloud banks stay at a comfortable distance from the model.
const cloudMat = new THREE.MeshStandardMaterial({
  color: "#f1eee0",
  roughness: 1
});
const cloudGroup = new THREE.Group();
world.add(cloudGroup);

for (let i = 0; i < 17; i++) {
  const cluster = new THREE.Group();
  cluster.position.set(
    50 + (hash(i, 0, 70) - 0.5) * 260,
    21 + hash(i, 0, 71) * 17,
    (hash(i, 0, 72) - 0.5) * 280
  );
  for (let j = 0; j < 4; j++)
    box(
      cluster,
      cloudMat,
      [5 + (j % 2) * 3, 1.1 + (j % 2) * 0.65, 3.5 + (j % 2) * 2],
      [(j - 1.5) * 3, (j % 2) * 0.6, 0]
    );
  cluster.children.forEach((m) => {
    m.castShadow = false;
  });
  cloudGroup.add(cluster);
}

// Route-side stakes and a checkered lap line make the course easy to read.
const markerCount = Math.floor(courseLength / 14);
const markers = new THREE.InstancedMesh(
  cube,
  new THREE.MeshStandardMaterial({ roughness: 1 }),
  markerCount * 4
);
const markerPoint = new THREE.Vector3(),
  markerTangent = new THREE.Vector3();

for (let i = 0; i < markerCount; i++) {
  course.getPointAt(i / markerCount, markerPoint);
  course.getTangentAt(i / markerCount, markerTangent);
  for (let side = 0; side < 2; side++) {
    const sign = side ? 1 : -1,
      x = markerPoint.x + markerTangent.z * 4 * sign,
      z = markerPoint.z - markerTangent.x * 4 * sign;
    const index = i * 4 + side * 2;
    matrixAt(markers, index, x, 0.4, z, 0.14, 0.8, 0.14);
    markers.setColorAt(index, new THREE.Color("#79593d"));
    matrixAt(markers, index + 1, x, 0.82, z, 0.18, 0.14, 0.18);
    markers.setColorAt(
      index + 1,
      new THREE.Color(side ? "#e4d8ab" : "#b0784e")
    );
  }
}

markers.castShadow = true;
markers.receiveShadow = true;
world.add(markers);

const lapLine = new THREE.InstancedMesh(
  cube,
  new THREE.MeshStandardMaterial({ roughness: 1 }),
  16
);

const startTangent = course.getTangentAt(0),
  startYaw = Math.atan2(startTangent.x, startTangent.z);

for (let i = 0; i < 8; i++)
  for (let j = 0; j < 2; j++) {
    const across = (i - 3.5) * 0.75,
      along = (j - 0.5) * 0.45,
      index = i * 2 + j;
    matrixAt(
      lapLine,
      index,
      across * Math.cos(startYaw) + along * Math.sin(startYaw),
      0.009,
      -across * Math.sin(startYaw) + along * Math.cos(startYaw),
      0.75,
      0.016,
      0.45,
      startYaw
    );
    lapLine.setColorAt(
      index,
      new THREE.Color((i + j) % 2 ? "#ece3c9" : "#554c3e")
    );
  }
lapLine.receiveShadow = true;
world.add(lapLine);

const mapCanvas = $("course-map"),
  mapCtx = mapCanvas.getContext("2d");

function drawCourseMap() {
  const mapPoint = (p) => [13 + (p.x + 18) * 0.77, 12 + (110 - p.z) * 0.44];
  mapCtx.clearRect(0, 0, 140, 112);
  mapCtx.lineWidth = 4;
  mapCtx.strokeStyle = "#f6edd295";
  mapCtx.beginPath();
  courseSamples.forEach((p, i) => {
    const [x, y] = mapPoint(p);
    if (i) mapCtx.lineTo(x, y);
    else mapCtx.moveTo(x, y);
  });
  mapCtx.closePath();
  mapCtx.stroke();
  const [sx, sy] = mapPoint(courseSamples[0]);
  mapCtx.fillStyle = "#f7edcc";
  mapCtx.fillRect(sx - 3, sy - 3, 6, 6);
  for (const animal of runners) {
    const [x, y] = mapPoint(animal.position),
      selected = animal.id === focusedId;
    if (selected) {
      mapCtx.strokeStyle = "#fff7df";
      mapCtx.lineWidth = 1.5;
      mapCtx.strokeRect(x - 5, y - 5, 10, 10);
    }
    mapCtx.fillStyle = "#374337";
    mapCtx.fillRect(x - 3, y - 3, 6, 6);
    mapCtx.fillStyle = animal.mapColor;
    mapCtx.fillRect(x - 2, y - 2, 4, 4);
  }
}

let paused = false,
  slow = false,
  pace = 8.5,
  simTime = 0;
let cameraTween = null;

const views = {
  three: new THREE.Vector3(5.6, 3.25, 6.6),
  side: new THREE.Vector3(7.8, 2.8, 0.15),
  chase: new THREE.Vector3(3, 3.5, -7.3),
  wide: new THREE.Vector3(18, 26, -23)
};

const defaultTarget = new THREE.Vector3(0, 1.25, 0.1);
const presetTarget = new THREE.Vector3(0, 1.25, 0.1);

function resetView(immediate = false) {
  const selected = runners.find((a) => a.id === focusedId);
  defaultTarget.set(0, selected.height, 0.1);
  const fit =
    $("view").value === "wide"
      ? 1
      : clamp(0.85 / camera.aspect, 1, 1.4) * selected.zoom;
  const offset = views[$("view").value]
    .clone()
    .sub(presetTarget)
    .multiplyScalar(fit);
  // View the inside-lane animals from the outside of their lane so larger
  // neighbors do not hide them when the camera arrives at the new target.
  if (selected.lane < 0) offset.x *= -1;
  const end = offset.applyAxisAngle(turnAxis, heading).add(defaultTarget);
  if (immediate) {
    camera.position.copy(end);
    controls.target.copy(defaultTarget);
    controls.update();
  } else
    cameraTween = {
      time: 0,
      from: camera.position.clone(),
      to: end.clone(),
      target: controls.target.clone()
    };
}

controls.addEventListener("start", () => {
  cameraTween = null;
});

$("pause").addEventListener("click", () => {
  paused = !paused;
  $("pause").textContent = paused ? "Resume" : "Pause";
  $("pause").setAttribute("aria-pressed", String(paused));
});

$("slow").addEventListener("click", () => {
  slow = !slow;
  $("slow").setAttribute("aria-pressed", String(slow));
});

$("speed").addEventListener("input", (e) => {
  pace = Number(e.target.value);
  $("pace").value = `${pace.toFixed(1)} m/s`;
});

$("view").addEventListener("change", () => resetView());
animalButtons.forEach((button) =>
  button.addEventListener("click", () => focusAnimal(button.dataset.animal))
);

$("reset").addEventListener("click", () => resetView());
const picker = new THREE.Raycaster(),
  pointer = new THREE.Vector2();

let pointerStart = null;
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button === 0) pointerStart = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener("pointercancel", () => {
  pointerStart = null;
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (e.button !== 0 || !pointerStart) return;
  const start = pointerStart;
  pointerStart = null;
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1
  );
  picker.setFromCamera(pointer, camera);
  const hit = picker.intersectObjects(
    runners.map((a) => a.mesh),
    true
  )[0];
  if (hit) {
    let obj = hit.object;
    while (obj && !obj.userData.runnerId) obj = obj.parent;
    if (obj) focusAnimal(obj.userData.runnerId);
  }
});

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function syncFullscreen() {
  const active = !!fullscreenElement();
  $("fullscreen").textContent = active ? "Exit fullscreen" : "Fullscreen";
  $("fullscreen").setAttribute("aria-pressed", String(active));
  resizeScene();
}

let noticeTimer;
function notifyUser(message) {
  $("notice").textContent = message;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    $("notice").hidden = true;
  }, 6500);
}

async function toggleFullscreen() {
  try {
    if (fullscreenElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) await exit.call(document);
    } else {
      const enter =
        document.documentElement.requestFullscreen ||
        document.documentElement.webkitRequestFullscreen;
      if (!enter) throw new Error("Fullscreen unavailable");
      await enter.call(document.documentElement);
    }
    syncFullscreen();
  } catch {
    notifyUser(
      "Fullscreen is blocked in this preview. Open the Pen in Full Page view, then use Fullscreen."
    );
  }
}

$("fullscreen").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("webkitfullscreenchange", syncFullscreen);

window.addEventListener("keydown", (e) => {
  if (
    /INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(e.target.tagName) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    $("pause").click();
  }
  if (e.code === "KeyR") resetView();
  if (e.code === "KeyF") {
    e.preventDefault();
    toggleFullscreen();
  }
  if (/^Digit[1-5]$/.test(e.code))
    focusAnimal(runners[Number(e.code.slice(-1)) - 1].id);
});

function resizeScene() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener("resize", resizeScene);

let last = performance.now(),
  hidden = document.hidden;
document.addEventListener("visibilitychange", () => {
  hidden = document.hidden;
  last = performance.now();
});

renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  $("status").hidden = false;
  $("status").textContent =
    "The graphics context was interrupted. Reload the Pen to restart.";
});

advanceAnimals(0, false);
updateRunner();
resetView(true);
streamTerrain();
updateParticles(0);
drawCourseMap();

$("status").hidden = true;

function frame(now) {
  requestAnimationFrame(frame);
  const visualDt = clamp((now - last) / 1000, 0, 0.25),
    realDt = Math.min(visualDt, 0.05);
  last = now;
  if (hidden) return;
  
  const dt = paused ? 0 : realDt * (slow ? 0.25 : 1);
  if (dt > 0) {
    simTime += dt;
    advanceAnimals(dt);
    grassUniforms.time.value = simTime;
    cloudGroup.position.x = Math.sin(simTime * 0.008) * 9;
  }
  updateRunner(visualDt);
  streamTerrain();
  updateParticles(dt);
  
  if (cameraTween) {
    cameraTween.time += visualDt;
    const t = smooth(Math.min(cameraTween.time / 0.85, 1));
    camera.position.lerpVectors(cameraTween.from, cameraTween.to, t);
    controls.target.copy(cameraTween.target).lerp(defaultTarget, t);
    if (t === 1) cameraTween = null;
  }
  
  controls.update();
  renderer.render(scene, camera);
  drawCourseMap();
}
requestAnimationFrame(frame);
