// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the Issue form's error summary names a field once.
//
//   [S1] An invalid Transfer ownership address reads as one sentence in the
//        summary, not "Transfer ownership to: Transfer ownership address ...".

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'issue-source',
    address: 'bc1qlockmintsupplyregression',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'software-signer',
});

function messagingFor() {
    const methods = {
        getAddressesByChain: vi.fn(async () => ({ [CHAIN_ID]: [ADDRESS] })),
        getActiveAddresses: vi.fn(async () => ({})),
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        preflight: vi.fn(async () => ({
            schemaVersion: 1, verdict: 'pass', restricted: false, checksRun: ['local'],
            findings: [], unverified: [], quote: null, stateHeight: 1, elapsedMs: 1,
        })),
        issueToken: vi.fn(async () => ({ txid: 'not-reached' })),
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

describe('regression/issue-summary-label', () => {
    it('[REGRESSION S1] does not repeat the field label before a message that names the field', async () => {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'LABELTEST' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.change(screen.getByLabelText('Transfer ownership to (optional)'), { target: { value: 'not-an-address' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        const alert = await screen.findByRole('alert', { name: 'Form errors' });
        await waitFor(() => expect(alert.textContent).toMatch(/Transfer ownership address is not valid/));
        expect(alert.textContent).not.toMatch(/Transfer ownership to:/);
        expect(alert.textContent.match(/Transfer ownership/g)).toHaveLength(1);
    });
});
