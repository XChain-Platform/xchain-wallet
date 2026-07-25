// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : Preview-to-Confirm migration spec for the action forms.
//
// routes-render.test.jsx Layer 4 pins the pilot pair (MintForm /
// DestroyForm). This file is the same behavioural spec for every form
// migrated off its hand-rolled Preview/review stage onto the 
// single-encode pipeline, and it is what keeps the migration honest:
//
//   1. on the SOFTWARE path the primary button carries the action verb,
//      never "Preview";
//   2. pressing it composes ONE PSBT host-side (`composeForConfirm`)
//      with the wire-format actionData the encoder will see;
//   3. sdk.preflight streams into the confirm page;
//   4. Approve dispatches the form's own software messaging method with
//      `prebuiltPsbt` carrying that exact PSBT, so the bytes signed are
//      the bytes previewed.
//
// A form that regresses to a rebuild-on-approve drops `prebuiltPsbt` and
// fails here.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';

import { BroadcastForm } from '../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CreatePollForm } from '../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DelegateVoteForm } from '../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { DelegationActionForm } from '../../packages/core/src/shared/routes/DelegationActionForm.jsx';
import { DividendForm } from '../../packages/core/src/shared/routes/DividendForm.jsx';
import { IssueTokenForm } from '../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { StakeForm } from '../../packages/core/src/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '../../packages/core/src/shared/routes/StakingActionForm.jsx';
import { ContractFundsForm } from '../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { ContractStakeForm } from '../../packages/core/src/shared/routes/ContractStakeForm.jsx';
import { ControllerBindForm } from '../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { DeployContractForm } from '../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { TokenAdminForm } from '../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { AdvancedActionsForm } from '../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { TokenWizard } from '../../packages/core/src/shared/routes/TokenWizard.jsx';
import { AirdropForm } from '../../packages/core/src/shared/routes/AirdropForm.jsx';
import { DispenserForm } from '../../packages/core/src/shared/routes/DispenserForm.jsx';
import { SwapForm } from '../../packages/core/src/shared/routes/SwapForm.jsx';
import { PlaceOrderPanel } from '../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { ComposeMessage } from '../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';

// Same frozen fee-payer the Layer-4 harness uses: a newest HD address at
// change index 0, which every form auto-selects as the source.
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
});

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

// Recording messaging mock. Real shapes for the calls the confirm pipeline
// makes; every other host call resolves to a permissive generic so the
// route's loaded branch still settles.
function recordingMessaging(overrides = {}) {
    const calls = [];
    const generic = Object.freeze([]);
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        // One spendable token so the TokenPicker has a row to select.
        getWalletBalances: () => Promise.resolve({
            [CHAIN]: [{
                address: HD_ADDRESS.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000', divisibility: 8 },
                    tokens: [
                        { tick: 'XCHAIN', quantity: '1000', divisibility: 8 },
                        { tick: 'JDOG', quantity: '500', divisibility: 8 },
                    ],
                },
            }],
        }),
        // ContractStakeForm refuses to compose against a contract with no
        // cooldown, so the target metadata has to be a real shape.
        getContractByActionIndex: () => Promise.resolve({
            row: { cooldown_blocks: 144, slash_destination: null },
        }),
        // AdvancedActionsForm's action picker is populated from the host.
        listActions: () => Promise.resolve(['BROADCAST', 'SEND']),
        // ControllerBindForm builds its wire action host-side (the SDK's
        // controller helper lives there), so the route must be stubbed.
        buildControllerBindParams: (args) => {
            calls.push({ method: 'buildControllerBindParams', args });
            return Promise.resolve({
                action: 'ISSUE',
                params: { VERSION: '6', TICK: 'JDOG', CONTROLLER: '7', ACTION_CLASS: 'transfer' },
            });
        },
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({ ...COMPOSED });
        },
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [] });
        },
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            // Any un-stubbed host call: record it and resolve with a shape
            // that carries a txid (the submit lanes) and is iterable.
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({ txid: `tx-${String(prop)}`, rows: generic });
            };
        },
    });
    return { messaging, calls };
}

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/**
 * Mount a form, run its `fill` step, click the named action button, then
 * Approve on the confirm page. Returns every recorded host dispatch.
 *
 * @param {object} spec
 * @param {import('react').ComponentType<any>} spec.Form
 * @param {object} spec.props
 * @param {string} spec.actionLabel   the software-path primary button label
 * @param {(utils: any) => void} [spec.fill]
 * @param {Array<(utils: any) => void>} [spec.steps]   extra interactions, each flushed on its own (picker screens need a render between clicks)
 */
