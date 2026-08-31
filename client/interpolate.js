// Snapshot buffer + entity interpolation for the networked scene.
//
// The server broadcasts 30x/sec but we render at 60+fps, so drawing the newest snapshot directly
// teleports everything ~40px every other frame — very obvious while jumping, and the camera
// follows it, so the whole screen judders. Instead we render slightly IN THE PAST and blend
// between the two snapshots bracketing that moment, which turns 30Hz updates into smooth motion
// at any frame rate. The cost is `delayMs` of extra visual latency.
const TAU = Math.PI * 2;

// Shortest way round the circle, so aim doesn't spin the long way through 0/2pi.
function lerpAngle(a, b, k) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return a + d * k;
}

export function createSnapshotBuffer({ delayMs = 60, teleport = 400, keep = 8 } = {}) {
    const buf = [];   // { t, s } oldest -> newest

    // Respawns and round changes move a ball across the map; blending through that would draw it
    // gliding over the whole arena, so past this distance we cut rather than interpolate.
    const blendEntity = (a, b, k) => {
        if (Math.hypot(b.x - a.x, b.y - a.y) > teleport) return b;
        const out = { ...b, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        if (a.radius != null && b.radius != null) out.radius = a.radius + (b.radius - a.radius) * k;
        if (a.dx != null && b.dx != null) out.dx = a.dx + (b.dx - a.dx) * k;
        if (a.dy != null && b.dy != null) out.dy = a.dy + (b.dy - a.dy) * k;
        if (a.angle != null && b.angle != null) out.angle = lerpAngle(a.angle, b.angle, k);
        if (a.shotRange != null && b.shotRange != null) out.shotRange = a.shotRange + (b.shotRange - a.shotRange) * k;
        // Shots fly ~86px between snapshots — steppier than the players firing them.
        if (a.projectiles && b.projectiles) out.projectiles = blendList(a.projectiles, b.projectiles, k, true);
        return out;
    };

    // Match by id where entities have one; consumables have none, so fall back to position in list.
    const blendList = (listA = [], listB = [], k, byId) => listB.map((b, i) => {
        const a = byId ? listA.find(x => x.id === b.id) : listA[i];
        return a ? blendEntity(a, b, k) : b;   // new this frame: nothing to blend from
    });

    return {
        push(snapshot, t) {
            buf.push({ t, s: snapshot });
            while (buf.length > keep) buf.shift();
        },
        get latest() { return buf.length ? buf[buf.length - 1].s : null; },
        get size() { return buf.length; },

        sample(now) {
            if (!buf.length) return null;
            if (buf.length === 1) return buf[0].s;
            const target = now - delayMs;
            if (target <= buf[0].t) return buf[0].s;                       // still filling the buffer

            for (let i = buf.length - 2; i >= 0; i--) {
                const a = buf[i], b = buf[i + 1];
                if (target < a.t || target > b.t) continue;
                const span = b.t - a.t;
                const k = span > 0 ? (target - a.t) / span : 1;
                return {
                    ...b.s,
                    players: blendList(a.s.players, b.s.players, k, true),
                    enemies: blendList(a.s.enemies, b.s.enemies, k, true),
                    consumables: blendList(a.s.consumables, b.s.consumables, k, false)
                };
            }
            // Starved (no snapshot newer than the render clock): hold the newest rather than
            // extrapolate, which would rubber-band when the next one lands.
            return buf[buf.length - 1].s;
        }
    };
}
