// filepath: /h:/Downloads/PLATZIO/lavaSquare.js
import { Splash } from './splash.js';
import { Consumable } from './consumableEnemies.js';
import { getRandomLavaColor } from './lava.js';
import { physics } from './physics.js';
import { generalSplashes } from './splash.js';
import { textToRGB } from './tools.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';

export class LavaSquare {
    constructor(x, y, size, speed, worldBounds, canvas, angle, health = 2,
        { spatialGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE * 2) } = {}) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.speed = speed;
        this.dx = Math.cos(angle) * speed;
        this.dy = Math.sin(angle) * speed;
        this.hitCount = 0;
        this.health = health;
        this.color = 'red';
        this.worldBounds = worldBounds;
        this.canvas = canvas;
        this.lavaRectangles = canvas ? this.generateLavaRectangles() : [];
        this.splashes = [];
        this.stickColor = getRandomLavaColor();
        this.yPhysics = 0;
        this.xPhysics = 0;
        this.angle = angle;
        this.armLength = size;
        this.mouthWidth = size / 6;
        this.targetRadius = size / 12;
        this.sucking = false;
        this.suctionStrength = 0;
        this.id = Math.random().toString(36).substr(2, 9);
        this.needsGridUpdate = true;
        this.spatialGrid = spatialGrid;
    }
    
    draw(ctx, ball) {
        ctx.save();
        
        // The connection stays narrow at the enemy and widens to the player's diameter.
        const stickLength = this.armLength;
        const stickEndX = this.x + this.size / 2 + stickLength * Math.cos(this.angle);
        const stickEndY = this.y + this.size / 2 + stickLength * Math.sin(this.angle);
        const mouthX = this.x + this.size / 2 + this.size / 2 * Math.cos(this.angle);
        const mouthY = this.y + this.size / 2 + this.size / 2 * Math.sin(this.angle);
        const normalX = -Math.sin(this.angle);
        const normalY = Math.cos(this.angle);
        const startHalfWidth = this.mouthWidth / 2;
        const connectionPath = () => {
            ctx.beginPath();
            ctx.moveTo(mouthX + normalX * startHalfWidth, mouthY + normalY * startHalfWidth);
            ctx.lineTo(stickEndX + normalX * this.targetRadius, stickEndY + normalY * this.targetRadius);
            ctx.lineTo(stickEndX - normalX * this.targetRadius, stickEndY - normalY * this.targetRadius);
            ctx.lineTo(mouthX - normalX * startHalfWidth, mouthY - normalY * startHalfWidth);
            ctx.closePath();
        };
        const maxOpacity = 1;
        const opacityPerHit = maxOpacity / this.health;
        const currentOpacity = Math.min(this.hitCount * opacityPerHit, maxOpacity);
        
        // Draw splashes
        this.splashes.forEach(splash => splash.draw(ctx));
        
        connectionPath();
        ctx.fillStyle = this.stickColor;
        ctx.shadowColor = this.stickColor;
        ctx.shadowBlur = 10;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = this.stickColor;
        ctx.lineWidth = Math.max(2, this.size / 18);
        ctx.stroke();
        
        connectionPath();
        ctx.fillStyle = `rgba(255, 255, 255, ${currentOpacity})`;
        ctx.fill();

        if (this.sucking) {
            const phase = (performance.now() / 350) % 1;
            ctx.fillStyle = 'white';
            for (let i = 0; i < 5; i++) {
                const distance = this.size / 2 + ((i / 5 - phase + 1) % 1) * (stickLength - this.size / 2);
                ctx.beginPath();
                const flowRadius = Math.max(2, (this.mouthWidth / 2 + (this.targetRadius - this.mouthWidth / 2) * distance / stickLength) / 4);
                ctx.arc(
                    this.x + this.size / 2 + distance * Math.cos(this.angle),
                    this.y + this.size / 2 + distance * Math.sin(this.angle),
                    flowRadius, 0, Math.PI * 2
                );
                ctx.fill();
            }
        }
        
        // Draw lava square body
        ctx.fillStyle = this.color;
        ctx.shadowColor = `rgba(${textToRGB(this.color)}, ${1 - currentOpacity})`;
        ctx.shadowBlur = 10;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        
        // Draw lava square overlay
        ctx.fillStyle = `rgba(255, 255, 255, ${currentOpacity})`;
        ctx.shadowColor = `rgba(255, 255, 255, ${currentOpacity})`;
        ctx.shadowBlur = 10;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        
        // Draw lava rectangles with clipping
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.x, this.y, this.size, this.size);
        ctx.clip();
        
        this.lavaRectangles.forEach(rect => {
            ctx.fillStyle = rect.color;
            ctx.shadowColor = rect.color;
            ctx.shadowBlur = 5;
            ctx.fillRect(this.x + rect.x, this.y + rect.y, rect.width, rect.height);
        });
        ctx.restore();
        
        ctx.restore();
    }
    
    shrinkLavaRectangles() {
        if (!this.canvas) return;
        const shrinkFactor = 1.0001;
        
        for (let i = this.lavaRectangles.length - 1; i >= 0; i--) {
            const rect = this.lavaRectangles[i];
            rect.x *= shrinkFactor;
            rect.y *= shrinkFactor;
            rect.width *= shrinkFactor;
            rect.height *= shrinkFactor;
            
            // Remove rectangles that are too small
            if (rect.width <= 2 || rect.height <= 2) {
                this.lavaRectangles.splice(i, 1);
            }
        }
        
        // Add new rectangle if needed
        if (this.lavaRectangles.length === 0) {
            this.lavaRectangles.push({
                x: Math.random() * this.size,
                y: Math.random() * this.size,
                width: Math.random() * (this.size / 4) + 2,
                height: Math.random() * (this.size / 4) + 2,
                color: getRandomLavaColor()
            });
        }
    }
    
