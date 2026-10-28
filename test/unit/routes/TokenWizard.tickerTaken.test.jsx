// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Token wizard checks the ticker against the chain while it is typed,
// with the lookup and field message Issue token uses, and keeps a taken name
// off Review: the chain refuses an ISSUE of an existing ticker after the fee.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

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
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: 'w-ticker', onBack() {} }),
    ));
    return messaging;
}

async function reachDetails(template = 'Meme token') {
    fireEvent.click(await screen.findByText(template));
    await screen.findByLabelText('Fee paid by');
    fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    await screen.findByText('Step 3 of 4: Details');
}

function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('TokenWizard ticker availability', () => {
    it('marks a taken name on the field and keeps Details from reaching Review', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(tick === 'TAKEN' ? FOUND : EMPTY));
        mountWizard(getTokenInfo);
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'TAKEN' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });

        expect(await screen.findByText('Ticker "TAKEN" already exists on this network.'))
            .toBeInTheDocument();
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'TAKEN' });

        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await waitFor(() => {
            expect(screen.getAllByText('Ticker "TAKEN" already exists on this network.').length)
                .toBeGreaterThan(1);
        });
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        expect(screen.getByText('Step 3 of 4: Details')).toBeInTheDocument();

        // A free name clears the field message and reaches Review.
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'FREE' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
    });

    it('holds a submit made during the lookup and refuses it when the name is taken', async () => {
        const gate = deferred();
        mountWizard(vi.fn(() => gate.promise));
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'TAKEN' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));

        await new Promise((resolve) => { setTimeout(resolve, 450); });
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        await act(async () => { gate.resolve(FOUND); });
        expect((await screen.findAllByText('Ticker "TAKEN" already exists on this network.')).length)
            .toBeGreaterThan(1);
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
    });

    it('does not let a late answer for an earlier name mark the current one taken', async () => {
        const early = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'EARLY' ? early.promise : Promise.resolve(EMPTY)));
        mountWizard(getTokenInfo);
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'EARLY' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'EARLY' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'LATER' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'LATER' }));
        await act(async () => { early.resolve(FOUND); });

        expect(screen.queryByText(/already exists on this network/)).toBeNull();
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
    });

    it('lets Review proceed when the lookup fails', async () => {
        mountWizard(vi.fn().mockRejectedValue(new Error('explorer offline')));
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'OUTAGE' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
        expect(screen.queryByText(/already exists on this network/)).toBeNull();
    });

    it('checks the full PARENT.CHILD ticker for a subtoken', async () => {
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(
            tick === 'PARENT' ? { creator: OWNER, totalSupply: '1', canonicalTick: 'PARENT' }
                : tick === 'PARENT.CHILD' ? FOUND : EMPTY,
        ));
        mountWizard(getTokenInfo);
        await reachDetails('Subtoken');
        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'PARENT' } });
        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '5' } });

        expect(await screen.findByText('Ticker "PARENT.CHILD" already exists on this network.'))
            .toBeInTheDocument();
        expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'PARENT.CHILD' });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();

        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'NEWCHILD' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
    });
});
