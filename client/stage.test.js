import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCoverViewport } from './viewport.js';

for (const [name, width, height] of [
    ['ultrawide', 2560, 1080],
    ['portrait', 900, 1600],
    ['standard', 1920, 1080]
]) {
    test(`cover viewport fills a ${name} window without letterboxing`, () => {
        const viewport = calculateCoverViewport(width, height, 1920, 1080);
        assert.ok(viewport.left <= 0 && viewport.top <= 0);
        assert.ok(viewport.left + viewport.width >= width);
        assert.ok(viewport.top + viewport.height >= height);
        assert.ok(viewport.visible.x >= 0 && viewport.visible.y >= 0);
        assert.ok(viewport.visible.x + viewport.visible.w <= 1920 + 1e-9);
        assert.ok(viewport.visible.y + viewport.visible.h <= 1080 + 1e-9);
    });
}
