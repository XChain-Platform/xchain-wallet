// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createRequire } from 'node:module';

import { expect, test } from '@playwright/test';
import xchainSdk from 'xchain-sdk';
import { InMemoryBackend } from '../../../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../../../packages/core/src/storage/Vault.js';
import { deriveMasterKey, makeFreshKdfParams } from '../../../../../packages/core/src/crypto/kdf.js';
import { defaultRegistry } from '../../../../../packages/core/src/registry/index.js';
import { SDKRegistry } from '../../../../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../../../../packages/core/src/sdk/defaultFactory.js';
import { persistHdWallet } from '../../../../../packages/core/src/flows/_persistHdWallet.js';
import { createConnectedSite } from '../../../../../packages/core/src/schemas/connectedSite.js';
import {
    AUTHORABLE_ACTIONS,
    CHAIN_GATED_ACTIONS,
} from '../../../../../packages/core/src/registry/actions.js';
import { donationAddressForDescriptor } from '../../../../../packages/core/src/registry/validate.js';
import { ADS_RECIPIENT_ROLE, adsReservationOf } from '../../../../../packages/core/src/flows/ads.js';
import { MessageHost } from '../../../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../../../packages/extension/src/bridge/handlers.js';
import {
    SIGN_ACTION_ENABLED,
    SIGN_ACTION_REFUSED,
} from '../../../../../packages/extension/src/bridge/signActionEnabled.js';
import {
    MATRIX_STAGES,
    cutSignActionLists,
} from '../../../fixtures/signActionMatrix.js';
import { generateBip39Mnemonic } from '../../../../../packages/core/src/crypto/mnemonic.js';
import { SoftwareSigner } from '../../../../../packages/core/src/signers/SoftwareSigner.js';
import { createSignThrottle } from '../../../../../packages/core/src/flows/signThrottle.js';
import { encoderRpc, minerRpc, waitForConfirmedUtxo } from '../../../fixtures/regtest.js';

const requireFromWeb = createRequire(
    new URL('../../../../../packages/web/package.json', import.meta.url),
);
const bitcoin = requireFromWeb('bitcoinjs-lib');

const CHAIN_ID = 'bitcoin-regtest';
const ORIGIN = 'https://matrix.example';
const WALLET_PASSWORD = 'matrix-wallet-password';
const STEP_BUDGET_MS = 90_000;
const TAMPER_REFUSAL = /did not approve|does not match what you approved/i;
const COIN_SIZE_BTC = 0.05;
const COINS_PER_ACTION = 3;

const sdk = new xchainSdk.XChainSDK({ network: CHAIN_ID, preflight: false });
const attackerKey = sdk.wallet.generateKeyPair();
const attackerAddress = sdk.wallet.deriveAddress(attackerKey.publicKey, { type: 'p2wpkh' });
const validatorPublicKey = '11'.repeat(32);

