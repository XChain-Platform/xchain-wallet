// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import { listMetaSupported } from '../../../packages/core/src/flows/listFormatSupport.js';

const CHAIN_ID = 'bitcoin-regtest';

function registryWithFormats(formats) {
    const getActionFormats = vi.fn(() => formats);
    const sdkRegistry = { get: vi.fn(() => ({ getActionFormats })) };
    return { getActionFormats, sdkRegistry };
}

describe('listMetaSupported', () => {
    it('returns true when LIST formats 4 and 5 are present', async () => {
        const { getActionFormats, sdkRegistry } = registryWithFormats({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM',
            5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO',
        });

        await expect(listMetaSupported({ sdkRegistry, chainId: CHAIN_ID }))
            .resolves.toBe(true);
        expect(sdkRegistry.get).toHaveBeenCalledWith(CHAIN_ID);
        expect(getActionFormats).toHaveBeenCalledWith('LIST');
    });

    it.each([
        [{ 4: 'VERSION|TYPE|NAME|DESCRIPTION|MEMO|...ITEM' }],
        [{ 5: 'VERSION|LIST_ACTION_INDEX|NAME|DESCRIPTION|MEMO' }],
        [{ 0: 'VERSION|TYPE|MEMO|...ITEM' }],
    ])('returns false when either LIST meta format is absent %#', async (formats) => {
        const { sdkRegistry } = registryWithFormats(formats);

        await expect(listMetaSupported({ sdkRegistry, chainId: CHAIN_ID }))
            .resolves.toBe(false);
    });

    it('returns false when the LIST formats answer is null', async () => {
        const { sdkRegistry } = registryWithFormats(null);

        await expect(listMetaSupported({ sdkRegistry, chainId: CHAIN_ID }))
            .resolves.toBe(false);
    });

    it('returns false when SDK lookup throws', async () => {
        const sdkRegistry = {
            get: () => {
                throw new Error('registry unavailable');
            },
        };

        await expect(listMetaSupported({ sdkRegistry, chainId: CHAIN_ID }))
            .resolves.toBe(false);
    });
});
