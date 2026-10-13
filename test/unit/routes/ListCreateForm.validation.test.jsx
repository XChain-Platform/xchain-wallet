// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});

function mount(initialType = '2') {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION|TYPE|MEMO|...ITEM' }),
        getTokenInfo: vi.fn().mockResolvedValue(null),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm
                walletId="wallet-1"
                chainId={CHAIN}
                initialType={initialType}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('ListCreateForm validation recovery', () => {
    it('surfaces click-to-upload read errors', async () => {
        class FailingFileReader {
            readAsText() {
                this.error = new Error('CSV read failed.');
                this.onerror();
            }
        }
        vi.stubGlobal('FileReader', FailingFileReader);
        mount();

        const input = await screen.findByLabelText('Upload CSV of addresses');
        fireEvent.change(input, {
            target: { files: [new File(['address\nrow'], 'members.csv', { type: 'text/csv' })] },
        });

        expect(await screen.findByText('CSV read failed.')).toBeTruthy();
    });

    it('clears stale validation when token members are added or removed', async () => {
        mount('1');
        const members = await screen.findByLabelText('Tokens (one per line)');
        const publish = screen.getByRole('button', { name: 'Publish list' });

        fireEvent.click(publish);
        expect(await screen.findByText('Add at least one token.')).toBeTruthy();

        fireEvent.change(members, { target: { value: 'XCHAIN' } });
        await waitFor(() => expect(screen.queryByText('Add at least one token.')).toBeNull());

        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'bad|memo' } });
        fireEvent.click(publish);
        expect(await screen.findByText('Memo cannot contain | or ; characters.')).toBeTruthy();

        fireEvent.change(members, { target: { value: '' } });
        await waitFor(() => expect(screen.queryByText('Memo cannot contain | or ; characters.')).toBeNull());
    });
});
