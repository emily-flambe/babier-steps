import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createScene } from './scene.js';
import { createRagdoll } from './ragdoll.js';
import { InputManager } from './input.js';
import { syncPhysicsToMesh } from './sync.js';
import { Telemetry } from './telemetry.js';
import { createObstacleCourse } from './obstacles.js';

async function init() {
  await RAPIER.init();

  const { scene, camera, renderer } = createScene();

  const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
  const world = new RAPIER.World(gravity);

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
  const course = createObstacleCourse(world, scene, RAPIER);

  if (typeof window !== 'undefined') {
    window.gameReady = false;
    window.gameInput = input;
  }

  // HUD
  const leftStatus = document.getElementById('left-status');
  const rightStatus = document.getElementById('right-status');
  const distanceEl = document.getElementById('distance');
  const progressEl = document.getElementById('progress');
  const startPos = new THREE.Vector3();

  // Camera
  const cameraOffset = new THREE.Vector3(0, 3, 6);

  // Foot control
  const footTarget = { left: new THREE.Vector3(), right: new THREE.Vector3() };
  const wasLifted = { left: false, right: false };

  const FOOT_SPEED = 3.0;
  const FOOT_MAX_REACH = 1.0;
  const FOOT_SPRING = 80.0;
  const FOOT_DAMPER = 15.0;

  const LEAN_FORCE = 15.0;
  const UPRIGHT_TORQUE = 50.0;
  const UPRIGHT_DAMPING = 15.0;
  const TARGET_HEIGHT = 1.4;

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
      ragdoll.body.addTorque({
        x: correctionAxis.x * tiltAmount * UPRIGHT_TORQUE,
        y: 0,
        z: correctionAxis.z * tiltAmount * UPRIGHT_TORQUE
      }, true);
    }

    const angvel = ragdoll.body.angvel();
    ragdoll.body.addTorque({
      x: -angvel.x * UPRIGHT_DAMPING,
      y: -angvel.y * UPRIGHT_DAMPING,
      z: -angvel.z * UPRIGHT_DAMPING
    }, true);

    // Read foot positions (used by height spring and follow force)
    const leftFP = ragdoll.feet.left.translation();
    const rightFP = ragdoll.feet.right.translation();

    // ── Height spring — relative to feet, not absolute ──
    const avgFootY = (leftFP.y + rightFP.y) / 2;
    const desiredHeight = avgFootY + 1.0; // body ~1m above feet
    const heightError = desiredHeight - bodyPos.y;
    const bodyVelY = ragdoll.body.linvel().y;
    // Critically-damped spring: k=60, c=2*sqrt(k*m)=60 for m=15
    ragdoll.body.addForce({
      x: 0,
      y: heightError * 60.0 - bodyVelY * 60.0,
      z: 0
    }, true);

    // ── Body follows feet midpoint ──
    const midX = (leftFP.x + rightFP.x) / 2;
    const midZ = (leftFP.z + rightFP.z) / 2;
    const bodyVel = ragdoll.body.linvel();

    // Critically-damped follow: k=15, c=2*sqrt(k*m)=30 for m=15
    ragdoll.body.addForce({
      x: (midX - bodyPos.x) * 15.0 - bodyVel.x * 30.0,
      y: 0,
      z: (midZ - bodyPos.z) * 15.0 - bodyVel.z * 30.0
    }, true);

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
        // Switch to dynamic if it was kinematic
        if (foot.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
          foot.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        }

        const target = footTarget[side];

        if (!wasLifted[side]) {
          target.set(
            footPos.x - bodyPos.x - xOff,
            0.2,
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

        foot.addForce({
          x: (worldTarget.x - footPos.x) * FOOT_SPRING - footVel.x * FOOT_DAMPER,
          y: (worldTarget.y - footPos.y) * FOOT_SPRING - footVel.y * FOOT_DAMPER,
          z: (worldTarget.z - footPos.z) * FOOT_SPRING - footVel.z * FOOT_DAMPER
        }, true);

        ragdoll.setFootFriction(side, 0.1);
      } else {
        // Planted: make foot kinematic so it stays put
        if (foot.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
          // Freeze foot where it landed
          const pos = foot.translation();
          foot.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          foot.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        }

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

    world.step();

    telemetry.update(leftLifted, rightLifted);
  }

  function gameLoop() {
    requestAnimationFrame(gameLoop);

    const now = performance.now();
    const frameDt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    accumulator += frameDt;
    while (accumulator >= PHYSICS_DT) {
      physicsStep();
      accumulator -= PHYSICS_DT;
    }

    syncPhysicsToMesh(ragdoll);
    ragdoll.updateLegs();

    leftStatus.textContent = input.keys['KeyQ'] ? 'LIFTED' : 'planted';
    rightStatus.textContent = input.keys['KeyE'] ? 'LIFTED' : 'planted';

    const bp = ragdoll.body.translation();
    if (startPos.lengthSq() === 0) startPos.set(bp.x, bp.y, bp.z);
    const dist = Math.sqrt((bp.x - startPos.x) ** 2 + (bp.z - startPos.z) ** 2);
    distanceEl.textContent = dist.toFixed(1);
    const progress = Math.min(100, Math.max(0, (-bp.z / -course.finishZ) * 100));
    progressEl.textContent = Math.floor(progress);

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
