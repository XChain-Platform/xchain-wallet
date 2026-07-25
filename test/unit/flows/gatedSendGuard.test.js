// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the PC-26 gated-send guard. The composition is the
// security-critical surface: a gated tick's SEND must be rewritten into
// ONE atomic BATCH(SEND, MESSAGE v2-to-destination) carrying every pack
// key the wallet holds, hard-blocking when it holds none or when the
// recipient has no on-chain pubkey to encrypt to, and warning (not
// blocking) on a partial pack set.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

import {
    prepareGatedSend,
    gatedSendReadiness,
    resolveGatedSendKeys,
    clearGatedGroupsCache,
    GatedSendKeysMissingError,
    GatedRecipientPubkeyMissingError,
} from '../../../packages/core/src/flows/gatedSendGuard.js';
import { PubkeyMismatchError } from '../../../packages/core/src/flows/messageAction.js';
import {
    clearGatedContentCaches,
    scanGatedKeyHandoffs,
} from '../../../packages/core/src/flows/gatedContent.js';
import { gatedKeyId, createGatedKey } from '../../../packages/core/src/schemas/gatedKey.js';

// --- Deterministic fake SDK -------------------------------------------
// Real shapes (Buffer keys, hex hashes, createAction canonical strings)
// with predictable contents so the BATCH COMMAND asserts byte-for-byte.
// Hashes are REAL sha256(K): the scan cache (flows/gatedContent.js)
// hashes with real crypto, so the memory-fallback path only matches
// when the fixture hashes are genuine digests.
const KEY_A = Buffer.alloc(32, 1);
const HASH_A = createHash('sha256').update(KEY_A).digest('hex');
const KEY_B = Buffer.alloc(32, 2);
const HASH_B = createHash('sha256').update(KEY_B).digest('hex');
const RECIPIENT = 'bcrt1qrecipient';
const RECIPIENT_PUBKEY = '02'.padEnd(66, 'cd');

function gatedRow(keyHash, actionIndex) {
    return { gate_ticker: 'GATED', key_hash: keyHash, action_index: actionIndex, name: `f${actionIndex}`, encryption_method: 1 };
}

function makeSdk(overrides = {}) {
    const keyByBuf = (k) => (k.equals(KEY_A) ? HASH_A : (k.equals(KEY_B) ? HASH_B : null));
    return {
        getFiles: vi.fn(async () => [gatedRow(HASH_A, '100')]),
        getPublicKey: vi.fn(async () => RECIPIENT_PUBKEY),
        gatedFile: {
            verifyKey: vi.fn((key, hash) => keyByBuf(key) === String(hash).toLowerCase()),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat([Buffer.from([0x01]), ...Object.values(keys)])),
            parseKeyPayload: vi.fn((bytes) => {
                if (bytes[0] !== 0x01) throw new Error('bad payload');
                const out = [];
                for (let i = 1; i + 32 <= bytes.length; i += 32) out.push(bytes.subarray(i, i + 32));
                return out;
            }),
        },
        messaging: {
            eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ec1e5c1pher' })),
        },
        actions: {
            createAction: vi.fn(({ action, params }) => {
                if (action === 'SEND') {
                    const parts = ['SEND', '0', params.TICK, params.AMOUNT, params.DESTINATION];
                    if (params.MEMO !== undefined) parts.push(params.MEMO);
                    return { actionString: parts.join('|'), action, version: 0 };
                }
                if (action === 'MESSAGE') {
                    return {
                        actionString: ['MESSAGE', params.VERSION, params.COIN, params.DESTINATION, params.ENCRYPTED_MESSAGE].join('|'),
                        action,
                        version: Number(params.VERSION),
                    };
                }
                throw new Error(`unexpected action ${action}`);
            }),
        },
        // The pubkey-bind check derives addresses from the returned key;
        // deriving RECIPIENT for the fixed pubkey simulates a verified match.
        wallet: {
            deriveAddress: vi.fn((pubkeyHex) => (pubkeyHex === RECIPIENT_PUBKEY ? RECIPIENT : 'bcrt1qother')),
        },
        ...overrides,
    };
}

function makeVault() {
    const store = new Map();
    return {
        store,
        gatedKeys: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
            list: vi.fn(async () => [...store.values()]),
        },
    };
}

function seedVaultKey(vault, keyHash, keyHex) {
    const record = createGatedKey({
        walletId: 'w1', chainId: 'btc-regtest', gateTicker: 'GATED',
        keyHash, keyHex, source: 'recovered',
    });
    vault.store.set(record.id, record);
    return record;
}

