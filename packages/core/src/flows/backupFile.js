// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Encrypted backup-file flows (§19.4): export wraps the BackupPayload below in
// the §19.4 envelope under a user-chosen password; import decrypts it, RE-KEYS
// the wallet's sealed key material under this device's password, then merges.

// Three distinct passwords, and conflating them fails silently: `password`
// opens the backup FILE's envelope, `walletPassword` opens the backed-up
// WALLET's seed and imported keys, `devicePassword` is what the restore
// re-seals them under.

// Skipping the re-key leaves a restored wallet openable only under the password
// it had on the device it left, failing at its first signature with no message.

// onConflict: 'overwrite' replaces existing records, 'preserve' keeps them and
// skips a matching incoming id, 'error' throws BackupConflictError on a
// collision.

// The BIP39 passphrase (§15.6) RIDES in the payload, as the wallet record's
// `encryptedPassphrase`: it is sealed under the wallet's own master key, so the
// envelope carries ciphertext the backup password cannot open, and the restore
// re-keys it exactly as it re-keys the seed. It is not "the passphrase in the
// file"; it is the same blob the device held, moved to a new password. Before
// it was stored the passphrase was re-typed at every unlock and so had nothing
// to back up. Still never in the payload (§19.4): hardware-wallet private
// keys, which stay on the device; `signers` carries only pairing metadata.

// A backup can also carry an OLDER schema than this release reads, and `put`
// never migrates (storage/Vault.js) - it only validates, and validation
// rejects any version but the current one. So EVERY record is migrated on the
// way out of the envelope; without that, a backup taken before a schema bump
// dies inside the vault's validator on restore.
//
// Every collection, not just the wallet and settings: those two were migrated
// here first and the other five were written straight through, so an envelope
// holding a v1 account or a v1 address was refused partway down the list -
// after the wallet had been written and auto-saved, leaving a restored wallet
// with no addresses under it. The migrator is a required argument of
// `stageCollection` rather than an optional one, so a collection added later
// cannot quietly inherit the raw path.

import {
    decodeBackupEnvelope,
    encodeBackupEnvelope,
    parseBackupEnvelope,
    stringifyBackupEnvelope,
    deriveMasterKeyAsync,
    makeFreshKdfParams,
    KDF_MIN_ITERATIONS,
    KDF_MIN_MEMORY_KIB,
    encrypt,
    decrypt,
    bytesToBase64,
    base64ToBytes,
    PASSPHRASE_AAD,
    decryptWalletSeed,
    encryptWalletSeed,
} from '../crypto/index.js';
import { randomUUID } from '../util/uuid.js';
import {
    migrateSettings,
    migrateWallet,
    migrateAccount,
    migrateAddress,
    migrateContact,
    migrateConnectedSite,
    migratePendingTx,
    migrateSigner,
} from '../schemas/migrations.js';
import { legacySettingsMigrationCtx } from './legacyRates.js';
import { validateAccount } from '../schemas/account.js';
import { validateAddress } from '../schemas/address.js';
import { validateContact } from '../schemas/contact.js';
import { validateConnectedSite } from '../schemas/connectedSite.js';
import { addressSourceForSignerKind } from '../schemas/constants.js';
import { validatePendingTx } from '../schemas/pendingTx.js';
import { SIGNER_KINDS, validateSignerRecord } from '../schemas/signer.js';
import { validateSettings } from '../schemas/settings.js';
import { parseBackupPointer } from '../uri/backupPointer.js';
import { defaultRegistry } from '../registry/index.js';
import { WalletNotFoundError } from './unlockWallet.js';
import { refuseHardwareWallet } from './hardwareWallet.js';
import {
    RESTORE_PASSWORD_LABELS,
    restorePasswordRequiredMessage,
} from './restorePasswordCopy.js';

// Address sources whose signerId names a SignerRecord in the same backup.
const SIGNER_RECORD_SOURCES = new Set(SIGNER_KINDS.map(addressSourceForSignerKind));

export const BACKUP_PAYLOAD_VERSION = 1;
export const MIN_BACKUP_PASSWORD_LENGTH = 8;

export class BackupConflictError extends Error {
    /** @param {string[]} conflicts */
    constructor(conflicts) {
        super(`importBackupFile: refusing to overwrite ${conflicts.length} existing record(s): ${conflicts.slice(0, 5).join(', ')}`);
        this.name = 'BackupConflictError';
        this.conflicts = conflicts;
    }
}

/**
 * The re-key could not open the backed-up wallet's own seal.
 *
 * Distinct from a bad envelope password on purpose. If the envelope had
 * not already opened we would never reach here, so "wrong password" on
 * its own is the wrong thing to tell the user: it is the OTHER password
 * - the one the wallet itself used on the device it came from - that is
 * wrong, and the message has to say which.
 */
export class BackupSeedPasswordError extends Error {
    /** @param {string} what   'seed' | 'imported key' | 'passphrase' */
    constructor(what) {
        // The copy names the field, not the function. The user is
        // looking at three password boxes, and this one is about the middle
        // one; a message that opens with `importBackupFile:` tells them which
        // function failed and nothing about which box to fix.
        super(
            `The backup file opened, but that is not the password of the wallet inside it (its `
            + `${what} stayed locked). The "${RESTORE_PASSWORD_LABELS.wallet}" field wants the `
            + `password you unlocked that wallet with on the device you backed it up from, not `
            + `this file's password and not the password for this device.`,
        );
        this.name = 'BackupSeedPasswordError';
        this.what = what;
    }
}

/**
 * A restore into an open vault re-seals the backed-up wallet under the
 * device box, and that box held a password the open vault does not open with. Refused before anything is written: a
 * wallet sealed under it would be skipped at every unlock and could not sign.
 */
export class RestoreDevicePasswordError extends Error {
    constructor() {
        super(
            `That is not the password this app unlocks with. The "${RESTORE_PASSWORD_LABELS.device.add}" `
            + 'field wants the password you already unlock this app with; the restored wallet is '
            + 're-locked with it.',
        );
        this.name = 'RestoreDevicePasswordError';
    }
}

