// filepath: /h:/Downloads/SUBSURFACE/platforms.js
import { Splash } from './splash.js';
import { ballHarming } from './damage.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';
import { mulberry32 } from './sim/rng.js';
import { playerArm } from './sim/playerGeometry.js';
import { drawPlatformMaterial } from './materials.js';

export const PLATFORM_MAX_HITS = 3;

// Base platform: immutable geometry, damage state, and splash/debris visuals.
class Platform {
    constructor(x, y, width, height, canvas, index = -1, seed = 0, onDestroyed = null, runtimeId = null) {
        // Own deterministic stream, so the crack pattern a platform shows when damaged is
        // identical on every client instead of each one inventing its own.
        this.rng = mulberry32((seed + index * 2654435761) >>> 0);
        // Material detail has an independent stream: adding or changing cosmetic grains must
        // never perturb the damage rectangles generated from this.rng.
        const materialSeed = (seed ^ Math.imul(index + 2, 0x6D2B79F5) ^
            Math.imul(Math.floor(x), 0x1B873593) ^ Math.imul(Math.floor(y), 0x85EBCA6B)) >>> 0;
        const materialRng = mulberry32(materialSeed);
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.hits = 0;
        this.color = '#aaa7a1';
        this.materialFlecks = [];
        this.materialVeins = [];
        const fleckCount = Math.max(5, Math.min(34, Math.round(width * height / 900)));
        for (let i = 0; i < fleckCount; i++) this.materialFlecks.push({
            x: materialRng() * width,
            y: materialRng() * height,
            rx: 1 + materialRng() * Math.min(7, height * 0.16),
            ry: 0.6 + materialRng() * Math.min(3, height * 0.08),
            angle: materialRng() * Math.PI,
            light: materialRng() > 0.62
        });
        const veinCount = 1 + Math.floor(materialRng() * 3);
        for (let i = 0; i < veinCount; i++) {
            const points = [];
            let vx = materialRng() * width, vy = materialRng() * height;
            for (let j = 0; j < 3 + Math.floor(materialRng() * 3); j++) {
                points.push({ x: vx, y: vy });
                vx += (materialRng() - 0.5) * width * 0.22;
                vy += (materialRng() - 0.5) * height * 0.45;
            }
            this.materialVeins.push(points);
        }
        this.hitRectangles = [];
        this.harmssquares = false;
        this.size = width * height;
        this.destroyed = false;
        this.onDestroyed = onDestroyed;
        this.canvas = canvas;
        this.splashes = [];
        // Seed-generated platforms carry their generation index, which is how the server
        // addresses them when syncing damage. Runtime-added ones (menu rock, lobby pads) use -1.
        this.index = index;
        this.id = index >= 0 ? `s${index}` : (runtimeId ?? `r${++Platform.runtimeIds}`);
    }

    generateSplashes(tOrB, impactY = 0) {
        if (!this.canvas) return;
        for (let i = 0; i < 5; i++) {
            const splash = new Splash(
                this.x + Math.random() * this.width,
                this.y + tOrB * this.height,
                this.width * this.height / 300,
                this.color,
                'square',
                Math.random() * this.width / 10 - this.width / 20,
                impactY * 3,
                this.width / 30
            );
            this.splashes.push(splash);
        }
    }
    
    hitPlatform(tOrB = 1, impactY = 0) {
        if (this.destroyed) return false;
        this.hits++;
        
        if (this.hits === 1) {
            this.generateHitRectangles(0.5);
            this.generateSplashes(tOrB, impactY);
        } else if (this.hits === 2) {
            this.hitRectangles = [];
            this.color = 'grey';
            this.generateSplashes(tOrB, impactY);
        } else if (this.hits >= PLATFORM_MAX_HITS) {
            this.destroyed = true;
            this.generateSplashes(tOrB, impactY);
            this.onDestroyed?.(this);
        }
        return true;
    }
    
