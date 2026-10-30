// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';

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

afterEach(() => cleanup());

describe('a contract abi that answers after the user typed a call', () => {
    it('keeps the typed method and arguments in the manual lane', async () => {
        const reply = deferred();
        mount(reply);
        fireEvent.change(await screen.findByLabelText('Method'), { target: { value: 'transfer' } });
        fireEvent.change(screen.getByLabelText('Arguments (optional)'), { target: { value: 'alice|7' } });

        reply.resolve({ data: { abi: ABI } });
        await flush();

        expect(screen.getByLabelText('Method')).toHaveValue('transfer');
        expect(screen.getByLabelText('Arguments (optional)')).toHaveValue('alice|7');
        expect(screen.getByRole('button', { name: 'Use declared methods' })).toBeInTheDocument();
    });

    it('leaves the call under review untouched', async () => {
        const reply = deferred();
        mount(reply);
        fireEvent.change(await screen.findByLabelText('Method'), { target: { value: 'transfer' } });
        fireEvent.change(screen.getByLabelText('Arguments (optional)'), { target: { value: 'alice|7' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
        await screen.findByRole('heading', { name: 'Review contract call' });

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
