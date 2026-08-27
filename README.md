# Platz

Browser action game with an authoritative Node/WebSocket server. GitHub Pages serves
the client; Azure Container Apps runs the shared simulation.

## Local development

```text
npm install
npm run dev
```

Open `http://localhost:8080`. This serves the client and WebSocket server together.
A Live Server page on ports 5500 or 8000 can also connect to the local server.

Run the regression checks with `npm test`.

## Multiplayer rules

- Players enter a unique 2–16 character name.
- The creator chooses co-op or PvP and starts the match.
- Every player shares the same `multiplayer.html?lobby=CODE` URL; host follows saved join order.
- Lobbies hold four players and cannot be joined after starting.
- If the creator leaves, ownership moves to the next player who joined.
- PvP players have three lives; eliminated players remain as spectators.
- Empty lobbies are deleted immediately. No database is required.

Singleplayer runs the same `createWorld` simulation locally, so its physics stay in
sync with online play without consuming Azure traffic.

## Deployment

The workflow in `.github/workflows/server-image.yml` publishes the server image to
GHCR after pushes to `main`. Azure Container Apps should expose port `8080`, enable
external ingress and WebSockets, and set `ALLOWED_ORIGINS` to the GitHub Pages origin.
The production WebSocket hostname is configured in `client/config.js`.