function actionParams(sourceAddress) {
    return Object.freeze({
        ADDRESS: {},
        AIRDROP: { TICK: 'XCHAIN', AMOUNT: '1', LIST_ACTION_INDEX: '1' },
        BATCH: { COMMAND: `SEND|0|XCHAIN|1|${sourceAddress}` },
        BET: { VERSION: 1, FEED_ACTION_INDEX: '1' },
        BROADCAST: { MESSAGE: 'matrix' },
        CALLBACK: { TICK: 'XCHAIN' },
        COINPAY: { ORDER_MATCH_ACTION_INDEX: '1' },
        COLLECT: {},
        DELEGATE: { VERSION: 0, NEW_SIGNING_PUBKEY: validatorPublicKey },
        DEPLOY: { CODE_ENCODING: Buffer.from('return 1').toString('base64'), GAS_LIMIT: '1000' },
        DEPOSIT: { CONTRACT_ACTION_INDEX: '1', TICK: 'XCHAIN', QUANTITY: '1' },
        DESTROY: { TICK: 'XCHAIN', AMOUNT: '1' },
        DISPENSER: { VERSION: 1, DISPENSER_ACTION_INDEX: '1' },
        DIVIDEND: { TICK: 'XCHAIN', DIVIDEND_TICK: 'XCHAIN', AMOUNT: '1' },
        EXECUTE: { CONTRACT_ACTION_INDEX: '1', METHOD: 'matrix' },
        FILE: { TYPE: 'text/plain' },
        ISSUE: { TICK: 'MATRIX' },
        LINK: { COIN1: 'BTC', COIN1_ACTION_INDEX: '1', COIN2: 'LTC', COIN2_ACTION_INDEX: '1' },
        LIST: { TYPE: 1, ITEM: ['XCHAIN'] },
        MESSAGE: { VERSION: 3, COIN: 'BTC', DESTINATION: sourceAddress, PLAINTEXT_MESSAGE: 'matrix' },
        MINT: { TICK: 'XCHAIN', AMOUNT: '1', DESTINATION: sourceAddress },
        ORDER: { VERSION: 1, ORDER_ACTION_INDEX: '1' },
        PRICE: { COIN: 'BTC', TICK: 'XCHAIN', FIAT: 'USD', VALUE: '1' },
        SEND: { TICK: 'XCHAIN', AMOUNT: '1', DESTINATION: sourceAddress },
        SLEEP: { RESUME_BLOCK: '999999999' },
        STAKE: { VERSION: 1, AMOUNT: '1', SIGNING_PUBKEY: validatorPublicKey },
        SWAP: { VERSION: 1, SWAP_ACTION_INDEX: '1' },
        SWEEP: { DESTINATION: sourceAddress },
        UNSTAKE: { VERSION: 0, SIGNING_PUBKEY: validatorPublicKey },
        VOTE: { VERSION: 1, POLL_REF: '1', BALLOT: '0' },
        WITHDRAW: { CONTRACT_ACTION_INDEX: '1', TICK: 'XCHAIN', QUANTITY: '1' },
        XBRIDGE: { VERSION: 0, DEST_COIN: 'LTC', DEST_ADDRESS: sourceAddress, AMOUNT: '1' },
    });
}

function addAttackerOutput(psbtHex) {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks.regtest });
    psbt.addOutput({ address: attackerAddress, value: 1000 });
    return psbt.toHex();
}

function builtOutputAddresses(psbtHex) {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks.regtest });
    return psbt.txOutputs.map((output) => {
        try {
            return bitcoin.address.fromOutputScript(output.script, bitcoin.networks.regtest);
        } catch {
            return null;
        }
    });
}

const signerCalls = { count: 0, beforeSign: null };
const realSignPsbt = SoftwareSigner.prototype.signPsbt;
SoftwareSigner.prototype.signPsbt = async function countedSignPsbt(...args) {
    signerCalls.count += 1;
    if (signerCalls.beforeSign) await signerCalls.beforeSign();
    return realSignPsbt.apply(this, args);
};

async function sourceOutpoints(address) {
    const { utxos } = await encoderRpc('get_utxos', { address });
    return (utxos ?? []).map((u) => `${u.txid}:${u.vout ?? u.n}`).sort();
}

function instrumentedRegistry(realRegistry) {
    const state = {
        tamper: false,
        broadcasts: 0,
        built: 0,
        mutated: 0,
        enqueued: 0,
        builtOutputs: [],
    };
    const wrapEncoder = (encoder) => new Proxy(encoder, {
        get(target, prop) {
            const member = Reflect.get(target, prop, target);
            if (prop === 'createTx') {
                return async (...args) => {
                    const built = await member.apply(target, args);
                    state.built += 1;
                    if (!state.tamper) {
                        state.builtOutputs = builtOutputAddresses(built.psbt);
                        return built;
                    }
                    const psbt = addAttackerOutput(built.psbt);
                    state.mutated += 1;
                    return { ...built, psbt };
                };
            }
            if (prop === 'broadcastTx') {
                return async (...args) => {
                    state.broadcasts += 1;
                    return member.apply(target, args);
                };
            }
            return typeof member === 'function' ? member.bind(target) : member;
        },
    });
    const wrapSdk = (real) => new Proxy(real, {
        get(target, prop) {
            if (prop === 'encoder') return wrapEncoder(target.encoder);
            const member = Reflect.get(target, prop, target);
            return typeof member === 'function' ? member.bind(target) : member;
        },
    });
    const registry = new Proxy(realRegistry, {
        get(target, prop) {
            if (prop === 'get') return (chainId) => wrapSdk(target.get(chainId));
            const member = Reflect.get(target, prop, target);
            return typeof member === 'function' ? member.bind(target) : member;
        },
    });
    return { registry, state };
}

