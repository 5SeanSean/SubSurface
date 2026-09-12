import { mulberry32 } from './rng.js';

// Deterministic 2D Perlin noise. Each caller owns an independent permutation table, so adding
// samples to one visual system cannot perturb any other seeded generator.
export function createPerlin2D(seed) {
    const rng = mulberry32(seed >>> 0);
    const permutation = Array.from({ length: 256 }, (_, i) => i);
    for (let i = permutation.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
    }
    const p = new Uint16Array(512);
    for (let i = 0; i < p.length; i++) p[i] = permutation[i & 255];

    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    const gradient = (hash, x, y) => {
        switch (hash & 7) {
            case 0: return x + y;
            case 1: return -x + y;
            case 2: return x - y;
            case 3: return -x - y;
            case 4: return x;
            case 5: return -x;
            case 6: return y;
            default: return -y;
        }
    };

    return (x, y) => {
        const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = fade(xf), v = fade(yf);
        const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1];
        const ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
        const value = lerp(
            lerp(gradient(aa, xf, yf), gradient(ba, xf - 1, yf), u),
            lerp(gradient(ab, xf, yf - 1), gradient(bb, xf - 1, yf - 1), u),
            v
        );
        return Math.max(-1, Math.min(1, value * 0.72));
    };
}
