// Headless ball (player) simulation — no canvas, no DOM, no rendering.
// This is the active simulation for multiplayer and single-player; the browser only
// renders authoritative snapshots.
import { GAME_CONFIG } from '../config.js';
import { physics } from '../physics.js';
import { SHOT_RANGE, adjustRange, removeArea, shotProfile } from './playerRanges.js';

const H = GAME_CONFIG.REF_HEIGHT;
// Recoil is the only propulsion (jumping is gone), modelled on conservation of momentum: the
// mass ejected as the shot (the area removed from the body) leaves at the projectile's speed, so
// the body gains the opposite momentum. Δv = gain · shotSpeed · ejectedMass / bodyMass, mass ∝
// area (radius²). Recoil therefore scales with the SQUARE of projectile/player size — a wide
// green shot kicks far harder than a compact purple one — and stays physically small, so movement
// feels weighty instead of rocket-jumpy. RECOIL_GAIN is the one tuning knob (1 = pure physics).
const RECOIL_GAIN = H / 18;  // base launch velocity per shot
const RECOIL_MAX = H / 60;   // per-direction plateau: shots fade + hard-clamp to this launch speed
const MAX_SPEED = GAME_CONFIG.PLAYER_MAX_SPEED;
const HORIZONTAL_RECOIL = 0.58;

function clampPlayerSpeed(ball) {
    const speed = Math.hypot(ball.dx, ball.dy);
    if (speed <= MAX_SPEED) return;
    ball.dx *= MAX_SPEED / speed;
    ball.dy *= MAX_SPEED / speed;
}

export function createBall(id, worldBounds) {
    return {
        id,
        x: worldBounds.right / 2,
        y: H / 16,
        radius: H / 18,
        speed: H / 270,
        dx: 0,
        dy: 0,
        gravity: H / 10000,
        jumpPower: -H / 100,
        isJumping: false,
        canDoubleJump: true,
        friction: 0.87,
        fireRate: 200,
        projSpeed: H / 50,
        currentStock: 10,
        maxStock: 10,
        isGameRunning: true,
        projectiles: [],
        score: 0,
        xPhysics: 0,
        yPhysics: 0,
        angle: 0,      // physical arm angle after platform constraints
        aimAngle: 0,   // requested pointer angle
        previousAimAngle: 0,
        aimMoved: false,
        armMode: 'leverage',
        armPivot: null,
        releaseArmPivot: false,
        strength: 1,
        shotRange: SHOT_RANGE.initial,
        lastShotTime: 0,
        projSeq: 0,     // stable per-shot id, so clients can interpolate a projectile's flight
        jumpedThisTick: false,
        dead: false
    };
}

// input: { keys:Set<string>, shooting:bool, jump:bool (edge), aim:number (radians) }
export function stepBall(ball, input, worldBounds, dtMs = GAME_CONFIG.TICK_DURATION) {
    ball.jumpedThisTick = false;
    ball.previousAimAngle = ball.aimAngle ?? ball.angle;
    // Space/W/Up and S/Down are auto-firing thrusters (see tryShoot). Up-thrust aims the shot
    // straight down; down-thrust aims it straight up. Neither held means aim follows the mouse.
    const thrusting = (input.keys.has(' ') || input.keys.has('w') || input.keys.has('arrowup')) && ball.isGameRunning;
    const dashing = !thrusting && (input.keys.has('s') || input.keys.has('arrowdown')) && ball.isGameRunning;
    ball.aimAngle = thrusting ? Math.PI / 2
        : dashing ? -Math.PI / 2
        : (input.aim ?? ball.aimAngle ?? ball.angle);
    ball.aimMoved = !thrusting && !dashing && !!input.aimMoved;

    const wider = input.keys.has('q');
    const narrower = input.keys.has('e');
    if (wider !== narrower) {
        ball.shotRange = adjustRange(SHOT_RANGE, ball.shotRange, wider ? 1 : -1, dtMs);
    }

    applyDirection(ball, input);

    ball.x += ball.dx * (0.2 + ball.strength * 0.8) + ball.xPhysics;
    ball.y += ball.dy + ball.yPhysics;

    physics(ball);
    ball.dy += ball.gravity;

    // Overall terminal speed: stacking diagonals and long falls can't build past this.
    clampPlayerSpeed(ball);

    // World bounds
    if (ball.x - ball.radius < worldBounds.left) {
        ball.x = worldBounds.left + ball.radius;
        ball.dx = -ball.dx / 1.5;
    } else if (ball.x + ball.radius > worldBounds.right) {
        ball.x = worldBounds.right - ball.radius;
        ball.dx = -ball.dx / 1.5;
    }
    if (ball.y - ball.radius < 0) {
        ball.y = ball.radius;
        ball.dy = Math.abs(ball.dy) + ball.gravity;
        ball.isJumping = true;
    }
    if (ball.y > worldBounds.bottom + ball.radius) {
        ball.y = worldBounds.bottom + ball.radius;
        ball.dx = 0;
        ball.isJumping = false;
        ball.canDoubleJump = true;
    }

    if (ball.radius < H / 40) ball.dead = true;

    if (ball.strength < 1) ball.strength = Math.min(1, ball.strength + 0.05);
    if (ball.strength < 0) ball.strength = 0;
}

