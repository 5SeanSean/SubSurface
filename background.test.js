import test from 'node:test';
import assert from 'node:assert/strict';
import { Background } from './background.js';
import { worldBounds } from './view.js';
import { mulberry32 } from './sim/rng.js';

const canvas = () => ({ width: 1280, height: 720, getContext: () => ({}) });

test('seeded background geology reproduces rocks, dirt texture, and cracks', () => {
    const a = new Background(canvas(), worldBounds, 8080);
    const b = new Background(canvas(), worldBounds, 8080);
    const c = new Background(canvas(), worldBounds, 8081);
    assert.deepEqual(a.rocks, b.rocks);
    assert.deepEqual(a.streaks, b.streaks);
    assert.deepEqual(a.grains, b.grains);
    assert.deepEqual(a.dirtCracks, b.dirtCracks);
    assert.notDeepEqual(a.rocks, c.rocks);
    assert.notDeepEqual(a.dirtCracks, c.dirtCracks);
    assert.notDeepEqual(a.grains, c.grains);
});

test('dirt generation does not perturb the independent rock stream', () => {
    const background = new Background(canvas(), worldBounds, 4242);
    const rocks = structuredClone(background.rocks);
    background.generateStreaks();
    background.rocks.length = 0;
    background.rockRng = mulberry32((4242 ^ 0xBAC6B00C) >>> 0);
    background.rockTextureRng = mulberry32((4242 ^ 0x7E87A11D) >>> 0);
    background.generateRocks();
    assert.deepEqual(background.rocks, rocks);
});
