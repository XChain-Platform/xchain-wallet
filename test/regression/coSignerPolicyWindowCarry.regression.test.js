// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: a policy edit keeps the agent account's spending window. A cap
// removed and added back still counts the approvals made before, and a new
// window length re-reads the kept entries against the new hours.

import { describe, it, expect } from 'vitest';
import { updateCoSignerAccount } from '../../packages/core/src/flows/updateCoSignerAccount.js';
import {
    buildAccountWindowStore,
    createVaultWindowPersistence,
} from '../../packages/core/src/cosigner/vaultWindowPersistence.js';
import { createCoSignerAccount, validateCoSignerAccount } from '../../packages/core/src/schemas/coSignerAccount.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);
const NOW = Date.UTC(2026, 0, 10);
const HOUR = 3600 * 1000;

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

async function seedWindow(vault, id, ages) {
    const entries = ages.map((age) => ({ t: NOW - age, action: 'SEND', tick: 'XCHAIN', amount: '1', txid: null }));
    await createVaultWindowPersistence(vault, id).write({ version: 1, entries, lastSeen: NOW - 1000 });
}

async function setPolicy(vault, id, policy) {
    await updateCoSignerAccount({ vault, id, patch: { policy } });
    return vault.coSignerAccounts.get(id);
}

async function windowCount(vault, account) {
    const store = buildAccountWindowStore({ vault, account, now: () => NOW });
    await store.load();
    return store.snapshot().count;
}

describe('agent account spending window across policy edits', () => {
    it('keeps the window when the cap is removed', async () => {
        const { vault, record } = await openVaultWithAccount();
        await seedWindow(vault, record.id, [HOUR]);

        const stored = await setPolicy(vault, record.id, { allowedActions: ['SEND'] });

        expect(stored.window.entries).toHaveLength(1);
        expect(validateCoSignerAccount(stored).ok).toBe(true);
        expect(buildAccountWindowStore({ vault, account: stored, now: () => NOW })).toBeNull();
    });

    it('counts the kept entry when the cap is added back', async () => {
        const { vault, record } = await openVaultWithAccount();
        await seedWindow(vault, record.id, [HOUR]);
        await setPolicy(vault, record.id, { allowedActions: ['SEND'] });

        const stored = await setPolicy(vault, record.id, {
            allowedActions: ['SEND'],
            maxPerWindow: { hours: 24, maxActions: 1 },
        });

        expect(await windowCount(vault, stored)).toBe(1);
    });

    it('drops entries outside a shortened window', async () => {
        const { vault, record } = await openVaultWithAccount();
        await seedWindow(vault, record.id, [2 * HOUR, 10 * HOUR]);

        const stored = await setPolicy(vault, record.id, {
            allowedActions: ['SEND'],
            maxPerWindow: { hours: 6, maxActions: 1 },
        });

        expect(await windowCount(vault, stored)).toBe(1);
    });

    it('counts kept entries inside a lengthened window', async () => {
        const { vault, record } = await openVaultWithAccount();
        await seedWindow(vault, record.id, [10 * HOUR, 60 * HOUR]);

        const stored = await setPolicy(vault, record.id, {
            allowedActions: ['SEND'],
            maxPerWindow: { hours: 48, maxActions: 1 },
        });

        expect(await windowCount(vault, stored)).toBe(1);
    });
});
