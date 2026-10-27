/**
 * DEV ONLY: pan/zoom frame-time probe for the preview. Paste/eval in the page:
 *   import('/Stfork/dev/ui-a/perf.js').then((m) => m.probe())
 * Drags the map with synthetic pointer events for ~2 s (one move per frame),
 * then wheel-zooms, and reports rAF frame intervals (median / p95 / max, ms).
 */
export async function probe({ frames = 120 } = {}) {
    const svg = document.querySelector('.hoi-map__svg');
    const r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const opts = (x, y) => ({ bubbles: true, pointerId: 11, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y });
    const nextFrame = () => new Promise((res) => requestAnimationFrame(res));
    const stats = (arr) => {
        const s = arr.slice().sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        return { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) };
    };

    svg.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
    let last = await nextFrame();
    const pan = [];
    for (let i = 0; i < frames; i++) {
        const t = i / frames;
        svg.dispatchEvent(new PointerEvent('pointermove', opts(cx + Math.sin(t * Math.PI * 2) * 300, cy + Math.cos(t * Math.PI * 2) * 120)));
        const now = await nextFrame();
        pan.push(now - last);
        last = now;
    }
    svg.dispatchEvent(new PointerEvent('pointerup', opts(cx, cy)));

    const zoom = [];
    last = await nextFrame();
    for (let i = 0; i < 60; i++) {
        svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: i < 30 ? -40 : 40, clientX: cx + 100, clientY: cy - 50 }));
        const now = await nextFrame();
        zoom.push(now - last);
        last = now;
    }
    return { paths: document.querySelectorAll('.hoi-map__c').length, pan: stats(pan), zoom: stats(zoom) };
}
