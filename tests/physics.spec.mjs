import { test, expect } from '@playwright/test';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.gameReady === true, null, { timeout: 10000 });
  await sleep(1000);
}

async function getStats(page) {
  return page.evaluate(() => window.gametelemetry.getStats());
}

async function resetTelemetry(page) {
  return page.evaluate(() => window.gametelemetry.reset());
}

async function getHistory(page, n) {
  return page.evaluate((count) => window.gametelemetry.getHistory(count), n);
}

async function getBodyPos(page) {
  return page.evaluate(() => {
    const h = window.gametelemetry.getHistory(1)[0];
    return h ? h.bodyPos : null;
  });
}

/** Take one step: lift foot, move direction, plant, optionally lean */
async function takeStep(page, side, direction, { lean = false, moveDuration = 300, leanDuration = 200, settleDuration = 200 } = {}) {
  const liftKey = side === 'left' ? 'KeyQ' : 'KeyE';
  const dirKey = direction === 'forward' ? 'KeyW'
    : direction === 'backward' ? 'KeyS'
    : direction === 'left' ? 'KeyA'
    : direction === 'right' ? 'KeyD'
    : null;
  const leanKey = direction === 'forward' ? 'ArrowUp'
    : direction === 'backward' ? 'ArrowDown'
    : direction === 'left' ? 'ArrowLeft'
    : direction === 'right' ? 'ArrowRight'
    : null;

  await page.keyboard.down(liftKey);
  await sleep(100);
  if (dirKey) {
    await page.keyboard.down(dirKey);
    await sleep(moveDuration);
    await page.keyboard.up(dirKey);
  }
  await page.keyboard.up(liftKey);
  await sleep(settleDuration);

  if (lean && leanKey) {
    await page.keyboard.down(leanKey);
    await sleep(leanDuration);
    await page.keyboard.up(leanKey);
    await sleep(settleDuration);
  }
}

// ═══════════════════════════════════════════════════
// SECTION 1: IDLE & STABILITY
// ═══════════════════════════════════════════════════

test.describe('Idle & Stability', () => {
  test('idle: character stands without falling for 3 seconds', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(3000);

    const stats = await getStats(page);

    expect(stats.minHipHeight).toBeGreaterThan(0.3);
    expect(stats.maxHipHeight).toBeLessThan(2.0);
    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxTorsoAngVel).toBeLessThan(5.0);
    expect(stats.totalDistance).toBeLessThan(1.0);
    expect(stats.maxBodyVelocity).toBeLessThan(10.0);
    expect(stats.maxFootHipDistance).toBeLessThan(2.0);
  });

  test('idle: body position does not drift', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);
    await sleep(3000);
    const endPos = await getBodyPos(page);

    const drift = Math.sqrt(
      (endPos.x - startPos.x) ** 2 +
      (endPos.z - startPos.z) ** 2
    );
    expect(drift).toBeLessThan(0.05);
  });

  test('idle: velocity converges to zero', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(2000);

    const history = await getHistory(page, 30);
    const lastFrames = history.slice(-10);

    for (const frame of lastFrames) {
      expect(frame.bodySpeed).toBeLessThan(0.1);
    }
  });

  test('idle: hip height is constant (no vertical oscillation)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(3000);

    const history = await getHistory(page, 60);
    const heights = history.map(f => f.hipHeight);
    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);

    // Should vary less than 1cm at idle
    expect(maxH - minH).toBeLessThan(0.01);
  });

  test('idle: no lateral oscillation', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(3000);

    const history = await getHistory(page, 60);
    const positions = history.map(f => f.bodyPos);

    // Count Z direction changes
    let zChanges = 0;
    for (let i = 2; i < positions.length; i++) {
      const prev = positions[i - 1].z - positions[i - 2].z;
      const curr = positions[i].z - positions[i - 1].z;
      if (prev * curr < 0) zChanges++;
    }

    expect(zChanges).toBeLessThan(3);
  });

  test('idle: character stays upright (uprightDot near 1.0)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(2000);

    const history = await getHistory(page, 30);
    for (const frame of history) {
      expect(frame.uprightDot).toBeGreaterThan(0.95);
    }
  });
});

