import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from './server.js';
import { createWorld } from '../sim/world.js';
import { setupPlatforms } from '../platforms.js';
import { hashSeed } from '../sim/rng.js';
import { worldBounds } from '../view.js';
import { GAME_CONFIG } from '../config.js';
import { LOBBY } from '../sim/lobbyLayout.js';

// The host begins a round by shooting START: drop a projectile onto the button rect and let the
// server tick detect it. Only the host's projectiles are tested, so this is inherently host-only.
const hostStart = lobby => lobby.world.players.get(lobby.hostId).ball.projectiles.push({
    x: LOBBY.startBtn.x + LOBBY.startBtn.w / 2, y: LOBBY.startBtn.y + LOBBY.startBtn.h / 2,
    radius: 6, dx: 0, dy: 0, ricochetCount: 0
});

const waitUntil = (check, message, timeout = 1000) => new Promise((done, fail) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
        if (check()) return done();
        if (Date.now() > deadline) return fail(new Error(message));
        setTimeout(poll, 10);
    };
    poll();
});

const connect = (port, { lobby, name, create = false, mode = 'coop', origin, cid } = {}) => new Promise((done, fail) => {
    const params = new URLSearchParams({ lobby, name, mode });
    if (create) params.set('create', '1');
    if (cid) params.set('cid', cid);
    const ws = new WebSocket(`ws://127.0.0.1:${port}?${params}`, origin ? { origin } : undefined);
    ws.once('open', () => done(ws));
    ws.once('error', fail);
});

test('lobbies wait for their host, isolate worlds, migrate ownership, and disappear', async () => {
    const game = createGameServer({ port: 0, serveStatic: true });
    await new Promise(done => game.server.once('listening', done));
    const { port } = game.server.address();
    const clients = [];
    try {
        const page = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /id="gameCanvas"/);

        const redHost = await connect(port, {
            lobby: 'RED', name: 'Alice', create: true, mode: 'pvp', origin: 'http://localhost:5500'
        });
        clients.push(redHost);
        await waitUntil(() => game.lobbies.get('RED')?.clients.size === 1, 'RED was not created');
        const red = game.lobbies.get('RED');
        assert.equal(red.status, 'staging');
        assert.ok(red.world, 'lobby world runs live from creation');
        assert.ok(red.world.players.has(red.joinOrder[0]), 'host lowered into the live world');
        assert.equal(red.mode, 'pvp');
        assert.deepEqual(red.joinOrder, [...red.clients.keys()]);
        assert.equal([...red.clients.values()][0].lives, 3);

        const publicBeforeJoin = await fetch(`http://127.0.0.1:${port}/lobbies`).then(r => r.json());
        assert.deepEqual(publicBeforeJoin, [{ id: 'RED', mode: 'pvp', players: 1, maxPlayers: 4 }]);

        // No explicit start: guests join during staging and are added to the world immediately.
        const redGuest = await connect(port, { lobby: 'RED', name: 'Bob' });
        clients.push(redGuest);
        await waitUntil(() => red.clients.size === 2 && red.world.players.has(red.joinOrder[1]), 'guest did not join RED');
        assert.equal(red.status, 'staging', 'lobby stays in staging until the host shoots START');

        const blueHost = await connect(port, { lobby: 'BLUE', name: 'First', create: true });
        const blueGuest = await connect(port, { lobby: 'BLUE', name: 'Second' });
        clients.push(blueHost, blueGuest);
        const blue = game.lobbies.get('BLUE');
        await waitUntil(() => blue?.clients.size === 2, 'BLUE players did not join');
        const duplicate = await connect(port, { lobby: 'BLUE', name: 'Second' });
        const duplicateClose = await new Promise(done => duplicate.once('close', (code, reason) => done({ code, reason: reason.toString() })));
        assert.deepEqual(duplicateClose, { code: 4409, reason: 'That name is taken' });
        const blueThird = await connect(port, { lobby: 'BLUE', name: 'Third' });
        const blueFourth = await connect(port, { lobby: 'BLUE', name: 'Fourth' });
        clients.push(blueThird, blueFourth);
        await waitUntil(() => blue.clients.size === 4, 'BLUE did not reach its player cap');
        const fifth = await connect(port, { lobby: 'BLUE', name: 'Fifth' });
        const fifthClose = await new Promise(done => fifth.once('close', (code, reason) => done({ code, reason: reason.toString() })));
        assert.deepEqual(fifthClose, { code: 4403, reason: 'Lobby is full' });
        const secondId = [...blue.clients.keys()][1];
        blueHost.send(JSON.stringify({ t: 'leave' }));
        await waitUntil(() => blue.hostId === secondId && blue.clients.size === 3,
            'host did not leave immediately or migrate to the second player');
        assert.equal(blue.joinOrder[0], secondId, 'second player did not become first in join order');
        assert.equal(blue.world.players.get(secondId).ball.x, LOBBY.hostX,
            'new host was not moved onto the host platform');

        for (const ws of clients) ws.close();
        await waitUntil(() => game.lobbies.size === 0, 'empty lobbies were not deleted');
    } finally {
        for (const ws of clients) ws.terminate();
        await game.close();
    }
});

