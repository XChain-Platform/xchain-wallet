// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConfirmActionModal render + interaction contract ( §5.1-5.2).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';

afterEach(() => cleanup());

const DECODED = { summary: 'Send 5 JDOG to bc1qxyz', details: [{ label: 'Amount', value: '5' }], warnings: [] };
const REPORT_PASS = { verdict: 'pass', restricted: false, findings: [{ code: 'DRYRUN_VALID', severity: 'info', message: 'ok' }], unverified: [], stateHeight: 100 };
const REPORT_HARD_FAIL = { verdict: 'fail', restricted: false, findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'bad address' }], unverified: [] };
const REPORT_OVERRIDABLE = { verdict: 'fail', restricted: false, findings: [{ code: 'DRYRUN_INVALID', severity: 'error', overridable: true, message: 'network says no' }], unverified: [] };

function base(overrides = {}) {
    return {
        phase: 'ready', composed: { psbt: 'x' }, report: REPORT_PASS, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(), decoded: DECODED, simulation: null,
        chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />, credentialsReady: true,
        variant: 'action', ...overrides,
    };
}

describe('ConfirmActionModal', () => {

    it('renders nothing when phase is idle', () => {
        const { container } = render(<ConfirmActionModal {...base({ phase: 'idle' })} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the intent, chain badge, and preflight panel when ready', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.getByTestId('action-intent')).toBeTruthy();
        expect(screen.getByTestId('confirm-chain-badge').textContent).toBe('Bitcoin');
        expect(screen.getByTestId('preflight-panel')).toBeTruthy();
        expect(screen.getByTestId('confirm-approve').textContent).toMatch(/Approve/);
    });

    it('renders no error region by default', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.queryByTestId('confirm-error')).toBeNull();
    });

    it('§5.3.4: surfaces a credential error in-modal (role=alert) while staying at ready', () => {
        // A bad password returns the hook to `ready` with `error` set: the modal
        // must stay open and TELL the user, so they can retype and re-approve
        // the SAME PSBT rather than the modal tearing down.
        render(<ConfirmActionModal {...base({ error: Object.assign(new Error('Incorrect password.'), { name: 'InvalidPasswordError' }) })} />);
        const alert = screen.getByTestId('confirm-error');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toMatch(/Incorrect password/);
        // Still approvable: the user gets to try again.
        expect(screen.getByTestId('confirm-approve').hasAttribute('disabled')).toBe(false);
    });

    it('accepts a plain string error', () => {
        render(<ConfirmActionModal {...base({ error: 'Something broke.' })} />);
        expect(screen.getByTestId('confirm-error').textContent).toMatch(/Something broke/);
    });

    // Page form (operator direction 2026-07-22): the confirm surface
    // renders as a full page with a "Confirm" header whose back arrow is
    // Reject, in place of the old overlay modal.
    it('renders as a page titled Confirm (no overlay dialog)', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.getByText('Confirm')).toBeTruthy();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('the header back arrow rejects in the ready phase', () => {
        const onReject = vi.fn();
        render(<ConfirmActionModal {...base({ onReject })} />);
        fireEvent.click(screen.getByLabelText('Back'));
        expect(onReject).toHaveBeenCalledOnce();
    });

    it('the header back arrow is inert once signing has begun', () => {
        const onReject = vi.fn();
        render(<ConfirmActionModal {...base({ onReject, phase: 'signing' })} />);
        const back = screen.getByLabelText('Back');
        expect(back.disabled).toBe(true);
        fireEvent.click(back);
        expect(onReject).not.toHaveBeenCalled();
    });

    it('Reject is disabled during signing (post-signature exit lockout)', () => {
        render(<ConfirmActionModal {...base({ phase: 'signing' })} />);
        expect(screen.getByTestId('confirm-reject').disabled).toBe(true);
    });

    it('a non-overridable error keeps Approve disabled with no ack checkbox', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);
        expect(screen.getByTestId('confirm-approve').disabled).toBe(true);
        expect(screen.queryByTestId('ack-DEST_ADDRESS_INVALID')).toBeNull();
    });

    it('a network-sourced error shows an acknowledgment checkbox', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_OVERRIDABLE, canApprove: false })} />);
        expect(screen.getByTestId('ack-DRYRUN_INVALID')).toBeTruthy();
    });

    it('Approve disables synchronously on click and calls onApprove once', () => {
        const onApprove = vi.fn(() => new Promise(() => {}));
        render(<ConfirmActionModal {...base({ onApprove })} />);
        const btn = screen.getByTestId('confirm-approve');
        fireEvent.click(btn);
        expect(btn.disabled).toBe(true);         // sync-disabled this tick
        fireEvent.click(btn);                     // second click ignored
        expect(onApprove).toHaveBeenCalledOnce();
    });

    it('shows the queued terminal copy in the signed-not-broadcast phase', () => {
        render(<ConfirmActionModal {...base({ phase: 'signed-not-broadcast' })} />);
        expect(screen.getByTestId('confirm-queued').textContent).toMatch(/broadcast will retry/i);
    });

    it('preflight verdict fail sets aria-live=assertive', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);
        expect(screen.getByTestId('preflight-panel').getAttribute('aria-live')).toBe('assertive');
    });
});
