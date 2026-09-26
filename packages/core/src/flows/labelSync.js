// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Label-sync flows (§19.5.2).
//
// Assembles / applies the labels + contacts payload that the wallet
// publishes on-chain via a FILE action (see §19.5.2 for the privacy
// rationale).
//
// `buildLabelSyncPayload` and `applyLabelSyncPayload` are the pure
// codec halves: build the encrypted payload from a seed, or apply a
// decrypted payload back to a vault. `publishLabelsNow` is the
// user-initiated full-cycle wrapper that the Settings → Backup
// "Publish now" button calls: it decrypts the seed, builds the
// payload, and submits the FILE action via `submitAction` so the
// resulting transaction is signed and broadcast end-to-end.
//
// Typical manual publish:
//   const { txid, chainId, discoveryName, sizeBytes } =
//       await publishLabelsNow({ vault, walletId, password, chainId, ... });
//
// Typical restore (after `importMnemonic` has produced a new wallet):
//   const body = await fetchAndDecryptLabelSync({ sdk, seed });
//   if (body) await applyLabelSyncPayload({ vault, walletId, payload: body });
//
// `createLabelSyncScheduler` is the auto-sync half (§19.5.2 cadence
// rules): it watches label/contact vault writes and collapses a burst
// of them into ONE publish per unlock window. It never holds a seed or
// a password - it only decides WHEN a publish is due and hands that
// decision to the shell, which prompts the user exactly as the manual
// "Publish now" button does.
//
// `fetchAndDecryptLabelSync` is the restore half (FOLLOWUP 2): it finds
// the published ciphertext again by asking the explorer for FILE actions
// whose `name` equals the discovery name, and hands the decrypted body
// back for `applyLabelSyncPayload` to write into the fresh vault.

import {
    computeLabelSyncCommitmentKey,
    computeLabelSyncDiscoveryName,
    decodeLabelSyncPayload,
    encodeLabelSyncPayload,
} from '../crypto/index.js';
import { decryptWalletSeed, decryptWalletPassphrase } from '../crypto/walletBlob.js';
import { bip39MnemonicToSeed } from '../crypto/mnemonic.js';
import { counterwalletMnemonicToSeedBytes } from '../crypto/counterwallet.js';
import { WalletNotFoundError } from './unlockWallet.js';
import { submitAction } from './submitAction.js';
import { ENVELOPE_MAX_PAYLOAD } from './fileSizeLimits.js';

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
 * @property {'overwrite' | 'preserve'} [onConflict]   default 'overwrite' (user asked for sync)
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
 * `address` string as fallback; the id can't survive a from-seed
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
 * @typedef {Object} PublishLabelsPreparation
 * @property {string} chainId
 * @property {import('../schemas/address.js').Address} from
 * @property {{ action: 'FILE', params: object }} actionData
 * @property {object} encoderOpts
 * @property {string} discoveryName
 * @property {number} sizeBytes
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
        super(`publishLabelsNow: wallet "${walletId}" is wif-only; label-sync requires a seed`);
        this.name = 'WifOnlyLabelSyncUnsupportedError';
        this.walletId = walletId;
    }
}

/**
 * Build the encrypted FILE payload and resolve the address that will fund it.
 * Keeping this separate from submission lets the shared confirm flow compose,
 * dry-run and display the exact payload before any signature is produced.
 *
 * @param {Omit<PublishLabelsNowOpts, 'sdkRegistry'>} opts
 * @returns {Promise<PublishLabelsPreparation>}
 */
export async function prepareLabelsPublication({
    vault,
    walletId,
    password,
    bip39Passphrase = '',
    chainId,
    chainRegistry,
    pickFromAddress,
    fee,
    feePerKb,
}) {
    if (!vault) throw new Error('prepareLabelsPublication: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('prepareLabelsPublication: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('prepareLabelsPublication: password is required');
    }
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('prepareLabelsPublication: chainId is required');
    }
    if (!chainRegistry) throw new Error('prepareLabelsPublication: chainRegistry is required');

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    const format = wallet.format ?? 'bip39';
    if (format === 'wif-only') {
        throw new WifOnlyLabelSyncUnsupportedError(walletId);
    }

    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) {
        throw new Error(`prepareLabelsPublication: unknown chain "${chainId}"`);
    }

    // Source address: caller override, or newest external HD address.
    const fromAddress = pickFromAddress
        ? await pickFromAddress(walletId, chainId)
        : await defaultPickFromAddress({ vault, walletId, descriptor });
    if (!fromAddress) throw new NoFundedAddressError(walletId, chainId);

    const seed = await deriveLabelSyncSeed({ wallet, password, bip39Passphrase });

    let payload;
    try {
        payload = await buildLabelSyncPayload({ vault, walletId, seed });
    } finally {
        seed.fill(0);
    }

    const { ciphertext, discoveryName } = payload;
    const sizeBytes = ciphertext.length;
    return {
        chainId,
        from: fromAddress,
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
            // Select funding UTXOs BY ADDRESS and return the change to the
            // spender. Both are required on any path that builds the
            // transaction live (no prebuiltPsbt), and this flow is one -
            // `advancedAction.js` carries the same pair for the same reason.
            //
            // WITHOUT `change` THIS ACTION COULD NEVER BROADCAST: the encoder
            // refuses with "Transaction would burn significant satoshis as
            // fees. Please provide a change address.", so Publish labels was a
            // dead end on every chain. `submitAction` only ROTATES a change
            // address that is already present - it never supplies one -
            // so nothing downstream covered the omission. Note what the
            // encoder's guard was actually preventing: with no change output
            // the entire funding UTXO beyond the data outputs is miner fee.
            sourceAddress: fromAddress.address,
            change: fromAddress.address,
            ...(fee !== undefined && { fee }),
            ...(feePerKb !== undefined && { feePerKb }),
        },
        discoveryName,
        sizeBytes,
    };
}

