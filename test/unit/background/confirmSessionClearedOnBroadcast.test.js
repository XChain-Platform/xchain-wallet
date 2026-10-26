// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A popup that closes between Approve and the end of the send never clears
// its stored confirm. The host drops the stored confirm for the PSBT it has
// just broadcast, so Home does not offer to finish a payment that has already
// left the wallet. LIST and AIRDROP are resumable too, so they get the same
// drop. The flows are stubbed: the scenario is about the store.

import { afterEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
    sendToken: vi.fn(),
    createList: vi.fn(),
    airdropAction: vi.fn(),
}));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: {
            ...actual.flows,
            sendToken: (...args) => stubs.sendToken(...args),
            createList: (...args) => stubs.createList(...args),
            airdropAction: (...args) => stubs.airdropAction(...args),
        },
    };
});

const CHAIN = 'bitcoin-regtest';
const W = 'w1';

function stubChromeSessionStorage() {
    const area = {};
    vi.stubGlobal('chrome', {
        storage: {
            session: {
                get: (key, cb) => cb({ [key]: area[key] === undefined ? undefined : JSON.parse(JSON.stringify(area[key])) }),
                set: (items, cb) => { Object.assign(area, JSON.parse(JSON.stringify(items))); cb?.(); },
            },
        },
    });
}

async function makeHost(activeNetwork = { current: 'regtest' }) {
    stubChromeSessionStorage();
    const { createBackgroundHost } = await import(
        '../../../packages/extension/src/background/createBackgroundHost.js'
    );
    const sdk = { encoder: { broadcastTx: vi.fn(async () => 'tx-A') } };
    const host = createBackgroundHost({
        vault: {
            wallets: { list: async () => [{ id: W }] },
            settings: { get: async () => ({ schemaVersion: 2, activeNetwork: activeNetwork.current, ads: { enabled: false, perChain: {} } }) },
        },
        chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }), list: () => [] },
        sdkRegistry: { get: () => sdk, for: () => sdk },
        signerPool: { get: () => null, has: () => false },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
    return (type, request) => host.handle({ type, request });
}

const putSession = (call, id, psbt) => call('action.confirmSession.put', {
    id, request: {}, composed: { psbt }, report: null, dispatch: { software: 'sendToken' }, createdAt: Date.now(),
});
const storedIds = async (call) => (await call('action.confirmSession.list')).result.sessions.map((s) => s.id);

describe('a stored confirm is dropped when its PSBT is broadcast', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        stubs.sendToken.mockReset();
        stubs.createList.mockReset();
        stubs.airdropAction.mockReset();
    });

    it.each([
        ['action.createList', 'createList'],
        ['action.airdrop', 'airdropAction'],
    ])('removes the session for a PSBT that %s broadcast', async (type, flow) => {
        const call = await makeHost();
        await putSession(call, 'cs:sent', 'psbt-sent');
        await putSession(call, 'cs:other', 'psbt-other');
        stubs[flow].mockResolvedValueOnce({ txid: 'tx-A' });

        const res = await call(type, { walletId: W, chainId: CHAIN, prebuiltPsbt: { psbtHex: 'psbt-sent' } });

        expect(res.ok).toBe(true);
        expect(await storedIds(call)).toEqual(['cs:other']);
    });

    it('removes the session for the broadcast PSBT and keeps the others', async () => {
        const call = await makeHost();
        await putSession(call, 'cs:sent', 'psbt-sent');
        await putSession(call, 'cs:other', 'psbt-other');
        stubs.sendToken.mockResolvedValueOnce({ txid: 'tx-A' });

        const res = await call('action.send', { walletId: W, chainId: CHAIN, prebuiltPsbt: { psbtHex: 'psbt-sent' } });

        expect(res.ok).toBe(true);
        expect(await storedIds(call)).toEqual(['cs:other']);
    });

    // A LIST or AIRDROP confirm composed on one network, stored or open in a
    // second window, must not sign after the wallet switches network, the
    // same rule Send follows.
    it.each([
        ['action.createList', 'createList'],
        ['action.airdrop', 'airdropAction'],
    ])('refuses %s after the active network changes', async (type, flow) => {
        const activeNetwork = { current: 'regtest' };
        const call = await makeHost(activeNetwork);
        await putSession(call, 'cs:sent', 'psbt-sent');
        activeNetwork.current = 'testnet';
        stubs[flow].mockResolvedValue({ txid: 'must-not-send' });

        const res = await call(type, { walletId: W, chainId: CHAIN, prebuiltPsbt: { psbtHex: 'psbt-sent' } });

        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/active network changed to testnet/i);
        expect(stubs[flow]).not.toHaveBeenCalled();
        expect(await storedIds(call)).toEqual(['cs:sent']);
    });

    // A queued broadcast already holds the signed bytes and a permanent refusal
    // can never confirm, so neither may stay offered as an unsent action. An
    // unsaved transient failure keeps it: the stored confirm is then the only
    // way back to that transaction.
    it.each([
        ['action.send', 'sendToken', 'BroadcastFailedTransientError', []],
        ['action.send', 'sendToken', 'BroadcastFailedPermanentError', []],
        ['action.send', 'sendToken', 'BroadcastFailedTransientUnsavedError', ['cs:sent']],
        ['action.createList', 'createList', 'BroadcastFailedTransientError', []],
        ['action.airdrop', 'airdropAction', 'BroadcastFailedPermanentError', []],
    ])('%s through %s failing with %s keeps %j', async (type, flow, name, kept) => {
        const call = await makeHost();
        await putSession(call, 'cs:sent', 'psbt-sent');
        const failure = new Error('broadcast refused');
        failure.name = name;
        stubs[flow].mockRejectedValueOnce(failure);

        const res = await call(type, { walletId: W, chainId: CHAIN, prebuiltPsbt: { psbtHex: 'psbt-sent' } });

        expect(res.ok).toBe(false);
        expect(await storedIds(call)).toEqual(kept);
    });

    it('keeps the session when the send fails, so the confirm stays resumable', async () => {
        const call = await makeHost();
        await putSession(call, 'cs:sent', 'psbt-sent');
        stubs.sendToken.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const res = await call('action.send', { walletId: W, chainId: CHAIN, prebuiltPsbt: { psbtHex: 'psbt-sent' } });

        expect(res.ok).toBe(false);
        expect(await storedIds(call)).toEqual(['cs:sent']);
    });
});
