// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Issue Token form between submit and Approve: a background worker that
// goes away mid-issue, supply values at their bounds, a ticker lookup that
// answers for a name the user has already changed, double taps, and a parent
// token that changes hands between two submits.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'w-wizard-worker';
const KEY = `xc:formdraft:issue-token:${WALLET}`;
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

async function reachForm(template = 'Utility token') {
    await screen.findByLabelText('Ticker');
    fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(template) }));
}

const nameField = () => screen.getByRole('textbox', { name: /^(Ticker|Subtoken name)$/ });
const supplyField = () => screen.getByRole('textbox', { name: 'Max supply' });
const issueForm = () => screen.getByRole('form', { name: 'Issue Token' });

// Utility template, then submit. `indivisible` turns Divisible off first.
async function fillUtility({ name = 'BOUND', supply = '100', maxMint, indivisible = false } = {}) {
    await reachForm('Utility token');
    if (indivisible) fireEvent.click(screen.getByRole('switch', { name: /Divisible/ }));
    fireEvent.change(nameField(), { target: { value: name } });
    fireEvent.change(supplyField(), { target: { value: supply } });
    if (maxMint !== undefined) {
        fireEvent.change(screen.getByLabelText('Max per transaction'), { target: { value: maxMint } });
    }
    fireEvent.submit(issueForm());
}

// The refusal, whether the error summary or an amount field's own error
// states it.
async function refusal(pattern) {
    await waitFor(() => {
        expect(screen.getAllByRole('alert').some((alert) => pattern.test(alert.textContent))).toBe(true);
    });
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

describe('Issue Token worker loss between compose and confirm', () => {
    it('keeps Approve unreachable and the draft saved when compose loses the worker', async () => {
        const messaging = mountWizard({
            composeForConfirm: vi.fn().mockRejectedValue(new Error(DISCONNECT)),
        });
        await fillUtility({ name: 'GONE', supply: '50' });
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Issue Token' })).toBeEnabled());
        expect(screen.queryByTestId('confirm-approve')).toBeNull();
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(issueForm()).toBeTruthy();
        expect(storedDraft()?.values.ticker).toBe('GONE');
        expect(storedDraft()?.values.supply).toBe('50');
    });

    it('keeps the draft and shows no result when the worker drops during Approve', async () => {
        const messaging = mountWizard({
            issueToken: vi.fn().mockRejectedValue(new Error(DISCONNECT)),
        });
        await fillUtility({ name: 'DROP', supply: '70' });
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.issueToken).toHaveBeenCalledTimes(1));
        await new Promise((r) => { setTimeout(r, 50); });
        expect(screen.queryByText('cd'.repeat(32))).toBeNull();
        expect(storedDraft()?.values.ticker).toBe('DROP');
        expect(storedDraft()?.values.supply).toBe('70');
    });
});

describe('Issue Token supply bounds', () => {
    // An amount field can refuse a keystroke itself ('Enter a valid ...'),
    // or the summary names the rule; either way nothing composes.
    const refused = [
        ['1000000000000000000001', {}, /Max supply cannot be more than/],
        ['1e5', {}, /Max supply must be zero or a positive number|Enter a valid/],
        ['-1', {}, /Max supply must be zero or a positive number|Enter a valid/],
        ['10.5', { indivisible: true }, /whole number for an indivisible token|decimal places|whole number/i],
    ];
    for (const [value, options, message] of refused) {
        it(`refuses supply ${value} before compose`, async () => {
            const messaging = mountWizard();
            await fillUtility({ supply: value, ...options });
            await refusal(message);
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        });
    }

    it('composes a 0 max supply as an uncapped token with nothing minted', async () => {
        // The wizard refused 0; on the form 0 is the indexer's uncapped
        // sentinel, so it omits MAX_SUPPLY and mints nothing.
        const messaging = mountWizard();
        await fillUtility({ supply: '0' });
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.MAX_SUPPLY).toBeUndefined();
        expect(params.MINT_SUPPLY).toBeUndefined();
    });

    const accepted = ['1', '1000000000000000000000', '9007199254740993'];
    for (const value of accepted) {
        it(`composes supply ${value} exactly as entered`, async () => {
            const messaging = mountWizard();
            await fillUtility({ supply: value });
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
        const approve = await screen.findByTestId('confirm-approve').catch(() => null);
        if (!approve) {
            expect(messaging.composeForConfirm).not.toHaveBeenCalled();
            return;
        }
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(['0007', '7']).toContain(params.MAX_SUPPLY);
    });

    it('refuses a max mint above the protocol ceiling before compose', async () => {
        // The wizard composed this and left the refusal to the chain; the
        // form names the ceiling on the field instead.
        const messaging = mountWizard();
        await fillUtility({ supply: '100', maxMint: '1000000000000000000001' });
        await refusal(/Max mint per transaction cannot be more than/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes a max mint above the supply exactly as entered', async () => {
        const messaging = mountWizard();
        await fillUtility({ supply: '100', maxMint: '1000' });
        await screen.findByTestId('confirm-approve');
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.MAX_MINT).toBe('1000');
    });
});

