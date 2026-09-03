// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch Step 4 of 7: Per-address multisig
// configs (closes FOLLOWUP 3 from 2026-04-24_phase4-close.md).

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    CURRENT_VERSION as WALLET_VERSION,
    validateWallet,
} from '../../../packages/core/src/schemas/wallet.js';
import {
    CURRENT_VERSION as MULTISIG_VERSION,
    validateMultisigConfig,
    buildMultisigConfig,
} from '../../../packages/core/src/schemas/multisigConfig.js';
import { migrateWallet, migrateMultisigConfig } from '../../../packages/core/src/schemas/migrations.js';
import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// ─── Schema versions bumped ──────────────────────────────────

// v3 added the stored BIP39 passphrase (§15.6); the multisig array this
// smoke covers arrived in v2 and is unchanged by that bump.
assert.equal(WALLET_VERSION, 3, 'Wallet schema is at v3');
assert.equal(MULTISIG_VERSION, 2, 'MultisigConfig schema is at v2');

// ─── buildMultisigConfig assigns an id ────────────────────────

const alice = '02' + 'a'.repeat(64);
const bob = '03' + 'b'.repeat(64);
const carol = '02' + 'c'.repeat(64);

const cfg1 = buildMultisigConfig({
    scheme: 'p2wsh-multisig',
    threshold: 2,
    cosigners: [
        { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
          localSignerId: 's1', xpub: null, derivationPath: "m/48'/0'/0'/2'/0/0" },
        { name: 'B', pubkey: bob, fingerprint: '55667788', origin: 'external-xpub',
          localSignerId: null, xpub: 'xpubB', derivationPath: "m/48'/0'/0'/2'/0/0" },
    ],
});
assert.ok(typeof cfg1.id === 'string' && cfg1.id.length > 0,
    'buildMultisigConfig auto-assigns an id when none supplied');
assert.equal(cfg1.schemaVersion, 2, 'newly-built MultisigConfig is at v2');
assert.equal(validateMultisigConfig(cfg1).ok, true,
    'auto-built v2 config validates');

// Caller-supplied id is honored.
const cfg2 = buildMultisigConfig({
    id: 'custom-id-1',
    scheme: 'p2sh-multisig',
    threshold: 2,
    cosigners: [
        { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
          localSignerId: 's1', xpub: null, derivationPath: "m/48'/0'/0'/2'/0/0" },
        { name: 'B', pubkey: carol, fingerprint: '99aabbcc', origin: 'external-xpub',
          localSignerId: null, xpub: 'xpubC', derivationPath: "m/48'/0'/0'/2'/0/0" },
    ],
});
assert.equal(cfg2.id, 'custom-id-1',
    'buildMultisigConfig honors a caller-supplied id');

// ─── Wallet v1 → v2 migration ─────────────────────────────────

// Legacy v1 record: single-slot `multisig` with no id.
const legacyV1 = {
    schemaVersion: 1,
    id: 'wallet-1',
    name: 'Legacy',
    createdAt: '2026-01-01T00:00:00Z',
    origin: 'imported-mnemonic',
    format: 'bip39',
    passphraseEnabled: false,
    encryptionAlgorithm: 'aes-256-gcm',
    encryptedSeed: 'aGVsbG8=',
    kdfParams: { algorithm: 'argon2id', salt: 'c2FsdA==', iterations: 1, memory: 1, parallelism: 1 },
    importedKeys: [],
    multisig: {
        // v1 had no `id` or `schemaVersion: 2`; the migration adds them.
        schemaVersion: 1,
        scheme: 'p2wsh-multisig',
        threshold: 2,
        scriptTemplate: `multi:2:${alice}:${bob}`,
        cosigners: [
            { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
              localSignerId: 's1', xpub: null, derivationPath: "m/48'/0'/0'/2'/0/0",
              addedAt: '2026-01-01T00:00:00Z' },
            { name: 'B', pubkey: bob, fingerprint: '55667788', origin: 'external-xpub',
              localSignerId: null, xpub: 'xpubB', derivationPath: "m/48'/0'/0'/2'/0/0",
              addedAt: '2026-01-01T00:00:00Z' },
        ],
    },
};

const migratedV2 = migrateWallet(legacyV1);
assert.equal(migratedV2.schemaVersion, 3, 'wallet migrates to v3');
assert.equal(migratedV2.encryptedPassphrase, null,
    'the v2 to v3 step seeds encryptedPassphrase null');
assert.equal(migratedV2.multisig, undefined,
    'legacy `multisig` slot is stripped after migration');
assert.ok(Array.isArray(migratedV2.multisigs) && migratedV2.multisigs.length === 1,
    'multisigs array carries the migrated config');
const migratedConfig = migratedV2.multisigs[0];
assert.ok(typeof migratedConfig.id === 'string'
    && migratedConfig.id.startsWith('legacy-'),
    'migrated config gets a synthetic legacy- id');
