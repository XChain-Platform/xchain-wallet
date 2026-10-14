// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vault: the wallet's persistent-state facade. Owns the in-memory
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
//   - Reads migrate records forward via the schema migration harness and
//     cache the result. The on-disk record stays at its stored version until
//     the next write.
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
    migrateCoSignerAccount,
    migratePendingAirdrop,
    migratePendingTx,
    migrateSettings,
    migrateSigner,
    migrateWallet,
    migrateWatchlistEntry,
    migratePriceAlert,
    migrateGatedKey,
    migratePendingDeploy,
    migrateAutopayOrder,
    migrateAutopayLease,
} from '../schemas/migrations.js';
import { validateAccount } from '../schemas/account.js';
import { validateAddress } from '../schemas/address.js';
import { validateConnectedSite } from '../schemas/connectedSite.js';
import { validateContact } from '../schemas/contact.js';
import { validatePendingAirdrop } from '../schemas/pendingAirdrop.js';
import { validatePendingDeploy } from '../schemas/pendingDeploy.js';
import { validatePendingTx } from '../schemas/pendingTx.js';
import { validateMultisigSigningSession } from '../schemas/multisigSigningSession.js';
import { validateCoSignerAccount } from '../schemas/coSignerAccount.js';
import { deflateSettings, inflateSettings, validateSettings } from '../schemas/settings.js';
import { validateSignerRecord } from '../schemas/signer.js';
import { validateWallet } from '../schemas/wallet.js';
import { validateWatchlistEntry } from '../schemas/watchlistEntry.js';
import { validateGatedKey } from '../schemas/gatedKey.js';
import { validateAutopayOrder } from '../schemas/autopayOrder.js';
import { validateAutopayLease } from '../schemas/autopayLease.js';
import { validatePriceAlert } from '../schemas/priceAlert.js';
import { logConsole } from '../shared/utils/logConsole.js';

export class VaultStateError extends Error {
    constructor(msg) {
        super(msg);
        this.name = 'VaultStateError';
    }
}

export class VaultValidationError extends Error {
    constructor(collection, errors) {
        super(`Vault: invalid ${collection} record: ${errors.join('; ')}`);
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
        /** @type {Promise<void> | null} */
        this._opening = null;
        // Every document write runs in invocation order. A rejected write is
        // absorbed only by the tail so later operations can still proceed.
        this._writeTail = Promise.resolve();

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
        // PC-38: crash-safe state for the multi-transaction chunked DEPLOY.
        this.pendingDeploys = makeCollection(
            this,
            'pendingDeploys',
            migratePendingDeploy,
            validatePendingDeploy,
        );
        this.watchlistEntries = makeCollection(
            this,
            'watchlistEntries',
            migrateWatchlistEntry,
            validateWatchlistEntry,
        );
        this.priceAlerts = makeCollection(
            this,
            'priceAlerts',
            migratePriceAlert,
            validatePriceAlert,
        );
        this.multisigSigningSessions = makeCollection(
            this,
            'multisigSigningSessions',
            migrateMultisigSigningSession,
            validateMultisigSigningSession,
        );
        this.coSignerAccounts = makeCollection(
            this,
            'coSignerAccounts',
            migrateCoSignerAccount,
            validateCoSignerAccount,
        );
        // PC-25 gated pack keys. Secret-bearing (see schemas/gatedKey.js):
        // rows carry the raw AES key and must never cross out of the
        // background context with keyHex intact.
        this.gatedKeys = makeCollection(
            this,
            'gatedKeys',
            migrateGatedKey,
            validateGatedKey,
        );
        // PC-16 CoinPay auto-pay: per-order consent + terms (the trust
        // anchor every auto-payment is capped against) and the
        // single-active-payer lease. See schemas/autopayOrder.js.
        this.autopayOrders = makeCollection(
            this,
            'autopayOrders',
            migrateAutopayOrder,
            validateAutopayOrder,
        );
        this.autopayLeases = makeCollection(
            this,
            'autopayLeases',
            migrateAutopayLease,
            validateAutopayLease,
        );
        // Settings are stored SPARSE (§35.10): only deltas from the current
        // release's defaults persist, so retuned defaults reach wallets
        // that never overrode them. Readers always see the full record
        // (inflate on get); writers hand in a full record which is
        // validated full, then reduced to deltas (deflate on put).
        this.settings = makeSingleton(this, 'settings', migrateSettings, validateSettings, {
            inflate: inflateSettings,
            deflate: deflateSettings,
        });
    }