/**
 * The backed-up wallet's own seal is damaged: not valid base64, or too short to
 * hold a ciphertext. No password opens it, so this must never read as the
 * wrong-password error above; only a GCM tag mismatch (`AeadAuthError`) means
 * the password is wrong. Matched by `name` because errors cross the shell
 * messaging boundary as plain objects.
 */
export class BackupSealDamagedError extends Error {
    /**
     * @param {string} what   'seed' | 'imported key' | 'passphrase'
     * @param {unknown} [cause]
     */
    constructor(what, cause) {
        super(
            `The wallet inside this backup file is damaged (its ${what} cannot be read), so no `
            + 'password can open it. Restore from a different backup file.',
        );
        this.name = 'BackupSealDamagedError';
        this.what = what;
        this.cause = cause;
    }
}

/**
 * Map a failure to open one of the backed-up wallet's seals to the error the
 * restore screen can act on. A tag mismatch is the wrong password; a decode or
 * length fault is a damaged record.
 *
 * @param {unknown} err
 * @param {string} what   'seed' | 'imported key' | 'passphrase'
 * @returns {Error}
 */
function sealOpenError(err, what) {
    if (/** @type {any} */ (err)?.name === 'AeadAuthError') return new BackupSeedPasswordError(what);
    return new BackupSealDamagedError(what, err);
}

/**
 * @typedef {Object} BackupPayload
 * @property {1} payloadVersion
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/account.js').Account[]} accounts
 * @property {import('../schemas/address.js').Address[]} addresses
 * @property {import('../schemas/contact.js').Contact[]} contacts
 * @property {import('../schemas/connectedSite.js').ConnectedSite[]} connectedSites
 * @property {import('../schemas/settings.js').Settings | null} settings
 * @property {import('../schemas/signer.js').SignerRecord[]} signers
 * @property {import('../schemas/pendingTx.js').PendingTx[]} pendingTxs
 */

/**
 * @typedef {Object} ExportBackupFileOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password                    backup password (NOT the wallet-unlock password)
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams]
 * @property {boolean} [includePendingTxs]        default true
 */

/**
 * @typedef {Object} ExportBackupFileResult
 * @property {string} fileContent                 pretty-printed JSON envelope ready to write to disk
 * @property {import('../crypto/backup.js').BackupEnvelope} envelope
 */

/**
 * @param {ExportBackupFileOpts} opts
 * @returns {Promise<ExportBackupFileResult>}
 */
