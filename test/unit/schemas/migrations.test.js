// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/migrations - migrate harness + all per-schema convenience wrappers.

import { describe, it, expect } from 'vitest';
import {
    migrate,
    walletMigrations,
    addressMigrations,
    settingsMigrations,
    multisigConfigMigrations,
    accountMigrations,
    contactMigrations,
    connectedSiteMigrations,
    pendingTxMigrations,
    multisigSigningSessionMigrations,
    signerMigrations,
    pendingAirdropMigrations,
    watchlistEntryMigrations,
    migrateWallet,
    migrateAccount,
    migrateAddress,
    migrateContact,
    migrateConnectedSite,
    migrateSettings,
    migratePendingTx,
    migrateMultisigConfig,
    migrateMultisigSigningSession,
    migrateSigner,
    migratePendingAirdrop,
    migrateWatchlistEntry,
} from '../../../packages/core/src/schemas/migrations.js';
import { validateWallet, CURRENT_VERSION as WALLET_VERSION } from '../../../packages/core/src/schemas/wallet.js';
import { validateAddress, CURRENT_VERSION as ADDRESS_VERSION } from '../../../packages/core/src/schemas/address.js';
import { CURRENT_VERSION as ACCOUNT_VERSION } from '../../../packages/core/src/schemas/account.js';
import { validateSettings, CURRENT_VERSION as SETTINGS_VERSION } from '../../../packages/core/src/schemas/settings.js';

const NOW = new Date().toISOString();

const makeV1Wallet = (overrides = {}) => ({
    schemaVersion: 1,
    id: 'w-1',
    name: 'Old Wallet',
    createdAt: NOW,
    origin: 'created',
    format: 'bip39',
    passphraseEnabled: false,
    encryptionAlgorithm: 'aes-256-gcm',
    encryptedSeed: 'c2VlZA==',
    kdfParams: { algorithm: 'argon2id', salt: 'c2FsdA==', iterations: 3, memory: 65536, parallelism: 1 },
    importedKeys: [],
    multisig: null,
    ...overrides,
});

describe('migrate() harness', () => {
    const noopMigrations = {};
    const oneMigration = {
        1: (r) => ({ ...r, schemaVersion: 2, extra: 'added' }),
    };

    it('returns record unchanged when already at target', () => {
        const r = { schemaVersion: 2, data: 'x' };
        const out = migrate(r, noopMigrations, 2);
        expect(out).toBe(r);
    });

    it('applies one migration step', () => {
        const r = { schemaVersion: 1, data: 'x' };
        const out = migrate(r, oneMigration, 2);
        expect(out.schemaVersion).toBe(2);
        expect(out.extra).toBe('added');
    });

    it('chains multiple steps', () => {
        const twoSteps = {
            1: (r) => ({ ...r, schemaVersion: 2, step1: true }),
            2: (r) => ({ ...r, schemaVersion: 3, step2: true }),
        };
        const out = migrate({ schemaVersion: 1 }, twoSteps, 3);
        expect(out.schemaVersion).toBe(3);
        expect(out.step1).toBe(true);
        expect(out.step2).toBe(true);
    });

    it('throws when record has no schemaVersion', () => {
        expect(() => migrate({}, noopMigrations, 1)).toThrow(/schemaVersion/);
        expect(() => migrate(null, noopMigrations, 1)).toThrow();
    });

    it('throws when record version > target (downgrade)', () => {
        const r = { schemaVersion: 5 };
        expect(() => migrate(r, noopMigrations, 2)).toThrow(/Downgrade/);
    });

    it('throws when a migration step is missing', () => {
        const r = { schemaVersion: 1 };
        expect(() => migrate(r, noopMigrations, 3)).toThrow(/no migration registered/);
    });

    it('throws when a migration step returns a record without schemaVersion', () => {
        const bad = { 1: () => ({ other: 'data' }) };
        expect(() => migrate({ schemaVersion: 1 }, bad, 2)).toThrow(/schemaVersion/);
    });
});

