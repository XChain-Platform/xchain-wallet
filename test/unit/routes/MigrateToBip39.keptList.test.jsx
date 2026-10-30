// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// After the new BIP39 wallet is saved, the migration's sweep list lives
// outside the wizard screen. Leaving for a sweep and coming back, or opening
// the wizard again from the legacy wallet, lands on the same list for the
// same wallet pair with swept rows marked, instead of a fresh upgrade that
// makes another phrase and another wallet.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WORDS = PHRASE.split(' ');
const CHAIN = 'migration-test-chain';

const legacy = (index) => ({
    id: `legacy-${index}`,
    address: `legacy-address-${index}`,
    derivationPath: `m/0'/0/${index}`,
    source: 'hd',
});
const LEGACY_BY_CHAIN = { [CHAIN]: [0, 1, 2, 3, 4].map(legacy) };
const NEW_BY_CHAIN = {
    [CHAIN]: [{ id: 'new-address-id', address: 'new-address', derivationPath: "m/44'/0'/0'/0/0", source: 'hd' }],
};

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';
import {
    clearMigrationSweeps,
    markMigrationSwept,
    pendingMigrationSweeps,
    readMigrationSweeps,
} from '../../../packages/core/src/flows/migrationSweeps.js';

afterEach(() => {
    cleanup();
    clearMigrationSweeps();
    localStorage.clear();
});

function makeMessaging({ wallets = ['wallet-old', 'wallet-new'] } = {}) {
    return {
        getAddressesByChain: vi.fn(async (walletId) => (walletId === 'wallet-old' ? LEGACY_BY_CHAIN : NEW_BY_CHAIN)),
        addImportedWallet: vi.fn().mockResolvedValue({ walletId: 'wallet-new' }),
        listWallets: vi.fn(async () => wallets.map((id) => ({ id }))),
    };
}

function mount(messaging, props = {}) {
    const onBack = vi.fn();
    const onSweepChain = vi.fn();
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MigrateToBip39
                legacyWalletId="wallet-old"
                onBack={onBack}
                onMigrated={vi.fn()}
                onSweepChain={onSweepChain}
                {...props}
            />
        </MessagingProvider>,
    );
    return { ...view, onBack, onSweepChain };
}

async function upgradeToDone(messaging) {
    const mounted = mount(messaging);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal recovery phrase' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    await screen.findByRole('heading', { level: 1, name: 'Verify your written copy' });
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: WORDS[position - 1] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));
    await screen.findByRole('heading', { level: 1, name: 'New BIP39 wallet ready' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review sweep' })).toHaveLength(5));
    return mounted;
}

function sweepRow(index) {
    markMigrationSwept('wallet-old', {
        newWalletId: 'wallet-new',
        chainId: CHAIN,
        fromAddress: `legacy-address-${index}`,
        txid: `txid-${index}`,
    });
}

describe('MigrateToBip39 keeps its sweep list outside the screen', () => {
    it('keeps the wallet pair and every listed address once the new wallet is saved', async () => {
        const messaging = makeMessaging();
        await upgradeToDone(messaging);
        await waitFor(() => expect(readMigrationSweeps('wallet-old')?.listed).toBe(true));
        const record = readMigrationSweeps('wallet-old');
        expect(record.newWalletId).toBe('wallet-new');
        expect(record.rows.map((row) => row.fromAddress)).toEqual([0, 1, 2, 3, 4].map((i) => `legacy-address-${i}`));
        expect(record.rows.every((row) => row.toAddress === 'new-address' && row.swept === false)).toBe(true);
    });

    it('returns from a sweep to the same list with that row marked and the rest still offered', async () => {
        const messaging = makeMessaging();
        const first = await upgradeToDone(messaging);
        fireEvent.click(screen.getAllByRole('button', { name: 'Review sweep' })[0]);
        expect(first.onSweepChain).toHaveBeenCalledWith(expect.objectContaining({ fromAddress: 'legacy-address-0' }));
        first.unmount();
        sweepRow(0);

        const back = mount(messaging, { resumeList: true });
        expect(screen.getByRole('heading', { level: 1, name: 'New BIP39 wallet ready' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review sweep' })).toHaveLength(4));
        expect(screen.getByText('txid-0')).toBeInTheDocument();
        expect(screen.getByText('Swept')).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole('button', { name: 'Review sweep' })[0]);
        expect(back.onSweepChain).toHaveBeenLastCalledWith(expect.objectContaining({
            legacyWalletId: 'wallet-old',
            newWalletId: 'wallet-new',
            fromAddress: 'legacy-address-1',
            toAddress: 'new-address',
        }));
        // No second wallet is made on the way back.
        expect(messaging.addImportedWallet).toHaveBeenCalledTimes(1);
    });

    it('opens on the list from the legacy wallet while any row is unswept', async () => {
        const messaging = makeMessaging();
        (await upgradeToDone(messaging)).unmount();
        sweepRow(0);
        sweepRow(1);

        mount(messaging);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Review sweep' })).toHaveLength(3));
        expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    });

    it('starts a fresh upgrade once every row is swept, but shows the finished list on the way back from the last sweep', async () => {
        const messaging = makeMessaging();
        (await upgradeToDone(messaging)).unmount();
        for (const i of [0, 1, 2, 3, 4]) sweepRow(i);
        expect(pendingMigrationSweeps('wallet-old')).toBeNull();

        const back = mount(messaging, { resumeList: true });
        await waitFor(() => expect(screen.getAllByText('Swept')).toHaveLength(5));
        expect(screen.queryByRole('button', { name: 'Review sweep' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Dismiss list' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(back.onBack).toHaveBeenCalled();
        expect(readMigrationSweeps('wallet-old')).toBeNull();
        back.unmount();

        mount(messaging);
        expect(screen.getByRole('heading', { level: 1, name: 'Upgrade to a BIP39 recovery phrase' })).toBeInTheDocument();
    });

    it('Dismiss list stops offering the list', async () => {
        const messaging = makeMessaging();
        const first = await upgradeToDone(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Dismiss list' }));
        expect(first.onBack).toHaveBeenCalled();
        expect(readMigrationSweeps('wallet-old')).toBeNull();
        first.unmount();

        mount(messaging);
        expect(screen.getByRole('heading', { level: 1, name: 'Upgrade to a BIP39 recovery phrase' })).toBeInTheDocument();
    });

    it('drops a kept list whose destination wallet is gone and starts over', async () => {
        (await upgradeToDone(makeMessaging())).unmount();
        const messaging = makeMessaging({ wallets: ['wallet-old'] });

        mount(messaging);
        await screen.findByRole('heading', { level: 1, name: 'Upgrade to a BIP39 recovery phrase' });
        expect(readMigrationSweeps('wallet-old')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Review sweep' })).toBeNull();
    });
});
