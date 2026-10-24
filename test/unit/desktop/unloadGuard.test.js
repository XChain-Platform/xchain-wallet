/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { shouldIgnoreBeforeUnload } from '../../../packages/desktop/main/security.js';

describe('shouldIgnoreBeforeUnload', () => {
    it('always lets a quit in progress through without asking', () => {
        const confirmLeave = vi.fn(() => false);
        expect(shouldIgnoreBeforeUnload({ quitting: true, confirmLeave })).toBe(true);
        expect(confirmLeave).not.toHaveBeenCalled();
    });

    it('lets test launches through without a dialog', () => {
        const confirmLeave = vi.fn(() => false);
        expect(shouldIgnoreBeforeUnload({ quitting: false, testMode: true, confirmLeave })).toBe(true);
        expect(confirmLeave).not.toHaveBeenCalled();
    });

    it('follows the answer for any other unload', () => {
        expect(shouldIgnoreBeforeUnload({ quitting: false, confirmLeave: () => true })).toBe(true);
        expect(shouldIgnoreBeforeUnload({ quitting: false, confirmLeave: () => false })).toBe(false);
    });

    it('keeps the page when the question cannot be asked', () => {
        expect(shouldIgnoreBeforeUnload({
            quitting: false,
            confirmLeave: () => { throw new Error('no window'); },
        })).toBe(false);
    });
});