export async function exportBackupFile({
    vault,
    walletId,
    password,
    kdfParams,
    includePendingTxs = true,
}) {
    if (!vault) throw new Error('exportBackupFile: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('exportBackupFile: walletId is required');
    }
    // Require the same minimum used when creating a wallet so a backup cannot be protected by a trivial password.
    if (typeof password !== 'string' || password.length < MIN_BACKUP_PASSWORD_LENGTH) {
        throw new Error(
            `exportBackupFile: password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`,
        );
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    // The backup restores a wallet from its sealed keys; a hardware wallet has
    // none (its device is the backup), and signer rows hold no key material.
    refuseHardwareWallet(wallet, 'a backup file');

    const [allAccounts, allAddresses, allContacts, allConnected, allPending, allSigners, settings] =
        await Promise.all([
            vault.accounts.list(),
            vault.addresses.list(),
            vault.contacts.list(),
            vault.connectedSites.list(),
            vault.pendingTxs.list(),
            vault.signers.list(),
            vault.settings.get(),
        ]);

    // Scope collections to the target wallet where the record carries a
    // walletId link; collections that don't (contacts, settings) ride
    // through whole. Accounts and addresses filter by accountId ancestry.
    const accounts = allAccounts.filter((a) => a.walletId === walletId);
    const accountIds = new Set(accounts.map((a) => a.id));
    const importedAddrIds = new Set(wallet.importedKeys.map((k) => k.addressId));
    const addresses = allAddresses.filter((a) =>
        (a.accountId && accountIds.has(a.accountId)) || importedAddrIds.has(a.id),
    );
    const addressScopes = new Set(addresses.map(addressScopeKey));
    const pendingTxs = includePendingTxs
        ? allPending.filter((p) => addressScopes.has(pendingTxScopeKey(p)))
        : [];
    const connectedSites = allConnected.flatMap((site) => {
        const grantedAccounts = site?.permissions?.accounts;
        // Persisted records always carry this array. Keeping an unrecognized
        // record intact lets the vault validator report the schema problem.
        if (!Array.isArray(grantedAccounts)) return [site];
        // An empty grant is the section 43.3 wildcard: it names no account to
        // scope, and dropping it would lose the connection on restore.
        if (grantedAccounts.length === 0) return [site];
        const scopedAccounts = grantedAccounts.filter((id) => accountIds.has(id));
        if (scopedAccounts.length === 0) return [];
        return [{
            ...site,
            permissions: { ...site.permissions, accounts: scopedAccounts },
        }];
    });

    /** @type {BackupPayload} */
    const payload = {
        payloadVersion: BACKUP_PAYLOAD_VERSION,
        wallet,
        accounts,
        addresses,
        contacts: allContacts,
        connectedSites,
        settings,
        signers: allSigners.filter((signer) => signer.walletId === walletId),
        pendingTxs,
    };

    const envelope = await encodeBackupEnvelope({
        password,
        payload,
        walletName: wallet.name,
        kdfParams,
    });

    return {
        fileContent: stringifyBackupEnvelope(envelope),
        envelope,
    };
}

/**
 * @typedef {Object} ImportBackupFileOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string | object} fileContent                 raw JSON string or parsed envelope
 * @property {string} password                             opens the ENVELOPE (the backup file's own password)
 * @property {string} [walletPassword]                     opens the backed-up WALLET's seal; required
 * whenever the payload carries key material
 * @property {string} [devicePassword]                     what the restored wallet is re-sealed under, i.e.
 *                                                          the password this device unlocks with
 * @property {'overwrite' | 'preserve' | 'error'} [onConflict]  default 'error'
 * @property {'fresh' | 'add'} [mode]                       'fresh' (default) imports the
 *                                                          wallet under its original ids;
 *                                                          'add' re-mints wallet / account /
 *                                                          address ids so the restored wallet
 *                                                          coexists with what's already in
 *                                                          the vault. Cluster H FOLLOWUP 3.
 * @property {DeviceKeyCallback} [onDeviceKey]              lends the re-key's new master key to the shell
 *                                                          so its signer-pool unlock skips a second
 *                                                          Argon2id round on identical inputs
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]
 */

/**
 * Receives the key the restored wallet is now sealed under (derived from
 * `devicePassword` under `kdfParams`). The buffer is zeroed as soon as the
 * callback returns, so a shell that needs it later copies it and zeroes its copy.
 *
 * @callback DeviceKeyCallback
 * @param {Uint8Array} masterKey
 * @param {import('../crypto/kdf.js').KdfParams} kdfParams   a copy of the new seal's params
 * @returns {void | Promise<void>}
 */

/**
 * @typedef {Object} ImportBackupFileResult
 * @property {BackupPayload} payload                       the decoded payload (for the shell to surface)
 * @property {string} walletId                             imported wallet id
 * @property {{ wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, signers: number, pendingTxs: number, settings: boolean }} writes
 * @property {{ wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, signers: number, pendingTxs: number, settings: boolean }} skipped
 * @property {boolean} rekeyed: the wallet's seal was moved to this
 *                                                          device's password (false only when the record
 *                                                          carried no sealed key material at all)
 */

/**
 * @param {ImportBackupFileOpts} opts
 * @returns {Promise<ImportBackupFileResult>}
 */
export async function importBackupFile({
    vault,
    fileContent,
    password,
    walletPassword,
    devicePassword,
    onConflict = 'error',
    mode = 'fresh',
    onDeviceKey,
    chainRegistry = defaultRegistry(),
}) {
    if (!vault) throw new Error('importBackupFile: vault is required');
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('importBackupFile: password is required');
    }
    if (onConflict !== 'overwrite' && onConflict !== 'preserve' && onConflict !== 'error') {
        throw new Error(
            `importBackupFile: onConflict must be 'overwrite' | 'preserve' | 'error' (got "${onConflict}")`,
        );
    }
    if (mode !== 'fresh' && mode !== 'add') {
        throw new Error(`importBackupFile: mode must be 'fresh' or 'add' (got "${mode}")`);
    }

    const envelope = parseBackupEnvelope(fileContent);
    const decoded = /** @type {BackupPayload} */ (
        await decodeBackupEnvelope({ password, envelope })
    );

    if (!decoded || typeof decoded !== 'object') {
        throw new Error('importBackupFile: decoded payload is not an object');
    }
    if (decoded.payloadVersion !== BACKUP_PAYLOAD_VERSION) {
        throw new Error(
            `importBackupFile: unsupported payloadVersion ${decoded.payloadVersion} (expected ${BACKUP_PAYLOAD_VERSION})`,
        );
    }
    if (!decoded.wallet || typeof decoded.wallet.id !== 'string' || decoded.wallet.id.length === 0) {
        throw new Error('importBackupFile: payload missing wallet record');
    }

    // Migrate and scope-check every record before the first vault write.
    // Migration or scope errors in a later collection must not turn a restore
    // into a wallet-only partial write, and records for another wallet must
    // not ride in a valid encrypted envelope.
    prepareDecodedPayload(decoded, { chainRegistry });

    // Re-seal the wallet's key material under this device's
    // password BEFORE anything is written. Doing it here rather than at
    // the shell means a seal we cannot open fails at RESTORE time, with
    // a message naming which password is wrong, instead of at the user's
    // first signature with no message at all. Nothing has touched the
    // vault yet at this point, so the throw leaves it untouched.
    const rekeyed = await rekeyWalletRecord(decoded.wallet, { walletPassword, devicePassword, onDeviceKey });

    // §19.4: 'add' mode re-mints wallet, account, address, and signer ids so a restored
    // wallet coexists even where both vaults derived equal ones (a same-device
    // from-seed restore does); globally-id'd records fall through to
    // onConflict.
    if (mode === 'add') {
        remintIdentifiers(decoded);
    }

    await reuseExistingSignerIds(vault, decoded);

    // Collect conflicts up-front; onConflict='error' fails fast. Add
    // mode skips wallet-scoped collisions because we re-minted those ids;
    // only contacts / connectedSites can still conflict.
    //
    // Settings is exempt in 'add' mode: it is a vault-global singleton,
    // so an initialized vault ALWAYS has one and the incoming record
    // would always collide - which made every restore-alongside fail on
    // the default onConflict='error'. The joining wallet does not get to
    // redefine the vault's network / fee / privacy choices, so its
    // settings are simply not applied (see the write below).
    const conflicts = await collectConflicts(
        vault, decoded, { skipWalletScoped: mode === 'add', skipSettings: mode === 'add' },
    );
    if (conflicts.length > 0 && onConflict === 'error') {
        throw new BackupConflictError(conflicts);
    }

    const writes = emptyRestoreCounts();
    const skipped = emptyRestoreCounts();

    // Every record is staged first and written together at the end, so a
    // storage refusal or a closed page part-way through leaves the vault as it
    // was: never a wallet with none of its accounts, which a retry would then
    // duplicate. `decoded.wallet` was already migrated above, before the re-key
    // rewrote it in place; migrateWallet here is the same no-op it is for any
    // current record, and keeps every collection on one path.
    const staged = [];
    await stageCollection(vault.wallets, [decoded.wallet], onConflict, writes, skipped, 'wallets', migrateWallet, staged);
    await stageCollection(vault.accounts, decoded.accounts ?? [], onConflict, writes, skipped, 'accounts', migrateAccount, staged);
    await stageCollection(vault.addresses, decoded.addresses ?? [], onConflict, writes, skipped, 'addresses', migrateAddress, staged);
    await stageCollection(vault.contacts, decoded.contacts ?? [], onConflict, writes, skipped, 'contacts', migrateContact, staged);
    await stageCollection(vault.connectedSites, decoded.connectedSites ?? [], onConflict, writes, skipped, 'connectedSites', migrateConnectedSite, staged);
    await stageCollection(vault.signers, decoded.signers ?? [], onConflict, writes, skipped, 'signers', migrateSigner, staged);
    await stageCollection(vault.pendingTxs, decoded.pendingTxs ?? [], onConflict, writes, skipped, 'pendingTxs', migratePendingTx, staged);

    // Settings is a singleton; overwrite/preserve decisions apply to
    // the whole record. In 'add' mode the vault's own settings win even
    // under onConflict='overwrite': that flag exists to resolve record
    // collisions for the wallet being restored, not to hand a joining
    // wallet the vault-wide network / fee / privacy configuration the
    // user is currently running under.
    if (decoded.settings) {
        const existing = await vault.settings.get();
        if (!existing || (onConflict === 'overwrite' && mode !== 'add')) {
            // A backup can carry an older schema (e.g. a v2 record whose
            // per-chain values are frozen copies of that release's
            // defaults); migrate before put or validation rejects it.
            staged.push({ store: vault.settings, record: migrateSettings(decoded.settings, legacySettingsMigrationCtx()), previous: existing });
            writes.settings = true;
        } else {
            skipped.settings = true;
        }
    }

    await writeStaged(vault, staged);

    return {
        payload: decoded,
        walletId: decoded.wallet.id,
        writes,
        skipped,
        rekeyed,
    };
}

