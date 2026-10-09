// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const unlock = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/flows/unlockWallet.js', () => ({ unlockWallet: unlock }));
vi.mock('../../../packages/core/src/flows/panicMode.js', () => ({ assertSigningAllowed: () => {} }));

import { signMultisigLocally, HW_SIGNER_DEFERRED } from '../../../packages/core/src/flows/multisigSignLocally.js';

const PK = ['02' + 'aa'.repeat(32), '02' + 'bb'.repeat(32)];

function opts() {
    const session = {
        id: 's1', walletId: 'w1', scheme: 'p2wsh', status: 'collecting-sigs', threshold: 2,
        cosignerPubkeys: PK, msgHash: 'cc'.repeat(32), psbtHex: '', chainId: 'bitcoin-mainnet',
        signatures: [], nonces: [], partialSigs: [],
    };
    const wallet = {
        id: 'w1',
        multisigs: [{ cosigners: [
            { pubkey: PK[0], origin: 'local', derivationPath: "m/48'/0'/0'/2'/0/0" },
            { pubkey: PK[1], origin: 'remote' },
        ] }],
    };
    return {
        vault: {
            multisigSigningSessions: { get: async () => session },
            wallets: { get: async () => wallet },
        },
        chainRegistry: {}, sdkRegistry: {}, sessionId: 's1', password: 'pw',
    };
}

function signerThrowing(kind, err) {
    return { kind, lock: vi.fn(), signMultisigClassical: async () => { throw err; } };
}

describe('signMultisigLocally hardware deferral', () => {
    beforeEach(() => unlock.mockReset());

    it('tags an uncoded hardware failure with HW_SIGNER_DEFERRED', async () => {
        unlock.mockResolvedValue(signerThrowing('ledger', new Error('not yet wired')));
        await expect(signMultisigLocally(opts())).rejects.toMatchObject({
            code: HW_SIGNER_DEFERRED, message: 'not yet wired',
        });
        expect(HW_SIGNER_DEFERRED).toBe('HW_SIGNER_DEFERRED');
    });

    it('keeps an existing code on a hardware failure', async () => {
        const e = Object.assign(new Error('x'), { code: 'OTHER' });
        unlock.mockResolvedValue(signerThrowing('trezor', e));
        await expect(signMultisigLocally(opts())).rejects.toMatchObject({ code: 'OTHER' });
    });

    it('does not tag software signer failures', async () => {
        unlock.mockResolvedValue(signerThrowing('software', new Error('boom')));
        const err = await signMultisigLocally(opts()).catch((e) => e);
        expect(err.message).toBe('boom');
        expect(err.code).toBeUndefined();
    });
});