async function buildVenue() {
    const kdfParams = makeFreshKdfParams();
    const chainRegistry = defaultRegistry();
    const realRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: adaptXChainSDK(xchainSdk.XChainSDK),
    });
    const masterKey = deriveMasterKey(WALLET_PASSWORD, kdfParams);
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey });
    await vault.open();
    const persisted = await persistHdWallet({
        mnemonic: generateBip39Mnemonic(),
        format: 'bip39',
        origin: 'created',
        passphraseEnabled: false,
        bip39Passphrase: '',
        password: WALLET_PASSWORD,
        name: 'Matrix Wallet',
        accountName: 'Matrix',
        kdfParams,
        vault,
        chainRegistry,
        sdkRegistry: realRegistry,
        activeChainIds: [CHAIN_ID],
        activeNetwork: 'regtest',
    });
    const entry = persisted.addresses.find((row) => row.chainId === CHAIN_ID);
    const source = entry.address;
    await vault.connectedSites.put(createConnectedSite({
        origin: ORIGIN,
        appName: 'Sign action matrix',
        permissions: {
            chains: [CHAIN_ID],
            accounts: [],
            canSignMessage: false,
            canSignAction: {},
        },
    }));
    const { registry, state } = instrumentedRegistry(realRegistry);
    const approvals = {
        signAction: async () => {
            return {
            approved: true,
            password: WALLET_PASSWORD,
            walletId: persisted.wallet.id,
            };
        },
        signPsbt: async () => ({ approved: false }),
    };
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: registry });
    const register = host.register.bind(host);
    host.register = (type, handler) => register(type, async (req, deps) => {
        try {
            return await handler(req, deps);
        } catch (caught) {
            if (type === 'bridge.signAction') state.lastThrown = caught;
            throw caught;
        }
    });
    registerBridgeHandlers(host, {
        approvals,
        signThrottle: createSignThrottle({ burst: AUTHORABLE_ACTIONS.length * 4 }),
        enqueueOnBroadcastFailure: () => () => { state.enqueued += 1; },
    });
    return { vault, chainRegistry, host, state, source, walletId: persisted.wallet.id };
}

function bridgeSignAction(venue, action, params) {
    return venue.host.handle({
        type: 'bridge.signAction',
        request: {
            origin: ORIGIN,
            chainId: CHAIN_ID,
            from: venue.source.address,
            action,
            params,
        },
    });
}