export class BackupPointerUnresolvedError extends Error {
    /** @param {import('../uri/backupPointer.js').BackupPointer} pointer */
    constructor(pointer) {
        super(`restoreFromBackupPointer: resolver returned no backup content for "${pointer?.location ?? '?'}"`);
        this.name = 'BackupPointerUnresolvedError';
        this.pointer = pointer;
    }
}

/**
 * @typedef {Object} RestoreFromBackupPointerOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string | import('../uri/backupPointer.js').BackupPointer} pointer   a
 *          backup-pointer URI string (parsed here) or an already-parsed
 *          `BackupPointer` from `detectQrContent` / `parseBackupPointer`.
 * @property {string} password                             backup password (NOT the wallet-unlock password)
 * @property {string} [walletPassword]: opens the backed-up wallet's own seal
 * @property {string} [devicePassword]: what it is re-sealed under here
 * @property {(pointer: import('../uri/backupPointer.js').BackupPointer) => Promise<string | object> | string | object} resolveBackupContent
 *          shell-injected resolver that turns the pointer's `location`
 *          into the raw §19.4 envelope (a JSON string or parsed object).
 *          Kept out of core so the flow stays network-free and
 *          unit-testable; shells wire in the actual fetch (https / on-chain
 *          FILE lookup).
 * @property {'overwrite' | 'preserve' | 'error'} [onConflict]   default 'error'
 * @property {'fresh' | 'add'} [mode]                       default 'fresh'
 * @property {DeviceKeyCallback} [onDeviceKey]              passed through to `importBackupFile`
 * @property {import('../registry/index.js').ChainRegistry} [chainRegistry]
 */

/**
 * @typedef {ImportBackupFileResult & { pointer: import('../uri/backupPointer.js').BackupPointer }} RestoreFromBackupPointerResult
 */

/**
 * §15.4 QR-from-backup-pointer restore. Parses (or accepts) a backup
 * pointer, hands it to the shell-injected `resolveBackupContent` to
 * fetch the encrypted §19.4 envelope, then runs the exact same
 * `importBackupFile` decrypt-and-merge path the file lane uses. The
 * pointer only carries a location; the envelope is still
 * password-encrypted, so the caller must supply the backup password
 * just like the file lane.
 *
 * @param {RestoreFromBackupPointerOpts} opts
 * @returns {Promise<RestoreFromBackupPointerResult>}
 */
export async function restoreFromBackupPointer({
    vault,
    pointer,
    password,
    walletPassword,
    devicePassword,
    resolveBackupContent,
    onConflict = 'error',
    mode = 'fresh',
    onDeviceKey,
    chainRegistry = defaultRegistry(),
}) {
    if (!vault) throw new Error('restoreFromBackupPointer: vault is required');
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('restoreFromBackupPointer: password is required');
    }
    if (typeof resolveBackupContent !== 'function') {
        throw new Error('restoreFromBackupPointer: resolveBackupContent must be a function');
    }

    const parsed = typeof pointer === 'string' ? parseBackupPointer(pointer) : pointer;
    if (!parsed || typeof parsed.location !== 'string' || parsed.location.length === 0) {
        throw new Error('restoreFromBackupPointer: pointer must have a location');
    }

    const fileContent = await resolveBackupContent(parsed);
    if (fileContent == null || (typeof fileContent === 'string' && fileContent.trim().length === 0)) {
        throw new BackupPointerUnresolvedError(parsed);
    }

    const result = await importBackupFile({
        vault,
        fileContent,
        password,
        walletPassword,
        devicePassword,
        onConflict,
        mode,
        onDeviceKey,
        chainRegistry,
    });

    return { ...result, pointer: parsed };
}

/**
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {BackupPayload} payload
 * @param {{ skipWalletScoped?: boolean, skipSettings?: boolean }} [opts]
 *        skipWalletScoped: skip wallets / accounts / addresses /
 *          signers / pendingTxs (the five collections whose ids `add`-mode has
 *          already re-minted).
 *        skipSettings: skip the settings singleton, which exists in
 *          every initialized vault and so always "collides".
 * @returns {Promise<string[]>}          conflict labels ("wallets/<id>", etc.)
 */
async function collectConflicts(vault, payload, opts = {}) {
    const out = [];
    async function check(collection, incoming, name) {
        for (const rec of incoming) {
            if (!rec || typeof rec.id !== 'string') continue;
            const existing = await collection.get(rec.id);
            if (existing) out.push(`${name}/${rec.id}`);
        }
    }
    if (!opts.skipWalletScoped) {
        await check(vault.wallets, [payload.wallet], 'wallets');
        await check(vault.accounts, payload.accounts ?? [], 'accounts');
        await check(vault.addresses, payload.addresses ?? [], 'addresses');
        await check(vault.signers, payload.signers ?? [], 'signers');
        await check(vault.pendingTxs, payload.pendingTxs ?? [], 'pendingTxs');
    }
    await check(vault.contacts, payload.contacts ?? [], 'contacts');
    await check(vault.connectedSites, payload.connectedSites ?? [], 'connectedSites');
    if (!opts.skipSettings && payload.settings && (await vault.settings.get())) out.push('settings');
    return out;
}

