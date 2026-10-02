// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Word a failed LOAD in the read voice: humanizeError drops explorer request URLs,
// and an unclassified function-prefixed precondition ("getOrderbook: tick1 is
// required") becomes a generic sentence instead of trailing the opener.

import { humanizeError } from './humanizeError.js';
import { isDeveloperMessage } from './userFacingMessage.js';

/**
 * @param {unknown} err   the caught error (Error, string, or anything)
 * @param {string} verb   what the screen was doing, e.g. 'load the order book'
 * @returns {string}      one sentence that opens with "Couldn't <verb>."
 */
export function readFailureMessage(err, verb) {
    const h = humanizeError(err, verb);
    // Keep classified copy; only an unclassified developer string is replaced.
    if (h.cause === 'unknown' && h.details === '' && isDeveloperMessage(err)) {
        return `Couldn't ${verb}. Something went wrong. Try again.`;
    }
    return h.message;
}