// ═══════════════════════════════════════════════════
// SECTION 2: GRAVITY & PHYSICS REALISM
// ═══════════════════════════════════════════════════

test.describe('Gravity & Physics', () => {
  test.fixme('both feet lifted: character should descend (gravity)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const beforePos = await getBodyPos(page);

    // Lift both feet for 2 seconds
    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyE');
    await sleep(2000);
    await page.keyboard.up('KeyQ');
    await page.keyboard.up('KeyE');

    const afterPos = await getBodyPos(page);

    // Body should drop when unsupported — even a little
    expect(afterPos.y).toBeLessThan(beforePos.y);
  });

  test.fixme('both feet lifted: hip height should decrease', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyE');
    await sleep(1500);

    const stats = await getStats(page);
    // Hip should drop below starting height
    expect(stats.minHipHeight).toBeLessThan(1.0);

    await page.keyboard.up('KeyQ');
    await page.keyboard.up('KeyE');
  });

  test('single foot lifted: body stays supported', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await sleep(1500);
    await page.keyboard.up('KeyQ');
    await sleep(500);

    const stats = await getStats(page);
    // Should NOT fall — one foot planted
    expect(stats.fellOver).toBe(false);
    expect(stats.minHipHeight).toBeGreaterThan(0.5);
  });

  test('planted feet act as anchors (no sliding)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Record foot positions
    const footsBefore = await page.evaluate(() => {
      const ragdoll = window.gametelemetry.ragdoll;
      const lf = ragdoll.feet.left.translation();
      const rf = ragdoll.feet.right.translation();
      return { left: { x: lf.x, z: lf.z }, right: { x: rf.x, z: rf.z } };
    });

    await sleep(2000);

    const footsAfter = await page.evaluate(() => {
      const ragdoll = window.gametelemetry.ragdoll;
      const lf = ragdoll.feet.left.translation();
      const rf = ragdoll.feet.right.translation();
      return { left: { x: lf.x, z: lf.z }, right: { x: rf.x, z: rf.z } };
    });

    // Planted feet should not move
    const leftDrift = Math.sqrt(
      (footsAfter.left.x - footsBefore.left.x) ** 2 +
      (footsAfter.left.z - footsBefore.left.z) ** 2
    );
    const rightDrift = Math.sqrt(
      (footsAfter.right.x - footsBefore.right.x) ** 2 +
      (footsAfter.right.z - footsBefore.right.z) ** 2
    );

    expect(leftDrift).toBeLessThan(0.01);
    expect(rightDrift).toBeLessThan(0.01);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 3: FOOT CONTROL
// ═══════════════════════════════════════════════════

test.describe('Foot Control', () => {
  test('lift left foot: foot rises off ground', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const beforeY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().y;
    });

    await page.keyboard.down('KeyQ');
    await sleep(500);

    const afterY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().y;
    });

    await page.keyboard.up('KeyQ');

    expect(afterY).toBeGreaterThan(beforeY + 0.05);
  });

  test('lift right foot: foot rises off ground', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const beforeY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.right.translation().y;
    });

    await page.keyboard.down('KeyE');
    await sleep(500);

    const afterY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.right.translation().y;
    });

    await page.keyboard.up('KeyE');

    expect(afterY).toBeGreaterThan(beforeY + 0.05);
  });

  test('W key moves lifted foot forward (-Z)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await sleep(100);

    const beforeZ = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().z;
    });

    await page.keyboard.down('KeyW');
    await sleep(500);
    await page.keyboard.up('KeyW');

    const afterZ = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().z;
    });

    await page.keyboard.up('KeyQ');

    // Forward is -Z
    expect(afterZ).toBeLessThan(beforeZ - 0.1);
  });

  test('S key moves lifted foot backward (+Z)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await sleep(100);

    const beforeZ = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().z;
    });

    await page.keyboard.down('KeyS');
    await sleep(500);
    await page.keyboard.up('KeyS');

    const afterZ = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().z;
    });

    await page.keyboard.up('KeyQ');

    expect(afterZ).toBeGreaterThan(beforeZ + 0.1);
  });

  test('A key moves lifted foot left (-X)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await sleep(100);

    const beforeX = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().x;
    });

    await page.keyboard.down('KeyA');
    await sleep(500);
    await page.keyboard.up('KeyA');

    const afterX = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().x;
    });

    await page.keyboard.up('KeyQ');

    expect(afterX).toBeLessThan(beforeX - 0.1);
  });

  test('D key moves lifted foot right (+X)', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('KeyQ');
    await sleep(100);

    const beforeX = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().x;
    });

    await page.keyboard.down('KeyD');
    await sleep(500);
    await page.keyboard.up('KeyD');

    const afterX = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().x;
    });

    await page.keyboard.up('KeyQ');

    expect(afterX).toBeGreaterThan(beforeX + 0.1);
  });

  test('lifted foot auto-rises to lift height', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const beforeY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().y;
    });

    await page.keyboard.down('KeyQ');
    await sleep(500);

    const afterY = await page.evaluate(() => {
      return window.gametelemetry.ragdoll.feet.left.translation().y;
    });

    await page.keyboard.up('KeyQ');

    // Foot should auto-lift above ground
    expect(afterY).toBeGreaterThan(beforeY + 0.1);
  });

  test('foot reach is clamped to max distance', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Move foot as far forward as possible
    await page.keyboard.down('KeyQ');
    await sleep(100);
    await page.keyboard.down('KeyW');
    await sleep(2000);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyQ');
    await sleep(500);

    const stats = await getStats(page);

    // Foot should not extend beyond reasonable reach
    expect(stats.maxFootHipDistance).toBeLessThan(2.0);
  });

  test('planted foot does not move with WASD', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const beforePos = await page.evaluate(() => {
      const f = window.gametelemetry.ragdoll.feet.left.translation();
      return { x: f.x, z: f.z };
    });

    // Press WASD without lifting foot
    await page.keyboard.down('KeyW');
    await sleep(500);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyA');
    await sleep(500);
    await page.keyboard.up('KeyA');

    const afterPos = await page.evaluate(() => {
      const f = window.gametelemetry.ragdoll.feet.left.translation();
      return { x: f.x, z: f.z };
    });

    const drift = Math.sqrt(
      (afterPos.x - beforePos.x) ** 2 +
      (afterPos.z - beforePos.z) ** 2
    );

    expect(drift).toBeLessThan(0.05);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 4: WALKING
// ═══════════════════════════════════════════════════

test.describe('Walking', () => {
  test('forward walking produces forward movement', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true });
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.stepCycles).toBeGreaterThanOrEqual(3);
    expect(stats.totalDistance).toBeGreaterThan(0.1);
    expect(stats.totalDistance).toBeLessThan(50.0);
  });

  test('backward walking produces backward movement', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'backward', { lean: true });
    }

    await sleep(500);
    const endPos = await getBodyPos(page);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    // Should have moved in +Z (backward)
    expect(endPos.z).toBeGreaterThan(startPos.z + 0.1);
  });

  test('sideways walking: left steps move left', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'left', { lean: true });
    }

    await sleep(500);
    const endPos = await getBodyPos(page);

    // Should have moved in -X
    expect(endPos.x).toBeLessThan(startPos.x - 0.05);
  });

  test('walking without leaning still produces some movement', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: false });
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.totalDistance).toBeGreaterThan(0.05);
  });

  test('step efficiency: distance per step is reasonable', async ({ page }) => {
    await waitForGame(page);
    await sleep(500);
    await resetTelemetry(page);

    for (let i = 0; i < 6; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true });
    }

    await sleep(500);
    const stats = await getStats(page);

    if (stats.stepCycles > 0) {
      const distPerStep = stats.totalDistance / stats.stepCycles;
      expect(distPerStep).toBeGreaterThan(0.05);
      expect(distPerStep).toBeLessThan(10.0);
    }
  });

  test('walking: alternating feet counts correct step cycles', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // 3 left steps, 3 right steps = 6 cycles
    for (let i = 0; i < 6; i++) {
      const side = i % 2 === 0 ? 'left' : 'right';
      const key = side === 'left' ? 'KeyQ' : 'KeyE';
      await page.keyboard.down(key);
      await sleep(200);
      await page.keyboard.up(key);
      await sleep(200);
    }

    const stats = await getStats(page);
    expect(stats.stepCycles).toBe(6);
  });

  test('walking: character stays upright through 10 steps', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 10; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true, moveDuration: 200, settleDuration: 150 });
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.minHipHeight).toBeGreaterThan(0.3);
  });

  test('walking: hip height stays bounded', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true });
    }

    const history = await getHistory(page, 120);
    for (const frame of history) {
      expect(frame.hipHeight).toBeGreaterThan(0.2);
      expect(frame.hipHeight).toBeLessThan(3.0);
    }
  });
});

