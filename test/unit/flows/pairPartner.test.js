// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: flows/pairPartner (§20.5 / ). The watcher <-> signer
// auto-pairing lane.
//
// The load-bearing claim is that two wallets restored from ONE recovery
// phrase pair, and two wallets restored from different phrases do not.
// So the fixtures derive real BIP32 keys with @scure/bip32 rather than
// hand-written hex: a hand-written fixture would pass a comparison that
// real derivation could still get wrong.

import { describe, it, expect } from 'vitest';
import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';
import {
    PARTNER_PAIRING_PREFIX,
    PartnerPairingError,
    partnerModeFor,
    describePairingLane,
    accountPathOf,
    pairingKeyId,
    keySetIdOf,
    collectPairingKeys,
    buildPairingPayload,
    validatePairingPayload,
    encodePairingPayload,
    parsePairingPayload,
    verifyPartnerPairing,
    toPartnerPairingRecord,
    pairPartner,
    partnerPairingOf,
    isPartnerPaired,
    partnerPairingSourceKeys,
} from '../../../packages/core/src/flows/pairPartner.js';
import { accountXpub } from '../../../packages/core/src/crypto/hd.js';

// --- fixtures ---------------------------------------------------------

const SEED_A = new Uint8Array(64).fill(0x11);
const SEED_B = new Uint8Array(64).fill(0x22);

const CHAINS = {
    'bitcoin-mainnet': { defaultAddressType: 'p2wpkh', template: "m/84'/0'/A'/C/I", networkKind: 'mainnet' },
    'litecoin-mainnet': { defaultAddressType: 'p2wpkh', template: "m/84'/2'/A'/C/I", networkKind: 'mainnet' },
    'dogecoin-mainnet': { defaultAddressType: 'p2pkh', template: "m/44'/3'/A'/C/I", networkKind: 'mainnet' },
};

