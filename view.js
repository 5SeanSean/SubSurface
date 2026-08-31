// filepath: /h:/Downloads/SUBSURFACE/view.js
import { GAME_CONFIG } from './config.js';

// Fixed world bounds (no `window` — must be importable headless in Node and identical
// for every player). The camera below is the only part that reads the real canvas size.
export const worldBounds = {
    left: 0,
    right: GAME_CONFIG.WORLD_WIDTH,
    top: 0,
    bottom: GAME_CONFIG.WORLD_HEIGHT
};

export function setupView(canvas, ctx, ball) {
    const camera = {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height
    };

    function updateCamera() {
        // Center the camera on the ball's x position
        camera.x = ball.x - camera.width / 2;
        camera.y = ball.y - camera.height / 2;
        // Clamp the camera position within the world bounds
        camera.x = Math.max(worldBounds.left, Math.min(camera.x, worldBounds.right - camera.width));
        camera.y = Math.max(worldBounds.top, Math.min(camera.y, worldBounds.bottom - camera.height));
    }

    function clearCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function drawWithCamera(drawFunction) {
        ctx.save();
        ctx.translate(-camera.x, -camera.y);
        drawFunction(ctx);
        ctx.restore();
    }

    return {
        camera,
        updateCamera,
        clearCanvas,
        drawWithCamera
    };
}