    generateHitRectangles(percentage) {
        if (!this.canvas) return;
        const totalArea = this.width * this.height;
        const areaToFill = totalArea * percentage;
        let filledArea = 0;
        
        this.hitRectangles = [];
        while (filledArea < areaToFill) {
            const rectWidth = this.rng() * (this.width / 4) + 5;
            const rectHeight = this.rng() * (this.height / 2) + 5;
            const rectX = this.rng() * (this.width - rectWidth);
            const rectY = this.rng() * (this.height - rectHeight);
            
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

    function destroySplashes(platform, tOrB, impactY = 0) {
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
                    impactY * 3,
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
        destroyed.clear();
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
                canvas, i, seed, retirePlatform
            ));
        }
        // The wide centre platform you land on out of the menu.
        add(new StaticPlatform(
            worldBounds.right / 2 - (worldBounds.right / 120),
            worldBounds.bottom / 1.6,
            worldBounds.right / 60,
            worldBounds.bottom / 30,
            canvas, GAME_CONFIG.PLATFORM_COUNT, seed, retirePlatform
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
            drawPlatformMaterial(ctx, platform);
            
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
        for (let j = platform.splashes.length - 1; j >= 0; j--) {
            platform.splashes[j].update();
            if (platform.splashes[j].isFinished()) platform.splashes.splice(j, 1);
        }
    }
}

function sweptCircleHit(previous, ball, platform) {
    const vx = ball.x - previous.x, vy = ball.y - previous.y;
    if (vx === 0 && vy === 0) return null;
    const minX = platform.x - ball.radius;
    const maxX = platform.x + platform.width + ball.radius;
    const minY = platform.y - ball.radius;
    const maxY = platform.y + platform.height + ball.radius;
    // Inclusive bounds: a body resting exactly on a face sits on this expanded box's edge.
    // With strict `<`/`>` that resting contact was read as a fresh entry, so jumping straight
    // up off a platform returned a false t=0 underside hit that snapped the body back down.
    if (previous.x >= minX && previous.x <= maxX && previous.y >= minY && previous.y <= maxY) return null;
    let enter = 0, exit = 1, normalX = 0, normalY = 0;

    for (const axis of [
        { origin: previous.x, delta: vx, min: minX, max: maxX, nx: -1, ny: 0 },
        { origin: previous.y, delta: vy, min: minY, max: maxY, nx: 0, ny: -1 }
    ]) {
        if (axis.delta === 0) {
            if (axis.origin < axis.min || axis.origin > axis.max) return null;
            continue;
        }
        let near = (axis.min - axis.origin) / axis.delta;
        let far = (axis.max - axis.origin) / axis.delta;
        let nx = axis.nx, ny = axis.ny;
        if (near > far) { [near, far] = [far, near]; nx = -nx; ny = -ny; }
        if (near > enter) { enter = near; normalX = nx; normalY = ny; }
        exit = Math.min(exit, far);
        if (enter > exit) return null;
    }
    return enter >= 0 && enter <= 1 ? { t: enter, x: normalX, y: normalY } : null;
}

function checkBallPlatformCollisions(ball, canvas, previous = null) {
    // Query the entire travel segment, not only the final position.
    const queryLeft = Math.min(previous?.x ?? ball.x, ball.x) - ball.radius;
    const queryTop = Math.min(previous?.y ?? ball.y, ball.y) - ball.radius;
    const queryRight = Math.max(previous?.x ?? ball.x, ball.x) + ball.radius;
    const queryBottom = Math.max(previous?.y ?? ball.y, ball.y) + ball.radius;
    const nearbyPlatforms = spatialGrid.getNearby(
        queryLeft, queryTop, queryRight - queryLeft, queryBottom - queryTop
    );
    nearbyPlatforms.sort((a, b) => {
        const overlap = p => ball.x + ball.radius > p.x && ball.x - ball.radius < p.x + p.width &&
            ball.y + ball.radius > p.y && ball.y - ball.radius < p.y + p.height;
        const ta = overlap(a) ? -1 : (previous ? sweptCircleHit(previous, ball, a)?.t ?? Infinity : Infinity);
        const tb = overlap(b) ? -1 : (previous ? sweptCircleHit(previous, ball, b)?.t ?? Infinity : Infinity);
        return ta - tb;
    });
    
    for (const platform of nearbyPlatforms) {
        if (platform.destroyed) continue;
        const top = platform.y;
        const bottom = platform.y + platform.height;
        const left = platform.x;
        const right = platform.x + platform.width;
        const overlapsNow = ball.x + ball.radius > left && ball.x - ball.radius < right &&
            ball.y + ball.radius > top && ball.y - ball.radius < bottom;
        if (!overlapsNow && previous) {
            const impact = sweptCircleHit(previous, ball, platform);
            if (!impact) continue;
            const vx = ball.x - previous.x, vy = ball.y - previous.y;
            ball.x = previous.x + vx * impact.t + impact.x * 0.01;
            ball.y = previous.y + vy * impact.t + impact.y * 0.01;
            if (impact.y < 0) {
                if (ball.dy * ball.radius > platform.size / 12) platform.hitPlatform(1, ball.dy);
                ball.dy = -Math.abs(ball.dy) / 2;
                ball.canDoubleJump = true;
                ball.isJumping = false;
            } else if (impact.y > 0) {
                if (ball.dy * ball.radius < -platform.size / 25) platform.hitPlatform(0, ball.dy);
                ball.dy = Math.abs(ball.dy) / 2;
                ball.isJumping = true;
            } else {
                ball.dx = impact.x < 0 ? -Math.abs(ball.dx) / 2 : Math.abs(ball.dx) / 2;
                ball.strength -= 0.5;
            }
            break;
        }

        // An upward impulse (recoil) must always be able to leave a platform. If accumulated
        // correction, resizing, or a corner impact put the body's centre inside the rectangle, the
        // normal face tests have no unambiguous side and used to leave the player trapped. Eject
        // upward and retain the upward impulse instead of treating it as another landing.
        if (overlapsNow && ball.dy < 0 &&
            ball.x > left && ball.x < right && ball.y >= top && ball.y <= bottom) {
            ball.y = top - ball.radius - 0.01;
            ball.yPhysics = Math.min(0, ball.yPhysics);
            ball.isJumping = true;
            break;
        }
        
        // Left collision
        if (ball.x + ball.radius > left && ball.x < left && 
            ball.y + ball.radius > top && ball.y - ball.radius < bottom && 
            ball.dx >= 0 && (ball.y + ball.radius > bottom + ball.radius / 20 || ball.radius < platform.height)) {
            ball.strength -= 0.5;
        }
        
        // Right collision
        if (ball.x - ball.radius < right && ball.x > right && 
            ball.y + ball.radius > top && ball.y - ball.radius < bottom && 
            ball.dx <= 0 && (ball.y + ball.radius > bottom + ball.radius / 20 || ball.radius < platform.height)) {
            ball.strength -= 0.5;
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
                
                if (ball.jumpedThisTick && ball.dy < 0) {
                    // Positional correction may still be necessary for a slightly embedded
                    // resting body, but it must not cancel the upward velocity just requested.
                    ball.isJumping = true;
                } else if (ball.dy * ball.radius > platform.size / 12) {
                    ball.strength -= 0.8;
                    platform.hitPlatform(1, ball.dy);
                    if (!ball.isGameRunning) { ball.isGameRunning = true; }
                    if (platform.hits < 2) {
                        ball.dy = Math.abs(ball.dy / 5);
                    } else {
                        ball.dy = Math.abs(ball.dy / 2);
                        destroySplashes(platform, 1, ball.dy);
                    }
                } else {
                    ball.dy = 0;
                }
                
                if (!ball.jumpedThisTick) {
                    ball.canDoubleJump = true;
                    ball.isJumping = false;
                }
            }
        }
        // Bottom collision
        else if (ball.y - ball.radius < bottom && ball.y > bottom) {
            if ((ball.x >= left && ball.x <= right) || 
                (right < ball.x && ball.radius >= Math.sqrt((ball.x - right) ** 2 + (ball.y - bottom) ** 2) || 
                 (left > ball.x && ball.radius >= Math.sqrt((left - ball.x) ** 2 + (ball.y - bottom) ** 2)))) {
                
                if (ball.dy * ball.radius < -platform.size / 25) {
                    ball.strength -= 0.8;
                    platform.hitPlatform(0, ball.dy);
                    ball.canDoubleJump = false;
                    if (platform.hits < 2) {
                        ball.dy = Math.abs(ball.dy / 2);
                    } else {
                        destroySplashes(platform, 0, ball.dy);
                        ball.dy = ball.dy / 1.5;
                    }
                } else {
                    if (ball.dy < 0 && ball.dy > GAME_CONFIG.REF_HEIGHT / 2000) {
                        ballHarming(ball);
                        if (canvas) genPlatSplashes.push(new Splash(ball.x, ball.y, ball.radius, 'white'));
                    } else {
                        ball.dy = Math.abs(ball.dy / 2);
                    }
                }
                ball.isJumping = true;
            }
        }
    }
    checkArmPlatformCollisions(ball, previous);
}

