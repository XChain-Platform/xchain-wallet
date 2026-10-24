// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Regression suite: Sign message autosaves a fresh form, offers a stored draft
// for an explicit Restore without overwriting it, and keeps saving after the
// draft is discarded.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { SignMessageForm } from '../../packages/core/src/shared/routes/SignMessageForm.jsx';

const WALLET_ID = 'sign-draft-wallet';
const KEY = `xc:formdraft:sign-message:${WALLET_ID}`;
const CHAIN_ID = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source-1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    role: 'receive',
};

function createMessaging() {
    const target = {
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: 'mainnet',
            privacy: { formDraftTtlMs: 86_400_000 },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN_ID]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN_ID]: SOURCE }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mountForm() {
    return render(
        <MessagingProvider shell="web" messaging={createMessaging()}>
            <SignMessageForm walletId={WALLET_ID} onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Sign message draft autosave', () => {
    it('saves what a user types into a fresh form', async () => {
        mountForm();
        fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'hello draft' } });
        await waitFor(() => {
            expect(localStorage.getItem(KEY)).toContain('hello draft');
        });
    });

    it('offers a stored draft for Restore and leaves it stored until then', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values: { chainId: CHAIN_ID, addressId: SOURCE.id, message: 'stored text' },
        }));
        mountForm();
        const restore = await screen.findByRole('button', { name: 'Restore' });
        expect(localStorage.getItem(KEY)).toContain('stored text');
        fireEvent.click(restore);
        await waitFor(() => {
            expect(screen.getByLabelText('Message')).toHaveValue('stored text');
        });
    });

    it('keeps saving after the stored draft is discarded', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values: { chainId: CHAIN_ID, addressId: SOURCE.id, message: 'stored text' },
        }));
        mountForm();
        await screen.findByRole('button', { name: 'Restore' });
        fireEvent.click(screen.getByRole('button', { name: 'Discard saved draft' }));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'after discard' } });
        await waitFor(() => {
            expect(localStorage.getItem(KEY)).toContain('after discard');
        });
    });
});
