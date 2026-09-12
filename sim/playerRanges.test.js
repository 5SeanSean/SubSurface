import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_CONFIG } from '../config.js';
import { createBall, stepBall, tryShoot } from './ball.js';
import { createWorld } from './world.js';
import { SHOT_RANGE, sampleRange, shotProfile } from './playerRanges.js';

const bounds = { left: 0, right: GAME_CONFIG.WORLD_WIDTH, bottom: GAME_CONFIG.WORLD_HEIGHT };
const input = keys => ({ keys: new Set(keys), shooting: false, jump: false, aim: 0 });

test('shot range is white at center and reaches 50/50 purple and green at its ends', () => {
    assert.equal(sampleRange(SHOT_RANGE, 0).color, 'rgb(255, 255, 255)');
    assert.equal(sampleRange(SHOT_RANGE, -1).color, 'rgb(192, 128, 192)');
    assert.equal(sampleRange(SHOT_RANGE, 1).color, 'rgb(128, 255, 128)');
});

test('Q widens toward green, E contracts toward purple, and the range clamps', () => {
    const ball = createBall(1, bounds);
    stepBall(ball, input(['q']), bounds, 2000);
    assert.equal(ball.shotRange, 1);
    const green = shotProfile(ball);

    stepBall(ball, input(['e']), bounds, 1250);
    assert.equal(ball.shotRange, 0);
    const neutral = shotProfile(ball);

    stepBall(ball, input(['e']), bounds, 2000);
    assert.equal(ball.shotRange, -1);
    const purple = shotProfile(ball);

    assert.ok(green.scale > neutral.scale && neutral.scale > purple.scale);
    assert.ok(green.projectileRadius > neutral.projectileRadius);
    assert.ok(neutral.projectileRadius > purple.projectileRadius);
    assert.ok(green.playerDamage > neutral.playerDamage);
    assert.ok(neutral.playerDamage > purple.playerDamage);
});

test('a projectile costs the shooter 50% more area than it carries as damage', () => {
    const ball = createBall(1, bounds);
    ball.shotRange = 1;
    const before = ball.radius;
    tryShoot(ball, { ...input([]), shooting: true }, 1000);

    assert.equal(ball.projectiles.length, 1);
    const shot = ball.projectiles[0];
    const spentArea = before * before - ball.radius * ball.radius;
    assert.ok(Math.abs(spentArea - shot.radius * shot.radius * 1.5) < 1e-9);
    assert.equal(shot.damage, shot.radius * shot.radius);
    assert.equal(shot.shotRange, 1);
});

test('compact shots fire faster and wide shots fire slower', () => {
    const compact = createBall(1, bounds);
    compact.shotRange = -1;
    tryShoot(compact, { ...input([]), shooting: true }, 120);
    assert.equal(compact.projectiles.length, 1, 'compact shot should be ready after 120ms');

    const wide = createBall(2, bounds);
    wide.shotRange = 1;
    tryShoot(wide, { ...input([]), shooting: true }, 120);
    assert.equal(wide.projectiles.length, 0, 'wide shot should still be cooling down at 120ms');
    tryShoot(wide, { ...input([]), shooting: true }, 300);
    assert.equal(wide.projectiles.length, 1, 'wide shot should be ready after 300ms');
});

test('horizontal recoil is softer while vertical thrust keeps full strength', () => {
    const shot = aim => {
        const b = createBall(10, bounds);
        b.aimAngle = aim;
        tryShoot(b, { ...input([]), shooting: true }, 1000);
        return Math.hypot(b.dx, b.dy);
    };
    const down = shot(Math.PI / 2);            // straight down (space thruster)
    const slightlyOff = shot(Math.PI / 2 - 0.35);  // ~20° off
    const sideways = shot(0);

    assert.ok(sideways < down * 0.65, 'sideways recoil was not reduced enough');
    assert.ok(sideways < slightlyOff && slightlyOff < down, 'angled recoil did not blend smoothly');
});

test('stacked shots cannot exceed the player speed cap', () => {
    const b = createBall(13, bounds);
    b.aimAngle = Math.PI / 2;
    for (let i = 1; i <= 5; i++)
        tryShoot(b, { ...input([]), shooting: true }, i * 1000, { consumeSize: false });
    assert.ok(Math.hypot(b.dx, b.dy) <= GAME_CONFIG.PLAYER_MAX_SPEED + 1e-9);
});