describe('walletMigrations: v1 to v2', () => {
    it('null multisig → empty multisigs array', () => {
        const r = walletMigrations[1](makeV1Wallet({ multisig: null }));
        expect(r.schemaVersion).toBe(2);
        expect(r.multisigs).toEqual([]);
        expect(r.multisig).toBeUndefined();
    });

    it('non-null multisig without id → wraps with synthetic id', () => {
        const legacy = { scheme: 'p2wsh-multisig', threshold: 2, cosigners: [] };
        const r = walletMigrations[1](makeV1Wallet({ multisig: legacy }));
        expect(r.multisigs).toHaveLength(1);
        expect(typeof r.multisigs[0].id).toBe('string');
        expect(r.multisigs[0].id.startsWith('legacy-')).toBe(true);
        expect(r.multisigs[0].schemaVersion).toBe(2);
    });

    it('multisig with existing id → preserves id', () => {
        const legacy = { id: 'original-id', scheme: 'p2wsh-multisig', threshold: 2, cosigners: [] };
        const r = walletMigrations[1](makeV1Wallet({ multisig: legacy }));
        expect(r.multisigs[0].id).toBe('original-id');
    });
});

describe('walletMigrations: v2 to v3', () => {
    it('seeds encryptedPassphrase null and touches nothing else', () => {
        const v2 = { schemaVersion: 2, id: 'w1', passphraseEnabled: true, multisigs: [], name: 'W' };
        const r = walletMigrations[2](v2);
        expect(r.schemaVersion).toBe(3);
        expect(r.encryptedPassphrase).toBeNull();
        expect(r.passphraseEnabled).toBe(true);
        expect(r.id).toBe('w1');
        expect(r.name).toBe('W');
    });

    it('distinguishes a migrated record from an unmigrated one (the point of the bump)', () => {
        const v2 = { schemaVersion: 2, id: 'w1', passphraseEnabled: true, multisigs: [] };
        expect('encryptedPassphrase' in v2).toBe(false);
        expect('encryptedPassphrase' in walletMigrations[2](v2)).toBe(true);
    });

    it('returns a new object rather than mutating its input', () => {
        const v2 = { schemaVersion: 2, id: 'w1', passphraseEnabled: false, multisigs: [] };
        const r = walletMigrations[2](v2);
        expect(r).not.toBe(v2);
        expect(v2.schemaVersion).toBe(2);
        expect(v2.encryptedPassphrase).toBeUndefined();
    });
});

describe('migrateWallet', () => {
    it('walks a v1 wallet all the way to v3 with encryptedPassphrase seeded', () => {
        const migrated = migrateWallet(makeV1Wallet());
        expect(migrated.schemaVersion).toBe(3);
        expect(migrated.encryptedPassphrase).toBeNull();
        expect(migrated.multisigs).toEqual([]);
    });

    it('migrates a v1 wallet to current version', () => {
        const w = makeV1Wallet();
        const migrated = migrateWallet(w);
        expect(migrated.schemaVersion).toBe(WALLET_VERSION);
    });

    it('no-ops on a wallet already at current version', () => {
        const w = { ...makeV1Wallet(), schemaVersion: WALLET_VERSION, multisigs: [], multisig: undefined };
        delete w.multisig;
        const migrated = migrateWallet(w);
        expect(migrated.schemaVersion).toBe(WALLET_VERSION);
    });
});

describe('addressMigrations: v1 to v2', () => {
    it('adds signerId: null to v1 record', () => {
        const v1 = { schemaVersion: 1, address: '1abc' };
        const r = addressMigrations[1](v1);
        expect(r.schemaVersion).toBe(2);
        expect(r.signerId).toBeNull();
        expect(r.address).toBe('1abc');
    });
});

describe('addressMigrations: v3 to v4', () => {
    it('coin-prefixes the legacy default label', () => {
        const v3 = { schemaVersion: 3, chain: 'bitcoin', label: 'Address #1' };
        const r = addressMigrations[3](v3);
        expect(r.schemaVersion).toBe(4);
        expect(r.label).toBe('BTC Address #1');
    });

    it('uses the right ticker per chain', () => {
        expect(addressMigrations[3]({ schemaVersion: 3, chain: 'litecoin', label: 'Address #2' }).label)
            .toBe('LTC Address #2');
        expect(addressMigrations[3]({ schemaVersion: 3, chain: 'dogecoin', label: 'Address #3' }).label)
            .toBe('DOGE Address #3');
    });

    it('leaves custom and already-prefixed labels untouched', () => {
        expect(addressMigrations[3]({ schemaVersion: 3, chain: 'bitcoin', label: 'Savings' }).label)
            .toBe('Savings');
        expect(addressMigrations[3]({ schemaVersion: 3, chain: 'bitcoin', label: 'BTC Address #1' }).label)
            .toBe('BTC Address #1');
    });
});

