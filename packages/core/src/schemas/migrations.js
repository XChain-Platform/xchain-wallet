// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Migration harness (§11.6). Migrations are forward-only. Each schema
// owns a sparse { fromVersion: (record) => record } map; `migrate()`
// walks the record from its current version up to the target, applying
// each step in sequence. When the first schema change ships, add the
// `1: (r) => { ...; r.schemaVersion = 2; return r; }` entry below.

import { CURRENT_VERSION as WALLET_VERSION, walletModeOf } from './wallet.js';
import { CURRENT_VERSION as ACCOUNT_VERSION } from './account.js';
import { CURRENT_VERSION as ADDRESS_VERSION } from './address.js';
import { CURRENT_VERSION as CONTACT_VERSION } from './contact.js';
import { CURRENT_VERSION as CONNECTED_SITE_VERSION } from './connectedSite.js';
import { withSiteIconFields } from './siteIcon.js';
import { CURRENT_VERSION as SETTINGS_VERSION } from './settings.js';
import { CURRENT_VERSION as PENDING_TX_VERSION } from './pendingTx.js';
import { CURRENT_VERSION as MULTISIG_VERSION } from './multisigConfig.js';
import { CURRENT_VERSION as MULTISIG_SIGNING_SESSION_VERSION } from './multisigSigningSession.js';
import { CURRENT_VERSION as SIGNER_VERSION } from './signer.js';
import { CURRENT_VERSION as PENDING_AIRDROP_VERSION } from './pendingAirdrop.js';
import { CURRENT_VERSION as WATCHLIST_VERSION } from './watchlistEntry.js';
import { CURRENT_VERSION as PRICE_ALERT_VERSION } from './priceAlert.js';
import { CURRENT_VERSION as COSIGNER_ACCOUNT_VERSION } from './coSignerAccount.js';
import { CURRENT_VERSION as GATED_KEY_VERSION } from './gatedKey.js';
import { CURRENT_VERSION as PENDING_DEPLOY_VERSION } from './pendingDeploy.js';
import { CURRENT_VERSION as PENDING_FILE_UPLOAD_VERSION } from './pendingFileUpload.js';
import { CURRENT_VERSION as AUTOPAY_ORDER_VERSION } from './autopayOrder.js';
import { CURRENT_VERSION as AUTOPAY_LEASE_VERSION } from './autopayLease.js';
import { randomUUID } from '../util/uuid.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import {
    ADS_DEFAULT_PER_TRANSACTION,
    ADS_DEFAULT_RECIPIENT,
    TEST_SEND_FIAT_DEFAULT,
    TEST_SEND_FIAT_MAX,
    TEST_SEND_FIAT_OFF,
    createDefaultAdsSettings,
} from './settings.js';

// The v3 donation roles and the v4 recipient each one became.
const LEGACY_ADS_ROLE_RECIPIENT = { DONATE1: 'protocol', DONATE2: 'community', EXPLORER: 'explorer' };

// This file sits in the vault import graph and a change to it triggers the
// every-OS release rehearsal, so it must not import the registry or the price
// lookup. The prices a v3 queue and a v4 sats threshold convert at come in
// through ctx (`adsRateFor`, `testSendRateFor`); flows/legacyRates.js builds
// that ctx. A caller that passes none has no price: queues drop and the test
// send takes its default.
const noPrice = () => null;

// sats * rate / 10^decimals in hundredths of the currency, rounded half up,
// in integer arithmetic (the rate is carried at 1e-10 precision).
function legacySatsToFiatCents(sats, decimals, rate) {
    let units;
    try { units = BigInt(sats); } catch { return 0n; }
    if (units <= 0n) return 0n;
    const rateScaled = BigInt(Math.round(rate * 1e10));
    const denominator = (10n ** BigInt(decimals)) * (10n ** 10n);
    const numerator = units * rateScaled * 100n;
    return (numerator + denominator / 2n) / denominator;
}

