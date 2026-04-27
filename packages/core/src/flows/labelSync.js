// Label-sync flows — §19.5.2.
//
// Assembles / applies the labels + contacts payload that the wallet
// publishes on-chain via a FILE action (see §19.5.2 for the privacy
// rationale).
//
// `buildLabelSyncPayload` and `applyLabelSyncPayload` are the pure
// codec halves: build the encrypted payload from a seed, or apply a
// decrypted payload back to a vault. `publishLabelsNow` is the
// user-initiated full-cycle wrapper that the Settings → Backup
// "Publish now" button calls — it decrypts the seed, builds the
// payload, and submits the FILE action via `submitAction` so the
// resulting transaction is signed and broadcast end-to-end.
//
// Typical manual publish:
//   const { txid, chainId, discoveryName, sizeBytes } =
//       await publishLabelsNow({ vault, walletId, password, chainId, ... });
//
// Typical restore (after `importMnemonic` has produced a new wallet):
//   const body = await fetchAndDecryptLabelSync({
//       sdk, chainId, commitmentKey,   // discoveryName derived inside
//   });
//   await applyLabelSyncPayload({ vault, walletId, payload: body });
//
// FOLLOWUPs (Cluster B FOLLOWUPS.md):
//   1. On-change debounced auto-sync (§19.5.2 cadence rules).
//   2. Fetch + decrypt + apply on restore (the import-side wiring).

import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    decodeLabelSyncPayload,
    encodeLabelSyncPayload,
} from '../crypto/index.js';
import { decryptWalletSeed } from '../crypto/walletBlob.js';
import { bip39MnemonicToSeed } from '../crypto/mnemonic.js';
import { counterwalletMnemonicToSeedBytes } from '../crypto/counterwallet.js';
import { WalletNotFoundError } from './unlockWallet.js';
import { submitAction } from './submitAction.js';

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

/**
 * @typedef {Object} PublishLabelsNowOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId
 * @property {string} password
 * @property {string} [bip39Passphrase]      required if the wallet is BIP39 with §15.6 25th-word enabled
 * @property {string} chainId                chain to publish on
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {(walletId: string, chainId: string) => Promise<import('../schemas/address.js').Address | null>} [pickFromAddress]   override how the source address for the FILE tx is selected; defaults to "newest external HD address on this (account, chain)"
 * @property {number} [fee]
 * @property {number} [feePerKb]
 */

/**
 * @typedef {Object} PublishLabelsNowResult
 * @property {string} txid
 * @property {string} chainId
 * @property {string} discoveryName
 * @property {number} sizeBytes
 * @property {string} fromAddress
 */

export class NoFundedAddressError extends Error {
    constructor(walletId, chainId) {
        super(`publishLabelsNow: wallet "${walletId}" has no HD address on chain "${chainId}"`);
        this.name = 'NoFundedAddressError';
        this.walletId = walletId;
        this.chainId = chainId;
    }
}

export class WifOnlyLabelSyncUnsupportedError extends Error {
    constructor(walletId) {
        super(`publishLabelsNow: wallet "${walletId}" is wif-only — label-sync requires a seed`);
        this.name = 'WifOnlyLabelSyncUnsupportedError';
        this.walletId = walletId;
    }
}

/**
 * §19.5.2 manual publish — builds the encrypted labels payload from
 * the wallet's seed and broadcasts it as a FILE action on the chosen
 * chain. The from-address is the wallet's newest external HD address
 * on that chain (callers can override via `pickFromAddress`).
 *
 * Auto-sync (debounced on label change) and fetch-on-restore are
 * separate FOLLOWUPs — this flow only powers the manual "Publish now"
 * button. HW wallets are not supported here because the commitment key
 * is derived from the seed, which only exists for software wallets.
 *
 * @param {PublishLabelsNowOpts} opts
 * @returns {Promise<PublishLabelsNowResult>}
 */
