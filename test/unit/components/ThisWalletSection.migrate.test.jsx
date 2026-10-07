// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > This Wallet offers the recovery-phrase upgrade only to a wallet
// in the older 12-word format, in plain words, and never to a standard wallet.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

function mount(activeWallet, { onOpenWalletPicker } = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listConnectedSites: vi.fn().mockResolvedValue([]),
    };
    const view = render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings
                onBack={() => {}}
                activeWallet={activeWallet}
                onOpenWalletPicker={onOpenWalletPicker}
                initialSubpageId="this-wallet"
            />
        </MessagingContext.Provider>,
    );
    return view;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ThisWalletSection recovery-phrase upgrade row', () => {
    it('shows a standard wallet no upgrade row and no legacy jargon', () => {
        const view = mount({ id: 'w-std', name: 'Standard', format: 'bip39' }, { onOpenWalletPicker: vi.fn() });
        expect(screen.getByText('Standard')).toBeTruthy();
        const text = view.container.textContent;
        expect(text).not.toMatch(/Upgrade recovery phrase/);
        expect(text).not.toMatch(/Counterwallet/);
        expect(text).not.toMatch(/Migrate to BIP39/);
    });

    it('shows a wallet with no recorded format no upgrade row', () => {
        const view = mount({ id: 'w-none', name: 'Unknown format' }, { onOpenWalletPicker: vi.fn() });
        expect(view.container.textContent).not.toMatch(/Upgrade recovery phrase|Counterwallet/);
    });

    it('offers a legacy wallet the upgrade in plain words, with a working way there', () => {
        const onOpenWalletPicker = vi.fn();
        const view = mount(
            { id: 'w-legacy', name: 'Old wallet', format: 'counterwallet-legacy' },
            { onOpenWalletPicker },
        );
        expect(screen.getByText('Upgrade recovery phrase')).toBeTruthy();
        expect(view.container.textContent).not.toMatch(/Counterwallet-legacy/);
        fireEvent.click(screen.getByRole('button', { name: 'Open wallets…' }));
        expect(onOpenWalletPicker).toHaveBeenCalledOnce();
    });
});
