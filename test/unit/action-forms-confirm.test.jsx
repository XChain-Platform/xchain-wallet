// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Preview-to-Confirm migration spec for the action forms.
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
import { selectOption } from '../helpers/selectOption.js';
import { publishWalletModes, resetWalletModes } from '../../packages/core/src/shared/hooks/useWalletMode.js';

import { BroadcastForm } from '../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CreatePollForm } from '../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { DelegateVoteForm } from '../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
// The staking routes render the one Staking form on their target and action.
import {
    ContractStakeRoute as ContractStakeForm,
    NetworkDelegationRoute as DelegationActionForm,
    NetworkPositionRoute as StakingActionForm,
    NetworkStakeRoute as StakeForm,
} from '../helpers/stakingFormRoutes.jsx';
import { DividendForm } from '../../packages/core/src/shared/routes/DividendForm.jsx';
import { IssueTokenForm } from '../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { ContractFundsForm } from '../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { CreateBetFeedForm } from '../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { CreateOrderForm } from '../../packages/core/src/shared/routes/CreateOrderForm.jsx';
import { ControllerBindForm } from '../../packages/core/src/shared/routes/ControllerBindForm.jsx';
import { UnbindForm } from '../../packages/core/src/shared/routes/UnbindForm.jsx';
import { DeployContractForm } from '../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import { TokenAdminForm } from '../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { AdvancedActionsForm } from '../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { TokenWizard } from '../../packages/core/src/shared/routes/TokenWizard.jsx';
import { AirdropForm } from '../../packages/core/src/shared/routes/AirdropForm.jsx';
import { DispenserForm } from '../../packages/core/src/shared/routes/DispenserForm.jsx';
import { SwapForm } from '../../packages/core/src/shared/routes/SwapForm.jsx';
import { SellOwnershipForm } from '../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { LinkForm } from '../../packages/core/src/shared/routes/LinkForm.jsx';
import { BatchComposerForm } from '../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { PlaceOrderPanel } from '../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { ComposeMessage } from '../../packages/core/src/shared/routes/ComposeMessage.jsx';
import { __clearTokenInfoCache } from '../../packages/core/src/shared/hooks/useTokenInfo.js';
import { PollDetail } from '../../packages/core/src/shared/routes/PollDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const VOTE_DELEGATE = 'bc1qdevmock03aabbcc';

// Same frozen fee-payer the Layer-4 harness uses: a newest HD address at
// change index 0, which every form auto-selects as the source.
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qdevmock02aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// The same address, paired to a device. Hardware signers used to be
// excluded from the confirm pipeline, which handed the users most likely to
// care about verification the legacy rebuild-on-Approve path with no
// output-set tamper check.
const HW_ADDRESS = Object.freeze({ ...HD_ADDRESS, source: 'trezor', signerId: 'signer-hw' });

const COMPOSED = Object.freeze({
    psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
});

beforeEach(() => {
    resetWalletModes();
    // A token record cached by one case must not answer the issuer check of the next.
    __clearTokenInfoCache();
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

// Owner-only token actions refuse until the issuer is confirmed; this record
// names the auto-selected source as JDOG's issuer for the cases that need it.
const OWNED_JDOG = Object.freeze({
    getTokenInfo: ({ tick } = {}) => Promise.resolve({ chainId: CHAIN, tick, creator: HD_ADDRESS.address, locks: {} }),
});

// Dividend Review needs a complete holder list, so the dividend cases answer
// the holder read with a whole set and let it land; the token lookups settle
// in the same wait, so they answer with real tokens.
const JDOG_HOLDERS = Object.freeze({
    getHoldersForToken: () => Promise.resolve({ data: [{ address: 'bc1qholderjdog', amount: '10' }], total: 1 }),
    getTokenInfo: ({ tick } = {}) => Promise.resolve({ chainId: CHAIN, tick, divisibility: 8, totalSupply: '1000000', locks: {} }),
});

// Recording messaging mock. Real shapes for the calls the confirm pipeline
// makes; every other host call resolves to a permissive generic so the
// route's loaded branch still settles.
// `walletMode` among the overrides is the mode of wallet `w`, published the way
// the shell does from the wallet list; every other override is a messaging method.
function recordingMessaging({ walletMode = 'full', ...overrides } = {}) {
    const calls = [];
    const generic = Object.freeze([]);
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode }]),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getOwnedTokens: () => Promise.resolve([{ tick: 'JDOG' }]),
        // One spendable token so the TokenPicker has a row to select.
        getWalletBalances: () => Promise.resolve({
            [CHAIN]: [{
                address: HD_ADDRESS.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000', divisibility: 8 },
                    tokens: [
                        { tick: 'XCHAIN', quantity: '100000000000', divisibility: 8 },
                        { tick: 'JDOG', quantity: '50000000000', divisibility: 8 },
                    ],
                },
            }],
        }),
        // ContractStakeForm refuses to compose against a contract with no
        // cooldown, so the target metadata has to be a real shape.
        getContractByActionIndex: () => Promise.resolve({
            row: { cooldown_blocks: 144, slash_destination: null },
            // ExecuteContractForm picks its method from the declared list.
            abi: {
                version: 1,
                methods: { transfer: { params: [] }, fundLoan: { params: [] } },
            },
        }),
        // AdvancedActionsForm's action picker is populated from the host.
        listActions: () => Promise.resolve(['BROADCAST', 'SEND']),
        validateAction: () => Promise.resolve({ valid: true, errors: [] }),
        getAddressBalances: () => Promise.resolve({
            native: { tick: 'BTC', quantity: '100000000000', divisibility: 8 },
            tokens: [{ tick: 'JDOG', quantity: '100000000000', divisibility: 8 }],
        }),
        // PollDetail renders its ballot editor from a loaded, OPEN poll.
        governancePoll: () => Promise.resolve({
            poll_index: 7, tick: 'JDOG', poll_status: 'open',
            options: ['Yes', 'No'], tally_mode: 'approval', max_selections: 1,
        }),
        governancePollResults: () => Promise.resolve([]),
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
        // VOTE composes through the SDK's own sdk.voting.*Params
        // builder, host-side. The stub stands in for that builder and
        // echoes the wire params back as `voteParams`, which is what the
        // confirm page decodes its intent from.
        composeVoteForConfirm: (args) => {
            calls.push({ method: 'composeVoteForConfirm', args });
            return Promise.resolve({ ...COMPOSED, voteParams: { VERSION: '0', TICK: 'JDOG' } });
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

function expectAccessibleFormControls(container) {
    const controls = container.querySelectorAll('input:not([type="hidden"]), select, [data-xc-select], textarea');
    for (const control of controls) {
        expect(control).toHaveAccessibleName();
        const descriptionIds = (control.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .filter(Boolean);
        for (const id of descriptionIds) {
            expect(document.getElementById(id), `${control.tagName} description #${id}`).toBeTruthy();
        }
        if (control.getAttribute('aria-invalid') === 'true') {
            expect(descriptionIds.length, `${control.tagName} invalid state has a description`).toBeGreaterThan(0);
        }
    }
}

/**
 * Mount a form, run its `fill` step, click the named action button, then
 * Approve on the confirm page. Returns every recorded host dispatch.
 *
 * @param {object} spec
 * @param {import('react').ComponentType<any>} spec.Form
 * @param {object} spec.props
 * @param {string|null} spec.actionLabel   the software-path primary button label, or null when a preceding step opens Confirm Standard
 * @param {(utils: any) => void} [spec.fill]
 * @param {Array<(utils: any) => void>} [spec.steps]   extra interactions, each flushed on its own (picker screens need a render between clicks)
 */
async function driveThroughConfirm({ Form, props, actionLabel, fill, steps = [], hw = false, afterClick = null, approveCount = 1 }) {
    const { messagingOverrides, ...formProps } = props;
    // The same drive, sourced from a paired device instead of an HD
    // key. Auto-select only picks `source === 'hd'`, so the hardware address
    // is named explicitly, as a user would via the source picker, and the
    // device reports ready - that, not a typed password, is what gates
    // Approve on this path.
    const { messaging, calls } = recordingMessaging(hw ? {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HW_ADDRESS] }),
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        ...messagingOverrides,
    } : messagingOverrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Form, {
                    walletId: 'w',
                    chainId: CHAIN,
                    onBack() {},
                    ...(hw ? { initialFromAddress: HW_ADDRESS.address } : {}),
                    ...formProps,
                }),
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

    expectAccessibleFormControls(utils.container);

    // Some flows, such as Airdrop's recipient review, now open the shared
    // Confirm Standard directly. Other forms still need their main action
    // clicked first.
    if (!utils.container.querySelector('[data-testid="confirm-modal"]')) {
        if (!actionLabel) throw new Error('the preceding step did not open Confirm Standard');
        const button = utils.getByRole('button', { name: actionLabel });
        expect(button.disabled, `"${actionLabel}" button is enabled`).toBe(false);
        await domAct(async () => {
            fireEvent.click(button);
            await drainMicrotasks();
        });
    }
    if (afterClick) {
        await domAct(async () => {
            afterClick(utils);
            await drainMicrotasks();
        });
    }

    const confirm = utils.container.querySelector('[data-testid="confirm-modal"]');
    expect(confirm, 'the action opens Confirm Standard').toBeTruthy();
    expect(confirm.querySelector('[data-testid="confirm-sentence"]')).toBeTruthy();
    expect(utils.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(utils.getByRole('button', { name: 'Approve' })).toBeTruthy();

    for (let round = 0; round < approveCount; round += 1) {
        // Airdrop has two G127 pages in sequence: recipient data approval,
        // then approval of the composed LIST or AIRDROP transaction.
        // eslint-disable-next-line no-await-in-loop
        await domAct(async () => {
            const approve = Array.from(utils.container.querySelectorAll('button'))
                .find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
            if (!approve) throw new Error('no enabled Approve button on the confirm page');
            fireEvent.click(approve);
            await drainMicrotasks(30);
        });
        if (round + 1 < approveCount) {
            expect(utils.getByTestId('confirm-sentence')).toBeTruthy();
            expect(utils.getByRole('button', { name: 'Reject' })).toBeTruthy();
            expect(utils.getByRole('button', { name: 'Approve' })).toBeTruthy();
        }
    }

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
    const control = utils.getByLabelText(label);
    // Dropdowns are the themed Select: pick the option rather than typing a value.
    if (control.hasAttribute('data-xc-select')) selectOption(control, value);
    else fireEvent.change(control, { target: { value } });
};

