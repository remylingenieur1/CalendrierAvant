// Guthrie Theater snow globe.
// Live: the light follows the real sun over Minneapolis and the weather follows the real weather.
// The switch previews day, sunset and night. "Let it snow" and "Purple rain" preview weather.
// Sun and moon are worked out on the page. Weather comes from Open-Meteo (free, no key).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ---------------------------------------------------------------------
// THE ROOF SIGNS. The Guthrie has two lit masts. Change the text and colours here.
// The letters stand upright, one under another. Each word comes in at the foot of the mast
// and travels up, first letter first, without end.
// You can also set them in the address: add ?sign=YOUR TEXT&sign2=OTHER TEXT to the URL.
// ---------------------------------------------------------------------
const SIGNS = [
  { text: 'WINTER IS COMING', color: '#FFFFFF', background: '#1638E0' },   // the tall mast on the roof
  { text: 'COMING SOON', color: '#FFB25E', background: '#08080E' },        // the shorter mast on the smaller block
];
const SIGN_SPEED = 0.9;             // how fast the words travel, in letters per second

const stage = document.getElementById('stage');
const $ = (id) => document.getElementById(id);
const readTemp = $('readTemp'), readSky = $('readSky'), readSun = $('readSun'), toastEl = $('toast'), announceEl = $('announce'), cursorEl = $('cursor');
const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const { degToRad: rad, radToDeg: deg, clamp, lerp, smoothstep } = THREE.MathUtils;

// =====================================================================
// Time, sun and moon for Minneapolis
// =====================================================================
const LAT = 44.9778, LON = -93.265, TZ = 'America/Chicago';
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'numeric' });
const clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

function mplsParts(ms) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = +p.value;
  return { minutes: o.hour * 60 + o.minute + o.second / 60, month: o.month };
}
const nowParts = mplsParts(Date.now());
const MIDNIGHT = Date.now() - nowParts.minutes * 60000;   // today's midnight in Minneapolis
const MONTH = nowParts.month;
const liveMinutes = () => ((Date.now() - MIDNIGHT) / 60000) % 1440;

function eclipticToHorizon(lonDeg, d) {
  const e = rad(23.439 - 0.00000036 * d), l = rad(lonDeg);
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  const ha = rad(gmst + LON) - ra, lat = rad(LAT);
  const alt = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { alt: deg(alt), az };
}
function sky(ms) {
  const d = ms / 86400000 + 2440587.5 - 2451545.0;
  const g = rad(357.529 + 0.98560028 * d), q = 280.459 + 0.98564736 * d;
  const sunLon = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
  const phase = (((d + 2451545.0 - 2451550.1) / 29.530588853) % 1 + 1) % 1;   // 0 new, 0.5 full
  return { sun: eclipticToHorizon(sunLon, d), moon: eclipticToHorizon(sunLon + phase * 360, d), phase };
}
// North is -z and east is +x, so the midday sun stands in front of the building.
const dirFrom = (altDeg, az, out) => {
  const a = rad(altDeg);
  return out.set(Math.sin(az) * Math.cos(a), Math.sin(a), -Math.cos(az) * Math.cos(a));
};

let SUNRISE = 420, SUNSET = 1020;
{
  let prev = sky(MIDNIGHT).sun.alt;
  for (let m = 1; m < 1440; m++) {
    const a = sky(MIDNIGHT + m * 60000).sun.alt;
    if (prev < -0.833 && a >= -0.833) SUNRISE = m;
    if (prev >= -0.833 && a < -0.833) SUNSET = m;
    prev = a;
  }
}
const PRESET_MIN = { light: 780, sunset: SUNSET - 8, dark: 1290 };       // 1 PM, just before sunset, 9:30 PM
const moodFor = (alt) => (alt > 6 ? 'light' : alt > -6 ? 'sunset' : 'dark');