update(ball, projectiles, consumables, platforms, endGame, lavaSquares) {
    this.aimAt(ball);
    
    // Check if destroyed
    if (this.hitCount >= this.health) {
        this.destroy(consumables, ball, lavaSquares);
        return;
    }
    if (this.sucking) this.eat(ball);
    
    // Update position
    // ponytail: clamp per-frame move to < own size so a fast square can't tunnel
    // clean through a platform/other square (collision is discrete AABB below).
    // Upgrade path: swept/substep collision if enemies must move faster than size/frame.
    const stepX = this.dx + this.xPhysics;
    const stepY = this.dy + this.yPhysics;
    const stepLen = Math.hypot(stepX, stepY);
    const maxStep = this.size * 0.9;
    const scale = stepLen > maxStep ? maxStep / stepLen : 1;
    this.x += stepX * scale;
    this.y += stepY * scale;
    
    // Update spatial grid if position changed
    if (this.needsGridUpdate) {
        this.spatialGrid.update(this, this.x, this.y, this.size, this.size);
        this.needsGridUpdate = false;
    }
    
    physics(this);
    
    // Get nearby lava squares for collision detection USING SPATIAL GRID
    const nearbyLavaSquares = this.spatialGrid.getNearby(
        this.x, this.y, this.size, this.size
    );
    
    // Check collisions with nearby lava squares
    this.checkLavaSquareCollisions(nearbyLavaSquares, lavaSquares);
    
    // Get nearby platforms for collision detection USING SPATIAL GRID
    // FIX: Use the spatial grid from platforms module
    const nearbyPlatforms = platforms.getNearbyPlatforms(this.x, this.y, this.size, this.size);
    
    // Then use this in checkPlatformCollisions
    this.checkPlatformCollisions(nearbyPlatforms);
    
    // Handle world bounds
    this.handleWorldBounds();
    
    this.checkProjectileCollisions(ball);
    
    // Check collision with player
    this.checkPlayerCollision(ball, consumables, lavaSquares);
    
    // Update splashes
    this.updateSplashes();
    
    // Update lava rectangles
    this.shrinkLavaRectangles();
    
    // Mark for grid update if physics changed position
    if (Math.abs(this.xPhysics) > 0.1 || Math.abs(this.yPhysics) > 0.1) {
        this.needsGridUpdate = true;
    }
}
    
    destroy(consumables, ball, lavaSquares) {
        // Create consumable
        const consumable = new Consumable(this.x, this.y, this.size, 'white', 'square', this.xPhysics, this.yPhysics);
        consumables.push(consumable);
        ball.score += this.size;
        
        // Remove from spatial grid
        this.spatialGrid.remove(this);
        
        // Remove from lava squares array
        const index = lavaSquares.indexOf(this);
        if (index > -1) {
            if (this.canvas) generalSplashes.push(new Splash(
                this.x + this.size / 2,
                this.y - this.size,
                this.size,
                'lava',
                'square'
            ));
            lavaSquares.splice(index, 1);
        }
        
        // Clean up resources
        this.splashes.forEach(splash => splash.destroy());
        this.lavaRectangles.length = 0;
    }
    
    checkLavaSquareCollisions(nearbyLavaSquares, lavaSquares) {
        for (const otherSquare of nearbyLavaSquares) {
            if (otherSquare === this || !otherSquare.update) continue;
            
            if (this.x + this.size > otherSquare.x &&
                this.x < otherSquare.x + otherSquare.size &&
                this.y + this.size > otherSquare.y &&
                this.y < otherSquare.y + otherSquare.size) {
                
                // Calculate collision response
                const dx = (this.x + this.size / 2) - (otherSquare.x + otherSquare.size / 2);
                const dy = (this.y + this.size / 2) - (otherSquare.y + otherSquare.size / 2);
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance === 0) return;
                
                // Normalize direction vector
                const nx = dx / distance;
                const ny = dy / distance;
                
                // Separate squares
                const separation = (this.size + otherSquare.size) / 2 - distance;
                if (separation > 0) {
                    this.x += nx * separation * 0.5;
                    this.y += ny * separation * 0.5;
                    otherSquare.x -= nx * separation * 0.5;
                    otherSquare.y -= ny * separation * 0.5;
                    
                    // Update spatial grid
                    this.needsGridUpdate = true;
                    otherSquare.needsGridUpdate = true;
                }
                
                // Bounce
                this.dx = -Math.sign(this.dx) * this.speed;
                this.dy = -Math.sign(this.dy) * this.speed;
            }
        }
    }
    
    checkProjectileCollisions(ball) {
        for (let i = ball.projectiles.length - 1; i >= 0; i--) {
            const projectile = ball.projectiles[i];
            
            if (projectile.x + projectile.radius > this.x &&
                projectile.x - projectile.radius < this.x + this.size &&
                projectile.y + projectile.radius > this.y &&
                projectile.y - projectile.radius < this.y + this.size) {
                
                // Handle hit. Damage is resolution-independent now (was scaled by
                // winSizeConstant = 1 at reference res, >1 on smaller windows — an
                // accidental advantage a shared server can't allow).
                ball.score += 0.5;
                this.hitCount += projectile.radius / 40;
                
                if (this.hitCount >= 30) {
                    ball.score += this.size;
                    ball.projectiles.splice(i, 1);
                    return;
                }
                
                // Create splash effect
                if (this.canvas) this.splashes.push(new Splash(
                    projectile.x,
                    projectile.y,
                    this.size / 3,
                    'lava',
                    'square',
                    projectile.dx,
                    projectile.dy,
                    1
                ));
                
                // Apply physics
                this.xPhysics = projectile.dx / 5;
                this.yPhysics = projectile.dy / 5;
                
                // Adjust size
                const halfSZ = this.size / 2;
                this.size *= 1.0001;
                this.dx = this.speed * Math.cos(this.angle);
                this.dy = this.speed * Math.sin(this.angle);
                this.shrinkLavaRectangles();
                this.x += halfSZ - this.size / 2;
                this.y += halfSZ - this.size / 2;
                
                // Mark for grid update
                this.needsGridUpdate = true;
                
                // Remove projectile
                ball.projectiles.splice(i, 1);
            }
        }
    }
    
