// Deterministic game clock. Advances by fixed ticks from the game loop, not wall time.
// Why: cooldowns/timers read one logical time instead of calling Date.now() per entity
// per frame, and logical time is what a future authoritative server / replay needs.
let _t = 0;

export function now() {
    return _t;
}

export function advanceClock(ms) {
    _t += ms;
}

export function resetClock() {
    _t = 0;
}
