// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Consequence warnings and the pre-flight invalid notice on the shared confirm
// screen (operator ruling 2026-11-14: what a transaction does belongs on the
// review, not the form). Rendered through ActionConfirmScreen, the adapter
// every action form uses, with the Approve gate taken from the same
// canApproveWithReport the confirm hook uses.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { canApproveWithReport } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';

afterEach(() => cleanup());

const REPORT_PASS = {
    verdict: 'pass', restricted: false, unverified: [], stateHeight: 100,
    findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }],
};
const REPORT_INVALID = {
    verdict: 'fail', restricted: false, unverified: [],
    findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'The new owner is not a valid address.' }],
};
const REPORT_OVERRIDABLE = {
    verdict: 'fail', restricted: false, unverified: [],
    findings: [{ code: 'DRYRUN_INVALID', severity: 'error', overridable: true, message: 'The network expects this to fail.' }],
};

function confirmAction({ composed, report = REPORT_PASS, acknowledged = new Set() }) {
    return {
        phase: 'ready',
        composed: { chainId: 'bitcoin-mainnet', psbt: 'x', ...composed },
        report,
        acknowledged,
        acknowledge: () => {},
        canApprove: canApproveWithReport(report, acknowledged),
        approve: () => {},
        reject: () => {},
        error: null,
        source: null,
    };
}

function renderScreen(action) {
    return render(
        <ActionConfirmScreen
            confirmAction={action}
            chainLabel="Bitcoin"
            signerReady
            password=""
            onPasswordChange={() => {}}
        />,
    );
}

