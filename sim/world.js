// Authoritative game world — runs headless on the server (and, later, locally for
// single-player). Owns all players and the shared level, advances one fixed tick at a
// time, and produces serializable snapshots to broadcast to clients.
//
// Now includes the full game: players, platforms, projectiles, enemies (lava squares
// targeting the nearest player), consumables, and the bottom lava.
import { worldBounds } from '../view.js';
import { GAME_CONFIG } from '../config.js';
import { physics } from '../physics.js';
import { setupPlatforms } from '../platforms.js';
import { LavaSquare } from '../lavaSquareEnemies.js';
import { SpatialGrid } from '../spatialGrid.js';
import { createBall, stepBall, tryShoot, stepProjectiles } from './ball.js';
import { removeArea } from './playerRanges.js';
import { mulberry32 } from './rng.js';
import { LOBBY, lobbyColumnX } from './lobbyLayout.js';

const SPAWN_INTERVAL = 4000;
const H = GAME_CONFIG.REF_HEIGHT;
const ALLOWED_KEYS = new Set(['a', 'd', 's', 'w', 'q', 'e', 'arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ']);

// Lobby staging layout lives in sim/lobbyLayout.js (shared with the client). The host stays on
// the menu pad; three empty guest pads and the divider lower in when the lobby is created.
const LOBBY_Y = LOBBY.restY;
const LOBBY_DROP = LOBBY.drop;

