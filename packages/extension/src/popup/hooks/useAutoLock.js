import { useEffect, useRef } from 'react';

/**
 * Foreground auto-lock timer — §26.
 *
 * Calls `onLock()` after `idleMs` milliseconds of no user activity while
 * the popup is open. Activity is any of: mousemove, keydown, scroll,
 * click, touchstart. The timer ticks every `tickMs` (default 30s) so a
 * precise idle measurement isn't needed — one tick past the threshold
 * is acceptable.
 *
 * Scope note: this is strictly a foreground hook. It doesn't auto-lock
 * while the popup is closed. Spec §26 envisions a background-mediated
 * lock that honours the timeout even across popup close/open — that
 * requires persisting a `lastActivity` stamp the service worker reads
 * on startup, and lands in a later piece.
 *
 * @param {() => void} onLock
 * @param {object} [opts]
 * @param {number} [opts.idleMs]   default 5 minutes
 * @param {number} [opts.tickMs]   default 30 seconds
 * @param {boolean} [opts.enabled] default true
 */
export function useAutoLock(
    onLock,
    { idleMs = 5 * 60 * 1000, tickMs = 30 * 1000, enabled = true } = {},
) {
    const lastActivity = useRef(Date.now());
    const onLockRef = useRef(onLock);
    onLockRef.current = onLock;

    useEffect(() => {
        if (!enabled) return undefined;
        const bump = () => { lastActivity.current = Date.now(); };
        const events = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
        for (const ev of events) {
            window.addEventListener(ev, bump, { passive: true });
        }
        let cancelled = false;
        const tick = () => {
            if (cancelled) return;
            if (Date.now() - lastActivity.current >= idleMs) {
                try { onLockRef.current?.(); } catch (_err) { /* ignore */ }
                return; // stop the loop — the parent re-renders a new route
            }
            window.setTimeout(tick, tickMs);
        };
        const handle = window.setTimeout(tick, tickMs);
        return () => {
            cancelled = true;
            clearTimeout(handle);
            for (const ev of events) window.removeEventListener(ev, bump);
        };
    }, [enabled, idleMs, tickMs]);
}
