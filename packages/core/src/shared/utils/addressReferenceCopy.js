// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-language copy for an address-list entry written as an address
// reference (`^<index>`). The recipient classifier names these and still skips
// them, because the wallet does not resolve references; every list form that
// shows them uses this wording so the forms cannot drift apart.

/** Per-entry line under the skipped-references disclosure. */
export const ADDRESS_REFERENCE_ITEM_MESSAGE = 'Address reference; paste the full address instead.';

/**
 * Sentence telling the user that reference entries were skipped, and why.
 *
 * @param {number} count  how many reference entries were skipped
 * @returns {string}
 */
export function addressReferenceNote(count) {
    const lead = count === 1
        ? 'One entry is an address reference (a caret and a number) and was skipped.'
        : `${count} entries are address references (a caret and a number) and were skipped.`;
    return `${lead} This form needs the full address, so paste the address the reference points to.`;
}
