// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words a reader hears from a message: its text without the decorative
 * tone icon StatusMessage marks aria-hidden.
 *
 * @param {Element} element
 * @returns {string}
 */
export function messageText(element) {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return copy.textContent;
}
