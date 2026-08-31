import { ballHarming } from './damage.js';
import { Splash } from './splash.js';
import { GAME_CONFIG } from './config.js';
import { hashSeed, mulberry32 } from './sim/rng.js';

export const LAVA_PALETTE = Object.freeze(['darkred', 'black', 'orange', 'yellow']);

// Accepts the world's seeded stream so enemy colours are reproducible; falls back to
// Math.random for the purely decorative background lava, which nothing needs to agree on.
export function getRandomLavaColor(rng = Math.random) {
    return LAVA_PALETTE[Math.floor(rng() * LAVA_PALETTE.length)];
}

// A pattern is stored in normalized local coordinates, so the same material engine can fill
// the world-wide lava floor or a single enemy without stretching one global texture.
export function createLavaPattern(count, rng = Math.random, {
    minWidth = 0.14, maxWidth = 0.52,
    minHeight = 0.08, maxHeight = 0.24,
    minSpeed = 0.00035, maxSpeed = 0.0014
} = {}) {
    return Array.from({ length: count }, () => ({
        x: rng(),
        y: rng(),
        width: minWidth + rng() * (maxWidth - minWidth),
        height: minHeight + rng() * (maxHeight - minHeight),
        speed: minSpeed + rng() * (maxSpeed - minSpeed),
        color: getRandomLavaColor(rng)
    }));
}

export function advanceLavaPattern(pattern, dtMs = 16) {
    const step = Math.min(dtMs, 100) / 16;
    for (const cell of pattern) {
        cell.x += cell.speed * step;
        if (cell.x > 1) cell.x = -cell.width;
    }
}

export function drawLavaMaterial(ctx, bounds, pattern, { damage = 0, outline = false } = {}) {
    const { x, y, width, height } = bounds;
    if (width <= 0 || height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const body = ctx.createLinearGradient(x, y, x, y + height);
    body.addColorStop(0, '#5a0500');
    body.addColorStop(0.55, '#d51b00');
    body.addColorStop(1, '#ff3b00');
    ctx.fillStyle = body;
    ctx.shadowColor = '#ff3b00';
    ctx.shadowBlur = Math.max(8, Math.min(24, height * 0.16));
    ctx.fillRect(x, y, width, height);

    for (const cell of pattern) {
        ctx.fillStyle = cell.color;
        ctx.shadowColor = cell.color;
        ctx.shadowBlur = Math.max(4, Math.min(10, height * 0.08));
        ctx.fillRect(
            x + cell.x * width,
            y + cell.y * height,
            Math.max(2, cell.width * width),
            Math.max(2, cell.height * height)
        );
    }

    if (damage > 0) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(255,255,255,${Math.min(0.72, damage * 0.72)})`;
        ctx.fillRect(x, y, width, height);
    }
    ctx.restore();

    if (outline) {
        ctx.save();
        ctx.strokeStyle = 'black';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = Math.max(8, Math.min(18, height * 0.14));
        ctx.lineWidth = Math.max(2, Math.min(width, height) / 18);
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }
}

export function createLava(worldBounds,canvas) {
    const pattern = createLavaPattern(150, Math.random, {
        minWidth: 0.01, maxWidth: 0.024,
        minHeight: 0.16, maxHeight: 0.65,
        minSpeed: 0.00008, maxSpeed: 0.00018
    });
    const splashes = []; // Initialize splashes array

    return {
        x: 0,
        y: worldBounds.bottom - GAME_CONFIG.REF_HEIGHT/18,
        width: worldBounds.right,
        height: GAME_CONFIG.REF_HEIGHT/18,
        draw(ctx) {
            ctx.save();
            const gradient = ctx.createLinearGradient(this.x, this.y , this.x, this.y- this.height * 5 );
            gradient.addColorStop(0, 'rgba(255, 0, 0, 0.6)');
            gradient.addColorStop(0.05, 'rgba(255, 20, 0, 0.1)');
            gradient.addColorStop(0.8, 'rgba(255, 100, 0, 0.05)');
            gradient.addColorStop(1, 'rgba(255, 200, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(this.x , this.y - this.height *5, this.width, this.y);
            drawLavaMaterial(ctx, this, pattern);

            // Draw splashes
            splashes.forEach(splash => splash.draw(ctx));
            ctx.restore();
        },

        update(consumables, dtMs = 16) {
            advanceLavaPattern(pattern, dtMs);

            for (let i = consumables.length - 1; i >= 0; i--) {
                const consumable = consumables[i];

                if (consumable.y + consumable.size > this.y && !consumable.splashed) {
                    // Consumable has collided with lava
                    splashes.push(new Splash(consumable.x, this.y, 5, getRandomLavaColor()));
                    consumable.splashed = true;
                    consumable.dy = 0;
                    consumable.gravity = 0;
                    consumable.dx = Math.random() * 0.5 + 0.5;
                }
            }
            // Update splashes
            splashes.forEach(splash => splash.update());
            // Filter out finished splashes without reassigning the array
            for (let i = splashes.length - 1; i >= 0; i--) {
                if (splashes[i].isFinished()) {
                    splashes.splice(i, 1);
                }
            }
        },
        
        
        checkKillCollision(ball) {
            return (
                
                ball.y  > this.y 
            );
        },
        
        handleCollision(ball) {
            
            if (this.checkKillCollision(ball)) {
                splashes.push(new Splash(ball.x, ball.y, Math.abs(ball.dy)*ball.radius/15 + ball.radius/2, 'lava', 'square'));  
                ballHarming(ball);
                }
                    
                  
            }
        
        
    };
}

// Enemy lava uses the same material renderer as the floor, but each enemy owns a dense,
// deterministic local pattern. That avoids small enemies sampling empty parts of a global field.
export function createLavaBackground(worldBounds) {
    const patterns = new Map();
    const patternFor = enemy => {
        if (!patterns.has(enemy.id)) {
            patterns.set(enemy.id, createLavaPattern(10, mulberry32(hashSeed(enemy.id))));
        }
        return patterns.get(enemy.id);
    };

    return {
        update(dtMs = 16) {
            for (const pattern of patterns.values()) advanceLavaPattern(pattern, dtMs);
        },
        drawReveal(ctx, enemies) {
            if (!enemies?.length) return;
            const live = new Set();
            for (const enemy of enemies) {
                live.add(enemy.id);
                drawLavaMaterial(
                    ctx,
                    { x: enemy.x, y: enemy.y, width: enemy.size, height: enemy.size },
                    patternFor(enemy),
                    { damage: enemy.health ? enemy.hitCount / enemy.health : 0, outline: true }
                );
            }
            for (const id of patterns.keys()) if (!live.has(id)) patterns.delete(id);
        }
    };
}
