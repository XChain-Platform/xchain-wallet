// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Receive's labelled fields each carry a '?' tip written for Receive (U57).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

vi.mock('../../../packages/core/src/shared/components/ToastHost.jsx', () => ({
    useToast: () => ({ showToast: () => {}, dismissToast: () => {}, clearToasts: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useFiatRate: () => ({ rate: 50000, fiatCurrency: 'USD' }),
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') },
}));

const { Receive } = await import('../../../packages/core/src/shared/routes/Receive.jsx');

const ADDRESS = {
    id: 'address-1',
    address: 'bcrt1qsharedrules',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    label: 'Deposits',
};

function renderReceive() {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ schemaVersion: 1, activeNetwork: 'regtest' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [ADDRESS] }),
        getNewestAddress: vi.fn().mockResolvedValue(ADDRESS),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Receive walletId="wallet-1" accountId="account-1" />
        </MessagingProvider>,
    );
}

async function tipText(name) {
    fireEvent.click(await screen.findByRole('button', { name }));
    const text = screen.getByRole('tooltip').textContent;
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' });
    return text;
}

afterEach(() => {
    cleanup();
});

describe('Receive field help tips', () => {
    it('explains the address type choice', async () => {
        renderReceive();
        expect(await tipText('About Address type')).toMatch(/SegWit is the usual choice/);
    });

    it('explains the private address label', async () => {
        renderReceive();
        expect(await tipText('About Address label')).toMatch(/never written on chain/);
    });

    it('explains the requested amount', async () => {
        renderReceive();
        expect(await tipText(/^About Amount/)).toMatch(/QR code and payment link/);
    });
});
