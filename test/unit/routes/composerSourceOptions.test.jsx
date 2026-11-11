// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Both composers show their source in the standard read-only address field,
// which opens the own-address picker; no source address is offered as a
// native select option.

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
])('%s source control', (_name, Form) => {
    it('shows the complete source in a read-only address field', async () => {
        mount(Form);
        const field = await screen.findByLabelText(/^From(?: address)?$/, { selector: 'input' });
        expect(field).toHaveValue(ADDRESS);
        expect(field).toHaveAttribute('readonly');
        expect(screen.queryByRole('combobox', { name: /^From(?: address)?$/ })).toBeNull();
    });
});