export async function publishLabelsNow({
    vault,
    walletId,
    password,
    bip39Passphrase = '',
    chainId,
    chainRegistry,
    sdkRegistry,
    pickFromAddress,
    fee,
    feePerKb,
}) {
    if (!vault) throw new Error('publishLabelsNow: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('publishLabelsNow: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('publishLabelsNow: password is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('publishLabelsNow: chainId is required');
    }
    if (!chainRegistry) throw new Error('publishLabelsNow: chainRegistry is required');
    if (!sdkRegistry) throw new Error('publishLabelsNow: sdkRegistry is required');

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    const format = wallet.format ?? 'bip39';
    if (format === 'wif-only') {
        throw new WifOnlyLabelSyncUnsupportedError(walletId);
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`publishLabelsNow: unknown chain "${chainId}"`);
    }

    // Source address — caller override OR newest external HD address.
    const fromAddress = pickFromAddress
        ? await pickFromAddress(walletId, chainId)
        : await defaultPickFromAddress({ vault, walletId, descriptor });
    if (!fromAddress) throw new NoFundedAddressError(walletId, chainId);

    // Decrypt mnemonic, derive seed for the commitment key. Both buffers
    // are zeroed in the finally so they never outlive this scope.
    const plaintext = await decryptWalletSeed({
        password,
        encryptedSeed: wallet.encryptedSeed,
        kdfParams: wallet.kdfParams,
        aad: wallet.aad,
    });
    let seed;
    try {
        const mnemonic = new TextDecoder().decode(plaintext);
        seed = format === 'counterwallet-legacy'
            ? counterwalletMnemonicToSeedBytes(mnemonic)
            : await bip39MnemonicToSeed(mnemonic, bip39Passphrase);
    } finally {
        plaintext.fill(0);
    }

    let payload;
    try {
        payload = await buildLabelSyncPayload({ vault, walletId, seed });
    } finally {
        seed.fill(0);
    }

    const { ciphertext, discoveryName } = payload;
    const sizeBytes = ciphertext.length;
    const result = await submitAction({
        vault,
        walletId,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
        chainId,
        actionData: {
            action: 'FILE',
            params: {
                VERSION: '0',
                NAME: discoveryName,
                TYPE: 'application/octet-stream',
                TITLE: 'wallet-labels',
                MEMO: '',
            },
        },
        encoderOpts: {
            pubkey: fromAddress.publicKey,
            rawData: bytesToHex(ciphertext),
            ...(fee !== undefined && { fee }),
            ...(feePerKb !== undefined && { feePerKb }),
        },
        signingPaths: [fromAddress.derivationPath
            ? { inputIndex: 0, path: fromAddress.derivationPath }
            : { inputIndex: 0, addressId: fromAddress.id }],
    });

    return {
        txid: result.txid,
        chainId,
        discoveryName,
        sizeBytes,
        fromAddress: fromAddress.address,
    };
}

/**
 * Default source-address picker — newest external HD address on the
 * chain across any account in the wallet. Mirrors the host's
 * `addresses.newest` semantics so the publish flow lines up with what
 * the user sees in Receive.
 */
async function defaultPickFromAddress({ vault, walletId, descriptor }) {
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIds = new Set(accounts.map((a) => a.id));
    if (accountIds.size === 0) return null;
    const all = await vault.addresses.list();
    let winner = null;
    let winnerIdx = -1;
    for (const a of all) {
        if (!accountIds.has(a.accountId)) continue;
        if (a.chain !== descriptor.coin) continue;
        if (a.network !== descriptor.networkKind) continue;
        if (a.source !== 'hd') continue;
        if (typeof a.derivationPath !== 'string') continue;
        const parts = a.derivationPath.split('/');
        if (parts.length < 2) continue;
        if (parts[parts.length - 2] !== '0') continue;
        const idx = Number(parts[parts.length - 1]);
        if (!Number.isFinite(idx)) continue;
        if (idx > winnerIdx) {
            winner = a;
            winnerIdx = idx;
        }
    }
    return winner;
}

function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
        out += bytes[i].toString(16).padStart(2, '0');
    }
    return out;
}
