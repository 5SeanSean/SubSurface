import test from 'node:test';
import assert from 'node:assert/strict';
import { LavaSquare } from './lavaSquareEnemies.js';
import { worldBounds } from './view.js';

test('lava squares have no stick or suction mechanics', () => {
    const enemy = new LavaSquare(0, 0, 60, 1, worldBounds, null, 0);
    for (const field of ['stickColor', 'armLength', 'mouthWidth', 'targetRadius', 'sucking', 'suctionStrength']) {
        assert.equal(field in enemy, false);
    }
    assert.equal(typeof enemy.aimAt, 'undefined');
    assert.equal(typeof enemy.eat, 'undefined');
});

test('lava squares have lower health and retarget the player that shoots them', () => {
    const enemy = new LavaSquare(100, 100, 60, 2, worldBounds, null, Math.PI);
    const ball = {
        x: 300, y: 130, score: 0,
        projectiles: [{ x: 130, y: 130, radius: 5, dx: -10, dy: 0, enemyDamage: 0.25 }]
    };

    assert.equal(enemy.health, 1);
    enemy.checkProjectileCollisions(ball);

    assert.equal(ball.projectiles.length, 0);
    assert.ok(Math.abs(enemy.angle) < 1e-9, 'enemy did not turn toward the shooter');
    assert.ok(enemy.dx > 0, 'enemy did not resume movement toward the shooter');
});

test('two squares meeting head-on vertically separate instead of sticking', () => {
    // dx≈0 on both, so the old sign(dx)-based bounce produced zero horizontal push; the
    // normal-based bounce must still drive them apart along the contact axis.
    const top = new LavaSquare(100, 100, 40, 1, worldBounds, null, Math.PI / 2);   // heading down
    const bottom = new LavaSquare(100, 130, 40, 1, worldBounds, null, -Math.PI / 2); // heading up
    top.dx = 0; bottom.dx = 0;
    top.checkLavaSquareCollisions([bottom], [top, bottom]);
    assert.ok(top.dy < 0, 'top square did not bounce upward off the contact normal');
    assert.ok(top.y + top.size <= bottom.y + 1e-6, 'overlapping squares were not separated');
});

test('a fast player eats a lava square from any impact direction', () => {
    for (const [label, dx, dy] of [
        ['right', 12, 0], ['left', -12, 0], ['down', 0, 12], ['up', 0, -12],
        ['diagonal', 9, -9]
    ]) {
        const enemy = new LavaSquare(100, 100, 40, 0, worldBounds, null, 0);
        enemy.dx = enemy.dy = 0;
        const enemies = [enemy], consumables = [];
        const ball = { x: 120, y: 120, radius: 40, dx, dy, xPhysics: 0, yPhysics: 0, score: 0 };

        enemy.checkPlayerCollision(ball, consumables, enemies);

        assert.equal(enemies.length, 0, `${label} impact did not eat the enemy`);
        assert.equal(consumables.length, 1, `${label} impact did not drop a consumable`);
    }
});

test('a moderate upward speed is enough to eat an enemy', () => {
    // Thrusting up at recoil speed should eat, not bounce — eating is direction-agnostic.
    const enemy = new LavaSquare(100, 100, 50, 0, worldBounds, null, 0);
    enemy.dx = enemy.dy = 0;
    const enemies = [enemy], consumables = [];
    const ball = { id: 1, x: 125, y: 125, radius: 45, dx: 0, dy: -6, xPhysics: 0, yPhysics: 0, score: 0 };

    enemy.checkPlayerCollision(ball, consumables, enemies);

    assert.equal(enemies.length, 0, 'moderate upward speed failed to eat the enemy');
    assert.equal(consumables.length, 1);
});

test('a slow player still bounces instead of eating the enemy', () => {
    const enemy = new LavaSquare(100, 100, 40, 0, worldBounds, null, 0);
    const enemies = [enemy], consumables = [];
    const ball = { x: 120, y: 120, radius: 40, dx: 2, dy: 2, xPhysics: 0, yPhysics: 0, score: 0 };

    enemy.checkPlayerCollision(ball, consumables, enemies);

    assert.equal(enemies.length, 1);
    assert.equal(consumables.length, 0);
    assert.ok(ball.radius < 40, 'failed eat did not damage the player');
    assert.ok(enemy.hitCount > 0, 'failed eat did not damage/whiten the enemy');
    assert.ok(enemy.size > 40, 'damaged enemy did not grow');
    const enemyCenterX = enemy.x + enemy.size / 2;
    assert.ok((ball.dx || ball.dy) && (enemy.dx || enemy.dy), 'collision did not bounce both bodies');
    assert.ok((ball.x - enemyCenterX) * (ball.dx - enemy.dx) >= 0,
        'bodies did not move apart after collision');
});

test('speed alone cannot eat an enemy when the player is too small', () => {
    const enemy = new LavaSquare(100, 100, 50, 0, worldBounds, null, 0);
    const enemies = [enemy], consumables = [];
    const ball = { id: 9, x: 125, y: 125, radius: 20, speed: 4,
        dx: 30, dy: 0, xPhysics: 0, yPhysics: 0, score: 0 };

    enemy.checkPlayerCollision(ball, consumables, enemies);

    assert.equal(enemies.length, 1);
    assert.equal(consumables.length, 0);
    assert.ok(enemy.hitCount > 0);
    assert.ok(ball.radius < 20);
});
