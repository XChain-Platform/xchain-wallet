import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ToastHost.module.css';
import { useHaptic } from '../hooks/useHaptic.js';

// §37.2 toast foundation. A single shared host renders an action queue
// at the bottom of the screen; any route can drop a toast via the
// `useToast()` hook. Toasts auto-dismiss after `durationMs` (default
// 8 s per spec) unless the user clicks the optional action button —
// typically Undo, but the API is generic enough to also surface "Open
// site" or "Retry" as later integrations land.
//
// The host is a context provider so the queue lives above route
// re-renders: a toast survives navigation back to Home from the form
// that triggered it (the user might dismiss the source surface and we
// still owe them the Undo affordance).

/**
 * @typedef {{
 *   id: string,
 *   message: string,
 *   actionLabel?: string,
 *   onAction?: () => void | Promise<void>,
 *   durationMs?: number,
 *   variant?: 'default' | 'success' | 'error',
 * }} ToastInput
 */

/**
 * @typedef {{
 *   showToast: (toast: ToastInput) => string,
 *   dismissToast: (id: string) => void,
 *   clearToasts: () => void,
 * }} ToastApi
 */

/** @type {React.Context<ToastApi | null>} */
const ToastContext = createContext(null);

/**
 * Mount once at the app root (web + extension App.jsx wrap their
 * unlocked tree in `<ToastHost>`). Children render exactly once;
 * `<ToastHost>` only adds an absolutely-positioned viewport at the
 * bottom of its slot.
 */
export function ToastHost({ children }) {
    const [toasts, setToasts] = useState(/** @type {ToastInput[]} */ ([]));
    const timersRef = useRef(/** @type {Map<string, ReturnType<typeof setTimeout>>} */ (new Map()));
    const haptic = useHaptic();

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        const timer = timersRef.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(id);
        }
    }, []);

    const showToast = useCallback(/** @param {ToastInput} input */ (input) => {
        const id = input.id || `toast-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const duration = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 8000;
        const record = { ...input, id, durationMs: duration };
        setToasts((prev) => [...prev, record]);
        // §37.3 — fire a haptic pulse keyed to the toast variant. The
        // hook silently no-ops on non-vibration hosts and on
        // prefers-reduced-motion, so this is safe everywhere.
        if (record.variant === 'error') haptic.error();
        else if (record.variant === 'success') haptic.success();
        else haptic.tap();
        if (duration > 0) {
            const timer = setTimeout(() => {
                timersRef.current.delete(id);
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, duration);
            timersRef.current.set(id, timer);
        }
        return id;
    }, [haptic]);

    const clearToasts = useCallback(() => {
        for (const timer of timersRef.current.values()) clearTimeout(timer);
        timersRef.current.clear();
        setToasts([]);
    }, []);

    useEffect(() => () => {
        for (const timer of timersRef.current.values()) clearTimeout(timer);
        timersRef.current.clear();
    }, []);

    const api = useMemo(() => ({ showToast, dismissToast, clearToasts }), [
        showToast, dismissToast, clearToasts,
    ]);

    return (
        <ToastContext.Provider value={api}>
            {children}
            <div
                className={styles.viewport}
                role="region"
                aria-label="Notifications"
                aria-live="polite"
            >
                {toasts.map((t) => (
                    <ToastItem
                        key={t.id}
                        toast={t}
                        onAction={() => {
                            if (typeof t.onAction === 'function') {
                                Promise.resolve(t.onAction()).catch(() => {
                                    /* swallow — caller surfaces its own error */
                                });
                            }
                            dismissToast(t.id);
                        }}
                        onDismiss={() => dismissToast(t.id)}
                    />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onAction, onDismiss }) {
    const variant = toast.variant || 'default';
    return (
        <div
            className={`${styles.toast} ${styles[`variant_${variant}`] || ''}`}
            role={variant === 'error' ? 'alert' : 'status'}
        >
            <span className={styles.message}>{toast.message}</span>
            <div className={styles.controls}>
                {toast.actionLabel && toast.onAction ? (
                    <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={onAction}
                    >
                        {toast.actionLabel}
                    </button>
                ) : null}
                <button
                    type="button"
                    className={styles.dismissBtn}
                    onClick={onDismiss}
                    aria-label="Dismiss notification"
                >
                    ×
                </button>
            </div>
        </div>
    );
}

/**
 * Hook for routes / components that want to surface a toast. Falls back
 * to a no-op API when used outside `<ToastHost>` so a stray test
 * doesn't crash on a missing provider — production callers always sit
 * inside the host.
 */
export function useToast() {
    const ctx = useContext(ToastContext);
    if (ctx) return ctx;
    return /** @type {ToastApi} */ ({
        showToast: () => '',
        dismissToast: () => {},
        clearToasts: () => {},
    });
}
