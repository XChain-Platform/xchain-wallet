// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as airdrop from '../../../packages/core/src/airdrop/index.js';

describe('airdrop public exports', () => {
    it('exposes every recipient-list helper', () => {
        expect(Object.keys(airdrop).sort()).toEqual([
            'applyTokenAccessLists',
            'bech32IdentityKey',
            'classifyRecipients',
            'isPlausibleAddress',
            'isRecipientForChain',
            'parseCsv',
            'parsePaste',
            'reconcileStoredList',
        ]);
        for (const helper of Object.values(airdrop)) expect(helper).toBeTypeOf('function');
    });
});
