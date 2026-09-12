import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLavaPattern, createLavaPattern } from './lava.js';
import { mulberry32 } from './sim/rng.js';

test('seeded lava patterns reproduce randomized flow directions', () => {
    const options = { minSpeed: 0.0014, maxSpeed: 0.0042, randomDirections: true };
    const a = createLavaPattern(20, mulberry32(123), options);
    const b = createLavaPattern(20, mulberry32(123), options);
    const c = createLavaPattern(20, mulberry32(124), options);

    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.ok(a.some(cell => cell.dx < 0));
    assert.ok(a.some(cell => cell.dx > 0));
    assert.ok(a.some(cell => Math.abs(cell.dy) > 0.001));

    const before = a.map(({ x, y }) => ({ x, y }));
    advanceLavaPattern(a, 16);
    assert.ok(a.some((cell, i) => cell.x !== before[i].x && cell.y !== before[i].y));
});
