// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: provisionCoSignerAccount (§22, P4). Verifies the flow derives the
// aggregate address via the SDK with the agreed [agent, daemon] key order,
// then persists a valid CoSignerAccount. The MuSig2 crypto itself is the
// SDK's tested responsibility; here sdk.coSigner.deriveMuSig2P2TR is a spy.

import { describe, it, expect, beforeEach } from 'vitest';
import { provisionCoSignerAccount } from '../../../packages/core/src/flows/provisionCoSignerAccount.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { validateCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';

const MASTER_KEY = new Uint8Array(32).fill(7);
const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);

function mkSdkRegistry() {
    const calls = [];
    const sdk = {
        wallet: { getBitcoinNetwork: () => ({ bech32: 'bcrt', name: 'regtest' }) },
        coSigner: {
            deriveMuSig2P2TR: (pubkeys, network) => {
                calls.push({ pubkeys, network });
                return { address: 'bcrt1paggregateexample', output: Buffer.alloc(34), tweaks: [] };
            },
        },
    };
    return { sdkRegistry: { get: () => sdk }, calls };
}

function baseOpts(sdkRegistry, overrides = {}) {
    return {
        vault: undefined, // set per test
        sdkRegistry,
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
        allowedOutputs: [{ script: '0014' + '11'.repeat(20), maxValue: 5000 }],
        name: 'Trading agent',
        ...overrides,
    };
}

describe('provisionCoSignerAccount', () => {
    /** @type {Vault} */
    let vault;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
    });

    it('derives the aggregate via the SDK and persists a valid account', async () => {
        const { sdkRegistry, calls } = mkSdkRegistry();
        const rec = await provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault });

        // derived with the agreed [agent, daemon] order and the SDK network.
        expect(calls).toHaveLength(1);
        expect(calls[0].pubkeys).toEqual([AGENT.toLowerCase(), DAEMON.toLowerCase()]);
        expect(calls[0].network).toEqual({ bech32: 'bcrt', name: 'regtest' });

        expect(rec.aggregateAddress).toBe('bcrt1paggregateexample');
        expect(rec.publicKeyOrder).toEqual([AGENT.toLowerCase(), DAEMON.toLowerCase()]);
        expect(rec.policy.allowedActions).toEqual(['SEND']);
        expect(validateCoSignerAccount(rec).ok).toBe(true);

        // persisted and retrievable.
        const stored = await vault.coSignerAccounts.get(rec.id);
        expect(stored).toEqual(rec);
    });

    it('requires the essential inputs', async () => {
        const { sdkRegistry } = mkSdkRegistry();
        await expect(provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault, agentPubkey: '' }))
            .rejects.toThrow(/agentPubkey/);
        await expect(provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault, daemonDerivationPath: '' }))
            .rejects.toThrow(/daemonDerivationPath/);
        await expect(provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault, policy: { allowedActions: [] } }))
            .rejects.toThrow(/allowedActions/);
    });

    it('throws when the SDK lacks the co-signer toolkit', async () => {
        const sdkRegistry = { get: () => ({ wallet: {} }) };
        await expect(provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault }))
            .rejects.toThrow(/deriveMuSig2P2TR/);
    });

    it('throws when derivation returns no address', async () => {
        const sdkRegistry = { get: () => ({ coSigner: { deriveMuSig2P2TR: () => ({}) } }) };
        await expect(provisionCoSignerAccount({ ...baseOpts(sdkRegistry), vault }))
            .rejects.toThrow(/aggregate address/);
    });
});
