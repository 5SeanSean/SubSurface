// The ONE name control, shown top-right whenever a name is stored. It is universal: it survives
// scene swaps because it lives in the page, not in any scene. Click it to rename in place.
// A rename dispatches a cancellable-ish 'namechange' event carrying a revert(): the active
// lobby scene sends it to the server and, if the server rejects it (name taken), calls revert().
const NAME_RE = /^[A-Za-z0-9 _-]{2,16}$/;
export const storedName = () => (localStorage.getItem('subsurfaceName') || '').trim();

// Store a name and let the badge redraw. Used by the name-entry form on first connect; a plain
// save, not a rename round-trip.
export function saveName(name) {
    localStorage.setItem('subsurfaceName', name);
    window.dispatchEvent(new CustomEvent('name-saved'));
}

export function createNameBadge() {
    const el = document.createElement('div');
    el.className = 'name-badge';
    const label = document.createElement('span');
    label.className = 'name-badge-label';
    const input = document.createElement('input');
    input.className = 'name-badge-input';
    input.maxLength = 16;
    input.hidden = true;
    el.append(label, input);
    document.body.appendChild(el);

    let editing = false;
    const render = () => {
        const n = storedName();
        el.hidden = !n && !editing;
        label.textContent = n || '';
        label.hidden = editing;
        input.hidden = !editing;
    };
    const startEdit = () => {
        editing = true;
        input.value = storedName();
        render();
        input.focus();
        input.select();
    };
    const commit = () => {
        if (!editing) return;
        const v = input.value.trim();
        editing = false;
        if (NAME_RE.test(v) && v !== storedName()) {
            const prev = storedName();
            localStorage.setItem('subsurfaceName', v);
            window.dispatchEvent(new CustomEvent('namechange', {
                detail: { name: v, revert: () => { localStorage.setItem('subsurfaceName', prev); render(); } }
            }));
        }
        render();
    };

    label.addEventListener('click', startEdit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { editing = false; render(); }
    });
    window.addEventListener('name-saved', render);
    render();
    return { refresh: render };
}
