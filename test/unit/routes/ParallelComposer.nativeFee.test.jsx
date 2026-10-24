// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const BTC = 'bitcoin-regtest';
const LTC = 'litecoin-regtest';
const record = (id, address) => ({
    id,
    address,
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});
const BTC_FROM = record('btc-1', 'bcrt1qparallelnativefeebtc00000000000000000');
const LTC_FROM = record('ltc-1', 'rltc1qparallelnativefeeltc00000000000000000');
const COMPOSED = {
    actionString: 'SWAP|0|LTC|AAA|1||BTC|BBB|1||bcrt1qdestination',
    action: 'SWAP',
    version: 0,
    psbt: 'parallel-psbt',
    encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};
afterEach(() => cleanup());

function swapParams(giveCoin, getCoin) {
    return {
        VERSION: '0',
        GIVE_COIN: giveCoin,
        GIVE_TICK: 'AAA',
        GIVE_AMOUNT: '1',
        GET_COIN: getCoin,
        GET_TICK: 'BBB',
        GET_AMOUNT: '1',
        GET_ADDRESS: 'bcrt1qdestination',
    };
}

async function signFirstRow(chainId, params) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [BTC]: [BTC_FROM], [LTC]: [LTC_FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [BTC]: BTC_FROM, [LTC]: LTC_FROM })),
        listActions: vi.fn(async () => ['SWAP']),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        validateAction: vi.fn(async () => ({ valid: true, errors: [] })),
        composeForConfirm: vi.fn(async () => COMPOSED),
        preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
        checkInputLiveness: vi.fn(async () => ({ verdict: 'live', spent: [] })),
        requoteNativeFee: vi.fn(async () => null),
        reserve: vi.fn(async () => {}),
        releaseReservation: vi.fn(async () => {}),
        advancedAction: vi.fn(async () => ({ txid: 'parallel-txid' })),
        buildActionPsbtRequest: vi.fn(async () => ({ psbtHex: 'aa00', encoding: 'psbt' })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={[{ chainId, action: 'SWAP', params }]}
            />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    return messaging.composeForConfirm.mock.calls[0][0];
}

describe('ParallelComposer native-coin protocol fee', () => {
    it('composes a row on a chain whose only fee lane is the native coin with the fee output', async () => {
        const call = await signFirstRow(LTC, swapParams('LTC', 'BTC'));

        expect(call.chainId).toBe(LTC);
        expect(call.encoderOpts.payFeeInNativeCoin).toBe(true);
    });

    it('leaves a Bitcoin row on the XCHAIN fee lane', async () => {
        const call = await signFirstRow(BTC, swapParams('BTC', 'LTC'));

        expect(call.chainId).toBe(BTC);
        expect(call.encoderOpts.payFeeInNativeCoin).toBeUndefined();
    });
});
