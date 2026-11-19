// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the allowed-tokens rule for agent accounts. Three states (absent is
// any token, [] is none, a list is only those), checked on every token an
// action names, enforced on the approval preview and on the signing decision.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    actionTicks,
    allowedTicksMode,
    evaluateAllowedTicks,
    nativeTickForChain,
    normalizeAllowedTicks,
    sdkValueUnreadable,
    TOKEN_NOT_ALLOWED,
    TOKEN_UNCHECKABLE,
    TOKEN_UNRESOLVED,
} from '../../../packages/core/src/cosigner/allowedTicks.js';
// The SDK's real policy evaluator answers whether an action's value is readable.
import { createRequire } from 'node:module';

const sdkRequire = createRequire(import.meta.url);
const realEvaluatePolicy = sdkRequire('../../../node_modules/xchain-sdk/src/cosigner/policy_evaluator.js').evaluatePolicy;
const REAL_SDK = { coSigner: { evaluatePolicy: realEvaluatePolicy } };
import {
    createCoSignerAccount,
    normalizeStoredPolicy,
    validateCoSignerAccount,
} from '../../../packages/core/src/schemas/coSignerAccount.js';
import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import { previewCoSignRequest } from '../../../packages/core/src/flows/previewCoSignRequest.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { describePolicyReason } from '../../../packages/core/src/shared/components/coSignPolicyReasons.js';

const LIST = { allowedActions: ['SEND', 'ORDER', 'SWAP'], allowedTicks: ['MYTOKEN', 'XCHAIN'] };
const NONE = { allowedActions: ['SEND', 'ORDER'], allowedTicks: [] };
const ANY = { allowedActions: ['SEND', 'ORDER'] };
const BTC = { nativeTick: 'BTC' };

