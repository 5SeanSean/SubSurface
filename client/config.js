// Client-side config. The scenes read the lobby from the URL themselves, so all this owns is
// the stable client id (for reconnecting to your ghost) and where the server lives.
const params = new URLSearchParams(location.search);
const lobbyId = (params.get('lobby') || '').toUpperCase();

// Keep identity out of shareable lobby URLs.
if (params.get('name')) {
    sessionStorage.setItem('platzPlayerName', params.get('name').trim());
    localStorage.setItem('platzName', params.get('name').trim());
}
if (params.get('server')) sessionStorage.setItem('platzServer', params.get('server'));

let clientId = localStorage.getItem('platzClientId');
if (!clientId) { clientId = crypto.randomUUID(); localStorage.setItem('platzClientId', clientId); }
export const CLIENT_ID = clientId;

// Same origin as the page in dev (the dev server serves the static files AND the websocket),
// so any port works — this used to hardcode 8080 and broke on every other port.
export const SERVER_URL = sessionStorage.getItem('platzServer') ||
    (location.protocol === 'https:'
        ? 'wss://lavagame.greenrock-b6387993.westus2.azurecontainerapps.io'
        : `ws://${location.host || 'localhost:8080'}`);

const cleanSearch = lobbyId ? `?lobby=${encodeURIComponent(lobbyId)}` : '';
if (location.search !== cleanSearch) history.replaceState(null, '', `${location.pathname}${cleanSearch}`);
