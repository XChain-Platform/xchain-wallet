// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The standalone ISSUE form (Token Actions > "Issue token") never exposed a
// MAX_MINT field, unlike the Token Creation Wizard's utility/edition/custom
// templates. xchain-indexer stores an omitted MAX_MINT as 0 and MINT
// pre-flight (xchain-sdk src/preflight/checks/mint.js) now correctly reads
// that as "no per-tx cap" (see mintHeadroom fix), but the field's ABSENCE
// here was still a real gap: an issuer using this form had no way to set a
// real per-transaction mint cap at creation time without a separate
// Mint settings (ISSUE v2) edit afterward.
//
// These drive the form to the confirm page and read the ISSUE params off
// the host-side compose call, mirroring IssueTokenForm.initialMint.test.jsx.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: 'bc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

let composeForConfirm;

function mountForm() {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(IssueTokenForm, { walletId: 'w', onBack() {} }),
        ),
    );
}

async function fill({ supply, maxMint }) {
    fireEvent.change(await screen.findByLabelText('Ticker'), {
        target: { value: 'MINTABLE' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: supply } });
    if (maxMint !== undefined) {
        fireEvent.change(screen.getByLabelText('Max mint per transaction (optional)'), {
            target: { value: maxMint },
        });
    }
}

async function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

afterEach(() => cleanup());
beforeEach(() => { composeForConfirm = undefined; });

describe('IssueTokenForm max mint per transaction', () => {
    it('omits MAX_MINT when left blank (indexer reads that as no per-tx cap)', async () => {
        mountForm();
        await fill({ supply: '5000' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_MINT).toBeUndefined();
    });

    it('sets MAX_MINT from the field when filled in', async () => {
        mountForm();
        await fill({ supply: '5000', maxMint: '250' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_MINT).toBe('250');
    });

    it('rejects a zero or negative max mint before it costs a fee', async () => {
        mountForm();
        await fill({ supply: '5000', maxMint: '0' });
        await submit();

        await screen.findByText(
            'Max mint per transaction must be a positive number, or left blank for no limit.',
        );
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
