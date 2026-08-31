// filepath: /h:/Downloads/SUBSURFACE/splash.js
import { textToRGB } from './tools.js';
import { getRandomLavaColor } from './lava.js';
import { physics } from './physics.js';
import { pools, initializePools } from './objectPool.js';

// Initialize pools on module load
if (!pools.splashes || !pools.particles) {
    initializePools();
}

export class Splash {
    constructor(x, y, radius, color, shape = 'circle', xPhysics = 0, yPhysics = 0, amount = 3) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.shape = shape;
        this.opacity = 1;
        this.growthRate = 0.5;
        this.fadeRate = 0.02;
        this.particles = [];
        
        // Use object pool for particles
        for (let i = 0; i < Math.min(amount, 10); i++) { // Limit amount
            let particleColor = this.color;
            if (this.color === 'lava') {
                particleColor = getRandomLavaColor();
            }
            
            const particle = pools.particles.acquire();
            particle.x = x;
            particle.y = y;
            particle.radius = Math.random() * this.radius / 5 + this.radius / 10;
            particle.dy = yPhysics / 40 * Math.random() + yPhysics / 20;
            particle.xPhysics = xPhysics / 4 + (Math.random() - 0.5) * this.radius / 5;
            particle.yPhysics = yPhysics / 4 + (Math.random() - 0.5) * this.radius / 5;
            particle.opacity = 1;
            particle.color = particleColor;
            
            this.particles.push(particle);
        }
    }
    
    draw(ctx) {
        ctx.save();
        
        // Batch particles by shape and color
        const squareParticles = [];
        const circleParticles = [];
        
        this.particles.forEach(particle => {
            if (this.shape === 'square') {
                squareParticles.push(particle);
            } else {
                circleParticles.push(particle);
            }
        });
        
        // Draw square particles
        if (squareParticles.length > 0) {
            squareParticles.forEach(particle => {
                const colorToUse = particle.color || this.color;
                ctx.fillStyle = `rgba(${textToRGB(colorToUse)}, ${particle.opacity})`;
                ctx.fillRect(
                    particle.x - particle.radius,
                    particle.y - particle.radius,
                    particle.radius * 2,
                    particle.radius * 2
                );
            });
        }
        
        // Draw circle particles
        if (circleParticles.length > 0) {
            circleParticles.forEach(particle => {
                const colorToUse = particle.color || this.color;
                ctx.fillStyle = `rgba(${textToRGB(colorToUse)}, ${particle.opacity})`;
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ctx.fill();
            });
        }
        
        ctx.restore();
    }
    
    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            
            particle.x += particle.xPhysics;
            particle.y += particle.yPhysics + particle.dy;
            particle.dy += 0.1; // Gravity effect
            particle.opacity -= 0.01; // Fade out effect
            
            physics(particle);
            
            // Return to pool when finished
            if (particle.opacity <= 0) {
                pools.particles.release(particle);
                this.particles.splice(i, 1);
            }
        }
    }
    
    isFinished() {
        return this.particles.length === 0;
    }
    
    // Clean up method to return all particles to pool
    destroy() {
        this.particles.forEach(particle => pools.particles.release(particle));
        this.particles.length = 0;
    }
}

export const generalSplashes = [];

// Clean up function for general splashes
export function cleanupGeneralSplashes() {
    for (let i = generalSplashes.length - 1; i >= 0; i--) {
        if (generalSplashes[i].isFinished()) {
            generalSplashes[i].destroy();
            generalSplashes.splice(i, 1);
        }
    }
}