// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { withListRemovalDescriptions } from '../../../packages/core/src/decoder/list_removal_description.js';

describe('list removal tied low-coverage behavior', () => {
    it('normalizes mixed-case actions before replacing both removal rows', () => {
        const decoded = {
            summary: 'Edit lists',
            details: [
                { label: 'Allow list', value: '0' },
                { label: 'Block list', value: '000' },
            ],
            warnings: [],
        };

        expect(withListRemovalDescriptions(decoded, {
            action: 'sWaP',
            version: 2,
            params: { ALLOW_LIST: '0', BLOCK_LIST: '000' },
        })).toEqual({
            ...decoded,
            details: [
                { label: 'Allow list', value: 'Remove allow list' },
                { label: 'Block list', value: 'Remove block list' },
            ],
        });
    });
});
