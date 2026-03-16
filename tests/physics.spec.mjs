import { test, expect } from '@playwright/test';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: wait for game to be ready
async function waitForGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.gameReady === true, null, { timeout: 10000 });
  // Let physics settle for 1 second
  await sleep(1000);
}

// Helper: get telemetry stats
async function getStats(page) {
  return page.evaluate(() => window.gametelemetry.getStats());
}

// Helper: reset telemetry
async function resetTelemetry(page) {
  return page.evaluate(() => window.gametelemetry.reset());
}

// Helper: get recent frame history
async function getHistory(page, n) {
  return page.evaluate((count) => window.gametelemetry.getHistory(count), n);
}

// ─────────────────────────────────────────────────
// Test 1: Idle stability — character should stand
// ─────────────────────────────────────────────────
test('idle stability: character stands without falling', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Stand still for 3 seconds
  await sleep(3000);

  const stats = await getStats(page);

  // Hip should stay near target height (1.6m)
  expect(stats.minHipHeight).toBeGreaterThan(1.3);
  expect(stats.maxHipHeight).toBeLessThan(1.9);

  // Should not have fallen
  expect(stats.fellOver).toBe(false);

  // No physics explosion
  expect(stats.explosionDetected).toBe(false);

  // Torso angular velocity should be low (stable)
  // Slightly elevated during initial settling from spawn
  expect(stats.maxTorsoAngVel).toBeLessThan(3.0);

  // Should not have drifted far
  expect(stats.totalDistance).toBeLessThan(0.5);

  // Max body velocity should be low
  expect(stats.maxBodyVelocity).toBeLessThan(5.0);

  // Foot-to-hip distance should be within leg length
  // Measured from torso center, so includes half-torso + full leg
  expect(stats.maxFootHipDistance).toBeLessThan(1.8);
});

// ─────────────────────────────────────────────────
// Test 2: Lifting one foot — should stay upright
// ─────────────────────────────────────────────────
test('single foot lift: character stays upright', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Lift left foot for 1 second
  await page.keyboard.down('KeyQ');
  await sleep(1000);
  await page.keyboard.up('KeyQ');
  await sleep(500);

  // Lift right foot for 1 second
  await page.keyboard.down('KeyE');
  await sleep(1000);
  await page.keyboard.up('KeyE');
  await sleep(500);

  const stats = await getStats(page);

  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);
  expect(stats.minHipHeight).toBeGreaterThan(1.0);
  expect(stats.maxFootHipDistance).toBeLessThan(2.0);
  // Foot spring forces can produce brief velocity spikes ~15 m/s
  // Explosion threshold is 50 m/s
  expect(stats.maxBodyVelocity).toBeLessThan(20.0);
});

// ─────────────────────────────────────────────────
// Test 3: Walking sequence — take steps, move forward
// ─────────────────────────────────────────────────
test('walking: deliberate steps produce forward movement', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Take 4 deliberate steps
  for (let i = 0; i < 4; i++) {
    const key = i % 2 === 0 ? 'KeyQ' : 'KeyE';

    // Lift
    await page.keyboard.down(key);
    await sleep(100);

    // Move forward
    await page.keyboard.down('KeyW');
    await sleep(300);
    await page.keyboard.up('KeyW');

    // Plant
    await page.keyboard.up(key);
    await sleep(200);

    // Lean forward
    await page.keyboard.down('ArrowUp');
    await sleep(200);
    await page.keyboard.up('ArrowUp');
    await sleep(200);
  }

  await sleep(500);
  const stats = await getStats(page);

  // Should not have fallen or exploded
  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);

  // Should have counted step cycles
  expect(stats.stepCycles).toBeGreaterThanOrEqual(3);

  // Should have moved some distance (but not teleported)
  expect(stats.totalDistance).toBeGreaterThan(0.1);
  expect(stats.totalDistance).toBeLessThan(30.0);

  // Hip stayed in reasonable range
  expect(stats.minHipHeight).toBeGreaterThan(0.8);

  // Foot-hip distance stayed sane
  expect(stats.maxFootHipDistance).toBeLessThan(2.5);
});

// ─────────────────────────────────────────────────
// Test 4: Leaning — should move body without falling
// ─────────────────────────────────────────────────
test('leaning: body shifts without falling', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Lean in each direction
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    await page.keyboard.down(key);
    await sleep(500);
    await page.keyboard.up(key);
    await sleep(300);
  }

  const stats = await getStats(page);

  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);
  expect(stats.minHipHeight).toBeGreaterThan(1.0);
});

// ─────────────────────────────────────────────────
// Test 5: Stress test — rapid inputs shouldn't explode
// ─────────────────────────────────────────────────
test('stress: rapid foot toggles do not cause explosion', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Rapidly toggle feet and mash movement keys
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

  await sleep(1000); // let it settle

  const stats = await getStats(page);

  // The key check: no explosion
  expect(stats.explosionDetected).toBe(false);

  // Velocity should be bounded
  expect(stats.maxBodyVelocity).toBeLessThan(30.0);

  // Joints shouldn't have stretched to infinity
  expect(stats.maxFootHipDistance).toBeLessThan(3.0);
});

// ─────────────────────────────────────────────────
// Test 6: Distance per step — sanity check
// ─────────────────────────────────────────────────
test('step efficiency: distance per step is reasonable', async ({ page }) => {
  await waitForGame(page);
  await sleep(500);
  await resetTelemetry(page);

  // Take 6 careful steps
  for (let i = 0; i < 6; i++) {
    const key = i % 2 === 0 ? 'KeyQ' : 'KeyE';

    await page.keyboard.down(key);
    await sleep(100);
    await page.keyboard.down('KeyW');
    await sleep(300);
    await page.keyboard.up('KeyW');
    await page.keyboard.up(key);
    await sleep(200);

    await page.keyboard.down('ArrowUp');
    await sleep(200);
    await page.keyboard.up('ArrowUp');
    await sleep(300);
  }

  await sleep(500);
  const stats = await getStats(page);

  if (stats.stepCycles > 0) {
    const distPerStep = stats.totalDistance / stats.stepCycles;
    // Each step should move roughly 0.1 - 3.0 meters
    // (wide range for now, tighten as we tune)
    expect(distPerStep).toBeGreaterThan(0.05);
    expect(distPerStep).toBeLessThan(5.0);
  }
});

// ─────────────────────────────────────────────────
// Test 7: Frame history — hip height over time
// ─────────────────────────────────────────────────
test('stability timeline: hip height stays bounded over time', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  // Do some activity
  await page.keyboard.down('KeyQ');
  await sleep(300);
  await page.keyboard.down('KeyW');
  await sleep(300);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('KeyQ');
  await sleep(500);

  await page.keyboard.down('ArrowUp');
  await sleep(500);
  await page.keyboard.up('ArrowUp');
  await sleep(1000);

  const history = await getHistory(page, 60);

  // Check every sampled frame
  for (const frame of history) {
    expect(frame.hipHeight).toBeGreaterThan(0.5);
    expect(frame.hipHeight).toBeLessThan(3.0);
    expect(frame.bodySpeed).toBeLessThan(25.0);
    expect(frame.uprightDot).toBeGreaterThan(0.1);
  }
});
