// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The standalone ISSUE form derived BOTH MAX_SUPPLY and
// MINT_SUPPLY from the single "Supply" box, so every token the wallet
// created was born fully minted at its own cap: mint headroom exactly 0,
// and the whole Mint surface unreachable for anything issued here.
// Confirmed on-chain on regtest tick S18PROBE (wallet E2E session 18):
// supply.current 5,000 == supply.max 5,000, and the Mint attempt refused
// by the network dry-run with "invalid: mint exceeds MAX_SUPPLY".
//
// These drive the form to the confirm page and read the ISSUE params off
// the host-side compose call, which is the exact payload that becomes the
// broadcast action.

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

// Fill ticker + supply (+ optional initial mint) and submit.
async function fill({ supply, initialMint, lockSupply }) {
    fireEvent.change(await screen.findByLabelText('Ticker'), {
        target: { value: 'MINTABLE' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: supply } });
    if (initialMint !== undefined) {
        fireEvent.change(screen.getByLabelText('Initial mint (optional)'), {
            target: { value: initialMint },
        });
    }
    if (lockSupply) {
        fireEvent.click(screen.getByLabelText('Lock supply + minting (irreversible)'));
    }
}

async function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

// The ISSUE params as they reach the host-side compose.
async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

afterEach(() => cleanup());
beforeEach(() => { composeForConfirm = undefined; });

describe('IssueTokenForm initial mint', () => {
    it('leaves mint headroom when the initial mint is below the supply', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '1000' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBe('5000');
        expect(params.MINT_SUPPLY).toBe('1000');
    });

    it('mints the whole supply when the initial mint is left blank', async () => {
        mountForm();
        await fill({ supply: '5000' });
        await submit();

        const params = await composedParams();
        // The simple path is unchanged: one number in, fully minted token out.
        expect(params.MAX_SUPPLY).toBe('5000');
        expect(params.MINT_SUPPLY).toBe('5000');
    });

    it('omits MINT_SUPPLY entirely for a fair-mint (initial mint 0)', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '0' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBe('5000');
        // Nothing minted at issuance: the whole cap stays publicly mintable.
        expect(params.MINT_SUPPLY).toBeUndefined();
    });

    it('refuses an initial mint above the supply instead of paying for a rejected ISSUE', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '6000' });
        await submit();

        await screen.findByText('Initial mint cannot be more than the supply.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses a 0 initial mint that is locked out of ever minting', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '0', lockSupply: true });
        await submit();

        await screen.findByText(
            'An initial mint of 0 needs minting left unlocked, or the token can never have any supply.',
        );
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('warns that locking minting strands the unminted remainder', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '1000', lockSupply: true });

        // 5000 cap minus a 1000 initial mint: 4000 would be stranded.
        await screen.findByText(/4000 left under the cap can never be minted/);
    });
});
