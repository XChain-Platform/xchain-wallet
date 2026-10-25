// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qoperatoroperatoroperatoroperatoroperator';

afterEach(cleanup);

function mount(claims) {
    const target = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress: vi.fn().mockResolvedValue([{ amount: '12.5', status: 'valid' }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([{ id: 1, amount: '3', block_index: 106 }]),
        getRewardClaimsForAddress: claims,
        getBroadcastsForAddress: vi.fn().mockResolvedValue([]),
        getValidatorsForChain: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 200 }),
    };
    const messaging = new Proxy(target, {
        get: (object, property) => (property in object ? object[property] : vi.fn().mockResolvedValue(null)),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <OperatorDashboard walletId="wallet-1" chainId={CHAIN} address={ADDRESS} onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('OperatorDashboard reward totals', () => {
    it('names the staking token XCHAIN', async () => {
        mount(vi.fn().mockResolvedValue([{ action_index: 4, amount: '1', status: 'valid' }]));

        expect(await screen.findByText('Total amount staked: 12.5 XCHAIN')).toBeInTheDocument();
        expect(screen.getByText('Unclaimed rewards:').closest('p'))
            .toHaveTextContent('Unclaimed rewards: 2 XCHAIN; Total rewards earned: 3 XCHAIN');
    });

    it('reports the unclaimed amount as unavailable when the claim ledger fails', async () => {
        mount(vi.fn().mockRejectedValue(new Error('Failed to fetch')));

        const line = (await screen.findByText('Unclaimed rewards:')).closest('p');
        expect(line).toHaveTextContent('Unclaimed rewards: unavailable; Total rewards earned: 3 XCHAIN');
    });
});
