// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Action detail hero shows the logo of the asset the action is about, as
// the History row does, and the action's own icon when it has no asset.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OURS = 'bc1qwalletaddress000000000000000000000000001';
const THEIRS = 'bc1qcounterparty00000000000000000000000001';

function entry(overrides = {}, raw = {}) {
    return {
        key: `${CHAIN}:42:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '42',
        action: 'SEND',
        blockIndex: 100,
        timestamp: 1705350600,
        txHash: 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899',
        source: OURS,
        raw: { source: OURS, destination: THEIRS, ...raw },
        link: null,
        detailContext: { chainTip: 110, indexerWatermark: 110, walletAddresses: [OURS] },
        ...overrides,
    };
}

function renderPage(value) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ActionDetail entry={value} walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('Action detail hero icon', () => {
    it('shows the coin logo for a coin send, with a direction badge and no QR icon', () => {
        const { container } = renderPage(entry({}, { amount: '0.5', tick: 'BTC' }));
        expect(screen.getByRole('img', { name: /^BTC on / })).toBeTruthy();
        expect(container.querySelector('[data-testid="action-hero-subject"]')).toBeNull();
        expect(container.querySelector('section .lucide-qr-code')).toBeNull();
    });

    it('shows the coin logo for a coin receive when the row names no ticker', () => {
        const { container } = renderPage(entry({ source: THEIRS }, { source: THEIRS, destination: OURS, amount: '0.5', fee: '0.0001' }));
        const mark = container.querySelector('[aria-label="BTC on Bitcoin"]');
        expect(mark).not.toBeNull();
        expect(container.querySelector('section .lucide-qr-code')).toBeNull();
    });

    it('shows the token icon for a token action', () => {
        const { container } = renderPage(entry({}, { amount: '12.5', tick: 'WALLETCOIN' }));
        expect(screen.getByRole('img', { name: /^WALLETCOIN on / })).toBeTruthy();
        expect(container.querySelector('section .lucide-qr-code')).toBeNull();
    });

    it('shows the given-side asset for an order', () => {
        renderPage(entry({ action: 'ORDER' }, { give_tick: 'WALLETCOIN', give_quantity: '5' }));
        expect(screen.getByRole('img', { name: /^WALLETCOIN on / })).toBeTruthy();
    });

    it.each(['ATTACH', 'POLL', 'DISPENSER'])('shows the %s action icon when the row has no asset', (action) => {
        const { container } = renderPage(entry({ action }, {}));
        const subject = container.querySelector('[data-testid="action-hero-subject"]');
        expect(subject).not.toBeNull();
        expect(subject.querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('img', { name: / on Bitcoin/ })).toBeNull();
        expect(container.querySelector('section .lucide-qr-code')).toBeNull();
    });

    it('shows the History order icon for an order with no asset', () => {
        const { container } = renderPage(entry({ action: 'ORDER' }, {}));
        expect(container.querySelector('[data-testid="action-hero-subject"] svg')).not.toBeNull();
    });
});
