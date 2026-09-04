// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.5.2 step 5, the restore half: find the published labels payload
// again and decrypt it.
//
// The property these tests exist to pin is that the DISCOVERY NAME IS NOT
// AN AUTHENTICATOR. It is SHA256 of the commitment key and it sits in a
// public FILE action, so from the first publish onward anyone can write
// their own FILE under the same name. Only the AES-256-GCM tag, keyed off
// the seed, says a payload is this wallet's. So the fetch must walk the
// matches and return the first one that AUTHENTICATES, and a decrypt
// failure has to read as "not ours", never as an error that aborts the
// restore. A version that trusted the first row would let one stranger's
// FILE make every user's labels unrecoverable.
//
// The suite drives a fake SDK rather than an explorer: what is under test
// is the wallet's selection and decrypt logic, and the explorer's own
// by-name query mode is covered on its side (db.files-name-mode.test.js).

import { describe, it, expect, vi } from 'vitest';
import {
    fetchAndDecryptLabelSync,
    selectLabelSyncCandidates,
    LABEL_SYNC_MAX_CANDIDATES,
    LABEL_SYNC_PAYLOAD_VERSION,
} from '../../../packages/core/src/flows/labelSync.js';
import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    encodeLabelSyncPayload,
} from '../../../packages/core/src/crypto/labelSync.js';

const SEED = new Uint8Array(64).fill(7);
const OTHER_SEED = new Uint8Array(64).fill(9);

function bodyWith(label, updatedAt = '2026-08-21T00:00:00.000Z') {
    return {
        version: LABEL_SYNC_PAYLOAD_VERSION,
        updatedAt,
        labels: [{ id: 'addr-1', address: 'xc1qexample', label }],
        contacts: [],
    };
}

function discoveryNameFor(seed) {
    const key = computeLabelSyncCommitmentKey(seed);
    try {
        return computeLabelSyncDiscoveryName(key);
    } finally {
        key.fill(0);
    }
}

async function cipherFor(seed, body) {
    const key = computeLabelSyncCommitmentKey(seed);
    try {
        return await encodeLabelSyncPayload(key, body);
    } finally {
        key.fill(0);
    }
}

/**
 * Fake explorer-backed SDK. `rows` is what getFiles returns; `raws` maps
 * action_index -> bytes (or an Error to throw) for the /raw fetch.
 */
function fakeSdk({ rows = [], raws = {} } = {}) {
    return {
        getFiles: vi.fn(async () => rows),
        getGatedFileRaw: vi.fn(async (actionIndex) => {
            const hit = raws[String(actionIndex)];
            if (hit instanceof Error) throw hit;
            if (hit === undefined) throw new Error('404 Not found');
            return hit;
        }),
    };
}

function fileRow(actionIndex, name, extra = {}) {
    return {
        action:       'FILE',
        action_index: actionIndex,
        name,
        title:        'wallet-labels',
        type:         'application/octet-stream',
        block_index:  600000 + Number(actionIndex),
        status:       'valid',
        ...extra,
    };
}

describe('fetchAndDecryptLabelSync: discovery query', () => {
    it('asks the explorer for FILEs by NAME, using the seed-derived discovery name', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: [fileRow('41', name)],
            raws: { 41: await cipherFor(SEED, bodyWith('Cold storage')) },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });

        expect(sdk.getFiles).toHaveBeenCalledTimes(1);
        expect(sdk.getFiles).toHaveBeenCalledWith(name, 'name');
        expect(body.labels[0].label).toBe('Cold storage');
    });

    it('round-trips exactly what publish encrypted', async () => {
        const name = discoveryNameFor(SEED);
        const original = {
            version: LABEL_SYNC_PAYLOAD_VERSION,
            updatedAt: '2026-08-30T12:00:00.000Z',
            labels: [
                { id: 'a1', address: 'xc1qaaa', label: 'Savings' },
                { id: 'a2', address: 'xc1qbbb', label: 'Payroll' },
            ],
            contacts: [{
                id: 'c1',
                name: 'Alice',
                notes: 'met at the meetup',
                entries: [{ chain: 'bitcoin-mainnet', address: 'bc1qalice', label: 'main' }],
            }],
        };
        const sdk = fakeSdk({
            rows: [fileRow('7', name)],
            raws: { 7: await cipherFor(SEED, original) },
        });

        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED })).resolves.toEqual(original);
    });

    it('accepts a { data: [...] } envelope as well as a bare array', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: { data: [fileRow('3', name)] },
            raws: { 3: await cipherFor(SEED, bodyWith('Enveloped')) },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });
        expect(body.labels[0].label).toBe('Enveloped');
    });

    it('takes a pre-derived commitmentKey instead of a seed', async () => {
        const key = computeLabelSyncCommitmentKey(SEED);
        const name = computeLabelSyncDiscoveryName(key);
        const sdk = fakeSdk({
            rows: [fileRow('11', name)],
            raws: { 11: await cipherFor(SEED, bodyWith('Keyed')) },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, commitmentKey: key });
        expect(body.labels[0].label).toBe('Keyed');
        // The caller owns the key it passed in; the flow must not zero it.
        expect(key.some((b) => b !== 0)).toBe(true);
    });
});

