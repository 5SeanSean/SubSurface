// filepath: /h:/Downloads/PLATZIO/player.js
import { physics } from './physics.js';
import { now } from './clock.js';
import { GAME_CONFIG } from './config.js';

export let mouseXAdjusted = 0;
export let mouseYAdjusted = 0;

export function setupPlayer(canvas, ctx, platforms, endGame, worldBounds) {
    const H = GAME_CONFIG.REF_HEIGHT; // sim units are fixed to reference height, not the window
    const ball = {
        x: worldBounds.right / 2,
        y: H / 16,
        radius: H / 18,
        speed: H / 270,
        dx: 0,
        dy: 0,
        gravity: H / 10000,
        jumpPower: -H / 100,
        isJumping: false,
        canDoubleJump: true,
        friction: 0.87, // per-frame horizontal damping (<1 so the ball decelerates).
                        // Was H/1080 — which is exactly 1.0 at reference height = no decay.
        fireRate: 200,
        projSpeed: H / 50,
        currentStock: 10,
        maxStock: 10,
        isGameRunning: false,
        projectiles: [],
        score: 0,
        xPhysics: 0,
        yPhysics: 0,
        angle: 0,
        strength: 1,
    };
    
    const pCamera = {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height
    };
    
    function updatePCamera() {
        pCamera.x = ball.x - pCamera.width / 2;
        pCamera.y = ball.y - pCamera.height / 2;
        pCamera.x = Math.max(worldBounds.left, Math.min(pCamera.x, worldBounds.right - pCamera.width));
        pCamera.y = Math.max(worldBounds.top, Math.min(pCamera.y, worldBounds.bottom - pCamera.height));
    }
    
    function resetPlayer() {
        ball.isGameRunning = false;
        ball.x = worldBounds.right / 2;
        ball.y = H / 16;
        ball.dx = 0;
        ball.dy = 0;
        ball.currentStock = ball.maxStock;
        ball.isJumping = false;
        ball.canDoubleJump = true;
        ball.radius = H / 18;
        ball.score = 0;
        input.shooting = false;
        input.jumpPressed = false;
        input.keys.clear();
    }
    
    // Input state — the ONLY channel between the input source and the simulation.
    // The browser DOM handlers below write it; the sim (updateBall/handleShooting)
    // reads it. An authoritative server would fill the same shape from network
    // packets instead of DOM events, and nothing in the sim would change.
    const input = {
        keys: new Set(),    // held movement keys (a/d/s + arrows)
        shooting: false,    // fire button held
        mouseX: 0,
        mouseY: 0,
        jumpPressed: false  // edge: set on a jump keydown, consumed once per tick
    };
    let lastShotTime = 0;
    const fireRate = ball.fireRate;
    
    // Input handling with debouncing
    // DOM handlers only translate events into `input` state — no game logic here,
    // so this whole block is what a network input source replaces.
    function handleKeyDown(event) {
        const key = event.key.toLowerCase();
        input.keys.add(key);
        if ((key === ' ' || key === 'w' || key === 'arrowup') && ball.isGameRunning) {
            input.jumpPressed = true;
            event.preventDefault(); // Prevent spacebar from scrolling
        }
    }

    function handleKeyUp(event) {
        input.keys.delete(event.key.toLowerCase());
    }

    // Mouse handling
    function handleMouseDown(event) {
        if (event.button === 0 && ball.isGameRunning) {
            input.shooting = true;
        }
        updateMousePosition(event);
    }

    function handleMouseUp(event) {
        if (event.button === 0) {
            input.shooting = false;
        }
        updateMousePosition(event);
    }

    function handleMouseMove(event) {
        updateMousePosition(event);
    }

    function updateMousePosition(event) {
        input.mouseX = event.clientX;
        input.mouseY = event.clientY;
    }
    
    // Update ball direction based on keys
    function updateBallDirection() {
        const hasA = input.keys.has('a') || input.keys.has('arrowleft');
        const hasD = input.keys.has('d') || input.keys.has('arrowright');
        const hasS = input.keys.has('s') || input.keys.has('arrowdown');
        
        if (hasA && hasD) {
            ball.dx = 0;
        } else if (hasA) {
            ball.dx = -ball.speed;
        } else if (hasD) {
            ball.dx = ball.speed;
        } else {
            ball.dx *= ball.friction;
        }
        
        if (hasS && ball.isGameRunning && ball.dy < 15) {
            ball.dy += 0.5 * ball.strength;
            ball.isJumping = false;
        }
    }
    
    // Draw functions (optimized)
    function drawBall() {
        ctx.save();
        
        // Set up glow effect
        ctx.shadowColor = 'white';
        ctx.shadowBlur = ball.radius / 2;
        
        mouseXAdjusted = input.mouseX + pCamera.x;
        mouseYAdjusted = input.mouseY + pCamera.y;
        
        // Draw stick pointing at cursor
        const stickLength = (ball.radius) * (ball.currentStock / ball.maxStock) + ball.radius;
        const stickEndX = ball.x + stickLength * Math.cos(ball.angle);
        const stickEndY = ball.y + stickLength * Math.sin(ball.angle);
        
        // Draw stick shadow
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(stickEndX, stickEndY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = ball.radius / 2;
        ctx.stroke();
        
        // Draw stick
        ctx.beginPath();
        ctx.moveTo(ball.x, ball.y);
        ctx.lineTo(stickEndX, stickEndY);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = ball.radius / 3;
        ctx.stroke();
        
        // Draw motion blur effects
        ctx.beginPath();
        ctx.arc(ball.x - ball.dx / 2, ball.y - ball.dy / 2, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(ball.x - ball.dx, ball.y - ball.dy, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fill();
        
        // Draw main ball
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
        
        ctx.restore();
    }
    
    function drawProjectiles() {
        ctx.save();
        ctx.shadowColor = 'white';
        
        ball.projectiles.forEach(projectile => {
            ctx.shadowBlur = projectile.radius / 2;
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
            ctx.fill();
        });
        
        ctx.restore();
    }
    
    function updateBall() {
        ball.angle = Math.atan2(mouseYAdjusted - ball.y, mouseXAdjusted - ball.x);
        updatePCamera();

        // Consume a queued jump this tick (was applied inline in the old keydown handler)
        if (input.jumpPressed && ball.isGameRunning) {
            if (!ball.isJumping) {
                ball.dy = ball.jumpPower * ball.strength;
                ball.isJumping = true;
                ball.canDoubleJump = true;
            } else if (ball.canDoubleJump) {
                ball.dy = ball.jumpPower * ball.strength;
                ball.canDoubleJump = false;
            }
        }
        input.jumpPressed = false;

        // Score readout is UI/render — updated in main.js draw(), not here in the sim.
        updateBallDirection();
        
        ball.x += ball.dx * (0.2 + ball.strength * 0.8) + ball.xPhysics;
        ball.y += ball.dy + ball.yPhysics;
        
        physics(ball);
        
        // Apply gravity
        ball.dy += ball.gravity;
        
        // Boundary checks
        if (ball.x - ball.radius < worldBounds.left) {
            ball.x = worldBounds.left + ball.radius;
            ball.dx = -ball.dx / 1.5;
        } else if (ball.x + ball.radius > worldBounds.right) {
            ball.x = worldBounds.right - ball.radius;
            ball.dx = -ball.dx / 1.5;
        }
        
        if (ball.y - ball.radius < 0) {
            ball.y = 0 + ball.radius;
            ball.dy = Math.abs(ball.dy) + ball.gravity;
            ball.isJumping = true;
        }
        
        if (ball.y > worldBounds.bottom + ball.radius) {
            ball.y = worldBounds.bottom + ball.radius;
            ball.dx = 0;
            ball.isJumping = false;
            ball.canDoubleJump = true;
        }
        
        // Game over conditions
        if (ball.radius < H / 40) {
            endGame();
        }
        
        // Recover strength
        if (ball.strength < 1) {
            ball.strength += 0.05;
        }
        
        if (ball.strength < 0) {
            ball.strength = 0;
        }
    }
    
    // Projectile functions
    function updateProjectiles() {
        for (let i = ball.projectiles.length - 1; i >= 0; i--) {
            const projectile = ball.projectiles[i];
            
            projectile.x += projectile.dx;
            projectile.y += projectile.dy;
            projectile.dy += 0.05;
            
            // Check platform collisions
            let collided = false;
            for (const platform of platforms) {
                if (projectile.x + projectile.radius > platform.x &&
                    projectile.x - projectile.radius < platform.x + platform.width &&
                    projectile.y + projectile.radius > platform.y &&
                    projectile.y - projectile.radius < platform.y + platform.height) {
                    
                    if (projectile.y - projectile.radius < platform.y || 
                        projectile.y + projectile.radius > platform.y + platform.height) {
                        projectile.dy = -projectile.dy;
                        projectile.ricochetCount++;
                    }
                    
                    if (projectile.x - projectile.radius < platform.x || 
                        projectile.x + projectile.radius > platform.x + platform.width) {
                        projectile.dx = -projectile.dx;
                        projectile.ricochetCount++;
                    }
                    
                    collided = true;
                    break;
                }
            }
            
            // Check player collision
            if (!collided && Math.hypot(projectile.x - ball.x, projectile.y - ball.y) < 
                projectile.radius + ball.radius && projectile.ricochetCount >= 1) {
                ball.radius += ball.radius / 1000;
                ball.projectiles.splice(i, 1);
                continue;
            }
            
            // Remove out of bounds projectiles
            if (projectile.x < ball.x - GAME_CONFIG.REF_WIDTH ||
                projectile.x > ball.x + GAME_CONFIG.REF_WIDTH ||
                projectile.y < 0 ||
                projectile.y > worldBounds.bottom || 
                projectile.ricochetCount >= 3) {
                ball.projectiles.splice(i, 1);
            }
        }
    }
    
    function handleShooting() {
        if (input.shooting) {
            const currentTime = now();
            if (currentTime - lastShotTime >= fireRate) {
                shootProjectile();
                lastShotTime = currentTime;
            }
        }
    }
    
    function shootProjectile() {
        if (ball.currentStock <= 0) {
            reload();
            return;
        }
        
        ball.currentStock--;
        const speed = ball.projSpeed;
        const dx = speed * Math.cos(ball.angle);
        const dy = speed * Math.sin(ball.angle);
        ball.radius -= ball.radius / 1000;
        
        ball.projectiles.push({
            x: ball.x + (ball.radius * 1.7 * Math.cos(ball.angle)) / 2,
            y: ball.y + (ball.radius * 1.7 * Math.sin(ball.angle)) / 2,
            radius: ball.radius / 6,
            dx: dx,
            dy: dy,
            ricochetCount: 0,
        });
    }
    
    function reload() {
        for (let i = 0; i < 5; i++) {
            setTimeout(() => ball.radius *= 1.02, 30 * i);
        }
        
        reloadHelper();
        for (let i = 0; i < ball.maxStock - 1; i++) {
            setTimeout(reloadHelper, 10 * i);
        }
    }
    
    function reloadHelper() {
        ball.currentStock++;
        ball.radius /= 1.02;
    }
    
    // Event listeners with passive option for better performance
   window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp, { passive: true });
    canvas.addEventListener('mousedown', handleMouseDown, { passive: true });
    canvas.addEventListener('mouseup', handleMouseUp, { passive: true });
    canvas.addEventListener('mousemove', handleMouseMove, { passive: true });
    
    return {
        drawBall,
        drawProjectiles,
        updateBall,
        updateProjectiles,
        handleShooting,
        resetPlayer,
        ball,
        mouseXAdjusted,
        mouseYAdjusted,
    };
}

export function ballHarming(ball) {
    ball.radius = ball.radius / 1.01;
}