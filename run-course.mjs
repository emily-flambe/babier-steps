import { chromium } from '@playwright/test';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Autopilot that walks the character through the obstacle course.
 * Uses telemetry to read body/foot positions and adapts inputs accordingly.
 */
async function runCourse() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--use-gl=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:5173');
  await page.waitForFunction(() => window.gameReady === true, null, { timeout: 10000 });
  await sleep(1500);

  // ── Helpers ──

  async function getPos() {
    return page.evaluate(() => {
      const r = window.gametelemetry.ragdoll;
      const b = r.body.translation();
      const lf = r.feet.left.translation();
      const rf = r.feet.right.translation();
      return {
        body: { x: b.x, y: b.y, z: b.z },
        leftFoot: { x: lf.x, y: lf.y, z: lf.z },
        rightFoot: { x: rf.x, y: rf.y, z: rf.z },
      };
    });
  }

  async function getBodyZ() {
    const pos = await getPos();
    return pos.body.z;
  }

  /** Lift foot, move in direction for duration, plant, then lean */
  async function step(side, { forward = 0, sideways = 0, up = 0, moveDur = 250, leanDur = 150, settleDur = 150 } = {}) {
    const liftKey = side === 'left' ? 'KeyQ' : 'KeyE';

    // Lift
    await page.keyboard.down(liftKey);
    await sleep(80);

    // Move foot
    const moveKeys = [];
    if (forward > 0) moveKeys.push('KeyW');
    if (forward < 0) moveKeys.push('KeyS');
    if (sideways > 0) moveKeys.push('KeyD');
    if (sideways < 0) moveKeys.push('KeyA');
    if (up > 0) moveKeys.push('KeyR');
    if (up < 0) moveKeys.push('KeyF');

    for (const k of moveKeys) await page.keyboard.down(k);
    await sleep(moveDur);
    for (const k of moveKeys) await page.keyboard.up(k);

    // Plant
    await page.keyboard.up(liftKey);
    await sleep(settleDur);

    // Lean forward
    if (leanDur > 0) {
      await page.keyboard.down('ArrowUp');
      await sleep(leanDur);
      await page.keyboard.up('ArrowUp');
      await sleep(settleDur);
    }
  }

  /** Take a high step (lift foot up first, then forward) for hurdles/stairs */
  async function highStep(side, { height = 300, forward = 250, leanDur = 150 } = {}) {
    const liftKey = side === 'left' ? 'KeyQ' : 'KeyE';

    await page.keyboard.down(liftKey);
    await sleep(60);

    // Raise foot
    await page.keyboard.down('KeyR');
    await sleep(height);
    await page.keyboard.up('KeyR');

    // Move forward
    await page.keyboard.down('KeyW');
    await sleep(forward);
    await page.keyboard.up('KeyW');

    // Plant
    await page.keyboard.up(liftKey);
    await sleep(150);

    // Lean
    if (leanDur > 0) {
      await page.keyboard.down('ArrowUp');
      await sleep(leanDur);
      await page.keyboard.up('ArrowUp');
      await sleep(120);
    }
  }

  /** Walk N alternating steps forward */
  async function walkForward(n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 'left' : 'right';
      await step(side, { forward: 1, ...opts });
    }
  }

  /** Lean in a direction */
  async function lean(direction, dur = 200) {
    const key = direction === 'forward' ? 'ArrowUp'
      : direction === 'back' ? 'ArrowDown'
      : direction === 'left' ? 'ArrowLeft'
      : 'ArrowRight';
    await page.keyboard.down(key);
    await sleep(dur);
    await page.keyboard.up(key);
    await sleep(100);
  }

  function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
  }

  // ═══════════════════════════════════════════════
  // THE RUN
  // ═══════════════════════════════════════════════

  log('Starting obstacle course run...');
  let pos = await getPos();
  log(`Start position: z=${pos.body.z.toFixed(2)}`);

  // ── Approach hurdles ──
  log('Section 1: Low hurdles');
  await walkForward(3);

  // Hurdle 1 (z=-3.5, height 0.2)
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}, approaching hurdle 1`);
  await highStep('left', { height: 250, forward: 300 });
  await highStep('right', { height: 250, forward: 300 });

  // Hurdle 2 (z=-5.0, height 0.3)
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}, approaching hurdle 2`);
  await highStep('left', { height: 300, forward: 300 });
  await highStep('right', { height: 300, forward: 300 });

  // Hurdle 3 (z=-6.5, height 0.4)
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}, approaching hurdle 3`);
  await highStep('left', { height: 350, forward: 300 });
  await highStep('right', { height: 350, forward: 300 });

  await walkForward(2);

  // ── Stepping stones ──
  log('Section 2: Stepping stones');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}`);

  // Stones at: (-0.3,-9), (0.3,-10.2), (-0.2,-11.4), (0.4,-12.6), (-0.1,-13.8), (0.2,-15)
  // Need to step onto each stone precisely
  const stones = [
    { x: -0.3, z: -9.0 },
    { x: 0.3, z: -10.2 },
    { x: -0.2, z: -11.4 },
    { x: 0.4, z: -12.6 },
    { x: -0.1, z: -13.8 },
    { x: 0.2, z: -15.0 },
  ];

  for (let i = 0; i < stones.length; i++) {
    const side = i % 2 === 0 ? 'left' : 'right';
    const stone = stones[i];
    pos = await getPos();

    // Calculate direction needed
    const needRight = stone.x > pos.body.x;
    const sideways = needRight ? 1 : -1;

    await step(side, {
      forward: 1,
      sideways,
      moveDur: 300,
      leanDur: 200,
      settleDur: 200,
    });

    log(`  Stepped to stone ${i + 1} at z=${stone.z}`);
  }

  await walkForward(2);

  // ── Narrow beam ──
  log('Section 3: Narrow beam');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}`);

  // Step onto entry platform, then careful narrow steps
  await step('left', { forward: 1, moveDur: 200, leanDur: 100 });

  // Walk carefully along the beam — small steps, no sideways drift
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 'right' : 'left';
    await step(side, { forward: 1, moveDur: 200, leanDur: 100, settleDur: 200 });
  }

  // Step off the beam
  await walkForward(2);

  // ── Ramp + platform ──
  log('Section 4: Ramp + platform');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}`);

  // Walk up the ramp — need high steps to get on the ramp surface
  await highStep('left', { height: 200, forward: 300 });
  await highStep('right', { height: 200, forward: 300 });

  // Continue up the ramp
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? 'left' : 'right';
    await highStep(side, { height: 200, forward: 300, leanDur: 200 });
  }

  // Step onto the platform at the top
  await highStep('left', { height: 250, forward: 300 });
  await highStep('right', { height: 250, forward: 300 });

  // Walk across platform
  await walkForward(2, { moveDur: 300 });

  // Step down off platform
  await step('left', { forward: 1, moveDur: 350, leanDur: 200 });
  await step('right', { forward: 1, moveDur: 350, leanDur: 200 });

  // ── Zigzag corridor ──
  log('Section 5: Zigzag corridor');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}`);

  // Walls alternate: left wall at z=-33, right at -35, left at -37, right at -39, left at -41
  // Need to go right around left walls and left around right walls

  // Approach and go right of first wall (at x=-0.6, z=-33)
  await step('right', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await step('left', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await lean('forward', 200);

  // Go left of second wall (at x=0.6, z=-35)
  await step('left', { forward: 1, sideways: -1, moveDur: 300, leanDur: 150 });
  await step('right', { forward: 1, sideways: -1, moveDur: 300, leanDur: 150 });
  await lean('forward', 200);

  // Go right of third wall (at x=-0.6, z=-37)
  await step('right', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await step('left', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await lean('forward', 200);

  // Go left of fourth wall (at x=0.6, z=-39)
  await step('left', { forward: 1, sideways: -1, moveDur: 300, leanDur: 150 });
  await step('right', { forward: 1, sideways: -1, moveDur: 300, leanDur: 150 });
  await lean('forward', 200);

  // Go right of fifth wall (at x=-0.6, z=-41)
  await step('right', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await step('left', { forward: 1, sideways: 1, moveDur: 300, leanDur: 150 });
  await lean('forward', 200);

  // Exit corridor
  await walkForward(2);

  // ── Staircase ──
  log('Section 6: Staircase');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}`);

  // 6 steps, each 0.12m higher, 1.0m deeper
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? 'left' : 'right';
    await highStep(side, { height: 300, forward: 350, leanDur: 200 });
    pos = await getPos();
    log(`  Stair ${i + 1}: z=${pos.body.z.toFixed(2)} y=${pos.body.y.toFixed(2)}`);
  }

  // Walk across landing
  await walkForward(2, { moveDur: 350 });

  // Step down off landing
  await step('left', { forward: 1, moveDur: 400, leanDur: 200 });
  await step('right', { forward: 1, moveDur: 400, leanDur: 200 });

  // ── Final approach to finish ──
  log('Section 7: Finish line');
  pos = await getPos();
  log(`  At z=${pos.body.z.toFixed(2)}, finish at z=-53`);

  // Walk to finish
  while (true) {
    pos = await getPos();
    if (pos.body.z <= -53) break;
    await step(Math.random() > 0.5 ? 'left' : 'right', {
      forward: 1,
      moveDur: 300,
      leanDur: 200,
    });
  }

  pos = await getPos();
  const progress = await page.evaluate(() => document.getElementById('progress').textContent);
  log(`\n${'═'.repeat(40)}`);
  log(`FINISHED! Final position: z=${pos.body.z.toFixed(2)}`);
  log(`Progress: ${progress}%`);
  log(`${'═'.repeat(40)}`);

  await page.screenshot({ path: '/tmp/course-complete.png' });
  log('Screenshot saved to /tmp/course-complete.png');

  // Keep browser open for a moment to admire
  await sleep(3000);
  await browser.close();
}

runCourse().catch(err => {
  console.error('Course run failed:', err);
  process.exit(1);
});
