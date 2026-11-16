// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readRawFileSpy } = vi.hoisted(() => ({ readRawFileSpy: vi.fn() }));

vi.mock('../../../packages/core/src/flows/rawFileRead.js', async (importOriginal) => {
    const actual = await importOriginal();
    readRawFileSpy.mockImplementation(actual.readRawFile);
    return { ...actual, readRawFile: readRawFileSpy };
});

import { fetchOnChainTisBundle } from '../../../packages/core/src/flows/tokenInfo.js';
import {
    fetchAndDecryptLabelSync,
    LABEL_SYNC_PAYLOAD_VERSION,
} from '../../../packages/core/src/flows/labelSync.js';
import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    encodeLabelSyncPayload,
} from '../../../packages/core/src/crypto/labelSync.js';

const TIS_JSON = JSON.stringify({ tick: 'ART', name: 'Ready artwork', images: [] });
const SEED = new Uint8Array(64).fill(7);

function statusError(status, data) {
    return Object.assign(new Error(`raw read failed: ${status}`), { status, details: { data } });
}

async function labelFixture() {
    const key = computeLabelSyncCommitmentKey(SEED);
    try {
        const name = computeLabelSyncDiscoveryName(key);
        const body = {
            version: LABEL_SYNC_PAYLOAD_VERSION,
            updatedAt: '2026-11-16T00:00:00.000Z',
            labels: [{ id: 'addr-1', address: 'xc1qexample', label: 'Later valid' }],
            contacts: [],
        };
        return { name, ciphertext: await encodeLabelSyncPayload(key, body) };
    } finally {
        key.fill(0);
    }
}

function fileRow(actionIndex, name) {
    return { action: 'FILE', action_index: actionIndex, name, status: 'valid' };
}

beforeEach(() => {
    readRawFileSpy.mockClear();
});

describe('on-chain TIS raw readiness', () => {
    it.each([409, 422])('returns null when the raw read rejects with %i', async (status) => {
        const sdk = { getGatedFileRaw: vi.fn(async () => { throw statusError(status); }) };
        await expect(fetchOnChainTisBundle({ sdk, actionIndex: 12, coin: 'LTC' }))
            .resolves.toBeNull();
    });

    it('never parses a JSON-looking 409 body as a TIS document', async () => {
        const error = statusError(409, Buffer.from(TIS_JSON));
        const sdk = { getGatedFileRaw: vi.fn(async () => { throw error; }) };
        await expect(fetchOnChainTisBundle({ sdk, actionIndex: 12, coin: 'LTC' }))
            .resolves.toBeNull();
    });

    it('reads once with coin context and parses ready TIS bytes', async () => {
        const sdk = { getGatedFileRaw: vi.fn(async () => Buffer.from(TIS_JSON)) };
        const bundle = await fetchOnChainTisBundle({ sdk, actionIndex: 12, coin: 'LTC' });
        expect(bundle?.name).toBe('Ready artwork');
        expect(readRawFileSpy).toHaveBeenCalledOnce();
        expect(readRawFileSpy).toHaveBeenCalledWith(sdk, '12', 'LTC');
    });
});

describe('label sync raw readiness', () => {
    it.each([409, 422])('skips a %i candidate and decrypts the next ready one', async (status) => {
        const { name, ciphertext } = await labelFixture();
        const sdk = {
            getFiles: vi.fn(async () => [fileRow('12', name), fileRow('11', name)]),
            getGatedFileRaw: vi.fn(async (actionIndex) => {
                if (actionIndex === '12') throw statusError(status);
                return ciphertext;
            }),
        };

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });

        expect(body?.labels[0].label).toBe('Later valid');
        expect(readRawFileSpy).toHaveBeenCalledTimes(2);
        expect(readRawFileSpy).toHaveBeenNthCalledWith(1, sdk, '12');
        expect(readRawFileSpy).toHaveBeenNthCalledWith(2, sdk, '11');
    });
});