// =====================================================================
// Renderer, scene, camera
// =====================================================================
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  root.classList.add('no-gl');
  root.classList.remove('is-instant');
  throw e;
}
// The canvas is see-through around the globe, so the page's own colour shows behind it.
renderer.setClearColor(0x000000, 0);
// Phones and tablets draw fewer pixels from the start, so taps are answered straight away.
const touchDevice = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, touchDevice ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(26, 1, 4, 70);
const TARGET = new THREE.Vector3(0, 0.78, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(TARGET);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;
controls.minPolarAngle = rad(46);
controls.maxPolarAngle = rad(86);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: touchDevice ? 2 : 4 }));
composer.addPass(new RenderPass(scene, camera, null, new THREE.Color(0x000000), 0));
const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.3, 0.5, 1.0);
// Glow is added to the colour only. It must not make the see-through page behind the globe any more solid.
const addColourOnly = (m) => { m.blending = THREE.CustomBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; };
addColourOnly(bloom.blendMaterial);
composer.addPass(bloom);
// Tilt-shift: sharp around the building, soft towards the edges, as in a photo of a real miniature.
const tilt = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: new THREE.Vector2(0.5, 0.5) }, uAmount: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uRes, uFocus; uniform float uAmount; varying vec2 vUv;
    void main(){
      vec2 d = (vUv - uFocus) * vec2(uRes.x / uRes.y * 0.62, 1.0);
      if (d.y < 0.0) d.y *= 0.35;                       // keep the base and its plate sharp
      float r = smoothstep(0.15, 0.5, length(d)) * uAmount;
      vec4 c = texture2D(tDiffuse, vUv);
      if (r > 0.02) {
        vec2 px = r / uRes;
        for (int i = 0; i < 14; i++) {
          float a = float(i) * 2.39996, q = sqrt((float(i) + 0.5) / 14.0);
          c += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * q * px);
        }
        c /= 15.0;
      }
      gl_FragColor = c;
    }`,
});
composer.addPass(tilt);
composer.addPass(new OutputPass());
scene.fog = new THREE.Fog(0x000000, 10, 40);          // a little haze: the far side of the globe is softer than the near side

// ---------- Lights ----------
const hemi = new THREE.HemisphereLight(0xffffff, 0x1a1626, 0.4);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffffff, 2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.setScalar(touchDevice ? 1024 : 2048);
Object.assign(sunLight.shadow.camera, { left: -3.3, right: 3.3, top: 3.3, bottom: -3.3, near: 1, far: 26 });
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.02; sunLight.shadow.radius = 4;
scene.add(sunLight, sunLight.target);
const lobbyLight = new THREE.PointLight(0xFFC98A, 0, 2.6, 1.6);
scene.add(lobbyLight);

// =====================================================================
// Helpers
// =====================================================================
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mats = new Map();
const mat = (hex, extra) => {
  const key = hex + JSON.stringify(extra || {});
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0, ...extra }));
  return mats.get(key);
};
const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

function box(w, h, d, material, r = 0.005) {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
  g.translate(0, h / 2, 0);                         // origin at the base
  return shadowed(new THREE.Mesh(g, typeof material === 'number' ? mat(material) : material));
}
function cyl(r, h, material, seg = 64) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(0, h / 2, 0);
  return shadowed(new THREE.Mesh(g, typeof material === 'number' ? mat(material) : material));
}
function canvasTex(size, draw, repX = 1, repY = 1, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repX, repY); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const speckle = (lo, hi, n) => (c, s) => {
  c.fillStyle = '#fff'; c.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) {
    const v = Math.round(lo + Math.random() * (hi - lo));
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
  }
};

// The Guthrie's skin: glossy midnight-blue steel panels that mirror the sky.
// Each panel has its own slight tone, and the joints between panels are grooves.
// The panels are long horizontal bands on a square grid, as on the real building. Each one has
// its own slight tone and its own slight tilt, so the mirrored sky ripples from panel to panel.
const PANEL_COLS = 2, PANEL_ROWS = 8, skins = [];
const panelCells = [];
for (let r = 0; r < PANEL_ROWS; r++) for (let k = 0; k < PANEL_COLS; k++) panelCells.push({ r, k, tone: 200 + Math.floor(Math.random() * 55), tilt: Math.random() * 6.283 });
function panelGrid(c, s, alpha, width) {
  const pw = s / PANEL_COLS, ph = s / PANEL_ROWS;
  c.strokeStyle = `rgba(0,0,0,${alpha})`; c.lineWidth = width;
  for (let r = 0; r <= PANEL_ROWS; r++) { c.beginPath(); c.moveTo(0, r * ph); c.lineTo(s, r * ph); c.stroke(); }
  for (let k = 0; k <= PANEL_COLS; k++) { c.beginPath(); c.moveTo(k * pw, 0); c.lineTo(k * pw, s); c.stroke(); }
}
const panelMapTex = canvasTex(512, (c, s) => {
  const pw = s / PANEL_COLS, ph = s / PANEL_ROWS;
  for (const p of panelCells) { c.fillStyle = `rgb(${p.tone},${p.tone},${p.tone})`; c.fillRect(p.k * pw, p.r * ph, pw, ph); }
  panelGrid(c, s, 0.6, 2);
});
const panelBumpTex = canvasTex(512, (c, s) => {
  const pw = s / PANEL_COLS, ph = s / PANEL_ROWS;
  for (const p of panelCells) {
    const cx = (p.k + 0.5) * pw, cy = (p.r + 0.5) * ph, dx = Math.cos(p.tilt) * pw / 2, dy = Math.sin(p.tilt) * ph / 2;
    const g = c.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, '#5c5c5c'); g.addColorStop(1, '#b4b4b4');
    c.fillStyle = g; c.fillRect(p.k * pw, p.r * ph, pw, ph);
  }
  panelGrid(c, s, 1, 3);
}, 1, 1, false);
function skin(repX, repY) {
  const map = panelMapTex.clone(); map.repeat.set(repX, repY); map.needsUpdate = true;
  const bump = panelBumpTex.clone(); bump.repeat.set(repX, repY); bump.needsUpdate = true;
  const m = new THREE.MeshPhysicalMaterial({ color: 0x17247A, map, bumpMap: bump, bumpScale: 1.3, roughness: 0.2, metalness: 0.8,
    clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.5, emissive: 0x10209A, emissiveIntensity: 0 });
  skins.push(m);
  return m;
}
const P = 2.2;                                       // texture tiles per unit
const blueBox = (w, h, d) => box(w, h, d, skin(Math.max(w, d) * P, h * P), 0.004);
const darkBlue = new THREE.MeshPhysicalMaterial({ color: 0x141D5C, roughness: 0.3, metalness: 0.8, clearcoat: 0.4 });

const GLOW = canvasTex(128, (x) => {
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
});
GLOW.wrapS = GLOW.wrapT = THREE.ClampToEdgeWrapping;
// Flat patches of light on the ground.
function pool(w, d, material, y = 0.02) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 2;
  return m;
}
const flat = (geo, material, y) => {                // a decal on the ground
  material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2;
  const m = new THREE.Mesh(geo, material); m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;
  return m;
};

// =====================================================================
// The globe: a round glass ball on a base
// =====================================================================
const R = 2.66, CY = 0.92;                           // radius of the ball, height of its centre
const R0 = Math.sqrt(R * R - CY * CY);               // where the ball meets the base
const domeR = (y) => Math.sqrt(Math.max(0, R * R - (y - CY) * (y - CY)));
const domeY = (r) => CY + Math.sqrt(Math.max(0, R * R - r * r));
function domeGeometry(scale) {
  const pts = [], a0 = -Math.asin(CY / R);
  for (let i = 0; i <= 64; i++) {
    const a = a0 + (i / 64) * (Math.PI / 2 - a0);
    pts.push(new THREE.Vector2(Math.max(0.0001, R * scale * Math.cos(a)), CY + R * scale * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, 96);
}

const world = new THREE.Group();
scene.add(world);

const basePts = [[0, -0.5], [2.52, -0.5], [2.66, -0.46], [2.72, -0.34], [2.7, -0.16], [2.62, -0.04], [2.52, 0.02], [2.42, 0.0]]
  .map(([x, y]) => new THREE.Vector2(x, y));
const base = shadowed(new THREE.Mesh(new THREE.LatheGeometry(new THREE.SplineCurve(basePts).getPoints(48), 96),
  new THREE.MeshPhysicalMaterial({ color: 0x17121F, roughness: 0.38, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.25 })));
world.add(base);
const ring = new THREE.Mesh(new THREE.TorusGeometry(R0 + 0.01, 0.024, 16, 128),
  new THREE.MeshStandardMaterial({ color: 0xC9A45C, roughness: 0.28, metalness: 1 }));
ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
world.add(ring);
// A brass plate on the front of the base.
const plateCanvas = document.createElement('canvas'); plateCanvas.width = 1024; plateCanvas.height = 192;
const plateTex = new THREE.CanvasTexture(plateCanvas); plateTex.colorSpace = THREE.SRGBColorSpace; plateTex.anisotropy = 8;
function drawPlate() {
  const c = plateCanvas.getContext('2d'), gr = c.createLinearGradient(0, 0, 0, 192), text = 'GUTHRIE THEATER';
  gr.addColorStop(0, '#F3DDA6'); gr.addColorStop(0.5, '#D2AC62'); gr.addColorStop(1, '#A9843F');
  c.fillStyle = gr; c.fillRect(0, 0, 1024, 192);
  c.strokeStyle = 'rgba(60,40,10,.55)'; c.lineWidth = 3; c.strokeRect(14, 14, 996, 164);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '600 88px "Playfair Display", Georgia, serif';
  if ('letterSpacing' in c) c.letterSpacing = '5px';
  c.fillStyle = 'rgba(255,240,200,.55)'; c.fillText(text, 512, 103);      // a light edge under the engraving
  c.fillStyle = '#1A1005'; c.fillText(text, 512, 100);
  plateTex.needsUpdate = true;
}
drawPlate();
document.fonts?.load('600 82px "Playfair Display"').then(drawPlate);
document.fonts?.ready.then(drawPlate);
// The plate gives off a little of its own light, so it can still be read at night.
const plate = new THREE.Mesh(new THREE.CylinderGeometry(2.745, 2.745, 0.17, 48, 1, true, rad(-22 - 19), rad(38)),
  new THREE.MeshStandardMaterial({ map: plateTex, metalness: 0.75, roughness: 0.34, emissive: 0xffffff, emissiveMap: plateTex, emissiveIntensity: 0.6 }));
plate.position.y = -0.25;
world.add(plate);

const tableGlow = pool(12, 12, new THREE.MeshBasicMaterial({ map: GLOW, color: 0x3A2A5E, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }), -0.51);
const tableShadow = pool(9.5, 9.5, new THREE.MeshBasicMaterial({ map: GLOW, color: 0x1A1626, transparent: true, opacity: 0, depthWrite: false }), -0.505);
tableGlow.renderOrder = tableShadow.renderOrder = 0;
addColourOnly(tableGlow.material);
for (const m of [base.material, ring.material, plate.material, tableGlow.material, tableShadow.material]) m.fog = false;
scene.add(tableGlow, tableShadow);
// The tabletop: a wide round surface, a shade off the page colour. Its far edge is the line where the table meets the wall.
const tableTop = new THREE.Mesh(new THREE.CircleGeometry(7.2, 128), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.045, depthWrite: false, fog: false }));
tableTop.rotation.x = -Math.PI / 2; tableTop.position.y = -0.52; tableTop.renderOrder = -1;
scene.add(tableTop);

const GROUND = 0.05, GROUND_R = R0 - 0.07;
const groundMat = new THREE.MeshStandardMaterial({ color: 0x46603F, roughness: 1, map: canvasTex(512, speckle(205, 255, 9000), 5, 5) });
const groundDisc = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(GROUND_R, GROUND_R, GROUND, 96), groundMat));
groundDisc.position.y = GROUND / 2;
world.add(groundDisc);

const ground = new THREE.Group();
ground.position.y = GROUND;
world.add(ground);

const hill = shadowed(new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), groundMat));
hill.scale.set(0.78, 0.15, 0.4);
hill.position.set(0.05, 0, 1.9);
ground.add(hill);
const hill2 = hill.clone(); hill2.scale.set(0.3, 0.09, 0.55); hill2.position.set(2.08, 0, -0.55); ground.add(hill2);

// ---------- The setting: the Mississippi on the bridge side, one street under the bridge, a plaza ----------
function strip(x0, x1) {                              // the part of the round ground between two x positions
  const rr = GROUND_R - 0.004, a0 = Math.acos(clamp(x0 / rr, -1, 1)), a1 = Math.acos(clamp(x1 / rr, -1, 1)), s = new THREE.Shape();
  for (let i = 0; i <= 28; i++) { const a = lerp(a1, a0, i / 28); s[i ? 'lineTo' : 'moveTo'](rr * Math.cos(a), rr * Math.sin(a)); }
  for (let i = 28; i >= 0; i--) { const a = lerp(a1, a0, i / 28); s.lineTo(rr * Math.cos(a), -rr * Math.sin(a)); }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
const RIVER_X = -1.74, STREET_X = -1.36, STREET_W = 0.3;
const waterBump = canvasTex(256, (c, s) => {
  c.fillStyle = '#808080'; c.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) {
    const v = 90 + Math.random() * 90; c.strokeStyle = `rgba(${v},${v},${v},.5)`; c.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * s, y = Math.random() * s, l = 8 + Math.random() * 26;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y + (Math.random() - 0.5) * 6, x + l, y); c.stroke();
  }
}, 3, 9, false);
const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x0A1730, roughness: 0.07, metalness: 0.92, bumpMap: waterBump, bumpScale: 0.5, envMapIntensity: 1.7 });
ground.add(flat(strip(-GROUND_R, RIVER_X), waterMat, 0.004));
const kerbMat = new THREE.MeshStandardMaterial({ color: 0x8C8A84, roughness: 0.9, map: canvasTex(256, speckle(215, 255, 3000), 6, 6) });
ground.add(flat(strip(RIVER_X, RIVER_X + 0.06), kerbMat, 0.005));
const roadMat = new THREE.MeshStandardMaterial({ color: 0x2E2E36, roughness: 0.8, map: canvasTex(256, speckle(190, 255, 5000), 2, 26) });
ground.add(flat(strip(STREET_X - STREET_W / 2, STREET_X + STREET_W / 2), roadMat, 0.003));
const laneMat = new THREE.MeshStandardMaterial({ color: 0xB9B6A8, roughness: 0.8 });
const lane = flat(strip(STREET_X - 0.004, STREET_X + 0.004), laneMat, 0.004);
lane.material.polygonOffsetFactor = -4;
ground.add(lane);
ground.add(flat(strip(STREET_X - STREET_W / 2 - 0.022, STREET_X - STREET_W / 2), kerbMat, 0.004));
ground.add(flat(strip(STREET_X + STREET_W / 2, STREET_X + STREET_W / 2 + 0.022), kerbMat, 0.004));

// =====================================================================
// The Guthrie
// =====================================================================
const G_SCALE = 1.42, G_X = 0.35;                    // the Guthrie fills the globe
const gx = (x) => G_X + x * G_SCALE, gz = (z) => z * G_SCALE;   // building coordinates to ground coordinates
const g = new THREE.Group();
g.position.x = G_X;
g.scale.setScalar(G_SCALE);
lobbyLight.position.set(gx(0.62), 0.32, gz(0.32));
lobbyLight.distance = 3.6;
ground.add(g);
const snowCaps = [];                                  // white slabs that appear when snow lies
const SNOW_WHITE = mat(0xF3F5FA, { roughness: 0.95 });
function cap(w, d, x, y, z) {
  const m = box(w, 0.035, d, SNOW_WHITE, 0.012);
  m.position.set(x, y, z); m.castShadow = false;
  g.add(m); snowCaps.push(m);
}

// Drum: the thrust stage. A wide cylinder that overhangs a glass ground floor.
const DRUM = { x: 0.62, z: 0.32, r: 0.64, y0: 0.3, y1: 0.98 };
const drum = new THREE.Group();
drum.position.set(DRUM.x, 0, DRUM.z);
g.add(drum);
{
  const plaza = flat(new THREE.CircleGeometry(1.14, 64), kerbMat, 0.003);     // paving around the entrance
  plaza.position.x = gx(DRUM.x); plaza.position.z = gz(DRUM.z);
  ground.add(plaza);
  for (let i = 0; i < 3; i++) {                                              // three round steps up to the lobby
    const st = cyl(0.78 - i * 0.055, 0.012, kerbMat, 64); st.position.y = i * 0.012; drum.add(st);
  }
}
const lobbyMat = new THREE.MeshPhysicalMaterial({ color: 0x10151F, roughness: 0.08, metalness: 0.9, emissive: 0xFFB56B, emissiveIntensity: 0 });
const lobby = cyl(DRUM.r - 0.1, DRUM.y0 + 0.02, lobbyMat);
lobby.castShadow = false;
drum.add(lobby);
for (let i = 0; i < 36; i++) {
  const a = (i / 36) * Math.PI * 2;
  const col = box(0.014, DRUM.y0, 0.014, darkBlue, 0.002);
  col.position.set(Math.cos(a) * (DRUM.r - 0.095), 0, Math.sin(a) * (DRUM.r - 0.095));
  col.rotation.y = -a;
  drum.add(col);
}
const drumBody = cyl(DRUM.r, DRUM.y1 - DRUM.y0, skin(Math.PI * 2 * DRUM.r * P, (DRUM.y1 - DRUM.y0) * P), 128);
drumBody.position.y = DRUM.y0;
drum.add(drumBody);
const roofLip = cyl(DRUM.r - 0.03, 0.02, darkBlue, 96);
roofLip.position.y = DRUM.y1 - 0.004;
drum.add(roofLip);
{
  const c = cyl(DRUM.r - 0.05, 0.035, SNOW_WHITE, 64);
  c.position.y = DRUM.y1 + 0.012; c.castShadow = false; drum.add(c); snowCaps.push(c);
}
// Curved glass on the drum. Angles run from +x towards +z (the front).
const bigGlass = new THREE.MeshBasicMaterial({ color: 0x223044, side: THREE.DoubleSide });
function drumPanel(a0, a1, y, h) {
  const start = rad(a0), len = rad(a1 - a0);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.r + 0.004, DRUM.r + 0.004, h, 48, 1, true, Math.PI / 2 - start - len, len), bigGlass);
  m.position.y = y;
  drum.add(m);
}
drumPanel(-40, 200, 0.5, 0.04);
drumPanel(35, 62, 0.72, 0.1);
drumPanel(96, 110, 0.8, 0.16);
drumPanel(128, 150, 0.68, 0.075);
drumPanel(-20, -4, 0.76, 0.12);
// The entrance: a deep, dark cut in the drum with louvres across it.
function drumBand(a0, a1, y, h, material, out) {
  const start = rad(a0), len = rad(a1 - a0);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.r + out, DRUM.r + out, h, 48, 1, true, Math.PI / 2 - start - len, len), material);
  m.position.y = y; drum.add(m);
}
const recessMat = new THREE.MeshStandardMaterial({ color: 0x070A1C, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
drumBand(62, 96, 0.52, 0.44, recessMat, 0.006);
const louvreMat = new THREE.MeshPhysicalMaterial({ color: 0x1B2A80, roughness: 0.25, metalness: 0.8, side: THREE.DoubleSide });
for (let i = 0; i < 6; i++) drumBand(63, 95, 0.36 + i * 0.062, 0.016, louvreMat, 0.011);
// The tall printed screens around the ground floor (kept plain here).
const screenMat = new THREE.MeshBasicMaterial({ color: 0x8A8F9C, side: THREE.DoubleSide });
[[20, 44], [48, 60], [100, 122], [126, 148]].forEach(([a0, a1]) => {
  const start = rad(a0), len = rad(a1 - a0);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.r - 0.092, DRUM.r - 0.092, 0.2, 24, 1, true, Math.PI / 2 - start - len, len), screenMat);
  m.position.y = 0.16; drum.add(m);
});

// The tall red sign beside the entrance. It is lit at night.
const redCanvas = document.createElement('canvas'); redCanvas.width = 512; redCanvas.height = 1280;
const redTex = new THREE.CanvasTexture(redCanvas); redTex.colorSpace = THREE.SRGBColorSpace; redTex.anisotropy = 8;
function drawRedSign() {
  const c = redCanvas.getContext('2d');
  c.fillStyle = '#D21F2C'; c.fillRect(0, 0, 512, 1280);
  c.fillStyle = '#FFFFFF'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '500 92px Inter, Arial, sans-serif';
  if ('letterSpacing' in c) c.letterSpacing = '6px';
  c.fillText('GUTHRIE', 256, 560); c.fillText('THEATER', 256, 668);
  redTex.needsUpdate = true;
}
drawRedSign();
document.fonts?.ready.then(drawRedSign);
const redFace = new THREE.MeshBasicMaterial({ map: redTex }), redEdge = new THREE.MeshBasicMaterial({ color: 0xA81822 });
{
  const a = rad(111), w = 0.25, h = 0.64;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.014), [redEdge, redEdge, redEdge, redEdge, redFace, redEdge]);
  sign.position.set(DRUM.x + Math.cos(a) * (DRUM.r + 0.022), 0.03 + h / 2, DRUM.z + Math.sin(a) * (DRUM.r + 0.022));
  sign.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));       // flat against the drum, facing out
  sign.castShadow = true;
  g.add(sign);
}

// Lobby tower, fly tower, lower wings.
const tower = blueBox(0.5, 1.22, 0.6); tower.position.set(-0.08, 0, 0.12); g.add(tower);
const fly = blueBox(0.95, 1.52, 0.85); fly.position.set(0.2, 0, -0.62); g.add(fly);
const flyCap = box(0.6, 0.06, 0.5, darkBlue); flyCap.position.set(0.25, 1.52, -0.62); g.add(flyCap);
const wing = blueBox(0.8, 0.66, 0.6); wing.position.set(-0.5, 0, -0.66); g.add(wing);
const wing2 = blueBox(0.55, 0.86, 0.5); wing2.position.set(-0.3, 0, -0.5); g.add(wing2);
cap(0.93, 0.83, 0.2, 1.52, -0.62); cap(0.58, 0.48, 0.25, 1.58, -0.62);
cap(0.48, 0.58, -0.08, 1.22, 0.12); cap(0.78, 0.58, -0.5, 0.66, -0.66); cap(0.53, 0.48, -0.3, 0.86, -0.5);

// The LED mast on the roof. It spells the sign text from top to bottom, one letter per line,
// on all four sides, as the real mast does for the theatre's shows.
const SIGN_PX = 128, query = new URLSearchParams(location.search);
const masts = [
  { ...SIGNS[0], text: (query.get('sign') || SIGNS[0].text).toUpperCase().slice(0, 80), x: 0.02, z: -0.78, y: 1.52, w: 0.1, h: 0.72 },
  { ...SIGNS[1], text: (query.get('sign2') || SIGNS[1].text).toUpperCase().slice(0, 80), x: -0.26, z: 0.33, y: 1.22, w: 0.085, h: 0.5 },      // on the roof of the smaller block, across from the tall mast
];
const mastDark = new THREE.MeshStandardMaterial({ color: 0x0A0B12, roughness: 0.4, metalness: 0.6 });
function drawMast(m) {
  // The letters stand upright, one under another, with an empty line between words. The words
  // come in at the foot of the mast and travel up: the first letter enters first. After the last
  // word there is a gap as tall as the mast, so the mast clears before the message starts again.
  const cell = SIGN_PX * 0.96, shown = (m.h / m.w) * SIGN_PX, chars = [...m.text];
  const canvas = document.createElement('canvas');
  canvas.width = SIGN_PX; canvas.height = Math.ceil(chars.length * cell + shown);
  const c = canvas.getContext('2d');
  c.fillStyle = m.background; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = m.color; c.font = `600 ${Math.round(SIGN_PX * 0.8)}px Inter, Arial, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  chars.forEach((ch, k) => c.fillText(ch, SIGN_PX / 2, (k + 0.5) * cell + SIGN_PX * 0.03));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, shown / canvas.height);
  m.mat.map?.dispose(); m.mat.map = tex; m.mat.needsUpdate = true; m.length = canvas.height;
}
const beaconMat = new THREE.MeshBasicMaterial({ color: 0x220000 });
for (const m of masts) {
  m.mat = new THREE.MeshBasicMaterial({ fog: false });
  drawMast(m);
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(m.w, m.h, m.w), [mastDark, mastDark, mastDark, mastDark, m.mat, m.mat]));   // lit on two faces
  mesh.position.set(m.x, m.y + m.h / 2, m.z);
  g.add(mesh);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.013, 12, 8), beaconMat); b.position.set(m.x, m.y + m.h + 0.012, m.z); g.add(b);
}
document.fonts?.ready.then(() => masts.forEach(drawMast));
const stack = cyl(0.016, 0.16, darkBlue, 16); stack.position.set(0.5, 1.52, -0.4); g.add(stack);   // a small roof vent

