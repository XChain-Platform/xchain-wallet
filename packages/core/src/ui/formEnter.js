// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const TEXT_ENTRY_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isTextEntry(element) {
    return element instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(element.getAttribute('type') || '');
}

/**
 * Keydown handler for a form: Enter submits only from the form's last visible
 * text field, so a stray Enter in an earlier field (an address, a name, the
 * current password) never submits the form early.
 *
 * @param {KeyboardEvent & { currentTarget: HTMLFormElement }} event
 */
export function submitOnlyFromLastField(event) {
    if (event.defaultPrevented || event.key !== 'Enter') return;
    const target = event.target;
    if (!isTextEntry(target)) return;
    const fields = [...event.currentTarget.querySelectorAll('input')]
        .filter((field) => isTextEntry(field) && !field.disabled && field.getClientRects().length > 0);
    if (fields.length > 1 && fields.at(-1) !== target) event.preventDefault();
}
