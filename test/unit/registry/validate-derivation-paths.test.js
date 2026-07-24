// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: validateChainDescriptor derivation-path template guards.
//
// Bundled descriptors are safe by construction, but Developer-Mode custom
// chains and signed remote-registry descriptors flow through the same
// validator. Two seams were unguarded: (1) derivationPaths templates were
// checked only as non-empty strings, so a malformed template silently
// expanded to a wrong-but-plausible path in derivationPathFor's placeholder
// substitution; (2) a descriptor overriding a bundled id could carry a
// drifted SLIP-44 coin-type slot (the classic 1' "testnet fix"), deriving
// addresses the backend does not watch (funds appear missing). These tests
// pin both the template-shape check and the family coin-type-slot parity.

import { describe, it, expect } from 'vitest';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';
import {
    BUNDLED_DESCRIPTORS,
    ChainRegistry,
    FAMILY_MAINNET_COIN_TYPE_SLOT,
    FAMILY_NETWORK_WIF_BYTE,
} from '../../../packages/core/src/registry/index.js';

const btcMainnet = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');
const btcTestnet = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-testnet');
const btcRegtest = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');

// Merge onto the base descriptor's existing paths so only the overridden
// addressType changes (descriptors require a template for every addressType).
function withPaths(base, derivationPaths) {
    return { ...base, derivationPaths: { ...base.derivationPaths, ...derivationPaths } };
}

describe('validateChainDescriptor: derivation-path template shape', () => {
    it('accepts every bundled descriptor unchanged', () => {
        for (const d of BUNDLED_DESCRIPTORS) {
            const res = validateChainDescriptor(d);
            expect(res.ok, `${d.id}: ${res.errors?.join('; ')}`).toBe(true);
        }
    });

    it('rejects a template with a stray placeholder-colliding segment (Index)', () => {
        const res = validateChainDescriptor(
            withPaths(btcMainnet, { p2wpkh: "m/84'/0'/A'/C/Index" }),
        );
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/derivationPaths/);
    });

    it('rejects a template with an uppercase leading M', () => {
        const res = validateChainDescriptor(
            withPaths(btcMainnet, { p2wpkh: "M/84'/0'/A'/C/I" }),
        );
        expect(res.ok).toBe(false);
    });

    it('rejects a template missing the hardened coin-type segment', () => {
        const res = validateChainDescriptor(
            withPaths(btcMainnet, { p2wpkh: "m/84'/A'/C/I" }),
        );
        expect(res.ok).toBe(false);
    });
});

describe('validateChainDescriptor: family coin-type slot parity', () => {
    it('rejects a bitcoin descriptor whose slot drifts to the SLIP-44 1 testnet slot', () => {
        const res = validateChainDescriptor(
            withPaths(btcTestnet, { p2wpkh: "m/84'/1'/A'/C/I" }),
        );
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/coin-type slot/);
    });

    it('accepts a bitcoin descriptor keeping the 0 mainnet slot on testnet', () => {
        const res = validateChainDescriptor(
            withPaths(btcTestnet, { p2wpkh: "m/84'/0'/A'/C/I" }),
        );
        expect(res.ok).toBe(true);
    });

    it('leaves an unknown coin family unconstrained', () => {
        const res = validateChainDescriptor({
            ...btcMainnet,
            id: 'forkcoin-mainnet',
            coin: 'forkcoin',
            addressTypes: ['p2pkh'],
            defaultAddressType: 'p2pkh',
            derivationPaths: { p2pkh: "m/44'/9999'/A'/C/I" },
        });
        expect(res.ok, res.errors?.join('; ')).toBe(true);
    });

    it('the promoted family map matches the bundled descriptors', () => {
        for (const d of BUNDLED_DESCRIPTORS) {
            const slot = FAMILY_MAINNET_COIN_TYPE_SLOT[d.coin];
            if (!slot) continue;
            for (const template of Object.values(d.derivationPaths)) {
                expect(template.match(/^m\/\d+'\/(\d+')\//)[1]).toBe(slot);
            }
        }
    });

    // The per-template loops above `continue` when a bundled coin has no map
    // entry, so a NEW bundled family added without registering it in the family
    // maps would be pinned by nothing and still pass. This dedicated
    // completeness check fails loud instead: every bundled coin MUST appear in
    // both the coin-type slot map and the WIF-byte map. Genuinely custom /
    // non-bundled chains stay intentionally unconstrained and are not checked.
    // A reserved bundled id must not be overridable with a mismatched coin,
    // which would dodge both coin-keyed parity pins.
    it('rejects a reserved id (bitcoin-mainnet) carrying a mismatched coin', () => {
        const res = validateChainDescriptor({ ...btcMainnet, coin: 'btc' });
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/coin/);
    });

    it('leaves a genuinely custom id (forkcoin-mainnet) unconstrained on coin', () => {
        const res = validateChainDescriptor({
            ...btcMainnet,
            id: 'forkcoin-mainnet',
            coin: 'forkcoin',
            addressTypes: ['p2pkh'],
            defaultAddressType: 'p2pkh',
            derivationPaths: { p2pkh: "m/44'/9999'/A'/C/I" },
        });
        expect(res.ok, res.errors?.join('; ')).toBe(true);
    });

    it('accepts every bundled descriptor unchanged (reserved-id check is consistent)', () => {
        for (const d of BUNDLED_DESCRIPTORS) {
            const res = validateChainDescriptor(d);
            expect(res.ok, `${d.id}: ${res.errors?.join('; ')}`).toBe(true);
        }
    });

    it('every bundled coin family is registered in both family maps', () => {
        const coins = [...new Set(BUNDLED_DESCRIPTORS.map((d) => d.coin))];
        for (const coin of coins) {
            expect(
                FAMILY_MAINNET_COIN_TYPE_SLOT[coin],
                `bundled family "${coin}" is missing from FAMILY_MAINNET_COIN_TYPE_SLOT`,
            ).toBeTruthy();
            expect(
                FAMILY_NETWORK_WIF_BYTE[coin],
                `bundled family "${coin}" is missing from FAMILY_NETWORK_WIF_BYTE`,
            ).toBeTruthy();
        }
    });
});

