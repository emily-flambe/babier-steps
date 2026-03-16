import * as THREE from 'three';

/**
 * Collects per-frame physics metrics and exposes them on window
 * for automated testing via Playwright.
 */
export class Telemetry {
  constructor(ragdoll) {
    this.ragdoll = ragdoll;
    this.frameCount = 0;
    this.history = []; // ring buffer of last N frames
    this.maxHistory = 300; // ~5 seconds at 60fps

    // Accumulated stats for assertions
    this.stats = {
      minHipHeight: Infinity,
      maxHipHeight: -Infinity,
      maxTorsoAngVel: 0,
      maxBodyVelocity: 0,
      maxFootHipDistance: 0,
      totalDistance: 0,
      stepCycles: 0,
      explosionDetected: false,
      fellOver: false,
    };

    this._lastBodyPos = null;
    this._prevLeftPlanted = true;
    this._prevRightPlanted = true;

    // Temp vectors
    this._v1 = new THREE.Vector3();

    // Expose on window for Playwright
    if (typeof window !== 'undefined') {
      window.gametelemetry = this;
    }
  }

  /** Call once per physics step. */
  update(leftLifted, rightLifted) {
    const r = this.ragdoll;
    const body = r.body;
    const bodyPos = body.translation();
    const bodyRot = body.rotation();
    const bodyVel = body.linvel();
    const bodyAngVel = body.angvel();

    // Hip height
    const hipHeight = bodyPos.y;
    this.stats.minHipHeight = Math.min(this.stats.minHipHeight, hipHeight);
    this.stats.maxHipHeight = Math.max(this.stats.maxHipHeight, hipHeight);

    // Torso angular velocity magnitude
    const torsoAngVel = Math.sqrt(
      bodyAngVel.x ** 2 + bodyAngVel.y ** 2 + bodyAngVel.z ** 2
    );
    this.stats.maxTorsoAngVel = Math.max(this.stats.maxTorsoAngVel, torsoAngVel);

    // Body velocity magnitude
    const bodySpeed = Math.sqrt(
      bodyVel.x ** 2 + bodyVel.y ** 2 + bodyVel.z ** 2
    );
    this.stats.maxBodyVelocity = Math.max(this.stats.maxBodyVelocity, bodySpeed);

    // Explosion detection
    if (bodySpeed > 20) {
      this.stats.explosionDetected = true;
    }

    // Fall detection (hip below 0.8m or torso nearly horizontal)
    const bodyQuat = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
    const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQuat);
    const uprightDot = currentUp.dot(new THREE.Vector3(0, 1, 0)); // 1 = upright, 0 = horizontal
    if (hipHeight < 0.8 || uprightDot < 0.3) {
      this.stats.fellOver = true;
    }

    // Foot-to-hip distances
    for (const side of ['left', 'right']) {
      const footPos = r.feet[side].translation();
      const dist = Math.sqrt(
        (footPos.x - bodyPos.x) ** 2 +
        (footPos.y - bodyPos.y) ** 2 +
        (footPos.z - bodyPos.z) ** 2
      );
      this.stats.maxFootHipDistance = Math.max(this.stats.maxFootHipDistance, dist);
    }

    // All parts velocity check
    for (const [key, part] of Object.entries(r.parts)) {
      const vel = part.linvel();
      const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
      this.stats.maxBodyVelocity = Math.max(this.stats.maxBodyVelocity, speed);
      if (speed > 50) {
        this.stats.explosionDetected = true;
      }
    }

    // Distance tracking
    if (this._lastBodyPos) {
      const dx = bodyPos.x - this._lastBodyPos.x;
      const dz = bodyPos.z - this._lastBodyPos.z;
      this.stats.totalDistance += Math.sqrt(dx * dx + dz * dz);
    }
    this._lastBodyPos = { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z };

    // Step cycle counting (a cycle = one foot goes lifted->planted)
    const leftPlanted = !leftLifted;
    const rightPlanted = !rightLifted;
    if (!this._prevLeftPlanted && leftPlanted) this.stats.stepCycles++;
    if (!this._prevRightPlanted && rightPlanted) this.stats.stepCycles++;
    this._prevLeftPlanted = leftPlanted;
    this._prevRightPlanted = rightPlanted;

    // Frame snapshot
    const snapshot = {
      frame: this.frameCount,
      hipHeight,
      torsoAngVel,
      bodySpeed,
      uprightDot,
      leftLifted,
      rightLifted,
      bodyPos: { x: bodyPos.x, y: bodyPos.y, z: bodyPos.z },
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this.frameCount++;
  }

  /** Get current stats for assertions. */
  getStats() {
    return { ...this.stats, frameCount: this.frameCount };
  }

  /** Get the last N frame snapshots. */
  getHistory(n) {
    return this.history.slice(-(n || this.history.length));
  }

  /** Reset all stats (useful between test phases). */
  reset() {
    this.stats = {
      minHipHeight: Infinity,
      maxHipHeight: -Infinity,
      maxTorsoAngVel: 0,
      maxBodyVelocity: 0,
      maxFootHipDistance: 0,
      totalDistance: 0,
      stepCycles: 0,
      explosionDetected: false,
      fellOver: false,
    };
    this.history = [];
    this.frameCount = 0;
    this._lastBodyPos = null;
  }
}
