// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { planChunkedDeploy } from '../../../packages/core/src/flows/deployChunked.js';

const HASH = 'a'.repeat(64);

function planner() {
    const sdk = {
        planDeploy: vi.fn(() => ({
            codeHash: HASH, single: true, parts: null, totalChunks: 0,
        })),
    };
    return { sdk, sdkRegistry: { get: () => sdk } };
}

describe('planChunkedDeploy staking fields', () => {
    it('sizes staking with normalized wire fields and the BURN default', () => {
        const { sdk, sdkRegistry } = planner();
        planChunkedDeploy({
            sdkRegistry, chainId: 'c', code: 'x', gasLimit: '1', cooldownBlocks: ' 144 ',
        });
        expect(sdk.planDeploy).toHaveBeenCalledWith('x', expect.objectContaining({
            cooldownBlocks: '144', slashDestination: 'BURN',
        }));
    });

    it('passes a trimmed slash destination', () => {
        const { sdk, sdkRegistry } = planner();
        planChunkedDeploy({
            sdkRegistry, chainId: 'c', code: 'x', cooldownBlocks: '144',
            slashDestination: '  bc1qslash  ',
        });
        expect(sdk.planDeploy).toHaveBeenCalledWith('x', expect.objectContaining({
            cooldownBlocks: '144', slashDestination: 'bc1qslash',
        }));
    });

    it('leaves non-staking plans unchanged', () => {
        const { sdk, sdkRegistry } = planner();
        planChunkedDeploy({ sdkRegistry, chainId: 'c', code: 'x', gasLimit: '1' });
        expect(sdk.planDeploy).toHaveBeenCalledWith('x', {
            gasLimit: '1', constructorParams: undefined,
        });
    });
});
