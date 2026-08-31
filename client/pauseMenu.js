// Esc overlay shared by the solo and multiplayer scenes. Esc opens it; Esc again backs out of
// it. Entries are clicked with the mouse, the same way everything else in this game is chosen.
// While it is open the scene locks input, so the ball doesn't keep playing behind the overlay.
const ITEM_H = 62, GAP = 14;

export function createPauseMenu(stage, items, { title = 'Paused' } = {}) {
    let open = false;

    // Laid out from the middle of the screen, so it follows resizes for free.
    function rects() {
        const W = stage.canvas.width, H = stage.canvas.height;
        const w = Math.min(420, W * 0.8);   // never wider than the viewport
        const total = items.length * ITEM_H + (items.length - 1) * GAP;
        const top = H / 2 - total / 2;
        return items.map((item, i) => ({
            x: W / 2 - w / 2, y: top + i * (ITEM_H + GAP), w, h: ITEM_H, item
        }));
    }
    const hit = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

    return {
        get open() { return open; },
        toggle() { open = !open; return open; },
        close() { open = false; },

        // Returns true when the click was consumed by the overlay.
        click() {
            if (!open) return false;
            const r = rects().find(r => hit(r, stage.pointer));
            if (r) { open = false; r.item.action(); }
            return true;
        },

        draw(ctx) {
            if (!open) return;
            const W = stage.canvas.width, H = stage.canvas.height;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, W, H);

            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'white';
            ctx.font = `${Math.min(64, W * 0.09)}px 'boxycool', sans-serif`;
            ctx.fillText(title, W / 2, rects()[0].y - 70);

            for (const r of rects()) {
                const hot = hit(r, stage.pointer);
                if (hot) { ctx.shadowColor = 'white'; ctx.shadowBlur = 30; } else { ctx.shadowBlur = 0; }
                ctx.fillStyle = hot ? 'white' : 'rgba(255,255,255,0.12)';
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'white'; ctx.lineWidth = 3;
                ctx.strokeRect(r.x, r.y, r.w, r.h);
                ctx.fillStyle = hot ? 'black' : 'white';
                ctx.font = `28px 'boxycool', sans-serif`;
                ctx.fillText(r.item.label, r.x + r.w / 2, r.y + r.h / 2);
            }

            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = `20px 'boxycool', sans-serif`;
            ctx.fillText('Esc to go back', W / 2, H - 40);

            // Invert the reticle over buttons so it remains visible over either hover colour.
            const buttonHot = rects().some(r => hit(r, stage.pointer));
            if (buttonHot) {
                ctx.globalCompositeOperation = 'difference';
                ctx.shadowBlur = 0;
            }
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(stage.pointer.x, stage.pointer.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    };
}
