// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Validator performance shows a roster row only when it names this operator's
// delegated key and this address. A row that pairs the key with another
// address is another record, and its uptime and score are not this operator's.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OperatorDashboard } from '../../../packages/core/src/shared/routes/OperatorDashboard.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qoperatoroperatoroperatoroperatoroperator';
const OTHER = 'bc1qsomeoneelsesomeoneelsesomeoneelsesomeone';
const KEY = 'c'.repeat(64);

afterEach(cleanup);

function mount(roster) {
    const target = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getStakesForAddress: vi.fn().mockResolvedValue([{ source: ADDRESS, amount: '12.5', status: 'valid', signing_pubkey: 'a'.repeat(64) }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([{ source: ADDRESS, signing_pubkey: KEY, status: 'valid', block_index: 160 }]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getBroadcastsForAddress: vi.fn().mockResolvedValue([]),
        getValidatorsForChain: vi.fn().mockResolvedValue(roster),
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

describe('OperatorDashboard validator performance', () => {
    it("does not claim another address's roster row that carries this key", async () => {
        mount([{ source: OTHER, signing_pubkey: KEY, uptime: '99%', score: 77, status: 'valid' }]);
        expect(await screen.findByText('Validator not active yet')).toBeInTheDocument();
        expect(screen.queryByText('Uptime: 99%')).toBeNull();
        expect(screen.queryByText('Validator score: 77')).toBeNull();
    });

    it('shows the row that names this key and this address', async () => {
        mount([
            { source: OTHER, signing_pubkey: KEY, uptime: '99%', status: 'valid' },
            { source: ADDRESS, signing_pubkey: KEY.toUpperCase(), uptime: '41%', status: 'valid' },
        ]);
        expect(await screen.findByText('Uptime: 41%')).toBeInTheDocument();
        expect(screen.queryByText('Uptime: 99%')).toBeNull();
    });
});
