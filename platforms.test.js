import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPlatforms, PLATFORM_MAX_HITS } from './platforms.js';
import { createBall, stepBall, stepProjectiles, tryShoot } from './sim/ball.js';
import { worldBounds } from './view.js';
import { pointOverPlayer, playerArm } from './sim/playerGeometry.js';

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

test('a player embedded in a platform is ejected by an upward impulse (recoil)', () => {
    const { system, platform } = isolatedPlatform(7007);
    const ball = createBall(1, worldBounds);
    ball.x = platform.x + platform.width / 2;
    ball.y = platform.y + Math.min(platform.height / 2, ball.radius / 2);
    ball.isJumping = false;
    ball.dy = -8;   // recoil-style upward impulse (was a jump)
    const upward = ball.dy;
    const previous = { x: ball.x, y: ball.y, angle: ball.angle };

    system.checkBallPlatforms(ball, previous);

    assert.ok(ball.y + ball.radius < platform.y, 'the upward impulse did not eject the player above the platform');
    assert.equal(ball.dy, upward, 'platform contact cancelled the upward impulse');
    assert.equal(ball.isJumping, true);
});

test('the reticle treats the gun arm as part of the player', () => {
    const player = { x: 100, y: 100, radius: 20, angle: 0,
        currentStock: 10, maxStock: 10, shotRange: 0 };
    const arm = playerArm(player);
    assert.equal(pointOverPlayer(player, arm.x2 - 2, arm.y2), true);
    assert.equal(pointOverPlayer(player, arm.x2, arm.y2 + arm.radius + 2), false);
});

test('the gun arm stops at a platform and levers the body off it, holding or swinging', () => {
    const system = setupPlatforms(null, worldBounds, 7010);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    const platform = system.addPlatform(135, 80, 40, 40);
    const ball = { x: 100, y: 100, radius: 20, angle: -0.5,
        aimAngle: 0, previousAimAngle: -0.5, aimMoved: true,
        currentStock: 10, maxStock: 10, shotRange: 0,
        dx: 1, dy: 0, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true };
    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: ball.angle });
    assert.ok(ball.angle < -0.01, 'arm rotated through the platform');
    const stopped = playerArm(ball);
    assert.ok(stopped.x2 <= platform.x - stopped.radius + 0.1 ||
        stopped.y2 <= platform.y - stopped.radius + 0.1,
        'arm capsule remained embedded in the platform corner');
    assert.ok(ball.xPhysics < 0, 'blocked rotation did not push the body away as leverage');

    // Getting-Over-It static press: keeping the pointer pushed into the wall keeps levering,
    // in the same direction, but the accumulated impulse stays bounded (no pin, no blow-up).
    ball.previousAimAngle = ball.aimAngle;
    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: ball.angle });
    assert.ok(ball.xPhysics < 0, 'holding the pointer stopped pressing');
    assert.ok(ball.xPhysics >= -ball.speed * 4 - 1e-9, 'held press exceeded the stability cap');
});

test('passive aim changes from ball or camera movement cannot inject leverage', () => {
    const system = setupPlatforms(null, worldBounds, 7014);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(135, 80, 40, 40);
    const ball = { x: 100, y: 100, radius: 20, angle: -0.5,
        aimAngle: 0, previousAimAngle: -0.5, aimMoved: false,
        currentStock: 10, maxStock: 10, shotRange: 0,
        dx: 0, dy: -8, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true };
    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: ball.angle });
    assert.deepEqual(
        { dx: ball.dx, dy: ball.dy, xPhysics: ball.xPhysics, yPhysics: ball.yPhysics },
        { dx: 0, dy: -8, xPhysics: 0, yPhysics: 0 },
        'passive aim change altered player movement'
    );
});

test('player movement deflects the rigid arm instead of sticking the ball', () => {
    const system = setupPlatforms(null, worldBounds, 7011);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(100, 80, 12, 15);
    const ball = { x: 120, y: 120, radius: 20, angle: -1,
        aimAngle: -1, previousAimAngle: -1,
        currentStock: 10, maxStock: 10, shotRange: 0,
        dx: 70, dy: 0, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true };
    system.checkBallPlatforms(ball, { x: 60, y: 120, angle: ball.angle });
    assert.equal(ball.x, 120, 'arm contact pinned the moving player');
    assert.equal(ball.dx, 70, 'arm contact erased player velocity');
    assert.notEqual(ball.angle, -1, 'moving player carried the arm through the platform');
});

