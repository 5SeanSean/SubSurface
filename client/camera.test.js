import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, centroid } from './camera.js';
import { GAME_CONFIG } from '../config.js';

const canvas = { width: 1280, height: 720 };
const centred = p => ({ x: p.x - canvas.width / 2, y: p.y - canvas.height / 2 });

test('centroid averages points and handles the empty case', () => {
    assert.equal(centroid([]), null);
    assert.deepEqual(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }]), { x: 5, y: 10 });
});

test('snap jumps to the target, then easing approaches it without overshooting', () => {
    const cam = createCamera(canvas);
    const target = { x: 3000, y: 2000 };
    cam.setTarget(() => target, { snap: true });

    cam.update(16);
    assert.deepEqual({ x: cam.pos.x, y: cam.pos.y }, centred(target), 'snap did not land exactly on the target');

    // Move the target; the camera should ease toward it, never past it.
    target.x = 4000;
    const want = centred(target).x;
    let prev = cam.pos.x;
    for (let i = 0; i < 200; i++) {
        cam.update(16);
        assert.ok(cam.pos.x >= prev - 1e-9, 'camera moved backwards while easing');
        assert.ok(cam.pos.x <= want + 1e-9, 'camera overshot the target');
        prev = cam.pos.x;
    }
    assert.ok(Math.abs(cam.pos.x - want) < 1, 'camera never converged on the target');
});

test('the camera stays inside the world bounds', () => {
    const cam = createCamera(canvas);
    cam.setTarget(() => ({ x: -99999, y: -99999 }), { snap: true });
    cam.update(16);
    assert.deepEqual({ x: cam.pos.x, y: cam.pos.y }, { x: 0, y: 0 }, 'camera escaped past the top-left');

    cam.setTarget(() => ({ x: 99999, y: 99999 }), { snap: true });
    cam.update(16);
    assert.deepEqual({ x: cam.pos.x, y: cam.pos.y }, {
        x: GAME_CONFIG.WORLD_WIDTH - canvas.width,
        y: GAME_CONFIG.WORLD_HEIGHT - canvas.height
    }, 'camera escaped past the bottom-right');
});

test('a scripted move runs to completion, fires its callback, then hands back to the target', () => {
    const cam = createCamera(canvas);
    cam.setTarget(() => ({ x: 1000, y: 1000 }), { snap: true });
    cam.update(16);
    const start = { ...cam.pos };

    let done = false;
    cam.moveTo({ x: 3000, y: 2500 }, 500, () => { done = true; });
    assert.equal(cam.moving, true);

    cam.update(250);
    assert.ok(cam.pos.x > start.x && cam.pos.x < centred({ x: 3000, y: 2500 }).x, 'move did not travel partway');
    assert.equal(done, false, 'callback fired early');

    cam.update(250);
    assert.equal(done, true, 'callback never fired');
    assert.equal(cam.moving, false, 'move did not finish');
    assert.deepEqual({ x: cam.pos.x, y: cam.pos.y }, centred({ x: 3000, y: 2500 }), 'move did not land on its destination');

    // Control returns to the standing target afterwards.
    cam.update(16);
    assert.ok(cam.pos.x < centred({ x: 3000, y: 2500 }).x, 'camera did not resume following its target');
});
