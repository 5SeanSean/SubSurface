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

const SPAWN_INTERVAL = 4000;
const H = GAME_CONFIG.REF_HEIGHT;
const ALLOWED_KEYS = new Set(['a', 'd', 's', 'w', 'arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ']);

// Lobby staging layout: players lower in on a small pad, left-to-right in join order,
// the host (index 0) centered, each pad stopping at a common resting level.
const LOBBY_Y = worldBounds.bottom * 0.42;   // resting top-of-pad level
const LOBBY_X0 = worldBounds.right / 2;       // host column (centered)
const LOBBY_DX = H * 0.85;                     // horizontal gap between players
const LOBBY_DROP = H * 2.5;                     // how far above the rest level a pad starts
const LOBBY_SPEED = H / 130;                    // descent per tick

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

    const lobbyPads = new Map(); // id -> descending pad platform
    const descending = new Set(); // ids still lowering in

    // Lobby: a calm shared arena — no auto-generated level, no enemies. Players arrive via
    // addLobbyPlayer and lower in on their own pad.
    if (lobby) {
        peaceful = true;
        platformsObj.platforms.length = 0;
        platformsObj.spatialGrid.clear();
    }

    const emptyInput = () => ({ keys: new Set(), shooting: false, jump: false, aim: 0 });
    const balls = () => [...players.values()].map(p => p.ball);

    function addPlayer(id) {
        players.set(id, { ball: createBall(id, worldBounds), input: emptyInput() });
    }
    // Add a player who lowers in on a pad at slot `index` (0 = host, centered).
    function addLobbyPlayer(id, index = players.size) {
        addPlayer(id);
        const b = players.get(id).ball;
        const padW = b.radius * 3, padH = H / 45;
        const x = LOBBY_X0 + index * LOBBY_DX;
        const pad = platformsObj.addPlatform(x - padW / 2, LOBBY_Y - LOBBY_DROP, padW, padH);
        b.x = x; b.y = pad.y - b.radius; b.dx = b.dy = 0; b.isGameRunning = false;
        lobbyPads.set(id, pad);
        descending.add(id);
    }
    function removePlayer(id) {
        players.delete(id);
        const pad = lobbyPads.get(id);
        if (pad) { platformsObj.removePlatform(pad); lobbyPads.delete(id); }
        descending.delete(id);
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
        const near = balls()[Math.floor(Math.random() * players.size)]; // spawn beside a random player
        const x = Math.random() > 0.5 ? near.x + 500 : near.x - 500;
        const size = Math.random() * (H / 30) + (H / 20);
        const speed = Math.random() * H / 700 + H / 700;
        const angle = Math.random() * Math.PI * 2;
        lavaSquares.push(new LavaSquare(x, worldBounds.bottom, size, speed,
            worldBounds, null, angle, 2, { spatialGrid: enemyGrid }));
    }

    function tick(dt) {
        time += dt;
        const deadPlayerIds = [];
        platformsObj.updatePlatformsMovement();

        // Lobby descent: carry each lowering player down on their pad until it reaches the rest level.
        for (const id of [...descending]) {
            const pad = lobbyPads.get(id), b = players.get(id).ball;
            pad.y = Math.min(LOBBY_Y, pad.y + LOBBY_SPEED);
            b.x = pad.x + pad.width / 2; b.y = pad.y - b.radius; b.dx = b.dy = 0;
            if (pad.y >= LOBBY_Y) { descending.delete(id); b.isGameRunning = true; }
        }

        for (const [pid, p] of players) {
            if (descending.has(pid)) continue;   // frozen while lowering in
            stepBall(p.ball, p.input, worldBounds);
            p.input.jump = false;
            tryShoot(p.ball, p.input, time);
            stepProjectiles(p.ball, platformsObj, worldBounds);
            platformsObj.checkBallPlatforms(p.ball);
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

    function checkPlayerProjectileHits() {
        for (const [ownerId, owner] of players) {
            for (let i = owner.ball.projectiles.length - 1; i >= 0; i--) {
                const projectile = owner.ball.projectiles[i];
                for (const [targetId, target] of players) {
                    if (targetId === ownerId) continue;
                    if (Math.hypot(projectile.x - target.ball.x, projectile.y - target.ball.y) >=
                        projectile.radius + target.ball.radius) continue;
                    target.ball.radius /= 1.01;
                    owner.ball.score += 0.5;
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
                projectiles: ball.projectiles.map(p => ({ x: p.x, y: p.y, radius: p.radius }))
            })),
            platforms: platformsObj.platforms.map(pl => ({
                x: pl.x, y: pl.y, width: pl.width, height: pl.height, color: pl.color
            })),
            enemies: lavaSquares.map(s => ({
                id: s.id, x: s.x, y: s.y, size: s.size, angle: s.angle, stickColor: s.stickColor,
                hitCount: s.hitCount, health: s.health, armLength: s.armLength, mouthWidth: s.mouthWidth,
                targetRadius: s.targetRadius, sucking: s.sucking
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
        addPlayer, addLobbyPlayer, removePlayer, setInput, tick, snapshot, netSnapshot, players, mode, seed,
        setPeaceful: v => { peaceful = v; },
        addPlatform: (x, y, w, h) => platformsObj.addPlatform(x, y, w, h),
        removePlatform: p => platformsObj.removePlatform(p)
    };
}
