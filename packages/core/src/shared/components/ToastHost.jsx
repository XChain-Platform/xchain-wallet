// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ToastHost.module.css';
import { HapticProvider, useHaptic } from '../hooks/useHaptic.js';

const VISIBLE_LIMIT = 3;
const DEFAULT_DURATION_MS = 8000;
const ACTION_MIN_DURATION_MS = 12000;

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
 *   announce: (message: string) => void,
 *   dismissToast: (id: string) => void,
 *   clearToasts: () => void,
 * }} ToastApi
 */

/** @type {React.Context<ToastApi | null>} */
const ToastContext = createContext(null);

/**
 * Mount once at the app root for every shell. Children render exactly once;
 * `<ToastHost>` only adds a fixed viewport at the
 * bottom of its slot.
 */
export function ToastHost({ children }) {
    const [toasts, setToasts] = useState(/** @type {ToastInput[]} */ ([]));
    const [announcement, setAnnouncement] = useState({ id: 0, message: '' });
    const timersRef = useRef(/** @type {Map<string, ReturnType<typeof setTimeout>>} */ (new Map()));
    const haptic = useHaptic();

    const announce = useCallback((message) => {
        if (typeof message !== 'string' || message.length === 0) return;
        setAnnouncement((current) => ({ id: current.id + 1, message }));
    }, []);

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
        const requestedDuration = Number.isFinite(input.durationMs)
            ? Math.max(0, input.durationMs)
            : DEFAULT_DURATION_MS;
        const duration = requestedDuration > 0 && input.actionLabel && input.onAction
            ? Math.max(requestedDuration, ACTION_MIN_DURATION_MS)
            : requestedDuration;
        const record = { ...input, id, durationMs: duration };
        setToasts((prev) => [...prev, record]);
        if (record.variant === 'error') haptic.error();
        else if (record.variant === 'success') haptic.success();
        else haptic.tap();
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

    const api = useMemo(() => ({ showToast, announce, dismissToast, clearToasts }), [
        showToast, announce, dismissToast, clearToasts,
    ]);

    const visibleToasts = toasts.slice(0, VISIBLE_LIMIT);
    const hiddenCount = Math.max(0, toasts.length - visibleToasts.length);

    useEffect(() => {
        const visibleIds = new Set(visibleToasts.map((toast) => toast.id));
        for (const [id, timer] of timersRef.current.entries()) {
            if (!visibleIds.has(id)) {
                clearTimeout(timer);
                timersRef.current.delete(id);
            }
        }
        for (const toast of visibleToasts) {
            if (toast.durationMs <= 0 || timersRef.current.has(toast.id)) continue;
            const timer = setTimeout(() => {
                timersRef.current.delete(toast.id);
                setToasts((prev) => prev.filter((item) => item.id !== toast.id));
            }, toast.durationMs);
            timersRef.current.set(toast.id, timer);
        }
    }, [visibleToasts]);

    return (
        <HapticProvider value={haptic}>
            <ToastContext.Provider value={api}>
                {children}
                <div
                    className={styles.viewport}
                    role="status"
                    aria-label="Notifications"
                    aria-live="polite"
                    aria-atomic="false"
                    aria-relevant="additions text"
                >
                    <span className={styles.liveAnnouncement} key={announcement.id}>
                        {announcement.message}
                    </span>
                    {hiddenCount > 0 ? (
                        <div className={styles.overflowBadge} aria-hidden="true">
                            {`+${hiddenCount} more`}
                        </div>
                    ) : null}
                    {visibleToasts.map((t) => (
                        <ToastItem
                            key={t.id}
                            toast={t}
                            onAction={() => {
                                if (typeof t.onAction === 'function') {
                                    Promise.resolve(t.onAction()).catch(() => {
                                        /* swallow; caller surfaces its own error */
                                    });
                                }
                                dismissToast(t.id);
                            }}
                            onDismiss={() => dismissToast(t.id)}
                        />
                    ))}
                </div>
            </ToastContext.Provider>
        </HapticProvider>
    );
}

function ToastItem({ toast, onAction, onDismiss }) {
    const variant = toast.variant || 'default';
    return (
        <div
            className={`${styles.toast} ${styles[`variant_${variant}`] || ''}`}
            onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss();
            }}
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
 * doesn't crash on a missing provider; production callers always sit
 * inside the host.
 */
export function useToast() {
    const ctx = useContext(ToastContext);
    if (ctx) return ctx;
    return /** @type {ToastApi} */ ({
        showToast: () => '',
        announce: () => {},
        dismissToast: () => {},
        clearToasts: () => {},
    });
}
