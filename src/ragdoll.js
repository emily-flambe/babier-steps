import * as THREE from 'three';

/**
 * Simplified character: one torso body + two feet.
 * No joints — feet are independent physics bodies.
 * Legs are visual lines drawn between torso and feet.
 */
export function createRagdoll(world, scene, RAPIER) {
  const parts = {};
  const meshes = {};
  const footColliders = {};

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc8844 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const legMat = new THREE.LineBasicMaterial({ color: 0x4466aa, linewidth: 2 });

  // --- Torso ---
  const torsoHalfW = 0.25;
  const torsoHalfH = 0.4;
  const torsoHalfD = 0.15;
  const torsoY = 1.4;

  const torsoDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, torsoY, 0)
    .setLinearDamping(2.0)
    .setAngularDamping(5.0);
  parts.body = world.createRigidBody(torsoDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(torsoHalfW, torsoHalfH, torsoHalfD).setMass(15),
    parts.body
  );

  const torsoGeo = new THREE.BoxGeometry(torsoHalfW * 2, torsoHalfH * 2, torsoHalfD * 2);
  meshes.body = new THREE.Mesh(torsoGeo, bodyMat);
  meshes.body.castShadow = true;
  scene.add(meshes.body);

  // Head (cosmetic child of torso)
  const headGeo = new THREE.SphereGeometry(0.15, 16, 16);
  const headMesh = new THREE.Mesh(headGeo, bodyMat);
  headMesh.castShadow = true;
  headMesh.position.y = torsoHalfH + 0.15;
  meshes.body.add(headMesh);

  // --- Feet ---
  const footHalfW = 0.1;
  const footHalfH = 0.05;
  const footHalfD = 0.15;

  for (const side of ['left', 'right']) {
    const xSign = side === 'left' ? -1 : 1;
    const hipX = xSign * 0.15;

    const footDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(hipX, footHalfH, 0.05)
      .setLinearDamping(4.0)
      .setAngularDamping(5.0);
    parts[`foot_${side}`] = world.createRigidBody(footDesc);
    footColliders[side] = world.createCollider(
      RAPIER.ColliderDesc.cuboid(footHalfW, footHalfH, footHalfD)
        .setMass(0.5)
        .setFriction(5.0),
      parts[`foot_${side}`]
    );

    const footGeo = new THREE.BoxGeometry(footHalfW * 2, footHalfH * 2, footHalfD * 2);
    meshes[`foot_${side}`] = new THREE.Mesh(footGeo, footMat);
    meshes[`foot_${side}`].castShadow = true;
    scene.add(meshes[`foot_${side}`]);

    // Visual leg line (torso hip -> foot)
    const legGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1, 0),
    ]);
    meshes[`leg_${side}`] = new THREE.Line(legGeo, legMat);
    scene.add(meshes[`leg_${side}`]);
  }

  return {
    body: parts.body,
    feet: {
      left: parts.foot_left,
      right: parts.foot_right,
    },
    parts,
    meshes,
    setFootFriction(side, friction) {
      footColliders[side].setFriction(friction);
    },
    // Update visual leg lines to connect torso to feet
    updateLegs() {
      const bp = parts.body.translation();
      for (const side of ['left', 'right']) {
        const xSign = side === 'left' ? -1 : 1;
        const fp = parts[`foot_${side}`].translation();
        const hipPos = new THREE.Vector3(bp.x + xSign * 0.15, bp.y - 0.4, bp.z);
        const footPos = new THREE.Vector3(fp.x, fp.y, fp.z);
        const positions = meshes[`leg_${side}`].geometry.attributes.position;
        positions.setXYZ(0, hipPos.x, hipPos.y, hipPos.z);
        positions.setXYZ(1, footPos.x, footPos.y, footPos.z);
        positions.needsUpdate = true;
      }
    },
  };
}
