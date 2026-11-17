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

// The page lands directly on its confirm step (RemoveWallet passes `direct`),
// so there is no "Remove…" step to open first: type the name, then Remove Wallet.
function confirmRemoval(name) {
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
        fireEvent.change(screen.getByRole('textbox', { name: 'Confirm wallet name' }), { target: { value: ACTIVE.name } });
        // G130: the button stays enabled; the active wallet's name is refused.
        fireEvent.click(screen.getByRole('button', { name: 'Remove Wallet' }));
        expect(screen.getByRole('alert', { name: /form errors/i })).toHaveTextContent(OTHER.name);
        fireEvent.change(screen.getByRole('textbox', { name: 'Confirm wallet name' }), { target: { value: OTHER.name } });
        expect(screen.getByRole('button', { name: 'Remove Wallet' })).toBeEnabled();
    });

    it('changes nothing when the user backs out', () => {
        const { messaging, reload, onBack, onRemoved } = mount(OTHER);
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

    it('leads with one danger notice, then the confirm field and the red danger button', () => {
        mount(OTHER);
        const field = screen.getByRole('textbox', { name: 'Confirm wallet name' });
        const button = screen.getByRole('button', { name: 'Remove Wallet' });
        const form = field.closest('form');
        expect(form).toBe(button.closest('form'));
        // The shared danger (error tone) notice is the first block in the form.
        const notice = screen.getByTestId('remove-wallet-danger-notice');
        expect(notice.getAttribute('data-variant')).toBe('error');
        expect(form.contains(notice)).toBe(true);
        expect(notice.textContent).toContain('You are about to remove this wallet');
        expect(notice.textContent).toContain(OTHER.name);
        expect(notice.textContent).toMatch(/can't be recovered without its backup or recovery phrase/i);
        expect(notice.textContent).toMatch(/back up/i);
        expect(notice.contains(field)).toBe(false);
        expect(notice.contains(button)).toBe(false);
        // Exactly three blocks: the title, the wallet name, then ONE paragraph
        // holding both sentences as flowing text.
        const paras = notice.querySelectorAll('p');
        expect(paras.length).toBe(2);
        expect(paras[0].textContent).toBe(OTHER.name);
        const body = screen.getByTestId('remove-wallet-danger-body');
        expect(body).toBe(paras[1]);
        expect(body.querySelector('br')).toBeNull();
        expect(body.textContent).toBe(
            'Its accounts, addresses, hardware wallet links, and pending transactions will be deleted. It can\'t be recovered without its backup or recovery phrase. Back up this wallet first.',
        );
        // Notice, then field, then button, with no card or Settings surface wrapping the field.
        const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(follows(notice, field)).toBe(true);
        expect(follows(field, button)).toBe(true);
        expect(document.body.querySelector('[class*="settingsSurface"]')).toBeNull();
        // The one red exception to the green main action: danger variant with its icon.
        // G125: red, never the success green of other main actions.
        expect(button.className).toMatch(/danger/);
        expect(button.className).not.toMatch(/success/);
        expect(button.className).toMatch(/block/i);
        expect(button.querySelector('svg')).toBeTruthy();
        // G130: the button is enabled; the typed name is checked on the press.
        expect(button.disabled).toBe(false);
    });

    it('keeps the final button red and enabled with no local override (G125, G130)', () => {
        mount(OTHER);
        const button = screen.getByRole('button', { name: 'Remove Wallet' });
        expect(button.disabled).toBe(false);
        expect(button.className).toMatch(/danger/);
        // G130: Button draws no disabled look at all, so the page needs no
        // exception of its own to stay red.
        const css = readFileSync(join(process.cwd(), 'packages/core/src/shared/components/settings/ThisWalletSection.module.css'), 'utf8');
        expect(css).not.toMatch(/:disabled\s*\{/);
    });

    it('offers no removal for a wallet whose name is unknown', () => {
        mount(OTHER, { walletName: '' });
        expect(screen.getByText('This wallet is no longer listed.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Wallet' })).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Confirm wallet name' })).toBeNull();
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
