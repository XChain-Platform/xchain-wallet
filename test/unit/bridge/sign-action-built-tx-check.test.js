// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// bridge.signAction, approved, then built: the built transaction is checked
// against the approval before anything is signed.
//
// Driven through the real registerBridgeHandlers, sendToken / sweepToken,
// submitAction and submitWithSigner. Only the edges are fakes: the vault, the
// approval (which says yes), the wallet unlock (a signer that records what it
// is asked to sign), and the SDK, whose encoder answer each case controls. In
// the in-app confirm flow the encoder's PSBT is tamper-checked before the user
// sees it; on this path the user approves an intent and the PSBT is built
// afterwards, so until the check ran here an encoder answer with another
// destination, amount or extra output went straight to the signer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SIGN_ACTION_ENABLED } from '../../../packages/extension/src/bridge/signActionEnabled.js';

const signer = {
    kind: 'software',
    signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    lock: vi.fn(),
};

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWallet: vi.fn(async () => signer),
}));

const { MessageHost } = await import('../../../packages/extension/src/background/MessageHost.js');
const { registerBridgeHandlers } = await import('../../../packages/extension/src/bridge/handlers.js');

const ORIGIN = 'https://dapp.example';
// BIP173 regtest vectors, so address validation passes on the real path.
const FROM = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TO = 'bcrt1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qzf4jry';
const ATTACKER = 'bcrt1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw';

const descriptor = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    networkKind: 'regtest',
    nativeTick: 'BTC',
    addressTypes: ['p2wpkh'],
};
const chainRegistry = {
    get: (id) => (id === descriptor.id ? descriptor : null),
    descriptorFor: (id) => (id === descriptor.id ? descriptor : null),
    supportedChains: () => [descriptor],
};

function fakeVault(settings = { activeNetwork: 'regtest', blockedOrigins: [] }) {
    const site = {
        id: 'site-1',
        origin: ORIGIN,
        permissions: { chains: [descriptor.id], accounts: [], canSignAction: {}, canSignMessage: false },
    };
    const pending = new Map();
    return {
        settings: { get: async () => settings, put: async () => {} },
        connectedSites: {
            findBy: async (field, value) => [site].filter((s) => s[field] === value),
            put: async () => site,
            update: async (id, decide) => decide(site.id === id ? site : null) != null,
        },
        wallets: { list: async () => [{ id: 'wallet-1' }], get: async () => ({ id: 'wallet-1' }) },
        accounts: { list: async () => [], get: async () => ({ id: 'acct-1', walletId: 'wallet-1' }) },
        addresses: {
            list: async () => [{
                id: 'addr-1',
                accountId: 'acct-1',
                chain: 'bitcoin',
                network: 'regtest',
                address: FROM,
                publicKey: `02${'aa'.repeat(32)}`,
                derivationPath: "m/84'/1'/0'/0/0",
            }],
        },
        pendingTxs: {
            put: async (r) => { pending.set(r.id, r); },
            get: async (id) => pending.get(id) ?? null,
            list: async () => [...pending.values()],
            findBy: async () => [],
        },
    };
}

const OPRETURN = { address: null, scriptPubKeyHex: '6a0b53454e44', scriptType: 'unknown', value: 0 };
const CHANGE = { address: FROM, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
const pay = (address, value) => ({ address, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value });

/** An SDK whose encoder returns `outputs`, and whose decoder reads back `decoded` (or the real string). */
function fakeSdkRegistry({ outputs, decoded }) {
    let built = null;
    const sdk = {
        config: { network: 'regtest' },
        encoder: {
            createTx: vi.fn(async (opts) => { built = opts; return { psbt: 'BUILT', encoding: 'OP_RETURN' }; }),
            broadcastTx: vi.fn(async () => ({ txid: 'txid-BUILT' })),
        },
        actions: {
            createAction: (actionData) => ({
                actionString: `${actionData.action}|${JSON.stringify(actionData.params)}`,
                action: actionData.action,
                version: 0,
            }),
        },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs }) },
        decoder: {
            decodeActionStringFromPsbt: () => ({ ok: true, actionString: decoded ?? built?.data }),
        },
        getAddress: async () => ({ balances: { confirmed: '1.5' } }),
        getBalances: async () => ({ data: [{ tick: 'JDOG', quantity: '900000', decimals: 0 }] }),
        getGatedKeys: async () => [],
        getTokenInfo: async () => null,
    };
    return { sdk, sdkRegistry: { get: () => sdk } };
}

function signAction({ action, params, sdkRegistry, settings, approvals, vault }) {
    const approvalSource = approvals ?? {
        signAction: async () => ({ approved: true, password: 'pw', walletId: 'wallet-1' }),
    };
    const host = new MessageHost({ vault: vault ?? fakeVault(settings), chainRegistry, sdkRegistry });
    registerBridgeHandlers(host, { approvals: approvalSource });
    return host.handle({
        type: 'bridge.signAction',
        request: { origin: ORIGIN, chainId: descriptor.id, action, params },
    });
}

const resultOf = (resp) => (resp && 'result' in resp ? resp.result : resp);

beforeEach(() => {
    signer.signPsbt.mockClear();
});

