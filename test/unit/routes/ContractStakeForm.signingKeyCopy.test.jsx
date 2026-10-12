// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The contract staking form names the signing key the same way on the input,
// in its validation error and on the review screen, in every mode.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractStakeForm } from '../../../packages/core/src/shared/routes/ContractStakeForm.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESS = 'bcrt1qactiveactiveactiveactiveactiveactive0';

function mountForm(props, walletMode = 'full') {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/1'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-1', address: ADDRESS } }),
        getContractByActionIndex: vi.fn().mockResolvedValue({
            row: { cooldown_blocks: 10, slash_destination: 'bcrt1qslashdestinationexampleexampleexample' },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ContractStakeForm, {
                walletId: 'w',
                chainId: CHAIN,
                contractActionIndex: '2048',
                onBack() {},
                ...props,
            }),
        ),
    );
}

async function submitUntil(check) {
    await screen.findByLabelText('From');
    const form = screen.getByLabelText(/signing public key/i).closest('form');
    await waitFor(() => {
        if (form.isConnected) fireEvent.submit(form);
        check();
    });
}

const reviewLabels = () => [...document.querySelectorAll('dt')].map((el) => el.textContent);

afterEach(() => cleanup());

describe('ContractStakeForm signing-key copy', () => {
    it('words the stake-mode key error with the input label', async () => {
        mountForm({ initialMode: 'stake', initialSigningPubkey: 'abc' });
        await submitUntil(() => expect(document.body.textContent)
            .toContain('The signing public key must be exactly 64 characters'));
        expect(document.body.textContent).not.toContain('Signing pubkey');
        expect(document.body.textContent).not.toContain('(Ed25519).');
    });

    it('words the delegate-mode key error with the new-key label', async () => {
        mountForm({ initialMode: 'delegate', initialSigningPubkey: 'abc' });
        await submitUntil(() => expect(document.body.textContent)
            .toContain('The new signing public key must be exactly 64 characters'));
    });

    it('labels the review row like the input in delegate mode', async () => {
        mountForm({ initialMode: 'delegate', initialTick: 'XCHAIN', initialSigningPubkey: 'a'.repeat(64) }, 'watcher');
        await submitUntil(() => expect(reviewLabels()).toContain('New signing public key'));
        expect(reviewLabels()).not.toContain('Signing pubkey');
    });
});
