// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Watches the service worker that holds this window's parked request. Its own
// module so the Router tests that stub messaging.js keep the real watch, which
// is inert where chrome.runtime.connect does not exist.

import { fetchApproval } from './messaging.js';
import { watchApprovalWorker } from '../shared/approvalWatch.js';

/**
 * Call `onInterrupted` with the interrupted note as soon as the service worker
 * holding request `id` stops, rather than when the user next presses a button.
 *
 * @param {string} id
 * @param {(message: string) => void} onInterrupted
 * @param {{ connect?: Function, lastError?: unknown }} [runtime]
 * @returns {() => void} stops watching
 */
export function watchApprovalRequest(id, onInterrupted, runtime) {
    return watchApprovalWorker({
        stillParked: () => fetchApproval(id),
        onLost: (err) => {
            // Any other failure says nothing about the request, so it waits
            // for the user's next press to report it.
            if (err?.name === 'ApprovalInterruptedError') onInterrupted(err.message);
        },
        runtime,
    });
}
