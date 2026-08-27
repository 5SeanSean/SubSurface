// Solo game controller on the shared stage. Adds the real player to the stage's live world
// at the menu ball's spot, bursts rock debris, then just feeds input and points the camera —
// the fall and everything after is the world's own physics, identical to the normal game.
import { GAME_CONFIG } from '../config.js';
import { Splash } from '../splash.js';
import { createInput } from './input.js';

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export function createGameScene(stage, { seedX = null, seedY = null } = {}) {
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
    const ball = stage.world.players.get(id).ball;
    stage.camera.setTarget(() => ball, { snap: true });

    // Debris where the platform shattered.
    const splashes = [];
    for (let i = 0; i < 6; i++) {
        splashes.push(new Splash(ball.x + (Math.random() - 0.5) * 140, ball.y + 30, 16, 'grey', 'square',
            (Math.random() - 0.5) * 22, 10, 6));
    }

    const input = createInput();
    const scoreCounter = document.getElementById('scoreCounter');
    scoreCounter.hidden = false;

    function update() {
        const aim = Math.atan2((stage.pointer.y + stage.cam.y) - ball.y, (stage.pointer.x + stage.cam.x) - ball.x);
        stage.world.setInput(id, { ...input.read(), aim });
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
        scoreCounter.textContent = `Score: ${Math.round(ball.score)}`;
    }

    return {
        myId: id, update, draw,
        dispose() { input.dispose(); scoreCounter.hidden = true; }
    };
}
