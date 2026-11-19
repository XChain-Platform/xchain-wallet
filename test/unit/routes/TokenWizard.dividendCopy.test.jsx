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
// So this file asserts the template distinction where the choice is made (the
// Issue Token form's template picker), along with the row presentation that
// helps users scan those choices.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
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

function mountWizard(props = {}) {
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
            React.createElement(TokenWizard, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

async function openTemplates() {
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    return screen.getAllByRole('option');
}

async function pickTemplate(label) {
    await openTemplates();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
    await waitFor(() => expect(screen.getByLabelText('Ticker')).toBeTruthy());
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    const { actionData } = composeForConfirm.mock.calls[0][0];
    expect(actionData.action).toBe('ISSUE');
    return actionData.params;
}

afterEach(() => cleanup());

describe('Issue Token template picker (no phantom dividend template)', () => {
    it('offers no Community template, so no one can pick the template that changed nothing', async () => {
        mountWizard();
        const options = await openTemplates();
        expect(options.some((o) => /Community/.test(o.textContent))).toBe(false);
        expect(screen.queryByText(/Dividend-enabled/i)).toBeNull();
    });

    it('opens straight on the full issue form, so no Custom template is needed to reach it', async () => {
        const onCustom = vi.fn();
        mountWizard({ onCustom });
        // Every ISSUE field is on this one form already.
        expect(await screen.findByLabelText('Ticker')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Issue Token' })).toBeTruthy();
        const options = await openTemplates();
        expect(options.some((o) => /^Custom/.test(o.textContent))).toBe(false);
        expect(onCustom).not.toHaveBeenCalled();
    });

    it('renders every template with its icon and name together, without legacy names', async () => {
        mountWizard();
        const options = await openTemplates();
        const names = ['Meme token', 'Utility token', 'Collectible', 'Limited edition', 'Subtoken'];
        for (const name of names) {
            const option = options.find((o) => o.textContent.startsWith(name));
            expect(option, `${name} option`).toBeTruthy();
            expect(option.querySelector('svg'), `${name} icon`).toBeTruthy();
        }
        expect(screen.queryByText(/Any token you issue here can pay dividends/i)).toBeNull();
        const listbox = screen.getByRole('listbox');
        expect(listbox.textContent).not.toMatch(/child token|subasset|sub-token/i);
    });

    it('names dividends on the Utility template itself, where the old choice was made', async () => {
        mountWizard();
        await openTemplates();
        const tagline = screen.getByText(/Mintable, adjustable supply/i);
        expect(tagline.textContent).toMatch(/dividend/i);
        expect(tagline.textContent).toMatch(/every token/i);
    });

    it('still composes the mintable, adjustable ISSUE the merged template promises', async () => {
        // The merge is a copy change, not a behaviour change: whichever of
        // the two cards an issuer used to click, this is the ISSUE they got.
        mountWizard();
        await pickTemplate('Utility token');
        fireEvent.change(screen.getByLabelText('Ticker'), {
            target: { value: 'DANKUTIL' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
        fireEvent.change(screen.getByLabelText('Max per transaction'), {
            target: { value: '100' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));

        const params = await composedParams();
        expect(params).toMatchObject({
            VERSION: '0',
            TICK: 'DANKUTIL',
            MAX_SUPPLY: '1000',
            MINT_SUPPLY: '1000',
            MAX_MINT: '100',
            // The form's Utility template is divisible (the wizard's left it
            // off and composed '0').
            DECIMALS: '8',
        });
        // Mintable and adjustable: no lock may ride this template, or the
        // merged card stops keeping the promise both cards used to make.
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
        expect(params.LOCK_MINT).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });
});
