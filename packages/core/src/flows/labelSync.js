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
//   const body = await fetchAndDecryptLabelSync({
//       sdk, chainId, commitmentKey,   // discoveryName derived inside
//   });
//   await applyLabelSyncPayload({ vault, walletId, payload: body });
//
// `createLabelSyncScheduler` is the auto-sync half (§19.5.2 cadence
// rules): it watches label/contact vault writes and collapses a burst
// of them into ONE publish per unlock window. It never holds a seed or
// a password - it only decides WHEN a publish is due and hands that
// decision to the shell, which prompts the user exactly as the manual
// "Publish now" button does.
//
// FOLLOWUPs (Cluster B FOLLOWUPS.md):
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
 * §19.5.2 manual publish: builds the encrypted labels payload from
 * the wallet's seed and broadcasts it as a FILE action on the chosen
 * chain. The from-address is the wallet's newest external HD address
 * on that chain (callers can override via `pickFromAddress`).
 *
 * This flow powers both the manual "Publish now" button and the
 * auto-sync path: `createLabelSyncScheduler` decides WHEN a publish is
 * due, the shell prompts for the password, and the write lands here.
 * Fetch-on-restore is a separate FOLLOWUP. HW wallets are not
 * supported here because the commitment key is derived from the seed,
 * which only exists for software wallets.
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

    // Source address: caller override, or newest external HD address.
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