export function createWorld({ mode = 'coop', lobby = false, seed = 1, canvas = null } = {}) {
    const platformsObj = setupPlatforms(canvas, worldBounds, seed); // null canvas: server never draws
    const enemyGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE * 2);
    const lavaY = worldBounds.bottom - H / 18;
    const players = new Map(); // id -> { ball, input }
    const lavaSquares = [];
    const consumables = [];
    let lastSpawn = 0;
    let time = 0;
    let peaceful = false;   // menu: real ball rests, but no enemies spawn

    // Enemy stream, seeded separately from the platform stream so the two can't shift each
    // other. Every spawn (position, size, speed, angle, colour, id) is reproducible from `seed`.
    const rng = mulberry32((seed ^ 0x9E3779B9) >>> 0);
    let enemySeq = 0;

    const lobbyPads = [];          // four persistent staging pads, populated as players join
    const playerSlots = new Map(); // player id -> slot index
    const lobbyMotions = [];
    const lobbyFixtures = [];

    // Separate seeded stream: lobby timing changes never perturb arena/enemy generation.
    const lobbyRng = mulberry32((seed ^ 0x51F15EED) >>> 0);
    const smoothstep = t => t * t * (3 - 2 * t);
    function addLobbyMotion(plat, targetY) {
        lobbyMotions.push({
            plat, fromY: plat.y, targetY, elapsed: 0,
            delay: lobbyRng() * LOBBY.motionDelayMs,
            duration: LOBBY.motionMs + lobbyRng() * LOBBY.motionJitterMs,
            dip: LOBBY.dip * (0.75 + lobbyRng() * 0.5),
            rebound: LOBBY.rebound * (0.75 + lobbyRng() * 0.5)
        });
    }

    // Lobby: a calm shared arena — no auto-generated level and no enemies. All pads exist from
    // creation; only the host pad is already in place, while the empty guest pads descend.
    if (lobby) {
        peaceful = true;
        platformsObj.platforms.length = 0;
        platformsObj.spatialGrid.clear();
        for (let i = 0; i < 4; i++) {
            const x = lobbyColumnX(i);
            const y = i === 0 ? LOBBY_Y : LOBBY_Y - LOBBY_DROP;
            lobbyPads.push(platformsObj.addPlatform(x - LOBBY.padW / 2, y, LOBBY.padW, LOBBY.padH));
            if (i > 0) addLobbyMotion(lobbyPads[i], LOBBY_Y);
        }
        for (const f of LOBBY.fixtures) {
            const plat = platformsObj.addPlatform(f.x, f.y - LOBBY_DROP, f.w, f.h);
            lobbyFixtures.push({ plat, targetY: f.y });
            addLobbyMotion(plat, f.y);
        }
    }

    const emptyInput = () => ({ keys: new Set(), shooting: false, jump: false, aim: 0 });
    const balls = () => [...players.values()].map(p => p.ball);

    function addPlayer(id, spawn = null) {
        const ball = createBall(id, worldBounds);
        if (spawn) Object.assign(ball, spawn, { id, projectiles: [] });
        players.set(id, { ball, input: emptyInput() });
    }
    // Populate one of the pads that already belongs to the lobby.
    function addLobbyPlayer(id, index = players.size) {
        addPlayer(id);
        const b = players.get(id).ball;
        const slot = Math.max(0, Math.min(index, lobbyPads.length - 1));
        const pad = lobbyPads[slot];
        playerSlots.set(id, slot);
        b.x = pad.x + pad.width / 2;
        // The host already occupied this platform on the preceding menu screen. Only guests
        // enter physically from above; slot zero begins exactly at rest.
        b.y = slot === 0 ? pad.y - b.radius : b.radius;
        b.dx = b.dy = 0;
        b.isGameRunning = true;
    }
    function removePlayer(id) {
        players.delete(id);
        playerSlots.delete(id);
    }

    // Compact the live staging players back into join order after somebody leaves. In
    // particular, the next host moves onto slot zero so they can reach the START control.
    function reassignLobbySlots(ids) {
        if (!lobby) return;
        playerSlots.clear();
        ids.forEach((id, index) => {
            const b = players.get(id)?.ball;
            const slot = Math.max(0, Math.min(index, lobbyPads.length - 1));
            const pad = lobbyPads[slot];
            if (!b || !pad) return;
            playerSlots.set(id, slot);
            b.x = pad.x + pad.width / 2;
            b.y = pad.y - b.radius;
            b.dx = b.dy = 0;
            b.isGameRunning = true;
        });
    }

    function setInput(id, msg) {
        const p = players.get(id);
        if (!p) return;
        p.input.keys = new Set(Array.isArray(msg.keys) ? msg.keys.filter(k => ALLOWED_KEYS.has(k)).slice(0, 9) : []);
        p.input.shooting = !!msg.shooting;
        p.input.aim = Number.isFinite(msg.aim) ? msg.aim : p.input.aim;
        if (msg.jump) p.input.jump = true; // edge; consumed in tick()
    }

    function spawnEnemy() {
        if (peaceful) return;
        if (time - lastSpawn < SPAWN_INTERVAL || lavaSquares.length >= GAME_CONFIG.MAX_LAVA_SQUARES) return;
        if (players.size === 0) return;
        lastSpawn = time;
        const near = balls()[Math.floor(rng() * players.size)]; // spawn beside a random player
        const x = rng() > 0.5 ? near.x + 500 : near.x - 500;
        const size = rng() * (H / 30) + (H / 20);
        const speed = rng() * H / 700 + H / 700;
        const angle = rng() * Math.PI * 2;
        lavaSquares.push(new LavaSquare(x, worldBounds.bottom, size, speed,
            worldBounds, canvas, angle, 1, { spatialGrid: enemyGrid, rng, id: `e${++enemySeq}` }));
    }

    function tick(dt) {
        time += dt;
        const deadPlayerIds = [];
        platformsObj.updatePlatformsMovement();

        // Smooth seeded keyframes: descend, dip below rest, rebound above it, then settle.
        for (let i = lobbyMotions.length - 1; i >= 0; i--) {
            const m = lobbyMotions[i];
            m.elapsed += dt;
            const p = Math.max(0, Math.min(1, (m.elapsed - m.delay) / m.duration));
            let y;
            if (p < 0.72) {
                const t = smoothstep(p / 0.72);
                y = m.fromY + (m.targetY + m.dip - m.fromY) * t;
            } else if (p < 0.88) {
                const t = smoothstep((p - 0.72) / 0.16);
                y = m.targetY + m.dip + (m.targetY - m.rebound - (m.targetY + m.dip)) * t;
            } else {
                const t = smoothstep((p - 0.88) / 0.12);
                y = m.targetY - m.rebound + m.rebound * t;
            }
            m.plat.dy = y - m.plat.y;
            m.plat.y = y;
            platformsObj.spatialGrid.update(m.plat, m.plat.x, m.plat.y, m.plat.width, m.plat.height);
            if (p >= 1) { m.plat.dy = 0; lobbyMotions.splice(i, 1); }
        }

        for (const [pid, p] of players) {
            const previous = { x: p.ball.x, y: p.ball.y };
            stepBall(p.ball, p.input, worldBounds, dt);
            p.input.jump = false;
            tryShoot(p.ball, p.input, time);
            stepProjectiles(p.ball, platformsObj, worldBounds);
            platformsObj.checkBallPlatforms(p.ball, previous);
            if (p.ball.y > lavaY) p.ball.radius /= 1.01;
        }

        if (mode === 'pvp') checkPlayerProjectileHits();

        for (const [id, p] of players) {
            if (p.ball.dead) {
                deadPlayerIds.push(id);
                const score = p.ball.score;
                p.ball = createBall(p.ball.id, worldBounds);
                p.ball.score = Math.floor(score / 2);
            }
        }

        spawnEnemy();
        const activeBalls = balls();
        for (let i = lavaSquares.length - 1; i >= 0; i--) {
            lavaSquares[i].stepMP(activeBalls, platformsObj, consumables, lavaSquares);
        }
        updateConsumables(activeBalls);
        return deadPlayerIds;
    }

    // Host-gated start: true if player `id`'s projectile is overlapping the START button (which
    // sits on the host's side of the wall). The projectile is consumed so one shot begins one
    // round. The server only ever calls this for the host during staging.
    function checkStartHit(id) {
        const p = players.get(id);
        if (!p) return false;
        const b = LOBBY.startBtn;
        for (let i = p.ball.projectiles.length - 1; i >= 0; i--) {
            const pr = p.ball.projectiles[i];
            if (pr.x + pr.radius > b.x && pr.x - pr.radius < b.x + b.w &&
                pr.y + pr.radius > b.y && pr.y - pr.radius < b.y + b.h) {
                p.ball.projectiles.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    // Consume guest attempts that reach either the divider or START itself. Layout changes can
    // make one path possible without the other, but both should trigger the alternate messages.
    function checkGuestBlockHit(hostId) {
        const start = LOBBY.startBtn;
        for (const [id, player] of players) {
            if (id === hostId) continue;
            for (let i = player.ball.projectiles.length - 1; i >= 0; i--) {
                const pr = player.ball.projectiles[i];
                const hitDivider = lobbyFixtures.some(({ plat }) =>
                    pr.x + pr.radius > plat.x && pr.x - pr.radius < plat.x + plat.width &&
                    pr.y + pr.radius > plat.y && pr.y - pr.radius < plat.y + plat.height);
                const hitStart =
                    pr.x + pr.radius > start.x && pr.x - pr.radius < start.x + start.w &&
                    pr.y + pr.radius > start.y && pr.y - pr.radius < start.y + start.h;
                if (!hitDivider && !hitStart) continue;
                player.ball.projectiles.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    // Start is a visible world event: remove every staging surface together, then let the same
    // authoritative balls fall while the server prepares the seeded arena.
    function breakLobbyPlatforms() {
        for (const pad of lobbyPads) platformsObj.removePlatform(pad);
        for (const fixture of lobbyFixtures) platformsObj.removePlatform(fixture.plat);
        lobbyPads.length = 0;
        lobbyFixtures.length = 0;
        lobbyMotions.length = 0;
        for (const { ball } of players.values()) ball.isGameRunning = true;
    }

    function checkPlayerProjectileHits() {
        for (const [ownerId, owner] of players) {
            for (let i = owner.ball.projectiles.length - 1; i >= 0; i--) {
                const projectile = owner.ball.projectiles[i];
                for (const [targetId, target] of players) {
                    if (targetId === ownerId) continue;
                    if (Math.hypot(projectile.x - target.ball.x, projectile.y - target.ball.y) >=
                        projectile.radius + target.ball.radius) continue;
                    target.ball.radius = removeArea(target.ball.radius,
                        projectile.damage ?? projectile.radius * projectile.radius);
                    owner.ball.score += projectile.enemyDamage ?? 0.5;
                    owner.ball.projectiles.splice(i, 1);
                    break;
                }
            }
        }
    }

    // Consumables home toward the nearest player; any player's projectiles knock them,
    // any player can pick them up, and lava squares can eat them.
    function updateConsumables(activeBalls) {
        for (let i = consumables.length - 1; i >= 0; i--) {
            const c = consumables[i];
            const target = nearest(activeBalls, c);
            if (target) {
                const a = Math.atan2(target.y - c.y - c.size / 2, target.x - c.x - c.size / 2);
                c.x += c.dx + c.xPhysics;
                if (c.speed > 0) { c.dy = Math.sin(a) * c.speed; c.dx = Math.cos(a) * c.speed; }
                c.y += c.dy + c.yPhysics;
            }

            for (const ball of activeBalls) {
                for (const pr of ball.projectiles) {
                    if (pr.x + pr.radius > c.x && pr.x - pr.radius < c.x + c.size &&
                        pr.y + pr.radius > c.y && pr.y - pr.radius < c.y + c.size) {
                        c.speed += pr.radius / 10;
                        pr.dx = -pr.dx; pr.dy = -pr.dy;
                    }
                }
            }

            physics(c);
            const nearbyPlatforms = platformsObj.getNearbyPlatforms(c.x, c.y, c.size, c.size);
            let remove = c.update(nearbyPlatforms, worldBounds, null);

            for (const ball of activeBalls) {
                if (c.checkCollision(ball)) {
                    ball.score += c.size;
                    ball.radius += c.size / 6;
                    remove = true;
                    break;
                }
            }
            if (c.checkEnContact(lavaSquares)) remove = true;
            if (remove) consumables.splice(i, 1);
        }
    }

    function nearest(activeBalls, obj) {
        let best = null, bd = Infinity;
        for (const b of activeBalls) {
            const d = Math.hypot(b.x - obj.x, b.y - obj.y);
            if (d < bd) { bd = d; best = b; }
        }
        return best;
    }

    function snapshot() {
        return {
            players: balls().map(ball => ({
                id: ball.id, x: ball.x, y: ball.y, radius: ball.radius,
                dx: ball.dx, dy: ball.dy, angle: ball.angle, score: ball.score,
                currentStock: ball.currentStock, maxStock: ball.maxStock, strength: ball.strength,
                shotRange: ball.shotRange,
                projectiles: ball.projectiles.map(p => ({
                    id: p.id, x: p.x, y: p.y, radius: p.radius, shotRange: p.shotRange
                }))
            })),
            platforms: platformsObj.platforms.map(pl => ({
                x: pl.x, y: pl.y, width: pl.width, height: pl.height, color: pl.color,
                hitRectangles: pl.hitRectangles
            })),
            enemies: lavaSquares.map(s => ({
                id: s.id, x: s.x, y: s.y, size: s.size, angle: s.angle,
                hitCount: s.hitCount, health: s.health
            })),
            consumables: consumables.map(c => ({ x: c.x, y: c.y, size: c.size, shape: c.shape, color: c.color })),
            lavaY
        };
    }

    // What actually goes over the wire. Platform geometry is omitted entirely — every client
    // regenerates it from `seed` — leaving only what can't be derived: damage and runtime pads.
    // This is ~82% of the old payload removed.
    function netSnapshot() {
        const { platforms, ...rest } = snapshot();
        return { ...rest, seed, damage: platformsObj.damage(), extras: platformsObj.extras() };
    }

    return {
        addPlayer, addLobbyPlayer, removePlayer, reassignLobbySlots, setInput, tick, snapshot, netSnapshot, players, mode, seed,
        checkStartHit, checkGuestBlockHit, breakLobbyPlatforms,
        setPeaceful: v => { peaceful = v; },
        addPlatform: (x, y, w, h) => platformsObj.addPlatform(x, y, w, h),
        removePlatform: p => platformsObj.removePlatform(p)
    };
}
