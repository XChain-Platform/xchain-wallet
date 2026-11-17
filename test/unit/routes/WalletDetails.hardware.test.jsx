// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet's Wallet Details (hw-4 layout 1): the device card with
// Actions and Details tabs and no account list of its own (G131: an Accounts
// row opens the shared My Accounts page); no phrase, backup or export rows; an
// Unlink row in the plain tone that opens its own page with one notice and one
// green Unlink Wallet button, no Cancel. Unlinking the last wallet runs the real
// removeWallet flow and leaves the app on Welcome.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { UnlinkHardwareWallet, unlinkNotice } from '../../../packages/core/src/shared/components/UnlinkHardwareWallet.jsx';
import { cardStatus } from '../../../packages/core/src/shared/components/HardwareWalletDetails.jsx';
import { removeWallet } from '../../../packages/core/src/flows/removeWallet.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const wipe = vi.hoisted(() => ({ wipeWalletStorage: vi.fn(async () => {}) }));

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', async (importOriginal) => ({
    ...(await importOriginal()),
    wipeWalletStorage: wipe.wipeWalletStorage,
}));
vi.mock('../../../packages/core/src/flows/gatedContent.js', () => ({ clearGatedContentCaches: () => {} }));
vi.mock('../../../packages/core/src/flows/gatedPublishAction.js', () => ({ clearPendingGeneratedKeysForWallet: () => {} }));

const HW = {
    id: 'hw-1', name: 'My Trezor', format: 'hardware', origin: 'connected-hardware',
    encryptedSeed: '', importedKeys: [], passphraseEnabled: false, walletMode: 'full',
    createdAt: '2026-11-15T10:00:00.000Z',
};
const SOFT = { id: 'soft-1', name: 'Everyday', format: 'bip39', origin: 'created', passphraseEnabled: false };
const SIGNER = { id: 'sig-1', walletId: HW.id, kind: 'trezor', vendor: 'trezor', model: 'Safe 3', deviceIdentifier: 'dev-1' };
const ADDRESSES = {
    'bitcoin-mainnet': [{ address: 'bc1qaaa', derivationPath: "m/84'/0'/0'/0/0", source: 'trezor', signerId: SIGNER.id }],
    'litecoin-mainnet': [{ address: 'ltc1qbbb', derivationPath: "m/84'/2'/0'/0/0", source: 'trezor', signerId: SIGNER.id }],
    'dogecoin-mainnet': [{ address: 'Dccc', derivationPath: "m/44'/3'/0'/0/0", source: 'trezor', signerId: SIGNER.id }],
};

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function messagingFor(overrides = {}) {
    return {
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listAccounts: () => Promise.resolve([{ id: 'a1', walletId: HW.id, index: 0 }]),
        listWallets: () => Promise.resolve([SOFT, HW]),
        listSigners: () => Promise.resolve([SIGNER]),
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        getAddressesByChain: () => Promise.resolve(ADDRESSES),
        hardwareBalances: ({ items }) => Promise.resolve(items.map((item) => ({ ...item, balance: '12500.12345678', fiat: null }))),
        ...overrides,
    };
}

