import { SHOT_RANGE, sampleRange } from './playerRanges.js';

// Shared game geometry keeps rendering, cursor hit-testing and physics in agreement.
export function playerArm(player) {
    const stock = player.maxStock ? player.currentStock / player.maxStock : 0;
    const length = player.radius * (1 + stock);
    const scale = sampleRange(SHOT_RANGE, player.shotRange).scale;
    const radius = player.radius / 6 * scale;
    return {
        x1: player.x, y1: player.y,
        x2: player.x + length * Math.cos(player.angle),
        y2: player.y + length * Math.sin(player.angle),
        length, radius
    };
}

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
    const vx = x2 - x1, vy = y2 - y1;
    const lengthSquared = vx * vx + vy * vy;
    const t = lengthSquared ? Math.max(0, Math.min(1,
        ((px - x1) * vx + (py - y1) * vy) / lengthSquared)) : 0;
    return { x: x1 + vx * t, y: y1 + vy * t };
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
    const closest = closestPointOnSegment(px, py, x1, y1, x2, y2);
    return Math.hypot(px - closest.x, py - closest.y);
}

export function pointOverPlayer(player, x, y) {
    if (Math.hypot(x - player.x, y - player.y) <= player.radius) return true;
    const arm = playerArm(player);
    return pointSegmentDistance(x, y, arm.x1, arm.y1, arm.x2, arm.y2) <= arm.radius;
}

// Arms are one-way support surfaces for other players. Only a downward approach onto the
// upper face resolves; side/bottom overlap is ignored so aiming an arm cannot trap, drag, or
// launch somebody. The hidden portion inside the owner's body is excluded from support.
export function resolveBallOnArm(rider, owner, previous = rider) {
    if (!rider || !owner || rider === owner || rider.id === owner.id) return false;
    const arm = playerArm(owner);
    const root = Math.min(1, (owner.radius + arm.radius) / Math.max(arm.length, 1));
    const x1 = arm.x1 + (arm.x2 - arm.x1) * root;
    const y1 = arm.y1 + (arm.y2 - arm.y1) * root;
    const closest = closestPointOnSegment(rider.x, rider.y, x1, y1, arm.x2, arm.y2);
    const dx = rider.x - closest.x, dy = rider.y - closest.y;
    const distance = Math.hypot(dx, dy);
    const supportRadius = rider.radius + arm.radius;
    if (distance >= supportRadius || distance < 1e-6) return false;

    const nx = dx / distance, ny = dy / distance;
    if (ny > -0.3) return false; // not the upper surface
    const ownerDy = Number.isFinite(owner.dy) ? owner.dy : 0;
    if (rider.dy < Math.min(0, ownerDy) - 0.5) return false; // moving up through it

    // Reject deep pre-existing overlap. A normal landing begins outside (or within a tiny
    // gravity-sized tolerance), which also keeps resting contact stable on following ticks.
    const oldClosest = closestPointOnSegment(previous.x, previous.y, x1, y1, arm.x2, arm.y2);
    const oldDistance = Math.hypot(previous.x - oldClosest.x, previous.y - oldClosest.y);
    if (oldDistance < supportRadius - 2) return false;

    const penetration = supportRadius - distance;
    rider.x += nx * penetration;
    rider.y += ny * penetration;
    rider.dy = Math.min(0, ownerDy);
    rider.canDoubleJump = true;
    rider.isJumping = false;
    return true;
}
