// One keyboard/mouse reader for every scene. Scenes used to each attach their own five window
// listeners and never remove them; this owns them once and hands back a dispose().
// lock() makes read() report "no input" without dropping the listeners, which is what a cutscene
// or a spectating (dead) player needs.
const JUMP_KEYS = new Set([' ', 'w', 'arrowup']);
const IDLE = { keys: [], shooting: false, jump: false };

export function createInput({ onKey = null } = {}) {
    const keys = new Set();
    let shooting = false, jumpQueued = false, locked = false;

    const onKeyDown = e => {
        const k = e.key.toLowerCase();
        if (onKey?.(k, e) === false) return;   // scene consumed it (text entry, menus)
        if (locked) return;
        keys.add(k);
        if (JUMP_KEYS.has(k)) { jumpQueued = true; e.preventDefault(); }
    };
    const onKeyUp = e => keys.delete(e.key.toLowerCase());
    const onMouseDown = e => { if (e.button === 0 && !locked) shooting = true; };
    const onMouseUp = e => { if (e.button === 0) shooting = false; };
    const clear = () => { keys.clear(); shooting = false; jumpQueued = false; };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', clear);

    return {
        // Consumes the queued jump edge, so call once per tick.
        read() {
            if (locked) return IDLE;
            const out = { keys: [...keys], shooting, jump: jumpQueued };
            jumpQueued = false;
            return out;
        },
        lock() { locked = true; clear(); },
        unlock() { locked = false; },
        get locked() { return locked; },
        dispose() {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', clear);
        }
    };
}
