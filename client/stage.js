// Shared canvas stage. Owns the ONE canvas, the ONE fixed-step game world, the rAF loop,
// the camera, and pointer state. The world runs from the menu onward (with zero players it
// just drifts the map — no enemies spawn), so choosing Singleplayer only has to add the real
// player to this same world: the physics are the game's, with nothing to hand off or reset.
import { GAME_CONFIG } from '../config.js';
import { Background } from '../background.js';
import { createLava } from '../lava.js';
import { worldBounds } from '../view.js';
import { createWorld } from '../sim/world.js';
import { renderWorld } from './render.js';
import { createCamera } from './camera.js';

const MENU_FRAME = 0;   // menu sits in the clear headroom at the very top; breaking a rock drops you down into the platform field
const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const WORLD_H = GAME_CONFIG.WORLD_HEIGHT;
const TICK = GAME_CONFIG.TICK_DURATION;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function createStage() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.hidden = false;
    // Re-checked every frame, not just on the resize event: if the window reports 0x0 at
    // construction (hidden tab, pane not yet displayed) a one-shot resize leaves the canvas
    // 0x0 forever and the game renders nothing with no error to show for it.
    const resize = () => {
        const w = window.innerWidth, h = window.innerHeight;
        if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    };
    resize();
    window.addEventListener('resize', resize);

    const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    window.addEventListener('mousemove', e => { pointer.x = e.clientX; pointer.y = e.clientY; });

    const background = new Background(canvas, worldBounds);
    const lava = createLava(worldBounds, canvas);
    // Solo gets its own random arena each session; multiplayer arenas come from the lobby seed.
    const world = createWorld({ mode: 'coop', seed: (Math.random() * 2 ** 32) >>> 0 });

    const camera = createCamera(canvas);
    const cam = camera.pos;   // scenes and renderers read cam.x / cam.y
    cam.y = clamp((WORLD_H - canvas.height) * MENU_FRAME, 0, WORLD_H);
    let state = world.snapshot();
    let scene = null;
    let acc = 0, last = performance.now();
    // Scenes own DOM listeners and hidden inputs; dispose() the outgoing one so nothing leaks
    // (a stale menu mousedown handler used to keep firing for the whole session).
    const setScene = s => { scene?.dispose?.(); scene = s; };

    (function frame(t) {
        const dt = Math.min(t - last, 100);
        resize();
        lava.update([]);
        // ownRender scenes (multiplayer, server-authoritative) draw the whole frame themselves,
        // but still drive the shared camera.
        if (scene?.ownRender) {
            last = t;
            scene.update?.(t);
            camera.update(dt);
            scene.draw?.(ctx, t);
            requestAnimationFrame(frame);
            return;
        }
        acc += dt;
        last = t;
        while (acc >= TICK) { world.tick(TICK); acc -= TICK; }
        state = world.snapshot();
        scene?.update?.(t);
        camera.update(dt);

        renderWorld(ctx, { canvas, state, background, lava, camX: cam.x, camY: cam.y, myId: scene?.myId ?? null, mouseX: pointer.x, mouseY: pointer.y });
        scene?.draw?.(ctx, t);
        requestAnimationFrame(frame);
    })(last);

    return { canvas, ctx, pointer, world, cam, camera, background, lava, get state() { return state; }, setScene };
}
