// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression (xchain-wallet#56): the Create screen persists its generated
// phrase through the import lanes (`wallet.import` on a fresh install,
// `wallet.add.import` on an open vault) and sent no origin, so the flow
// labeled every created wallet "Imported from a recovery phrase". Both
// lanes must now carry origin 'created'.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Pin the generated phrase so the quiz can be answered from the test.
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE } };
});

async function createThroughQuiz(mode) {
    const messaging = {
        importMnemonic: vi.fn(async () => ({ walletId: 'w-new' })),
        addImportedWallet: vi.fn(async () => ({ wallet: { id: 'w-new' } })),
        updateSettings: vi.fn(async () => ({})),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CreateWallet mode={mode} onBack={() => {}} onCreated={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'correct-horse-battery' } });
    fireEvent.change(screen.getByLabelText(/^Confirm/), { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /Verify recovery phrase/ }));

    const words = PHRASE.split(' ');
    for (const input of await screen.findAllByLabelText(/^Word \d+$/)) {
        const n = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: words[n - 1] } });
    }
    fireEvent.click(screen.getByRole('button', { name: /Create wallet/ }));
    return messaging;
}

describe('Create new wallet records origin "created"', () => {
    it('on a fresh install (wallet.import lane)', async () => {
        const messaging = await createThroughQuiz('fresh');
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalledTimes(1));
        expect(messaging.importMnemonic.mock.calls[0][0]).toMatchObject({ mnemonic: PHRASE, origin: 'created' });
    });

    it('when adding to an open vault (wallet.add.import lane)', async () => {
        const messaging = await createThroughQuiz('add');
        await waitFor(() => expect(messaging.addImportedWallet).toHaveBeenCalledTimes(1));
        expect(messaging.addImportedWallet.mock.calls[0][0]).toMatchObject({ mnemonic: PHRASE, origin: 'created' });
    });
});
