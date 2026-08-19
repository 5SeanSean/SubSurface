// filepath: /h:/Downloads/PLATZIO/platforms.js
import { createLava } from './lava.js';
import { Splash } from './splash.js';
import { worldBounds } from './view.js';
import { physics } from './physics.js';
import { ballHarming } from './player.js';
import { GAME_CONFIG } from './config.js';
import { SpatialGrid } from './spatialGrid.js';

const genPlatSplashes = [];
let spatialGrid = new SpatialGrid(GAME_CONFIG.CELL_SIZE);

function destroySplashes(platform, tOrB) {
    for (let i = 0; i < 3; i++) {
        const splash = new Splash(
            platform.x + Math.random() * platform.width,
            platform.y + tOrB * platform.height,
            platform.width * platform.height / 300,
            'grey',
            'square',
            Math.random() * platform.width / 5,
            platform.yPhysics * 3,
            platform.width / 30
        );
        genPlatSplashes.push(splash);
    }
    
    for (let i = 0; i < 3; i++) {
        const splash = new Splash(
            platform.x + Math.random() * platform.width,
            platform.y + tOrB * platform.height,
            platform.width * platform.height / 300,
            'grey',
            'square',
            Math.random() * -platform.width / 5,
            platform.yPhysics * 3,
            platform.width / 30
        );
        genPlatSplashes.push(splash);
    }
}

