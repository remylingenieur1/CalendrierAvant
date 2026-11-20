export const CLOUD_NOISE_CONFIG = {
  baseDensity: .34,
  broad: { frequency: .061, verticalFrequency: .2065, weight: .63 },
  detail: { frequency: .171, verticalFrequency: .357, weight: .16 },
  fine: { frequency: .3195, verticalFrequency: .582, weight: .12 },
  micro: { frequency: .2445, verticalFrequency: .45, weight: .08 }
};

// Build the animated cloud volume shared by the landscape renderer.
export function buildClouds({ THREE, HALF, center, cloudResolution, cloudCeilingHeight, cloudHumidityCutoff, perlite, noiseOffset, clouds, cloudMaterial, scene, time = 0 }) {
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
  const smooth = x => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  for (let y = 0; y <= verticalSegments; y++) {
    const worldY = verticalLevels[y];
    for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
      const worldX = -HALF + x * step + center.x;
      const worldZ = -HALF + z * step + center.y;
      const broad = perlite.sample(worldX * CLOUD_NOISE_CONFIG.broad.frequency + noiseOffset + 91 + time * 3 * .008, worldY * CLOUD_NOISE_CONFIG.broad.verticalFrequency + 7.3 + time * 3 * .014, worldZ * CLOUD_NOISE_CONFIG.broad.frequency - noiseOffset - time * 3 * .006);
      const detail = perlite.sample(worldX * CLOUD_NOISE_CONFIG.detail.frequency + noiseOffset + 113 + time * 3 * .014, worldY * CLOUD_NOISE_CONFIG.detail.verticalFrequency + 13.7 + time * 3 * .023, worldZ * CLOUD_NOISE_CONFIG.detail.frequency - noiseOffset - time * 3 * .011);
      const fine = perlite.sample(worldX * CLOUD_NOISE_CONFIG.fine.frequency + noiseOffset + 139 + time * 3 * .021, worldY * CLOUD_NOISE_CONFIG.fine.verticalFrequency + 19.1 + time * 3 * .034, worldZ * CLOUD_NOISE_CONFIG.fine.frequency - noiseOffset - time * 3 * .016);
      const micro = perlite.sample(worldX * CLOUD_NOISE_CONFIG.micro.frequency + noiseOffset + 157 + time * 3 * .028, worldY * CLOUD_NOISE_CONFIG.micro.verticalFrequency + 23.9 + time * 3 * .045, worldZ * CLOUD_NOISE_CONFIG.micro.frequency - noiseOffset - time * 3 * .022);
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
  cloud.geometry.dispose();
  cloud.geometry = new THREE.BufferGeometry();
  cloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(uniquePositions, 3));
  cloud.geometry.setIndex(indices);
  cloud.geometry.computeVertexNormals();
  cloud.geometry.computeBoundingSphere();
  cloud.visible = indices.length > 0;
}
