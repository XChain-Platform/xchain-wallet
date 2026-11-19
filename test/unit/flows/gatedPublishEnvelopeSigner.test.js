// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm compose of a gated publish must carry the same envelope signer
// the sign-and-send path uses, or an oversized payload is refused on one path
// and enveloped on the other.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/composeActionForConfirm.js', () => ({
    composeActionForConfirm: vi.fn(async () => ({
        psbt: 'confirm-psbt', encoding: 'P2WSH', actionString: 'BATCH|0|...', version: '0',
    })),
}));

import { composeGatedPublishForConfirm } from '../../../packages/core/src/flows/gatedPublishAction.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';

const KEY = Buffer.alloc(32, 7);

function makeOpts(extra = {}) {
    const sdk = {
        gatedFile: {
            generateKey: vi.fn(() => ({ key: KEY, keyHash: 'a'.repeat(64) })),
            encryptWithKey: vi.fn((plain) => Buffer.from(plain)),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat(keys)),
        },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ciphertext' })) },
    };
    return {
        vault: { gatedKeys: { get: vi.fn(async () => null), put: vi.fn(async () => {}), list: vi.fn(async () => []) } },
        walletId: 'w1',
        password: 'pw',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        chainId: 'btc-regtest',
        from: { address: 'bcrt1qissuer', publicKey: '02'.padEnd(66, 'ab'), derivationPath: "m/84'/1'/0'/0/0" },
        gateTicker: 'mytoken',
        name: 'album.zip',
        type: 'application/zip',
        plainData: 'PLAINTEXT-BYTES',
        ownAddresses: ['bcrt1qissuer'],
        ...extra,
    };
}

beforeEach(() => {
    vi.mocked(composeActionForConfirm).mockClear();
});

describe('composeGatedPublishForConfirm envelope signer', () => {
    it('hands the envelope signer to the shared compose step', async () => {
        const envelopeSigner = { source: 'hd' };
        await composeGatedPublishForConfirm(makeOpts({ envelopeSigner }));
        expect(vi.mocked(composeActionForConfirm).mock.calls[0][0].signer).toBe(envelopeSigner);
    });

    it('composes with no envelope signer when the route supplies none', async () => {
        await composeGatedPublishForConfirm(makeOpts());
        expect(vi.mocked(composeActionForConfirm).mock.calls[0][0].signer).toBeNull();
    });
});
