// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Reduced-motion resolution.
//
// Two inputs decide whether motion is reduced:
//
//   1. the OS preference, `prefers-reduced-motion: reduce`
//   2. Settings > Appearance > Reduced motion, stamped on <html> by
//      useSettingsRootAttributes as `data-xc-reduced-motion`:
//        (absent)         follow the OS      (setting value `auto`)
//        "reduce"         force reduce       (setting value `always`)
//        "no-preference"  ignore the OS      (setting value `never`)
//
// The override is the entire point of the setting: "Always reduce" exists
// for a user whose OS does not advertise the preference, so a consumer that
// reads `window.matchMedia` directly can never honour it. Every JS-driven
// animation (QR frame auto-advance, carousel autoplay, haptic pulses) reads
// the resolved value from here; CSS reads the same attribute in tokens.css.

import { useEffect, useState } from 'react';

export const REDUCED_MOTION_ATTR = 'data-xc-reduced-motion';
const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/** The OS preference alone, with no user override applied. */
export function osPrefersReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
        return window.matchMedia(MEDIA_QUERY).matches;
    } catch {
        return false;
    }
}

function overrideValue() {
    if (typeof document === 'undefined') return null;
    const root = document.documentElement;
    if (!root || typeof root.getAttribute !== 'function') return null;
    return root.getAttribute(REDUCED_MOTION_ATTR);
}

/**
 * The effective preference: the user's explicit override when they set one,
 * otherwise the OS answer.
 *
 * @returns {boolean} true when motion should be reduced
 */
export function resolveReducedMotion() {
    const override = overrideValue();
    if (override === 'reduce') return true;
    if (override === 'no-preference') return false;
    return osPrefersReducedMotion();
}

/**
 * Subscribe to changes in the effective preference. Fires when the OS flips
 * the media query AND when the user changes the setting (which rewrites the
 * root attribute), so a consumer never has to watch both sources itself.
 *
 * @param {(reduced: boolean) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeReducedMotion(onChange) {
    const notify = () => onChange(resolveReducedMotion());
    /** @type {Array<() => void>} */
    const teardown = [];

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
            const mq = window.matchMedia(MEDIA_QUERY);
            if (typeof mq.addEventListener === 'function') {
                mq.addEventListener('change', notify);
                teardown.push(() => mq.removeEventListener('change', notify));
            } else if (typeof mq.addListener === 'function') {
                // Safari < 14 / older WebViews: the deprecated listener API.
                mq.addListener(notify);
                teardown.push(() => mq.removeListener(notify));
            }
        } catch { /* matchMedia unavailable: the attribute path still works */ }
    }

    if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
        const obs = new MutationObserver(notify);
        obs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: [REDUCED_MOTION_ATTR],
        });
        teardown.push(() => obs.disconnect());
    }

    return () => { for (const fn of teardown) fn(); };
}

/**
 * React binding for `resolveReducedMotion`. Re-renders on either input
 * changing.
 *
 * @returns {boolean}
 */
export function useReducedMotion() {
    const [reduced, setReduced] = useState(resolveReducedMotion);
    useEffect(() => {
        // Re-seed on mount: the attribute may have landed between the first
        // render's lazy initialiser and this effect.
        setReduced(resolveReducedMotion());
        return subscribeReducedMotion(setReduced);
    }, []);
    return reduced;
}
