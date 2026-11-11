// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Meme template icon. It lives beside the wizard until the shared icon
// set (ui/icons) can take it; the stroke props mirror that set exactly.
const STROKE_PROPS = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    'data-xc-icon': '',
    style: { display: 'block' },
};

export function FrogIcon() {
    return (
        <svg {...STROKE_PROPS} data-icon="frog">
            <path d="M3.5 14.5c0-3.6 3.8-6.2 8.5-6.2s8.5 2.6 8.5 6.2-3.8 5.2-8.5 5.2-8.5-1.6-8.5-5.2z" />
            <circle cx="7.8" cy="7.2" r="2.6" />
            <circle cx="16.2" cy="7.2" r="2.6" />
            <circle cx="7.8" cy="7.2" r="0.7" fill="currentColor" />
            <circle cx="16.2" cy="7.2" r="0.7" fill="currentColor" />
            <path d="M8.5 15.2c2 1.4 5 1.4 7 0" />
        </svg>
    );
}
