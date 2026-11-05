// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Receive lays out its refusal and empty states through the page templates.
// The signer-mode notice and the no-networks empty state each sit inside a
// ListPage or FormPage root, never straight in the Screen body, so they take
// the same spacing and width as every other routed screen.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import listStyles from '../../../packages/core/src/ui/ListPage.module.css';
import formStyles from '../../../packages/core/src/ui/FormPage.module.css';

vi.mock('../../../packages/core/src/shared/routes/Settings.jsx', () => ({
    Settings: () => <div data-testid="settings-panel" />,
}));

const CHAIN = 'litecoin-mainnet';
const ADDRESS = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';

function messaging(settings, addresses) {
    const methods = {
        getSettings: vi.fn().mockResolvedValue(settings),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet' }]),
        listAccounts: vi.fn().mockResolvedValue([{ id: 'account-1', walletId: 'wallet-1', index: 0 }]),
        getAddressesByChain: vi.fn().mockResolvedValue(addresses),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('not configured')),
    };
    return new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const fallback = vi.fn().mockResolvedValue(null);
            target[property] = fallback;
            return fallback;
        },
    });
}

function mount(settings, addresses = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging(settings, addresses)}>
            <Receive walletId="wallet-1" accountId="account-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

const TEMPLATE_ROOTS = [listStyles.page, formStyles.page, formStyles.form]
    .filter(Boolean)
    .map((name) => `.${name}`)
    .join(', ');

afterEach(() => cleanup());

describe('Receive: refusal and empty states use the page templates', () => {
    it('draws the signer-mode notice inside a page template', async () => {
        mount({ walletMode: 'signer', grace: { testSendThresholdSats: 0 } }, {
            [CHAIN]: [{ id: 'addr-1', address: ADDRESS, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' }],
        });

        const notice = await screen.findByText(/doesn't have an address for receiving funds/i);
        expect(TEMPLATE_ROOTS.length).toBeGreaterThan(0);
        expect(notice.closest(TEMPLATE_ROOTS)).not.toBeNull();
    });

    it('draws the no-networks empty state inside a page template', async () => {
        mount({ activeNetwork: 'mainnet', fees: {} });

        const title = await screen.findByText('No networks available');
        expect(title.closest(TEMPLATE_ROOTS)).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Open network settings' }).closest(TEMPLATE_ROOTS)).not.toBeNull();
    });
});
