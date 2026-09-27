// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A cancelling dispenser closes at the first block whose protocol time is
// later than the cancel's block time plus the 1-hour window. The helper turns
// the cancel time into the earliest close and a countdown that never promises
// a clock time once the window has passed. It measures against the chain's
// protocol time when given one, and against the wall clock otherwise.

import { describe, it, expect } from 'vitest';
import {
    DISPENSER_CLOSE_DELAY_SECONDS, chainClockFromTipRead, dispenserCancelTimestamp, dispenserCloseEta, shortAddress,
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

describe('dispenserCloseEta on chain time', () => {
    const LAG = 29 * 60;
    // The wall clock is 5 minutes past the window's end, and the chain's
    // protocol time trails it by 29 minutes.
    const wallNow = at(3600 + 5 * 60);
    const chainNow = CANCEL_AT + 3600 + 5 * 60 - LAG;

    it('counts the remainder on the chain even when the wall clock says past due', () => {
        const clockOnly = dispenserCloseEta(CANCEL_AT, { nowMs: wallNow });
        expect(clockOnly.pastDue).toBe(true);
        const eta = dispenserCloseEta(CANCEL_AT, { nowMs: wallNow, chainTime: chainNow, chainTimeReadAtMs: wallNow });
        expect(eta.basis).toBe('chain');
        expect(eta.pastDue).toBe(false);
        expect(eta.secondsLeft).toBe(24 * 60);
        expect(eta.countdown).toBe('about 24 minutes');
        expect(eta.closeAt).toBe(CANCEL_AT + 3600);
        // The local clock label is now plus the chain-time remainder.
        expect(eta.closeAtMs).toBe(wallNow + 24 * 60 * 1000);
    });

    it('shows about 29 minutes left when the chain lags 29 minutes and the wall clock reads the window end', () => {
        const eta = dispenserCloseEta(CANCEL_AT, {
            nowMs: at(3600), chainTime: CANCEL_AT + 3600 - LAG, chainTimeReadAtMs: at(3600),
        });
        expect(eta.countdown).toBe('about 29 minutes');
        expect(eta.shortCountdown).toBe('~29 min');
    });

    it('advances the chain reading by local time elapsed since the read', () => {
        const readAt = at(3600);
        const eta = dispenserCloseEta(CANCEL_AT, {
            nowMs: readAt + 10 * 60 * 1000, chainTime: CANCEL_AT + 3600 - LAG, chainTimeReadAtMs: readAt,
        });
        expect(eta.secondsLeft).toBe(19 * 60);
    });

    it('never runs the chain reading backwards when the local clock steps back', () => {
        const readAt = at(3600);
        const eta = dispenserCloseEta(CANCEL_AT, {
            nowMs: readAt - 10 * 60 * 1000, chainTime: CANCEL_AT + 3600 - LAG, chainTimeReadAtMs: readAt,
        });
        expect(eta.secondsLeft).toBe(LAG);
    });

    it('says "at the next block" once the chain has passed the window, with no clock time', () => {
        const eta = dispenserCloseEta(CANCEL_AT, {
            nowMs: wallNow, chainTime: CANCEL_AT + 3600 + 1, chainTimeReadAtMs: wallNow,
        });
        expect(eta.pastDue).toBe(true);
        expect(eta.secondsLeft).toBe(0);
        expect(eta.countdown).toBe('at the next block');
        expect(eta.shortCountdown).toBe('next block');
    });

    it('falls back to the wall clock when chain time is missing or unreadable', () => {
        const cases = [
            {},
            { chainTime: null, chainTimeReadAtMs: wallNow },
            { chainTime: chainNow, chainTimeReadAtMs: null },
            { chainTime: 'soon', chainTimeReadAtMs: wallNow },
            { chainTime: 0, chainTimeReadAtMs: wallNow },
        ];
        for (const extra of cases) {
            const eta = dispenserCloseEta(CANCEL_AT, { nowMs: wallNow, ...extra });
            expect(eta.basis).toBe('clock');
            expect(eta.pastDue).toBe(true);
            expect(eta.countdown).toBe('any block now');
            expect(eta.closeAtMs).toBe((CANCEL_AT + 3600) * 1000);
        }
    });
});

describe('chainClockFromTipRead', () => {
    it('pairs a protocol time with the local read time', () => {
        expect(chainClockFromTipRead({ blockTime: 1790460068, protocolTime: 1790458382 }, 1790460118000))
            .toEqual({ chainTime: 1790458382, chainTimeReadAtMs: 1790460118000 });
    });

    it('returns null when the read has no usable protocol time', () => {
        for (const read of [null, undefined, {}, { blockTime: 1790460068 }, { protocolTime: null }, { protocolTime: 'x' }, { protocolTime: 0 }]) {
            expect(chainClockFromTipRead(read, 1)).toBeNull();
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
