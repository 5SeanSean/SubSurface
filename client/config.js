const params = new URLSearchParams(location.search);
// `?server=wss://...` lets us test Azure before committing its final hostname.
export const SERVER_URL = params.get('server') ||
    (location.protocol === 'https:' ? 'wss://lavagame.greenrock-b6387993.westus2.azurecontainerapps.io' : 'ws://localhost:8080');
export const LOBBY_ID = (params.get('lobby') || 'PUBLIC').toUpperCase();
