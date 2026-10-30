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

function expectInlineEndRoom(row) {
    expect(row.style.paddingRight).toBe('');
    expect(row.style.paddingLeft).toBe('');
    expect(row.style.paddingInlineEnd).toBe('56px');
}

describe('picker rows keep the inline end clear for their row button', () => {
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
        const wrap = document.querySelector('[class*="rowWrap"]');
        expect(wrap).not.toBeNull();
        expectInlineEndRoom(wrap.firstElementChild);
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
        const wrap = document.querySelector('[class*="rowWrap"]');
        expect(wrap).not.toBeNull();
        expectInlineEndRoom(wrap.firstElementChild);
    });
});
