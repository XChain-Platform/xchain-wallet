// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// responsive-first program, slice 1: the single source of truth for
// the wallet shell's layout breakpoints.
//
// WHY THIS FILE EXISTS
// --------------------
// The shell used to carry two independent thresholds that nobody kept in
// sync: the web shell flipped its `small`/`full` variant at 640px in JS,
// while LeftNav.module.css collapsed the sidebar with a
// `@media (max-width: 899px)` rule. Between those two numbers the wallet
// rendered NO persistent navigation at all: too wide for the bottom tab
// bar (JS-gated on the `small` variant), too narrow for the sidebar (CSS-
// gated at 900px). Tablet portrait and a half-screen desktop window both
// land squarely in that gap.
//
// Every width decision the shell makes now derives from the constants
// here, so there is exactly one place to move a breakpoint.
//
// THREE TIERS, ONE INTERFACE
// --------------------------
//   compact  (< 640px)     phone portrait, extension popup (360px), side
//                          panel. Bottom tab bar owns navigation.
//   rail     (640-899px)   tablet portrait, half-screen desktop window.
//                          Sidebar stays, collapsed to an icon rail.
//   full     (>= 900px)    desktop / landscape tablet. Labelled sidebar.
//
// Tiers are resolved from the width of the LAYOUT CONTAINER, not the
// browser viewport (see useLayoutTier.js). That distinction matters: the
// dev-preview frames and the extension popup are narrow surfaces inside a
// wide window, so a viewport media query reads the wrong number for them.

/** Container width (px) at or above which the sidebar appears as an icon rail. */
export const TIER_RAIL_MIN_PX = 640;

/** Container width (px) at or above which the sidebar shows its labels. */
export const TIER_FULL_MIN_PX = 900;

/** Tier names, narrowest first. */
export const LAYOUT_TIERS = Object.freeze(['compact', 'rail', 'full']);

/**
 * Resolve a layout tier from a container width in CSS pixels.
 *
 * A width we cannot trust (0, NaN, undefined, negative) resolves to
 * `compact`: mobile-first is the safe default, since the compact tier is
 * the only one that renders correctly at every width.
 *
 * @param {number} width
 * @returns {'compact' | 'rail' | 'full'}
 */
export function tierForWidth(width) {
    const px = Number(width);
    if (!Number.isFinite(px) || px <= 0) return 'compact';
    if (px >= TIER_FULL_MIN_PX) return 'full';
    if (px >= TIER_RAIL_MIN_PX) return 'rail';
    return 'compact';
}

/**
 * Does this tier render the left sidebar (labelled or rail)?
 * @param {string} tier
 */
export function showsSidebar(tier) {
    return tier === 'rail' || tier === 'full';
}

/**
 * Does this tier render the bottom tab bar?
 *
 * Invariant the shell relies on: for any width, exactly one of
 * `showsSidebar` / `showsBottomBar` is true, so the wallet always has one
 * persistent navigation surface and never two.
 *
 * @param {string} tier
 */
export function showsBottomBar(tier) {
    return tier === 'compact';
}