checkPlatformCollisions(platforms) {
    for (const platform of platforms) {
        // Calculate collision box with some tolerance
        const left = this.x;
        const right = this.x + this.size;
        const top = this.y;
        const bottom = this.y + this.size;
        
        const platformLeft = platform.x;
        const platformRight = platform.x + platform.width;
        const platformTop = platform.y;
        const platformBottom = platform.y + platform.height;
        
        // Check for collision
        if (right > platformLeft && 
            left < platformRight && 
            bottom > platformTop && 
            top < platformBottom) {
            
            // Calculate penetration depths
            const penetrationX = Math.min(
                right - platformLeft,
                platformRight - left
            );
            const penetrationY = Math.min(
                bottom - platformTop,
                platformBottom - top
            );
            
            // Resolve along the smallest-penetration axis, but choose the ejection
            // DIRECTION by center-side (position), not velocity sign. Platforms drift and
            // enemies home toward the player, so velocity often points the wrong way and
            // would eject the enemy straight through the platform. Position can't.
            if (penetrationX < penetrationY) {
                // Horizontal collision
                if (this.x + this.size / 2 < platformLeft + platform.width / 2) {
                    this.x = platformLeft - this.size;      // eject left
                    if (this.dx > 0) this.dx = -Math.abs(this.dx) * 0.8;
                } else {
                    this.x = platformRight;                 // eject right
                    if (this.dx < 0) this.dx = Math.abs(this.dx) * 0.8;
                }
            } else {
                // Vertical collision
                if (this.y + this.size / 2 < platformTop + platform.height / 2) {
                    this.y = platformTop - this.size;        // eject up (sit on top)
                    if (this.dy > 0) this.dy = -Math.abs(this.dy) * 0.8;
                    if (platform.yPhysics > 0) this.yPhysics = platform.yPhysics * 0.5;
                } else {
                    this.y = platformBottom;                 // eject down
                    if (this.dy < 0) this.dy = Math.abs(this.dy) * 0.8;
                    if (platform.yPhysics < 0) this.yPhysics = platform.yPhysics * 0.5;
                }
            }
            
            // Update platform physics slightly (reaction force)
            platform.xPhysics += this.dx * 0.1;
            platform.yPhysics += this.dy * 0.1;
            
            // Update spatial grid for this lava square
            this.needsGridUpdate = true;
            
            // Update spatial grid for platform (if platform module has update method)
            if (platform.needsGridUpdate !== undefined) {
                platform.needsGridUpdate = true;
            }
        }
    }
}
    
