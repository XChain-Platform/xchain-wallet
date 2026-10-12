// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: the undo-send opt-in flag and resolveUndoSendWindowSeconds.

import { describe, it, expect } from 'vitest';
import {
    resolveUndoSendWindowSeconds,
    createDefaultSettings,
    validateSettings,
    deflateSettings,
    inflateSettings,
} from '../../../packages/core/src/schemas/settings.js';

const make = (enabled, seconds) => ({ grace: { undoSendSeconds: seconds, undoSendEnabled: enabled } });

describe('resolveUndoSendWindowSeconds', () => {
    it('reads 0 for fresh defaults', () => {
        expect(resolveUndoSendWindowSeconds(createDefaultSettings())).toBe(0);
    });
    it('reads the seconds when enabled', () => {
        expect(resolveUndoSendWindowSeconds(make(true, 5))).toBe(5);
    });
    it('clamps to 30 when enabled', () => {
        expect(resolveUndoSendWindowSeconds(make(true, 600))).toBe(30);
    });
    it('reads 0 when enabled with 0', () => {
        expect(resolveUndoSendWindowSeconds(make(true, 0))).toBe(0);
    });
    it('reads 0 for non-true flags', () => {
        for (const f of [1, 'true', null, false, undefined]) {
            expect(resolveUndoSendWindowSeconds(make(f, 5))).toBe(0);
        }
    });
    it('reads 0 for absent settings', () => {
        expect(resolveUndoSendWindowSeconds(undefined)).toBe(0);
        expect(resolveUndoSendWindowSeconds(null)).toBe(0);
        expect(resolveUndoSendWindowSeconds({})).toBe(0);
    });
});

describe('validateSettings undoSendEnabled', () => {
    const withFlag = (v, drop) => {
        const s = createDefaultSettings();
        if (drop) delete s.grace.undoSendEnabled;
        else s.grace.undoSendEnabled = v;
        return s;
    };
    it('passes with the flag absent, true and false', () => {
        expect(validateSettings(withFlag(undefined, true)).ok).toBe(true);
        expect(validateSettings(withFlag(true)).ok).toBe(true);
        expect(validateSettings(withFlag(false)).ok).toBe(true);
    });
    it('fails with a non-boolean', () => {
        expect(validateSettings(withFlag('yes')).ok).toBe(false);
    });
});

describe('deflate and inflate', () => {
    it('keeps a true flag through a round trip', () => {
        const s = createDefaultSettings();
        s.grace.undoSendEnabled = true;
        expect(inflateSettings(deflateSettings(s)).grace.undoSendEnabled).toBe(true);
    });
    it('deflates a default record with no grace key', () => {
        expect(deflateSettings(createDefaultSettings()).grace).toBeUndefined();
    });
});