describe('evaluateAllowedTicks with a list', () => {
    it('refuses a send of a token that is not listed, naming the token', () => {
        const verdict = evaluateAllowedTicks(LIST, { action: 'SEND', params: { TICK: 'PEPECASH', AMOUNT: '500', DESTINATION: 'bc1qx' } }, BTC);
        expect(verdict).toEqual({
            ok: false,
            violation: {
                code: TOKEN_NOT_ALLOWED,
                message: 'PEPECASH is not an allowed token',
                details: { action: 'SEND', tick: 'PEPECASH' },
            },
        });
    });

    it('allows a send of a listed token, in any letter case', () => {
        expect(evaluateAllowedTicks(LIST, { action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '1' } }, BTC).ok).toBe(true);
        expect(evaluateAllowedTicks(LIST, { action: 'SEND', params: { tick: 'mytoken', amount: '1' } }, BTC).ok).toBe(true);
    });

    it('checks both legs of an order: BTC for a listed token passes, a listed token for an unlisted one does not', () => {
        expect(evaluateAllowedTicks(LIST, { action: 'ORDER', params: { GIVE_TICK: 'BTC', GIVE_AMOUNT: '0.02', GET_TICK: 'MYTOKEN', GET_AMOUNT: '100' } }, BTC).ok).toBe(true);
        const verdict = evaluateAllowedTicks(LIST, { action: 'SWAP', params: { GIVE_TICK: 'MYTOKEN', GIVE_AMOUNT: '500', GET_TICK: 'PEPECASH', GET_AMOUNT: '9' } }, BTC);
        expect(verdict.ok).toBe(false);
        expect(verdict.violation.code).toBe(TOKEN_NOT_ALLOWED);
        expect(verdict.violation.details).toEqual({ action: 'SWAP', tick: 'PEPECASH' });
    });

    it('treats BTC as a token when the chain coin is unknown', () => {
        const verdict = evaluateAllowedTicks(LIST, { action: 'ORDER', params: { GIVE_TICK: 'BTC', GET_TICK: 'MYTOKEN' } }, {});
        expect(verdict.ok).toBe(false);
        expect(verdict.violation.details.tick).toBe('BTC');
    });

    it('counts the gas token a capability stake and a vote proposal spend without naming it', () => {
        const goldOnly = { allowedActions: ['STAKE', 'VOTE'], allowedTicks: ['GOLD'] };
        const stake = evaluateAllowedTicks(goldOnly, { action: 'STAKE', version: 1, params: { AMOUNT: '10' } }, BTC);
        expect(stake.ok).toBe(false);
        expect(stake.violation.details).toEqual({ action: 'STAKE', tick: 'XCHAIN' });
        const vote = evaluateAllowedTicks(goldOnly, { action: 'VOTE', version: 0, params: { TICK: 'GOLD', DEPOSIT: '1' } }, BTC);
        expect(vote.ok).toBe(false);
        expect(vote.violation.details.tick).toBe('XCHAIN');
        // A ballot moves nothing, so only its governance token is checked.
        expect(evaluateAllowedTicks(goldOnly, { action: 'VOTE', version: 1, params: { TICK: 'GOLD' } }, BTC).ok).toBe(true);
        // A contract stake names its own token, so the gas default does not apply.
        expect(evaluateAllowedTicks(goldOnly, { action: 'STAKE', params: { TICK: 'GOLD', AMOUNT: '1' } }, BTC).ok).toBe(true);
    });

    it('checks a dividend payout token beside the token it is paid on', () => {
        const verdict = evaluateAllowedTicks(LIST, { action: 'DIVIDEND', params: { TICK: 'MYTOKEN', DIVIDEND_TICK: 'PEPECASH', AMOUNT: '1' } }, BTC);
        expect(verdict.ok).toBe(false);
        expect(verdict.violation.details.tick).toBe('PEPECASH');
    });

    it('refuses a ^id token reference the policy cannot resolve, and resolves one it can', () => {
        const unresolved = evaluateAllowedTicks(LIST, { action: 'SEND', params: { TICK: '^42', AMOUNT: '1' } }, BTC);
        expect(unresolved.ok).toBe(false);
        expect(unresolved.violation.code).toBe(TOKEN_UNRESOLVED);
        expect(unresolved.violation.details).toEqual({ action: 'SEND', tick: '^42' });
        const withIds = { ...LIST, tickIds: { MYTOKEN: 42, PEPECASH: 7 } };
        expect(evaluateAllowedTicks(withIds, { action: 'SEND', params: { TICK: '^42' } }, BTC).ok).toBe(true);
        expect(evaluateAllowedTicks(withIds, { action: 'SEND', params: { TICK: '^7' } }, BTC).violation.details.tick).toBe('PEPECASH');
    });

    it('refuses a sweep, a command bundle and a contract call while any list is set', () => {
        for (const action of ['SWEEP', 'BATCH', 'EXECUTE']) {
            const verdict = evaluateAllowedTicks(LIST, { action, version: 0, params: { TICK: 'MYTOKEN' } }, BTC);
            expect(verdict).toEqual({
                ok: false,
                violation: {
                    code: TOKEN_UNCHECKABLE,
                    message: `${action} moves tokens the request does not name, so it cannot be signed while the allowed tokens are limited`,
                    details: { action },
                },
            });
        }
    });

    it('refuses an action that names no token but moves a referenced object\'s token (the SDK reads it as unbounded)', () => {
        const opts = { ...BTC, valueUnreadable: sdkValueUnreadable(REAL_SDK) };
        // Cancel a referenced order, top up a referenced dispenser: the token is the referenced object's.
        const cancel = evaluateAllowedTicks(LIST, { action: 'ORDER', version: 1, params: { ORDER_ACTION_INDEX: '5' } }, opts);
        expect(cancel.ok).toBe(false);
        expect(cancel.violation.code).toBe(TOKEN_UNCHECKABLE);
        const topUp = evaluateAllowedTicks(LIST, { action: 'DISPENSER', version: 2, params: { DISPENSER_ACTION_INDEX: '9', GIVE_ESCROW: '100' } }, opts);
        expect(topUp.violation.code).toBe(TOKEN_UNCHECKABLE);
    });

    it('lets an action that names no token and moves no token through, when the SDK can read it', () => {
        const opts = { ...BTC, valueUnreadable: sdkValueUnreadable(REAL_SDK) };
        expect(evaluateAllowedTicks(LIST, { action: 'BROADCAST', version: 2, params: { MESSAGE: 'hi', FEE: '0' } }, opts).ok).toBe(true);
        // Paying a matched order in the chain coin moves no token.
        expect(evaluateAllowedTicks(LIST, { action: 'COINPAY', version: 0, params: { ORDER_MATCH_ACTION_INDEX: '7' } }, opts).ok).toBe(true);
    });

    it('fails closed on an action that names no token when nothing can say what it moves', () => {
        const verdict = evaluateAllowedTicks(LIST, { action: 'BROADCAST', version: 2, params: { MESSAGE: 'hi' } }, BTC);
        expect(verdict.violation.code).toBe(TOKEN_UNCHECKABLE);
        const throwing = { ...BTC, valueUnreadable: () => { throw new Error('boom'); } };
        expect(evaluateAllowedTicks(LIST, { action: 'BROADCAST', params: {} }, throwing).ok).toBe(false);
    });

    it('ignores inherited names as tick fields', () => {
        const params = Object.create({ TICK: 'PEPECASH' });
        params.AMOUNT = '1';
        expect(actionTicks('SEND', params)).toEqual([]);
    });
});

