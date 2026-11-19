// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';

// The viewport width where a layout counts as wide: tablets in portrait and
// every desktop window. Width-based on purpose, so a narrow window of a wide
// shell and a wide window of any shell both follow the viewport.
export const WIDE_LAYOUT_MIN_WIDTH = 834;
const WIDE_LAYOUT_QUERY = `(min-width: ${WIDE_LAYOUT_MIN_WIDTH}px)`;

function wideLayoutMatches() {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
        return window.matchMedia(WIDE_LAYOUT_QUERY).matches;
    }
    return window.innerWidth >= WIDE_LAYOUT_MIN_WIDTH;
}

/**
 * True while the viewport is 834px wide or wider. Follows window resizes.
 *
 * @returns {boolean}
 */
export function useWideLayout() {
    const [wide, setWide] = useState(wideLayoutMatches);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        if (typeof window.matchMedia !== 'function') {
            const onResize = () => setWide(wideLayoutMatches());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }
        const query = window.matchMedia(WIDE_LAYOUT_QUERY);
        const onChange = (event) => setWide(event.matches);
        setWide(query.matches);
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange);
            return () => query.removeEventListener('change', onChange);
        }
        if (typeof query.addListener === 'function') {
            query.addListener(onChange);
            return () => query.removeListener(onChange);
        }
        return undefined;
    }, []);

    return wide;
}
