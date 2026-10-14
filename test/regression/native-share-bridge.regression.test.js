// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// [P1] 2026-10-13: Receive must use the share method exposed by the mobile
// platform for payment links. Clipboard copy is only the no-share fallback.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

const { copyText, qrToDataURL } = vi.hoisted(() => ({
    copyText: vi.fn(async () => ({ ok: true })),
    qrToDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));

vi.mock('../../packages/core/src/shared/clipboard.js', () => ({ copyText }));

vi.mock('../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), clearToasts: vi.fn() }),
}));

vi.mock('../../packages/core/src/shared/hooks/useFiatRate.js', () => ({
    useFiatRate: () => ({ rate: null, fiatCurrency: 'USD' }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: qrToDataURL },
}));

const { Receive } = await import('../../packages/core/src/shared/routes/Receive.jsx');

const ADDRESS = {
    id: 'receive-address-1',
    address: 'bcrt1qnativeshare',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: '',
};

const SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: { 'bitcoin-regtest': { strategy: 'normal' } },
};

function renderReceive() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
    };
    return render(createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        createElement(Receive, { walletId: 'wallet-1', accountId: 'account-1' }),
    ));
}

async function sharePaymentLink() {
    const button = await screen.findByRole('button', { name: 'Share QR payment link' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

afterEach(() => {
    cleanup();
    copyText.mockClear();
    qrToDataURL.mockClear();
    delete navigator.share;
});

describe('native share bridge regression', () => {
    it('[REGRESSION P1] calls the mobile platform share method with the payment link and title', async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        renderReceive();

        await sharePaymentLink();

        await waitFor(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Receive BTC with XChain',
            url: 'bitcoin:bcrt1qnativeshare',
        })));
        expect(copyText).not.toHaveBeenCalled();
    });

    it('[REGRESSION P1] copies the payment link only when no share path exists', async () => {
        renderReceive();

        await sharePaymentLink();

        // The share helper passes its platform env as a second argument.
        await waitFor(() => expect(copyText).toHaveBeenCalledWith('bitcoin:bcrt1qnativeshare', expect.anything()));
        expect(copyText).toHaveBeenCalledTimes(1);
    });
});
