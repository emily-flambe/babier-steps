import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './scene.js';
import { createRagdoll } from './ragdoll.js';
import { InputManager } from './input.js';
import { syncPhysicsToMesh } from './sync.js';
import { Telemetry } from './telemetry.js';

async function init() {
  await RAPIER.init();

  const { scene, camera, renderer } = createScene();

  const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
  const world = new RAPIER.World(gravity);

  // Fixed timestep for deterministic physics
  const PHYSICS_DT = 1 / 60;
  let accumulator = 0;

  // Ground
  const groundGeo = new THREE.PlaneGeometry(100, 100);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x556b2f });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 0.1, 50),
    groundBody
  );

  const grid = new THREE.GridHelper(100, 100, 0x444444, 0x333333);
  grid.position.y = 0.01;
  scene.add(grid);

  const ragdoll = createRagdoll(world, scene, RAPIER);
  const input = new InputManager();
  const telemetry = new Telemetry(ragdoll);

  // Expose game state for Playwright
  if (typeof window !== 'undefined') {
    window.gameReady = false;
    window.gameInput = input;
  }

  // HUD
  const leftStatus = document.getElementById('left-status');
  const rightStatus = document.getElementById('right-status');
  const distanceEl = document.getElementById('distance');
  const startPos = new THREE.Vector3();

  // Camera
  const cameraOffset = new THREE.Vector3(0, 3, 6);

  // --- Foot control state ---
  const footTarget = {
    left: new THREE.Vector3(),
    right: new THREE.Vector3()
  };
  const wasLifted = { left: false, right: false };

  // Tuning constants
  const FOOT_SPEED = 2.5;
  const FOOT_MAX_REACH = 0.8;
  const FOOT_SPRING = 60.0;
  const FOOT_DAMPER = 12.0;

  const LEAN_FORCE = 12.0;
  const UPRIGHT_TORQUE = 40.0;
  const UPRIGHT_DAMPING = 12.0;
  const HEIGHT_SPRING = 30.0;
  const TARGET_HEIGHT = 1.6;

  const PLANTED_FRICTION = 5.0;
  const LIFTED_FRICTION = 0.1;

  let lastTime = performance.now();

  function physicsStep() {
    const bodyPos = ragdoll.body.translation();
    const bodyRot = ragdoll.body.rotation();

    // ── Upright stabilization ──
    const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
    const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQuat);
    const correctionAxis = new THREE.Vector3().crossVectors(currentUp, new THREE.Vector3(0, 1, 0));
    const tiltAmount = correctionAxis.length();

    if (tiltAmount > 0.001) {
      correctionAxis.normalize();
      ragdoll.body.addTorque(
        { x: correctionAxis.x * tiltAmount * UPRIGHT_TORQUE,
          y: 0,
          z: correctionAxis.z * tiltAmount * UPRIGHT_TORQUE },
        true
      );
    }

    const angvel = ragdoll.body.angvel();
    ragdoll.body.addTorque(
      { x: -angvel.x * UPRIGHT_DAMPING,
        y: -angvel.y * UPRIGHT_DAMPING,
        z: -angvel.z * UPRIGHT_DAMPING },
      true
    );

    // ── Height maintenance ──
    if (bodyPos.y < TARGET_HEIGHT) {
      ragdoll.body.addForce(
        { x: 0, y: (TARGET_HEIGHT - bodyPos.y) * HEIGHT_SPRING, z: 0 },
        true
      );
    }

    // ── Foot control ──
    const leftLifted = !!input.keys['KeyQ'];
    const rightLifted = !!input.keys['KeyE'];

    for (const side of ['left', 'right']) {
      const isLifted = side === 'left' ? leftLifted : rightLifted;
      const foot = ragdoll.feet[side];
      const footPos = foot.translation();
      const footVel = foot.linvel();
      const xOff = side === 'left' ? -0.15 : 0.15;

      if (isLifted) {
        const target = footTarget[side];

        if (!wasLifted[side]) {
          target.set(
            footPos.x - bodyPos.x - xOff,
            0.15,
            footPos.z - bodyPos.z
          );
        }

        if (input.keys['KeyW']) target.z -= FOOT_SPEED * PHYSICS_DT;
        if (input.keys['KeyS']) target.z += FOOT_SPEED * PHYSICS_DT;
        if (input.keys['KeyA']) target.x -= FOOT_SPEED * PHYSICS_DT;
        if (input.keys['KeyD']) target.x += FOOT_SPEED * PHYSICS_DT;
        if (input.keys['KeyR']) target.y += FOOT_SPEED * PHYSICS_DT;
        if (input.keys['KeyF']) target.y -= FOOT_SPEED * PHYSICS_DT;

        target.clampLength(0, FOOT_MAX_REACH);
        target.y = Math.max(0.05, Math.min(target.y, FOOT_MAX_REACH));

        const worldTarget = {
          x: bodyPos.x + xOff + target.x,
          y: target.y + 0.05,
          z: bodyPos.z + target.z
        };

        const dx = worldTarget.x - footPos.x;
        const dy = worldTarget.y - footPos.y;
        const dz = worldTarget.z - footPos.z;

        foot.addForce({
          x: dx * FOOT_SPRING - footVel.x * FOOT_DAMPER,
          y: dy * FOOT_SPRING - footVel.y * FOOT_DAMPER,
          z: dz * FOOT_SPRING - footVel.z * FOOT_DAMPER
        }, true);

        ragdoll.setFootFriction(side, LIFTED_FRICTION);
      } else {
        ragdoll.setFootFriction(side, PLANTED_FRICTION);

        if (wasLifted[side]) {
          footTarget[side].set(0, 0, 0);
        }
      }

      wasLifted[side] = isLifted;
    }

    // ── Lean ──
    if (input.keys['ArrowUp']) ragdoll.body.addForce({ x: 0, y: 0, z: -LEAN_FORCE }, true);
    if (input.keys['ArrowDown']) ragdoll.body.addForce({ x: 0, y: 0, z: LEAN_FORCE }, true);
    if (input.keys['ArrowLeft']) ragdoll.body.addForce({ x: -LEAN_FORCE, y: 0, z: 0 }, true);
    if (input.keys['ArrowRight']) ragdoll.body.addForce({ x: LEAN_FORCE, y: 0, z: 0 }, true);

    // Step physics
    world.step();

    // Update telemetry
    telemetry.update(leftLifted, rightLifted);
  }

  function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = performance.now();
    const frameDt = Math.min((now - lastTime) / 1000, 0.1); // cap to avoid spiral of death
    lastTime = now;

    // Fixed timestep accumulator
    accumulator += frameDt;
    while (accumulator >= PHYSICS_DT) {
      physicsStep();
      accumulator -= PHYSICS_DT;
    }

    // Sync visuals
    syncPhysicsToMesh(ragdoll);

    // HUD
    leftStatus.textContent = input.keys['KeyQ'] ? 'LIFTED' : 'planted';
    rightStatus.textContent = input.keys['KeyE'] ? 'LIFTED' : 'planted';

    const bp = ragdoll.body.translation();
    if (startPos.lengthSq() === 0) startPos.set(bp.x, bp.y, bp.z);
    const dist = Math.sqrt((bp.x - startPos.x) ** 2 + (bp.z - startPos.z) ** 2);
    distanceEl.textContent = dist.toFixed(1);

    // Camera follow
    camera.position.set(
      bp.x + cameraOffset.x,
      bp.y + cameraOffset.y,
      bp.z + cameraOffset.z
    );
    camera.lookAt(bp.x, bp.y, bp.z);

    renderer.render(scene, camera);
  }

  if (typeof window !== 'undefined') {
    window.gameReady = true;
  }

  gameLoop();
}

init();