/**
 * Submit a prepared label payload, optionally signing the exact PSBT already
 * shown by the shared confirm flow.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.walletId
 * @param {string} [opts.password]
 * @param {any} [opts.signer]
 * @param {string} [opts.bip39Passphrase]
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
 * @param {PublishLabelsPreparation} opts.preparation
 * @param {import('../sdk/submitWithSigner.js').PrebuiltPsbt} [opts.prebuiltPsbt]
 * @returns {Promise<PublishLabelsNowResult>}
 */
export async function submitLabelsPublication({
    vault,
    walletId,
    password,
    signer,
    bip39Passphrase = '',
    chainRegistry,
    sdkRegistry,
    preparation,
    prebuiltPsbt,
}) {
    if (!preparation?.from || !preparation?.actionData || !preparation?.encoderOpts) {
        throw new Error('submitLabelsPublication: preparation is required');
    }
    if (!sdkRegistry) throw new Error('submitLabelsPublication: sdkRegistry is required');

    const { chainId, from, actionData, encoderOpts, discoveryName, sizeBytes } = preparation;
    const result = await submitAction({
        vault,
        walletId,
        password,
        signer,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
        chainId,
        actionData,
        encoderOpts: { pubkey: from.publicKey, ...encoderOpts },
        signingPaths: [from.derivationPath
            ? { inputIndex: 0, path: from.derivationPath }
            : { inputIndex: 0, addressId: from.id }],
        prebuiltPsbt,
    });

    return {
        txid: result.txid,
        chainId,
        discoveryName,
        sizeBytes,
        fromAddress: from.address,
    };
}

/**
 * §19.5.2 manual publish: builds the encrypted labels payload from
 * the wallet's seed and broadcasts it as a FILE action on the chosen
 * chain. The from-address is the wallet's newest external HD address
 * on that chain (callers can override via `pickFromAddress`).
 *
 * This flow powers the auto-sync path: `createLabelSyncScheduler` decides
 * WHEN a publish is due, the shell prompts for the password, and the write
 * lands here. The manual settings path calls the preparation and submission
 * halves separately so shared confirmation sits between them.
 * `fetchAndDecryptLabelSync` reads the result back on restore. HW
 * wallets are not supported here because the commitment key is derived
 * from the seed, which only exists for software wallets.
 *
 * @param {PublishLabelsNowOpts} opts
 * @returns {Promise<PublishLabelsNowResult>}
 */
export async function publishLabelsNow(opts) {
    const preparation = await prepareLabelsPublication(opts);
    return submitLabelsPublication({ ...opts, preparation });
}

/**
 * Open a software wallet's seed for the commitment key. Every buffer on the
 * way there (plaintext mnemonic, stored passphrase, master key) is zeroed
 * before this returns; the seed itself is the caller's to zero.
 *
 * The stored passphrase always wins. A non-null encryptedPassphrase means
 * the 25th word was captured once at setup; deriving from a caller-supplied
 * bip39Passphrase instead (the old typed-at-unlock path) would silently
 * compute the WRONG commitment key and publish labels under the wrong name,
 * or fail to find them on restore, so the stored value overrides whatever
 * the caller passed. retainMasterKey hands back a fresh copy of the derived
 * master key (ours to zero, unlike a signer's) so that passphrase can be
 * opened without a second Argon2id round.
 *
 * @param {{ wallet: import('../schemas/wallet.js').Wallet, password: string, bip39Passphrase?: string }} opts
 * @returns {Promise<Uint8Array>}
 */
