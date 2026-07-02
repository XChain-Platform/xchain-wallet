// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: updateCoSignerAccount (§22, P4 management). Verifies the mutable-field
// patch semantics (name / enabled / policy / allowedOutputs), that identity
// fields stay immutable, and that a missing id surfaces the typed not-found
// error. Uses a real in-memory Vault so validation runs end to end.

import { describe, it, expect, beforeEach } from 'vitest';
import {
    updateCoSignerAccount,
    CoSignerAccountNotFoundError,
} from '../../../packages/core/src/flows/updateCoSignerAccount.js';
import { createCoSignerAccount, validateCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const MASTER_KEY = new Uint8Array(32).fill(9);
const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);

function seedRecord(overrides = {}) {
    return createCoSignerAccount({
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1paggregateexample',
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        publicKeyOrder: [AGENT.toLowerCase(), DAEMON.toLowerCase()],
        policy: { allowedActions: ['SEND'] },
        name: 'Trading agent',
        ...overrides,
    });
}

describe('updateCoSignerAccount', () => {
    /** @type {Vault} */
    let vault;
    let record;
    beforeEach(async () => {
        vault = new Vault({ backend: new InMemoryBackend(), masterKey: MASTER_KEY });
        await vault.open();
        record = seedRecord();
        await vault.coSignerAccounts.put(record);
    });

    it('toggles enabled without touching identity fields', async () => {
        const updated = await updateCoSignerAccount({ vault, id: record.id, patch: { enabled: false } });
        expect(updated.enabled).toBe(false);
        expect(updated.aggregateAddress).toBe(record.aggregateAddress);
        expect(updated.agentPubkey).toBe(record.agentPubkey);
        expect(updated.daemonDerivationPath).toBe(record.daemonDerivationPath);
        expect(updated.updatedAt >= record.updatedAt).toBe(true);
        const stored = await vault.coSignerAccounts.get(record.id);
        expect(stored.enabled).toBe(false);
    });

    it('renames and replaces the policy, normalizing action case', async () => {
        const updated = await updateCoSignerAccount({
            vault,
            id: record.id,
            patch: {
                name: '  Ops agent  ',
                policy: { allowedActions: ['send', 'issue'], maxPerWindow: { hours: 12, maxActions: 5 } },
                allowedOutputs: [{ address: 'bcrt1qexample', maxValue: 1000 }],
            },
        });
        expect(updated.name).toBe('Ops agent');
        expect(updated.policy.allowedActions).toEqual(['SEND', 'ISSUE']);
        expect(updated.policy.maxPerWindow).toEqual({ hours: 12, maxActions: 5 });
        expect(updated.allowedOutputs).toEqual([{ address: 'bcrt1qexample', maxValue: 1000 }]);
        expect(validateCoSignerAccount(updated).ok).toBe(true);
    });

    it('rejects an empty policy and a blank name', async () => {
        await expect(updateCoSignerAccount({ vault, id: record.id, patch: { policy: { allowedActions: [] } } }))
            .rejects.toThrow(/allowedActions/);
        await expect(updateCoSignerAccount({ vault, id: record.id, patch: { name: '   ' } }))
            .rejects.toThrow(/name/);
    });

    it('throws a typed error for an unknown id', async () => {
        await expect(updateCoSignerAccount({ vault, id: 'missing' }))
            .rejects.toBeInstanceOf(CoSignerAccountNotFoundError);
    });
});
