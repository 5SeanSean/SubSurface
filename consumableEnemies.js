// filepath: /h:/Downloads/PLATZIO/playerConsumables.js
import { createLava } from "./lava.js";
import { physics } from "./physics.js";
import { GAME_CONFIG } from "./config.js";
export class Consumable {
    constructor(x, y, size, color, shape = 'square', xPhysics =0, yPhysics =0) {
        this.x = x;
        this.y = y;
        this.size = size;
        this.color = color;
        this.shape = shape;
        this.speed = Math.random() *2+1;
        this.dx = 0;
        this.dy = 0;
        this.gravity = 0.1;
        this.splashed = false;
        this.yPhysics = yPhysics;
        this.xPhysics = xPhysics;
        this.speed = 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.shadowColor = 'white';
        ctx.shadowBlur = 20;
        if (this.shape === 'square') {
            ctx.fillRect(this.x, this.y, this.size, this.size);
        } else if (this.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.closePath();
        }
        ctx.restore();
    }
    
update(nearbyPlatforms, worldBounds, canvas) {
    // Apply gravity
    this.dy += this.gravity;
    if (this.y > worldBounds.bottom - GAME_CONFIG.REF_HEIGHT/18) {
        this.dy -= this.gravity * 2;
    }
    
    // Check for collisions with nearby platforms only.
    // Same resolver as LavaSquare.checkPlatformCollisions: smallest-penetration axis,
    // ejection direction by center-side (position), not velocity sign — velocity lies
    // about which side you're on when platforms drift, which pops objects through.
    for (const platform of nearbyPlatforms) {
        const left = this.x, right = this.x + this.size;
        const top = this.y, bottom = this.y + this.size;
        const pLeft = platform.x, pRight = platform.x + platform.width;
        const pTop = platform.y, pBottom = platform.y + platform.height;

        if (right > pLeft && left < pRight && bottom > pTop && top < pBottom) {
            const penX = Math.min(right - pLeft, pRight - left);
            const penY = Math.min(bottom - pTop, pBottom - top);

            if (penX < penY) {
                if (this.x + this.size / 2 < pLeft + platform.width / 2) this.x = pLeft - this.size;
                else this.x = pRight;
                this.dx = 0;
            } else {
                if (this.y + this.size / 2 < pTop + platform.height / 2) this.y = pTop - this.size;
                else this.y = pBottom;
                this.dy = 0;
            }
        }
    }

    return false; // Indicate that the consumable should not be removed
}


    checkEnContact(squares) {
        let enConsumed = false;
        squares.forEach(square => {
            const dist = Math.hypot(this.x - square.x, this.y - square.y);
            if (dist < this.size)  {
                square.size+= this.size/3;
                square.x = square.x + square.size/2;
                square.y = square.y + square.size/2;
                enConsumed = true;
            }
                         
        });
    return enConsumed;
}

checkCollision(ball) {
    const dx = this.x + this.size/2 - ball.x;
    const dy = this.y + this.size/2 - ball.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < this.size/2 + ball.radius;
}

}
export function drawConsumables(ctx, consumables) {
    consumables.forEach(consumable => consumable.draw(ctx));
}

export function updateConsumables(consumables, ball, projectiles, endGame, platforms, worldBounds, squares, canvas) {
    for (let i = consumables.length - 1; i >= 0; i--) {
        const consumable = consumables[i];
        const angle = Math.atan2(ball.y - consumable.y - consumable.size/2, ball.x - consumable.x - consumable.size/2);
        
        consumable.x += consumable.dx + consumable.xPhysics;
        if (consumable.speed > 0) {
            consumable.dy = (Math.sin(angle) * consumable.speed);
            consumable.dx = Math.cos(angle) * consumable.speed;
        }
        
        consumable.y += consumable.dy + consumable.yPhysics;
        
        // Check collision with projectiles
        for (let j = ball.projectiles.length - 1; j >= 0; j--) {
            const projectile = ball.projectiles[j];
            if (projectile.x + projectile.radius > consumable.x &&
                projectile.x - projectile.radius < consumable.x + consumable.size &&
                projectile.y + projectile.radius > consumable.y &&
                projectile.y - projectile.radius < consumable.y + consumable.size) {
                
                consumable.speed += projectile.radius/10;
                projectile.dx = -projectile.dx;
                projectile.dy = -projectile.dy;
            }
        }
        
        physics(consumable);
        
        // Get nearby platforms using spatial grid.
        // No optional chaining: passing the wrong thing here should throw, not silently
        // return zero platforms (that bug let consumables fall through the world).
        const nearbyPlatforms = platforms.getNearbyPlatforms(
            consumable.x, consumable.y, consumable.size, consumable.size
        );
        
        // Update consumable with only nearby platforms
        if (consumable.update(nearbyPlatforms, worldBounds, canvas) || 
            consumable.checkCollision(ball) || 
            consumable.checkEnContact(squares)) {
            
            if (consumable.checkCollision(ball)) {
                ball.score += consumable.size; 
                ball.radius += consumable.size/6;
            }
            
            consumables.splice(i, 1);
        }
    }
}