const angleDelta = (from, to) => {
    let delta = (to - from) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
};

// Weight/torque limit on how hard the gun-arm can throw its owner. The arm has a fixed torque
// budget; the body is a mass proportional to its area, so a bigger (heavier) ball is flung
// slower and a smaller one (after shooting away area) is flung faster — the same torque acting
// on more or less inertia. Caps the launch speed the leverage/pivot arc hands back as velocity.
const REF_RADIUS = GAME_CONFIG.REF_HEIGHT / 18;      // ball's spawn radius (mass reference)
const ARM_MAX_THROW = GAME_CONFIG.REF_HEIGHT / 60;   // tip-speed ceiling at spawn weight (~4.5× walk)
function armThrowLimit(ball) {
    const mass = (ball.radius / REF_RADIUS) ** 2;    // ∝ area
    return ARM_MAX_THROW / Math.max(mass, 1e-6);     // torque ÷ inertia → speed cap
}
function limitArmThrow(ball) {
    const cap = armThrowLimit(ball);
    const speed = Math.hypot(ball.dx, ball.dy);
    if (speed > cap) { ball.dx *= cap / speed; ball.dy *= cap / speed; }
}

function segmentIntersectsRect(x1, y1, x2, y2, left, top, right, bottom) {
    let enter = 0, exit = 1;
    for (const [origin, delta, min, max] of [
        [x1, x2 - x1, left, right], [y1, y2 - y1, top, bottom]
    ]) {
        if (Math.abs(delta) < 1e-9) {
            if (origin <= min || origin >= max) return false;
            continue;
        }
        let near = (min - origin) / delta, far = (max - origin) / delta;
        if (near > far) [near, far] = [far, near];
        enter = Math.max(enter, near);
        exit = Math.min(exit, far);
        if (enter >= exit) return false;
    }
    return exit > 0 && enter < 1;
}

