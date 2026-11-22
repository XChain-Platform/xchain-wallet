// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// @vitest-environment jsdom

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const feeFiat = vi.hoisted(() => ({
    formatNativeFee: vi.fn((amount) => (amount === '0.000015' ? '~$1.50' : null)),
}));

vi.mock('../../../packages/core/src/shared/hooks/useFeeFiat.js', () => ({
    useFeeFiat: () => ({
        formatNativeFee: feeFiat.formatNativeFee,
        formatProtocolFee: vi.fn(() => null),
    }),
}));

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    listWallets: async () => [{ id: 'wallet-1', name: 'Wallet 1' }],
    getSettings: async () => ({
        walletMode: 'full',
        fiatCurrency: 'USD',
        privacy: { priceDataEnabled: true },
    }),
    getAddressesByChain: async () => ({
        'bitcoin-mainnet': [{ address: 'bc1qownaddressownaddress' }],
    }),
    getAddressBalances: async () => { throw new Error('preview not needed'); },
    getTokenInfo: async () => null,
    parsePsbt: async () => { throw new Error('not used by signAction'); },
    resolveApproval: vi.fn(async () => ({ approved: true })),
    requoteNativeFee: vi.fn(async () => null),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async ({ action }) => ({
        summary: action === 'SWEEP' ? 'Sweep this account.' : 'Send 1 BTC.',
        details: [],
        warnings: [],
    })),
    parseCoSign: async () => { throw new Error('not used by signAction'); },
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/core/src/shared/approval/SignApproval.jsx'
);

function renderAction(action, requested) {
    render(
        <SignApproval
            id={`fee-${action}`}
            kind="signAction"
            payload={{
                chainId: 'bitcoin-mainnet',
                action,
                payload: {
                    from: { address: 'bc1qownaddressownaddress' },
                    requested,
                },
            }}
            onReject={() => {}}
        />,
    );
}

afterAll(() => vi.unstubAllGlobals());

afterEach(() => {
    cleanup();
    feeFiat.formatNativeFee.mockClear();
});

describe('SignApproval network fee summary', () => {
    it('shows an exact SEND fee in the native coin with the shared fiat formatter', async () => {
        renderAction('SEND', { fee: 1500, feePerKb: 6000 });

        await screen.findByText('Send 1 BTC.');
        // No Total block (G127 revised 2026-11-16): the fee is one row in the
        // facts card with its fiat value.
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        const fee = screen.getByTestId('confirm-fee-network');
        expect(fee).toHaveTextContent('0.000015 BTC ($1.50)');
        expect(fee.closest('[data-testid="confirm-facts"]')).not.toBeNull();
        expect(screen.queryByTestId('sign-approval-fee')).toBeNull();
        expect(feeFiat.formatNativeFee).toHaveBeenCalledWith('0.000015');
    });

    it('names an unknown SWEEP network fee by the site\'s rate, in one row', async () => {
        renderAction('SWEEP', { feePerKb: 12000 });

        await screen.findByText('Sweep this account.');
        expect(screen.getAllByTestId('confirm-fee-network')).toHaveLength(1);
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent(/^Set by the site/);
        expect(feeFiat.formatNativeFee).not.toHaveBeenCalled();
    });

    it('names an unknown SEND network fee once', async () => {
        renderAction('SEND', {});

        await screen.findByText('Send 1 BTC.');
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('Set by the site');
        expect(screen.getByTestId('confirm-fee-network')).not.toHaveTextContent('sat/vB');
    });
});
