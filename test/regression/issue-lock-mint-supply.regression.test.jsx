// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the Issue form's "Lock supply + minting" option.
//
//   [L1] The option writes LOCK_MINT_SUPPLY beside LOCK_MAX_SUPPLY and
//        LOCK_MINT, matching the wizard's meme and collectible templates,
//        so an owner who locked minting cannot mint through a re-ISSUE.

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
        composeForConfirm: vi.fn(async () => ({
            psbt: 'aa00',
            encoding: 'psbt',
            actionString: 'ISSUE|0|LOCKTEST|1000',
            version: 1,
            chainId: CHAIN_ID,
            decoded: { summary: 'Issue 1,000 LOCKTEST', details: [], warnings: [] },
        })),
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

function composedParams(messaging) {
    const call = messaging.composeForConfirm.mock.calls[0]?.[0];
    return call?.actionData?.params ?? call?.params;
}

describe('regression/issue-lock-mint-supply', () => {
    async function submit(lock) {
        const messaging = messagingFor();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'LOCKTEST' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        if (lock) fireEvent.click(screen.getByLabelText(/Lock supply \+ minting/));
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        return composedParams(messaging);
    }

    it('[REGRESSION L1] locking supply and minting writes all three lock flags', async () => {
        const params = await submit(true);
        expect(params.LOCK_MAX_SUPPLY).toBe('1');
        expect(params.LOCK_MINT).toBe('1');
        expect(params.LOCK_MINT_SUPPLY).toBe('1');
    });

    it('[REGRESSION L1] leaving the option off writes no lock flag', async () => {
        const params = await submit(false);
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
        expect(params.LOCK_MINT).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });
});
