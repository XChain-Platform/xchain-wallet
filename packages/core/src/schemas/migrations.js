// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

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
import { CURRENT_VERSION as MULTISIG_SIGNING_SESSION_VERSION } from './multisigSigningSession.js';
import { CURRENT_VERSION as SIGNER_VERSION } from './signer.js';
import { CURRENT_VERSION as PENDING_AIRDROP_VERSION } from './pendingAirdrop.js';
import { CURRENT_VERSION as WATCHLIST_VERSION } from './watchlistEntry.js';
import { randomUUID } from '../util/uuid.js';

/**
 * @typedef {(record: any) => any} MigrationStep
 * @typedef {Record<number, MigrationStep>} MigrationMap
 */

/** @type {MigrationMap} */
export const walletMigrations = {
    // v1 → v2: §56.3 pre-launch Step 4. Single-slot `multisig` becomes
    // a `multisigs` array so a wallet can carry multiple multisig
    // configurations (different N-of-M groups, different schemes,
    // different cosigner sets). Existing wallets keep their config —
    // we synthesize an `id` if the v1 record didn't carry one (it
    // didn't, since v1 MultisigConfig had no `id` field), wrap in an
    // array, and strip the legacy `multisig` slot. Legacy null →
    // empty array.
    1: (r) => {
        const legacy = r.multisig;
        const next = { ...r, schemaVersion: 2 };
        delete next.multisig;
        if (!legacy) {
            next.multisigs = [];
        } else {
            const id = typeof legacy.id === 'string' && legacy.id.length > 0
                ? legacy.id
                : `legacy-${randomUUID()}`;
            next.multisigs = [{
                ...legacy,
                id,
                schemaVersion: 2,
            }];
        }
        return next;
    },
};
/** @type {MigrationMap} */
export const accountMigrations = {};
/** @type {MigrationMap} */
export const addressMigrations = {
    // v1 → v2: §17.6. Signer routing. Existing v1 records predate
    // address-to-signer linkage; fill signerId as null ("unresolved").
    // Runtime reconciliation — the next time the wallet is unlocked,
    // the shell can match addresses by (publicKey, derivationPath)
    // against available signers and write signerId back.
    1: (r) => ({ ...r, schemaVersion: 2, signerId: null }),
};
/** @type {MigrationMap} */
export const contactMigrations = {};
/** @type {MigrationMap} */
export const connectedSiteMigrations = {};
/** @type {MigrationMap} */
export const settingsMigrations = {
    // v1 → v2: §35 Settings build round 2. Adds opt-in fields the v1
    // panel surfaces deferred: reducedMotion override (Appearance),
    // privacy.blurOnBlur + privacy.labelsSurviveRestore (Privacy),
    // grace.testSendThresholdSats + panicMode.enabled + backupReminders
    // (Safety). Defaults preserve v1 behavior — every field starts in
    // its "no-op" state so existing wallets see no behavior change.
    1: (r) => ({
        ...r,
        schemaVersion: 2,
        reducedMotion: typeof r.reducedMotion === 'string' ? r.reducedMotion : 'auto',
        privacy: {
            torRouting: Boolean(r.privacy?.torRouting),
            changeAddressRotation: r.privacy?.changeAddressRotation !== false,
            hideSmallBalances: Boolean(r.privacy?.hideSmallBalances),
            blurOnBlur: Boolean(r.privacy?.blurOnBlur),
            labelsSurviveRestore: Boolean(r.privacy?.labelsSurviveRestore),
        },
        grace: {
            undoSendSeconds: Number.isFinite(r.grace?.undoSendSeconds) ? r.grace.undoSendSeconds : 5,
            testSendThresholdSats: Number.isFinite(r.grace?.testSendThresholdSats) ? r.grace.testSendThresholdSats : 0,
        },
        panicMode: {
            enabled: Boolean(r.panicMode?.enabled),
        },
        backupReminders: typeof r.backupReminders === 'string' ? r.backupReminders : 'off',
    }),
};
/** @type {MigrationMap} */
export const pendingTxMigrations = {};
/** @type {MigrationMap} */
export const multisigConfigMigrations = {
    // v1 → v2: §56.3 pre-launch Step 4. Add `id` so a wallet can
    // distinguish multiple configs. Synthetic id when missing. The
    // wallet migration above also runs on read, so this fires for
    // any embedded multisig record not already migrated by the
    // wallet pass.
    1: (r) => ({
        ...r,
        schemaVersion: 2,
        id: typeof r.id === 'string' && r.id.length > 0
            ? r.id
            : `legacy-${randomUUID()}`,
    }),
};
/** @type {MigrationMap} */
export const multisigSigningSessionMigrations = {};
/** @type {MigrationMap} */
export const signerMigrations = {};
/** @type {MigrationMap} */
export const pendingAirdropMigrations = {};
/** @type {MigrationMap} */
export const watchlistEntryMigrations = {};

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
export const migrateMultisigSigningSession = (r) =>
    migrate(r, multisigSigningSessionMigrations, MULTISIG_SIGNING_SESSION_VERSION);
export const migrateSigner = (r) => migrate(r, signerMigrations, SIGNER_VERSION);
export const migratePendingAirdrop = (r) =>
    migrate(r, pendingAirdropMigrations, PENDING_AIRDROP_VERSION);
export const migrateWatchlistEntry = (r) =>
    migrate(r, watchlistEntryMigrations, WATCHLIST_VERSION);
