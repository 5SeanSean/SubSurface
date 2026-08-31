import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPlatforms, PLATFORM_MAX_HITS } from './platforms.js';
import { stepProjectiles } from './sim/ball.js';
import { worldBounds } from './view.js';

function isolatedPlatform(seed = 7001) {
    const system = setupPlatforms(null, worldBounds, seed);
    const platform = system.platforms.find(p => p.index >= 0);
    for (const other of [...system.platforms]) {
        if (other !== platform) system.removePlatform(other);
    }
    return { system, platform };
}

test('a platform retires atomically from the list and collision grid', () => {
    const { system, platform } = isolatedPlatform();
    for (let i = 0; i < PLATFORM_MAX_HITS; i++) platform.hitPlatform(1);

    assert.equal(system.platforms.includes(platform), false);
    assert.equal(
        system.getNearbyPlatforms(platform.x, platform.y, platform.width, platform.height).includes(platform),
        false
    );
    assert.deepEqual(system.damage(), [[platform.index, PLATFORM_MAX_HITS]]);
});

test('swept collision catches a ball that crosses a whole platform in one tick', () => {
    const { system, platform } = isolatedPlatform(7002);
    const radius = 12;
    const previous = { x: platform.x + platform.width / 2, y: platform.y - radius - 120 };
    const ball = {
        ...previous,
        y: platform.y + platform.height + radius + 120,
        radius, dx: 0, dy: 260, strength: 1,
        canDoubleJump: false, isJumping: true, isGameRunning: true
    };

    system.checkBallPlatforms(ball, previous);

    assert.ok(ball.y <= platform.y - radius + 0.1, 'ball tunneled through the platform');
    assert.ok(ball.dy < 0, 'swept impact did not bounce the ball');
});

test('damage sync is monotonic under duplicate and stale snapshots', () => {
    const system = setupPlatforms(null, worldBounds, 7003);
    const platform = system.platforms.find(p => p.index >= 0);

    system.applySync([[platform.index, 2]], []);
    system.applySync([[platform.index, 1]], []);
    assert.equal(platform.hits, 2);

    system.applySync([[platform.index, PLATFORM_MAX_HITS]], []);
    system.applySync([[platform.index, 1]], []);
    assert.equal(system.platforms.some(p => p.index === platform.index), false);
});

test('runtime platform sync preserves identity and updates geometry in place', () => {
    const server = setupPlatforms(null, worldBounds, 7004);
    const client = setupPlatforms(null, worldBounds, 7004);
    const runtime = server.addPlatform(100, 200, 300, 40);

    client.applySync(server.damage(), server.extras());
    const first = client.platforms.find(p => p.id === runtime.id);
    client.applySync(server.damage(), server.extras());
    assert.equal(client.platforms.find(p => p.id === runtime.id), first);

    runtime.x = 160;
    runtime.width = 360;
    client.applySync(server.damage(), server.extras());
    assert.equal(first.x, 160);
    assert.equal(first.width, 360);
});

test('one projectile damages a seeded platform at most once', () => {
    const { system, platform } = isolatedPlatform(7005);
    const projectile = {
        id: 'shot', x: platform.x + platform.width / 2,
        y: platform.y - 1, radius: 8, dx: 0, dy: 2, ricochetCount: 0
    };
    const ball = { x: projectile.x, projectiles: [projectile] };

    stepProjectiles(ball, system, worldBounds);
    assert.equal(platform.hits, 1);

    projectile.x = platform.x + platform.width / 2;
    projectile.y = platform.y - 1;
    projectile.dy = 2;
    stepProjectiles(ball, system, worldBounds);
    assert.equal(platform.hits, 1);
});

test('a fast projectile cannot tunnel through a thin platform', () => {
    const { system, platform } = isolatedPlatform(7006);
    const projectile = {
        id: 'fast-shot', x: platform.x + platform.width / 2,
        y: platform.y - 100, radius: 4, dx: 0, dy: 220, ricochetCount: 0
    };
    const ball = { x: projectile.x, projectiles: [projectile] };

    stepProjectiles(ball, system, worldBounds);

    assert.equal(platform.hits, 1);
    assert.ok(projectile.dy < 0, 'projectile crossed the platform without ricocheting');
    assert.ok(projectile.y <= platform.y - projectile.radius + 0.1);
});
