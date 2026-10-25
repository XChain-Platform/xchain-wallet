// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN_ID = 'bitcoin-regtest';
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

function mount({ walletMode = 'full', messagingOverrides = {}, initialRows, onBack = () => {} } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [CHAIN_ID]: FROM })),
        listActions: vi.fn(async () => ['SEND']),
        getSettings: vi.fn(async () => ({ walletMode })),
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
        ...messagingOverrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={onBack}
                initialRows={initialRows || [{
                    chainId: CHAIN_ID,
                    action: 'SEND',
                    params: { VERSION: '0', TICK: 'TOKEN', AMOUNT: '1', DESTINATION: 'bc1qdestination' },
                }]}
            />
        </MessagingProvider>,
    );
    return messaging;
}

describe('ParallelComposer queued rows', () => {
    it('reports a signed row held in the broadcast queue as not broadcast', async () => {
        const queuedError = Object.assign(new Error('network down'), { name: 'BroadcastFailedTransientError' });
        const advancedAction = vi.fn().mockRejectedValue(queuedError);
        mount({ messagingOverrides: { advancedAction } });

        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));

        expect(await screen.findByText('Parallel run complete')).toBeTruthy();
        expect(screen.getByLabelText('Status: Signed, not broadcast')).toBeTruthy();
        expect(document.body.textContent).not.toMatch(/All rows broadcast/);
        expect(document.body.textContent).toMatch(/waiting in the queued-transactions banner/);
    });
});
