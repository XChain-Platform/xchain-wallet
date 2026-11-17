// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Advanced Actions review stage names the action in words, the same
// label the success heading uses, never the raw protocol code.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { selectOption, selectOptionValues } from '../../helpers/selectOption.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const BTC = 'bitcoin-mainnet';
const FROM = {
    id: 'bc-0',
    address: 'bc1qreviewlabeladdress0000000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => { cleanup(); resetWalletModes(); });

function watcherMessaging() {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
    const target = {
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'watcher' }]),
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listActions: vi.fn().mockResolvedValue(['EXECUTE', 'XBRIDGE']),
        getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION' }),
        getActionFields: vi.fn().mockResolvedValue([]),
    };
    return new Proxy(target, {
        get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
        has: (t, prop) => prop in t,
    });
}

async function openReview(actionCode) {
    render(
        <MessagingProvider shell="web" messaging={watcherMessaging()}>
            <AdvancedActionsForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    const picker = await screen.findByRole('combobox', { name: 'Action' });
    await waitFor(() => expect(selectOptionValues(picker)).toContain(actionCode));
    selectOption(picker, actionCode);
    const submit = await screen.findByRole('button', { name: 'Sign Action' });
    fireEvent.click(submit);
}

describe('AdvancedActionsForm review stage wording', () => {
    it('titles a watcher-mode EXECUTE review as a contract call', async () => {
        await openReview('EXECUTE');

        expect(await screen.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Call');
        const submit = screen.getByRole('button', { name: 'Approve' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit.querySelector('svg')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.queryByText(/Estimate unavailable/)).not.toBeInTheDocument();
        expect(screen.getByText('Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.')).toBeInTheDocument();
        expect(screen.queryByText(/Review EXECUTE|: EXECUTE/)).not.toBeInTheDocument();
    });

    it('titles a watcher-mode XBRIDGE review as a bridge transfer', async () => {
        await openReview('XBRIDGE');

        expect(await screen.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Bridge transfer');
        expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });
});
