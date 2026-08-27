// Headless ball (player) simulation — no canvas, no DOM, no rendering.
// This is the active simulation for multiplayer and single-player; the browser only
// renders authoritative snapshots.
import { GAME_CONFIG } from '../config.js';
import { physics } from '../physics.js';

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
        lastShotTime: 0,
        dead: false
    };
}

// input: { keys:Set<string>, shooting:bool, jump:bool (edge), aim:number (radians) }
export function stepBall(ball, input, worldBounds) {
    ball.angle = input.aim ?? ball.angle;

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
    if (currentTime - ball.lastShotTime < ball.fireRate) return;
    if (ball.currentStock <= 0) {
        ball.currentStock = ball.maxStock;
        return;
    }

    ball.lastShotTime = currentTime;
    ball.currentStock--;
    ball.radius -= ball.radius / 1000;
    const speed = ball.projSpeed;
    ball.projectiles.push({
        x: ball.x + (ball.radius * 1.7 * Math.cos(ball.angle)) / 2,
        y: ball.y + (ball.radius * 1.7 * Math.sin(ball.angle)) / 2,
        radius: ball.radius / 6,
        dx: speed * Math.cos(ball.angle),
        dy: speed * Math.sin(ball.angle),
        ricochetCount: 0,
        ownerId: ball.id
    });
}

// Advance this ball's projectiles: gravity, ricochet off nearby platforms, despawn.
// platformsObj must expose getNearbyPlatforms(x, y, w, h).
export function stepProjectiles(ball, platformsObj, worldBounds) {
    for (let i = ball.projectiles.length - 1; i >= 0; i--) {
        const p = ball.projectiles[i];
        p.x += p.dx;
        p.y += p.dy;
        p.dy += 0.05;

        const platforms = platformsObj.getNearbyPlatforms(p.x, p.y, p.radius * 2, p.radius * 2);
        for (const platform of platforms) {
            if (p.x + p.radius > platform.x && p.x - p.radius < platform.x + platform.width &&
                p.y + p.radius > platform.y && p.y - p.radius < platform.y + platform.height) {
                if (p.y - p.radius < platform.y || p.y + p.radius > platform.y + platform.height) {
                    p.dy = -p.dy;
                    p.ricochetCount++;
                }
                if (p.x - p.radius < platform.x || p.x + p.radius > platform.x + platform.width) {
                    p.dx = -p.dx;
                    p.ricochetCount++;
                }
                break;
            }
        }

        if (p.x < ball.x - GAME_CONFIG.REF_WIDTH || p.x > ball.x + GAME_CONFIG.REF_WIDTH ||
            p.y < 0 || p.y > worldBounds.bottom || p.ricochetCount >= 3) {
            ball.projectiles.splice(i, 1);
        }
    }
}
