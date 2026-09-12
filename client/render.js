// Shared world renderer — draws a world snapshot with the original game's visual treatment.
// Used by the stage (menu backdrop + solo game). Kept as pure functions taking ctx + data
// so any caller (menu, solo, later multiplayer) renders identically.
// ponytail: mpClient.js still has its own copies for the networked path; unify in the lobby rework.
import { SHOT_RANGE, sampleRange } from '../sim/playerRanges.js';
import { playerArm, pointOverPlayer } from '../sim/playerGeometry.js';
import { drawPlatformMaterial } from '../materials.js';

export function drawPlatform(ctx, p) {
    drawPlatformMaterial(ctx, p);
    if (p.hitRectangles?.length) {
        ctx.fillStyle = 'grey';
        for (const crack of p.hitRectangles) {
            ctx.fillRect(p.x + crack.x, p.y + crack.y, crack.width, crack.height);
        }
    }
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
    const arm = playerArm(p);

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = p.radius / 2;
    // Rectangular arm: square caps, one solid stroke sharing the body's colour + glow.
    // The tip is pushed out by the capsule radius so the flat end still reaches the surface
    // the physics capsule contacts (a butt cap otherwise stops short by that radius).
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(arm.x2 + Math.cos(p.angle) * arm.radius, arm.y2 + Math.sin(p.angle) * arm.radius);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = color;
    ctx.lineWidth = p.radius / 2 * range.scale;
    ctx.stroke();

    // Motion blur: smear ghost copies back along the velocity (any direction), longer and denser
    // the faster the body is moving. At rest it collapses to nothing.
    const vx = p.dx || 0, vy = p.dy || 0;
    const speed = Math.hypot(vx, vy);
    // Reach visible blur at ordinary recoil/walk speeds rather than only near a full radius per
    // tick. It still collapses completely at rest and remains proportional in every direction.
    const blur = Math.min(1, speed / Math.max(1, p.radius * 0.42));
    if (blur > 0.008) {
        const ghosts = Math.round(3 + blur * 9);
        for (let i = 1; i <= ghosts; i++) {
            const t = i / ghosts;
            const trailX = vx * t * 2.2, trailY = vy * t * 2.2;
            ctx.globalAlpha = 0.22 * blur * (1 - t);

            // Smear the arm with the body so fast movement reads as one rigid player silhouette
            // instead of a blurred ball dragging a perfectly crisp detached limb.
            ctx.beginPath();
            ctx.moveTo(p.x - trailX, p.y - trailY);
            ctx.lineTo(
                arm.x2 + Math.cos(p.angle) * arm.radius - trailX,
                arm.y2 + Math.sin(p.angle) * arm.radius - trailY
            );
            ctx.lineCap = 'butt';
            ctx.strokeStyle = color;
            ctx.lineWidth = p.radius / 2 * range.scale;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(p.x - trailX, p.y - trailY, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        }
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
        const worldMouseX = mouseX + camX;
        const worldMouseY = mouseY + camY;
        const overPlayer = state.players.some(p => pointOverPlayer(p, worldMouseX, worldMouseY));
        ctx.save();
        ctx.fillStyle = 'white';
        if (reticleInvert || overPlayer) {
            ctx.globalCompositeOperation = 'difference';
            ctx.shadowBlur = 0;
        } else {
            ctx.shadowColor = 'white';
            ctx.shadowBlur = me.radius / 6;
        }
        ctx.beginPath();
        ctx.arc(worldMouseX, worldMouseY, me.radius / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}
