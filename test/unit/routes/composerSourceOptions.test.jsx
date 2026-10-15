// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The batch and parallel composers pick their source address from a native
// select, which cannot shorten its text. A full 42-character address ran
// under the chevron and was cut off at phone width, so the options use the
// wallet's usual first6…last6 form. The value stays the address record id.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qsourceaddressthatistoolongforaphonerow00';
const FROM = {
    id: 'addr-0',
    address: ADDRESS,
    publicKey: '02a0',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(Form) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: FROM.id, address: ADDRESS } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listActions: vi.fn().mockResolvedValue(['SEND']),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Form, { walletId: 'w', onBack() {} }),
    ));
}

afterEach(() => cleanup());

describe.each([
    ['BatchComposerForm', BatchComposerForm],
    ['ParallelComposer', ParallelComposer],
])('%s source options', (_name, Form) => {
    it('shows the source address as first6…last6 and keeps the record id as the value', async () => {
        mount(Form);
        const select = await screen.findByLabelText('From address');
        const short = `${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-6)}`;
        expect(await screen.findByRole('option', { name: short })).toBeTruthy();
        expect(select.value).toBe(FROM.id);
        expect(select.textContent).not.toContain(ADDRESS);
    });
});