// The yellow glass room, high on the fly tower.
const amberMat = new THREE.MeshPhysicalMaterial({ color: 0x9A6A12, roughness: 0.12, metalness: 0.35, clearcoat: 1, emissive: 0xFFA516, emissiveIntensity: 0.1 });
const amber = box(0.34, 0.17, 0.3, amberMat, 0.004);
amber.position.set(-0.37, 1.16, -0.88);
g.add(amber);
const amberBandMat = new THREE.MeshBasicMaterial({ color: 0xFFC233 });     // its two lit bands
[0.022, 0.108].forEach((y) => { const b = box(0.346, 0.04, 0.306, amberBandMat, 0.002); b.position.set(-0.37, 1.16 + y, -0.88); b.castShadow = false; g.add(b); });
cap(0.32, 0.28, -0.37, 1.33, -0.88);

// The Endless Bridge: flat on top, thinning to its tip, with nothing under it.
const BR = { len: 1.62, depth: 0.36, top: 0.86, thick: 0.3, x: -0.3, z: 0.12 };
{
  const prof = new THREE.Shape();
  prof.moveTo(0, -BR.thick); prof.lineTo(0, 0); prof.lineTo(-BR.len, 0);
  prof.lineTo(-BR.len + 0.015, -0.075); prof.lineTo(-0.42, -BR.thick); prof.closePath();
  const geo = new THREE.ExtrudeGeometry(prof, { depth: BR.depth, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  geo.translate(0, 0, -BR.depth / 2);
  const bridge = shadowed(new THREE.Mesh(geo, skin(P, P)));
  bridge.position.set(BR.x, BR.top, BR.z);
  g.add(bridge);
  const upper = blueBox(0.95, 0.1, 0.26); upper.position.set(BR.x - 0.52, BR.top, BR.z - 0.03); g.add(upper);
  cap(0.93, 0.24, BR.x - 0.52, BR.top + 0.1, BR.z - 0.03);
  cap(0.6, 0.33, BR.x - 1.3, BR.top, BR.z);
}

// ---------- Windows: one instanced mesh, each window with its own bedtime ----------
const wins = [];
function addWin(p, s, kind) {
  wins.push({ p, s, kind,
    dusk: 1 - rnd() * 6,                         // sun height at which it switches on
    bed: 570 + rnd() * 250,                      // minutes after noon: 9:30 PM to 1:40 AM
    wake: rnd() < 0.28 ? 1030 + rnd() * 110 : 0, // early risers: 5:10 AM to 7:00 AM
    owl: rnd() < 0.07, warm: rnd(), level: 0 });
}
const winZ = (x, y, z, w, h, kind = 'glass') => addWin([x, y, z], [w, h, 0.01], kind);
const winX = (x, y, z, w, h, kind = 'glass') => addWin([x, y, z], [0.01, h, w], kind);

const bz = BR.z + BR.depth / 2 + 0.005, bzb = BR.z - BR.depth / 2 - 0.005;
[[-0.2, -0.1, 0.05], [-0.38, -0.14, 0.035], [-0.52, -0.07, 0.05], [-0.66, -0.12, 0.04], [-0.8, -0.06, 0.035],
 [-0.93, -0.11, 0.045], [-1.34, -0.05, 0.03]].forEach(([dx, dy, s]) => winZ(BR.x + dx, BR.top + dy, bz, s, s));
winZ(BR.x - 1.12, BR.top - 0.085, bz + 0.003, 0.11, 0.08);
[[-0.3, -0.09, 0.045], [-0.6, -0.13, 0.04], [-0.85, -0.07, 0.05], [-1.1, -0.06, 0.035]].forEach(([dx, dy, s]) => winZ(BR.x + dx, BR.top + dy, bzb, s, s));
winX(BR.x - BR.len - 0.008, BR.top - 0.04, BR.z, BR.depth - 0.06, 0.05);      // the open end of the bridge
winZ(BR.x - 0.6, BR.top - 0.2, bz, 0.56, 0.014); winZ(BR.x - 0.6, BR.top - 0.2, bzb, 0.56, 0.014);   // the long slot along each side

const tz = 0.12 + 0.3 + 0.005, tx = -0.08 - 0.25 - 0.005;
winZ(-0.08, 0.4, tz, 0.2, 0.62, 'lobby');
winX(tx, 0.42, 0.26, 0.14, 0.6, 'lobby');
[[-0.2, 1.02, 0.07, 0.03], [0.02, 0.94, 0.1, 0.018], [-0.14, 0.82, 0.05, 0.05]].forEach(([x, y, w, h]) => winZ(x, y, tz, w, h));
[[1.05, 0.3, 0.06, 0.035], [0.98, 0.1, 0.1, 0.018], [0.3, 0.14, 0.12, 0.2]].forEach(([y, z, w, h]) => winX(tx, y, z, w, h));

const fx0 = 0.2 - 0.475 - 0.005, fx1 = 0.2 + 0.475 + 0.005, fz0 = -0.62 - 0.425 - 0.005, fz1 = -0.62 + 0.425 + 0.005;
for (let i = 0; i < 9; i++) {
  winX(fx0, 1.0 + rnd() * 0.42, -0.62 + (rnd() - 0.5) * 0.6, 0.06 + rnd() * 0.12, 0.014, 'amber');
  winZ(0.2 + (rnd() - 0.5) * 0.7, 0.9 + rnd() * 0.5, fz0, 0.06 + rnd() * 0.12, 0.014, 'amber');
  winX(fx1, 0.75 + rnd() * 0.65, -0.62 + (rnd() - 0.5) * 0.6, 0.05 + rnd() * 0.1, 0.014);
}
for (let i = 0; i < 4; i++) winZ(0.2 + (rnd() - 0.5) * 0.6, 1.1 + rnd() * 0.3, fz1, 0.08 + rnd() * 0.1, 0.014);

const wz0 = -0.66 - 0.3 - 0.005, wz1 = -0.66 + 0.3 + 0.005, wx0 = -0.5 - 0.4 - 0.005;
for (let i = 0; i < 7; i++) { winZ(-0.84 + i * 0.11, 0.42, wz0, 0.06, 0.03); winZ(-0.84 + i * 0.11, 0.22, wz0, 0.06, 0.03); }
for (let i = 0; i < 4; i++) winZ(-0.82 + i * 0.1, 0.4 - (i % 2) * 0.16, wz1, 0.05, 0.03);
for (let i = 0; i < 5; i++) winX(wx0, 0.4 - (i % 2) * 0.2, -0.9 + i * 0.12, 0.06, 0.035);

const winMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), wins.length);
{
  const d = new THREE.Object3D();
  wins.forEach((w, i) => { d.position.set(...w.p); d.scale.set(...w.s); d.updateMatrix(); winMesh.setMatrixAt(i, d.matrix); winMesh.setColorAt(i, new THREE.Color(0x223044)); });
}
g.add(winMesh);

