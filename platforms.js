// filepath: /h:/Downloads/PLATZIO/platforms.js
import { Splash } from './splash.js';
import { ballHarming } from './damage.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';
import { mulberry32 } from './sim/rng.js';

// Base platform: geometry, damage state and the splash/debris visuals. Movement lives in
// subclasses — the base itself never moves, so `dy`/`yPhysics` stay 0 unless a kind sets them.
class Platform {
    constructor(x, y, width, height, canvas, index = -1) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.dx = 0;
        this.dy = 0;
        this.xPhysics = 0;
        this.yPhysics = 0;
        this.hits = 0;
        this.color = '#354859';
        this.hitRectangles = [];
        this.harmssquares = false;
        this.size = width * height;
        this.toRemove = false;
        this.canvas = canvas;
        this.splashes = [];
        // Seed-generated platforms carry their generation index, which is how the server
        // addresses them when syncing damage. Runtime-added ones (menu rock, lobby pads) use -1.
        this.index = index;
        this.id = index >= 0 ? `s${index}` : `r${++Platform.runtimeIds}`;
    }

    generateSplashes(tOrB) {
        if (!this.canvas) return;
        for (let i = 0; i < 5; i++) {
            const splash = new Splash(
                this.x + Math.random() * this.width,
                this.y + tOrB * this.height,
                this.width * this.height / 300,
                this.color,
                'square',
                Math.random() * this.width / 10 - this.width / 20,
                this.yPhysics * 3,
                this.width / 30
            );
            this.splashes.push(splash);
        }
    }
    
    hitPlatform(tOrB = 1) {
        this.hits++;
        
        if (this.hits === 1) {
            this.generateHitRectangles(0.5);
            this.generateSplashes(tOrB);
        } else if (this.hits === 2) {
            this.hitRectangles = [];
            this.color = 'grey';
            this.generateSplashes(tOrB);
        } else if (this.hits >= 3) {
            this.toRemove = true;
            this.generateSplashes(tOrB);
        }
    }
    
    generateHitRectangles(percentage) {
        if (!this.canvas) return;
        const totalArea = this.width * this.height;
        const areaToFill = totalArea * percentage;
        let filledArea = 0;
        
        this.hitRectangles = [];
        while (filledArea < areaToFill) {
            const rectWidth = Math.random() * (this.width / 4) + 5;
            const rectHeight = Math.random() * (this.height / 2) + 5;
            const rectX = Math.random() * (this.width - rectWidth);
            const rectY = Math.random() * (this.height - rectHeight);
            
            this.hitRectangles.push({ x: rectX, y: rectY, width: rectWidth, height: rectHeight });
            filledArea += rectWidth * rectHeight;
        }
    }
}
Platform.runtimeIds = 0;

// The only kind the game uses now. Static: seed-placed, never drifts, never respawns — the
// arena only ever degrades as platforms are destroyed, which is the round's pressure gradient.
class StaticPlatform extends Platform {}

export function setupPlatforms(canvas, worldBounds, seed = 1) {
    const platforms = [];
    const genPlatSplashes = [];
    const spatialGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE);
    // Destruction is permanent, and state is only broadcast every few ticks — so remember which
    // seeded platforms are gone rather than deriving it from the live list, which would let a
    // destruction that happened between broadcasts go unreported and desync the client forever.
    const destroyed = new Set();

    function destroySplashes(platform, tOrB) {
        if (!canvas) return;
        for (const direction of [1, -1]) {
            for (let i = 0; i < 3; i++) {
                genPlatSplashes.push(new Splash(
                    platform.x + Math.random() * platform.width,
                    platform.y + tOrB * platform.height,
                    platform.width * platform.height / 300,
                    'grey',
                    'square',
                    Math.random() * direction * platform.width / 5,
                    platform.yPhysics * 3,
                    platform.width / 30
                ));
            }
        }
    }
    
    // Keeps platforms off the left/right centre line so the middle stays open.
    function genSidePlatX(rng) {
        const margin = (worldBounds.right / 25) + (worldBounds.right / 40);
        if (rng() > 0.5) return rng() * ((worldBounds.right / 2) - margin * 2);
        return rng() * ((worldBounds.right / 2) - margin) + margin + (worldBounds.right / 2);
    }

    // Deterministic from `seed`: same seed -> same arena on every client and on the server,
    // which is why platform geometry never has to travel over the network.
    function generatePlatforms() {
        const rng = mulberry32(seed);
        platforms.length = 0;
        spatialGrid.clear();

        const add = platform => {
            platforms.push(platform);
            spatialGrid.insert(platform, platform.x, platform.y, platform.width, platform.height);
        };

        for (let i = 0; i < GAME_CONFIG.PLATFORM_COUNT; i++) {
            add(new StaticPlatform(
                genSidePlatX(rng),
                GAME_CONFIG.MENU_HEADROOM + rng() * (worldBounds.bottom - 100 - GAME_CONFIG.MENU_HEADROOM),
                rng() * (worldBounds.right / 25) + (worldBounds.right / 40),
                rng() * (worldBounds.bottom / 170) + (worldBounds.bottom / 90),
                canvas, i
            ));
        }
        // The wide centre platform you land on out of the menu.
        add(new StaticPlatform(
            worldBounds.right / 2 - (worldBounds.right / 120),
            worldBounds.bottom / 1.6,
            worldBounds.right / 60,
            worldBounds.bottom / 30,
            canvas, GAME_CONFIG.PLATFORM_COUNT
        ));

    }

    function drawPlatforms(ctx) {
        // Draw platform splashes
        if (genPlatSplashes.length > 0) {
            ctx.save();
            ctx.fillStyle = 'grey';
            genPlatSplashes.forEach(splash => {
                splash.draw(ctx);
            });
            ctx.restore();
        }
        
        // Draw platforms
        ctx.save();
        platforms.forEach(platform => {
            // Draw platform body
            ctx.fillStyle = platform.color;
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
            
            // Draw platform shadow
            ctx.fillStyle = 'grey';
            ctx.fillRect(platform.x, platform.y + platform.height, platform.width, 2);
            
            // Draw hit rectangles
            if (platform.hitRectangles.length > 0) {
                ctx.fillStyle = 'grey';
                platform.hitRectangles.forEach(rect => {
                    ctx.fillRect(platform.x + rect.x, platform.y + rect.y, rect.width, rect.height);
                });
            }
            
            // Draw platform splashes
            platform.splashes.forEach(splash => splash.draw(ctx));
        });
        ctx.restore();
    }
    