handleWorldBounds() {
    let bounced = false;
    
    // Left boundary
    if (this.x < this.worldBounds.left) {
        this.x = this.worldBounds.left;
        this.dx = Math.abs(this.dx);
        bounced = true;
    } 
    // Right boundary
    else if (this.x + this.size > this.worldBounds.right) {
        this.x = this.worldBounds.right - this.size;
        this.dx = -Math.abs(this.dx);
        bounced = true;
    }
    
    // Top boundary
    if (this.y < this.worldBounds.top) {
        this.y = this.worldBounds.top;
        this.dy = Math.abs(this.dy);
        bounced = true;
    } 
    // Bottom boundary - IMPORTANT: This was wrong
    else if (this.y + this.size > this.worldBounds.bottom) {
        this.y = this.worldBounds.bottom - this.size; // Changed from just changing dy
        this.dy = -Math.abs(this.dy);
        bounced = true;
    }
    
    if (bounced) {
        this.needsGridUpdate = true;
    }
}
    
    aimAt(ball) {
        const dx = ball.x - this.x - this.size / 2;
        const dy = ball.y - this.y - this.size / 2;
        const distance = Math.hypot(dx, dy);
        const reach = this.size * 2;
        const gap = distance - this.size / 2 - ball.radius;
        this.angle = Math.atan2(dy, dx);
        this.mouthWidth = this.size / 6;
        this.sucking = gap <= reach;
        this.suctionStrength = this.sucking ? 1 - Math.max(0, gap) / reach : 0;
        this.armLength = this.sucking ? Math.max(this.size / 2, distance - ball.radius) : this.size;
        this.targetRadius = this.sucking ? ball.radius : this.mouthWidth / 2;
    }

    eat(ball) {
        if (!this.sucking) return;
        const deathSize = GAME_CONFIG.REF_HEIGHT / 40;
        const bite = Math.min(
            ball.radius - deathSize,
            GAME_CONFIG.REF_HEIGHT / 30000 * (this.size / (ball.radius * 2)) ** 1.5 *
                (0.2 + this.suctionStrength * 0.8)
        );
        if (bite <= 0) { ball.dead = true; return; }
        ball.radius -= bite;
        if (ball.radius <= deathSize) ball.dead = true;
        this.x -= bite;
        this.y -= bite;
        this.size += bite * 2;
        this.needsGridUpdate = true;
    }

    checkPlayerCollision(ball, consumables, lavaSquares) {
        const distance = Math.hypot(
            this.x + this.size / 2 - ball.x,
            this.y + this.size / 2 - ball.y
        );
        
        if (distance < this.size / 2 + ball.radius) {
            if (ball.dy * ball.radius > this.size * 8) {
                // Player destroys lava square
                ball.score += this.size * 2;
                this.destroy(consumables, ball, lavaSquares);
            } else {
                if (this.canvas) this.splashes.push(new Splash(
                    ball.x,
                    ball.y,
                    ball.radius,
                    '255,255,255',
                    'circle'
                ));
                ball.xPhysics += (this.x + this.size / 2 - ball.x) / 500;
                ball.yPhysics += (this.y + this.size / 2 - ball.y) / 500;
            }
        }
    }
    
    // ---- Multiplayer: target/collide against N players instead of a single ball ----
    nearestPlayer(players) {
        let best = null, bd = Infinity;
        for (const p of players) {
            const d = Math.hypot(p.x - this.x, p.y - this.y);
            if (d < bd) { bd = d; best = p; }
        }
        return best;
    }

    stepMP(players, platformsObj, consumables, lavaSquares) {
        const target = this.nearestPlayer(players);
        if (target) this.aimAt(target);
        else this.sucking = false;
        if (this.hitCount >= this.health) {
            this.destroy(consumables, target || { score: 0 }, lavaSquares);
            return;
        }
        if (target && this.sucking) this.eat(target);

        // Position with the same anti-tunnel clamp as single-player update()
        const stepX = this.dx + this.xPhysics;
        const stepY = this.dy + this.yPhysics;
        const stepLen = Math.hypot(stepX, stepY);
        const maxStep = this.size * 0.9;
        const scale = stepLen > maxStep ? maxStep / stepLen : 1;
        this.x += stepX * scale;
        this.y += stepY * scale;

        if (this.needsGridUpdate) {
            this.spatialGrid.update(this, this.x, this.y, this.size, this.size);
            this.needsGridUpdate = false;
        }
        physics(this);

        this.checkLavaSquareCollisions(this.spatialGrid.getNearby(this.x, this.y, this.size, this.size), lavaSquares);
        this.checkPlatformCollisions(platformsObj.getNearbyPlatforms(this.x, this.y, this.size, this.size));
        this.handleWorldBounds();

        for (const ball of players) {
            this.checkProjectileCollisions(ball);
            this.checkPlayerCollision(ball, consumables, lavaSquares);
        }

        this.updateSplashes();
        this.shrinkLavaRectangles();
        if (Math.abs(this.xPhysics) > 0.1 || Math.abs(this.yPhysics) > 0.1) this.needsGridUpdate = true;
    }

    updateSplashes() {
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            this.splashes[i].update();
            if (this.splashes[i].isFinished()) {
                this.splashes[i].destroy();
                this.splashes.splice(i, 1);
            }
        }
    }
    
    generateLavaRectangles() {
        const rectangles = [];
        const count = 10;
        
        for (let i = 0; i < count; i++) {
            rectangles.push({
                x: Math.random() * this.size,
                y: Math.random() * this.size,
                width: Math.random() * this.size + 4,
                height: Math.random() * (this.size / 4) + (this.size / 10),
                color: getRandomLavaColor()
            });
        }
        
        return rectangles;
    }
    
    reset() {
        this.spatialGrid.remove(this);
        this.x = GAME_CONFIG.REF_WIDTH / 4;
        this.y = GAME_CONFIG.REF_HEIGHT / 4;
        this.size = 40;
        this.hitCount = 0;
        this.lavaRectangles = this.generateLavaRectangles();
        this.splashes.forEach(splash => splash.destroy());
        this.splashes.length = 0;
        this.needsGridUpdate = true;
    }
}
