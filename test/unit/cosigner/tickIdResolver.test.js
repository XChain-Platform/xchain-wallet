// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token numbers are read once, when the owner saves an agent account's
// rules, and stored as policy.tickIds. The approval preview and the signing
// decision read only that saved map and never ask an explorer.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    TOKEN_NOT_ALLOWED,
    TOKEN_UNRESOLVED,
} from '../../../packages/core/src/cosigner/allowedTicks.js';
import {
    MAX_TICK_LOOKUPS,
    applyTickLookup,
    lookupTickerIds,
    policyTickNames,
    resolveCoSignerTokenIds,
} from '../../../packages/core/src/cosigner/tickIdResolver.js';
import { declarePolicyTokenIds } from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';
import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import { previewCoSignRequest } from '../../../packages/core/src/flows/previewCoSignRequest.js';
import { updateCoSignerAccount } from '../../../packages/core/src/flows/updateCoSignerAccount.js';
import { createCoSignerAccount, validateCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import { describePolicyReason } from '../../../packages/core/src/shared/components/coSignPolicyReasons.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createRequire } from 'node:module';

const sdkRequire = createRequire(import.meta.url);
const realEvaluatePolicy = sdkRequire('../../../node_modules/xchain-sdk/src/cosigner/policy_evaluator.js').evaluatePolicy;

const LIST = { allowedActions: ['SEND', 'ORDER', 'SWAP'], allowedTicks: ['MYTOKEN', 'XCHAIN'] };
// The SDK evaluator's refusal for an amount above a per-action cap.
const CAP_EXCEEDED = 'POLICY_AMOUNT_EXCEEDED';

// The explorer as findToken answers a ticker: the unwrapped info record, null
// for a ticker it does not know. `tokens` maps ticker -> id (null for a token
// with no stable number); `fail` makes every read throw, `hang` never settles.
function explorerSdk(tokens = {}, { fail = false, hang = false, echoTick } = {}) {
    const reads = [];
    const sdk = {
        async findToken(tick, opts) {
            reads.push({ tick, opts });
            if (hang) return new Promise(() => {});
            if (fail) throw Object.assign(new Error('explorer unreachable'), { code: 'EXPLORER_HTTP_503' });
            if (!Object.prototype.hasOwnProperty.call(tokens, tick)) return null;
            return { tick: echoTick ?? tick, tick_id: tokens[tick] };
        },
    };
    return { sdk, reads };
}

// An SDK whose every token read throws, so any read on a path that must not
// read fails the test loudly through the count.
function noReadSdk() {
    const reads = [];
    const refuse = (tick) => { reads.push(tick); throw new Error('no explorer read is allowed here'); };
    return { sdk: { findToken: refuse, getToken: refuse }, reads };
}

describe('looking up the token numbers a policy names', () => {
    it('names every token the rules name once, without the wildcard or the chain coin', () => {
        const policy = {
            ...LIST,
            maxPerAction: { SEND: { '*': '5', mytoken: '1', OTHER: '2' }, ORDER: { BTC: '1' } },
            maxPerWindow: { hours: 24, perTick: { WIN: '3' } },
            confirmAbove: { perTick: { CONF: '4', MYTOKEN: '9' } },
        };
        expect(policyTickNames(policy, { nativeTick: 'BTC' })).toEqual(['MYTOKEN', 'XCHAIN', 'OTHER', 'WIN', 'CONF']);
        expect(policyTickNames({ allowedActions: ['SEND'] }, { nativeTick: 'BTC' })).toEqual([]);
    });

    it('reads each distinct ticker once, in parallel, and keeps the number it echoes', async () => {
        let inFlight = 0;
        let peak = 0;
        const reads = [];
        const sdk = {
            async findToken(tick, opts) {
                reads.push({ tick, opts });
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 5));
                inFlight -= 1;
                return { tick, tick_id: tick === 'MYTOKEN' ? 1234 : 7 };
            },
        };
        const lookup = await lookupTickerIds(sdk, ['MYTOKEN', 'other', 'MYTOKEN', 'OTHER']);
        expect(reads).toEqual([
            { tick: 'MYTOKEN', opts: { noRetry: true } },
            { tick: 'OTHER', opts: { noRetry: true } },
        ]);
        expect(peak).toBe(2);
        expect(lookup).toEqual({ ids: { MYTOKEN: 1234, OTHER: 7 }, missing: [], failed: [], duplicate: [], noId: [] });
    });

    it('sorts out unknown, unreadable, slow, mismatched, shared and numberless answers', async () => {
        expect((await lookupTickerIds(explorerSdk({}).sdk, ['NOPE'])).missing).toEqual(['NOPE']);
        expect((await lookupTickerIds(explorerSdk({ A: 1 }, { fail: true }).sdk, ['A'])).failed).toEqual(['A']);
        expect((await lookupTickerIds(explorerSdk({ A: 1 }, { hang: true }).sdk, ['A'], { timeoutMs: 20 })).failed).toEqual(['A']);
        expect((await lookupTickerIds(explorerSdk({ A: 1 }, { echoTick: 'B' }).sdk, ['A'])).failed).toEqual(['A']);
        expect((await lookupTickerIds(explorerSdk({ A: 5, B: 5 }).sdk, ['A', 'B'])).duplicate).toEqual(['A', 'B']);
        expect(await lookupTickerIds(explorerSdk({ A: null }).sdk, ['A']))
            .toEqual({ ids: {}, missing: [], failed: [], duplicate: [], noId: ['A'] });
        expect((await lookupTickerIds({}, ['A'])).failed).toEqual(['A']);
    });

    it('counts a 404 from the raw token read as not found and other errors as unchecked', async () => {
        const notFound = { async getToken() { throw Object.assign(new Error('404'), { code: 'EXPLORER_HTTP_404' }); } };
        expect((await lookupTickerIds(notFound, ['A'])).missing).toEqual(['A']);
        const envelope = { async getToken(tick) { return [{ info: { tick, tick_id: 9 } }]; } };
        expect((await lookupTickerIds(envelope, ['A'])).ids).toEqual({ A: 9 });
    });

    it('reads nothing past the per-save cap', async () => {
        const { sdk, reads } = explorerSdk({});
        const many = Array.from({ length: MAX_TICK_LOOKUPS + 1 }, (_, i) => `T${i}`);
        expect((await lookupTickerIds(sdk, many)).failed).toHaveLength(MAX_TICK_LOOKUPS + 1);
        expect(reads).toHaveLength(0);
    });

    it('looks up on the account chain and skips its coin in the host route', async () => {
        const { sdk, reads } = explorerSdk({ MYTOKEN: 1234 });
        const lookup = await resolveCoSignerTokenIds({
            sdkRegistry: { get: (chainId) => (chainId === 'bitcoin-mainnet' ? sdk : null) },
            chainId: 'bitcoin-mainnet',
            ticks: ['MYTOKEN', 'BTC'],
        });
        expect(lookup.ids).toEqual({ MYTOKEN: 1234 });
        expect(reads.map((r) => r.tick)).toEqual(['MYTOKEN']);
    });

    it('rebuilds tickIds from the lookup alone and refuses any problem', () => {
        const policy = { ...LIST, tickIds: { STALE: 3 } };
        expect(applyTickLookup(policy, { ids: { MYTOKEN: 1234 }, missing: [], failed: [], duplicate: [], noId: [] }))
            .toEqual({ ok: true, policy: { ...LIST, tickIds: { MYTOKEN: 1234 } } });
        expect(applyTickLookup(policy, { ids: {}, missing: [], failed: [], duplicate: [], noId: ['XCHAIN'] }))
            .toEqual({ ok: true, policy: LIST });
        expect(applyTickLookup(LIST, { ids: {}, missing: ['A'], failed: ['B'], duplicate: ['C'], noId: [] }))
            .toEqual({ ok: false, problems: { A: 'missing', B: 'failed', C: 'duplicate' } });
    });
});

