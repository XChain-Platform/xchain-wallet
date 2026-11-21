// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    backgroundCheckRowState,
    summarizeRunLog,
} from '../../../packages/core/src/shared/components/settings/WatchAlertsRows.jsx';

describe('backgroundCheckRowState()', () => {
    it('uses the watch defaults', () => {
        expect(backgroundCheckRowState({})).toEqual({ on: true, locked: false });
    });

    it('honors a stored off value', () => {
        expect(backgroundCheckRowState({ watch: { backgroundActivityCheck: false } }))
            .toEqual({ on: false, locked: false });
    });

    it('locks and disables a stored on value when Tor routing is on', () => {
        const settings = {
            watch: { backgroundActivityCheck: true },
            privacy: { torRouting: true },
        };

        expect(backgroundCheckRowState(settings)).toEqual({ on: false, locked: true });
    });

    it('does not lock for a truthy non-boolean Tor value', () => {
        const settings = {
            watch: { backgroundActivityCheck: true },
            privacy: { torRouting: 'true' },
        };

        expect(backgroundCheckRowState(settings)).toEqual({ on: true, locked: false });
    });

    it('accepts an absent settings object', () => {
        expect(backgroundCheckRowState()).toEqual({ on: true, locked: false });
    });
});

describe('summarizeRunLog()', () => {
    it('filters, sorts, and limits native run-log times', () => {
        const valid = Array.from({ length: 21 }, (_, index) => 1_000 + index);
        const log = [...valid, '1021', Number.NaN, -1, Number.POSITIVE_INFINITY];

        expect(log).toHaveLength(25);
        expect(summarizeRunLog(log)).toEqual({
            count: 20,
            times: valid.slice(1).reverse(),
        });
    });

    it('supports a smaller limit without mutating the log', () => {
        const log = [100, 300, 200];

        expect(summarizeRunLog(log, { limit: 2 })).toEqual({ count: 2, times: [300, 200] });
        expect(log).toEqual([100, 300, 200]);
    });

    it('returns an empty summary for an absent or non-array log', () => {
        expect(summarizeRunLog()).toEqual({ count: 0, times: [] });
        expect(summarizeRunLog({})).toEqual({ count: 0, times: [] });
    });
});
