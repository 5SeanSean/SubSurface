// Single entry point. ?lobby=CODE joins/opens a multiplayer lobby on the shared stage;
// otherwise the diegetic menu (which starts singleplayer and creates lobbies in-page, no reload).
const params = new URLSearchParams(location.search);

if (params.has('lobby')) {
    const { createStage } = await import('./stage.js');
    const { createNetScene } = await import('./netScene.js');
    const stage = createStage();
    const name = (sessionStorage.getItem('platzPlayerName') || localStorage.getItem('platzName') || '').trim();
    stage.setScene(createNetScene(stage, { lobbyId: params.get('lobby').toUpperCase(), name, create: false }));
} else {
    import('./menu.js');
}
