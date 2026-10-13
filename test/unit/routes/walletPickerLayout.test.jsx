// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';

afterEach(() => cleanup());

describe('WalletPicker row layout', () => {
    it('groups a long wallet name and its format in a wrapping text column', async () => {
        const wallet = {
            id: 'wallet-1',
            name: 'A wallet name long enough to wrap on a narrow screen',
            format: 'bip39',
        };
        let view;
        await act(async () => {
            view = render(
                <MessagingProvider
                    shell="popup"
                    messaging={{ listWallets: () => Promise.resolve([wallet]) }}
                >
                    <WalletPicker
                        activeWalletId={null}
                        onSwitch={() => {}}
                        onAddWallet={() => {}}
                        onBack={() => {}}
                    />
                </MessagingProvider>,
            );
            await Promise.resolve();
        });

        const row = Array.from(view.container.querySelectorAll('button'))
            .find((button) => button.textContent.includes(wallet.name));
        expect(row).toBeTruthy();
        expect(row.children).toHaveLength(1);
        expect(row.firstElementChild.children).toHaveLength(2);
        expect(row.firstElementChild.textContent).toContain('BIP39');
    });
});