describe('Issue Token stale ticker answers', () => {
    it('does not let a late free answer for an earlier name pass the current one', async () => {
        const early = deferred();
        const later = deferred();
        const getTokenInfo = vi.fn(({ tick }) => (tick === 'EARLY' ? early.promise : later.promise));
        const messaging = mountWizard({ getTokenInfo });
        await reachForm('Meme token');
        fireEvent.change(nameField(), { target: { value: 'EARLY' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'EARLY' }));
        fireEvent.change(nameField(), { target: { value: 'LATER' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith({ chainId: CHAIN, tick: 'LATER' }));
        fireEvent.change(supplyField(), { target: { value: '100' } });
        await act(async () => { early.resolve(EMPTY); });
        fireEvent.submit(issueForm());
        await new Promise((r) => { setTimeout(r, 30); });
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        await act(async () => { later.resolve(FOUND); });
        expect((await screen.findAllByText(/already exists on this network/)).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('Issue Token double taps', () => {
    it('composes once and signs once for double taps on Issue Token and Approve', async () => {
        const gate = deferred();
        const messaging = mountWizard({ composeForConfirm: vi.fn(() => gate.promise) });
        await reachForm('Utility token');
        fireEvent.change(nameField(), { target: { value: 'TAPS' } });
        fireEvent.change(supplyField(), { target: { value: '10' } });
        const go = screen.getByRole('button', { name: 'Issue Token' });
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

describe('Issue Token parent ownership between submits', () => {
    it('refuses the next submit with a plain notice when the parent changes hands', async () => {
        let parentOwner = OWNER;
        const getTokenInfo = vi.fn(({ tick }) => Promise.resolve(
            tick === 'PARENT' ? { creator: parentOwner, totalSupply: '1', canonicalTick: 'PARENT' } : EMPTY,
        ));
        // The first compose loses the worker, so the form stays for a retry.
        const messaging = mountWizard({
            getTokenInfo,
            composeForConfirm: vi.fn().mockRejectedValue(new Error(DISCONNECT)),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbt: 'aa00' }),
        });
        await reachForm('Subtoken');
        fireEvent.change(screen.getByLabelText('Parent ticker'), { target: { value: 'PARENT' } });
        fireEvent.change(nameField(), { target: { value: 'CHILD' } });
        fireEvent.change(supplyField(), { target: { value: '100' } });
        fireEvent.submit(issueForm());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const lookupsAtFirstSubmit = getTokenInfo.mock.calls.filter(([q]) => q.tick === 'PARENT').length;
        expect(lookupsAtFirstSubmit).toBeGreaterThan(0);

        // The parent changes hands; the retry looks it up again and refuses.
        parentOwner = STRANGER;
        await waitFor(() => expect(screen.getByRole('button', { name: 'Issue Token' })).toBeEnabled());
        fireEvent.submit(issueForm());
        await waitFor(() => {
            expect(screen.getAllByRole('alert').some((a) => /This wallet does not own PARENT/.test(a.textContent)))
                .toBe(true);
        });
        expect(getTokenInfo.mock.calls.filter(([q]) => q.tick === 'PARENT').length)
            .toBeGreaterThan(lookupsAtFirstSubmit);
        await new Promise((r) => { setTimeout(r, 50); });
        // The refusal never reaches the confirm flow.
        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
        expect(messaging.issueToken).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirm-approve')).toBeNull();
        expect(screen.getByRole('button', { name: 'Issue Token' })).toBeEnabled();
    });
});