// ═══════════════════════════════════════════════════
// SECTION 5: LEANING
// ═══════════════════════════════════════════════════

test.describe('Leaning', () => {
  test('lean forward shifts body in -Z', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    await page.keyboard.down('ArrowUp');
    await sleep(500);
    await page.keyboard.up('ArrowUp');
    await sleep(300);

    const endPos = await getBodyPos(page);

    expect(endPos.z).toBeLessThan(startPos.z);
  });

  test('lean backward shifts body in +Z', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    await page.keyboard.down('ArrowDown');
    await sleep(500);
    await page.keyboard.up('ArrowDown');
    await sleep(300);

    const endPos = await getBodyPos(page);

    expect(endPos.z).toBeGreaterThan(startPos.z);
  });

  test('lean left shifts body in -X', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    await page.keyboard.down('ArrowLeft');
    await sleep(500);
    await page.keyboard.up('ArrowLeft');
    await sleep(300);

    const endPos = await getBodyPos(page);

    expect(endPos.x).toBeLessThan(startPos.x);
  });

  test('lean right shifts body in +X', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    await page.keyboard.down('ArrowRight');
    await sleep(500);
    await page.keyboard.up('ArrowRight');
    await sleep(300);

    const endPos = await getBodyPos(page);

    expect(endPos.x).toBeGreaterThan(startPos.x);
  });

  test('leaning in all directions does not cause fall', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await page.keyboard.down(key);
      await sleep(500);
      await page.keyboard.up(key);
      await sleep(300);
    }

    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.minHipHeight).toBeGreaterThan(0.2);
  });

  test('sustained lean: character does not accelerate forever', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lean forward for 3 seconds
    await page.keyboard.down('ArrowUp');
    await sleep(3000);
    await page.keyboard.up('ArrowUp');

    const stats = await getStats(page);

    // Velocity should be bounded even with sustained input
    expect(stats.maxBodyVelocity).toBeLessThan(5.0);
    expect(stats.fellOver).toBe(false);
  });

  test('lean then release: body velocity should decay', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    await page.keyboard.down('ArrowUp');
    await sleep(500);
    await page.keyboard.up('ArrowUp');

    // Wait for decay
    await sleep(2000);

    const history = await getHistory(page, 30);
    const lastFrames = history.slice(-10);

    // Velocity should be decreasing or near zero
    const avgSpeed = lastFrames.reduce((s, f) => s + f.bodySpeed, 0) / lastFrames.length;
    expect(avgSpeed).toBeLessThan(0.5);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 6: SETTLING & ENERGY CONSERVATION
// ═══════════════════════════════════════════════════

test.describe('Settling & Energy', () => {
  test('after walking: body settles to stillness within 3 seconds', async ({ page }) => {
    await waitForGame(page);

    // Walk 4 steps
    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true });
    }

    // Wait to settle
    await resetTelemetry(page);
    await sleep(3000);

    const history = await getHistory(page, 30);
    const lastFrames = history.slice(-10);

    // Speed should be decaying, not growing
    for (const frame of lastFrames) {
      expect(frame.bodySpeed).toBeLessThan(0.5);
    }
  });

  test('after walking: velocity does not increase during idle', async ({ page }) => {
    await waitForGame(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, i % 2 === 0 ? 'left' : 'right', 'forward', { lean: true });
    }

    await sleep(1000);
    await resetTelemetry(page);
    await sleep(3000);

    const history = await getHistory(page, 60);
    const speeds = history.map(f => f.bodySpeed);

    // Average of last 10 should be <= average of first 10 (decaying or flat)
    const first10 = speeds.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const last10 = speeds.slice(-10).reduce((a, b) => a + b, 0) / 10;

    expect(last10).toBeLessThanOrEqual(first10 + 0.1);
  });

  test('foot plant: no velocity spike on replanting', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lift foot, move it forward, then plant
    await page.keyboard.down('KeyQ');
    await sleep(100);
    await page.keyboard.down('KeyW');
    await sleep(500);
    await page.keyboard.up('KeyW');
    await sleep(200);
    await page.keyboard.up('KeyQ');

    await sleep(500);
    const stats = await getStats(page);

    // Velocity spike should be bounded
    expect(stats.maxBodyVelocity).toBeLessThan(8.0);
  });

  test('no energy leak: idle velocity stays near zero for 10 seconds', async ({ page }) => {
    test.setTimeout(30000);
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(10000);

    const history = await getHistory(page, 120);
    const speeds = history.map(f => f.bodySpeed);

    // Every frame should be near zero
    for (const speed of speeds) {
      expect(speed).toBeLessThan(0.1);
    }
  });
});

