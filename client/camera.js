// The one camera. A scene sets a TARGET — a function returning the world point to centre on —
// and the camera eases toward it, clamped to the world. Everything the game wants from a camera
// is expressible as a target: follow your ball, frame a group of players, spectate someone else,
// or walk a scripted path for a cutscene. Scenes no longer write camera code.
import { GAME_CONFIG } from '../config.js';

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const WORLD_H = GAME_CONFIG.WORLD_HEIGHT;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// Centre of a set of points. The lobby framing (host + everyone lowering in) wants this.
export function centroid(points) {
    if (!points.length) return null;
    let x = 0, y = 0;
    for (const p of points) { x += p.x; y += p.y; }
    return { x: x / points.length, y: y / points.length };
}

export function createCamera(canvas) {
    const pos = { x: 0, y: 0 };     // top-left of the view, in world space
    let target = null;              // () => {x,y} | null  — the point to centre on
    let ease = 0.1;
    let snapNext = true;
    let move = null;                // active scripted move

    // Where the camera's top-left would be to centre `point`, clamped to the world.
    function frame(point) {
        return {
            x: clamp(point.x - canvas.width / 2, 0, Math.max(0, WORLD_W - canvas.width)),
            y: clamp(point.y - canvas.height / 2, 0, Math.max(0, WORLD_H - canvas.height))
        };
    }

    return {
        pos,
        // snap:true jumps this frame instead of easing in from wherever the camera was.
        setTarget(fn, { ease: e = 0.1, snap = false } = {}) {
            target = fn;
            ease = e;
            if (snap) snapNext = true;
        },
        snap() { snapNext = true; },

        // Cutscene primitive: glide to `point` (a point or a function returning one) over `ms`,
        // then resume following whatever target is set. Scripted camera moves are a sequence
        // of these; nothing else is needed for the cutscenes we scoped.
        moveTo(point, ms = 1500, onDone = null) {
            const to = typeof point === 'function' ? point : () => point;
            move = { to, ms, t: 0, from: { ...pos }, onDone };
        },
        get moving() { return !!move; },
        cancelMove() { move = null; },

        update(dt) {
            if (move) {
                move.t = Math.min(move.ms, move.t + dt);
                const k = move.ms ? move.t / move.ms : 1;
                const s = k * k * (3 - 2 * k);                    // smoothstep in/out
                const dest = frame(move.to());
                pos.x = move.from.x + (dest.x - move.from.x) * s;
                pos.y = move.from.y + (dest.y - move.from.y) * s;
                if (move.t >= move.ms) { const done = move.onDone; move = null; done?.(); }
                return;
            }
            const point = target?.();
            if (!point) return;
            const dest = frame(point);
            // ponytail: per-frame lerp, matching the original feel. Swap for a dt-exponential
            // (1 - (1-ease)**(dt/16)) if variable frame rates ever make this feel inconsistent.
            if (snapNext) { pos.x = dest.x; pos.y = dest.y; snapNext = false; }
            else { pos.x += (dest.x - pos.x) * ease; pos.y += (dest.y - pos.y) * ease; }
        }
    };
}
