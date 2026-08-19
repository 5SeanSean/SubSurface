// filepath: /h:/Downloads/PLATZIO/config.js
export const GAME_CONFIG = {
    TICK_RATE: 120,
    TICK_DURATION: 1000 / 120,
    // Fixed reference resolution. The SIMULATION derives all its units from these
    // constants, never the live browser window, so it runs identically on every
    // client and headless in Node. The renderer still adapts to the real window.
    REF_WIDTH: 1920,
    REF_HEIGHT: 1080,
    WORLD_SCALE: 3,
    // Fixed world size (reference * scale) — shared by all players.
    WORLD_WIDTH: 1920 * 3,
    WORLD_HEIGHT: 1080 * 3,
    PLATFORM_COUNT: 60,
    MAX_LAVA_SQUARES: 20,
    PHYSICS_DAMPING: 1.1,
    SPAWN_INTERVAL: 100,
    CELL_SIZE: 100,
    MAX_PARTICLES: 1000,
    MAX_PROJECTILES: 50,
    MAX_SPLASHES: 200
};