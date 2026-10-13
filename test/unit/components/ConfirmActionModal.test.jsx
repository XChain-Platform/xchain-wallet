// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConfirmActionModal render + interaction contract (§5.1-5.2).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

afterEach(() => {
    cleanup();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
});

const DECODED = {
    summary: 'Send 5 JDOG to bc1qxyz',
    details: [
        { label: 'Amount', value: '5' },
        { label: 'Destination', value: 'bc1qxyz' },
    ],
    warnings: [],
};
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
        expect(screen.getByTestId('confirm-approve').textContent)
            .toBe('Approve Send 5 JDOG to bc1qxyz');
        expect(screen.getByTestId('confirm-reject').textContent).toBe('Reject');
    });

    it('orders and labels the review as recipient, amount, fee, then total', () => {
        const { container } = render(<ConfirmActionModal {...base({
            feeText: 'Network fee: 0.1 BTC',
            totalText: 'Total: 5.1 BTC',
        })} />);
        const labels = Array.from(screen.getByTestId('action-intent').querySelectorAll('dt'))
            .map((node) => node.textContent);
        expect(labels).toEqual(['To', 'Amount']);

        const intent = screen.getByTestId('action-intent');
        const fee = screen.getByTestId('confirm-fee');
        const total = screen.getByTestId('confirm-total');
        const preflight = screen.getByTestId('preflight-panel');
        expect(intent.compareDocumentPosition(fee) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(fee.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(total.compareDocumentPosition(preflight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(container.textContent).not.toContain('Destination');
    });

    it('shows an exact total for a native payment without adding unlike units', () => {
        const confirmAction = {
            phase: 'ready',
            composed: {
                chainId: 'bitcoin-mainnet',
                bareNativePayment: true,
                networkFeeSats: 2500,
                decoded: {
                    summary: 'Send 1 BTC to bc1qxyz',
                    details: [
                        { label: 'Token', value: 'BTC' },
                        { label: 'Amount', value: '1' },
                        { label: 'Destination', value: 'bc1qxyz' },
                    ],
                    warnings: [],
                },
            },
            report: null,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };
        const { rerender } = render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );
        expect(screen.getByTestId('confirm-total').textContent).toBe('Total: 1.000025 BTC');

        rerender(
            <ActionConfirmScreen
                confirmAction={{
                    ...confirmAction,
                    composed: {
                        ...confirmAction.composed,
                        decoded: {
                            ...confirmAction.composed.decoded,
                            details: [
                                { label: 'Token', value: 'JDOG' },
                                { label: 'Amount', value: '1' },
                            ],
                        },
                    },
                }}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('confirm-total')).toBeNull();
    });

    it.each([320, 360])('keeps the Send review readable and reachable at %ipx', (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
        const longToken = 'A-VERY-LONG-TOKEN-NAME-THAT-MUST-NOT-HIDE-THE-AMOUNT';
        const confirmAction = {
            phase: 'ready',
            composed: {
                chainId: 'bitcoin-mainnet',
                bareNativePayment: true,
                networkFeeSats: 2500,
                decoded: {
                    summary: `Send 1 BTC to ${address}`,
                    details: [
                        { label: 'Token', value: 'BTC' },
                        { label: 'Amount', value: '1' },
                        { label: 'Destination', value: address },
                    ],
                    warnings: [],
                },
                simulation: {
                    deltas: [{ tick: longToken, before: '123456789.12345678', after: '1.00000000' }],
                    notes: [],
                },
            },
            report: null,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };

        render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );

        const intent = screen.getByTestId('action-intent');
        expect(intent).toHaveTextContent(address);
        expect(intent).toHaveTextContent(longToken);
        expect(intent).toHaveTextContent('123456789.12345678 → 1.00000000');
        expect(screen.getByTestId('confirm-fee')).toHaveTextContent('Network fee: 0.000025 BTC');
        expect(screen.getByTestId('confirm-total')).toHaveTextContent('Total: 1.000025 BTC');
        expect(screen.getByTestId('confirm-approve')).toBeVisible();

        const intentCss = readFileSync(
            'packages/core/src/shared/components/ActionIntentSummary.module.css',
            'utf8',
        );
        const modalCss = readFileSync(
            'packages/core/src/shared/components/ConfirmActionModal.module.css',
            'utf8',
        );
        expect(intentCss).toMatch(/@media \(max-width: 399px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
        expect(intentCss).toMatch(/\.deltaTick\s*\{[^}]*overflow-wrap:\s*anywhere/s);
        expect(modalCss).toMatch(/\.fee\s*\{[^}]*text-align:\s*end/s);
        expect(modalCss).toMatch(/\.page\s*\{[^}]*padding-bottom:\s*var\(--xc-bottom-bar-h, 0px\)/s);
        expect(modalCss).toMatch(/@media \(max-width: 399px\)[\s\S]*\.footer\s*\{[^}]*flex-direction:\s*column/s);
    });

    it('uses a plain headline when an action has no decoded summary', () => {
        render(<ConfirmActionModal {...base({ decoded: null })} />);
        expect(screen.getByText('Review action')).toBeTruthy();
        expect(screen.getByTestId('confirm-modal').getAttribute('aria-label'))
            .toBe('Confirm Review action');
    });

    it('shows the browser-verified requesting site in a labelled block', () => {
        render(<ConfirmActionModal {...base({
            requestOrigin: 'https://very-long-requesting-site.example/path',
        })} />);
        const site = screen.getByTestId('confirm-request-origin');
        expect(site.tagName).toBe('SECTION');
        expect(site.getAttribute('aria-label')).toBe('Requesting site');
        expect(site.textContent).toContain('https://very-long-requesting-site.example/path');
    });

    it('does not claim a requesting site for a wallet-initiated action', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.queryByTestId('confirm-request-origin')).toBeNull();
    });

    // #40. The page that is the last check before signing did not say who was
    // signing, in a wallet that holds several addresses per chain.
    describe('the From row (#40)', () => {
        const ADDR = 'ndDEAAqTMcJmDFEHkLPfEjGvPTyY4NVoTY';

        it('names the spender on the action variant', () => {
            render(<ConfirmActionModal {...base({ sourceAddress: ADDR })} />);
            const row = screen.getByTestId('confirm-source');
            expect(row.textContent).toMatch(/^From/);
            // The final review keeps the complete address visible and also
            // exposes it through the title attribute.
            expect(row.querySelector('[title]')?.getAttribute('title')).toBe(ADDR);
            expect(row.textContent).toContain(ADDR);
        });

        it('renders no row when no source was supplied', () => {
            render(<ConfirmActionModal {...base()} />);
            expect(screen.queryByTestId('confirm-source')).toBeNull();
        });

        // The restriction is the design, not an oversight: a caller-supplied
        // PSBT can spend several owned addresses, and the psbt variant already
        // enumerates its inputs and marks which ones the wallet owns. One From
        // line there would assert a single spender that may not exist.
        it('stays off the psbt variant even when a source is passed', () => {
            render(<ConfirmActionModal {...base({
                variant: 'psbt', sourceAddress: ADDR, headline: 'Sign transaction',
                psbtPanel: <div data-testid="psbt-panel" />,
            })} />);
            expect(screen.queryByTestId('confirm-source')).toBeNull();
            expect(screen.getByTestId('psbt-panel')).toBeTruthy();
        });
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

    it('explains when a failed request carries no diagnostic message', () => {
        render(<ConfirmActionModal {...base({ error: {} })} />);
        expect(screen.getByTestId('confirm-error').textContent)
            .toMatch(/wallet service returned no explanation/i);
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
        // "will retry" promised an auto-drain that does not exist.
        expect(screen.getByTestId('confirm-queued').textContent).toMatch(/not broadcast yet/i);
        expect(screen.getByTestId('confirm-queued').textContent).not.toMatch(/retry/i);
    });

    it('preflight verdict fail sets aria-live=assertive', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);
        expect(screen.getByTestId('preflight-panel').getAttribute('aria-live')).toBe('assertive');
    });
});
