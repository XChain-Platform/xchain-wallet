// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Variant resolution for the web shell.
//
// Variant follows AVAILABLE WIDTH, not container type:
//   < THRESHOLD_PX  → `small`  (mobile portrait, narrow desktop window,
//                                Chrome extension popup, future native
//                                app with constrained width, or anything
//                                where horizontal space is at a premium)
//   ≥ THRESHOLD_PX  → `full`   (desktop browsers, tablets in landscape,
//                                extension full-screen mode)
//
// Designers can pin a variant for ONE navigation via `?variant=…`, which
// is also what the dev badge writes. The hook exposes the *source* so the
// badge can show whether the user is in auto mode or has forced an
// override.
//
// 640px threshold: every common phone in portrait sits below; every
// tablet in landscape and every desktop window the user is likely to
// keep open sits above.
//
// : the number itself is no longer defined here. It is the shell's
// `rail` breakpoint, and it lives in core's shared/styles/breakpoints.js
// alongside the other tier boundaries so a move stays in one place.
//
// : THE URL IS THE ONLY OVERRIDE CHANNEL. This used to fall back to
// a `localStorage` copy, and that copy is what made the web wallet render
// at extension-popup width on a 1489px desktop: `sidebar` and `extension`
// pin a fixed 375/360px preview frame (DevVariantShell.module.css), the
// stored value outlived the session that opted into it, and it survived a
// hard reload, so a wide window drew a popup-sized column against an empty
// page with no visible way back. An override the user cannot see and
// cannot clear is indistinguishable from a broken app, and this app is the
// public download page's primary call to action. A URL parameter cannot
// trap anyone: it is visible, it is per-navigation, and reloading the bare
// origin returns the shell to auto-by-width.

import { useEffect, useState } from 'react';
import { TIER_RAIL_MIN_PX } from '@xchain-wallet/core/shared/styles/breakpoints.js';

export const THRESHOLD_PX = TIER_RAIL_MIN_PX;

/** Legacy key. Nothing writes it any more; `purgeStoredVariantOverride` clears it. */
export const STORAGE_KEY = 'xc.devVariant';

function normalize(v) {
    if (v === 'small' || v === 'full' || v === 'sidebar' || v === 'extension') return v;
    if (v === 'popup') return 'extension';   // legacy alias; popup now means the chrome-extension dropdown
    return null;
}

function readUrlOverride() {
    if (typeof window === 'undefined') return null;
    return normalize(new URL(window.location.href).searchParams.get('variant'));
}

/**
 * Erase a stored override left behind by an older build.
 *
 * Erase, not ignore: a browser already carrying `sidebar` recovers on its
 * next load without the user ever learning the words "local storage"
 * . Idempotent and safe where storage is unavailable.
 *
 * @returns {boolean} whether a stored override was found and removed
 */
export function purgeStoredVariantOverride() {
    if (typeof window === 'undefined') return false;
    try {
        if (window.localStorage.getItem(STORAGE_KEY) === null) return false;
        window.localStorage.removeItem(STORAGE_KEY);
        return true;
    } catch { return false; }
}

function viewportPx() {
    if (typeof window === 'undefined') return THRESHOLD_PX;
    return window.innerWidth || document.documentElement.clientWidth || THRESHOLD_PX;
}

function autoVariant() {
    return viewportPx() < THRESHOLD_PX ? 'small' : 'full';
}

/**
 * The variant this navigation runs in.
 *
 * Two sources only: the `variant` query parameter, and the viewport. A
 * stored override is not a source (see the  note in the header); it
 * is swept on the way past so a trapped browser heals itself.
 *
 * @returns {{ variant: 'small' | 'full' | 'sidebar' | 'extension', source: 'url' | 'auto', viewportPx: number }}
 */
export function resolveVariant() {
    purgeStoredVariantOverride();
    const url = readUrlOverride();
    if (url) return { variant: url, source: 'url', viewportPx: viewportPx() };
    return { variant: autoVariant(), source: 'auto', viewportPx: viewportPx() };
}

/**
 * Pin a variant for this navigation + reload.
 *
 * The parameter travels in the URL, which is the whole persistence
 * mechanism: it survives the reload the badge needs, it is visible in the
 * address bar, and it is gone the moment the user opens the bare origin.
 * Reloading (rather than re-rendering) keeps the bootstrap coherent: SDK
 * resolution, MessagingProvider mount and the frame wrapper all read the
 * variant once, at start.
 */
export function setActiveVariant(variant) {
    if (typeof window === 'undefined') return;
    const v = normalize(variant);
    if (!v) return;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', v);
    window.location.replace(url.toString());
}

/**
 * Clear any override (URL + a legacy stored one) and return to
 * auto-by-width. Reloads so the rest of the bootstrap sees the cleared
 * state.
 */
export function clearVariantOverride() {
    if (typeof window === 'undefined') return;
    purgeStoredVariantOverride();
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
 * surfaces; the small-viewport behaviour set applies (auto-lock,
 * pancake-only nav, etc.).
 */
export function shellForVariant(variant) {
    return variant === 'full' ? 'web' : 'popup';
}