describe('bridge.signAction checks the built transaction before signing', () => {
    it('refuses an inactive network before prompting or signing', async () => {
        const approvals = { signAction: vi.fn() };
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [pay(TO, '10000'), CHANGE] });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
            settings: { activeNetwork: 'mainnet', blockedOrigins: [] },
            approvals,
        });

        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(approvals.signAction).not.toHaveBeenCalled();
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('refuses when the network changes during approval', async () => {
        const settings = { activeNetwork: 'regtest', blockedOrigins: [] };
        const approvals = {
            signAction: vi.fn(async () => {
                settings.activeNetwork = 'mainnet';
                return { approved: true, password: 'pw', walletId: 'wallet-1' };
            }),
        };
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [pay(TO, '10000'), CHANGE] });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
            settings,
            approvals,
        });

        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('rechecks the network after signing and before broadcast', async () => {
        const settings = { activeNetwork: 'regtest', blockedOrigins: [] };
        const { sdk, sdkRegistry } = fakeSdkRegistry({ outputs: [pay(TO, '10000'), CHANGE] });
        signer.signPsbt.mockImplementationOnce(async ({ psbtHex }) => {
            settings.activeNetwork = 'mainnet';
            return { txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` };
        });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
            settings,
        });

        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(signer.signPsbt).toHaveBeenCalledOnce();
        expect(sdk.encoder.broadcastTx).not.toHaveBeenCalled();
    });

    it('rechecks the network before a SWEEP broadcast and fails its pending row', async () => {
        const settings = { activeNetwork: 'regtest', blockedOrigins: [] };
        const vault = fakeVault(settings);
        const { sdk, sdkRegistry } = fakeSdkRegistry({ outputs: [OPRETURN, CHANGE] });
        signer.signPsbt.mockImplementationOnce(async ({ psbtHex }) => {
            settings.activeNetwork = 'mainnet';
            return { txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` };
        });
        const resp = await signAction({
            action: 'SWEEP',
            params: { fromAddress: FROM, toAddress: TO },
            sdkRegistry,
            vault,
        });

        expect(resp.ok).toBe(false);
        expect(resp.error.message).toMatch(/CHAIN_NOT_PERMITTED/);
        expect(signer.signPsbt).toHaveBeenCalledOnce();
        expect(sdk.encoder.broadcastTx).not.toHaveBeenCalled();
        const rows = await vault.pendingTxs.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('failed');
    });

    it('answers an unsupported action with UNSUPPORTED_ACTION on an inactive network', async () => {
        const approvals = { signAction: vi.fn() };
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [OPRETURN, CHANGE] });
        const resp = await signAction({
            action: 'STAKE',
            params: { fromAddress: FROM },
            sdkRegistry,
            settings: { activeNetwork: 'mainnet', blockedOrigins: [] },
            approvals,
        });

        expect(resultOf(resp)).toMatchObject({ ok: false, error: 'UNSUPPORTED_ACTION' });
        expect(resultOf(resp).supportedActions).toEqual(SIGN_ACTION_ENABLED.slice());
        expect(approvals.signAction).not.toHaveBeenCalled();
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('signs an honest native SEND, exactly the bytes the encoder returned', async () => {
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [pay(TO, '10000'), CHANGE] });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
        });
        expect(resultOf(resp)).toMatchObject({ ok: true });
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
    });

    it('refuses a native SEND whose payment goes to another address, with no signature', async () => {
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [pay(ATTACKER, '10000'), CHANGE] });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
        });
        const r = resultOf(resp) ?? {};
        const message = r.message ?? resp?.error?.message ?? '';
        expect(r.ok ?? resp.ok).toBe(false);
        expect(message).toMatch(/did not approve/);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('refuses a native SEND whose amount was changed', async () => {
        const { sdkRegistry } = fakeSdkRegistry({ outputs: [pay(TO, '1000000'), CHANGE] });
        const resp = await signAction({
            action: 'SEND',
            params: { fromAddress: FROM, toAddress: TO, asset: 'BTC', amountRaw: '10000' },
            sdkRegistry,
        });
        expect((resultOf(resp) ?? resp).ok).toBe(false);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('signs an honest token SEND and refuses one with an extra output', async () => {
        const params = { fromAddress: FROM, toAddress: TO, asset: 'JDOG', amount: '5' };
        const honest = fakeSdkRegistry({ outputs: [OPRETURN, CHANGE] });
        expect(resultOf(await signAction({ action: 'SEND', params, sdkRegistry: honest.sdkRegistry })))
            .toMatchObject({ ok: true });
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);

        signer.signPsbt.mockClear();
        const tampered = fakeSdkRegistry({ outputs: [OPRETURN, pay(ATTACKER, 50000), CHANGE] });
        const resp = await signAction({ action: 'SEND', params, sdkRegistry: tampered.sdkRegistry });
        expect((resultOf(resp) ?? resp).ok).toBe(false);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });

    it('signs an honest SWEEP and refuses one whose action bytes name another destination', async () => {
        const params = { fromAddress: FROM, toAddress: TO };
        const honest = fakeSdkRegistry({ outputs: [OPRETURN, CHANGE] });
        expect(resultOf(await signAction({ action: 'SWEEP', params, sdkRegistry: honest.sdkRegistry })))
            .toMatchObject({ ok: true });
        expect(signer.signPsbt).toHaveBeenCalledTimes(1);

        signer.signPsbt.mockClear();
        const tampered = fakeSdkRegistry({ outputs: [OPRETURN, CHANGE], decoded: `SWEEP|${ATTACKER}` });
        const resp = await signAction({ action: 'SWEEP', params, sdkRegistry: tampered.sdkRegistry });
        const r = resultOf(resp) ?? resp;
        expect(r.ok).toBe(false);
        expect(r.message ?? resp?.error?.message).toMatch(/does not match what you approved/);
        expect(signer.signPsbt).not.toHaveBeenCalled();
    });
});