describe('evaluateAllowedTicks with None and Any', () => {
    it('None (an empty list) refuses every token but lets the chain coin through', () => {
        const verdict = evaluateAllowedTicks(NONE, { action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '1' } }, BTC);
        expect(verdict.ok).toBe(false);
        expect(verdict.violation).toEqual({
            code: TOKEN_NOT_ALLOWED,
            message: 'MYTOKEN is not an allowed token',
            details: { action: 'SEND', tick: 'MYTOKEN' },
        });
        expect(evaluateAllowedTicks(NONE, { action: 'SEND', params: { TICK: 'BTC', AMOUNT: '0.1' } }, BTC).ok).toBe(true);
    });

    it('Any (no allowedTicks, or null) places no token restriction', () => {
        expect(evaluateAllowedTicks(ANY, { action: 'SEND', params: { TICK: 'PEPECASH', AMOUNT: '500' } }, BTC)).toEqual({ ok: true, violation: null });
        expect(evaluateAllowedTicks({ ...ANY, allowedTicks: null }, { action: 'SWEEP', params: {} }, BTC).ok).toBe(true);
    });

    it('names each mode', () => {
        expect(allowedTicksMode(ANY)).toBe('any');
        expect(allowedTicksMode(NONE)).toBe('none');
        expect(allowedTicksMode(LIST)).toBe('list');
    });
});

describe('stored policy', () => {
    it('folds, trims and de-duplicates the list; anything but an array reads as any', () => {
        expect(normalizeAllowedTicks([' mytoken', 'MYTOKEN', 'xchain', ''])).toEqual(['MYTOKEN', 'XCHAIN']);
        expect(normalizeAllowedTicks([])).toEqual([]);
        expect(normalizeAllowedTicks(null)).toBeNull();
        expect(normalizeAllowedTicks('MYTOKEN')).toBeNull();
    });

    it('keeps the list and the empty list, and omits the key for any token', () => {
        expect(normalizeStoredPolicy(LIST).allowedTicks).toEqual(['MYTOKEN', 'XCHAIN']);
        expect(normalizeStoredPolicy(NONE).allowedTicks).toEqual([]);
        expect('allowedTicks' in normalizeStoredPolicy(ANY)).toBe(false);
    });

    it('validates a record that carries the rule and refuses a malformed one', () => {
        const record = createCoSignerAccount(accountInput({ policy: LIST }));
        expect(validateCoSignerAccount(record)).toEqual({ ok: true, errors: [] });
        const bad = { ...record, policy: { ...record.policy, allowedTicks: [''] } };
        expect(validateCoSignerAccount(bad).ok).toBe(false);
    });

    it('resolves the bitcoin chain coin to BTC', () => {
        expect(nativeTickForChain('bitcoin-mainnet')).toBe('BTC');
        expect(nativeTickForChain('no-such-chain')).toBeNull();
    });

    it('describes each refusal in plain words', () => {
        for (const code of [TOKEN_NOT_ALLOWED, TOKEN_UNRESOLVED, TOKEN_UNCHECKABLE]) {
            expect(describePolicyReason(code)).toMatch(/token/);
        }
    });
});

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };

function signingSdk(decoded) {
    const calls = { process: 0, decode: 0 };
    const sdk = {
        coSigner: {
            decodeActionFromPsbt: () => { calls.decode += 1; return decoded; },
            CoSigner: class {
                process() {
                    calls.process += 1;
                    return { approved: true, signatures: [{ index: 0, publicNonce: 'aa', sig: 'bb', msg: 'cc' }] };
                }
            },
        },
    };
    return { sdk, calls };
}

