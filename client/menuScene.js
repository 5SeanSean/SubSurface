// Diegetic menu built from the REAL game world: a real player-ball rests on a small normal
// platform in the clear headroom, input locked to aim + shoot (no movement). Three enemy-boxes
// slide in from the right and hover; you pick an option by SHOOTING it. A click only fires if
// the pre-calculated projectile arc would actually hit an option (otherwise no shot is wasted).
// Shoot Singleplayer -> it dies, the others leave frame, you fall in. Shoot Create/Join -> a form
// grows on that enemy. Fields use the normal cursor; hovering a button restores the custom
// reticle so the player can shoot it to choose or confirm.
import { GAME_CONFIG } from '../config.js';
import { SERVER_URL, WORLD_NAME } from './config.js';
import { worldBounds } from '../view.js';
import { Splash } from '../splash.js';
import { LOBBY } from '../sim/lobbyLayout.js';

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const RADIUS = GAME_CONFIG.REF_HEIGHT / 18;
const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,24}$/;

const MENU_X = WORLD_W / 2;
const REST_X = LOBBY.hostX;
const PLAT = { w: 180, h: 44, x: REST_X - 90, y: 820 };
const REST_Y = PLAT.y - RADIUS;
const ESW = 380, ESH = 150;                   // enemy box: wide horizontal bars, no gun
const OFF_X = MENU_X + 1400;                  // off-screen right (options slide in from here)
const pointInRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// hostName: the world this menu would host (defaults to the session's world). openCreate jumps
// straight into the create form — used when you typed a lobby name that nobody is hosting yet.
export function createMenuScene(stage, { onSolo, onCreate, onJoin, isActive = () => true,
                                         hostName = WORLD_NAME, openCreate = false, notice = '' }) {
    let state = 'main';                       // main | createForm | joinForm | done
    let mode = 'coop';
    let lobbies = [];
    let lobbyLoadPending = false;
    let lastLobbyLoad = -Infinity;
    const splashes = [];
    const id = 1;

    stage.world.setPeaceful(true);
    const platform = stage.world.addPlatform(PLAT.x, PLAT.y, PLAT.w, PLAT.h);
    stage.world.addPlayer(id);
    const ball = stage.world.players.get(id).ball;
    ball.x = REST_X; ball.y = REST_Y; ball.dx = ball.dy = 0;

    // Options ride a diagonal arc up to the right — the shot's trajectory — spanning the screen:
    // centred on-screen (not on the ball, which sits lower-right), stepping up as they go right,
    // with a slight upward bow so the line arcs rather than runs straight.
    const ROW_Y = REST_Y - 320;
    const ROW_CX = MENU_X - stage.canvas.width * 0.167;   // screen centre, in world space
    const GAP = stage.canvas.width * 0.30, RISE = 200, BOW = 70;
    const enemies = [
        { kind: 'singleplayer', text: 'Singleplayer', homeX: ROW_CX - GAP, homeY: ROW_Y + RISE + BOW },
        { kind: 'create', text: 'Create Lobby', homeX: ROW_CX, homeY: ROW_Y },
        { kind: 'join', text: 'Join Game', homeX: ROW_CX + GAP, homeY: ROW_Y - RISE + BOW }
    ].map(e => ({ ...e, x: OFF_X, y: e.homeY, targetX: e.homeX, dead: false }));
    let active = null;
    let wantShoot = false;
    let shotAim = null;                       // exact angle a queued shot fires at (set on click)
    const lastProjPos = new Map();            // projectile id -> last frame's position, for swept hit tests

    // Preserve the exact fresh-page composition while navigating and creating a lobby. The only
    // camera handoff is the intentional one after the host actually drops into a game.
    const menuCenter = () => ({ x: MENU_X - stage.canvas.width * 0.167, y: REST_Y - stage.canvas.height * 0.22 });
    stage.camera.setTarget(() => state === 'done' ? ball : menuCenter(),
        { ease: 0.08, snap: true });

    const textInput = document.createElement('input');
    textInput.maxLength = 24;
    Object.assign(textInput.style, { position: 'fixed', left: '-9999px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(textInput);
    const onTextKeyDown = e => {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return;
        const start = textInput.selectionStart ?? textInput.value.length;
        const end = textInput.selectionEnd ?? start;
        const from = start === end && e.key === 'Backspace' ? Math.max(0, start - 1) : start;
        const to = start === end && e.key === 'Delete' ? Math.min(textInput.value.length, end + 1) : end;
        if (from !== to) textInput.setRangeText('', from, to, 'end');
        e.preventDefault();
    };
    textInput.addEventListener('keydown', onTextKeyDown);
    const focusTextInput = () => {
        textInput.focus({ preventScroll: true });
        const end = textInput.value.length;
        textInput.setSelectionRange(end, end);
    };

    const enemyBox = e => ({ x: e.x - ESW / 2, y: e.y - ESH / 2, w: ESW, h: ESH });

    // Arriving here because a typed lobby didn't exist: skip the option bars and open the
    // create form for that name, so "join something nobody hosts" becomes "host it".
    if (openCreate) {
        const target = enemies.find(e => e.kind === 'create');
        target.x = target.homeX;                 // already in frame; no slide-in
        active = target;
        state = 'createForm';
        for (const o of enemies) if (o !== target) o.targetX = OFF_X;
        textInput.value = localStorage.getItem('subsurfaceName') || '';
        setTimeout(focusTextInput, 0);
    }

    // ---- form panel (grows on the chosen enemy) ----
    function panelRect() {
        // Both forms occupy the same slim column, centred in the open space
        // between the player and the viewport's right edge.
        return { ...LOBBY.panel };
    }
    const nameBox = p => ({ x: p.x + 30, y: p.y + 70, w: p.w - 60, h: 52 });
    const modeBoxes = p => ({
        coop: { x: p.x + 30, y: p.y + 134, w: p.w - 60, h: 44 },
        pvp: { x: p.x + 30, y: p.y + 190, w: p.w - 60, h: 44 }
    });
    const codeBox = p => ({ x: p.x + 30, y: p.y + 70, w: p.w - 60, h: 52 });
    const lobbyRows = p => lobbies.slice(0, 2).map((l, i) => ({ x: p.x + 30, y: p.y + 138 + i * 40, w: p.w - 60, h: 34, lobby: l }));
    const confirmBox = p => ({ x: p.x + 30, y: p.y + p.h - 66, w: p.w - 60, h: 48 });

    // Shootable targets for the current state (world rects + what a hit does). Form fields remain
    // ordinary click UI, while buttons keep the menu's shoot-to-select interaction.
    function targets() {
        if (state === 'main') return enemies.filter(e => !e.dead).map(e => ({ rect: enemyBox(e), hit: () => onEnemyHit(e), kind: e.kind }));
        if (formOpen()) {
            const p = panelRect();
            const confirm = { rect: confirmBox(p), hit: commitForm, kind: 'confirm' };
            if (state === 'createForm') {
                const { coop, pvp } = modeBoxes(p);
                return [
                    { rect: coop, hit: () => { mode = 'coop'; }, kind: 'coop' },
                    { rect: pvp, hit: () => { mode = 'pvp'; }, kind: 'pvp' },
                    confirm
                ];
            }
            return [
                ...lobbyRows(p).map(row => ({
                    rect: row, hit: () => { textInput.value = row.lobby.id; }, kind: 'lobby'
                })),
                confirm
            ];
        }
        return [];
    }
    const formOpen = () => state === 'createForm' || state === 'joinForm';
    const titleBox = () => {
        const W = stage.canvas.width;
        const size = Math.min(120, W * 0.11);
        return { x: W * 0.06, y: stage.canvas.height * 0.16 - size / 2, w: size * 5.4, h: size };
    };
    const titleHovered = () => {
        const b = titleBox();
        return pointInRect(stage.pointer.x, stage.pointer.y, b);
    };
    const hoveredTarget = () => {
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        return targets().find(target => pointInRect(wx, wy, target.rect)) || null;
    };
    const hoveredField = () => {
        if (!formOpen()) return false;
        const p = panelRect();
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        return pointInRect(wx, wy, state === 'createForm' ? nameBox(p) : codeBox(p));
    };

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
            state = 'done';
            // Hand control over after this simulation step. The game scene reuses this exact ball
            // and the existing camera keeps easing, so there is no timer or scene-cut jump.
            queueMicrotask(onSolo);
        } else {
            active = e;
            state = e.kind === 'create' ? 'createForm' : 'joinForm';
            for (const o of enemies) if (o !== e) o.targetX = OFF_X;
            textInput.value = e.kind === 'create' ? (localStorage.getItem('subsurfaceName') || '') : '';
            focusTextInput();
            if (e.kind === 'join') loadLobbies();
        }
    }

    async function loadLobbies() {
        if (lobbyLoadPending) return;
        lobbyLoadPending = true;
        lastLobbyLoad = performance.now();
        try {
            const u = new URL(SERVER_URL);
            u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
            u.pathname = '/lobbies';
            lobbies = await fetch(u, { cache: 'no-store' }).then(r => r.json());
        } catch {
            lobbies = [];
        } finally {
            lobbyLoadPending = false;
        }
    }

    function commitForm() {
        const p = panelRect();
        splashAt(p.x + p.w / 2, p.y + p.h / 2);
        if (state === 'createForm') { const n = textInput.value.trim(); if (!NAME_RE.test(n)) return; onCreate(n, mode, hostName); }
        else { const c = textInput.value.trim().toUpperCase(); if (!CODE_RE.test(c)) return; onJoin(c); }
    }

    // Text fields are ordinary point-and-click controls.
    function handleFormClick(e, wx, wy) {
        const p = panelRect();
        if (state === 'createForm') {
            if (pointInRect(wx, wy, nameBox(p))) {
                e.preventDefault();
                focusTextInput();
                return true;
            }
        } else {
            if (pointInRect(wx, wy, codeBox(p))) {
                e.preventDefault();
                focusTextInput();
                return true;
            }
        }
        return false;
    }

    const onMouseDown = e => {
        if (!isActive() || state === 'done') return;
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        if (formOpen()) {
            const target = hoveredTarget();
            if (target) {
                target.hit();
                return;
            }
            return handleFormClick(e, wx, wy);
        }
        // main: it's a shot — aim straight at the click and only fire if the arc would hit a
        // target. ball.angle lags a frame behind the cursor, so validating (and firing) the
        // click's own angle is what makes clicking a button actually shoot it.
        const aim = Math.atan2(wy - ball.y, wx - ball.x);
        if (arcTarget(aim)) { wantShoot = true; shotAim = aim; }
    };
    window.addEventListener('mousedown', onMouseDown);

    // Esc backs out one step of the selection: an open form returns to the three options.
    function backOut() {
        if (state !== 'createForm' && state !== 'joinForm') return false;
        state = 'main';
        active = null;
        for (const o of enemies) if (!o.dead) o.targetX = o.homeX;   // the options slide back in
        textInput.blur();
        textInput.value = '';
        return true;
    }
    const onKeyDown = e => {
        if (e.key !== 'Escape' || !isActive()) return;
        if (backOut()) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);

    function update(t) {
        if (state === 'joinForm' && t - lastLobbyLoad >= 1500) loadLobbies();
        for (const e of enemies) {
            e.x += (e.targetX - e.x) * 0.12;
            e.y = e.homeY + (e.targetX === e.homeX ? Math.sin(t / 600 + e.homeX) * 8 : 0);
        }
        // Forms use the system cursor over fields and empty space. A shootable button swaps back
        // to this player's reticle, which the shared renderer draws as an inversion filter.
        document.body.style.cursor = formOpen()
            ? (hoveredTarget() ? 'none' : (hoveredField() ? 'text' : 'default'))
            : 'none';
        const liveAim = Math.atan2((stage.pointer.y + stage.cam.y) - ball.y, (stage.pointer.x + stage.cam.x) - ball.x);
        const aim = wantShoot && shotAim != null ? shotAim : liveAim;
        stage.world.setInput(id, { keys: [], shooting: wantShoot, jump: false, aim });
        wantShoot = false;
        shotAim = null;

        // Real projectile hitting a target selects it. The world ticks several times per frame,
        // so sweep the whole segment travelled this frame rather than testing one point.
        const ts = targets();
        for (let i = ball.projectiles.length - 1; i >= 0; i--) {
            const p = ball.projectiles[i];
            const prev = lastProjPos.get(p.id) || { x: p.x, y: p.y };
            const n = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.y - prev.y) / 24));
            let hit = null;
            for (let s = 1; s <= n && !hit; s++) {
                const sx = prev.x + (p.x - prev.x) * (s / n), sy = prev.y + (p.y - prev.y) * (s / n);
                hit = ts.find(target => pointInRect(sx, sy, target.rect));
            }
            if (hit) { ball.projectiles.splice(i, 1); lastProjPos.delete(p.id); hit.hit(); break; }
            lastProjPos.set(p.id, { x: p.x, y: p.y });
        }
        // Drop remembered positions for projectiles that are gone (ricocheted away / despawned).
        if (lastProjPos.size > ball.projectiles.length)
            for (const key of lastProjPos.keys()) if (!ball.projectiles.some(p => p.id === key)) lastProjPos.delete(key);
        for (let i = splashes.length - 1; i >= 0; i--) { splashes[i].update(); if (splashes[i].isFinished()) splashes.splice(i, 1); }

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
        const focused = document.activeElement === textInput;
        whiteBox(ctx, b, focused);
        const caret = focused && Math.floor(Date.now() / 500) % 2 ? '|' : '';
        const display = value || (focused ? '' : placeholder);
        wtext(ctx, display + caret, b.x + 14, b.y + b.h / 2, 26, 'left', value || focused ? 'black' : 'grey');
    }
    // Menu-consistent button: white box / black text, inverted (black box / white text) when
    // active — a mode button stays inverted while selected, others invert only on hover.
    function menuButton(ctx, b, label, active, size = 26) {
        ctx.save();
        if (active) { ctx.shadowColor = 'white'; ctx.shadowBlur = 24; }
        ctx.fillStyle = active ? 'black' : 'white';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
        wtext(ctx, label, b.x + b.w / 2, b.y + b.h / 2, size, 'center', active ? 'white' : 'black');
    }

    function draw(ctx, t) {
        const W = stage.canvas.width;
        wtext(ctx, 'SUBSURFACE', W * 0.06, stage.canvas.height * 0.16, Math.min(120, W * 0.11), 'left');

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

        // Form-button reticle belongs to the overlay pass so it sits above the button instead of
        // being covered by it. White + difference compositing inverts every pixel beneath it.
        if (hoveredTarget() || titleHovered()) {
            ctx.save();
            ctx.globalCompositeOperation = 'difference';
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(stage.pointer.x, stage.pointer.y, ball.radius / 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // Glowing option bar. Hover inverts the colours (black box, white text) — no size change.
    function drawMenuEnemy(ctx, e, hot) {
        const w = ESW, h = ESH, x = e.x - w / 2, y = e.y - h / 2;
        ctx.save();
        ctx.shadowColor = 'white'; ctx.shadowBlur = hot ? 50 : 28;
        ctx.fillStyle = hot ? 'black' : 'white';
        ctx.fillRect(x, y, w, h);
        ctx.restore();
        if (hot) { ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); }
        let size = h * 0.42;
        ctx.font = `${size}px 'boxycool', sans-serif`;
        const total = ctx.measureText(e.text).width, maxW = w * 0.88;
        if (total > maxW) { size *= maxW / total; ctx.font = `${size}px 'boxycool', sans-serif`; }
        ctx.fillStyle = hot ? 'white' : 'black'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.text, e.x, e.y);
    }

    function drawPanel(ctx) {
        const p = panelRect(), wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        // White-outlined panel, consistent with the menu (no orange, no hover on the panel itself).
        ctx.fillStyle = 'rgba(10,10,10,0.88)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
        wtext(ctx, active.kind === 'create' ? `Host ${hostName}` : 'Join Game', p.x + p.w / 2, p.y + 34, 30);

        if (active.kind === 'create') {
            // Hosting opens THIS world up; the name others type in to join is the world's name.
            wtext(ctx, notice || 'others join with this name', p.x + p.w / 2, p.y + 56, 17, 'center',
                notice ? 'white' : 'rgba(255,255,255,0.55)');
            fieldBox(ctx, nameBox(p), textInput.value, 'Your name');
            const { coop, pvp } = modeBoxes(p);
            // Selected mode stays inverted; the other inverts only while hovered.
            menuButton(ctx, coop, 'Co-op', mode === 'coop' || pointInRect(wx, wy, coop));
            menuButton(ctx, pvp, 'PvP', mode === 'pvp' || pointInRect(wx, wy, pvp));
        } else {
            fieldBox(ctx, codeBox(p), textInput.value.toUpperCase(), 'Lobby code');
            const rws = lobbyRows(p);
            if (!rws.length) wtext(ctx, 'No public lobbies', p.x + 30, p.y + 152, 20, 'left', 'grey');
            for (const row of rws) {
                const hot = pointInRect(wx, wy, row);
                menuButton(ctx, row, `${row.lobby.id} — ${row.lobby.mode.toUpperCase()} — ${row.lobby.players}/${row.lobby.maxPlayers}`, hot, 20);
            }
        }
        // Confirm is shootable and inverts on hover like the other buttons.
        const c = confirmBox(p);
        menuButton(ctx, c, active.kind === 'create' ? 'Create Lobby' : 'Join', pointInRect(wx, wy, c));
    }

    return {
        update, draw,
        // Form buttons use the in-world reticle; fields and empty form space use the OS cursor.
        get myId() { return formOpen() && !hoveredTarget() ? null : id; },
        get reticleInvert() { return !!(hoveredTarget() || titleHovered()); },
        get reticleOnTop() { return !!(hoveredTarget() || titleHovered()); },
        dispose() {
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('keydown', onKeyDown);
            textInput.removeEventListener('keydown', onTextKeyDown);
            textInput.remove();
            document.body.style.cursor = 'none';   // game scenes use the in-world reticle again
        }
    };
}
