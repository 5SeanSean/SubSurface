// Multiplayer client: pure input + render. It NEVER simulates — it sends input to the
// authoritative server and draws whatever snapshot the server sends back. If the server
// is unreachable it shows an offline notice; single-player (index.html) is unaffected.
import { GAME_CONFIG } from '../config.js';
import { LOBBY_ID, SERVER_URL } from './config.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const WORLD_W = GAME_CONFIG.WORLD_WIDTH;
const WORLD_H = GAME_CONFIG.WORLD_HEIGHT;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

// ---- network state ----
let ws = null;
let myId = null;
let status = 'connecting';        // connecting | connected | offline
let state = { players: [], platforms: [], enemies: [], consumables: [], lavaY: 0 };

function connect() {
    status = 'connecting';
    try {
        const url = new URL(SERVER_URL);
        url.searchParams.set('lobby', LOBBY_ID);
        ws = new WebSocket(url);
    }
    catch { status = 'offline'; return; }

    ws.onopen = () => { status = 'connected'; };
    ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') myId = m.id;
        else if (m.t === 'state') state = m;
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onclose = () => { status = 'offline'; myId = null; setTimeout(connect, 2000); }; // auto-retry
}
connect();

// ---- input (same shape the server expects) ----
const keys = new Set();
let shooting = false, jumpQueued = false, mouseX = 0, mouseY = 0;
const JUMP_KEYS = new Set([' ', 'w', 'arrowup']);

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    keys.add(k);
    if (JUMP_KEYS.has(k)) { jumpQueued = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) shooting = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) shooting = false; });
window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

function sendInput() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Camera is centered on our own ball, so aim angle is measured from screen center.
    const aim = Math.atan2(mouseY - canvas.height / 2, mouseX - canvas.width / 2);
    ws.send(JSON.stringify({ t: 'input', keys: [...keys], shooting, jump: jumpQueued, aim }));
    jumpQueued = false;
}

// ---- render ----
function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const me = myId != null ? state.players.find(p => p.id === myId) : null;
    const camX = me ? clamp(me.x - canvas.width / 2, 0, Math.max(0, WORLD_W - canvas.width)) : 0;
    const camY = me ? clamp(me.y - canvas.height / 2, 0, Math.max(0, WORLD_H - canvas.height)) : 0;

    ctx.save();
    ctx.translate(-camX, -camY);

    // Platforms
    for (const pl of state.platforms) {
        ctx.fillStyle = pl.color || '#354859';
        ctx.fillRect(pl.x, pl.y, pl.width, pl.height);
    }

    // Lava (bar across the world floor)
    if (state.lavaY) {
        ctx.fillStyle = '#e11d1d';
        ctx.fillRect(0, state.lavaY, WORLD_W, WORLD_H - state.lavaY);
    }

    // Enemies (lava squares) + their projectiles
    for (const e of state.enemies || []) {
        ctx.fillStyle = '#c026d3';
        for (const pr of e.projectiles) {
            ctx.fillRect(pr.x - pr.radius, pr.y - pr.radius, pr.radius * 2, pr.radius * 2);
        }
        const hurt = e.health ? Math.min(e.hitCount / e.health, 1) : 0;
        ctx.fillStyle = `rgb(${220 - hurt * 120}, 40, 40)`;
        ctx.fillRect(e.x, e.y, e.size, e.size);
        // aim stick toward its target
        ctx.strokeStyle = '#ff8888';
        ctx.lineWidth = e.size / 6;
        ctx.beginPath();
        ctx.moveTo(e.x + e.size / 2, e.y + e.size / 2);
        ctx.lineTo(e.x + e.size / 2 + Math.cos(e.angle) * e.size, e.y + e.size / 2 + Math.sin(e.angle) * e.size);
        ctx.stroke();
    }

    // Consumables
    for (const c of state.consumables || []) {
        ctx.fillStyle = c.color || 'white';
        if (c.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(c.x, c.y, c.size / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillRect(c.x, c.y, c.size, c.size);
        }
    }

    // Players (+ their projectiles)
    for (const p of state.players) {
        ctx.fillStyle = 'white';
        for (const pr of p.projectiles) {
            ctx.beginPath();
            ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
            ctx.fill();
        }
        const isMe = p.id === myId;
        ctx.fillStyle = isMe ? '#ffffff' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        // aim stick
        ctx.strokeStyle = isMe ? '#ffffff' : '#38bdf8';
        ctx.lineWidth = p.radius / 4;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(p.angle) * p.radius * 1.6, p.y + Math.sin(p.angle) * p.radius * 1.6);
        ctx.stroke();
    }

    ctx.restore();
    drawHud(me);
}

function drawHud(me) {
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText(`Players: ${state.players.length}`, 20, 30);
    ctx.fillText(`Lobby: ${LOBBY_ID}`, 20, 58);
    if (me) ctx.fillText(`Score: ${Math.round(me.score)}   Ammo: ${me.currentStock}`, 20, 86);

    if (status !== 'connected') {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, canvas.height / 2 - 60, canvas.width, 120);
        ctx.fillStyle = '#ff6666';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        const msg = status === 'connecting' ? 'Connecting to server…' : 'Multiplayer server offline';
        ctx.fillText(msg, canvas.width / 2, canvas.height / 2 - 10);
        ctx.fillStyle = 'white';
        ctx.font = '18px Arial';
        ctx.fillText('Single-player is always available at index.html', canvas.width / 2, canvas.height / 2 + 24);
        ctx.textAlign = 'left';
    }
}

function loop() {
    sendInput();
    render();
    requestAnimationFrame(loop);
}
loop();
