// Variant resolution for the web shell.
//
// Variant follows AVAILABLE WIDTH, not container type:
//   < THRESHOLD_PX  → `small`  (mobile portrait, narrow desktop window,
//                                Chrome extension popup, future native
//                                app with constrained width — anything
//                                where horizontal space is at a premium)
//   ≥ THRESHOLD_PX  → `full`   (desktop browsers, tablets in landscape,
//                                extension full-screen mode)
//
// Designers can pin a variant via `?variant=small|full` (URL) or via
// the dev badge (which writes localStorage). The hook also exposes
// the *source* so the badge can show whether the user is in auto
// mode or has forced an override.
//
// 640px threshold — every common phone in portrait sits below; every
// tablet in landscape and every desktop window the user is likely to
// keep open sits above. Tweakable in one place.

import { useEffect, useState } from 'react';

export const THRESHOLD_PX = 640;
const STORAGE_KEY = 'xc.devVariant';

function normalize(v) {
    if (v === 'small' || v === 'full' || v === 'sidebar') return v;
    if (v === 'popup') return 'small';   // legacy alias
    return null;
}

function readUrlOverride() {
    if (typeof window === 'undefined') return null;
    return normalize(new URL(window.location.href).searchParams.get('variant'));
}

function readStorageOverride() {
    if (typeof window === 'undefined') return null;
    try { return normalize(window.localStorage.getItem(STORAGE_KEY)); }
    catch { return null; }
}

function viewportPx() {
    if (typeof window === 'undefined') return THRESHOLD_PX;
    return window.innerWidth || document.documentElement.clientWidth || THRESHOLD_PX;
}

function autoVariant() {
    return viewportPx() < THRESHOLD_PX ? 'small' : 'full';
}

/**
 * @returns {{ variant: 'small' | 'full' | 'sidebar', source: 'url' | 'storage' | 'auto', viewportPx: number }}
 */
export function resolveVariant() {
    const url = readUrlOverride();
    if (url) return { variant: url, source: 'url', viewportPx: viewportPx() };
    const stored = readStorageOverride();
    if (stored) return { variant: stored, source: 'storage', viewportPx: viewportPx() };
    return { variant: autoVariant(), source: 'auto', viewportPx: viewportPx() };
}

/**
 * Persist a chosen variant + reload. Reload ensures the override
 * applies cleanly across bootstrap (SDK resolution, MessagingProvider
 * mount, frame wrapper, etc.).
 */
export function setActiveVariant(variant) {
    if (typeof window === 'undefined') return;
    const v = normalize(variant);
    if (!v) return;
    try { window.localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v);
    window.location.replace(url.toString());
}

/**
 * Clear any override (URL + storage) and return to auto-by-width.
 * Reloads so the rest of the bootstrap sees the cleared state.
 */
export function clearVariantOverride() {
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.delete('variant');
    window.location.replace(url.toString());
}

/**
 * Live hook: variant updates as the viewport resizes (rAF-debounced) so
 * a user dragging a desktop window from wide → narrow flips to small
 * mid-session, no reload needed. Overrides freeze the variant until
 * cleared.
 */
export function useActiveVariant() {
    const [state, setState] = useState(resolveVariant);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let frame = 0;
        const onResize = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setState(resolveVariant()));
        };
        window.addEventListener('resize', onResize);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', onResize);
        };
    }, []);
    return state;
}

/**
 * Map the active variant to the shell value `<MessagingProvider>` expects.
 * `full` → `web`; `small` and `sidebar` → `popup` (both are narrow
 * surfaces; the small-viewport behaviour set applies — auto-lock,
 * pancake-only nav, etc.).
 */
export function shellForVariant(variant) {
    return variant === 'full' ? 'web' : 'popup';
}