// ---------- Conifers: many uneven tiers of boughs, each tree a little different ----------
const treeMats = [];
function conifer(x, z, s = 1) {
  const t = new THREE.Group(), tiers = 9, height = 0.44;
  const base = new THREE.Color().setHSL(0.38 + rnd() * 0.04, 0.32 + rnd() * 0.1, 0.055 + rnd() * 0.035);
  const m = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 1, flatShading: true, envMapIntensity: 0.2 });
  treeMats.push({ m, base });
  t.add(cyl(0.011, 0.09, 0x3A2C22, 7));
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1), r = lerp(0.105, 0.018, Math.pow(f, 0.85)) * (0.9 + rnd() * 0.2), h = lerp(0.1, 0.07, f);
    const geo = new THREE.ConeGeometry(r, h, 11, 2, true);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i); if (y > h / 2 - 0.001) continue;        // keep the tip
      const j = 1 + (rnd() - 0.5) * 0.42;
      pos.setXYZ(i, pos.getX(i) * j, y - (rnd() * 0.018) * (1 - (y + h / 2) / h), pos.getZ(i) * j);
    }
    geo.computeVertexNormals();
    const c = shadowed(new THREE.Mesh(geo, m));
    c.position.y = 0.06 + f * (height - 0.12) + h / 2; c.rotation.y = rnd() * 6.283;
    t.add(c);
  }
  t.position.set(x, 0, z); t.rotation.y = rnd() * 6.283; t.scale.set(s, s * (0.9 + rnd() * 0.25), s);
  ground.add(t);
}
[[2.0, -0.95, 1.6], [1.75, -1.5, 1.25], [0.25, -2.05, 1.5], [-0.55, -1.98, 1.2], [-0.92, -1.72, 1.55],
 [1.25, 1.95, 1.4], [-0.55, 1.3, 1.25], [-0.85, 1.78, 1.6], [2.15, -0.3, 1.1]].forEach(([x, z, s]) => conifer(x, z, s));

// ---------- Street lamps ----------
const lampMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const lampPoolMat = new THREE.MeshBasicMaterial({ map: GLOW, color: 0xFFC27A, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const poleMat = mat(0x15131C, { roughness: 0.5, metalness: 0.6 });
[[STREET_X + STREET_W / 2 + 0.07, -1.55, Math.PI], [STREET_X + STREET_W / 2 + 0.07, -0.72, Math.PI], [STREET_X + STREET_W / 2 + 0.07, 0.86, Math.PI],
 [STREET_X + STREET_W / 2 + 0.07, 1.62, Math.PI]].forEach(([x, z, turn]) => {
  const lamp = new THREE.Group();
  lamp.add(cyl(0.006, 0.34, poleMat, 8));
  const arm = box(0.1, 0.006, 0.006, poleMat, 0.002); arm.position.set(0.045, 0.336, 0); lamp.add(arm);
  const head = box(0.04, 0.008, 0.016, poleMat, 0.002); head.position.set(0.09, 0.33, 0); lamp.add(head);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.012), lampMat); bulb.position.set(0.09, 0.327, 0); lamp.add(bulb);
  const p = pool(0.95, 0.95, lampPoolMat); p.position.x = 0.12; lamp.add(p);
  lamp.position.set(x, 0, z);
  lamp.rotation.y = turn;
  ground.add(lamp);
});

// ---------- Cars: small saloons with real proportions ----------
const headMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
const beamMat = new THREE.MeshBasicMaterial({ map: GLOW, color: 0xFFE2B0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const carGlass = new THREE.MeshPhysicalMaterial({ color: 0x0B0D14, roughness: 0.05, metalness: 0.9 });
const tyreMat = mat(0x0C0B10, { roughness: 0.9 });
const CAR_W = 0.058;
function carShape(points) {
  const s = new THREE.Shape(); points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s;
}
const carBodyGeo = new THREE.ExtrudeGeometry(carShape([[-0.07, 0.009], [-0.071, 0.024], [-0.062, 0.029], [-0.04, 0.031], [-0.022, 0.043], [0.014, 0.043],
  [0.034, 0.031], [0.062, 0.027], [0.071, 0.021], [0.07, 0.009]]), { depth: CAR_W, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 4 });
carBodyGeo.translate(0, 0, -CAR_W / 2);
const carGlassGeo = new THREE.ExtrudeGeometry(carShape([[-0.036, 0.0315], [-0.021, 0.041], [0.012, 0.041], [0.029, 0.0315]]), { depth: CAR_W + 0.009, bevelEnabled: false });
carGlassGeo.translate(0, 0, -(CAR_W + 0.009) / 2);
const wheelGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.012, 16); wheelGeo.rotateX(Math.PI / 2);
function makeCar(color) {
  const car = new THREE.Group();
  car.add(shadowed(new THREE.Mesh(carBodyGeo, new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.08 }))));
  car.add(new THREE.Mesh(carGlassGeo, carGlass));
  for (const sx of [-0.043, 0.045]) for (const sz of [-0.029, 0.029]) { const w = new THREE.Mesh(wheelGeo, tyreMat); w.position.set(sx, 0.0125, sz); car.add(w); }
  for (const sz of [-0.022, 0.022]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.005, 0.012), headMat); h.position.set(0.0745, 0.022, sz); car.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.014), tailMat); t.position.set(-0.0745, 0.024, sz); car.add(t);
  }
  const beam = pool(0.46, 0.26, beamMat); beam.position.x = 0.29; car.add(beam);
  return car;
}
const STREET_END = Math.sqrt(GROUND_R * GROUND_R - (STREET_X - STREET_W / 2) ** 2) - 0.06;
const cars = [
  { color: 0x0E0E12, z: -1.5, dir: 1 }, { color: 0xB9BCC4, z: -0.2, dir: 1 }, { color: 0x5A1420, z: 1.2, dir: 1 },
  { color: 0xE8E8EA, z: 1.6, dir: -1 }, { color: 0x1A2748, z: 0.3, dir: -1 }, { color: 0x3A3D44, z: -1.0, dir: -1 },
].map((c) => { c.mesh = makeCar(c.color); ground.add(c.mesh); return c; });
function placeCars(dt, now = 0) {
  for (const c of cars) {
    const pace = c.dir > 0 ? 0.36 + 0.07 * Math.sin(now / 2600) : 0.3 + 0.06 * Math.sin(now / 3100 + 2);   // each lane eases its speed
    c.z += c.dir * pace * dt;
    if (c.z > STREET_END) c.z = -STREET_END; else if (c.z < -STREET_END) c.z = STREET_END;
    c.mesh.position.set(STREET_X + (c.dir > 0 ? -0.072 : 0.072), 0.004, c.z);
    c.mesh.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    c.mesh.scale.setScalar(Math.max(0.001, smoothstep(STREET_END - Math.abs(c.z), 0, 0.2)));   // they slip in and out at the glass
  }
}
placeCars(0);


// ---------- Contact shadows: soft dark patches where things meet the ground ----------
const shadeMat = new THREE.MeshBasicMaterial({ map: GLOW, color: 0x05040A, transparent: true, opacity: 0.62, depthWrite: false, fog: false });
function shade(w, d, x, z) { const m = pool(w, d, shadeMat, 0.007); m.position.x = x; m.position.z = z; m.renderOrder = 1; ground.add(m); }
shade(1.5, 1.8, gx(-0.08), gz(0.12)); shade(2.6, 2.4, gx(0.2), gz(-0.62)); shade(2.2, 1.8, gx(-0.5), gz(-0.66));
shade(3.0, 3.0, gx(DRUM.x), gz(DRUM.z)); shade(3.2, 1.3, gx(-1.1), gz(0.12));
// A patch of gathered light on the ground, on the far side from the sun.
const causticMat = new THREE.MeshBasicMaterial({ map: GLOW, color: 0xFFF1D0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
const caustic = pool(1.7, 1.7, causticMat, 0.016);
ground.add(caustic);
lampPoolMat.fog = false; beamMat.fog = false;

// ---------- Blue light washing the walls at night ----------
const washA = new THREE.PointLight(0x2440D8, 0, 2.6, 1.8), washB = new THREE.PointLight(0x2440D8, 0, 2.6, 1.8);
washA.position.set(gx(-0.9), 0.35, gz(0.75)); washB.position.set(gx(0.9), 0.35, gz(-1.5));
world.add(washA, washB);

// ---------- Snow drifts that build up against walls and trees ----------
const drifts = [];
[[-0.4, -1.55, 0.5, 0.16, 0.07], [1.5, -0.9, 0.2, 0.5, 0.08], [0.2, 0.78, 0.4, 0.14, 0.06], [-1.08, 0.9, 0.1, 0.5, 0.05], [-1.08, -1.3, 0.1, 0.5, 0.05],
 [2.0, -0.95, 0.3, 0.3, 0.07], [0.25, -2.05, 0.3, 0.25, 0.07], [1.25, 1.95, 0.3, 0.25, 0.06], [-0.85, 1.78, 0.28, 0.26, 0.06]].forEach(([x, z, rx, rz, h]) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), SNOW_WHITE);
  m.position.set(x, 0, z); m.scale.set(rx, h, rz); m.receiveShadow = true; ground.add(m); drifts.push({ m, h });
});

