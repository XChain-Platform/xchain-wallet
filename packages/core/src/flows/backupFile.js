// Encrypted backup-file flows — §19.4.
//
// `exportBackupFile` reads everything the vault knows about a wallet
// (wallet record incl. encryptedSeed + importedKeys, accounts, addresses
// incl. labels + pinned state, contacts, connectedSites, settings,
// pendingTxs) and wraps it in the §19.4 envelope under a user-chosen
// password. The password is independent of the wallet-unlock password.
//
// `importBackupFile` decrypts an envelope, validates the shape, and
// merges the contents back into the live vault. Conflict policy:
//
//   onConflict = 'overwrite'   existing records replaced by incoming
//   onConflict = 'preserve'    existing records kept; incoming skipped if id matches
//   onConflict = 'error'       throw BackupConflictError if any collision exists
//
// Not included in the payload (per §19.4):
//   - BIP39 passphrase (user re-enters on restore — the passphrase is a
//     security property of the seed, not stored state).
//   - Hardware-wallet private keys (they live on the device; the backup
//     only records the pairing metadata in `signers`).
//
// `signers` is reserved in the payload shape for future hardware-signer
// records. Phase 1 ships only SoftwareSigner (coupled 1:1 with the
// wallet record), so the list is currently empty both ways.

import {
    decodeBackupEnvelope,
    encodeBackupEnvelope,
    parseBackupEnvelope,
    stringifyBackupEnvelope,
} from '../crypto/index.js';
import { randomUUID } from '../util/uuid.js';
import { WalletNotFoundError } from './unlockWallet.js';

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
 * @property {string} password
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
 */

/**
 * @param {ImportBackupFileOpts} opts
 * @returns {Promise<ImportBackupFileResult>}
 */
export async function importBackupFile({
    vault,
    fileContent,
    password,
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

    // §19.4 / Cluster H FOLLOWUP 3 — 'add' mode re-mints wallet /
    // account / address ids so the restored wallet coexists with what
    // the vault already has, even if the source vault and target vault
    // happened to share an id (a from-seed restore on the same device,
    // for example, would deterministically produce some equal ids).
    // Contacts / connectedSites / settings stay shared (their ids are
    // already global) — collisions there fall through to the existing
    // onConflict policy.
    if (mode === 'add') {
        remintIdentifiers(decoded);
    }

    // Collect conflicts up-front; onConflict='error' fails fast. Add
    // mode skips the wallet / account / address collisions because we
    // just re-minted those ids — only contacts / connectedSites /
    // settings can still conflict.
    const conflicts = await collectConflicts(
        vault, decoded, { skipWalletScoped: mode === 'add' },
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

    // Settings is a singleton — overwrite/preserve decisions apply to
    // the whole record.
    if (decoded.settings) {
        const existing = await vault.settings.get();
        if (!existing || onConflict === 'overwrite') {
            await vault.settings.put(decoded.settings);
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
    };
}

/**
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {BackupPayload} payload
 * @param {{ skipWalletScoped?: boolean }} [opts]   when true, skip
 *                                                  wallets / accounts /
 *                                                  addresses / pendingTxs
 *                                                  (the four collections
 *                                                  whose ids `add`-mode
 *                                                  has already re-minted)
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
    if (payload.settings && (await vault.settings.get())) out.push('settings');
    return out;
}

/**
 * Re-mint wallet / account / address ids on the decoded payload so
 * an `add`-mode import can land alongside what the vault already
 * has. Mutates `decoded` in place. Updates every field that
 * references one of the re-minted ids:
 *
 *   - wallet.id
 *   - wallet.importedKeys[].addressId
 *   - account.id, account.walletId
 *   - address.id, address.accountId
 *   - pendingTx.id    (kept independent — pending txs are address-scoped
 *                     via `fromAddress`, not id-scoped)
 *
 * Contacts / connectedSites / settings ids stay as-is (they're global
 * across wallets and there's nothing to disambiguate). Exported for
 * test access; production callers go through `importBackupFile({mode:
 * 'add'})`.
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

    // Wallet's importedKeys point at the re-minted address ids by
    // value; rewire so a wif-imported wallet lands intact.
    if (Array.isArray(decoded.wallet.importedKeys)) {
        for (const ik of decoded.wallet.importedKeys) {
            if (ik && typeof ik.addressId === 'string' && addressIdMap.has(ik.addressId)) {
                ik.addressId = addressIdMap.get(ik.addressId);
            }
        }
    }

    // PendingTxs — re-mint id so a re-import of the same backup doesn't
    // collide; keep the rest of the row (fromAddress / txid / status)
    // untouched. fromAddress is the canonical address string, not an
    // id, so it survives the address-id re-mint.
    for (const ptx of decoded.pendingTxs ?? []) {
        if (ptx && typeof ptx.id === 'string') {
            ptx.id = randomUUID();
        }
    }
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