function applyDirection(ball, input) {
    const hasA = input.keys.has('a') || input.keys.has('arrowleft');
    const hasD = input.keys.has('d') || input.keys.has('arrowright');

    if (hasA && hasD) ball.dx = 0;
    // Walking sets a target speed but must never SLOW existing momentum — recoil launches you
    // faster than walking, and pressing toward that motion should keep it, not clamp it to walk
    // speed. Pressing toward your travel keeps the faster of the two; pressing against it reverses.
    else if (hasD) ball.dx = Math.max(ball.dx, ball.speed);
    else if (hasA) ball.dx = Math.min(ball.dx, -ball.speed);
    else if (!ball.isJumping) ball.dx *= ball.friction;   // friction only on the ground; air keeps momentum
    // S no longer fast-drops directly: it auto-fires straight up, so the recoil dashes you down.
}

// Fire if the fire button is held (or space is thrusting) and the cooldown has elapsed.
export function tryShoot(ball, input, currentTime, { consumeSize = true } = {}) {
    const firing = input.shooting || input.keys?.has(' ') || input.keys?.has('w') || input.keys?.has('arrowup') ||
        input.keys?.has('s') || input.keys?.has('arrowdown');
    if (!firing || !ball.isGameRunning) return;
    const profile = shotProfile(ball);
    if (currentTime - ball.lastShotTime < profile.cooldownMs) return;
    if (ball.currentStock <= 0) {
        ball.currentStock = ball.maxStock;
        return;
    }

    // No suicide blocker: a shot that shrinks you past the death size is allowed — stepBall's
    // radius check then kills you. removeArea already floors the radius at 0.
    const nextRadius = consumeSize ? removeArea(ball.radius, profile.areaCost) : ball.radius;
    ball.lastShotTime = currentTime;
    ball.currentStock--;
    ball.radius = nextRadius;
    // Shots follow where you AIM, not the physically-blocked arm angle: standing on a platform the
    // arm can't rotate down through it, so firing on ball.angle made the space down-thrust come out
    // shallow and weak. aimAngle is the pointer (or straight down while thrusting).
    const shotAngle = ball.aimAngle ?? ball.angle;
    // Recoil propulsion. Applied as VELOCITY (dx/dy), not the fast-decaying impulse channel, so
    // one shot is a real jump — velocity is bled off only by gravity, like the old jump, instead
    // of vanishing in a few ticks. Consistency across directions comes from air having no friction
    // (see applyDirection): every direction is then just velocity + gravity. Scaled by the linear
    // projectile ÷ player size ratio so a wide green shot launches further than a compact purple
    // one, without the square-law blowing green's jump height out of proportion. Not in the lobby.
    if (ball.armMode !== 'locked') {
        const recoil = RECOIL_GAIN * profile.projectileRadius / ball.radius;
        const cap = RECOIL_MAX;
        // Side propulsion is intentionally softer than vertical thrust. Scale only the X axis,
        // so diagonals transition smoothly instead of switching strength at an angle threshold.
        const rx = -Math.cos(shotAngle) * HORIZONTAL_RECOIL;
        const ry = -Math.sin(shotAngle);
        // Diminishing returns per direction: the recoil fades the faster you're already moving
        // that way, so the first shot hits hard and stacking the same way plateaus toward `cap`.
        // A new direction is full strength again (your speed that way is low).
        const directionLength = Math.max(1e-9, Math.hypot(rx, ry));
        const nx = rx / directionLength, ny = ry / directionLength;
        const speedThatWay = ball.dx * nx + ball.dy * ny;
        const fade = Math.max(0, Math.min(1, 1 - speedThatWay / cap));
        const recoilDX = rx * recoil * fade;
        const recoilDY = ry * recoil * fade;
        ball.dx += recoilDX;
        ball.dy += recoilDY;
        // Release only for recoil that explicitly pushes away from a planted contact. Inferring
        // this from total velocity breaks legitimate tangential movement around the leverage arc.
        if (ball.armPivot) {
            const pivotDX = ball.armPivot.x - ball.x;
            const pivotDY = ball.armPivot.y - ball.y;
            const pivotDistance = Math.max(1e-9, Math.hypot(pivotDX, pivotDY));
            const recoilTowardPivot = recoilDX * pivotDX / pivotDistance +
                recoilDY * pivotDY / pivotDistance;
            if (recoilTowardPivot < -0.25) ball.releaseArmPivot = true;
        }
        // Hard clamp so even one huge shot can't launch past this direction's plateau.
        const after = ball.dx * nx + ball.dy * ny;
        if (after > cap) { ball.dx -= nx * (after - cap); ball.dy -= ny * (after - cap); }
        // Clamp in the same tick as the shot. Waiting for the next movement step allowed the
        // third stacked shot to exceed the advertised terminal speed for a whole server frame.
        clampPlayerSpeed(ball);
        if (ball.dy < 0) ball.isJumping = true;   // launched off the ground: airborne
    }
    const speed = ball.projSpeed;
    ball.projectiles.push({
        id: `${ball.id}-${++ball.projSeq}`,
        x: ball.x + (ball.radius * 1.7 * Math.cos(shotAngle)) / 2,
        y: ball.y + (ball.radius * 1.7 * Math.sin(shotAngle)) / 2,
        radius: profile.projectileRadius,
        dx: speed * Math.cos(shotAngle),
        dy: speed * Math.sin(shotAngle),
        ricochetCount: 0,
        ownerId: ball.id,
        shotRange: profile.normalized,
        damage: profile.playerDamage,
        enemyDamage: profile.enemyDamage
    });
}