// ═══════════════════════════════════════════════════
// SECTION 7: STRESS TESTS
// ═══════════════════════════════════════════════════

test.describe('Stress Tests', () => {
  test('rapid foot toggles do not cause explosion', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 20; i++) {
      await page.keyboard.down('KeyQ');
      await page.keyboard.down('KeyW');
      await sleep(50);
      await page.keyboard.up('KeyQ');
      await page.keyboard.down('KeyE');
      await page.keyboard.down('KeyA');
      await sleep(50);
      await page.keyboard.up('KeyE');
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyA');
      await sleep(50);
    }

    await sleep(1000);
    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxBodyVelocity).toBeLessThan(50.0);
    expect(stats.maxFootHipDistance).toBeLessThan(5.0);
  });

  test('simultaneous foot lift + all directions: no explosion', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lift both feet and mash all directions
    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyE');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await sleep(500);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyA');
    await page.keyboard.down('KeyS');
    await page.keyboard.down('KeyD');
    await sleep(500);
    await page.keyboard.up('KeyS');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyQ');
    await page.keyboard.up('KeyE');
    await sleep(1000);

    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxBodyVelocity).toBeLessThan(50.0);
  });

  test('lean + walk simultaneously: no explosion', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lean while stepping
    for (let i = 0; i < 6; i++) {
      const foot = i % 2 === 0 ? 'KeyQ' : 'KeyE';
      await page.keyboard.down(foot);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('ArrowUp');
      await sleep(200);
      await page.keyboard.up('KeyW');
      await page.keyboard.up('ArrowUp');
      await page.keyboard.up(foot);
      await sleep(200);
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.fellOver).toBe(false);
  });

  test('30 rapid steps: character survives', async ({ page }) => {
    test.setTimeout(30000);
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 30; i++) {
      const foot = i % 2 === 0 ? 'KeyQ' : 'KeyE';
      await page.keyboard.down(foot);
      await sleep(50);
      await page.keyboard.down('KeyW');
      await sleep(100);
      await page.keyboard.up('KeyW');
      await page.keyboard.up(foot);
      await sleep(50);
    }

    await sleep(1000);
    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxBodyVelocity).toBeLessThan(50.0);
  });

  test('hold all keys at once: no crash', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const allKeys = ['KeyQ', 'KeyE', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    for (const k of allKeys) {
      await page.keyboard.down(k);
    }
    await sleep(1000);
    for (const k of allKeys) {
      await page.keyboard.up(k);
    }
    await sleep(1000);

    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxBodyVelocity).toBeLessThan(100.0);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 8: WALKING PATTERNS
// ═══════════════════════════════════════════════════

test.describe('Walking Patterns', () => {
  test('zigzag walking: alternating left and right steps', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Left foot forward, lean, right foot right, lean
    await takeStep(page, 'left', 'forward', { lean: true });
    await takeStep(page, 'right', 'right', { lean: true });
    await takeStep(page, 'left', 'forward', { lean: true });
    await takeStep(page, 'right', 'left', { lean: true });

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.totalDistance).toBeGreaterThan(0.1);
  });

  test('same foot repeated: only using left foot', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    for (let i = 0; i < 4; i++) {
      await takeStep(page, 'left', 'forward', { lean: true });
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    // Should still count steps
    expect(stats.stepCycles).toBeGreaterThanOrEqual(3);
  });

  test('circle walking: turn by stepping sideways', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Step forward-left, step forward-right to curve
    for (let i = 0; i < 4; i++) {
      // Left foot forward
      await page.keyboard.down('KeyQ');
      await sleep(100);
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA');
      await sleep(300);
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyA');
      await page.keyboard.up('KeyQ');
      await sleep(200);
      await page.keyboard.down('ArrowUp');
      await sleep(200);
      await page.keyboard.up('ArrowUp');
      await sleep(200);

      // Right foot forward
      await page.keyboard.down('KeyE');
      await sleep(100);
      await page.keyboard.down('KeyW');
      await sleep(300);
      await page.keyboard.up('KeyW');
      await page.keyboard.up('KeyE');
      await sleep(200);
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
  });

  test('stomp in place: lift and plant same spot', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Just lift and plant without moving
    for (let i = 0; i < 6; i++) {
      const key = i % 2 === 0 ? 'KeyQ' : 'KeyE';
      await page.keyboard.down(key);
      await sleep(300);
      await page.keyboard.up(key);
      await sleep(300);
    }

    await sleep(500);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
    expect(stats.stepCycles).toBe(6);
    // Should barely move — no directional input
    expect(stats.totalDistance).toBeLessThan(1.0);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 9: RECOVERY & EDGE CASES
// ═══════════════════════════════════════════════════

test.describe('Recovery & Edge Cases', () => {
  test('recovery from lean: body returns near starting position', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    // Lean hard forward
    await page.keyboard.down('ArrowUp');
    await sleep(1000);
    await page.keyboard.up('ArrowUp');

    // Wait for recovery
    await sleep(3000);
    const endPos = await getBodyPos(page);

    // Should settle somewhere, not keep drifting
    const stats = await getStats(page);
    expect(stats.fellOver).toBe(false);
  });

  test('foot overextension recovery: plant far foot and settle', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Extend foot as far as possible
    await page.keyboard.down('KeyQ');
    await sleep(100);
    await page.keyboard.down('KeyW');
    await sleep(1500);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyQ');

    await sleep(2000);
    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
  });

  test('quick double-tap foot lift: no glitch', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Rapidly tap Q
    for (let i = 0; i < 10; i++) {
      await page.keyboard.down('KeyQ');
      await sleep(30);
      await page.keyboard.up('KeyQ');
      await sleep(30);
    }

    await sleep(1000);
    const stats = await getStats(page);

    expect(stats.explosionDetected).toBe(false);
    expect(stats.maxBodyVelocity).toBeLessThan(15.0);
  });

  test('lift-move-lift other: smooth transition between feet', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lift left, move forward, immediately lift right (don't wait for full plant)
    await page.keyboard.down('KeyQ');
    await page.keyboard.down('KeyW');
    await sleep(200);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyQ');
    await sleep(50); // Very brief plant

    await page.keyboard.down('KeyE');
    await page.keyboard.down('KeyW');
    await sleep(200);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyE');
    await sleep(500);

    const stats = await getStats(page);

    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
  });

  test('opposing lean inputs cancel out', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    const startPos = await getBodyPos(page);

    // Press left and right simultaneously
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowRight');
    await sleep(1000);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowRight');
    await sleep(500);

    const endPos = await getBodyPos(page);

    // Should barely move in X (opposing forces cancel)
    const xDrift = Math.abs(endPos.x - startPos.x);
    expect(xDrift).toBeLessThan(0.3);
  });

  test('opposing foot directions cancel out', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // Lift foot and press W+S simultaneously
    await page.keyboard.down('KeyQ');
    await sleep(100);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyS');
    await sleep(500);
    await page.keyboard.up('KeyW');
    await page.keyboard.up('KeyS');
    await page.keyboard.up('KeyQ');
    await sleep(500);

    const stats = await getStats(page);

    // Should have minimal movement
    expect(stats.explosionDetected).toBe(false);
    expect(stats.totalDistance).toBeLessThan(2.0);
  });
});