    /**
     * Load the persisted blob (or initialize an empty document if there
     * is none) and put the vault into the "open" state. Idempotent.
     */
    async open() {
        if (this._opened) return;
        if (!this._opening) {
            this._opening = (async () => {
                const blob = await this._backend.load();
                this._doc = blob
                    ? await decodeDocument(this._masterKey, blob, this._aad)
                    : emptyDocument();
                this._opened = true;
                logConsole.record({
                    source: 'vault',
                    level: 'info',
                    message: blob ? 'open (existing)' : 'open (empty)',
                });
            })();
        }
        try {
            await this._opening;
        } finally {
            this._opening = null;
        }
    }

    /** Flush the current document to the backend. */
    async save() {
        this._assertOpen();
        return this._enqueueWrite(() => this._saveNow());
    }

    async _saveNow() {
        this._assertOpen();
        const blob = await encodeDocument(this._masterKey, this._doc, this._aad);
        await this._backend.save(blob);
    }

    /**
     * Clear persisted state and forget the in-memory document. Leaves
     * the vault in a closed state. Callers must `open()` again.
     */
    async clear() {
        return this._enqueueWrite(async () => {
            await this._backend.clear();
            this._doc = null;
            this._opened = false;
            logConsole.record({ source: 'vault', level: 'info', message: 'clear' });
        });
    }

    /**
     * Whether `candidate` is the key this vault is sealed under, compared in
     * constant time. Lets a password change ask "does the old password open
     * the vault?" without decrypting the blob a second time.
     *
     * @param {Uint8Array} candidate
     * @returns {boolean}
     */
    keyMatches(candidate) {
        this._assertOpen();
        if (!(candidate instanceof Uint8Array) || candidate.length !== this._masterKey.length) return false;
        let diff = 0;
        for (let i = 0; i < candidate.length; i += 1) diff |= candidate[i] ^ this._masterKey[i];
        return diff === 0;
    }

    /**
     * Replace wallet records and, when `masterKey` is given, the key the
     * document is sealed under, in ONE blob write.
     *
     * A password change has to move the document key and every wallet seal
     * the old password made together: a crash or a failed write between two
     * separate writes leaves the vault openable by one password and the
     * wallets by the other. So the replacement document is encoded under the
     * new key and saved once, and the in-memory document and key change only
     * after that save returns. A failure leaves both exactly as they were, and
     * the backend's own write is the atomic step (an object-store put, a
     * temp-file rename, the native store's generation swap).
     *
     * The caller keeps ownership of `masterKey`; the vault takes a copy.
     *
     * @param {Object} opts
     * @param {Uint8Array} [opts.masterKey]   the new 32-byte key; omitted keeps the current one
     * @param {Array<import('../schemas/wallet.js').Wallet>} [opts.wallets]   replacements for existing records, matched by id
     * @returns {Promise<void>}
     */
    async rekey({ masterKey, wallets = [] } = {}) {
        this._assertOpen();
        if (masterKey !== undefined && (!(masterKey instanceof Uint8Array) || masterKey.length !== 32)) {
            throw new Error('Vault.rekey: masterKey must be a 32-byte Uint8Array');
        }
        for (const record of wallets) {
            if (!record || typeof record.id !== 'string' || !record.id) {
                throw new VaultValidationError('wallets', ['record.id is required']);
            }
            const result = validateWallet(record);
            if (!result.ok) throw new VaultValidationError('wallets', result.errors);
        }
        return this._enqueueWrite(async () => {
            this._assertOpen();
            const previous = this._doc;
            const arr = [...previous.wallets];
            for (const record of wallets) {
                const idx = arr.findIndex((r) => r.id === record.id);
                if (idx < 0) throw new Error(`Vault.rekey: no wallet with id "${record.id}"`);
                arr[idx] = record;
            }
            const next = { ...previous, wallets: arr };
            const nextKey = masterKey ? new Uint8Array(masterKey) : null;
            try {
                const blob = await encodeDocument(nextKey ?? this._masterKey, next, this._aad);
                await this._backend.save(blob);
            } catch (err) {
                if (nextKey) nextKey.fill(0);
                throw err;
            }
            // A close or clear that landed while the backend settled owns the
            // state now; the blob is written, so only the in-memory copy is skipped.
            if (this._doc !== previous || !this._masterKey) {
                if (nextKey) nextKey.fill(0);
                return;
            }
            if (nextKey) {
                this._masterKey.fill(0);
                this._masterKey = nextKey;
            }
            this._doc = next;
            logConsole.record({ source: 'vault', level: 'info', message: nextKey ? 'rekey' : 'reseal wallets' });
        });
    }