function armHitsPlatform(ball, angle, x = ball.x, y = ball.y) {
    const arm = playerArm({ ...ball, x, y, angle });
    // The body's circle owns the hidden root of the arm. Collision begins just outside it.
    const start = Math.min(1, (ball.radius + arm.radius) / Math.max(arm.length, 1));
    const x1 = arm.x1 + (arm.x2 - arm.x1) * start;
    const y1 = arm.y1 + (arm.y2 - arm.y1) * start;
    const left = Math.min(x1, arm.x2) - arm.radius;
    const top = Math.min(y1, arm.y2) - arm.radius;
    const width = Math.abs(arm.x2 - x1) + arm.radius * 2;
    const height = Math.abs(arm.y2 - y1) + arm.radius * 2;
    for (const p of spatialGrid.getNearby(left, top, width, height)) {
        if (!p.destroyed && segmentIntersectsRect(
            x1, y1, arm.x2, arm.y2,
            p.x - arm.radius, p.y - arm.radius,
            p.x + p.width + arm.radius, p.y + p.height + arm.radius
        )) return true;
    }
    return false;
}

// A downward-pointing arm can carry the player's weight when its capsule approaches a
// platform's top face from above. This is deliberately narrower than general arm collision:
// side and underside contacts must still deflect instead of pinning the body.
function armTopSupport(ball, angle, x = ball.x, y = ball.y) {
    const arm = playerArm({ ...ball, x, y, angle });
    const root = Math.min(1, (ball.radius + arm.radius) / Math.max(arm.length, 1));
    const x1 = arm.x1 + (arm.x2 - arm.x1) * root;
    const y1 = arm.y1 + (arm.y2 - arm.y1) * root;
    const rise = arm.y2 - y1;
    if (rise <= arm.radius) return null;
    const left = Math.min(x1, arm.x2) - arm.radius;
    const top = y1 - arm.radius;
    const width = Math.abs(arm.x2 - x1) + arm.radius * 2;
    const height = rise + arm.radius * 2;
    for (const p of spatialGrid.getNearby(left, top, width, height)) {
        if (p.destroyed) continue;
        const contactY = p.y - arm.radius;
        if (y1 > contactY || arm.y2 < contactY) continue;
        const t = (contactY - y1) / rise;
        const contactX = x1 + (arm.x2 - x1) * t;
        if (contactX >= p.x && contactX <= p.x + p.width) {
            const distance = Math.hypot(contactX - x, contactY - y);
            return { x: contactX, y: contactY, distance, platformId: p.id };
        }
    }
    return null;
}

