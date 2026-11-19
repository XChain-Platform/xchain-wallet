// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

afterEach(cleanup);

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <WalletPicker
                activeWalletId={null}
                onSwitch={() => {}}
                onAddWallet={() => {}}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

describe('WalletPicker error copy', () => {
    it('hides developer details from a wallet-list failure', async () => {
        mount({
            listWallets: () => {
                throw new TypeError("Cannot read properties of undefined (reading 'map')");
            },
        });

        expect(await screen.findByText('Could not load your wallets. Try again.')).toBeTruthy();
        expect(screen.queryByText(/Cannot read properties/)).toBeNull();
    });

    it('describes a missing wallet-list capability without naming code', async () => {
        mount({});

        expect(await screen.findByText('Wallet switching is not available here.')).toBeTruthy();
        expect(screen.queryByText(/messaging\./)).toBeNull();
    });
});