// Stand-in for ChainRegistry: only the three methods collectPairingKeys
// touches, so a registry change that renames one of them fails loudly here.
const registry = {
    descriptorFor: (id) => CHAINS[id],
    get: (id) => CHAINS[id],
    derivationPathFor(chainId, addressType, accountIndex, change, index) {
        const d = CHAINS[chainId];
        if (!d || d.defaultAddressType !== addressType) return null;
        return d.template.replace(/A'\/C\/I$/, `${accountIndex}'/${change}/${index}`);
    },
};

// Stand-in for a SoftwareSigner: same two methods the real one exposes,
// backed by real BIP32 derivation from the given seed.
function mkSigner(seed, { withXpub = true } = {}) {
    const root = HDKey.fromMasterSeed(seed);
    return {
        async getPublicKey({ path }) {
            const child = root.derive(path);
            return {
                publicKey: bytesToHex(child.publicKey),
                chainCode: bytesToHex(child.chainCode),
            };
        },
        ...(withXpub
            ? { async getAccountXpub({ path }) { return accountXpub(root, path); } }
            : {}),
    };
}

const ALL_CHAINS = Object.keys(CHAINS);

async function payloadFor(seed, walletMode, chainIds = ALL_CHAINS, opts = {}) {
    const keys = await collectPairingKeys({
        signer: mkSigner(seed, opts), chainRegistry: registry, chainIds,
    });
    return buildPairingPayload({ walletMode, keys, label: `${walletMode} half` });
}

// --- role helpers -----------------------------------------------------

describe('flows/pairPartner role helpers', () => {
    it('maps each pairable mode to its complement', () => {
        expect(partnerModeFor('watcher')).toBe('signer');
        expect(partnerModeFor('signer')).toBe('watcher');
    });

    it('has no partner for a full wallet or a missing mode', () => {
        expect(partnerModeFor('full')).toBeNull();
        expect(partnerModeFor(undefined)).toBeNull();
        expect(partnerModeFor(null)).toBeNull();
    });

    it('describes the lane with the mode-appropriate call to action', () => {
        const watcher = describePairingLane('watcher');
        expect(watcher.available).toBe(true);
        expect(watcher.partnerMode).toBe('signer');
        expect(watcher.cta).toBe('Pair a signer');

        const signer = describePairingLane('signer');
        expect(signer.available).toBe(true);
        expect(signer.partnerMode).toBe('watcher');
        expect(signer.cta).toBe('Pair a watcher');
    });

    it('reports the lane unavailable for a full wallet', () => {
        const lane = describePairingLane('full');
        expect(lane.available).toBe(false);
        expect(lane.cta).toBeNull();
        expect(lane.help).toMatch(/Watcher and Signer/);
    });
});

// --- path + id helpers ------------------------------------------------

describe('flows/pairPartner accountPathOf', () => {
    it('keeps every leading hardened segment', () => {
        expect(accountPathOf("m/84'/0'/0'/0/5")).toBe("m/84'/0'/0'");
        expect(accountPathOf("m/44'/3'/2'/1/17")).toBe("m/44'/3'/2'");
    });

    it('handles the counterwallet-legacy single-account shape', () => {
        expect(accountPathOf("m/0'/0/5")).toBe("m/0'");
    });

    it('accepts an already-truncated account path unchanged', () => {
        expect(accountPathOf("m/84'/0'/0'")).toBe("m/84'/0'/0'");
    });

    it('rejects a path with no hardened prefix', () => {
        expect(() => accountPathOf('m/0/0')).toThrow(PartnerPairingError);
    });

    it('rejects a non-path string', () => {
        expect(() => accountPathOf('84h/0h')).toThrow(PartnerPairingError);
    });
});

describe('flows/pairPartner key ids', () => {
    it('is stable for the same key material and differs across seeds', async () => {
        const a1 = await mkSigner(SEED_A).getPublicKey({ path: "m/84'/0'/0'" });
        const a2 = await mkSigner(SEED_A).getPublicKey({ path: "m/84'/0'/0'" });
        const b = await mkSigner(SEED_B).getPublicKey({ path: "m/84'/0'/0'" });
        expect(pairingKeyId(a1)).toBe(pairingKeyId(a2));
        expect(pairingKeyId(a1)).not.toBe(pairingKeyId(b));
        expect(pairingKeyId(a1)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects malformed key material rather than hashing it anyway', () => {
        expect(() => pairingKeyId({ publicKey: 'zz', chainCode: 'zz' })).toThrow(PartnerPairingError);
    });

    it('computes a key-set id independent of ordering', () => {
        const keys = [
            { chainId: 'a', keyId: '11'.repeat(32) },
            { chainId: 'b', keyId: '22'.repeat(32) },
        ];
        expect(keySetIdOf(keys)).toBe(keySetIdOf([...keys].reverse()));
    });
});

// --- key collection ---------------------------------------------------

describe('flows/pairPartner collectPairingKeys', () => {
    it('reads one account-level key per chain, with xpub when available', async () => {
        const keys = await collectPairingKeys({
            signer: mkSigner(SEED_A), chainRegistry: registry, chainIds: ALL_CHAINS,
        });
        expect(keys).toHaveLength(3);
        expect(keys.map((k) => k.chainId)).toEqual(ALL_CHAINS);
        expect(keys.map((k) => k.path)).toEqual(["m/84'/0'/0'", "m/84'/2'/0'", "m/44'/3'/0'"]);
        for (const k of keys) {
            expect(k.publicKey).toMatch(/^[0-9a-f]{66}$/);
            expect(k.chainCode).toMatch(/^[0-9a-f]{64}$/);
            expect(k.keyId).toBe(pairingKeyId(k));
            expect(k.xpub).toMatch(/^xpub/);
        }
    });

    it('leaves xpub null for a signer that cannot produce one (hardware)', async () => {
        const keys = await collectPairingKeys({
            signer: mkSigner(SEED_A, { withXpub: false }),
            chainRegistry: registry,
            chainIds: ['bitcoin-mainnet'],
        });
        expect(keys[0].xpub).toBeNull();
        expect(keys[0].keyId).toMatch(/^[0-9a-f]{64}$/);
    });

    it('skips chains the registry does not know', async () => {
        const keys = await collectPairingKeys({
            signer: mkSigner(SEED_A),
            chainRegistry: registry,
            chainIds: ['bitcoin-mainnet', 'nosuch-chain'],
        });
        expect(keys.map((k) => k.chainId)).toEqual(['bitcoin-mainnet']);
    });

    it('throws when no requested chain resolves a path', async () => {
        await expect(collectPairingKeys({
            signer: mkSigner(SEED_A), chainRegistry: registry, chainIds: ['nosuch-chain'],
        })).rejects.toThrow(/no.*chains|derivation path/i);
    });

    it('requires an unlocked signer', async () => {
        await expect(collectPairingKeys({
            signer: null, chainRegistry: registry, chainIds: ALL_CHAINS,
        })).rejects.toThrow(PartnerPairingError);
    });
});

// --- payload build / encode / parse -----------------------------------

describe('flows/pairPartner payload encoding', () => {
    it('round-trips through the prefixed base64url form', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        const encoded = encodePairingPayload(payload);
        expect(encoded.startsWith(PARTNER_PAIRING_PREFIX)).toBe(true);
        expect(parsePairingPayload(encoded)).toEqual(payload);
    });

    it('tolerates surrounding whitespace and a missing prefix', async () => {
        const payload = await payloadFor(SEED_A, 'signer');
        const encoded = encodePairingPayload(payload);
        const bare = encoded.slice(PARTNER_PAIRING_PREFIX.length);
        expect(parsePairingPayload(`  ${encoded}\n`)).toEqual(payload);
        expect(parsePairingPayload(bare)).toEqual(payload);
    });

    it('accepts bare JSON, for a user copying between devices by hand', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        expect(parsePairingPayload(JSON.stringify(payload))).toEqual(payload);
    });

    it('refuses to build a payload for a full wallet', async () => {
        const keys = await collectPairingKeys({
            signer: mkSigner(SEED_A), chainRegistry: registry, chainIds: ALL_CHAINS,
        });
        expect(() => buildPairingPayload({ walletMode: 'full', keys })).toThrow(/watcher or signer/);
    });

    it('rejects an unsupported payload version', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        expect(() => validatePairingPayload({ ...payload, v: 2 })).toThrow(/unsupported payload version/);
    });

    it('rejects a payload whose keyId disagrees with its key material', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        const tampered = {
            ...payload,
            keys: payload.keys.map((k, i) => (i === 0 ? { ...k, keyId: 'ab'.repeat(32) } : k)),
        };
        expect(() => validatePairingPayload(tampered)).toThrow(/truncated or corrupt/);
    });

    it('rejects a payload that lists the same chain twice', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        expect(() => validatePairingPayload({
            ...payload, keys: [payload.keys[0], payload.keys[0]],
        })).toThrow(/twice/);
    });

    it('rejects an empty key set', async () => {
        const payload = await payloadFor(SEED_A, 'watcher');
        expect(() => validatePairingPayload({ ...payload, keys: [] })).toThrow(/non-empty/);
    });

    it('reports a helpful error for empty input', () => {
        expect(() => parsePairingPayload('   ')).toThrow(/paste or scan/i);
    });

    it('reports a helpful error for garbage input', () => {
        expect(() => parsePairingPayload('XCW-PAIR:!!!not-base64!!!')).toThrow(PartnerPairingError);
    });
});

// --- verification -----------------------------------------------------

describe('flows/pairPartner verifyPartnerPairing', () => {
    it('pairs two halves of the same recovery phrase', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_A, 'signer');
        const v = verifyPartnerPairing({ local, partner });
        expect(v.ok).toBe(true);
        expect(v.reason).toBeNull();
        expect(v.sharedChainIds).toEqual(ALL_CHAINS);
        expect(v.mismatchedChainIds).toEqual([]);
        expect(v.localKeySetId).toBe(v.partnerKeySetId);
    });

    it('refuses two wallets built from different recovery phrases', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_B, 'signer');
        const v = verifyPartnerPairing({ local, partner });
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('seed-mismatch');
        expect(v.mismatchedChainIds).toEqual(ALL_CHAINS);
        expect(v.message).toMatch(/different recovery phrases/);
    });

    it('refuses a partner in the same mode (two watchers cannot pair)', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_A, 'watcher');
        const v = verifyPartnerPairing({ local, partner });
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('mode-mismatch');
        expect(v.message).toMatch(/must be in signer mode/);
    });

    it('pairs on the overlap when the offline half has fewer chains switched on', async () => {
        const local = await payloadFor(SEED_A, 'watcher', ALL_CHAINS);
        const partner = await payloadFor(SEED_A, 'signer', ['bitcoin-mainnet']);
        const v = verifyPartnerPairing({ local, partner });
        expect(v.ok).toBe(true);
        expect(v.sharedChainIds).toEqual(['bitcoin-mainnet']);
        // Different chain sets legitimately produce different set ids; the
        // set id is a display fingerprint, never the gate.
        expect(v.localKeySetId).not.toBe(v.partnerKeySetId);
    });

    it('reports no-shared-chains when the two halves overlap on nothing', async () => {
        const local = await payloadFor(SEED_A, 'watcher', ['bitcoin-mainnet']);
        const partner = await payloadFor(SEED_A, 'signer', ['dogecoin-mainnet']);
        const v = verifyPartnerPairing({ local, partner });
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('no-shared-chains');
    });

    it('detects a one-word typo in the phrase even when most chains match', async () => {
        // Same seed for BTC/LTC, a different seed for DOGE: exactly what a
        // partially-corrupted key set looks like on the wire.
        const local = await payloadFor(SEED_A, 'watcher', ALL_CHAINS);
        const good = await payloadFor(SEED_A, 'signer', ALL_CHAINS);
        const bad = await payloadFor(SEED_B, 'signer', ALL_CHAINS);
        const mixed = validatePairingPayload({
            ...good,
            keys: [good.keys[0], good.keys[1], bad.keys[2]],
        });
        const v = verifyPartnerPairing({ local, partner: mixed });
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('seed-mismatch');
        expect(v.mismatchedChainIds).toEqual(['dogecoin-mainnet']);
    });
});

// --- persistence shape ------------------------------------------------

describe('flows/pairPartner record + settings helpers', () => {
    it('produces a settings patch holding the partner key set', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_A, 'signer');
        const { record, patch, verification } = pairPartner({
            local, partner: encodePairingPayload(partner), pairedAt: '2026-07-26T00:00:00.000Z',
        });
        expect(verification.ok).toBe(true);
        expect(patch.partnerPairing).toBe(record);
        expect(record.walletMode).toBe('signer');
        expect(record.keys).toHaveLength(3);
        expect(record.keySetId).toBe(keySetIdOf(partner.keys));
        expect(record.sharedChainIds).toEqual(ALL_CHAINS);
        expect(record.pairedAt).toBe('2026-07-26T00:00:00.000Z');
    });

    it('never puts private material into the persisted record', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_A, 'signer');
        const { record } = pairPartner({ local, partner });
        const serialized = JSON.stringify(record);
        expect(serialized).not.toMatch(/xprv/);
        expect(serialized).not.toMatch(/privateKey/i);
        expect(serialized).not.toMatch(/mnemonic/i);
    });

    it('throws with the machine-readable reason when the halves disagree', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_B, 'signer');
        try {
            pairPartner({ local, partner });
            throw new Error('expected pairPartner to throw');
        } catch (err) {
            expect(err).toBeInstanceOf(PartnerPairingError);
            expect(err.reason).toBe('seed-mismatch');
        }
    });

    it('refuses to build a record from an unverified pairing', async () => {
        const partner = await payloadFor(SEED_A, 'signer');
        expect(() => toPartnerPairingRecord({
            partner, verification: { ok: false, reason: 'seed-mismatch', sharedChainIds: [] },
        })).toThrow(/unverified/);
    });

    it('reads the pairing back off a settings record', async () => {
        const local = await payloadFor(SEED_A, 'watcher');
        const partner = await payloadFor(SEED_A, 'signer');
        const { record } = pairPartner({ local, partner });
        const settings = { partnerPairing: record };
        expect(isPartnerPaired(settings)).toBe(true);
        expect(partnerPairingOf(settings)).toBe(record);
        expect(partnerPairingSourceKeys(settings)).toHaveLength(3);
    });

    it('treats an absent / null pairing as unpaired', () => {
        expect(isPartnerPaired(null)).toBe(false);
        expect(isPartnerPaired({})).toBe(false);
        expect(isPartnerPaired({ partnerPairing: null })).toBe(false);
        expect(partnerPairingSourceKeys({ partnerPairing: null })).toEqual([]);
    });
});