function makeArgs(overrides = {}) {
    const sdk = overrides.sdk || makeSdk();
    const vault = overrides.vault || makeVault();
    return {
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'bitcoin', addressTypes: ['p2wpkh'] }) },
        vault,
        walletId: 'w1',
        chainId: 'btc-regtest',
        source: { address: 'bcrt1qsender' },
        to: RECIPIENT,
        tick: 'GATED',
        amount: '5',
        sdk,
        ...overrides,
    };
}

beforeEach(() => {
    clearGatedGroupsCache();
    clearGatedContentCaches();
});

describe('prepareGatedSend detection', () => {
    it('returns null for an ungated tick', async () => {
        const sdk = makeSdk({ getFiles: vi.fn(async () => []) });
        expect(await prepareGatedSend(makeArgs({ sdk }))).toBeNull();
    });

    it('returns null for the native coin without querying the explorer', async () => {
        const sdk = makeSdk();
        expect(await prepareGatedSend(makeArgs({ sdk, tick: 'BTC' }))).toBeNull();
        expect(sdk.getFiles).not.toHaveBeenCalled();
    });

    it('returns null for a ^id tick (indexer backstop documented)', async () => {
        const sdk = makeSdk();
        expect(await prepareGatedSend(makeArgs({ sdk, tick: '^123' }))).toBeNull();
        expect(sdk.getFiles).not.toHaveBeenCalled();
    });

    it('ignores demo-only gated groups', async () => {
        const sdk = makeSdk({
            getFiles: vi.fn(async () => [gatedRow(HASH_A, 'demo:pepecreature-art')]),
        });
        expect(await prepareGatedSend(makeArgs({ sdk }))).toBeNull();
    });

    it('degrades to plain SEND when the explorer is down (listGatedFiles swallows)', async () => {
        const sdk = makeSdk({ getFiles: vi.fn(async () => { throw new Error('explorer down'); }) });
        expect(await prepareGatedSend(makeArgs({ sdk }))).toBeNull();
    });
});