// =====================================================================
// Sky inside the globe, the sky the building mirrors, and the glass
// =====================================================================
const skyU = {
  uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunVis: { value: 1 },
  uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 }, uPhase: { value: 0.5 },
  uStars: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 },
};
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skyFrag = (forMirror) => `
  uniform vec3 uTop, uHor, uCloudCol, uGround, uSunDir, uSunCol, uMoonDir;
  uniform float uSunVis, uMoon, uPhase, uStars, uCloud, uTime;
  varying vec3 vDir;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*noise(p); p *= 2.03; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHor, uTop, pow(smoothstep(0.0, 0.8, h), 0.7));
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.5) * uSunVis;
    col += uSunCol * smoothstep(0.9968, 0.9982, sd) * ${forMirror ? '2.0' : '6.0'} * uSunVis;
    vec2 sp = vec2(atan(d.z, d.x) * 34.0, d.y * 40.0);
    vec2 cell = floor(sp), f = fract(sp) - 0.5;
    float r = hash(cell);
    vec2 jit = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
    float star = step(0.84, r) * (1.0 - smoothstep(0.0, 0.13, length(f + jit)));
    col += vec3(1.0, 0.96, 0.9) * star * (0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0)) * uStars * 1.8;
    float md = dot(d, uMoonDir);
    float disc = smoothstep(0.9966, 0.9974, md);
    vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir)), my = cross(uMoonDir, mx);
    vec2 q = vec2(dot(d, mx), dot(d, my)) / 0.078;
    float term = cos(uPhase * 6.2831853) * sqrt(max(0.0, 1.0 - q.y*q.y));
    float lit = uPhase < 0.5 ? smoothstep(-0.06, 0.06, q.x - term) : smoothstep(-0.06, 0.06, -term - q.x);
    col += vec3(0.95, 0.96, 1.0) * disc * mix(0.05, 1.0, lit) * uMoon * 2.4;
    col += vec3(0.5, 0.56, 0.9) * pow(max(md, 0.0), 90.0) * 0.18 * uMoon;
    float c = fbm(d.xz / (abs(d.y) + 0.4) * 1.5 + vec2(uTime * 0.012, 0.0));
    float ca = smoothstep(0.78 - uCloud * 0.75, 1.02 - uCloud * 0.7, c) * min(1.0, uCloud * 1.7);
    col = mix(col, uCloudCol * (0.85 + 0.3 * c), ca);
    ${forMirror ? 'col = mix(uGround, col, smoothstep(-0.12, 0.02, d.y));' : ''}
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }`;
const skyDome = new THREE.Mesh(domeGeometry(0.985), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: skyFrag(false) }));
world.add(skyDome);

// The same sky, drawn into a small cube map. Everything shiny in the globe mirrors it.
const mirrorScene = new THREE.Scene();
mirrorScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: skyU, vertexShader: SKY_VERT, fragmentShader: skyFrag(true) })));
const mirrorRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
const mirrorCam = new THREE.CubeCamera(0.1, 30, mirrorRT);
// The cube map is blurred into reflection levels here, before the frame is drawn. Letting the
// renderer do it in the middle of a frame wipes the picture on that frame.
const pmrem = new THREE.PMREMGenerator(renderer);
let mirrorEnv = null, mirrorAt = 0;

const glassU = { uRim: { value: new THREE.Color() }, uFrost: { value: 0 }, uRoom: { value: 1 }, uPaper: { value: 0 } };
const GLASS_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
// The glass: a thick rim, a second line where the wall of the ball has depth, two soft windows of a
// room mirrored in it, and frost creeping up from the base when it is cold.
const glass = new THREE.Mesh(domeGeometry(1), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: glassU, vertexShader: GLASS_VERT,
  fragmentShader: `uniform vec3 uRim; uniform float uFrost, uRoom; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*noise(p); p *= 2.07; a *= 0.5; } return s; }
    void main(){
      vec3 n = normalize(vN), v = normalize(vV);
      float ndv = clamp(dot(n, v), 0.0, 1.0);
      float fres = pow(1.0 - ndv, 3.0);
      float rim = 1.0 - smoothstep(0.0, 0.3, ndv);
      float inner = (1.0 - smoothstep(0.0, 0.035, abs(ndv - 0.25))) * 0.2;
      vec3 r = reflect(-v, n);
      float facing = smoothstep(0.0, 0.35, r.z);
      vec2 w1 = (r.xy - vec2(-0.55, 0.55)) / vec2(0.1, 0.15);
      float box1 = 1.0 - smoothstep(0.55, 1.0, max(abs(w1.x), abs(w1.y)));
      float bars = smoothstep(0.03, 0.1, abs(w1.x)) * smoothstep(0.03, 0.1, abs(w1.y + 0.1));
      vec2 w2 = (r.xy - vec2(0.46, -0.34)) / vec2(0.1, 0.17);
      float box2 = 1.0 - smoothstep(0.7, 1.0, max(abs(w2.x), abs(w2.y)));
      float room = (box1 * (0.3 + 0.7 * bars) * 0.17 + box2 * 0.06) * facing * uRoom;
      // Frost: small icy patches low on the glass. Two crossed samples keep it even all the way round.
      float fr = 0.5 * (fbm(vec2(vP.x + vP.z, vP.y * 1.3) * 7.0) + fbm(vec2(vP.x - vP.z, vP.y * 1.3) * 7.0 + 19.0));
      float frost = uFrost * (1.0 - smoothstep(0.0, 0.8, vP.y)) * smoothstep(0.5, 0.6, fr) * (0.6 + 0.4 * noise(vP.xy * 60.0 + vP.z * 43.0));
      vec3 col = uRim * (fres * 0.5 + rim * 0.22 + inner) + vec3(1.0, 0.98, 0.95) * room + vec3(0.8, 0.9, 1.0) * frost * 0.26;
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
glass.renderOrder = 5;
world.add(glass);
// On the light page the bright rim cannot show, so the edge of the ball darkens there.
const glassShade = new THREE.Mesh(glass.geometry, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: glassU, vertexShader: GLASS_VERT,
  fragmentShader: `uniform float uPaper; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main(){ float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
      gl_FragColor = vec4(0.2, 0.17, 0.3, (1.0 - smoothstep(0.0, 0.32, ndv)) * 0.34 * uPaper); }`,
}));
glassShade.renderOrder = 4;
world.add(glassShade);

// =====================================================================
// Snow and rain
// =====================================================================
const FLOOR = GROUND + 0.012, NS = 2200, FALL_R = GROUND_R - 0.08;
const sPos = new Float32Array(NS * 3), sVel = new Float32Array(NS * 3), sAlpha = new Float32Array(NS), sRest = new Uint8Array(NS), sFall = new Float32Array(NS);
for (let i = 0; i < NS; i++) {
  const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * FALL_R;
  sPos[i * 3] = Math.cos(a) * r; sPos[i * 3 + 1] = FLOOR; sPos[i * 3 + 2] = Math.sin(a) * r;
  sRest[i] = 1; sFall[i] = 0.1 + Math.random() * 0.14;      // flakes sink slowly, as they do through liquid
}
// Flakes come in different sizes. A few are large and soft, as if close to the glass.
const sSize = new Float32Array(NS).map(() => (Math.random() < 0.04 ? 3 + Math.random() * 2.4 : 0.55 + Math.random() * 1.15));
const POINT_VERT = `attribute float aAlpha; attribute float aSize; varying float vA; uniform float uScale;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha; gl_PointSize = 0.03 * aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const POINT_FRAG = `varying float vA; uniform vec3 uColor;
  void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.1, 0.5, d)) * vA); }`;
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
snowGeo.setAttribute('aAlpha', new THREE.BufferAttribute(sAlpha, 1));
snowGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
const snowU = { uScale: { value: 1 }, uColor: { value: new THREE.Color(1, 1, 1) } };
const snowPts = new THREE.Points(snowGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: snowU,
  vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
}));
snowPts.frustumCulled = false; snowPts.renderOrder = 3;
world.add(snowPts);

function respawn(i, anywhere) {
  const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * FALL_R;
  const top = domeY(r) * (0.8 + Math.random() * 0.15);
  sPos[i * 3] = Math.cos(a) * r; sPos[i * 3 + 2] = Math.sin(a) * r;
  sPos[i * 3 + 1] = anywhere ? FLOOR + Math.random() * (top - FLOOR) : top;
  sVel[i * 3] = sVel[i * 3 + 2] = 0; sVel[i * 3 + 1] = -sFall[i];
  sRest[i] = 0;
}
// A shake sets the liquid in the globe moving, and the flakes ride it. The liquid turns about the
// middle (the swirl) and rolls over (up the middle, out under the top, down the glass, back in along
// the floor). Both die away over a few seconds, and then the flakes sink slowly and steadily.
let shakeUntil = 0, swirl = 0, roll = 0;
function shake(soft) {
  const power = soft === true ? 0.6 : 1;
  swirl = (Math.random() < 0.5 ? -1 : 1) * 1.15 * power;      // turns a second, at mid-radius
  roll = 1.55 * power;                                        // how fast the liquid rolls over
  for (let i = 0; i < NS; i++) {
    sRest[i] = 0;
    if (reduceMotion) { respawn(i, true); continue; }
    sVel[i * 3] += (Math.random() - 0.5) * 0.5;
    sVel[i * 3 + 2] += (Math.random() - 0.5) * 0.5;
    sVel[i * 3 + 1] = 1.2 + Math.random() * 2.6;              // a lift off the floor; the liquid does the rest
  }
  shakeUntil = performance.now() + 14000;
  if (soft !== true) { window.globeSwitch?.sound('shake'); if (hintState !== 'done') { hintState = 'done'; lastStatus = ''; } }
}

// Rain: many fine streaks that fade along their length and lean with the wind,
// and a small splash where each one lands.
const NR = 1500, rPos = new Float32Array(NR * 6), rAlpha = new Float32Array(NR * 2), rHead = new Float32Array(NR * 3), rSpd = new Float32Array(NR);
for (let i = 0; i < NR; i++) {
  const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * FALL_R;
  rHead[i * 3] = Math.cos(a) * r; rHead[i * 3 + 1] = FLOOR + Math.random() * (domeY(r) * 0.95 - FLOOR); rHead[i * 3 + 2] = Math.sin(a) * r;
  rSpd[i] = 4.4 + Math.random() * 2.2; rAlpha[i * 2] = 0.3 + Math.random() * 0.6; rAlpha[i * 2 + 1] = 0;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
rainGeo.setAttribute('aAlpha', new THREE.BufferAttribute(rAlpha, 1));
const rainU = { uColor: { value: new THREE.Color(0.6, 0.47, 0.98) }, uOpacity: { value: 0 } };
const rain = new THREE.LineSegments(rainGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: rainU,
  vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying float vA; uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, vA * uOpacity); }`,
}));
rain.frustumCulled = false; rain.renderOrder = 3;
world.add(rain);

const NSP = 320, spPos = new Float32Array(NSP * 3), spAlpha = new Float32Array(NSP), spLife = new Float32Array(NSP);
let spNext = 0;
const splashGeo = new THREE.BufferGeometry();
splashGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
splashGeo.setAttribute('aAlpha', new THREE.BufferAttribute(spAlpha, 1));
const splashU = { uScale: snowU.uScale, uColor: rainU.uColor };
const splashes = new THREE.Points(splashGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, uniforms: splashU,
  vertexShader: `attribute float aAlpha; varying float vA; uniform float uScale;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha; gl_PointSize = (0.02 + 0.07 * (1.0 - aAlpha)) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vA; uniform vec3 uColor;
    void main(){ vec2 q = gl_PointCoord - 0.5; q.y *= 2.4; float d = length(q); float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.2, 0.36, d); gl_FragColor = vec4(uColor, ring * vA * 0.8); }`,
}));
splashes.frustumCulled = false; splashes.renderOrder = 3;
world.add(splashes);

// Steam from the short stack when it is cold.
const NST = 26, stPos = new Float32Array(NST * 3), stAlpha = new Float32Array(NST), stSize = new Float32Array(NST), stAge = new Float32Array(NST).map((_, i) => i / NST);
const steamGeo = new THREE.BufferGeometry();
steamGeo.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
steamGeo.setAttribute('aAlpha', new THREE.BufferAttribute(stAlpha, 1));
steamGeo.setAttribute('aSize', new THREE.BufferAttribute(stSize, 1));
const steamU = { uScale: snowU.uScale, uColor: { value: new THREE.Color(0.8, 0.82, 0.9) } };
const steam = new THREE.Points(steamGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: steamU, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG }));
steam.frustumCulled = false; steam.renderOrder = 3;
world.add(steam);
const STEAM_AT = new THREE.Vector3(gx(0.5), GROUND + 1.7 * G_SCALE, gz(-0.4));

// =====================================================================
// Weather
// =====================================================================
const CODE_TEXT = { 0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail' };
const SNOW_CODE = { 71: 0.35, 73: 0.6, 75: 1, 77: 0.3, 85: 0.5, 86: 0.9 };
const RAIN_CODE = { 51: 0.2, 53: 0.3, 55: 0.4, 56: 0.3, 57: 0.4, 61: 0.4, 63: 0.7, 65: 1, 66: 0.5, 67: 0.7, 80: 0.5, 81: 0.75, 82: 1, 95: 1, 96: 1, 99: 1 };
const blank = () => ({ snow: 0, rain: 0, cloud: 0.1, cover: 0, windX: 0, windZ: 0 });
let liveWx = blank(), liveInfo = null, wxFailed = false, lastStatus = '';
const PRESET_WX = {
  clear: { ...blank(), cloud: 0.05 },
  // Previews use light cloud, so the sky that was chosen (a sunset, say) still shows through the snow or rain.
  snow: { ...blank(), snow: 0.85, cloud: 0.34, cover: 1, windX: 0.12, windZ: 0.05 },
  rain: { ...blank(), rain: 0.9, cloud: 0.46, windX: 0.1 },
};
const wx = blank();                                  // what is shown now, eased towards the target

async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,snow_depth&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago`;
    const c = (await (await fetch(url)).json()).current;
    const code = c.weather_code, snow = SNOW_CODE[code] || 0, w = clamp(c.wind_speed_10m / 25, 0, 1) * 0.5, to = rad(c.wind_direction_10m + 180);
    liveWx = { snow, rain: RAIN_CODE[code] || 0, cloud: Math.max(clamp(c.cloud_cover / 100, 0, 1), code === 45 || code === 48 ? 1 : 0),
      cover: clamp((c.snow_depth || 0) / 0.04, 0, 1), windX: Math.sin(to) * w, windZ: -Math.cos(to) * w };
    liveInfo = { temp: Math.round(c.temperature_2m), text: CODE_TEXT[code] || 'mixed weather' };
    wxFailed = false;
  } catch (e) { wxFailed = true; }
  lastStatus = '';
}
loadWeather();
setInterval(loadWeather, 10 * 60 * 1000);

