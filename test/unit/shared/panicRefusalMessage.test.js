// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every form reports a refused submit through submitFailureMessage. A freeze
// the user armed is said plainly; a duress-armed one keeps the generic line.

import { afterEach, describe, expect, it } from 'vitest';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { panicRefusalMessage } from '../../../packages/core/src/shared/safety/panicNotice.js';

const HOUR = 60 * 60 * 1000;
const refusal = () => Object.assign(
    new Error('Signing is frozen by panic mode (60 min remaining)'),
    { name: 'PanicModeActiveError' },
);
const state = (armedBy, now = Date.now()) => ({ activatedAt: now, expiresAt: now + HOUR, durationMs: HOUR, armedBy });

afterEach(() => { localStorage.clear(); });

describe('panic refusal wording', () => {
    it('names a self-armed freeze and what to do', () => {
        localStorage.setItem('xchain-wallet:panic', JSON.stringify(state('self')));
        const text = submitFailureMessage(refusal(), { verb: 'create this dispenser' });
        expect(text).toMatch(/^Panic mode is on, so nothing was sent\./);
        expect(text).toMatch(/Settings > Safety/);
        expect(text).not.toMatch(/Something went wrong/);
    });

    it('keeps the generic line for a duress-armed freeze', () => {
        localStorage.setItem('xchain-wallet:panic', JSON.stringify(state('duress')));
        const text = submitFailureMessage(refusal(), { verb: 'send' });
        expect(text).toBe("Couldn't send. Something went wrong. Try again.");
        expect(panicRefusalMessage(refusal())).toBeNull();
    });

    it('keeps the generic line while the freeze is still loading or already over', () => {
        expect(submitFailureMessage(refusal(), { verb: 'send' })).toBe("Couldn't send. Something went wrong. Try again.");
    });

    it('ignores every other error', () => {
        localStorage.setItem('xchain-wallet:panic', JSON.stringify(state('self')));
        expect(panicRefusalMessage(new Error('Signing is frozen by panic mode'))).toBeNull();
    });
});
