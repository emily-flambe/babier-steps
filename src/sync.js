import * as THREE from 'three';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/**
 * Syncs all ragdoll physics bodies to their Three.js mesh counterparts.
 */
export function syncPhysicsToMesh(ragdoll) {
  for (const [key, body] of Object.entries(ragdoll.parts)) {
    const mesh = ragdoll.meshes[key];
    if (!mesh || !body) continue;

    const t = body.translation();
    const r = body.rotation();

    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
