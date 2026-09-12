// Authoritative multiplayer server. Lobbies are in memory and intentionally vanish
// when their last player leaves; only a host can start their isolated simulation.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { GAME_CONFIG } from '../config.js';
import { createWorld } from '../sim/world.js';
import { hashSeed } from '../sim/rng.js';
import { LOBBY } from '../sim/lobbyLayout.js';

const BROADCAST_EVERY = 4;
const MAX_PLAYERS = 4;
const GHOST_MAX_RESPAWNS = 3;   // coop: a disconnected player respawns this many times, then fully dies
const MAX_LOBBIES = 100;
// Round cycle: players lower in during staging and wait there until the HOST shoots START, fight
// the round, then results before the next one stages.
const OVER_MS = 5000;
const LIVES = 3;
const PUMP_MS = 4;              // timer period; the accumulator decides how many fixed ticks run
const MAX_CATCHUP_TICKS = 10;   // bound the catch-up burst after a hitch
const VALID_NAME = /^[A-Za-z0-9 _-]{2,16}$/;
const VALID_LOBBY = /^[A-Z0-9_-]{1,24}$/;
const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const DEFAULT_ORIGINS = [
    'http://localhost:8000', 'http://127.0.0.1:8000',
    'http://localhost:8080', 'http://127.0.0.1:8080',
    'http://localhost:5500', 'http://127.0.0.1:5500',
    'https://5seansean.github.io'
];
const CONTENT_TYPES = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
    '.json': 'application/json', '.ttf': 'font/ttf'
};

