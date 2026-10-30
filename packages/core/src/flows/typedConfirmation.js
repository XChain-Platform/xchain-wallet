// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Require the displayed confirmation word byte for byte. Destructive gates do
 * not repair casing or whitespace because the deliberate exact entry is part
 * of the confirmation.
 *
 * @param {unknown} typed
 * @param {string} expected
 * @returns {boolean}
 */
export function isExactTypedConfirmation(typed, expected) {
    return typeof typed === 'string' && typed === expected;
}
