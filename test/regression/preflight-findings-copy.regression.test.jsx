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
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));

        await waitFor(() => expect(screen.getByTestId('preflight-panel'))
            .toHaveAttribute('data-verdict', 'fail'));
        const panel = screen.getByTestId('preflight-panel');
        expect(screen.getAllByTestId('preflight-panel')).toHaveLength(1);
        expect(within(panel).getAllByRole('listitem')).toHaveLength(FINDINGS.length);
        expect(within(panel).getAllByText(/TICK \(reserved\)/i)).toHaveLength(1);
        expect(within(panel).getAllByText('Ticker format needs review before signing.')).toHaveLength(1);
        expect(within(panel).getAllByText('The dry-run service did not return a second verdict.')).toHaveLength(1);
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(within(panel).queryByText(/the network refused/i)).toBeNull();
    });
});