export function createGameServer({
    port = Number(process.env.PORT || 8080),
    serveStatic = false,
    allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map(s => s.trim())
} = {}) {
    const lobbies = new Map();
    let nextPlayerId = 1;
    let ticks = 0;
    let timer = null;
    let accumulator = 0, lastPump = 0;

    const server = createServer(async (req, res) => {
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
            res.end();
            return;
        }
        if (pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }
        if (pathname === '/lobbies') {
            const publicLobbies = [...lobbies.values()]
                // Rounds run continuously now, so any lobby with room is joinable — you spectate
                // until the next staging phase.
                .filter(lobby => lobby.clients.size < MAX_PLAYERS)
                .map(lobby => ({ id: lobby.id, mode: lobby.mode, players: lobby.clients.size, maxPlayers: MAX_PLAYERS }));
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(publicLobbies));
            return;
        }
        if (!serveStatic) {
            res.writeHead(426, { 'Content-Type': 'text/plain' });
            res.end('WebSocket connection required');
            return;
        }

        const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
        const filePath = resolve(ROOT, relativePath);
        if (!filePath.startsWith(ROOT + sep)) {
            res.writeHead(403).end();
            return;
        }
        try {
            const body = await readFile(filePath);
            res.writeHead(200, {
                'Content-Type': CONTENT_TYPES[extname(filePath)] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(body);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

    server.on('upgrade', (req, socket, head) => {
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.includes(origin)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        const params = new URL(req.url, 'http://localhost').searchParams;
        const info = {
            lobbyId: params.get('lobby')?.toUpperCase(),
            name: params.get('name')?.trim(),
            cid: params.get('cid') || null,
            create: params.get('create') === '1',
            mode: params.get('mode') === 'pvp' ? 'pvp' : 'coop'
        };
        if (!info.lobbyId || !VALID_LOBBY.test(info.lobbyId) || !info.name || !VALID_NAME.test(info.name)) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, info));
    });

    const send = (ws, message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    const lobbyMessage = lobby => ({
        t: 'lobby', lobby: lobby.id, mode: lobby.mode, status: lobby.status, hostId: lobby.hostId,
        round: lobby.round, seed: lobby.world?.seed ?? 0, phaseMs: Math.max(0, lobby.phaseMs),
        winnerId: lobby.winnerId ?? null, buttonTaunt: lobby.buttonTaunt ?? null,
        players: lobby.joinOrder.map(id => {
            const { name, lives, eliminated, disconnected, spectating } = lobby.clients.get(id);
            return { id, name, lives, eliminated, disconnected, spectating };
        })
    });
    const broadcast = (lobby, message) => {
        const payload = JSON.stringify(message);
        for (const client of lobby.clients.values()) {
            if (client.ws.readyState === WebSocket.OPEN) client.ws.send(payload);
        }
    };
    const broadcastLobby = lobby => broadcast(lobby, lobbyMessage(lobby));

    // Host is the earliest-joined player that is still connected (falls back to any).
    const liveHost = lobby => lobby.joinOrder.find(id => !lobby.clients.get(id).disconnected) ?? lobby.joinOrder[0];

    // The creator leaving before the game starts destroys the lobby — there is no host migration
    // in staging. Everyone still connected is told to fall back to the menu, then torn down.
    function dissolveLobby(lobby) {
        broadcast(lobby, { t: 'dissolve' });
        for (const c of lobby.clients.values()) { try { c.ws.close(1000, 'Lobby closed'); } catch {} }
        lobby.world = null;
        lobby.clients.clear();
        lobby.joinOrder.length = 0;
        lobbies.delete(lobby.id);
    }

    function fullyRemove(lobby, id) {
        if (!lobby.clients.has(id)) return;
        if (lobby.status === 'staging' && lobby.joinOrder[0] === id) return dissolveLobby(lobby);
        lobby.clients.delete(id);
        lobby.joinOrder.splice(lobby.joinOrder.indexOf(id), 1);
        // Staging: the pad falls out and a fresh one drops into the seat. Mid-game: just gone.
        if (lobby.status === 'staging') lobby.world?.vacateLobbySlot(id);
        else lobby.world?.removePlayer(id);
        if (lobby.clients.size === 0) { lobby.world = null; lobbies.delete(lobby.id); return; }
        lobby.hostId = liveHost(lobby);
        broadcastLobby(lobby);
        if (lobby.world) broadcast(lobby, { t: 'state', ...lobby.world.netSnapshot() });
        checkRoundOver(lobby);
    }

    // ---- round cycle: staging -> starting (pads break) -> playing -> over -> staging ----
    // Each round gets its own seed, so every round is a fresh arena that clients generate
    // locally from the seed rather than receiving.
    // The lobby's NAME is its seed: round 1 is exactly the world that name denotes, which is the
    // world the host was already standing in. Later rounds derive fresh arenas from the same name.
    const roundSeed = lobby => lobby.round <= 1 ? lobby.baseSeed : hashSeed(`${lobby.id}:${lobby.round}`);

    // Staging: a calm, arena-free world where each player lowers in on their own pad.
    function toStaging(lobby) {
        lobby.round++;
        lobby.status = 'staging';
        lobby.phaseMs = Infinity;   // staging holds until the host shoots START
        lobby.winnerId = null;
        lobby.buttonTaunt = null;
        lobby.buttonTauntMs = 0;
        lobby.world = createWorld({ mode: lobby.mode, lobby: true, seed: roundSeed(lobby) });
        lobby.joinOrder.forEach((id, i) => {
            const client = lobby.clients.get(id);
            client.lives = LIVES;
            client.eliminated = false;
            client.spectating = false;   // everyone waiting gets in on the next round
            client.ghostRespawns = 0;
            lobby.world.addLobbyPlayer(id, i);
        });
        broadcastLobby(lobby);
    }

    function toStarting(lobby) {
        // pvp with nobody to fight would end the instant it began — the host's START does nothing
        // until there are enough contenders, so just stay in staging.
        const contenders = lobby.joinOrder.filter(id => !lobby.clients.get(id).spectating).length;
        if (contenders < (lobby.mode === 'pvp' ? 2 : 1)) return;
        lobby.status = 'starting';
        lobby.phaseMs = LOBBY.breakMs;
        lobby.world.breakLobbyPlatforms();
        broadcastLobby(lobby);
    }

    // Playing: preserve each falling ball's position and velocity when the seeded arena replaces
    // the staging set, so the break reads as one continuous fall instead of a scene teleport.
    function toPlaying(lobby) {
        const entry = new Map(lobby.joinOrder.map(id => {
            const b = lobby.world.players.get(id)?.ball;
            return [id, b ? {
                x: b.x, y: b.y, dx: b.dx, dy: b.dy, angle: b.angle, shotRange: b.shotRange
            } : null];
        }));
        lobby.status = 'playing';
        lobby.phaseMs = Infinity;
        lobby.world = createWorld({ mode: lobby.mode, seed: roundSeed(lobby) });
        for (const id of lobby.joinOrder) {
            if (!lobby.clients.get(id).spectating) lobby.world.addPlayer(id, entry.get(id));
        }
        broadcastLobby(lobby);
    }

    function toOver(lobby, winnerId) {
        lobby.status = 'over';
        lobby.phaseMs = OVER_MS;
        lobby.winnerId = winnerId ?? null;
        broadcastLobby(lobby);
    }

    // Round ends on last-player-standing (pvp) / everyone eliminated (coop).
    function checkRoundOver(lobby) {
        if (lobby.status !== 'playing') return;
        const alive = lobby.joinOrder.filter(id => {
            const c = lobby.clients.get(id);
            return !c.spectating && !c.eliminated;
        });
        const needed = lobby.mode === 'pvp' ? 1 : 0;
        if (alive.length > needed) return;
        toOver(lobby, lobby.mode === 'pvp' ? alive[0] ?? null : null);
    }

    wss.on('connection', (ws, info) => {
        let lobby = lobbies.get(info.lobbyId);
        if (info.create) {
            if (lobby) return ws.close(4409, 'Lobby already exists');
            if (lobbies.size >= MAX_LOBBIES) return ws.close(4503, 'Server has too many lobbies');
            lobby = {
                id: info.lobbyId, mode: info.mode, status: 'staging', hostId: null,
                world: null, clients: new Map(), joinOrder: [],
                round: 1, phaseMs: Infinity, winnerId: null,
                buttonTaunt: null, buttonTauntMs: 0, tauntIndex: 0,
                baseSeed: hashSeed(info.lobbyId)
            };
            lobby.world = createWorld({ mode: info.mode, lobby: true, seed: roundSeed(lobby) });
            lobbies.set(lobby.id, lobby);
            ensureTimer();
        } else if (!lobby) {
            return ws.close(4404, 'Lobby not found');
        }
        // Reconnect: a disconnected player reclaims their ghost via the stable client id.
        const ghost = info.cid && [...lobby.clients].find(([, c]) => c.disconnected && c.cid === info.cid);
        let id, client;
        if (ghost) {
            [id, client] = ghost;
            client.ws = ws;
            client.disconnected = false;
            client.ghostRespawns = 0;
            client.messages = 0;
            client.messageWindow = Date.now();
            lobby.hostId = liveHost(lobby);
            send(ws, { t: 'welcome', id, lobby: lobby.id });
            broadcastLobby(lobby);
            console.log(`[subsurface] ${info.name} (${id}) reconnected to ${lobby.id}`);
        } else {
            if (lobby.clients.size >= MAX_PLAYERS) return ws.close(4403, 'Lobby is full');
            if ([...lobby.clients.values()].some(c => c.name.toLowerCase() === info.name.toLowerCase())) {
                return ws.close(4409, 'That name is taken');
            }
            // Joining mid-round spectates until the next staging phase picks everyone back up.
            const spectating = lobby.status !== 'staging';
            id = nextPlayerId++;
            client = {
                ws, name: info.name, cid: info.cid, lives: LIVES,
                eliminated: false, spectating, disconnected: false, ghostRespawns: 0,
                messages: 0, messageWindow: Date.now()
            };
            lobby.clients.set(id, client);
            lobby.joinOrder.push(id);
            lobby.hostId = lobby.joinOrder[0];
            // Lower in on the lowest free pad — live and identical for everyone already in the lobby.
            if (!spectating) lobby.world.addLobbyPlayer(id);
            send(ws, { t: 'welcome', id, lobby: lobby.id });
            broadcastLobby(lobby);
            console.log(`[subsurface] ${info.name} (${id}) joined ${lobby.id} (${lobby.clients.size} online)`);
        }

        ws.on('message', data => {
            if (client.ws !== ws) return;   // superseded by a reconnect
            const currentTime = Date.now();
            if (currentTime - client.messageWindow >= 1000) {
                client.messageWindow = currentTime;
                client.messages = 0;
            }
            if (++client.messages > 120) return;
            let msg;
            try { msg = JSON.parse(data); } catch { return; }

            if (msg?.t === 'input' && lobby.world && !client.eliminated) {
                lobby.world.setInput(id, msg);
            } else if (msg?.t === 'leave') {
                fullyRemove(lobby, id);
                console.log(`[subsurface] ${info.name} (${id}) left ${lobby.id} (${lobby.clients.size} online)`);
                ws.close(1000, 'Left lobby');
            }
        });

        ws.on('close', () => {
            if (client.ws !== ws) return;   // stale socket replaced by a reconnect — ignore
            if (!lobby.clients.has(id)) return; // graceful leave was already removed and broadcast
            // Mid-game: leave the player in the world as a frozen ghost that keeps respawning
            // until it fully dies (pvp: lives run out; coop: GHOST_MAX_RESPAWNS). Same cid rejoins it.
            // A raw drop still ghosts even in staging (reconnectable); only a deliberate 'leave'
            // message dissolves the lobby (host) or vacates a pad (guest).
            if (!client.eliminated && lobby.world?.players.has(id)) {
                client.disconnected = true;
                lobby.world.setInput(id, { keys: [], shooting: false });
                if (lobby.hostId === id) lobby.hostId = liveHost(lobby);
                if (![...lobby.clients.values()].some(c => !c.disconnected)) {
                    lobby.world = null;
                    lobbies.delete(lobby.id);   // everyone gone — drop the lobby
                } else {
                    broadcastLobby(lobby);
                }
                console.log(`[subsurface] ${info.name} (${id}) disconnected from ${lobby.id} (ghost)`);
                return;
            }
            fullyRemove(lobby, id);
            console.log(`[subsurface] ${info.name} (${id}) left ${lobby.id} (${lobby.clients.size} online)`);
        });
        ws.on('error', () => {});
    });

    // setInterval cannot honour an 8.33 ms period (timers clamp to ~16 ms on Windows), which
    // silently ran the whole simulation at half the configured 120 Hz. Drive fixed ticks off a
    // real-time accumulator instead, so the world advances at TICK_RATE whatever the timer does.
    function pumpLobbies() {
        const t = performance.now();
        accumulator += Math.min(t - lastPump, 250);   // cap so a stalled process can't spiral
        lastPump = t;
        let steps = 0;
        while (accumulator >= GAME_CONFIG.TICK_DURATION && steps++ < MAX_CATCHUP_TICKS) {
            accumulator -= GAME_CONFIG.TICK_DURATION;
            tickLobbies();
        }
    }

    function tickLobbies() {
        for (const lobby of lobbies.values()) {
            if (!lobby.world) continue;
            const deaths = lobby.world.tick(GAME_CONFIG.TICK_DURATION);

            // Both modes use lives now, so "everyone is out" is reachable in coop too and a
            // round can actually end. Disconnected ghosts burn a smaller respawn budget.
            if (lobby.status === 'playing' && deaths.length) {
                for (const id of deaths) {
                    const client = lobby.clients.get(id);
                    if (!client || client.eliminated) continue;
                    if (client.disconnected && ++client.ghostRespawns > GHOST_MAX_RESPAWNS) { fullyRemove(lobby, id); continue; }
                    if (--client.lives <= 0) {
                        client.eliminated = true;
                        lobby.world.removePlayer(id);
                    }
                }
                broadcastLobby(lobby);
            }
            // Evaluated every tick rather than only on death, so the round ends correctly no
            // matter what removed the last player (death, disconnect, kick).
            checkRoundOver(lobby);

            if (lobby.status === 'staging') {
                if (lobby.world.checkGuestBlockHit(lobby.hostId)) {
                    const taunts = ['TRY AGAIN', 'HA HA', 'HOST ONLY'];
                    lobby.buttonTaunt = taunts[lobby.tauntIndex++ % taunts.length];
                    lobby.buttonTauntMs = 1000;
                    broadcastLobby(lobby);
                }
                if (lobby.world.checkStartHit(lobby.hostId)) toStarting(lobby);
                if (lobby.buttonTauntMs > 0) {
                    lobby.buttonTauntMs -= GAME_CONFIG.TICK_DURATION;
                    if (lobby.buttonTauntMs <= 0) {
                        lobby.buttonTaunt = null;
                        broadcastLobby(lobby);
                    }
                }
            }

            // Phase clock. Staging has no clock; starting completes the visible break/fall.
            lobby.phaseMs -= GAME_CONFIG.TICK_DURATION;
            if (lobby.phaseMs <= 0 && lobby.status === 'starting') toPlaying(lobby);
            if (lobby.phaseMs <= 0 && lobby.status === 'over') toStaging(lobby);
        }
        if (++ticks % BROADCAST_EVERY === 0) {
            for (const lobby of lobbies.values()) {
                if (lobby.world) broadcast(lobby, { t: 'state', ...lobby.world.netSnapshot() });
            }
        }
        if (![...lobbies.values()].some(lobby => lobby.world)) {
            clearInterval(timer);
            timer = null;
        }
    }

    function ensureTimer() {
        if (timer) return;
        lastPump = performance.now();
        accumulator = 0;
        timer = setInterval(pumpLobbies, PUMP_MS);
    }

    server.listen(port, () => console.log(`[subsurface] authoritative server listening on port ${server.address().port}`));
    return {
        server,
        lobbies,
        close: () => new Promise(done => {
            if (timer) clearInterval(timer);
            for (const client of wss.clients) client.terminate();
            wss.close(() => server.close(done));
        })
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createGameServer();
