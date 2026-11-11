// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The standalone ISSUE form derived BOTH MAX_SUPPLY and
// MINT_SUPPLY from the single "Supply" box, so every token the wallet
// created was born fully minted at its own cap: mint headroom exactly 0,
// and the whole Mint surface unreachable for anything issued here.
// Confirmed on-chain on regtest tick S18PROBE (wallet E2E session 18):
// supply.current 5,000 == supply.max 5,000, and the Mint attempt refused
// by the network dry-run with "invalid: mint exceeds MAX_SUPPLY".
//
// These drive the form to the confirm page and read the ISSUE params off
// the host-side compose call, which is the exact payload that becomes the
// broadcast action.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { userEvent } from '../../helpers/userEvent.js';

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

function mountForm(overrides = {}) {
    composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        issueToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        ...overrides,
    };
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(IssueTokenForm, { walletId: 'w', onBack() {} }),
        ),
    );
}

// Fill ticker + supply (+ optional initial mint) and submit.
async function fill({ supply, initialMint, lockSupply, divisible }) {
    fireEvent.change(await screen.findByLabelText('Ticker'), {
        target: { value: 'MINTABLE' },
    });
    // Divisible first: every amount edit is checked against the precision it sets.
    if (!divisible) {
        fireEvent.click(screen.getByLabelText('Divisible (8 decimal places)'));
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: supply } });
    if (initialMint !== undefined) {
        fireEvent.change(screen.getByLabelText('Initial mint'), {
            target: { value: initialMint },
        });
    }
    if (lockSupply) {
        fireEvent.click(screen.getByLabelText('Minting'));
        fireEvent.click(screen.getByLabelText('Mint supply'));
    }
}

async function submit() {
    fireEvent.submit(screen.getByRole('form', { name: 'Issue token' }));
}

function field(label) {
    return label === 'Max supply'
        ? screen.getByRole('textbox', { name: label })
        : screen.getByLabelText(label);
}

// The ISSUE params as they reach the host-side compose.
async function composedParams() {
    await waitFor(() => expect(composeForConfirm).toHaveBeenCalled());
    return composeForConfirm.mock.calls[0][0].actionData.params;
}

afterEach(() => cleanup());
beforeEach(() => { composeForConfirm = undefined; });