async function deriveLabelSyncSeed({ wallet, password, bip39Passphrase = '' }) {
    const format = wallet.format ?? 'bip39';
    let sessionMasterKey = null;
    const plaintext = await decryptWalletSeed({
        password,
        encryptedSeed: wallet.encryptedSeed,
        kdfParams: wallet.kdfParams,
        aad: wallet.aad,
        retainMasterKey: (k) => { sessionMasterKey = k; },
    });
    let passphraseBytes = null;
    try {
        const mnemonic = new TextDecoder().decode(plaintext);
        let effectivePassphrase = bip39Passphrase;
        if (wallet.encryptedPassphrase != null) {
            passphraseBytes = await decryptWalletPassphrase({
                masterKey: sessionMasterKey,
                encryptedPassphrase: wallet.encryptedPassphrase,
            });
            effectivePassphrase = new TextDecoder().decode(passphraseBytes);
        }
        return format === 'counterwallet-legacy'
            ? counterwalletMnemonicToSeedBytes(mnemonic)
            : await bip39MnemonicToSeed(mnemonic, effectivePassphrase);
    } finally {
        plaintext.fill(0);
        if (passphraseBytes) passphraseBytes.fill(0);
        if (sessionMasterKey) sessionMasterKey.fill(0);
    }
}

/**
 * @typedef {Object} RestoreLabelSyncOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {string} walletId                the wallet importMnemonic just persisted
 * @property {string} password
 * @property {string} [bip39Passphrase]
 * @property {string[]} chainIds              chains to search; the publish went to one of the wallet's active chains
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {'overwrite' | 'preserve'} [onConflict]   default 'overwrite'; a fresh import has nothing to preserve
 * @property {number} [maxCandidates]
 * @property {number} [perChainTimeoutMs]  default LABEL_SYNC_RESTORE_CHAIN_TIMEOUT_MS; a chain past it is reported as an error
 */

/** How long one chain's explorer may take before the restore stops waiting on it. */
export const LABEL_SYNC_RESTORE_CHAIN_TIMEOUT_MS = 15_000;

/**
 * The chains a restore should search: the wallet's active chains first, then
 * every other chain the registry knows. A publish lands on one chain of the
 * network the user was on at the time, and a fresh import always starts on
 * mainnet, so a search limited to the active set would miss a payload
 * published on testnet (the tester's case) until the user happened to switch
 * networks and re-import. The searches run concurrently under a per-chain
 * timeout, so the extra chains cost one round trip, not one each.
 *
 * @param {{ supportedChains?: () => Array<{ id: string }> } | null | undefined} chainRegistry
 * @param {string[]} [activeChainIds]
 * @returns {string[]}
 */
export function labelSyncSearchChainIds(chainRegistry, activeChainIds = []) {
    const out = [];
    const seen = new Set();
    const add = (id) => {
        if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return;
        seen.add(id);
        out.push(id);
    };
    for (const id of Array.isArray(activeChainIds) ? activeChainIds : []) add(id);
    let known = [];
    try {
        known = typeof chainRegistry?.supportedChains === 'function' ? chainRegistry.supportedChains() : [];
    } catch {
        known = [];
    }
    for (const d of Array.isArray(known) ? known : []) add(d?.id);
    return out;
}

/**
 * @typedef {Object} RestoreLabelSyncResult
 * @property {boolean} restored               a payload authenticated and was applied
 * @property {'wif-only' | 'no-chains' | null} skipped   why no search ran, when none did
 * @property {string | null} chainId          chain the applied payload came from
 * @property {string | null} updatedAt        the applied payload's own timestamp
 * @property {string[]} searchedChainIds      chains the search actually reached
 * @property {Array<{ chainId: string, message: string }>} errors   chains whose explorer read threw
 * @property {number} addressesUpdated
 * @property {number} addressesSkipped
 * @property {number} addressesMissing
 * @property {number} contactsAdded
 * @property {number} contactsUpdated
 * @property {number} contactsSkipped
 */

const EMPTY_APPLY = {
    addressesUpdated: 0,
    addressesSkipped: 0,
    addressesMissing: 0,
    contactsAdded: 0,
    contactsUpdated: 0,
    contactsSkipped: 0,
};

/**
 * §19.5.2 step 5, the restore half: after a from-seed import, look for the
 * labels + contacts this wallet published earlier and write them into the
 * fresh vault. A wallet's contacts live only in the vault, and a browser
 * that purges site data on quit erases the vault along with the wallet; a
 * tester re-imported from seed and found every contact gone, because the
 * publish half shipped without anyone calling this.
 *
 * The search covers every chain the caller names: a publish lands on ONE
 * chain and the user does not have to remember which. When more than one
 * chain answers (the user published on two chains at different times) the
 * payload with the newest `updatedAt` wins, since each publish carries the
 * whole address book.
 *
 * BEST-EFFORT BY CONTRACT. This runs inside the import, and an import that
 * has already persisted the wallet must not fail because an explorer was
 * unreachable. Explorer and network errors are collected per chain in
 * `errors` and never thrown; a chain whose SDK is missing or lacks the FILE
 * reads is skipped silently. Only invalid arguments throw. A wif-only wallet
 * has no seed to derive the commitment key from and is reported as skipped.
 *
 * @param {RestoreLabelSyncOpts} opts
 * @returns {Promise<RestoreLabelSyncResult>}
 */