describe('confirm screen consequence warnings', () => {
    it('shows the LIST transfer warnings in one card for a list transfer', () => {
        renderScreen(confirmAction({
            composed: { action: 'LIST', version: 3, actionString: 'LIST|3|7|bc1q|', actionWarnings: ['LIST_TRANSFER'] },
        }));
        // The short warning (G127 revised 2026-11-16): one danger notice.
        const cards = screen.getAllByTestId('confirm-warning');
        expect(cards).toHaveLength(1);
        expect(cards[0].getAttribute('data-tone')).toBe('danger');
        // A bold title and one short line.
        expect(cards[0].textContent.startsWith("You can't undo this")).toBe(true);
        expect([...cards[0].querySelectorAll('[data-testid="confirm-warning-point"]')].map((li) => li.textContent)).toEqual([
            'The new owner controls this list from this block on.',
        ]);
        // After the details, in the scrolling page; the docked footer holds
        // only Reject and Approve.
        const facts = screen.getByTestId('confirm-facts');
        expect(facts.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(cards[0].closest('main')).toBeTruthy();
        const decision = screen.getByTestId('confirm-decision');
        expect([...decision.children]).toEqual([screen.getByTestId('confirm-buttons')]);
        expect(decision.closest('footer')).toBeTruthy();
    });

    it('shows no warning for a plain send', () => {
        renderScreen(confirmAction({
            composed: { action: 'SEND', version: 0, actionString: 'SEND|0|JDOG|1|bc1q', actionWarnings: [] },
        }));
        expect(screen.queryByTestId('confirm-warning')).toBeNull();
    });

    it('shows no warning for a bare coin payment with no ids', () => {
        renderScreen(confirmAction({ composed: { bareNativePayment: true }, report: null }));
        expect(screen.queryByTestId('confirm-warning')).toBeNull();
    });

    it('says a decoder line the card covers once, in the card, and keeps the decoder lint', () => {
        renderScreen(confirmAction({
            composed: {
                action: 'DESTROY',
                version: 0,
                actionWarnings: ['DESTROY'],
                decoded: {
                    summary: 'Destroy 1 JDOG',
                    details: [{ label: 'Token', value: 'JDOG' }],
                    warnings: [
                        'Destroying is irreversible. The tokens cannot be recovered.',
                        'Memo contains | or ;: the protocol will reject this transaction.',
                    ],
                },
            },
        }));
        const page = screen.getByTestId('confirm-modal');
        expect(screen.getByTestId('confirm-warning').textContent)
            .toContain("You can't undo thisDestroyed tokens are burned for good.");
        expect(page.textContent).not.toContain('Destroying is irreversible.');
        expect(screen.getAllByText('Memo contains | or ;: the protocol will reject this transaction.')).toHaveLength(1);
    });

    it('shows the share lines the Share form used to show', () => {
        renderScreen(confirmAction({
            composed: { action: 'LIST', version: 2, actionWarnings: ['LIST_SHARE'] },
        }));
        expect(screen.getByTestId('confirm-warning').textContent.startsWith('Sharing is permanent')).toBe(true);
        expect([...screen.getByTestId('confirm-warning').querySelectorAll('[data-testid="confirm-warning-point"]')]
            .map((li) => li.textContent)).toEqual(['There is no unshare.']);
    });

    it('has no serious axe violations with the card shown', async () => {
        const { container } = renderScreen(confirmAction({
            composed: { action: 'LIST', version: 3, actionWarnings: ['LIST_TRANSFER'] },
        }));
        await expectNoSeriousAxeViolations(container);
    });
});

describe('confirm screen pre-flight invalid notice', () => {
    it('shows the reason first and sends nothing on Approve when pre-flight says invalid', () => {
        renderScreen(confirmAction({
            composed: { action: 'LIST', version: 3, actionWarnings: ['LIST_TRANSFER'] },
            report: REPORT_INVALID,
        }));
        // The failed check is the status notice at the top; the transfer's
        // line is the short warning after the details.
        const status = screen.getByTestId('confirm-status');
        expect(status.getAttribute('data-state')).toBe('fail');
        expect(status.textContent).toContain('This will fail');
        expect(status.textContent).toContain('The checks found a problem with this action.');
        expect(status.textContent).not.toContain('The new owner is not a valid address.');
        expect(status.textContent).not.toContain("Approve won't send this while it fails.");
        expect(screen.getByTestId('confirm-warning').textContent).toContain('The new owner controls this list from this block on.');
        const approve = screen.getByTestId('confirm-approve');
        expect(approve).toBeDisabled();
        fireEvent.click(approve);
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
        expect(screen.getAllByText('The checks found a problem with this action.')).toHaveLength(1);
    });

    it('keeps the deliberate Sign anyway override and says Approve waits for it', () => {
        renderScreen(confirmAction({
            composed: { action: 'SEND', version: 0, actionWarnings: [] },
            report: REPORT_OVERRIDABLE,
        }));
        expect(screen.getByTestId('confirm-status').textContent)
            .toContain('Tick Sign anyway to approve it.');
        expect(screen.getByTestId('confirm-approve')).toBeDisabled();
        expect(screen.getByTestId('ack-DRYRUN_INVALID')).toBeTruthy();
        expect(screen.getAllByText('The checks found a problem with this action.')).toHaveLength(1);
        expect(screen.queryByText('The network expects this to fail.')).toBeNull();
    });

    it('drops the Approve line once the override is ticked', () => {
        renderScreen(confirmAction({
            composed: { action: 'SEND', version: 0, actionWarnings: [] },
            report: REPORT_OVERRIDABLE,
            acknowledged: new Set(['DRYRUN_INVALID']),
        }));
        const lines = screen.getAllByTestId('confirm-warning-point').map((p) => p.textContent);
        expect(lines.some((line) => /Approve/.test(line))).toBe(false);
        expect(screen.getByTestId('confirm-approve')).not.toBeDisabled();
    });

    it('shows only the green status on a passing pre-flight', () => {
        renderScreen(confirmAction({ composed: { action: 'SEND', version: 0, actionWarnings: [] } }));
        expect(screen.queryByTestId('confirm-warning')).toBeNull();
        expect(screen.getByTestId('confirm-status').getAttribute('data-tone')).toBe('success');
        expect(screen.getByTestId('confirm-approve')).not.toBeDisabled();
    });
});
