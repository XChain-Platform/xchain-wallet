// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Races around the Issue Token form's compose and sign. The form holds the
// values, the host composes those values, and the confirm page signs what the
// host composed; every test here checks the three agree, and that a subtoken
// parent answer about values no longer on screen never composes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { ownedTokensFor, pickParentToken } from '../../helpers/issueParentPicker.js';

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
        // The Parent token picker's list of owned tokens.
        getOwnedTokens: ownedTokensFor(vi.fn, ADDRESSES['bitcoin-regtest'][0].address, ['MINE', 'PARENT', 'THEIRS']),
        ...overrides,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: 'w', onBack() {} }),
    ));
    return messaging;
}

// Fill the form (optionally on a template); the caller submits it.
async function fillForm({ template = 'Utility token', name = 'RACE', supply = '100' } = {}) {
    await screen.findByLabelText('Ticker');
    fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(template) }));
    fireEvent.change(screen.getByRole('textbox', { name: /^(Ticker|Subtoken name)$/ }), { target: { value: name } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: supply } });
}

const issueForm = () => screen.getByRole('form', { name: 'Issue Token' });

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

afterEach(() => cleanup());

describe('Issue Token compose and sign races', () => {
    it('composes once for a triple submit', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await fillForm();
        const form = issueForm();
        fireEvent.submit(form);
        fireEvent.submit(form);
        fireEvent.submit(form);
        await act(async () => { gate.resolve(COMPOSED); });
        await screen.findByTestId('confirm-approve');
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('signs once for a double Approve', async () => {
        const messaging = mountWizard();
        await fillForm();
        fireEvent.submit(issueForm());
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        fireEvent.click(approve);
        await screen.findByText('cd'.repeat(32));
        expect(messaging.issueToken).toHaveBeenCalledTimes(1);
    });

    it('holds the form still while the host composes it', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await fillForm({ supply: '100' });
        fireEvent.submit(issueForm());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));

        // Back and the fields are held while the compose of supply 100 is in
        // flight, so no other supply can be on screen when it confirms.
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        expect(back).toBeDisabled();
        const supplyField = screen.getByRole('textbox', { name: 'Max supply' });
        expect(supplyField).toBeDisabled();

        await act(async () => { gate.resolve(COMPOSED); });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));

        // What was composed is what is signed.
        const composedParams = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        const signedParams = messaging.issueToken.mock.calls[0][0].params;
        expect(composedParams.MAX_SUPPLY).toBe('100');
        expect(signedParams).toEqual(composedParams);
    });

    it('does not compose when a field changes during the parent lookup', async () => {
        const lookup = deferred();
        // The PARENT.CHILD availability lookup answers 'not issued'; the
        // parent ownership lookup is the one held open.
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'PARENT' ? lookup.promise : Promise.resolve({})));
        const messaging = mountWizard({ getTokenInfo });
        await fillForm({ template: 'Subtoken', name: 'CHILD' });
        await pickParentToken('PARENT');
        fireEvent.submit(issueForm());
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PARENT' })));

        // A new supply while the parent is still being looked up.
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '999' } });
        await act(async () => {
            lookup.resolve({ creator: ADDRESSES['bitcoin-regtest'][0].address });
        });

        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirm-approve')).toBeNull();
    });

    it('does not compose a parent picked after the lookup started', async () => {
        const lookup = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'MINE' ? lookup.promise : Promise.resolve({})));
        const messaging = mountWizard({ getTokenInfo });
        await fillForm({ template: 'Subtoken', name: 'CHILD' });
        await pickParentToken('MINE');
        fireEvent.submit(issueForm());
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'MINE' })));

        await pickParentToken('THEIRS');
        await act(async () => {
            lookup.resolve({ creator: ADDRESSES['bitcoin-regtest'][0].address });
        });

        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        // A fresh submit looks the new parent up.
        fireEvent.submit(issueForm());
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'THEIRS' })));
    });
});