test('a disconnected player becomes a ghost that the same client id can reclaim', async () => {
    const game = createGameServer({ port: 0, serveStatic: true });
    await new Promise(done => game.server.once('listening', done));
    const { port } = game.server.address();
    const clients = [];
    try {
        const host = await connect(port, { lobby: 'GHOST', name: 'Host', create: true, cid: 'cid-host' });
        const guest = await connect(port, { lobby: 'GHOST', name: 'Guest', cid: 'cid-guest' });
        clients.push(host, guest);
        const lobby = game.lobbies.get('GHOST');
        await waitUntil(() => lobby.clients.size === 2, 'both players did not join');
        const guestId = lobby.joinOrder[1];
        await waitUntil(() => lobby.world?.players.has(guestId), 'guest not in the live world');

        guest.close();
        await waitUntil(() => lobby.clients.get(guestId)?.disconnected, 'guest was not ghosted');
        assert.ok(lobby.world.players.has(guestId), 'ghost was removed from the world');
        assert.equal(lobby.clients.size, 2, 'ghost was dropped from the lobby');
        assert.equal(lobby.hostId, lobby.joinOrder[0], 'host did not stay/migrate to a live player');

        const joinOrderBefore = [...lobby.joinOrder];
        const rejoin = await connect(port, { lobby: 'GHOST', name: 'Guest', cid: 'cid-guest' });
        clients.push(rejoin);
        await waitUntil(() => !lobby.clients.get(guestId)?.disconnected, 'ghost was not reactivated');
        assert.deepEqual(lobby.joinOrder, joinOrderBefore, 'reconnect created a new player instead of reclaiming the ghost');
        assert.equal(lobby.clients.size, 2, 'reconnect created a duplicate player');
    } finally {
        for (const ws of clients) ws.terminate();
        await game.close();
    }
});

test('a round stages, plays, ends on last-standing, and cycles into the next round', async () => {
    const game = createGameServer({ port: 0, serveStatic: false });
    await new Promise(done => game.server.once('listening', done));
    const { port } = game.server.address();
    const clients = [];
    try {
        const host = await connect(port, { lobby: 'CYCLE', name: 'Alpha', create: true, mode: 'pvp' });
        const guest = await connect(port, { lobby: 'CYCLE', name: 'Beta' });
        clients.push(host, guest);
        const lobby = game.lobbies.get('CYCLE');
        await waitUntil(() => lobby.clients.size === 2, 'players did not join');
        assert.equal(lobby.status, 'staging');
        assert.equal(lobby.round, 1);
        const stagingSeed = lobby.world.seed;

        // Staging holds until the HOST shoots START — no auto-countdown.
        await new Promise(r => setTimeout(r, 250));
        assert.equal(lobby.status, 'staging', 'staging should wait for the host, not auto-begin');
        const stagingHost = { ...lobby.world.players.get(lobby.hostId).ball };
        hostStart(lobby);
        await waitUntil(() => lobby.status === 'starting', 'START did not trigger the break phase');
        assert.equal(lobby.world.snapshot().platforms.length, 0, 'all staging pads and the divider should break together');
        await waitUntil(() => lobby.status === 'playing', 'host START did not begin the round', 3000);
        const [alphaId, betaId] = lobby.joinOrder;
        assert.ok(lobby.world.players.has(alphaId) && lobby.world.players.has(betaId), 'players not in the round world');
        assert.equal(lobby.world.players.get(alphaId).ball.x, stagingHost.x, 'host teleported horizontally when the arena appeared');
        assert.ok(lobby.world.players.get(alphaId).ball.y > stagingHost.y, 'host fall was not carried into the arena');
        assert.equal(lobby.world.seed, stagingSeed, 'round should reuse the seed staged for it');

        // Knock Beta out; pvp ends the round with one player standing.
        const beta = lobby.clients.get(betaId);
        beta.lives = 0;
        beta.eliminated = true;
        lobby.world.removePlayer(betaId);
        await waitUntil(() => lobby.status === 'over', 'round did not end on last player standing', 3000);
        assert.equal(lobby.winnerId, alphaId, 'wrong winner');

        // …then cycles back to staging with a fresh arena and everyone revived.
        await waitUntil(() => lobby.status === 'staging', 'lobby did not return to staging', 9000);
        assert.equal(lobby.round, 2);
        assert.notEqual(lobby.world.seed, stagingSeed, 'next round reused the previous arena');
        assert.equal(lobby.clients.get(betaId).eliminated, false, 'eliminated player did not rejoin next round');
        assert.equal(lobby.clients.get(betaId).lives, 3, 'lives were not restored');
    } finally {
        for (const ws of clients) ws.terminate();
        await game.close();
    }
});

