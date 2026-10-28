// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Races around the wizard's review and sign steps. The review shows a
// decode of the form values, the host composes those values, and the confirm
// page signs what the host composed; every test here checks the three agree.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

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

function mountWizard(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs: vi.fn().mockResolvedValue({}),
        issueToken: vi.fn().mockResolvedValue({ txid: 'cd'.repeat(32) }),
        ...overrides,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
    ));
    return messaging;
}

async function reachReview({ template = 'Utility token', name = 'RACE', supply = '100' } = {}) {
    fireEvent.click(await screen.findByText(template));
    await screen.findByLabelText('Fee paid by');
    fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: supply } });
    fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
    await screen.findByText('Step 4 of 4: Review');
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

afterEach(() => cleanup());

describe('TokenWizard review and sign races', () => {
    it('composes once for a double submit at Review', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await reachReview();
        const form = screen.getByRole('form', { name: 'Review token issuance' });
        fireEvent.submit(form);
        fireEvent.submit(form);
        fireEvent.submit(form);
        await act(async () => { gate.resolve(COMPOSED); });
        await screen.findByTestId('confirm-approve');
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('signs once for a double Approve', async () => {
        const messaging = mountWizard();
        await reachReview();
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        fireEvent.click(approve);
        await screen.findByText('cd'.repeat(32));
        expect(messaging.issueToken).toHaveBeenCalledTimes(1);
    });

    it('keeps the review on screen while the host composes it', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await reachReview({ supply: '100' });
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        // Back while the compose of supply 100 is in flight, then a new supply.
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        expect(back).toBeDisabled();
        fireEvent.click(back);
        fireEvent.keyDown(document, { key: 'Escape' });
        const supplyField = screen.queryByLabelText('Supply');
        if (supplyField) fireEvent.change(supplyField, { target: { value: '999' } });

        await act(async () => { gate.resolve(COMPOSED); });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));

        // What was composed is what is signed, and the user never saw a
        // different supply on screen while it was being composed.
        const composedParams = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        const signedParams = messaging.issueToken.mock.calls[0][0].params;
        expect(signedParams).toEqual(composedParams);
        expect(supplyField).toBeNull();
    });

    it('does not jump to Review when the user leaves Details during the parent lookup', async () => {
        const lookup = deferred();
        // The PARENT.CHILD availability lookup answers 'not issued'; the
        // parent ownership lookup is the one held open.
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'PARENT' ? lookup.promise : Promise.resolve({})));
        mountWizard({ getTokenInfo });
        fireEvent.click(await screen.findByText('Subtoken'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'PARENT' } });
        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PARENT' })));

        // Back to Network while the parent is still being looked up.
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await act(async () => {
            lookup.resolve({ creator: ADDRESSES['bitcoin-regtest'][0].address });
        });

        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
    });

    it('does not review a parent typed after the lookup started', async () => {
        const lookup = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'MINE' ? lookup.promise : Promise.resolve({})));
        mountWizard({ getTokenInfo });
        fireEvent.click(await screen.findByText('Subtoken'));
        await screen.findByLabelText('Fee paid by');
        fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'MINE' } });
        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'MINE' })));

        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'THEIRS' } });
        await act(async () => {
            lookup.resolve({ creator: ADDRESSES['bitcoin-regtest'][0].address });
        });

        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        expect(screen.queryByText('THEIRS.CHILD')).toBeNull();
        // A fresh submit looks the new parent up.
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'THEIRS' })));
    });
});
