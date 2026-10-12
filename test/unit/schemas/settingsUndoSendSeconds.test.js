// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: resolveUndoSendSeconds, the reader-side bound on
// settings.grace.undoSendSeconds (0 to 30, default 5).

import { describe, it, expect } from 'vitest';
import {
    UNDO_SEND_SECONDS_MIN,
    UNDO_SEND_SECONDS_MAX,
    UNDO_SEND_SECONDS_DEFAULT,
    resolveUndoSendSeconds,
    createDefaultSettings,
} from '../../../packages/core/src/schemas/settings.js';

const withSeconds = (v) => ({ grace: { undoSendSeconds: v } });

describe('resolveUndoSendSeconds', () => {
    it('exports the bounds', () => {
        expect(UNDO_SEND_SECONDS_MIN).toBe(0);
        expect(UNDO_SEND_SECONDS_MAX).toBe(30);
        expect(UNDO_SEND_SECONDS_DEFAULT).toBe(5);
    });

    it('returns the default when absent', () => {
        expect(resolveUndoSendSeconds(undefined)).toBe(5);
        expect(resolveUndoSendSeconds(null)).toBe(5);
        expect(resolveUndoSendSeconds({})).toBe(5);
        expect(resolveUndoSendSeconds({ grace: {} })).toBe(5);
        expect(resolveUndoSendSeconds(createDefaultSettings())).toBe(5);
    });

    it.each([[0, 0], [5, 5], [30, 30], [31, 30], [600, 30]])('%s resolves to %s', (input, out) => {
        expect(resolveUndoSendSeconds(withSeconds(input))).toBe(out);
    });

    it.each([[-1], [2.5], ['7'], [NaN], [Infinity], [null]])('%s falls back to the default', (input) => {
        expect(resolveUndoSendSeconds(withSeconds(input))).toBe(5);
    });
});
