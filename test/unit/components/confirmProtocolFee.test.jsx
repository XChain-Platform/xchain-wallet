// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The confirm screen must disclose the XCHAIN-mode protocol fee.
//
// The screen quoted the miner fee to eight decimals and said nothing about
// the protocol fee unless the user had switched to native-coin payment - so
// in the DEFAULT mode the larger of the two charges was invisible.
// put the number on `report.quote.xchainFee`; this is the wiring that reads
// it, and the guards that keep it from double-counting the native lane.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';

afterEach(() => cleanup());

const DECODED = { summary: 'Issue 1000 S19FEE', details: [], warnings: [] };

// What sdk.preflight lands after: the echoed fee record on the quote.
const REPORT = (xchainFee) => ({
    verdict: 'pass', restricted: false, unverified: [], stateHeight: 100,
    findings: [{ code: 'DRYRUN_VALID', severity: 'info', message: 'ok' }],
    quote: { valid: true, status: 'valid', xchainFee, blockIndex: 100 },
});

function base(overrides = {}) {
    return {
        phase: 'ready',
        composed: { psbt: 'x', networkFeeSats: 1176, protocolFeeSats: null, quote: null },
        report: REPORT('0.50000000'), reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(), decoded: DECODED, simulation: null,
        chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />, credentialsReady: true,
        variant: 'action', feeText: 'Network fee: 0.00001176 BTC',
        ...overrides,
    };
}

describe('confirm screen protocol-fee disclosure', () => {

    it('shows an XCHAIN protocol-fee row in the default mode', () => {
        render(<ConfirmActionModal {...base()} />);
        const row = screen.getByTestId('confirm-protocol-fee');
        expect(row.textContent).toMatch(/Protocol fee: 0\.5 XCHAIN/);
    });

    it('keeps the miner fee and the protocol fee as two distinct lines', () => {
        // Neither number may pass for the other: "Network fee" stays the miner
        // fee, and the protocol fee is named as itself.
        render(<ConfirmActionModal {...base()} />);
        expect(screen.getByTestId('confirm-fee').textContent).toBe('Network fee: 0.00001176 BTC');
        expect(screen.getByTestId('confirm-protocol-fee').textContent).not.toMatch(/Network fee/);
    });

    it('shows the fee even when the PSBT could not price its miner fee', () => {
        // The two lines are independent: an un-priceable miner fee must not
        // take the protocol fee down with it.
        render(<ConfirmActionModal {...base({ feeText: undefined })} />);
        expect(screen.queryByTestId('confirm-fee')).toBeNull();
        expect(screen.getByTestId('confirm-protocol-fee')).toBeTruthy();
    });

    it('does not show the XCHAIN row when the fee is paid in the native coin', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', protocolFeeSats: 2000, quote: { requiredFeeSats: 2000 } },
        })} />);
        expect(screen.queryByTestId('confirm-protocol-fee')).toBeNull();
    });

    it('shows nothing while the report is still streaming in', () => {
        render(<ConfirmActionModal {...base({ phase: 'preflighting', report: null, reportLoading: true })} />);
        expect(screen.queryByTestId('confirm-protocol-fee')).toBeNull();
    });

    it('shows nothing for a zero-fee action', () => {
        render(<ConfirmActionModal {...base({ report: REPORT('0.00000000') })} />);
        expect(screen.queryByTestId('confirm-protocol-fee')).toBeNull();
    });

    it('does not claim an XCHAIN fee on a caller-supplied PSBT', () => {
        // The wallet did not build those bytes and cannot tell which lane
        // paid their fee, so "from your XCHAIN balance" could be flatly wrong.
        render(<ConfirmActionModal {...base({ variant: 'psbt', psbtPanel: <div /> })} />);
        expect(screen.queryByTestId('confirm-protocol-fee')).toBeNull();
    });

    it('names a priced oracle usage fee as its own line', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', networkFeeSats: 1176, oracleFeeQuote: { requiredFeeSats: 1500, belowDust: false } },
            nativeTicker: 'BTC',
        })} />);
        const row = screen.getByTestId('confirm-oracle-fee');
        expect(row.textContent).toMatch(/^Oracle usage fee: 0\.000015 BTC /);
        expect(screen.getByTestId('confirm-protocol-fee').textContent).not.toMatch(/oracle/i);
    });

    it('draws no oracle line when the quote appended no output', () => {
        for (const oracleFeeQuote of [null, { requiredFeeSats: 300, belowDust: true }, { requiredFeeSats: 0 }, { requiredFeeSats: 'n/a' }]) {
            render(<ConfirmActionModal {...base({ composed: { psbt: 'x', oracleFeeQuote }, nativeTicker: 'BTC' })} />);
            expect(screen.queryByTestId('confirm-oracle-fee')).toBeNull();
            cleanup();
        }
    });

    it('draws no oracle line on a caller-supplied PSBT', () => {
        render(<ConfirmActionModal {...base({
            variant: 'psbt', psbtPanel: <div />,
            composed: { psbt: 'x', oracleFeeQuote: { requiredFeeSats: 1500 } },
        })} />);
        expect(screen.queryByTestId('confirm-oracle-fee')).toBeNull();
    });

    it('does not claim an XCHAIN fee on a bare native payment', () => {
        // No XChain action, so no protocol fee at all.
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', bareNativePayment: true }, report: null,
        })} />);
        expect(screen.queryByTestId('confirm-protocol-fee')).toBeNull();
    });
});
