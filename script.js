import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { buildTerrain as buildTerrainModule } from './terrain-renderer.js';
import { buildClouds as buildCloudsModule, CLOUD_NOISE_CONFIG } from './cloud-renderer.js';
import { createPerlite } from './perlite.js';
import { FINE_TUNING_SETTINGS } from './fine-tuning-settings.js';

const CLOUD_WIND_SPEED = 3;
const WET_SURFACE_DRYING_DURATION = 72;
const WET_SURFACE_DRYING_RATE = 4.6;

const $ = (id) => document.getElementById(id);
function configureTuningSlider(slider, { min, max, default: initialValue }) {
  slider.min = String(min);
  slider.max = String(max);
  slider.value = String(initialValue);
}

const fineTuningPanels = [
  ['terrain-resolution-toggle', 'terrain-resolution-panel'],
  ['cloud-resolution-toggle', 'cloud-resolution-panel'],
  ['cloud-humidity-toggle', 'cloud-humidity-panel'],
  ['terrain-ceiling-toggle', 'terrain-ceiling-panel'],
  ['rain-threshold-toggle', 'rain-threshold-panel'],
  ['terrain-lod-toggle', 'terrain-lod-panel']
];
function toggleFineTuningPanel(toggle, panel) {
  const expanded = toggle.getAttribute('aria-expanded') !== 'true';
  for (const [toggleId, panelId] of fineTuningPanels) {
    if (toggleId === toggle.id) continue;
    $(toggleId).setAttribute('aria-expanded', 'false');
    $(panelId).hidden = true;
    $(toggleId).classList.remove('selected');
  }
  toggle.setAttribute('aria-expanded', String(expanded));
  panel.hidden = !expanded;
  toggle.classList.toggle('selected', expanded);
}

