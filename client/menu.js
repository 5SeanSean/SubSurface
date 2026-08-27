// Menu entry: the diegetic canvas menu owns the whole title experience (no HTML buttons).
// Picking an option swaps the stage's scene in-page — solo and multiplayer are both seamless,
// with only the URL updated via replaceState so a lobby link is shareable.
import { createStage } from './stage.js';
import { createMenuScene } from './menuScene.js';
import { createGameScene } from './gameScene.js';
import { createNetScene } from './netScene.js';

function randomLobby() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => alphabet[byte % alphabet.length]).join('');
}

const stage = createStage();
let inMenu = true;

stage.setScene(createMenuScene(stage, {
    // Singleplayer: the menu already shattered its platform; the real ball is now falling.
    onSolo: () => { inMenu = false; stage.setScene(createGameScene(stage)); },
    onCreate: (name, gameMode) => {
        localStorage.setItem('platzName', name);
        const lobby = randomLobby();
        history.replaceState(null, '', `?lobby=${lobby}`);
        inMenu = false;
        stage.setScene(createNetScene(stage, { lobbyId: lobby, name, create: true, mode: gameMode }));
    },
    onJoin: code => {
        history.replaceState(null, '', `?lobby=${code}`);
        inMenu = false;
        stage.setScene(createNetScene(stage, { lobbyId: code, name: (localStorage.getItem('platzName') || '').trim(), create: false }));
    },
    isActive: () => inMenu
}));
