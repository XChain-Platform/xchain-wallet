// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ISSUE v0 carries two destinations: TRANSFER (issuer rights) and
// TRANSFER_SUPPLY (where the initial mint lands). The form offered only the
// first, labelled "Transfer ownership to", and a testnet issuer who filled it
// handed the operator control of Charlie_Lee on TLTC while keeping all
// 84,000,000 minted units, then reported the balance as a bug. These pin
// that the two fields stay independent on the wire and that the supply
// field is refused where the chain would ignore it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const OWNER = 'bc1qownerownerownerownerownerownerowner';
const HOLDER = 'bc1qholderholderholderholderholderholde';

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

async function fill({ supply, initialMint, owner, holder }) {
    fireEvent.change(await screen.findByLabelText('Ticker'), {
        target: { value: 'Charlie_Lee' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: supply } });
    if (initialMint !== undefined) {
        fireEvent.change(screen.getByLabelText('Initial mint (optional)'), {
            target: { value: initialMint },
        });
    }
    if (owner !== undefined) {
        fireEvent.change(screen.getByLabelText('Transfer ownership to (optional)'), {
            target: { value: owner },
        });
    }
    if (holder !== undefined) {
        fireEvent.change(screen.getByLabelText('Send the initial mint to (optional)'), {
            target: { value: holder },
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

describe('IssueTokenForm ownership transfer versus supply transfer', () => {
    it('an ownership transfer alone never moves the minted supply', async () => {
        mountForm();
        await fill({ supply: '84000000', owner: OWNER });
        await submit();

        const params = await composedParams();
        // The Charlie_Lee shape: rights to the new owner, every unit stays home.
        expect(params.TRANSFER).toBe(OWNER);
        expect(params.MINT_SUPPLY).toBe('84000000');
        expect(params.TRANSFER_SUPPLY).toBeUndefined();
    });

    it('the supply field sets TRANSFER_SUPPLY without touching ownership', async () => {
        mountForm();
        await fill({ supply: '5000', holder: HOLDER });
        await submit();

        const params = await composedParams();
        expect(params.TRANSFER).toBeUndefined();
        expect(params.TRANSFER_SUPPLY).toBe(HOLDER);
    });

    it('both fields ride the same ISSUE with their own destinations', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '1000', owner: OWNER, holder: HOLDER });
        await submit();

        const params = await composedParams();
        expect(params.TRANSFER).toBe(OWNER);
        expect(params.TRANSFER_SUPPLY).toBe(HOLDER);
        expect(params.MINT_SUPPLY).toBe('1000');
    });

    it('refuses a supply destination on a fair-mint, where nothing is minted to send', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '0', holder: HOLDER });
        await submit();

        await screen.findByText('Sending the initial mint somewhere needs an initial mint above 0.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('says on the form itself that ownership and the minted tokens move separately', async () => {
        mountForm();
        await screen.findByLabelText('Ticker');
        expect(screen.getByText(/the minted tokens stay with the issuing address/i)).toBeTruthy();
    });
});
