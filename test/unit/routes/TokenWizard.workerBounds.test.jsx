// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wizard between Review and Approve: a background worker that goes away
// mid-issue, supply values at their bounds, a ticker lookup that answers for a
// name the user has already changed, double taps, and a parent token that
// changes hands after Details.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'w-wizard-worker';
const KEY = `xc:formdraft:token-wizard:${WALLET}`;
const OWNER = 'bcrt1qexampleexampleexampleexampleexample0';
const STRANGER = 'bcrt1qstrangerstrangerstrangerstrangerstr';
const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: OWNER,
        publicKey: '02ab',
        derivationPath: "m/84'/1'/0'/0/0",
        source: 'hd',
    }],
};
const COMPOSED = { psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0 };
const EMPTY = { creator: null, totalSupply: null, canonicalTick: null };
const FOUND = { creator: 'bcrt1qsomeoneelse', totalSupply: '10', canonicalTick: 'TAKEN' };
const DISCONNECT = 'Could not establish connection. Receiving end does not exist.';

function mountWizard(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'regtest' }),
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
        React.createElement(TokenWizard, { walletId: WALLET, onBack() {} }),
    ));
    return messaging;
}

async function reachDetails(template = 'Utility token') {
    fireEvent.click(await screen.findByText(template));
    await screen.findByLabelText('Fee paid by');
    fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    await screen.findByText('Step 3 of 4: Details');
}

async function fillUtility({ name = 'BOUND', supply = '100', maxMint } = {}) {
    await reachDetails('Utility token');
    fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Supply'), { target: { value: supply } });
    if (maxMint !== undefined) {
        fireEvent.change(screen.getByLabelText(/Max mint per transaction/), { target: { value: maxMint } });
    }
    fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function storedDraft() {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('TokenWizard worker loss between compose and confirm', () => {
    it('keeps Approve unreachable and the draft saved when compose loses the worker', async () => {
        const messaging = mountWizard({
            composeForConfirm: vi.fn().mockRejectedValue(new Error(DISCONNECT)),
        });
        await fillUtility({ name: 'GONE', supply: '50' });
        await screen.findByText('Step 4 of 4: Review');
        await waitFor(() => expect(storedDraft()?.values.name).toBe('GONE'));
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('button', { name: /Continue to confirmation/ })).toBeEnabled());
        expect(screen.queryByTestId('confirm-approve')).toBeNull();
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(screen.getByText('Step 4 of 4: Review')).toBeTruthy();
        expect(storedDraft()?.values.name).toBe('GONE');
        expect(storedDraft()?.values.supply).toBe('50');
    });

    it('keeps the draft and shows no result when the worker drops during Approve', async () => {
        const messaging = mountWizard({
            issueToken: vi.fn().mockRejectedValue(new Error(DISCONNECT)),
        });
        await fillUtility({ name: 'DROP', supply: '70' });
        await screen.findByText('Step 4 of 4: Review');
        await waitFor(() => expect(storedDraft()?.values.name).toBe('DROP'));
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
        await new Promise((r) => { setTimeout(r, 50); });
        expect(screen.queryByText('cd'.repeat(32))).toBeNull();
        expect(storedDraft()?.values.name).toBe('DROP');
        expect(storedDraft()?.values.supply).toBe('70');
    });
});

