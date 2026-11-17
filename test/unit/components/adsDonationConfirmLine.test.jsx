// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shared confirm screen names an automatic donation the composed bytes
// carry, on its own line before Approve (§36, ruling 2026-11-14):
// "Automatic donation $25.00 (0.00025 BTC) to Protocol". The coin figure is
// the output's own value, and the donation counts in Total cost.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { automaticDonationLine } from '../../../packages/core/src/shared/utils/adsDonationLine.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

afterEach(() => cleanup());

const PLAN = {
    canSubmit: true,
    reason: 'ok',
    donationAmount: 25000,
    donationAddress: 'bc1qdonate',
    donationFiat: '25',
    coinAmount: '0.00025',
    currency: 'USD',
    recipient: 'protocol',
    ticker: 'BTC',
};

function base(composedExtra = {}) {
    return {
        phase: 'ready',
        composed: {
            psbt: 'x', chainId: 'bitcoin-mainnet', networkFeeSats: 1176, protocolFeeSats: null, quote: null,
            protocolFeeKnownFree: true, ...composedExtra,
        },
        report: null, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(),
        decoded: { summary: 'Send 0.001 BTC', details: [], warnings: [] }, simulation: null,
        chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />, credentialsReady: true,
        variant: 'action', nativeTicker: 'BTC',
        networkFee: { amount: '0.00001176', ticker: 'BTC', fiat: null, estimate: false },
        paymentAmount: '0.001',
    };
}

describe('automaticDonationLine', () => {
    it('states the fiat amount, the coin amount from the output, and the recipient', () => {
        const line = automaticDonationLine({
            composed: { adsPlan: PLAN }, descriptor: defaultRegistry().get('bitcoin-mainnet'),
        });
        expect(line.text).toBe('Automatic donation $25.00 (0.00025 BTC) to Protocol');
        expect(line.coin).toBe('0.00025');
    });

    it('names Community and Explorer, and says nothing when the bytes carry no donation', () => {
        const d = defaultRegistry().get('dogecoin-mainnet');
        expect(automaticDonationLine({
            composed: { adsPlan: { ...PLAN, recipient: 'community', donationAmount: 10000000000, ticker: 'DOGE' } }, descriptor: d,
        }).text).toBe('Automatic donation $25.00 (100 DOGE) to Community');
        expect(automaticDonationLine({ composed: { adsPlan: { ...PLAN, recipient: 'explorer' } } }).recipient).toBe('Explorer');
        expect(automaticDonationLine({ composed: { adsPlan: { ...PLAN, canSubmit: false, reason: 'unaffordable' } } })).toBeNull();
        expect(automaticDonationLine({ composed: {} })).toBeNull();
    });
});

describe('the confirm screen', () => {
    it('shows the donation once, as its own row before Approve', () => {
        render(<ConfirmActionModal {...base({ adsPlan: PLAN })} />);
        const row = screen.getByTestId('confirm-fee-donation');
        expect(row).toHaveTextContent('$25.00 (0.00025 BTC) to Protocol');
        expect(row.closest('[data-testid="confirm-facts"]')).not.toBeNull();
        // No Total block (G127 revised 2026-11-16).
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        // Named once on the page.
        expect(screen.getByTestId('confirm-modal').textContent.match(/0\.00025 BTC/g)).toHaveLength(1);
    });

    it('shows no donation line when the send goes out without one', () => {
        render(<ConfirmActionModal {...base({ adsPlan: { ...PLAN, canSubmit: false, reason: 'no-price' } })} />);
        expect(screen.queryByTestId('confirm-fee-donation')).toBeNull();
        expect(screen.getByTestId('confirm-modal').textContent).not.toContain('Automatic donation');
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.00001176 BTC');
    });
});
