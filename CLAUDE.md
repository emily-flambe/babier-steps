# Babier Steps — Claude Context

## Project Overview

Physics-based walking game. Browser-based, Three.js + Rapier (WASM). The character has 3 physics bodies (torso + 2 feet, no joints). Deployed to Cloudflare Workers as a static site.

## Architecture

### Character Physics (`src/ragdoll.js`)
- **Torso:** mass=15, linearDamping=2.0, angularDamping=5.0, gravityScale=0
- **Feet:** mass=0.5, linearDamping=4.0, angularDamping=5.0, gravityScale=0, friction=5.0
- Spawns at: torso y=1.05, feet y=0.05 (footHalfH), feet z=0
- No physics joints — legs are visual lines only

### Force Systems (`src/main.js`)
All forces applied in `physicsStep()` at fixed 1/60s timestep:

1. **Upright torque** — cross product of body up vs world up, k=50, damping=15
2. **Height spring** — targets `avgFootY + 1.0`, k=60, c=60 (critically damped for m=15)
3. **Body-follow-feet** — spring to feet midpoint, k=15, c=30 (critically damped for m=15)
4. **Foot spring** — when lifted: k=120, c=20, speed=4.0, maxReach=1.2
5. **Lean force** — arrow keys apply 25N directly to torso

### Foot State Machine
- **Planted:** KinematicPositionBased — immovable anchor
- **Lifted:** Dynamic — spring force toward target, low friction (0.1)
- **Planting:** Raycast downward (excluding all ragdoll colliders) to find ground surface, snap foot to surface + 0.05m

### Critical Damping Formula
For a spring with stiffness `k` and mass `m`: `c = 2 * sqrt(k * m)`
This prevents oscillation. All springs in this project use this formula.

## Known Bugs

- **No gravity when both feet lifted** — `gravityScale(0)` means the body floats. Two tests marked `test.fixme()` document this. Fixing requires re-enabling gravity selectively without reintroducing oscillation.
- **Leaning slides the body** — lean force translates horizontally instead of tilting the torso, because the body has no ground contact constraint.

## Testing

59 Playwright tests across 10 categories. Run with `npm test`.

Tests use `window.gametelemetry` (exposed by `src/telemetry.js`) to read physics state:
- `getStats()` — accumulated stats (min/max hipHeight, velocity, fell over, explosion, step cycles)
- `getHistory(n)` — last N frame snapshots
- `reset()` — clear stats between test phases

Headless Chrome with `--use-gl=swiftshader` for software WebGL.

## Development Commands

```bash
npm run dev          # Vite dev server on :5173
npm test             # Playwright test suite
npm run build        # Production build to dist/
npm run deploy       # Build + wrangler deploy
```

## Rapier API Gotchas

- `setBodyType(type, wakeUp)` — second arg is required boolean
- `setGravityScale(scale)` on RigidBodyDesc takes 1 arg; on RigidBody takes 2 (scale, wakeUp)
- `world.castRay()` — use `filterPredicate` callback for reliable collider exclusion
- Rapier applies gravity internally in `world.step()` — don't add gravity compensation forces
- Colliders use half-extents, Three.js geometries use full dimensions

## Knowledge Graph (Agent-MCP)

After significant changes (new features, architecture decisions, schema changes), save context to Agent-MCP using `update_project_context`. Use the key prefix `babier-steps/` (e.g., `babier-steps/architecture`).

Update existing entries when information changes. Create new keys for new topics. This ensures any agent in any session can retrieve project context via `ask_project_rag`.
