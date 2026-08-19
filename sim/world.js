// Authoritative game world — runs headless on the server (and, later, locally for
// single-player). Owns all players and the shared level, advances one fixed tick at a
// time, and produces serializable snapshots to broadcast to clients.
//
// Now includes the full game: players, platforms, projectiles, enemies (lava squares
// targeting the nearest player), consumables, and the bottom lava.
import { worldBounds } from '../view.js';
import { now } from '../clock.js';
import { GAME_CONFIG } from '../config.js';
import { physics } from '../physics.js';
import { setupPlatforms } from '../platforms.js';
import { LavaSquare } from '../lavaSquareEnemies.js';
import { createLava } from '../lava.js';
import { createBall, stepBall, tryShoot, stepProjectiles } from './ball.js';

const SPAWN_INTERVAL = 4000;
const H = GAME_CONFIG.REF_HEIGHT;

export function createWorld() {
    const platformsObj = setupPlatforms(null, worldBounds); // null canvas: server never draws
    const lava = createLava(worldBounds, null);
    const players = new Map(); // id -> { ball, input }
    const lavaSquares = [];
    const consumables = [];
    let lastSpawn = 0;

    const emptyInput = () => ({ keys: new Set(), shooting: false, jump: false, aim: 0 });
    const balls = () => [...players.values()].map(p => p.ball);

    function addPlayer(id) {
        players.set(id, { ball: createBall(id, worldBounds), input: emptyInput() });
    }
    function removePlayer(id) { players.delete(id); }

    function setInput(id, msg) {
        const p = players.get(id);
        if (!p) return;
        p.input.keys = new Set(msg.keys || []);
        p.input.shooting = !!msg.shooting;
        p.input.aim = typeof msg.aim === 'number' ? msg.aim : p.input.aim;
        if (msg.jump) p.input.jump = true; // edge; consumed in tick()
    }

    function spawnEnemy() {
        if (now() - lastSpawn < SPAWN_INTERVAL || lavaSquares.length >= GAME_CONFIG.MAX_LAVA_SQUARES) return;
        if (players.size === 0) return;
        lastSpawn = now();
        const near = balls()[Math.floor(Math.random() * players.size)]; // spawn beside a random player
        const x = Math.random() > 0.5 ? near.x + 500 : near.x - 500;
        const size = Math.random() * (H / 30) + (H / 20);
        const speed = Math.random() * H / 700 + H / 700;
        const angle = Math.random() * Math.PI * 2;
        lavaSquares.push(new LavaSquare(x, worldBounds.bottom, size, speed, speed * 1.1,
            Math.random() * 1000 + 4000, worldBounds, null, angle, 2));
    }

    function tick(dt) {
        platformsObj.updatePlatformsMovement();

        for (const p of players.values()) {
            stepBall(p.ball, p.input, worldBounds);
            p.input.jump = false;
            tryShoot(p.ball, p.input);
            stepProjectiles(p.ball, platformsObj, worldBounds);
            platformsObj.checkBallPlatforms(p.ball);
            lava.handleCollision(p.ball);
            if (p.ball.dead) {
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
        lava.update(consumables);
        updateConsumables(activeBalls);
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
                angle: ball.angle, score: ball.score,
                currentStock: ball.currentStock, strength: ball.strength,
                projectiles: ball.projectiles.map(p => ({ x: p.x, y: p.y, radius: p.radius }))
            })),
            platforms: platformsObj.platforms.map(pl => ({
                x: pl.x, y: pl.y, width: pl.width, height: pl.height, color: pl.color
            })),
            enemies: lavaSquares.map(s => ({
                x: s.x, y: s.y, size: s.size, angle: s.angle,
                hitCount: s.hitCount, health: s.health,
                projectiles: s.projectiles.map(p => ({ x: p.x, y: p.y, radius: p.radius }))
            })),
            consumables: consumables.map(c => ({ x: c.x, y: c.y, size: c.size, shape: c.shape, color: c.color })),
            lavaY: lava.y
        };
    }

    return { addPlayer, removePlayer, setInput, tick, snapshot, players };
}
