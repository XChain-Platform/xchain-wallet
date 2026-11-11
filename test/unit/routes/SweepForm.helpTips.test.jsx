// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every Sweep field label carries its '?' help tip (From, Destination address
// and Memo), and the form opens straight on its fields with no visible
// "Addresses" heading above them.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const EMPTY_PREVIEW = Object.freeze({
    balances: { rows: [], error: null },
    ownerships: { rows: [], error: null },
    orders: { rows: [], error: null },
    swaps: { rows: [], error: null },
    dispensers: { rows: [], error: null },
    gatedTicks: { rows: [], error: null, partial: false },
});

function mountSweep() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({ [CHAIN]: [] }),
        sweepPreview: () => Promise.resolve(EMPTY_PREVIEW),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SweepForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return container;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('SweepForm field help tips', () => {
    it('gives From, Destination address and Memo a help button on the label', async () => {
        const container = mountSweep();
        await waitFor(() => expect(container.querySelector('button[aria-label="About From"]')).not.toBeNull());
        expect(container.querySelector('button[aria-label="About Destination address"]')).not.toBeNull();
        expect(container.querySelector('button[aria-label="About Memo"]')).not.toBeNull();
    });

    it('shows no Addresses heading above the Network field', async () => {
        const container = mountSweep();
        await waitFor(() => expect(container.querySelector('button[aria-label="About From"]')).not.toBeNull());
        const headings = Array.from(container.querySelectorAll('h2, h3, legend'))
            .filter((node) => node.textContent.trim() === 'Addresses');
        for (const heading of headings) {
            const hidden = heading.closest('[class*="untitledSection"]')
                || /visually-?hidden|srOnly|sr-only/i.test(heading.className || '');
            expect(Boolean(hidden)).toBe(true);
        }
    });
});