assert.equal(migratedConfig.schemaVersion, 2,
    'migrated MultisigConfig is at v2');
assert.equal(migratedConfig.scheme, 'p2wsh-multisig');
assert.equal(migratedConfig.threshold, 2);
assert.equal(validateWallet(migratedV2).ok, true,
    'migrated wallet passes validation');

// Legacy v1 with no multisig at all → empty multisigs array.
const legacyEmpty = { ...legacyV1, multisig: null };
const migratedEmpty = migrateWallet(legacyEmpty);
assert.deepEqual(migratedEmpty.multisigs, [],
    'wallet with no multisig migrates to empty array');
assert.equal(migratedEmpty.multisig, undefined,
    'legacy slot gone in the no-multisig case too');

// MultisigConfig v1 record (without id) migrates to v2 with synthetic id.
const legacyConfigV1 = {
    schemaVersion: 1,
    scheme: 'p2sh-multisig',
    threshold: 2,
    scriptTemplate: `multi:2:${alice}:${bob}`,
    cosigners: legacyV1.multisig.cosigners,
};
const migratedConfigStandalone = migrateMultisigConfig(legacyConfigV1);
assert.equal(migratedConfigStandalone.schemaVersion, 2);
assert.ok(typeof migratedConfigStandalone.id === 'string'
    && migratedConfigStandalone.id.startsWith('legacy-'),
    'standalone config migration synthesizes a legacy- id');

// ─── Wallet validator rejects duplicate config ids ────────────

const badWallet = {
    ...migratedV2,
    multisigs: [migratedConfig, { ...migratedConfig }],
};
assert.equal(validateWallet(badWallet).ok, false,
    'wallet validator rejects duplicate multisig config ids');
const errs = validateWallet(badWallet).errors.join(' ');
assert.ok(/duplicate id/.test(errs),
    'duplicate-id error mentions the constraint by name');

// ─── createMultisigConfig appends to multisigs[] ─────────────

{
    /** @type {Map<string, any>} */
    const wallets = new Map();
    wallets.set('w', { id: 'w', multisigs: [], name: 'W', createdAt: '2026-01-01T00:00:00Z',
        origin: 'created', format: 'bip39', passphraseEnabled: false,
        encryptionAlgorithm: 'aes-256-gcm', encryptedSeed: 'a',
        kdfParams: { algorithm: 'argon2id', salt: 'c2FsdA==', iterations: 1, memory: 1, parallelism: 1 },
        importedKeys: [] });
    const vault = {
        wallets: {
            async get(id) { return wallets.get(id) || null; },
            async put(rec) { wallets.set(rec.id, rec); },
        },
    };
    const sdkRegistry = {
        get() {
            return { musig2: { aggregateKeys() { return { xOnlyPubkey: new Uint8Array(32) }; } } };
        },
    };

    const r1 = await flows.createMultisigConfig({
        vault, sdkRegistry,
        chainId: 'bitcoin-mainnet', walletId: 'w',
        scheme: 'p2wsh-multisig', threshold: 2,
        cosigners: [
            { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
              localSignerId: 's1', derivationPath: "m/48'/0'/0'/2'/0/0" },
            { name: 'B', pubkey: bob, fingerprint: '55667788', origin: 'external-xpub',
              xpub: 'xpubB', derivationPath: "m/48'/0'/0'/2'/0/0" },
        ],
    });
    assert.equal(r1.wallet.multisigs.length, 1,
        'first config appended to multisigs[]');

    const r2 = await flows.createMultisigConfig({
        vault, sdkRegistry,
        chainId: 'bitcoin-mainnet', walletId: 'w',
        scheme: 'p2sh-multisig', threshold: 2,
        cosigners: [
            { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
              localSignerId: 's1', derivationPath: "m/48'/0'/0'/2'/0/0" },
            { name: 'C', pubkey: carol, fingerprint: 'aabbccdd', origin: 'external-xpub',
              xpub: 'xpubC', derivationPath: "m/48'/0'/0'/2'/0/0" },
        ],
    });
    assert.equal(r2.wallet.multisigs.length, 2,
        'second config appends; wallet now has two configs');
    assert.notEqual(r1.config.id, r2.config.id,
        'each config gets a distinct id');

    // Duplicate scriptTemplate rejected.
    await assert.rejects(
        async () => flows.createMultisigConfig({
            vault, sdkRegistry,
            chainId: 'bitcoin-mainnet', walletId: 'w',
            scheme: 'p2wsh-multisig', threshold: 2,
            cosigners: [
                { name: 'A', pubkey: alice, fingerprint: '11223344', origin: 'local',
                  localSignerId: 's1', derivationPath: "m/48'/0'/0'/2'/0/0" },
                { name: 'B', pubkey: bob, fingerprint: '55667788', origin: 'external-xpub',
                  xpub: 'xpubB', derivationPath: "m/48'/0'/0'/2'/0/0" },
            ],
        }),
        /already has a multisig configuration with this scriptTemplate/,
        'duplicate scriptTemplate rejected (same cosigners + scheme = same template)',
    );
}