const armHasTopSupport = (ball, angle, x = ball.x, y = ball.y) =>
    !!armTopSupport(ball, angle, x, y);

// How far the owner must rise for a downward arm aimed into a platform top to become a
// load-bearing brace. Contact anywhere along the exposed arm can support the player.
function armTopLift(ball, angle) {
    const arm = playerArm({ ...ball, angle });
    const root = Math.min(1, (ball.radius + arm.radius) / Math.max(arm.length, 1));
    const x1 = arm.x1 + (arm.x2 - arm.x1) * root;
    const y1 = arm.y1 + (arm.y2 - arm.y1) * root;
    const vx = arm.x2 - x1, vy = arm.y2 - y1;
    if (vy <= arm.radius) return 0;
    const left = Math.min(x1, arm.x2) - arm.radius;
    const top = y1 - arm.radius;
    const width = Math.abs(vx) + arm.radius * 2;
    const height = vy + arm.radius * 2;
    let lift = 0;
    for (const p of spatialGrid.getNearby(left, top, width, height)) {
        if (p.destroyed || y1 > p.y - arm.radius) continue;
        let from = 0, to = 1;
        if (Math.abs(vx) < 1e-9) {
            if (x1 < p.x || x1 > p.x + p.width) continue;
        } else {
            const a = (p.x - x1) / vx, b = (p.x + p.width - x1) / vx;
            from = Math.max(0, Math.min(a, b));
            to = Math.min(1, Math.max(a, b));
            if (from > to) continue;
        }
        const deepestY = y1 + vy * to;
        lift = Math.max(lift, deepestY + arm.radius - p.y);
    }
    return Math.max(0, lift);
}

function sweepArmTranslation(ball, previous, angle) {
    if (!previous || !Number.isFinite(previous.x) || !Number.isFinite(previous.y)) return angle;
    const endX = ball.x, endY = ball.y;
    const dx = endX - previous.x, dy = endY - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return angle;
    const arm = playerArm(ball);
    const steps = Math.max(1, Math.ceil(distance / Math.max(arm.radius * 0.5, 2)));
    let carriedAngle = nearestClearArmAngle(ball, angle, previous.x, previous.y);
    const requestedAngle = ball.aimAngle ?? carriedAngle;
    // If the player is retracting a downward brace, release it before translation contact is
    // considered. Otherwise the previous frame's downward pose can repeatedly zero falling
    // velocity while the requested upward pose is still waiting to be swept.
    const releasingTopSupport = Math.sin(carriedAngle) > 0.2 &&
        Math.sin(requestedAngle) < Math.sin(carriedAngle) - 0.08;
    let safeT = 0;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = previous.x + dx * t, y = previous.y + dy * t;
        if (!armHitsPlatform(ball, carriedAngle, x, y)) { safeT = t; continue; }

        // Landing arm-first on a top face is real leverage: the arm supports its owner like a
        // temporary leg. Upward movement (especially a fresh jump) releases it immediately.
        if (ball.armMode !== 'locked' && dy > 0 && !ball.jumpedThisTick &&
            !releasingTopSupport &&
            armHasTopSupport(ball, carriedAngle, x, y)) {
            const support = armTopSupport(ball, carriedAngle, x, y);
            let lo = safeT, hi = t;
            for (let j = 0; j < 10; j++) {
                const mid = (lo + hi) / 2;
                const mx = previous.x + dx * mid, my = previous.y + dy * mid;
                if (armHasTopSupport(ball, carriedAngle, mx, my)) hi = mid; else lo = mid;
            }
            ball.x = previous.x + dx * lo;
            ball.y = previous.y + dy * lo;
            ball.dy = 0;
            ball.yPhysics = 0;
            ball.canDoubleJump = true;
            ball.isJumping = false;
            if (support) {
                const planted = playerArm({ ...ball, angle: carriedAngle });
                ball.armPivot = {
                    x: planted.x2,
                    y: support.y,
                    distance: planted.length,
                    platformId: support.platformId,
                    topFace: true
                };
            }
            return carriedAngle;
        }

        // In normal play, body movement drags the arm around the contacted surface instead of
        // turning it into a static anchor. The small translation steps keep this deflection on
        // the near side of the platform rather than teleporting through it.
        if (ball.armMode !== 'locked') {
            const deflected = nearestClearArmAngle(ball, carriedAngle, x, y);
            if (!armHitsPlatform(ball, deflected, x, y)) {
                carriedAngle = deflected;
                safeT = t;
                continue;
            }
        }

        // Lobby lock mode (or a fully enclosed arm) is the only case that stops the body.
        let lo = safeT, hi = t;
        for (let j = 0; j < 10; j++) {
            const mid = (lo + hi) / 2;
            const mx = previous.x + dx * mid, my = previous.y + dy * mid;
            if (armHitsPlatform(ball, carriedAngle, mx, my)) hi = mid; else lo = mid;
        }
        ball.x = previous.x + dx * lo;
        ball.y = previous.y + dy * lo;
        if (Math.abs(endX - ball.x) > 0.01) { ball.dx = 0; ball.xPhysics = 0; }
        if (Math.abs(endY - ball.y) > 0.01) { ball.dy = 0; ball.yPhysics = 0; }
        return carriedAngle;
    }
    return carriedAngle;
}

