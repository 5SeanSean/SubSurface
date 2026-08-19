// filepath: /h:/Downloads/PLATZIO/lavaSquare.js
import { ballHarming } from './player.js';
import { Splash } from './splash.js';
import { Consumable } from './consumableEnemies.js';
import { getRandomLavaColor } from './lava.js';
import { physics } from './physics.js';
import { now } from './clock.js';
import { generalSplashes, cleanupGeneralSplashes } from './splash.js';
import { textToRGB } from './tools.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';

// Spatial grid for lava squares collision optimization
let lavaSpatialGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE * 2); // Larger cell size for lava squares

export class LavaSquare {
    constructor(x, y, size, speed, projectileSpeed, shootInterval, worldBounds, canvas, angle, health = 2) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.speed = speed;
        this.dx = Math.cos(angle) * speed;
        this.dy = Math.sin(angle) * speed;
        this.projectileSpeed = projectileSpeed;
        this.shootInterval = shootInterval;
        this.lastShotTime = 0;
        this.hitCount = 0;
        this.health = health;
        this.color = 'red';
        this.projectiles = [];
        this.worldBounds = worldBounds;
        this.canvas = canvas;
        this.lavaRectangles = this.generateLavaRectangles();
        this.splashes = [];
        this.stickColor = getRandomLavaColor();
        this.yPhysics = 0;
        this.xPhysics = 0;
        this.angle = angle;
        this.id = Math.random().toString(36).substr(2, 9);
        this.needsGridUpdate = true;
    }
    
    draw(ctx, ball) {
        ctx.save();
        
        // Draw the stick pointing at the player
        const stickLength = this.size * ((this.health - (this.hitCount / 3)) / this.health);
        const stickEndX = this.x + this.size / 2 + stickLength * Math.cos(this.angle);
        const stickEndY = this.y + this.size / 2 + stickLength * Math.sin(this.angle);
        const maxOpacity = 1;
        const opacityPerHit = maxOpacity / this.health;
        const currentOpacity = Math.min(this.hitCount * opacityPerHit, maxOpacity);
        
        // Draw splashes
        this.splashes.forEach(splash => splash.draw(ctx));
        
        // Draw projectiles
        ctx.save();
        this.projectiles.forEach(projectile => {
            // Projectile glow
            ctx.fillStyle = `rgba(${textToRGB('magma')}, 0.5)`;
            ctx.shadowColor = 'orange';
            ctx.shadowBlur = 5;
            ctx.fillRect(
                projectile.x - projectile.radius * 1.25,
                projectile.y - projectile.radius * 1.25,
                projectile.radius * 2.5,
                projectile.radius * 2.5
            );
            
            // Projectile core
            ctx.fillStyle = 'red';
            ctx.fillRect(
                projectile.x - projectile.radius * 0.9,
                projectile.y - projectile.radius * 0.9,
                projectile.radius * 1.8,
                projectile.radius * 1.8
            );
        });
        ctx.restore();
        
        // Draw stick (shadow)
        ctx.beginPath();
        ctx.moveTo(this.x + this.size / 2, this.y + this.size / 2);
        ctx.lineTo(stickEndX, stickEndY);
        ctx.strokeStyle = this.stickColor;
        ctx.lineWidth = this.size / 4;
        ctx.shadowColor = this.stickColor;
        ctx.shadowBlur = 10;
        ctx.stroke();
        
        // Draw stick (overlay)
        ctx.beginPath();
        ctx.moveTo(this.x + this.size / 2, this.y + this.size / 2);
        ctx.lineTo(stickEndX, stickEndY);
        ctx.strokeStyle = `rgba(255, 255, 255, ${currentOpacity})`;
        ctx.lineWidth = this.size / 4;
        ctx.stroke();
        
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
    // Calculate direction towards player
    this.angle = Math.atan2(ball.y - this.y - this.size / 2, ball.x - this.x - this.size / 2);
    
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
        lavaSpatialGrid.update(this, this.x, this.y, this.size, this.size);
        this.needsGridUpdate = false;
    }
    
    physics(this);
    
    // Get nearby lava squares for collision detection USING SPATIAL GRID
    const nearbyLavaSquares = lavaSpatialGrid.getNearby(
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
    
    // Shoot projectiles
    this.handleShooting(ball);
    
    // Update projectiles
    this.updateProjectiles(platforms, ball); // platforms obj: projectiles query the grid at their own position

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
        lavaSpatialGrid.remove(this);
        
        // Remove from lava squares array
        const index = lavaSquares.indexOf(this);
        if (index > -1) {
            generalSplashes.push(new Splash(
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
        this.projectiles.length = 0;
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
                this.splashes.push(new Splash(
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
    
    handleShooting(ball) {
        const currentTime = now();
        if (currentTime - this.lastShotTime >= this.shootInterval) {
            this.shootProjectile(ball);
            this.lastShotTime = currentTime;
        }
    }
    
    updateProjectiles(platformsObj, ball) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];

            projectile.x += projectile.dx;
            projectile.y += projectile.dy;

            // Query platforms near the projectile itself, not near the firing enemy
            const platforms = platformsObj.getNearbyPlatforms(
                projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2
            );

            // Check platform collisions
            let collided = false;
            for (const platform of platforms) {
                if (projectile.x + projectile.radius > platform.x &&
                    projectile.x - projectile.radius < platform.x + platform.width &&
                    projectile.y + projectile.radius > platform.y &&
                    projectile.y - projectile.radius < platform.y + platform.height) {
                    
                    this.splashes.push(new Splash(
                        projectile.x,
                        projectile.y,
                        this.size / 3,
                        'lava',
                        'square',
                        platform.dx,
                        platform.dy
                    ));
                    this.projectiles.splice(i, 1);
                    collided = true;
                    break;
                }
            }
            
            if (collided) continue;
            
            // Check player collision
            if (Math.hypot(projectile.x - ball.x, projectile.y - ball.y) < 
                projectile.radius + ball.radius) {
                this.splashes.push(new Splash(
                    projectile.x,
                    projectile.y,
                    projectile.radius * 4,
                    '255,255,255',
                    'circle'
                ));
                ballHarming(ball);
                this.projectiles.splice(i, 1);
            }
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
                // Player takes damage
                ballHarming(ball);
                this.splashes.push(new Splash(
                    ball.x,
                    ball.y,
                    ball.radius,
                    '255,255,255',
                    'circle'
                ));
                ball.dy = 0;
                ball.dx = 0;
                ball.yPhysics = (ball.y - (this.y + this.size / 2)) / 4;
                ball.xPhysics = (ball.x - (this.x + this.size / 2)) / 4;
            }
        }
    }
    
    // ---- Multiplayer: target/collide against N players instead of a single ball ----
    // players is an array of ball objects. Reuses the single-ball collision methods
    // per player; only homing and enemy-projectile-vs-players need MP-specific loops.
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
        if (target) {
            this.angle = Math.atan2(target.y - this.y - this.size / 2, target.x - this.x - this.size / 2);
        }
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
            lavaSpatialGrid.update(this, this.x, this.y, this.size, this.size);
            this.needsGridUpdate = false;
        }
        physics(this);

        this.checkLavaSquareCollisions(lavaSpatialGrid.getNearby(this.x, this.y, this.size, this.size), lavaSquares);
        this.checkPlatformCollisions(platformsObj.getNearbyPlatforms(this.x, this.y, this.size, this.size));
        this.handleWorldBounds();

        this.handleShooting();                       // fires toward this.angle (nearest player)
        this.updateProjectilesMP(platformsObj, players);
        for (const ball of players) {                // reuse single-ball methods per player
            this.checkProjectileCollisions(ball);
            this.checkPlayerCollision(ball, consumables, lavaSquares);
        }

        this.updateSplashes();
        this.shrinkLavaRectangles();
        if (Math.abs(this.xPhysics) > 0.1 || Math.abs(this.yPhysics) > 0.1) this.needsGridUpdate = true;
    }

    // Enemy projectiles: move once, ricochet-splash off platforms, damage ANY player.
    updateProjectilesMP(platformsObj, players) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const projectile = this.projectiles[i];
            projectile.x += projectile.dx;
            projectile.y += projectile.dy;

            const platforms = platformsObj.getNearbyPlatforms(
                projectile.x, projectile.y, projectile.radius * 2, projectile.radius * 2
            );
            let collided = false;
            for (const platform of platforms) {
                if (projectile.x + projectile.radius > platform.x &&
                    projectile.x - projectile.radius < platform.x + platform.width &&
                    projectile.y + projectile.radius > platform.y &&
                    projectile.y - projectile.radius < platform.y + platform.height) {
                    this.splashes.push(new Splash(projectile.x, projectile.y, this.size / 3, 'lava', 'square', platform.dx, platform.dy));
                    this.projectiles.splice(i, 1);
                    collided = true;
                    break;
                }
            }
            if (collided) continue;

            for (const ball of players) {
                if (Math.hypot(projectile.x - ball.x, projectile.y - ball.y) < projectile.radius + ball.radius) {
                    this.splashes.push(new Splash(projectile.x, projectile.y, projectile.radius * 4, '255,255,255', 'circle'));
                    ballHarming(ball);
                    this.projectiles.splice(i, 1);
                    break;
                }
            }
        }
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
    
    shootProjectile() {
        const speed = this.projectileSpeed;
        const dx = speed * Math.cos(this.angle);
        const dy = speed * Math.sin(this.angle);
        
        this.projectiles.push({
            x: this.x + this.size / 2 + this.size * Math.cos(this.angle),
            y: this.y + this.size / 2 + this.size * Math.sin(this.angle),
            radius: 5,
            dx: dx,
            dy: dy,
            shape: 'square',
            color: getRandomLavaColor()
        });
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
        lavaSpatialGrid.remove(this);
        this.x = GAME_CONFIG.REF_WIDTH / 4;
        this.y = GAME_CONFIG.REF_HEIGHT / 4;
        this.size = 40;
        this.projectiles.length = 0;
        this.hitCount = 0;
        this.lavaRectangles = this.generateLavaRectangles();
        this.splashes.forEach(splash => splash.destroy());
        this.splashes.length = 0;
        this.needsGridUpdate = true;
    }
}

