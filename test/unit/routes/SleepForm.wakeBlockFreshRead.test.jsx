// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wake-block check just before a SLEEP signs reads the indexed height
// fresh. The review read the same height moments earlier, and a reused or
// HTTP-cached answer would let a wake block that has just passed be signed.
// The height reads that build the review stay ordinary.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { indexerWatermark } from '../../../packages/core/src/flows/balances.js';

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ chainId }) => React.createElement('p', null, `Picker chain: ${chainId}`),
}));

const BITCOIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02btc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SLEEP wake-block check reads the height fresh', () => {
    it('refuses at sign time when only a fresh read shows the wake block passed', async () => {
        // A reused or cached read keeps answering the review's height.
        const getIndexerWatermark = vi.fn(async (req) => ({ watermark: req.fresh ? 10_017 : 10_005 }));
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [BITCOIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getIndexerWatermark,
            sleepAction: vi.fn().mockResolvedValue({ txid: 'sleep-txid' }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SleepForm walletId="wallet-1" mode="address" initialChainId={BITCOIN} onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('Duration (blocks)'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        expect(await screen.findByText(/until block 10017/)).toBeInTheDocument();
        const beforeSign = getIndexerWatermark.mock.calls.length;
        expect(getIndexerWatermark.mock.calls.every(([req]) => !req.fresh)).toBe(true);

        fireEvent.change(screen.getByLabelText('Type LOCK to confirm'), { target: { value: 'LOCK' } });
        fireEvent.click(screen.getByRole('button', { name: 'Lock address' }));

        expect(await screen.findByText('Wake block 10,017 has passed. Go back and choose a new duration.')).toBeInTheDocument();
        expect(getIndexerWatermark.mock.calls.slice(beforeSign).map(([req]) => req))
            .toEqual([{ chainId: BITCOIN, fresh: true }]);
        expect(messaging.sleepAction).not.toHaveBeenCalled();
    });

    it('reads /status fresh through the explorer client when asked', async () => {
        const sdk = {
            explorer: { coin: 'BTC', get: vi.fn(async () => ({ last_block: { BTC: 10_017 } })) },
            getStatus: vi.fn(async () => ({ last_block: { BTC: 10_005 } })),
        };
        const fresh = await indexerWatermark({ sdkRegistry: { get: () => sdk }, chainId: BITCOIN, fresh: true });
        expect(sdk.explorer.get).toHaveBeenCalledWith('/status', { fresh: true });
        expect(fresh.watermark).toBe(10_017);
        const ordinary = await indexerWatermark({ sdkRegistry: { get: () => sdk }, chainId: BITCOIN });
        expect(ordinary.watermark).toBe(10_005);
        expect(sdk.explorer.get).toHaveBeenCalledTimes(1);
    });
});
