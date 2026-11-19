// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The COLLECTIBLE and MEME templates both promise a supply that can
// never grow. Two locks do not deliver that promise:
//
//   LOCK_MAX_SUPPLY  freezes the cap.
//   LOCK_MINT        closes the MINT action.
//   MINT_SUPPLY      is credited on EVERY valid ISSUE, not only the first.
//
// So an owner who re-ISSUEs the same tick with MINT_SUPPLY set, restating
// MAX_SUPPLY at its current value, walks past both locks and mints fresh
// supply onto a "1 of 1". The only thing that refuses it is the indexer's
// ISSUE_MINT_SUPPLY_CUMULATIVE_CAP protocol change, which is gated: active at
// genesis on testnet/regtest, but on mainnet only from 1786924800
// (2026-08-17). LOCK_MINT_SUPPLY is the token-level lock that closes the same
// path with no flag day involved (issue.js: "invalid: MINT_SUPPLY (locked)",
// checked BEFORE the gated cumulative cap), and it costs one more field in the
// same ISSUE transaction at the same fee.
//
// These tests pick each template on the real Issue Token form and read the
// params handed to the host compose, so they fail if a template stops writing
// the flag - it would go back to promising something only the network can keep.

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
    fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(label) }));
    await waitFor(() => expect(screen.getByLabelText('Ticker')).toBeTruthy());
}

const supplyField = () => screen.getByRole('textbox', { name: 'Max supply' });

async function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    const { actionData } = composeForConfirm.mock.calls[0][0];
    expect(actionData.action).toBe('ISSUE');
    return actionData.params;
}

afterEach(() => cleanup());

describe('Issue Token fixed-supply templates lock MINT_SUPPLY', () => {
    it('the collectible composes all three locks, so its 1-of-1 needs no flag day', async () => {
        mountWizard();
        await pickTemplate('Collectible');
        fireEvent.change(screen.getByLabelText('Ticker'), {
            target: { value: 'ONEOFONE' },
        });
        fireEvent.change(screen.getByLabelText('Image URL'), {
            target: { value: 'https://example.com/art.png' },
        });
        await submit();

        expect(await composedParams()).toMatchObject({
            VERSION: '0',
            TICK: 'ONEOFONE',
            MAX_SUPPLY: '1',
            MINT_SUPPLY: '1',
            DECIMALS: '0',
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
            // Without this the re-ISSUE below is refused only where
            // ISSUE_MINT_SUPPLY_CUMULATIVE_CAP has already activated.
            LOCK_MINT_SUPPLY: '1',
            // The artwork rides DESCRIPTION.
            DESCRIPTION: 'https://example.com/art.png',
        });
    });

    it('the meme token composes all three locks, so its fixed supply is the token\'s own', async () => {
        mountWizard();
        await pickTemplate('Meme token');
        fireEvent.change(screen.getByLabelText('Ticker'), {
            target: { value: 'DANKCOIN' },
        });
        fireEvent.change(supplyField(), { target: { value: '21000000' } });
        await submit();

        expect(await composedParams()).toMatchObject({
            VERSION: '0',
            TICK: 'DANKCOIN',
            MAX_SUPPLY: '21000000',
            MINT_SUPPLY: '21000000',
            DECIMALS: '0',
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
            LOCK_MINT_SUPPLY: '1',
            // The form's meme preset also freezes the per-mint limit.
            LOCK_MAX_MINT: '1',
        });
    });

    it('leaves the mintable templates alone: edition keeps its public mint window open', async () => {
        // The lock is only correct where the template promises a supply that
        // cannot grow. Edition's whole point is that anyone can still MINT
        // prints, and utility is mintable by design, so writing
        // LOCK_MINT_SUPPLY there would permanently break them.
        mountWizard();
        await pickTemplate('Limited edition');
        fireEvent.change(screen.getByLabelText('Ticker'), {
            target: { value: 'PRINTS' },
        });
        // Edition size is the max supply; copies per mint the per-transaction max.
        fireEvent.change(supplyField(), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Image URL'), {
            target: { value: 'https://example.com/prints.png' },
        });
        await submit();

        const params = await composedParams();
        expect(params).toMatchObject({
            TICK: 'PRINTS',
            MAX_SUPPLY: '10',
            MAX_MINT: '1',
            MINT_ADDRESS_MAX: '1',
            DECIMALS: '0',
            DESCRIPTION: 'https://example.com/prints.png',
        });
        expect(params.LOCK_MAX_SUPPLY).toBe('1');
        expect(params.LOCK_MINT).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
        // A fair mint: nothing is minted to the issuer at creation.
        expect(params.MINT_SUPPLY).toBeUndefined();
    });

    it('a meme picked after Limited edition still mints its whole supply', async () => {
        // Edition is a fair mint (initial mint 0); carried onto Meme, whose
        // locks close minting, it would issue a token that can never have
        // supply. Each template names its own initial mint.
        mountWizard();
        await pickTemplate('Limited edition');
        await pickTemplate('Meme token');
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'SWITCHED' } });
        fireEvent.change(supplyField(), { target: { value: '500' } });
        await submit();

        const params = await composedParams();
        expect(params).toMatchObject({
            MAX_SUPPLY: '500',
            MINT_SUPPLY: '500',
            LOCK_MINT: '1',
            LOCK_MINT_SUPPLY: '1',
        });
        expect(params.MINT_ADDRESS_MAX).toBeUndefined();
    });

    it('leaves the utility template mintable', async () => {
        mountWizard();
        await pickTemplate('Utility token');
        fireEvent.change(screen.getByLabelText('Ticker'), {
            target: { value: 'UTIL' },
        });
        fireEvent.change(supplyField(), { target: { value: '1000' } });
        await submit();

        const params = await composedParams();
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });
});