// =====================================================================
// Controls. Live is one state: the real time and the real weather together.
// Choosing a time on the switch, snow or rain leaves Live for a preview.
// =====================================================================
let live = true, pvMood = null, pvWx = null, frozenMin = 0, displayMin = liveMinutes(), first = true, cold = 0, paperNow = 0, skyVarAt = 0, snowLie = 0, lookAlt = 0, lookAz = 0;
const SNOW_BUILD_SECONDS = 24;      // how long heavy snow takes to cover the building fully
const liveBtn = document.getElementById('live'), snowBtn = document.getElementById('snow'), rainBtn = document.getElementById('rain');
function syncButtons() {
  liveBtn.setAttribute('aria-pressed', live);
  liveBtn.dataset.tip = live ? 'Real time and weather' : 'Back to real time and weather';
  snowBtn.setAttribute('aria-pressed', pvWx === 'snow');
  rainBtn.setAttribute('aria-pressed', pvWx === 'rain');
  announceEl.textContent = live ? 'Live: the real time and weather in Minneapolis.' : `Preview: ${previewWords()}.`;   // spoken once, on a change
  lastStatus = '';
}
function leaveLive() { if (live) { live = false; frozenMin = displayMin; } }
document.addEventListener('globe:pick', (e) => { leaveLive(); pvMood = e.detail.mood; syncButtons(); });
liveBtn.addEventListener('click', () => {
  live = true; pvMood = null; pvWx = null;
  window.globeSwitch?.set(moodFor(sky(Date.now()).sun.alt), false);
  window.globeSwitch?.sound('live');
  syncButtons();
});
function weatherButton(btn, kind) {
  btn.addEventListener('click', () => {
    leaveLive();
    pvWx = pvWx === kind ? null : kind;
    if (pvWx) window.globeSwitch?.sound(kind);
    syncButtons();
  });
}
weatherButton(snowBtn, 'snow');
weatherButton(rainBtn, 'rain');
document.getElementById('shake').addEventListener('click', () => shake());

let lastPt = null;
stage.addEventListener('pointerdown', (e) => { lastPt = { x: e.clientX, y: e.clientY, t: e.timeStamp }; if (hintState !== 'done') { hintState = 'done'; lastStatus = ''; } });
stage.addEventListener('pointermove', (e) => {
  if (!lastPt || !e.buttons) return;
  const dt = e.timeStamp - lastPt.t; if (dt < 8) return;
  const speed = Math.hypot(e.clientX - lastPt.x, e.clientY - lastPt.y) / dt * 1000;
  lastPt = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  if (speed > 2600 && performance.now() > shakeUntil - 9500) shake();
});
addEventListener('pointerup', () => { lastPt = null; });

// With the keyboard, the left and right arrow keys turn the globe when no control has the focus.
addEventListener('keydown', (e) => {
  if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
  if (e.target.closest && e.target.closest('.toggle, input, textarea, select')) return;
  retireCursor();
  const off = camera.position.clone().sub(TARGET).applyAxisAngle(new THREE.Vector3(0, 1, 0), (e.key === 'ArrowLeft' ? -1 : 1) * 0.16);
  camera.position.copy(TARGET).add(off);
  controls.autoRotate = false;
  e.preventDefault();
});

// With a mouse, a small "Drag" label follows the pointer over the globe, until the visitor has dragged once.
let cursorOn = matchMedia('(hover: hover) and (pointer: fine)').matches;
function retireCursor() {
  if (!cursorOn) return;
  cursorOn = false;
  cursorEl.classList.remove('is-on');
  root.classList.remove('has-cursor');
}
if (cursorOn) {
  root.classList.add('has-cursor');
  stage.addEventListener('pointermove', (e) => { if (!cursorOn) return; cursorEl.style.translate = `${e.clientX}px ${e.clientY}px`; cursorEl.classList.add('is-on'); });
  stage.addEventListener('pointerleave', () => cursorEl.classList.remove('is-on'));
  stage.addEventListener('pointerdown', () => cursorEl.classList.add('is-down'));
  addEventListener('pointerup', () => { if (cursorEl.classList.contains('is-down')) { cursorEl.classList.remove('is-down'); retireCursor(); } });
}
addEventListener('pointercancel', () => { lastPt = null; cursorEl.classList.remove('is-down'); });

// =====================================================================
// Status line
// =====================================================================
const span = (min) => { const m = Math.max(1, Math.round(min)), h = Math.floor(m / 60), r = m % 60;
  return (h ? `${h} h` : '') + (h && r ? ' ' : '') + (r || !h ? `${r} min` : ''); };
const MOOD_WORD = { light: 'day', sunset: 'sunset', dark: 'night' }, WX_WORD = { snow: 'snow', rain: 'purple rain' };
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const previewWords = () => (pvMood && pvWx ? `${MOOD_WORD[pvMood]}, with ${WX_WORD[pvWx]}` : pvMood ? MOOD_WORD[pvMood] : pvWx ? WX_WORD[pvWx] : 'a clear sky');
function setText(el, text) {                          // a changed value cross-blurs in
  if (el.textContent === text) return;
  el.textContent = text;
  if (!reduceMotion) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
}
function showToast(text) { if (toastEl.textContent !== text) toastEl.textContent = text; toastEl.classList.add('is-shown'); }
let hintState = 'waiting', hintAt = 0;               // the touch hint shows once: waiting, showing, done
function updateStatus() {
  const now = performance.now();
  // The reading in the corner: the time and the weather in Minneapolis now. It stays the same in a preview.
  setText(readTemp, clockFmt.format(new Date()));
  setText(readSky, liveInfo ? `${liveInfo.temp}°F / ${Math.round((liveInfo.temp - 32) * 5 / 9)}°C` : wxFailed ? 'Weather unavailable' : 'Reading the weather');
  setText(readSun, liveInfo ? sentence(liveInfo.text) : '\u00a0');
  liveBtn.classList.toggle('is-offline', live && wxFailed);      // no pulse when the weather could not be read
  // The line above the dock.
  if (!live) toastEl.classList.remove('is-shown');
  else if (hintState === 'showing') { showToast('Drag to turn it. Flick to shake it.'); if (now > hintAt + 5200) { hintState = 'done'; toastEl.classList.remove('is-shown'); } }
  else {
    toastEl.classList.remove('is-shown');
    if (hintState === 'waiting' && openedAt && now > openedAt + 7000) { hintState = 'showing'; hintAt = now; }
  }
  lastStatus = 'set';
}

// =====================================================================
// The look of each moment
// =====================================================================
const KEYS = [   // sun height in degrees, sky at the top, sky at the horizon
  [-18, 0x05051A, 0x120E2A], [-10, 0x0E0C30, 0x35265F], [-4, 0x25235E, 0xB65C8C], [0, 0x39489A, 0xFF9A66],
  [6, 0x4877C8, 0xFFD3A0], [20, 0x3D7FDB, 0xB9DCFF], [60, 0x2F74DA, 0xA9D4FF],
].map(([a, t, h]) => ({ a, t: new THREE.Color(t), h: new THREE.Color(h) }));
function skyColors(alt, top, hor) {
  let i = 0; while (i < KEYS.length - 2 && alt > KEYS[i + 1].a) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1], f = clamp((alt - k0.a) / (k1.a - k0.a), 0, 1);
  top.copy(k0.t).lerp(k1.t, f); hor.copy(k0.h).lerp(k1.h, f);
}

const cTop = new THREE.Color(), cHor = new THREE.Color(), cTmp = new THREE.Color(), cTmp2 = new THREE.Color(), cGrey = new THREE.Color(), cWin = new THREE.Color();
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
const GRASS = new THREE.Color(MONTH >= 11 || MONTH <= 3 ? 0x767A4A : 0x5C8A48), SNOW = new THREE.Color(0xEEF1F8), WHITE = new THREE.Color(0xF3F5FA);
const ROAD = new THREE.Color(0x2E2E36), ROAD_WET = new THREE.Color(0x15151B), ROAD_SNOW = new THREE.Color(0x8E909C);
const LIT_WARM = new THREE.Color(0xFFD08A), LIT_COOL = new THREE.Color(0xDDE6FF), LIT_AMBER = new THREE.Color(0xFFB12E), AMBER_DAY = new THREE.Color(0xC98F1C);

