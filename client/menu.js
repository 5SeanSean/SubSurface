// Menu entry and the single owner of the stage. Picking an option swaps the scene in-page —
// solo and multiplayer are both seamless, with browser history mirroring scene changes.
//
// Creating a lobby does NOT invent a code: the world you are standing in already has a name,
// and that name IS the lobby. And because the two are the same thing, typing the name of a
// world nobody is hosting isn't an error — it drops you into the create flow for that name.
import { createStage } from './stage.js';
import { createMenuScene } from './menuScene.js';
import { createGameScene } from './gameScene.js';
import { createNetScene } from './netScene.js';
import { WORLD_NAME } from './config.js';
import { hashSeed } from '../sim/rng.js';
import { createNameBadge, storedName } from './nameBadge.js';

const stage = createStage();
createNameBadge();   // universal top-right name chip, lives for the whole session
let inMenu = true;
let activeScene = null;
// A scene that owns a graceful exit (the lobby's drop-out) plays it before the next scene builds.
const swap = scene => { activeScene = scene; stage.setScene(scene); return scene; };
const setUrl = (mode, url) => {
    if (mode === 'push') history.pushState(null, '', url);
    else if (mode === 'replace') history.replaceState(null, '', url);
};

// Joining a world nobody hosts sends you here to host it instead. Because Create Lobby now hosts
// instantly (you pick co-op/pvp from inside the lobby), a named create skips the menu entirely
// and drops straight into staging that world.
export function showMenu({ createFor = null, seed = null, historyMode = 'replace' } = {}) {
    if (createFor) return enterLobby({ lobbyId: createFor, name: storedName(), create: true, mode: 'coop', named: true, historyMode });
    inMenu = true;
    const hostName = seed || WORLD_NAME;
    setUrl(historyMode, `?seed=${hostName}`);
    // Rebuild the backdrop for whichever world the menu is now offering, so the title,
    // the URL and the arena you are looking at all agree.
    stage.resetWorld(hashSeed(hostName));
    swap(createMenuScene(stage, {
        hostName,
        onSolo: () => { inMenu = false; swap(createGameScene(stage, { onExit: showMenu })); },
        // Create hosts immediately; the name screen (if unset) and co-op/pvp both live in the lobby.
        onCreate: lobbyId => enterLobby({ lobbyId, name: storedName(), create: true, mode: 'coop', named: false }),
        onJoin: code => enterLobby({ lobbyId: code, name: storedName(), create: false, named: true }),
        isActive: () => inMenu
    }));
}

function enterLobby({ lobbyId, name, create, mode = 'coop', named, historyMode = 'push' }) {
    setUrl(historyMode, `?lobby=${lobbyId}`);
    inMenu = false;
    swap(createNetScene(stage, {
        lobbyId, name, create, mode, named,
        onExit: showMenu,
        // Nobody is hosting that world — go and host it rather than dead-ending on an error.
        onNotFound: missing => showMenu({ createFor: missing, notice: `nobody is hosting ${missing} — host it` })
    }));
}

// ?lobby=CODE goes straight into that lobby; otherwise the diegetic menu.
export function start({ lobbyId = null } = {}) {
    if (lobbyId) enterLobby({ lobbyId, name: storedName(), create: false, named: true, historyMode: 'replace' });
    else showMenu();
}

// Back/Forward swaps the in-page scene as well as the URL. Scene disposal sends the graceful
// leave message, so going Back from a lobby also disappears immediately for the other players.
window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    const lobbyId = params.get('lobby')?.toUpperCase();
    const nav = () => {
        if (lobbyId) enterLobby({ lobbyId, name: storedName(), create: false, named: true, historyMode: 'none' });
        else showMenu({ seed: params.get('seed')?.toUpperCase() || WORLD_NAME, historyMode: 'none' });
    };
    // Leaving a lobby plays its drop-out first, then the target scene builds.
    if (activeScene?.requestLeave) activeScene.requestLeave(nav);
    else nav();
});
