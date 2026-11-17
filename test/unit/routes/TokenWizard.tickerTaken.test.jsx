// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Create a token route (the one Issue Token form) checks the ticker
// against the chain while it is typed, and keeps a taken name from composing:
// the chain refuses an ISSUE of an existing ticker after the fee.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { ownedTokensFor, pickParentToken } from '../../helpers/issueParentPicker.js';

const CHAIN = 'bitcoin-regtest';
const OWNER = 'bcrt1qexampleexampleexampleexampleexample0';
const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: OWNER,
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
    }],
};
const EMPTY = { creator: null, totalSupply: null, canonicalTick: null };
const FOUND = { creator: 'bcrt1qsomeoneelse', totalSupply: '10', canonicalTick: 'TAKEN' };

function mountWizard(getTokenInfo) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getTokenInfo,
        getOwnedTokens: ownedTokensFor(vi.fn, OWNER, ['PARENT']),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: 'w-ticker', onBack() {} }),
    ));
    return messaging;
}

async function reachForm(template) {
    await screen.findByLabelText('Ticker');
    if (template) {
        fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
        fireEvent.click(screen.getByRole('option', { name: new RegExp(template) }));
    }
}

const nameField = () => screen.getByRole('textbox', { name: /^(Ticker|Subtoken name)$/ });
const supplyField = () => screen.getByRole('textbox', { name: 'Max supply' });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
const composed = (messaging) => messaging.composeForConfirm.mock.calls[0][0].actionData.params;

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Issue Token ticker availability', () => {
    it('marks a taken name on the field and keeps it from composing', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(tick === 'TAKEN' ? FOUND : EMPTY));
        const messaging = mountWizard(getTokenInfo);
        await reachForm();
        fireEvent.change(nameField(), { target: { value: 'TAKEN' } });
        fireEvent.change(supplyField(), { target: { value: '100' } });

        expect(await screen.findByText('Ticker "TAKEN" already exists on this network.'))
            .toBeInTheDocument();
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'TAKEN' });

        submit();
        await waitFor(() => {
            expect(screen.getAllByText('Ticker "TAKEN" already exists on this network.').length)
                .toBeGreaterThan(1);
        });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        // A free name clears the field message and composes.
        fireEvent.change(nameField(), { target: { value: 'FREE' } });
        submit();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composed(messaging).TICK).toBe('FREE');
    });

    it('holds a submit made during the lookup and refuses it when the name is taken', async () => {
        const gate = deferred();
        const messaging = mountWizard(vi.fn(() => gate.promise));
        await reachForm();
        fireEvent.change(nameField(), { target: { value: 'TAKEN' } });
        fireEvent.change(supplyField(), { target: { value: '100' } });
        submit();

        await new Promise((resolve) => { setTimeout(resolve, 450); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        await act(async () => { gate.resolve(FOUND); });
        expect((await screen.findAllByText('Ticker "TAKEN" already exists on this network.')).length)
            .toBeGreaterThan(1);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not let a late answer for an earlier name mark the current one taken', async () => {
        const early = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'EARLY' ? early.promise : Promise.resolve(EMPTY)));
        const messaging = mountWizard(getTokenInfo);
        await reachForm();
        fireEvent.change(nameField(), { target: { value: 'EARLY' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'EARLY' }));
        fireEvent.change(nameField(), { target: { value: 'LATER' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'LATER' }));
        await act(async () => { early.resolve(FOUND); });

        expect(screen.queryByText(/already exists on this network/)).toBeNull();
        fireEvent.change(supplyField(), { target: { value: '100' } });
        submit();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composed(messaging).TICK).toBe('LATER');
    });

    it('lets the issue proceed when the lookup fails', async () => {
        const messaging = mountWizard(vi.fn().mockRejectedValue(new Error('explorer offline')));
        await reachForm();
        fireEvent.change(nameField(), { target: { value: 'OUTAGE' } });
        fireEvent.change(supplyField(), { target: { value: '100' } });
        submit();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/already exists on this network/)).toBeNull();
    });

    it('checks the full PARENT.CHILD ticker for a subtoken', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(
            tick === 'PARENT' ? { creator: OWNER, totalSupply: '1', canonicalTick: 'PARENT' }
                : tick === 'PARENT.CHILD' ? FOUND : EMPTY,
        ));
        const messaging = mountWizard(getTokenInfo);
        await reachForm('Subtoken');
        await pickParentToken('PARENT');
        fireEvent.change(nameField(), { target: { value: 'CHILD' } });
        fireEvent.change(supplyField(), { target: { value: '5' } });

        expect(await screen.findByText('Ticker "PARENT.CHILD" already exists on this network.'))
            .toBeInTheDocument();
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'PARENT.CHILD' });
        submit();
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(nameField(), { target: { value: 'NEWCHILD' } });
        submit();
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composed(messaging).TICK).toBe('PARENT.NEWCHILD');
    });
});