describe('TokenWizard supply bounds', () => {
    const refused = [
        ['0', /Supply must be a positive number/],
        ['1000000000000000000001', /Supply cannot be more than/],
        ['1e5', /Supply must be a positive number/],
        ['-1', /Supply must be a positive number/],
        ['10.5', /whole number for an indivisible token/],
    ];
    for (const [value, message] of refused) {
        it(`refuses supply ${value} before compose`, async () => {
            const messaging = mountWizard();
            await fillUtility({ supply: value });
            expect(await screen.findByText(message)).toBeTruthy();
            expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        });
    }

    const accepted = ['1', '1000000000000000000000', '9007199254740993'];
    for (const value of accepted) {
        it(`composes supply ${value} exactly as entered`, async () => {
            const messaging = mountWizard();
            await fillUtility({ supply: value });
            await screen.findByText('Step 4 of 4: Review');
            fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
            const approve = await screen.findByTestId('confirm-approve');
            await waitFor(() => expect(approve).toBeEnabled());
            const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
            expect(params.MAX_SUPPLY).toBe(value);
            fireEvent.click(approve);
            await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
            expect(messaging.issueToken.mock.calls[0][0].params).toEqual(params);
        });
    }

    it('reports what a supply with leading zeros composes', async () => {
        const messaging = mountWizard();
        await fillUtility({ supply: '0007' });
        const review = await screen.findByText('Step 4 of 4: Review').catch(() => null);
        if (!review) {
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
            return;
        }
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        await screen.findByTestId('confirm-approve');
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(['0007', '7']).toContain(params.MAX_SUPPLY);
    });

    it('composes a max mint above the supply exactly as entered', async () => {
        const messaging = mountWizard();
        await fillUtility({ supply: '100', maxMint: '1000000000000000000001' });
        await screen.findByText('Step 4 of 4: Review');
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        await screen.findByTestId('confirm-approve');
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.MAX_MINT).toBe('1000000000000000000001');
    });
});

describe('TokenWizard stale ticker answers', () => {
    it('does not let a late free answer for an earlier name pass the current one', async () => {
        const early = deferred();
        const later = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'EARLY' ? early.promise : later.promise));
        const messaging = mountWizard({ getTokenInfo });
        await reachDetails('Meme token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'EARLY' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'EARLY' }));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'LATER' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'LATER' }));
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        await act(async () => { early.resolve(EMPTY); });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await new Promise((r) => { setTimeout(r, 30); });
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        await act(async () => { later.resolve(FOUND); });
        expect((await screen.findAllByText(/already exists on this network/)).length).toBeGreaterThan(0);
        expect(screen.queryByText('Step 4 of 4: Review')).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('TokenWizard double taps', () => {
    it('composes once and signs once for double taps on Continue and Approve', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await fillUtility({ name: 'TAPS', supply: '10' });
        await screen.findByText('Step 4 of 4: Review');
        const go = screen.getByRole('button', { name: /Continue to confirmation/ });
        fireEvent.click(go);
        fireEvent.click(go);
        await act(async () => { gate.resolve(COMPOSED); });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        fireEvent.click(approve);
        await screen.findByText('cd'.repeat(32));
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(messaging.issueToken).toHaveBeenCalledTimes(1);
    });
});

describe('TokenWizard parent ownership between steps', () => {
    it('refuses confirm with a plain notice when the parent changes hands after Details', async () => {
        let parentOwner = OWNER;
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(
            tick === 'PARENT' ? { creator: parentOwner, totalSupply: '1', canonicalTick: 'PARENT' } : EMPTY,
        ));
        const messaging = mountWizard({
            getTokenInfo,
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbt: 'aa00' }),
        });
        await reachDetails('Subtoken');
        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'PARENT' } });
        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '100' } });
        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
        const lookupsAtReview = getTokenInfo.mock.calls.filter(([q]) => q.tick === 'PARENT').length;
        expect(lookupsAtReview).toBeGreaterThan(0);
        parentOwner = STRANGER;
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        expect(await screen.findByText(/This wallet does not own PARENT/)).toBeTruthy();
        expect(getTokenInfo.mock.calls.filter(([q]) => q.tick === 'PARENT').length)
            .toBeGreaterThan(lookupsAtReview);
        await new Promise((r) => { setTimeout(r, 50); });
        // Confirm composes through actionConfirm.run, so an untouched compose
        // means the confirm flow never starts.
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirm-approve')).toBeNull();
        expect(screen.getByText('Step 4 of 4: Review')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Continue to confirmation/ })).toBeEnabled();
    });
});
