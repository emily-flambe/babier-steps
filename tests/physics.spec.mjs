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

// ─────────────────────────────────────────────────
// Test 1: Idle stability
// ─────────────────────────────────────────────────
test('idle stability: character stands without falling', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);
  await sleep(3000);

  const stats = await getStats(page);

  // Simplified char: body ~1.0m above feet
  expect(stats.minHipHeight).toBeGreaterThan(0.3);
  expect(stats.maxHipHeight).toBeLessThan(2.0);
  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);
  expect(stats.maxTorsoAngVel).toBeLessThan(5.0);
  expect(stats.totalDistance).toBeLessThan(1.0);
  expect(stats.maxBodyVelocity).toBeLessThan(10.0);
  expect(stats.maxFootHipDistance).toBeLessThan(2.0);
});

// ─────────────────────────────────────────────────
// Test 2: Single foot lift
// ─────────────────────────────────────────────────
test('single foot lift: character stays upright', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  await page.keyboard.down('KeyQ');
  await sleep(1000);
  await page.keyboard.up('KeyQ');
  await sleep(500);

  await page.keyboard.down('KeyE');
  await sleep(1000);
  await page.keyboard.up('KeyE');
  await sleep(500);

  const stats = await getStats(page);

  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);
  expect(stats.minHipHeight).toBeGreaterThan(0.3);
  expect(stats.maxFootHipDistance).toBeLessThan(3.0);
  expect(stats.maxBodyVelocity).toBeLessThan(25.0);
});

// ─────────────────────────────────────────────────
// Test 3: Walking sequence
// ─────────────────────────────────────────────────
test('walking: deliberate steps produce forward movement', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

  for (let i = 0; i < 4; i++) {
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
    await sleep(200);
  }

  await sleep(500);
  const stats = await getStats(page);

  expect(stats.fellOver).toBe(false);
  expect(stats.explosionDetected).toBe(false);
  expect(stats.stepCycles).toBeGreaterThanOrEqual(3);
  expect(stats.totalDistance).toBeGreaterThan(0.1);
  expect(stats.totalDistance).toBeLessThan(50.0);
  expect(stats.minHipHeight).toBeGreaterThan(0.2);
  expect(stats.maxFootHipDistance).toBeLessThan(4.0);
});

// ─────────────────────────────────────────────────
// Test 4: Leaning
// ─────────────────────────────────────────────────
test('leaning: body shifts without falling', async ({ page }) => {
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

// ─────────────────────────────────────────────────
// Test 5: Stress test
// ─────────────────────────────────────────────────
test('stress: rapid foot toggles do not cause explosion', async ({ page }) => {
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

// ─────────────────────────────────────────────────
// Test 6: Step efficiency
// ─────────────────────────────────────────────────
test('step efficiency: distance per step is reasonable', async ({ page }) => {
  await waitForGame(page);
  await sleep(500);
  await resetTelemetry(page);

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
    expect(distPerStep).toBeGreaterThan(0.05);
    expect(distPerStep).toBeLessThan(10.0);
  }
});

// ─────────────────────────────────────────────────
// Test 7: Frame history
// ─────────────────────────────────────────────────
test('stability timeline: hip height stays bounded over time', async ({ page }) => {
  await waitForGame(page);
  await resetTelemetry(page);

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

  for (const frame of history) {
    expect(frame.hipHeight).toBeGreaterThan(0.2);
    expect(frame.hipHeight).toBeLessThan(3.0);
    expect(frame.bodySpeed).toBeLessThan(30.0);
    expect(frame.uprightDot).toBeGreaterThan(0.1);
  }
});
