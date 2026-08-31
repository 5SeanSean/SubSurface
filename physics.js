// filepath: /h:/Downloads/SUBSURFACE/physics.js
const DAMPING = 1.1;
const MIN_VELOCITY = 0.3;

export function physics(object) {
    // Early exit if no physics to process
    if (!object.xPhysics && !object.yPhysics) return;
    
    const xPhys = object.xPhysics;
    const yPhys = object.yPhysics;
    
    // Process X physics
    if (xPhys !== 0) {
        const absX = Math.abs(xPhys);
        if (absX > MIN_VELOCITY) {
            object.xPhysics = xPhys / DAMPING;
        } else {
            object.xPhysics = 0;
        }
    }
    
    // Process Y physics
    if (yPhys !== 0) {
        const absY = Math.abs(yPhys);
        if (absY > MIN_VELOCITY) {
            object.yPhysics = yPhys / DAMPING;
        } else {
            object.yPhysics = 0;
        }
    }
}

export function applyGravity(object, gravity) {
    object.dy += gravity;
}

export function applyFriction(object, friction) {
    object.dx *= friction;
}

export function checkBounds(object, bounds) {
    let bounced = false;
    
    // X bounds
    if (object.x < bounds.left) {
        object.x = bounds.left;
        if (object.dx < 0) {
            object.dx = -object.dx / 1.5;
            bounced = true;
        }
    } else if (object.x > bounds.right) {
        object.x = bounds.right;
        if (object.dx > 0) {
            object.dx = -object.dx / 1.5;
            bounced = true;
        }
    }
    
    // Y bounds
    if (object.y < bounds.top) {
        object.y = bounds.top;
        if (object.dy < 0) {
            object.dy = -object.dy;
            bounced = true;
        }
    } else if (object.y > bounds.bottom) {
        object.y = bounds.bottom;
        if (object.dy > 0) {
            object.dy = -object.dy / 2;
            bounced = true;
        }
    }
    
    return bounced;
}