test('falling past a platform sweeps the arm aside without hanging the ball', () => {
    const system = setupPlatforms(null, worldBounds, 7013);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(125, 105, 20, 12);
    const ball = { x: 100, y: 110, radius: 20, angle: 0,
        aimAngle: 0, previousAimAngle: 0,
        currentStock: 10, maxStock: 10, shotRange: 0,
        dx: 0, dy: 10, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true };
    system.checkBallPlatforms(ball, { x: 100, y: 100, angle: 0 });
    assert.equal(ball.y, 110, 'arm contact left the ball hanging above the platform');
    assert.equal(ball.dy, 10, 'arm contact erased downward velocity');
    assert.notEqual(ball.angle, 0, 'falling player dragged the arm through the platform');
});

test('a downward arm supports its owner when it lands on a platform top', () => {
    const system = setupPlatforms(null, worldBounds, 7015);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(80, 160, 80, 20);
    const ball = { x: 120, y: 118, radius: 20, angle: Math.PI / 2,
        aimAngle: Math.PI / 2, previousAimAngle: Math.PI / 2, aimMoved: false,
        currentStock: 10, maxStock: 10, shotRange: 0, armMode: 'leverage',
        dx: 0, dy: 10, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true,
        jumpedThisTick: false };

    system.checkBallPlatforms(ball, { x: 120, y: 108, angle: ball.angle });

    assert.ok(ball.y < 118, 'arm support did not stop the falling body at contact');
    assert.equal(ball.dy, 0, 'arm support retained downward velocity');
    assert.equal(ball.angle, Math.PI / 2, 'load-bearing arm was swept away from the top face');
    assert.equal(ball.isJumping, false, 'arm support did not ground its owner');
    assert.equal(ball.canDoubleJump, true);

    const supportedY = ball.y;
    ball.jumpedThisTick = true;
    ball.dy = -8;
    system.checkBallPlatforms(ball, { x: ball.x, y: supportedY, angle: ball.angle });
    assert.equal(ball.dy, -8, 'jumping did not release arm support');
});

test('pushing the arm down plants a pivot and moves the owner along a leverage arc', () => {
    const system = setupPlatforms(null, worldBounds, 7016);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(80, 160, 80, 20);
    const startAngle = Math.PI / 3;
    const targetAngle = Math.PI / 2;
    const ball = { x: 120, y: 120, radius: 20, angle: startAngle,
        aimAngle: targetAngle, previousAimAngle: startAngle, aimMoved: true,
        currentStock: 10, maxStock: 10, shotRange: 0, armMode: 'leverage',
        dx: 0, dy: 0, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true,
        jumpedThisTick: false };

    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: startAngle });

    assert.ok(ball.y < 120, 'downward arm motion did not lift the owner');
    assert.ok(ball.x > 120, 'standing leverage did not move the owner along the arc');
    assert.equal(ball.xPhysics, 0, 'pivot motion leaked into free-body momentum');
    assert.equal(ball.angle, targetAngle, 'arm did not reach its load-bearing target angle');
    assert.equal(ball.isJumping, false);
    assert.ok(ball.armPivot, 'standing leverage did not retain its planted contact');

    const planted = { ...ball.armPivot };
    const swayTarget = Math.PI * 0.42;
    ball.aimAngle = swayTarget;
    ball.previousAimAngle = targetAngle;
    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: targetAngle });
    assert.equal(ball.angle, swayTarget);
    assert.equal(ball.armPivot.x, planted.x);
    assert.equal(ball.armPivot.y, planted.y);
    const radius = Math.hypot(ball.x - planted.x, ball.y - planted.y);
    assert.ok(Math.abs(radius - planted.distance) < 1e-6, 'mouse sway left the leverage arc');

    // Continue the arc until the body itself reaches the slab. At that point normal platform
    // support must take over and the leverage constraint must disappear.
    ball.aimAngle = Math.asin((planted.y + ball.radius - 160) / planted.distance);
    ball.dx = 2;
    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: ball.angle });
    assert.equal(ball.armPivot, null, 'body contact retained the planted arm constraint');
    assert.equal(ball.y, 160 - ball.radius, 'body contact did not settle on the platform top');
    assert.equal(ball.dx, 2, 'pivot-to-platform handoff erased horizontal movement');
});

