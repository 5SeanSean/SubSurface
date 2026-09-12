import test from 'node:test';
import assert from 'node:assert/strict';
import { createBall } from './ball.js';
import { resolveBallOnArm } from './playerGeometry.js';

const bounds = { left: 0, right: 2000, bottom: 2000 };

function pair() {
    const owner = createBall(1, bounds);
    owner.x = 500; owner.y = 500; owner.radius = 60;
    owner.currentStock = owner.maxStock;
    owner.angle = 0;
    const rider = createBall(2, bounds);
    rider.radius = 30;
    return { owner, rider };
}

test('a falling player can land and stand on top of another player arm', () => {
    const { owner, rider } = pair();
    rider.x = 600; rider.y = 470; rider.dy = 4;
    const previous = { x: rider.x, y: 455 };

    assert.equal(resolveBallOnArm(rider, owner, previous), true);
    assert.equal(rider.dy, 0);
    assert.equal(rider.isJumping, false);
    assert.equal(rider.canDoubleJump, true);
    assert.ok(rider.y < 470, 'landing should separate the rider upward from the arm');
});

test('an arm does not pin players touching its side or underside', () => {
    const { owner, rider } = pair();
    rider.x = 600; rider.y = 530; rider.dy = -2;
    const before = { x: rider.x, y: rider.y, dy: rider.dy };

    assert.equal(resolveBallOnArm(rider, owner, { x: 600, y: 545 }), false);
    assert.deepEqual({ x: rider.x, y: rider.y, dy: rider.dy }, before);
});

test('deep overlap is not captured as a standing contact', () => {
    const { owner, rider } = pair();
    rider.x = 600; rider.y = 490; rider.dy = 1;
    const before = { x: rider.x, y: rider.y, dy: rider.dy };

    assert.equal(resolveBallOnArm(rider, owner, { x: 600, y: 490 }), false);
    assert.deepEqual({ x: rider.x, y: rider.y, dy: rider.dy }, before);
});
