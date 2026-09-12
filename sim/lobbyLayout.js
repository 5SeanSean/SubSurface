// Lobby staging layout — the ONE source of truth for the host-gated start flow, shared by the
// authoritative sim (sim/world.js) and the client renderer (client/netScene.js) so the wall the
// host is boxed behind and the button they shoot to begin are identical on both sides.
//
// The host remains near the menu platform. The create form to their right
// becomes the live lobby panel. Guests line up to the host's left behind a short divider that
// protects the START target without cutting the whole screen in half.
import { worldBounds } from '../view.js';
import { GAME_CONFIG } from '../config.js';

const H = GAME_CONFIG.REF_HEIGHT;
const W = worldBounds.right;

export const LOBBY = {
    restY: 820,
    // Staging pieces begin ABOVE the visible frame (the camera's top edge can reach world-y 0 on
    // tall windows), then ease through a seeded dip/bounce — so the drop-in reads as seamless
    // rather than platforms popping into view. The same distance drives the drop-OUT on leave.
    drop: H * 0.9,
    motionMs: 2200,
    motionJitterMs: 420,
    motionDelayMs: 140,
    dip: 24,
    rebound: 11,
    padW: 180,
    padH: 44,
    hostX: W / 2 - 60,
    otherX0: W / 2 - 510,
    otherDX: -200,
    // Keep the menu/lobby UI halfway between the host and the right edge of the
    // reference viewport. The narrower column leaves equal breathing room on
    // either side instead of crowding the edge of the screen.
    panel: { x: W / 2 + 140, y: 470, w: 360, h: 330 },
    fixtures: [
        { x: W / 2 - 330, y: 520, w: 54, h: 390 }
    ],
    // The create form's confirm button becomes this authoritative shootable target.
    startBtn: { x: W / 2 + 170, y: 734, w: 300, h: 48 },
    breakMs: 850
};

// Column x for a lobby slot: index 0 is the host, the rest fan out to the left.
export const lobbyColumnX = index =>
    index === 0 ? LOBBY.hostX : LOBBY.otherX0 + (index - 1) * LOBBY.otherDX;
