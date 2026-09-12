import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerlin2D } from './perlin.js';

test('Perlin fields are deterministic per seed and vary between seeds', () => {
    const a = createPerlin2D(1234);
    const b = createPerlin2D(1234);
    const c = createPerlin2D(5678);
    const samplesA = Array.from({ length: 20 }, (_, i) => a(i * 0.173, i * -0.291));
    const samplesB = Array.from({ length: 20 }, (_, i) => b(i * 0.173, i * -0.291));
    const samplesC = Array.from({ length: 20 }, (_, i) => c(i * 0.173, i * -0.291));
    assert.deepEqual(samplesA, samplesB);
    assert.notDeepEqual(samplesA, samplesC);
    assert.ok(samplesA.every(value => value >= -1 && value <= 1));
});
