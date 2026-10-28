// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Issue token goes straight from the form to the host compose, so the form
// is what stays on screen while the host builds the transaction. A value
// edited in that window is not in the transaction the confirm page then
// opens, and the user has no sign of it; the fields hold still instead.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';

const ADDRESSES = {
    'bitcoin-regtest': [{
        id: 'addr-1',
        address: 'bcrt1qexampleexampleexampleexampleexample0',
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
    }],
};
const COMPOSED = { psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0 };

function mount(composeForConfirm) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', network: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs: vi.fn().mockResolvedValue({}),
        issueToken: vi.fn().mockResolvedValue({ txid: 'ef'.repeat(32) }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(IssueTokenForm, { walletId: 'w-race', onBack() {} }),
    ));
    return messaging;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Issue token while the host composes', () => {
    it('holds every field until the confirm page opens for the submitted values', async () => {
        let release;
        const composeForConfirm = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const messaging = mount(composeForConfirm);
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'HOLD' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));

        for (const label of [
            'Ticker', 'Supply', 'Initial mint (optional)', 'Max mint per transaction (optional)',
            'Description (optional)', 'Transfer ownership to (optional)', 'Send the initial mint to (optional)',
        ]) {
            expect(screen.getByLabelText(label), label).toBeDisabled();
        }
        expect(screen.getByRole('switch', { name: 'Divisible (8 decimal places)' })).toBeDisabled();
        expect(screen.getByRole('switch', { name: /^Lock supply/ })).toBeDisabled();

        await act(async () => { release(COMPOSED); });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
        expect(messaging.issueToken.mock.calls[0][0].params)
            .toEqual(composeForConfirm.mock.calls[0][0].actionData.params);
    });

    it('opens the fields again when the confirm page is rejected', async () => {
        const composeForConfirm = vi.fn().mockResolvedValue(COMPOSED);
        mount(composeForConfirm);
        fireEvent.change(await screen.findByLabelText('Ticker'), { target: { value: 'BACK' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue token' }));
        fireEvent.click(await screen.findByTestId('confirm-reject'));
        expect(await screen.findByLabelText('Supply')).toBeEnabled();
        expect(screen.getByLabelText('Supply').value).toBe('5');
    });
});
