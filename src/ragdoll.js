import * as THREE from 'three';

/**
 * Creates a simplified ragdoll: torso + 2 upper legs + 2 lower legs + 2 feet.
 * All parts stay dynamic — no kinematic switching.
 */
export function createRagdoll(world, scene, RAPIER) {
  const parts = {};
  const meshes = {};
  const footColliders = {};

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcc8844 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x4466aa });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

  // --- Torso ---
  const torsoHalfW = 0.25;
  const torsoHalfH = 0.4;
  const torsoHalfD = 0.15;
  const torsoY = 1.6;

  const torsoDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, torsoY, 0)
    .setLinearDamping(2.0)
    .setAngularDamping(5.0);
  parts.body = world.createRigidBody(torsoDesc);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(torsoHalfW, torsoHalfH, torsoHalfD).setMass(20),
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

  // --- Legs ---
  const legHalfW = 0.08;
  const legHalfH = 0.25;
  const legHalfD = 0.08;

  for (const side of ['left', 'right']) {
    const xSign = side === 'left' ? -1 : 1;
    const hipX = xSign * 0.15;

    // Upper leg
    const upperY = torsoY - torsoHalfH - legHalfH;
    const upperDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(hipX, upperY, 0)
      .setLinearDamping(3.0)
      .setAngularDamping(5.0);
    parts[`upperLeg_${side}`] = world.createRigidBody(upperDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(legHalfW, legHalfH, legHalfD).setMass(1),
      parts[`upperLeg_${side}`]
    );

    const upperGeo = new THREE.BoxGeometry(legHalfW * 2, legHalfH * 2, legHalfD * 2);
    meshes[`upperLeg_${side}`] = new THREE.Mesh(upperGeo, legMat);
    meshes[`upperLeg_${side}`].castShadow = true;
    scene.add(meshes[`upperLeg_${side}`]);

    // Hip joint
    const hipJoint = RAPIER.JointData.spherical(
      { x: hipX, y: -torsoHalfH, z: 0 },
      { x: 0, y: legHalfH, z: 0 }
    );
    world.createImpulseJoint(hipJoint, parts.body, parts[`upperLeg_${side}`], true);

    // Lower leg
    const lowerY = upperY - legHalfH * 2;
    const lowerDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(hipX, lowerY, 0)
      .setLinearDamping(3.0)
      .setAngularDamping(5.0);
    parts[`lowerLeg_${side}`] = world.createRigidBody(lowerDesc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(legHalfW, legHalfH, legHalfD).setMass(0.8),
      parts[`lowerLeg_${side}`]
    );

    const lowerGeo = new THREE.BoxGeometry(legHalfW * 2, legHalfH * 2, legHalfD * 2);
    meshes[`lowerLeg_${side}`] = new THREE.Mesh(lowerGeo, legMat);
    meshes[`lowerLeg_${side}`].castShadow = true;
    scene.add(meshes[`lowerLeg_${side}`]);

    // Knee joint
    const kneeJoint = RAPIER.JointData.spherical(
      { x: 0, y: -legHalfH, z: 0 },
      { x: 0, y: legHalfH, z: 0 }
    );
    world.createImpulseJoint(kneeJoint, parts[`upperLeg_${side}`], parts[`lowerLeg_${side}`], true);

    // Foot
    const footHalfW = 0.1;
    const footHalfH = 0.05;
    const footHalfD = 0.15;
    const footY = lowerY - legHalfH - footHalfH;
    const footDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(hipX, footY, 0.05)
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

    // Ankle joint
    const ankleJoint = RAPIER.JointData.spherical(
      { x: 0, y: -legHalfH, z: 0 },
      { x: 0, y: footHalfH, z: -0.05 }
    );
    world.createImpulseJoint(ankleJoint, parts[`lowerLeg_${side}`], parts[`foot_${side}`], true);
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
  };
}