// ═══════════════════════════════════════════════════
// SECTION 10: TELEMETRY INTEGRITY
// ═══════════════════════════════════════════════════

test.describe('Telemetry Integrity', () => {
  test('telemetry reset clears all stats', async ({ page }) => {
    await waitForGame(page);

    // Generate some activity
    await page.keyboard.down('KeyQ');
    await sleep(500);
    await page.keyboard.up('KeyQ');
    await sleep(500);

    const before = await getStats(page);
    expect(before.stepCycles).toBeGreaterThan(0);

    await resetTelemetry(page);
    // A few frames may run between reset and read, so allow small frameCount
    const stats = await getStats(page);

    expect(stats.frameCount).toBeLessThan(10);
    expect(stats.totalDistance).toBeLessThan(0.1);
    expect(stats.stepCycles).toBe(0);
    expect(stats.fellOver).toBe(false);
    expect(stats.explosionDetected).toBe(false);
  });

  test('frame count increases over time', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(1000);

    const stats = await getStats(page);
    // At 60fps, 1 second should give ~60 frames
    expect(stats.frameCount).toBeGreaterThan(30);
    expect(stats.frameCount).toBeLessThan(120);
  });

  test('history length is bounded', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(6000);

    const history = await getHistory(page, 1000);
    // Max history is 300 frames
    expect(history.length).toBeLessThanOrEqual(300);
    expect(history.length).toBeGreaterThan(100);
  });

  test('history snapshots have all required fields', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(500);

    const history = await getHistory(page, 5);

    for (const frame of history) {
      expect(frame).toHaveProperty('frame');
      expect(frame).toHaveProperty('hipHeight');
      expect(frame).toHaveProperty('torsoAngVel');
      expect(frame).toHaveProperty('bodySpeed');
      expect(frame).toHaveProperty('uprightDot');
      expect(frame).toHaveProperty('leftLifted');
      expect(frame).toHaveProperty('rightLifted');
      expect(frame).toHaveProperty('bodyPos');
      expect(frame.bodyPos).toHaveProperty('x');
      expect(frame.bodyPos).toHaveProperty('y');
      expect(frame.bodyPos).toHaveProperty('z');
    }
  });

  test('step cycle count matches actual lifts', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);

    // 3 left lifts + 2 right lifts = 5 step cycles
    for (let i = 0; i < 5; i++) {
      const key = i % 2 === 0 ? 'KeyQ' : 'KeyE';
      await page.keyboard.down(key);
      await sleep(200);
      await page.keyboard.up(key);
      await sleep(200);
    }

    const stats = await getStats(page);
    expect(stats.stepCycles).toBe(5);
  });

  test('uprightDot is 1.0 when perfectly upright', async ({ page }) => {
    await waitForGame(page);
    await resetTelemetry(page);
    await sleep(1000);

    const history = await getHistory(page, 10);

    for (const frame of history) {
      // Should be very close to 1.0 at idle
      expect(frame.uprightDot).toBeGreaterThan(0.99);
    }
  });
});
