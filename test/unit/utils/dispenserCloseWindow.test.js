// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A cancelling dispenser closes at the first block whose block time is later
// than the cancel's block time plus the 1-hour window. The helper turns the
// cancel time into the earliest close and a countdown that never promises a
// clock time once the window has passed.

import { describe, it, expect } from 'vitest';
import {
    DISPENSER_CLOSE_DELAY_SECONDS, dispenserCancelTimestamp, dispenserCloseEta, shortAddress,
} from '../../../packages/core/src/shared/utils/dispenserCloseWindow.js';

const CANCEL_AT = 1790455620;
const at = (secondsAfterCancel) => (CANCEL_AT + secondsAfterCancel) * 1000;

describe('dispenserCloseEta', () => {
    it('puts the earliest close one window after the cancel', () => {
        const eta = dispenserCloseEta(CANCEL_AT, { nowMs: at(0) });
        expect(DISPENSER_CLOSE_DELAY_SECONDS).toBe(3600);
        expect(eta.closeAt).toBe(CANCEL_AT + 3600);
        expect(eta.closeAtMs).toBe((CANCEL_AT + 3600) * 1000);
        expect(eta.secondsLeft).toBe(3600);
        expect(eta.pastDue).toBe(false);
        expect(eta.countdown).toBe('about 60 minutes');
        expect(eta.shortCountdown).toBe('~60 min');
    });

    it('counts down in whole minutes', () => {
        const eta = dispenserCloseEta(String(CANCEL_AT), { nowMs: at(3600 - 23 * 60) });
        expect(eta.countdown).toBe('about 23 minutes');
        expect(eta.shortCountdown).toBe('~23 min');
    });

    it('says "a few minutes" in the last five minutes', () => {
        const eta = dispenserCloseEta(CANCEL_AT, { nowMs: at(3600 - 4 * 60) });
        expect(eta.countdown).toBe('a few minutes');
        expect(eta.shortCountdown).toBe('a few min');
    });

    it('says "any block now" once the window has passed, since the close waits on a block', () => {
        for (const late of [0, 1, 600, 86400]) {
            const eta = dispenserCloseEta(CANCEL_AT, { nowMs: at(3600 + late) });
            expect(eta.pastDue).toBe(true);
            expect(eta.secondsLeft).toBe(0);
            expect(eta.countdown).toBe('any block now');
            expect(eta.shortCountdown).toBe('any block now');
        }
    });

    it('rounds long waits to hours when the delay is longer', () => {
        const eta = dispenserCloseEta(CANCEL_AT, { nowMs: at(0), delaySeconds: 3 * 3600 });
        expect(eta.countdown).toBe('about 3 hours');
    });

    it('returns null for a missing or unreadable cancel time', () => {
        for (const bad of [null, undefined, '', 0, '0', 'soon', Number.NaN, -5]) {
            expect(dispenserCloseEta(bad, { nowMs: at(0) })).toBeNull();
        }
    });
});

describe('dispenserCancelTimestamp', () => {
    const cancel = { action_index: '19', dispenser_action_index: '18', status: 'valid', block_index: 500, timestamp: CANCEL_AT };

    it('reads the valid cancel that names this dispenser', () => {
        expect(dispenserCancelTimestamp([cancel], '18')).toBe(CANCEL_AT);
        expect(dispenserCancelTimestamp([cancel], 18)).toBe(CANCEL_AT);
    });

    it('ignores refused cancels, other dispensers and rows with no dispenser index', () => {
        expect(dispenserCancelTimestamp([
            { ...cancel, status: 'invalid: not open' },
            { ...cancel, dispenser_action_index: '17' },
            { ...cancel, dispenser_action_index: null },
            { ...cancel, timestamp: null },
        ], '18')).toBeNull();
    });

    it('takes the newest qualifying cancel', () => {
        expect(dispenserCancelTimestamp([
            { ...cancel, block_index: 400, timestamp: CANCEL_AT - 900 },
            cancel,
        ], '18')).toBe(CANCEL_AT);
    });

    it('treats a row without a status as valid and tolerates junk input', () => {
        const { status, ...noStatus } = cancel;
        expect(status).toBe('valid');
        expect(dispenserCancelTimestamp([noStatus], '18')).toBe(CANCEL_AT);
        expect(dispenserCancelTimestamp(null, '18')).toBeNull();
        expect(dispenserCancelTimestamp([null, 5], '18')).toBeNull();
    });
});

describe('shortAddress', () => {
    it('keeps the head and tail of a long address', () => {
        expect(shortAddress('tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37')).toBe('tltc1q…ek37');
        expect(shortAddress('short')).toBe('short');
        expect(shortAddress(null)).toBe('');
    });
});