test('platform geometry never goes over the wire and is reproducible from the seed', () => {
    const a = createWorld({ mode: 'coop', seed: 4242 });
    const b = createWorld({ mode: 'coop', seed: 4242 });
    const c = createWorld({ mode: 'coop', seed: 777 });
    assert.deepEqual(a.snapshot().platforms, b.snapshot().platforms, 'same seed produced different arenas');
    assert.notDeepEqual(a.snapshot().platforms, c.snapshot().platforms, 'different seeds produced the same arena');

    a.addPlayer(1);
    for (let i = 0; i < 600; i++) a.tick(GAME_CONFIG.TICK_DURATION);
    const net = a.netSnapshot();
    assert.equal(net.platforms, undefined, 'platform geometry leaked into the network snapshot');
    assert.equal(net.seed, 4242);
    assert.ok(JSON.stringify(net).length * 4 < JSON.stringify(a.snapshot()).length,
        'network snapshot is not dramatically smaller than the full one');

    // A client that only knows the seed rebuilds the identical arena.
    const client = setupPlatforms(null, worldBounds, net.seed);
    client.applySync(net.damage, net.extras);
    assert.equal(client.platforms.length, a.snapshot().platforms.length, 'client arena diverged from the server');
});

test('the host stays put while guest pads ease down and joined players fall in', () => {
    const world = createWorld({ mode: 'coop', lobby: true, seed: 42 });
    world.addLobbyPlayer(1, 0);
    const before = world.snapshot();
    const hostBefore = before.players.find(p => p.id === 1);
    const hostPadBefore = before.platforms[0];
    const guestPadBefore = before.platforms[1];
    const dividerBefore = before.platforms[4];

    for (let i = 0; i < 30; i++) world.tick(GAME_CONFIG.TICK_DURATION);

    const after = world.snapshot();
    const hostAfter = after.players.find(p => p.id === 1);
    assert.equal(hostAfter.x, hostBefore.x, 'host moved horizontally during lobby creation');
    assert.equal(hostAfter.y, hostBefore.y, 'host dropped in despite already occupying the menu pad');
    assert.equal(after.platforms[0].y, hostPadBefore.y, 'host platform descended');
    assert.ok(after.platforms[1].y > guestPadBefore.y, 'empty guest platform did not descend');
    assert.ok(after.platforms[4].y > dividerBefore.y, 'divider did not descend');
});

test('a guest shot on START is consumed and triggers the alternate-message path', () => {
    const world = createWorld({ mode: 'coop', lobby: true, seed: 9 });
    world.addLobbyPlayer(1, 0);
    world.addLobbyPlayer(2, 1);
    const guest = world.players.get(2).ball;
    guest.projectiles.push({
        id: 'guest-start-attempt',
        x: LOBBY.startBtn.x + LOBBY.startBtn.w / 2,
        y: LOBBY.startBtn.y + LOBBY.startBtn.h / 2,
        radius: 8,
        dx: 0,
        dy: 0,
        ricochetCount: 0,
        ownerId: 2
    });

    assert.equal(world.checkGuestBlockHit(1), true);
    assert.equal(guest.projectiles.length, 0);
});

test('lobby platform dip and bounce are deterministic for a seed', () => {
    const a = createWorld({ mode: 'coop', lobby: true, seed: 777 });
    const b = createWorld({ mode: 'coop', lobby: true, seed: 777 });
    const c = createWorld({ mode: 'coop', lobby: true, seed: 778 });
    for (let i = 0; i < 220; i++) {
        a.tick(GAME_CONFIG.TICK_DURATION);
        b.tick(GAME_CONFIG.TICK_DURATION);
        c.tick(GAME_CONFIG.TICK_DURATION);
    }
    const ys = world => world.snapshot().platforms.slice(1).map(p => p.y);
    assert.deepEqual(ys(a), ys(b), 'same seed produced different lobby motion');
    assert.notDeepEqual(ys(a), ys(c), 'different seeds produced identical lobby motion');
});

