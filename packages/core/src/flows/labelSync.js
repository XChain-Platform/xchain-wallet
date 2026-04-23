// Label-sync flows — §19.5.2.
//
// Assembles / applies the labels + contacts payload that the wallet
// publishes on-chain via a FILE action (see §19.5.2 for the privacy
// rationale). The FILE submission itself lives in the shell integration
// — it needs the SDK's FILE action encoder plus a chainId choice, both
// of which are orthogonal to the payload codec. These flows handle
// everything else: payload assembly, cipher derivation, applying a
// decrypted payload back to a vault on restore.
//
// Typical publish:
//   const { ciphertext, discoveryName } = await buildLabelSyncPayload({
//       vault, walletId, seed,
//   });
//   await sdk.encoder.action({ action: 'FILE', params: { name: discoveryName, content: ciphertext } });
//
// Typical restore (after `importMnemonic` has produced a new wallet):
//   const body = await fetchAndDecryptLabelSync({
//       sdk, chainId, commitmentKey,   // discoveryName derived inside
//   });
//   await applyLabelSyncPayload({ vault, walletId, payload: body });

import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    decodeLabelSyncPayload,
    encodeLabelSyncPayload,
} from '../crypto/index.js';
import { WalletNotFoundError } from './unlockWallet.js';

export const LABEL_SYNC_PAYLOAD_VERSION = 1;

/**
 * @typedef {Object} BuildLabelSyncOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {Uint8Array} seed               caller holds the decrypted seed (ephemeral)
 */

/**
 * @typedef {Object} BuildLabelSyncResult
 * @property {Uint8Array} ciphertext         AES-256-GCM `iv || ct || tag`; ready to go into FILE action content
 * @property {string} discoveryName          hex SHA256(commitmentKey); goes into FILE action `name`
 * @property {import('../crypto/labelSync.js').LabelSyncBody} body
 */

/**
 * Read the wallet's labeled addresses + contacts, encrypt them under
 * the seed-derived commitment key, and return the ciphertext +
 * discovery name ready for the caller to ship via a FILE action.
 *
 * @param {BuildLabelSyncOpts} opts
 * @returns {Promise<BuildLabelSyncResult>}
 */