/**
 * Pairing is idempotent by wallet, vendor, and device identifier. If this
 * vault already knows a restored device under another record id, keep that
 * stable id so a later pairing and the restored addresses agree.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {BackupPayload} payload
 */
async function reuseExistingSignerIds(vault, payload) {
    if (!payload.signers?.length) return;
    const existing = await vault.signers.list();
    if (existing.length === 0) return;

    const replacementIds = new Map();
    payload.signers = payload.signers.filter((incoming) => {
        const match = existing.find((record) => (
            record.walletId === incoming.walletId
            && record.vendor === incoming.vendor
            && record.deviceIdentifier === incoming.deviceIdentifier
        ));
        if (!match || match.id === incoming.id) return true;
        replacementIds.set(incoming.id, match.id);
        return false;
    });

    for (const address of payload.addresses ?? []) {
        if (!SIGNER_RECORD_SOURCES.has(address.source)) continue;
        address.signerId = replacementIds.get(address.signerId) ?? address.signerId;
    }
}

/**
 * @param {BackupPayload['accounts']} accounts
 * @param {Map<string, string>} addressIdMap
 */
function remapActiveAddressOverrides(accounts, addressIdMap) {
    for (const account of accounts ?? []) {
        const overrides = account?.activeAddressByChainId;
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) continue;
        const remapped = {};
        for (const [chainId, addressId] of Object.entries(overrides)) {
            if (addressIdMap.has(addressId)) remapped[chainId] = addressIdMap.get(addressId);
        }
        account.activeAddressByChainId = remapped;
    }
}

/**
 * Give each signer a new id under the re-minted wallet and move hardware
 * address links with it. Only device addresses point at SignerRecords, so
 * every other address keeps its signerId.
 *
 * @param {BackupPayload} decoded
 * @param {Map<string, string>} walletIdMap
 */
function remintSignerIds(decoded, walletIdMap) {
    const signerIdMap = new Map();
    for (const signer of decoded.signers ?? []) {
        if (!signer || typeof signer.id !== 'string') continue;
        const newId = randomUUID();
        signerIdMap.set(signer.id, newId);
        signer.id = newId;
        if (typeof signer.walletId === 'string' && walletIdMap.has(signer.walletId)) {
            signer.walletId = walletIdMap.get(signer.walletId);
        }
    }
    for (const addr of decoded.addresses ?? []) {
        if (!addr || !SIGNER_RECORD_SOURCES.has(addr.source)) continue;
        if (typeof addr.signerId === 'string' && signerIdMap.has(addr.signerId)) {
            addr.signerId = signerIdMap.get(addr.signerId);
        }
    }
}

/**
 * @param {BackupPayload['connectedSites']} sites
 * @param {Map<string, string>} accountIdMap
 */
function remapSiteGrants(sites, accountIdMap) {
    for (const site of sites ?? []) {
        const grantedAccounts = site?.permissions?.accounts;
        if (!Array.isArray(grantedAccounts)) continue;
        site.permissions.accounts = grantedAccounts.map((accountId) => (
            accountIdMap.get(accountId) ?? accountId
        ));
    }
}

/**
 * Re-mint wallet / account / address ids on the decoded payload so
 * an `add`-mode import can land alongside what the vault already
 * has. Mutates `decoded` in place. Updates every field that
 * references one of the re-minted ids:
 *
 *   - wallet.id
 *   - wallet.importedKeys[].addressId
 *   - account.id, account.walletId, account.activeAddressByChainId values
 *   - address.id, address.accountId
 *   - signer.id, signer.walletId, hardware address.signerId
 *   - pendingTx.id    (kept independent; pending txs are address-scoped
 *                     via chain / network / `fromAddress`, not id-scoped)
 *
 * Contacts / connectedSites / settings ids stay as-is (they're global),
 * while connectedSites.permissions.accounts follows the account remint.
 * Exported for test access; production callers go through
 * `importBackupFile({ mode: 'add' })`.
 *
 * @param {BackupPayload} decoded
 */
export function remintIdentifiers(decoded) {
    const walletIdMap = new Map();
    const accountIdMap = new Map();
    const addressIdMap = new Map();

    const oldWalletId = decoded.wallet.id;
    const newWalletId = randomUUID();
    walletIdMap.set(oldWalletId, newWalletId);
    decoded.wallet.id = newWalletId;

    for (const acc of decoded.accounts ?? []) {
        if (!acc || typeof acc.id !== 'string') continue;
        const oldId = acc.id;
        const newId = randomUUID();
        accountIdMap.set(oldId, newId);
        acc.id = newId;
        if (typeof acc.walletId === 'string' && walletIdMap.has(acc.walletId)) {
            acc.walletId = walletIdMap.get(acc.walletId);
        }
    }

    for (const addr of decoded.addresses ?? []) {
        if (!addr || typeof addr.id !== 'string') continue;
        const oldId = addr.id;
        const newId = randomUUID();
        addressIdMap.set(oldId, newId);
        addr.id = newId;
        if (typeof addr.accountId === 'string' && accountIdMap.has(addr.accountId)) {
            addr.accountId = accountIdMap.get(addr.accountId);
        }
    }

    remintSignerIds(decoded, walletIdMap);
    remapActiveAddressOverrides(decoded.accounts, addressIdMap);
    remapSiteGrants(decoded.connectedSites, accountIdMap);

    // Wallet's importedKeys point at the re-minted address ids by
    // value; rewire so a wif-imported wallet lands intact.
    if (Array.isArray(decoded.wallet.importedKeys)) {
        for (const ik of decoded.wallet.importedKeys) {
            if (ik && typeof ik.addressId === 'string' && addressIdMap.has(ik.addressId)) {
                ik.addressId = addressIdMap.get(ik.addressId);
            }
        }
    }

    // PendingTxs: re-mint id so a re-import of the same backup doesn't
    // collide; keep the rest of the row (chain / network / fromAddress /
    // txid / status) untouched. fromAddress is the canonical address string,
    // not an id, so it survives the address-id re-mint.
    for (const ptx of decoded.pendingTxs ?? []) {
        if (ptx && typeof ptx.id === 'string') {
            ptx.id = randomUUID();
        }
    }
}

