import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotBuffer } from './interpolate.js';

const snap = players => ({ players, enemies: [], consumables: [], lavaY: 0 });
const feed = (buf, pairs) => pairs.forEach(([t, s]) => buf.push(s, t));

test('blends between the two snapshots bracketing the delayed render clock', () => {
    const buf = createSnapshotBuffer({ delayMs: 100 });
    feed(buf, [
        [1000, snap([{ id: 1, x: 0, y: 0 }])],
        [1100, snap([{ id: 1, x: 100, y: 200 }])]
    ]);
    // now=1200 -> render clock 1100... take the midpoint instead: now=1150 -> target 1050.
    const mid = buf.sample(1150).players[0];
    assert.equal(mid.x, 50, 'x not halfway between snapshots');
    assert.equal(mid.y, 100, 'y not halfway between snapshots');
});

test('a jump is smoothed instead of teleporting a whole snapshot at once', () => {
    const buf = createSnapshotBuffer({ delayMs: 33 });
    // 30Hz snapshots of a ball rising 43px per snapshot, as measured live.
    for (let i = 0; i <= 3; i++) buf.push(snap([{ id: 1, x: 0, y: 500 - i * 43 }]), 1000 + i * 33);
    // Sample at 60fps across one snapshot interval; every step must be a partial move.
    const ys = [];
    for (let t = 1066; t <= 1099; t += 16) ys.push(buf.sample(t).players[0].y);
    const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
    assert.ok(steps.length > 0, 'no samples taken');
    assert.ok(Math.max(...steps) < 43, `still stepping a full snapshot at once: ${steps}`);
});

test('aim takes the short way round the circle', () => {
    const buf = createSnapshotBuffer({ delayMs: 0 });
    feed(buf, [
        [0, snap([{ id: 1, x: 0, y: 0, angle: 0.1 }])],
        [100, snap([{ id: 1, x: 0, y: 0, angle: Math.PI * 2 - 0.1 }])]
    ]);
    const a = buf.sample(50).players[0].angle;
    // Halfway between 0.1 and -0.1 (i.e. ~0), NOT halfway through a full spin (~pi).
    assert.ok(Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.05, `angle spun the long way: ${a}`);
});

test('a respawn cuts instead of gliding the ball across the arena', () => {
    const buf = createSnapshotBuffer({ delayMs: 0, teleport: 400 });
    feed(buf, [
        [0, snap([{ id: 1, x: 0, y: 3000 }])],
        [100, snap([{ id: 1, x: 2000, y: 60 }])]      // died and respawned at the top
    ]);
    assert.deepEqual(
        { x: buf.sample(50).players[0].x, y: buf.sample(50).players[0].y },
        { x: 2000, y: 60 },
        'interpolated through a respawn instead of cutting'
    );
});

test('holds the newest snapshot when starved rather than extrapolating', () => {
    const buf = createSnapshotBuffer({ delayMs: 50 });
    feed(buf, [[0, snap([{ id: 1, x: 0, y: 0 }])], [100, snap([{ id: 1, x: 100, y: 0 }])]]);
    assert.equal(buf.sample(5000).players[0].x, 100, 'extrapolated past the last known position');
});

test('players who appear mid-interval are shown, not dropped', () => {
    const buf = createSnapshotBuffer({ delayMs: 0 });
    feed(buf, [
        [0, snap([{ id: 1, x: 0, y: 0 }])],
        [100, snap([{ id: 1, x: 10, y: 0 }, { id: 2, x: 900, y: 50 }])]
    ]);
    const players = buf.sample(50).players;
    assert.equal(players.length, 2, 'a newly joined player was dropped');
    assert.deepEqual({ x: players[1].x, y: players[1].y }, { x: 900, y: 50 });
});

test('projectiles are interpolated too — they fly further per snapshot than players do', () => {
    const buf = createSnapshotBuffer({ delayMs: 0 });
    const withShot = (px, py) => ({
        players: [{ id: 1, x: 0, y: 0, projectiles: [{ id: '1-7', x: px, y: py, radius: 5 }] }],
        enemies: [], consumables: [], lavaY: 0
    });
    feed(buf, [[0, withShot(0, 0)], [100, withShot(86, 40)]]);
    const shot = buf.sample(50).players[0].projectiles[0];
    assert.equal(shot.x, 43, 'projectile did not interpolate');
    assert.equal(shot.y, 20);
});
