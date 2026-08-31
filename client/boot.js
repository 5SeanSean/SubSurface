// Single entry point. menu.js owns the stage for BOTH paths, so a ?lobby= link that turns out
// to be unhosted can still fall back into the menu's create flow.
const params = new URLSearchParams(location.search);
const { start } = await import('./menu.js');
start({ lobbyId: params.get('lobby')?.toUpperCase() || null });
