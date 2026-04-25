// Vault — the wallet's persistent-state facade. Owns the in-memory
// document, coordinates encrypt-on-save / decrypt-on-load through the
// codec, and exposes typed per-collection handles.
//
// Lifecycle:
//   const vault = new Vault({ backend, masterKey });
//   await vault.open();                // load blob or init empty
//   await vault.wallets.put(record);
//   const w = await vault.wallets.get(id);
//   await vault.close();               // zeros the cached masterKey
//
// Design choices:
//   - Every mutation auto-saves. Shells that want batching can set
//     autoSave: false and call vault.save() explicitly.
//   - Reads migrate records forward via the schema migration harness.
//     Migrations run lazily — the on-disk record stays at its stored
//     version until the next write.
//   - AAD is optional; when supplied it's passed through to AEAD
//     unchanged on both save and load.

import {
    DOCUMENT_VERSION,
    decodeDocument,
    emptyDocument,
    encodeDocument,
} from './codec.js';
import {
    migrateAccount,
    migrateAddress,
    migrateConnectedSite,
    migrateContact,
    migrateMultisigSigningSession,
    migratePendingAirdrop,
    migratePendingTx,
    migrateSettings,
    migrateSigner,
    migrateWallet,
    migrateWatchlistEntry,
} from '../schemas/migrations.js';
import { validateAccount } from '../schemas/account.js';
import { validateAddress } from '../schemas/address.js';
import { validateConnectedSite } from '../schemas/connectedSite.js';
import { validateContact } from '../schemas/contact.js';
import { validatePendingAirdrop } from '../schemas/pendingAirdrop.js';
import { validatePendingTx } from '../schemas/pendingTx.js';
import { validateMultisigSigningSession } from '../schemas/multisigSigningSession.js';
import { validateSettings } from '../schemas/settings.js';
import { validateSignerRecord } from '../schemas/signer.js';
import { validateWallet } from '../schemas/wallet.js';
import { validateWatchlistEntry } from '../schemas/watchlistEntry.js';

export class VaultStateError extends Error {
    constructor(msg) {
        super(msg);
        this.name = 'VaultStateError';
    }
}

export class VaultValidationError extends Error {
    constructor(collection, errors) {
        super(`Vault: invalid ${collection} record — ${errors.join('; ')}`);
        this.name = 'VaultValidationError';
        this.collection = collection;
        this.errors = errors;
    }
}

/**
 * @typedef {Object} VaultOpts
 * @property {import('./backend.js').StorageBackend} backend
 * @property {Uint8Array} masterKey               32 bytes; caller retains lifetime
 * @property {Uint8Array} [aad]
 * @property {boolean} [autoSave]                 default true
 */

export class Vault {
    /** @param {VaultOpts} opts */
    constructor({ backend, masterKey, aad, autoSave = true }) {
        if (!backend) throw new Error('Vault: backend is required');
        if (!(masterKey instanceof Uint8Array) || masterKey.length !== 32) {
            throw new Error('Vault: masterKey must be a 32-byte Uint8Array');
        }
        this._backend = backend;
        this._masterKey = new Uint8Array(masterKey);  // private copy
        this._aad = aad;
        this._autoSave = autoSave;
        /** @type {import('./codec.js').VaultDocument | null} */
        this._doc = null;
        this._opened = false;

        this.wallets = makeCollection(this, 'wallets', migrateWallet, validateWallet);
        this.accounts = makeCollection(this, 'accounts', migrateAccount, validateAccount);
        this.addresses = makeCollection(this, 'addresses', migrateAddress, validateAddress);
        this.contacts = makeCollection(this, 'contacts', migrateContact, validateContact);
        this.connectedSites = makeCollection(
            this,
            'connectedSites',
            migrateConnectedSite,
            validateConnectedSite,
        );
        this.pendingTxs = makeCollection(
            this,
            'pendingTxs',
            migratePendingTx,
            validatePendingTx,
        );
        this.signers = makeCollection(
            this,
            'signers',
            migrateSigner,
            validateSignerRecord,
        );
        this.pendingAirdrops = makeCollection(
            this,
            'pendingAirdrops',
            migratePendingAirdrop,
            validatePendingAirdrop,
        );
        this.watchlistEntries = makeCollection(
            this,
            'watchlistEntries',
            migrateWatchlistEntry,
            validateWatchlistEntry,
        );
        this.multisigSigningSessions = makeCollection(
            this,
            'multisigSigningSessions',
            migrateMultisigSigningSession,
            validateMultisigSigningSession,
        );
        this.settings = makeSingleton(this, 'settings', migrateSettings, validateSettings);
    }

