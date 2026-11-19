// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/payloadCompression.js', () => ({
    inflateGatedPlaintext: vi.fn(async (bytes) => ({ bytes })),
}));
vi.mock('../../../packages/core/src/flows/gatedInflateLimit.js', () => ({
    resolveGatedInflate: vi.fn(async () => ({ declared: '', options: {} })),
}));

import {
    clearGatedContentCaches,
    unlockGatedFile,
    unlockGatedFileForAddress,
} from '../../../packages/core/src/flows/gatedContent.js';
import { inflateGatedPlaintext } from '../../../packages/core/src/flows/payloadCompression.js';
import { resolveGatedInflate } from '../../../packages/core/src/flows/gatedInflateLimit.js';

const KEY = Buffer.alloc(32, 5);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const CIPHERTEXT = Buffer.from('ciphertext');
const PLAINTEXT = Buffer.from('plaintext');

function makeSdk(rawResult) {
    return {
        getGatedFileRaw: vi.fn(async () => {
            if (rawResult instanceof Error) throw rawResult;
            return rawResult;
        }),
        getMessagesForAddress: vi.fn(async () => [{ bytes: KEY }]),
        gatedFile: {
            parseKeyPayload: vi.fn(() => [KEY]),
            verifyKey: vi.fn(() => true),
            decryptFileBytes: vi.fn(() => PLAINTEXT),
        },
    };
}

function directUnlock(sdk) {
    return unlockGatedFile({
        sdk, address: 'holder', wif: 'wif', actionIndex: '41', keyHash: KEY_HASH,
    });
}

function vaultUnlock(sdk) {
    const vault = { gatedKeys: { get: vi.fn(async () => ({ keyHex: KEY.toString('hex') })) } };
    return unlockGatedFileForAddress({
        vault,
        walletId: 'wallet',
        sdkRegistry: { get: () => sdk },
        actionIndex: '41',
        keyHash: KEY_HASH,
        gateTicker: 'GATE',
        chainId: 'btc-regtest',
    });
}

const UNLOCKERS = [
    { name: 'unlockGatedFile', run: directUnlock },
    { name: 'unlockGatedFileForAddress', run: vaultUnlock },
];

const RAW_ERROR_SHAPES = [
    ['direct status', Object.assign(new Error('409'), { status: 409 }), 409, 'FILE_INCOMPLETE'],
    ['response status', Object.assign(new Error('422'), { response: { status: 422 } }), 422, 'FILE_ASSEMBLY_MISMATCH'],
    ['SDK details status', Object.assign(new Error('409'), { details: { status: 409 } }), 409, 'FILE_INCOMPLETE'],
    ['SDK binary body', Object.assign(new Error('body'), {
        details: { data: Buffer.from(JSON.stringify({ code: 'FILE_ASSEMBLY_MISMATCH' })) },
    }), 422, 'FILE_ASSEMBLY_MISMATCH'],
    ['Axios body', Object.assign(new Error('body'), {
        response: { data: { code: 'FILE_INCOMPLETE' } },
    }), 409, 'FILE_INCOMPLETE'],
    ['direct body', Object.assign(new Error('body'), {
        body: JSON.stringify({ code: 'FILE_ASSEMBLY_MISMATCH' }),
    }), 422, 'FILE_ASSEMBLY_MISMATCH'],
    ['direct data', Object.assign(new Error('body'), {
        data: { error: { code: 'FILE_INCOMPLETE' } },
    }), 409, 'FILE_INCOMPLETE'],
    ['direct code', Object.assign(new Error('code'), {
        code: 'FILE_ASSEMBLY_MISMATCH',
    }), 422, 'FILE_ASSEMBLY_MISMATCH'],
];

const MISSING_RAW_RESULTS = [
    ['null body', null],
    ['empty body', Buffer.alloc(0)],
    ['direct 404', Object.assign(new Error('404'), { status: 404 })],
    ['response 404', Object.assign(new Error('404'), { response: { status: 404 } })],
    ['SDK details 404', Object.assign(new Error('404'), { details: { status: 404 } })],
];

async function rejected(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('Expected promise to reject');
}

beforeEach(() => {
    clearGatedContentCaches();
    vi.clearAllMocks();
});

describe('gated ciphertext not-ready errors', () => {
    const cases = UNLOCKERS.flatMap((unlocker) => RAW_ERROR_SHAPES.map((shape) => [
        unlocker.name, unlocker.run, ...shape,
    ]));

    it.each(cases)('%s maps the %s shape', async (_name, run, _shape, rawError, status, reason) => {
        const sdk = makeSdk(rawError);
        const error = await rejected(run(sdk));
        const message = status === 409
            ? 'Gated file is still being assembled.'
            : 'Gated file parts do not match its manifest.';

        expect(error).toMatchObject({ code: 'GATED_FILE_NOT_READY', reason, status });
        expect(error.message).toBe(message);
        expect(sdk.gatedFile.decryptFileBytes).not.toHaveBeenCalled();
        expect(resolveGatedInflate).not.toHaveBeenCalled();
        expect(inflateGatedPlaintext).not.toHaveBeenCalled();
    });
});

describe('gated ciphertext missing bodies', () => {
    const cases = UNLOCKERS.flatMap((unlocker) => MISSING_RAW_RESULTS.map(([label, result]) => [
        unlocker.name, unlocker.run, label, result,
    ]));

    it.each(cases)('%s rejects a missing %s', async (_name, run, _label, result) => {
        const sdk = makeSdk(result);
        await expect(run(sdk)).rejects.toMatchObject({ code: 'GATED_FILE_NOT_FOUND' });
        expect(sdk.gatedFile.decryptFileBytes).not.toHaveBeenCalled();
    });
});

describe('gated ciphertext ready bytes', () => {
    it.each(UNLOCKERS)('$name passes ready bytes to decryption', async ({ run }) => {
        const sdk = makeSdk(CIPHERTEXT);

        await run(sdk);

        expect(sdk.gatedFile.decryptFileBytes).toHaveBeenCalledWith(CIPHERTEXT, KEY);
        expect(resolveGatedInflate).toHaveBeenCalledTimes(1);
        expect(inflateGatedPlaintext).toHaveBeenCalledWith(PLAINTEXT, '', {});
    });
});

describe('gated ciphertext unknown failures', () => {
    it.each(UNLOCKERS)('$name propagates a thrown 500 unchanged', async ({ run }) => {
        const failure = Object.assign(new Error('server failed'), { status: 500 });
        const sdk = makeSdk(failure);

        await expect(run(sdk)).rejects.toBe(failure);
        expect(sdk.gatedFile.decryptFileBytes).not.toHaveBeenCalled();
        expect(inflateGatedPlaintext).not.toHaveBeenCalled();
    });
});

describe('gated ciphertext cache after not-ready reads', () => {
    it.each(UNLOCKERS)('$name does not cache a not-ready read', async ({ run }) => {
        const sdk = makeSdk(Object.assign(new Error('assembling'), { status: 409 }));
        await expect(run(sdk)).rejects.toMatchObject({ code: 'GATED_FILE_NOT_READY' });

        sdk.getGatedFileRaw.mockResolvedValue(CIPHERTEXT);
        await run(sdk);

        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(2);
        expect(sdk.gatedFile.decryptFileBytes).toHaveBeenCalledTimes(1);
        expect(inflateGatedPlaintext).toHaveBeenCalledTimes(1);
    });
});
