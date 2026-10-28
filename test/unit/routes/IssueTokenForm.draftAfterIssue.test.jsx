// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A saved Issue token draft is the token the user is about to create. Once
// the confirm page signs and broadcasts it, the draft describes a token that
// exists, and offering it back as "unfinished" invites a second ISSUE of the
// same ticker: a re-ISSUE from the owner either fails on chain (the fee is
// spent) or, with a partial initial mint, mints that amount again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const CHAIN = 'bitcoin-regtest';
const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: 'bcrt1qexampleexampleexampleexampleexample0',
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
    }],
};

function makeMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', network: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs: vi.fn().mockResolvedValue({}),
        issueToken: vi.fn().mockResolvedValue({ txid: 'ab'.repeat(32) }),
        ...overrides,
    };
}

function mount(messaging) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(IssueTokenForm, { walletId: 'w-draft', onBack() {} }),
    ));
}

function savedDraftKeys() {
    return Object.keys(localStorage).filter((k) => k.startsWith('xc:formdraft:issue-token:'));
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Issue token draft after a confirmed issuance', () => {
    it('drops the saved draft once the confirm page broadcasts the token', async () => {
        const messaging = makeMessaging();
        mount(messaging);
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'ONCEONLY' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.change(screen.getByLabelText('Initial mint (optional)'), { target: { value: '100' } });
        await waitFor(() => expect(savedDraftKeys()).toHaveLength(1));

        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
        expect(await screen.findByText('ab'.repeat(32))).toBeTruthy();

        expect(savedDraftKeys()).toHaveLength(0);

        // Reopening the form offers nothing to restore.
        cleanup();
        mount(makeMessaging());
        await screen.findByLabelText('Ticker');
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    });

    it('keeps the draft when the confirm page is rejected', async () => {
        const messaging = makeMessaging();
        mount(messaging);
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'KEEPME' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '10' } });
        await waitFor(() => expect(savedDraftKeys()).toHaveLength(1));

        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        fireEvent.click(await screen.findByTestId('confirm-reject'));
        await screen.findByLabelText('Ticker');
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(savedDraftKeys()).toHaveLength(1);
    });
});
