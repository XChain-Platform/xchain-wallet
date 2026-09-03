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
// rejects any version but the current one. So the wallet and the settings
// records are migrated on the way out of the envelope; without that, a backup
// taken before a schema bump dies inside the vault's validator on restore.

import {
    decodeBackupEnvelope,
    encodeBackupEnvelope,
    parseBackupEnvelope,
    stringifyBackupEnvelope,
    deriveMasterKey,
    makeFreshKdfParams,
    encrypt,
    decrypt,
    bytesToBase64,
    base64ToBytes,
    PASSPHRASE_AAD,
} from '../crypto/index.js';
import { randomUUID } from '../util/uuid.js';
import { migrateSettings, migrateWallet } from '../schemas/migrations.js';
import { parseBackupPointer } from '../uri/backupPointer.js';
import { WalletNotFoundError } from './unlockWallet.js';
import {
    RESTORE_PASSWORD_LABELS,
    restorePasswordRequiredMessage,
} from './restorePasswordCopy.js';

export const BACKUP_PAYLOAD_VERSION = 1;

export class BackupConflictError extends Error {
    /** @param {string[]} conflicts */
    constructor(conflicts) {
        super(`importBackupFile: refusing to overwrite ${conflicts.length} existing record(s): ${conflicts.slice(0, 5).join(', ')}`);
        this.name = 'BackupConflictError';
        this.conflicts = conflicts;
    }
}

/**
 * The re-key could not open the backed-up wallet's own seal. Deliberately
 * distinct from a bad envelope password: the envelope already opened, so the
 * wrong one is the WALLET's, and the message has to name which.
 */
