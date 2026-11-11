// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

const TEXT_ENTRY_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);

function isTextEntry(element) {
    return element instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(element.getAttribute('type') || '');
}

// A field the user can type into right now. Chromium still lays out the
// content of a closed <details>, so a field in a shut disclosure (Send's
// Advanced section) reports client rects and needs its own check; a read-only
// field is a picker surface (From, change address), not one the user types in.
function isOpenTypingField(field) {
    if (!isTextEntry(field) || field.disabled || field.readOnly) return false;
    if (field.getClientRects().length === 0) return false;
    const closedDisclosure = field.closest('details:not([open])');
    return !closedDisclosure || !!field.closest('summary');
}

/**
 * Keydown handler for a form: Enter submits only from the form's last visible
 * text field, so a stray Enter in an earlier field (an address, a name, the
 * current password) never submits the form early. Fields in a closed
 * disclosure and read-only picker fields do not count as the last field, and
 * Enter in a read-only field never submits.
 *
 * @param {KeyboardEvent & { currentTarget: HTMLFormElement }} event
 */
export function submitOnlyFromLastField(event) {
    if (event.defaultPrevented || event.key !== 'Enter') return;
    const target = event.target;
    if (!isTextEntry(target)) return;
    if (target.readOnly) {
        event.preventDefault();
        return;
    }
    const fields = [...event.currentTarget.querySelectorAll('input')].filter(isOpenTypingField);
    if (fields.length > 1 && fields.at(-1) !== target) event.preventDefault();
}
