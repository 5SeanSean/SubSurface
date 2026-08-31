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

const stage = createStage();
let inMenu = true;
const storedName = () => (localStorage.getItem('subsurfaceName') || '').trim();
const setUrl = (mode, url) => {
    if (mode === 'push') history.pushState(null, '', url);
    else if (mode === 'replace') history.replaceState(null, '', url);
};

// Joining a world nobody hosts sends you here to host it instead, so the name the menu would
// host isn't always the session's own world.
export function showMenu({ createFor = null, notice = '', seed = null, historyMode = 'replace' } = {}) {
    inMenu = true;
    const hostName = createFor || seed || WORLD_NAME;
    setUrl(historyMode, `?seed=${hostName}`);
    // Rebuild the backdrop for whichever world the menu is now offering, so the title,
    // the URL and the arena you are looking at all agree.
    stage.resetWorld(hashSeed(hostName));
    stage.setScene(createMenuScene(stage, {
        hostName,
        openCreate: !!createFor,
        notice,
        onSolo: () => { inMenu = false; stage.setScene(createGameScene(stage, { onExit: showMenu })); },
        onCreate: (playerName, gameMode, lobbyId) => {
            localStorage.setItem('subsurfaceName', playerName);
            enterLobby({ lobbyId, name: playerName, create: true, mode: gameMode, named: !!createFor });
        },
        onJoin: code => enterLobby({ lobbyId: code, name: storedName(), create: false, named: true }),
        isActive: () => inMenu
    }));
}

function enterLobby({ lobbyId, name, create, mode = 'coop', named, historyMode = 'push' }) {
    setUrl(historyMode, `?lobby=${lobbyId}`);
    inMenu = false;
    stage.setScene(createNetScene(stage, {
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
    if (lobbyId) {
        enterLobby({ lobbyId, name: storedName(), create: false, named: true, historyMode: 'none' });
    } else {
        showMenu({ seed: params.get('seed')?.toUpperCase() || WORLD_NAME, historyMode: 'none' });
    }
});
