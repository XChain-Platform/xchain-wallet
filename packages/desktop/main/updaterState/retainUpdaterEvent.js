// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Update work that still stands after a later check result arrives. A
// failed or in-flight check does not withdraw an offer electron-updater
// already holds, nor a download it has started or verified, so a window
// that hydrates afterwards must still see that work.
const STANDING_UPDATE_TYPES = new Set([
    'available',
    'progress',
    'downloaded',
    'verifying',
    'ready',
    'rejected',
]);

// Check results that only describe the check itself. The banner ignores
// them when hydrating, so retaining one over standing work hides that work.
const TRANSIENT_CHECK_TYPES = new Set(['checking', 'error']);

/**
 * Choose the event main keeps for a renderer that mounts later. Every
 * event still broadcasts live; only the retained slot is filtered here.
 * `not-available` and any newer offer or download event replace the slot.
 *
 * @param {object|null} previous the event retained so far
 * @param {object|null} event the event just emitted
 * @returns {object|null} the event to retain, never a copy
 */
export function retainUpdaterEvent(previous, event) {
    if (TRANSIENT_CHECK_TYPES.has(event?.type) && STANDING_UPDATE_TYPES.has(previous?.type)) {
        return previous;
    }
    return event;
}
