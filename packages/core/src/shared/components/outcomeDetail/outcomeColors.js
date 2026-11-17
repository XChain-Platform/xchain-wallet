// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One colour per outcome or ballot option, readable on the blue hero. The
// bet market and the poll page draw their lines, legend and swatches from
// this one list so the two pages cannot drift.
export const OUTCOME_COLORS = ['#FFFFFF', '#F5B83D', '#E879F9', '#22D3EE', '#4ADE80', '#FB7185', '#A78BFA', '#FDE047'];

// The same hues for a light page surface (the Bet tab's outcome buttons): the
// hero's white becomes the app blue it sits on, and each other hue is
// darkened until it reads at 4.5:1 on white. A dark theme uses the hero list.
export const OUTCOME_SURFACE_COLORS = ['#1A7BAC', '#B45309', '#A21CAF', '#0E7490', '#15803D', '#BE123C', '#6D28D9', '#A16207'];

const slot = (index, list) => {
    const i = Number(index);
    return list[(Number.isInteger(i) && i >= 0 ? i : 0) % list.length];
};

/** The colour of outcome or option `index`. */
export function outcomeColor(index) {
    return slot(index, OUTCOME_COLORS);
}

/** The colour of outcome `index` on a light page surface. */
export function outcomeSurfaceColor(index) {
    return slot(index, OUTCOME_SURFACE_COLORS);
}
