import { ballHarming } from './player.js';
import { Splash } from './splash.js';
import { GAME_CONFIG } from './config.js';

export function getRandomLavaColor() {
    let color;
    switch (Math.floor(Math.random() * 4)) {
        
        case 0:
            color = 'darkred';
            break;
        case 1:
            color = 'black';
            break;
        case 2:
            color = 'orange';
            break;
        case 3:
            color = 'yellow';
            break;
    }
    return color;
}
export function createLava(worldBounds,canvas) {
    const lines = [];
    const splashes = []; // Initialize splashes array

    let killed= false;
    // Function to generate random rectangles
    
    function generateLines() {
        for (let i = 0; i < 150; i++) {
            let color= getRandomLavaColor();
            
            

            lines.push({
                x: Math.random() * worldBounds.right,
                y: worldBounds.bottom - 50 + Math.random() * 50,
                width: Math.random() * 70 + 60,
                height: Math.random() * 30 + 10, // Fixed height for the rectangles
                speed: Math.random() * 0.5 + 0.5,
                color: color
            });
        }
    }

    // Generate initial lines
    generateLines();

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
            ctx.fillStyle = 'red';
            ctx.fillRect(this.x, this.y, this.width, this.height);
            // Draw red glow
            
            // Draw moving rectangles
            lines.forEach(line => {
                ctx.fillStyle = line.color;
                ctx.shadowColor = line.color;
        
            ctx.shadowBlur = 5;
                ctx.fillRect(line.x, line.y, line.width, line.height);
            });

            // Draw splashes
            splashes.forEach(splash => splash.draw(ctx));
            ctx.restore();
        },

        update(consumables) {
            // Update rectangle positions
            lines.forEach(line => {
                line.x += line.speed;
                if (line.x > worldBounds.right) {
                    line.x = -line.width;
                    line.y = worldBounds.bottom - 50 + Math.random() * 50;
                    line.color = getRandomLavaColor();
                }
            });

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