async function mountFilledForm({ Form, props, steps = [], fill }) {
    const { messagingOverrides, ...formProps } = props;
    const { messaging, calls } = recordingMessaging(messagingOverrides);
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Form, {
                    walletId: 'w',
                    chainId: CHAIN,
                    onBack() {},
                    ...formProps,
                }),
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
    return { calls, utils };
}

async function clickAction(utils, label) {
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: label }));
        await drainMicrotasks();
    });
}

async function approveAction(utils) {
    await domAct(async () => {
        const approve = Array.from(utils.container.querySelectorAll('button'))
            .find((button) => /approve/i.test(button.textContent || '') && !button.disabled);
        if (!approve) throw new Error('no enabled Approve button on the confirm page');
        fireEvent.click(approve);
        await drainMicrotasks();
    });
}

// TokenField opens the shared TokenPicker screen; these two steps open it
// and pick the row for `tick` out of the mocked wallet balances.
const openTokenField = (label) => (utils) => {
    fireEvent.click(utils.getByRole('button', { name: new RegExp(`^${label}`, 'i') }));
};
// A closed form section's fields are not reachable by role until it is opened.
const openFormSection = (title) => (utils) => {
    const toggle = utils.getAllByRole('button')
        .find((b) => b.hasAttribute('aria-expanded') && (b.textContent || '').startsWith(title));
    if (!toggle) throw new Error(`no ${title} section`);
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
};
const pickToken = (tick) => (utils) => {
    const row = Array.from(utils.container.querySelectorAll('button'))
        .find((b) => (b.textContent || '').includes(tick));
    if (!row) throw new Error(`no ${tick} row in the token picker`);
    fireEvent.click(row);
};