export async function restoreLabelSyncAfterImport({
    vault,
    walletId,
    password,
    bip39Passphrase = '',
    chainIds,
    sdkRegistry,
    onConflict = 'overwrite',
    maxCandidates = LABEL_SYNC_MAX_CANDIDATES,
    perChainTimeoutMs = LABEL_SYNC_RESTORE_CHAIN_TIMEOUT_MS,
}) {
    if (!vault) throw new Error('restoreLabelSyncAfterImport: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('restoreLabelSyncAfterImport: walletId is required');
    }
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('restoreLabelSyncAfterImport: password is required');
    }
    if (!Array.isArray(chainIds)) {
        throw new Error('restoreLabelSyncAfterImport: chainIds must be an array');
    }
    if (!sdkRegistry || typeof sdkRegistry.get !== 'function') {
        throw new Error('restoreLabelSyncAfterImport: sdkRegistry with get() is required');
    }

    const base = {
        restored: false,
        skipped: /** @type {'wif-only' | 'no-chains' | null} */ (null),
        chainId: /** @type {string | null} */ (null),
        updatedAt: /** @type {string | null} */ (null),
        searchedChainIds: /** @type {string[]} */ ([]),
        errors: /** @type {Array<{ chainId: string, message: string }>} */ ([]),
        ...EMPTY_APPLY,
    };

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);
    if ((wallet.format ?? 'bip39') === 'wif-only') {
        return { ...base, skipped: 'wif-only' };
    }
    const uniqueChainIds = [...new Set(chainIds.filter((id) => typeof id === 'string' && id.length > 0))];
    if (uniqueChainIds.length === 0) {
        return { ...base, skipped: 'no-chains' };
    }

    // One commitment key for every chain: the seed is opened once and the
    // key is zeroed on the way out whatever happens in between.
    const seed = await deriveLabelSyncSeed({ wallet, password, bip39Passphrase });
    let commitmentKey;
    try {
        commitmentKey = computeLabelSyncCommitmentKey(seed);
    } finally {
        seed.fill(0);
    }

    /** @type {{ chainId: string, body: import('../crypto/labelSync.js').LabelSyncBody } | null} */
    let newest = null;
    try {
        // Every chain at once, each under its own clock: the search now spans
        // every network the registry knows, and an explorer that is down for
        // this venue (mainnet's, from a regtest box) must cost one timeout,
        // not one per chain in sequence.
        const searches = [];
        for (const chainId of uniqueChainIds) {
            let sdk;
            try {
                sdk = sdkRegistry.get(chainId);
            } catch {
                sdk = null;
            }
            if (!sdk || typeof sdk.getFiles !== 'function' || typeof sdk.getGatedFileRaw !== 'function') {
                continue;
            }
            base.searchedChainIds.push(chainId);
            searches.push(
                withTimeout(
                    fetchAndDecryptLabelSync({ sdk, commitmentKey, maxCandidates }),
                    perChainTimeoutMs,
                    `explorer did not answer within ${Math.round(perChainTimeoutMs / 1000)}s`,
                ).then(
                    (body) => ({ chainId, body, error: null }),
                    (err) => ({ chainId, body: null, error: err && err.message ? String(err.message) : String(err) }),
                ),
            );
        }
        for (const r of await Promise.all(searches)) {
            if (r.error !== null) {
                base.errors.push({ chainId: r.chainId, message: r.error });
                continue;
            }
            if (!r.body) continue;
            if (!newest || isoToMs(r.body.updatedAt) > isoToMs(newest.body.updatedAt)) {
                newest = { chainId: r.chainId, body: r.body };
            }
        }
    } finally {
        commitmentKey.fill(0);
    }

    if (!newest) return base;

    const applied = await applyLabelSyncPayload({
        vault,
        walletId,
        payload: newest.body,
        onConflict,
    });
    return {
        ...base,
        ...applied,
        restored: true,
        chainId: newest.chainId,
        updatedAt: typeof newest.body.updatedAt === 'string' ? newest.body.updatedAt : null,
    };
}

/** An unparseable or missing timestamp sorts oldest, never ahead of a real one. */
function isoToMs(iso) {
    const ms = Date.parse(String(iso ?? ''));
    return Number.isFinite(ms) ? ms : -Infinity;
}

