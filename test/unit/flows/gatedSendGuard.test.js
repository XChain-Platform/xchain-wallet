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
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    prepareGatedSend,
    gatedSendReadiness,
    resolveGatedSendKeys,
    clearGatedGroupsCache,
    gatedGroupThreshold,
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

// --- PC-29 unlock-threshold lane (GATE_MIN_AMOUNT) --------------------
// Inert until the  flag-day train pins activation heights; these
// tests force activation through the test-only `_activationHeights`
// override. Post-activation SEND rule: a pack's key handoff is required
// only when the destination's POST-SEND balance meets the pack's
// threshold; below it the send goes out plain and carries no key.
describe('PC-29 unlock-threshold lane', () => {
    const ACTIVE = { 'btc-regtest': 100 };

    function thresholdRow(keyHash, actionIndex, gateMin) {
        return { ...gatedRow(keyHash, actionIndex), gate_min_amount: gateMin };
    }

    // Watermark 500 (>= scheduled 100); destination holds 2.0 GATED
    // (quantity 20 at 1 decimal), so a '5' send makes post-send 7.0.
    function thresholdSdk(overrides = {}) {
        return makeSdk({
            getStatus: vi.fn(async () => ({ last_block: { RBTC: 500 } })),
            getBalances: vi.fn(async () => ({ data: [{ tick: 'GATED', quantity: '20', decimals: 1 }] })),
            ...overrides,
        });
    }

    it('is fully inert while no activation height is scheduled (frozen map)', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [thresholdRow(HASH_A, '100', '1000000')]),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        // No _activationHeights override: production map, all-null. The
        // absurd threshold must be ignored and the key attached as today.
        const plan = await prepareGatedSend(makeArgs({ sdk, vault }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(sdk.getBalances).not.toHaveBeenCalled();
    });

    it('composes a plain SEND (null) when every pack is below threshold', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [thresholdRow(HASH_A, '100', '100')]),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const plan = await prepareGatedSend(makeArgs({ sdk, vault, _activationHeights: ACTIVE }));
        expect(plan).toBeNull();
        // Plain sends need no recipient pubkey; the rail must not fire.
        expect(sdk.getPublicKey).not.toHaveBeenCalled();
    });

    it('drops below-threshold packs, attaches the rest, and warns', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [
                thresholdRow(HASH_A, '100', '5'),     // post-send 7.0 >= 5: required
                thresholdRow(HASH_B, '200', '100'),   // 7.0 < 100: dropped
            ]),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        seedVaultKey(vault, HASH_B, KEY_B.toString('hex'));
        const plan = await prepareGatedSend(makeArgs({ sdk, vault, _activationHeights: ACTIVE }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(plan.missingKeyHashes).toEqual([]);
        expect(plan.warnings).toHaveLength(1);
        expect(plan.warnings[0].code).toBe('GATED_SEND_BELOW_THRESHOLD');
        // The handoff payload carries ONLY the required pack's key: the
        // publisher's threshold decides who gets KEY_B, not the sender.
        const [payload] = sdk.messaging.eciesEncryptBytes.mock.calls[0];
        expect(payload).toEqual(Buffer.concat([Buffer.from([0x01]), KEY_A]));
    });

    it('a pack containing any threshold-less file stays unconditional', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [
                thresholdRow(HASH_A, '100', '100'),
                gatedRow(HASH_A, '101'),   // same pack, no threshold
            ]),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        const plan = await prepareGatedSend(makeArgs({ sdk, vault, _activationHeights: ACTIVE }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(plan.warnings).toEqual([]);
    });

    it('treats an unreadable destination balance as all-required', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [thresholdRow(HASH_A, '100', '100')]),
            getBalances: vi.fn(async () => { throw new Error('explorer down'); }),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));
        // Attaching anyway always composes a VALID send; guessing "below"
        // could compose a plain SEND the indexer rejects.
        const plan = await prepareGatedSend(makeArgs({ sdk, vault, _activationHeights: ACTIVE }));
        expect(plan.attachedKeyHashes).toEqual([HASH_A]);
        expect(plan.warnings).toEqual([]);
    });

    it('no balance row = zero balance; threshold boundary is inclusive', async () => {
        // Post-send balance is exactly the amount ('5').
        const mkSdk = (thr) => thresholdSdk({
            getFiles: vi.fn(async () => [thresholdRow(HASH_A, '100', thr)]),
            getBalances: vi.fn(async () => ({ data: [] })),
        });
        const vault = makeVault();
        seedVaultKey(vault, HASH_A, KEY_A.toString('hex'));

        const met = await prepareGatedSend(makeArgs({ sdk: mkSdk('5'), vault, _activationHeights: ACTIVE }));
        expect(met.attachedKeyHashes).toEqual([HASH_A]);

        clearGatedGroupsCache();
        const unmet = await prepareGatedSend(makeArgs({ sdk: mkSdk('5.00000001'), vault, _activationHeights: ACTIVE }));
        expect(unmet).toBeNull();
    });

    it('hard-blocks only on missing keys for REQUIRED packs', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [
                thresholdRow(HASH_A, '100', '5'),     // required, key NOT held
                thresholdRow(HASH_B, '200', '100'),   // below threshold
            ]),
        });
        const err = await prepareGatedSend(makeArgs({ sdk, vault: makeVault(), _activationHeights: ACTIVE }))
            .catch((e) => e);
        expect(err).toBeInstanceOf(GatedSendKeysMissingError);
        expect(err.missingKeyHashes).toEqual([HASH_A]);
    });

    it('readiness mirrors the compose lane when to+amount are supplied', async () => {
        const sdk = thresholdSdk({
            getFiles: vi.fn(async () => [thresholdRow(HASH_A, '100', '100')]),
        });
        const base = makeArgs({ sdk, vault: makeVault(), _activationHeights: ACTIVE });

        // Without destination context the probe stays conservative.
        const conservative = await gatedSendReadiness({ ...base, to: null, amount: null });
        expect(conservative.state).toBe('blocked');

        const mirrored = await gatedSendReadiness(base);
        expect(mirrored.state).toBe('ungated');
        expect(mirrored.belowThresholdCount).toBe(1);
    });

    it('gatedGroupThreshold picks the pack minimum and rejects garbage', () => {
        const grp = (files) => ({ keyHash: HASH_A, files });
        expect(gatedGroupThreshold(grp([{ gateMinAmount: '5' }, { gateMinAmount: '2.5' }]))).toBe('2.5');
        expect(gatedGroupThreshold(grp([{ gateMinAmount: '5' }, { gateMinAmount: null }]))).toBeNull();
        expect(gatedGroupThreshold(grp([{ gateMinAmount: 'abc' }]))).toBeNull();
        expect(gatedGroupThreshold(grp([]))).toBeNull();
    });

    // ── Shared vector fixture ( spec section 6.5) ──────────────────────
    // The same vectors the SDK validator and the indexer's FILE handler run, from a
    // byte-identical file. This wallet is the third implementation of the threshold
    // rules and the only one that compares balances, so the pack-minimum and
    // handoff-required halves are its share of the contract. Three suites written
    // separately can agree today and drift tomorrow; one fixture cannot.
    describe('shared GATE_MIN_AMOUNT vectors', () => {
        // Paths are resolved from the package root (vitest's cwd): this config does not
        // give import.meta.url a file: scheme, so a URL-relative read cannot be used.
        const FIXTURE = resolve('test/fixtures/gate-min-amount-vectors.json');
        const vectors = JSON.parse(readFileSync(FIXTURE, 'utf8'));

        it('is byte-identical to the canonical xchain-sdk copy', () => {
            const sibling = resolve('../xchain-sdk/test/fixtures/gate-min-amount-vectors.json');
            if (!existsSync(sibling)) {
                if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1')
                    throw new Error('sibling xchain-sdk fixture missing');
                return;
            }
            expect(readFileSync(sibling, 'utf8')).toBe(readFileSync(FIXTURE, 'utf8'));
        });

        for (const vec of vectors.pack_threshold) {
            it(`pack threshold: ${vec.label}`, () => {
                const files = vec.thresholds.map((t) => ({ gateMinAmount: t }));
                const got = gatedGroupThreshold({ keyHash: HASH_A, files });
                if (vec.effective === null) {
                    expect(got, 'an unconditional pack must return null, not a value').toBeNull();
                } else {
                    // Compared NUMERICALLY per the fixture contract: which equal spelling
                    // is returned is not part of the contract, only the value is.
                    expect(got).not.toBeNull();
                    expect(Number(got)).toBe(Number(vec.effective));
                }
            });
        }

        // The threshold scale is a cross-repo constant twin (spec section 6.2): the
        // indexer bounds a threshold's decimal places at min(tick divisibility, this),
        // precisely because a value with more places cannot be represented in the
        // fixed-scale BigInt comparison here. If the two drift, the two sides disagree
        // on the last digit of a threshold neither considers malformed.
        it('the fixed comparison scale matches the protocol constant', () => {
            const sibling = resolve('../xchain-sdk/src/protocol/constants.js');
            if (!existsSync(sibling)) {
                if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1')
                    throw new Error('sibling xchain-sdk protocol constants missing');
                return;
            }
            const src = readFileSync(sibling, 'utf8');
            const m = /THRESHOLD_SCALE\s*[:=]\s*(\d+)/.exec(src);
            expect(m, 'THRESHOLD_SCALE not found in the sibling protocol constants').toBeTruthy();
            // Read this side from the source rather than importing a private const.
            const own = /THRESHOLD_SCALE\s*=\s*(\d+)/.exec(
                readFileSync(resolve('packages/core/src/flows/gatedSendGuard.js'), 'utf8'));
            expect(own).toBeTruthy();
            expect(own[1]).toBe(m[1]);
        });
    });
});
