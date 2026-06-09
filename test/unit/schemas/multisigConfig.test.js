// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: schemas/multisigConfig — validateMultisigConfig + buildMultisigConfig.

import { describe, it, expect } from 'vitest';
import {
    validateMultisigConfig,
    buildMultisigConfig,
    MULTISIG_SCHEMES,
    COSIGNER_ORIGINS,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/multisigConfig.js';

const NOW = new Date().toISOString();
const PK_A = '02' + 'a'.repeat(64);
const PK_B = '03' + 'b'.repeat(64);
const PK_C = '02' + 'c'.repeat(64);

const BASE_COSIGNER_A = {
    name: 'Alice',
    pubkey: PK_A,
    fingerprint: 'aabbccdd',
    origin: 'local',
    localSignerId: 'signer-1',
    xpub: null,
    derivationPath: "m/48'/0'/0'/2'",
    addedAt: NOW,
};

const BASE_COSIGNER_B = {
    name: 'Bob',
    pubkey: PK_B,
    fingerprint: 'eeff0011',
    origin: 'external-xpub',
    localSignerId: null,
    xpub: 'xpub661MyMwAqRb...',
    derivationPath: "m/48'/0'/0'/2'",
    addedAt: NOW,
};

const BASE_CONFIG = {
    schemaVersion: CURRENT_VERSION,
    id: 'cfg-1',
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosigners: [BASE_COSIGNER_A, BASE_COSIGNER_B],
    scriptTemplate: `multi:2:${PK_A.toLowerCase()}:${PK_B.toLowerCase()}`,
};

describe('MULTISIG_SCHEMES', () => {
    it('contains expected schemes', () => {
        expect(MULTISIG_SCHEMES).toContain('p2sh-multisig');
        expect(MULTISIG_SCHEMES).toContain('p2wsh-multisig');
        expect(MULTISIG_SCHEMES).toContain('taproot-musig2');
    });
});

describe('COSIGNER_ORIGINS', () => {
    it('contains local, external-xpub, external-hardware', () => {
        expect(COSIGNER_ORIGINS).toContain('local');
        expect(COSIGNER_ORIGINS).toContain('external-xpub');
        expect(COSIGNER_ORIGINS).toContain('external-hardware');
    });
});

describe('validateMultisigConfig', () => {
    it('accepts a valid p2wsh-multisig config', () => {
        const r = validateMultisigConfig(BASE_CONFIG);
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('rejects non-object input', () => {
        expect(validateMultisigConfig(null).ok).toBe(false);
        expect(validateMultisigConfig('x').ok).toBe(false);
        expect(validateMultisigConfig(42).ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, schemaVersion: 1 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects empty id', () => {
        expect(validateMultisigConfig({ ...BASE_CONFIG, id: '' }).ok).toBe(false);
    });

    it('rejects invalid scheme', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, scheme: 'unknown' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('scheme'))).toBe(true);
    });

    it('rejects threshold 0', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, threshold: 0 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('threshold'))).toBe(true);
    });

    it('rejects threshold > cosigners.length', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, threshold: 3 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('threshold'))).toBe(true);
    });

    it('rejects fewer than 2 cosigners', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [BASE_COSIGNER_A] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('cosigners'))).toBe(true);
    });

    it('rejects non-array cosigners', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: 'bad' });
        expect(r.ok).toBe(false);
    });

    it('rejects duplicate cosigner pubkeys', () => {
        const dupCosigner = { ...BASE_COSIGNER_B, pubkey: PK_A };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [BASE_COSIGNER_A, dupCosigner] });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('duplicate pubkey'))).toBe(true);
    });

    it('rejects taproot-musig2 when threshold !== cosigners.length', () => {
        const musigConfig = {
            ...BASE_CONFIG,
            scheme: 'taproot-musig2',
            threshold: 1,
            cosigners: [BASE_COSIGNER_A, BASE_COSIGNER_B],
            scriptTemplate: `musig2:${'ab'.repeat(32)}`,
        };
        const r = validateMultisigConfig(musigConfig);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('taproot-musig2'))).toBe(true);
    });

    it('accepts taproot-musig2 when threshold === cosigners.length', () => {
        const aggKey = 'ab'.repeat(32);
        const musigConfig = {
            schemaVersion: CURRENT_VERSION,
            id: 'cfg-musig2',
            scheme: 'taproot-musig2',
            threshold: 2,
            cosigners: [BASE_COSIGNER_A, BASE_COSIGNER_B],
            scriptTemplate: `musig2:${aggKey}`,
        };
        const r = validateMultisigConfig(musigConfig);
        expect(r.ok).toBe(true);
    });

    it('rejects empty scriptTemplate', () => {
        const r = validateMultisigConfig({ ...BASE_CONFIG, scriptTemplate: '' });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed cosigner — missing name', () => {
        const bad = { ...BASE_COSIGNER_A, name: '' };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [bad, BASE_COSIGNER_B] });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed cosigner — invalid origin', () => {
        const bad = { ...BASE_COSIGNER_A, origin: 'unknown' };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [bad, BASE_COSIGNER_B] });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed cosigner — empty string localSignerId', () => {
        const bad = { ...BASE_COSIGNER_A, localSignerId: '' };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [bad, BASE_COSIGNER_B] });
        expect(r.ok).toBe(false);
    });

    it('accepts cosigner with null localSignerId', () => {
        const good = { ...BASE_COSIGNER_A, localSignerId: null };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [good, BASE_COSIGNER_B] });
        expect(r.ok).toBe(true);
    });

    it('rejects malformed cosigner — empty string xpub', () => {
        const bad = { ...BASE_COSIGNER_B, xpub: '' };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [BASE_COSIGNER_A, bad] });
        expect(r.ok).toBe(false);
    });

    it('accepts cosigner with null xpub', () => {
        const good = { ...BASE_COSIGNER_B, xpub: null };
        const r = validateMultisigConfig({ ...BASE_CONFIG, cosigners: [BASE_COSIGNER_A, good] });
        expect(r.ok).toBe(true);
    });
});

