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
// These tests drive the real wizard and read the params handed to the host
// compose, so they fail if the composer stops writing the flag - the template
// would go back to promising something only the network can keep.

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

function submit() {
    fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
}

async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    const { actionData } = composeForConfirm.mock.calls[0][0];
    expect(actionData.action).toBe('ISSUE');
    return actionData.params;
}

afterEach(() => cleanup());

describe('TokenWizard fixed-supply templates lock MINT_SUPPLY', () => {
    it('the collectible composes all three locks, so its 1-of-1 needs no flag day', async () => {
        mountWizard();
        await pickTemplate('Collectible');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'ONEOFONE' },
        });
        fireEvent.change(screen.getByLabelText('Image URL'), {
            target: { value: 'https://example.com/art.png' },
        });
        submit();

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
        });
    });

    it('the meme token composes all three locks, so its fixed supply is the token\'s own', async () => {
        mountWizard();
        await pickTemplate('Meme token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'DANKCOIN' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '21000000' } });
        submit();

        expect(await composedParams()).toMatchObject({
            VERSION: '0',
            TICK: 'DANKCOIN',
            MAX_SUPPLY: '21000000',
            MINT_SUPPLY: '21000000',
            DECIMALS: '0',
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
            LOCK_MINT_SUPPLY: '1',
        });
    });

    it('leaves the mintable templates alone: edition keeps its public mint window open', async () => {
        // The lock is only correct where the template promises a supply that
        // cannot grow. Edition's whole point is that anyone can still MINT
        // prints, and utility/community are mintable by design, so writing
        // LOCK_MINT_SUPPLY there would permanently break them.
        mountWizard();
        await pickTemplate('Limited edition');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'PRINTS' },
        });
        fireEvent.change(screen.getByLabelText('Edition size'), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Copies per mint'), { target: { value: '1' } });
        submit();

        const params = await composedParams();
        expect(params.LOCK_MAX_SUPPLY).toBe('1');
        expect(params.LOCK_MINT).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });

    it('leaves the utility template mintable', async () => {
        mountWizard();
        await pickTemplate('Utility token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
            target: { value: 'UTIL' },
        });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '1000' } });
        submit();

        const params = await composedParams();
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
        expect(params.LOCK_MINT_SUPPLY).toBeUndefined();
    });
});