/**
 * Re-seal a restored wallet's key material under THIS device's password,
 * in place. The §19.4 envelope carries `encryptedSeed`,
 * `importedKeys[].encryptedWif` and the wallet's OWN `kdfParams` verbatim, so
 * skipping this leaves the wallet sealed under its old device's password and
 * `SignerPool.populate` skips it silently. `importedKeys` re-key with the seed
 * because `importWif` seals them under the SAME master key (importWif.js), and
 * so does the §15.6 `encryptedPassphrase`, which is the third leg below.
 * New params copy the source's argon2 COST (raised to the KDF_MIN_* floor when
 * lower) but ALWAYS take a fresh salt: one
 * salt reused under one password derives the same master key for two wallets.
 * That fresh salt is also why the passphrase cannot simply ride through
 * verbatim: nothing about the new seal matches the old one, so an untouched
 * passphrase blob would fail its GCM tag at the first unlock and leave a wallet
 * that opens but derives the wrong seed.
 * @param {import('../schemas/wallet.js').Wallet} wallet
 * @param {Object} opts
 * @param {string} [opts.walletPassword]  what the backed-up wallet was sealed under
 * @param {Uint8Array} [opts.walletKey]   the key it is sealed under, already derived, used
 *   instead of `walletPassword` (the recovery-phrase reset holds keys, not the forgotten
 *   password); copied on receipt and the copy zeroed here, the caller zeroes its own
 * @param {string} opts.devicePassword    what it must open under from now on
 * @param {import('../crypto/kdf.js').KdfParams} [opts.kdfParams]  override for the new seal
 * @param {DeviceKeyCallback} [opts.onDeviceKey]  shown the new key once the re-seal succeeds; never
 *   called when nothing was re-sealed or the re-seal failed
 * @returns {Promise<boolean>}            true if anything was re-sealed
 */
export async function rekeyWalletRecord(wallet, { walletPassword, walletKey, devicePassword, kdfParams, onDeviceKey }) {
    // A caller that asked for the key must be able to receive it; checked before any derivation.
    if (onDeviceKey !== undefined && typeof onDeviceKey !== 'function') {
        throw new Error('rekeyWalletRecord: onDeviceKey must be a function');
    }
    const hasSeed = typeof wallet?.encryptedSeed === 'string' && wallet.encryptedSeed.length > 0;
    const allKeys = Array.isArray(wallet?.importedKeys) ? wallet.importedKeys : [];
    const sealedKeys = allKeys.filter(
        (k) => k && typeof k.encryptedWif === 'string' && k.encryptedWif.length > 0,
    );
    // A legacy passphrase wallet carries null here and is re-captured at its
    // next unlock, so only a real blob counts as key material to move.
    const hasPassphrase = typeof wallet?.encryptedPassphrase === 'string'
        && wallet.encryptedPassphrase.length > 0;
    if (!hasSeed && sealedKeys.length === 0 && !hasPassphrase) return false;

    // Name which BOX on the restore screen is empty, never the parameter: the
    // parameter name is the one thing on screen the user cannot see.
    const hasWalletKey = walletKey instanceof Uint8Array && walletKey.length === 32;
    if (walletKey !== undefined && !hasWalletKey) {
        throw new Error('rekeyWalletRecord: walletKey must be a 32-byte Uint8Array');
    }
    if (!hasWalletKey && (typeof walletPassword !== 'string' || walletPassword.length === 0)) {
        throw new Error(restorePasswordRequiredMessage('wallet'));
    }
    if (typeof devicePassword !== 'string' || devicePassword.length === 0) {
        // Core does not know which shell mode is restoring, so it names the
        // fresh-install label; the screen re-labels for 'add' when it renders
        // the message (see `restoreFailureMessage`).
        throw new Error(restorePasswordRequiredMessage('device'));
    }
    if (!wallet.kdfParams || typeof wallet.kdfParams !== 'object') {
        throw new Error(
            'The wallet inside this backup file is missing the details needed to unlock it, so no '
            + 'password can open it. Restore from a different backup file.',
        );
    }

    /** @type {Uint8Array | null} */
    let oldKey = null;
    let seed = null;
    /** @type {Uint8Array[]} */
    let wifs = [];
    /** @type {Uint8Array | null} */
    let passphrase = null;
    /** @type {Uint8Array | null} */
    let newKey = null;
    try {
        oldKey = hasWalletKey
            ? new Uint8Array(walletKey)
            : await deriveMasterKeyAsync(walletPassword, wallet.kdfParams);
        if (hasSeed) {
            try {
                seed = await decryptWalletSeed({
                    encryptedSeed: wallet.encryptedSeed,
                    kdfParams: wallet.kdfParams,
                    masterKey: oldKey,
                });
            } catch (err) {
                throw sealOpenError(err, 'seed');
            }
        }
        for (const k of sealedKeys) {
            try {
                wifs.push(await decrypt(oldKey, base64ToBytes(k.encryptedWif)));
            } catch (err) {
                throw sealOpenError(err, 'imported key');
            }
        }
        if (hasPassphrase) {
            try {
                // The AAD is what distinguishes this blob from a seed blob
                // under the same key, so it is mandatory on both sides. Kept in
                // BYTES the whole way across: decoding to a string would put
                // the passphrase somewhere that cannot be zeroed (§17.7.3),
                // and nothing here needs to read it.
                passphrase = await decrypt(
                    oldKey, base64ToBytes(wallet.encryptedPassphrase), PASSPHRASE_AAD,
                );
            } catch (err) {
                throw sealOpenError(err, 'passphrase');
            }
        }

        // Fresh salt, inherited cost, never below the floor. `makeFreshKdfParams` supplies the salt.
        // A sub-floor cost may still OPEN (validateKdfParams), but THIS device's password is a new
        // secret, and sealing it at a backup's weak cost would make it cheap to guess.
        const nextParams = kdfParams ?? makeFreshKdfParams({
            iterations: Math.max(wallet.kdfParams.iterations, KDF_MIN_ITERATIONS),
            memory: Math.max(wallet.kdfParams.memory, KDF_MIN_MEMORY_KIB),
            parallelism: wallet.kdfParams.parallelism,
        });
        newKey = await deriveMasterKeyAsync(devicePassword, nextParams);
        try {
            if (seed) {
                wallet.encryptedSeed = (await encryptWalletSeed({
                    seed,
                    kdfParams: nextParams,
                    masterKey: newKey,
                })).encryptedSeed;
            }
            for (let i = 0; i < sealedKeys.length; i += 1) {
                sealedKeys[i].encryptedWif = bytesToBase64(await encrypt(newKey, wifs[i]));
            }
            if (passphrase) {
                wallet.encryptedPassphrase = bytesToBase64(
                    await encrypt(newKey, passphrase, PASSPHRASE_AAD),
                );
            }
            wallet.kdfParams = nextParams;
        } finally {
            if (seed) seed.fill(0);
            for (const wif of wifs) wif.fill(0);
            if (passphrase) passphrase.fill(0);
            seed = null;
            wifs = [];
            passphrase = null;
        }
        // Lend the key to the shell, whose signer-pool unlock would otherwise
        // derive it again from the same password and params. The plaintext
        // secrets are already zeroed; this buffer is zeroed right after.
        if (onDeviceKey) await onDeviceKey(newKey, { ...nextParams });
        return true;
    } finally {
        if (oldKey) oldKey.fill(0);
        if (newKey) newKey.fill(0);
        if (seed) seed.fill(0);
        for (const wif of wifs) wif.fill(0);
        if (passphrase) passphrase.fill(0);
        oldKey = null;
        newKey = null;
        seed = null;
        wifs = [];
        passphrase = null;
    }
}

