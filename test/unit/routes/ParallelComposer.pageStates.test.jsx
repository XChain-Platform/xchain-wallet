// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the parallel composer lays out through a page template: the
// load error, the loading line, the watcher result and the finished run sit
// inside ListPage (or the FormPage form), never straight in the Screen box.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';

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
afterEach(() => {
    cleanup();
    // Each test publishes its own wallet mode; forget it.
    resetWalletModes();
});

function mount({ walletMode = 'full', messagingOverrides = {} } = {}) {
    // Wallet mode is a property of the wallet record, not of settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
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

function listPageSelector() {
    const probe = render(<ListPage><p>x</p></ListPage>);
    const name = probe.container.firstChild.className.split(' ')[0];
    probe.unmount();
    return '.' + CSS.escape(name);
}

function expectInsideTemplate(element) {
    const inside = element.closest(listPageSelector()) || element.closest('form');
    expect(inside, 'inside ListPage or FormPage').not.toBeNull();
}

async function runToSign() {
    fireEvent.click(await screen.findByRole('button', { name: 'Sign and Send Queue' }));
    await screen.findByRole('button', { name: 'Sign all' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign' }));
}

describe('ParallelComposer page templates', () => {
    it('lays out the load error inside a page template', async () => {
        mount({ messagingOverrides: { getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) } });
        expectInsideTemplate(await screen.findByText(/Address store unavailable|Failed to load wallet/));
    });

    it('lays out the no-address notice inside a page template', async () => {
        mount({ messagingOverrides: { getAddressesByChain: vi.fn(async () => ({})) } });
        expectInsideTemplate(await screen.findByText(/No addresses on any network yet/));
    });

    it('lays out the loading line inside a page template', () => {
        mount({ messagingOverrides: { getAddressesByChain: vi.fn(() => new Promise(() => {})) } });
        expectInsideTemplate(screen.getByText('Loading wallet…'));
    });

    it('lays out the finished run and its Done action inside a page template', async () => {
        mount();
        await runToSign();
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        expectInsideTemplate(await screen.findByText('Parallel run complete'));
        expectInsideTemplate(screen.getByText(/All rows broadcast/));
        expectInsideTemplate(screen.getByRole('button', { name: 'Done' }));
    });

    it('lays out the watcher result inside a page template', async () => {
        mount({ walletMode: 'watcher' });
        await runToSign();
        expectInsideTemplate(await screen.findByText('Unsigned transaction, ready for signing'));
        expectInsideTemplate(screen.getByLabelText('Unsigned transaction code'));
    });

    it('answers a missing signing source without disabling Sign', async () => {
        const addresses = { [CHAIN_ID]: [FROM] };
        const messaging = mount({
            messagingOverrides: {
                getAddressesByChain: vi.fn(async () => addresses),
            },
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Sign and Send Queue' }));
        addresses[CHAIN_ID].splice(0);
        fireEvent.click(await screen.findByRole('button', { name: 'Sign all' }));

        const sign = await screen.findByRole('button', { name: 'Sign' });
        expect(sign).not.toBeDisabled();
        fireEvent.click(sign);

        expect(await within(screen.getByLabelText('Form errors')).findByText('Choose an available From address before signing this action.')).toBeInTheDocument();
        expect(document.getElementById('parallel-sign-from')).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