/**
 * Settle `promise` or reject with `message` after `ms`. The timer is cleared
 * either way so a fast answer does not leave a handle behind.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, message) {
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    let timer;
    const clock = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

/**
 * Default source-address picker: newest external HD address on the
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

// --- Fetch on restore (FOLLOWUP 2, §19.5.2 step 5) -----------------------
//
// The discovery name is SHA256 of the commitment key, and it goes on the
// FILE action's `name` field precisely so a restoring wallet does not have
// to download every FILE on the chain and try to decrypt each one. The
// explorer gained the matching read on 2026-08-19: `getFiles(name, 'name')`
// is an exact-match lookup on the plain `files.name` column, so the whole
// discovery step is one indexed query.
//
// WHY THIS TRIES SEVERAL ROWS INSTEAD OF TRUSTING THE FIRST. The discovery
// name is PUBLIC the moment the first payload is published, so anyone can
// publish their own FILE under that same name - either to grief the restore
// or by accident. The name therefore proves nothing; only a successful
// AES-256-GCM authentication does, and that key is seed-derived. So the fetch
// walks the matches newest-first and returns the first one that AUTHENTICATES,
// treating a decrypt failure as "not ours" rather than as an error. The user's
// own re-publishes land under the same name too, which is the ordinary reason
// for more than one row: the newest of those is the one to restore.

/** How many same-name FILE rows a single restore will try to decrypt. */
export const LABEL_SYNC_MAX_CANDIDATES = 5;

/**
 * @typedef {Object} FetchAndDecryptLabelSyncOpts
 * @property {import('../sdk/SDKRegistry.js').XChainSDKLike} sdk   SDK for the chain the labels were published on
 * @property {Uint8Array} [seed]              caller holds the decrypted seed (ephemeral); one of seed / commitmentKey
 * @property {Uint8Array} [commitmentKey]     32 bytes, when the caller already derived it
 * @property {number} [maxCandidates]         default LABEL_SYNC_MAX_CANDIDATES
 */

/**
 * Find this wallet's published labels payload on one chain and decrypt it.
 *
 * Returns the decrypted body, or `null` when nothing under the discovery
 * name authenticates under this seed (never published, published on a
 * different chain, or every match belongs to somebody else). Network and
 * explorer failures throw, so a restore UI can tell "you have no published
 * labels" apart from "the explorer is unreachable".
 *
 * A commitment key derived here is zeroed before returning; one passed in
 * belongs to the caller and is left alone.
 *
 * @param {FetchAndDecryptLabelSyncOpts} opts
 * @returns {Promise<import('../crypto/labelSync.js').LabelSyncBody | null>}
 */
export async function fetchAndDecryptLabelSync({
    sdk,
    seed,
    commitmentKey,
    maxCandidates = LABEL_SYNC_MAX_CANDIDATES,
} = {}) {
    if (!sdk || typeof sdk.getFiles !== 'function') {
        throw new Error('fetchAndDecryptLabelSync: sdk with a getFiles() method is required');
    }
    if (typeof sdk.getGatedFileRaw !== 'function') {
        throw new Error(
            'fetchAndDecryptLabelSync: sdk must expose getGatedFileRaw() to read FILE bytes',
        );
    }
    if (!Number.isFinite(maxCandidates) || maxCandidates < 1) {
        throw new Error('fetchAndDecryptLabelSync: maxCandidates must be a positive number');
    }

    // Derive-or-borrow. Only a key we derived is ours to zero.
    const derivedHere = commitmentKey === undefined || commitmentKey === null;
    if (derivedHere && !(seed instanceof Uint8Array && seed.length > 0)) {
        throw new Error(
            'fetchAndDecryptLabelSync: pass either a non-empty seed or a 32-byte commitmentKey',
        );
    }
    if (!derivedHere && !(commitmentKey instanceof Uint8Array && commitmentKey.length === 32)) {
        throw new Error('fetchAndDecryptLabelSync: commitmentKey must be a 32-byte Uint8Array');
    }
    const key = derivedHere ? computeLabelSyncCommitmentKey(seed) : commitmentKey;

    try {
        const discoveryName = computeLabelSyncDiscoveryName(key);
        const rows = await sdk.getFiles(discoveryName, 'name');
        const candidates = selectLabelSyncCandidates(rows, discoveryName).slice(
            0,
            Math.floor(maxCandidates),
        );

        for (const row of candidates) {
            let served;
            try {
                // Same endpoint serves gated and non-gated FILE bytes
                // (/{COIN}/api/file/{index}/raw); the SDK method is named for
                // its first caller. A label payload is never gated.
                served = toBytes(await sdk.getGatedFileRaw(String(row.actionIndex)));
            } catch {
                // One unreadable row must not sink the restore: a later
                // candidate may still be the wallet's own payload.
                continue;
            }
            if (!served || served.length === 0) continue;
            for (const ciphertext of ciphertextForms(served)) {
                // Anyone can publish arbitrary bytes under this name. Refuse to
                // spend AES work on anything larger than a payload could legally be.
                if (ciphertext.length > ENVELOPE_MAX_PAYLOAD) continue;
                try {
                    return await decodeLabelSyncPayload(key, ciphertext);
                } catch {
                    // Failed GCM auth (or a foreign payload version) means the row
                    // is not ours. That is the expected miss, not an error.
                    continue;
                }
            }
        }
        return null;
    } finally {
        if (derivedHere) key.fill(0);
    }
}

