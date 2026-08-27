// Multiplayer scene on the shared stage. Connects to the authoritative server and renders its
// snapshots. Platform geometry never arrives over the network — the server sends a seed and this
// scene regenerates the identical arena locally, folding in only damage and runtime pads.
// ownRender:true — this scene draws the whole frame, so the stage skips its local world.
import { SERVER_URL, CLIENT_ID } from './config.js';
import { renderWorld } from './render.js';
import { createInput } from './input.js';
import { centroid } from './camera.js';
import { setupPlatforms } from '../platforms.js';
import { worldBounds } from '../view.js';

const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;

export function createNetScene(stage, { lobbyId, name, create = false, mode = 'coop' }) {
    let ws = null;
    let status = name ? 'connecting' : 'nameEntry';   // nameEntry when opened via a bare ?lobby link
    let message = '';
    let myId = null;
    let lobby = { players: [], status: 'staging', hostId: null, mode, round: 0, phaseMs: 0, winnerId: null };
    let world = { players: [], enemies: [], consumables: [], lavaY: 0, damage: [], extras: [] };

    // Locally generated arena, rebuilt whenever the server announces a new seed (i.e. a new round).
    let arena = null, arenaSeed = null;
    function syncArena(snapshot) {
        if (snapshot.seed !== arenaSeed) {
            arenaSeed = snapshot.seed;
            arena = setupPlatforms(stage.canvas, worldBounds, arenaSeed);
        }
        arena.applySync(snapshot.damage, snapshot.extras);
    }

    // Who the camera watches: yourself while you're in the round, otherwise the surviving
    // players (spectating), otherwise everyone on screen (staging).
    stage.camera.setTarget(() => {
        const me = world.players.find(p => p.id === myId);
        if (me) return me;
        const others = world.players;
        return others.length ? centroid(others) : null;
    }, { ease: 0.1, snap: true });

    // name entry (bare ?lobby link with no stored name)
    const nameInput = document.createElement('input');
    nameInput.maxLength = 16;
    nameInput.setAttribute('autocomplete', 'nickname');
    Object.assign(nameInput.style, { position: 'fixed', left: '-9999px', opacity: '0', pointerEvents: 'none' });
    nameInput.value = name || '';
    document.body.appendChild(nameInput);
    if (status === 'nameEntry') nameInput.focus();

    function connect(playerName) {
        status = 'connecting';
        message = '';
        try {
            const url = new URL(SERVER_URL);
            url.searchParams.set('lobby', lobbyId);
            url.searchParams.set('name', playerName);
            url.searchParams.set('cid', CLIENT_ID);
            if (create) { url.searchParams.set('create', '1'); url.searchParams.set('mode', mode); }
            ws = new WebSocket(url);
        } catch { status = 'offline'; message = 'Cannot reach the server.'; return; }

        ws.onopen = () => { status = 'connected'; };
        ws.onmessage = e => {
            let m; try { m = JSON.parse(e.data); } catch { return; }
            if (m.t === 'welcome') { myId = m.id; create = false; }
            else if (m.t === 'lobby') lobby = m;
            else if (m.t === 'state') { world = m; syncArena(m); }
            else if (m.t === 'error') message = m.message;
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onclose = ev => { status = 'offline'; message = ev.reason || 'Disconnected.'; };
    }
    if (name) connect(name);

    const input = createInput({
        onKey: k => {
            if (status !== 'nameEntry') return;
            if (k === 'enter') submitName();
            return false;   // swallow keys while typing a name
        }
    });
    const onMouseDown = () => { if (status === 'nameEntry') nameInput.focus(); };
    window.addEventListener('mousedown', onMouseDown);

    function submitName() {
        const v = nameInput.value.trim();
        if (!NAME_RE.test(v)) { message = 'Name must be 2–16 letters, numbers, spaces, - or _.'; return; }
        localStorage.setItem('platzName', v);
        connect(v);
    }

    function update() {
        const me = world.players.find(p => p.id === myId);
        if (ws?.readyState === WebSocket.OPEN && me) {
            const aim = Math.atan2((stage.pointer.y + stage.cam.y) - me.y, (stage.pointer.x + stage.cam.x) - me.x);
            ws.send(JSON.stringify({ t: 'input', ...input.read(), aim }));
        }
    }

    function text(ctx, str, x, y, size, align = 'center', color = 'white') {
        ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
        ctx.font = `${size}px 'boxycool', sans-serif`;
        ctx.fillText(str, x, y);
    }

    function draw(ctx) {
        const W = stage.canvas.width, H = stage.canvas.height;
        const state = { ...world, platforms: arena ? arena.platforms : [] };
        renderWorld(ctx, {
            canvas: stage.canvas, state, background: stage.background, lava: stage.lava,
            camX: stage.cam.x, camY: stage.cam.y, myId, mouseX: stage.pointer.x, mouseY: stage.pointer.y
        });

        if (status === 'nameEntry') {
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
            text(ctx, 'Enter your name', W / 2, H * 0.16, Math.min(64, W * 0.1));
            const bx = W / 2 - 180, by = H * 0.3;
            ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, 360, 44);
            text(ctx, (nameInput.value || 'Your name') + (Math.floor(Date.now() / 500) % 2 ? '|' : ''), bx + 12, by + 22, 22, 'left');
            text(ctx, 'Press Enter to join', W / 2, by + 80, 22);
        } else {
            drawHud(ctx, W, H);
        }
        if (status === 'offline') text(ctx, message || 'Disconnected', W / 2, H * 0.8, 24, 'center', '#ff7777');
        else if (message) text(ctx, message, W / 2, H * 0.8, 22, 'center', '#ff9');
    }

    function drawHud(ctx, W, H) {
        text(ctx, `Lobby ${lobbyId}  ·  Round ${lobby.round}`, W / 2, H * 0.05, Math.min(30, W * 0.045));

        const me = lobby.players.find(p => p.id === myId);
        if (lobby.status === 'staging') {
            text(ctx, `Round starts in ${Math.ceil(lobby.phaseMs / 1000)}`, W / 2, H * 0.11, 26, 'center', '#9fd');
        } else if (lobby.status === 'over') {
            const winner = lobby.players.find(p => p.id === lobby.winnerId);
            ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
            text(ctx, winner ? `${winner.name} wins!` : 'Round over', W / 2, H * 0.4, Math.min(64, W * 0.09));
            text(ctx, `Next round in ${Math.ceil(lobby.phaseMs / 1000)}`, W / 2, H * 0.5, 28);
        } else if (me?.spectating) {
            text(ctx, 'Spectating — you join the next round', W / 2, H * 0.11, 24, 'center', '#9fd');
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
        ownRender: true, update, draw,
        dispose() {
            input.dispose();
            window.removeEventListener('mousedown', onMouseDown);
            nameInput.remove();
            try { ws?.close(); } catch {}
        }
    };
}
