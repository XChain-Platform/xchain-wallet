// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: previewCoSignRequest (§22, P4 "always prompt"). Read-only preview:
// decode-from-PSBT + dry-run policy, no signing, no budget write. The SDK's
// decodeActionFromPsbt + evaluatePolicy are spied; the real crypto is the
// SDK's tested responsibility.

import { describe, it, expect, beforeEach } from 'vitest';
import { previewCoSignRequest } from '../../../packages/core/src/flows/previewCoSignRequest.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';

const MASTER_KEY = new Uint8Array(32).fill(7);

function mkSdkRegistry({ decoded, verdict }) {
    const calls = { decode: [], policy: [] };
    const sdk = {
        wallet: { getBitcoinNetwork: () => ({ bech32: 'bcrt' }) },
        coSigner: {
            decodeActionFromPsbt: (psbt, opts) => { calls.decode.push({ psbt, opts }); return decoded; },
            evaluatePolicy: (policy, actionData, windowUsage) => {
                calls.policy.push({ policy, actionData, windowUsage });
                return verdict;
            },
        },
    };
    return { sdkRegistry: { get: () => sdk }, calls };
}

function accountInput(overrides = {}) {
    return {
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        name: 'Agent',
        aggregateAddress: 'bcrt1pagg',
        agentPubkey: '02' + 'a'.repeat(64),
        daemonPubkey: '02' + 'b'.repeat(64),
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)],
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
        allowedOutputs: [],
        ...overrides,
    };
}

describe('previewCoSignRequest', () => {
    /** @type {Vault} */
    let vault;
    let account;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
        account = createCoSignerAccount(accountInput());
        await vault.coSignerAccounts.put(account);
    });

    it('previews an in-policy request with the decoded action and window snapshot', async () => {
        const { sdkRegistry, calls } = mkSdkRegistry({
            decoded: { ok: true, action: 'SEND', params: { TICK: 'XCHAIN', AMOUNT: '5', DESTINATION: 'bcrt1qdest' } },
            verdict: { ok: true, violation: null, evaluation: { action: 'SEND', tick: 'XCHAIN', amount: '5', destinations: ['bcrt1qdest'], needsConfirmation: false } },
        });
        const preview = await previewCoSignRequest({ vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' } });

        expect(preview.decodeOk).toBe(true);
        expect(preview.action).toBe('SEND');
        expect(preview.amount).toBe('5');
        expect(preview.tick).toBe('XCHAIN');
        expect(preview.destinations).toEqual(['bcrt1qdest']);
        expect(preview.policyOk).toBe(true);
        expect(preview.account).toMatchObject({ id: account.id, aggregateAddress: 'bcrt1pagg', enabled: true });
        // decode used the SDK-resolved network; policy got a window snapshot object.
        expect(calls.decode[0].opts.network).toEqual({ bech32: 'bcrt' });
        expect(calls.policy[0].windowUsage).toEqual({ count: 0, perTick: {} });
    });

    it('flags an out-of-policy request (still decoded)', async () => {
        const { sdkRegistry } = mkSdkRegistry({
            decoded: { ok: true, action: 'ISSUE', params: {} },
            verdict: { ok: false, violation: { code: 'POLICY_ACTION_DENIED' }, evaluation: { action: 'ISSUE', destinations: [], needsConfirmation: false } },
        });
        const preview = await previewCoSignRequest({ vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' } });
        expect(preview.decodeOk).toBe(true);
        expect(preview.policyOk).toBe(false);
        expect(preview.policyReason).toBe('POLICY_ACTION_DENIED');
    });

    it('reports a decode failure without a policy verdict', async () => {
        const { sdkRegistry, calls } = mkSdkRegistry({ decoded: { ok: false, reason: 'NO_OP_RETURN' }, verdict: null });
        const preview = await previewCoSignRequest({ vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' } });
        expect(preview.decodeOk).toBe(false);
        expect(preview.decodeReason).toBe('NO_OP_RETURN');
        expect(preview.policyOk).toBe(false);
        expect(preview.policyReason).toBe('UNDECODABLE');
        expect(calls.policy).toHaveLength(0); // no policy eval on undecodable input
    });

    it('surfaces needsConfirmation from the policy evaluation', async () => {
        const { sdkRegistry } = mkSdkRegistry({
            decoded: { ok: true, action: 'SEND', params: { AMOUNT: '100' } },
            verdict: { ok: true, violation: null, evaluation: { action: 'SEND', amount: '100', destinations: [], needsConfirmation: true } },
        });
        const preview = await previewCoSignRequest({ vault, sdkRegistry, accountId: account.id, request: { psbt: 'aabb' } });
        expect(preview.needsConfirmation).toBe(true);
    });

    it('throws for an unknown account and bad input', async () => {
        const { sdkRegistry } = mkSdkRegistry({ decoded: { ok: true, action: 'SEND', params: {} }, verdict: { ok: true, evaluation: {} } });
        await expect(previewCoSignRequest({ vault, sdkRegistry, accountId: 'nope', request: { psbt: 'aa' } }))
            .rejects.toThrow(/no co-signer account/);
        await expect(previewCoSignRequest({ vault, sdkRegistry, accountId: account.id, request: {} }))
            .rejects.toThrow(/psbt/);
    });
});