    /**
     * Load the persisted blob (or initialize an empty document if there
     * is none) and put the vault into the "open" state. Idempotent.
     */
    async open() {
        if (this._opened) return;
        const blob = await this._backend.load();
        this._doc = blob
            ? await decodeDocument(this._masterKey, blob, this._aad)
            : emptyDocument();
        this._opened = true;
    }

    /** Flush the current document to the backend. */
    async save() {
        this._assertOpen();
        const blob = await encodeDocument(this._masterKey, this._doc, this._aad);
        await this._backend.save(blob);
    }

    /**
     * Clear persisted state and forget the in-memory document. Leaves
     * the vault in a closed state — callers must `open()` again.
     */
    async clear() {
        await this._backend.clear();
        this._doc = null;
        this._opened = false;
    }

    /** Zero the cached master key and close. Safe to call multiple times. */
    close() {
        if (this._masterKey) this._masterKey.fill(0);
        this._masterKey = null;
        this._doc = null;
        this._opened = false;
    }

    get documentVersion() {
        return DOCUMENT_VERSION;
    }

    _assertOpen() {
        if (!this._opened || !this._doc) {
            throw new VaultStateError('Vault is not open');
        }
        if (!this._masterKey) {
            throw new VaultStateError('Vault is closed (masterKey cleared)');
        }
    }

    async _maybeAutoSave() {
        if (this._autoSave) await this.save();
    }
}

/**
 * @template T
 * @param {Vault} vault
 * @param {string} collection
 * @param {(r: T) => T} migrate
 * @param {(r: unknown) => { ok: boolean, errors: string[] }} validate
 */
function makeCollection(vault, collection, migrate, validate) {
    return {
        async get(id) {
            vault._assertOpen();
            const found = vault._doc[collection].find((r) => r.id === id);
            return found ? migrate(found) : null;
        },

        async list() {
            vault._assertOpen();
            return vault._doc[collection].map((r) => migrate(r));
        },

        async put(record) {
            vault._assertOpen();
            if (!record || typeof record.id !== 'string' || !record.id) {
                throw new VaultValidationError(collection, ['record.id is required']);
            }
            const result = validate(record);
            if (!result.ok) {
                throw new VaultValidationError(collection, result.errors);
            }
            const arr = vault._doc[collection];
            const idx = arr.findIndex((r) => r.id === record.id);
            if (idx >= 0) arr[idx] = record;
            else arr.push(record);
            await vault._maybeAutoSave();
        },

        async delete(id) {
            vault._assertOpen();
            const arr = vault._doc[collection];
            const idx = arr.findIndex((r) => r.id === id);
            if (idx < 0) return false;
            arr.splice(idx, 1);
            await vault._maybeAutoSave();
            return true;
        },

        async count() {
            vault._assertOpen();
            return vault._doc[collection].length;
        },

        async findBy(field, value) {
            vault._assertOpen();
            return vault._doc[collection]
                .filter((r) => r[field] === value)
                .map((r) => migrate(r));
        },
    };
}

/**
 * @template T
 * @param {Vault} vault
 * @param {string} key
 * @param {(r: T) => T} migrate
 * @param {(r: unknown) => { ok: boolean, errors: string[] }} validate
 */
function makeSingleton(vault, key, migrate, validate) {
    return {
        async get() {
            vault._assertOpen();
            const r = vault._doc[key];
            return r ? migrate(r) : null;
        },

        async put(record) {
            vault._assertOpen();
            const result = validate(record);
            if (!result.ok) {
                throw new VaultValidationError(key, result.errors);
            }
            vault._doc[key] = record;
            await vault._maybeAutoSave();
        },

        async clear() {
            vault._assertOpen();
            vault._doc[key] = null;
            await vault._maybeAutoSave();
        },
    };
}