export class BackupSeedPasswordError extends Error {
    /** @param {string} what   'seed' | 'imported key' | 'passphrase' */
    constructor(what) {
        // Name the password BOX, not the function: the user is looking at three
        // of them and needs to know which one to fix.
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
 * @typedef {Object} BackupPayload
 * @property {1} payloadVersion
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/account.js').Account[]} accounts
 * @property {import('../schemas/address.js').Address[]} addresses
 * @property {import('../schemas/contact.js').Contact[]} contacts
 * @property {import('../schemas/connectedSite.js').ConnectedSite[]} connectedSites
 * @property {import('../schemas/settings.js').Settings | null} settings
 * @property {unknown[]} signers                  reserved; HW pairings land here
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
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('exportBackupFile: password is required');
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const [allAccounts, allAddresses, allContacts, allConnected, allPending, settings] =
        await Promise.all([
            vault.accounts.list(),
            vault.addresses.list(),
            vault.contacts.list(),
            vault.connectedSites.list(),
            vault.pendingTxs.list(),
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
    const addressStrings = new Set(addresses.map((a) => a.address));
    const pendingTxs = includePendingTxs
        ? allPending.filter((p) => addressStrings.has(p.fromAddress))
        : [];

    /** @type {BackupPayload} */
    const payload = {
        payloadVersion: BACKUP_PAYLOAD_VERSION,
        wallet,
        accounts,
        addresses,
        contacts: allContacts,
        connectedSites: allConnected,
        settings,
        signers: [],
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
 */

/**
 * @typedef {Object} ImportBackupFileResult
 * @property {BackupPayload} payload                       the decoded payload (for the shell to surface)
 * @property {string} walletId                             imported wallet id
 * @property {{ wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, pendingTxs: number, settings: boolean }} writes
 * @property {{ wallets: number, accounts: number, addresses: number, contacts: number, connectedSites: number, pendingTxs: number, settings: boolean }} skipped
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
    if (!decoded.wallet || typeof decoded.wallet.id !== 'string') {
        throw new Error('importBackupFile: payload missing wallet record');
    }

    // Migrate the wallet the moment it leaves the envelope, for the same
    // reason settings are migrated below: `put` validates against the CURRENT
    // schema version and never migrates, so a record written before any bump
    // fails the restore rather than the wallet. Ordering is load-bearing:
    // `migrateWallet` returns a NEW object, while the re-key below rewrites
    // the sealed blobs IN PLACE, so migrating afterwards would hand `put` a
    // copy still sealed under the old device's password.
    decoded.wallet = migrateWallet(decoded.wallet);

    // Re-seal key material under the device password BEFORE any write: an
    // unopenable seal then throws at RESTORE time naming which password is
    // wrong, with the vault untouched, not at the user's first signature.
    const rekeyed = await rekeyWalletRecord(decoded.wallet, { walletPassword, devicePassword });

    // §19.4: 'add' mode re-mints wallet / account / address ids so a restored
    // wallet coexists even where both vaults derived equal ones (a same-device
    // from-seed restore does); globally-id'd records fall through to
    // onConflict.
    if (mode === 'add') {
        remintIdentifiers(decoded);
    }

    // Collect conflicts up-front so onConflict='error' fails fast. 'add' mode
    // skips the wallet / account / address ids just re-minted, leaving
    // contacts and connectedSites as the only records that can still collide.

    // Settings is exempt in 'add' mode: the vault-global singleton always
    // exists, so an incoming record would always collide and fail every
    // restore-alongside. A joining wallet does not redefine the vault's
    // network / fee / privacy choices, so its settings are not applied.
    const conflicts = await collectConflicts(
        vault, decoded, { skipWalletScoped: mode === 'add', skipSettings: mode === 'add' },
    );
    if (conflicts.length > 0 && onConflict === 'error') {
        throw new BackupConflictError(conflicts);
    }

    const writes = {
        wallets: 0,
        accounts: 0,
        addresses: 0,
        contacts: 0,
        connectedSites: 0,
        pendingTxs: 0,
        settings: false,
    };
    const skipped = {
        wallets: 0,
        accounts: 0,
        addresses: 0,
        contacts: 0,
        connectedSites: 0,
        pendingTxs: 0,
        settings: false,
    };

    await applyCollection(vault.wallets, [decoded.wallet], onConflict, writes, skipped, 'wallets');
    await applyCollection(vault.accounts, decoded.accounts ?? [], onConflict, writes, skipped, 'accounts');
    await applyCollection(vault.addresses, decoded.addresses ?? [], onConflict, writes, skipped, 'addresses');
    await applyCollection(vault.contacts, decoded.contacts ?? [], onConflict, writes, skipped, 'contacts');
    await applyCollection(vault.connectedSites, decoded.connectedSites ?? [], onConflict, writes, skipped, 'connectedSites');
    await applyCollection(vault.pendingTxs, decoded.pendingTxs ?? [], onConflict, writes, skipped, 'pendingTxs');

    // Settings is a singleton, so overwrite/preserve covers the whole record.
    // In 'add' mode the vault's own settings win even under 'overwrite': that
    // flag resolves collisions for the wallet being restored, never the
    // vault-wide configuration the user is currently running under.
    if (decoded.settings) {
        const existing = await vault.settings.get();
        if (!existing || (onConflict === 'overwrite' && mode !== 'add')) {
            // A backup can carry an older schema (e.g. a v2 record whose
            // per-chain values are frozen copies of that release's
            // defaults); migrate before put or validation rejects it.
            await vault.settings.put(migrateSettings(decoded.settings));
            writes.settings = true;
        } else {
            skipped.settings = true;
        }
    }

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
 */

/**
 * @typedef {ImportBackupFileResult & { pointer: import('../uri/backupPointer.js').BackupPointer }} RestoreFromBackupPointerResult
 */

/**
 * §15.4 QR-from-backup-pointer restore: resolve the pointer through the
 * shell-injected `resolveBackupContent`, then run the file lane's own
 * `importBackupFile` decrypt-and-merge. A pointer carries only a location, so
 * the envelope is still password-encrypted and the caller supplies its password.
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
    });

    return { ...result, pointer: parsed };
}

/**
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {BackupPayload} payload
 * @param {{ skipWalletScoped?: boolean, skipSettings?: boolean }} [opts]
 *        skipWalletScoped: skip wallets / accounts / addresses /
 *          pendingTxs (the four collections whose ids `add`-mode has
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
        await check(vault.pendingTxs, payload.pendingTxs ?? [], 'pendingTxs');
    }
    await check(vault.contacts, payload.contacts ?? [], 'contacts');
    await check(vault.connectedSites, payload.connectedSites ?? [], 'connectedSites');
    if (!opts.skipSettings && payload.settings && (await vault.settings.get())) out.push('settings');
    return out;
}

/**
 * Re-mint wallet / account / address ids in place so an `add`-mode import lands
 * alongside the vault's own, rewiring every field that references one.
 * Contacts / connectedSites / settings ids are global and stay as-is.
 * Exported for tests; production goes through `importBackupFile({mode:'add'})`.
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

    // Wallet's importedKeys point at the re-minted address ids by
    // value; rewire so a wif-imported wallet lands intact.
    if (Array.isArray(decoded.wallet.importedKeys)) {
        for (const ik of decoded.wallet.importedKeys) {
            if (ik && typeof ik.addressId === 'string' && addressIdMap.has(ik.addressId)) {
                ik.addressId = addressIdMap.get(ik.addressId);
            }
        }
    }

    // PendingTxs: re-mint only the id so a re-import cannot collide.
    // fromAddress is the canonical address STRING, not an id, so it survives
    // the re-mint and the rest of the row stays untouched.
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
 * New params copy the source's argon2 COST but ALWAYS take a fresh salt: one
 * salt reused under one password derives the same master key for two wallets.
 * That fresh salt is also why the passphrase cannot simply ride through
 * verbatim: nothing about the new seal matches the old one, so an untouched
 * passphrase blob would fail its GCM tag at the first unlock and leave a wallet
 * that opens but derives the wrong seed.
 * @param {import('../schemas/wallet.js').Wallet} wallet
 * @param {Object} opts
 * @param {string} opts.walletPassword    what the backed-up wallet was sealed under
 * @param {string} opts.devicePassword    what it must open under from now on
 * @param {import('../crypto/kdf.js').KdfParams} [opts.kdfParams]  override for the new seal
 * @returns {Promise<boolean>}            true if anything was re-sealed
 */
export async function rekeyWalletRecord(wallet, { walletPassword, devicePassword, kdfParams }) {
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
    if (typeof walletPassword !== 'string' || walletPassword.length === 0) {
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

    const oldKey = deriveMasterKey(walletPassword, wallet.kdfParams);
    let seed = null;
    /** @type {Uint8Array[]} */
    let wifs = [];
    /** @type {Uint8Array | null} */
    let passphrase = null;
    try {
        if (hasSeed) {
            try {
                seed = await decrypt(oldKey, base64ToBytes(wallet.encryptedSeed));
            } catch {
                throw new BackupSeedPasswordError('seed');
            }
        }
        for (const k of sealedKeys) {
            try {
                wifs.push(await decrypt(oldKey, base64ToBytes(k.encryptedWif)));
            } catch {
                throw new BackupSeedPasswordError('imported key');
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
            } catch {
                throw new BackupSeedPasswordError('passphrase');
            }
        }
    } finally {
        oldKey.fill(0);
    }

    // Fresh salt, inherited cost. `makeFreshKdfParams` supplies the salt.
    const nextParams = kdfParams ?? makeFreshKdfParams({
        iterations: wallet.kdfParams.iterations,
        memory: wallet.kdfParams.memory,
        parallelism: wallet.kdfParams.parallelism,
    });
    const newKey = deriveMasterKey(devicePassword, nextParams);
    try {
        if (seed) wallet.encryptedSeed = bytesToBase64(await encrypt(newKey, seed));
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
        newKey.fill(0);
        if (seed) seed.fill(0);
        for (const w of wifs) w.fill(0);
        if (passphrase) passphrase.fill(0);
        seed = null;
        wifs = [];
        passphrase = null;
    }
    return true;
}

async function applyCollection(collection, records, onConflict, writes, skipped, name) {
    for (const rec of records) {
        if (!rec || typeof rec.id !== 'string' || !rec.id) continue;
        const existing = await collection.get(rec.id);
        if (existing && onConflict === 'preserve') {
            skipped[name] += 1;
            continue;
        }
        await collection.put(rec);
        writes[name] += 1;
    }
}
