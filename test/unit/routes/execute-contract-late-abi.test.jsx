// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import * as walletModes from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const ABI = {
    version: 1,
    methods: {
        zzz: { params: [] },
        release: { params: [{ name: 'amount', type: 'amount' }] },
    },
};

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
}

async function flush() {
    await act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

function mount(abiReply) {
    // A wallet's mode is published by the shell from the wallet list, not read from settings.
    walletModes.publishWalletModes?.({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });
    const messaging = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getContractByActionIndex: () => abiReply.promise,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ExecuteContractForm
                walletId="wallet-1"
                chainId={CHAIN}
                contractActionIndex="41"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    walletModes.resetWalletModes?.();
});

describe('a contract abi that answers after the user typed a call', () => {
    it('keeps the typed method and arguments in the manual lane', async () => {
        const reply = deferred();
        mount(reply);
        fireEvent.change(await screen.findByLabelText('Method'), { target: { value: 'transfer' } });
        fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'alice|7' } });

        reply.resolve({ data: { abi: ABI } });
        await flush();

        expect(screen.getByLabelText('Method')).toHaveValue('transfer');
        expect(screen.getByLabelText('Arguments')).toHaveValue('alice|7');
        expect(screen.getByRole('button', { name: 'Use Declared Methods' })).toBeInTheDocument();
    });

    it('leaves the call under review untouched', async () => {
        const reply = deferred();
        mount(reply);
        fireEvent.change(await screen.findByLabelText('Method'), { target: { value: 'transfer' } });
        fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'alice|7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call Contract' }));
        await screen.findByRole('heading', { name: 'Review Contract Call' });

        reply.resolve({ data: { abi: ABI } });
        await flush();

        expect(screen.getByText('transfer')).toBeInTheDocument();
        expect(screen.queryByText('zzz')).toBeNull();
        expect(screen.getByText('alice')).toBeInTheDocument();
    });

    it('still selects the first declared method on an untouched form', async () => {
        const reply = deferred();
        mount(reply);
        await screen.findByLabelText('Method');
        reply.resolve({ data: { abi: ABI } });
        await flush();

        expect(screen.getByLabelText('Method')).toHaveValue('zzz');
    });
});
