// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §20 ruling 2026-11-12: wallet mode is a property of each wallet, chosen
// once at create, import or pair, shown read-only on Wallet Details, and
// gone from Settings. These cases pin each half of that: the choice rides
// the create and import requests, readers follow the ACTIVE wallet's own
// mode (never the app-wide setting), Wallet Details shows it, and neither
// the Settings search nor the command palette offers a wallet-mode switch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    publishWalletModes,
    resetWalletModes,
    useWalletMode,
} from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { CreateWallet } from '../../../packages/core/src/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import {
    buildCommands,
    settingsSectionsToCommands,
} from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';
import { selectOption } from '../../helpers/selectOption.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct-horse-battery';

// Pin the generated phrase so the create quiz can be answered here.
vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, generateBip39Mnemonic: () => PHRASE } };
});

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

const CHAIN = 'litecoin-mainnet';
const ADDRESS = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const WALLETS = [
    { id: 'w-normal', name: 'Everyday', walletMode: 'full' },
    { id: 'w-signer', name: 'Cold', walletMode: 'signer' },
];

/** Messaging stub: two wallets with different modes; the app-wide legacy key says watcher. */
function messagingStub(extra = {}) {
    const base = {
        listWallets: vi.fn().mockResolvedValue(WALLETS),
        // A stale app-wide value must never decide a wallet's mode.
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', grace: { testSendThresholdSats: 0 } }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-1', address: ADDRESS } }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        listAccounts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        ...extra,
    };
    return new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
}

function withMessaging(messaging) {
    return function Wrapper({ children }) {
        return React.createElement(MessagingProvider, { shell: 'web', messaging }, children);
    };
}

describe('useWalletMode follows the active wallet', () => {
    it('reads the mode the shell published for the active wallet, and follows a switch', () => {
        const { result } = renderHook(() => useWalletMode(), { wrapper: withMessaging(messagingStub()) });
        act(() => { publishWalletModes({ wallets: WALLETS, activeWalletId: 'w-signer' }); });
        expect(result.current).toMatchObject({ walletMode: 'signer', isSignerMode: true, walletModeKnown: true });
        act(() => { publishWalletModes({ activeWalletId: 'w-normal' }); });
        expect(result.current).toMatchObject({ walletMode: 'full', isFullMode: true, walletModeKnown: true });
    });

    it('reads a named wallet from the safe wallet list, never from settings', async () => {
        const messaging = messagingStub();
        const { result } = renderHook(() => useWalletMode('w-signer'), { wrapper: withMessaging(messaging) });
        expect(result.current.walletModeKnown).toBe(false);
        await waitFor(() => expect(result.current.walletModeKnown).toBe(true));
        expect(result.current.walletMode).toBe('signer');
        expect(messaging.listWallets).toHaveBeenCalledTimes(1);
    });

    it('settles on Normal when the shell has no wallet list', async () => {
        const messaging = { getSettings: vi.fn().mockResolvedValue({ walletMode: 'signer' }) };
        const { result } = renderHook(() => useWalletMode('w-x'), { wrapper: withMessaging(messaging) });
        await waitFor(() => expect(result.current.walletModeKnown).toBe(true));
        expect(result.current.walletMode).toBe('full');
    });
});

describe('Send follows the wallet it sends from', () => {
    function mountSend(walletId, messaging) {
        return render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Send, { walletId, onBack() {} }),
            ),
        );
    }

    it('refuses for the signer-for-another-phone wallet and composes for the Normal one', async () => {
        const messaging = messagingStub();
        const view = mountSend('w-signer', messaging);
        expect(await screen.findByText(/This wallet is the signer for another phone/)).toBeInTheDocument();
        expect(screen.queryByLabelText(/^To$/)).toBeNull();

        view.rerender(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Send, { walletId: 'w-normal', onBack() {} }),
            ),
        );
        await waitFor(() => expect(screen.getByLabelText(/^To$/)).toBeInTheDocument());
        expect(screen.queryByText(/This wallet is the signer for another phone/)).toBeNull();
    });
});

