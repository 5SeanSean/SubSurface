// Shared canvas stage. Owns the ONE canvas, the ONE fixed-step game world, the rAF loop,
// the camera, and pointer state. The world runs from the menu onward (with zero players it
// just drifts the map — no enemies spawn), so choosing Singleplayer only has to add the real
// player to this same world: the physics are the game's, with nothing to hand off or reset.
import { GAME_CONFIG } from '../config.js';
import { Background } from '../background.js';
import { createLava, createLavaBackground } from '../lava.js';
import { worldBounds } from '../view.js';
import { createWorld } from '../sim/world.js';
import { renderWorld } from './render.js';
import { createCamera } from './camera.js';
import { WORLD_SEED } from './config.js';
import { calculateCoverViewport } from './viewport.js';

const MENU_FRAME = 0;   // menu sits in the clear headroom at the very top; breaking a rock drops you down into the platform field
const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const WORLD_H = GAME_CONFIG.WORLD_HEIGHT;
const TICK = GAME_CONFIG.TICK_DURATION;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function createStage() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    canvas.hidden = false;
    // Render into one fixed logical viewport, then cover the browser window. Non-16:9 screens
    // crop only the excess dimension instead of exposing letterbox bars.
    canvas.width = GAME_CONFIG.REF_WIDTH;
    canvas.height = GAME_CONFIG.REF_HEIGHT;
    let viewport = {
        left: 0, top: 0, width: canvas.width, height: canvas.height, scale: 1,
        visible: { x: 0, y: 0, w: canvas.width, h: canvas.height }
    };
    const resize = () => {
        const w = window.innerWidth, h = window.innerHeight;
        if (!w || !h) return;
        viewport = calculateCoverViewport(w, h, canvas.width, canvas.height);
        Object.assign(canvas.style, {
            left: `${viewport.left}px`, top: `${viewport.top}px`,
            width: `${viewport.width}px`, height: `${viewport.height}px`
        });
    };
    resize();
    window.addEventListener('resize', resize);

    const pointer = { x: canvas.width / 2, y: canvas.height / 2, revision: 0 };
    window.addEventListener('mousemove', e => {
        pointer.x = (e.clientX - viewport.left) / viewport.scale;
        pointer.y = (e.clientY - viewport.top) / viewport.scale;
        pointer.revision++;
    });

    const background = new Background(canvas, worldBounds, WORLD_SEED);
    const lava = createLava(worldBounds, canvas, WORLD_SEED);
    const lavaBackground = createLavaBackground(worldBounds, WORLD_SEED);
    // The local world runs off this session's world name, hashed (from ?lobby=/?seed=, else
    // rolled and written into the URL). Reloading gives you the identical world back.
    const newWorld = (seed = WORLD_SEED) => createWorld({ mode: 'coop', seed, canvas });
    let world = newWorld();
    // Leaving a game back to the menu rebuilds the world, so you return to a pristine arena
    // rather than one still carrying the last run's damage and enemies. A seed may be passed
    // when the session switches worlds — e.g. you typed the name of a world nobody was hosting.
    const resetWorld = (seed = WORLD_SEED) => {
        world = newWorld(seed);
        background.setSeed(seed);
        lava.setSeed(seed);
        lavaBackground.setSeed(seed);
        state = world.snapshot();
        return world;
    };

    const camera = createCamera(canvas);
    const cam = camera.pos;   // scenes and renderers read cam.x / cam.y
    cam.y = clamp((WORLD_H - canvas.height) * MENU_FRAME, 0, WORLD_H);
    let state = world.snapshot();
    let scene = null;
    let acc = 0, last = performance.now();
    // Scenes own DOM listeners and hidden inputs; dispose() the outgoing one so nothing leaks
    // (a stale menu mousedown handler used to keep firing for the whole session).
    const setScene = s => { scene?.dispose?.(); scene = s; };

    // ONE frame path for singleplayer and multiplayer. The only difference between them is
    // where the world state comes from: a scene that owns an authoritative feed exposes state(),
    // and the local simulation is neither ticked nor rendered for it. Everything downstream —
    // camera, renderer, HUD overlay — is identical, so neither mode has its own draw path.
    (function frame(t) {
        const dt = Math.min(t - last, 100);
        resize();
        lava.update([], dt);
        lavaBackground.update(dt);
        last = t;

        const fed = scene?.state?.();
        if (fed) {
            state = fed;              // server-authoritative: the local sim stays parked
            acc = 0;
        } else {
            acc += dt;
            while (acc >= TICK) { world.tick(TICK); acc -= TICK; }
            state = world.snapshot();
        }
        scene?.update?.(t);
        camera.update(dt);

        renderWorld(ctx, {
            canvas, state, background, lava, lavaBackground, camX: cam.x, camY: cam.y,
            myId: scene?.myId ?? null, mouseX: pointer.x, mouseY: pointer.y,
            reticleInvert: !!scene?.reticleInvert,
            showReticle: !scene?.reticleOnTop
        });
        scene?.draw?.(ctx, t);       // scenes only ever draw overlays on top
        requestAnimationFrame(frame);
    })(last);

    return {
        canvas, ctx, pointer, cam, camera, background, lava, lavaBackground, setScene, resetWorld,
        toClientRect(box) {
            return {
                x: viewport.left + box.x * viewport.scale,
                y: viewport.top + box.y * viewport.scale,
                w: box.w * viewport.scale,
                h: box.h * viewport.scale,
                scale: viewport.scale
            };
        },
        toClientPoint(point) {
            return {
                x: viewport.left + point.x * viewport.scale,
                y: viewport.top + point.y * viewport.scale,
                scale: viewport.scale
            };
        },
        get visibleFrame() { return viewport.visible; },
        get world() { return world; },
        get state() { return state; }
    };
}