function update(dt, now) {
  // --- time ---
  const targetMin = live ? liveMinutes() : pvMood ? PRESET_MIN[pvMood] : frozenMin;
  const diff = ((targetMin - displayMin + 2160) % 1440) - 720;
  const settled = first || reduceMotion || Math.abs(diff) < 0.05;
  displayMin = (displayMin + (settled ? diff : diff * (1 - Math.exp(-dt * 2.4))) + 1440) % 1440;
  const s = sky(MIDNIGHT + displayMin * 60000), altNow = s.sun.alt;
  if (live && settled && window.globeSwitch && window.globeSwitch.mood() !== moodFor(altNow)) window.globeSwitch.set(moodFor(altNow), false);
  // The light does not jump to the new time. The sun's height eases there, and it crosses twilight
  // (where the sky changes colour fastest) at a slow, steady pace, so dusk falls smoothly.
  const lookGoal = clamp(altNow, -18, 90);
  if (first || reduceMotion) { lookAlt = lookGoal; lookAz = s.sun.az; }
  else {
    const gap = lookGoal - lookAlt, twilight = lookAlt > -13 && lookAlt < 5;
    lookAlt += Math.sign(gap) * Math.min(Math.abs(gap), (twilight ? 6 : 8 + 1.6 * Math.abs(gap)) * dt);
    lookAz += Math.atan2(Math.sin(s.sun.az - lookAz), Math.cos(s.sun.az - lookAz)) * (1 - Math.exp(-dt * 2));
  }
  const alt = lookAlt, moving = !settled || Math.abs(lookGoal - lookAlt) > 0.02;
  dirFrom(alt, lookAz, sunDir); dirFrom(s.moon.alt, s.moon.az, moonDir);

  // --- weather ---
  const goal = live ? liveWx : pvWx ? PRESET_WX[pvWx] : { ...PRESET_WX.clear, cover: liveWx.cover };
  const k = first || reduceMotion ? 1 : 1 - Math.exp(-dt * 1.5);
  for (const key in wx) wx[key] = lerp(wx[key], goal[key], k);

  const day = smoothstep(alt, -6, 8), night = 1 - smoothstep(alt, -9, -1), dim = 1 - 0.72 * wx.cloud;
  skyColors(alt, cTop, cHor);
  cGrey.setRGB(0.5, 0.53, 0.6).multiplyScalar(0.06 + 0.9 * day);
  cTop.lerp(cGrey, wx.cloud * 0.8); cHor.lerp(cTmp.copy(cGrey).multiplyScalar(1.25), wx.cloud * 0.7);

  // --- page: its colour follows the switch ---
  paperNow = lerp(paperNow, root.dataset.mood === 'light' ? 1 : 0, first || reduceMotion ? 1 : 1 - Math.exp(-dt * 3.3));   // in step with the page's 700ms colour change
  const paper = paperNow;
  tableTop.material.color.setRGB(1, 1, 1).lerp(cTmp.setRGB(0.16, 0.12, 0.24), paper);
  tableTop.material.opacity = lerp(0.045, 0.07, paper);
  if (now > skyVarAt) { skyVarAt = now + 300; root.style.setProperty('--sky', `#${cTmp.copy(cHor).getHexString()}`); }   // the page takes a little of the sky's colour
  tableGlow.material.opacity = 0.5 * (1 - paper);
  tableGlow.material.color.copy(cHor).multiplyScalar(0.28 + 0.2 * day).lerp(cTmp.setHex(0x3A2A5E), 0.5);
  tableShadow.material.opacity = 0.34 * paper;

  // --- sky, mirror and glass ---
  skyU.uTop.value.copy(cTop); skyU.uHor.value.copy(cHor);
  skyU.uCloudCol.value.copy(cGrey).lerp(cHor, 0.35).multiplyScalar(1.15);
  skyU.uGround.value.copy(groundMat.color).multiplyScalar(0.12 + 0.5 * day * dim);
  skyU.uSunDir.value.copy(sunDir); skyU.uMoonDir.value.copy(moonDir);
  const sunCol = skyU.uSunCol.value.setHex(0xFF8A4A).lerp(cTmp.setHex(0xFFF3E2), smoothstep(alt, 0, 25));
  skyU.uSunVis.value = smoothstep(alt, -2.5, 0.5) * (1 - wx.cloud * 0.85);
  skyU.uMoon.value = smoothstep(s.moon.alt, -1, 3) * (0.25 + 0.75 * night);
  skyU.uPhase.value = s.phase;
  skyU.uStars.value = night * (1 - wx.cloud * 0.9);
  skyU.uCloud.value = wx.cloud;
  skyU.uTime.value = reduceMotion ? 0 : now / 1000;
  if (now > mirrorAt) {                               // redraw the mirrored sky: every frame while the light is changing
    mirrorCam.update(renderer, mirrorScene);
    mirrorEnv = pmrem.fromCubemap(mirrorRT.texture, mirrorEnv);
    scene.environment = mirrorEnv.texture;
    mirrorAt = now + (moving ? (touchDevice || lowQuality ? 120 : 0) : 600);
  }
  glassU.uRim.value.copy(cHor).lerp(cTmp.setRGB(1, 1, 1), 0.45).multiplyScalar((0.3 + 0.7 * day) * (1 - 0.6 * paper));
  glassU.uRoom.value = (0.4 + 0.6 * day) * (1 - 0.45 * paper);
  glassU.uPaper.value = paper;
  // Cold: frost on the glass and steam from the stack. Live uses the real temperature.
  cold = lerp(cold, live ? (liveInfo ? clamp((38 - liveInfo.temp) / 14, 0, 1) : 0) : pvWx === 'snow' ? 1 : 0, k);
  glassU.uFrost.value = cold;
  caustic.position.x = clamp(-sunDir.x * 1.7, -1.6, 1.6); caustic.position.z = clamp(-sunDir.z * 1.7, -1.6, 1.6);
  causticMat.opacity = skyU.uSunVis.value * day * 0.22;
  scene.fog.color.copy(cHor).lerp(cTop, 0.35);

  // --- light ---
  const sunI = smoothstep(alt, -3, 5) * 3.3 * dim;        // the low sun is strong, so sunset paints the west walls
  const moonUp = s.moon.alt > 4, moonLit = (1 - Math.cos(s.phase * Math.PI * 2)) / 2;
  if (sunI > 0.02) { sunLight.position.copy(sunDir).multiplyScalar(11); sunLight.color.copy(sunCol); sunLight.intensity = sunI; }
  else {
    if (moonUp) sunLight.position.copy(moonDir).multiplyScalar(11); else sunLight.position.set(-3.5, 9, 5);
    sunLight.color.setHex(0x8FA6FF);
    sunLight.intensity = night * (0.2 + 0.4 * moonLit * (moonUp ? 1 : 0.3)) * dim;
  }
  hemi.color.copy(cTop).lerp(cTmp.setRGB(1, 1, 1), 0.2);
  hemi.groundColor.copy(cHor).multiplyScalar(0.25);
  // Night is dark. The building goes near-black, as the real one does, and it is picked out by its own
  // windows, signs and a little floodlight at its foot. Nothing is lit evenly.
  hemi.intensity = 0.4 + 1.0 * day * dim;
  scene.environmentIntensity = 1.5 - 0.5 * night;
  bloom.strength = 0.16 + 0.12 * night;
  for (const m of skins) m.emissiveIntensity = night * 0.065;       // a trace of blue, so the walls do not go dead black
  washA.intensity = washB.intensity = night * 1.1;                 // floodlight at the foot of the walls

  // --- ground: grass, snow cover, wet road ---
  // Snow builds up slowly while it falls, on the roofs, the trees and the ground. It does not appear
  // all at once. When the snow stops it thins back to what really lies in Minneapolis.
  const lying = liveWx.cover;
  if (first) snowLie = lying;
  else if (wx.snow > 0.05) snowLie = Math.min(1, snowLie + dt * wx.snow / SNOW_BUILD_SECONDS);
  else if (snowLie > lying) snowLie = Math.max(lying, snowLie - dt / 12);
  else snowLie = lerp(snowLie, lying, k);
  groundMat.color.copy(GRASS).lerp(SNOW, snowLie);
  roadMat.color.copy(ROAD).lerp(ROAD_WET, wx.rain).lerp(ROAD_SNOW, snowLie * 0.6);
  roadMat.roughness = 0.8 - 0.62 * wx.rain;
  for (const c of snowCaps) { c.visible = snowLie > 0.03; c.scale.y = Math.max(0.01, snowLie); }
  for (const t of treeMats) t.m.color.copy(t.base).lerp(WHITE, snowLie * 0.5);
  for (const d of drifts) { d.m.visible = snowLie > 0.05; d.m.scale.y = Math.max(0.001, d.h * snowLie); }
  waterBump.offset.y = reduceMotion ? 0 : (now / 1000 * 0.02) % 1;

  // --- windows, sign, lamps, headlights ---
  const u = (displayMin + 720) % 1440;               // minutes after noon
  const evening = u < 690 ? 1 : u > 1020 ? 0.5 : 0.22; // the lobby glows until about 11:30 PM
  const glassDay = cTmp.copy(cTop).multiplyScalar(0.55).addScalar(0.03);
  wins.forEach((w, i) => {
    const dark = alt < w.dusk;
    const on = w.kind === 'amber' ? alt < 2 : w.kind === 'lobby' ? dark && evening > 0.3 : dark && (u < w.bed || (w.wake && u >= w.wake) || w.owl);
    w.level = first || reduceMotion ? +on : lerp(w.level, +on, 1 - Math.exp(-dt * 2.5));
    if (w.kind === 'amber') cWin.copy(AMBER_DAY).multiplyScalar(0.25 + 0.75 * day).lerp(cTmp2.copy(LIT_AMBER).multiplyScalar(1.15), w.level);
    else cWin.copy(glassDay).lerp(cTmp2.copy(w.warm > 0.3 ? LIT_WARM : LIT_COOL).multiplyScalar(w.kind === 'lobby' ? 1.1 : 0.8 + w.warm * 0.35), w.level);
    winMesh.setColorAt(i, cWin);
  });
  winMesh.instanceColor.needsUpdate = true;
  const glow = night * evening;
  bigGlass.color.copy(glassDay).lerp(cTmp2.copy(LIT_WARM).multiplyScalar(0.95), glow);
  lobbyMat.emissiveIntensity = glow * 0.7;
  lobbyLight.intensity = glow * 1.2;
  amberMat.emissiveIntensity = 0.1 + night * 0.55;
  amberBandMat.color.setHex(0xFFC233).multiplyScalar(0.6 + night * 0.55);
  redFace.color.setScalar(0.55 + 0.35 * day + night * 0.6); redEdge.color.setHex(0xA81822).multiplyScalar(0.6 + 0.3 * day + night * 0.5);
  screenMat.color.setHex(0xC8CCD6).multiplyScalar(0.3 + 0.3 * day + glow * 1.0);
  for (const m of masts) {
    m.mat.color.setScalar(1.25 - 0.2 * night);
    if (!reduceMotion && m.mat.map) m.mat.map.offset.y = 1 - (now / 1000 * SIGN_SPEED * SIGN_PX / m.length) % 1;
  }
  lampMat.color.setHex(0xFFD9A0).multiplyScalar(0.08 + night * 1.5);
  lampPoolMat.opacity = night * 0.24;
  headMat.color.setHex(0xFFF1D6).multiplyScalar(0.25 + night * 1.6);
  tailMat.color.setHex(0xFF2A1A).multiplyScalar(0.2 + night * 1.6);
  beamMat.opacity = night * 0.32;
  beaconMat.color.setHex(0xFF2418).multiplyScalar(night * (reduceMotion ? 2 : 0.4 + 3 * Math.max(0, Math.sin(now / 520))) + 0.12);

  // --- snow ---
  const active = Math.floor(NS * wx.snow), shaking = now < shakeUntil;
  snowU.uColor.value.setRGB(1, 1, 1).multiplyScalar(0.35 + 0.75 * day + 0.25 * night);
  if (!reduceMotion) { swirl *= Math.exp(-dt / 7); roll *= Math.exp(-dt / 4.4); }      // the liquid comes to rest
  const follow = Math.min(1, dt * 2.4), GLASS = R * 0.955, TOP = CY + R, windX = wx.windX * 0.45, windZ = wx.windZ * 0.45;
  for (let i = 0; i < NS; i++) {
    const j = i * 3;
    if (sRest[i]) {
      sAlpha[i] = 0;
      // Flakes start one by one, a few each moment, so snow begins lightly and thickens. Starting them
      // all together would send them down as one sheet.
      if (i < active && (reduceMotion || first || Math.random() < dt * 0.14)) respawn(i, first || reduceMotion);
      continue;
    }
    sAlpha[i] = sSize[i] > 2.5 ? 0.28 : 0.92;
    if (reduceMotion) { if (i >= active && !shaking) sRest[i] = 1; continue; }
    const x = sPos[j], y = sPos[j + 1], z = sPos[j + 2];
    // Where the liquid is going at this flake: fastest mid-way out, still at the glass.
    const r = Math.hypot(x, z), q = Math.min(1, r / Math.max(0.3, domeR(y))), hy = clamp((y - FLOOR) / (TOP - FLOOR), 0, 1);
    const turn = swirl * (1 - q * q), up = roll * ((1 - 2.2 * q * q) * Math.sin(Math.PI * hy) + 0.7 * (1 - q) * (1 - q) * Math.pow(1 - hy, 4)), out = roll * q * (0.85 * hy - 0.16);   // a little inward at the floor, then outward all the way up, so the flakes spread to the glass
    const churn = 0.3 * (roll + Math.abs(swirl) * 0.5);        // the stirred liquid scatters the flakes, so they do not bunch
    const rx = r > 1e-4 ? x / r : 0, rz = r > 1e-4 ? z / r : 0;
    const tx = -z * turn + rx * out + windX + Math.sin(now / 1700 + i) * 0.04 + Math.sin(now / 640 + i * 12.99) * churn;
    const ty = up - sFall[i] + Math.sin(now / 780 + i * 7.31) * churn * 0.7;
    const tz = x * turn + rz * out + windZ + Math.cos(now / 2100 + i * 1.7) * 0.04 + Math.cos(now / 700 + i * 4.17) * churn;
    // The flake is carried by the liquid: it eases towards the liquid's speed, with no sudden moves.
    sVel[j] += (tx - sVel[j]) * follow; sVel[j + 1] += (ty - sVel[j + 1]) * follow; sVel[j + 2] += (tz - sVel[j + 2]) * follow;
    sPos[j] += sVel[j] * dt; sPos[j + 1] += sVel[j + 1] * dt; sPos[j + 2] += sVel[j + 2] * dt;
    // At the glass a flake slides along the curve: it is put back on the inside of the ball, and
    // only the part of its motion that points out through the glass is taken away.
    const dx = sPos[j], dy = sPos[j + 1] - CY, dz = sPos[j + 2], d = Math.hypot(dx, dy, dz);
    if (d > GLASS) {
      const nx = dx / d, ny = dy / d, nz = dz / d, push = sVel[j] * nx + sVel[j + 1] * ny + sVel[j + 2] * nz;
      sPos[j] = nx * GLASS; sPos[j + 1] = CY + ny * GLASS; sPos[j + 2] = nz * GLASS;
      if (push > 0) { sVel[j] -= nx * push; sVel[j + 1] -= ny * push; sVel[j + 2] -= nz * push; }
    }
    if (sPos[j + 1] <= FLOOR) {
      sPos[j + 1] = FLOOR;
      if (roll > 0.1) { if (sVel[j + 1] < 0) sVel[j + 1] = 0; }       // while the liquid is still rolling, flakes skim the floor
      else if (i < active) respawn(i, false);
      else sRest[i] = 1;                                          // then they settle
    }
  }
  snowGeo.attributes.position.needsUpdate = true; snowGeo.attributes.aAlpha.needsUpdate = true;

  // --- purple rain ---
  rainU.uOpacity.value = wx.rain;
  rainU.uColor.value.setRGB(0.6, 0.47, 0.98).multiplyScalar(0.7 + 0.4 * day);
  rain.visible = splashes.visible = wx.rain > 0.02;
  if (rain.visible) {
    const n = Math.floor(NR * wx.rain), vx = 0.5 + wx.windX * 5, vz = wx.windZ * 5, streak = 0.04;
    for (let i = 0; i < NR; i++) {
      const j = i * 3, o = i * 6;
      if (!reduceMotion) { rHead[j] += vx * dt; rHead[j + 1] -= rSpd[i] * dt; rHead[j + 2] += vz * dt; }
      const out = Math.hypot(rHead[j], rHead[j + 2]) > domeR(rHead[j + 1]) * 0.95;
      if (rHead[j + 1] < FLOOR || out) {
        if (!out && i < n && Math.random() < 0.6) {          // a splash where it landed
          const k = spNext++ % NSP;
          spPos[k * 3] = rHead[j]; spPos[k * 3 + 1] = FLOOR + 0.004; spPos[k * 3 + 2] = rHead[j + 2]; spLife[k] = 1;
        }
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * FALL_R;
        rHead[j] = Math.cos(a) * r; rHead[j + 2] = Math.sin(a) * r; rHead[j + 1] = domeY(r) * (0.8 + Math.random() * 0.15);
      }
      const on = i < n ? 1 : 0;
      rPos[o] = rHead[j]; rPos[o + 1] = rHead[j + 1]; rPos[o + 2] = rHead[j + 2];
      rPos[o + 3] = rHead[j] - vx * streak * on; rPos[o + 4] = rHead[j + 1] + rSpd[i] * streak * on; rPos[o + 5] = rHead[j + 2] - vz * streak * on;
    }
    for (let k = 0; k < NSP; k++) { spLife[k] = Math.max(0, spLife[k] - dt / 0.32); spAlpha[k] = spLife[k]; }
    rainGeo.attributes.position.needsUpdate = true;
    splashGeo.attributes.position.needsUpdate = true; splashGeo.attributes.aAlpha.needsUpdate = true;
  }
  // --- steam ---
  steam.visible = cold > 0.02;
  if (steam.visible) {
    steamU.uColor.value.setRGB(0.8, 0.82, 0.9).multiplyScalar(0.3 + 0.7 * day + 0.15 * night);
    for (let i = 0; i < NST; i++) {
      if (!reduceMotion) stAge[i] = (stAge[i] + dt / 3.4) % 1;
      const a = stAge[i];
      stPos[i * 3] = STEAM_AT.x + (0.22 + wx.windX * 2) * a + Math.sin(i * 2.4) * 0.06 * a;
      stPos[i * 3 + 1] = STEAM_AT.y + 0.6 * a;
      stPos[i * 3 + 2] = STEAM_AT.z + wx.windZ * 2 * a + Math.cos(i * 1.7) * 0.06 * a;
      stSize[i] = 2 + 9 * a; stAlpha[i] = Math.sin(Math.PI * a) * 0.17 * cold;
    }
    for (const n of ['position', 'aAlpha', 'aSize']) steamGeo.attributes[n].needsUpdate = true;
  }
  first = false;
}

