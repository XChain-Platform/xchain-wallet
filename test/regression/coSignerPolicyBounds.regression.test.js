// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The SDK output gate matches an output to the FIRST allow-list entry with the
// same script, so a second entry for one address carries a cap that is never
// enforced. The editor refuses the duplicate instead of saving a limit the
// co-signer ignores. A rolling window has an upper bound so a typed length
// always means a real, expiring window. A second wallet context writing over
// a co-signer record that changed underneath it is refused by the vault.

import { describe, expect, it } from 'vitest';
import { buildPolicyDraft, emptyPolicyDraft } from '../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';
import { createCoSignerAccount } from '../../packages/core/src/schemas/coSignerAccount.js';
import { updateCoSignerAccount } from '../../packages/core/src/flows/updateCoSignerAccount.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

const OUT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function draft(extra) {
    return { ...emptyPolicyDraft(), allowedActionsText: 'SEND', ...extra };
}

describe('co-signer policy bounds', () => {
    it('refuses two allowed outputs for one address', () => {
        const built = buildPolicyDraft(draft({
            allowedOutputs: [{ address: OUT, maxValue: '1000' }, { address: OUT, maxValue: '5' }],
        }));
        expect(built.error).toMatch(/listed more than once/);
    });

    it('refuses the same bech32 address typed in another letter case', () => {
        const built = buildPolicyDraft(draft({
            allowedOutputs: [{ address: OUT, maxValue: '1000' }, { address: OUT.toUpperCase(), maxValue: '5' }],
        }));
        expect(built.error).toMatch(/listed more than once/);
    });

    it('keeps distinct allowed outputs', () => {
        const other = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
        const built = buildPolicyDraft(draft({
            allowedOutputs: [{ address: OUT, maxValue: '1000' }, { address: other, maxValue: '5' }],
        }));
        expect(built.error).toBeUndefined();
        expect(built.allowedOutputs).toEqual([{ address: OUT, maxValue: 1000 }, { address: other, maxValue: 5 }]);
    });

    it('refuses a rolling window longer than one year', () => {
        // '9' x 300 reads as about 1e300; '9' x 400 overflows a double to Infinity.
        for (const windowHours of ['8761', '8760.5', '9'.repeat(300), '9'.repeat(400)]) {
            const built = buildPolicyDraft(draft({ windowEnabled: true, windowHours, windowMaxActions: '3' }));
            expect(built.error).toMatch(/at most 8760 hours \(one year\)/);
        }
        const year = buildPolicyDraft(draft({ windowEnabled: true, windowHours: '8760', windowMaxActions: '3' }));
        expect(year.error).toBeUndefined();
        expect(year.policy.maxPerWindow).toEqual({ hours: 8760, maxActions: 3 });
        const day = buildPolicyDraft(draft({ windowEnabled: true, windowHours: '24', windowMaxActions: '3' }));
        expect(day.error).toBeUndefined();
        expect(day.policy.maxPerWindow).toEqual({ hours: 24, maxActions: 3 });
    });

    it('still refuses a zero or non-decimal rolling window', () => {
        for (const windowHours of ['0', '0.0', '', 'abc', '0x10', '1e1', '-5', 'Infinity']) {
            const built = buildPolicyDraft(draft({ windowEnabled: true, windowHours, windowMaxActions: '3' }));
            expect(built.error).toMatch(/greater than zero/);
        }
    });

    it('refuses a stale second context overwriting an edited co-signer record', async () => {
        const backend = new InMemoryBackend();
        const key = new Uint8Array(32).fill(9);
        const first = new Vault({ backend, masterKey: key });
        await first.open();
        const record = createCoSignerAccount({
            walletId: 'wallet-1',
            chainId: 'bitcoin-mainnet',
            name: 'Agent',
            aggregateAddress: 'bc1paggregate',
            agentPubkey: `03${'b'.repeat(64)}`,
            daemonPubkey: `02${'a'.repeat(64)}`,
            daemonDerivationPath: "m/86'/0'/0'/0/0",
            publicKeyOrder: [`03${'b'.repeat(64)}`, `02${'a'.repeat(64)}`],
            policy: { allowedActions: ['SEND'] },
        });
        await first.coSignerAccounts.put(record);
        const second = new Vault({ backend, masterKey: key });
        await second.open();

        await updateCoSignerAccount({ vault: first, id: record.id, patch: { enabled: false } });
        await expect(updateCoSignerAccount({ vault: second, id: record.id, patch: { name: 'Renamed' } }))
            .rejects.toMatchObject({ name: 'VaultConflictError' });

        const reader = new Vault({ backend, masterKey: key });
        await reader.open();
        const stored = await reader.coSignerAccounts.get(record.id);
        expect(stored.enabled).toBe(false);
        expect(stored.name).toBe('Agent');
    });
});