/** @returns {ImportBackupFileResult['writes']} */
function emptyRestoreCounts() {
    return {
        wallets: 0,
        accounts: 0,
        addresses: 0,
        contacts: 0,
        connectedSites: 0,
        signers: 0,
        pendingTxs: 0,
        settings: false,
    };
}

async function stageCollection(collection, records, onConflict, writes, skipped, name, migrateRecord, staged) {
    if (typeof migrateRecord !== 'function') {
        throw new Error(`stageCollection: a migrator is required for "${name}"`);
    }
    for (const rec of records) {
        if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
        const existing = await collection.get(rec.id);
        if (existing && onConflict === 'preserve') {
            skipped[name] += 1;
            continue;
        }
        // Idempotent: a record already at the current version has no step to
        // walk. A record from a NEWER release is refused by the harness itself
        // (§11.6, "downgrade is unsupported"), which names the two versions;
        // that is a better error than the validator's field-by-field one, and
        // the honest outcome either way, since this build cannot know the
        // fields that release added.
        staged.push({ store: collection, record: migrateRecord(rec), previous: existing });
        writes[name] += 1;
    }
}

/**
 * Write the staged restore records as one unit. The core Vault saves them in
 * a single document write; a vault without `putMany` gets them one at a time,
 * and a failure part-way puts back what the earlier writes replaced and
 * removes what they added before the error goes on.
 */
async function writeStaged(vault, staged) {
    if (staged.length === 0) return;
    if (typeof vault.putMany === 'function') {
        await vault.putMany(staged.map(({ store, record }) => ({ store, record })));
        return;
    }
    const done = [];
    try {
        for (const entry of staged) {
            await entry.store.put(entry.record);
            done.push(entry);
        }
    } catch (err) {
        for (const entry of done.reverse()) {
            try {
                if (entry.previous) await entry.store.put(entry.previous);
                else if (typeof entry.store.delete === 'function') await entry.store.delete(entry.record.id);
            } catch { /* the original error is the one to report */ }
        }
        throw err;
    }
}

function addressScopeKey(record) {
    return JSON.stringify([record?.chain, record?.network, record?.address]);
}

function pendingTxScopeKey(record) {
    return JSON.stringify([record?.chain, record?.network, record?.fromAddress]);
}

/**
 * @param {string} kind
 * @param {{ id: string, walletId: string }[]} records
 * @param {string} walletId
 */
function assertWalletScoped(kind, records, walletId) {
    for (const record of records) {
        if (record.walletId !== walletId) {
            throw new Error(`importBackupFile: ${kind} "${record.id}" belongs to another wallet`);
        }
    }
}

function prepareDecodedPayload(decoded, { chainRegistry }) {
    // A backup taken before wallet mode moved onto the wallet carries the
    // mode in its own settings; that value, never the receiving vault's,
    // is the one its wallet had.
    decoded.wallet = migrateWallet(decoded.wallet, { legacyWalletMode: decoded.settings?.walletMode });
    decoded.accounts = migratePayloadRecords(decoded.accounts, 'accounts', migrateAccount);
    decoded.addresses = migratePayloadRecords(decoded.addresses, 'addresses', migrateAddress);
    decoded.contacts = migratePayloadRecords(decoded.contacts, 'contacts', migrateContact);
    decoded.connectedSites = migratePayloadRecords(
        decoded.connectedSites, 'connectedSites', migrateConnectedSite,
    );
    decoded.pendingTxs = migratePayloadRecords(decoded.pendingTxs, 'pendingTxs', migratePendingTx);
    decoded.signers = migratePayloadRecords(decoded.signers, 'signers', migrateSigner);
    if (decoded.settings != null) decoded.settings = migrateSettings(decoded.settings, legacySettingsMigrationCtx());

    const walletId = decoded.wallet.id;
    const accountIds = new Set(decoded.accounts.map((account) => account.id));
    assertWalletScoped('account', decoded.accounts, walletId);
    assertWalletScoped('signer', decoded.signers, walletId);

    const importedAddressIds = new Set(
        (Array.isArray(decoded.wallet.importedKeys) ? decoded.wallet.importedKeys : [])
            .map((key) => key?.addressId)
            .filter((id) => typeof id === 'string' && id.length > 0),
    );
    const addressScopes = new Set();
    for (const address of decoded.addresses) {
        const belongsToAccount = typeof address.accountId === 'string'
            && accountIds.has(address.accountId);
        if (!belongsToAccount && !importedAddressIds.has(address.id)) {
            throw new Error(`importBackupFile: address "${address.id}" belongs to another wallet`);
        }
        addressScopes.add(addressScopeKey(address));
    }
    // An imported key whose address record is absent is tolerated, as it
    // always was: the exporter only copies address records that still exist,
    // so a backup written after an address was removed carries the dangling
    // reference, and refusing it would make that backup unrestorable.

    // Earlier exporters scoped pending transactions by address text alone, so
    // a valid older backup can carry one from another chain or network that
    // shares the text. Drop it rather than refuse the whole restore; it is
    // still never written.
    decoded.pendingTxs = decoded.pendingTxs.filter(
        (pendingTx) => addressScopes.has(pendingTxScopeKey(pendingTx)),
    );
    decoded.connectedSites = decoded.connectedSites.flatMap((site) => {
        const grantedAccounts = site?.permissions?.accounts;
        if (!Array.isArray(grantedAccounts)) return [site];
        // An empty grant is the section 43.3 wildcard: it names no account to
        // scope, and dropping it would lose the connection on restore.
        if (grantedAccounts.length === 0) return [site];
        const scopedAccounts = grantedAccounts.filter((accountId) => accountIds.has(accountId));
        if (scopedAccounts.length === 0) return [];
        return [{
            ...site,
            permissions: { ...site.permissions, accounts: scopedAccounts },
        }];
    });

    // The vault validates each record on put and saves after every put, so a
    // record it refuses late in the list would leave the earlier collections
    // written. Run the same validators here, before the first write.
    assertRecordsValid('accounts', decoded.accounts, validateAccount);
    assertRecordsValid('addresses', decoded.addresses, validateAddress);
    assertAddressTypesSupported(decoded.addresses, chainRegistry);
    assertRecordsValid('contacts', decoded.contacts, validateContact);
    assertRecordsValid('connectedSites', decoded.connectedSites, validateConnectedSite);
    assertRecordsValid('signers', decoded.signers, validateSignerRecord);
    assertRecordsValid('pendingTxs', decoded.pendingTxs, validatePendingTx);
    if (decoded.settings != null) assertRecordsValid('settings', [decoded.settings], validateSettings);
}

