const exhibit = document.querySelector('.exhibit');
const viewport = document.querySelector('.viewport');
const camera = document.querySelector('.camera');
const vanes = document.querySelector('.vanes');

const nativeSiblings = CSS.supports('z-index', 'sibling-index()') &&
                       CSS.supports('z-index', 'sibling-count()');
const densities = [64, 40, 80, 52];
let density = 0;
let pitch = 46;
let yaw = -24;
let gesture = null;
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;

function updateCamera() {
    camera.style.setProperty('--pitch', `${pitch}deg`);
    camera.style.setProperty('--yaw', `${yaw}deg`);
}

function compose(count) {
    // Keep existing elements alive so their motion does not restart.
    while (vanes.childElementCount > count) {
        vanes.lastElementChild.remove();
    }

    const fragment = document.createDocumentFragment();
    for (let i = vanes.childElementCount; i < count; i++) {
        const vane = document.createElement('div');
        vane.className = 'vane';
        const blade = document.createElement('div');
        blade.className = 'blade';
        vane.append(blade);
        fragment.append(vane);
    }
    vanes.append(fragment);

    // Older browsers only. On modern browsers CSS counts the DOM itself.
    if (!nativeSiblings) {
        Array.from(vanes.children).forEach((vane, i) => {
            vane.style.setProperty('--i', i);
            vane.style.setProperty('--n', count);
        });
    }

}

function recompose() {
    density = (density + 1) % densities.length;
    compose(densities[density]);
}

function updatePlayback() {
    exhibit.toggleAttribute('data-paused', paused);
}

viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pitch,
        yaw,
        moved: false
    };
    viewport.setPointerCapture(event.pointerId);
});

viewport.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
    gesture.moved = true;
    yaw = gesture.yaw + dx * .35;
    pitch = Math.max(12, Math.min(82, gesture.pitch - dy * .25));
    updateCamera();
});

viewport.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!gesture.moved) recompose();
    gesture = null;
});

viewport.addEventListener('lostpointercapture', () => { gesture = null; });
viewport.addEventListener('pointercancel', () => { gesture = null; });

window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    switch (event.key) {
        case ' ':
            event.preventDefault();
            paused = !paused;
            updatePlayback();
            break;
        case 'Enter':
            recompose();
            break;
        case 'ArrowLeft': yaw -= 8; break;
        case 'ArrowRight': yaw += 8; break;
        case 'ArrowUp': pitch = Math.max(12, pitch - 5); break;
        case 'ArrowDown': pitch = Math.min(82, pitch + 5); break;
        default: return;
    }
    if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        updateCamera();
    }
});

compose(densities[density]);
updateCamera();
updatePlayback();