async function driveThroughConfirm({ Form, props, actionLabel, fill, steps = [] }) {
    const { messagingOverrides, ...formProps } = props;
    const { messaging, calls } = recordingMessaging(messagingOverrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Form, { walletId: 'w', chainId: CHAIN, onBack() {}, ...formProps }),
            ),
        );
        await drainMicrotasks();
    });

    for (const step of [...steps, ...(fill ? [fill] : [])]) {
        // eslint-disable-next-line no-await-in-loop
        await domAct(async () => {
            step(utils);
            await drainMicrotasks();
        });
    }

    const button = utils.getByRole('button', { name: actionLabel });
    expect(button.disabled, `"${actionLabel}" button is enabled`).toBe(false);
    await domAct(async () => {
        fireEvent.click(button);
        await drainMicrotasks();
    });

    await domAct(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        if (!approve) throw new Error('no enabled Approve button on the confirm page');
        fireEvent.click(approve);
        await drainMicrotasks();
    });

    return { calls, utils };
}

/** Assert the migration invariants and return the submit dispatch. */
function expectSingleEncode(calls, { action, params, submitMethod }) {
    const compose = calls.find((c) => c.method === 'composeForConfirm');
    expect(compose, 'composeForConfirm was dispatched').toBeTruthy();
    expect(compose.args.actionData.action).toBe(action);
    if (params) expect(compose.args.actionData.params).toMatchObject(params);
    expect(calls.some((c) => c.method === 'preflight'), 'preflight streamed').toBe(true);
    const submit = calls.find((c) => c.method === submitMethod);
    expect(submit, `${submitMethod} was dispatched on Approve`).toBeTruthy();
    expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
    return submit;
}

const setValue = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

// TokenField opens the shared TokenPicker screen; these two steps open it
// and pick the row for `tick` out of the mocked wallet balances.
const openTokenField = (label) => (utils) => {
    fireEvent.click(utils.getByRole('button', { name: new RegExp(label, 'i') }));
};
const pickToken = (tick) => (utils) => {
    const row = Array.from(utils.container.querySelectorAll('button'))
        .find((b) => (b.textContent || '').includes(tick));
    if (!row) throw new Error(`no ${tick} row in the token picker`);
    fireEvent.click(row);
};

