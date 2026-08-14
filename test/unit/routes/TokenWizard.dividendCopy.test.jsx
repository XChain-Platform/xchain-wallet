// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wizard used to offer COMMUNITY and UTILITY as separate
// templates that composed a byte-identical ISSUE: the Community composer
// was literally `return TEMPLATE_COMPOSERS.utility(form)` and its field
// map was field-for-field the same. Community's only distinguishing
// promise was its tagline, "Dividend-enabled, mintable" - and
// xchain-indexer/src/actions/dividend.js has no per-token opt-in of any
// kind. Its validation asks only that TICK and DIVIDEND_TICK exist, that
// neither they nor the source are sleeping, and that the payer has the
// funds. Every token is dividend-capable, Meme and Collectible included.
//
// The harm is the INVERSE reading, which is why the copy is worth a test
// rather than a shrug: an issuer who wants to pay dividends and picked
// Utility concludes the door is shut, and that the remedy is to abandon a
// working token and re-issue under Community - a fresh ISSUE fee, a dead
// ticker, holders stranded, all for a distinction that never existed.
//
// So this file asserts the two halves of the fix together: the false
// choice is gone from the picker, and the truth is stated where the
// choice used to be made.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

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

function mountWizard() {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: null }),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

async function pickTemplate(label) {
    fireEvent.click(await screen.findByText(label));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText('Token name (ticker)')).toBeTruthy());
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    const { actionData } = composeForConfirm.mock.calls[0][0];
    expect(actionData.action).toBe('ISSUE');
    return actionData.params;
}

afterEach(() => cleanup());

describe('TokenWizard template picker (no phantom dividend template)', () => {
    it('offers no Community card, so no one can pick the template that changed nothing', async () => {
        mountWizard();
        await screen.findByText('Utility token');
        expect(screen.queryByText('Community')).toBeNull();
        expect(screen.queryByText(/Dividend-enabled/i)).toBeNull();
    });

    it('says on the picker that any token can pay dividends', async () => {
        mountWizard();
        const note = await screen.findByText(/Any token you create here can pay dividends/i);
        // The second sentence is the one that closes the inverse reading:
        // without it the note still reads as "some templates enable this".
        expect(note.textContent).toMatch(/not something a template turns on/i);
    });

    it('names dividends on the Utility card itself, where the old choice was made', async () => {
        mountWizard();
        const tagline = await screen.findByText(/Mintable, adjustable supply/i);
        expect(tagline.textContent).toMatch(/dividend/i);
        expect(tagline.textContent).toMatch(/every token/i);
    });

    it('still composes the mintable, adjustable ISSUE the merged template promises', async () => {
        // The merge is a copy change, not a behaviour change: whichever of
        // the two cards an issuer used to click, this is the ISSUE they got.
        mountWizard();
        await pickTemplate('Utility token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'DANKUTIL' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        fireEvent.change(screen.getByLabelText('Max mint per transaction (optional)'), {
            target: { value: '100' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));

        const params = await composedParams();
        expect(params).toMatchObject({
            VERSION: '0',
            TICK: 'DANKUTIL',
            MAX_SUPPLY: '1000',
            MINT_SUPPLY: '1000',
            MAX_MINT: '100',
            DECIMALS: '0',
        });
        // Mintable and adjustable: no lock may ride this template, or the
        // merged card stops keeping the promise both cards used to make.
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
        expect(params.LOCK_MINT).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });
});