function sweptProjectileHit(fromX, fromY, projectile, platform) {
    const vx = projectile.x - fromX, vy = projectile.y - fromY;
    const minX = platform.x - projectile.radius;
    const maxX = platform.x + platform.width + projectile.radius;
    const minY = platform.y - projectile.radius;
    const maxY = platform.y + platform.height + projectile.radius;
    if (fromX > minX && fromX < maxX && fromY > minY && fromY < maxY) {
        const edges = [
            { distance: fromX - minX, x: -1, y: 0 },
            { distance: maxX - fromX, x: 1, y: 0 },
            { distance: fromY - minY, x: 0, y: -1 },
            { distance: maxY - fromY, x: 0, y: 1 }
        ];
        const edge = edges.reduce((best, candidate) =>
            candidate.distance < best.distance ? candidate : best);
        return { t: 0, x: edge.x, y: edge.y };
    }
    let enter = 0, exit = 1, normalX = 0, normalY = 0;
    for (const axis of [
        { origin: fromX, delta: vx, min: minX, max: maxX, nx: -1, ny: 0 },
        { origin: fromY, delta: vy, min: minY, max: maxY, nx: 0, ny: -1 }
    ]) {
        if (axis.delta === 0) {
            if (axis.origin < axis.min || axis.origin > axis.max) return null;
            continue;
        }
        let near = (axis.min - axis.origin) / axis.delta;
        let far = (axis.max - axis.origin) / axis.delta;
        let nx = axis.nx, ny = axis.ny;
        if (near > far) { [near, far] = [far, near]; nx = -nx; ny = -ny; }
        if (near > enter) { enter = near; normalX = nx; normalY = ny; }
        exit = Math.min(exit, far);
        if (enter > exit) return null;
    }
    return enter >= 0 && enter <= 1 ? { t: enter, x: normalX, y: normalY } : null;
}

// Advance this ball's projectiles: gravity, swept ricochet, platform damage, despawn.
// platformsObj must expose getNearbyPlatforms(x, y, w, h).
export function stepProjectiles(ball, platformsObj, worldBounds) {
    for (let i = ball.projectiles.length - 1; i >= 0; i--) {
        const p = ball.projectiles[i];
        const fromX = p.x, fromY = p.y;
        p.x += p.dx;
        p.y += p.dy;
        p.dy += 0.05;

        const left = Math.min(fromX, p.x) - p.radius;
        const top = Math.min(fromY, p.y) - p.radius;
        const right = Math.max(fromX, p.x) + p.radius;
        const bottom = Math.max(fromY, p.y) + p.radius;
        let first = null;
        for (const platform of platformsObj.getNearbyPlatforms(left, top, right - left, bottom - top)) {
            if (platform.destroyed) continue;
            const hit = sweptProjectileHit(fromX, fromY, p, platform);
            if (hit && (!first || hit.t < first.hit.t)) first = { platform, hit };
        }
        if (first) {
            const { platform, hit } = first;
            p.x = fromX + (p.x - fromX) * hit.t + hit.x * 0.01;
            p.y = fromY + (p.y - fromY) * hit.t + hit.y * 0.01;
            p.hitPlatforms ??= new Set();
            if (platform.index >= 0 && !p.hitPlatforms.has(platform.id)) {
                p.hitPlatforms.add(platform.id);
                platform.hitPlatform(hit.y <= 0 ? 1 : 0, p.dy);
            }
            if (hit.y) p.dy = -p.dy;
            else p.dx = -p.dx;
            p.ricochetCount++;
        }

        if (p.x < ball.x - GAME_CONFIG.REF_WIDTH || p.x > ball.x + GAME_CONFIG.REF_WIDTH ||
            p.y < 0 || p.y > worldBounds.bottom || p.ricochetCount >= 3) {
            ball.projectiles.splice(i, 1);
        }
    }
}
