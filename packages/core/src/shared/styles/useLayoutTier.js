// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first program, slice 1: measure the layout container
// and report its tier.
//
// Container width, not viewport width. The wallet renders into surfaces
// that are much narrower than the window around them: the 360px extension
// popup, the Chrome side panel, and the dev-preview frames. A viewport
// media query reads the window and gets those wrong, which is why the
// bottom tab bar had to be JS-gated in the first place. Measuring the
// container makes one rule work everywhere.
//
// The first render has nothing to measure yet, so it seeds from the
// viewport: correct for the common full-window case, corrected on mount
// for everything else.

import { useEffect, useRef, useState } from 'react';
import { tierForWidth } from './breakpoints.js';

function viewportWidth() {
    if (typeof window === 'undefined') return 0;
    return window.innerWidth || document.documentElement?.clientWidth || 0;
}

/**
 * @returns {[import('react').RefObject<any>, 'compact' | 'rail' | 'full']}
 *   a ref to attach to the layout container, and its current tier
 */
export function useLayoutTier() {
    const ref = useRef(null);
    const [tier, setTier] = useState(() => tierForWidth(viewportWidth()));

    useEffect(() => {
        const el = ref.current;
        // A 0-width box means "not laid out yet" (or jsdom, which has no
        // layout at all), so fall back to the viewport rather than pinning
        // the whole shell to compact.
        const measure = () => {
            const measured = el?.getBoundingClientRect?.().width || 0;
            const next = tierForWidth(measured || viewportWidth());
            setTier((prev) => (prev === next ? prev : next));
        };
        measure();

        if (el && typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(measure);
            observer.observe(el);
            return () => observer.disconnect();
        }
        // No ResizeObserver (older embedder, test env): the viewport is the
        // best proxy available, and window resize is the only signal.
        if (typeof window === 'undefined') return undefined;
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, []);

    return [ref, tier];
}
