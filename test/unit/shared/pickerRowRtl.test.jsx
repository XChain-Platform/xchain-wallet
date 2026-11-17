// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet and account picker rows hold a details or rename button at the
// row's inline end. The row keeps that end clear for the button with a logical
// padding, so under a right-to-left page (button on the left) the name stops
// short of the button instead of running underneath it.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

afterEach(cleanup);

function renderWith(messaging, node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {node}
        </MessagingProvider>,
    );
}

// A picker row is one tappable list row ending in the chevron (G07); the
// separate details button that sat over the row's end is gone, so there is no
// overlay to keep the inline end clear for, and no physical left/right padding.
function expectOneRowButton(name) {
    expect(document.querySelector('[class*="rowWrap"]')).toBeNull();
    const row = screen.getByRole('button', { name: new RegExp(name) });
    expect(row.style.paddingRight).toBe('');
    expect(row.style.paddingLeft).toBe('');
    expect(screen.queryByRole('button', { name: /details for/i })).toBeNull();
}

describe('picker rows are one row button with no overlay at the inline end', () => {
    it('wallet picker', async () => {
        renderWith({
            listWallets: async () => [{ id: 'w1', name: 'Alpha', format: 'bip39' }],
        }, (
            <WalletPicker
                activeWalletId="w1"
                onSwitch={() => {}}
                onAddWallet={() => {}}
                onShowDetails={() => {}}
                onBack={() => {}}
            />
        ));
        await screen.findAllByText('Alpha');
        expectOneRowButton('Alpha');
    });

    it('account picker', async () => {
        renderWith({
            listAccounts: async () => [{ id: 'a1', walletId: 'w1', index: 0, name: 'Main' }],
        }, (
            <AccountPicker
                walletId="w1"
                activeAccountId="a1"
                onSwitch={() => {}}
                onAddAccount={() => {}}
                onRenameAccount={() => {}}
                onBack={() => {}}
            />
        ));
        await screen.findAllByText('Main');
        expectOneRowButton('Main');
    });
});
