import * as THREE from 'three';

/**
 * Creates an obstacle course laid out along the -Z axis.
 * Each obstacle is a static Rapier body + Three.js mesh.
 */
export function createObstacleCourse(world, scene, RAPIER) {
  const obstacles = [];

  function addBox(x, y, z, hw, hh, hd, color, { friction = 0.5, receiveShadow = true } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color });
    const geo = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hw, hh, hd).setFriction(friction),
      body
    );

    obstacles.push({ mesh, body });
    return { mesh, body };
  }

  function addCylinder(x, y, z, radius, halfHeight, color) {
    const mat = new THREE.MeshStandardMaterial({ color });
    const geo = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 16);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(halfHeight, radius).setFriction(0.5),
      body
    );

    obstacles.push({ mesh, body });
    return { mesh, body };
  }

  function addMarker(x, z, label, color = 0xffffff) {
    // Tall thin pole as a waypoint marker
    addCylinder(x, 1.0, z, 0.05, 1.0, color);

    // Sign at top
    const signMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const signGeo = new THREE.BoxGeometry(0.8, 0.3, 0.05);
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.position.set(x, 2.1, z);
    signMesh.castShadow = true;
    scene.add(signMesh);
  }

  // ═══════════════════════════════════════════════
  // SECTION 1: LOW HURDLES (z = -3 to -7)
  // Step over small barriers
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -2, 0x44ff44);

  // Three low hurdles across the path
  addBox(0, 0.1, -3.5, 1.0, 0.1, 0.05, 0xaa4422, { friction: 0.8 });
  addBox(0, 0.15, -5.0, 1.0, 0.15, 0.05, 0xaa4422, { friction: 0.8 });
  addBox(0, 0.2, -6.5, 1.0, 0.2, 0.05, 0xaa4422, { friction: 0.8 });

  // Side walls to keep player on course
  addBox(-1.3, 0.3, -5.0, 0.1, 0.3, 2.5, 0x666666);
  addBox(1.3, 0.3, -5.0, 0.1, 0.3, 2.5, 0x666666);

  // ═══════════════════════════════════════════════
  // SECTION 2: STEPPING STONES (z = -9 to -15)
  // Raised platforms with gaps between them
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -8, 0x44ff44);

  // Remove ground in this section by placing "pit" walls on the sides
  addBox(-1.5, -0.3, -12, 0.1, 0.5, 3.5, 0x333333);
  addBox(1.5, -0.3, -12, 0.1, 0.5, 3.5, 0x333333);

  // Stepping stones — alternating left and right to force actual stepping
  const stones = [
    { x: -0.3, z: -9.0 },
    { x: 0.3, z: -10.2 },
    { x: -0.2, z: -11.4 },
    { x: 0.4, z: -12.6 },
    { x: -0.1, z: -13.8 },
    { x: 0.2, z: -15.0 },
  ];

  for (const s of stones) {
    addBox(s.x, 0.15, s.z, 0.3, 0.15, 0.3, 0xddaa44, { friction: 1.0 });
  }

  // ═══════════════════════════════════════════════
  // SECTION 3: NARROW BEAM (z = -17 to -23)
  // Balance across a thin bridge
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -16, 0x44ff44);

  // The beam itself — narrow!
  addBox(0, 0.2, -20, 0.15, 0.2, 3.0, 0x8888cc, { friction: 1.0 });

  // Entry and exit platforms
  addBox(0, 0.1, -16.5, 0.6, 0.1, 0.5, 0x8888cc, { friction: 0.8 });
  addBox(0, 0.1, -23.5, 0.6, 0.1, 0.5, 0x8888cc, { friction: 0.8 });

  // ═══════════════════════════════════════════════
  // SECTION 4: RAMP + PLATFORM (z = -25 to -31)
  // Walk up an incline onto a raised platform
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -24, 0x44ff44);

  // Ramp — angled box
  const rampHW = 0.8, rampHH = 0.1, rampHD = 1.5;
  const rampAngle = Math.atan2(0.5, 3.0); // ~9.5 degrees
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x66aa66 });
  const rampGeo = new THREE.BoxGeometry(rampHW * 2, rampHH * 2, rampHD * 2);
  const rampMesh = new THREE.Mesh(rampGeo, rampMat);
  rampMesh.position.set(0, 0.25, -26.5);
  rampMesh.rotation.x = rampAngle;
  rampMesh.castShadow = true;
  rampMesh.receiveShadow = true;
  scene.add(rampMesh);

  const rampBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, 0.25, -26.5)
      .setRotation({ x: Math.sin(rampAngle / 2), y: 0, z: 0, w: Math.cos(rampAngle / 2) })
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(rampHW, rampHH, rampHD).setFriction(1.0),
    rampBody
  );
  obstacles.push({ mesh: rampMesh, body: rampBody });

  // Raised platform at top of ramp
  addBox(0, 0.45, -29.5, 1.0, 0.05, 1.5, 0x66aa66, { friction: 0.8 });

  // ═══════════════════════════════════════════════
  // SECTION 5: ZIGZAG CORRIDOR (z = -32 to -42)
  // Navigate around walls in a tight corridor
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -31, 0x44ff44);

  // Alternating wall segments
  addBox(-0.6, 0.4, -33, 0.6, 0.4, 0.1, 0x885544);
  addBox(0.6, 0.4, -35, 0.6, 0.4, 0.1, 0x885544);
  addBox(-0.6, 0.4, -37, 0.6, 0.4, 0.1, 0x885544);
  addBox(0.6, 0.4, -39, 0.6, 0.4, 0.1, 0x885544);
  addBox(-0.6, 0.4, -41, 0.6, 0.4, 0.1, 0x885544);

  // Outer corridor walls
  addBox(-1.5, 0.4, -37, 0.1, 0.4, 5.5, 0x666666);
  addBox(1.5, 0.4, -37, 0.1, 0.4, 5.5, 0x666666);

  // ═══════════════════════════════════════════════
  // SECTION 6: STAIRCASE (z = -44 to -50)
  // Climb steps
  // ═══════════════════════════════════════════════

  addMarker(-1.5, -43, 0x44ff44);

  for (let i = 0; i < 6; i++) {
    const stepY = 0.1 + i * 0.12;
    const stepZ = -44.5 - i * 1.0;
    addBox(0, stepY, stepZ, 0.8, 0.06, 0.5, 0xaa8866, { friction: 1.0 });
  }

  // Landing platform at the top
  addBox(0, 0.7, -51.5, 1.0, 0.05, 1.0, 0xaa8866, { friction: 0.8 });

  // ═══════════════════════════════════════════════
  // SECTION 7: FINISH LINE (z = -53)
  // ═══════════════════════════════════════════════

  // Finish posts
  addCylinder(-1.0, 1.0, -53, 0.08, 1.0, 0xff4444);
  addCylinder(1.0, 1.0, -53, 0.08, 1.0, 0xff4444);

  // Finish banner (visual only, no collider)
  const bannerMat = new THREE.MeshStandardMaterial({
    color: 0xff4444,
    emissive: 0xff2222,
    emissiveIntensity: 0.4,
  });
  const bannerGeo = new THREE.BoxGeometry(2.0, 0.3, 0.05);
  const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
  bannerMesh.position.set(0, 2.1, -53);
  scene.add(bannerMesh);

  // Checkered finish line on the ground
  const checkerSize = 0.25;
  const checkerMat1 = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const checkerMat2 = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const checkerGeo = new THREE.PlaneGeometry(checkerSize, checkerSize);

  for (let xi = -3; xi <= 3; xi++) {
    for (let zi = 0; zi < 2; zi++) {
      const mat = (xi + zi) % 2 === 0 ? checkerMat1 : checkerMat2;
      const tile = new THREE.Mesh(checkerGeo, mat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(xi * checkerSize, 0.011, -53 + zi * checkerSize);
      scene.add(tile);
    }
  }

  return {
    obstacles,
    finishZ: -53,
  };
}