describe('IssueTokenForm initial mint', () => {
    it('refuses a hostile description before compose', async () => {
        mountForm();
        await fill({ supply: '10' });
        fireEvent.change(screen.getByLabelText('Token description'), {
            target: { value: 'safe\u200bunsafe' },
        });

        await submit();

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent('Description cannot contain zero-width characters.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('ignores a stale taken-name result after the ticker changes', async () => {
        let resolveOld;
        let resolveCurrent;
        const getTokenInfo = vi.fn(({ tick }) => new Promise((resolve) => {
            if (tick === 'OLDNAME') resolveOld = resolve;
            if (tick === 'NEWNAME') resolveCurrent = resolve;
        }));
        mountForm({ getTokenInfo });
        const ticker = await screen.findByLabelText('Ticker');
        fireEvent.change(ticker, { target: { value: 'OLDNAME' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'OLDNAME' })));
        fireEvent.change(ticker, { target: { value: 'NEWNAME' } });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'NEWNAME' })));

        resolveCurrent({ canonicalTick: null, creator: null, totalSupply: null });
        resolveOld({ canonicalTick: 'OLDNAME', creator: 'bc1qcreator', totalSupply: '10' });
        await waitFor(() => expect(ticker).not.toHaveAttribute('aria-invalid', 'true'));
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '10' } });
        await submit();

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect((await composedParams()).TICK).toBe('NEWNAME');
    });

    it('handles a rejected name lookup and still allows valid issuance', async () => {
        const getTokenInfo = vi.fn().mockRejectedValue(new Error('explorer offline'));
        mountForm({ getTokenInfo });
        await fill({ supply: '10' });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        await submit();

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    });

    it('blocks a ticker that the current network already contains', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            canonicalTick: 'MINTABLE', creator: 'bc1qcreator', totalSupply: '10',
        });
        mountForm({ getTokenInfo });
        await fill({ supply: '10' });

        expect(await screen.findByText(/already exists on this network/i)).toBeTruthy();
        await submit();
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('treats the empty record the host returns for an unknown ticker as available', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({
            canonicalTick: null, creator: null, totalSupply: null, divisibility: null,
        });
        mountForm({ getTokenInfo });
        await fill({ supply: '10' });
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        await act(async () => { await getTokenInfo.mock.results.at(-1).value; });
        expect(screen.queryByText(/already exists on this network/i)).toBeNull();
        await submit();

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
    });

    it.each([
        ['Max supply', 'Max supply must be a whole number for an indivisible token.'],
        ['Initial mint', 'Initial mint must be a whole number for an indivisible token.'],
        ['Max per transaction', 'Max mint per transaction must be a whole number for an indivisible token.'],
    ])('keeps a fractional %s intact when divisibility is turned off and refuses it', async (label, message) => {
        mountForm();
        await fill({ supply: label === 'Max supply' ? '1.5' : '10', divisible: true });
        const divisible = screen.getByLabelText('Divisible (8 decimal places)');
        if (label !== 'Max supply') {
            fireEvent.change(field(label), { target: { value: '1.5' } });
        }
        fireEvent.click(divisible);

        expect(field(label)).toHaveValue('1.5');
        await submit();
        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('resets a custom fee preview when the network changes', async () => {
        mountForm({
            getAddressesByChain: vi.fn().mockResolvedValue({
                ...ADDRESSES,
                'dogecoin-mainnet': [{
                    id: 'doge-1',
                    address: 'DExampleExampleExampleExampleExample1',
                    publicKey: '02cd',
                    derivationPath: "m/44'/3'/0'/0/0",
                    source: 'hd',
                }],
            }),
        });
        await screen.findByLabelText('Ticker');
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '25' } });
        expect(screen.getByRole('slider', { name: 'Network fee' })).toHaveAttribute(
            'aria-valuetext',
            expect.stringMatching(/^Custom:/),
        );

        fireEvent.click(screen.getByRole('button', { name: /Network: Bitcoin/i }));
        fireEvent.click(screen.getByRole('button', { name: /Select Dogecoin/i }));

        await waitFor(() => expect(screen.getByRole('slider', { name: 'Network fee' })).toHaveAttribute(
            'aria-valuetext',
            expect.stringMatching(/^Normal:/),
        ));
        expect(screen.queryByLabelText(/Custom fee rate/)).toBeNull();

        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        expect(screen.getByLabelText(/Custom fee rate/)).toHaveValue('1');
    });

    it('tabs in field order and opens review from Enter only when valid', async () => {
        const user = userEvent.setup();
        mountForm();
        const ticker = await screen.findByLabelText('Ticker');
        ticker.focus();

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Supply Optional$/ }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About Max supply' }));
        await user.tab();
        const supply = screen.getByRole('textbox', { name: 'Max supply' });
        expect(document.activeElement).toBe(supply);
        fireEvent.change(ticker, { target: { value: 'KEYS' } });
        fireEvent.change(supply, { target: { value: 'abc' } });
        await user.keyboard('{Enter}');

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent('Max supply must be zero or a positive number.');
        expect(composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(supply, { target: { value: '1000' } });
        supply.focus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(await screen.findByTestId('confirm-modal')).toBeInTheDocument();

        await user.keyboard('{Escape}');
        expect(await screen.findByLabelText('Ticker')).toHaveValue('KEYS');
        expect(screen.queryByTestId('confirm-modal')).toBeNull();
    });

    it.each([
        ['Max supply', 'abc', 'Max supply must be zero or a positive number.'],
        ['Initial mint', 'Infinity', 'Initial mint must be zero or a positive number.'],
        ['Max per transaction', 'five', 'Max mint per transaction must be a positive number'],
    ])('refuses malformed numeric text in %s before composing', async (label, value, message) => {
        mountForm();
        await fill({ supply: '5000' });
        fireEvent.change(field(label), { target: { value } });
        await submit();

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it.each([
        'New owner address',
        'Send initial mint to',
    ])('refuses an invalid %s address before composing', async (label) => {
        mountForm();
        await fill({ supply: '5000' });
        fireEvent.change(field(label), { target: { value: 'not-an-address' } });
        await submit();

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent(/not valid for the active network/i);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('leaves mint headroom when the initial mint is below the supply', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '1000' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBe('5000');
        expect(params.MINT_SUPPLY).toBe('1000');
    });

    it('mints the whole supply when the initial mint is left blank', async () => {
        mountForm();
        await fill({ supply: '5000' });
        await submit();

        const params = await composedParams();
        // The simple path is unchanged: one number in, fully minted token out.
        expect(params.MAX_SUPPLY).toBe('5000');
        expect(params.MINT_SUPPLY).toBe('5000');
    });

    it('mints an initial supply without declaring a cap', async () => {
        mountForm();
        await fill({ supply: '', initialMint: '1000' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBeUndefined();
        expect(params.MINT_SUPPLY).toBe('1000');
    });

    it('omits MINT_SUPPLY entirely for a fair-mint (initial mint 0)', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '0' });
        await submit();

        const params = await composedParams();
        expect(params.MAX_SUPPLY).toBe('5000');
        // Nothing minted at issuance: the whole cap stays publicly mintable.
        expect(params.MINT_SUPPLY).toBeUndefined();
    });

    it('refuses an initial mint above the supply instead of paying for a rejected ISSUE', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '6000' });
        await submit();

        await screen.findByText('Initial mint cannot be more than the max supply.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('refuses an initial mint one atomic unit above a large supply', async () => {
        mountForm();
        await fill({
            supply: '90071992.54740901',
            initialMint: '90071992.54740902',
            divisible: true,
        });
        await submit();

        await screen.findByText('Initial mint cannot be more than the max supply.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes the public and owner mint locks as separate flags', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '0', lockSupply: true });
        await submit();

        const params = await composedParams();
        expect(params.LOCK_MINT).toBe('1');
        expect(params.LOCK_MINT_SUPPLY).toBe('1');
        expect(params.LOCK_MAX_SUPPLY).toBeUndefined();
    });

    it('shows no lock footnote beneath the switches', async () => {
        mountForm();
        await fill({ supply: '5000', initialMint: '1000', lockSupply: true });

        expect(screen.queryByText(/left under the cap can never be minted/)).toBeNull();
    });

    it('shows one atomic unit of headroom at a large supply', async () => {
        mountForm();
        await fill({
            supply: '90071992.54740902',
            initialMint: '90071992.54740901',
            divisible: true,
        });

        await screen.findByText(/Leaves 0\.00000001 to mint later/);
    });
});