describe('migrateAddress', () => {
    it('migrates v1 address to v2', () => {
        const v1 = {
            schemaVersion: 1,
            id: 'a-1',
            accountId: 'acc-1',
            chain: 'BTC',
            network: 'mainnet',
            source: 'hd',
            addressType: 'p2wpkh',
            derivationPath: "m/84'/0'/0'/0/0",
            address: '1abc',
            publicKey: '02aabb',
            label: '',
            pinned: false,
            hidden: false,
            createdAt: NOW,
        };
        const migrated = migrateAddress(v1);
        expect(migrated.schemaVersion).toBe(ADDRESS_VERSION);
        expect(migrated.signerId).toBeNull();
        const r = validateAddress(migrated);
        expect(r.ok).toBe(true);
    });
});

describe('settingsMigrations: v1 to v2', () => {
    const makeV1Settings = (overrides = {}) => ({
        schemaVersion: 1,
        theme: 'system',
        autolockMinutes: 15,
        fiatCurrency: 'USD',
        language: 'en',
        sdkEndpoints: {},
        fees: {},
        privacy: { torRouting: false, changeAddressRotation: true, hideSmallBalances: false },
        ads: { enabled: true, perChain: {} },
        notifications: { txConfirmations: true, incomingReceipts: true, dispenserFills: true, orderFills: true, priceAlerts: false },
        developerMode: false,
        learnMode: false,
        grace: { undoSendSeconds: 5 },
        ...overrides,
    });

    it('migrates to v2 with expected new fields', () => {
        const r = settingsMigrations[1](makeV1Settings());
        expect(r.schemaVersion).toBe(2);
        expect(r.reducedMotion).toBe('auto');
        expect(r.privacy.blurOnBlur).toBe(false);
        expect(r.privacy.labelsSurviveRestore).toBe(false);
        expect(r.grace.testSendThresholdSats).toBe(0);
        expect(r.panicMode.enabled).toBe(false);
        expect(r.backupReminders).toBe('off');
    });

    it('preserves existing reducedMotion if string', () => {
        const r = settingsMigrations[1](makeV1Settings({ reducedMotion: 'always' }));
        expect(r.reducedMotion).toBe('always');
    });

    it('defaults reducedMotion to "auto" when not a string', () => {
        const r = settingsMigrations[1](makeV1Settings({ reducedMotion: undefined }));
        expect(r.reducedMotion).toBe('auto');
    });

    it('preserves existing undoSendSeconds', () => {
        const r = settingsMigrations[1](makeV1Settings({ grace: { undoSendSeconds: 10 } }));
        expect(r.grace.undoSendSeconds).toBe(10);
    });

    it('defaults backupReminders to "off" when not a string', () => {
        const r = settingsMigrations[1](makeV1Settings({ backupReminders: undefined }));
        expect(r.backupReminders).toBe('off');
    });

    it('preserves existing backupReminders if a string', () => {
        const r = settingsMigrations[1](makeV1Settings({ backupReminders: 'monthly' }));
        expect(r.backupReminders).toBe('monthly');
    });

    it('defaults changeAddressRotation to false when the field is absent', () => {
        const r = settingsMigrations[1](makeV1Settings({
            privacy: { torRouting: false, hideSmallBalances: false },
        }));
        expect(r.privacy.changeAddressRotation).toBe(false);
    });

    it('preserves an explicit changeAddressRotation: true', () => {
        const r = settingsMigrations[1](makeV1Settings({
            privacy: { torRouting: false, changeAddressRotation: true, hideSmallBalances: false },
        }));
        expect(r.privacy.changeAddressRotation).toBe(true);
    });

    it('preserves an explicit changeAddressRotation: false', () => {
        const r = settingsMigrations[1](makeV1Settings({
            privacy: { torRouting: false, changeAddressRotation: false, hideSmallBalances: false },
        }));
        expect(r.privacy.changeAddressRotation).toBe(false);
    });
});

describe('migrateSettings', () => {
    it('migrates a v1 settings record to current version', () => {
        const v1 = {
            schemaVersion: 1,
            theme: 'dark',
            autolockMinutes: 15,
            fiatCurrency: 'USD',
            language: 'en',
            sdkEndpoints: {},
            fees: {},
            privacy: { torRouting: false, changeAddressRotation: true, hideSmallBalances: false },
            ads: { enabled: true, perChain: {} },
            notifications: { txConfirmations: true, incomingReceipts: true, dispenserFills: true, orderFills: true, priceAlerts: false },
            developerMode: false,
            learnMode: false,
            grace: { undoSendSeconds: 5 },
        };
        const migrated = migrateSettings(v1);
        expect(migrated.schemaVersion).toBe(SETTINGS_VERSION);
        const r = validateSettings(migrated);
        expect(r.ok).toBe(true);
    });
});

