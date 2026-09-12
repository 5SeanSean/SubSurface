// Solo game controller on the shared stage. Adds the real player to the stage's live world
// at the menu ball's spot, bursts rock debris, then just feeds input and points the camera —
// the fall and everything after is the world's own physics, identical to the normal game.
import { GAME_CONFIG } from '../config.js';
import { Splash } from '../splash.js';
import { createInput } from './input.js';
import { createPauseMenu } from './pauseMenu.js';

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function createGameScene(stage, { seedX = null, seedY = null, onExit = null } = {}) {
    const id = 1;
    // The menu already added the real ball resting on its platform; reuse it so the fall is continuous.
    if (!stage.world.players.has(id)) {
        stage.world.addPlayer(id);
        const b = stage.world.players.get(id).ball;
        const W = stage.canvas.width, H = stage.canvas.height;
        b.x = clamp(stage.cam.x + (seedX ?? W / 2), b.radius, WORLD_W - b.radius);
        b.y = stage.cam.y + (seedY ?? H * 0.3);
        b.dy = 0;
    }
    stage.world.setPeaceful(false);   // enemies resume now that the game is on
    // Resolved fresh each time: the world REPLACES p.ball on death, so a captured reference
    // would leave the camera and score watching the corpse of the previous life forever.
    const ballOf = () => stage.world.players.get(id)?.ball ?? null;
    const ball = ballOf();
    let lastPointerRevision = stage.pointer.revision;
    stage.camera.setTarget(ballOf, { ease: 0.1 });

    // Debris where the platform shattered.
    const splashes = [];
    for (let i = 0; i < 6; i++) {
        splashes.push(new Splash(ball.x + (Math.random() - 0.5) * 140, ball.y + 30, 16, 'grey', 'square',
            (Math.random() - 0.5) * 22, 10, 6));
    }

    // Esc pauses; Esc again backs out of the pause menu. Input is locked while it is open so
    // the ball doesn't keep playing behind the overlay.
    const pause = createPauseMenu(stage, [
        { label: 'Resume', action: () => input.unlock() },
        ...(onExit ? [{ label: 'Main Menu', action: () => onExit() }] : [])
    ]);
    const input = createInput({
        onKey: k => {
            if (k !== 'escape') return;
            if (pause.toggle()) input.lock(); else input.unlock();
            return false;
        }
    });
    const onMouseDown = () => pause.click();
    window.addEventListener('mousedown', onMouseDown);

    const scoreCounter = document.getElementById('scoreCounter');
    scoreCounter.hidden = false;

    function update() {
        const b = ballOf();
        if (!b) return;
        const aim = Math.atan2((stage.pointer.y + stage.cam.y) - b.y, (stage.pointer.x + stage.cam.x) - b.x);
        const aimMoved = stage.pointer.revision !== lastPointerRevision;
        lastPointerRevision = stage.pointer.revision;
        stage.world.setInput(id, { ...input.read(), aim, aimMoved });
        for (let i = splashes.length - 1; i >= 0; i--) {
            splashes[i].update();
            if (splashes[i].isFinished()) splashes.splice(i, 1);
        }
    }

    function draw(ctx) {
        if (splashes.length) {
            ctx.save();
            ctx.translate(-stage.cam.x, -stage.cam.y);
            for (const s of splashes) s.draw(ctx);
            ctx.restore();
        }
        scoreCounter.textContent = `Score: ${Math.round(ballOf()?.score ?? 0)}`;
        const visible = stage.visibleFrame;
        const hud = stage.toClientPoint({ x: visible.x + 24, y: visible.y + 20 });
        scoreCounter.style.left = `${hud.x}px`;
        scoreCounter.style.top = `${hud.y}px`;
        scoreCounter.style.fontSize = `${56 * hud.scale}px`;
        pause.draw(ctx);
    }

    return {
        myId: id, update, draw,
        dispose() {
            input.dispose();
            window.removeEventListener('mousedown', onMouseDown);
            scoreCounter.hidden = true;
        }
    };
}
