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
    // Receive no longer offers an Address type select or an Address label editor, so those two
    // help tips are retired with their fields.
    it('no longer offers the Address type or Address label fields', async () => {
        renderReceive();
        await screen.findByRole('button', { name: /^About Amount/ });
        expect(screen.queryByRole('button', { name: 'About Address type' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'About Address label' })).toBeNull();
    });

    // Ruling 2026-11-13: every labelled field shows its '?' tip, Address and Asset included.
    it('explains the receive address and the asset', async () => {
        renderReceive();
        expect(await tipText(/^About Address$/)).toMatch(/address the payer sends to/);
        expect(await tipText(/^About Asset$/)).toMatch(/coin or token you want to be paid in/);
    });

    it('explains the requested amount', async () => {
        renderReceive();
        expect(await tipText(/^About Amount/)).toMatch(/QR code and payment link/);
    });
});
