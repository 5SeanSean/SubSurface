import test from 'node:test';
import assert from 'node:assert/strict';
import { LavaSquare } from './lavaSquareEnemies.js';
import { worldBounds } from './view.js';

test('lava squares keep a short stub until a nearby player triggers the triangle', () => {
    const enemy = new LavaSquare(0, 0, 60, 1, worldBounds, null, 0);
    const ball = { x: 1000, y: 30, radius: 60, dx: 0, dy: 0, xPhysics: 0, yPhysics: 0, score: 0 };

    enemy.aimAt(ball);
    const distantLength = enemy.armLength;
    const fixedMouth = enemy.mouthWidth;
    assert.equal(fixedMouth, enemy.size / 6);
    assert.equal(enemy.targetRadius, fixedMouth / 2);
    assert.equal(distantLength, enemy.size);
    assert.equal(enemy.sucking, false);
    enemy.eat(ball);
    assert.equal(ball.radius, 60);

    ball.x = 220;
    enemy.aimAt(ball);
    assert.ok(enemy.armLength > distantLength);
    assert.equal(enemy.armLength, 220 - enemy.size / 2 - ball.radius);
    assert.equal(enemy.mouthWidth, fixedMouth);
    assert.equal(enemy.targetRadius, ball.radius);
    const initialRadius = ball.radius;
    enemy.eat(ball);
    const firstBite = initialRadius - ball.radius;

    for (let i = 0; i < 1000; i++) {
        enemy.aimAt(ball);
        enemy.eat(ball);
    }
    enemy.aimAt(ball);
    const beforeLaterBite = ball.radius;
    enemy.eat(ball);

    assert.ok(enemy.sucking);
    assert.ok(firstBite > 0);
    assert.ok(beforeLaterBite - ball.radius > firstBite);
    assert.equal('projectiles' in enemy, false);
});