/**
 * Normalize an explorer `getFiles` response into the rows worth trying,
 * newest first. Exported for tests; the filtering is deliberately narrow
 * so an explorer that adds columns cannot silently drop the payload.
 *
 * @param {unknown} rows                raw `getFiles` response (array, or { data: [...] })
 * @param {string} discoveryName
 * @returns {Array<{ actionIndex: string, blockIndex: number | null }>}
 */
export function selectLabelSyncCandidates(rows, discoveryName) {
    const list = Array.isArray(rows)
        ? rows
        : (rows && Array.isArray(/** @type {any} */ (rows).data) ? /** @type {any} */ (rows).data : []);
    const wanted = String(discoveryName).toLowerCase();
    const out = [];
    for (const row of list) {
        if (!row || typeof row !== 'object') continue;
        if (row.action_index === undefined || row.action_index === null) continue;
        // The explorer's `name` mode is already an exact match; re-check it so
        // a future fuzzy/prefix mode could never widen what we decrypt.
        if (String(row.name ?? '').toLowerCase() !== wanted) continue;
        // Token-gated FILEs are encrypted under a gate key, not this seed, so
        // they can never authenticate. Skip the round trip.
        if (row.gate_ticker) continue;
        // Anything the indexer explicitly rejected is not a payload. 'valid'
        // and 'unverified' both stay in; only an outright 'invalid' is dropped.
        if (String(row.status ?? '').toLowerCase() === 'invalid') continue;
        const blockIndex = Number(row.block_index);
        out.push({
            actionIndex: String(row.action_index),
            blockIndex: Number.isFinite(blockIndex) ? blockIndex : null,
        });
    }
    // Newest first: action_index is monotonic, so it orders re-publishes even
    // when several land in one block. Sort defensively rather than trusting
    // the explorer's default ordering to stay DESC.
    out.sort((a, b) => Number(b.actionIndex) - Number(a.actionIndex));
    return out;
}