describe('multisigConfigMigrations: v1 to v2', () => {
    it('adds id field', () => {
        const v1 = { schemaVersion: 1, scheme: 'p2wsh-multisig' };
        const r = multisigConfigMigrations[1](v1);
        expect(r.schemaVersion).toBe(2);
        expect(typeof r.id).toBe('string');
        expect(r.id.startsWith('legacy-')).toBe(true);
    });

    it('preserves existing id when present', () => {
        const v1 = { schemaVersion: 1, id: 'existing-id', scheme: 'p2wsh-multisig' };
        const r = multisigConfigMigrations[1](v1);
        expect(r.id).toBe('existing-id');
    });
});

describe('empty migration maps (contact, connectedSite, pendingTx, etc.)', () => {
    it('contactMigrations has no registered steps', () => {
        expect(Object.keys(contactMigrations)).toHaveLength(0);
    });

    it('connectedSiteMigrations has no registered steps', () => {
        expect(Object.keys(connectedSiteMigrations)).toHaveLength(0);
    });

    it('pendingTxMigrations registers the v1 → v2 and v2 → v3 steps', () => {
        expect(Object.keys(pendingTxMigrations)).toEqual(['1', '2']);
    });

    it('multisigSigningSessionMigrations has no registered steps', () => {
        expect(Object.keys(multisigSigningSessionMigrations)).toHaveLength(0);
    });

    it('signerMigrations has no registered steps', () => {
        expect(Object.keys(signerMigrations)).toHaveLength(0);
    });

    it('pendingAirdropMigrations has no registered steps', () => {
        expect(Object.keys(pendingAirdropMigrations)).toHaveLength(0);
    });

    it('watchlistEntryMigrations has no registered steps', () => {
        expect(Object.keys(watchlistEntryMigrations)).toHaveLength(0);
    });
});

describe('accountMigrations: v1 to v2', () => {
    it('adds an empty activeAddressByChainId map', () => {
        const r = accountMigrations[1]({ schemaVersion: 1, id: 'a-1' });
        expect(r.schemaVersion).toBe(2);
        expect(r.activeAddressByChainId).toEqual({});
        expect(r.id).toBe('a-1');
    });

    it('migrateAccount carries a v1 record up to current', () => {
        const r = migrateAccount({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(ACCOUNT_VERSION);
        expect(r.activeAddressByChainId).toEqual({});
    });
});

describe('migrateContact (no-op)', () => {
    it('passes through at current version', () => {
        const r = migrateContact({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});

describe('migrateConnectedSite (no-op)', () => {
    it('passes through at current version', () => {
        const r = migrateConnectedSite({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});

// v1 → v2 seeded the structured amount fields; v3 (§4 M2.2) added
// `mempoolSeenAt`. `migratePendingTx` always walks to the CURRENT version, so
// a v1 record now arrives with both sets of fields seeded.
describe('migratePendingTx (additive fields)', () => {
    it('upgrades a v1 record to v3, seeding null amount fields', () => {
        const r = migratePendingTx({ schemaVersion: 1, action: 'SEND', txid: 'abc' });
        expect(r.schemaVersion).toBe(3);
        expect(r.tick).toBe(null);
        expect(r.amount).toBe(null);
        expect(r.params).toBe(null);
        expect(r.mempoolSeenAt).toBe(null);
        // additive: existing fields survive untouched
        expect(r.action).toBe('SEND');
        expect(r.txid).toBe('abc');
    });

    it('passes through at current version', () => {
        const r = migratePendingTx({ schemaVersion: 3, tick: 'JDOG', amount: '5' });
        expect(r.schemaVersion).toBe(3);
        expect(r.tick).toBe('JDOG');
    });
});

describe('migrateMultisigConfig', () => {
    it('migrates v1 multisig config to v2', () => {
        const r = migrateMultisigConfig({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(2);
        expect(typeof r.id).toBe('string');
    });
});

describe('migrateMultisigSigningSession (no-op)', () => {
    it('passes through at current version', () => {
        const r = migrateMultisigSigningSession({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});

describe('migrateSigner (no-op)', () => {
    it('passes through at current version', () => {
        const r = migrateSigner({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});

describe('migratePendingAirdrop (no-op)', () => {
    it('passes through at current version', () => {
        const r = migratePendingAirdrop({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});

describe('migrateWatchlistEntry (no-op)', () => {
    it('passes through at current version', () => {
        const r = migrateWatchlistEntry({ schemaVersion: 1 });
        expect(r.schemaVersion).toBe(1);
    });
});
