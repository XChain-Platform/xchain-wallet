// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: pre-flight findings on the token-issuance review.
//
//   [P1] 2026-10-13: The Issue token review presents every finding once and
//        describes a dry-run rejection as what the network would do. The
//        transaction is not signed or broadcast while it is under review.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { warningText } from '../../packages/core/src/shared/utils/preflightFindingCopy.js';

const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'issue-source',
    address: 'bc1qpreflightcopyregression',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'software-signer',
});

const FINDINGS = Object.freeze([
    Object.freeze({
        code: 'DRYRUN_INVALID',
        severity: 'error',
        source: 'dryrun',
        overridable: false,
        message: 'The network reports this will fail: invalid: TICK (reserved)',
        data: Object.freeze({ status: 'invalid: TICK (reserved)' }),
    }),
    Object.freeze({
        code: 'TICK_FORMAT',
        severity: 'warning',
        source: 'client',
        message: 'Ticker format needs review before signing.',
    }),
    Object.freeze({
        code: 'DRYRUN_UNAVAILABLE',
        severity: 'info',
        source: 'dryrun',
        message: 'The dry-run service did not return a second verdict.',
    }),
]);

function messagingFor(report) {
    const methods = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [ADDRESS] })),
        getActiveAddresses: vi.fn(async () => ({})),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        composeForConfirm: vi.fn(async () => ({
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'ISSUE|0|REGCOPY|1000',
            version: 1,
            chainId: CHAIN_ID,
            decoded: {
                summary: 'Issue 1,000 REGCOPY',
                details: [{ label: 'Token', value: 'REGCOPY' }],
                warnings: [],
            },
        })),
        preflight: vi.fn(async () => report),
        issueToken: vi.fn(async () => ({ txid: 'not-reached-during-review' })),
        releaseEncoderInputs: vi.fn(async () => undefined),
        reserve: vi.fn(async () => ({ id: 'reservation' })),
        releaseReservation: vi.fn(async () => undefined),
    };
    return new Proxy(methods, {
        get(target, property) {
            if (property in target) return target[property];
            return vi.fn(async () => []);
        },
    });
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('regression/preflight-findings-copy', () => {
    it('[REGRESSION P1] shows each Issue token finding once without claiming an unbroadcast refusal', async () => {
        const report = {
            schemaVersion: 1,
            verdict: 'fail',
            restricted: false,
            checksRun: ['local', 'dryrun'],
            findings: FINDINGS,
            unverified: [],
            quote: null,
            stateHeight: 123,
            elapsedMs: 5,
        };
        const messaging = messagingFor(report);
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );

        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'REGCOPY' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));

        // Confirm Standard (G127): the warning slot's one danger notice holds
        // every finding, each said once: the blocking reason, the warning, and
        // that the network check went unanswered.
        await waitFor(() => expect(screen.getByTestId('confirm-status'))
            .toHaveAttribute('data-state', 'fail'));
        const page = screen.getByTestId('confirm-modal');
        const notice = screen.getByTestId('confirm-status');
        expect(screen.getAllByTestId('confirm-status')).toHaveLength(1);
        expect(within(notice).getAllByText(/TICK \(reserved\)/i)).toHaveLength(1);
        expect(within(page).getAllByText(/TICK \(reserved\)/i)).toHaveLength(1);
        expect(within(page).getAllByText(warningText(FINDINGS[1]).headline)).toHaveLength(1);
        // The producer's own words ride under each line, once.
        expect(within(page).getAllByText('Ticker format needs review before signing.')).toHaveLength(1);
        expect(within(notice).getAllByText(/verdict was not reached/i)).toHaveLength(1);
        expect(within(page).getAllByText('The dry-run service did not return a second verdict.')).toHaveLength(1);
        // A blocking pre-flight finding disables Approve (operator ruling
        // 2026-11-23); the reason stays visible in the status above it.
        expect(screen.getByTestId('confirm-approve')).toBeDisabled();
        expect(messaging.issueToken).not.toHaveBeenCalled();
        // Nothing was broadcast, so the review says what the network would do,
        // never that it refused.
        expect(page.textContent).not.toMatch(/the network refused|was refused|has been refused/i);
    });
});