function start() {
  const mount = $('landscape');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xe0e9e2, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.localClippingEnabled = true;
  mount.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Endless landscape. Drag or use arrow keys to pan, scroll or use plus and minus to zoom.');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-50, 50, 34, -34, .1, 400);
  const homePosition = new THREE.Vector3(76, 67, 85);
  camera.position.copy(homePosition);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = .09;
  controls.enablePan = false;
  controls.minPolarAngle = .35;
  controls.maxPolarAngle = 1.25;
  controls.minZoom = .0065;
  controls.maxZoom = 13;
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  controls.touches.ONE = null;
  controls.touches.TWO = null;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xf4f5e5, 0x647b66, 2.5));
  const sun = new THREE.DirectionalLight(0xffedcf, 3.2);
  sun.position.set(-35, 65, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 160 });
  sun.shadow.normalBias = .08;
  sun.shadow.bias = -.00015;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xdcefed, .7);
  fill.position.set(30, 20, -40);
  scene.add(fill);

  const HALF = 29;
  let N = 76;
  let selectedTerrainResolution = N;
  let terrainPanning = false;
  let extraTerrainLodLevels = FINE_TUNING_SETTINGS.terrainLodLevels.default;
  let STEP = HALF * 2 / N;
  const BOTTOM = -7;
  const WATER = .42;
  const noise = new ImprovedNoise();
  let seed = 2418;
  let noiseOffset = seed * .173;
  const perlite = createPerlite(noise);
  const center = new THREE.Vector2();
  const RAIN_CELL_SIZE = 4;
  const RAIN_SAMPLE_INTERVAL = .8;
  const RAIN_VISUAL_INTERVAL = .25;
  const RAIN_STREAK_CAPACITY = 360;
  const RAIN_FALL_SPEED = 32;
  const wetnessByCell = new Map();
  let rainCells = [];
  let rainStreaks = [];
  let lastRainSample = -Infinity;
  let lastRainVisualUpdate = -Infinity;
  let rainThreshold = FINE_TUNING_SETTINGS.rainDensityThreshold.default;
  let dirty = true;
  let lastBuild = -1000;
  let mode = 'pan';
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let time = 0;
  let ceilingHeight = 30;
  const ceilingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), ceilingHeight);
  const boundary = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), HALF),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), HALF),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), HALF),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), HALF),
    ceilingPlane
  ];
  const rand = (x, z, salt = 0) => {
    const v = Math.sin(x * 127.1 + z * 311.7 + seed * .012 + salt * 74.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const sample = (x, z, scale, offset = 0) => perlite.terrain(x, z, scale, noiseOffset, offset);
  const river = (z) => 6.5 * Math.sin(z * .065 + seed * .001) + 3.1 * Math.sin(z * .135 + .6);
  const riverWidth = (z) => 1.85 + .4 * Math.sin(z * .12 + 2);
  const smooth = (x) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  function biomeAt(x, z) {
    const moisture = sample(x, z, .018, 41);
    const continent = sample(x, z, .011, 53);
    const ridge = sample(x, z, .008, 67);
    if (continent > .18 && ridge > -.05) return 'alpine';
    if (moisture < -.22 && continent < .25) return 'desert';
    if (moisture > .27 && continent < .16) return 'wetland';
    return moisture > -.04 ? 'forest' : 'grassland';
  }
  function terrainHeight(x, z) {
    const kind = biomeAt(x, z);
    const d = Math.abs(x - river(z));
    let hills;
    if (kind === 'alpine') hills = 8 + 15 * sample(x, z, .031) + 6.2 * sample(x, z, .076, 4) + 1.1 * sample(x, z, .22, 8);
    else if (kind === 'desert') hills = 2.4 + 2.2 * sample(x, z, .022, 12) + .65 * Math.sin((x * .055 + sample(x, z, .009, 82) * 2) * Math.PI) + .35 * sample(x, z, .09, 8);
    else if (kind === 'grassland') hills = 2.7 + 4.3 * sample(x, z, .031) + 1.3 * sample(x, z, .076, 4) + .3 * sample(x, z, .22, 8);
    else if (kind === 'wetland') hills = 2.6 + 5.5 * sample(x, z, .031) + 1.8 * sample(x, z, .076, 4) + .35 * sample(x, z, .22, 8);
    else hills = 3.4 + 8 * sample(x, z, .031) + 2.5 * sample(x, z, .076, 4) + .48 * sample(x, z, .22, 8);
    const bank = smooth((d - riverWidth(z) + .65) / 4.5);
    return -.45 + (Math.max(1.55, hills) + .45) * bank;
  }
  const waterBody = (ix, iz) => {
    const cell = 44;
    if (rand(ix, iz, 90) > .18) return null;
    const x = (ix + .15 + rand(ix, iz, 91) * .7) * cell;
    const z = (iz + .15 + rand(ix, iz, 92) * .7) * cell;
    const kind = biomeAt(x, z);
    if (kind === 'desert' || kind === 'alpine' || Math.abs(x - river(z)) < riverWidth(z) + 5) return null;
    const lake = rand(ix, iz, 93) > .88;
    const radius = lake ? 6.5 + rand(ix, iz, 94) * 3.5 : 2.2 + rand(ix, iz, 94) * 2.2;
    const level = lake ? 1.08 : .88;
    const ground = terrainHeight(x, z);
    if (ground < level + .65 || ground > 7.5) return null;
    return { x, z, radius, level };
  };
  const waterBodyAt = (x, z) => {
    const cell = 44;
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    let closest = null;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const body = waterBody(ix + dx, iz + dz);
      if (!body || Math.hypot(x - body.x, z - body.z) > body.radius) continue;
      if (!closest || Math.hypot(x - body.x, z - body.z) < Math.hypot(x - closest.x, z - closest.z)) closest = body;
    }
    return closest;
  };
  function height(x, z) {
    const ground = terrainHeight(x, z);
    const body = waterBodyAt(x, z);
    if (!body) return ground;
    const distance = Math.hypot(x - body.x, z - body.z);
    const basin = smooth((distance / body.radius - .68) / .32);
    return (body.level - .46) + (ground - (body.level - .46)) * basin;
  }

  function material(color, clip = true) {
    return new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, clippingPlanes: clip ? boundary : [] });
  }
  const generatedBoundaryCaps = new Map();
  const excludedBoundaryCapOwners = new Set();
  function boundaryCapPositions(geometry, matrix) {
    const attribute = geometry.attributes.position;
    const index = geometry.index;
    const vertex = i => new THREE.Vector3(attribute.getX(i), attribute.getY(i), attribute.getZ(i)).applyMatrix4(matrix);
    const triangles = index ? index.count / 3 : attribute.count / 3;
    const edges = [
      { axis: 'x', value: -HALF, inward: .001 },
      { axis: 'x', value: HALF, inward: -.001 },
      { axis: 'z', value: -HALF, inward: .001 },
      { axis: 'z', value: HALF, inward: -.001 },
      { axis: 'y', value: ceilingHeight, inward: -.001 }
    ];
    const positions = [];
    for (const edge of edges) {
      const segments = [];
      for (let triangle = 0; triangle < triangles; triangle++) {
        const ids = index ? [index.getX(triangle * 3), index.getX(triangle * 3 + 1), index.getX(triangle * 3 + 2)] : [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
        const points = [];
        for (let side = 0; side < 3; side++) {
          const a = vertex(ids[side]), b = vertex(ids[(side + 1) % 3]);
          const da = a[edge.axis] - edge.value, db = b[edge.axis] - edge.value;
          if (Math.abs(da) < 1e-7) points.push(a);
          if (da * db < -1e-12) points.push(a.clone().lerp(b, da / (da - db)));
        }
        const unique = points.filter((point, i) => points.findIndex(other => point.distanceToSquared(other) < 1e-10) === i);
        if (unique.length === 2) segments.push(unique);
      }
      const keyOf = point => `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)},${Math.round(point.z * 10000)}`;
      const pointsByKey = new Map(), neighbors = new Map(), segmentKeys = new Set();
      for (const [a, b] of segments) {
        const ka = keyOf(a), kb = keyOf(b);
        if (ka === kb) continue;
        const segmentKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (segmentKeys.has(segmentKey)) continue;
        segmentKeys.add(segmentKey);
        pointsByKey.set(ka, a);
        pointsByKey.set(kb, b);
        if (!neighbors.has(ka)) neighbors.set(ka, []);
        if (!neighbors.has(kb)) neighbors.set(kb, []);
        neighbors.get(ka).push(kb);
        neighbors.get(kb).push(ka);
      }
      const visited = new Set();
      for (const [start, adjacent] of neighbors) for (const first of adjacent) {
        const firstEdge = start < first ? `${start}|${first}` : `${first}|${start}`;
        if (visited.has(firstEdge)) continue;
        const loop = [start];
        let previous = start, current = first;
        visited.add(firstEdge);
        while (current !== start && loop.length <= neighbors.size) {
          loop.push(current);
          const next = (neighbors.get(current) || []).find(candidate => {
            const key = current < candidate ? `${current}|${candidate}` : `${candidate}|${current}`;
            return candidate !== previous && !visited.has(key);
          });
          if (!next) break;
          const key = current < next ? `${current}|${next}` : `${next}|${current}`;
          visited.add(key);
          previous = current;
          current = next;
        }
        if (current !== start || loop.length < 3) continue;
        const boundaryPoints = loop.map(key => {
          const point = pointsByKey.get(key).clone();
          point[edge.axis] = edge.value + edge.inward;
          return point;
        });
        const contour = boundaryPoints.map(point => edge.axis === 'x'
          ? new THREE.Vector2(point.y, point.z)
          : edge.axis === 'y'
            ? new THREE.Vector2(point.x, point.z)
            : new THREE.Vector2(point.x, point.y));
        for (const triangle of THREE.ShapeUtils.triangulateShape(contour, [])) {
          for (const index of triangle) {
            const point = boundaryPoints[index];
            positions.push(point.x, point.y, point.z);
          }
        }
      }
    }
    return positions;
  }
  function rebuildBoundaryCaps(owner, geometry) {
    const old = generatedBoundaryCaps.get(owner);
    if (old) {
      scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
      generatedBoundaryCaps.delete(owner);
    }
    if (!geometry || !geometry.attributes.position || !geometry.attributes.position.count) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const positions = [];
    const addForMatrix = matrix => {
      const sphere = geometry.boundingSphere.clone().applyMatrix4(matrix);
      if (Math.abs(sphere.center.x + HALF) < sphere.radius || Math.abs(sphere.center.x - HALF) < sphere.radius || Math.abs(sphere.center.z + HALF) < sphere.radius || Math.abs(sphere.center.z - HALF) < sphere.radius || Math.abs(sphere.center.y - ceilingHeight) < sphere.radius) {
        positions.push(...boundaryCapPositions(geometry, matrix));
      }
    };
    if (owner.isInstancedMesh) {
      const instanceMatrix = new THREE.Matrix4();
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < owner.count; i++) {
        owner.getMatrixAt(i, instanceMatrix);
        matrix.multiplyMatrices(owner.matrixWorld, instanceMatrix);
        addForMatrix(matrix);
      }
    } else addForMatrix(owner.matrixWorld);
    if (!positions.length) return;
    const capGeometry = new THREE.BufferGeometry();
    capGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    capGeometry.computeVertexNormals();
    const sourceMaterial = Array.isArray(owner.material) ? owner.material[0] : owner.material;
    const capMaterial = sourceMaterial.clone();
    capMaterial.clippingPlanes = [];
    capMaterial.side = THREE.DoubleSide;
    const caps = new THREE.Mesh(capGeometry, capMaterial);
    caps.frustumCulled = false;
    caps.castShadow = true;
    caps.receiveShadow = true;
    scene.add(caps);
    generatedBoundaryCaps.set(owner, caps);
  }
  function excludeBoundaryCaps(owner) {
    excludedBoundaryCapOwners.add(owner);
    rebuildBoundaryCaps(owner, null);
  }
  function rebuildAllBoundaryCaps() {
    scene.updateMatrixWorld(true);
    const owners = [];
    scene.traverse(owner => {
      if (!owner.isMesh) return;
      if (excludedBoundaryCapOwners.has(owner)) {
        rebuildBoundaryCaps(owner, null);
        return;
      }
      if (generatedBoundaryCaps.has(owner)) return;
      const materials = Array.isArray(owner.material) ? owner.material : [owner.material];
      if (materials.some(mat => mat && mat.clippingPlanes && mat.clippingPlanes.includes(ceilingPlane))) owners.push(owner);
    });
    for (const owner of owners) rebuildBoundaryCaps(owner, owner.geometry);
  }
  function rebuildAnimalBoundaryCaps() {
    scene.updateMatrixWorld(true);
    for (const animal of animalPool) animal.model.traverse(owner => {
      if (owner.isMesh) rebuildBoundaryCaps(owner, animal.model.visible ? owner.geometry : null);
    });
  }
  const grassColors = [0x83a75e, 0x8baa63, 0x91ae6b, 0x7b9e59, 0x96af6b, 0x86a962].map(c => new THREE.Color(c));
  const sandColors = [0xc9ae73, 0xd4bb82, 0xbfa36a, 0xd9c28e].map(c => new THREE.Color(c));
  const alpineColors = [0x858d87, 0x969b91, 0x777f7b, 0xa4a69c].map(c => new THREE.Color(c));
  const wetlandColors = [0x748f60, 0x81966a, 0x718b63].map(c => new THREE.Color(c));
  const shoreColor = new THREE.Color(0xc4bc8a);
  const stoneColor = new THREE.Color(0xa0ab8f);
  const terrainGeometry = new THREE.BufferGeometry();
  let groundPositions = new Float32Array(N * N * 18);
  let groundColors = new Float32Array(groundPositions.length);
  let groundBaseColors = new Float32Array(groundPositions.length);
  terrainGeometry.setAttribute('position', new THREE.BufferAttribute(groundPositions, 3).setUsage(THREE.DynamicDrawUsage));
  terrainGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3).setUsage(THREE.DynamicDrawUsage));
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, clippingPlanes: boundary }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const sideGeometry = new THREE.BufferGeometry();
  let sidePositions = new Float32Array(N * 4 * 3 * 6 * 3);
  let sideColors = new Float32Array(sidePositions.length);
  sideGeometry.setAttribute('position', new THREE.BufferAttribute(sidePositions, 3).setUsage(THREE.DynamicDrawUsage));
  sideGeometry.setAttribute('color', new THREE.BufferAttribute(sideColors, 3).setUsage(THREE.DynamicDrawUsage));
  sideGeometry.setDrawRange(0, 0);
  const sides = new THREE.Mesh(sideGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
  sides.receiveShadow = false;
  sides.castShadow = true;
  excludeBoundaryCaps(sides);
  scene.add(sides);
  function allocateGridBuffers(resolution) {
    N = Math.round(resolution);
    STEP = HALF * 2 / N;
    groundPositions = new Float32Array(N * N * 18);
    groundColors = new Float32Array(groundPositions.length);
    groundBaseColors = new Float32Array(groundPositions.length);
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(groundPositions, 3).setUsage(THREE.DynamicDrawUsage));
    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(groundColors, 3).setUsage(THREE.DynamicDrawUsage));
    sidePositions = new Float32Array(N * 4 * 3 * 6 * 3);
    sideColors = new Float32Array(sidePositions.length);
    sideGeometry.setAttribute('position', new THREE.BufferAttribute(sidePositions, 3).setUsage(THREE.DynamicDrawUsage));
    sideGeometry.setAttribute('color', new THREE.BufferAttribute(sideColors, 3).setUsage(THREE.DynamicDrawUsage));
    sideGeometry.setDrawRange(0, 0);
  }
  function setSelectedTerrainResolution(resolution) {
    selectedTerrainResolution = Math.round(resolution);
    if (terrainPanning && extraTerrainLodLevels === 0) {
      clearTimeout(panResolutionTimer);
      terrainPanning = false;
    }
    applyTerrainResolutionTier(terrainPanning ? terrainResolutionTier : extraTerrainLodLevels);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(58, .15, 58), material(0x716358, false));
  base.position.y = BOTTOM - .075;
  scene.add(base);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.ShadowMaterial({ opacity: .105 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -13;
  shadow.receiveShadow = true;
  scene.add(shadow);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(58, 58, 64, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x71bfc1, roughness: .18, metalness: .05, transparent: true, opacity: .91 }));
  water.position.y = WATER;
  water.receiveShadow = true;
  scene.add(water);
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x92d2ce, roughness: .35, transparent: true, opacity: .64, side: THREE.DoubleSide }));
  scene.add(fall);
  const fallStreak = new THREE.Mesh(new THREE.PlaneGeometry(.1, 6.7), new THREE.MeshBasicMaterial({ color: 0xd1f0e7, transparent: true, opacity: .55 }));
  scene.add(fallStreak);

  const rainGeometry = new THREE.BufferGeometry();
  const rainPositions = new Float32Array(RAIN_STREAK_CAPACITY * 6);
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
  rainGeometry.setDrawRange(0, 0);
  const rainMesh = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xd8f1ed, transparent: true, opacity: .74 }));
  rainMesh.frustumCulled = false;
  scene.add(rainMesh);

  const dummy = new THREE.Object3D();
  const instances = [];
  function batch(geometry, color, max) {
    const mesh = new THREE.InstancedMesh(geometry, material(color), max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.userData.rainWorldPositions = new Float32Array(max * 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    instances.push(mesh);
    return mesh;
  }
  function place(mesh, x, y, z, sx, sy = sx, sz = sx, rotation = 0) {
    if (mesh.count >= mesh.instanceMatrix.count) return;
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, rotation, 0);
    dummy.updateMatrix();
    const instanceIndex = mesh.count++;
    mesh.setMatrixAt(instanceIndex, dummy.matrix);
    const worldPositions = mesh.userData.rainWorldPositions;
    worldPositions[instanceIndex * 2] = x + center.x;
    worldPositions[instanceIndex * 2 + 1] = z + center.y;
    mesh.setColorAt(instanceIndex, new THREE.Color(1, 1, 1));
  }
  const trunks = batch(new THREE.CylinderGeometry(.15, .21, 1, 5), 0x7a6548, 750);
  const pines = [0x3f7350, 0x518456, 0x64905c].map(c => batch(new THREE.ConeGeometry(1, 1, 6), c, 1100));
  const leaf = batch(new THREE.IcosahedronGeometry(1, 1), 0x78a35a, 700);
  const leafLight = batch(new THREE.IcosahedronGeometry(1, 0), 0x9bb36b, 450);
  const rocks = batch(new THREE.IcosahedronGeometry(1, 0), 0xa5ad99, 500);
  const grass = batch(new THREE.ConeGeometry(.13, .8, 3), 0x6e9250, 1500);
  const desertPlants = batch(new THREE.CylinderGeometry(.12, .18, 1, 5), 0x71894f, 220);
  const flowerStem = batch(new THREE.CylinderGeometry(.025, .025, .44, 3), 0x5d854e, 700);
  const petals = [0xe6ce83, 0xf0e7cb, 0xb19cb4].map(c => batch(new THREE.IcosahedronGeometry(.13, 0), c, 300));
  const ripples = batch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 0xbce3d6, 100);
  ripples.castShadow = false;
  const pondWater = batch(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), 0x71bfc1, 80);
  pondWater.material.roughness = .32;
  pondWater.material.transparent = true;
  pondWater.material.opacity = .91;
  pondWater.castShadow = false;

  let waterWavesEnabled = true;
  let waterReflectionsEnabled = true;
  const waterWaveMaterials = [water.material, pondWater.material];
  for (const waterMaterial of waterWaveMaterials) {
    waterMaterial.roughness = .18;
    waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.uWaterTime = { value: 0 };
      shader.uniforms.uWaterWavesEnabled = { value: 1 };
      shader.uniforms.uWaterReflectionsEnabled = { value: 1 };
      waterMaterial.userData.waterShader = shader;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vWaterWorldPosition;`);
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWaterWorldPosition = worldPosition.xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWaterWorldPosition;
uniform float uWaterTime;
uniform float uWaterWavesEnabled;
uniform float uWaterReflectionsEnabled;
vec2 waterGradient(vec2 p) {
  float angle = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453) * 6.28318530718;
  return vec2(cos(angle), sin(angle));
}
float waterPerlin(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
  float a = dot(waterGradient(cell), local);
  float b = dot(waterGradient(cell + vec2(1.0, 0.0)), local - vec2(1.0, 0.0));
  float c = dot(waterGradient(cell + vec2(0.0, 1.0)), local - vec2(0.0, 1.0));
  float d = dot(waterGradient(cell + vec2(1.0, 1.0)), local - vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y) * 1.7;
}
float waterWaveHeight(vec2 p) {
  float broad = waterPerlin(p * 0.14 + vec2(uWaterTime * 0.10, -uWaterTime * 0.07));
  float detail = waterPerlin(p * 0.34 + vec2(-uWaterTime * 0.17, uWaterTime * 0.13));
  return broad * 0.075 + detail * 0.025;
}
float waterReflectionPattern(vec2 p) {
  float broad = waterPerlin(p * 0.12 + vec2(0.0, uWaterTime * 0.018));
  float detail = waterPerlin(p * 0.31 + vec2(uWaterTime * 0.012, 0.0));
  return smoothstep(0.02, 0.36, broad + detail * 0.35);
}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 waterPoint = vWaterWorldPosition.xz;
float waterEpsilon = 0.12;
float waterSlopeX = (waterWaveHeight(waterPoint + vec2(waterEpsilon, 0.0)) - waterWaveHeight(waterPoint - vec2(waterEpsilon, 0.0))) / (2.0 * waterEpsilon);
float waterSlopeZ = (waterWaveHeight(waterPoint + vec2(0.0, waterEpsilon)) - waterWaveHeight(waterPoint - vec2(0.0, waterEpsilon))) / (2.0 * waterEpsilon);
vec3 waterWaveNormal = normalize(mat3(viewMatrix) * vec3(-waterSlopeX, 1.0, -waterSlopeZ));
normal = normalize(mix(normal, waterWaveNormal, uWaterWavesEnabled));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `vec3 waterViewDirection = normalize(-vViewPosition);
vec3 waterLightDirection = normalize(mat3(viewMatrix) * vec3(-0.45, 0.82, 0.35));
float waterShine = pow(max(dot(normal, normalize(waterLightDirection + waterViewDirection)), 0.0), 72.0) * uWaterWavesEnabled;
float waterReflection = waterReflectionPattern(waterPoint) * uWaterReflectionsEnabled;
outgoingLight += vec3(0.38, 0.52, 0.44) * waterShine;
outgoingLight += vec3(0.12, 0.25, 0.23) * waterReflection;
#include <opaque_fragment>`);
    };
    waterMaterial.needsUpdate = true;
  }
  function setWaterWaves(enabled) {
    waterWavesEnabled = Boolean(enabled);
    const button = $('water-waves-toggle');
    button.setAttribute('aria-pressed', String(waterWavesEnabled));
    button.setAttribute('aria-label', waterWavesEnabled ? 'Disable water waves' : 'Enable water waves');
    button.title = waterWavesEnabled ? 'Turn water waves off' : 'Turn water waves on';
    button.classList.toggle('selected', waterWavesEnabled);
    for (const waterMaterial of waterWaveMaterials) {
      const shader = waterMaterial.userData.waterShader;
      if (shader) shader.uniforms.uWaterWavesEnabled.value = waterWavesEnabled ? 1 : 0;
    }
  }
  function setWaterReflections(enabled) {
    waterReflectionsEnabled = Boolean(enabled);
    const button = $('water-reflection-toggle');
    button.setAttribute('aria-pressed', String(waterReflectionsEnabled));
    button.setAttribute('aria-label', waterReflectionsEnabled ? 'Disable water reflections' : 'Enable water reflections');
    button.title = waterReflectionsEnabled ? 'Turn water reflections off' : 'Turn water reflections on';
    button.classList.toggle('selected', waterReflectionsEnabled);
    for (const waterMaterial of waterWaveMaterials) {
      const shader = waterMaterial.userData.waterShader;
      if (shader) shader.uniforms.uWaterReflectionsEnabled.value = waterReflectionsEnabled ? 1 : 0;
    }
  }
  $('water-waves-toggle').addEventListener('click', () => setWaterWaves(!waterWavesEnabled));
  $('water-reflection-toggle').addEventListener('click', () => setWaterReflections(!waterReflectionsEnabled));
  function updateWaterEffects(now) {
    for (const waterMaterial of waterWaveMaterials) {
      const shader = waterMaterial.userData.waterShader;
      if (!shader) continue;
      shader.uniforms.uWaterTime.value = now * .001;
      shader.uniforms.uWaterWavesEnabled.value = waterWavesEnabled ? 1 : 0;
      shader.uniforms.uWaterReflectionsEnabled.value = waterReflectionsEnabled ? 1 : 0;
    }
  }

  const wool = material(0xf0ead9);
  const dark = material(0x585b4b);
  const deerFur = material(0xb88959);
  const antlerMat = material(0xe0c9a0);
  const animalPool = [];
  const terrainObstacles = [];
  function part(group, geometry, mat, x, y, z, sx = 1, sy = sx, sz = sx) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  const animalBody = new THREE.IcosahedronGeometry(1, 1);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 30; i++) {
    const isDeer = i >= 18;
    const model = new THREE.Group();
    const fur = isDeer ? deerFur : wool;
    const legs = [];
    part(model, animalBody, fur, 0, isDeer ? .88 : .65, 0, isDeer ? .4 : .43, isDeer ? .4 : .39, isDeer ? .72 : .6);
    for (const x of [-.24, .24]) for (const z of [-.38, .37]) {
      legs.push(part(model, cube, isDeer ? deerFur : dark, x, .33, z, .095, .65, .095));
    }
    const head = new THREE.Group();
    head.position.set(0, isDeer ? 1.25 : .87, .55);
    model.add(head);
    part(head, animalBody, isDeer ? deerFur : dark, 0, 0, .08, .23, .25, .32);
    for (const x of [-.24, .24]) part(head, cube, fur, x, .15, .02, .22, .08, .14);
    if (isDeer) {
      part(model, cube, deerFur, 0, 1.04, .49, .24, .65, .25);
      for (const x of [-.16, .16]) {
        const horn = part(head, cube, antlerMat, x, .42, -.04, .045, .5, .045);
        horn.rotation.z = x > 0 ? -.25 : .25;
        part(head, cube, antlerMat, x * 1.45, .51, .03, .19, .045, .045);
      }
    }
    for (const x of [-.16, .16]) part(head, cube, dark, x, .06, .29, .045, .045, .045);
    const wetMaterials = [];
    model.traverse(owner => {
      if (!owner.isMesh) return;
      owner.material = owner.material.clone();
      wetMaterials.push({ material: owner.material, dryColor: owner.material.color.clone() });
    });
    model.visible = false;
    scene.add(model);
    animalPool.push({ model, legs, head, isDeer, x: 0, z: 0, phase: 0, speed: 0, wetMaterials });
  }

  let cloudHumidityCutoff = .52;
  let cloudCeilingHeight = 22;
  let cloudResolution = 28;
  let lastCloudAnimationBuild = performance.now();
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xf8f6ed, roughness: 1, side: THREE.DoubleSide });
  const clouds = [];
  function buildCloudsLegacy() {
    const segments = 40;
    const step = HALF * 2 / segments;
    const humidity = new Float32Array((segments + 1) * (segments + 1));
    for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
      const worldX = -HALF + x * step + center.x;
      const worldZ = -HALF + z * step + center.y;
      humidity[z * (segments + 1) + x] = THREE.MathUtils.clamp((sample(worldX, worldZ, .026, 91) + 1) * .5, 0, 1);
    }
    const layers = [
      { threshold: Math.max(0, cloudHumidityCutoff - .08), y: 16.2 },
      { threshold: cloudHumidityCutoff, y: 17.2 },
      { threshold: Math.min(1, cloudHumidityCutoff + .08), y: 18.2 }
    ];
    const clipTriangle = (triangle, threshold) => {
      const polygon = [];
      for (let i = 0; i < triangle.length; i++) {
        const current = triangle[i];
        const previous = triangle[(i + triangle.length - 1) % triangle.length];
        const currentInside = current.value >= threshold;
        const previousInside = previous.value >= threshold;
        if (currentInside !== previousInside) {
          const t = (threshold - previous.value) / (current.value - previous.value);
          polygon.push({
            x: previous.x + (current.x - previous.x) * t,
            z: previous.z + (current.z - previous.z) * t,
            value: threshold
          });
        }
        if (currentInside) polygon.push(current);
      }
      return polygon;
    };
    layers.forEach((layer, layerIndex) => {
      const positions = [];
      const boundaryEdges = new Map();
      const topHeight = point => layer.y + Math.max(0, point.value - layer.threshold) * 2.5 + sample(point.x + center.x, point.z + center.y, .085, 113) * .65;
      const bottomHeight = point => layer.y - 2.35 + sample(point.x + center.x, point.z + center.y, .09, 127) * .45;
      const addTriangle = (points) => {
        for (const point of points) positions.push(point.x, topHeight(point), point.z);
        for (const point of [points[0], points[2], points[1]]) positions.push(point.x, bottomHeight(point), point.z);
      };
      const addPolygon = (triangle) => {
        const polygon = clipTriangle(triangle, layer.threshold);
        if (polygon.length < 3) return;
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i], b = polygon[(i + 1) % polygon.length];
          const keyA = `${a.x.toFixed(5)},${a.z.toFixed(5)}`;
          const keyB = `${b.x.toFixed(5)},${b.z.toFixed(5)}`;
          const key = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
          if (boundaryEdges.has(key)) boundaryEdges.delete(key);
          else boundaryEdges.set(key, [a, b]);
        }
        for (let i = 1; i < polygon.length - 1; i++) addTriangle([polygon[0], polygon[i], polygon[i + 1]]);
      };
      for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
        const x0 = -HALF + x * step, x1 = x0 + step;
        const z0 = -HALF + z * step, z1 = z0 + step;
        const a = { x: x0, z: z0, value: humidity[z * (segments + 1) + x] };
        const b = { x: x0, z: z1, value: humidity[(z + 1) * (segments + 1) + x] };
        const c = { x: x1, z: z0, value: humidity[z * (segments + 1) + x + 1] };
        const d = { x: x1, z: z1, value: humidity[(z + 1) * (segments + 1) + x + 1] };
        addPolygon([a, b, c]);
        addPolygon([c, b, d]);
      }
      for (const [a, b] of boundaryEdges.values()) {
        const topA = topHeight(a), topB = topHeight(b);
        const bottomA = bottomHeight(a), bottomB = bottomHeight(b);
        positions.push(a.x, topA, a.z, a.x, bottomA, a.z, b.x, topB, b.z);
        positions.push(b.x, topB, b.z, a.x, bottomA, a.z, b.x, bottomB, b.z);
      }
      let cloud = clouds[layerIndex];
      if (!cloud) {
        cloud = new THREE.Mesh(new THREE.BufferGeometry(), cloudMaterials[layerIndex]);
        cloud.frustumCulled = false;
        scene.add(cloud);
        clouds[layerIndex] = cloud;
      }
      cloud.geometry.dispose();
      cloud.geometry = new THREE.BufferGeometry();
      cloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      cloud.geometry.computeVertexNormals();
      cloud.geometry.computeBoundingSphere();
      cloud.visible = positions.length > 0;
    });
  }

  function buildClouds() {
    const segments = cloudResolution;
    const bottomY = 12.5;
    const topY = cloudCeilingHeight;
    const width = segments + 1;
    const planeSize = width * width;
    const step = HALF * 2 / segments;
    const verticalStep = HALF * 2 / segments;
    const verticalLevels = [bottomY];
    for (let y = bottomY + verticalStep; y < topY - 1e-8; y += verticalStep) verticalLevels.push(y);
    if (topY - verticalLevels[verticalLevels.length - 1] > 1e-8) verticalLevels.push(topY);
    else verticalLevels[verticalLevels.length - 1] = topY;
    const verticalSegments = verticalLevels.length - 1;
    const field = new Float32Array(planeSize * (verticalSegments + 1));
    const thresholdAt = y => {
      const altitude = THREE.MathUtils.clamp((y - bottomY) / (22 - bottomY), 0, 1);
      const lowerEdgeFade = 1 - smooth(altitude / .16);
      return cloudHumidityCutoff - .22 * smooth(altitude) + lowerEdgeFade * 1.1;
    };
    for (let y = 0; y <= verticalSegments; y++) {
      const worldY = verticalLevels[y];
      for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
        const worldX = -HALF + x * step + center.x;
        const worldZ = -HALF + z * step + center.y;
        const broad = perlite.sample(worldX * CLOUD_NOISE_CONFIG.broad.frequency + noiseOffset + 91 + time * CLOUD_WIND_SPEED * .008, worldY * CLOUD_NOISE_CONFIG.broad.verticalFrequency + 7.3 + time * CLOUD_WIND_SPEED * .014, worldZ * CLOUD_NOISE_CONFIG.broad.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .006);
        const detail = perlite.sample(worldX * CLOUD_NOISE_CONFIG.detail.frequency + noiseOffset + 113 + time * CLOUD_WIND_SPEED * .014, worldY * CLOUD_NOISE_CONFIG.detail.verticalFrequency + 13.7 + time * CLOUD_WIND_SPEED * .023, worldZ * CLOUD_NOISE_CONFIG.detail.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .011);
        const fine = perlite.sample(worldX * CLOUD_NOISE_CONFIG.fine.frequency + noiseOffset + 139 + time * CLOUD_WIND_SPEED * .021, worldY * CLOUD_NOISE_CONFIG.fine.verticalFrequency + 19.1 + time * CLOUD_WIND_SPEED * .034, worldZ * CLOUD_NOISE_CONFIG.fine.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .016);
        const micro = perlite.sample(worldX * CLOUD_NOISE_CONFIG.micro.frequency + noiseOffset + 157 + time * CLOUD_WIND_SPEED * .028, worldY * CLOUD_NOISE_CONFIG.micro.verticalFrequency + 23.9 + time * CLOUD_WIND_SPEED * .045, worldZ * CLOUD_NOISE_CONFIG.micro.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .022);
        field[y * planeSize + z * width + x] = CLOUD_NOISE_CONFIG.baseDensity + broad * CLOUD_NOISE_CONFIG.broad.weight + detail * CLOUD_NOISE_CONFIG.detail.weight + fine * CLOUD_NOISE_CONFIG.fine.weight + micro * CLOUD_NOISE_CONFIG.micro.weight - thresholdAt(worldY);
      }
    }
    const isoLevel = 0;
    const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
    const positions = [];
    const interpolate = (a, b) => {
      const t = (isoLevel - a.value) / (b.value - a.value);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    };
    const addTriangle = (a, b, c, inside, outside) => {
      const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
      const ac = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
      const outward = new THREE.Vector3(outside.x - inside.x, outside.y - inside.y, outside.z - inside.z);
      if (ab.cross(ac).dot(outward) < 0) [b, c] = [c, b];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    const polygonize = points => {
      const inside = points.filter(point => point.value >= isoLevel);
      const outside = points.filter(point => point.value < isoLevel);
      if (!inside.length || !outside.length) return;
      const average = group => group.reduce((sum, point) => ({ x: sum.x + point.x / group.length, y: sum.y + point.y / group.length, z: sum.z + point.z / group.length }), { x: 0, y: 0, z: 0 });
      const insideCenter = average(inside), outsideCenter = average(outside);
      if (inside.length === 1 || inside.length === 3) {
        const lone = inside.length === 1 ? inside[0] : outside[0];
        const group = inside.length === 1 ? outside : inside;
        const pointsOnSurface = group.map(point => interpolate(lone, point));
        addTriangle(pointsOnSurface[0], pointsOnSurface[1], pointsOnSurface[2], insideCenter, outsideCenter);
      } else {
        const a = interpolate(inside[0], outside[0]);
        const b = interpolate(inside[0], outside[1]);
        const c = interpolate(inside[1], outside[0]);
        const d = interpolate(inside[1], outside[1]);
        addTriangle(a, c, b, insideCenter, outsideCenter);
        addTriangle(b, c, d, insideCenter, outsideCenter);
      }
    };
    for (let y = 0; y < verticalSegments; y++) for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
      const index = (ix, iy, iz) => iy * planeSize + iz * width + ix;
      const x0 = -HALF + x * step, x1 = x0 + step;
      const y0 = verticalLevels[y], y1 = verticalLevels[y + 1];
      const z0 = -HALF + z * step, z1 = z0 + step;
      const corners = [
        { x: x0, y: y0, z: z0, value: field[index(x, y, z)] },
        { x: x1, y: y0, z: z0, value: field[index(x + 1, y, z)] },
        { x: x1, y: y0, z: z1, value: field[index(x + 1, y, z + 1)] },
        { x: x0, y: y0, z: z1, value: field[index(x, y, z + 1)] },
        { x: x0, y: y1, z: z0, value: field[index(x, y + 1, z)] },
        { x: x1, y: y1, z: z0, value: field[index(x + 1, y + 1, z)] },
        { x: x1, y: y1, z: z1, value: field[index(x + 1, y + 1, z + 1)] },
        { x: x0, y: y1, z: z1, value: field[index(x, y + 1, z + 1)] }
      ];
      for (const tetrahedron of tetrahedra) polygonize(tetrahedron.map(corner => corners[corner]));
    }

    const addTopCap = triangle => {
      let polygon = [];
      for (let i = 0; i < triangle.length; i++) {
        const current = triangle[i];
        const previous = triangle[(i + triangle.length - 1) % triangle.length];
        const currentInside = current.value >= isoLevel;
        const previousInside = previous.value >= isoLevel;
        if (currentInside !== previousInside) polygon.push(interpolate(previous, current));
        if (currentInside) polygon.push(current);
      }
      polygon = polygon.filter((point, i) => {
        const previous = polygon[(i + polygon.length - 1) % polygon.length];
        return Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-8;
      });
      for (let i = 1; i < polygon.length - 1; i++) {
        const a = polygon[0], b = polygon[i], c = polygon[i + 1];
        const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
        if (Math.abs(area) < 1e-10) continue;
        positions.push(a.x, topY, a.z, b.x, topY, b.z, c.x, topY, c.z);
      }
    };
    for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
      const x0 = -HALF + x * step, x1 = x0 + step;
      const z0 = -HALF + z * step, z1 = z0 + step;
      const index = (ix, iz) => verticalSegments * planeSize + iz * width + ix;
      const a = { x: x0, y: topY, z: z0, value: field[index(x, z)] };
      const b = { x: x1, y: topY, z: z0, value: field[index(x + 1, z)] };
      const c = { x: x0, y: topY, z: z1, value: field[index(x, z + 1)] };
      const d = { x: x1, y: topY, z: z1, value: field[index(x + 1, z + 1)] };
      addTopCap([a, d, b]);
      addTopCap([a, c, d]);
    }

    const addBottomCap = triangle => {
    let polygon = [];
    for (let i = 0; i < triangle.length; i++) {
      const current = triangle[i];
      const previous = triangle[(i + triangle.length - 1) % triangle.length];
      const currentInside = current.value >= isoLevel;
      const previousInside = previous.value >= isoLevel;
      if (currentInside !== previousInside) polygon.push(interpolate(previous, current));
      if (currentInside) polygon.push(current);
    }
    polygon = polygon.filter((point, i) => {
      const previous = polygon[(i + polygon.length - 1) % polygon.length];
      return Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-8;
    });
    for (let i = 1; i < polygon.length - 1; i++) {
      const a = polygon[0], b = polygon[i], c = polygon[i + 1];
      const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
      if (Math.abs(area) < 1e-10) continue;
      positions.push(a.x, bottomY, a.z, c.x, bottomY, c.z, b.x, bottomY, b.z);
    }
  };
  for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
    const x0 = -HALF + x * step, x1 = x0 + step;
    const z0 = -HALF + z * step, z1 = z0 + step;
    const index = (ix, iz) => iz * width + ix;
    const a = { x: x0, y: bottomY, z: z0, value: field[index(x, z)] };
    const b = { x: x1, y: bottomY, z: z0, value: field[index(x + 1, z)] };
    const c = { x: x0, y: bottomY, z: z1, value: field[index(x, z + 1)] };
    const d = { x: x1, y: bottomY, z: z1, value: field[index(x + 1, z + 1)] };
    addBottomCap([a, d, b]);
    addBottomCap([a, c, d]);
  }

  const addBoundaryCapTriangle = (triangle, outward) => {
      const polygon = [];
      for (let i = 0; i < triangle.length; i++) {
        const current = triangle[i];
        const previous = triangle[(i + triangle.length - 1) % triangle.length];
        const currentInside = current.value >= isoLevel;
        const previousInside = previous.value >= isoLevel;
        if (currentInside !== previousInside) polygon.push(interpolate(previous, current));
        if (currentInside) polygon.push(current);
      }
      for (let i = 1; i < polygon.length - 1; i++) {
        const a = polygon[0];
        let b = polygon[i], c = polygon[i + 1];
        const ab = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        const ac = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z);
        if (ab.cross(ac).dot(outward) < 0) [b, c] = [c, b];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    };
    const sidePoint = (x, y, z) => ({
      x: -HALF + x * step,
      y: verticalLevels[y],
      z: -HALF + z * step,
      value: field[y * planeSize + z * width + x]
    });
    const addCloudBoundarySide = (axis, edge, outward) => {
      for (let y = 0; y < verticalSegments; y++) for (let u = 0; u < segments; u++) {
        const a = axis === 'x' ? sidePoint(edge, y, u) : sidePoint(u, y, edge);
        const b = axis === 'x' ? sidePoint(edge, y, u + 1) : sidePoint(u + 1, y, edge);
        const c = axis === 'x' ? sidePoint(edge, y + 1, u) : sidePoint(u, y + 1, edge);
        const d = axis === 'x' ? sidePoint(edge, y + 1, u + 1) : sidePoint(u + 1, y + 1, edge);
        addBoundaryCapTriangle([a, b, c], outward);
        addBoundaryCapTriangle([c, b, d], outward);
      }
    };
    addCloudBoundarySide('x', 0, new THREE.Vector3(-1, 0, 0));
    addCloudBoundarySide('x', segments, new THREE.Vector3(1, 0, 0));
    addCloudBoundarySide('z', 0, new THREE.Vector3(0, 0, -1));
    addCloudBoundarySide('z', segments, new THREE.Vector3(0, 0, 1));

    const uniquePositions = [];
    const indices = [];
    const vertexLookup = new Map();
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const key = `${Math.round(x * 10000)},${Math.round(y * 10000)},${Math.round(z * 10000)}`;
      let vertex = vertexLookup.get(key);
      if (vertex === undefined) {
        vertex = uniquePositions.length / 3;
        vertexLookup.set(key, vertex);
        uniquePositions.push(x, y, z);
      }
      indices.push(vertex);
    }

    let cloud = clouds[0];
    if (!cloud) {
      cloud = new THREE.Mesh(new THREE.BufferGeometry(), cloudMaterial);
      cloud.castShadow = true;
      cloud.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      cloud.frustumCulled = false;
      scene.add(cloud);
      clouds[0] = cloud;
    }
    const geometry = cloud.geometry;
    let positionAttribute = geometry.getAttribute('position');
    if (!positionAttribute || positionAttribute.array.length < uniquePositions.length) {
      let capacity = Math.max(3, positionAttribute ? positionAttribute.array.length : 0);
      while (capacity < uniquePositions.length) capacity *= 2;
      const array = new Float32Array(capacity);
      if (positionAttribute) array.set(positionAttribute.array);
      positionAttribute = new THREE.BufferAttribute(array, 3).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', positionAttribute);
    }
    positionAttribute.array.set(uniquePositions);
    positionAttribute.count = uniquePositions.length / 3;
    positionAttribute.needsUpdate = true;

    let indexAttribute = geometry.getIndex();
    if (!indexAttribute || indexAttribute.array.length < indices.length) {
      let capacity = Math.max(3, indexAttribute ? indexAttribute.array.length : 0);
      while (capacity < indices.length) capacity *= 2;
      const array = new Uint32Array(capacity);
      if (indexAttribute) array.set(indexAttribute.array);
      indexAttribute = new THREE.BufferAttribute(array, 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setIndex(indexAttribute);
    }
    indexAttribute.array.set(indices);
    indexAttribute.count = indices.length;
    indexAttribute.needsUpdate = true;
    geometry.setDrawRange(0, indices.length);
    geometry.computeVertexNormals();
    cloud.geometry.computeBoundingSphere();
    sun.shadow.needsUpdate = true;
    cloud.visible = indices.length > 0;
  }

  function buildTerrain() {
    // Terrain mesh generation lives in the shared renderer module.
    buildTerrainModule({
      THREE, N, STEP, HALF, center, height, biomeAt, rand, smooth, sun,
      sandColors, alpineColors, wetlandColors, grassColors, shoreColor, stoneColor,
      groundPositions, groundColors, groundBaseColors, terrainGeometry,
      sidePositions, sideColors, sideGeometry, BOTTOM, sample, river, riverWidth,
      fall, fallStreak, WATER
    });
  }

  function buildLife() {
    for (const batch of instances) batch.count = 0;
    terrainObstacles.length = 0;
    const spacing = 2.25;
    let trees = 0;
    const startX = Math.floor((center.x - HALF - 2) / spacing);
    const endX = Math.ceil((center.x + HALF + 2) / spacing);
    const startZ = Math.floor((center.y - HALF - 2) / spacing);
    const endZ = Math.ceil((center.y + HALF + 2) / spacing);
    for (let iz = startZ; iz <= endZ; iz++) for (let ix = startX; ix <= endX; ix++) {
      const wx = (ix + rand(ix, iz, 1) * .8) * spacing;
      const wz = (iz + rand(ix, iz, 2) * .8) * spacing;
      const x = wx - center.x, z = wz - center.y;
      if (Math.abs(x) > HALF + 1 || Math.abs(z) > HALF + 1) continue;
      const y = height(wx, wz);
      const r = rand(ix, iz, 3);
      const forest = sample(wx, wz, .065, 21);
      const kind = biomeAt(wx, wz);
      const treeChance = kind === 'forest' ? .82 : kind === 'wetland' ? .46 : kind === 'grassland' ? .16 : 0;
      if (y > 1.35 && r < treeChance && r > .35 - forest * .5 && Math.abs(wx - river(wz)) > riverWidth(wz) + 2) {
        const size = .75 + rand(ix, iz, 4) * .65;
        place(trunks, x, y + size * .65, z, size, size * 1.3, size);
        terrainObstacles.push({ x: wx, z: wz, radius: size * .55 });
        if (rand(ix, iz, 7) > .24) {
          for (let tier = 0; tier < 3; tier++) place(pines[tier], x, y + size * (1.5 + tier * .64), z, size * (1.08 - tier * .23), size * 1.75, size * (1.08 - tier * .23), r * 6);
        } else {
          place(leaf, x, y + size * 2.2, z, size * 1.3, size * 1.15, size * 1.3, r * 6);
          place(leafLight, x + .4 * size, y + size * 2.7, z + .1, size * .8, size * .8, size * .85);
        }
        trees++;
      } else if (kind === 'desert' && y > .8 && r < .3) {
        const s = .7 + rand(ix, iz, 8) * .8;
        place(desertPlants, x, y + s * .7, z, s, s * 1.4, s, r * 30);
      } else if (y > .7 && r < (kind === 'alpine' ? .48 : kind === 'desert' ? .06 : .14)) {
        const s = kind === 'alpine' ? 1.15 + rand(ix, iz, 8) * 1.8 : .22 + rand(ix, iz, 8) * .5;
        place(rocks, x, y + s * .28, z, s * (kind === 'alpine' ? 1.5 : 1.4), s * .8, s, r * 30);
        terrainObstacles.push({ x: wx, z: wz, radius: s * .8 });
        if (r < (kind === 'alpine' ? .28 : .06)) {
          place(rocks, x + s, y + s * .1, z + .3, s * .7, s * .5, s * .8);
          terrainObstacles.push({ x: wx + s, z: wz + .3, radius: s * .55 });
        }
      } else if (y > 1.1 && kind !== 'desert') {
        const tuftCount = kind === 'grassland' ? 5 : kind === 'alpine' ? 1 : 3;
        for (let j = 0; j < tuftCount; j++) {
          const ox = (rand(ix, iz, j + 20) - .5) * 1.4;
          const oz = (rand(ix, iz, j + 30) - .5) * 1.4;
          const yy = height(wx + ox, wz + oz);
          if (yy < 1) continue;
          place(grass, x + ox, yy + .2, z + oz, .65, .65, .65, r * 10);
          if ((kind === 'grassland' || kind === 'wetland') && r > .5 && forest < .15) {
            place(flowerStem, x + ox, yy + .22, z + oz, 1);
            place(petals[Math.floor(rand(ix, iz, 40) * 3)], x + ox, yy + .46, z + oz, 1);
          }
        }
      }
    }
    for (let z = -HALF + .5; z < HALF; z += 1.3) {
      const wz = z + center.y;
      const x = river(wz) - center.x;
      if (Math.abs(x) < HALF - 1) {
        place(ripples, x + Math.sin(wz * 2) * .8, WATER + .025, z, .3 + rand(Math.floor(wz), 3) * .8, 1, .035);
      }
    }
    const waterCell = 44;
    for (let iz = Math.floor((center.y - HALF) / waterCell) - 1; iz <= Math.ceil((center.y + HALF) / waterCell) + 1; iz++) {
      for (let ix = Math.floor((center.x - HALF) / waterCell) - 1; ix <= Math.ceil((center.x + HALF) / waterCell) + 1; ix++) {
        const body = waterBody(ix, iz);
        if (!body || Math.abs(body.x - center.x) > HALF + body.radius || Math.abs(body.z - center.y) > HALF + body.radius) continue;
        place(pondWater, body.x - center.x, body.level, body.z - center.y, body.radius, 1, body.radius);
      }
    }
    for (const mesh of instances) {
      mesh.instanceMatrix.needsUpdate = true;
      rebuildBoundaryCaps(mesh, mesh.geometry);
    }

    for (const a of animalPool) a.model.visible = false;
    let sheepIndex = 0, deerIndex = 18, animals = 0;
    const cell = 8;
    for (let iz = Math.floor((center.y - HALF) / cell); iz <= Math.ceil((center.y + HALF) / cell); iz++) {
      for (let ix = Math.floor((center.x - HALF) / cell); ix <= Math.ceil((center.x + HALF) / cell); ix++) {
        if (rand(ix, iz, 70) > .44) continue;
        const wx = (ix + .2 + rand(ix, iz, 71) * .6) * cell;
        const wz = (iz + .2 + rand(ix, iz, 72) * .6) * cell;
        if (Math.abs(wx - center.x) > HALF - 1 || Math.abs(wz - center.y) > HALF - 1 || height(wx, wz) < 1.3 || Math.abs(wx - river(wz)) < riverWidth(wz) + 3.5) continue;
        if (terrainObstacles.some(obstacle => Math.hypot(wx - obstacle.x, wz - obstacle.z) < obstacle.radius + .55)) continue;
        if (animalPool.some(other => other.model.visible && Math.hypot(wx - other.lastX, wz - other.lastZ) < 1.15)) continue;
        const isDeer = rand(ix, iz, 73) > .65;
        const index = isDeer ? deerIndex++ : sheepIndex++;
        if ((!isDeer && index >= 18) || index >= 30) continue;
        const a = animalPool[index];
        a.model.visible = true;
        a.x = wx; a.z = wz;
        a.lastX = wx; a.lastZ = wz;
        a.phase = rand(ix, iz, 74) * Math.PI * 2;
        a.speed = .11 + rand(ix, iz, 75) * .12;
        a.model.scale.setScalar(.75 + rand(ix, iz, 76) * .25);
        animals++;
      }
    }
    $('population').textContent = `${trees} trees · ${animals} wandering animals`;
  }

  const rainCellKey = (x, z) => `${Math.floor(x / RAIN_CELL_SIZE)},${Math.floor(z / RAIN_CELL_SIZE)}`;
  function requestRainResample(threshold) {
    rainThreshold = threshold;
    lastRainSample = -Infinity;
  }
  function rainCloudAt(x, z) {
    const bottomY = 12.5;
    const step = Math.max(1, (cloudCeilingHeight - bottomY) / 10);
    const smoothValue = value => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
    let strongest = { density: -Infinity, y: bottomY };
    for (let y = bottomY; y <= cloudCeilingHeight; y += step) {
      const altitude = THREE.MathUtils.clamp((y - bottomY) / (22 - bottomY), 0, 1);
      const threshold = cloudHumidityCutoff - .22 * smoothValue(altitude) + (1 - smoothValue(altitude / .16)) * 1.1;
      const broad = perlite.sample(x * CLOUD_NOISE_CONFIG.broad.frequency + noiseOffset + 91 + time * CLOUD_WIND_SPEED * .008, y * CLOUD_NOISE_CONFIG.broad.verticalFrequency + 7.3 + time * CLOUD_WIND_SPEED * .014, z * CLOUD_NOISE_CONFIG.broad.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .006);
      const detail = perlite.sample(x * CLOUD_NOISE_CONFIG.detail.frequency + noiseOffset + 113 + time * CLOUD_WIND_SPEED * .014, y * CLOUD_NOISE_CONFIG.detail.verticalFrequency + 13.7 + time * CLOUD_WIND_SPEED * .023, z * CLOUD_NOISE_CONFIG.detail.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .011);
      const fine = perlite.sample(x * CLOUD_NOISE_CONFIG.fine.frequency + noiseOffset + 139 + time * CLOUD_WIND_SPEED * .021, y * CLOUD_NOISE_CONFIG.fine.verticalFrequency + 19.1 + time * CLOUD_WIND_SPEED * .034, z * CLOUD_NOISE_CONFIG.fine.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .016);
      const micro = perlite.sample(x * CLOUD_NOISE_CONFIG.micro.frequency + noiseOffset + 157 + time * CLOUD_WIND_SPEED * .028, y * CLOUD_NOISE_CONFIG.micro.verticalFrequency + 23.9 + time * CLOUD_WIND_SPEED * .045, z * CLOUD_NOISE_CONFIG.micro.frequency - noiseOffset - time * CLOUD_WIND_SPEED * .022);
      const density = CLOUD_NOISE_CONFIG.baseDensity + broad * CLOUD_NOISE_CONFIG.broad.weight + detail * CLOUD_NOISE_CONFIG.detail.weight + fine * CLOUD_NOISE_CONFIG.fine.weight + micro * CLOUD_NOISE_CONFIG.micro.weight - threshold;
      if (density > strongest.density) strongest = { density, y };
    }
    return strongest;
  }
  function refreshWetSurfaceColors() {
    const smoothWetness = wetness => {
      const value = THREE.MathUtils.clamp(wetness, 0, 1);
      return value * value * (3 - 2 * value);
    };
    const wetnessAt = (x, z) => {
      const gridX = x / RAIN_CELL_SIZE - .5;
      const gridZ = z / RAIN_CELL_SIZE - .5;
      const x0 = Math.floor(gridX), z0 = Math.floor(gridZ);
      const fractionX = gridX - x0, fractionZ = gridZ - z0;
      const blendX = fractionX * fractionX * (3 - 2 * fractionX);
      const blendZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
      const cellWetness = (ix, iz) => wetnessByCell.get(rainCellKey((ix + .5) * RAIN_CELL_SIZE, (iz + .5) * RAIN_CELL_SIZE)) || 0;
      const near = THREE.MathUtils.lerp(cellWetness(x0, z0), cellWetness(x0 + 1, z0), blendX);
      const far = THREE.MathUtils.lerp(cellWetness(x0, z0 + 1), cellWetness(x0 + 1, z0 + 1), blendX);
      const interpolated = THREE.MathUtils.lerp(near, far, blendZ);
      const noise = THREE.MathUtils.clamp((sample(x, z, .12, 47) + 1) * .5, 0, 1);
      return smoothWetness(interpolated * (.82 + noise * .18));
    };
    for (let i = 0; i < groundPositions.length; i += 3) {
      const wetness = wetnessAt(groundPositions[i] + center.x, groundPositions[i + 2] + center.y);
      const shade = 1 - wetness * .68;
      groundColors[i] = groundBaseColors[i] * shade;
      groundColors[i + 1] = groundBaseColors[i + 1] * shade;
      groundColors[i + 2] = groundBaseColors[i + 2] * shade;
    }
    terrainGeometry.attributes.color.needsUpdate = true;
    const tint = new THREE.Color();
    for (const mesh of instances) {
      const positions = mesh.userData.rainWorldPositions;
      const isWaterSurface = mesh === ripples || mesh === pondWater;
      for (let i = 0; i < mesh.count; i++) {
        const wetness = isWaterSurface ? 0 : wetnessAt(positions[i * 2], positions[i * 2 + 1]);
        tint.setRGB(1 - wetness * .68, 1 - wetness * .68, 1 - wetness * .68);
        mesh.setColorAt(i, tint);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const animal of animalPool) {
      const wetness = wetnessAt(animal.lastX || animal.x, animal.lastZ || animal.z);
      for (const item of animal.wetMaterials) item.material.color.copy(item.dryColor).multiplyScalar(1 - wetness * .68);
    }
  }
  const RAIN_SPLASH_CAPACITY = 24;
  const RAIN_SPLASH_SPOKES = 8;
  const RAIN_SPLASH_DROPLETS = 4;
  const rainSplashes = Array.from({ length: RAIN_SPLASH_CAPACITY }, () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RAIN_SPLASH_SPOKES + RAIN_SPLASH_DROPLETS) * 6), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xe8ffff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.visible = false;
    scene.add(mesh);
    return { geometry, material, mesh, age: 0, x: 0, z: 0, y: 0, active: false };
  });
  let rainSplashCursor = 0;
  function spawnRainSplash(streak) {
    const splash = rainSplashes[rainSplashCursor];
    rainSplashCursor = (rainSplashCursor + 1) % RAIN_SPLASH_CAPACITY;
    splash.x = streak.x + center.x;
    splash.z = streak.z + center.y;
    splash.y = streak.groundY;
    splash.age = 0;
    splash.active = true;
    splash.mesh.visible = true;
  }
  function updateRainSplashes(delta) {
    for (const splash of rainSplashes) {
      if (!splash.active) continue;
      splash.age += delta;
      const progress = splash.age / 2;
      if (progress >= 1) {
        splash.active = false;
        splash.mesh.visible = false;
        continue;
      }
      const radius = .12 + progress * .88;
      const lift = Math.sin(progress * Math.PI) * .12;
      const positions = splash.geometry.attributes.position.array;
      const x = splash.x - center.x;
      const z = splash.z - center.y;
      for (let spoke = 0; spoke < RAIN_SPLASH_SPOKES; spoke++) {
        const angle = spoke * Math.PI * 2 / RAIN_SPLASH_SPOKES;
        const nextAngle = (spoke + 1) * Math.PI * 2 / RAIN_SPLASH_SPOKES;
        const offset = spoke * 6;
        positions[offset] = x + Math.cos(angle) * radius;
        positions[offset + 1] = splash.y + .05 + lift * .35;
        positions[offset + 2] = z + Math.sin(angle) * radius;
        positions[offset + 3] = x + Math.cos(nextAngle) * radius;
        positions[offset + 4] = splash.y + .05 + lift * .35;
        positions[offset + 5] = z + Math.sin(nextAngle) * radius;
      }
      for (let droplet = 0; droplet < RAIN_SPLASH_DROPLETS; droplet++) {
        const angle = (droplet + .5) * Math.PI * 2 / RAIN_SPLASH_DROPLETS;
        const distance = .18 + progress * .42;
        const rise = Math.sin(progress * Math.PI * .8) * .42;
        const offset = (RAIN_SPLASH_SPOKES + droplet) * 6;
        const dropletX = x + Math.cos(angle) * distance;
        const dropletZ = z + Math.sin(angle) * distance;
        const dropletY = splash.y + .06 + rise;
        const tail = .12 * (1 - progress);
        positions[offset] = dropletX;
        positions[offset + 1] = dropletY;
        positions[offset + 2] = dropletZ;
        positions[offset + 3] = dropletX + Math.cos(angle) * tail * .35;
        positions[offset + 4] = dropletY + tail;
        positions[offset + 5] = dropletZ + Math.sin(angle) * tail * .35;
      }
      splash.geometry.attributes.position.needsUpdate = true;
      splash.material.opacity = .9 * (1 - progress);
    }
  }
  function updateRainWorld(now, delta, densityThreshold) {
    if (now - lastRainSample >= RAIN_SAMPLE_INTERVAL) {
      const nextCells = [];
      const cutoff = densityThreshold - .5;
      const startX = Math.floor((center.x - HALF) / RAIN_CELL_SIZE);
      const endX = Math.ceil((center.x + HALF) / RAIN_CELL_SIZE);
      const startZ = Math.floor((center.y - HALF) / RAIN_CELL_SIZE);
      const endZ = Math.ceil((center.y + HALF) / RAIN_CELL_SIZE);
      for (let iz = startZ; iz <= endZ; iz++) for (let ix = startX; ix <= endX; ix++) {
        const x = (ix + .5) * RAIN_CELL_SIZE;
        const z = (iz + .5) * RAIN_CELL_SIZE;
        if (Math.abs(x - center.x) > HALF || Math.abs(z - center.y) > HALF) continue;
        const cloud = rainCloudAt(x, z);
        if (cloud.density >= cutoff) nextCells.push({ x, z, y: cloud.y, density: cloud.density });
      }
      rainCells = nextCells;
      const activeCellKeys = new Set(rainCells.map(cell => rainCellKey(cell.x, cell.z)));
      rainStreaks = rainStreaks.filter(streak => activeCellKeys.has(streak.cellKey));
      const streakCounts = new Map();
      for (const streak of rainStreaks) streakCounts.set(streak.cellKey, (streakCounts.get(streak.cellKey) || 0) + 1);
      for (const cell of rainCells) {
        const cellKey = rainCellKey(cell.x, cell.z);
        const targetCount = Math.max(5, Math.ceil(Math.max(0, cell.density) * 240));
        for (let i = streakCounts.get(cellKey) || 0; i < targetCount && rainStreaks.length < RAIN_STREAK_CAPACITY; i++) {
          const x = cell.x + (rand(Math.floor(cell.x), i, 101) - .5) * RAIN_CELL_SIZE;
          const z = cell.z + (rand(Math.floor(cell.z), i, 102) - .5) * RAIN_CELL_SIZE;
          const groundY = height(x, z);
          const y = groundY + 1 + rand(Math.floor(cell.z), i, 103) * Math.max(0, cell.y - groundY - 1);
          rainStreaks.push({ x: x - center.x, y, z: z - center.y, groundY, cloudY: cell.y, cellKey });
        }
      }
      lastRainSample = now;
    }
    let wetnessChanged = false;
    const rainingCells = new Set(rainCells.map(cell => rainCellKey(cell.x, cell.z)));
    for (const [key, value] of wetnessByCell) {
      if (rainingCells.has(key)) continue;
      const next = value * Math.exp(-delta * WET_SURFACE_DRYING_RATE / WET_SURFACE_DRYING_DURATION);
      if (next !== value) wetnessChanged = true;
      if (next <= .01) wetnessByCell.delete(key);
      else wetnessByCell.set(key, next);
    }
    for (const cell of rainCells) {
      const key = rainCellKey(cell.x, cell.z);
      const wetness = wetnessByCell.get(key) || 0;
      wetnessByCell.set(key, THREE.MathUtils.clamp(1 - (1 - wetness) * Math.exp(-delta * .32), 0, 1));
      wetnessChanged = true;
    }
    for (let i = 0; i < rainStreaks.length; i++) {
      const streak = rainStreaks[i];
      streak.y -= RAIN_FALL_SPEED * delta;
      if (streak.y <= streak.groundY + .5) {
        spawnRainSplash(streak);
        streak.y = streak.cloudY;
      }
      rainPositions.set([streak.x, streak.y, streak.z, streak.x, streak.y - .3, streak.z], i * 6);
    }
    updateRainSplashes(delta);
    rainGeometry.attributes.position.needsUpdate = true;
    rainGeometry.setDrawRange(0, rainStreaks.length * 2);
    if (now - lastRainVisualUpdate >= RAIN_VISUAL_INTERVAL) {
      if (wetnessChanged) refreshWetSurfaceColors();
      lastRainVisualUpdate = now;
    }
  }

  function updateAnimals() {
    const blocked = (x, z, animal) => {
      for (const obstacle of terrainObstacles) {
        if (Math.hypot(x - obstacle.x, z - obstacle.z) < obstacle.radius + .55) return true;
      }
      for (const other of animalPool) {
        if (other === animal || !other.model.visible) continue;
        if (Math.hypot(x - other.lastX, z - other.lastZ) < 1.15) return true;
      }
      return false;
    };
    for (const a of animalPool) {
      if (!a.model.visible) continue;
      const angle = time * a.speed + a.phase;
      const targetX = a.x + Math.sin(angle) * .7, targetZ = a.z + Math.cos(angle) * .7;
      const dx = targetX - a.lastX, dz = targetZ - a.lastZ;
      const distance = Math.hypot(dx, dz);
      let wx = targetX, wz = targetZ;
      if (blocked(wx, wz, a)) {
        const step = Math.min(distance, .08);
        const direction = Math.atan2(dz, dx);
        let found = false;
        for (const offset of [Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const candidateX = a.lastX + Math.cos(direction + offset) * step;
          const candidateZ = a.lastZ + Math.sin(direction + offset) * step;
          if (!blocked(candidateX, candidateZ, a)) {
            wx = candidateX;
            wz = candidateZ;
            found = true;
            break;
          }
        }
        if (!found) { wx = a.lastX; wz = a.lastZ; }
      }
      a.lastX = wx; a.lastZ = wz;
      a.model.position.set(wx - center.x, height(wx, wz) + .05, wz - center.y);
      a.model.rotation.y = -angle + Math.PI / 2;
      a.head.rotation.x = .13 + Math.sin(time * .8 + a.phase) * .17;
      a.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(time * 3.5 + a.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * .14; });
    }
    rebuildAnimalBoundaryCaps();
  }
  function updateWorld(now) {
    buildTerrain();
    buildLife();
    buildClouds();
    updateAnimals();
    refreshWetSurfaceColors();
    $('seed').textContent = String(seed).padStart(5, '0');
    const format = n => `${n < 0 ? '−' : ''}${String(Math.abs(Math.round(n))).padStart(4, '0')}`;
    $('coordinates').innerHTML = `X ${format(center.x)} <i>/</i> Z ${format(center.y)}`;
    dirty = false;
    lastBuild = now;
  }

  function resize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    const aspect = w / h;
    const halfHeight = Math.max(33, 42 / aspect);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(mount);
  resize();

  function setMode(next) {
    mode = next;
    controls.mouseButtons.LEFT = mode === 'orbit' ? THREE.MOUSE.ROTATE : null;
    controls.touches.ONE = mode === 'orbit' ? THREE.TOUCH.ROTATE : null;
    controls.touches.TWO = mode === 'orbit' ? THREE.TOUCH.DOLLY_ROTATE : null;
    canvas.classList.toggle('orbiting', mode === 'orbit');
    for (const name of ['pan', 'orbit']) {
      $(name).classList.toggle('selected', name === mode);
      $(name).setAttribute('aria-pressed', String(name === mode));
    }
    $('hint').innerHTML = mode === 'pan' ? 'Drag to explore <span>·</span> Scroll to zoom' : 'Drag to orbit <span>·</span> Scroll to zoom';
  }
  $('pan').addEventListener('click', () => setMode('pan'));
  $('orbit').addEventListener('click', () => setMode('orbit'));
  function zoomBy(factor) {
    camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom);
    camera.updateProjectionMatrix();
  }
  $('zoom-in').addEventListener('click', () => zoomBy(1.18));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / 1.18));
  function resetView() {
    center.set(0, 0);
    camera.position.copy(homePosition);
    controls.target.set(0, 2, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    dirty = true;
  }
  $('reset').addEventListener('click', resetView);
  $('regenerate').addEventListener('click', () => {
    seed = Math.floor(Math.random() * 99999);
    noiseOffset = seed * .173;
    center.set(0, 0);
    dirty = true;
  });
  function updatePause() {
    $('pause').setAttribute('aria-pressed', String(paused));
    $('pause').setAttribute('aria-label', paused ? 'Resume wildlife and clouds' : 'Pause wildlife and clouds');
    $('pause').title = paused ? 'Resume wildlife and clouds' : 'Pause wildlife and clouds';
    $('pause').innerHTML = paused ? '<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>';
    $('status').textContent = paused ? 'A quiet moment' : 'Ecosystem active';
  }
  $('pause').addEventListener('click', () => { paused = !paused; updatePause(); });
  updatePause();

  let terrainRecoveryTier = 0;
  let terrainRecoveryLayers = 2;
  function applyTerrainResolution(resolution) {
    const nextResolution = Math.min(selectedTerrainResolution, Math.max(32, Math.round(resolution)));
    if (nextResolution === N) return;
    allocateGridBuffers(nextResolution);
    dirty = true;
  }
  function applyTerrainRecoveryTier() {
    const recoveryFraction = terrainRecoveryLayers === 0 ? .25 : (terrainRecoveryTier + 1) / (terrainRecoveryLayers + 1);
    applyTerrainResolution(selectedTerrainResolution * recoveryFraction);
  }
  const terrainLodToggle = $('terrain-lod-toggle');
  const terrainLodPanel = $('terrain-lod-panel');
  const terrainLodSlider = $('terrain-lod-layers');
  const terrainLodValue = $('terrain-lod-value');
  configureTuningSlider(terrainLodSlider, FINE_TUNING_SETTINGS.terrainRecoveryLayers);
  if (terrainLodToggle && terrainLodPanel && terrainLodSlider) {
    terrainLodToggle.addEventListener('click', () => toggleFineTuningPanel(terrainLodToggle, terrainLodPanel));
    const updateTerrainRecoveryLayers = () => {
      terrainRecoveryLayers = Math.round(Number(terrainLodSlider.value));
      terrainLodSlider.value = String(terrainRecoveryLayers);
      if (terrainLodValue) terrainLodValue.textContent = `${terrainRecoveryLayers} ${terrainRecoveryLayers === 1 ? 'layer' : 'layers'}`;
      if (terrainPanning) {
        terrainRecoveryTier = Math.min(terrainRecoveryTier, terrainRecoveryLayers);
        applyTerrainRecoveryTier();
      }
    };
    terrainLodSlider.addEventListener('input', updateTerrainRecoveryLayers);
    updateTerrainRecoveryLayers();
  }
  const resolutionToggle = $('terrain-resolution-toggle');
  const resolutionPanel = $('terrain-resolution-panel');
  const resolutionSlider = resolutionPanel?.querySelector('input[type="range"]') || $('terrain-resolution');
  const resolutionValue = resolutionPanel?.querySelector('output, [data-resolution-value]') || $('terrain-resolution-value');
  configureTuningSlider(resolutionSlider, FINE_TUNING_SETTINGS.terrainResolution);
  if (resolutionToggle && resolutionPanel && resolutionSlider) {
    resolutionToggle.addEventListener('click', () => toggleFineTuningPanel(resolutionToggle, resolutionPanel));
    const updateResolution = () => {
      const resolution = Math.round(Number(resolutionSlider.value));
      selectedTerrainResolution = resolution;
      resolutionSlider.value = String(resolution);
      if (resolutionValue) resolutionValue.textContent = `${resolution} × ${resolution}`;
      if (terrainPanning) applyTerrainRecoveryTier();
      else applyTerrainResolution(selectedTerrainResolution);
    };
    resolutionSlider.addEventListener('input', updateResolution);
    updateResolution();
  }

  const terrainCeilingToggle = $('terrain-ceiling-toggle');
  const terrainCeilingPanel = $('terrain-ceiling-panel');
  const terrainCeilingSlider = $('terrain-ceiling');
  const terrainCeilingValue = $('terrain-ceiling-value');
  configureTuningSlider(terrainCeilingSlider, FINE_TUNING_SETTINGS.cloudCeiling);
  if (terrainCeilingToggle && terrainCeilingPanel && terrainCeilingSlider) {
    terrainCeilingToggle.addEventListener('click', () => toggleFineTuningPanel(terrainCeilingToggle, terrainCeilingPanel));
    const updateTerrainCeiling = () => {
      cloudCeilingHeight = Number(terrainCeilingSlider.value);
      if (terrainCeilingValue) terrainCeilingValue.textContent = `${cloudCeilingHeight} m`;
      buildClouds();
    };
    terrainCeilingSlider.addEventListener('input', updateTerrainCeiling);
    updateTerrainCeiling();
  }

  const cloudHumidityToggle = $('cloud-humidity-toggle');
  const cloudHumidityPanel = $('cloud-humidity-panel');
  const cloudHumiditySlider = $('cloud-humidity');
  const cloudHumidityValue = $('cloud-humidity-value');
  configureTuningSlider(cloudHumiditySlider, FINE_TUNING_SETTINGS.cloudHumidity);
  if (cloudHumidityToggle && cloudHumidityPanel && cloudHumiditySlider) {
    cloudHumidityToggle.addEventListener('click', () => toggleFineTuningPanel(cloudHumidityToggle, cloudHumidityPanel));
    const updateCloudHumidity = () => {
      cloudHumidityCutoff = Number(cloudHumiditySlider.value) / 100;
      if (cloudHumidityValue) cloudHumidityValue.textContent = `${cloudHumiditySlider.value}%`;
      buildClouds();
    };
    cloudHumiditySlider.addEventListener('input', updateCloudHumidity);
    updateCloudHumidity();
  }

  let cloudGridResolution = 0;
  const cloudResolutionToggle = $('cloud-resolution-toggle');
  const cloudResolutionPanel = $('cloud-resolution-panel');
  const cloudResolutionSlider = $('cloud-resolution');
  const cloudResolutionValue = $('cloud-resolution-value');
  configureTuningSlider(cloudResolutionSlider, FINE_TUNING_SETTINGS.cloudResolution);
  if (cloudResolutionToggle && cloudResolutionPanel && cloudResolutionSlider) {
    cloudResolutionToggle.addEventListener('click', () => toggleFineTuningPanel(cloudResolutionToggle, cloudResolutionPanel));
    const updateCloudResolution = () => {
      cloudGridResolution = Math.round(Number(cloudResolutionSlider.value));
      cloudResolutionSlider.value = String(cloudGridResolution);
      if (cloudResolutionValue) cloudResolutionValue.textContent = `${cloudGridResolution} × ${cloudGridResolution}`;
      cloudResolution = cloudGridResolution;
      buildClouds();
    };
    cloudResolutionSlider.addEventListener('input', updateCloudResolution);
    updateCloudResolution();
  }

  const rainThresholdToggle = $('rain-threshold-toggle');
  const rainThresholdPanel = $('rain-threshold-panel');
  const rainThresholdSlider = $('rain-threshold');
  const rainThresholdValue = $('rain-threshold-value');
  let rainDensityThreshold = 0;
  configureTuningSlider(rainThresholdSlider, FINE_TUNING_SETTINGS.rainDensityThreshold);
  if (rainThresholdToggle && rainThresholdPanel && rainThresholdSlider) {
    rainThresholdToggle.addEventListener('click', () => toggleFineTuningPanel(rainThresholdToggle, rainThresholdPanel));
    const updateRainThreshold = () => {
      rainDensityThreshold = Number(rainThresholdSlider.value) / 100;
      if (rainThresholdValue) rainThresholdValue.textContent = `${rainThresholdSlider.value}%`;
      requestRainResample(rainDensityThreshold);
    };
    rainThresholdSlider.addEventListener('input', updateRainThreshold);
    updateRainThreshold();
  }

  const perlinSamplingToggle = $('perlin-sampling-toggle');
  const perlinResolution = $('perlin-resolution');
  const perlinSamplingStatus = $('perlin-sampling-status');
  let perlinLoadGeneration = 0;
  async function loadPerlinNoiseMap() {
    const generation = ++perlinLoadGeneration;
    const resolution = Number(perlinResolution.value);
    perlite.setSamplingEnabled(false);
    perlinSamplingStatus.textContent = `Loading ${resolution} × ${resolution} noise map…`;
    try {
      await perlite.generateMap(resolution);
      if (generation !== perlinLoadGeneration) return;
      perlite.setSamplingEnabled(perlinSamplingToggle.checked);
      dirty = true;
      lastCloudAnimationBuild = -Infinity;
      perlinSamplingStatus.textContent = `${resolution} × ${resolution} generated noise map ready`;
    } catch (error) {
      if (generation !== perlinLoadGeneration) return;
      perlite.setSamplingEnabled(false);
      perlinSamplingStatus.textContent = 'Noise map generation failed; using calculated Perlin noise';
      console.warn('Generated Perlin noise map unavailable; using calculated Perlin noise.', error);
    }
  }
  perlinSamplingToggle.addEventListener('change', () => {
    perlinLoadGeneration++;
    if (perlinSamplingToggle.checked) loadPerlinNoiseMap();
    else {
      perlite.setSamplingEnabled(false);
      perlinSamplingStatus.textContent = 'Using calculated Perlin noise';
    }
    dirty = true;
    lastCloudAnimationBuild = -Infinity;
  });
  perlinResolution.addEventListener('change', () => {
    if (perlinSamplingToggle.checked) loadPerlinNoiseMap();
  });
  if (perlinSamplingToggle.checked) loadPerlinNoiseMap();
  else {
    perlite.setSamplingEnabled(false);
    perlinSamplingStatus.textContent = 'Using calculated Perlin noise';
  }

  const right = new THREE.Vector3(), up = new THREE.Vector3();
  let terrainPanTimer = 0;
  function scheduleTerrainRecovery() {
    terrainPanTimer = setTimeout(() => {
      if (terrainRecoveryLayers === 0) {
        terrainPanning = false;
        applyTerrainRecoveryTier();
        return;
      }
      terrainRecoveryTier = Math.min(terrainRecoveryTier + 1, terrainRecoveryLayers);
      if (terrainRecoveryTier >= terrainRecoveryLayers) terrainPanning = false;
      applyTerrainRecoveryTier();
      if (terrainPanning) scheduleTerrainRecovery();
    }, 1000);
  }
  function panPixels(dx, dy) {
    terrainPanning = true;
    terrainRecoveryTier = 0;
    clearTimeout(terrainPanTimer);
    applyTerrainRecoveryTier();
    scheduleTerrainRecovery();
    camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0); right.y = 0; right.normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1); up.y = 0; up.normalize();
    const scale = (camera.top - camera.bottom) / mount.clientHeight / camera.zoom;
    center.x += (-dx * right.x + dy * up.x * 1.5) * scale;
    center.y += (-dx * right.z + dy * up.z * 1.5) * scale;
    dirty = true;
  }
  const pointers = new Map();
  canvas.addEventListener('pointerdown', e => {
    if (mode !== 'pan' || e.button > 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId) || mode !== 'pan') return;
    e.preventDefault();
    const old = pointers.get(e.pointerId);
    if (pointers.size === 1) panPixels(e.clientX - old.x, e.clientY - old.y);
    else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(old.x - other.x, old.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0) zoomBy(after / before);
      panPixels((e.clientX - old.x) / 2, (e.clientY - old.y) / 2);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, e => pointers.delete(e.pointerId));
  canvas.addEventListener('keydown', e => {
    const moves = { ArrowLeft: [26, 0], ArrowRight: [-26, 0], ArrowUp: [0, 26], ArrowDown: [0, -26], a: [26, 0], d: [-26, 0], w: [0, 26], s: [0, -26] };
    if (moves[e.key]) { e.preventDefault(); panPixels(...moves[e.key]); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.12); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 1.12); }
    else if (e.key === 'Home') { e.preventDefault(); resetView(); }
  });

  let previous = performance.now();
  const initializationStarted = previous;
  updateWorld(previous);
  $('world-init-time').textContent = `${Math.round(performance.now() - initializationStarted)} ms`;
  let fpsFrameCount = 0;
  let fpsLastUpdate = performance.now();
  const frameGenerationTimes = [];
  function frame(now) {
    requestAnimationFrame(frame);
    const frameStarted = performance.now();
    const delta = Math.min((now - previous) / 1000, .05);
    previous = now;
    fpsFrameCount++;
    const fpsElapsed = now - fpsLastUpdate;
    if (fpsElapsed >= 500) {
      $('frame-rate').textContent = String(Math.round(fpsFrameCount * 1000 / fpsElapsed));
      fpsFrameCount = 0;
      fpsLastUpdate = now;
    }
    if (!paused && !document.hidden) time += delta;
    controls.update();
    if (dirty && now - lastBuild > 65) updateWorld(now);
    if (!paused && !document.hidden && now - lastCloudAnimationBuild >= 100) {
      buildClouds();
      lastCloudAnimationBuild = now;
    }
    if (!paused && !document.hidden) updateRainWorld(now, delta, rainDensityThreshold);
    updateAnimals();
    fallStreak.material.opacity = .4 + Math.sin(time * 3) * .12;
    ripples.position.z = Math.sin(time * .7) * .13;
    const percent = Math.round(camera.zoom / .65 * 100);
    $('zoom').textContent = `${percent}%`;
    $('zoom-out').disabled = camera.zoom <= controls.minZoom + .001;
    $('zoom-in').disabled = camera.zoom >= controls.maxZoom - .001;
    const azimuth = controls.getAzimuthalAngle();
    document.querySelector('.compass svg').style.transform = `rotate(${-azimuth * 180 / Math.PI}deg)`;
    updateWaterEffects(now);
    renderer.render(scene, camera);
    frameGenerationTimes.push(performance.now() - frameStarted);
    if (frameGenerationTimes.length > 10) frameGenerationTimes.shift();
    if (frameGenerationTimes.length === 10) {
      const averageFrameTime = frameGenerationTimes.reduce((sum, duration) => sum + duration, 0) / 10;
      const variance = frameGenerationTimes.reduce((sum, duration) => sum + (duration - averageFrameTime) ** 2, 0) / 10;
      const standardDeviation = Math.sqrt(variance);
      $('frame-time').textContent = `${averageFrameTime.toFixed(2)}ms (s.d. ${standardDeviation.toFixed(1)}ms)`;
    }
  }
  requestAnimationFrame(frame);
}

try {
  start();
} catch (error) {
  console.error(error);
  $('status').textContent = 'The landscape couldn’t start.';
  $('population').textContent = 'Enable WebGL in your browser, then reload.';
}
