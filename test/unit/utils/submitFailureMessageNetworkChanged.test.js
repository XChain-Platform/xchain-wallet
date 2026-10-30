// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host refuses a send whose network is no longer the active one, at
// Approve and again after an Undo hold, with its own sentence naming the
// remedy. The submit message keeps that sentence instead of the generic line.

import { describe, it, expect } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const SENTENCE = 'The active network changed to testnet. Return to Send and review the payment again.';

describe('submitFailureMessage for a network that changed under a send', () => {
    it('keeps the host sentence for an ActiveNetworkChangedError', () => {
        const err = Object.assign(new Error(SENTENCE), { name: 'ActiveNetworkChangedError' });
        expect(submitFailureMessage(err, { verb: 'send' })).toBe(SENTENCE);
    });

    it('does not pass through a plain error carrying other text under the name', () => {
        const err = Object.assign(new Error('ECONNREFUSED 127.0.0.1:18443'), { name: 'ActiveNetworkChangedError' });
        expect(submitFailureMessage(err, { verb: 'send' })).not.toContain('ECONNREFUSED');
    });
});
