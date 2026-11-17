// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each poll option carries its own trash icon in the field's trailing slot,
// named "Remove option N". There is no separate Remove button. At the minimum
// of two options the icon stays but pressing it does nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qdevmock01aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 0 }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

beforeEach(() => {
    resetBackStackForTests();
    resetWalletModes();
    __clearTokenInfoCache();
    publishWalletModes({ activeWalletId: 'wallet-1' });
});
afterEach(cleanup);

async function mount() {
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging: messagingWith() },
        React.createElement(CreatePollForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} }),
    ));
    await screen.findByLabelText('Question');
}

const trash = (n) => screen.getByRole('button', { name: `Remove option ${n}` });

describe('Create poll: trash icon in each option field', () => {
    it('has no Remove button and a named trash icon inside every option field', async () => {
        await mount();
        expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
        for (const n of [1, 2]) {
            const field = screen.getByLabelText(`Option ${n}`);
            const button = trash(n);
            expect(button.querySelector('svg')).not.toBeNull();
            // The icon sits in the Input's own trailing action slot, beside the text box.
            expect(button.parentElement.className).toMatch(/controlActions/);
            expect(button.parentElement.parentElement).toBe(field.parentElement);
        }
    });

    it('does nothing at the minimum of two options, with no notice', async () => {
        await mount();
        expect(trash(1)).toHaveAttribute('aria-disabled', 'true');
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Yes' } });
        fireEvent.click(trash(1));
        fireEvent.click(trash(2));
        expect(screen.getByLabelText('Option 1')).toHaveValue('Yes');
        expect(screen.getByLabelText('Option 2')).toBeInTheDocument();
        expect(screen.queryByLabelText('Option 3')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('removes the pressed option above the minimum and renumbers the rest', async () => {
        await mount();
        fireEvent.click(screen.getByRole('button', { name: /^Add option/i }));
        expect(screen.getByLabelText('Option 3')).toBeInTheDocument();
        expect(trash(1)).not.toHaveAttribute('aria-disabled');
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'A' } });
        fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'B' } });
        fireEvent.change(screen.getByLabelText('Option 3'), { target: { value: 'C' } });
        fireEvent.click(trash(2));
        expect(screen.queryByLabelText('Option 3')).toBeNull();
        expect(screen.getByLabelText('Option 1')).toHaveValue('A');
        expect(screen.getByLabelText('Option 2')).toHaveValue('C');
        expect(trash(1)).toHaveAttribute('aria-disabled', 'true');
    });
});