/** Coerce whatever the SDK hands back for raw bytes into a plain Uint8Array. */
function toBytes(value) {
    if (value == null) return null;
    if (value instanceof Uint8Array) {
        // Buffer is a Uint8Array subclass; copy into a plain one so the noble
        // ciphers see exactly the type they assert on.
        return value.constructor === Uint8Array ? value : new Uint8Array(value);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (typeof value === 'string') return new TextEncoder().encode(value);
    return null;
}

/**
 * The ciphertexts one served body might be, most likely first.
 *
 * The explorer's raw route serves a NON-gated FILE in its stored form, and
 * the decoder stores a FILE's payload as the hex text the publish put on the
 * wire (`rawData: bytesToHex(ciphertext)`), so what comes back for a label
 * payload is 2N ASCII hex characters, not N bytes. Measured on regtest
 * 2026-09-12: the first driven restore found its row, read 2066 bytes of hex
 * text, failed GCM on the text and reported "never published". A gated FILE
 * takes a different column and comes back as bytes, and a future explorer
 * may decode before serving, so both forms are tried: the hex decoding first
 * when the body reads as hex, then the bytes as served. A real ciphertext
 * (random 12-byte IV, then AES output) is never all hex digits at any length
 * a payload can have, so the decode never shadows a byte-form answer.
 *
 * @param {Uint8Array} served
 * @returns {Uint8Array[]}
 */
function ciphertextForms(served) {
    const forms = [];
    if (served.length >= 2 && served.length % 2 === 0) {
        let hex = true;
        for (let i = 0; i < served.length; i += 1) {
            const c = served[i];
            const isHex = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
            if (!isHex) { hex = false; break; }
        }
        if (hex) {
            const out = new Uint8Array(served.length / 2);
            for (let i = 0; i < out.length; i += 1) {
                out[i] = parseInt(String.fromCharCode(served[2 * i], served[2 * i + 1]), 16);
            }
            forms.push(out);
        }
    }
    forms.push(served);
    return forms;
}

// --- Auto-sync scheduler (§19.5.2 cadence rules) -------------------------
//
// Shape decided 2026-08-11: keep PROMPTING for the seed rather than
// caching it, and batch label edits into ONE publish per unlock window.
// The two halves are related. Publishing needs the seed, the seed only
// exists for the length of a `publishLabelsNow` call, and the only way
// to get it without keeping a copy is to ask the user again. Asking on
// every rename would be unusable - renaming eight addresses in a row
// would cost eight password prompts and eight FILE transactions - so
// the scheduler debounces the edits and raises at most one prompt per
// unlock window. A rename storm therefore costs one prompt and one
// on-chain write; the unlocked session still never holds a raw seed.
//
// What the scheduler does NOT do: it does not publish. It decides that
// a publish is due and calls `requestPublish`, which the shell wires to
// the same password-prompt-then-`publishLabelsNow` path the manual
// "Publish now" button uses. Nothing secret ever crosses this API, and
// `noteLabelChange` refuses input that carries a secret-shaped key so a
// future caller cannot quietly start passing one through.
//
// Window bookkeeping. `attempt` is what the one-per-window cap counts,
// not `publish`: the user may cancel the prompt, and re-raising it on
// the next edit would rebuild exactly the nag loop this replaces. A
// consumed window still keeps the edits dirty, so a cancelled or failed
// publish retries at the next unlock rather than losing the labels.

/** Quiet period after the last label edit before a publish is due. */
export const LABEL_SYNC_AUTO_DEBOUNCE_MS = 45_000;

/**
 * Ceiling on how long a continuous edit stream can defer the publish.
 * Without it, a user renaming an address every 40s would re-arm the
 * debounce forever and never sync.
 */
export const LABEL_SYNC_AUTO_MAX_WAIT_MS = 5 * 60_000;

/** Keys `noteLabelChange` refuses: the scheduler must never see secrets. */
const SECRET_KEYS = ['password', 'seed', 'mnemonic', 'bip39Passphrase', 'privateKey', 'wif'];

/**
 * @typedef {Object} LabelSyncBatch
 * @property {number} changeCount          label/contact edits collapsed into this publish
 * @property {string[]} walletIds          wallets whose labels changed (may be empty: contacts are vault-global)
 * @property {number} firstChangeAt        epoch ms of the oldest un-published edit
 * @property {number} dueAt                epoch ms the scheduler decided the publish was due
 * @property {'debounce' | 'maxWait' | 'flush'} reason
 */

/**
 * @typedef {Object} LabelSyncSchedulerStatus
 * @property {boolean} pending             edits are waiting to be published
 * @property {number} changeCount
 * @property {string[]} walletIds
 * @property {number | null} firstChangeAt
 * @property {number | null} dueAt         when the armed timer will fire (null when not armed)
 * @property {boolean} unlocked            an unlock window is open
 * @property {boolean} attemptedThisWindow a publish was already raised in this window
 * @property {boolean} publishedThisWindow a publish actually completed in this window
 * @property {number} windowId
 */

/**
 * @param {object} [opts]
 * @param {(batch: LabelSyncBatch) => unknown} [opts.requestPublish]   raise the publish prompt (shell-owned; never handed a secret)
 * @param {() => boolean | Promise<boolean>} [opts.isEnabled]          opt-in gate; wire to settings.privacy.labelsSurviveRestore. Default: disabled.
 * @param {number} [opts.debounceMs]
 * @param {number} [opts.maxWaitMs]
 * @param {boolean} [opts.startUnlocked]   default true: hosts are built at unlock, so construction opens the first window
 * @param {() => number} [opts.now]        clock injection for tests
 * @param {(fn: () => void, ms: number) => unknown} [opts.setTimer]
 * @param {(handle: unknown) => void} [opts.clearTimer]
 * @param {(err: unknown) => void} [opts.onError]
 */
export function createLabelSyncScheduler(opts = {}) {
    const requestPublish = typeof opts.requestPublish === 'function'
        ? opts.requestPublish
        : () => {};
    const isEnabled = typeof opts.isEnabled === 'function' ? opts.isEnabled : () => false;
    const debounceMs = Number.isFinite(opts.debounceMs) && opts.debounceMs >= 0
        ? Math.floor(opts.debounceMs)
        : LABEL_SYNC_AUTO_DEBOUNCE_MS;
    const maxWaitMs = Number.isFinite(opts.maxWaitMs) && opts.maxWaitMs >= 0
        ? Math.floor(opts.maxWaitMs)
        : LABEL_SYNC_AUTO_MAX_WAIT_MS;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const setTimer = typeof opts.setTimer === 'function'
        ? opts.setTimer
        : (fn, ms) => setTimeout(fn, ms);
    const clearTimer = typeof opts.clearTimer === 'function'
        ? opts.clearTimer
        : (h) => clearTimeout(h);
    const onError = typeof opts.onError === 'function' ? opts.onError : () => {};

    let windowId = 1;
    let unlocked = opts.startUnlocked !== false;
    let attemptWindowId = /** @type {number | null} */ (null);
    let publishWindowId = /** @type {number | null} */ (null);
    let changeCount = 0;
    let firstChangeAt = /** @type {number | null} */ (null);
    const dirtyWallets = new Set();
    let timer = /** @type {unknown} */ (null);
    let dueAt = /** @type {number | null} */ (null);
    let disposed = false;

    function disarm() {
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
        dueAt = null;
    }

    function arm() {
        if (disposed || !unlocked) return;
        if (changeCount === 0) return;
        if (attemptWindowId === windowId) return;
        const at = now();
        const debouncedAt = at + debounceMs;
        const ceilingAt = (firstChangeAt ?? at) + maxWaitMs;
        // Each edit pushes the deadline out by another quiet period,
        // which is what collapses a rename storm - but never past the
        // ceiling, so a steady stream still syncs.
        const nextDueAt = Math.min(debouncedAt, ceilingAt);
        const reason = nextDueAt < debouncedAt ? 'maxWait' : 'debounce';
        disarm();
        dueAt = nextDueAt;
        timer = setTimer(() => { void fire(reason); }, Math.max(0, nextDueAt - at));
    }

    /** @param {'debounce' | 'maxWait' | 'flush'} reason */
    async function fire(reason) {
        timer = null;
        dueAt = null;
        if (disposed || !unlocked) return null;
        if (changeCount === 0) return null;
        if (attemptWindowId === windowId) return null;
        let enabled = false;
        try {
            enabled = (await isEnabled()) === true;
        } catch (err) {
            onError(err);
            return null;
        }
        // Opt-out means no on-chain copy at all, so the edits are not
        // "pending" - drop them rather than banking a publish the user
        // would get prompted for the moment they opt in.
        if (!enabled) {
            reset();
            return null;
        }
        attemptWindowId = windowId;
        /** @type {LabelSyncBatch} */
        const batch = {
            changeCount,
            walletIds: [...dirtyWallets],
            firstChangeAt: firstChangeAt ?? now(),
            dueAt: now(),
            reason,
        };
        try {
            await requestPublish(batch);
        } catch (err) {
            onError(err);
        }
        return batch;
    }

    function reset() {
        changeCount = 0;
        firstChangeAt = null;
        dirtyWallets.clear();
        disarm();
    }

    return {
        /**
         * Record one label / contact vault write. Safe to call on every
         * keystroke-level edit: the debounce is what collapses them.
         *
         * @param {{ walletId?: string | null }} [change]
         * @returns {{ scheduled: boolean, reason: string, dueAt: number | null }}
         */
        noteLabelChange(change = {}) {
            if (change && typeof change === 'object') {
                for (const key of SECRET_KEYS) {
                    if (key in change) {
                        throw new Error(
                            `labelSyncScheduler.noteLabelChange: "${key}" must never be passed; the scheduler never holds secrets`,
                        );
                    }
                }
            }
            if (disposed) return { scheduled: false, reason: 'disposed', dueAt: null };
            const at = now();
            changeCount += 1;
            if (firstChangeAt === null) firstChangeAt = at;
            if (typeof change?.walletId === 'string' && change.walletId.length > 0) {
                dirtyWallets.add(change.walletId);
            }
            if (!unlocked) {
                // Locked: nothing can be published (the prompt lives in an
                // unlocked UI). Keep the edit dirty; the next unlock arms it.
                return { scheduled: false, reason: 'locked', dueAt: null };
            }
            if (attemptWindowId === windowId) {
                return { scheduled: false, reason: 'window-consumed', dueAt: null };
            }
            arm();
            return { scheduled: timer !== null, reason: 'armed', dueAt };
        },

        /** Open a new unlock window: the one-publish cap resets and carried-over edits re-arm. */
        beginUnlockWindow() {
            if (disposed) return;
            windowId += 1;
            unlocked = true;
            arm();
        },

        /** Close the unlock window. Pending edits survive to the next one. */
        endUnlockWindow() {
            unlocked = false;
            disarm();
        },

        /**
         * Force the due decision now, ignoring the remaining debounce.
         * Still honours the one-attempt-per-window cap.
         *
         * @returns {Promise<LabelSyncBatch | null>}
         */
        flush() {
            disarm();
            return fire('flush');
        },

        /**
         * Called by the shell after a publish actually lands (auto OR
         * manual: a manual "Publish now" carries the same payload, so it
         * satisfies the pending auto-sync too).
         */
        markPublished() {
            if (disposed) return;
            publishWindowId = windowId;
            attemptWindowId = windowId;
            reset();
        },

        /** Drop pending edits without publishing (e.g. the user opted out). */
        clearPending() {
            reset();
        },

        /** @returns {LabelSyncSchedulerStatus} */
        status() {
            return {
                pending: changeCount > 0,
                changeCount,
                walletIds: [...dirtyWallets],
                firstChangeAt,
                dueAt,
                unlocked,
                attemptedThisWindow: attemptWindowId === windowId,
                publishedThisWindow: publishWindowId === windowId,
                windowId,
            };
        },

        dispose() {
            disposed = true;
            disarm();
        },
    };
}