function nearestClearArmAngle(ball, angle, x = ball.x, y = ball.y) {
    if (!armHitsPlatform(ball, angle, x, y)) return angle;
    const increment = Math.PI / 90;
    for (let i = 1; i <= 90; i++) {
        const plus = angle + increment * i;
        const minus = angle - increment * i;
        if (!armHitsPlatform(ball, plus, x, y)) return plus;
        if (!armHitsPlatform(ball, minus, x, y)) return minus;
    }
    return angle;
}

function sweepArmAngle(ball, from, target) {
    from = nearestClearArmAngle(ball, from);
    const delta = angleDelta(from, target);
    const arm = playerArm(ball);
    const steps = Math.max(1, Math.ceil(Math.abs(delta) * arm.length / Math.max(arm.radius * 0.5, 2)));
    let safe = from;
    for (let i = 1; i <= steps; i++) {
        const candidate = from + delta * i / steps;
        if (!armHitsPlatform(ball, candidate)) { safe = candidate; continue; }
        let lo = safe, hi = candidate;
        for (let j = 0; j < 10; j++) {
            const mid = lo + angleDelta(lo, hi) / 2;
            if (armHitsPlatform(ball, mid)) hi = mid; else lo = mid;
        }
        return { angle: lo, blocked: true };
    }
    return { angle: target, blocked: false };
}