describe(': action forms confirm via the single-encode pipeline', () => {
    it('CreatePollForm composes VOTE v0 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: CreatePollForm,
            props: { presetTick: 'JDOG' },
            actionLabel: 'Create poll',
            fill: (utils) => {
                setValue(utils, 'Closes at block', '900000');
                setValue(utils, 'Option 0', 'Yes');
                setValue(utils, 'Option 1', 'No');
            },
        });
        expectSingleEncode(calls, {
            action: 'VOTE',
            params: { VERSION: '0', TICK: 'JDOG', END_BLOCK: '900000', OPTIONS: 'Yes,No' },
            submitMethod: 'createPollAction',
        });
    });

    it('DividendForm composes DIVIDEND and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DividendForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: 'Pay dividend',
            steps: [openTokenField('Dividend token'), pickToken('XCHAIN')],
            fill: (utils) => setValue(utils, /^Per-unit amount/, '0.5'),
        });
        expectSingleEncode(calls, {
            action: 'DIVIDEND',
            params: { TICK: 'JDOG', DIVIDEND_TICK: 'XCHAIN' },
            submitMethod: 'dividendAction',
        });
    });

    it('IssueTokenForm composes ISSUE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: IssueTokenForm,
            props: {},
            actionLabel: 'Issue token',
            fill: (utils) => {
                setValue(utils, 'Ticker', 'JDOG');
                setValue(utils, 'Supply', '1000');
            },
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            params: { TICK: 'JDOG' },
            submitMethod: 'issueToken',
        });
    });

    it('StakeForm composes STAKE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: StakeForm,
            props: {},
            actionLabel: 'Stake',
            fill: (utils) => {
                setValue(utils, /^Amount/, '25');
                setValue(utils, 'Signing public key', 'a'.repeat(64));
            },
        });
        expectSingleEncode(calls, {
            action: 'STAKE',
            params: { SIGNING_PUBKEY: 'a'.repeat(64) },
            submitMethod: 'stakeAction',
        });
    });

    it('StakingActionForm (unstake) composes UNSTAKE and signs the prebuilt PSBT', async () => {
        // Seed one staked position so the  editable Amount field has
        // an available balance; a partial entry must thread AMOUNT through.
        const { calls } = await driveThroughConfirm({
            Form: StakingActionForm,
            props: {
                mode: 'unstake',
                messagingOverrides: {
                    getStakesForAddress: () => Promise.resolve([
                        { signing_pubkey: 'b'.repeat(64), amount: '1000' },
                    ]),
                },
            },
            actionLabel: 'Unstake',
            fill: (utils) => {
                setValue(utils, 'Signing public key', 'b'.repeat(64));
                setValue(utils, /^Amount/, '250');
            },
        });
        expectSingleEncode(calls, {
            action: 'UNSTAKE',
            params: { SIGNING_PUBKEY: 'b'.repeat(64), AMOUNT: '250' },
            submitMethod: 'unstakeAction',
        });
    });

    it('ContractFundsForm (deposit) composes DEPOSIT and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ContractFundsForm,
            props: { mode: 'deposit', contractActionIndex: '42' },
            actionLabel: 'Deposit',
            steps: [openTokenField('Token'), pickToken('XCHAIN')],
            fill: (utils) => setValue(utils, /^Quantity/, '10'),
        });
        expectSingleEncode(calls, {
            action: 'DEPOSIT',
            params: { TICK: 'XCHAIN', QUANTITY: '10', CONTRACT_ACTION_INDEX: '42' },
            submitMethod: 'depositAction',
        });
    });

    it('DelegationActionForm composes DELEGATE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DelegationActionForm,
            props: { mode: 'delegate' },
            actionLabel: 'Delegate signing key',
            fill: (utils) => setValue(utils, 'New signing pubkey', 'c'.repeat(64)),
        });
        expectSingleEncode(calls, {
            action: 'DELEGATE',
            params: { VERSION: '0', NEW_SIGNING_PUBKEY: 'c'.repeat(64) },
            submitMethod: 'delegateAction',
        });
    });

    it('DelegateVoteForm composes VOTE v3 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DelegateVoteForm,
            props: { presetTick: 'JDOG' },
            actionLabel: 'Delegate votes',
            fill: (utils) => setValue(utils, 'Delegate to address', 'bc1qdelegate'),
        });
        expectSingleEncode(calls, {
            action: 'VOTE',
            params: { VERSION: '3', TICK: 'JDOG', DELEGATE_TO: 'bc1qdelegate' },
            submitMethod: 'delegateVoteAction',
        });
    });

    it('ControllerBindForm composes the host-built bind action and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ControllerBindForm,
            props: { tick: 'JDOG' },
            actionLabel: 'Bind',
            fill: (utils) => setValue(utils, 'Guard contract', '7'),
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            submitMethod: 'advancedAction',
        });
    });

    it('ExecuteContractForm composes EXECUTE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ExecuteContractForm,
            props: { contractActionIndex: '9' },
            actionLabel: 'Execute',
            fill: (utils) => setValue(utils, 'Method', 'transfer'),
        });
        expectSingleEncode(calls, {
            action: 'EXECUTE',
            params: { METHOD: 'transfer' },
            submitMethod: 'executeAction',
        });
    });

    it('ContractStakeForm composes STAKE v3 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ContractStakeForm,
            props: { contractActionIndex: '5' },
            actionLabel: 'Stake',
            fill: (utils) => {
                // `tick` defaults to XCHAIN, the gas token.
                setValue(utils, 'Signing public key', 'd'.repeat(64));
                setValue(utils, /^Amount/, '3');
            },
        });
        expectSingleEncode(calls, {
            action: 'STAKE',
            params: {
                VERSION: '3',
                SIGNING_PUBKEY: 'd'.repeat(64),
                TARGET_CONTRACT_INDEX: '5',
                TICK: 'XCHAIN',
                AMOUNT: '3',
            },
            submitMethod: 'contractStakeAction',
        });
        // The submit keeps the flow-facing param shape (no VERSION); only the
        // compose carries the wire form.
        const submit = calls.find((c) => c.method === 'contractStakeAction');
        expect(submit.args.params.VERSION).toBeUndefined();
        expect(submit.args.mode).toBe('stake');
    });

    it('DeployContractForm composes DEPLOY and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DeployContractForm,
            props: {},
            actionLabel: 'Deploy',
            fill: (utils) => {
                const code = utils.container.querySelector('textarea');
                if (!code) throw new Error('no contract-code textarea');
                fireEvent.change(code, { target: { value: 'export function main() {}' } });
                setValue(utils, 'Gas limit', '100000');
            },
        });
        expectSingleEncode(calls, { action: 'DEPLOY', submitMethod: 'deployAction' });
    });

    it('TokenAdminForm composes ISSUE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: TokenAdminForm,
            props: { mode: 'description', initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: 'Update token',
            fill: (utils) => setValue(utils, 'New description', 'a better token'),
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            params: { TICK: 'JDOG', DESCRIPTION: 'a better token' },
            submitMethod: 'issueToken',
        });
    });

    it('AdvancedActionsForm composes the picked action and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: AdvancedActionsForm,
            props: {},
            actionLabel: 'Sign action',
            fill: (utils) => {
                fireEvent.change(utils.getByLabelText('Action'), { target: { value: 'BROADCAST' } });
            },
        });
        const submit = expectSingleEncode(calls, {
            action: 'BROADCAST',
            submitMethod: 'advancedAction',
        });
        expect(submit.args.action).toBe('BROADCAST');
    });

    it('TokenWizard skips its own preview/sign stages and confirms the composed ISSUE', async () => {
        const { calls } = await driveThroughConfirm({
            Form: TokenWizard,
            props: {},
            actionLabel: 'Issue token',
            steps: [
                (utils) => fireEvent.click(utils.getByRole('button', { name: /Custom/ })),
                (utils) => fireEvent.click(utils.getByRole('button', { name: 'Next' })),
            ],
            fill: (utils) => {
                setValue(utils, 'Token name (ticker)', 'JDOG');
                setValue(utils, 'Supply', '1000');
            },
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            params: { TICK: 'JDOG' },
            submitMethod: 'issueToken',
        });
    });

    it('AirdropForm confirms leg 1 (LIST) and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: AirdropForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: /^Sign LIST/,
            steps: [
                (utils) => {
                    setValue(utils, /^Per-recipient amount/, '5');
                    const box = utils.container.querySelector('textarea');
                    if (!box) throw new Error('no recipients textarea');
                    fireEvent.change(box, { target: { value: 'bc1qrecipientone\nbc1qrecipienttwo' } });
                },
                // The recipient-list review stage is kept: it is a data
                // review, and its button is what opens the confirm page.
                (utils) => fireEvent.click(utils.getByRole('button', { name: 'Review recipients' })),
            ],
        });
        expectSingleEncode(calls, { action: 'LIST', submitMethod: 'createList' });
    });

    it('AirdropForm confirms leg 2 (AIRDROP) and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: AirdropForm,
            props: {
                resumeId: 'pa-1',
                // Resume straight into the second leg: the LIST is already
                // broadcast and indexed, so only the AIRDROP is left to sign.
                messagingOverrides: {
                    listPendingAirdropsForWallet: () => Promise.resolve([{
                        id: 'pa-1',
                        walletId: 'w',
                        chainId: CHAIN,
                        fromAddress: HD_ADDRESS.address,
                        token: 'JDOG',
                        amountPer: '5',
                        recipients: ['bc1qrecipientone', 'bc1qrecipienttwo'],
                        listTxid: 'listtx',
                        listActionIndex: '77',
                        stage: 'ready-to-airdrop',
                    }]),
                },
            },
            actionLabel: /^Sign AIRDROP/,
        });
        expectSingleEncode(calls, {
            action: 'AIRDROP',
            params: { VERSION: '0', TICK: 'JDOG', AMOUNT: '5', LIST_ACTION_INDEX: '77' },
            submitMethod: 'airdropAction',
        });
    });

    it('DispenserForm composes DISPENSER and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DispenserForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: 'Create',
            fill: (utils) => {
                setValue(utils, /^Give amount/, '10');
                setValue(utils, /^Escrow amount/, '100');
                setValue(utils, /^Trigger price/, '0.001');
            },
        });
        expectSingleEncode(calls, {
            action: 'DISPENSER',
            params: { VERSION: '0', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10', GIVE_ESCROW: '100' },
            submitMethod: 'dispenserAction',
        });
    });

    it('SwapForm composes SWAP and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: SwapForm,
            props: { initialChainId: CHAIN },
            actionLabel: 'Swap',
            steps: [
                // Give and get must differ: SwapForm rejects a same-ticker pair.
                openTokenField('Give token:'), pickToken('XCHAIN'),
                openTokenField('Get token:'), pickToken('JDOG'),
            ],
            fill: (utils) => {
                setValue(utils, /^Give amount/, '10');
                setValue(utils, /^Get amount/, '20');
            },
        });
        expectSingleEncode(calls, {
            action: 'SWAP',
            params: {
                VERSION: '0', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '10',
                GET_TICK: 'JDOG', GET_AMOUNT: '20',
            },
            submitMethod: 'swapAction',
        });
    });

    it('BroadcastForm composes BROADCAST and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: BroadcastForm,
            props: {},
            actionLabel: 'Broadcast',
            fill: (utils) => setValue(utils, 'Message', 'hello chain'),
        });
        expectSingleEncode(calls, {
            action: 'BROADCAST',
            params: { VERSION: '0', MESSAGE: 'hello chain' },
            submitMethod: 'broadcastAction',
        });
    });

    // : hardware signers were excluded from the confirm pipeline, so the
    // users most likely to care about verification got the legacy
    // rebuild-on-Approve path with no output-set tamper check - while the
    // modal's own hardware note tells them this screen is where action intent
    // is verified (the device can only show native outputs). This pins that a
    // HW source reaches the confirm page and signs the SAME prebuilt PSBT.
    it('BroadcastForm confirms a HARDWARE source and signs the prebuilt PSBT', async () => {
        const HW_ADDRESS = { ...HD_ADDRESS, source: 'trezor', signerId: 'signer-hw' };
        const { messaging, calls } = recordingMessaging({
            getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HW_ADDRESS] }),
            // The device reports ready, which is what gates Approve in place of
            // a typed password.
            getSignerStatus: () => Promise.resolve({ status: 'available' }),
        });
        let utils;
        await domAct(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    // Auto-select only picks `source === 'hd'`, so a hardware
                    // address is chosen explicitly, as a user would via the
                    // source picker.
                    React.createElement(BroadcastForm, {
                        walletId: 'w',
                        chainId: CHAIN,
                        initialFromAddress: HW_ADDRESS.address,
                        onBack() {},
                    }),
                ),
            );
            await drainMicrotasks();
        });
        await domAct(async () => {
            setValue(utils, 'Message', 'hello from hardware');
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Broadcast' }));
            await drainMicrotasks();
        });

        // The confirm page opened for a HW source, and there is no password
        // field on it: readiness is the device, not a typed secret.
        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.queryByLabelText('Password')).toBe(null);

        await domAct(async () => {
            vi.advanceTimersByTime(1000);
            await drainMicrotasks();
        });
        const approve = utils.getByTestId('confirm-approve');
        expect(approve.disabled, 'Approve enabled once the device is available').toBe(false);
        await domAct(async () => {
            fireEvent.click(approve);
            await drainMicrotasks();
        });

        // The HW lane, not the software one, and carrying the same bytes.
        const submit = calls.find((c) => c.method === 'broadcastActionHw');
        expect(submit, 'broadcastActionHw dispatched').toBeTruthy();
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(submit.args.signerId).toBe('signer-hw');
        expect(calls.some((c) => c.method === 'broadcastAction')).toBe(false);
    });

    // ---  §5.6 slice 3 (bespoke flows) --------------------------------

    it('PlaceOrderPanel composes ORDER and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: PlaceOrderPanel,
            props: { tick1: 'JDOG', tick2: 'XCHAIN' },
            // The software path carries the action verb, never "Review".
            actionLabel: 'Place buy order',
            fill: (utils) => {
                setValue(utils, /^Price/, '2');
                setValue(utils, /^Size/, '5');
            },
        });
        const submit = expectSingleEncode(calls, {
            action: 'ORDER',
            params: {
                VERSION: '0',
                // Buy tick1 with tick2: give price x size of tick2, get size of tick1.
                GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '10',
                GET_TICK: 'JDOG', GET_AMOUNT: '5',
            },
            submitMethod: 'orderAction',
        });
        // The exact params that were composed are the params submitted: a
        // rebuild on Approve would be a different order.
        expect(submit.args.params).toMatchObject({ GIVE_AMOUNT: '10', GET_AMOUNT: '5' });
    });
});