export function setupLavaSquares(canvas, ctx, ball, endGame, platforms, projectiles, consumables, worldBounds) {
    const lavaSquares = [];
    let lastSpawnTime = 0;
    const SPAWN_INTERVAL = 4000;
    
    function drawLavaSquares() {
        ctx.save();
        lavaSquares.forEach(lavaSquare => lavaSquare.draw(ctx, ball));
        ctx.restore();
    }
    
    function updateLavaSquares() {
        // Splash cleanup lives in updateGameLogic (main.js) — don't double it up here.
        for (let i = lavaSquares.length - 1; i >= 0; i--) {
            const lavaSquare = lavaSquares[i];
            lavaSquare.update(ball, projectiles, consumables, platforms, endGame, lavaSquares);
        }
    }
    
    function spawnLavaSquare() {
        const currentTime = now();
        if (currentTime - lastSpawnTime < SPAWN_INTERVAL || 
            lavaSquares.length >= GAME_CONFIG.MAX_LAVA_SQUARES) {
            return;
        }
        
        lastSpawnTime = currentTime;
        
        const x = Math.random() > 0.5 ? ball.x + 500 : ball.x - 500;
        const size = Math.random() * (GAME_CONFIG.REF_HEIGHT / 30) + (GAME_CONFIG.REF_HEIGHT / 20);
        const y = worldBounds.bottom;
        const speed = Math.random() * GAME_CONFIG.REF_HEIGHT / 700 + GAME_CONFIG.REF_HEIGHT / 700;
        const projectileSpeed = speed * 1.1;
        const shootInterval = Math.random() * 1000 + 4000;
        const angle = Math.random() * Math.PI * 2;
        
        const lavaSquare = new LavaSquare(
            x, y, size, speed, projectileSpeed, shootInterval, 
            worldBounds, canvas, angle
        );
        
        lavaSquares.push(lavaSquare);
        lavaSpatialGrid.insert(lavaSquare, lavaSquare.x, lavaSquare.y, lavaSquare.size, lavaSquare.size);
    }
    
    // Use requestAnimationFrame for spawning to sync with game loop
    function spawnLoop() {
        if (ball.isGameRunning) {
            spawnLavaSquare();
        }
        requestAnimationFrame(spawnLoop);
    }
    
    spawnLoop();
    
    return {
        drawLavaSquares,
        updateLavaSquares,
        lavaSquares,
        getSpatialGridStats: () => lavaSpatialGrid.stats
    };
}