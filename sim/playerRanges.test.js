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
