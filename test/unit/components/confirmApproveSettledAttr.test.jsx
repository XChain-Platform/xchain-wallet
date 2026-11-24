// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import {
    ConfirmButtons,
    ConfirmDecisionFooter,
} from '../../../packages/core/src/shared/components/ConfirmStandard.jsx';
import {
    APPROVE_SETTLE_MS,
    approveSettle,
} from '../../../packages/core/src/shared/utils/approveSettle.js';

const REPORT_PASS = { verdict: 'pass', restricted: false, findings: [], unverified: [] };

function readyProps() {
    return {
        phase: 'ready', composed: { psbt: 'x' }, report: REPORT_PASS, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(),
        decoded: { summary: 'Send 5 JDOG to bc1qxyz', details: [], warnings: [] },
        simulation: null, chainLabel: 'Bitcoin', credentialsReady: true, variant: 'action',
    };
}

describe('Approve settled attribute', () => {
    beforeEach(() => {
        approveSettle.ms = APPROVE_SETTLE_MS;
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        approveSettle.ms = 0;
    });

    it('reports settle and re-arm transitions after layout changes', () => {
        render(<ConfirmActionModal {...readyProps()} />);
        const approve = screen.getByTestId('confirm-approve');

        expect(approve).toHaveAttribute('data-settled', 'false');
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        expect(approve).toHaveAttribute('data-settled', 'true');

        act(() => { window.dispatchEvent(new Event('resize')); });
        expect(approve).toHaveAttribute('data-settled', 'false');
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        expect(approve).toHaveAttribute('data-settled', 'true');

        act(() => { window.dispatchEvent(new Event('xchain:native-fold')); });
        expect(approve).toHaveAttribute('data-settled', 'false');
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        expect(approve).toHaveAttribute('data-settled', 'true');
    });

    it('reports settled on open when the settle window is disabled', () => {
        approveSettle.ms = 0;
        render(<ConfirmActionModal {...readyProps()} />);

        expect(screen.getByTestId('confirm-approve')).toHaveAttribute('data-settled', 'true');
    });

    it.each([
        ['ConfirmButtons', ConfirmButtons],
        ['ConfirmDecisionFooter', ConfirmDecisionFooter],
    ])('leaves bare %s markup unchanged', (_name, Component) => {
        render(<Component onReject={() => {}} onApprove={() => {}} />);

        expect(screen.getByTestId('confirm-approve')).not.toHaveAttribute('data-settled');
    });
});
