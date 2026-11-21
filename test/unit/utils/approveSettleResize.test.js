// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import {
    APPROVE_SETTLE_MS,
    approveSettle,
} from '../../../packages/core/src/shared/utils/approveSettle.js';

const REPORT_PASS = { verdict: 'pass', restricted: false, findings: [], unverified: [] };

function props(onApprove) {
    return {
        phase: 'ready', composed: { psbt: 'x' }, report: REPORT_PASS, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove, onReject: vi.fn(),
        decoded: { summary: 'Send 5 JDOG to bc1qxyz', details: [], warnings: [] },
        simulation: null, chainLabel: 'Bitcoin', credentialsReady: true, variant: 'action',
    };
}

describe('Approve settle after layout changes', () => {
    beforeEach(() => {
        approveSettle.ms = APPROVE_SETTLE_MS;
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        approveSettle.ms = 0;
    });

    it.each(['resize', 'xchain:native-fold'])('re-arms Approve after %s', (eventName) => {
        const onApprove = vi.fn();
        render(React.createElement(ConfirmActionModal, props(onApprove)));
        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });

        act(() => { window.dispatchEvent(new Event(eventName)); });
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(onApprove).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(APPROVE_SETTLE_MS); });
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(onApprove).toHaveBeenCalledOnce();
    });
});
