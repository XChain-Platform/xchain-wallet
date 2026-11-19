// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The gated publish flow follows the picked upload method: the Taproot
// envelope sizes the plaintext ceiling to the envelope and asks the confirm
// compose for AUTO with the signer's capability and record; Standard keeps the
// legacy ceiling and sends no encoding. The watcher and direct-sign paths keep
// the Standard request.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'f'.repeat(64) })),
}));
vi.mock('../../../packages/core/src/flows/buildActionPsbt.js', () => ({
    buildActionPsbt: vi.fn(async () => ({ psbtHex: 'unsigned' })),
}));
vi.mock('../../../packages/core/src/flows/composeActionForConfirm.js', () => ({
    composeActionForConfirm: vi.fn(async () => ({ psbt: 'confirm-psbt', encoding: 'TAPROOT' })),
}));

const { composeGatedPublishForConfirm, buildGatedPublishPsbtRequest, gatedPublishAction } =
    await import('../../../packages/core/src/flows/gatedPublishAction.js');
const { maxGatedPlaintextBytes } = await import('../../../packages/core/src/flows/fileSizeLimits.js');
const { composeActionForConfirm } = await import('../../../packages/core/src/flows/composeActionForConfirm.js');
const { buildActionPsbt } = await import('../../../packages/core/src/flows/buildActionPsbt.js');
const { submitAction } = await import('../../../packages/core/src/flows/submitAction.js');

const KEY = Buffer.alloc(32, 7);
const KEY_HASH = 'a'.repeat(64);

function makeOpts(overrides = {}) {
    const sdk = {
        gatedFile: {
            generateKey: vi.fn(() => ({ key: KEY, keyHash: KEY_HASH })),
            encryptWithKey: vi.fn((plaintext) => Buffer.concat([Buffer.alloc(28), Buffer.from(plaintext)])),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat([Buffer.from([0x01]), ...keys])),
            verifyKey: vi.fn(() => true),
        },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ec1e5c1pher' })) },
    };
    return {
        vault: { gatedKeys: { get: vi.fn(), put: vi.fn(), list: vi.fn(async () => []) } },
        walletId: 'w1',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => sdk },
        chainId: 'bitcoin-regtest',
        from: {
            address: 'bcrt1qissuer',
            publicKey: `02${'ab'.repeat(32)}`,
            derivationPath: "m/84'/1'/0'/0/0",
            addressId: 'a1',
            source: 'hd',
        },
        gateTicker: 'GATE',
        name: 'album.zip',
        type: 'application/zip',
        title: 'Album',
        memo: '',
        plainData: 'PLAINTEXT-BYTES',
        ...overrides,
    };
}

const legacyCap = maxGatedPlaintextBytes({
    name: 'album.zip', type: 'application/zip', title: 'Album', memo: '',
    gateTicker: 'GATE', coin: 'BTC', address: 'bcrt1qissuer',
});

beforeEach(() => {
    vi.mocked(composeActionForConfirm).mockClear();
    vi.mocked(buildActionPsbt).mockClear();
    vi.mocked(submitAction).mockClear();
});

describe('gated publish upload method', () => {
    it('Standard sends no encoding, no signer, and keeps the legacy ceiling', async () => {
        await composeGatedPublishForConfirm(makeOpts());
        const call = vi.mocked(composeActionForConfirm).mock.calls[0][0];
        expect(call.encoderOpts).not.toHaveProperty('encoding');
        expect(call.encoderOpts).not.toHaveProperty('options');
        expect(call.signer).toBeNull();
        await expect(composeGatedPublishForConfirm(makeOpts({ plainData: 'x'.repeat(legacyCap + 1) })))
            .rejects.toThrow(/ceiling is \d+ bytes/);
    });

    it('Taproot envelope asks for AUTO with the signer capability and record, at the envelope ceiling', async () => {
        const opts = makeOpts({ encoding: 'AUTO', plainData: 'x'.repeat(legacyCap + 20_000) });
        await composeGatedPublishForConfirm(opts);
        const call = vi.mocked(composeActionForConfirm).mock.calls[0][0];
        expect(call.encoderOpts).toMatchObject({ encoding: 'AUTO', options: { signerSupportsTapscript: true } });
        expect(call.signer).toBe(opts.from);
        expect(call.encoderOpts.rawData.length).toBe(legacyCap + 20_000 + 28);
    });

    it('asserts no capability for a hardware From even when asked', async () => {
        await composeGatedPublishForConfirm(makeOpts({ encoding: 'AUTO', from: { ...makeOpts().from, source: 'trezor' } }));
        const call = vi.mocked(composeActionForConfirm).mock.calls[0][0];
        expect(call.encoderOpts.options).toEqual({ signerSupportsTapscript: false });
    });

    it('keeps the watcher and direct-sign requests and ceilings on Standard', async () => {
        await buildGatedPublishPsbtRequest(makeOpts({ encoding: 'AUTO' }));
        expect(vi.mocked(buildActionPsbt).mock.calls[0][0].encoderOpts).not.toHaveProperty('encoding');
        await gatedPublishAction(makeOpts({ encoding: 'AUTO' }));
        expect(vi.mocked(submitAction).mock.calls[0][0].encoderOpts).not.toHaveProperty('encoding');
        // Neither path asks for the envelope, so neither accepts a file only it could carry.
        const oversized = 'x'.repeat(legacyCap + 1);
        await expect(buildGatedPublishPsbtRequest(makeOpts({ encoding: 'AUTO', plainData: oversized })))
            .rejects.toThrow(/ceiling is \d+ bytes/);
        await expect(gatedPublishAction(makeOpts({ encoding: 'AUTO', plainData: oversized })))
            .rejects.toThrow(/ceiling is \d+ bytes/);
    });

    it('treats only AUTO as the envelope request', async () => {
        await expect(composeGatedPublishForConfirm(makeOpts({ encoding: 'TAPROOT', plainData: 'x'.repeat(legacyCap + 1) })))
            .rejects.toThrow(/ceiling is \d+ bytes/);
    });
});
