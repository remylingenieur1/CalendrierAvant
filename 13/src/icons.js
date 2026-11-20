import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const ICON_NAMES = ["Collab", "Curious", "Doers", "Ethical", "Quality"];

// Each GLB is a root named after the icon holding <Name>_render (the bevelled
// mesh) and <Name>_colliders, a group of convex pieces tagged
// userData.collider === "convex". The pieces carry no transforms, so their
// vertices are already in the root's space and go to the physics as they are.
export async function loadIcons(CONFIG, base = "./models/") {
  const loader = new GLTFLoader();
  return Promise.all(
    ICON_NAMES.map(async (name) => {
      const gltf = await loader.loadAsync(`${base}${name}.glb`);
      let render = null;
      const hulls = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.role === "render") render = o;
        else if (o.userData.collider === "convex") {
          hulls.push(positionsOf(o.geometry));
          o.geometry.dispose();
        }
      });
      if (!render) throw new Error(`${name}.glb has no render mesh`);
      if (!hulls.length) throw new Error(`${name}.glb has no convex colliders`);

      const geometry = render.geometry;
      geometry.computeBoundingSphere();
      const { center, radius } = geometry.boundingSphere;

      const src = render.material;
      const material = new THREE.MeshPhysicalMaterial({
        name: src.name,
        color: src.color,
        roughness: src.roughness,
        metalness: 0,
        clearcoat: CONFIG.look.clearcoat,
        clearcoatRoughness: 0.2,
      });
      src.dispose();

      return { name, geometry, material, hulls, radius: center.length() + radius };
    }),
  );
}

// Copied out with getX/Y/Z so an interleaved or offset buffer still comes out
// as a tight xyz list
function positionsOf(geometry) {
  const pos = geometry.attributes.position;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i);
    out[i * 3 + 1] = pos.getY(i);
    out[i * 3 + 2] = pos.getZ(i);
  }
  return out;
}
