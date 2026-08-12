// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The native-coin fee lane on the two contract authoring forms.
//
// DEPLOY and EXECUTE were the last fee-bearing forms with no fee lane at all,
// which was defensible only while contracts were Bitcoin-only: there the
// protocol fee comes out of an XCHAIN balance by default and the user never has
// to say anything. On LTC/DOGE there is no XCHAIN lane, so an action composed
// without a FEE_DESTINATION output is broadcast, spends a real miner fee, and
// then indexes `insufficient fee (native coin output required)`. The lane has
// to be here, and non-optional, BEFORE BTC_EXCLUSIVE_ACTIONS opens these two.
//
// What is worth driving rather than reading:
//
//   1. On a chain with no XCHAIN lane the row is a statement and the flag is on
//      without the user touching anything. An unticked opt-in there is the
//      pre-fix bug wearing the post-fix hook.
//   2. Compose AND submit carry the flag. Compose is the load-bearing one: the
//      fee output has to be inside the PSBT the user approves and the tamper
//      check verifies, not bolted on afterwards.
// 3. The valid:null caveat is SHOWN. prices these two off the gas
//      schedule without a dry-run, so "the quote came back fine" does not mean
//      "the action will be accepted", and the fee is spent either way. Every
//      other form's quote carries a verdict; these two must not imply one.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { NATIVE_FEE_UNVERIFIED_NOTICE } from '../../../packages/core/src/sdk/nativeFeePreflight.js';

const BTC_CHAIN = 'bitcoin-mainnet';
// A chain with NO XCHAIN fee lane, where the native-coin output is the only way
// to pay a protocol fee. EXECUTE reaches it through a chainId prop today; DEPLOY
// picks its own chains off the registry, which still gates contracts to BTC.
const LTC_CHAIN = 'litecoin-regtest';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const CONTRACT_SOURCE = 'function main() { return 1; }';

function harness(chainId, overrides = {}) {
    const calls = [];
    const record = (method) => (args) => {
        calls.push({ method, args });
        return Promise.resolve({});
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [chainId]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        // No published abi: the EXECUTE form falls back to its manual lane.
        getContractByActionIndex: () => Promise.resolve({}),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00', encoding: 'psbt', actionString: 'ACT|0', version: 0,
            });
        },
        deployAction: record('deployAction'),
        executeAction: record('executeAction'),
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return record(String(prop));
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function mount(Component, messaging, props) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Component, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

function button(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

async function mountExecute(messaging, chainId) {
    let utils;
    await domAct(async () => {
        utils = mount(ExecuteContractForm, messaging, { chainId, contractActionIndex: '2308' });
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Method'), { target: { value: 'ping' } });
        await drain();
    });
    return utils;
}

async function mountDeploy(messaging) {
    let utils;
    await domAct(async () => {
        utils = mount(DeployContractForm, messaging, {});
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: CONTRACT_SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
        await drain();
    });
    return utils;
}

// Compose -> approve, the one path a full-mode wallet takes.
async function reviewAndApprove(utils, label) {
    await domAct(async () => {
        fireEvent.click(button(utils, label));
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Password'), { target: { value: 'hunter2' } });
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByTestId('confirm-approve'));
        await drain();
    });
}

describe('EXECUTE carries the native-coin fee lane', () => {
    it('forces the fee on a chain with no XCHAIN lane, and states it instead of offering a choice', async () => {
        const { messaging, calls } = harness(LTC_CHAIN);
        const utils = await mountExecute(messaging, LTC_CHAIN);

        // EXECUTE is priced, but the FORM holds no quote for it, so the
        // row states the chain's rule rather than asserting a charge.
        expect(utils.container.textContent).toContain('Protocol fees are paid in LTC');
        expect(utils.queryByLabelText(/Pay protocol fee in LTC instead of XCHAIN/)).toBeNull();
        // The caveat rides along on the mandatory variant too: there is no
        // opting out of the forfeiture risk on this chain, only knowing about it.
        expect(utils.container.textContent).toContain(NATIVE_FEE_UNVERIFIED_NOTICE);

        await reviewAndApprove(utils, /^Execute/);

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.encoderOpts.payFeeInNativeCoin).toBe(true);
        const submit = calls.find((c) => c.method === 'executeAction');
        expect(submit.args.payFeeInNativeCoin).toBe(true);
        // Approve signs the composed PSBT, so the fee output the user saw is the
        // one that gets broadcast.
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
    });

    it('keeps it an opt-in on Bitcoin, absent (not false) until ticked', async () => {
        const off = harness(BTC_CHAIN);
        const utils = await mountExecute(off.messaging, BTC_CHAIN);

        expect(utils.getByLabelText(/Pay protocol fee in BTC instead of XCHAIN/)).toBeTruthy();
        // Nothing to warn about while the fee is an XCHAIN debit: a rejected
        // action costs no protocol fee at all.
        expect(utils.container.textContent).not.toContain(NATIVE_FEE_UNVERIFIED_NOTICE);

        await reviewAndApprove(utils, /^Execute/);
        expect(off.calls.find((c) => c.method === 'composeForConfirm').args.encoderOpts.payFeeInNativeCoin)
            .toBeUndefined();
        expect(off.calls.find((c) => c.method === 'executeAction').args.payFeeInNativeCoin)
            .toBeUndefined();

        const on = harness(BTC_CHAIN);
        const ticked = await mountExecute(on.messaging, BTC_CHAIN);
        await domAct(async () => {
            fireEvent.click(ticked.getByLabelText(/Pay protocol fee in BTC instead of XCHAIN/));
            await drain();
        });
        // Ticking it is what makes the unverified caveat relevant, so it appears
        // with the choice rather than before it.
        expect(ticked.container.textContent).toContain(NATIVE_FEE_UNVERIFIED_NOTICE);

        await reviewAndApprove(ticked, /^Execute/);
        expect(on.calls.find((c) => c.method === 'composeForConfirm').args.encoderOpts.payFeeInNativeCoin)
            .toBe(true);
        expect(on.calls.find((c) => c.method === 'executeAction').args.payFeeInNativeCoin).toBe(true);
    });
});

describe('DEPLOY carries the native-coin fee lane', () => {
    it('threads the opt-in into both the composed PSBT and the signing submit', async () => {
        const { messaging, calls } = harness(BTC_CHAIN);
        const utils = await mountDeploy(messaging);

        await domAct(async () => {
            fireEvent.click(utils.getByLabelText(/Pay protocol fee in BTC instead of XCHAIN/));
            await drain();
        });
        expect(utils.container.textContent).toContain(NATIVE_FEE_UNVERIFIED_NOTICE);

        await reviewAndApprove(utils, /^Deploy/);

        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.action).toBe('DEPLOY');
        expect(compose.args.encoderOpts.payFeeInNativeCoin).toBe(true);
        const submit = calls.find((c) => c.method === 'deployAction');
        expect(submit.args.payFeeInNativeCoin).toBe(true);
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00' });
    });

    it('leaves the flag off the payload when the fee stays in XCHAIN', async () => {
        const { messaging, calls } = harness(BTC_CHAIN);
        const utils = await mountDeploy(messaging);

        await reviewAndApprove(utils, /^Deploy/);

        expect(calls.find((c) => c.method === 'composeForConfirm').args.encoderOpts.payFeeInNativeCoin)
            .toBeUndefined();
        expect(calls.find((c) => c.method === 'deployAction').args.payFeeInNativeCoin).toBeUndefined();
    });
});
