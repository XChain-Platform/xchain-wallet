// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A request the extension's service worker dropped by restarting carries the
// wallet's own "review and try again" sentence. The submit message keeps it
// instead of the generic line, so the user knows to look before retrying.

import { describe, it, expect } from 'vitest';
import { submitFailureMessage, MAINNET_PRELAUNCH_MESSAGE } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const SENTENCE = 'The wallet background restarted before this request finished. Please review and try again.';

function runtimeError(code, message = SENTENCE) {
    return Object.assign(new Error(message), { name: 'RuntimeConnectionError', code });
}

describe('submitFailureMessage for an interrupted background', () => {
    it.each(['RUNTIME_DISCONNECTED', 'RUNTIME_NO_RESPONSE'])('keeps the restart sentence for %s', (code) => {
        expect(submitFailureMessage(runtimeError(code), { verb: 'send', fallback: "Couldn't send." })).toBe(SENTENCE);
    });

    it('keeps the generic line for a timeout, which is not a restart', () => {
        const timeout = runtimeError('RUNTIME_TIMEOUT', 'background did not respond to "action.sendToken"');
        expect(submitFailureMessage(timeout, { verb: 'send' })).not.toBe(timeout.message);
    });

    it('does not take a plain error that only reuses the name', () => {
        const plain = Object.assign(new Error('boom'), { name: 'RuntimeConnectionError' });
        expect(submitFailureMessage(plain, { verb: 'send' })).not.toBe('boom');
    });
});

describe('submitFailureMessage for a mainnet action before launch', () => {
    it('names the refusal and says nothing was signed', () => {
        const err = Object.assign(
            new Error('XChain actions are not available on bitcoin-mainnet before mainnet launch'),
            { name: 'MainnetPrelaunchError', code: 'MAINNET_PRELAUNCH' },
        );
        const message = submitFailureMessage(err, { verb: 'publish the price', fallback: err.message });
        expect(message).toBe(MAINNET_PRELAUNCH_MESSAGE);
        expect(message).toMatch(/Nothing was signed/);
    });

    it('takes the error rebuilt from its code alone', () => {
        const err = Object.assign(new Error('refused'), { code: 'MAINNET_PRELAUNCH' });
        expect(submitFailureMessage(err, { verb: 'send' })).toBe(MAINNET_PRELAUNCH_MESSAGE);
    });
});