describe('prepareGatedSend composition', () => {
    it('rewrites into byte-exact BATCH(SEND, MESSAGE v2) with the vault key', async () => {
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const args = makeArgs({ vault });
        const plan = await prepareGatedSend(args);

        expect(plan.actionData.action).toBe('BATCH');
        expect(plan.actionData.params.VERSION).toBe('0');
        expect(plan.actionData.params.COMMAND).toBe(
            `SEND|0|GATED|5|${RECIPIENT}`
            + `;MESSAGE|2|BTC|${RECIPIENT}|ec1e5c1pher`,
        );
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(plan.missingKeyHashes).toEqual([]);
        expect(plan.warnings).toEqual([]);
        // The handoff was ECIES-encrypted to the RECIPIENT's pubkey with
        // the 0x01-versioned payload carrying K.
        const [payload, pubkey] = args.sdk.messaging.eciesEncryptBytes.mock.calls[0];
        expect(pubkey).toBe(RECIPIENT_PUBKEY);
        expect(payload).toEqual(Buffer.concat([Buffer.from([0x01]), KEY_A]));
    });

    it('includes MEMO in the SEND sub-command when present', async () => {
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const plan = await prepareGatedSend(makeArgs({ vault, memo: 'hi' }));
        expect(plan.actionData.params.COMMAND.startsWith(`SEND|0|GATED|5|${RECIPIENT}|hi;`)).toBe(true);
    });

    it('rejects a memo carrying BATCH separators', async () => {
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        await expect(prepareGatedSend(makeArgs({ vault, memo: 'a;b' }))).rejects.toThrow(/cannot contain/);
    });

    it('attaches every held pack key and warns about missing ones', async () => {
        const sdk = makeSdk({
            getFiles: vi.fn(async () => [gatedRow(HASH_A, '100'), gatedRow(HASH_B, '200')]),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const plan = await prepareGatedSend(makeArgs({ sdk, vault }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(plan.missingKeyHashes).toEqual([HASH_B]);
        expect(plan.warnings).toHaveLength(1);
        expect(plan.warnings[0].code).toBe('GATED_SEND_PARTIAL_KEYS');
    });

    it('falls back to the in-memory scan cache under the sending address', async () => {
        const sdk = makeSdk();
        // Seed KEY_CACHE via a scan for the SENDER address: one ECIES
        // message whose payload is 0x01 || KEY_A.
        await scanGatedKeyHandoffs({
            sdk: {
                ...sdk,
                getMessagesForAddress: vi.fn(async () => [
                    { bytes: Buffer.concat([Buffer.from([0x01]), KEY_A]) },
                ]),
            },
            address: 'bcrt1qsender',
            wif: 'WIF',
        });
        const plan = await prepareGatedSend(makeArgs({ sdk, vault: makeVault() }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
    });
});

describe('prepareGatedSend hard blocks', () => {
    it('throws GatedSendKeysMissingError when no pack key is held', async () => {
        const err = await prepareGatedSend(makeArgs()).catch((e) => e);
        expect(err).toBeInstanceOf(GatedSendKeysMissingError);
        expect(err.code).toBe('GATED_SEND_KEYS_MISSING');
        expect(err.missingKeyHashes).toEqual([HASH_A]);
    });

    it('treats a corrupted vault row (hash mismatch) as missing', async () => {
        const vault = makeVault();
        // KEY_B stored under HASH_A: verifyKey fails, row must not be used.
        seedVaultKey(vault, HASH_A, KEY_B.toString('hex'));
        const err = await prepareGatedSend(makeArgs({ vault })).catch((e) => e);
        expect(err).toBeInstanceOf(GatedSendKeysMissingError);
    });

    it('throws GatedRecipientPubkeyMissingError for a never-spent destination', async () => {
        const sdk = makeSdk({ getPublicKey: vi.fn(async () => null) });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const err = await prepareGatedSend(makeArgs({ sdk, vault })).catch((e) => e);
        expect(err).toBeInstanceOf(GatedRecipientPubkeyMissingError);
        expect(err.code).toBe('GATED_SEND_NO_RECIPIENT_PUBKEY');
        expect(err.message).toMatch(/no transaction history/);
    });

    it('throws PubkeyMismatchError when the explorer key does not derive to the destination', async () => {
        const sdk = makeSdk({ getPublicKey: vi.fn(async () => '02'.padEnd(66, 'ee')) });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        await expect(prepareGatedSend(makeArgs({ sdk, vault }))).rejects.toThrow(PubkeyMismatchError);
    });
});

describe('resolveGatedSendKeys', () => {
    it('prefers the vault over the memory cache and verifies every candidate', async () => {
        const sdk = makeSdk();
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const { keysByHash, missingKeyHashes } = await resolveGatedSendKeys({
            sdk, vault, walletId: 'w1', chainId: 'btc-regtest', tick: 'GATED',
            sourceAddress: 'bcrt1qsender',
            groups: [{ keyHash: HASH_A, files: [{ actionIndex: '100' }] }],
        });
        expect(Object.keys(keysByHash)).toEqual([HASH_A]);
        expect(missingKeyHashes).toEqual([]);
        expect(keysByHash[HASH_A].equals(KEY_A)).toBe(true);
    });
});

describe('gatedSendReadiness', () => {
    it('reports ungated for native / ^id / no-group ticks', async () => {
        const sdk = makeSdk({ getFiles: vi.fn(async () => []) });
        const base = makeArgs({ sdk });
        expect((await gatedSendReadiness({ ...base, tick: 'BTC' })).state).toBe('ungated');
        expect((await gatedSendReadiness({ ...base, tick: '^9' })).state).toBe('ungated');
        expect((await gatedSendReadiness({ ...base, tick: 'GATED' })).state).toBe('ungated');
    });

    it('reports ready / partial / blocked from vault key coverage', async () => {
        const sdk = makeSdk({
            getFiles: vi.fn(async () => [gatedRow(HASH_A, '100'), gatedRow(HASH_B, '200')]),
        });
        const vault = makeVault();
        const base = makeArgs({ sdk, vault });

        expect((await gatedSendReadiness(base)).state).toBe('blocked');

        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        clearGatedGroupsCache();
        const partial = await gatedSendReadiness(base);
        expect(partial.state).toBe('partial');
        expect(partial.groups.find((g) => g.keyHash === HASH_A).haveKey).toBe(true);
        expect(partial.groups.find((g) => g.keyHash === HASH_B).haveKey).toBe(false);

        seedVaultKey(vault, HASH_B, KEY_B.toString('hex'));
        clearGatedGroupsCache();
        expect((await gatedSendReadiness(base)).state).toBe('ready');
    });

    it('is secret-free (no keyHex in the report)', async () => {
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const report = await gatedSendReadiness(makeArgs({ vault }));
        expect(JSON.stringify(report)).not.toMatch(KEY_A.toString('hex'));
    });
});
