// Headless ball (player) simulation — no canvas, no DOM, no rendering.
// This is the active simulation for multiplayer and single-player; the browser only
// renders authoritative snapshots.
import { GAME_CONFIG } from '../config.js';
import { physics } from '../physics.js';
import { SHOT_RANGE, adjustRange, removeArea, shotProfile } from './playerRanges.js';

const H = GAME_CONFIG.REF_HEIGHT;

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
        angle: 0,      // aim, set from the client's input.aim each tick
        strength: 1,
        shotRange: SHOT_RANGE.initial,
        lastShotTime: 0,
        projSeq: 0,     // stable per-shot id, so clients can interpolate a projectile's flight
        dead: false
    };
}

// input: { keys:Set<string>, shooting:bool, jump:bool (edge), aim:number (radians) }
export function stepBall(ball, input, worldBounds, dtMs = GAME_CONFIG.TICK_DURATION) {
    ball.angle = input.aim ?? ball.angle;

    const wider = input.keys.has('q');
    const narrower = input.keys.has('e');
    if (wider !== narrower) {
        ball.shotRange = adjustRange(SHOT_RANGE, ball.shotRange, wider ? 1 : -1, dtMs);
    }

    // Jump (edge-triggered)
    if (input.jump && ball.isGameRunning) {
        if (!ball.isJumping) {
            ball.dy = ball.jumpPower * ball.strength;
            ball.isJumping = true;
            ball.canDoubleJump = true;
        } else if (ball.canDoubleJump) {
            ball.dy = ball.jumpPower * ball.strength;
            ball.canDoubleJump = false;
        }
    }

    applyDirection(ball, input);

    ball.x += ball.dx * (0.2 + ball.strength * 0.8) + ball.xPhysics;
    ball.y += ball.dy + ball.yPhysics;

    physics(ball);
    ball.dy += ball.gravity;

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

    if (ball.strength < 1) ball.strength += 0.05;
    if (ball.strength < 0) ball.strength = 0;
}

function applyDirection(ball, input) {
    const hasA = input.keys.has('a') || input.keys.has('arrowleft');
    const hasD = input.keys.has('d') || input.keys.has('arrowright');
    const hasS = input.keys.has('s') || input.keys.has('arrowdown');

    if (hasA && hasD) ball.dx = 0;
    else if (hasA) ball.dx = -ball.speed;
    else if (hasD) ball.dx = ball.speed;
    else ball.dx *= ball.friction;

    if (hasS && ball.isGameRunning && ball.dy < 15) {
        ball.dy += 0.5 * ball.strength;
        ball.isJumping = false;
    }
}

// Fire if the fire button is held and the cooldown has elapsed (logical clock).
export function tryShoot(ball, input, currentTime) {
    if (!input.shooting || !ball.isGameRunning) return;
    const profile = shotProfile(ball);
    if (currentTime - ball.lastShotTime < profile.cooldownMs) return;
    if (ball.currentStock <= 0) {
        ball.currentStock = ball.maxStock;
        return;
    }

    const nextRadius = removeArea(ball.radius, profile.areaCost);
    if (nextRadius < H / 40) return;
    ball.lastShotTime = currentTime;
    ball.currentStock--;
    ball.radius = nextRadius;
    const speed = ball.projSpeed;
    ball.projectiles.push({
        id: `${ball.id}-${++ball.projSeq}`,
        x: ball.x + (ball.radius * 1.7 * Math.cos(ball.angle)) / 2,
        y: ball.y + (ball.radius * 1.7 * Math.sin(ball.angle)) / 2,
        radius: profile.projectileRadius,
        dx: speed * Math.cos(ball.angle),
        dy: speed * Math.sin(ball.angle),
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
