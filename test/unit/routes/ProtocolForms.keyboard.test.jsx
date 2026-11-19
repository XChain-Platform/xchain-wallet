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
// The stake-form route: the one Staking form on validator staking.
import { NetworkStakeRoute as StakeForm } from '../../helpers/stakingFormRoutes.jsx';
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
    // Every Form Standard section but the main one starts closed and its
    // fields are hidden: open them all so the tab order covers every control.
    await act(async () => {
        utils.container.querySelectorAll('[data-form-section-toggle][aria-expanded="false"]')
            .forEach((toggle) => fireEvent.click(toggle));
        await drainMicrotasks();
    });
    return { ...utils, composeForConfirm, composeBetForConfirm, composeVoteForConfirm };
}

async function expectTabSequence(user, controls) {
    controls[0].focus();
    for (const expected of controls.slice(1)) {
        await user.tab();
        const name = (element) => element?.getAttribute('aria-label') || element?.id || element?.textContent;
        expect(document.activeElement, `Tab should reach ${name(expected)}, reached ${name(document.activeElement)}`).toBe(expected);
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
        const fromSection = utils.getByRole('button', { name: 'From' });
        const networkHelp = utils.getByRole('button', { name: 'About Network' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const oracleHelp = utils.getByRole('button', { name: 'About From address' });
        const oracle = utils.getByLabelText('From address');
        const chooseOracle = utils.getByRole('button', { name: 'Choose oracle address' });
        const marketSection = utils.getByRole('button', { name: 'Market' });
        const questionHelp = utils.getByRole('button', { name: 'About Question' });
        const question = utils.getByLabelText('Question');
        const outcomesHelp = utils.getByRole('button', { name: 'About Outcomes' });
        const outcome1 = utils.getByLabelText('Outcome 1');
        const outcome2 = utils.getByLabelText('Outcome 2');
        const addOutcome = utils.getByRole('button', { name: 'Add Outcome' });
        const closesHelp = utils.getByRole('button', { name: 'About Closes' });
        const closes = utils.getByLabelText('Closes');
        const tokenHelp = utils.getByRole('button', { name: 'About Token' });
        const token = utils.getByRole('button', { name: /^Token: XCHAIN/ });

        expect(network).toBeInTheDocument();
        await expectTabSequence(user, [
            // The preset token fixes the network, so its picker is shown but not a tab stop.
            fromSection, networkHelp, oracleHelp, oracle, chooseOracle,
            marketSection, questionHelp, question, outcomesHelp, outcome1, outcome2, addOutcome,
            closesHelp, closes, tokenHelp, token,
        ]);

        question.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Give the market a question or title.');
        expect(utils.composeBetForConfirm).not.toHaveBeenCalled();

        fireEvent.change(question, { target: { value: 'Will it rain?' } });
        fireEvent.change(outcome1, { target: { value: 'Yes' } });
        fireEvent.change(outcome2, { target: { value: 'No' } });
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
        fireEvent.change(closes, { target: { value: tomorrow } });
        closes.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Question'));
        expect(utils.composeBetForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps vote controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(DelegateVoteForm, { presetTick: 'XCHAIN' });
        // The route fixes delegate or clear, so the form has no mode switch.
        const fromSection = utils.getByRole('button', { name: 'From' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const networkHelp = utils.getByRole('button', { name: 'About Network' });
        const from = utils.getByLabelText('From address');
        const fromHelp = utils.getByRole('button', { name: 'About From address' });
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const delegationSection = utils.getByRole('button', { name: 'Delegation' });
        const tokenHelp = utils.getByRole('button', { name: 'About Governance token' });
        const token = utils.getByRole('button', { name: /^Governance token:/ });
        const delegateHelp = utils.getByRole('button', { name: 'About Delegate to address' });
        const delegateTo = utils.getByLabelText('Delegate to address');
        const contacts = utils.getByRole('button', { name: 'Open address book' });
        const memoSection = utils.getByRole('button', { name: /^Memo/ });
        // A lone memo has no label row, so no ? tip between header and field.
        expect(utils.queryByRole('button', { name: 'About Memo' })).toBeNull();
        const memo = utils.getByLabelText('Memo');

        expect(network).toBeInTheDocument();
        await expectTabSequence(user, [
            // The preset token fixes the network, so its picker is shown but not a tab stop.
            fromSection, networkHelp, fromHelp, from, chooseSource,
            delegationSection, tokenHelp, token, delegateHelp, delegateTo, contacts,
            memoSection, memo,
        ]);

        // The memo is a textarea: Enter there neither breaks the line nor
        // submits, so the last text input (Delegate to) is where Enter submits.
        memo.focus();
        await user.keyboard('{Enter}');
        expect(utils.queryByRole('alert')).toBeNull();
        expect(memo).toHaveValue('');
        delegateTo.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Delegate-to address is required.');
        expect(utils.composeVoteForConfirm).not.toHaveBeenCalled();

        fireEvent.change(delegateTo, { target: { value: 'bc1qdevmock03aabbcc' } });
        delegateTo.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Delegate to address'));
        expect(utils.composeVoteForConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps stake controls in visual order, validates Enter, and cancels review with Escape', async () => {
        const user = userEvent.setup();
        const utils = await mountForm(StakeForm);
        const fromSection = utils.getByRole('button', { name: 'From' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const networkHelp = utils.getByRole('button', { name: 'About Network' });
        const from = utils.getByLabelText('From address');
        const fromHelp = utils.getByRole('button', { name: 'About From address' });
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const positionSection = utils.getByRole('button', { name: 'Staking' });
        // The one Staking form opens its main section on the action toggle (G109 ruling), then Stake On.
        const stakeOnHelp = utils.getByRole('button', { name: 'About Stake On' });
        const pickTarget = utils.getByRole('button', { name: 'Choose what to stake on' });
        const actionHelp = utils.getByRole('button', { name: 'About Action' });
        const actionSelect = utils.getByRole('button', { name: 'Action: Stake' });
        const modeHelp = utils.getByRole('button', { name: 'About Mode' });
        const modeSelect = utils.getByRole('button', { name: 'Mode: New stake' });
        const amountHelp = utils.getByRole('button', { name: 'About Amount (XCHAIN)' });
        const amount = utils.getByLabelText('Amount (XCHAIN)');
        const useMax = utils.getByRole('button', { name: 'Use max available amount' });
        const pubkeyHelp = utils.getByRole('button', { name: 'About Signing public key' });
        const pubkey = utils.getByLabelText('Signing public key');

        await expectTabSequence(user, [
            fromSection, networkHelp, network, fromHelp, from, chooseSource,
            // Use max is disabled while the balance is unknown, so it is not a tab stop.
            positionSection, actionHelp, actionSelect, stakeOnHelp, pickTarget,
            modeHelp, modeSelect, amountHelp, amount, pubkeyHelp, pubkey,
        ]);

        pubkey.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Enter an amount to stake.');
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
        const fromSection = utils.getByRole('button', { name: 'From' });
        const network = await utils.findByRole('button', { name: /^Network:/ });
        const networkHelp = utils.getByRole('button', { name: 'About Network' });
        const from = utils.getByLabelText('From');
        const fromHelp = utils.getByRole('button', { name: 'About From' });
        const chooseSource = utils.getByRole('button', { name: 'Choose source address' });
        const listSection = utils.getByRole('button', { name: 'List' });
        // The one List form's Action field leads the List section.
        const actionHelp = utils.getByRole('button', { name: 'About Action' });
        const action = utils.getByRole('button', { name: /^Action:/ });
        const listTypeHelp = utils.getByRole('button', { name: 'About List type' });
        const listType = utils.getByRole('button', { name: /^List type:/ });
        const tokensHelp = utils.getByRole('button', { name: 'About Tokens' });
        const tokens = utils.getByLabelText('Tokens');
        // The optional tickers file field sits between the box and the picker.
        const tickersFileHelp = utils.getByRole('button', { name: 'About Tickers file (CSV or TXT)' });
        const tickersFileName = utils.getByLabelText('Tickers file (CSV or TXT)');
        const tickersFile = utils.getByRole('button', { name: 'Choose a file' });
        const picker = utils.getByRole('button', { name: 'Add from Token Picker' });
        const memoSection = utils.getByRole('button', { name: /^Memo/ });
        // A lone memo has no label row, so no ? tip between header and field.
        expect(utils.queryByRole('button', { name: 'About Memo' })).toBeNull();
        const memo = utils.getByLabelText('Memo');

        await expectTabSequence(user, [
            fromSection, networkHelp, network, fromHelp, from, chooseSource,
            listSection, actionHelp, action, listTypeHelp, listType, tokensHelp, tokens, tickersFileHelp, tickersFileName, tickersFile, picker,
            memoSection, memo,
        ]);

        // Tokens and the memo are both textareas, where Enter never submits
        // (in the memo it adds no line break either); the action button
        // takes Enter.
        memo.focus();
        await user.keyboard('{Enter}');
        expect(utils.queryByRole('alert')).toBeNull();
        expect(memo).toHaveValue('');
        const submit = document.querySelector('button[type="submit"]');
        submit.focus();
        await user.keyboard('{Enter}');
        expect(utils.getByRole('alert')).toHaveTextContent('Add at least one token.');
        expect(utils.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(tokens, { target: { value: 'XCHAIN' } });
        submit.focus();
        await user.keyboard('{Enter}');

        await expectReviewThenEscape(user, utils, () => utils.getByLabelText('Tokens'));
        expect(utils.composeForConfirm).toHaveBeenCalledTimes(1);
    });
});
