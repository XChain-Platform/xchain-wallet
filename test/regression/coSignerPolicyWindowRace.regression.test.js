// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: a policy edit and a window write on the same agent account
// both rewrite the whole record, so they must not overwrite each other. A
// lost window write re-opens the spending budget; a lost policy edit leaves
// the old limits in force while the editor reports success.

import { describe, it, expect } from 'vitest';
import { updateCoSignerAccount } from '../../packages/core/src/flows/updateCoSignerAccount.js';
import { createVaultWindowPersistence } from '../../packages/core/src/cosigner/vaultWindowPersistence.js';
import { createCoSignerAccount } from '../../packages/core/src/schemas/coSignerAccount.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);

async function openVaultWithAccount() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    const record = createCoSignerAccount({
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1paggregateexample',
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        publicKeyOrder: [AGENT, DAEMON],
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 1 } },
    });
    await vault.coSignerAccounts.put(record);
    return { vault, record };
}

const WINDOW = { version: 1, entries: [{ t: 1000, action: 'SEND', tick: 'XCHAIN', amount: '5', txid: null }], lastSeen: 1000 };

describe('agent account policy edit racing a window write', () => {
    for (const order of ['window first', 'edit first']) {
        it(`keeps both changes (${order})`, async () => {
            const { vault, record } = await openVaultWithAccount();
            const persistence = createVaultWindowPersistence(vault, record.id);
            const edit = () => updateCoSignerAccount({
                vault,
                id: record.id,
                patch: { policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24, maxActions: 9 } } },
            });
            const write = () => persistence.write(WINDOW);
            await Promise.all(order === 'window first' ? [write(), edit()] : [edit(), write()]);
            const stored = await vault.coSignerAccounts.get(record.id);
            expect(stored.policy.maxPerWindow.maxActions).toBe(9);
            expect(stored.window.entries).toHaveLength(1);
        });
    }
});