describe('Action forms confirm via the single-encode pipeline', () => {
    it('CreatePollForm composes VOTE v0 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: CreatePollForm,
            props: { presetTick: 'JDOG' },
            actionLabel: 'Create Poll',
            fill: (utils) => {
                // The wallet requires a question before it composes a poll.
                setValue(utils, 'Question', 'Which option wins?');
                setValue(utils, 'Closes at block', '900000');
                // Option fields are numbered from 1; the wire list stays in order.
                setValue(utils, 'Option 1', 'Yes');
                setValue(utils, 'Option 2', 'No');
            },
        });
        // VOTE's wire encoding belongs to sdk.voting.createPollParams,
        // which lives host-side, so the form hands over the UI-level input and
        // the HOST builds the params the encoder sees. The generic route must
        // NOT be used: it would compose a client-side mirror of that encoding,
        // and a mirror that drifts gets SIGNED rather than caught (the tamper
        // check verifies the PSBT against whatever the encoder was handed).
        const compose = calls.find((c) => c.method === 'composeVoteForConfirm');
        expect(compose, 'composed through the VOTE builder route').toBeTruthy();
        expect(compose.args.builder).toBe('createPollParams');
        expect(compose.args.params).toMatchObject({
            tick: 'JDOG', endBlock: '900000', options: ['Yes', 'No'], question: 'Which option wins?',
        });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(calls.some((c) => c.method === 'preflight'), 'preflight streamed').toBe(true);
        const submit = calls.find((c) => c.method === 'createPollAction');
        expect(submit, 'createPollAction dispatched on Approve').toBeTruthy();
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
    });

    it('DividendForm composes DIVIDEND and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DividendForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG', messagingOverrides: JDOG_HOLDERS },
            actionLabel: 'Pay Dividend',
            steps: [openTokenField('Dividend token'), pickToken('XCHAIN'), () => vi.advanceTimersByTime(450)],
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
            actionLabel: 'Issue Token',
            fill: (utils) => {
                setValue(utils, 'Ticker', 'JDOG');
                fireEvent.change(utils.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
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
        // Seed one staked position so the editable Amount field has
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
            steps: [openTokenField('Token:'), pickToken('XCHAIN')],
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
            actionLabel: 'Delegate Signing Key',
            fill: (utils) => setValue(utils, 'New signing pubkey', 'c'.repeat(64)),
        });
        expectSingleEncode(calls, {
            action: 'DELEGATE',
            params: { VERSION: '0', NEW_SIGNING_PUBKEY: 'c'.repeat(64) },
            submitMethod: 'delegateAction',
        });
    });

    // Capability revoke is DELEGATE v2; a v0 pin has no SIGNING_PUBKEY slot and the SDK refuses it.
    it('DelegationActionForm (revoke) composes DELEGATE v2 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DelegationActionForm,
            props: { mode: 'revoke' },
            actionLabel: 'Revoke Delegation',
            fill: (utils) => setValue(utils, 'Signing pubkey to revoke', 'd'.repeat(64)),
        });
        const submit = expectSingleEncode(calls, {
            action: 'DELEGATE',
            params: { VERSION: '2', SIGNING_PUBKEY: 'd'.repeat(64) },
            submitMethod: 'revokeDelegationAction',
        });
        expect(submit.args.params).toMatchObject({ VERSION: '2', SIGNING_PUBKEY: 'd'.repeat(64) });
    });

    it('DelegateVoteForm composes VOTE v3 and signs the prebuilt PSBT', async () => {
        const { calls, utils } = await driveThroughConfirm({
            Form: DelegateVoteForm,
            props: { presetTick: 'JDOG' },
            actionLabel: 'Delegate Votes',
            fill: (utils) => setValue(utils, 'Delegate to address', VOTE_DELEGATE),
        });
        const compose = calls.find((c) => c.method === 'composeVoteForConfirm');
        expect(compose, 'composed through the VOTE builder route').toBeTruthy();
        expect(compose.args.builder).toBe('delegateVoteParams');
        expect(compose.args.params).toMatchObject({ tick: 'JDOG', delegateTo: VOTE_DELEGATE });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        const submit = calls.find((c) => c.method === 'delegateVoteAction');
        expect(submit, 'delegateVoteAction dispatched on Approve').toBeTruthy();
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        // The result step's Done is its green main action with an icon (U63).
        const done = utils.getByRole('button', { name: 'Done' });
        expect(done.className).toMatch(/success/);
        expect(done.querySelector('svg')).not.toBeNull();
    });

    it('ControllerBindForm composes the host-built bind action and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ControllerBindForm,
            props: { tick: 'JDOG', messagingOverrides: OWNED_JDOG },
            actionLabel: 'Bind Token',
            fill: (utils) => setValue(utils, 'Guard contract', '7'),
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            submitMethod: 'advancedAction',
        });
    });

    // UNBIND is the only way a token is released from a guard, and it is its
    // own form. An unbind sends an EMPTY CONTROLLER, because the chain resolves
    // the live binding for the chosen class itself, so the form has no Guard
    // contract field at all and must still compose.
    it('UnbindForm composes an UNBIND with no guard contract at all', async () => {
        const { calls } = await driveThroughConfirm({
            Form: UnbindForm,
            props: { tick: 'JDOG', messagingOverrides: OWNED_JDOG },
            actionLabel: 'Unbind',
        });
        const built = calls.find((c) => c.method === 'buildControllerBindParams');
        expect(built, 'the unbind reached the host builder').toBeTruthy();
        expect(built.args.unbind, 'built as a drop, not a bind').toBe(true);
        expect(built.args.target).toBe('token');
        expect(built.args.tick).toBe('JDOG');
        // Empty, not a placeholder: a value here would be discarded by the
        // chain, so inventing one would only mislead the review screen.
        expect(String(built.args.controller || '')).toBe('');
        expectSingleEncode(calls, {
            action: 'ISSUE',
            submitMethod: 'advancedAction',
        });
    });

    it('ExecuteContractForm composes EXECUTE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ExecuteContractForm,
            props: { contractActionIndex: '9' },
            actionLabel: 'Call Contract',
            fill: (utils) => setValue(utils, 'Method', 'transfer'),
        });
        expectSingleEncode(calls, {
            action: 'EXECUTE',
            params: { METHOD: 'transfer' },
            submitMethod: 'executeAction',
        });
        // EXECUTE v0 has no GAS_LIMIT slot; the form used to inject one
        // anyway, and the SDK's leg-field guard then refused every compose,
        // so no contract method could be called from the wallet at all.
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params.GAS_LIMIT).toBeUndefined();
    });

    // EXECUTE carries no amount, so a paid method (a loan's fundLoan) only
    // sees tokens deposited ahead of it in the same transaction. A tester's
    // bare fundLoan reverted because the form had no way to attach one.
    it('ExecuteContractForm with a deposit composes DEPOSIT then EXECUTE as one BATCH', async () => {
        let built = null;
        const { calls } = await driveThroughConfirm({
            Form: ExecuteContractForm,
            props: {
                contractActionIndex: '9',
                messagingOverrides: {
                    buildBatchCommand: (args) => {
                        built = args;
                        return Promise.resolve({
                            command: 'DEPOSIT|0|9|XCHAIN|10;EXECUTE|0|9|fundLoan',
                            subStrings: ['DEPOSIT|0|9|XCHAIN|10', 'EXECUTE|0|9|fundLoan'],
                        });
                    },
                },
            },
            actionLabel: 'Call Contract',
            steps: [
                (utils) => setValue(utils, 'Method', 'fundLoan'),
                openFormSection('Deposit'),
                // The Deposit section's field is labelled Token.
                openTokenField('Token:'),
                pickToken('XCHAIN'),
            ],
            fill: (utils) => setValue(utils, /^Deposit amount/, '10'),
        });
        expect(built.subActions.map((x) => x.action)).toEqual(['DEPOSIT', 'EXECUTE']);
        expect(built.subActions[0].params).toMatchObject({
            CONTRACT_ACTION_INDEX: '9', TICK: 'XCHAIN', QUANTITY: '10',
        });
        expect(built.subActions[1].params).toMatchObject({ CONTRACT_ACTION_INDEX: '9', METHOD: 'fundLoan' });
        expectSingleEncode(calls, {
            action: 'BATCH',
            params: { VERSION: '0', COMMAND: 'DEPOSIT|0|9|XCHAIN|10;EXECUTE|0|9|fundLoan' },
            submitMethod: 'advancedAction',
        });
        const submit = calls.find((c) => c.method === 'advancedAction');
        expect(submit.args.action).toBe('BATCH');
        expect(calls.some((c) => c.method === 'executeAction'), 'no bare EXECUTE submit').toBe(false);
    });

    it('ExecuteContractForm refuses a deposit token with no amount instead of composing', async () => {
        const { messaging, calls } = recordingMessaging({});
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
                React.createElement(ExecuteContractForm, {
                    walletId: 'w', chainId: CHAIN, contractActionIndex: '9', onBack() {},
                })));
            await drainMicrotasks();
        });
        for (const step of [
            (u) => setValue(u, 'Method', 'fundLoan'),
            openFormSection('Deposit'),
            openTokenField('Token:'),
            pickToken('XCHAIN'),
            (u) => fireEvent.click(u.getByRole('button', { name: 'Call Contract' })),
        ]) {
            // eslint-disable-next-line no-await-in-loop
            await domAct(async () => { step(utils); await drainMicrotasks(); });
        }
        expect(utils.getByText('Deposit amount must be a positive number.')).toBeTruthy();
        expect(calls.some((c) => c.method === 'composeForConfirm' || c.method === 'buildBatchCommand')).toBe(false);
    });

    it('the Staking form toggle switches a contract stake to UNSTAKE v1 on the contract wire', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ContractStakeForm,
            props: { contractActionIndex: '5' },
            steps: [(u) => fireEvent.click(u.getByRole('radio', { name: 'Unstake' }))],
            actionLabel: 'Unstake',
            // Amount left blank: the full staked balance, legacy no-AMOUNT bytes.
            fill: (utils) => setValue(utils, 'Signing Key', 'e'.repeat(64)),
        });
        expectSingleEncode(calls, {
            action: 'UNSTAKE',
            params: {
                VERSION: '1',
                SIGNING_PUBKEY: 'e'.repeat(64),
                TARGET_CONTRACT_INDEX: '5',
                TICK: 'XCHAIN',
            },
            submitMethod: 'contractStakeAction',
        });
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params.AMOUNT).toBeUndefined();
        expect(calls.find((c) => c.method === 'contractStakeAction').args.mode).toBe('unstake');
    });

    it('the Staking form Action switches a network stake to DELEGATE v0 on the validator wire', async () => {
        const { calls } = await driveThroughConfirm({
            Form: StakeForm,
            props: {},
            steps: [
                (u) => fireEvent.click(u.getByRole('button', { name: 'Action: Stake' })),
                (u) => {
                    // Only the network's own five actions are offered.
                    expect(u.getAllByRole('option').map((o) => o.textContent))
                        .toEqual(['Stake', 'Unstake', 'Claim', 'Delegate', 'Revoke']);
                    fireEvent.click(u.getByRole('option', { name: 'Delegate' }));
                },
            ],
            actionLabel: 'Delegate Signing Key',
            fill: (utils) => setValue(utils, 'New signing pubkey', 'c'.repeat(64)),
        });
        expectSingleEncode(calls, {
            action: 'DELEGATE',
            params: { VERSION: '0', NEW_SIGNING_PUBKEY: 'c'.repeat(64) },
            submitMethod: 'delegateAction',
        });
    });

    it('ContractStakeForm composes STAKE v3 and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: ContractStakeForm,
            props: { contractActionIndex: '5' },
            actionLabel: 'Stake',
            fill: (utils) => {
                // `tick` defaults to XCHAIN, the gas token.
                setValue(utils, 'Signing Key', 'd'.repeat(64));
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
            actionLabel: 'Publish Contract',
            fill: (utils) => {
                const code = utils.container.querySelector('textarea');
                if (!code) throw new Error('no contract-code textarea');
                fireEvent.change(code, { target: { value: 'export function main() {}' } });
                setValue(utils, 'Gas limit', '100000');
                // There is no Name field to fill any more: a contract's name is
                // an export of its own source under CONTRACT_META_REQUIRED. The
                // NAME assertion below stays, because no DEPLOY version has a
                // slot for one and a params.NAME would make the deploy
                // uncomposable whatever put it there.
            },
        });
        expectSingleEncode(calls, { action: 'DEPLOY', submitMethod: 'deployAction' });
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.actionData.params.NAME).toBeUndefined();
    });

    it('TokenAdminForm composes ISSUE and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: TokenAdminForm,
            props: { mode: 'description', initialChainId: CHAIN, initialTick: 'JDOG', messagingOverrides: OWNED_JDOG },
            actionLabel: 'Update Description',
            fill: (utils) => setValue(utils, 'Description', 'a better token'),
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
            actionLabel: 'Sign Action',
            fill: (utils) => {
                selectOption(utils.getByLabelText('Action'), 'BROADCAST');
            },
        });
        const submit = expectSingleEncode(calls, {
            action: 'BROADCAST',
            submitMethod: 'advancedAction',
        });
        expect(submit.args.action).toBe('BROADCAST');
    });

    describe('AdvancedActionsForm gates irreversible raw actions behind a typed word', () => {
        const fieldsFor = (fields) => ({
            messagingOverrides: {
                listActions: () => Promise.resolve(['DESTROY', 'BROADCAST']),
                getActionFormats: () => Promise.resolve({ 0: ['VERSION', ...fields].join('|') }),
                getActionFields: () => Promise.resolve(fields),
            },
        });
        const approveButton = (utils) => Array.from(utils.container.querySelectorAll('button'))
            .find((button) => /approve/i.test(button.textContent || ''));

        it('holds Approve for DESTROY until DESTROY is typed, saying why on a tap (G130)', async () => {
            const { utils } = await mountFilledForm({
                Form: AdvancedActionsForm,
                props: fieldsFor(['TICK', 'AMOUNT']),
                fill: (u) => {
                    selectOption(u.getByLabelText('Action'), 'DESTROY');
                },
            });
            await domAct(async () => { await drainMicrotasks(); });
            setValue(utils, 'TICK', 'JDOG');
            setValue(utils, 'AMOUNT', '5');
            await clickAction(utils, 'Sign Action');

            // Approve keeps its colour; a tap before the word is typed is
            // answered at the top of the page instead of signing.
            const held = async () => {
                expect(approveButton(utils).disabled).toBe(false);
                await domAct(async () => {
                    fireEvent.click(approveButton(utils));
                    await drainMicrotasks();
                });
                expect(utils.getByTestId('confirm-blocked').textContent).toBe('Finish the step above Approve, then approve.');
            };
            await held();
            await domAct(async () => {
                setValue(utils, 'Type "DESTROY" to confirm', 'destroy');
                await drainMicrotasks();
            });
            await held();
            await domAct(async () => {
                setValue(utils, 'Type "DESTROY" to confirm', ' DESTROY ');
                await drainMicrotasks();
            });
            await held();
            await domAct(async () => {
                setValue(utils, 'Type "DESTROY" to confirm', 'DESTROY');
                await drainMicrotasks();
            });
            expect(approveButton(utils).disabled).toBe(false);
            expect(utils.queryByTestId('confirm-blocked')).toBeNull();
        });

        it('asks for no typed word on an action that can be undone', async () => {
            const { utils } = await mountFilledForm({
                Form: AdvancedActionsForm,
                props: fieldsFor([]),
                fill: (u) => {
                    selectOption(u.getByLabelText('Action'), 'BROADCAST');
                },
            });
            await clickAction(utils, 'Sign Action');

            expect(utils.queryByLabelText(/to confirm/)).toBeNull();
            expect(approveButton(utils).disabled).toBe(false);
        });
    });

    // The wizard is the one Issue Token form: no template, details or review
    // steps of its own, so one press composes and opens the confirm page.
    it('TokenWizard skips its own preview/sign stages and confirms the composed ISSUE', async () => {
        const { calls } = await driveThroughConfirm({
            Form: TokenWizard,
            props: {},
            actionLabel: 'Issue Token',
            fill: (utils) => {
                setValue(utils, 'Ticker', 'JDOG');
                fireEvent.change(utils.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
            },
        });
        expectSingleEncode(calls, {
            action: 'ISSUE',
            params: { TICK: 'JDOG' },
            submitMethod: 'issueToken',
        });
    });

    it('TokenWizard builds an unsigned ISSUE in watcher mode without asking for a password', async () => {
        const build = vi.fn(async (args) => ({
            psbtHex: '70736274ff00',
            encoding: 'op_return',
            chainId: args.chainId,
            fromAddress: args.from.address,
        }));
        const { messaging, calls } = recordingMessaging({
            walletMode: 'watcher',
            buildActionPsbtRequest: build,
        });
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messaging}>
                    <TokenWizard walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drainMicrotasks();
        });
        await domAct(async () => {
            setValue(utils, 'Ticker', 'JDOG');
            fireEvent.change(utils.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
            await drainMicrotasks();
        });

        expect(utils.queryByLabelText('Password')).toBeNull();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Issue Token' }));
            await drainMicrotasks();
        });
        // Watcher mode uses the same Confirm Standard, then builds the unsigned transaction.
        expect(utils.getByTestId('confirm-sentence')).toHaveTextContent('Issue');
        expect(utils.getByRole('button', { name: 'Reject' })).toBeTruthy();
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Approve' }));
            await drainMicrotasks();
        });

        expect(build).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            actionData: expect.objectContaining({
                action: 'ISSUE',
                params: expect.objectContaining({ TICK: 'JDOG' }),
            }),
        }));
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(utils.getByLabelText('Unsigned transaction code')).toBeTruthy();
        expect(utils.queryByLabelText('Password')).toBeNull();
    });

    it('AirdropForm confirms leg 1 (LIST) and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: AirdropForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: null,
            approveCount: 2,
            steps: [
                (utils) => {
                    setValue(utils, /^Per-recipient amount/, '5');
                    const box = utils.container.querySelector('textarea');
                    if (!box) throw new Error('no recipients textarea');
                    // Real bitcoin-mainnet addresses: a later change made the
                    // recipient parser network-aware, so placeholder strings
                    // are now skipped (that is the whole point of the fix).
                    fireEvent.change(box, {
                        target: {
                            value: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4\n'
                                + '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
                        },
                    });
                },
                // The recipient-list review stage is kept: it is a data
                // review, and its button is what opens the confirm page.
                (utils) => fireEvent.click(utils.getByRole('button', { name: 'Review Recipients' })),
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
            actionLabel: null,
            approveCount: 2,
        });
        expectSingleEncode(calls, {
            action: 'AIRDROP',
            params: { VERSION: '0', TICK: 'JDOG', AMOUNT: '5', LIST_ACTION_INDEX: '77' },
            submitMethod: 'airdropAction',
        });
    });

    // The review stage has no fee toggle, so a resumed AIRDROP can only pay
    // the way the LIST did if the pending record carries that choice. Without
    // it a Bitcoin airdrop whose LIST paid in BTC moved onto the XCHAIN balance.
    it.each([
        [true, true],
        [false, undefined],
        [undefined, undefined],
    ])('AirdropForm resumes leg 2 on the fee lane the LIST chose (record %s)', async (recorded, expected) => {
        const { calls } = await driveThroughConfirm({
            Form: AirdropForm,
            props: {
                resumeId: 'pa-1',
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
                        ...(recorded === undefined ? {} : { payFeeInNativeCoin: recorded }),
                    }]),
                },
            },
            actionLabel: null,
            approveCount: 2,
        });
        const submit = expectSingleEncode(calls, { action: 'AIRDROP', submitMethod: 'airdropAction' });
        const compose = calls.find((c) => c.method === 'composeForConfirm');
        expect(compose.args.encoderOpts?.payFeeInNativeCoin).toBe(expected);
        expect(submit.args.payFeeInNativeCoin).toBe(expected);
    });

    it('DispenserForm composes DISPENSER and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: DispenserForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: 'Create Dispenser',
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
            actionLabel: 'Create Swap',
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

    // The value-moving forms the §5.6 migration left behind. Each one signed
    // from a hand-rolled review stage, so the bytes broadcast were a rebuild
    // of the bytes the user read. A regression to that path drops
    // `prebuiltPsbt` and never opens a confirm page, so it fails here.
    it('SellOwnershipForm composes ORDER and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: SellOwnershipForm,
            props: { tick: 'JDOG', messagingOverrides: OWNED_JDOG },
            actionLabel: 'List Ownership for Sale',
            fill: (utils) => setValue(utils, /^Price/, '5'),
        });
        expectSingleEncode(calls, {
            action: 'ORDER',
            params: { VERSION: '0', GIVE_TICK: 'JDOG', GIVE_OWNERSHIP: '1', GET_AMOUNT: '5' },
            submitMethod: 'orderAction',
        });
    });

    // A BATCH is the largest thing one signature can authorise, and its
    // review list is a decode of what the HOST said it built. Nothing tied
    // that list to the bytes until the form joined the lane.
    it('BatchComposerForm composes BATCH and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: BatchComposerForm,
            props: {
                messagingOverrides: {
                    buildBatchCommand: () => Promise.resolve({
                        command: 'SEND|0|JDOG|1|bc1qdest', subStrings: ['SEND|0|JDOG|1|bc1qdest'],
                    }),
                },
            },
            steps: [
                (utils) => selectOption(utils.getByLabelText('Action'), 'SEND'),
                (utils) => fireEvent.click(utils.getByRole('button', { name: 'Review 1 Transaction' })),
            ],
            actionLabel: 'Sign Batch',
        });
        expectSingleEncode(calls, {
            action: 'BATCH',
            params: { VERSION: '0', COMMAND: 'SEND|0|JDOG|1|bc1qdest' },
            submitMethod: 'advancedAction',
        });
    });

    // A refused compose shows a sentence; the composer's own text sits only in the collapsed details.
    it('BatchComposerForm shows a refused compose in plain words, raw text only in details', async () => {
        const raw = 'buildBatchCommand: STAKE version 1 is accepted on Bitcoin only, not on litecoin-mainnet';
        const { messaging } = recordingMessaging({
            buildBatchCommand: () => Promise.reject(new Error(raw)),
        });
        let utils;
        await domAct(async () => {
            utils = render(React.createElement(MessagingProvider, { shell: 'web', messaging },
                React.createElement(BatchComposerForm, { walletId: 'w', chainId: CHAIN, onBack() {} })));
            await drainMicrotasks();
        });
        for (const step of [
            (u) => selectOption(u.getByLabelText('Action'), 'SEND'),
            (u) => fireEvent.click(u.getByRole('button', { name: 'Review 1 Transaction' })),
        ]) {
            // eslint-disable-next-line no-await-in-loop
            await domAct(async () => { step(utils); await drainMicrotasks(); });
        }
        const alert = utils.getByText(/works only on Bitcoin/);
        expect(alert.textContent).not.toMatch(/buildBatchCommand|litecoin-mainnet/);
        const details = utils.container.querySelector('details');
        expect(details, 'the raw refusal is kept in a collapsed disclosure').toBeTruthy();
        expect(details.textContent).toContain(raw);
    });

    it('LinkForm composes LINK and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: LinkForm,
            props: {
                messagingOverrides: {
                    getActionByIndex: () => Promise.resolve({ action: 'SEND', tick: 'JDOG', amount: '1' }),
                },
            },
            actionLabel: 'Link Actions',
            steps: [
                (utils) => {
                    // Both action cards carry the same field label, so they are
                    // addressed positionally: Action 1 first, Action 2 second.
                    const [a, b] = utils.getAllByLabelText('Action number');
                    fireEvent.change(a, { target: { value: '11' } });
                    fireEvent.change(b, { target: { value: '22' } });
                },
                () => vi.advanceTimersByTime(350),
            ],
        });
        // The binding is the whole point: the pair the user read has to be
        // the pair inside the bytes that get signed.
        expectSingleEncode(calls, {
            action: 'LINK',
            params: {
                VERSION: '0',
                COIN1: 'BTC', COIN1_ACTION_INDEX: '11',
                COIN2: 'BTC', COIN2_ACTION_INDEX: '22',
            },
            submitMethod: 'linkAction',
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

    // Hardware signers were excluded from the confirm pipeline, so the
    // users most likely to care about verification got the legacy
    // rebuild-on-Approve path with no output-set tamper check - while the
    // modal's own hardware note tells them this screen is where action intent
    // is verified (the device can only show native outputs). This pins that a
    // HW source reaches the confirm page and signs the SAME prebuilt PSBT.
    it('BroadcastForm confirms a HARDWARE source and signs the prebuilt PSBT', async () => {
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

    // --- §5.6 slice 3 (bespoke flows) --------------------------------

    it('PlaceOrderPanel composes ORDER and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: PlaceOrderPanel,
            props: { tick1: 'JDOG', tick2: 'XCHAIN' },
            // The software path carries the action verb, never "Review".
            actionLabel: 'Place Buy Order',
            fill: (utils) => {
                // /^Price/ alone also names the "Price and amount" field group.
                setValue(utils, /^Price \(/, '2');
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

    // Casting a ballot was the last signing surface still on the
    // legacy stage machine, where submitWithSigner rebuilds the PSBT on
    // Approve. Ballots are token-weighted governance; leaving them without
    // the tamper check and pre-flight panel every other action gets was a
    // migration gap, not a design decision.
    it('PollDetail composes a ballot through the VOTE builder and signs the prebuilt PSBT', async () => {
        const { calls } = await driveThroughConfirm({
            Form: PollDetail,
            props: { pollIndex: 7 },
            actionLabel: 'Sign Vote',
            // The Yes row opens Cast Vote with Yes chosen, whose Sign Vote
            // leads to the confirm screen.
            fill: (utils) => {
                fireEvent.click(utils.getByRole('button', { name: 'Vote for Yes' }));
            },
        });

        // The ballot encoding (approval indices vs split option:share pairs)
        // belongs to sdk.voting.castBallotParams, host-side. The form hands
        // over its UI-level ballot; it must not encode the wire form itself.
        const compose = calls.find((c) => c.method === 'composeVoteForConfirm');
        expect(compose, 'composed through the VOTE builder route').toBeTruthy();
        expect(compose.args.builder).toBe('castBallotParams');
        expect(compose.args.params).toMatchObject({ pollRef: 7, ballot: [0] });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(calls.some((c) => c.method === 'preflight'), 'preflight streamed').toBe(true);

        const submit = calls.find((c) => c.method === 'castBallotAction');
        expect(submit, 'castBallotAction dispatched on Approve').toBeTruthy();
        expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
        expect(submit.args.params).toMatchObject({ pollRef: 7, ballot: [0] });
    });
});

// The same spec, driven from a paired device.
//
// Every migrated form gated its confirm path on `!isHwSource`, so hardware
// users fell back to the LEGACY review stage where submitWithSigner REBUILDS
// the PSBT on Approve: no output-set tamper check, no action-byte cross-check,
// no exact fee, no pre-flight panel, no reservation - while the confirm page's
// own hardware note tells them precisely that screen is where action intent
// gets verified, because the device can only show native outputs and
// destinations. The users with the most to verify had the least verification.
//
// Each case pins three things a regression would break: the confirm page opens
// for a HW source, it shows NO password field (readiness is the device), and
// Approve dispatches the `.hw` lane carrying the SAME prebuilt PSBT - never the
// software lane, which would try to sign with a password that was never typed.
describe('Hardware signers confirm on the single-encode surface', () => {
    /** Forms whose source can be named at mount, so a device can be the payer. */
    const HW_CASES = [
        {
            name: 'DividendForm',
            Form: DividendForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG', messagingOverrides: JDOG_HOLDERS },
            actionLabel: 'Pay Dividend',
            steps: [openTokenField('Dividend token'), pickToken('XCHAIN'), () => vi.advanceTimersByTime(450)],
            fill: (utils) => setValue(utils, /^Per-unit amount/, '0.5'),
            software: 'dividendAction',
            hardware: 'dividendActionHw',
        },
        {
            name: 'TokenAdminForm',
            Form: TokenAdminForm,
            props: { mode: 'description', initialChainId: CHAIN, initialTick: 'JDOG', messagingOverrides: OWNED_JDOG },
            actionLabel: 'Update Description',
            fill: (utils) => setValue(utils, 'Description', 'a better token'),
            software: 'issueToken',
            hardware: 'issueTokenHw',
        },
        {
            name: 'DispenserForm',
            Form: DispenserForm,
            props: { initialChainId: CHAIN, initialTick: 'JDOG' },
            actionLabel: 'Create Dispenser',
            fill: (utils) => {
                setValue(utils, /^Give amount/, '10');
                setValue(utils, /^Escrow amount/, '100');
                setValue(utils, /^Trigger price/, '0.001');
            },
            software: 'dispenserAction',
            hardware: 'dispenserActionHw',
        },
    ];

    for (const c of HW_CASES) {
        it(`${c.name} confirms a HARDWARE source and signs the prebuilt PSBT`, async () => {
            const { calls, utils } = await driveThroughConfirm({
                Form: c.Form,
                props: c.props,
                actionLabel: c.actionLabel,
                steps: c.steps,
                fill: c.fill,
                hw: true,
            });

            // No password field: a device is not unlocked by typing here.
            expect(utils.queryByLabelText('Password')).toBe(null);

            const compose = calls.find((x) => x.method === 'composeForConfirm');
            expect(compose, 'composed host-side for the HW source too').toBeTruthy();
            expect(compose.args.from.address).toBe(HW_ADDRESS.address);

            const submit = calls.find((x) => x.method === c.hardware);
            expect(submit, `${c.hardware} dispatched on Approve`).toBeTruthy();
            // The load-bearing assertion: the device signs the bytes the user
            // saw checked, not a rebuild.
            expect(submit.args.prebuiltPsbt).toMatchObject({ psbtHex: 'aa00', encoding: 'psbt' });
            expect(submit.args.signerId).toBe('signer-hw');
            // No password may ride the HW lane, and the software lane must
            // never fire: it would sign with an empty password.
            expect(submit.args.password).toBe(undefined);
            expect(calls.some((x) => x.method === c.software)).toBe(false);
        });
    }
});

// ComposeMessage is the one action whose wire params cannot be built
// client-side: the body is ENCRYPTED host-side, so it composes through the
// dedicated `action.message.composeForConfirm` route and hands the resulting
// ciphertext params back on Approve. Re-encrypting on Approve would sign
// different bytes than the ones previewed, so that passthrough IS the
// single-encode guarantee here and is what this spec pins.
describe('§5.6 slice 3: ComposeMessage confirms the encrypted MESSAGE', () => {
    const ENCRYPTED_PARAMS = Object.freeze({
        VERSION: '2',
        COIN: 'BTC',
        // `devmock` addresses are the validator's sanctioned test placeholder
        // (sdk/devMockAddresses.isDevMockAddress), so this exercises the real
        // MESSAGE any-network recipient rule without pinning a live address.
        // The tail must be the real generated shape (lowercase hex);
        // the validator no longer takes any string mentioning "devmock".
        DESTINATION: 'bc1qdevmock02aabbcc',
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
            fireEvent.click(utils.getByRole('button', { name: 'Send Message' }));
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

// A migrated form's Approve failure is the LAST place wire wording can still
// reach a user: the confirm page unmounts on a terminal error ('error' is not
// an open phase), so what shows is the form's own catch. Several migrated
// forms mapped nothing there and printed the encoder's developer string.
// nativeFeeConfirmPathMessage.test.js could not see them: its roster is the
// forms that mount NativeFeeToggle, and these do not mount it.
describe('A migrated form maps its Approve failure through the one helper', () => {
    // The boundary shape a form actually catches: MessageHost.serializeError
    // keeps only { name, message }, so `code` is gone by the time it lands.
    function encoderRefusalAcrossBoundary() {
        const err = new Error('no spendable UTXOs found for the funding address');
        err.name = 'SDKEncoderError';
        return err;
    }

    it('StakeForm shows the encoder sentence, not the encoder wire wording', async () => {
        const { utils } = await driveThroughConfirm({
            Form: StakeForm,
            props: {
                messagingOverrides: {
                    stakeAction: () => Promise.reject(encoderRefusalAcrossBoundary()),
                },
            },
            actionLabel: 'Stake',
            fill: (u) => {
                setValue(u, /^Amount/, '25');
                setValue(u, 'Signing public key', 'a'.repeat(64));
            },
        });
        const text = utils.container.textContent || '';
        expect(text).toContain('needs BTC for the protocol fee');
        expect(text, 'the encoder developer string never reaches the screen')
            .not.toContain('no spendable UTXOs');
    });

    it('CreatePollForm shows the encoder sentence, not the encoder wire wording', async () => {
        const { utils } = await driveThroughConfirm({
            Form: CreatePollForm,
            props: {
                presetTick: 'JDOG',
                messagingOverrides: {
                    createPollAction: () => Promise.reject(encoderRefusalAcrossBoundary()),
                },
            },
            actionLabel: 'Create Poll',
            fill: (u) => {
                setValue(u, 'Question', 'Which option wins?');
                setValue(u, 'Closes at block', '900000');
                setValue(u, 'Option 1', 'Yes');
                setValue(u, 'Option 2', 'No');
            },
        });
        const text = utils.container.textContent || '';
        expect(text).toContain('needs BTC for the protocol fee');
        expect(text, 'the encoder developer string never reaches the screen')
            .not.toContain('no spendable UTXOs');
    });
});

const PROTOCOL_FAILURE_FORMS = [
    {
        name: 'issue',
        Form: IssueTokenForm,
        props: {},
        actionLabel: 'Issue Token',
        composeMethod: 'composeForConfirm',
        submitMethod: 'issueToken',
        fill: (u) => {
            setValue(u, 'Ticker', 'RETRYISSUE');
            fireEvent.change(u.getByRole('textbox', { name: 'Max supply' }), { target: { value: '1000' } });
        },
        expectValues: (u) => {
            expect(u.getByLabelText('Ticker').value).toBe('RETRYISSUE');
            // The typed value survives the failure. A new token starts divisible (8
            // places), so it reads padded once the field has blurred.
            expect(u.getByRole('textbox', { name: 'Max supply' }).value).toMatch(/^1,000(?:\.0{8})?$/);
        },
    },
    {
        name: 'dispenser',
        Form: DispenserForm,
        props: { initialChainId: CHAIN, initialTick: 'JDOG' },
        actionLabel: 'Create Dispenser',
        composeMethod: 'composeForConfirm',
        submitMethod: 'dispenserAction',
        fill: (u) => {
            setValue(u, /^Give amount/, '10');
            setValue(u, /^Escrow amount/, '100');
            setValue(u, /^Trigger price/, '0.001');
        },
        expectValues: (u) => {
            expect(u.getByLabelText(/^Give amount/).value).toBe('10');
            expect(u.getByLabelText(/^Escrow amount/).value).toBe('100');
            expect(u.getByLabelText(/^Trigger price/).value).toBe('0.001');
        },
    },
    {
        name: 'order',
        Form: CreateOrderForm,
        props: { initialChainId: CHAIN },
        actionLabel: 'Place Order',
        composeMethod: 'composeForConfirm',
        submitMethod: 'orderAction',
        // The give token is picked from the Give asset picker page.
        steps: [openTokenField('Give asset'), pickToken('JDOG')],
        fill: (u) => {
            setValue(u, /^Give amount/, '5');
            setValue(u, /^Get amount/, '0.01');
        },
        expectValues: (u) => {
            expect(u.getByRole('button', { name: /^Give asset: JDOG/ })).toBeTruthy();
            expect(u.getByLabelText(/^Give amount/).value).toBe('5');
            // Shown as typed while editing, padded to 8 decimals once not (U61).
            expect(u.getByLabelText(/^Get amount/).value).toMatch(/^0\.01(000000)?$/);
        },
    },
    {
        name: 'bet',
        Form: CreateBetFeedForm,
        props: { presetTick: 'JDOG' },
        actionLabel: 'Open Market',
        composeMethod: 'composeBetForConfirm',
        submitMethod: 'createMarketAction',
        // The Quick view names the deadline "Closes"; outcomes are numbered from 1.
        fill: (u) => {
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
            setValue(u, 'Question', 'Will retry work?');
            setValue(u, 'Outcome 1', 'Yes');
            setValue(u, 'Outcome 2', 'No');
            setValue(u, 'Closes', tomorrow);
        },
        expectValues: (u) => {
            expect(u.getByLabelText('Question').value).toBe('Will retry work?');
            expect(u.getByLabelText('Outcome 1').value).toBe('Yes');
            expect(u.getByLabelText('Outcome 2').value).toBe('No');
            expect(u.getByLabelText('Closes').value).not.toBe('');
        },
    },
    {
        name: 'vote',
        Form: DelegateVoteForm,
        props: { presetTick: 'JDOG' },
        actionLabel: 'Delegate Votes',
        composeMethod: 'composeVoteForConfirm',
        submitMethod: 'delegateVoteAction',
        fill: (u) => {
            setValue(u, 'Delegate to address', VOTE_DELEGATE);
            setValue(u, 'Memo', 'keep my vote');
        },
        expectValues: (u) => {
            expect(u.getByLabelText('Delegate to address').value).toBe(VOTE_DELEGATE);
            expect(u.getByLabelText('Memo').value).toBe('keep my vote');
        },
    },
    {
        name: 'stake',
        Form: StakeForm,
        props: {},
        actionLabel: 'Stake',
        composeMethod: 'composeForConfirm',
        submitMethod: 'stakeAction',
        fill: (u) => {
            setValue(u, /^Amount/, '25');
            setValue(u, 'Signing public key', 'a'.repeat(64));
        },
        expectValues: (u) => {
            expect(u.getByLabelText(/^Amount/).value).toBe('25');
            expect(u.getByLabelText('Signing public key').value).toBe('a'.repeat(64));
        },
    },
];

const SUBMIT_FAILURES = [
    {
        name: 'insufficient network fee',
        makeError: () => new Error('broadcast failed (commit): Encoder RPC error: insufficient fee'),
        shown: 'The network rejected this transaction because its fee is too low.',
        hidden: 'broadcast failed',
    },
    {
        name: 'network error',
        makeError: () => new Error('Failed to fetch'),
        shown: /The network is unreachable\. Check your connection and try again\./,
        hidden: 'Failed to fetch',
    },
    {
        name: 'signer cancellation',
        makeError: () => new Error('User cancelled signing on the device.'),
        shown: 'Signing was cancelled. Nothing was signed. Review the details and try again when you are ready.',
        hidden: 'User cancelled signing on the device.',
    },
];

function expectFailureBesideAction(utils, spec, shown, hidden) {
    const message = utils.getByText(shown);
    const action = utils.getByRole('button', { name: spec.actionLabel });
    // The failure shows in the form's one status slot, just above the action,
    // never a box inside a section or another form's. A Form Standard form on
    // the form error standard (Issue, Dispenser: `form.fail`) lists it in its
    // one error notice at the top of the page instead (G23 as revised by the
    // Notice Standard, G120).
    const errorNotice = message.closest('[data-form-errors]');
    if (errorNotice) {
        expect(errorNotice).toHaveAttribute('data-tone', 'danger');
    } else {
        expect(action.closest('form').querySelector('[data-form-status]')).toContainElement(message);
    }
    expect(utils.container.textContent || '').not.toContain(hidden);
    spec.expectValues(utils);
}

describe.each(PROTOCOL_FAILURE_FORMS)('$name form submit failures', (spec) => {
    it('shows a boundary-crossed protocol refusal and can compose again', async () => {
        const reason = 'This token symbol is already registered.';
        const refusal = Object.assign(new Error(`Encoder RPC error: ${reason}`), {
            name: 'SDKEncoderError',
        });
        const compose = vi.fn()
            .mockRejectedValueOnce(refusal)
            .mockResolvedValue({ ...COMPOSED });
        const { utils } = await mountFilledForm({
            Form: spec.Form,
            props: {
                ...spec.props,
                messagingOverrides: { [spec.composeMethod]: compose },
            },
            steps: spec.steps,
            fill: spec.fill,
        });

        await clickAction(utils, spec.actionLabel);
        expectFailureBesideAction(utils, spec, reason, 'Encoder RPC error');

        await clickAction(utils, spec.actionLabel);
        expect(utils.container.querySelector('[data-testid="confirm-facts"]')).toBeTruthy();
        expect(compose).toHaveBeenCalledTimes(2);
        await clickAction(utils, 'Reject');
    });

    it.each(SUBMIT_FAILURES)('shows $name, keeps values, and retries', async (failure) => {
        const submit = vi.fn()
            .mockRejectedValueOnce(failure.makeError())
            .mockResolvedValue({ txid: `retry-${spec.name}` });
        const { utils } = await driveThroughConfirm({
            Form: spec.Form,
            props: {
                ...spec.props,
                messagingOverrides: { [spec.submitMethod]: submit },
            },
            actionLabel: spec.actionLabel,
            steps: spec.steps,
            fill: spec.fill,
        });

        expectFailureBesideAction(utils, spec, failure.shown, failure.hidden);

        await clickAction(utils, spec.actionLabel);
        await approveAction(utils);
        expect(submit).toHaveBeenCalledTimes(2);
        expect(utils.queryByText(failure.shown)).toBe(null);
    });
});