async function renderDetails(props = {}, messaging = messagingFor()) {
    await act(async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <WalletDetails walletId={HW.id} activeWalletId={SOFT.id} onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

describe('Wallet Details for a hardware wallet', () => {
    it('shows the device card and the Actions and Details tabs, with an Accounts row into the shared pages', async () => {
        const onOpenAccounts = vi.fn();
        await renderDetails({ onRename: () => {}, onReconnect: () => {}, onOpenAccounts, onMakeActive: () => {} });
        const card = document.querySelector('[data-hardware-device-card]');
        expect(card).toHaveAttribute('data-status', 'connected');
        expect(card).toHaveTextContent('My Trezor');
        const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
        expect(tabs).toEqual(['Actions', 'Details']);
        const actions = screen.getByRole('list', { name: 'Hardware wallet actions' });
        expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual([
            expect.stringMatching(/^Set as active wallet/),
            expect.stringMatching(/^Reconnect/),
            expect.stringMatching(/^Rename/),
            expect.stringMatching(/^Accounts/),
            expect.stringMatching(/^Unlink/),
        ]);
        fireEvent.click(within(actions).getByRole('button', { name: /^Accounts/ }));
        expect(onOpenAccounts).toHaveBeenCalledWith(expect.objectContaining({ id: HW.id }));
        // No per-network account list of its own.
        expect(screen.queryByRole('list', { name: 'Hardware wallet accounts' })).toBeNull();
    });

    it('hides the recovery phrase, backup, export, address check and Remove rows', async () => {
        await renderDetails({
            onRename: () => {}, onShowRecoveryPhrase: () => {}, onExportBackup: () => {}, onRemoveWallet: () => {},
            onMigrateToBip39: () => {},
        }, messagingFor({ discoverAddresses: () => Promise.resolve() }));
        expect(screen.queryByRole('button', { name: /recovery phrase/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /export backup/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /check.*address/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Remove wallet/ })).toBeNull();
    });

    it('keeps the Device Access note over the device facts under Details', async () => {
        await renderDetails();
        fireEvent.click(screen.getByRole('tab', { name: /Details/ }));
        const panel = screen.getByRole('tabpanel');
        const accessNotice = within(panel).getByRole('note');
        expect(accessNotice).toHaveTextContent('Device Access');
        expect(panel.firstElementChild).toBe(accessNotice.closest('[data-variant]') || accessNotice);
        const facts = within(panel);
        expect(facts.getByText('Trezor Safe 3')).toBeInTheDocument();
        expect(facts.getByText('Connected')).toBeInTheDocument();
        expect(facts.getByText('1')).toBeInTheDocument();
    });

    it('draws Unlink as a plain row and opens its own page with one notice and one green button', async () => {
        await renderDetails();
        const unlinkRow = screen.getByRole('button', { name: /^Unlink/ });
        expect(unlinkRow.closest('[data-tone]')).toHaveAttribute('data-tone', 'default');
        fireEvent.click(unlinkRow);
        expect(screen.getByRole('heading', { name: 'Unlink Wallet' })).toBeInTheDocument();
        expect(screen.getByRole('note')).toHaveTextContent(
            'This removes My Trezor and its 1 account from this app. Your coins stay on the Trezor; connect it again any time to see them.',
        );
        const notice = screen.getByRole('note');
        const card = document.querySelector('[data-hardware-device-card]');
        expect(notice).toHaveTextContent('Coins Stay Safe');
        expect(notice.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
        const button = screen.getByRole('button', { name: 'Unlink Wallet' });
        expect(button).toHaveClass(buttonStyles.success);
        expect(button).not.toHaveClass(buttonStyles.danger);
    });

    it('unlinks a wallet that is not active and hands back to the host', async () => {
        const removeWalletCall = vi.fn(() => Promise.resolve({}));
        const onUnlinked = vi.fn();
        await renderDetails({ onUnlinked }, messagingFor({ removeWallet: removeWalletCall }));
        fireEvent.click(screen.getByRole('button', { name: /^Unlink/ }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlink Wallet' }));
            for (let i = 0; i < 8; i += 1) await Promise.resolve();
        });
        expect(removeWalletCall).toHaveBeenCalledWith({ walletId: HW.id });
        expect(onUnlinked).toHaveBeenCalledWith(HW.id);
        expect(wipe.wipeWalletStorage).not.toHaveBeenCalled();
    });
});

// An in-memory vault the real removeWallet flow can run on.
function memoryVault({ wallets, signers, accounts, addresses }) {
    const tables = {
        wallets, signers, accounts, addresses,
        connectedSites: [], pendingTxs: [], pendingAirdrops: [], pendingDeploys: [],
        multisigSigningSessions: [], coSignerAccounts: [], watchlistEntries: [],
        priceAlerts: [], gatedKeys: [], autopayOrders: [],
    };
    const collection = (name) => ({
        get: async (id) => tables[name].find((r) => r.id === id) || null,
        list: async () => [...tables[name]],
        findBy: async (field, value) => tables[name].filter((r) => r[field] === value),
        put: async (record) => {
            tables[name] = [...tables[name].filter((r) => r.id !== record.id), record];
        },
        delete: async (id) => {
            tables[name] = tables[name].filter((r) => r.id !== id);
        },
    });
    const vault = Object.fromEntries(Object.keys(tables).map((name) => [name, collection(name)]));
    return { vault, tables };
}

describe('Unlinking the last wallet', () => {
    it('removes the wallet and its signer through removeWallet, clears the vault and reloads to Welcome', async () => {
        const { vault, tables } = memoryVault({
            wallets: [HW],
            signers: [SIGNER],
            accounts: [{ id: 'a1', walletId: HW.id, index: 0 }],
            addresses: [{ id: 'ad1', accountId: 'a1', address: 'bc1qaaa', chain: 'bitcoin', network: 'mainnet' }],
        });
        const messaging = {
            removeWallet: ({ walletId }) => removeWallet({ vault, walletId }),
            listWallets: () => vault.wallets.list(),
        };
        const reload = vi.fn();
        const onUnlinked = vi.fn();
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <UnlinkHardwareWallet
                        wallet={HW}
                        signer={SIGNER}
                        accountCount={1}
                        activeWalletId={null}
                        onBack={() => {}}
                        onUnlinked={onUnlinked}
                        reload={reload}
                    />
                </MessagingProvider>,
            );
        });
        expect(screen.getByRole('note')).toHaveTextContent('This removes My Trezor and its 1 account from this app.');
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlink Wallet' }));
            for (let i = 0; i < 20; i += 1) await Promise.resolve();
        });
        expect(tables.wallets).toEqual([]);
        expect(tables.signers).toEqual([]);
        expect(tables.accounts).toEqual([]);
        expect(tables.addresses).toEqual([]);
        expect(wipe.wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(onUnlinked).not.toHaveBeenCalled();
    });

    it('keeps the page and says so when the removal fails', async () => {
        const messaging = { removeWallet: () => Promise.reject(new Error('locked')), listWallets: () => Promise.resolve([HW]) };
        await act(async () => {
            render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <UnlinkHardwareWallet wallet={HW} signer={SIGNER} accountCount={3} onBack={() => {}} reload={vi.fn()} />
                </MessagingProvider>,
            );
        });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Unlink Wallet' }));
            for (let i = 0; i < 8; i += 1) await Promise.resolve();
        });
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't unlink this wallet. Try again.");
        expect(wipe.wipeWalletStorage).not.toHaveBeenCalled();
    });
});

describe('manage page helpers', () => {
    it('maps the signer status to the card status', () => {
        expect(cardStatus({ status: 'available' })).toBe('connected');
        expect(cardStatus('locked')).toBe('unlock');
        expect(cardStatus({ status: 'idle', detail: 'x' })).toBe('not-connected');
        expect(cardStatus(null)).toBe('not-connected');
    });

    it('words the notice for one account and for several', () => {
        expect(unlinkNotice({ name: 'Cold', vendor: 'Ledger', count: 1 })).toMatch(/its 1 account from/);
        expect(unlinkNotice({ name: 'Cold', vendor: 'Ledger', count: 2 })).toMatch(/its 2 accounts from/);
        expect(unlinkNotice({ name: 'Cold', vendor: 'Ledger', count: 12000 })).toMatch(/its 12,000 accounts from/);
    });
});
