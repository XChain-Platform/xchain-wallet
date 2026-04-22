// Vault-document codec. Serializes the in-memory document shape to a
// ciphertext blob using AES-256-GCM under the master key.
//
// Document layout (post-decrypt JSON):
//   {
//     documentVersion: 1,             // codec-level version, not schema
//     wallets: Wallet[],
//     accounts: Account[],
//     addresses: Address[],
//     contacts: Contact[],
//     connectedSites: ConnectedSite[],
//     pendingTxs: PendingTx[],
//     settings: Settings | null,      // singleton slot
//   }
//
// Migrations between documentVersions live here; migrations on the
// contained records live in schemas/migrations.js and run on read from
// the Vault accessors.

import { decrypt, encrypt } from '../crypto/aead.js';

export const DOCUMENT_VERSION = 1;

/** @returns {VaultDocument} */
export function emptyDocument() {
    return {
        documentVersion: DOCUMENT_VERSION,
        wallets: [],
        accounts: [],
        addresses: [],
        contacts: [],
        connectedSites: [],
        pendingTxs: [],
        settings: null,
    };
}

/**
 * @typedef {Object} VaultDocument
 * @property {number} documentVersion
 * @property {import('../schemas/wallet.js').Wallet[]} wallets
 * @property {import('../schemas/account.js').Account[]} accounts
 * @property {import('../schemas/address.js').Address[]} addresses
 * @property {import('../schemas/contact.js').Contact[]} contacts
 * @property {import('../schemas/connectedSite.js').ConnectedSite[]} connectedSites
 * @property {import('../schemas/pendingTx.js').PendingTx[]} pendingTxs
 * @property {import('../schemas/settings.js').Settings | null} settings
 */

/**
 * Encrypt a document for backend persistence.
 *
 * @param {Uint8Array} masterKey
 * @param {VaultDocument} document
 * @param {Uint8Array} [aad]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeDocument(masterKey, document, aad) {
    const json = JSON.stringify(document);
    const plaintext = new TextEncoder().encode(json);
    try {
        return await encrypt(masterKey, plaintext, aad);
    } finally {
        plaintext.fill(0);
    }
}

/**
 * Decrypt and parse a persisted blob into a document. Throws on auth
 * failure (wrong master key or tampered blob) or on an unrecognized
 * documentVersion.
 *
 * @param {Uint8Array} masterKey
 * @param {Uint8Array} blob
 * @param {Uint8Array} [aad]
 * @returns {Promise<VaultDocument>}
 */
export async function decodeDocument(masterKey, blob, aad) {
    const plaintext = await decrypt(masterKey, blob, aad);
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
        plaintext.fill(0);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('codec: decoded payload is not an object');
    }
    if (parsed.documentVersion !== DOCUMENT_VERSION) {
        throw new Error(
            `codec: unsupported documentVersion ${parsed.documentVersion} (expected ${DOCUMENT_VERSION})`,
        );
    }
    const empty = emptyDocument();
    // Defensively merge against an empty doc so missing collections read
    // as [] rather than undefined. Older persisted docs stay loadable
    // even if a new collection is added later at documentVersion 1.
    return {
        documentVersion: parsed.documentVersion,
        wallets: parsed.wallets ?? empty.wallets,
        accounts: parsed.accounts ?? empty.accounts,
        addresses: parsed.addresses ?? empty.addresses,
        contacts: parsed.contacts ?? empty.contacts,
        connectedSites: parsed.connectedSites ?? empty.connectedSites,
        pendingTxs: parsed.pendingTxs ?? empty.pendingTxs,
        settings: parsed.settings ?? empty.settings,
    };
}
