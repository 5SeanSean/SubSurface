// Authoritative multiplayer server with isolated, in-memory lobby worlds.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { GAME_CONFIG } from '../config.js';
import { advanceClock } from '../clock.js';
import { createWorld } from '../sim/world.js';

const BROADCAST_EVERY = 4;
const DEFAULT_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000', 'https://5seansean.github.io'];

export function createGameServer({
    port = Number(process.env.PORT || 8080),
    allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(s => s.trim())
} = {}) {
    const lobbies = new Map();
    let nextPlayerId = 1;
    let ticks = 0;
    const server = createServer((req, res) => {
        res.writeHead(req.url === '/health' ? 200 : 426, { 'Content-Type': 'text/plain' });
        res.end(req.url === '/health' ? 'ok' : 'WebSocket connection required');
    });
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.includes(origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        const lobbyId = new URL(req.url, 'http://localhost').searchParams.get('lobby')?.toUpperCase();
        if (!lobbyId || !/^[A-Z0-9_-]{1,24}$/.test(lobbyId)) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, lobbyId));
    });

    wss.on('connection', (ws, lobbyId) => {
        let lobby = lobbies.get(lobbyId);
        if (!lobby) {
            lobby = { world: createWorld(), clients: new Map() };
            lobbies.set(lobbyId, lobby);
        }

        const id = nextPlayerId++;
        lobby.clients.set(id, ws);
        lobby.world.addPlayer(id);
        ws.send(JSON.stringify({ t: 'welcome', id, lobby: lobbyId }));
        console.log(`[platz] player ${id} joined ${lobbyId} (${lobby.clients.size} online)`);

        ws.on('message', data => {
            let msg;
            try { msg = JSON.parse(data); } catch { return; }
            if (msg?.t === 'input') lobby.world.setInput(id, msg);
        });
        ws.on('close', () => {
            lobby.clients.delete(id);
            lobby.world.removePlayer(id);
            if (lobby.clients.size === 0) lobbies.delete(lobbyId);
            console.log(`[platz] player ${id} left ${lobbyId} (${lobby.clients.size} online)`);
        });
        ws.on('error', () => {});
    });

    const timer = setInterval(() => {
        advanceClock(GAME_CONFIG.TICK_DURATION);
        for (const lobby of lobbies.values()) lobby.world.tick(GAME_CONFIG.TICK_DURATION);
        if (++ticks % BROADCAST_EVERY !== 0) return;
        for (const lobby of lobbies.values()) {
            const payload = JSON.stringify({ t: 'state', ...lobby.world.snapshot() });
            for (const ws of lobby.clients.values()) {
                if (ws.readyState === WebSocket.OPEN) ws.send(payload);
            }
        }
    }, GAME_CONFIG.TICK_DURATION);

    server.listen(port, () => console.log(`[platz] authoritative server listening on port ${server.address().port}`));
    return {
        server,
        lobbies,
        close: () => new Promise(done => {
            clearInterval(timer);
            for (const client of wss.clients) client.terminate();
            wss.close(() => server.close(done));
        })
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createGameServer();