describe('validateChainDescriptor: family WIF-version-byte parity', () => {
    it('rejects a bitcoin-regtest descriptor carrying the mainnet WIF byte (0x80)', () => {
        const res = validateChainDescriptor({ ...btcRegtest, wifVersionByte: 0x80 });
        expect(res.ok).toBe(false);
        expect(res.errors.join(' ')).toMatch(/wifVersionByte/);
    });

    it('accepts a bitcoin-regtest descriptor with the correct regtest WIF byte (0xef)', () => {
        const res = validateChainDescriptor({ ...btcRegtest, wifVersionByte: 0xef });
        expect(res.ok, res.errors?.join('; ')).toBe(true);
    });

    it('leaves an unknown coin family unconstrained on wifVersionByte', () => {
        const res = validateChainDescriptor({
            ...btcMainnet,
            id: 'forkcoin-mainnet',
            coin: 'forkcoin',
            addressTypes: ['p2pkh'],
            defaultAddressType: 'p2pkh',
            derivationPaths: { p2pkh: "m/44'/9999'/A'/C/I" },
            wifVersionByte: 0x42,
        });
        expect(res.ok, res.errors?.join('; ')).toBe(true);
    });

    it('the promoted WIF-byte map matches the bundled descriptors', () => {
        for (const d of BUNDLED_DESCRIPTORS) {
            const expected = FAMILY_NETWORK_WIF_BYTE[d.coin]?.[d.networkKind];
            if (expected === undefined) continue;
            expect(d.wifVersionByte).toBe(expected);
        }
    });
});

describe('applyRemoteDescriptors / addCustom reject drifted descriptors', () => {
    it('applyRemoteDescriptors throws on a slot-drifted override of a bundled id', () => {
        const reg = new ChainRegistry();
        expect(() =>
            reg.applyRemoteDescriptors([withPaths(btcTestnet, { p2wpkh: "m/84'/1'/A'/C/I" })]),
        ).toThrow(/invalid remote descriptor/);
    });

    it('applyRemoteDescriptors installs a correctly-anchored override', () => {
        const reg = new ChainRegistry();
        const res = reg.applyRemoteDescriptors([
            withPaths(btcTestnet, { ...btcTestnet.derivationPaths }),
        ]);
        expect(res.updated).toContain('bitcoin-testnet');
    });

    it('applyRemoteDescriptors throws on a WIF-byte-drifted override of a bundled id', () => {
        const reg = new ChainRegistry();
        expect(() =>
            reg.applyRemoteDescriptors([{ ...btcRegtest, wifVersionByte: 0x80 }]),
        ).toThrow(/invalid remote descriptor/);
    });

    it('addCustom throws on a WIF-byte-drifted override for a known family', () => {
        const reg = new ChainRegistry();
        expect(() =>
            reg.addCustom({ ...btcRegtest, id: 'bitcoin-regtest-evil', wifVersionByte: 0x80 }),
        ).toThrow();
    });

    it('addCustom throws on a malformed template', () => {
        const reg = new ChainRegistry();
        expect(() =>
            reg.addCustom({
                ...btcMainnet,
                id: 'forkcoin-mainnet',
                coin: 'forkcoin',
                derivationPaths: { p2pkh: "m/44'/9'/A'/C/Index" },
            }),
        ).toThrow();
    });
});
