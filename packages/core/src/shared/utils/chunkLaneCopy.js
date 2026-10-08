// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Plain-language pieces of the chunk-lane refusals (an action too large for
// one transaction, refused before anything is signed or broadcast).
//
// The refusals are shown to users word for word, and in the extension only
// the message string survives the trip to the popup, so the wording itself
// must be plain: the action by its display label, no script-type token, and
// the device named the way it is sold. The opener and the regex that reads
// it back live together so the two cannot drift apart.

import { actionDisplayLabel } from './actionDisplayLabel.js';

/** Stable part of every chunk-lane refusal, for a reader holding only the message. */
export const CHUNK_LANE_OPENER_RE = /too large for one transaction: it has to go out as two linked transactions/;

/**
 * Opening clause shared by every chunk-lane refusal.
 *
 * @param {string | null | undefined} action  protocol action name, e.g. 'DISPENSER'
 * @returns {string}
 */
export function chunkLaneOpener(action) {
    const label = actionDisplayLabel(action || '');
    return `This ${label ? `${label} action` : 'action'} is too large for one transaction: `
        + 'it has to go out as two linked transactions';
}

/** Sentence subject for each signer kind, as the user knows the device. */
const SIGNER_SUBJECT = Object.freeze({
    ledger: 'A Ledger',
    trezor: 'A Trezor',
    multisig: 'A multisig signer',
    airgap: 'An air-gapped signer',
});

/**
 * Subject naming the signer that cannot finish the second transaction.
 *
 * @param {string | null | undefined} kind  the signer's `kind`
 * @returns {string}
 */
export function signerSubject(kind) {
    const key = String(kind || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(SIGNER_SUBJECT, key) ? SIGNER_SUBJECT[key] : 'This signer';
}