// Every build reserves the inputs it selects for five minutes, refused builds
// included, so each build in the matrix needs its own confirmed coin.
async function fundSeparateCoins(address, count) {
    for (let i = 0; i < count; i += 1) {
        await minerRpc('send_funds', { address, amount: COIN_SIZE_BTC });
    }
    await minerRpc('generate_blocks', { count: 1 });
    const deadline = Date.now() + STEP_BUDGET_MS;
    while (Date.now() < deadline) {
        const { utxos } = await encoderRpc('get_utxos', { address });
        if ((utxos ?? []).length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`${count} regtest coins never appeared at ${address}`);
}

async function settleOnChain(venue, txid) {
    try {
        await waitForConfirmedUtxo(venue.source.address, txid, STEP_BUDGET_MS);
        return null;
    } catch (firstError) {
        await minerRpc('generate_blocks', { count: 1 });
        try {
            await waitForConfirmedUtxo(venue.source.address, txid, STEP_BUDGET_MS);
            return null;
        } catch {
            return firstError.message;
        }
    }
}

function failureReason(response) {
    if (typeof response?.result?.error === 'string') {
        return `${response.result.error}: ${response.result.message ?? ''}`.trim();
    }
    const error = response?.error;
    if (!error) return 'no result';
    return `${error.code ?? error.name ?? 'error'}: ${error.message ?? ''}`.trim();
}

async function probeAction(venue, action, params) {
    const stages = Object.fromEntries(MATRIX_STAGES.map((stage) => [stage, false]));
    const notes = {};
    const validation = sdk.actions.validateAction(action, params);
    expect(validation.valid, `${action} validation: ${JSON.stringify(validation.errors)}`).toBe(true);
    const composed = sdk.actions.composeActionString({ action, params });
    expect(composed.action).toBe(action);
    expect(composed.actionString).toMatch(new RegExp(`^${action}\\|`));
    stages.compose = true;

    const description = sdk.decoder.describe({
        action,
        version: composed.version,
        params: composed.fields,
    }, { chainId: CHAIN_ID, chainRegistry: venue.chainRegistry });
    expect(description?.summary, `${action} description`).toEqual(expect.any(String));
    expect(description.summary.trim(), `${action} description`).not.toBe('');
    stages.describe = true;

    const pendingBefore = new Set((await venue.vault.pendingTxs.list()).map((row) => row.id));
    venue.state.tamper = true;
    venue.state.broadcasts = 0;
    venue.state.built = 0;
    venue.state.mutated = 0;
    const hostile = await bridgeSignAction(venue, action, params);
    venue.state.tamper = false;
    const pendingAfterHostile = (await venue.vault.pendingTxs.list()).length;
    const refusedAsTamper = hostile.error !== undefined
        && TAMPER_REFUSAL.test(String(hostile.error.message ?? ''));
    if (venue.state.mutated > 0 && refusedAsTamper && venue.state.broadcasts === 0) {
        stages.tamper = true;
    } else {
        notes.tamper = venue.state.mutated === 0
            ? `build never reached: ${failureReason(hostile)}`
            : `tampered build was not refused as tampering: ${failureReason(hostile)}`;
    }

    venue.state.broadcasts = 0;
    const honest = await bridgeSignAction(venue, action, params);
    const txid = honest.result?.txid;
    const pendingRows = await venue.vault.pendingTxs.list();
    const tracked = typeof txid === 'string' && pendingRows.some((row) => row.txid === txid);
    const donationAddresses = Object.values(ADS_RECIPIENT_ROLE)
        .map((role) => donationAddressForDescriptor(venue.chainRegistry.get(CHAIN_ID), role))
        .filter(Boolean);
    const paysDonation = venue.state.builtOutputs.some((address) => donationAddresses.includes(address));
    const adsSettings = await venue.vault.settings.get();
    if (
        honest.result?.ok === true
        && typeof txid === 'string'
        && venue.state.broadcasts >= 1
        && venue.state.enqueued === 0
        && pendingRows.length > pendingAfterHostile
        && tracked
        && venue.state.builtOutputs.length > 0
        && !paysDonation
        && !adsReservationOf(adsSettings)
    ) {
        const unconfirmed = await settleOnChain(venue, txid);
        if (unconfirmed === null) {
            stages.submit = true;
        } else {
            notes.submit = `broadcast but never confirmed: ${unconfirmed}`;
        }
    } else {
        notes.submit = tracked || honest.result?.ok !== true
            ? failureReason(honest)
            : `no pending record for ${txid}`;
        if (paysDonation) notes.submit = 'build carried an ads payout output';
    }

    return Object.freeze({ action, stages: Object.freeze(stages), notes: Object.freeze(notes) });
}

async function probeNetworkSwitch(venue, params) {
    const settingsBefore = await venue.vault.settings.get();
    const pendingBefore = new Set((await venue.vault.pendingTxs.list()).map((row) => row.id));
    const outpointsBefore = await sourceOutpoints(venue.source.address);
    venue.state.broadcasts = 0;
    venue.state.enqueued = 0;
    venue.state.lastThrown = null;
    const signsBefore = signerCalls.count;
    signerCalls.beforeSign = async () => {
        const stored = await venue.vault.settings.get();
        await venue.vault.settings.put({ ...stored, activeNetwork: 'mainnet' });
    };
    let response;
    try {
        response = await bridgeSignAction(venue, 'SEND', params);
    } finally {
        signerCalls.beforeSign = null;
        await venue.vault.settings.put(settingsBefore);
    }
    const created = (await venue.vault.pendingTxs.list()).filter((row) => !pendingBefore.has(row.id));
    const signs = signerCalls.count - signsBefore;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const outpointsAfter = await sourceOutpoints(venue.source.address);
    return Object.freeze({
        signs,
        signerObserved: signs > 0,
        chainUnchanged: JSON.stringify(outpointsBefore) === JSON.stringify(outpointsAfter),
        refusal: failureReason(response),
        ok: response.result?.ok === true,
        broadcasts: venue.state.broadcasts,
        pendingStatuses: created.map((row) => row.status),
        pendingIds: created.map((row) => row.id),
        pendingTxids: created.map((row) => row.txid ?? null),
        errorPendingTxId: venue.state.lastThrown?.pendingTxId ?? null,
    });
}

export async function runSignActionMatrix(onResult = () => {}) {
    const venue = await buildVenue();
    await fundSeparateCoins(venue.source.address, AUTHORABLE_ACTIONS.length * COINS_PER_ACTION);
    const paramsByAction = actionParams(venue.source.address);
    const matrix = [];
    for (const action of AUTHORABLE_ACTIONS) {
        const result = await probeAction(venue, action, paramsByAction[action]);
        onResult(result);
        matrix.push(result);
    }
    matrix.networkSwitch = await probeNetworkSwitch(venue, paramsByAction.SEND);
    return matrix;
}

const registerTests = process.env.XCHAIN_MATRIX_PROBE_ONLY !== '1';

if (registerTests) test.describe('site request signAction regtest matrix', () => {
    let matrix;

    test.beforeAll(async () => {
        test.setTimeout(AUTHORABLE_ACTIONS.length * 4 * STEP_BUDGET_MS);
        matrix = await runSignActionMatrix();
    });

    test('runs every registry action through every generic-branch stage', () => {
        expect(matrix.map(({ action }) => action)).toEqual(AUTHORABLE_ACTIONS);
        for (const result of matrix) {
            if (CHAIN_GATED_ACTIONS.includes(result.action)) continue;
            if (!(result.action in SIGN_ACTION_REFUSED)) {
                expect(result.stages, `${result.action} ${JSON.stringify(result.notes)}`).toEqual({
                    compose: true,
                    describe: true,
                    tamper: true,
                    submit: true,
                });
            }
        }
    });

    test('refuses with CHAIN_NOT_PERMITTED when the active network changes before broadcast', () => {
        const outcome = matrix.networkSwitch;
        expect(outcome.refusal).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(outcome.ok).toBe(false);
        expect(outcome.signerObserved).toBe(true);
        expect(outcome.signs).toBe(1);
        expect(outcome.broadcasts).toBe(0);
        expect(outcome.chainUnchanged).toBe(true);
        expect(outcome.pendingStatuses).toEqual(['failed']);
        expect(outcome.errorPendingTxId).toEqual(expect.any(String));
        expect(outcome.pendingIds).toEqual([outcome.errorPendingTxId]);
        expect(outcome.pendingTxids).toEqual([null]);
    });

    test('cuts the committed enabled and refused lists from the matrix', () => {
        const lists = cutSignActionLists(matrix, {
            authorable: AUTHORABLE_ACTIONS,
            gated: CHAIN_GATED_ACTIONS,
        });

        expect(lists.enabled).toEqual(SIGN_ACTION_ENABLED);
        expect(Object.keys(lists.refused)).toEqual(Object.keys(SIGN_ACTION_REFUSED).sort());
    });

    test('keeps chain-dependent actions refused after a passing Bitcoin run', () => {
        for (const action of CHAIN_GATED_ACTIONS) {
            const result = matrix.find((row) => row.action === action);
            expect(result.stages.submit, `${action} must not submit on Bitcoin`).toBe(false);
            expect(result.notes.submit, `${action} refusal`).toEqual(expect.any(String));
            expect(SIGN_ACTION_REFUSED[action], action).toBe('chain-gated');
            expect(SIGN_ACTION_ENABLED, action).not.toContain(action);
        }
    });
});
