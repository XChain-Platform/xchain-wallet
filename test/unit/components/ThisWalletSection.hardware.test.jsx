// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet has no seed to export keys from, so This wallet shows no
// extended public key export row for it; a software wallet keeps the row.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ThisWalletSection } from '../../../packages/core/src/shared/components/settings/ThisWalletSection.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';

afterEach(() => cleanup());

function mount(wallet, only = null) {
    return render(
        <MessagingContext.Provider value={{ messaging: {}, shell: 'web' }}>
            <ToastHost>
                <ThisWalletSection activeWallet={wallet} activeAccount={{ id: 'a1', name: 'Account 1', index: 0 }} only={only} />
            </ToastHost>
        </MessagingContext.Provider>,
    );
}

describe('ThisWalletSection on a hardware wallet', () => {
    it('shows no extended public key row', () => {
        mount({ id: 'hw-1', name: 'My Trezor', format: 'hardware' });
        expect(screen.queryByText(/extended public keys/i)).toBeNull();
    });

    it('says the keys stay on the device on the xpub-only part and shows no keys', () => {
        mount({ id: 'hw-1', name: 'My Trezor', format: 'hardware' }, 'xpub');
        expect(screen.getByText("This wallet's keys stay on its hardware device.")).toBeInTheDocument();
        expect(screen.queryByText(/extended public keys/i)).toBeNull();
    });

    it('keeps the row on a software wallet', () => {
        mount({ id: 'soft-1', name: 'Everyday', format: 'bip39' });
        expect(screen.getAllByText(/extended public keys/i).length).toBeGreaterThan(0);
    });
});
