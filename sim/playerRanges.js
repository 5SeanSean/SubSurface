// Reusable adjustable player ranges. A definition maps one normalized value (-1..1) to
// presentation and mechanics, keeping input, rendering, cost, and damage on one source of truth.
export const SHOT_RANGE = Object.freeze({
    key: 'shotRange',
    min: -1,
    max: 1,
    initial: 0,
    unitsPerSecond: 0.8,
    lowColor: [128, 0, 128],   // purple
    highColor: [0, 255, 0],    // green
    maxColorMix: 0.5,
    lowScale: 0.6,
    highScale: 1.5
});

export const clampRange = (definition, value) =>
    Math.max(definition.min, Math.min(definition.max, Number.isFinite(value) ? value : definition.initial));

export function adjustRange(definition, value, direction, dtMs) {
    return clampRange(definition, value + Math.sign(direction) * definition.unitsPerSecond * dtMs / 1000);
}

const mix = (a, b, amount) => Math.round(a + (b - a) * amount);

export function sampleRange(definition, value) {
    const normalized = clampRange(definition, value);
    const amount = Math.abs(normalized);
    const endpoint = normalized < 0 ? definition.lowColor : definition.highColor;
    const colorMix = amount * definition.maxColorMix;
    const color = `rgb(${mix(255, endpoint[0], colorMix)}, ${mix(255, endpoint[1], colorMix)}, ${mix(255, endpoint[2], colorMix)})`;
    const scale = normalized < 0
        ? 1 + (1 - definition.lowScale) * normalized
        : 1 + (definition.highScale - 1) * normalized;
    return { normalized, color, scale };
}

// Radius changes are calculated as area (without the common PI factor).
export function removeArea(radius, area) {
    return Math.sqrt(Math.max(0, radius * radius - Math.max(0, area)));
}

export function shotProfile(ball) {
    const range = sampleRange(SHOT_RANGE, ball.shotRange);
    const projectileRadius = ball.radius / 6 * range.scale;
    const area = projectileRadius * projectileRadius;
    return {
        ...range,
        projectileRadius,
        // Shooting is deliberately lossy: firing costs more mass than the projectile carries.
        areaCost: area * 1.5,
        playerDamage: area,
        enemyDamage: area / 400,
        // Compact purple shots trade reach/size for cadence; wide green shots do the reverse.
        cooldownMs: ball.fireRate * range.scale
    };
}