describe('fetchAndDecryptLabelSync: nothing to restore', () => {
    it('returns null when the chain has no FILE under that name', async () => {
        const sdk = fakeSdk({ rows: [] });
        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED })).resolves.toBeNull();
        expect(sdk.getGatedFileRaw).not.toHaveBeenCalled();
    });

    it('returns null (not a throw) when every match belongs to another seed', async () => {
        // Someone else's wallet published under a colliding name, or a
        // griefer copied ours. Neither authenticates; neither is an error.
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: [fileRow('20', name)],
            raws: { 20: await cipherFor(OTHER_SEED, bodyWith('Not yours')) },
        });

        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED })).resolves.toBeNull();
    });

    it('propagates an explorer failure instead of reporting "nothing published"', async () => {
        const sdk = fakeSdk();
        sdk.getFiles = vi.fn(async () => { throw new Error('ECONNREFUSED'); });

        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED }))
            .rejects.toThrow('ECONNREFUSED');
    });
});

describe('fetchAndDecryptLabelSync: the name is not an authenticator', () => {
    it('skips a griefer FILE published under the same name and restores ours', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            // Griefer's row is NEWER, so a first-row-wins implementation fails here.
            rows: [fileRow('99', name), fileRow('42', name)],
            raws: {
                99: new Uint8Array(64).fill(0xab),
                42: await cipherFor(SEED, bodyWith('Ours')),
            },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });
        expect(body.labels[0].label).toBe('Ours');
        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(2);
    });

    it('returns the NEWEST of our own re-publishes, whatever order the explorer sent', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: [fileRow('50', name), fileRow('310', name), fileRow('120', name)],
            raws: {
                50:  await cipherFor(SEED, bodyWith('oldest', '2026-01-01T00:00:00.000Z')),
                120: await cipherFor(SEED, bodyWith('middle', '2026-04-01T00:00:00.000Z')),
                310: await cipherFor(SEED, bodyWith('newest', '2026-08-01T00:00:00.000Z')),
            },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });
        expect(body.labels[0].label).toBe('newest');
        // Newest authenticated on the first try: no wasted fetches.
        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(1);
    });

    it('keeps going when one candidate is unreadable at the raw endpoint', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: [fileRow('80', name), fileRow('60', name)],
            raws: {
                80: new Error('500 Server error'),
                60: await cipherFor(SEED, bodyWith('Survived')),
            },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });
        expect(body.labels[0].label).toBe('Survived');
    });

    it('never decrypts more candidates than maxCandidates allows', async () => {
        const name = discoveryNameFor(SEED);
        const rows = [];
        const raws = {};
        for (let i = 1; i <= 12; i += 1) {
            rows.push(fileRow(String(i), name));
            raws[i] = new Uint8Array(64).fill(i);
        }
        const sdk = fakeSdk({ rows, raws });

        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED, maxCandidates: 3 }))
            .resolves.toBeNull();
        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(3);
    });

    it('defaults the candidate cap to LABEL_SYNC_MAX_CANDIDATES', async () => {
        const name = discoveryNameFor(SEED);
        const rows = [];
        const raws = {};
        for (let i = 1; i <= 12; i += 1) {
            rows.push(fileRow(String(i), name));
            raws[i] = new Uint8Array(64).fill(i);
        }
        const sdk = fakeSdk({ rows, raws });

        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED })).resolves.toBeNull();
        expect(sdk.getGatedFileRaw).toHaveBeenCalledTimes(LABEL_SYNC_MAX_CANDIDATES);
    });

    it('refuses to spend AES work on an oversized blob published under our name', async () => {
        const name = discoveryNameFor(SEED);
        const sdk = fakeSdk({
            rows: [fileRow('500', name), fileRow('400', name)],
            raws: {
                // Larger than any legal envelope payload: a decrypt-bomb attempt.
                500: new Uint8Array(400_001).fill(1),
                400: await cipherFor(SEED, bodyWith('Ours')),
            },
        });

        const body = await fetchAndDecryptLabelSync({ sdk, seed: SEED });
        expect(body.labels[0].label).toBe('Ours');
    });

    it('tolerates a Buffer or an ArrayBuffer from the SDK raw fetch', async () => {
        const name = discoveryNameFor(SEED);
        const bytes = await cipherFor(SEED, bodyWith('Buffered'));
        const asBuffer = Buffer.from(bytes);
        const sdk = fakeSdk({ rows: [fileRow('5', name)], raws: { 5: asBuffer } });
        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED }))
            .resolves.toMatchObject({ labels: [{ label: 'Buffered' }] });

        const asArrayBuffer = bytes.slice().buffer;
        const sdk2 = fakeSdk({ rows: [fileRow('5', name)], raws: { 5: asArrayBuffer } });
        await expect(fetchAndDecryptLabelSync({ sdk: sdk2, seed: SEED }))
            .resolves.toMatchObject({ labels: [{ label: 'Buffered' }] });
    });
});

