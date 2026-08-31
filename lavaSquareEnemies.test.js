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