// Single-player entry point: move platforms once, then collide the one ball.
// The authoritative World calls the two halves separately (movement once per tick,
// then ball-collision for each connected player).
function updatePlatforms(ball) {
    updatePlatformsMovement();
    checkBallPlatformCollisions(ball, null);
}

// Ball-independent platform update. Platforms are static now, so this is only debris animation
// and retiring platforms that combat has destroyed — no drift, no respawn, no platform-platform
// collisions, and the spatial grid is built once and never moved.
function updatePlatformsMovement() {
    for (let i = genPlatSplashes.length - 1; i >= 0; i--) {
        genPlatSplashes[i].update();
        if (genPlatSplashes[i].isFinished()) genPlatSplashes.splice(i, 1);
    }

    for (let i = platforms.length - 1; i >= 0; i--) {
        const platform = platforms[i];
        if (platform.toRemove) {
            if (platform.index >= 0) destroyed.add(platform.index);
            spatialGrid.remove(platform);
            platforms.splice(i, 1);
            continue;
        }
        for (let j = platform.splashes.length - 1; j >= 0; j--) {
            platform.splashes[j].update();
            if (platform.splashes[j].isFinished()) platform.splashes.splice(j, 1);
        }
    }
}

function checkBallPlatformCollisions(ball, canvas) {
    // Get platforms near the ball using spatial grid
    const nearbyPlatforms = spatialGrid.getNearby(
        ball.x - ball.radius,
        ball.y - ball.radius,
        ball.radius * 2,
        ball.radius * 2
    );
    
    for (const platform of nearbyPlatforms) {
        const top = platform.y;
        const bottom = platform.y + platform.height;
        const left = platform.x;
        const right = platform.x + platform.width;
        
        // Left collision
        if (ball.x + ball.radius > left && ball.x < left && 
            ball.y + ball.radius > top && ball.y - ball.radius < bottom && 
            ball.dx >= 0 && (ball.y + ball.radius > bottom + ball.radius / 20 || ball.radius < platform.height)) {
            platform.xPhysics = ball.dx / 1.5;
            ball.strength -= 0.5;
            spatialGrid.update(platform, platform.x, platform.y, platform.width, platform.height);
        }
        
        // Right collision
        if (ball.x - ball.radius < right && ball.x > right && 
            ball.y + ball.radius > top && ball.y - ball.radius < bottom && 
            ball.dx <= 0 && (ball.y + ball.radius > bottom + ball.radius / 20 || ball.radius < platform.height)) {
            platform.xPhysics = ball.dx / 1.5;
            ball.strength -= 0.5;
            spatialGrid.update(platform, platform.x, platform.y, platform.width, platform.height);
        }
        
        // Top collision
        if (ball.y + ball.radius > top && ball.y < top) {
            if (ball.x + ball.radius >= left && ball.x - ball.radius <= right) {
                if (right < ball.x) {
                    ball.y = top - Math.sqrt(Math.max(0, ball.radius ** 2 - (right - ball.x) ** 2));
                    ball.xPhysics += (ball.x - right) / 500 + ball.dy / 10;
                } else if (left > ball.x) {
                    ball.y = top - Math.sqrt(Math.max(0, ball.radius ** 2 - (ball.x - left) ** 2));
                    ball.xPhysics += (ball.x - left) / 500 - ball.dy / 10;
                } else {
                    ball.y = top - ball.radius;
                }
                
                if (ball.dy * ball.radius > platform.size / 12) {
                    platform.yPhysics += ball.dy;
                    ball.strength -= 0.8;
                    platform.updated = true;
                    platform.hitPlatform(1);
                    if (!ball.isGameRunning) { ball.isGameRunning = true; }
                    if (platform.hits < 2) {
                        ball.dy = Math.abs(ball.dy / 5);
                    } else {
                        platform.yPhysics = ball.dy;
                        ball.dy = Math.abs(ball.dy / 2);
                        destroySplashes(platform, 1);
                    }
                } else {
                    ball.dy = platform.dy;
                }
                
                ball.canDoubleJump = true;
                ball.isJumping = false;
            }
        }
        // Bottom collision
        else if (ball.y - ball.radius < bottom && ball.y > bottom) {
            if ((ball.x >= left && ball.x <= right) || 
                (right < ball.x && ball.radius >= Math.sqrt((ball.x - right) ** 2 + (ball.y - bottom) ** 2) || 
                 (left > ball.x && ball.radius >= Math.sqrt((left - ball.x) ** 2 + (ball.y - bottom) ** 2)))) {
                
                if (ball.dy * ball.radius < -platform.size / 25) {
                    platform.yPhysics = ball.dy * 1.6;
                    platform.updated = true;
                    ball.strength -= 0.8;
                    platform.hitPlatform(0);
                    ball.canDoubleJump = false;
                    if (platform.hits < 2) {
                        ball.dy = Math.abs(ball.dy / 2) + platform.dy;
                    } else {
                        destroySplashes(platform, 0);
                        ball.dy = ball.dy / 1.5;
                    }
                } else {
                    if (ball.dy < platform.dy && ball.dy > GAME_CONFIG.REF_HEIGHT / 2000) {
                        ballHarming(ball);
                        if (canvas) genPlatSplashes.push(new Splash(ball.x, ball.y, ball.radius, 'white'));
                    } else {
                        ball.dy = Math.abs(ball.dy / 2) + platform.dy;
                    }
                }
                ball.isJumping = true;
            }
        }
    }
}
        
    // Inject/remove a platform that isn't part of the seeded arena (menu rock, lobby pads).
    // These DO travel over the network, since no client can derive them from the seed.
    function addPlatform(x, y, width, height) {
        const platform = new StaticPlatform(x, y, width, height, canvas);
        platforms.push(platform);
        spatialGrid.insert(platform, x, y, width, height);
        return platform;
    }
    function removePlatform(platform) {
        const i = platforms.indexOf(platform);
        if (i < 0) return;
        spatialGrid.remove(platform);
        platforms.splice(i, 1);
    }

    // --- network sync. Seeded geometry never travels; only what a client can't derive does. ---
    // Damage to seeded platforms, sparse: [[index, hits], ...]. Usually empty. Includes
    // already-destroyed ones so a client that missed the destroying frame still catches up.
    const damage = () => [
        ...platforms.filter(p => p.index >= 0 && p.hits > 0).map(p => [p.index, p.hits]),
        ...[...destroyed].map(i => [i, 3])
    ];
    // Runtime platforms in full — there are only ever a handful.
    const extras = () => platforms.filter(p => p.index < 0)
        .map(p => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height }));

    // Client side: fold the server's damage/extras back onto the locally generated arena.
    function applySync(damageList = [], extraList = []) {
        const hitsFor = new Map(damageList);
        for (let i = platforms.length - 1; i >= 0; i--) {
            const p = platforms[i];
            if (p.index < 0) { removePlatform(p); continue; }   // rebuilt from extraList below
            const hits = hitsFor.get(p.index) ?? 0;
            if (hits === p.hits) continue;
            p.hits = hits;
            p.color = hits >= 2 ? 'grey' : '#354859';
            if (hits === 1) p.generateHitRectangles(0.5); else p.hitRectangles = [];
        }
        // Destroyed platforms are simply absent from the arena once hits hit 3.
        for (let i = platforms.length - 1; i >= 0; i--) {
            if (platforms[i].index >= 0 && platforms[i].hits >= 3) removePlatform(platforms[i]);
        }
        for (const e of extraList) addPlatform(e.x, e.y, e.width, e.height);
    }

    generatePlatforms();
    return {
        platforms,
        addPlatform,
        removePlatform,
        drawPlatforms,
        generatePlatforms,
        updatePlatforms,                                  // single-player: movement + one ball
        updatePlatformsMovement,                          // multiplayer: movement once per tick
        checkBallPlatforms: (ball) => checkBallPlatformCollisions(ball, null), // then per player
        damage,
        extras,
        applySync,
        getSpatialGridStats: () => spatialGrid.stats,
        getNearbyPlatforms: (x, y, width, height) => spatialGrid.getNearby(x, y, width, height),
        spatialGrid
    };
}
