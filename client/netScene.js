// Multiplayer scene on the shared stage. The ONLY thing that makes it different from the solo
// scene is where world state comes from: it exposes state(), so the stage feeds the renderer
// from the server instead of ticking the local simulation. Camera, rendering and HUD are shared.
// Platform geometry never arrives over the network — the server sends a seed and this scene
// regenerates the identical arena locally, folding in only damage and runtime pads.
import { SERVER_URL, CLIENT_ID, randomWorldName } from './config.js';
import { createInput } from './input.js';
import { createPauseMenu } from './pauseMenu.js';
import { centroid } from './camera.js';
import { createSnapshotBuffer } from './interpolate.js';
import { setupPlatforms } from '../platforms.js';
import { worldBounds } from '../view.js';
import { LOBBY } from '../sim/lobbyLayout.js';
import { Splash } from '../splash.js';
import { GAME_CONFIG } from '../config.js';
import { saveName } from './nameBadge.js';

const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
const MENU_BALL_RADIUS = GAME_CONFIG.REF_HEIGHT / 18;

export function createNetScene(stage, { lobbyId, name, create = false, mode = 'coop',
                                       named = false, onExit = null, onNotFound = null }) {
    const seamlessCreate = create;
    const handoffState = seamlessCreate ? stage.state : null;
    const handoffPlayerId = seamlessCreate ? 1 : null;
    let ws = null;
    let attempts = 0;   // bounded retries while we settle host-vs-join for this name
    let status = name ? 'connecting' : 'nameEntry';   // nameEntry when opened via a bare ?lobby link
    let message = '';
    let myId = null;
    let lobby = { players: [], status: 'staging', hostId: null, mode, round: 0, phaseMs: 0, winnerId: null };
    const EMPTY = { players: [], enemies: [], consumables: [], lavaY: 0, damage: [], extras: [] };
    // Raw authoritative snapshots go in; a smoothed, slightly-delayed view comes out.
    const snapshots = createSnapshotBuffer({ delayMs: 60 });
    let world = handoffState || EMPTY; // keep the menu host visible until authority arrives
    let latest = null;
    const lobbyDebris = [];
    let shattered = false;

    // Leaving is a local, ~1s drop-out that mirrors the drop-in: the staging platforms fall down
    // out of frame (randomized per pad) and then the menu takes over. It plays for the leaver on
    // Back/Leave and for guests told to leave by a host dissolving the lobby. The server does its
    // own half for the players who stay (a guest's pad is replaced; a host's dissolve ejects all).
    const LEAVE_MS = 850, LEAVE_STAGGER = 220;
    const clamp01 = v => Math.max(0, Math.min(1, v));
    let leaving = null;
    // Two leave choreographies, both ~1s then a handoff to the menu:
    //  - Host: the guest pads + divider fall out while the host's own pad stays (it becomes the
    //    menu rock in place); the camera holds the lobby framing.
    //  - Guest: the lobby freezes as a backdrop and only YOUR ball drops; the camera follows it
    //    down, then rises back to the lobby framing so you land on the menu — you, not the host.
    function requestLeave(after) {
        if (leaving) return;
        try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leave' })); } catch {}
        const view = sceneState();
        const iAmHost = isHost();
        const meId = myId ?? handoffPlayerId;
        const me = (view.players || []).find(p => p.id === meId);
        const hostPadX = LOBBY.hostX - LOBBY.padW / 2;
        leaving = {
            t0: performance.now(), after, done: false, iAmHost, lavaY: view.lavaY ?? 0,
            meId, meX: me?.x ?? 0, meFromY: me?.y ?? 0, fall: stage.canvas.height + 200,
            plats: (view.platforms || []).map(p => ({
                ...p, fromY: p.y,
                // Guest: everything freezes. Host: keep the host pad, the rest falls.
                keep: !iAmHost || (Math.abs(p.x - hostPadX) < 2 && Math.abs(p.y - LOBBY.restY) < 2),
                delay: Math.random() * LEAVE_STAGGER
            })),
            players: (view.players || []).map(p => ({ ...p, fromY: p.y }))
        };
        if (!iAmHost) stage.camera.setTarget(leaveCameraTarget, { ease: 0.2, snap: false });
    }
    const leaveElapsed = () => performance.now() - leaving.t0;
    const leaveBallY = t => leaving.meFromY + leaving.fall * (t * t);
    // Follow the dropping ball, then ease back up to the lobby framing over the last stretch.
    function leaveCameraTarget() {
        if (!leaving) return menuCameraAnchor();
        const t = clamp01(leaveElapsed() / LEAVE_MS);
        if (t < 0.55) return { x: leaving.meX, y: leaveBallY(t) };
        const k = (t - 0.55) / 0.45, holdY = leaveBallY(0.55), a = menuCameraAnchor();
        return { x: leaving.meX + (a.x - leaving.meX) * k, y: holdY + (a.y - holdY) * k };
    }
    function leavingState() {
        const t = leaveElapsed();
        return {
            enemies: [], consumables: [], lavaY: leaving.lavaY,
            platforms: leaving.plats.map(p => {
                if (p.keep) return p;
                const k = clamp01((t - p.delay) / LEAVE_MS);
                return { ...p, y: p.fromY + leaving.fall * (k * k) };
            }),
            // Host stays put; a guest drops only their own ball while everything else is frozen.
            players: leaving.players.map(p => {
                if (leaving.iAmHost || p.id !== leaving.meId) return p;
                return { ...p, y: leaveBallY(clamp01(t / LEAVE_MS)) };
            })
        };
    }

    // Locally generated arena, rebuilt whenever the server announces a new seed (i.e. a new round).
    let arena = null, arenaSeed = null;
    function syncArena(snapshot) {
        if (snapshot.seed !== arenaSeed) {
            arenaSeed = snapshot.seed;
            arena = setupPlatforms(stage.canvas, worldBounds, arenaSeed);
            stage.background.setSeed(arenaSeed);
            stage.lava.setSeed(arenaSeed);
            stage.lavaBackground.setSeed(arenaSeed);
        }
        arena.applySync(snapshot.damage, snapshot.extras);
    }

    // Reuse the menu's exact composition while staging, including its viewport-relative offset.
    // Every client computes the same anchor, so joined players share the host's previous view.
    const menuCameraAnchor = () => ({
        x: worldBounds.right / 2 - stage.canvas.width * 0.167,
        y: LOBBY.restY - MENU_BALL_RADIUS - stage.canvas.height * 0.22
    });
    function gameCameraTarget() {
        const me = world.players.find(p => p.id === (myId ?? handoffPlayerId));
        if (me) return me;
        return world.players.length ? centroid(world.players) : menuCameraAnchor();
    }
    stage.camera.setTarget(() => {
        if (lobby.status === 'staging') return menuCameraAnchor();
        return gameCameraTarget();
    // Ease direct joins into the shared composition; seamless hosts are already at this anchor.
    }, { ease: 0.1 });

    // Name entry (bare ?lobby link with no stored name). Keep this as a real, visible DOM field:
    // mobile/desktop keyboards then work normally and the placeholder disappears on first input.
    const nameInput = document.createElement('input');
    nameInput.maxLength = 16;
    nameInput.placeholder = 'Your name';
    nameInput.setAttribute('aria-label', 'Your name');
    nameInput.setAttribute('autocomplete', 'nickname');
    nameInput.className = 'name-entry-input';
    nameInput.value = name || '';
    document.body.appendChild(nameInput);

    const nameSubmit = document.createElement('button');
    nameSubmit.type = 'button';
    nameSubmit.className = 'name-entry-submit';
    nameSubmit.textContent = 'Enter';
    nameSubmit.addEventListener('click', submitName);
    document.body.appendChild(nameSubmit);

    // This form is DOM-backed and sits above the canvas, so its inverse reticle must live in
    // the same DOM layer rather than being drawn underneath it by the world renderer.
    const nameReticle = document.createElement('div');
    nameReticle.className = 'name-entry-reticle';
    nameReticle.hidden = true;
    document.body.appendChild(nameReticle);
    if (status === 'nameEntry') nameInput.focus();

    function layoutNameForm() {
        const W = stage.canvas.width, H = stage.canvas.height;
        const field = { x: W / 2 - 180, y: H * 0.3, w: 360, h: 46 };
        const button = { x: W / 2 - 90, y: field.y + 70, w: 180, h: 48 };
        for (const [element, box] of [[nameInput, field], [nameSubmit, button]]) {
            const client = stage.toClientRect(box);
            element.style.left = `${client.x}px`;
            element.style.top = `${client.y}px`;
            element.style.width = `${client.w}px`;
            element.style.height = `${client.h}px`;
            element.style.borderWidth = `${3 * client.scale}px`;
            element.style.fontSize = `${(element === nameInput ? 22 : 24) * client.scale}px`;
        }
        const visible = status === 'nameEntry';
        nameInput.hidden = !visible;
        nameSubmit.hidden = !visible;
        const buttonHot = visible && nameSubmit.matches(':hover');
        nameReticle.hidden = !buttonHot;
        if (buttonHot) {
            const client = stage.toClientPoint(stage.pointer);
            nameReticle.style.left = `${client.x}px`;
            nameReticle.style.top = `${client.y}px`;
            nameReticle.style.width = `${14 * client.scale}px`;
            nameReticle.style.height = `${14 * client.scale}px`;
        }
    }

    function connect(playerName) {
        status = 'connecting';
        message = '';
        let opened = false;
        try {
            const url = new URL(SERVER_URL);
            url.searchParams.set('lobby', lobbyId);
            url.searchParams.set('name', playerName);
            url.searchParams.set('cid', CLIENT_ID);
            // No seed goes over the wire: the lobby's name IS its seed, so the server derives
            // the same world from `lobby` alone.
            if (create) { url.searchParams.set('create', '1'); url.searchParams.set('mode', mode); }
            ws = new WebSocket(url);
        } catch { status = 'offline'; message = 'Cannot reach the server.'; return; }

        const connectionTimer = setTimeout(() => {
            if (!opened && ws?.readyState !== WebSocket.OPEN) {
                message = 'Game server did not respond. Is npm run dev running on port 8080?';
                try { ws.close(); } catch {}
            }
        }, 5000);
        ws.onopen = () => { opened = true; clearTimeout(connectionTimer); status = 'connected'; };
        ws.onmessage = e => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            // Host dissolved the lobby: fall back to the menu with the same drop-out.
            if (m.t === 'dissolve') return requestLeave(() => onExit?.());
            if (leaving) return;   // already animating out; ignore late server state
            if (m.t === 'welcome') { myId = m.id; create = false; }
            else if (m.t === 'lobby') {
                const gameStarting = m.status === 'starting' && lobby.status !== 'starting';
                lobby = m;
                if (gameStarting) {
                    stage.camera.moveTo(gameCameraTarget, 1000);
                    if (!shattered) shatterLobby();
                }
                if (m.status === 'staging') shattered = false;
                pendingRename = null;   // any lobby broadcast carrying our new name confirms the rename
            }
            else if (m.t === 'state') { latest = m; snapshots.push(m, performance.now()); syncArena(m); }
            else if (m.t === 'renameError') { message = m.message; pendingRename?.revert(); pendingRename = null; }
            else if (m.t === 'error') message = m.message;
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onclose = ev => {
            clearTimeout(connectionTimer);
            const reason = ev.reason || '';
            if (leaving) return;   // we chose to leave; the drop-out is already running
            // Host dissolved the lobby out from under us — leave with the same drop-out.
            if (ev.code === 1000 && /lobby closed/i.test(reason)) return requestLeave(() => onExit?.());
            // A shared/stored name may already belong to somebody in this lobby. Keep the
            // player here and reuse the existing name-entry form instead of dead-ending on a
            // disconnected message.
            if (ev.code === 4409 && /name is taken/i.test(reason)) {
                status = 'nameEntry';
                message = 'That name is taken. Choose another.';
                nameInput.value = '';
                setTimeout(() => nameInput.focus(), 0);
                return;
            }
            // Hosting and joining are the same act on the same name, so the two ways that can
            // race are both recoverable rather than errors. Bounded so they can't ping-pong.
            if (attempts++ < 4) {
                // Nobody hosts this world yet. If the player asked for it by name, offer to
                // host it; otherwise just create it.
                if (ev.code === 4404) {
                    if (named && onNotFound) return onNotFound(lobbyId);
                    create = true;
                    return connect(playerName);
                }
                if (ev.code === 4409 && /lobby already exists/i.test(reason)) {
                    if (named) { create = false; return connect(playerName); }   // beaten to it: join instead
                    lobbyId = randomWorldName();                                  // our own rolled world clashed
                    history.replaceState(null, '', `?lobby=${lobbyId}`);
                    return connect(playerName);
                }
            }
            status = 'offline';
            message = message || reason || 'Disconnected.';
        };
    }
    if (name) connect(name);

    // Esc pauses; Esc again backs out. Leaving closes the socket, which the server treats as a
    // normal disconnect (your ghost is reclaimable if you come back).
    const pause = createPauseMenu(stage, [
        { label: 'Resume', action: () => input.unlock() },
        ...(onExit ? [{ label: 'Leave Lobby', action: () => requestLeave(() => onExit()) }] : [])
    ], { title: `Lobby ${lobbyId}` });

    const input = createInput({
        onKey: k => {
            if (status === 'nameEntry') {
                if (k === 'enter') submitName();
                return false;   // swallow keys while typing a name
            }
            if (k !== 'escape') return;
            if (pause.toggle()) input.lock(); else input.unlock();
            return false;
        }
    });
    // Two co-op/pvp toggles inside the staging panel, sitting just above the START button.
    const modeBtns = () => {
        const p = LOBBY.panel, w = (p.w - 70) / 2, y = p.y + 226, h = 34;
        return { coop: { x: p.x + 30, y, w, h }, pvp: { x: p.x + 30 + w + 10, y, w, h } };
    };
    const isHost = () => lobby.hostId === myId;

    const onMouseDown = () => {
        if (pause.click()) return;
        if (status === 'nameEntry') { nameInput.focus(); return; }
        // Only the host flips the mode, and only while staging (the round is derived from it).
        if (lobby.status === 'staging' && isHost() && ws?.readyState === WebSocket.OPEN) {
            const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
            const b = modeBtns();
            for (const m of ['coop', 'pvp']) {
                const r = b[m];
                if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
                    if (lobby.mode !== m) ws.send(JSON.stringify({ t: 'mode', mode: m }));
                    return;
                }
            }
        }
    };
    window.addEventListener('mousedown', onMouseDown);

    function submitName() {
        const v = nameInput.value.trim();
        if (!NAME_RE.test(v)) { message = 'Name must be 2–16 letters, numbers, spaces, - or _.'; return; }
        saveName(v);   // surfaces the top-right badge
        connect(v);
    }

    // The universal name badge renaming: the lobby is the authority, so send it and let the
    // server accept (name unique) or reject (revert the badge).
    let pendingRename = null;
    const onNameChange = e => {
        if (ws?.readyState !== WebSocket.OPEN || !myId) return;   // not connected: the badge just stored it
        pendingRename = e.detail;
        ws.send(JSON.stringify({ t: 'rename', name: e.detail.name }));
    };
    window.addEventListener('namechange', onNameChange);

    let lastPointerRevision = stage.pointer.revision;
    function update() {
        // Mid drop-out: let the platforms fall (sceneState animates them), then hand off to the menu.
        if (leaving) {
            document.body.style.cursor = 'none';
            if (!leaving.done && leaveElapsed() > LEAVE_MS + LEAVE_STAGGER) {
                leaving.done = true;
                leaving.after?.();
            }
            return;
        }
        // Name entry uses a normal DOM-backed form, so reveal the OS pointer while it is open.
        // Once connected, the game goes back to its in-world aiming reticle.
        document.body.style.cursor = status === 'nameEntry' ? 'default' : 'none';
        layoutNameForm();
        const me = world.players.find(p => p.id === myId);
        if (ws?.readyState === WebSocket.OPEN && me) {
            const aim = Math.atan2((stage.pointer.y + stage.cam.y) - me.y, (stage.pointer.x + stage.cam.x) - me.x);
            const aimMoved = stage.pointer.revision !== lastPointerRevision;
            lastPointerRevision = stage.pointer.revision;
            ws.send(JSON.stringify({ t: 'input', ...input.read(), aim, aimMoved }));
        }
        for (let i = lobbyDebris.length - 1; i >= 0; i--) {
            lobbyDebris[i].update();
            if (lobbyDebris[i].isFinished()) lobbyDebris.splice(i, 1);
        }
    }

    function shatterLobby() {
        shattered = true;
        for (const p of latest?.extras || []) {
            for (let i = 0; i < 5; i++) {
                lobbyDebris.push(new Splash(
                    p.x + Math.random() * p.width,
                    p.y + Math.random() * p.height,
                    Math.max(8, Math.min(24, Math.sqrt(p.width * p.height) / 8)),
                    'grey', 'square', (Math.random() - 0.5) * 24, 10, 6
                ));
            }
        }
    }

    function text(ctx, str, x, y, size, align = 'center', color = 'white') {
        const visible = stage.visibleFrame;
        const margin = Math.max(8, size * 0.65);
        y = Math.max(visible.y + margin, Math.min(visible.y + visible.h - margin, y));
        if (align === 'left') x = Math.max(visible.x + margin, x);
        else if (align === 'right') x = Math.min(visible.x + visible.w - margin, x);
        else x = Math.max(visible.x + margin, Math.min(visible.x + visible.w - margin, x));
        ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
        ctx.font = `${size}px 'boxycool', sans-serif`;
        ctx.fillText(str, x, y);
    }

    // The stage renders this. Called once per frame, so it is also where the interpolated view
    // is refreshed — the camera and input then read the same smoothed positions we draw, which
    // is what stops the screen juddering along with the ball.
    function sceneState() {
        if (leaving) return leavingState();
        // Creating is an in-place ownership handoff, not a scene cut. Continue rendering the
        // menu's exact player/platform snapshot until the first authoritative state is ready.
        if (!latest && handoffState) { world = handoffState; return handoffState; }
        if (!latest) return { ...EMPTY, platforms: [] };
        world = snapshots.sample(performance.now()) ?? latest;
        return { ...world, platforms: arena ? arena.platforms : [] };
    }

    function draw(ctx) {
        if (leaving) return;   // clean drop-out: world only, no panels/HUD/pause overlays
        const W = stage.canvas.width, H = stage.canvas.height;
        if (status === 'nameEntry') {
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
            text(ctx, 'Enter your name', W / 2, H * 0.16, Math.min(64, W * 0.1));
        } else {
            if (lobby.status === 'staging' || lobby.status === 'starting') drawLobbyPanel(ctx);
            drawHud(ctx, W, H);
        }
        if (lobbyDebris.length) {
            ctx.save();
            ctx.translate(-stage.cam.x, -stage.cam.y);
            for (const s of lobbyDebris) s.draw(ctx);
            ctx.restore();
        }
        if (startButtonHovered()) {
            const me = world.players.find(p => p.id === myId);
            ctx.save();
            ctx.globalCompositeOperation = 'difference';
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(stage.pointer.x, stage.pointer.y, (me?.radius || 42) / 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        if (status === 'offline') text(ctx, message || 'Disconnected', W / 2, H * 0.8, 24, 'center', '#ff7777');
        else if (message) text(ctx, message, W / 2, H * 0.8, 22, 'center', '#ff9');
        pause.draw(ctx);
    }

    function startButtonHovered() {
        if (lobby.status !== 'staging') return false;
        const b = LOBBY.startBtn;
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
    }

    // This is the create form after it becomes live: same rectangle, now showing the lobby and
    // its slots. Its old confirm button is the server-checked START target.
    function drawLobbyPanel(ctx) {
        const p = LOBBY.panel, b = LOBBY.startBtn;
        const isStarting = lobby.status === 'starting';
        const wx = stage.pointer.x + stage.cam.x, wy = stage.pointer.y + stage.cam.y;
        const hovered = wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
        ctx.save();
        ctx.translate(-stage.cam.x, -stage.cam.y);
        ctx.fillStyle = 'rgba(10,10,10,0.88)'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = 'white'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `30px 'boxycool', sans-serif`;
        ctx.fillText(`Lobby ${lobbyId}`, p.x + p.w / 2, p.y + 34);
        ctx.globalAlpha = 0.6;
        ctx.font = `17px 'boxycool', sans-serif`;
        ctx.fillText(`${lobby.mode.toUpperCase()} · ${lobby.players.length}/4 players`, p.x + p.w / 2, p.y + 62);
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left'; ctx.font = `20px 'boxycool', sans-serif`;
        for (let i = 0; i < 4; i++) {
            const player = lobby.players[i];
            ctx.fillStyle = player ? (player.disconnected ? '#ff9' : 'white') : '#666';
            ctx.fillText(`${i === 0 ? 'HOST' : `SLOT ${i + 1}`}  ${player?.name || 'waiting…'}`,
                p.x + 30, p.y + 98 + i * 36);
        }
        if (hovered && !isStarting) { ctx.shadowColor = 'white'; ctx.shadowBlur = 24; }
        ctx.fillStyle = hovered && !isStarting ? 'black' : 'white';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.shadowBlur = 0;
        ctx.fillStyle = hovered && !isStarting ? 'white' : 'black';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `24px 'boxycool', sans-serif`;
        ctx.fillText(isStarting ? 'BREAKING IN…' : (lobby.buttonTaunt || 'START GAME'), b.x + b.w / 2, b.y + b.h / 2);
        ctx.restore();
    }

    function drawHud(ctx, W, H) {
        text(ctx, `Lobby ${lobbyId}  ·  Round ${lobby.round}`, W / 2, H * 0.05, Math.min(30, W * 0.045));

        const me = lobby.players.find(p => p.id === myId);
        if (lobby.status === 'over') {
            const winner = lobby.players.find(p => p.id === lobby.winnerId);
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
            text(ctx, winner ? `${winner.name} wins!` : 'Round over', W / 2, H * 0.4, Math.min(64, W * 0.09));
            text(ctx, `Next round in ${Math.ceil(lobby.phaseMs / 1000)}`, W / 2, H * 0.5, 28);
        } else if (me?.spectating) {
            text(ctx, 'Spectating — you join the next round', W / 2, H * 0.11, 24, 'center', 'white');
        } else if (me?.eliminated) {
            text(ctx, 'Eliminated — spectating', W / 2, H * 0.11, 24, 'center', '#ff9');
        }

        // Player strip: lives left, dimmed once out.
        let y = H * 0.17;
        for (const p of lobby.players) {
            const out = p.eliminated || p.spectating;
            const label = p.spectating ? 'waiting' : '♥'.repeat(Math.max(0, p.lives));
            text(ctx, `${p.name}${p.id === myId ? ' (you)' : ''}  ${label}`, W * 0.02, y, 20, 'left',
                out ? '#777' : (p.disconnected ? '#ff9' : 'white'));
            y += 26;
        }
    }

    return {
        update, draw, state: sceneState, requestLeave,
        get myId() { return myId ?? handoffPlayerId; },
        get reticleInvert() { return startButtonHovered(); },
        get reticleOnTop() { return !!leaving || startButtonHovered(); },
        dispose() {
            input.dispose();
            window.removeEventListener('mousedown', onMouseDown);
            nameSubmit.removeEventListener('click', submitName);
            nameInput.remove();
            nameSubmit.remove();
            nameReticle.remove();
            try {
                if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leave' }));
                ws?.close(1000, 'Left lobby');
            } catch {}
        }
    };
}
