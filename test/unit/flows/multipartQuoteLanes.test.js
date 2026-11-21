// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    multipartOutputFloor,
    multipartQuoteLanes,
} from '../../../packages/core/src/flows/multipartQuoteLanes.js';
import {
    quoteMultipartFile,
} from '../../../packages/core/src/flows/multipartFilePlan.js';
import { publishMultipartFile } from '../../../packages/core/src/flows/publishMultipartFile.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { litecoinDescriptors } from '../../../packages/core/src/registry/descriptors/litecoin.js';
import { dogecoinDescriptors } from '../../../packages/core/src/registry/descriptors/dogecoin.js';

const DESCRIPTORS = [
    ...bitcoinDescriptors,
    ...litecoinDescriptors,
    ...dogecoinDescriptors,
];
const FLOOR_BY_COIN = { bitcoin: 546, litecoin: 5460, dogecoin: 1_000_000 };
const SOURCE = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};
const BYTES = Uint8Array.of(7, 8, 9);
const HASH = 'cd'.repeat(32);
const SIZES = { envelopePairVbytes: () => 8, standardPairBytes: () => 8 };

function fakePlan() {
    const parts = [Uint8Array.of(1, 2), Uint8Array.of(3, 4)];
    return {
        parts: parts.map((rawData, partIndex) => ({
            partIndex, rawData, digest: String(partIndex + 1).repeat(64),
        })),
        fileHash: HASH,
        totalParts: 2,
        totalBytes: 4,
        compression: '',
        manifestParams: {
            fileHash: HASH, totalParts: 2, totalBytes: 4,
            name: 'art.bin', type: 'application/octet-stream', title: '', memo: '',
            gateTicker: '', encryptionMethod: '', keyHash: '', gateMinAmount: '', compression: '',
        },
    };
}

function txid(number) {
    return number.toString(16).padStart(2, '0').repeat(32);
}

function uploadHarness() {
    let signedNumber = 0;
    let actionIndex = 40;
    const encoder = {
        createTx: vi.fn(async (opts) => opts.customOutputs ? {
            psbt: 'funding',
            outputs: opts.customOutputs.map((output, vout) => ({
                vout, ...output, scriptPubKey: `script-${vout}`,
            })),
        } : { psbt: 'commit', revealPsbt: 'reveal' }),
        broadcastTx: vi.fn(async () => {}),
        getTxBlock: vi.fn(async () => ({ block_height: 12 })),
        getUTXOs: vi.fn(async () => ({ utxos: [] })),
    };
    const sdk = {
        encoder,
        actions: { createAction: vi.fn(({ params }) => ({ actionString: JSON.stringify(params) })) },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs: [] })) },
        waitForAction: vi.fn(async () => ({
            actions: [{ action: 'FILE', action_index: actionIndex++ }],
        })),
        getAction: vi.fn(async () => ({ data: [{ multipart: { status: 'complete' } }] })),
    };
    const signer = { kind: 'software', signPsbt: vi.fn(async ({ psbtHex }) => {
        signedNumber += 1;
        return { psbtHex, txid: txid(signedNumber), txHex: `${signedNumber}aa` };
    }) };
    const pendingFileUploads = { put: vi.fn(async () => {}), get: vi.fn(async () => null) };
    return { encoder, sdk, signer, pendingFileUploads };
}

function uploadOptions(harness) {
    return {
        vault: { pendingFileUploads: harness.pendingFileUploads },
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        chainRegistry: { get: () => bitcoinDescriptors.find(({ id }) => id === 'bitcoin-regtest') },
        from: SOURCE,
        bytes: BYTES,
        meta: { name: 'art.bin', type: 'application/octet-stream' },
        signer: harness.signer,
        sdkRegistry: { get: () => harness.sdk },
        lane: 'envelope',
        buildMode: 'one_call',
        rate: 1,
        sizes: SIZES,
        planMultipartFile: vi.fn(async () => fakePlan()),
        sleep: vi.fn(async () => {}),
    };
}

describe('multipart quote lane defaults', () => {
    it.each(DESCRIPTORS)('prices $id with its coin floor and reveal pad', (descriptor) => {
        const lanes = multipartQuoteLanes({ descriptor });
        const floor = FLOOR_BY_COIN[descriptor.coin];
        expect(multipartOutputFloor({ descriptor })).toBe(floor);
        expect(lanes).toEqual({
            envelope: {
                type: 'envelope', outputFloor: floor,
                revealPad: descriptor.coin === 'litecoin',
            },
            standard: { type: 'standard', outputFloor: floor },
        });
    });
});

describe('multipart quote lane overrides', () => {
    it.each(['bitcoin', 'litecoin', 'dogecoin'])('lets an explicit floor win on %s', (coin) => {
        const descriptor = DESCRIPTORS.find((item) => item.coin === coin);
        expect(multipartQuoteLanes({ descriptor, outputFloor: 777 })).toEqual({
            envelope: { type: 'envelope', outputFloor: 777, revealPad: coin === 'litecoin' },
            standard: { type: 'standard', outputFloor: 777 },
        });
    });
});

describe('multipart quote lane refusals', () => {
    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '546', null, NaN])(
        'refuses invalid explicit floor %#',
        (outputFloor) => {
            expect(() => multipartOutputFloor({ descriptor: bitcoinDescriptors[0], outputFloor }))
                .toThrow(expect.objectContaining({
                    name: 'TypeError', code: 'MULTIPART_LANES_INVALID',
                }));
        },
    );

    it.each([null, { coin: 'unknown' }])('refuses unknown descriptor floor %#', (descriptor) => {
        expect(() => multipartOutputFloor({ descriptor })).toThrow(expect.objectContaining({
            code: 'MULTIPART_OUTPUT_FLOOR_UNKNOWN',
        }));
    });
});

describe('multipart quote lane object ownership', () => {
    it('returns fresh lane containers and lane values', () => {
        const first = multipartQuoteLanes({ descriptor: bitcoinDescriptors[0] });
        const second = multipartQuoteLanes({ descriptor: bitcoinDescriptors[0] });
        expect(first).not.toBe(second);
        expect(first.envelope).not.toBe(second.envelope);
        expect(first.standard).not.toBe(second.standard);
    });
});

describe('multipart quote lane quote compatibility', () => {
    it.each([
        ['envelope', { type: 'envelope', outputFloor: 546, revealPad: false }],
        ['standard', { type: 'standard', outputFloor: 546 }],
    ])('matches the prior hand-built %s lane', (lane, handBuilt) => {
        const plan = fakePlan();
        const generated = multipartQuoteLanes({ descriptor: bitcoinDescriptors[0] });
        expect(quoteMultipartFile(plan, 1, generated[lane], SIZES))
            .toEqual(quoteMultipartFile(plan, 1, handBuilt, SIZES));
    });
});

describe('multipart publish derived output floor', () => {
    it('completes and funds the quote outputs without an outputFloor option', async () => {
        const harness = uploadHarness();
        const options = uploadOptions(harness);
        const expected = quoteMultipartFile(
            fakePlan(), 1, multipartQuoteLanes({ descriptor: bitcoinDescriptors[2] }).envelope, SIZES,
        );
        const result = await publishMultipartFile(options);
        const funding = harness.encoder.createTx.mock.calls
            .map(([args]) => args).find((args) => args.customOutputs);
        expect(result.record.stage).toBe('complete');
        expect(result.quote).toEqual(expected);
        expect(funding.customOutputs.map(({ value }) => value)).toEqual(expected.outputs);
        expect(expected.outputs).toEqual([2184, 2184, 2184]);
    });
});