// =====================================================================
// Sizing and the loop
// =====================================================================
// The globe is fitted to the space between the corners and the dock: its top and the front of its
// base are projected to the screen, and the camera's distance and aim are adjusted until both sit
// just inside that space.
let baseDist = 17;
const fitCam = new THREE.PerspectiveCamera(), fitTop = new THREE.Vector3(), fitBot = new THREE.Vector3(), fitMid = new THREE.Vector3();
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight, pr = renderer.getPixelRatio();
  if (!w || !h) return;                                    // no size yet (a hidden frame): wait for the next resize
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  const tl = document.querySelector('.corner--tl').getBoundingClientRect(), dk = document.querySelector('.dockwrap').getBoundingClientRect();
  const topPx = (w > 900 ? 26 : tl.bottom + 10), botPx = Math.max(topPx + 120, dk.top - 6);
  const span = 2 * Math.tan(rad(camera.fov / 2));          // world height seen per unit of distance
  let dist = 17, aim = 1.5;
  fitCam.fov = camera.fov; fitCam.aspect = camera.aspect; fitCam.near = 1; fitCam.far = 300; fitCam.updateProjectionMatrix();
  for (let k = 0; k < 8; k++) {
    fitCam.position.setFromSpherical(new THREE.Spherical(dist, rad(76), 0)); fitCam.position.y += aim;
    fitCam.lookAt(0, aim, 0); fitCam.updateMatrixWorld();
    fitTop.set(0, CY + R, 0).project(fitCam); fitBot.set(0, -0.5, 2.74).project(fitCam);
    const pt = (1 - fitTop.y) / 2 * h, pb = (1 - fitBot.y) / 2 * h;
    dist *= clamp((pb - pt) / (botPx - topPx), 0.6, 1.6);
    aim -= ((pt + pb) / 2 - (topPx + botPx) / 2) * span * dist / h;
  }
  baseDist = Math.max(dist, 5.9 / (span * camera.aspect));     // never wider than the window
  TARGET.y = aim;
  controls.target.copy(TARGET);
  if (!camera.userData.placed || !Number.isFinite(camera.position.x + camera.position.y + camera.position.z)) {
    camera.position.setFromSpherical(new THREE.Spherical(baseDist, rad(76), rad(-22))).add(TARGET);
    camera.userData.placed = true;
  }
  camera.updateProjectionMatrix();
  controls.minDistance = controls.maxDistance = baseDist;
  scene.fog.near = baseDist - 1.4; scene.fog.far = baseDist + 13;
  snowU.uScale.value = (h * pr) / (2 * Math.tan(rad(camera.fov / 2)));
  fitCam.position.setFromSpherical(new THREE.Spherical(baseDist, rad(76), 0)); fitCam.position.y += aim;
  fitCam.lookAt(0, aim, 0); fitCam.updateMatrixWorld();
  fitMid.set(0, 1.15, 0).project(fitCam);                    // the blur stays sharp around the building
  tilt.uniforms.uRes.value.set(w * pr, h * pr);
  tilt.uniforms.uFocus.value.set(0.5, (fitMid.y + 1) / 2);
  tilt.uniforms.uAmount.value = 4.5 * pr;
}
addEventListener('resize', resize);
resize();
document.fonts?.ready.then(resize);
if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);   // also catches a frame that gets its size late

// The globe turns slowly on its own, and stops while someone is holding it.
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.32;
let resumeTurn = 0;
controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(resumeTurn); });
controls.addEventListener('end', () => { if (!reduceMotion) resumeTurn = setTimeout(() => { controls.autoRotate = true; }, 6000); });

// Start on the real moment, without animating the switch, then let it ease from there on.
window.globeSwitch?.set(moodFor(sky(Date.now()).sun.alt), false);
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('is-instant')));

// The opening: the camera eases in while the snow settles.
const OPENING = 2800;
let openedAt = 0, lowQuality = 0, slowSum = 0, slowN = 0;
let last = performance.now(), statusAt = 0;
function frame(now) {
  const real = now - last, dt = Math.min(0.1, real / 1000); last = now;
  // If the device cannot keep up, draw fewer pixels and drop the edge blur.
  if (lowQuality < 2 && openedAt && now - openedAt > 600 && real < 2000) {
    slowSum += real; slowN++;
    if (slowN === 30) {
      if (slowSum / slowN > 36) {
        lowQuality++;
        if (lowQuality === 1) { renderer.setPixelRatio(1); tilt.enabled = false; }
        else { renderer.setPixelRatio(0.75); bloom.enabled = false; }
        resize();
      }
      slowSum = slowN = 0;
    }
  }
  if (!openedAt) { openedAt = now; root.classList.add('is-ready'); if (!reduceMotion) shake(true); }
  const o = reduceMotion ? 1 : clamp((now - openedAt) / OPENING, 0, 1), eased = 1 - Math.pow(1 - o, 3);
  controls.minDistance = controls.maxDistance = baseDist * (1 + 0.24 * (1 - eased));
  if (!reduceMotion) placeCars(dt, now);
  update(dt, now);
  if (now > statusAt || !lastStatus) { updateStatus(); statusAt = now + 1000; }
  controls.update();
  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);