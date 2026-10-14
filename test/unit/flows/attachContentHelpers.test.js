// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { linkAction } from '../../../packages/core/src/flows/linkAction.js';

const VALID = {
    coin1: 'BTC',
    coin1ActionIndex: '12',
    coin2: 'BTC',
    coin2ActionIndex: '34',
};

describe('attach-content LINK references', () => {
    it.each([
        ['', /coin1ActionIndex/],
        ['0', /coin1ActionIndex/],
        ['-1', /coin1ActionIndex/],
        ['1.5', /coin1ActionIndex/],
    ])('rejects an invalid artwork action number %j', async (value, message) => {
        await expect(linkAction({ ...VALID, coin1ActionIndex: value })).rejects.toThrow(message);
    });

    it.each([
        ['', /coin2ActionIndex/],
        ['0', /coin2ActionIndex/],
        ['-1', /coin2ActionIndex/],
        ['1.5', /coin2ActionIndex/],
    ])('rejects an invalid token action number %j', async (value, message) => {
        await expect(linkAction({ ...VALID, coin2ActionIndex: value })).rejects.toThrow(message);
    });
});
