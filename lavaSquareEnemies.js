// filepath: /h:/Downloads/SUBSURFACE/lavaSquare.js
import { Splash } from './splash.js';
import { Consumable } from './consumableEnemies.js';
import { physics } from './physics.js';
import { generalSplashes } from './splash.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';

export class LavaSquare {
    // `rng` is the world's seeded stream: every enemy's appearance and identity is derived
    // from it so all clients and the server agree without any of it going over the wire.
    constructor(x, y, size, speed, worldBounds, canvas, angle, health = 1,
        { spatialGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE * 2), rng = Math.random, id = null } = {}) {
        this.rng = rng;
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
        this.splashes = [];
        this.yPhysics = 0;
        this.xPhysics = 0;
        this.angle = angle;
        this.id = id ?? `e${Math.floor(rng() * 1e9).toString(36)}`;
        this.needsGridUpdate = true;
        this.spatialGrid = spatialGrid;
    }
    
update(ball, projectiles, consumables, platforms, endGame, lavaSquares) {
    // Check if destroyed
    if (this.hitCount >= this.health) {
        this.destroy(consumables, ball, lavaSquares);
        return;
    }
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
                this.hitCount += projectile.enemyDamage ?? projectile.radius / 40;
                
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
                
                // Retarget the player who hit us, then resume at our normal speed toward them.
                const centerX = this.x + this.size / 2;
                const centerY = this.y + this.size / 2;
                this.angle = Math.atan2(ball.y - centerY, ball.x - centerX);

                // Adjust size
                const halfSZ = this.size / 2;
                this.size *= 1.0001;
                this.dx = this.speed * Math.cos(this.angle);
                this.dy = this.speed * Math.sin(this.angle);
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
        if (this.hitCount >= this.health) {
            this.destroy(consumables, target || { score: 0 }, lavaSquares);
            return;
        }
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
    
    reset() {
        this.spatialGrid.remove(this);
        this.x = GAME_CONFIG.REF_WIDTH / 4;
        this.y = GAME_CONFIG.REF_HEIGHT / 4;
        this.size = 40;
        this.hitCount = 0;
        this.splashes.forEach(splash => splash.destroy());
        this.splashes.length = 0;
        this.needsGridUpdate = true;
    }
}