// The physical arm sweeps from its last valid pose toward the pointer. A platform stops the
// rotation instead of repeatedly ejecting the body. Only fresh mouse motion transfers the
// blocked tip movement into body momentum, producing a controllable brace/pivot without pinning.
function checkArmPlatformCollisions(ball, previous) {
    const from = previous?.angle ?? ball.angle ?? 0;
    const target = ball.aimAngle ?? ball.angle ?? from;

    // A planted arm is a rigid pivot. Keep its world contact fixed and move the owner around
    // that point as the requested angle changes. This is the leverage arc the arm visually
    // promises; upward aiming or losing the platform releases it immediately.
    if (ball.armPivot && ball.armMode !== 'locked') {
        const pivot = ball.armPivot;
        const platform = platforms.find(p => p.id === pivot.platformId && !p.destroyed);
        // Shooting changes radius and stock after the previous collision pass, which changes both
        // arm length and capsule thickness. Rebuild those pivot dimensions now instead of using
        // stale pre-shot geometry. Upward recoil from a downward shot points away from the planted
        // contact and must release it rather than being overwritten by the constraint.
        const liveArm = playerArm({ ...ball, angle: target });
        const recoilRelease = !!ball.releaseArmPivot;
        ball.releaseArmPivot = false;
        const releasing = ball.jumpedThisTick || recoilRelease || !platform || Math.sin(target) <= 0.2;
        if (!releasing) {
            pivot.distance = liveArm.length;
            // pivot.y represents the arm capsule's centre at the platform surface. A smaller
            // post-shot arm radius sits closer to that same physical top face.
            if (pivot.topFace) pivot.y = platform.y - liveArm.radius;
            const nextX = pivot.x - Math.cos(target) * pivot.distance;
            const nextY = pivot.y - Math.sin(target) * pivot.distance;
            const bodyOnPlatform = nextX + ball.radius > platform.x &&
                nextX - ball.radius < platform.x + platform.width &&
                nextY + ball.radius >= platform.y - 0.25;
            if (bodyOnPlatform) {
                // The arc has placed the body on the floor. Hand contact off to the ordinary
                // circle/platform solver instead of retaining a zero-velocity pivot forever.
                ball.x = nextX;
                ball.y = platform.y - ball.radius;
                ball.angle = nearestClearArmAngle(ball, target);
                ball.armPivot = null;
                ball.canDoubleJump = true;
                ball.isJumping = false;
                return;
            }
            if (nextY + ball.radius <= platform.y + 0.01) {
                const px = previous?.x ?? ball.x, py = previous?.y ?? ball.y;
                ball.x = nextX;
                ball.y = nextY;
                ball.angle = target;
                // Carry the arc's per-tick displacement as velocity, so letting go of the lever
                // flings the body along the swing instead of dropping it from a standstill —
                // but weight/torque-limited so a fast mouse whip can't launch the body freely.
                ball.dx = ball.x - px;
                ball.dy = ball.y - py;
                limitArmThrow(ball);
                ball.xPhysics = 0;
                ball.yPhysics = 0;
                ball.canDoubleJump = true;
                ball.isJumping = false;
                return;
            }
        }
        ball.armPivot = null;
    }

    const carriedAngle = sweepArmTranslation(ball, previous, from);
    let result = sweepArmAngle(ball, carriedAngle, target);
    ball.angle = result.angle;

    if (result.blocked && ball.armMode === 'locked') {
        // Lobby contact is a hard brace: the arm stops at the surface and cannot impart motion
        // to its owner. This keeps aim usable for buttons without turning the staging pads into
        // leverage points.
        ball.dx = 0;
        ball.dy = 0;
        ball.xPhysics = 0;
        ball.yPhysics = 0;
        return;
    }

    if (!result.blocked) return;

    // Leverage fires on a fresh swing, or while braced and slow enough to hold (Getting-Over-It
    // static press). The static-press path is gated on being airborne: while the circle solver
    // already has the body grounded on a platform, ordinary walking (still mouse = slow) must not
    // plant a pivot/reaction that drags the owner backward along the arm's arc. It also excludes
    // fast free flight, where a passive aim-drift into a clipped platform must not grab the body.
    const bracedInAir = ball.isJumping && Math.hypot(ball.dx, ball.dy) < ball.speed * 1.5;
    if (!ball.aimMoved && !bracedInAir) return;

    const standLift = armTopLift(ball, target);
    if (standLift > 0) {
        // Rotation first plants the arm at the blocking angle, then continues around that fixed
        // point. The owner's centre follows the same circular arc as a rigid lever.
        const support = armTopSupport(ball, target);
        const planted = playerArm({ ...ball, angle: result.angle });
        const pivot = {
            x: planted.x2,
            y: support?.y ?? planted.y2,
            distance: planted.length,
            platformId: support?.platformId,
            topFace: !!support
        };
        const px = previous?.x ?? ball.x, py = previous?.y ?? ball.y;
        ball.x = pivot.x - Math.cos(target) * pivot.distance;
        ball.y = pivot.y - Math.sin(target) * pivot.distance;
        ball.angle = target;
        // Carry the swing as velocity (see the pivot-arc branch) for a momentum-preserving,
        // weight/torque-limited release.
        ball.dx = ball.x - px;
        ball.dy = ball.y - py;
        limitArmThrow(ball);
        ball.xPhysics = 0;
        ball.yPhysics = 0;
        ball.canDoubleJump = true;
        ball.isJumping = false;
        if (support) ball.armPivot = pivot;
        return;
    }

    // Reaction leverage: the arm is stopped short of where the pointer commands and keeps
    // pressing on that surface, so the body is shoved the opposite way. Driven by the gap
    // between the blocked pose and the requested pose, so holding into a wall keeps pushing.
    const arm = playerArm(ball);
    const blockedArm = playerArm({ ...ball, angle: result.angle });
    const targetArm = playerArm({ ...ball, angle: target });
    let pushX = blockedArm.x2 - targetArm.x2;
    let pushY = blockedArm.y2 - targetArm.y2;
    const magnitude = Math.hypot(pushX, pushY);
    if (magnitude < 1e-6) return;
    // Leverage is strong — deliberately not capped to walking speed — but bounded by the arm's
    // own reach, and the accumulated impulse is clamped so a held press settles at a stable
    // ceiling instead of pinning the body or blowing up.
    const maxImpulse = arm.length * 0.5;
    if (magnitude > maxImpulse) {
        pushX *= maxImpulse / magnitude;
        pushY *= maxImpulse / magnitude;
    }
    ball.xPhysics += pushX * 0.45;
    ball.yPhysics += pushY * 0.45;
    // Same weight/torque ceiling as the pivot throw: a held press settles at a stable, mass-
    // dependent cap instead of pinning the body or blowing up.
    const cap = armThrowLimit(ball);
    ball.xPhysics = Math.max(-cap, Math.min(cap, ball.xPhysics));
    ball.yPhysics = Math.max(-cap, Math.min(cap, ball.yPhysics));
}
        
    // Inject/remove a platform that isn't part of the seeded arena (menu rock, lobby pads).
    // These DO travel over the network, since no client can derive them from the seed.
    function addPlatform(x, y, width, height, runtimeId = null) {
        const platform = new StaticPlatform(x, y, width, height, canvas, -1, seed, retirePlatform, runtimeId);
        platforms.push(platform);
        spatialGrid.insert(platform, x, y, width, height);
        return platform;
    }
    function retirePlatform(platform) {
        if (platform.index >= 0) destroyed.add(platform.index);
        removePlatform(platform);
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
        ...[...destroyed].map(i => [i, PLATFORM_MAX_HITS])
    ];
    // Runtime platforms in full — there are only ever a handful.
    const extras = () => platforms.filter(p => p.index < 0)
        .map(p => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height }));

    // Client side: fold the server's damage/extras back onto the locally generated arena.
    function applySync(damageList = [], extraList = []) {
        const hitsFor = new Map(damageList);
        for (let i = platforms.length - 1; i >= 0; i--) {
            const p = platforms[i];
            if (p.index < 0) continue;
            // Damage is monotonic within a seeded arena. Duplicate or stale snapshots can never
            // heal a platform or resurrect one that a newer snapshot already destroyed.
            const hits = Math.max(p.hits, hitsFor.get(p.index) ?? 0);
            if (hits === p.hits) continue;
            p.hits = hits;
            p.color = hits >= 2 ? 'grey' : '#aaa7a1';
            if (hits === 1) p.generateHitRectangles(0.5); else p.hitRectangles = [];
        }
        // Destroyed platforms are simply absent from the arena once the shared threshold is met.
        for (let i = platforms.length - 1; i >= 0; i--) {
            if (platforms[i].index >= 0 && platforms[i].hits >= PLATFORM_MAX_HITS) removePlatform(platforms[i]);
        }
        const wantedExtras = new Map(extraList.map(e => [e.id, e]));
        for (let i = platforms.length - 1; i >= 0; i--) {
            const p = platforms[i];
            if (p.index < 0 && !wantedExtras.has(p.id)) removePlatform(p);
        }
        for (const e of extraList) {
            const existing = platforms.find(p => p.index < 0 && p.id === e.id);
            if (existing) {
                if (existing.x !== e.x || existing.y !== e.y ||
                    existing.width !== e.width || existing.height !== e.height) {
                    existing.x = e.x; existing.y = e.y;
                    existing.width = e.width; existing.height = e.height;
                    existing.size = e.width * e.height;
                    spatialGrid.update(existing, e.x, e.y, e.width, e.height);
                }
            } else addPlatform(e.x, e.y, e.width, e.height, e.id);
        }
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
        checkBallPlatforms: (ball, previous) => checkBallPlatformCollisions(ball, null, previous),
        damage,
        extras,
        applySync,
        getSpatialGridStats: () => spatialGrid.stats,
        getNearbyPlatforms: (x, y, width, height) => spatialGrid.getNearby(x, y, width, height),
        spatialGrid
    };
}
