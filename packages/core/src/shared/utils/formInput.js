// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Removes focus before a number input handles a wheel event.
 *
 * Chromium increments a focused number input instead of scrolling its page,
 * which can silently change a setting or transaction parameter. Blurring
 * before the browser's default wheel action keeps the page scrollable and
 * leaves number-input validation and spinner controls intact.
 *
 * @param {{ currentTarget: { blur: () => void } }} event
 */
export function blurNumberInputOnWheel(event) {
    event.currentTarget.blur();
}