describe('selectLabelSyncCandidates', () => {
    const NAME = 'a'.repeat(64);

    it('drops rows whose name is not an exact match', () => {
        const picked = selectLabelSyncCandidates(
            [fileRow('1', NAME), fileRow('2', 'artwork.png'), fileRow('3', NAME + 'ff')],
            NAME,
        );
        expect(picked.map((r) => r.actionIndex)).toEqual(['1']);
    });

    it('matches the name case-insensitively (hex is hex)', () => {
        const picked = selectLabelSyncCandidates([fileRow('1', NAME.toUpperCase())], NAME);
        expect(picked).toHaveLength(1);
    });

    it('drops token-gated FILEs: they are keyed off a gate, not the seed', () => {
        const picked = selectLabelSyncCandidates(
            [fileRow('1', NAME, { gate_ticker: 'XCHAIN' }), fileRow('2', NAME)],
            NAME,
        );
        expect(picked.map((r) => r.actionIndex)).toEqual(['2']);
    });

    it('drops rows the indexer marked invalid, but keeps unverified ones', () => {
        const picked = selectLabelSyncCandidates(
            [
                fileRow('1', NAME, { status: 'invalid' }),
                fileRow('2', NAME, { status: 'unverified' }),
                fileRow('3', NAME, { status: undefined }),
            ],
            NAME,
        );
        expect(picked.map((r) => r.actionIndex).sort()).toEqual(['2', '3']);
    });

    it('orders newest-first by action_index, numerically not lexically', () => {
        const picked = selectLabelSyncCandidates(
            [fileRow('9', NAME), fileRow('100', NAME), fileRow('20', NAME)],
            NAME,
        );
        expect(picked.map((r) => r.actionIndex)).toEqual(['100', '20', '9']);
    });

    it('tolerates junk rows without throwing', () => {
        const picked = selectLabelSyncCandidates(
            [null, 'nope', {}, { name: NAME }, fileRow('4', NAME)],
            NAME,
        );
        expect(picked.map((r) => r.actionIndex)).toEqual(['4']);
    });
});

describe('fetchAndDecryptLabelSync: argument guards', () => {
    it('requires an sdk that can query files', async () => {
        await expect(fetchAndDecryptLabelSync({ seed: SEED })).rejects.toThrow(/getFiles/);
        await expect(fetchAndDecryptLabelSync({ sdk: {}, seed: SEED })).rejects.toThrow(/getFiles/);
    });

    it('requires an sdk that can read raw FILE bytes', async () => {
        await expect(fetchAndDecryptLabelSync({ sdk: { getFiles: async () => [] }, seed: SEED }))
            .rejects.toThrow(/getGatedFileRaw/);
    });

    it('requires a seed or a well-formed commitmentKey', async () => {
        const sdk = fakeSdk();
        await expect(fetchAndDecryptLabelSync({ sdk })).rejects.toThrow(/seed or a 32-byte/);
        await expect(fetchAndDecryptLabelSync({ sdk, seed: new Uint8Array(0) }))
            .rejects.toThrow(/seed or a 32-byte/);
        await expect(fetchAndDecryptLabelSync({ sdk, commitmentKey: new Uint8Array(16) }))
            .rejects.toThrow(/32-byte Uint8Array/);
    });

    it('rejects a nonsensical candidate cap', async () => {
        const sdk = fakeSdk();
        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED, maxCandidates: 0 }))
            .rejects.toThrow(/maxCandidates/);
        await expect(fetchAndDecryptLabelSync({ sdk, seed: SEED, maxCandidates: Number.NaN }))
            .rejects.toThrow(/maxCandidates/);
    });

    it('leaves the caller\'s seed untouched', async () => {
        const seed = new Uint8Array(64).fill(7);
        const sdk = fakeSdk();
        await fetchAndDecryptLabelSync({ sdk, seed });
        expect(seed.every((b) => b === 7)).toBe(true);
    });
});
