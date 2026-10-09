// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The sentence to show when Speed up, Cancel or Undo fails. The flow's own
// messages are written for developers (a missing replacement engine, a
// `replaceTx:` precondition), so they never reach the screen as they are;
// the plain reasons the flow gives for a refused entry still pass through.

import { RbfNotSupportedError } from '../../flows/rbfReplace.js';
import { userFacingMessage } from './userFacingMessage.js';

export const RBF_UNAVAILABLE_MESSAGE =
    "Speeding up or cancelling a transaction isn't available in this version of the wallet yet.";

/**
 * @param {unknown} err       the error the replacement flow threw
 * @param {string} fallback   house-voice copy for any other developer-shaped failure
 * @returns {string}
 */
export function rbfFailureMessage(err, fallback) {
    if (err instanceof RbfNotSupportedError) return RBF_UNAVAILABLE_MESSAGE;
    return userFacingMessage(err, fallback);
}