export async function buildLabelSyncPayload({ vault, walletId, seed }) {
    if (!vault) throw new Error('buildLabelSyncPayload: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('buildLabelSyncPayload: walletId is required');
    }
    if (!(seed instanceof Uint8Array) || seed.length === 0) {
        throw new Error('buildLabelSyncPayload: seed must be a non-empty Uint8Array');
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const [allAddresses, allContacts, allAccounts] = await Promise.all([
        vault.addresses.list(),
        vault.contacts.list(),
        vault.accounts.list(),
    ]);
    const accountIds = new Set(
        allAccounts.filter((a) => a.walletId === walletId).map((a) => a.id),
    );
    const importedIds = new Set(wallet.importedKeys.map((k) => k.addressId));

    // Only carry addresses WITH a user-set label. Un-labeled HD
    // addresses are re-derivable; shipping their default labels would
    // just bloat the payload.
    const labels = allAddresses
        .filter(
            (a) =>
                (accountIds.has(a.accountId) || importedIds.has(a.id)) &&
                typeof a.label === 'string' &&
                a.label.length > 0,
        )
        .map((a) => ({ id: a.id, address: a.address, label: a.label }));

    const contacts = allContacts.map((c) => ({
        id: c.id,
        name: c.name,
        notes: c.notes ?? '',
        entries: (c.entries ?? []).map((e) => ({
            chain: e.chain,
            address: e.address,
            label: e.label ?? '',
        })),
    }));

    /** @type {import('../crypto/labelSync.js').LabelSyncBody} */
    const body = {
        version: LABEL_SYNC_PAYLOAD_VERSION,
        updatedAt: new Date().toISOString(),
        labels,
        contacts,
    };

    const commitmentKey = computeLabelSyncCommitmentKey(seed);
    try {
        const discoveryName = computeLabelSyncDiscoveryName(commitmentKey);
        const ciphertext = await encodeLabelSyncPayload(commitmentKey, body);
        return { ciphertext, discoveryName, body };
    } finally {
        commitmentKey.fill(0);
    }
}

/**
 * @typedef {Object} ApplyLabelSyncOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId                         wallet the labels attach to
 * @property {import('../crypto/labelSync.js').LabelSyncBody} payload
 * @property {'overwrite' | 'preserve'} [onConflict]   default 'overwrite' — user asked for sync
 */

/**
 * @typedef {Object} ApplyLabelSyncResult
 * @property {number} addressesUpdated
 * @property {number} addressesSkipped
 * @property {number} addressesMissing                 incoming had labels for addresses not in this wallet
 * @property {number} contactsAdded
 * @property {number} contactsUpdated
 * @property {number} contactsSkipped
 */

/**
 * Match incoming labels to persisted Address records (by id first, by
 * `address` string as fallback — the id can't survive a from-seed
 * restore because the new wallet generates fresh UUIDs for its
 * addresses).
 *
 * @param {ApplyLabelSyncOpts} opts
 * @returns {Promise<ApplyLabelSyncResult>}
 */
export async function applyLabelSyncPayload({
    vault,
    walletId,
    payload,
    onConflict = 'overwrite',
}) {
    if (!vault) throw new Error('applyLabelSyncPayload: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('applyLabelSyncPayload: walletId is required');
    }
    if (!payload || typeof payload !== 'object') {
        throw new Error('applyLabelSyncPayload: payload must be an object');
    }
    if (payload.version !== LABEL_SYNC_PAYLOAD_VERSION) {
        throw new Error(
            `applyLabelSyncPayload: unsupported payload version ${payload.version} (expected ${LABEL_SYNC_PAYLOAD_VERSION})`,
        );
    }
    if (onConflict !== 'overwrite' && onConflict !== 'preserve') {
        throw new Error(
            `applyLabelSyncPayload: onConflict must be 'overwrite' | 'preserve' (got "${onConflict}")`,
        );
    }

    const [allAddresses, allContacts] = await Promise.all([
        vault.addresses.list(),
        vault.contacts.list(),
    ]);

    let addressesUpdated = 0;
    let addressesSkipped = 0;
    let addressesMissing = 0;
    for (const entry of payload.labels ?? []) {
        const match =
            allAddresses.find((a) => a.id === entry.id) ??
            allAddresses.find((a) => a.address === entry.address);
        if (!match) {
            addressesMissing += 1;
            continue;
        }
        const hadLabel = typeof match.label === 'string' && match.label.length > 0;
        if (hadLabel && onConflict === 'preserve') {
            addressesSkipped += 1;
            continue;
        }
        if (match.label === entry.label) {
            addressesSkipped += 1;
            continue;
        }
        await vault.addresses.put({ ...match, label: entry.label });
        addressesUpdated += 1;
    }

    let contactsAdded = 0;
    let contactsUpdated = 0;
    let contactsSkipped = 0;
    for (const incoming of payload.contacts ?? []) {
        if (!incoming || typeof incoming.id !== 'string') continue;
        const existing = allContacts.find((c) => c.id === incoming.id);
        const now = new Date().toISOString();
        if (!existing) {
            const rec = {
                schemaVersion: 1,
                id: incoming.id,
                name: incoming.name,
                notes: incoming.notes ?? '',
                entries: (incoming.entries ?? []).map((e) => ({
                    chain: e.chain,
                    address: e.address,
                    label: e.label ?? '',
                })),
                avatarSeed: incoming.entries?.[0]?.address ?? '',
                createdAt: now,
                updatedAt: now,
            };
            await vault.contacts.put(rec);
            contactsAdded += 1;
            continue;
        }
        if (onConflict === 'preserve') {
            contactsSkipped += 1;
            continue;
        }
        const merged = {
            ...existing,
            name: incoming.name,
            notes: incoming.notes ?? existing.notes ?? '',
            entries: (incoming.entries ?? []).map((e) => ({
                chain: e.chain,
                address: e.address,
                label: e.label ?? '',
            })),
            updatedAt: now,
        };
        await vault.contacts.put(merged);
        contactsUpdated += 1;
    }

    return {
        addressesUpdated,
        addressesSkipped,
        addressesMissing,
        contactsAdded,
        contactsUpdated,
        contactsSkipped,
    };
}