function assertAddressTypesSupported(addresses, chainRegistry) {
    for (const [index, address] of addresses.entries()) {
        if (address.source === 'imported-wif'
            && /^04[0-9a-f]{128}$/i.test(address.publicKey)
            && address.addressType !== 'p2pkh') {
            throw new Error(
                `importBackupFile: payload addresses[${index}] is an uncompressed key with `
                + `addressType "${address.addressType}"; an uncompressed key only has a p2pkh address`,
            );
        }
        const chainId = chainRegistry.chainIdFor(address.chain, address.network);
        if (!chainId) continue;
        const descriptor = chainRegistry.descriptorFor(chainId);
        if (descriptor && !descriptor.addressTypes.includes(address.addressType)) {
            throw new Error(
                `importBackupFile: payload addresses[${index}] has addressType `
                + `"${address.addressType}", which chain "${address.chain}" `
                + `(${address.network}) does not support`,
            );
        }
    }
}

function assertRecordsValid(name, records, validate) {
    for (const [index, record] of records.entries()) {
        const outcome = validate(record);
        if (!outcome.ok) {
            throw new Error(
                `importBackupFile: payload ${name}[${index}] is invalid (${outcome.errors.join('; ')})`,
            );
        }
    }
}

function migratePayloadRecords(records, name, migrateRecord) {
    if (records == null) return [];
    if (!Array.isArray(records)) {
        throw new Error(`importBackupFile: payload ${name} must be an array`);
    }
    return records.map((record, index) => {
        if (!record || typeof record !== 'object'
            || typeof record.id !== 'string' || record.id.length === 0) {
            throw new Error(`importBackupFile: payload ${name}[${index}] has no id`);
        }
        return migrateRecord(record);
    });
}

/**
 * Check, without touching any vault, that a backup file would restore: the
 * envelope opens with `password`, the payload is one this build can read and
 * validate, and the wallet's own seals open with `walletPassword` (the file
 * password when omitted). The Forgot Password page runs this BEFORE erasing
 * anything, so a wrong file or a wrong password erases nothing (operator
 * ruling 2026-11-16).
 *
 * The restore's own steps run on a private copy of the decoded payload, so
 * "verified" means the same checks a restore makes, and every decrypted seed,
 * key and passphrase is zeroed before this returns.
 *
 * @param {Object} opts
 * @param {string} opts.fileContent
 * @param {string} opts.password           the backup file's password
 * @param {string} [opts.walletPassword]   the backed-up wallet's own password, when it differs
 * @param {string[]} [opts.currentWalletIds] wallet ids recorded for this locked vault
 * @param {import('../registry/index.js').ChainRegistry} [opts.chainRegistry]
 * @returns {Promise<{ verified: true, walletName: string, belongsToVault: boolean }>}
 * @throws {import('../crypto/backup.js').BackupPasswordError} the file password is wrong
 * @throws {BackupSeedPasswordError} the wallet inside needs its own password
 */
export async function verifyBackupFileForRestore({
    fileContent, password, walletPassword, currentWalletIds = [], chainRegistry = defaultRegistry(),
}) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('verifyBackupFileForRestore: password is required');
    }
    const envelope = parseBackupEnvelope(fileContent);
    const decoded = /** @type {BackupPayload} */ (
        await decodeBackupEnvelope({ password, envelope })
    );
    if (!decoded || typeof decoded !== 'object') {
        throw new Error('importBackupFile: decoded payload is not an object');
    }
    if (decoded.payloadVersion !== BACKUP_PAYLOAD_VERSION) {
        throw new Error(
            `importBackupFile: unsupported payloadVersion ${decoded.payloadVersion} (expected ${BACKUP_PAYLOAD_VERSION})`,
        );
    }
    if (!decoded.wallet || typeof decoded.wallet.id !== 'string' || decoded.wallet.id.length === 0) {
        throw new Error('importBackupFile: payload missing wallet record');
    }
    prepareDecodedPayload(decoded, { chainRegistry });
    const opener = typeof walletPassword === 'string' && walletPassword.length > 0 ? walletPassword : password;
    // The re-seal proves every seal opens; its result is a copy nobody keeps.
    await rekeyWalletRecord(decoded.wallet, { walletPassword: opener, devicePassword: opener });
    const belongsToVault = Array.isArray(currentWalletIds)
        && currentWalletIds.some((walletId) => walletId === decoded.wallet.id);
    return {
        verified: true,
        walletName: typeof decoded.wallet.name === 'string' ? decoded.wallet.name : '',
        belongsToVault,
    };
}