describe('buildMultisigConfig', () => {
    const COSIGNER_A_NO_ADDED_AT = {
        name: 'Alice',
        pubkey: PK_A,
        fingerprint: 'aabbccdd',
        origin: 'local',
        localSignerId: 'signer-1',
        xpub: null,
        derivationPath: "m/48'/0'/0'/2'",
    };
    const COSIGNER_B_NO_ADDED_AT = {
        name: 'Bob',
        pubkey: PK_B,
        fingerprint: 'eeff0011',
        origin: 'external-xpub',
        localSignerId: null,
        xpub: 'xpub661...',
        derivationPath: "m/48'/0'/0'/2'",
    };

    it('builds a p2wsh-multisig config', () => {
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        });
        expect(cfg.scheme).toBe('p2wsh-multisig');
        expect(cfg.threshold).toBe(2);
        expect(cfg.cosigners).toHaveLength(2);
        expect(cfg.scriptTemplate).toMatch(/^multi:2:/);
        expect(cfg.scriptTemplate).toContain(PK_A.toLowerCase());
        expect(typeof cfg.id).toBe('string');
        expect(cfg.schemaVersion).toBe(CURRENT_VERSION);
        const r = validateMultisigConfig(cfg);
        expect(r.ok).toBe(true);
    });

    it('builds a taproot-musig2 config', () => {
        const aggKey = 'cd'.repeat(32);
        const cfg = buildMultisigConfig({
            scheme: 'taproot-musig2',
            threshold: 2,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
            aggregatedXOnlyPubkey: aggKey,
        });
        expect(cfg.scheme).toBe('taproot-musig2');
        expect(cfg.scriptTemplate).toBe(`musig2:${aggKey.toLowerCase()}`);
        expect(validateMultisigConfig(cfg).ok).toBe(true);
    });

    it('uses provided id when given', () => {
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
            id: 'my-stable-id',
        });
        expect(cfg.id).toBe('my-stable-id');
    });

    it('generates an id when not provided', () => {
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        });
        expect(typeof cfg.id).toBe('string');
        expect(cfg.id.length).toBeGreaterThan(0);
    });

    it('throws when input is null', () => {
        expect(() => buildMultisigConfig(null)).toThrow(/input is required/);
    });

    it('throws on invalid scheme', () => {
        expect(() => buildMultisigConfig({
            scheme: 'unknown',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        })).toThrow(/scheme/);
    });

    it('throws when fewer than 2 cosigners', () => {
        expect(() => buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT],
        })).toThrow(/cosigners/);
    });

    it('throws on non-positive threshold', () => {
        expect(() => buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 0,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        })).toThrow(/threshold/);
    });

    it('throws when threshold > cosigners.length', () => {
        expect(() => buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 3,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        })).toThrow(/threshold/);
    });

    it('throws when taproot-musig2 threshold !== cosigners.length', () => {
        expect(() => buildMultisigConfig({
            scheme: 'taproot-musig2',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
            aggregatedXOnlyPubkey: 'ab'.repeat(32),
        })).toThrow(/taproot-musig2/);
    });

    it('throws when taproot-musig2 missing aggregatedXOnlyPubkey', () => {
        expect(() => buildMultisigConfig({
            scheme: 'taproot-musig2',
            threshold: 2,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        })).toThrow(/aggregatedXOnlyPubkey/);
    });

    it('throws when taproot-musig2 aggregatedXOnlyPubkey is empty string', () => {
        expect(() => buildMultisigConfig({
            scheme: 'taproot-musig2',
            threshold: 2,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
            aggregatedXOnlyPubkey: '',
        })).toThrow(/aggregatedXOnlyPubkey/);
    });

    it('fills in addedAt timestamps for cosigners', () => {
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 1,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT],
        });
        for (const c of cfg.cosigners) {
            expect(typeof c.addedAt).toBe('string');
            expect(Number.isFinite(Date.parse(c.addedAt))).toBe(true);
        }
    });

    it('lowercases pubkeys in p2wsh scriptTemplate', () => {
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 1,
            cosigners: [
                { ...COSIGNER_A_NO_ADDED_AT, pubkey: PK_A.toUpperCase() },
                COSIGNER_B_NO_ADDED_AT,
            ],
        });
        expect(cfg.scriptTemplate).not.toContain(PK_A.toUpperCase());
        expect(cfg.scriptTemplate).toContain(PK_A.toLowerCase());
    });

    it('builds 3-cosigner config with threshold 2', () => {
        const COSIGNER_C = { ...COSIGNER_A_NO_ADDED_AT, name: 'Carol', pubkey: PK_C, fingerprint: '12345678' };
        const cfg = buildMultisigConfig({
            scheme: 'p2wsh-multisig',
            threshold: 2,
            cosigners: [COSIGNER_A_NO_ADDED_AT, COSIGNER_B_NO_ADDED_AT, COSIGNER_C],
        });
        expect(cfg.threshold).toBe(2);
        expect(cfg.cosigners).toHaveLength(3);
        expect(validateMultisigConfig(cfg).ok).toBe(true);
    });
});
