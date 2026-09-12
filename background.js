
import { mulberry32 } from './sim/rng.js';
import { createPerlin2D } from './sim/perlin.js';
import { ROCK_PALETTES, drawRockMaterial } from './materials.js';

export class Background {
    constructor(canvas, worldBounds, seed = 1) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.worldBounds = worldBounds;
        this.rocks = [];
        this.parallaxFactor = -0.5; // Adjust this value to control the background movement speed
        this.streaks = [];
        this.grains = [];
        this.dirtCracks = [];
        this.setSeed(seed);
        this.topOverlayColor = 'rgba(0, 0, 0, 0.85)';   // stronger than the old 0.65 (was doubled-up)
        this.bottomGlowColor = 'rgba(255, 215, 0, 0.95)'; // stronger gold glow
    }

    setSeed(seed) {
        // Independent streams keep persistent visual layers stable as each other evolves.
        this.rockRng = mulberry32((seed ^ 0xBAC6B00C) >>> 0);
        this.rockTextureRng = mulberry32((seed ^ 0x7E87A11D) >>> 0);
        this.dirtRng = mulberry32((seed ^ 0xD17A5EED) >>> 0);
        this.grainRng = mulberry32((seed ^ 0x601DFACE) >>> 0);
        this.crackRng = mulberry32((seed ^ 0xC2AC4E57) >>> 0);
        this.dirtNoise = createPerlin2D((seed ^ 0x5045524C) >>> 0);
        this.rockNoise = createPerlin2D((seed ^ 0x524F434B) >>> 0);
        this.rocks.length = 0;
        this.generateRocks();
        this.streaks = this.generateStreaks();
        this.grains = this.generateGrains();
        this.dirtCracks = this.generateDirtCracks();
    }

    drawOverlay(ball) {
        
        let offsetX = 0;
        let offsetY =0;
         offsetX = ball.x * this.parallaxFactor;
         offsetY = ball.y * this.parallaxFactor;
         
        const gradient = this.ctx.createLinearGradient(
            0, this.worldBounds.top - offsetY,
            0, this.worldBounds.bottom - offsetY
        );

        // Add color stops for a smoother gradient
        
        gradient.addColorStop(0, this.topOverlayColor);
        gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
        
        gradient.addColorStop(1, this.bottomGlowColor);

        // Draw the gradient overlay
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(
            this.worldBounds.left - offsetX,
            this.worldBounds.top - offsetY,
            this.worldBounds.right - this.worldBounds.left,
            this.worldBounds.bottom - this.worldBounds.top
        );
    }
   

    generateRocks() {
        const rockCount = 200; // Adjust this for more or fewer rocks
        for (let i = 0; i < rockCount; i++) {
            this.rocks.push(this.createRock());
        }
    }

    generateStreaks() {
        const streakCount = 340;
        const streaks = [];
        for (let i = 0; i < streakCount; i++) {
            const x = this.dirtRng() * this.worldBounds.right;
            const y = this.dirtRng() * this.worldBounds.bottom;
            const noise = this.dirtNoise(x / 520, y / 520);
            streaks.push({
                x, y,
                width: 100 + this.dirtRng() * 340,
                height: 45 + this.dirtRng() * 190,
                angle: noise * 0.8 + this.dirtRng() * 0.25,
                color: this.getRandomEarthTone(this.dirtRng),
                alpha: 0.045 + Math.abs(noise) * 0.07
            });
        }
        return streaks;
    }
    generateGrains() {
        const grains = [];
        for (let i = 0; i < 900; i++) {
            grains.push({
                x: this.grainRng() * this.worldBounds.right,
                y: this.grainRng() * this.worldBounds.bottom,
                r: 1 + this.grainRng() * 4.5,
                light: this.grainRng() > 0.58,
                alpha: 0.035 + this.grainRng() * 0.09
            });
        }
        return grains;
    }
    getRandomEarthTone(rng) {
        const earthTones = [
            '#a66d43', '#75462e', '#bc8050', '#5b3728', '#d0925e',
            '#8c5a38', '#69483a', '#c17a3f', '#4b3027'
        ];
        return earthTones[Math.floor(rng() * earthTones.length)];
    }
    createRock() {
        const rng = this.rockRng;
        const x = rng() * (this.worldBounds.right - this.worldBounds.left) + this.worldBounds.left;
        const y = rng() * (this.worldBounds.bottom - this.worldBounds.top) + this.worldBounds.top;
        const size = rng() * 200 + 50;
        const points = Math.floor(rng() * 3) + 5;

        const rock = {
            x,
            y,
            size,
            points: [],
            palette: ROCK_PALETTES[Math.floor(rng() * ROCK_PALETTES.length)],
            cracks: [],
            flecks: []
        };

        for (let i = 0; i < points; i++) {
            const angle = (Math.PI * 2 * i) / points;
            const radius = size / 2 * (0.8 + rng() * 0.8);
            rock.points.push({
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius
            });
        }

        const textureRng = this.rockTextureRng;
        const fleckCount = 8 + Math.floor(textureRng() * 14);
        for (let i = 0; i < fleckCount; i++) {
            const angle = textureRng() * Math.PI * 2;
            const radius = Math.sqrt(textureRng()) * size * 0.43;
            rock.flecks.push({
                x: x + Math.cos(angle) * radius,
                y: y + Math.sin(angle) * radius,
                r: Math.max(0.8, size * (0.006 + textureRng() * 0.018)),
                angle: textureRng() * Math.PI,
                light: textureRng() > 0.62
            });
        }

        const crackCount = 1 + Math.floor((this.rockNoise(x / 300, y / 300) + 1) * 1.2);
        for (let i = 0; i < crackCount; i++) {
            rock.cracks.push(this.createCrack(
                x + (rng() - 0.5) * size * 0.28,
                y + (rng() - 0.5) * size * 0.28,
                size * (0.18 + rng() * 0.16),
                3 + Math.floor(rng() * 4),
                rng() * Math.PI * 2,
                this.rockNoise,
                rng
            ));
        }

        return rock;
    }

    createCrack(x, y, segmentLength, segments, angle, noise, rng) {
        const points = [{ x, y }];
        for (let i = 0; i < segments; i++) {
            const bend = noise(x / 170 + i * 0.31, y / 170 - i * 0.23) * 0.95;
            angle += bend + (rng() - 0.5) * 0.28;
            const length = segmentLength * (0.55 + rng() * 0.7);
            x += Math.cos(angle) * length;
            y += Math.sin(angle) * length;
            points.push({ x, y });
        }
        return points;
    }

    generateDirtCracks() {
        const cracks = [];
        const count = 150;
        for (let i = 0; i < count; i++) {
            const x = this.crackRng() * this.worldBounds.right;
            const y = this.crackRng() * this.worldBounds.bottom;
            const noise = this.dirtNoise(x / 380, y / 380);
            cracks.push(this.createCrack(
                x, y,
                18 + Math.abs(noise) * 24,
                4 + Math.floor(this.crackRng() * 6),
                this.crackRng() * Math.PI * 2,
                this.dirtNoise,
                this.crackRng
            ));
        }
        return cracks;
    }

    draw(camera) {
        const offsetX = camera.x * this.parallaxFactor;
        const offsetY = camera.y * this.parallaxFactor;

        const dirt = this.ctx.createLinearGradient(
            this.worldBounds.left, this.worldBounds.top,
            this.worldBounds.right * 0.18, this.worldBounds.bottom
        );
        dirt.addColorStop(0, '#684229');
        dirt.addColorStop(0.28, '#513223');
        dirt.addColorStop(0.58, '#412a20');
        dirt.addColorStop(0.82, '#34221c');
        dirt.addColorStop(1, '#241915');
        this.ctx.fillStyle = dirt;
        this.ctx.fillRect(camera.x, camera.y, this.canvas.width, this.canvas.height);

        const visible = (x, y, radius) =>
            x - offsetX + radius >= camera.x && x - offsetX - radius <= camera.x + this.canvas.width &&
            y - offsetY + radius >= camera.y && y - offsetY - radius <= camera.y + this.canvas.height;

        // ponytail: 600 cheap visibility checks per frame avoid both the blurry scaled
        // bitmap and its old ~75MB full-resolution replacement. Add a grid only if this
        // count grows enough to show up in a profiler.
        this.ctx.save();
        this.ctx.translate(-offsetX, -offsetY);
        for (const streak of this.streaks) {
            const radius = Math.hypot(streak.width, streak.height) / 2;
            if (!visible(streak.x, streak.y, radius)) continue;
            this.ctx.save();
            this.ctx.translate(streak.x, streak.y);
            this.ctx.rotate(streak.angle);
            this.ctx.globalAlpha = streak.alpha;
            this.ctx.fillStyle = streak.color;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, streak.width / 2, streak.height / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
        for (const grain of this.grains) {
            if (!visible(grain.x, grain.y, grain.r)) continue;
            this.ctx.globalAlpha = grain.alpha;
            this.ctx.fillStyle = grain.light ? '#d39a68' : '#1d120e';
            this.ctx.beginPath();
            this.ctx.arc(grain.x, grain.y, grain.r, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.globalAlpha = 1;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        for (const crack of this.dirtCracks) {
            const start = crack[0];
            if (!visible(start.x, start.y, 180)) continue;
            this.ctx.beginPath();
            this.ctx.moveTo(start.x, start.y);
            for (let i = 1; i < crack.length; i++) this.ctx.lineTo(crack[i].x, crack[i].y);
            this.ctx.strokeStyle = 'rgba(18,11,8,0.34)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.strokeStyle = 'rgba(135,91,58,0.08)';
            this.ctx.lineWidth = 0.75;
            this.ctx.stroke();
        }
        for (const rock of this.rocks) {
            if (!visible(rock.x, rock.y, rock.size)) continue;
            drawRockMaterial(this.ctx, rock);
        }
        this.ctx.restore();

        this.drawOverlay(camera);
    }
}