class Platform {
    constructor(x, y, width, height, dx, dy, xPhysics, yPhysics, canvas) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.dx = dx;
        this.dy = dy;
        this.xPhysics = xPhysics;
        this.yPhysics = yPhysics;
        this.hits = 0;
        this.color = '#354859';
        this.hitRectangles = [];
        this.harmssquares = false;
        this.size = width * height;
        this.toRemove = false;
        this.canvas = canvas;
        this.splashes = [];
        this.id = Math.random().toString(36).substr(2, 9);
    }
    
    generateSplashes(tOrB) {
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
        this.harmssquares = true;
        
        setTimeout(() => {
            this.harmssquares = false;
        }, 1);
        
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

export function setupPlatforms(canvas, worldBounds) {
    const maxPlatDY = (GAME_CONFIG.REF_HEIGHT / 1000);
    const platforms = [];
    
    function newPlatform() {
        const platform = new Platform(
            Math.random() * (worldBounds.right),
            -30,
            Math.random() * (worldBounds.right / 25) + (worldBounds.right / 40),
            Math.random() * (worldBounds.bottom / 170) + (worldBounds.bottom / 90),
            0,
            Math.random() * (GAME_CONFIG.REF_HEIGHT / 3000) + (GAME_CONFIG.REF_HEIGHT / 2000),
            0,
            0,
            canvas
        );
        platforms.push(platform);
        spatialGrid.insert(platform, platform.x, platform.y, platform.width, platform.height);
        return platform;
    }
    
    function genSidePlatX() {
        let sideX;
        if (Math.random() > 0.5) {
            sideX = Math.random() * ((worldBounds.right / 2) - ((worldBounds.right / 25) + (worldBounds.right / 40)) * 2);
        } else {
            sideX = Math.random() * ((worldBounds.right / 2) - ((worldBounds.right / 25) + (worldBounds.right / 40))) + 
                    (worldBounds.right / 25) + (worldBounds.right / 40) + (worldBounds.right / 2);
        }
        return sideX;
    }
    
    function startPlatforms() {
        const platform = new Platform(
            genSidePlatX(),
            Math.random() * (worldBounds.bottom - 100),
            Math.random() * (worldBounds.right / 25) + (worldBounds.right / 40),
            Math.random() * (worldBounds.bottom / 170) + (worldBounds.bottom / 90),
            0,
            Math.random() * (maxPlatDY - GAME_CONFIG.REF_HEIGHT / 2000) + (GAME_CONFIG.REF_HEIGHT / 2000),
            0,
            0,
            canvas
        );
        platforms.push(platform);
        spatialGrid.insert(platform, platform.x, platform.y, platform.width, platform.height);
        return platform;
    }
    
    function generatePlatforms() {
        platforms.length = 0;
        spatialGrid.clear();
        
        for (let i = 0; i < GAME_CONFIG.PLATFORM_COUNT; i++) {
            startPlatforms();
        }
        
        const startPlatform = new Platform(
            worldBounds.right / 2 - (worldBounds.right / 120),
            worldBounds.bottom / 1.6,
            (worldBounds.right / 60),
            (worldBounds.bottom / 30),
            0,
            Math.random() * (GAME_CONFIG.REF_HEIGHT / 3000) + (GAME_CONFIG.REF_HEIGHT / 2000),
            0,
            0,
            canvas
        );
        platforms.push(startPlatform);
        spatialGrid.insert(startPlatform, startPlatform.x, startPlatform.y, startPlatform.width, startPlatform.height);
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

// Ball-independent platform update: splashes, movement, platform-platform collisions.
function updatePlatformsMovement() {
    // Update platform splashes
    for (let i = genPlatSplashes.length - 1; i >= 0; i--) {
        genPlatSplashes[i].update();
        if (genPlatSplashes[i].isFinished()) {
            genPlatSplashes.splice(i, 1);
        }
    }
    
    // Update platforms and rebuild spatial grid
    for (let i = platforms.length - 1; i >= 0; i--) {
        const platform = platforms[i];
        
        platform.size = platform.height * platform.width;
        platform.y += (platform.dy + platform.yPhysics);
        platform.x += (platform.dx + platform.xPhysics);
        
        // Update platform in spatial grid
        spatialGrid.update(platform, platform.x, platform.y, platform.width, platform.height);
        
        physics(platform);
        
        // Remove platforms that fall out of bounds
        if (platform.y > worldBounds.bottom) {
            newPlatform();
            platform.toRemove = true;
        }
        
        if (platform.toRemove) {
            spatialGrid.remove(platform);
            platforms.splice(i, 1);
            continue;
        }
        
        // Update platform splashes
        for (let j = platform.splashes.length - 1; j >= 0; j--) {
            platform.splashes[j].update();
            if (platform.splashes[j].isFinished()) {
                platform.splashes.splice(j, 1);
            }
        }
    }
    
    // Check platform-platform collisions using spatial grid
    checkPlatformPlatformCollisions();
}

function checkPlatformPlatformCollisions() {
    // Use spatial grid for platform-platform collisions
    const allPlatforms = [];
    spatialGrid.grid.forEach(cell => {
        cell.forEach(platform => {
            if (!allPlatforms.includes(platform)) {
                allPlatforms.push(platform);
            }
        });
    });
    
    for (const platform of allPlatforms) {
        const nearbyPlatforms = spatialGrid.getNearby(
            platform.x, platform.y, platform.width, platform.height
        );
        
        for (const otherPlatform of nearbyPlatforms) {
            if (otherPlatform === platform) continue;
            
            if (platform.y + platform.height > otherPlatform.y && 
                platform.y < otherPlatform.y &&
                ((platform.x > otherPlatform.x && platform.x < otherPlatform.x + otherPlatform.width) ||
                 (platform.x + platform.width > otherPlatform.x && platform.x + platform.width < otherPlatform.x + otherPlatform.width))) {
                
                otherPlatform.y = platform.y + platform.height;
                const newDY = (platform.dy + otherPlatform.dy) / 2;
                platform.dy = newDY;
                otherPlatform.dy = newDY;
                const newPhysics = (platform.yPhysics + otherPlatform.yPhysics) / 2;
                platform.yPhysics = newPhysics;
                otherPlatform.yPhysics = newPhysics;
                
                // Update positions in spatial grid
                spatialGrid.update(platform, platform.x, platform.y, platform.width, platform.height);
                spatialGrid.update(otherPlatform, otherPlatform.x, otherPlatform.y, otherPlatform.width, otherPlatform.height);
            }
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
                        genPlatSplashes.push(new Splash(ball.x, ball.y, ball.radius, 'white'));
                    } else {
                        ball.dy = Math.abs(ball.dy / 2) + platform.dy;
                    }
                }
                ball.isJumping = true;
            }
        }
    }
}
        
    generatePlatforms();
return {
    platforms,
    drawPlatforms,
    generatePlatforms,
    updatePlatforms,                                  // single-player: movement + one ball
    updatePlatformsMovement,                          // multiplayer: movement once per tick
    checkBallPlatforms: (ball) => checkBallPlatformCollisions(ball, null), // then per player
    getSpatialGridStats: () => spatialGrid.stats,
    getNearbyPlatforms: (x, y, width, height) => {
        return spatialGrid.getNearby(x, y, width, height);
    },
    spatialGrid: spatialGrid // Add this line!
};
}