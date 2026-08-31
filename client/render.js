// Shared world renderer — draws a world snapshot with the original game's visual treatment.
// Used by the stage (menu backdrop + solo game). Kept as pure functions taking ctx + data
// so any caller (menu, solo, later multiplayer) renders identically.
// ponytail: mpClient.js still has its own copies for the networked path; unify in the lobby rework.
import { SHOT_RANGE, sampleRange } from '../sim/playerRanges.js';

export function drawPlatform(ctx, p) {
    ctx.fillStyle = p.color || '#777';
    ctx.fillRect(p.x, p.y, p.width, p.height);
    if (p.hitRectangles?.length) {
        ctx.fillStyle = 'grey';
        for (const crack of p.hitRectangles) {
            ctx.fillRect(p.x + crack.x, p.y + crack.y, crack.width, crack.height);
        }
    }
    ctx.fillStyle = 'grey';
    ctx.fillRect(p.x, p.y + p.height, p.width, 2);
}

export function drawProjectile(ctx, p) {
    const color = sampleRange(SHOT_RANGE, p.shotRange).color;
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(5, p.radius / 2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function drawPlayer(ctx, p, myId) {
    const range = sampleRange(SHOT_RANGE, p.shotRange);
    const color = range.color;
    const stock = p.maxStock ? p.currentStock / p.maxStock : 0;
    const stickLength = p.radius * stock + p.radius;
    const endX = p.x + stickLength * Math.cos(p.angle);
    const endY = p.y + stickLength * Math.sin(p.angle);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = p.radius / 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = p.radius / 2 * range.scale;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = p.radius / 3 * range.scale;
    ctx.stroke();

    for (const [amount, alpha] of [[0.5, 0.2], [1, 0.1]]) {
        ctx.beginPath();
        ctx.arc(p.x - (p.dx || 0) * amount, p.y - (p.dy || 0) * amount, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    for (const projectile of p.projectiles) drawProjectile(ctx, projectile);
}

export function drawEnemy(ctx, e) {
    // The shared lava material draws the body and outline before this pass.
}

export function drawConsumable(ctx, c) {
    ctx.save();
    ctx.fillStyle = c.color || 'white';
    ctx.shadowColor = 'white';
    ctx.shadowBlur = 20;
    if (c.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.size / 2, 0, Math.PI * 2);
        ctx.fill();
    } else ctx.fillRect(c.x, c.y, c.size, c.size);
    ctx.restore();
}

// Full scene (minus HUD): clears, applies the camera, draws background + world + lava + cursor.
export function renderWorld(ctx, {
    canvas, state, background, lava, lavaBackground, camX, camY, myId = null,
    mouseX = 0, mouseY = 0, reticleInvert = false, showReticle = true
}) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camX, -camY);
    background.draw({ x: camX, y: camY });
    for (const p of state.platforms) drawPlatform(ctx, p);
    for (const c of state.consumables || []) drawConsumable(ctx, c);
    lavaBackground?.drawReveal(ctx, state.enemies || []);
    for (const e of state.enemies || []) drawEnemy(ctx, e);
    for (const p of state.players) drawPlayer(ctx, p, myId);
    lava.draw(ctx);

    const me = myId != null ? state.players.find(p => p.id === myId) : null;
    if (me && showReticle) {
        ctx.save();
        ctx.fillStyle = 'white';
        if (reticleInvert) {
            ctx.globalCompositeOperation = 'difference';
            ctx.shadowBlur = 0;
        } else {
            ctx.shadowColor = 'white';
            ctx.shadowBlur = me.radius / 6;
        }
        ctx.beginPath();
        ctx.arc(mouseX + camX, mouseY + camY, me.radius / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}
