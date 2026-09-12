export const ROCK_PALETTES = Object.freeze([
    Object.freeze(['#705b4c', '#4d3e35', '#29221f']),
    Object.freeze(['#756256', '#50443e', '#2b2524']),
    Object.freeze(['#66584c', '#463c34', '#25211e']),
    Object.freeze(['#79604a', '#554130', '#2c241e']),
    Object.freeze(['#625553', '#443a3b', '#252123'])
]);

const tracePolygon = (ctx, points) => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
};

export function drawRockMaterial(ctx, rock) {
    const palette = rock.palette || ROCK_PALETTES[0];
    ctx.save();
    tracePolygon(ctx, rock.points);
    const body = ctx.createLinearGradient(
        rock.x - rock.size * 0.45, rock.y - rock.size * 0.55,
        rock.x + rock.size * 0.4, rock.y + rock.size * 0.55
    );
    body.addColorStop(0, palette[0]);
    body.addColorStop(0.5, palette[1]);
    body.addColorStop(1, palette[2]);
    ctx.fillStyle = body;
    ctx.fill();

    tracePolygon(ctx, rock.points);
    ctx.clip();
    const glint = ctx.createRadialGradient(
        rock.x - rock.size * 0.22, rock.y - rock.size * 0.28, 0,
        rock.x - rock.size * 0.1, rock.y - rock.size * 0.12, rock.size * 0.7
    );
    glint.addColorStop(0, 'rgba(255,222,185,0.11)');
    glint.addColorStop(0.45, 'rgba(164,121,86,0.03)');
    glint.addColorStop(1, 'rgba(20,12,9,0.22)');
    ctx.fillStyle = glint;
    ctx.fillRect(rock.x - rock.size, rock.y - rock.size, rock.size * 2, rock.size * 2);
    for (const fleck of rock.flecks || []) {
        ctx.fillStyle = fleck.light ? 'rgba(226,183,135,0.13)' : 'rgba(27,18,14,0.22)';
        ctx.beginPath();
        ctx.ellipse(fleck.x, fleck.y, fleck.r * 1.8, fleck.r, fleck.angle, 0, Math.PI * 2);
        ctx.fill();
    }
    if (rock.cracks?.length) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const crack of rock.cracks) {
            ctx.beginPath();
            ctx.moveTo(crack[0].x, crack[0].y);
            for (let i = 1; i < crack.length; i++) ctx.lineTo(crack[i].x, crack[i].y);
            ctx.strokeStyle = 'rgba(18,11,9,0.52)';
            ctx.lineWidth = Math.max(1, rock.size * 0.014);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(205,158,113,0.12)';
            ctx.lineWidth = Math.max(0.5, rock.size * 0.004);
            ctx.stroke();
        }
    }
    ctx.restore();

    ctx.save();
    tracePolygon(ctx, rock.points);
    ctx.strokeStyle = 'rgba(210,166,125,0.16)';
    ctx.lineWidth = Math.max(1, rock.size * 0.008);
    ctx.stroke();
    ctx.restore();
}

export function drawPlatformMaterial(ctx, platform) {
    const damaged = platform.color === 'grey' || platform.color === '#808080';
    const top = damaged ? '#aaa6a1' : '#ddd9d2';
    const middle = damaged ? '#817d78' : '#b9b5ae';
    const bottom = damaged ? '#54504d' : '#85817c';
    const { x, y, width, height } = platform;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const body = ctx.createLinearGradient(x, y, x + width * 0.22, y + height);
    body.addColorStop(0, top);
    body.addColorStop(0.5, middle);
    body.addColorStop(1, bottom);
    ctx.fillStyle = body;
    ctx.fillRect(x, y, width, height);

    const sheen = ctx.createLinearGradient(x, y, x + width, y);
    sheen.addColorStop(0, 'rgba(255,248,235,0.18)');
    sheen.addColorStop(0.55, 'rgba(139,119,101,0.035)');
    sheen.addColorStop(1, 'rgba(35,27,23,0.18)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, width, height);

    // The same mineral inclusions and thin veins used by the large background rocks, clipped
    // into the platform silhouette so these read as slabs of the same stone.
    for (const fleck of platform.materialFlecks || []) {
        ctx.fillStyle = fleck.light ? 'rgba(255,240,215,0.32)' : 'rgba(70,57,49,0.23)';
        ctx.beginPath();
        ctx.ellipse(x + fleck.x, y + fleck.y, fleck.rx, fleck.ry, fleck.angle, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const vein of platform.materialVeins || []) {
        ctx.beginPath();
        ctx.moveTo(x + vein[0].x, y + vein[0].y);
        for (let i = 1; i < vein.length; i++) ctx.lineTo(x + vein[i].x, y + vein[i].y);
        ctx.strokeStyle = 'rgba(64,51,44,0.20)';
        ctx.lineWidth = Math.max(0.75, Math.min(2, height * 0.045));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(244,225,200,0.14)';
        ctx.lineWidth = Math.max(0.4, Math.min(0.8, height * 0.018));
        ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = damaged ? 'rgba(230,220,210,0.20)' : 'rgba(255,247,232,0.36)';
    ctx.fillRect(x, y, width, Math.max(1, Math.min(2, height * 0.08)));
    ctx.fillStyle = damaged ? '#45413e' : '#625d59';
    ctx.fillRect(x, y + height - 2, width, 2);
}
