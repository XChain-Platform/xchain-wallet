// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A co-sign request that arrives during a duress freeze comes from a party
// outside the wallet (an agent or a partner asking for a co-signature), and
// whoever forced the duress unlock can be watching that party. The co-sign
// flows answer it with the plain failure the dApp bridge gives: no PANIC_MODE
// reason, no error name, no panic sentence and no time left. A freeze the user
// armed in Settings keeps its PANIC_MODE refusal.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', () => ({
    withUnlocked: async () => {
        throw new Error('a frozen co-sign never unlocks');
    },
}));

import { passiveCoSign } from '../../../packages/core/src/flows/passiveCoSign.js';
import { passiveCoSignForAccount } from '../../../packages/core/src/flows/passiveCoSignForAccount.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import {
    PANIC_ARMED_DURESS,
    PANIC_ARMED_SELF,
    PANIC_COVER_MESSAGE,
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    clearPanicModeState,
} from '../../../packages/core/src/flows/panicMode.js';

const KEY = new Uint8Array(32).fill(7);
const PUBKEYS = ['02' + 'a'.repeat(64), '02' + 'b'.repeat(64)];
const REQUEST = { psbt: 'aabbccdd', agentPublicNonce: '03' + 'c'.repeat(130), inputIndex: 0 };
const CUES = /PANIC|panic|remainingMs|PanicModeActiveError|frozen|freeze|min remaining/;

function sdkThatMustNotRun() {
    return {
        coSigner: {
            CoSigner: class {
                constructor() { throw new Error('a frozen co-sign never reaches the CoSigner'); }
            },
        },
    };
}

function plain(err) {
    return JSON.stringify({ name: err?.name, message: err?.message, code: err?.code, keys: Object.keys(err || {}) });
}

let vault;
let account;
beforeEach(async () => {
    localStorage.clear();
    __resetPanicModePersistenceForTests();
    vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    account = createCoSignerAccount({
        walletId: 'wallet-1',
        chainId: 'bitcoin-mainnet',
        name: 'Agent',
        aggregateAddress: 'bc1pagg',
        agentPubkey: PUBKEYS[0],
        daemonPubkey: PUBKEYS[1],
        daemonDerivationPath: "m/86'/0'/0'/0/0",
        publicKeyOrder: PUBKEYS,
        policy: { allowedActions: ['SEND'], maxPerWindow: { hours: 24 } },
        allowedOutputs: [],
    });
    await vault.coSignerAccounts.put(account);
});

afterEach(() => {
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
    localStorage.clear();
});

const flows = {
    passiveCoSign: () => passiveCoSign({
        sdk: sdkThatMustNotRun(),
        secretKey: KEY,
        publicKeys: PUBKEYS,
        policy: { allowedActions: ['SEND'] },
        request: REQUEST,
    }),
    passiveCoSignForAccount: () => passiveCoSignForAccount({
        vault,
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdkThatMustNotRun() },
        accountId: account.id,
        password: 'pw',
        request: { psbt: 'aa' },
    }),
};

describe.each(Object.keys(flows))('%s during a freeze', (name) => {
    it('answers a duress freeze with the plain cover failure', async () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        let thrown = null;
        let result = null;
        try {
            result = await flows[name]();
        } catch (err) {
            thrown = err;
        }
        expect(result).toBeNull();
        expect(thrown?.message).toBe(PANIC_COVER_MESSAGE);
        expect(thrown?.name).toBe('Error');
        expect(plain(thrown)).not.toMatch(CUES);
    });

    it('keeps the PANIC_MODE refusal for a freeze armed in Settings', async () => {
        activatePanicMode({ armedBy: PANIC_ARMED_SELF });
        const result = await flows[name]();
        expect(result).toMatchObject({ approved: false, reason: 'PANIC_MODE' });
    });
});
