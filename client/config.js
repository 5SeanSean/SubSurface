// Client-side config: the stable client id (for reclaiming your ghost on reconnect), where the
// server lives, and this session's world.
//
// The world's NAME IS ITS SEED. "K7QP2M" names both a lobby and the exact arena, enemy spawns
// and layout that lobby plays — everything in the sim derives from hashing this one string. So
// sharing a lobby name shares a world, and creating a lobby from a world you're already in
// simply keeps its name.
import { hashSeed } from '../sim/rng.js';

const params = new URLSearchParams(location.search);
const VALID = /^[A-Z0-9_-]{1,24}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 — these get read aloud

export function randomWorldName() {
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join('');
}

// Keep identity out of shareable lobby URLs.
if (params.get('name')) {
    sessionStorage.setItem('subsurfacePlayerName', params.get('name').trim());
    localStorage.setItem('subsurfaceName', params.get('name').trim());
}
if (params.get('server')) sessionStorage.setItem('subsurfaceServer', params.get('server'));

let clientId = localStorage.getItem('subsurfaceClientId');
if (!clientId) { clientId = crypto.randomUUID(); localStorage.setItem('subsurfaceClientId', clientId); }
export const CLIENT_ID = clientId;

// A lobby name and a seed name are the same thing, so ?lobby= wins when present.
const requested = (params.get('lobby') || params.get('seed') || '').toUpperCase();
export const WORLD_NAME = VALID.test(requested) ? requested : randomWorldName();
export const WORLD_SEED = hashSeed(WORLD_NAME);
export const IN_LOBBY = params.has('lobby');

// The Node dev server serves both files and WebSockets, so pages opened on it use the same
// origin. VS Code Live Server only serves files (normally on 5500/5501), therefore those pages
// must connect to the game server on 8080 instead of Live Server's own reload WebSocket.
const liveServerPorts = new Set(['5500', '5501', '8000']);
const localSocketHost = liveServerPorts.has(location.port)
    ? `${location.hostname || 'localhost'}:8080`
    : (location.host || 'localhost:8080');
export const SERVER_URL = sessionStorage.getItem('subsurfaceServer') ||
    (location.protocol === 'https:'
        ? 'wss://lavagame.greenrock-b6387993.westus2.azurecontainerapps.io'
        : `ws://${localSocketHost}`);

// Canonical URL: the world name, as a lobby when we're in one, otherwise as a seed.
const clean = `?${IN_LOBBY ? 'lobby' : 'seed'}=${WORLD_NAME}`;
if (location.search !== clean) history.replaceState(null, '', `${location.pathname}${clean}`);
