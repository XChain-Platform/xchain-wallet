// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { provisionCoSignerAccount } from '../../../packages/core/src/flows/provisionCoSignerAccount.js';
import { updateCoSignerAccount } from '../../../packages/core/src/flows/updateCoSignerAccount.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';

const KEY = new Uint8Array(32).fill(7);
const AGENT = `02${'a'.repeat(64)}`;
const DAEMON = `02${'b'.repeat(64)}`;
const sdk = {
    wallet: { getBitcoinNetwork: () => ({ bech32: 'bcrt' }) },
    coSigner: { deriveMuSig2P2TR: () => ({ address: 'bcrt1paggregateexample' }) },
};

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class HeldFailureBackend extends InMemoryBackend {
    hold = null;

    failNextSave() {
        const started = deferred();
        const failure = deferred();
        this.hold = { started, failure };
        return { started: started.promise, reject: failure.reject };
    }

    async save(blob, options) {
        const held = this.hold;
        if (held) {
            this.hold = null;
            held.started.resolve();
            await held.failure.promise;
        }
        await super.save(blob, options);
    }
}

function provision(vault) {
    return provisionCoSignerAccount({
        vault,
        sdkRegistry: { get: () => sdk },
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        agentPubkey: AGENT,
        daemonPubkey: DAEMON,
        daemonDerivationPath: "m/86'/0'/0'/0/3",
        policy: { allowedActions: ['SEND'] },
    });
}

describe('failed co-signer provisioning save', () => {
    it('cannot be resurrected by an edit that starts while the save is pending', async () => {
        const backend = new HeldFailureBackend();
        const vault = new Vault({ backend, masterKey: KEY });
        await vault.open();
        const gate = backend.failNextSave();
        const provisioning = provision(vault);
        const provisioningFailure = expect(provisioning).rejects.toThrow('backend down');
        await gate.started;
        const [provisional] = await vault.coSignerAccounts.list();
        const update = updateCoSignerAccount({
            vault,
            id: provisional.id,
            patch: { name: 'Renamed' },
        });
        const updateFailure = expect(update).rejects.toMatchObject({ name: 'CoSignerAccountNotFoundError' });
        await Promise.resolve();
        await Promise.resolve();
        gate.reject(new Error('backend down'));

        await provisioningFailure;
        await updateFailure;
        expect(await vault.coSignerAccounts.count()).toBe(0);
        const reopened = new Vault({ backend, masterKey: KEY });
        await reopened.open();
        expect(await reopened.coSignerAccounts.count()).toBe(0);
    });
});
