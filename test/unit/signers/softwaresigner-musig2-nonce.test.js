// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security regression (SIGN-1): MuSig2 secret-nonce reuse -> key extraction.
//
// The secret nonce is derived from a deterministic sessionId. Before the fix
// that id was a pure function of (path, sessionRef.fingerprint, privKey), and
// the fingerprint covers only the transaction. Two signings of the SAME tx
// therefore reused the SAME secret (and public) nonce; a coordinator who
// varied the aggregate nonce across the two signings could solve for the
// private key. The fix binds the derivation to a per-signing-session unique
// id (the session UUID), so:
//   - two sessions over the same tx -> DIFFERENT nonce (no cross-session reuse);
//   - the same session -> SAME nonce across round 1 / round 2 (still works);
//   - a sessionRef without nonceUniqueId is rejected (no deterministic-only path).

import { describe, it, expect } from 'vitest';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

// Fingerprint of a specific transaction. Same tx == same fingerprint across
// two independent signing sessions (that is the whole hazard).
const TX_FINGERPRINT = 'aa'.repeat(32);
const MSG_HASH = 'bb'.repeat(32);
const PUBKEY_A = '02' + '11'.repeat(32);
const PUBKEY_B = '03' + '22'.repeat(32);
const PATH = "m/86'/0'/0'/0/0";
const CHAIN = 'bitcoin';

function baseSessionRef(nonceUniqueId) {
    return {
        scheme: 'taproot-musig2',
        threshold: 2,
        cosignerPubkeys: [PUBKEY_A, PUBKEY_B],
        msgHash: MSG_HASH,
        fingerprint: TX_FINGERPRINT,
        nonceUniqueId,
    };
}

// Mock sdk.musig2: generateNonce echoes the deterministic `sessionId` it was
// handed back inside the 66-byte publicNonce (first 32 bytes), so the test can
// observe whether two calls derived the same or different secret nonce.
function makeSigner() {
    const musig2 = {
        aggregateKeys: () => ({ xOnlyPubkey: new Uint8Array(32) }),
        generateNonce: ({ sessionId }) => {
            const out = new Uint8Array(66);
            out.set(sessionId.subarray(0, 32), 0);
            return out;
        },
    };
    const sdkRegistry = { get: () => ({ musig2 }) };
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry,
    });
    // Inject a known 64-byte seed directly (bypass password unlock).
    const seed = new Uint8Array(64);
    for (let i = 0; i < seed.length; i++) seed[i] = (i * 7 + 1) & 0xff;
    signer._acceptUnlockedState({ mnemonicBytes: new Uint8Array(0), seed, importedWifs: new Map() });
    return signer;
}

async function nonceFor(signer, nonceUniqueId) {
    const { publicNonce } = await signer.signMusig2Round1({
        chainId: CHAIN,
        path: PATH,
        sessionRef: baseSessionRef(nonceUniqueId),
    });
    return publicNonce;
}

describe('SoftwareSigner MuSig2 nonce uniqueness (SIGN-1)', () => {
    it('two sessions over the SAME tx derive DIFFERENT nonces', async () => {
        const signer = makeSigner();
        const nonceSession1 = await nonceFor(signer, 'session-uuid-1111');
        const nonceSession2 = await nonceFor(signer, 'session-uuid-2222');
        expect(nonceSession1).not.toBe(nonceSession2);
    });

    it('the SAME session reproduces the same nonce (round 1 == round 2 re-derive)', async () => {
        const signer = makeSigner();
        const a = await nonceFor(signer, 'session-uuid-stable');
        const b = await nonceFor(signer, 'session-uuid-stable');
        expect(a).toBe(b);
    });

    it('rejects a sessionRef missing nonceUniqueId (no deterministic-only path)', async () => {
        const signer = makeSigner();
        const ref = baseSessionRef('x');
        delete ref.nonceUniqueId;
        await expect(
            signer.signMusig2Round1({ chainId: CHAIN, path: PATH, sessionRef: ref }),
        ).rejects.toThrow(/nonceUniqueId is required/);
    });

    it('rejects an empty nonceUniqueId', async () => {
        const signer = makeSigner();
        await expect(
            signer.signMusig2Round1({ chainId: CHAIN, path: PATH, sessionRef: baseSessionRef('') }),
        ).rejects.toThrow(/nonceUniqueId is required/);
    });
});
