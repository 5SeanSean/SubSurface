// Diegetic menu built from the REAL game world: a real player-ball rests on a small normal
// platform in the clear headroom, input locked to aim + shoot (no movement). Three enemy-boxes
// slide in from the right and hover; you pick an option by SHOOTING it. A click only fires if
// the pre-calculated projectile arc would actually hit an option (otherwise no shot is wasted).
// Shoot Singleplayer -> it dies, the others leave frame, you fall in. Shoot Create/Join -> a form
// grows on that enemy with a Confirm box you shoot to commit.
import { GAME_CONFIG } from '../config.js';
import { SERVER_URL } from './config.js';
import { worldBounds } from '../view.js';
import { Splash } from '../splash.js';

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const RADIUS = GAME_CONFIG.REF_HEIGHT / 18;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,24}$/;

const PLAT = { w: 180, h: 44, x: WORLD_W / 2 - 90, y: 820 };
const REST_X = WORLD_W / 2, REST_Y = PLAT.y - RADIUS;
const ESW = 380, ESH = 150;                   // enemy box: wide horizontal bars, no gun
const HOME_X = REST_X + 360;                  // settle column, right of the ball
const OFF_X = REST_X + 1400;                  // off-screen right
const pointInRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function createMenuScene(stage, { onSolo, onCreate, onJoin, isActive = () => true }) {
    let state = 'main';                       // main | createForm | joinForm | falling
    let mode = 'coop';
    let lobbies = [];
    let fallT = 0;
    const splashes = [];
    const id = 1;

    stage.world.setPeaceful(true);
    const platform = stage.world.addPlatform(PLAT.x, PLAT.y, PLAT.w, PLAT.h);
    stage.world.addPlayer(id);
    const ball = stage.world.players.get(id).ball;
    ball.x = REST_X; ball.y = REST_Y; ball.dx = ball.dy = 0;

    const enemies = [
        { kind: 'singleplayer', text: 'Singleplayer', homeY: REST_Y - 200, x: OFF_X, y: REST_Y - 200 },
        { kind: 'create', text: 'Create Game', homeY: REST_Y, x: OFF_X, y: REST_Y },
        { kind: 'join', text: 'Join Game', homeY: REST_Y + 200, x: OFF_X, y: REST_Y + 200 }
    ].map(e => ({ ...e, targetX: HOME_X, dead: false }));
    let active = null;
    let wantShoot = false;

    // Camera sits offset, framed between the ball and the option boxes; once you fall in it
    // eases back to a normal follow of the ball.
    const menuCenter = { x: (REST_X + HOME_X) / 2, y: REST_Y };
    stage.camera.setTarget(() => (state === 'falling' || state === 'done') ? ball : menuCenter,
        { ease: 0.08, snap: true });

    const textInput = document.createElement('input');
    textInput.maxLength = 24;
    Object.assign(textInput.style, { position: 'fixed', left: '-9999px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(textInput);

    const enemyBox = e => ({ x: e.x - ESW / 2, y: e.y - ESH / 2, w: ESW, h: ESH });

    // ---- form panel (grows on the chosen enemy) ----
    const PANEL = { w: 460, h: 330 };
    function panelRect() {
        const cx = clamp(active.x, stage.cam.x + PANEL.w / 2 + 20, stage.cam.x + stage.canvas.width - PANEL.w / 2 - 20);
        return { x: cx - PANEL.w / 2, y: active.y - PANEL.h / 2, w: PANEL.w, h: PANEL.h };
    }
    const nameBox = p => ({ x: p.x + 30, y: p.y + 70, w: p.w - 60, h: 52 });
    const modeBoxes = p => { const bw = (p.w - 80) / 2; return { coop: { x: p.x + 30, y: p.y + 140, w: bw, h: 48 }, pvp: { x: p.x + 50 + bw, y: p.y + 140, w: bw, h: 48 } }; };
    const codeBox = p => ({ x: p.x + 30, y: p.y + 70, w: p.w - 60, h: 52 });
    const lobbyRows = p => lobbies.slice(0, 2).map((l, i) => ({ x: p.x + 30, y: p.y + 138 + i * 40, w: p.w - 60, h: 34, lobby: l }));
    const confirmBox = p => ({ x: p.x + 30, y: p.y + p.h - 66, w: p.w - 60, h: 48 });

    // Shootable targets for the current state (world rects + what a hit does).
    function targets() {
        if (state === 'main') return enemies.filter(e => !e.dead).map(e => ({ rect: enemyBox(e), hit: () => onEnemyHit(e) }));
        if (state === 'createForm' || state === 'joinForm') return [{ rect: confirmBox(panelRect()), hit: () => commitForm() }];
        return [];
    }

    // Pre-calculate the projectile arc for the current aim; return the target it would hit, or null.
    function arcTarget(angle) {
        const speed = ball.projSpeed;
        let x = ball.x + (ball.radius * 1.7 * Math.cos(angle)) / 2;
        let y = ball.y + (ball.radius * 1.7 * Math.sin(angle)) / 2;
        let dx = speed * Math.cos(angle), dy = speed * Math.sin(angle);
        const ts = targets();
        for (let i = 0; i < 90; i++) {
            x += dx; y += dy; dy += 0.05;
            for (const t of ts) if (pointInRect(x, y, t.rect)) return t;
            if (Math.abs(x - ball.x) > GAME_CONFIG.REF_WIDTH || y < 0 || y > worldBounds.bottom) break;
        }
        return null;
    }

    function splashAt(cx, cy) {
        for (let i = 0; i < 10; i++) splashes.push(new Splash(cx, cy, 20, 'orange', 'square', (Math.random() - 0.5) * 26, 12, 6));
    }

    function onEnemyHit(e) {
        if (e.kind === 'singleplayer') {
            splashAt(e.x, e.y);
            e.dead = true;
            for (const o of enemies) o.targetX = OFF_X;   // the others leave frame
            stage.world.removePlatform(platform);          // ball falls into the field
            state = 'falling';
            fallT = 0;
            // Scripted camera move: dive ahead of the falling ball into the arena, then hand
            // back to the normal follow target. This is the whole cutscene mechanism.
            stage.camera.moveTo(() => ({ x: ball.x, y: ball.y + stage.canvas.height * 0.35 }), 450);
        } else {
            active = e;
            state = e.kind === 'create' ? 'createForm' : 'joinForm';
            for (const o of enemies) if (o !== e) o.targetX = OFF_X;
            textInput.value = e.kind === 'create' ? (localStorage.getItem('platzName') || '') : '';
            textInput.focus();
            if (e.kind === 'join') loadLobbies();
        }
    }

    async function loadLobbies() {
        try { const u = new URL(SERVER_URL); u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/lobbies'; lobbies = await fetch(u).then(r => r.json()); }
        catch { lobbies = []; }
    }

    function commitForm() {
        const p = panelRect();
        splashAt(p.x + p.w / 2, p.y + p.h / 2);
        if (state === 'createForm') { const n = textInput.value.trim(); if (!NAME_RE.test(n)) return; onCreate(n, mode); }
        else { const c = textInput.value.trim().toUpperCase(); if (!CODE_RE.test(c)) return; onJoin(c); }
    }

    const onMouseDown = () => {
        if (!isActive() || state === 'falling') return;
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        // form field clicks (not shots)
        if (state === 'createForm') {
            const p = panelRect();
            if (pointInRect(wx, wy, nameBox(p))) return textInput.focus();
            const { coop, pvp } = modeBoxes(p);
            if (pointInRect(wx, wy, coop)) return void (mode = 'coop');
            if (pointInRect(wx, wy, pvp)) return void (mode = 'pvp');
        } else if (state === 'joinForm') {
            const p = panelRect();
            if (pointInRect(wx, wy, codeBox(p))) return textInput.focus();
            const row = lobbyRows(p).find(r => pointInRect(wx, wy, r));
            if (row) return void (textInput.value = row.lobby.id);
        }
        // otherwise it's a shot — only fire if the arc would hit a target
        if (arcTarget(ball.angle)) wantShoot = true;
    };
    window.addEventListener('mousedown', onMouseDown);

    function update(t) {
        for (const e of enemies) {
            e.x += (e.targetX - e.x) * 0.12;
            e.y = e.homeY + (e.targetX === HOME_X ? Math.sin(t / 600 + e.homeY) * 8 : 0);
        }
        // aim at cursor; shoot only when a valid shot was queued
        const aim = Math.atan2((stage.pointer.y + stage.cam.y) - ball.y, (stage.pointer.x + stage.cam.x) - ball.x);
        stage.world.setInput(id, { keys: [], shooting: wantShoot, jump: false, aim });
        wantShoot = false;

        // real projectile hitting a target selects it
        const ts = targets();
        for (let i = ball.projectiles.length - 1; i >= 0; i--) {
            const p = ball.projectiles[i];
            const t = ts.find(t => pointInRect(p.x, p.y, t.rect));
            if (t) { ball.projectiles.splice(i, 1); t.hit(); break; }
        }
        for (let i = splashes.length - 1; i >= 0; i--) { splashes[i].update(); if (splashes[i].isFinished()) splashes.splice(i, 1); }

        if (state === 'falling' && (fallT += 16) > 450) { state = 'done'; onSolo(); }
    }

    function wtext(ctx, str, x, y, size, align = 'center', color = 'white') {
        ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
        ctx.font = `${size}px 'boxycool', sans-serif`;
        ctx.fillText(str, x, y);
    }
    // Opaque white box with a solid white outline (glows when highlighted/shootable).
    function whiteBox(ctx, b, glow = false) {
        ctx.save();
        if (glow) { ctx.shadowColor = 'white'; ctx.shadowBlur = 30; }
        ctx.fillStyle = 'white'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
    function fieldBox(ctx, b, value, placeholder) {
        whiteBox(ctx, b, document.activeElement === textInput);
        const caret = document.activeElement === textInput && Math.floor(Date.now() / 500) % 2 ? '|' : '';
        wtext(ctx, (value || placeholder) + caret, b.x + 14, b.y + b.h / 2, 26, 'left', value ? 'black' : 'grey');
    }

    function draw(ctx, t) {
        const W = stage.canvas.width;
        wtext(ctx, 'PLATZ', W / 2, stage.canvas.height * 0.09, Math.min(96, W * 0.15));

        ctx.save();
        ctx.translate(-stage.cam.x, -stage.cam.y);
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;

        // enemies
        for (const e of enemies) {
            if (e.dead) continue;
            if (e === active) drawPanel(ctx);
            else drawMenuEnemy(ctx, e, state === 'main' && pointInRect(wx, wy, enemyBox(e)));
        }
        for (const s of splashes) s.draw(ctx);
        ctx.restore();
    }

    // Glowing white option bar with black text.
    function drawMenuEnemy(ctx, e, hot) {
        const w = ESW * (hot ? 1.07 : 1), h = ESH * (hot ? 1.07 : 1);
        const x = e.x - w / 2, y = e.y - h / 2;
        ctx.save();
        ctx.shadowColor = 'white'; ctx.shadowBlur = hot ? 50 : 28;
        ctx.fillStyle = 'white';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        let size = h * 0.42;
        ctx.font = `${size}px 'boxycool', sans-serif`;
        const total = ctx.measureText(e.text).width, maxW = w * 0.88;
        if (total > maxW) { size *= maxW / total; ctx.font = `${size}px 'boxycool', sans-serif`; }
        ctx.fillStyle = 'black'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.text, e.x, e.y);
    }

    function drawPanel(ctx) {
        const p = panelRect(), wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        ctx.fillStyle = 'rgba(20,10,0,0.9)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'orange'; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
        wtext(ctx, active.kind === 'create' ? 'Create Game' : 'Join Game', p.x + p.w / 2, p.y + 34, 30);

        if (active.kind === 'create') {
            fieldBox(ctx, nameBox(p), textInput.value, 'Your name');
            const { coop, pvp } = modeBoxes(p);
            for (const [b, key, txt] of [[coop, 'coop', 'Co-op'], [pvp, 'pvp', 'PvP']]) {
                whiteBox(ctx, b, mode === key);
                wtext(ctx, txt, b.x + b.w / 2, b.y + b.h / 2, 26, 'center', 'black');
            }
        } else {
            fieldBox(ctx, codeBox(p), textInput.value.toUpperCase(), 'Lobby code');
            const rws = lobbyRows(p);
            if (!rws.length) wtext(ctx, 'No public lobbies', p.x + 30, p.y + 152, 20, 'left', 'grey');
            for (const row of rws) {
                whiteBox(ctx, row, pointInRect(wx, wy, row));
                wtext(ctx, `${row.lobby.id} — ${row.lobby.mode.toUpperCase()} — ${row.lobby.players}/${row.lobby.maxPlayers}`, row.x + 8, row.y + row.h / 2, 20, 'left', 'black');
            }
        }
        // Confirm box — white and shootable; glows when the arc would hit it.
        const c = confirmBox(p), aimed = !!arcTarget(ball.angle);
        whiteBox(ctx, c, aimed);
        wtext(ctx, active.kind === 'create' ? 'Create Lobby' : 'Join', c.x + c.w / 2, c.y + c.h / 2, 26, 'center', 'black');
    }

    return {
        myId: id, update, draw,
        dispose() {
            window.removeEventListener('mousedown', onMouseDown);
            textInput.remove();
        }
    };
}
