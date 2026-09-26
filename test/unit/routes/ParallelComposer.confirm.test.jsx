// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qparallelfromaddress000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const COMPOSED = {
    actionString: 'SEND|0|TOKEN|1|bc1qdestination',
    action: 'SEND',
    version: 0,
    psbt: 'parallel-psbt',
    encoding: 'OP_RETURN',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};

afterEach(() => cleanup());

function mount({ walletMode = 'full' } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode })),
        signerReady: vi.fn(async () => ({ ready: true })),
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
                initialRows={[{
                    chainId: CHAIN_ID,
                    action: 'SEND',
                    params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' },
                }]}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('ParallelComposer confirmation', () => {
    it('dry-runs and confirms each row before signing the composed PSBT', async () => {
        const messaging = mount();

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        await waitFor(() => expect(messaging.preflight).toHaveBeenCalledWith(expect.objectContaining({
            actionString: COMPOSED.actionString,
            source: FROM.address,
        })));
        expect(messaging.advancedAction).not.toHaveBeenCalled();
        expect(screen.getByLabelText(FROM.address)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

        await waitFor(() => expect(messaging.advancedAction).toHaveBeenCalledWith(expect.objectContaining({
            walletId: 'wallet-1',
            chainId: CHAIN_ID,
            from: expect.objectContaining({ address: FROM.address }),
            action: 'SEND',
            prebuiltPsbt: expect.objectContaining({ psbtHex: COMPOSED.psbt }),
        })));
        expect(await screen.findByText('Parallel run complete')).toBeTruthy();
    });

    it('shows an unsigned transaction without completing the row in watcher mode', async () => {
        const messaging = mount({ walletMode: 'watcher' });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));

        expect(await screen.findByRole('heading', {
            name: 'Unsigned transaction, ready for signing',
        })).toBeTruthy();
        expect(screen.getByLabelText('Unsigned transaction hex').value).toBe('aa00');
        expect(screen.queryByText('Parallel run complete')).toBeNull();
        expect(messaging.advancedAction).not.toHaveBeenCalled();
    });
});
