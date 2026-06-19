// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Behavioural test for the Token Creation Wizard's native-coin fee
// toggle. The render guard (routes-render) only proves the wizard mounts;
// this drives the full template -> chain -> details -> preview -> sign
// flow and asserts the opt-in actually threads `payFeeInNativeCoin` into
// the messaging.issueToken submit payload (and surfaces the forfeiture
// warning on the review stage). Mirrors the per-form toggle that shipped
// on the standalone Issue/Dispenser/Swap/Order/Advanced forms.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { NATIVE_FEE_WARNING } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

// One HD address on Bitcoin mainnet so the wizard auto-picks a fee-payer
// and the native-coin toggle resolves a coin ticker (BTC).
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

let issueToken;

function mountWizard() {
    issueToken = vi.fn().mockResolvedValue({ txid: 'deadbeef' });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        issueToken,
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
        ),
    );
}

// Drive template -> chain -> details (meme: name + supply) -> preview.
// `nativeFee` flips the toggle on the details stage when true.
async function driveToPreview({ nativeFee }) {
    fireEvent.click(await screen.findByText('Meme token'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), {
        target: { value: 'MEMECOIN' },
    });
    fireEvent.change(screen.getByLabelText('Supply'), {
        target: { value: '1000' },
    });
    if (nativeFee) fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
}

beforeEach(() => {
    issueToken = undefined;
});
afterEach(() => cleanup());

describe('TokenWizard native-coin fee toggle', () => {
    it('threads payFeeInNativeCoin: true into the issueToken submit when toggled on', async () => {
        mountWizard();
        await driveToPreview({ nativeFee: true });

        // Review stage surfaces the forfeiture warning while the toggle is on.
        expect(screen.getByText(NATIVE_FEE_WARNING)).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'pw' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

        await waitFor(() => expect(issueToken).toHaveBeenCalledTimes(1));
        expect(issueToken.mock.calls[0][0].payFeeInNativeCoin).toBe(true);
    });

    it('omits the flag (undefined, not false) when the toggle is left off', async () => {
        mountWizard();
        await driveToPreview({ nativeFee: false });

        // No toggle => no forfeiture warning on review.
        expect(screen.queryByText(NATIVE_FEE_WARNING)).toBeNull();

        fireEvent.change(screen.getByLabelText('Password'), {
            target: { value: 'pw' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

        await waitFor(() => expect(issueToken).toHaveBeenCalledTimes(1));
        expect(issueToken.mock.calls[0][0].payFeeInNativeCoin).toBeUndefined();
    });
});