// ComposeMessage is the one action whose wire params cannot be built
// client-side: the body is ENCRYPTED host-side, so it composes through the
// dedicated `action.message.composeForConfirm` route and hands the resulting
// ciphertext params back on Approve. Re-encrypting on Approve would sign
// different bytes than the ones previewed, so that passthrough IS the
// single-encode guarantee here and is what this spec pins.
describe(' §5.6 slice 3: ComposeMessage confirms the encrypted MESSAGE', () => {
    const ENCRYPTED_PARAMS = Object.freeze({
        VERSION: '2',
        COIN: 'BTC',
        // `devmock` addresses are the validator's sanctioned test placeholder
        // (addressValidation.looksLikeDevMock), so this exercises the real
        // MESSAGE any-network recipient rule without pinning a live address.
        DESTINATION: 'bc1qdevmockrecipient',
        ENCRYPTED_MESSAGE: 'deadbeefciphertext',
    });

    async function driveComposeMessage() {
        const { messaging, calls } = recordingMessaging({
            getRecipientPubkey: () => Promise.resolve('02aabbcc'),
            listContacts: () => Promise.resolve([]),
            composeMessageForConfirm: (args) => {
                calls.push({ method: 'composeMessageForConfirm', args });
                return Promise.resolve({ ...COMPOSED, messageParams: { ...ENCRYPTED_PARAMS } });
            },
        });
        let utils;
        await domAct(async () => {
            utils = render(
                React.createElement(
                    MessagingProvider,
                    { shell: 'web', messaging },
                    React.createElement(ComposeMessage, {
                        walletId: 'w', chainId: CHAIN, onBack() {},
                    }),
                ),
            );
            await drainMicrotasks();
        });

        await domAct(async () => {
            setValue(utils, 'Address', ENCRYPTED_PARAMS.DESTINATION);
            setValue(utils, 'Message', 'hello there');
            await drainMicrotasks();
        });
        // The recipient-pubkey lookup is debounced; without it the encrypted
        // path stays gated on `checking`.
        await domAct(async () => {
            vi.advanceTimersByTime(500);
            await drainMicrotasks();
        });

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Send message' }));
            await drainMicrotasks();
        });
        await domAct(async () => {
            const approve = Array.from(utils.container.querySelectorAll('button'))
                .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
            if (!approve) throw new Error('no enabled Approve button on the confirm page');
            fireEvent.click(approve);
            await drainMicrotasks();
        });
        return { calls, utils };
    }

    it('encrypts host-side, then signs that exact ciphertext', async () => {
        const { calls } = await driveComposeMessage();

        const compose = calls.find((c) => c.method === 'composeMessageForConfirm');
        expect(compose, 'composeMessageForConfirm was dispatched').toBeTruthy();
        // The delivery network funds + broadcasts; the destination chain only
        // sets COIN and resolves the recipient's key.
        expect(compose.args.broadcastChainId).toBe(CHAIN);
        expect(compose.args.destination).toBe(ENCRYPTED_PARAMS.DESTINATION);
        expect(compose.args.message).toBe('hello there');
        // The generic compose route must NOT be used: it cannot encrypt.
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);

        const submit = calls.find((c) => c.method === 'messageAction');
        expect(submit, 'messageAction was dispatched on Approve').toBeTruthy();
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        // The load-bearing assertion: the SAME ciphertext, carried through.
        expect(submit.args.prebuiltParams).toEqual(ENCRYPTED_PARAMS);
    });
});