describe('passiveCoSign enforces the allowed tokens', () => {
    it('refuses an unlisted token before the co-signer runs', async () => {
        const { sdk, calls } = signingSdk({ ok: true, action: 'SEND', params: { TICK: 'PEPECASH', AMOUNT: '500' } });
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: LIST, request: REQUEST, nativeTick: 'BTC' });
        expect(result).toEqual({
            approved: false,
            reason: TOKEN_NOT_ALLOWED,
            detail: { action: 'SEND', tick: 'PEPECASH' },
            action: 'SEND',
        });
        expect(calls.process).toBe(0);
    });

    it('signs a listed token', async () => {
        const { sdk, calls } = signingSdk({ ok: true, action: 'SEND', params: { TICK: 'MYTOKEN', AMOUNT: '5' } });
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: LIST, request: REQUEST, nativeTick: 'BTC' });
        expect(result.approved).toBe(true);
        expect(calls.process).toBe(1);
    });

    it('does not decode at all when the account allows any token', async () => {
        const { sdk, calls } = signingSdk({ ok: true, action: 'SEND', params: { TICK: 'PEPECASH' } });
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: ANY, request: REQUEST });
        expect(result.approved).toBe(true);
        expect(calls.decode).toBe(0);
    });

    it('refuses a PSBT its decode cannot read while a list is set, without running the co-signer', async () => {
        const { sdk, calls } = signingSdk({ ok: false, reason: 'NO_OP_RETURN' });
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: LIST, request: REQUEST, nativeTick: 'BTC' });
        expect(result).toEqual({ approved: false, reason: TOKEN_UNCHECKABLE, detail: { decodeReason: 'NO_OP_RETURN' } });
        expect(calls.process).toBe(0);
    });

    it('refuses on the sign path an order cancel that names no token, using the SDK evaluator', async () => {
        const { sdk, calls } = signingSdk({ ok: true, action: 'ORDER', version: 1, params: { ORDER_ACTION_INDEX: '5' } });
        sdk.coSigner.evaluatePolicy = realEvaluatePolicy;
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: LIST, request: REQUEST, nativeTick: 'BTC' });
        expect(result.approved).toBe(false);
        expect(result.reason).toBe(TOKEN_UNCHECKABLE);
        expect(calls.process).toBe(0);
    });

    it('fails closed when the SDK cannot decode the action for the check', async () => {
        const { sdk, calls } = signingSdk(null);
        delete sdk.coSigner.decodeActionFromPsbt;
        const result = await passiveCoSign({ sdk, secretKey: KEY, publicKeys: PUBKEYS, policy: NONE, request: REQUEST });
        expect(result.approved).toBe(false);
        expect(result.reason).toBe('POLICY_CONFIG_INVALID');
        expect(calls.process).toBe(0);
    });
});

function accountInput(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        name: 'Trading bot',
        aggregateAddress: 'bc1pagg',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        policy: LIST,
        allowedOutputs: [],
        ...overrides,
    };
}

describe('previewCoSignRequest flags an unlisted token', () => {
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
    });

    it('marks the request out of policy with the token reason after the SDK allows it', async () => {
        const account = createCoSignerAccount(accountInput());
        await vault.coSignerAccounts.put(account);
        const sdk = {
            coSigner: {
                decodeActionFromPsbt: () => ({ ok: true, action: 'SWAP', params: { GIVE_TICK: 'MYTOKEN', GIVE_AMOUNT: '500', GET_TICK: 'PEPECASH' } }),
                evaluatePolicy: () => ({ ok: true, violation: null, evaluation: { action: 'SWAP', tick: 'MYTOKEN', amount: '500', destinations: [], needsConfirmation: true } }),
            },
        };
        const preview = await previewCoSignRequest({ vault, sdkRegistry: { get: () => sdk }, accountId: account.id, request: { psbt: 'aabb' } });
        expect(preview.policyOk).toBe(false);
        expect(preview.policyReason).toBe(TOKEN_NOT_ALLOWED);
        expect(preview.tick).toBe('PEPECASH');
        expect(preview.needsConfirmation).toBe(false);
    });

    it('leaves a listed-token request in policy', async () => {
        const account = createCoSignerAccount(accountInput());
        await vault.coSignerAccounts.put(account);
        const sdk = {
            coSigner: {
                decodeActionFromPsbt: () => ({ ok: true, action: 'ORDER', params: { GIVE_TICK: 'BTC', GIVE_AMOUNT: '0.04', GET_TICK: 'MYTOKEN' } }),
                evaluatePolicy: () => ({ ok: true, violation: null, evaluation: { action: 'ORDER', tick: 'BTC', amount: '0.04', destinations: [], needsConfirmation: false } }),
            },
        };
        const preview = await previewCoSignRequest({ vault, sdkRegistry: { get: () => sdk }, accountId: account.id, request: { psbt: 'aabb' } });
        expect(preview.policyOk).toBe(true);
        expect(preview.policyReason).toBeNull();
    });
});
