// Migration harness — §11.6. Migrations are forward-only. Each schema
// owns a sparse { fromVersion: (record) => record } map; `migrate()`
// walks the record from its current version up to the target, applying
// each step in sequence. When the first schema change ships, add the
// `1: (r) => { ...; r.schemaVersion = 2; return r; }` entry below.

import { CURRENT_VERSION as WALLET_VERSION } from './wallet.js';
import { CURRENT_VERSION as ACCOUNT_VERSION } from './account.js';
import { CURRENT_VERSION as ADDRESS_VERSION } from './address.js';
import { CURRENT_VERSION as CONTACT_VERSION } from './contact.js';
import { CURRENT_VERSION as CONNECTED_SITE_VERSION } from './connectedSite.js';
import { CURRENT_VERSION as SETTINGS_VERSION } from './settings.js';
import { CURRENT_VERSION as PENDING_TX_VERSION } from './pendingTx.js';
import { CURRENT_VERSION as MULTISIG_VERSION } from './multisigConfig.js';

/**
 * @typedef {(record: any) => any} MigrationStep
 * @typedef {Record<number, MigrationStep>} MigrationMap
 */

/** @type {MigrationMap} */
export const walletMigrations = {};
/** @type {MigrationMap} */
export const accountMigrations = {};
/** @type {MigrationMap} */
export const addressMigrations = {};
/** @type {MigrationMap} */
export const contactMigrations = {};
/** @type {MigrationMap} */
export const connectedSiteMigrations = {};
/** @type {MigrationMap} */
export const settingsMigrations = {};
/** @type {MigrationMap} */
export const pendingTxMigrations = {};
/** @type {MigrationMap} */
export const multisigConfigMigrations = {};

/**
 * Walk `record` forward through `migrations` until it reaches `target`.
 * Throws if a step is missing — the caller must fall back to read-only
 * mode per §11.6.
 *
 * @param {{ schemaVersion: number }} record
 * @param {MigrationMap} migrations
 * @param {number} target
 */
export function migrate(record, migrations, target) {
    if (!record || typeof record.schemaVersion !== 'number') {
        throw new Error('migrate: record has no schemaVersion');
    }
    if (record.schemaVersion > target) {
        throw new Error(
            `migrate: record is at v${record.schemaVersion}, newer than target v${target}. ` +
                'Downgrade is unsupported (§11.6).',
        );
    }
    let r = record;
    while (r.schemaVersion < target) {
        const step = migrations[r.schemaVersion];
        if (!step) {
            throw new Error(
                `migrate: no migration registered from v${r.schemaVersion} to v${r.schemaVersion + 1}`,
            );
        }
        r = step(r);
        if (!r || typeof r.schemaVersion !== 'number') {
            throw new Error(
                'migrate: migration step returned a record without schemaVersion',
            );
        }
    }
    return r;
}

// Per-schema convenience wrappers. Callers that don't care about the
// generic harness just reach for these.
export const migrateWallet = (r) => migrate(r, walletMigrations, WALLET_VERSION);
export const migrateAccount = (r) => migrate(r, accountMigrations, ACCOUNT_VERSION);
export const migrateAddress = (r) => migrate(r, addressMigrations, ADDRESS_VERSION);
export const migrateContact = (r) => migrate(r, contactMigrations, CONTACT_VERSION);
export const migrateConnectedSite = (r) =>
    migrate(r, connectedSiteMigrations, CONNECTED_SITE_VERSION);
export const migrateSettings = (r) => migrate(r, settingsMigrations, SETTINGS_VERSION);
export const migratePendingTx = (r) => migrate(r, pendingTxMigrations, PENDING_TX_VERSION);
export const migrateMultisigConfig = (r) =>
    migrate(r, multisigConfigMigrations, MULTISIG_VERSION);