test('a client that missed the destroying frame still catches up on the destruction', () => {
    const server = setupPlatforms(null, worldBounds, 31337);
    const client = setupPlatforms(null, worldBounds, 31337);
    const victim = server.platforms.find(p => p.index >= 0);

    // Destroy it and let the server retire it — WITHOUT syncing on that frame, which is the
    // normal case since state is only broadcast every few ticks.
    victim.hitPlatform(1); victim.hitPlatform(1); victim.hitPlatform(1);
    server.updatePlatformsMovement();
    assert.ok(!server.platforms.includes(victim), 'server did not retire the destroyed platform');

    // The next sync the client receives must still report it.
    client.applySync(server.damage(), server.extras());
    assert.equal(client.platforms.length, server.platforms.length, 'client kept a platform the server destroyed');
    assert.ok(!client.platforms.some(p => p.index === victim.index), 'destroyed platform survived on the client');
});

test('the whole world - platforms AND enemies - is reproducible from the seed alone', () => {
    const run = seed => {
        const w = createWorld({ mode: 'coop', seed });
        w.addPlayer(1);
        for (let i = 0; i < 4000; i++) w.tick(GAME_CONFIG.TICK_DURATION);
        const s = w.snapshot();
        return JSON.stringify({
            platforms: s.platforms.map(p => [p.x, p.y, p.width, p.height]),
            enemies: s.enemies.map(e => [e.id, e.x, e.y, e.size, e.angle])
        });
    };
    const a = run(2024), b = run(2024), c = run(2025);
    assert.ok(JSON.parse(a).enemies.length > 0, 'no enemies spawned, so the check proves nothing');
    assert.equal(a, b, 'same seed produced a different world');
    assert.notEqual(a, c, 'different seeds produced the same world');
});

test('a lobby name IS its seed: the world is derived from the name alone', async () => {
    const game = createGameServer({ port: 0 });
    await new Promise(done => game.server.once('listening', done));
    const { port } = game.server.address();
    const clients = [];
    try {
        // No seed is sent over the wire at all — only the lobby name.
        const ws = new WebSocket(`ws://127.0.0.1:${port}?lobby=K7QP2M&name=Host&create=1`);
        await new Promise((done, fail) => { ws.once('open', done); ws.once('error', fail); });
        clients.push(ws);
        await waitUntil(() => game.lobbies.get('K7QP2M'), 'lobby was not created');
        const lobby = game.lobbies.get('K7QP2M');
        assert.equal(lobby.baseSeed, hashSeed('K7QP2M'), 'seed was not derived from the lobby name');
        assert.equal(lobby.world.seed, hashSeed('K7QP2M'), 'round 1 is not the world that name denotes');

        // Anyone who knows only the name reproduces the identical arena.
        const local = setupPlatforms(null, worldBounds, hashSeed('K7QP2M'));
        // All four staging pads exist at creation, even while the three guest slots are empty.
        // The only other runtime geometry is the descending divider.
        const staged = lobby.world.snapshot().platforms;
        assert.equal(staged.length, 4 + LOBBY.fixtures.length, 'staging should contain four pads and the divider');
        hostStart(lobby);
        await waitUntil(() => lobby.status === 'playing', 'round never began', 3000);
        assert.deepEqual(
            lobby.world.snapshot().platforms.map(p => [p.x, p.y]),
            local.platforms.map(p => [p.x, p.y]),
            'lobby arena does not match the world its name denotes'
        );

        // A different name is a different world.
        const other = setupPlatforms(null, worldBounds, hashSeed('ZZZZZZ'));
        assert.notDeepEqual(local.platforms.map(p => [p.x, p.y]), other.platforms.map(p => [p.x, p.y]));
    } finally {
        for (const ws of clients) ws.terminate();
        await game.close();
    }
});

test('static platforms never drift', () => {
    const w = createWorld({ mode: 'coop', seed: 5 });
    const before = w.snapshot().platforms.map(p => `${p.x},${p.y}`);
    for (let i = 0; i < 500; i++) w.tick(GAME_CONFIG.TICK_DURATION);
    assert.deepEqual(w.snapshot().platforms.map(p => `${p.x},${p.y}`), before, 'a platform moved');
});

test('platform collision grids belong to one world', () => {
    const first = setupPlatforms(null, worldBounds);
    const firstPlatform = first.platforms[0];
    const second = setupPlatforms(null, worldBounds);
    assert.notEqual(first.spatialGrid, second.spatialGrid);
    assert.ok(first.getNearbyPlatforms(firstPlatform.x, firstPlatform.y, firstPlatform.width, firstPlatform.height)
        .includes(firstPlatform), 'creating another world cleared the first world grid');
});
