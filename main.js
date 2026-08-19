// filepath: /h:/Downloads/PLATZIO/main.js
import { worldBounds, setupView } from './view.js';
import { advanceClock, resetClock } from './clock.js';
import { drawConsumables, updateConsumables } from './consumableEnemies.js';
import { setupPlatforms } from './platforms.js';
import { setupLavaSquares } from './lavaSquareEnemies.js';
import { setupPlayer } from './player.js';
import { createLava } from './lava.js';
import { Background } from './background.js';
import { mouseBall } from './mouseBall.js';
import { generalSplashes, cleanupGeneralSplashes } from './splash.js';
import { GAME_CONFIG } from './config.js';
import { initializePools } from './objectPool.js';

export const winSizeConstant = (1920 * 1080) / (window.innerWidth * window.innerHeight);

function setup() {
    // Initialize object pools
    initializePools();
    
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to fill the screen
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const fadeOverlay = document.getElementById('fadeOverlay');
    let isWindowFocused = true;
    let lastFrameTime = 0;
    let frameCount = 0;
    let fps = 0;
    
    window.addEventListener('focus', () => {
        isWindowFocused = true;
    });
    
    window.addEventListener('blur', () => {
        isWindowFocused = false;
    });
    
    function fadeIn() {
        fadeOverlay.style.opacity = '1';
        fadeOverlay.style.display = 'block';
        setTimeout(() => {
            fadeOverlay.style.opacity = '0';
            setTimeout(() => {
                fadeOverlay.style.display = 'none';
            }, 2000);
        }, 100);
    }
    
    // Initial fade in
    fadeIn();
    
    // Initialize game systems
    const platformsObj = setupPlatforms(canvas, worldBounds);
    const platforms = platformsObj.platforms;
    const updatePlatforms = platformsObj.updatePlatforms;
    
    const { drawBall, drawProjectiles, updateBall, updateProjectiles, handleShooting, ball, projectiles, resetPlayer } = 
        setupPlayer(canvas, ctx, platforms, endGame, worldBounds);
    
    const background = new Background(canvas, worldBounds);
    const consumables = [];
    let gameActive = true;
    let lava = createLava(worldBounds, canvas);
    
    function endGame() {
        ball.isGameRunning = false;
        const overlay = document.getElementById('gameOverlay');
        overlay.style.visibility = 'visible';
        gameActive = false;
        
        const scoreCounter = document.getElementById('scoreCounter');
        scoreCounter.style.top = '65%';
        scoreCounter.style.left = '50%';
        scoreCounter.style.transform = 'translate(-50%, -50%)';
    }
    
    const { camera, updateCamera, clearCanvas, drawWithCamera } = setupView(canvas, ctx, ball);
    const { drawLavaSquares, updateLavaSquares, lavaSquares } = 
        setupLavaSquares(canvas, ctx, ball, endGame, platformsObj, projectiles, consumables, worldBounds);
    
    // Restart button event listener
    document.getElementById('restartButton').addEventListener('click', restartGame);
    
    // Spacebar restart
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && !gameActive) {
            restartGame();
        }
    });
    
    function restartGame() {
        resetClock();
        resetPlayer();
        lavaSquares.length = 0;
        platformsObj.generatePlatforms();
        consumables.length = 0;
        lava = createLava(worldBounds, canvas);
        document.getElementById('gameOverlay').style.visibility = 'hidden';
        gameActive = true;
        
        const scoreCounter = document.getElementById('scoreCounter');
        scoreCounter.style.top = '2%';
        scoreCounter.style.left = '2%';
        scoreCounter.style.transform = 'translate(0,0)';
        fadeIn();
    }
    
    // Fixed timestep game loop
    let accumulator = 0;
    let lastTime = 0;
    
    function gameLoop(currentTime) {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        
        // Calculate FPS
        frameCount++;
        if (currentTime - lastFrameTime >= 1000) {
            fps = frameCount;
            frameCount = 0;
            lastFrameTime = currentTime;
            // Optional: log FPS for debugging
            // console.log(`FPS: ${fps}`);
        }
        
        if (gameActive && isWindowFocused) {
            // Fixed timestep physics update
            accumulator += deltaTime;
            while (accumulator >= GAME_CONFIG.TICK_DURATION) {
                updateGameLogic(GAME_CONFIG.TICK_DURATION);
                accumulator -= GAME_CONFIG.TICK_DURATION;
            }
        }
        
        // Always draw, even if game is paused
        draw();
        
        requestAnimationFrame(gameLoop);
    }
    
    function updateGameLogic(deltaTime) {
        advanceClock(deltaTime); // logical time advances one fixed tick per update
        updateConsumables(consumables, ball, projectiles, endGame, platformsObj, worldBounds, lavaSquares, canvas);
        updateBall();
        handleShooting();
        updateProjectiles();
        
        // Clean up old splashes
        cleanupGeneralSplashes();
        
        updateLavaSquares();
        updatePlatforms(ball);
        lava.update(consumables);
        lava.handleCollision(ball, endGame);
    }


    
    function draw() {
        // Score readout is UI — window-scaled here in the render layer, not in the sim.
        document.getElementById('scoreCounter').innerText =
            `Score: ${Math.round(ball.score * winSizeConstant)}`;

        if (!gameActive) {
            // Freeze-frame the death screen with the same camera transform as the live
            // frame, or the background is mis-positioned and the page shows through.
            clearCanvas();
            drawWithCamera(() => background.draw(camera));
            return;
        }
        
        clearCanvas();
        updateCamera();
        
        drawWithCamera(() => {
            // Draw background
            background.draw(camera);
            
            // Batch drawing operations
            ctx.save();
            platformsObj.drawPlatforms(ctx);
            drawConsumables(ctx, consumables);
            drawProjectiles();
            drawLavaSquares();
            drawBall();
            lava.draw(ctx);
            
          
            mouseBall(ball, ctx);
            background.drawOverlay(camera);
            ctx.restore();
            
        });
        
        // Draw FPS counter (optional, for debugging)
        // drawFPS(ctx);
    }
    
    
    // Start the game loop
    requestAnimationFrame(gameLoop);
}

window.onload = setup;