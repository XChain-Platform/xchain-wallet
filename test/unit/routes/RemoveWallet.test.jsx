// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wallet Details' Remove wallet opens a Remove Wallet page for that wallet.
// Opening it, backing out of it or removing a wallet that is not active never
// changes the active wallet; removing the active wallet hands over to another
// one as Settings does.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { RemoveWallet } from '../../../packages/core/src/shared/routes/RemoveWallet.jsx';
import { readActiveWallet, writeActiveWallet } from '../../../packages/core/src/shared/utils/activeWalletMemory.js';

const { wipeWalletStorage } = vi.hoisted(() => ({
    wipeWalletStorage: vi.fn(async () => {}),
}));

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', async (importOriginal) => ({
    ...(await importOriginal()),
    wipeWalletStorage,
}));

const ACTIVE = { id: 'wallet-active', name: 'Active Wallet' };
const OTHER = { id: 'wallet-other', name: 'Other Wallet' };

function mount(target, { walletsAfterRemoval = [ACTIVE], removeWallet, walletName } = {}) {
    const reload = vi.fn();
    const onBack = vi.fn();
    const onRemoved = vi.fn();
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        removeWallet: removeWallet || vi.fn().mockResolvedValue({ removed: { wallet: 1 } }),
        listWallets: vi.fn().mockResolvedValue(walletsAfterRemoval),
    };
    render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <RemoveWallet
                walletId={target.id}
                walletName={walletName ?? target.name}
                activeWalletId={ACTIVE.id}
                onBack={onBack}
                onRemoved={onRemoved}
                reload={reload}
            />
        </MessagingContext.Provider>,
    );
    return { messaging, reload, onBack, onRemoved };
}

function confirmRemoval(name) {
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Confirm wallet name' }), { target: { value: name } });
    const confirm = screen.getByRole('button', { name: 'Remove Wallet' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
}

beforeEach(() => {
    globalThis.localStorage.clear();
    writeActiveWallet(ACTIVE.id, ACTIVE.name);
    wipeWalletStorage.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Remove Wallet page', () => {
    it('removes a wallet that is not active and leaves the active wallet active', async () => {
        const { messaging, reload, onRemoved } = mount(OTHER, { walletsAfterRemoval: [ACTIVE] });
        expect(screen.getByRole('heading', { name: 'Remove Wallet' })).toBeTruthy();

        confirmRemoval(OTHER.name);

        await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(OTHER.id));
        expect(messaging.removeWallet).toHaveBeenCalledOnce();
        expect(messaging.removeWallet).toHaveBeenCalledWith({ walletId: OTHER.id });
        expect(readActiveWallet()).toBe(ACTIVE.id);
        expect(reload).not.toHaveBeenCalled();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('asks for the chosen wallet\'s name, not the active wallet\'s', () => {
        mount(OTHER);
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Confirm wallet name' }), { target: { value: ACTIVE.name } });
        expect(screen.getByRole('button', { name: 'Remove Wallet' })).toBeDisabled();
    });

    it('changes nothing when the user backs out', () => {
        const { messaging, reload, onBack, onRemoved } = mount(OTHER);
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Confirm wallet name' }), { target: { value: OTHER.name } });

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onBack).toHaveBeenCalledOnce();
        expect(messaging.removeWallet).not.toHaveBeenCalled();
        expect(messaging.listWallets).not.toHaveBeenCalled();
        expect(onRemoved).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(readActiveWallet()).toBe(ACTIVE.id);
    });

    it('keeps Back shut while the removal runs', async () => {
        let finish;
        const removeWallet = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { onRemoved } = mount(OTHER, { removeWallet });
        confirmRemoval(OTHER.name);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Back to previous screen' })).toBeDisabled());
        finish({ removed: { wallet: 1 } });
        await waitFor(() => expect(onRemoved).toHaveBeenCalledWith(OTHER.id));
    });

    it('hands over to another wallet when the active wallet is removed', async () => {
        const { reload, onRemoved } = mount(ACTIVE, { walletsAfterRemoval: [OTHER] });
        confirmRemoval(ACTIVE.name);

        await waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(readActiveWallet()).toBe(OTHER.id);
        expect(onRemoved).not.toHaveBeenCalled();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('wipes wallet storage when the last wallet, the active one, is removed', async () => {
        const { reload } = mount(ACTIVE, { walletsAfterRemoval: [] });
        confirmRemoval(ACTIVE.name);

        await waitFor(() => expect(reload).toHaveBeenCalledOnce());
        expect(wipeWalletStorage).toHaveBeenCalledOnce();
        expect(readActiveWallet()).toBeNull();
    });

    it('offers no removal for a wallet whose name is unknown', () => {
        mount(OTHER, { walletName: '' });
        expect(screen.getByText('This wallet is no longer listed.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull();
    });
});

describe('every shell routes Wallet Details\' Remove wallet to the page', () => {
    const shells = ['packages/web/src/App.jsx', 'packages/desktop/renderer/App.jsx', 'packages/extension/src/popup/App.jsx'];
    it.each(shells)('%s opens wallet-remove without switching wallets', (path) => {
        const src = readFileSync(join(process.cwd(), path), 'utf8');
        const handler = src.match(/onRemoveWallet=\{([^\n]*)\}/)?.[1] || '';
        expect(handler).toContain("'wallet-remove'");
        expect(handler).not.toMatch(/handleSwitchWallet|settings/i);
        expect(src).toMatch(/unlockedView === 'wallet-remove' && walletDetailsId[\s\S]{0,300}<RemoveWallet/);
    });
});