// ─── receiveMultisigAddress + multisigConfigId routing ───────

assert.equal(typeof flows.listMultisigReceiveAddresses, 'function',
    'flows.listMultisigReceiveAddresses re-exported');

{
    const wallet = {
        id: 'wp', multisigs: [
            {
                id: 'cfg-A', schemaVersion: 2, scheme: 'p2wsh-multisig',
                threshold: 2, scriptTemplate: `multi:2:${alice}:${bob}`,
                cosigners: [{ name: 'A' }, { name: 'B' }],
            },
            {
                id: 'cfg-B', schemaVersion: 2, scheme: 'p2sh-multisig',
                threshold: 2, scriptTemplate: `multi:2:${alice}:${carol}`,
                cosigners: [{ name: 'A' }, { name: 'C' }],
            },
        ],
    };
    const vault = {
        wallets: { async get(id) { return id === 'wp' ? wallet : null; } },
    };
    const sdkRegistry = {
        get() {
            return {
                deriveMultisigAddress({ scheme }) {
                    return { address: `addr-${scheme}`, witnessScript: 'aa' };
                },
            };
        },
    };

    const a = await flows.receiveMultisigAddress({
        vault, sdkRegistry, walletId: 'wp', chainId: 'bitcoin-mainnet',
        multisigConfigId: 'cfg-A',
    });
    assert.equal(a.multisigConfigId, 'cfg-A');
    assert.equal(a.address, 'addr-p2wsh-multisig');

    const b = await flows.receiveMultisigAddress({
        vault, sdkRegistry, walletId: 'wp', chainId: 'bitcoin-mainnet',
        multisigConfigId: 'cfg-B',
    });
    assert.equal(b.multisigConfigId, 'cfg-B');
    assert.equal(b.address, 'addr-p2sh-multisig');

    // Default (no multisigConfigId) returns the first config.
    const def = await flows.receiveMultisigAddress({
        vault, sdkRegistry, walletId: 'wp', chainId: 'bitcoin-mainnet',
    });
    assert.equal(def.multisigConfigId, 'cfg-A',
        'default returns the first config in the array');

    // Unknown id rejected.
    await assert.rejects(
        async () => flows.receiveMultisigAddress({
            vault, sdkRegistry, walletId: 'wp', chainId: 'bitcoin-mainnet',
            multisigConfigId: 'cfg-Z',
        }),
        /no multisig config with id "cfg-Z"/,
    );

    // listMultisigReceiveAddresses returns BOTH.
    const list = await flows.listMultisigReceiveAddresses({
        vault, sdkRegistry, walletId: 'wp', chainId: 'bitcoin-mainnet',
    });
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((r) => r.multisigConfigId).sort(), ['cfg-A', 'cfg-B']);
}

// ─── Background host registers multisig.listAddresses ────────

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'multisig.listAddresses'"),
    'background host registers multisig.listAddresses');
assert.ok(/multisigs:\s*Array\.isArray\(w\.multisigs\)/.test(bg),
    'toSafeWallet projection passes multisigs array through');

// ─── 3-shell messaging exposes listMultisigReceiveAddresses ──

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function listMultisigReceiveAddresses\b/.test(m),
        `${shell} messaging.js exports listMultisigReceiveAddresses`);
}

// ─── Receive + AddressList read multisigs[] ──────────────────

const receive = readFileSync(join(sharedRoutes, 'Receive.jsx'), 'utf8');
assert.ok(/listMultisigReceiveAddresses/.test(receive),
    'Receive uses the plural helper');
assert.ok(/multisigs\.map/.test(receive),
    'Receive renders one section per config');

const addressList = readFileSync(join(sharedRoutes, 'AddressList.jsx'), 'utf8');
assert.ok(/listMultisigReceiveAddresses/.test(addressList),
    'AddressList uses the plural helper');
assert.ok(/for \(const m of multisigs\)/.test(addressList),
    'AddressList synthesizes one row per config');

console.log(
    'OK: multisig multi-config smoke (Wallet v2 + MultisigConfig v2 + buildMultisigConfig auto-id + caller-id pass-through + v1 to v2 wallet migration with synthetic legacy-id + empty-array fallback + standalone MultisigConfig migration + duplicate-id validator guard + createMultisigConfig appends to multisigs[] + duplicate scriptTemplate guard + multisigConfigId routing on receiveMultisigAddress + listMultisigReceiveAddresses returns all + bg multisig.listAddresses handler + 3-shell listMultisigReceiveAddresses helpers + Receive multi-section render + AddressList multi-row render)',
);