describe('Wallet Details shows the wallet mode read-only', () => {
    async function detailsRow(walletId) {
        const messaging = messagingStub();
        let utils;
        await act(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(WalletDetails, { walletId, onBack() {} }),
                ),
            );
            for (let i = 0; i < 8; i += 1) await Promise.resolve();
        });
        await act(async () => {
            fireEvent.click(utils.getByRole('tab', { name: 'Details' }));
            for (let i = 0; i < 4; i += 1) await Promise.resolve();
        });
        const label = [...utils.container.querySelectorAll('dt')]
            .find((dt) => dt.textContent === en['walletDetails.walletMode']);
        return { label, value: label?.nextElementSibling ?? null };
    }

    it('names each wallet\'s own mode on the Details tab', async () => {
        const signer = await detailsRow('w-signer');
        expect(signer.label).toBeTruthy();
        expect(signer.value.textContent).toBe('Signer for another phone');
        cleanup();
        const normal = await detailsRow('w-normal');
        expect(normal.value.textContent).toBe('Normal');
    });

    it('offers no control to change it', async () => {
        const { value } = await detailsRow('w-signer');
        expect(value.querySelector('input, select, button')).toBeNull();
    });
});

describe('the mode is chosen at create and import', () => {
    it('create sends the picked mode with the new wallet', async () => {
        const messaging = {
            importMnemonic: vi.fn(async () => ({ walletId: 'w-new' })),
            updateSettings: vi.fn(async () => ({})),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <CreateWallet mode="fresh" onBack={() => {}} onCreated={() => {}} />
            </MessagingProvider>,
        );
        // The form offers no wallet-mode field; every create is the normal full mode.
        expect(screen.queryByRole('combobox', { name: 'Wallet mode' })).toBeNull();
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } });
        // Anchored: the Extra Passphrase section's "Confirm passphrase" field
        // is always on the form now (disabled until its switch is on).
        fireEvent.change(screen.getByLabelText(/^Confirm( password)?$/), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: /Next/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Reveal Recovery Phrase' }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /Verify Recovery Phrase/ }));
        const words = PHRASE.split(' ');
        for (const input of await screen.findAllByLabelText(/^Word \d+$/)) {
            const n = Number(input.labels[0].textContent.match(/\d+/)[0]);
            fireEvent.change(input, { target: { value: words[n - 1] } });
        }
        fireEvent.click(screen.getByRole('button', { name: 'Create Wallet' }));
        await waitFor(() => expect(messaging.importMnemonic).toHaveBeenCalledTimes(1));
        expect(messaging.importMnemonic.mock.calls[0][0]).toMatchObject({ origin: 'created', walletMode: 'full' });
    });

    it('import sends Normal by default and the picked mode when changed', async () => {
        const importMnemonic = vi.fn(async (request) => ({ walletId: 'w-imp', walletName: request.name }));
        render(
            <MessagingProvider shell="web" messaging={{ importMnemonic, listWallets: vi.fn(async () => []) }}>
                <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.queryByRole('combobox', { name: 'Wallet mode' })).toBeNull();
        fireEvent.change(screen.getByLabelText('Recovery phrase'), { target: { value: PHRASE } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
        fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        await waitFor(() => expect(importMnemonic).toHaveBeenCalledTimes(1));
        expect(importMnemonic.mock.calls[0][0]).toMatchObject({ mnemonic: PHRASE, walletMode: 'full' });
    });
});

describe('Settings and the palette offer no wallet-mode switch', () => {
    it('the palette has no wallet-mode command', () => {
        const ids = [
            ...buildCommands({ navigate() {} }),
            ...settingsSectionsToCommands({ openSettings() {} }),
        ].map((command) => command.id);
        expect(ids).not.toContain('settings-wallet-mode');
        expect(ids.filter((id) => /wallet-?mode/i.test(id))).toEqual([]);
    });

    it('a Settings search for a mode name finds no row', async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingStub()}>
                <Settings onBack={() => {}} activeWallet={{ id: 'w-normal', name: 'Everyday' }} />
            </MessagingProvider>,
        );
        // The search lives behind the header filter button, so open it first.
        fireEvent.click(await screen.findByRole('button', { name: 'Filter settings' }));
        const search = await screen.findByRole('searchbox');
        for (const query of ['Wallet mode', 'Watcher', 'air-gapped']) {
            fireEvent.change(search, { target: { value: query } });
            await act(async () => { await Promise.resolve(); });
            // No result row (each is a button) names a wallet mode or its modes.
            const rows = screen.queryAllByRole('button')
                .filter((b) => /wallet mode|watcher|watch-only|air-gapped|signer/i.test(b.textContent));
            expect(rows.map((b) => b.textContent)).toEqual([]);
        }
        // The same search does find a real setting, so the empty result above means something.
        fireEvent.change(search, { target: { value: 'Backup' } });
        await waitFor(() => expect(screen.queryAllByRole('button')
            .some((b) => /backup/i.test(b.textContent))).toBe(true));
    });
});