test('looking upward releases a standing arm before it can pin the owner to the platform', () => {
    const system = setupPlatforms(null, worldBounds, 7017);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(80, 160, 80, 20);
    const ball = { x: 120, y: 117.5, radius: 20, angle: Math.PI / 2,
        aimAngle: -Math.PI / 2, previousAimAngle: Math.PI / 2, aimMoved: true,
        currentStock: 10, maxStock: 10, shotRange: 0, armMode: 'leverage',
        dx: 0, dy: 1, xPhysics: 0, yPhysics: 0, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: true, isJumping: false, isGameRunning: true,
        jumpedThisTick: false };
    const previous = { x: ball.x, y: 116.5, angle: ball.angle };

    system.checkBallPlatforms(ball, previous);

    assert.equal(ball.y, 117.5, 'retracting arm snapped the owner back onto its old support');
    assert.equal(ball.dy, 1, 'retracting arm erased the owner\'s falling velocity');
    assert.ok(Math.sin(ball.angle) < 0.2, 'arm remained trapped in its downward support pose');
});

test('locked arm mode stops at a lobby platform without moving its owner', () => {
    const system = setupPlatforms(null, worldBounds, 7012);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    system.addPlatform(135, 80, 40, 40);
    const ball = { x: 100, y: 100, radius: 20, angle: -0.5,
        aimAngle: 0, previousAimAngle: -0.5, armMode: 'locked',
        currentStock: 10, maxStock: 10, shotRange: 0,
        dx: 2, dy: 3, xPhysics: 1, yPhysics: 1, speed: 4, jumpPower: -8,
        strength: 1, canDoubleJump: false, isJumping: true, isGameRunning: true };
    const before = { x: ball.x, y: ball.y };
    system.checkBallPlatforms(ball, { ...before, angle: ball.angle });
    assert.ok(ball.angle < -0.01, 'locked arm rotated through the platform');
    assert.deepEqual({ x: ball.x, y: ball.y }, before, 'locked contact displaced the player');
    assert.deepEqual(
        { dx: ball.dx, dy: ball.dy, xPhysics: ball.xPhysics, yPhysics: ball.yPhysics },
        { dx: 0, dy: 0, xPhysics: 0, yPhysics: 0 },
        'locked contact retained player momentum'
    );
});

test('a body resting on a platform thrusts straight up by shooting downward (space)', () => {
    const system = setupPlatforms(null, worldBounds, 7018);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    const plat = system.addPlatform(800, 500, 200, 30);
    const ball = createBall(1, worldBounds);
    ball.armMode = 'leverage';
    ball.x = 900;
    ball.y = plat.y - ball.radius;   // resting exactly on the top face
    ball.dx = 0; ball.dy = 0; ball.isJumping = false; ball.canDoubleJump = true;

    const startY = ball.y;
    const input = { keys: new Set([' ']), shooting: false, jump: false, aim: 0, aimMoved: false };
    // hold space: aim snaps down, auto-fires, recoil lifts the body over a few ticks
    for (let t = 0; t < 4; t++) {
        const prev = { x: ball.x, y: ball.y, angle: ball.angle };
        stepBall(ball, input, worldBounds);
        system.checkBallPlatforms(ball, prev);
        tryShoot(ball, input, 1000 * (t + 1));   // clear the cooldown each tick
    }
    // Recoil (not a jump) lifts it, and the swept solver must not read resting contact as a
    // false underside hit that cancels the upward launch.
    assert.ok(ball.dy < 0, 'downward recoil did not produce upward velocity');
    assert.ok(ball.y < startY - 1, 'the body did not rise off the platform');
});

test('downward shooting releases a planted arm and preserves upward recoil after shrinking', () => {
    const system = setupPlatforms(null, worldBounds, 7021);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    const plat = system.addPlatform(800, 500, 200, 30);
    const ball = createBall(1, worldBounds);
    ball.x = 900;
    ball.angle = ball.aimAngle = Math.PI / 2;
    const arm = playerArm(ball);
    ball.y = plat.y - arm.radius - arm.length;
    ball.armPivot = {
        x: ball.x,
        y: plat.y - arm.radius,
        distance: arm.length,
        platformId: plat.id,
        topFace: true
    };
    ball.isJumping = false;
    const beforeShot = { x: ball.x, y: ball.y, angle: ball.angle };
    const oldRadius = ball.radius;
    const input = { keys: new Set([' ']), shooting: false, jump: false, aim: 0, aimMoved: false };

    tryShoot(ball, input, 1000);
    assert.ok(ball.radius < oldRadius, 'test shot did not shrink the player');
    assert.ok(ball.dy < 0, 'test shot did not create upward recoil');
    stepBall(ball, input, worldBounds);
    system.checkBallPlatforms(ball, beforeShot);

    assert.equal(ball.armPivot, null, 'old planted pivot swallowed recoil after the arm shrank');
    assert.ok(ball.y < beforeShot.y, 'player stayed fixed instead of rising from downward recoil');
    assert.ok(ball.dy < 0, 'pivot release erased upward recoil velocity');
});