    /** Zero the cached master key and close. Safe to call multiple times. */
    close() {
        if (this._masterKey) this._masterKey.fill(0);
        this._masterKey = null;
        this._doc = null;
        this._opened = false;
        logConsole.record({ source: 'vault', level: 'info', message: 'close' });
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

    _enqueueWrite(operation) {
        const result = this._writeTail.then(operation);
        this._writeTail = result.catch(() => {});
        return result;
    }

    async _mutate(buildNext) {
        this._assertOpen();
        return this._enqueueWrite(async () => {
            this._assertOpen();
            const previous = this._doc;
            const { document, result, persist = true } = buildNext(previous);
            this._doc = document;
            try {
                if (this._autoSave && persist) await this._saveNow();
                return result;
            } catch (err) {
                // A close or clear may replace the document while the backend
                // settles. Restore only the state owned by this operation.
                if (this._doc === document) this._doc = previous;
                throw err;
            }
        });
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
            const arr = vault._doc[collection];
            const idx = arr.findIndex((r) => r.id === id);
            if (idx < 0) return null;
            const migrated = migrate(arr[idx]);
            arr[idx] = migrated;
            return migrated;
        },

        async list() {
            vault._assertOpen();
            return vault._doc[collection].map((r, idx, arr) => {
                const migrated = migrate(r);
                arr[idx] = migrated;
                return migrated;
            });
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
            await vault._mutate((document) => {
                const arr = [...document[collection]];
                const idx = arr.findIndex((r) => r.id === record.id);
                if (idx >= 0) arr[idx] = record;
                else arr.push(record);
                return { document: { ...document, [collection]: arr } };
            });
        },

        async delete(id) {
            vault._assertOpen();
            return vault._mutate((document) => {
                const arr = [...document[collection]];
                const idx = arr.findIndex((r) => r.id === id);
                if (idx < 0) return { document, result: false, persist: false };
                arr.splice(idx, 1);
                return { document: { ...document, [collection]: arr }, result: true };
            });
        },

        async count() {
            vault._assertOpen();
            return vault._doc[collection].length;
        },

        async findBy(field, value) {
            vault._assertOpen();
            const arr = vault._doc[collection];
            const found = [];
            arr.forEach((r, idx) => {
                if (r[field] !== value) return;
                const migrated = migrate(r);
                arr[idx] = migrated;
                found.push(migrated);
            });
            return found;
        },
    };
}

/**
 * @template T
 * @param {Vault} vault
 * @param {string} key
 * @param {(r: T) => T} migrate
 * @param {(r: unknown) => { ok: boolean, errors: string[] }} validate
 * @param {{ inflate?: (r: T) => T, deflate?: (r: T) => T }} [transforms]  storage-form <-> reader-form pair (sparse settings)
 */
function makeSingleton(vault, key, migrate, validate, { inflate, deflate } = {}) {
    return {
        async get() {
            vault._assertOpen();
            const r = vault._doc[key];
            if (!r) return null;
            const migrated = migrate(r);
            vault._doc[key] = migrated;
            return inflate ? inflate(migrated) : migrated;
        },

        async put(record) {
            vault._assertOpen();
            // Validation runs on the full (reader-form) record; only the
            // storage form is reduced.
            const result = validate(record);
            if (!result.ok) {
                throw new VaultValidationError(key, result.errors);
            }
            await vault._mutate((document) => ({
                document: {
                    ...document,
                    [key]: deflate ? deflate(record) : record,
                },
            }));
        },

        async clear() {
            vault._assertOpen();
            await vault._mutate((document) => ({
                document: { ...document, [key]: null },
            }));
        },
    };
}
