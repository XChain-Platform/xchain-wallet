// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wizard's Custom template is the second place a token is issued with an
// ownership field, so it carries the same pair the standalone form does
// (IssueTokenForm.transferSupply.test.jsx): TRANSFER for the issuer rights,
// TRANSFER_SUPPLY for where the minted units land, never one implying the
// other.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

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

async function openCustom({ owner, holder }) {
    fireEvent.click(await screen.findByText('Custom'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText('Token name (ticker)')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'Charlie_Lee' } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '84000000' } });
    if (owner !== undefined) {
        fireEvent.change(screen.getByLabelText('Transfer ownership to (optional)'), { target: { value: owner } });
    }
    if (holder !== undefined) {
        fireEvent.change(screen.getByLabelText('Send the initial mint to (optional)'), { target: { value: holder } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    const { actionData } = composeForConfirm.mock.calls[0][0];
    expect(actionData.action).toBe('ISSUE');
    return actionData.params;
}

afterEach(() => cleanup());

describe('TokenWizard custom template: ownership versus minted supply', () => {
    it('an ownership transfer alone leaves the minted supply with the issuer', async () => {
        mountWizard();
        await openCustom({ owner: OWNER });
        const params = await composedParams();
        expect(params.TRANSFER).toBe(OWNER);
        expect(params.MINT_SUPPLY).toBe('84000000');
        expect(params.TRANSFER_SUPPLY).toBeUndefined();
    });

    it('the supply field sets TRANSFER_SUPPLY on its own', async () => {
        mountWizard();
        await openCustom({ holder: HOLDER });
        const params = await composedParams();
        expect(params.TRANSFER).toBeUndefined();
        expect(params.TRANSFER_SUPPLY).toBe(HOLDER);
    });

    it('both destinations ride one ISSUE', async () => {
        mountWizard();
        await openCustom({ owner: OWNER, holder: HOLDER });
        const params = await composedParams();
        expect(params.TRANSFER).toBe(OWNER);
        expect(params.TRANSFER_SUPPLY).toBe(HOLDER);
    });
});