test('a hanging pivot recalculates reach and torque from the current player size', () => {
    const system = setupPlatforms(null, worldBounds, 7022);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    const plat = system.addPlatform(800, 500, 200, 30);
    const ball = createBall(1, worldBounds);
    ball.radius = 42;
    ball.currentStock = 6;
    ball.angle = ball.aimAngle = Math.PI / 2;
    ball.armPivot = { x: 900, y: plat.y - 10, distance: 120, platformId: plat.id, topFace: true };
    ball.x = 900;
    ball.y = ball.armPivot.y - ball.armPivot.distance;
    ball.dx = ball.dy = 0;
    const expected = playerArm(ball);

    system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: ball.angle });

    assert.ok(ball.armPivot, 'valid hanging contact was unexpectedly released');
    assert.equal(ball.armPivot.distance, expected.length, 'pivot kept its stale pre-shrink reach');
    assert.ok(Math.abs(ball.armPivot.y - (plat.y - expected.radius)) < 1e-9,
        'pivot did not recalculate capsule contact height');
    assert.ok(Math.abs(Math.hypot(ball.x - ball.armPivot.x, ball.y - ball.armPivot.y) - expected.length) < 1e-9,
        'player was not repositioned to the recalculated arm reach');
});

test('walking on a platform is not hijacked by the arm bracing on a nearby surface', () => {
    const system = setupPlatforms(null, worldBounds, 7019);
    for (const existing of [...system.platforms]) system.removePlatform(existing);
    const floor = system.addPlatform(600, 500, 700, 30);
    system.addPlatform(600, 250, 700, 30);   // overhead slab the raised arm points into
    const ball = createBall(1, worldBounds);
    ball.armMode = 'leverage';
    ball.x = 900;
    ball.y = floor.y - ball.radius;
    ball.dx = 0; ball.dy = 0; ball.isJumping = false; ball.canDoubleJump = true;

    // Aim straight up into the overhead slab, mouse held still (aimMoved false), and walk right.
    const start = ball.x;
    for (let i = 0; i < 10; i++) {
        const aim = Math.atan2(250 - ball.y, ball.x - ball.x - 1e-9); // ~ -pi/2, recomputed as it moves
        const prev = { x: ball.x, y: ball.y, angle: ball.angle };
        stepBall(ball, { keys: new Set(['d']), shooting: false, jump: false, aim, aimMoved: false }, worldBounds);
        system.checkBallPlatforms(ball, prev);
    }
    // Grounded walking must move in the pressed direction; leverage may only engage in the air.
    assert.ok(ball.x > start + 10, 'the arm dragged the grounded walker backward');
    assert.equal(ball.armPivot, null, 'walking on the ground planted a leverage pivot');
});

test('the arm throw speed is weight/torque limited: heavier balls fling slower', () => {
    // A hard one-tick swing on a planted pivot would otherwise launch the body at the raw arc
    // displacement. The torque budget caps release speed inversely with mass (∝ radius²).
    const fling = radius => {
        const system = setupPlatforms(null, worldBounds, 7020);
        for (const existing of [...system.platforms]) system.removePlatform(existing);
        const plat = system.addPlatform(700, 900, 400, 30);   // keeps the pivot's platform valid
        const ball = createBall(1, worldBounds);
        ball.armMode = 'leverage'; ball.radius = radius;
        const dist = radius * 2;
        ball.armPivot = { x: 900, y: 600, distance: dist, platformId: plat.id };
        const startT = Math.PI / 2, target = 0.3;             // ~90° whip in one tick
        ball.x = ball.armPivot.x - Math.cos(startT) * dist;
        ball.y = ball.armPivot.y - Math.sin(startT) * dist;
        ball.angle = startT; ball.aimAngle = target; ball.previousAimAngle = startT; ball.aimMoved = true;
        ball.dx = 0; ball.dy = 0; ball.isJumping = true; ball.canDoubleJump = true;
        system.checkBallPlatforms(ball, { x: ball.x, y: ball.y, angle: startT });
        return Math.hypot(ball.dx, ball.dy);
    };
    const light = fling(30), spawn = fling(60), heavy = fling(120);
    assert.ok(light > spawn && spawn > heavy, 'throw speed did not fall as the ball got heavier');
    // Doubling the radius quadruples the mass, so the cap should roughly quarter.
    assert.ok(Math.abs(spawn / heavy - 4) < 0.5, 'throw cap did not scale with mass (radius squared)');
});
