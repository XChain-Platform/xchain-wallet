// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConfirmActionModal keeps Approve inert while the review settles.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import {
    APPROVE_SETTLE_MS,
    approveSettle,
} from '../../../packages/core/src/shared/utils/approveSettle.js';

const REPORT_PASS = { verdict: 'pass', restricted: false, findings: [], unverified: [], stateHeight: 100 };

function props(overrides = {}) {
    return {
        phase: 'ready', composed: { psbt: 'x' }, report: REPORT_PASS, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(),
        decoded: { summary: 'Send 5 JDOG to bc1qxyz', details: [], warnings: [] },
        simulation: null, chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />,
        credentialsReady: true, variant: 'action', ...overrides,
    };
}

// A tap meant for the Send button lands on Approve when the review swaps in
// under the finger: the two buttons share a screen position on a phone.
describe('ConfirmActionModal Approve settle window', () => {
    beforeEach(() => {
        approveSettle.ms = APPROVE_SETTLE_MS;
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        approveSettle.ms = 0;
    });

    it('ignores an Approve tap that lands as the review appears', () => {
        const onApprove = vi.fn();
        render(<ConfirmActionModal {...props({ onApprove })} />);
        const approve = screen.getByTestId('confirm-approve');

        expect(approve).toBeDisabled();
        fireEvent.click(approve);
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS - 1); });
        expect(approve).toBeDisabled();
        expect(onApprove).not.toHaveBeenCalled();
    });

    it('accepts Approve once the window has passed, exactly once', () => {
        const onApprove = vi.fn(() => new Promise(() => {}));
        render(<ConfirmActionModal {...props({ onApprove })} />);

        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        const approve = screen.getByTestId('confirm-approve');
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        fireEvent.click(approve);
        expect(onApprove).toHaveBeenCalledTimes(1);
    });

    it('restarts the window for a newly composed request', () => {
        const first = { psbt: 'a' };
        const { rerender } = render(<ConfirmActionModal {...props({ composed: first })} />);
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();

        rerender(<ConfirmActionModal {...props({ composed: { psbt: 'b' } })} />);
        expect(screen.getByTestId('confirm-approve')).toBeDisabled();
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();
    });

    it('does not restart the window when only the preflight report refreshes', () => {
        const composed = { psbt: 'a' };
        const { rerender } = render(<ConfirmActionModal {...props({ composed })} />);
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });

        rerender(<ConfirmActionModal {...props({ composed, reportLoading: true })} />);
        rerender(<ConfirmActionModal {...props({ composed, reportLoading: false })} />);
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();
    });
});