test('holding S dashes you down by shooting straight up', () => {
    const b = createBall(20, bounds);
    b.isGameRunning = true;
    stepBall(b, { keys: new Set(['s']), shooting: false, jump: false, aim: 0, aimMoved: false }, GAME_CONFIG.TICK_DURATION);
    assert.ok(Math.abs(b.aimAngle + Math.PI / 2) < 1e-9, 'S did not aim straight up');
    tryShoot(b, { keys: new Set(['s']), shooting: false }, 1000);
    assert.ok(b.dy > 0, 'S dash did not push the body downward');
    assert.equal(b.projectiles.length, 1, 'S did not auto-fire');
});

test('W works exactly like Space for upward thrust', () => {
    const launch = key => {
        const b = createBall(key === 'w' ? 21 : 22, bounds);
        const controls = { keys: new Set([key]), shooting: false, jump: false, aim: 0, aimMoved: false };
        stepBall(b, controls, bounds, GAME_CONFIG.TICK_DURATION);
        tryShoot(b, controls, 1000);
        return b;
    };
    const w = launch('w'), space = launch(' ');
    assert.equal(w.aimAngle, Math.PI / 2);
    assert.ok(Math.abs(w.dx - space.dx) < 1e-9);
    assert.ok(Math.abs(w.dy - space.dy) < 1e-9);
    assert.equal(w.projectiles.length, 1);
});

test('walking does not slow recoil momentum in the same direction', () => {
    const b = createBall(30, bounds);
    b.isGameRunning = true;
    b.aimAngle = 0;            // shoot right → recoil left
    b.isJumping = true;        // airborne: no ground friction
    tryShoot(b, { ...input([]), shooting: true }, 1000);
    const recoilLeft = b.dx;
    assert.ok(recoilLeft < -b.speed, 'recoil should exceed walk speed');

    // Holding A (left) must keep the faster recoil speed, not clamp it down to the walk speed.
    stepBall(b, { keys: new Set(['a']), shooting: false, jump: false, aim: 0, aimMoved: false }, GAME_CONFIG.TICK_DURATION);
    assert.ok(b.dx <= recoilLeft + 1e-9, 'walking toward the recoil slowed the body down');
});

test('you can shoot yourself to death — no minimum-size blocker', () => {
    const b = createBall(31, bounds);
    b.isGameRunning = true;
    b.radius = GAME_CONFIG.REF_HEIGHT / 38;   // just above the death size
    let t = 0;
    while (!b.dead && t < 50) {
        tryShoot(b, { ...input([]), shooting: true }, ++t * 1000);
        stepBall(b, { ...input([]) }, bounds, GAME_CONFIG.TICK_DURATION);
    }
    assert.ok(b.dead, 'shooting past the death size did not kill the player');
});

test('recoil propulsion is disabled in the lobby (locked arm)', () => {
    const ball = createBall(12, bounds);
    ball.armMode = 'locked';   // how lobby players are flagged
    ball.aimAngle = Math.PI / 2;
    tryShoot(ball, { ...input([]), shooting: true }, 1000);
    assert.equal(ball.dx, 0, 'lobby shot applied horizontal recoil');
    assert.equal(ball.dy, 0, 'lobby shot applied vertical recoil');
    assert.equal(ball.projectiles.length, 1, 'lobby shot should still fire a projectile');
});

test('PvP removes the same projectile area from the player it hits', () => {
    const world = createWorld({ mode: 'pvp', seed: 7 });
    world.addPlayer(1);
    world.addPlayer(2);
    const owner = world.players.get(1).ball;
    const target = world.players.get(2).ball;
    const before = target.radius;
    owner.projectiles.push({
        id: 'test-shot',
        x: target.x,
        y: target.y,
        radius: 10,
        dx: 0,
        dy: 0,
        ricochetCount: 0,
        ownerId: 1,
        damage: 100,
        enemyDamage: 0.25,
        shotRange: 0
    });

    world.tick(GAME_CONFIG.TICK_DURATION);
    assert.ok(Math.abs((before * before - target.radius * target.radius) - 100) < 1e-9);
    assert.equal(owner.projectiles.length, 0);
});
