import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from './server.js';

const connect = (port, lobby) => new Promise((done, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}?lobby=${lobby}`);
    ws.once('open', () => done(ws));
    ws.once('error', fail);
});

const waitForPlayers = (ws, count) => new Promise((done, fail) => {
    const timeout = setTimeout(() => fail(new Error(`No ${count}-player snapshot received`)), 1000);
    ws.on('message', data => {
        const message = JSON.parse(data);
        if (message.t === 'state' && message.players.length === count) {
            clearTimeout(timeout);
            done();
        }
    });
});

test('lobbies isolate players and disappear when empty', async () => {
    const game = createGameServer({ port: 0, allowedOrigins: [] });
    await new Promise(done => game.server.once('listening', done));
    const { port } = game.server.address();
    const red1 = await connect(port, 'red');
    const red2 = await connect(port, 'red');
    const blue = await connect(port, 'blue');

    await Promise.all([waitForPlayers(red1, 2), waitForPlayers(red2, 2), waitForPlayers(blue, 1)]);
    assert.equal(game.lobbies.size, 2);
    red1.close(); red2.close(); blue.close();
    await new Promise(done => setTimeout(done, 50));
    assert.equal(game.lobbies.size, 0);
    await game.close();
});
