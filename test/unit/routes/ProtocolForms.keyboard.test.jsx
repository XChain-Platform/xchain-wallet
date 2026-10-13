// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { StakeForm } from '../../../packages/core/src/shared/routes/StakeForm.jsx';
import { userEvent } from '../../helpers/userEvent.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'ACT',
    version: 1,
    decoded: { summary: 'Review action', details: [], warnings: [] },
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mountForm(Form, props = {}) {
    const composeForConfirm = vi.fn().mockResolvedValue(COMPOSED);
    const composeBetForConfirm = vi.fn().mockResolvedValue(COMPOSED);
    const composeVoteForConfirm = vi.fn().mockResolvedValue(COMPOSED);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getStakesForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 1 }),
        getCapabilityThresholds: vi.fn().mockResolvedValue([]),
        getActionFormats: vi.fn().mockResolvedValue({ 0: 'VERSION|TYPE|MEMO|...ITEM' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
        getTokenInfo: vi.fn().mockResolvedValue(null),
        betProjectFeedCreateFee: vi.fn().mockResolvedValue({
            durationSeconds: 1209600,
            days: 14,
            billableDays: 0,
            free: true,
            fee: '0.00000000',
        }),
        composeForConfirm,
        composeBetForConfirm,
        composeVoteForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        releaseEncoderInputs: vi.fn().mockResolvedValue(null),
        releaseReservation: vi.fn().mockResolvedValue(null),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <Form walletId="wallet-1" chainId={CHAIN} onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        await drainMicrotasks();
    });
    return { ...utils, composeForConfirm, composeBetForConfirm, composeVoteForConfirm };
}

async function expectTabSequence(user, controls) {
    controls[0].focus();
    for (const expected of controls.slice(1)) {
        await user.tab();
        expect(document.activeElement).toBe(expected);
    }
}

async function expectReviewThenEscape(user, utils, formControl) {
    await waitFor(() => expect(utils.getByTestId('confirm-modal')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(formControl()).toBeInTheDocument());
    expect(utils.queryByTestId('confirm-modal')).toBeNull();
}

afterEach(() => cleanup());

describe('protocol form keyboard operation', () => {
    it('keeps bet controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(CreateBetFeedForm, { presetTick: 'XCHAIN' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const oracle = utils.getByLabelText('Your oracle address');
        const chooseOracle = utils.getByRole('button', { name: 'Choose oracle address' });
        const token = utils.getByRole('button', { name: /^Token bets are placed in:/ });
        const label = utils.getByLabelText('What is being bet on');
        const outcome0 = utils.getByLabelText('Outcome 0');
        const outcome1 = utils.getByLabelText('Outcome 1');

        await expectTabSequence(user, [network, oracle, chooseOracle, token, label, outcome0, outcome1]);

        label.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Give the market a question or title.');
        expect(utils.composeBetForConfirm).not.toHaveBeenCalled();

        fireEvent.change(label, { target: { value: 'Will it rain?' } });
        fireEvent.change(outcome0, { target: { value: 'Yes' } });
        fireEvent.change(outcome1, { target: { value: 'No' } });
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        const deadline = utils.getByLabelText('Betting closes');
        fireEvent.change(deadline, { target: { value: tomorrow } });
        deadline.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('What is being bet on'));
        expect(utils.composeBetForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps vote controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(DelegateVoteForm, { presetTick: 'XCHAIN' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const delegateMode = utils.getByRole('button', { name: 'Delegate' });
        const clearMode = utils.getByRole('button', { name: 'Clear' });
        const from = utils.getByLabelText('From');
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const token = utils.getByRole('button', { name: /^Governance token:/ });
        const delegateTo = utils.getByLabelText('Delegate to address');
        const contacts = utils.getByRole('button', { name: 'Open address book' });
        const memo = utils.getByLabelText('Memo (optional)');

        await expectTabSequence(user, [
            network, delegateMode, clearMode, from, chooseSource, token, delegateTo, contacts, memo,
        ]);

        memo.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Delegate-to address is required.');
        expect(utils.composeVoteForConfirm).not.toHaveBeenCalled();

        fireEvent.change(delegateTo, { target: { value: 'bc1qdelegate' } });
        memo.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Delegate to address'));
        expect(utils.composeVoteForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps stake controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(StakeForm);
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const from = utils.getByLabelText('From');
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const newStake = utils.getByRole('radio', { name: /New stake/ });
        const topUp = utils.getByRole('radio', { name: /Top up an existing stake/ });
        const amount = utils.getByLabelText('Amount (XCHAIN)');
        const paste = utils.getByRole('button', { name: 'Paste from clipboard' });
        const pubkey = utils.getByLabelText('Signing public key');

        await expectTabSequence(user, [network, from, chooseSource, newStake, topUp, amount, paste, pubkey]);

        pubkey.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Amount must be a positive number with up to 8 decimals.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(amount, { target: { value: '25' } });
        fireEvent.change(pubkey, { target: { value: 'a'.repeat(64) } });
        pubkey.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Signing public key'));
        expect(utils.composeForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps list controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(ListCreateForm, { initialType: '1' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const from = utils.getByLabelText('From');
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const listType = utils.getByLabelText('List type');
        const tokens = utils.getByLabelText('Tokens (one per line)');
        const picker = utils.getByRole('button', { name: 'Add from token picker' });
        const memo = utils.getByLabelText('Memo (optional)');

        await expectTabSequence(user, [network, from, chooseSource, listType, tokens, picker, memo]);

        memo.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Add at least one token.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(tokens, { target: { value: 'XCHAIN' } });
        memo.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Tokens (one per line)'));
        expect(utils.composeForConfirm).toHaveBeenCalledTimes(1);
    });
});
