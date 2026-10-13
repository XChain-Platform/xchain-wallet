// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    undoSendExpired,
    undoSendRemainingSeconds,
} from '../../../packages/core/src/flows/undoSend.js';

const STARTED_AT = 1_000_000;
const SECONDS = 10;

describe('undo-send countdown', () => {
    it('shows the full window at the start', () => {
        const input = { startedAt: STARTED_AT, seconds: SECONDS, now: STARTED_AT };

        expect(undoSendRemainingSeconds(input)).toBe(10);
        expect(undoSendExpired(input)).toBe(false);
    });

    it('rounds a mid-window partial second up', () => {
        const input = { startedAt: STARTED_AT, seconds: SECONDS, now: STARTED_AT + 6_250 };

        expect(undoSendRemainingSeconds(input)).toBe(4);
        expect(undoSendExpired(input)).toBe(false);
    });

    it('expires at the exact boundary', () => {
        const input = { startedAt: STARTED_AT, seconds: SECONDS, now: STARTED_AT + 10_000 };

        expect(undoSendRemainingSeconds(input)).toBe(0);
        expect(undoSendExpired(input)).toBe(true);
    });

    it('stays expired after the window has passed', () => {
        const input = { startedAt: STARTED_AT, seconds: SECONDS, now: STARTED_AT + 60_000 };

        expect(undoSendRemainingSeconds(input)).toBe(0);
        expect(undoSendExpired(input)).toBe(true);
    });

    it('shows the full window when the clock is behind the start', () => {
        const input = { startedAt: STARTED_AT, seconds: SECONDS, now: STARTED_AT - 5_000 };

        expect(undoSendRemainingSeconds(input)).toBe(10);
        expect(undoSendExpired(input)).toBe(false);
    });

    it.each([
        ['startedAt', { startedAt: Number.NaN, seconds: SECONDS, now: STARTED_AT }],
        ['seconds', { startedAt: STARTED_AT, seconds: Number.POSITIVE_INFINITY, now: STARTED_AT }],
        ['now', { startedAt: STARTED_AT, seconds: SECONDS, now: Number.NEGATIVE_INFINITY }],
    ])('throws TypeError for a non-finite %s', (_name, input) => {
        expect(() => undoSendRemainingSeconds(input)).toThrow(TypeError);
        expect(() => undoSendExpired(input)).toThrow(TypeError);
    });
});
