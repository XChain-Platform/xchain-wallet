// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The host flows behind a dispenser buy's Approve reads carry `fresh` down to
// the explorer client, including through getAction(index), whose facade takes
// no options. Without the flag they read exactly as before.

import { describe, it, expect, vi } from 'vitest';
import { dispenserByActionIndex, dispensersForAddress } from '../../../packages/core/src/flows/dispenserQueries.js';
import { listByActionIndex } from '../../../packages/core/src/flows/listQueries.js';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';

function fakeSdk(actions = {}) {
    const sdk = {
        explorer: { get: vi.fn(async (path) => actions[path] ?? { path }) },
        getAction: vi.fn(async (index) => actions[`/action/${index}`] ?? { index }),
        getDispensers: vi.fn(async () => ({ data: [] })),
        getToken: vi.fn(async (tick) => ({ tick })),
    };
    return { sdk, sdkRegistry: { get: () => sdk } };
}

describe('dispenser guard reads carry fresh to the explorer client', () => {
    it('reads a dispenser by action index fresh through the explorer client', async () => {
        const { sdk, sdkRegistry } = fakeSdk();
        await dispenserByActionIndex({ sdkRegistry, chainId: 'c', actionIndex: '81 7', fresh: true });
        expect(sdk.explorer.get).toHaveBeenCalledWith('/action/81%207', { fresh: true });
        expect(sdk.getAction).not.toHaveBeenCalled();

        await dispenserByActionIndex({ sdkRegistry, chainId: 'c', actionIndex: '817' });
        expect(sdk.getAction).toHaveBeenCalledWith('817');
        expect(sdk.explorer.get).toHaveBeenCalledTimes(1);
    });

    it('lists the dispensers at an address fresh and keeps the caller options', async () => {
        const { sdk, sdkRegistry } = fakeSdk();
        await dispensersForAddress({ sdkRegistry, chainId: 'c', address: 'a', opts: { limit: 5 }, fresh: true });
        expect(sdk.getDispensers).toHaveBeenLastCalledWith('a', 'address', { limit: 5, fresh: true });
        await dispensersForAddress({ sdkRegistry, chainId: 'c', address: 'a', opts: { limit: 5 } });
        expect(sdk.getDispensers).toHaveBeenLastCalledWith('a', 'address', { limit: 5 });
    });

    it('reads both hops of a list fresh', async () => {
        const { sdk, sdkRegistry } = fakeSdk({
            '/action/55': { action: 'LIST', action_format: 5, list_action_index: '40' },
            '/action/40': { action: 'LIST', list: [] },
        });
        const list = await listByActionIndex({ sdkRegistry, chainId: 'c', actionIndex: '55', fresh: true });
        expect(list).toEqual({ action: 'LIST', list: [] });
        expect(sdk.explorer.get.mock.calls).toEqual([['/action/55', { fresh: true }], ['/action/40', { fresh: true }]]);
        expect(sdk.getAction).not.toHaveBeenCalled();
    });

    it('reads a token row fresh', async () => {
        const { sdk, sdkRegistry } = fakeSdk();
        await tokenInfoFor({ sdkRegistry, chainId: 'c', tick: 'PEPE', metadataFetchEnabled: false, fresh: true });
        expect(sdk.getToken).toHaveBeenLastCalledWith('PEPE', { fresh: true });
        await tokenInfoFor({ sdkRegistry, chainId: 'c', tick: 'PEPE', metadataFetchEnabled: false });
        expect(sdk.getToken).toHaveBeenLastCalledWith('PEPE');
    });
});