// The renderer's messaging route, answered by the real host-side lookup.
function editorMessaging(tokens, opts) {
    const { sdk, reads } = explorerSdk(tokens, opts);
    const calls = [];
    const messaging = {
        async resolveCoSignerTokenIds(req) {
            calls.push(req);
            return resolveCoSignerTokenIds({ sdkRegistry: { get: () => sdk }, ...req });
        },
    };
    return { messaging, reads, calls };
}

describe('saving the rules stores each token number', () => {
    const CAPPED_LIST = { ...LIST, maxPerAction: { SEND: { MYTOKEN: '100', '*': '5' } } };

    it('stores the number of every named token in policy.tickIds', async () => {
        const { messaging, reads, calls } = editorMessaging({ MYTOKEN: 1234, XCHAIN: 1 });
        const saved = await declarePolicyTokenIds({ policy: CAPPED_LIST, chainId: 'bitcoin-mainnet', messaging });
        expect(saved).toEqual({
            policy: { ...CAPPED_LIST, tickIds: { MYTOKEN: 1234, XCHAIN: 1 } },
            tokenIds: { MYTOKEN: 1234, XCHAIN: 1 },
        });
        expect(calls).toEqual([{ chainId: 'bitcoin-mainnet', ticks: ['MYTOKEN', 'XCHAIN'] }]);
        expect(reads).toHaveLength(2);
    });

    it('refuses to save a ticker the network does not know, with a message for its field', async () => {
        const { messaging } = editorMessaging({ MYTOKEN: 1234 });
        const saved = await declarePolicyTokenIds({ policy: LIST, chainId: 'bitcoin-mainnet', messaging });
        expect(saved.policy).toBeUndefined();
        expect(saved.error).toMatch(/couldn't be matched/);
        expect(Object.keys(saved.tokenErrors)).toEqual(['XCHAIN']);
        expect(saved.tokenErrors.XCHAIN).toMatch(/XCHAIN wasn't found on this network/);
    });

    it('refuses to save when the lookup cannot run or fails', async () => {
        const down = editorMessaging({ MYTOKEN: 1234, XCHAIN: 1 }, { fail: true });
        const failed = await declarePolicyTokenIds({ policy: LIST, chainId: 'bitcoin-mainnet', messaging: down.messaging });
        expect(failed.tokenErrors.MYTOKEN).toMatch(/couldn't be checked/);
        const thrown = await declarePolicyTokenIds({
            policy: LIST, chainId: 'bitcoin-mainnet',
            messaging: { async resolveCoSignerTokenIds() { throw new Error('host gone'); } },
        });
        expect(Object.keys(thrown.tokenErrors)).toEqual(['MYTOKEN', 'XCHAIN']);
        const missingRoute = await declarePolicyTokenIds({ policy: LIST, chainId: 'bitcoin-mainnet', messaging: {} });
        expect(missingRoute.error).toMatch(/can't be checked/);
        const partial = await declarePolicyTokenIds({
            policy: LIST, chainId: 'bitcoin-mainnet',
            messaging: { async resolveCoSignerTokenIds() { return { ids: { MYTOKEN: 1 }, missing: [], failed: [], duplicate: [], noId: [] }; } },
        });
        expect(Object.keys(partial.tokenErrors)).toEqual(['XCHAIN']);
    });

    it('saves rules that name no token without any lookup, dropping an old map', async () => {
        const { messaging, calls } = editorMessaging({});
        const saved = await declarePolicyTokenIds({
            policy: { allowedActions: ['SEND'], maxPerAction: { SEND: { '*': '5', BTC: '1' } }, tickIds: { OLD: 9 } },
            chainId: 'bitcoin-mainnet',
            messaging,
        });
        expect(saved.policy).toEqual({ allowedActions: ['SEND'], maxPerAction: { SEND: { '*': '5', BTC: '1' } } });
        expect(calls).toHaveLength(0);
    });

    it('stores the map through the account update and back out of the vault', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
        const account = createCoSignerAccount(accountInput({ policy: LIST }));
        await vault.coSignerAccounts.put(account);
        const { messaging } = editorMessaging({ MYTOKEN: 1234, XCHAIN: 1 });
        const saved = await declarePolicyTokenIds({ policy: CAPPED_LIST, chainId: account.chainId, messaging });
        await updateCoSignerAccount({ vault, id: account.id, patch: { policy: saved.policy } });
        const stored = await vault.coSignerAccounts.get(account.id);
        expect(stored.policy.tickIds).toEqual({ MYTOKEN: 1234, XCHAIN: 1 });
        expect(validateCoSignerAccount(stored)).toEqual({ ok: true, errors: [] });
        expect(validateCoSignerAccount({ ...stored, policy: { ...stored.policy, tickIds: { MYTOKEN: '^1' } } }).ok).toBe(false);
        expect(validateCoSignerAccount({ ...stored, policy: { ...stored.policy, tickIds: { A: 1, B: 1 } } }).ok).toBe(false);
    });
});

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };

function accountInput(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        name: 'Trading bot',
        aggregateAddress: 'bc1pagg',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: PUBKEYS,
        policy: LIST,
        allowedOutputs: [],
        ...overrides,
    };
}

// A co-signer stand-in that decides with the real SDK evaluator on the policy
// it was built with, as CoSigner does (it stores config.policy as given and
// hands it to evaluatePolicy), and records that policy. Its token reads throw.
function signingSdk(decoded) {
    const calls = { process: 0, policy: null };
    const { sdk, reads } = noReadSdk();
    sdk.coSigner = {
        decodeActionFromPsbt: () => decoded,
        CoSigner: class {
            constructor(config) { calls.policy = config.policy; }
            process() {
                calls.process += 1;
                const verdict = realEvaluatePolicy(calls.policy,
                    { action: decoded.action, version: decoded.version, params: decoded.params });
                if (!verdict.ok) return { approved: false, reason: verdict.violation.code };
                return { approved: true, signatures: [{ index: 0, publicNonce: 'aa', sig: 'bb', msg: 'cc' }] };
            }
        },
    };
    return { sdk, calls, reads };
}

// Rules saved with their token numbers, and the same rules saved before the
// numbers were recorded.
const DECLARED = { ...LIST, maxPerAction: { SEND: { MYTOKEN: '100' } }, tickIds: { MYTOKEN: 1234, XCHAIN: 1 } };
const UNDECLARED = { ...LIST, maxPerAction: { SEND: { MYTOKEN: '100' } } };
const sendById = (amount) => ({ ok: true, action: 'SEND', params: { TICK: '^1234', AMOUNT: amount, DESTINATION: 'bc1qdest' } });

describe('the signing decision reads only the saved token numbers', () => {
    const sign = (sdk, policy, extra = {}) => passiveCoSign({
        sdk, secretKey: KEY, publicKeys: PUBKEYS, policy, request: REQUEST, nativeTick: 'BTC', ...extra,
    });

    it('signs a declared token sent by number within its cap, with no explorer read', async () => {
        const { sdk, calls, reads } = signingSdk(sendById('5'));
        expect((await sign(sdk, DECLARED)).approved).toBe(true);
        expect(calls.process).toBe(1);
        expect(calls.policy).toBe(DECLARED);
        expect(reads).toHaveLength(0);
    });

    it('applies the cap to a declared token sent by number', async () => {
        const { sdk, reads } = signingSdk(sendById('500'));
        expect(await sign(sdk, DECLARED)).toEqual({ approved: false, reason: CAP_EXCEEDED });
        expect(reads).toHaveLength(0);
    });

    it('refuses an undeclared number before the co-signer runs, telling the owner to save the rules again', async () => {
        const { sdk, calls, reads } = signingSdk(sendById('5'));
        const result = await sign(sdk, UNDECLARED);
        expect(result.reason).toBe(TOKEN_UNRESOLVED);
        expect(result.reason).toBe('POLICY_UNRESOLVED_TICK');
        expect(result.detail).toEqual({ action: 'SEND', tick: '^1234' });
        expect(calls.process).toBe(0);
        expect(reads).toHaveLength(0);
        expect(describePolicyReason(result.reason)).toMatch(/save the account's rules again/);
    });

    it('keeps rules saved before the numbers working by ticker', async () => {
        const { sdk, reads } = signingSdk({ ok: true, action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '5', DESTINATION: 'bc1qdest' } });
        expect((await sign(sdk, UNDECLARED)).approved).toBe(true);
        expect(reads).toHaveLength(0);
    });

    it('refuses an unlisted token sent by a declared number, by its ticker', async () => {
        const { sdk, calls } = signingSdk({ ok: true, action: 'SEND', params: { TICK: '^77', AMOUNT: '5' } });
        const result = await sign(sdk, { ...LIST, tickIds: { MYTOKEN: 1234, PEPECASH: 77 } });
        expect(result).toEqual({ approved: false, reason: TOKEN_NOT_ALLOWED, detail: { action: 'SEND', tick: 'PEPECASH' }, action: 'SEND' });
        expect(calls.process).toBe(0);
    });

    it('leaves an any-token account with a cap to the SDK, which refuses an undeclared number, with no read', async () => {
        const policy = { allowedActions: ['SEND'], maxPerAction: { SEND: { MYTOKEN: '100' } } };
        const undeclared = signingSdk(sendById('5'));
        expect(await sign(undeclared.sdk, policy, { nativeTick: undefined }))
            .toEqual({ approved: false, reason: 'POLICY_UNRESOLVED_TICK' });
        const declared = signingSdk(sendById('500'));
        expect(await sign(declared.sdk, { ...policy, tickIds: { MYTOKEN: 1234 } }, { nativeTick: undefined }))
            .toEqual({ approved: false, reason: CAP_EXCEEDED });
        expect(undeclared.reads).toHaveLength(0);
        expect(declared.reads).toHaveLength(0);
    });
});

describe('the approval preview reads only the saved token numbers', () => {
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
    });

    // The preview with the real SDK evaluator and an SDK whose token reads throw.
    async function preview(policy, params) {
        const account = createCoSignerAccount(accountInput({ policy }));
        await vault.coSignerAccounts.put(account);
        const { sdk, reads } = noReadSdk();
        sdk.coSigner = {
            decodeActionFromPsbt: () => ({ ok: true, action: 'SEND', params }),
            evaluatePolicy: realEvaluatePolicy,
        };
        const result = await previewCoSignRequest({ vault, sdkRegistry: { get: () => sdk }, accountId: account.id, request: { psbt: 'aabb' } });
        return { result, reads };
    }

    it('passes a declared token sent by number within its cap', async () => {
        const { result, reads } = await preview(DECLARED, sendById('5').params);
        expect(result.policyOk).toBe(true);
        expect(result.policyReason).toBeNull();
        expect(reads).toHaveLength(0);
    });

    it('refuses a declared token sent by number above its cap, a lower-case cap included', async () => {
        expect((await preview(DECLARED, sendById('500').params)).result.policyReason).toBe(CAP_EXCEEDED);
        const lower = { ...DECLARED, maxPerAction: { SEND: { mytoken: '100' } } };
        expect((await preview(lower, sendById('500').params)).result.policyReason).toBe(CAP_EXCEEDED);
    });

    it('refuses an undeclared number on a list account with and without caps, with no read', async () => {
        const capped = await preview(UNDECLARED, sendById('5').params);
        expect(capped.result.policyOk).toBe(false);
        expect(capped.result.policyReason).toBe('POLICY_UNRESOLVED_TICK');
        const listOnly = await preview(LIST, sendById('5').params);
        expect(listOnly.result.policyReason).toBe('POLICY_UNRESOLVED_TICK');
        expect(capped.reads).toHaveLength(0);
        expect(listOnly.reads).toHaveLength(0);
    });

    it('keeps rules saved before the numbers working by ticker', async () => {
        const { result } = await preview(UNDECLARED, { TICK: 'MYTOKEN', AMOUNT: '5', DESTINATION: 'bc1qdest' });
        expect(result.policyOk).toBe(true);
    });

    it('flags an unlisted token sent by a declared number by its ticker', async () => {
        const { result } = await preview({ ...LIST, tickIds: { MYTOKEN: 1234, PEPECASH: 77 } }, { TICK: '^77', AMOUNT: '5', DESTINATION: 'bc1qdest' });
        expect(result.policyReason).toBe(TOKEN_NOT_ALLOWED);
        expect(result.tick).toBe('PEPECASH');
    });
});