function centsToDecimal(cents) {
    const whole = cents / 100n;
    const frac = String(cents % 100n).padStart(2, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * v3 -> v4 donations: the per-network switch, amounts and sats queues become
 * one wallet-wide fiat setting. Exported for its unit test.
 *
 * - On when the v3 switch was on (an absent `enabled` is the old default, on)
 *   and some network still added an amount; on comes back at the default
 *   per-transaction amount, off as an explicit 0.
 * - The recipient is the first network's non-default choice, else Protocol.
 * - Each mainnet queue converts at the price this process holds for its coin;
 *   a queue with no price, and every test-network queue, is dropped.
 *
 * @param {any} r   the stored (sparse) or full v3 record
 * @param {{ adsRateFor?: (chainId: string, currency: string) => ({ rate: number, decimals: number } | null) }} [ctx]
 */
export function migrateLegacyAds(r, ctx) {
    const legacy = r && typeof r.ads === 'object' && r.ads !== null ? r.ads : {};
    const perChain = legacy.perChain && typeof legacy.perChain === 'object' ? legacy.perChain : {};
    const states = Object.entries(perChain).filter(([, s]) => s && typeof s === 'object');
    const switchOn = legacy.enabled !== false;
    const addsSomewhere = states.length === 0
        || states.some(([, s]) => s.perTxAmountSats == null || Number(s.perTxAmountSats) > 0);
    const currency = typeof r?.fiatCurrency === 'string' && r.fiatCurrency ? r.fiatCurrency : 'USD';
    const roles = states
        .map(([, s]) => s.donationAddressRole)
        .filter((role) => Object.prototype.hasOwnProperty.call(LEGACY_ADS_ROLE_RECIPIENT, role));
    const pickedRole = roles.find((role) => role !== 'DONATE1') ?? roles[0];
    const rateFor = typeof ctx?.adsRateFor === 'function' ? ctx.adsRateFor : noPrice;
    let queuedCents = 0n;
    for (const [chainId, s] of states) {
        const price = rateFor(chainId, currency);
        if (!price) continue;
        queuedCents += legacySatsToFiatCents(s.accumulatedSats, price.decimals, price.rate);
    }
    return {
        ...createDefaultAdsSettings(currency),
        perTransaction: switchOn && addsSomewhere ? ADS_DEFAULT_PER_TRANSACTION : '0',
        recipient: pickedRole ? LEGACY_ADS_ROLE_RECIPIENT[pickedRole] : ADS_DEFAULT_RECIPIENT,
        queued: centsToDecimal(queuedCents),
    };
}

/**
 * v4 -> v5 test send (operator ruling 2026-11-14): the sats threshold
 * becomes an amount in the display currency. Off stays Off; any other value
 * converts at the price this process holds, rounded to a whole amount (at
 * least 1), or becomes the $1,000 default when there is no price. Exported
 * for its unit test.
 *
 * @param {any} r   the stored (sparse) or full v4 record
 * @param {{ testSendRateFor?: (currency: string) => ({ rate: number, decimals: number } | null) }} [ctx]
 * @returns {string}   the v5 `grace.testSendThresholdFiat`
 */
export function migrateLegacyTestSend(r, ctx) {
    let sats;
    try { sats = BigInt(String(r?.grace?.testSendThresholdSats ?? '0').trim() || '0'); } catch { sats = 0n; }
    if (sats <= 0n) return TEST_SEND_FIAT_OFF;
    const currency = typeof r?.fiatCurrency === 'string' && r.fiatCurrency ? r.fiatCurrency : 'USD';
    const rateFor = typeof ctx?.testSendRateFor === 'function' ? ctx.testSendRateFor : noPrice;
    const price = rateFor(currency);
    if (!price) return TEST_SEND_FIAT_DEFAULT;
    const cents = legacySatsToFiatCents(sats, price.decimals, price.rate);
    let whole = (cents + 50n) / 100n;
    if (whole < 1n) whole = 1n;
    const max = BigInt(TEST_SEND_FIAT_MAX);
    return String(whole > max ? max : whole);
}

/**
 * A step sees the record and an optional context object that carries
 * document-level values a single record cannot know (see walletMigrations 3).
 *
 * @typedef {(record: any, ctx?: any) => any} MigrationStep
 * @typedef {Record<number, MigrationStep>} MigrationMap
 */

/** @type {MigrationMap} */
export const walletMigrations = {
    // v1 → v2: §56.3 pre-launch Step 4. Single-slot `multisig` becomes
    // a `multisigs` array so a wallet can carry multiple multisig
    // configurations (different N-of-M groups, different schemes,
    // different cosigner sets). Existing wallets keep their config:
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
    // v2 → v3: §15.6. The BIP39 passphrase is stored with the wallet, so
    // the record gains `encryptedPassphrase`. Seeding it null is the whole
    // step, and the reason the version bump exists at all: without it an
    // unmigrated record reads `undefined`, which is falsy exactly like the
    // null this migration writes, and "wallet has no passphrase" would be
    // indistinguishable from "wallet predates the change and still owes us
    // its passphrase once". Those two states take opposite unlock paths.
    2: (r) => ({ ...r, schemaVersion: 3, encryptedPassphrase: null }),
    // v3 -> v4: §20. Copy the legacy app-wide `settings.walletMode` the caller
    // passes (vault or backup settings) onto the wallet; absent or unknown is
    // Normal, as the sparse store omits an unchanged mode.
    3: (r, ctx) => ({
        ...r,
        schemaVersion: 4,
        walletMode: walletModeOf({ walletMode: ctx?.legacyWalletMode }),
    }),
};
/** @type {MigrationMap} */
export const accountMigrations = {
    // v1 -> v2: §11.3.2. Active address per chain. Existing accounts get an
    // empty override map; the active address resolves to the default (the
    // lowest-index receive address) until the user picks one.
    1: (r) => ({ ...r, schemaVersion: 2, activeAddressByChainId: {} }),
};
/** @type {MigrationMap} */
export const addressMigrations = {
    // v1 -> v2: §17.6. Signer routing. Existing v1 records predate
    // address-to-signer linkage, so seed signerId as null. Software
    // routing does not require the link. Nothing backfills it automatically;
    // callers may explicitly use reconcileAddressSigners with unlocked signers.
    1: (r) => ({ ...r, schemaVersion: 2, signerId: null }),
    // v2 -> v3: §16. Dispenser sub-addresses. Backfill `role` from the
    // BIP44 change segment of derivationPath (1 -> change, 2 -> dispenser,
    // 0/other -> receive). Watch-only / imported keys (null path) have no
    // branch and default to receive.
    2: (r) => {
        let role = 'receive';
        if (typeof r.derivationPath === 'string') {
            const parts = r.derivationPath.split('/');
            const change = parts[parts.length - 2];
            if (change === '1') role = 'change';
            else if (change === '2') role = 'dispenser';
        }
        return { ...r, schemaVersion: 3, role };
    },
    // v3 -> v4: the default address label ("Address #N") was chain-agnostic,
    // so BTC/LTC/DOGE under one account all showed the same label. Prefix
    // the native ticker to the legacy default ("BTC Address #N"). Only the
    // exact old-default pattern is rewritten; user-customized labels (and
    // already-prefixed ones) are left untouched.
    3: (r) => {
        let label = r.label;
        if (typeof label === 'string') {
            const m = /^Address #(\d+)$/.exec(label);
            if (m) label = `${tickerForCoin(r.chain)} Address #${m[1]}`;
        }
        return { ...r, schemaVersion: 4, label };
    },
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
    // (Safety). Defaults preserve v1 behavior: every field starts in
    // its "no-op" state so existing wallets see no behavior change.
    1: (r) => ({
        ...r,
        schemaVersion: 2,
        reducedMotion: typeof r.reducedMotion === 'string' ? r.reducedMotion : 'auto',
        privacy: {
            torRouting: Boolean(r.privacy?.torRouting),
            // Default OFF when the field is absent, matching the new-wallet
            // default (createDefaultSettings). An explicit prior choice
            // (true/false) is preserved; only an unset value flips to off.
            changeAddressRotation: r.privacy?.changeAddressRotation === true,
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
    // v2 → v3: sparse defaults (§35.10 / §36.6). v2 seeding COPIED release
    // defaults into the record, freezing them at wallet-creation time; v3
    // stores null for "follow the current release default" and resolves at
    // read time. Rewrite every per-chain preference field that still holds
    // the value v2 seeding wrote (ads: the flat 1 sat / 1000 trigger; fees:
    // strategy 'normal' for every coin, rbfByDefault true except Dogecoin)
    // to null - those are near-certainly untouched seeds, not user choices,
    // and nulling them re-attaches the wallet to release tuning. A value
    // that differs from the old seed IS a user choice and is preserved.
    // Top-level fields need no rewrite: deflateSettings drops the ones
    // equal to current defaults on the next write.
    2: (r) => {
        const perChain = {};
        for (const [chainId, s] of Object.entries(r.ads?.perChain ?? {})) {
            perChain[chainId] = {
                ...s,
                perTxAmountSats: s?.perTxAmountSats === 1 ? null : s?.perTxAmountSats ?? null,
                triggerAmountSats: s?.triggerAmountSats === 1000 ? null : s?.triggerAmountSats ?? null,
            };
        }
        const fees = {};
        for (const [chainId, f] of Object.entries(r.fees ?? {})) {
            const legacyRbf = !String(chainId).startsWith('dogecoin');
            fees[chainId] = {
                ...f,
                strategy: f?.strategy === 'normal' ? null : f?.strategy ?? null,
                rbfByDefault: f?.rbfByDefault === legacyRbf ? null : f?.rbfByDefault ?? null,
            };
        }
        return {
            ...r,
            schemaVersion: 3,
            ads: { ...r.ads, perChain },
            fees,
        };
    },
    // v3 -> v4: automatic donations become one wallet-wide fiat queue
    // (operator ruling 2026-11-14); see migrateLegacyAds.
    3: (r, ctx) => ({ ...r, schemaVersion: 4, ads: migrateLegacyAds(r, ctx) }),
    // v4 -> v5: the new-recipient test-send threshold moves from sats to the
    // display currency (operator ruling 2026-11-14); see migrateLegacyTestSend.
    // Off is the default, so a sparse record that was Off stays as it was.
    4: (r, ctx) => {
        const fiat = migrateLegacyTestSend(r, ctx);
        if (fiat === TEST_SEND_FIAT_OFF) return { ...r, schemaVersion: 5 };
        return { ...r, schemaVersion: 5, grace: { ...r.grace, testSendThresholdFiat: fiat } };
    },
};
/** @type {MigrationMap} */
export const pendingTxMigrations = {
    // v1 → v2: additive structured amount fields for the
    // pre-flight pending-delta machinery (§4.7). Legacy records carry no
    // per-tick amount, so seed nulls; the wallet re-populates on the next
    // submit. Purely additive, no data loss.
    1: (r) => ({
        ...r,
        schemaVersion: 2,
        tick: r.tick === undefined ? null : r.tick,
        amount: r.amount === undefined ? null : r.amount,
        params: r.params === undefined ? null : r.params,
    }),
    // v2 → v3: `mempoolSeenAt`, the network's own sighting of a transaction we
    // broadcast (§4 M2.2). Seed null, never a guess: a v2 record carries no
    // evidence that any mempool ever reported it, and back-dating one would
    // make the timeline claim a sighting the wallet never had. An in-flight
    // v2 record re-earns the stamp from the next mempool frame or poll; a
    // long-settled one keeps null and nothing reads it. Purely additive.
    2: (r) => ({
        ...r,
        schemaVersion: 3,
        mempoolSeenAt: r.mempoolSeenAt === undefined ? null : r.mempoolSeenAt,
    }),
};
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
/** @type {MigrationMap} */
export const priceAlertMigrations = {};

// CoSignerAccount (§22, P4) is a base-v1 schema; no upgrade steps yet.
export const coSignerAccountMigrations = {};

// GatedKey (PC-25) is a base-v1 schema; no upgrade steps yet.
/** @type {MigrationMap} */
export const gatedKeyMigrations = {};

// PendingDeploy (PC-38) is a base-v1 schema; no upgrade steps yet.
/** @type {MigrationMap} */
export const pendingDeployMigrations = {};

/** @type {MigrationMap} */
export const pendingFileUploadMigrations = {};

// AutopayOrder / AutopayLease (PC-16) are base-v1 schemas; no upgrade steps yet.
/** @type {MigrationMap} */
export const autopayOrderMigrations = {};
/** @type {MigrationMap} */
export const autopayLeaseMigrations = {};

/**
 * Walk `record` forward through `migrations` until it reaches `target`.
 * Throws if a step is missing; the caller must fall back to read-only
 * mode per §11.6.
 *
 * @param {{ schemaVersion: number }} record
 * @param {MigrationMap} migrations
 * @param {number} target
 * @param {any} [ctx]   passed to every step unchanged
 */
export function migrate(record, migrations, target, ctx = undefined) {
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
        r = step(r, ctx);
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
/**
 * @param {any} r
 * @param {{ legacyWalletMode?: unknown }} [ctx]   the pre-v4 app-wide wallet mode to copy onto a v3 record
 */
export const migrateWallet = (r, ctx) => migrate(r, walletMigrations, WALLET_VERSION, ctx);
export const migrateAccount = (r) => migrate(r, accountMigrations, ACCOUNT_VERSION);
export const migrateAddress = (r) => migrate(r, addressMigrations, ADDRESS_VERSION);
export const migrateContact = (r) => migrate(r, contactMigrations, CONTACT_VERSION);
// Site icons arrived inside v1 (the autoApproved precedent): a record written
// before them reads back with `icon` and `iconCapturedAt` null, and a value
// that fails the site icon checks (a tampered backup) is dropped to null.
export const migrateConnectedSite = (r) =>
    withSiteIconFields(migrate(r, connectedSiteMigrations, CONNECTED_SITE_VERSION));
/**
 * @param {any} r
 * @param {{ adsRateFor?: (chainId: string, currency: string) => ({ rate: number, decimals: number } | null) }} [ctx]
 *   the v3 -> v4 donation-queue price source; defaults to the rate this process holds
 */
export const migrateSettings = (r, ctx) => migrate(r, settingsMigrations, SETTINGS_VERSION, ctx);
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
export const migratePriceAlert = (r) =>
    migrate(r, priceAlertMigrations, PRICE_ALERT_VERSION);
export const migrateCoSignerAccount = (r) =>
    migrate(r, coSignerAccountMigrations, COSIGNER_ACCOUNT_VERSION);
export const migrateGatedKey = (r) =>
    migrate(r, gatedKeyMigrations, GATED_KEY_VERSION);
export const migratePendingDeploy = (r) =>
    migrate(r, pendingDeployMigrations, PENDING_DEPLOY_VERSION);
export const migratePendingFileUpload = (r) =>
    migrate(r, pendingFileUploadMigrations, PENDING_FILE_UPLOAD_VERSION);
export const migrateAutopayOrder = (r) =>
    migrate(r, autopayOrderMigrations, AUTOPAY_ORDER_VERSION);
export const migrateAutopayLease = (r) =>
    migrate(r, autopayLeaseMigrations, AUTOPAY_LEASE_VERSION);
