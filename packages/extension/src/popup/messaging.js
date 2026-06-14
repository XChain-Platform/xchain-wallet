// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Popup-facing helpers layered on the shared chrome.runtime.sendMessage
// wrapper. Each helper documents the exact message type + request shape
// so callers don't need to build envelopes by hand.

import { sendMessage } from '../shared/chromeMessaging.js';

export { sendMessage };

/**
 * Read the background's view of the current wallet-session state.
 * Answered by the session-meta listener in background.js — works before
 * the MessageHost's vault-backed handlers come online.
 *
 * @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>}
 */
export function getSessionStatus() {
    return /** @type {any} */ (sendMessage('session.status'));
}

/**
 * Derive the vault master key from `password`, authenticate it by
 * opening the encrypted blob, seed the session backend, and trigger a
 * host re-init in the background. On wrong-password, rejects with an
 * error whose `name === 'InvalidPasswordError'`.
 *
 * @param {string} password
 * @returns {Promise<{ unlocked: true }>}
 */
export function unlockWallet(password) {
    return /** @type {any} */ (sendMessage('wallet.unlock', { password }));
}

/**
 * Create a fresh BIP39 wallet via the pre-host `wallet.create` handler.
 * Returns the plaintext mnemonic for the §19.2 seed-phrase ceremony.
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} [opts.name]
 * @param {128 | 160 | 192 | 224 | 256} [opts.strengthBits]
 * @param {string} [opts.bip39Passphrase]
 */
export function createWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.create', opts));
}

/**
 * Import an existing 12/15/18/21/24-word BIP39 mnemonic (or
 * Counterwallet-legacy 12-word; format auto-detected).
 *
 * @param {object} opts
 * @param {string} opts.password
 * @param {string} opts.mnemonic
 * @param {string} [opts.name]
 * @param {string} [opts.bip39Passphrase]
 */
export function importMnemonic(opts) {
    return /** @type {any} */ (sendMessage('wallet.import', opts));
}

/**
 * Clear the session master key and tear down the background host. Next
 * query of `session.status` returns `locked`.
 *
 * @returns {Promise<{ locked: true }>}
 */
export function lockWallet() {
    return /** @type {any} */ (sendMessage('wallet.lock'));
}

/**
 * List all persisted wallets, safe-projected (no encryptedSeed / kdfParams /
 * importedKeys). Populates the Home screen's wallet picker.
 *
 * @returns {Promise<Array<{ id: string, name: string, createdAt: string, origin: string, format: string, passphraseEnabled: boolean, multisigs: Array<{ id: string, scheme: string, threshold: number }> }>>}
 */
export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/**
 * Add a wallet to the already-open vault (unlocked-state add). Distinct
 * from the pre-host `wallet.import` (which only runs on a fresh install
 * via `assertFreshVault`).
 *
 * @param {object} opts
 * @param {string} opts.password               encrypts the new wallet's seed
 * @param {string} opts.mnemonic
 * @param {string} [opts.name]
 * @param {string} [opts.bip39Passphrase]
 */
export function addImportedWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.add.import', opts));
}

/**
 * Rename a wallet.
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.name
 */
export function renameWallet(opts) {
    return /** @type {any} */ (sendMessage('wallet.rename', opts));
}

/**
 * List BIP44 accounts under a wallet, sorted by index.
 *
 * @param {string} walletId
 * @returns {Promise<Array<{ id: string, walletId: string, name: string, index: number, createdAt: string }>>}
 */
export function listAccounts(walletId) {
    return /** @type {any} */ (sendMessage('account.list', { walletId }));
}

/**
 * Create the next BIP44 account under a wallet (max(index)+1). Persists
 * an Account record + a first address per active chain. When
 * `opts.signerId` is set, the new addresses are derived by the named
 * paired hardware signer (§17.6 / G023) and persisted with
 * `source: 'trezor' | 'ledger'`; omit it to derive via the wallet's
 * software seed.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} [opts.password]
 * @param {string} [opts.bip39Passphrase]
 * @param {string} [opts.name]
 * @param {string} [opts.signerId]
 */
export function createAccount(opts) {
    return /** @type {any} */ (sendMessage('account.create', opts));
}

/**
 * Aggregate balances for a wallet, grouped by chainId. Per-address
 * entries carry `balances: null` + a `error` string when the SDK
 * read fails — the Home screen renders those as retry rows.
 *
 * @param {string} walletId
 * @param {string} [accountId]   when supplied, restrict to a single BIP44 account; otherwise aggregate across all accounts under the wallet
 * @returns {Promise<Record<string, Array<{ address: string, addressType: string, label: string, balances: unknown | null, error: string | null }>>>}
 */
export function getWalletBalances(walletId, accountId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId, accountId }));
}

/**
 * Single-address balance read — the §21.2 simulator's input source.
 * Returns the SDK's raw `{ native, tokens }` shape; callers convert
 * with `decoder.balancesFromSdk(...)` before feeding `simulateAction`.
 *
 * @param {string} chainId
 * @param {string} address
 * @returns {Promise<unknown>}
 */
export function getAddressBalances(chainId, address) {
    return /** @type {any} */ (sendMessage('balances.address', { chainId, address }));
}

/**
 * @param {string} walletId
 * @param {string} [accountId]   when supplied, restrict to a single BIP44 account
 * @returns {Promise<Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null }>>>}
 */
export function getAddressesByChain(walletId, accountId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId, accountId }));
}

/**
 * Newest (highest external index) HD address for a wallet + chain, or
 * `null` if no address exists yet.
 *
 * @param {string} walletId
 * @param {string} chainId
 * @param {string} [accountId]   when supplied, restrict to a single BIP44 account
 * @returns {Promise<null | { address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function getNewestAddress(walletId, chainId, accountId) {
    return /** @type {any} */ (
        sendMessage('addresses.newest', { walletId, chainId, accountId })
    );
}

/**
 * Derive + persist the next unused external address for (wallet, chain).
 * Requires the user's password when the resolved signer is software
 * (re-runs Argon2id KDF on the encrypted seed). When `opts.signerId`
 * names a paired hardware signer (§17.6 / G023), the password is
 * skipped and the device confirms the derivation locally; the address
 * is persisted with `source: 'trezor' | 'ledger'`.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} [opts.password]
 * @param {string} [opts.bip39Passphrase]
 * @param {string} [opts.addressType]
 * @param {string} [opts.signerId]
 * @returns {Promise<{ id: string, address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}

/**
 * Build, sign, and broadcast a SEND action via the host's `action.send`
 * handler. Pass-through to core's `sendToken` flow — fails loudly
 * against the dev-SDK stub until real xchain-sdk is bundled.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.to
 * @param {string} opts.tick
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function sendToken(opts) {
    return /** @type {any} */ (sendMessage('action.send', opts));
}

/**
 * §20 / G040 — Watcher-mode helper: encode an unsigned PSBT for a SEND
 * action without unlocking the wallet, signing, or broadcasting. Caller
 * transports the resulting hex to a separate Signer-mode wallet.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.to
 * @param {string} opts.tick
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @returns {Promise<{ psbtHex: string, encoding: string, actionString: string, action: string, chainId: string, fromAddress: string }>}
 */
export function buildSendPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.send.psbt', opts));
}

/**
 * §20 / Cluster W FOLLOWUP 5 — watcher-mode helper for the non-Send
 * action surface. Builds an unsigned PSBT for any XChain action without
 * unlocking the wallet, calling a signer, or broadcasting.
 *
 * @param {object} opts
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string, addressId?: string, source?: string, signerId?: string }} opts.from
 * @param {{ action: string, params: object }} opts.actionData
 * @param {object} [opts.encoderOpts]   passes-through to encoder.createTx (fee / feePerKb / rbf / etc.)
 * @returns {Promise<{ psbtHex: string, encoding: string, actionString: string, action: string, chainId: string, fromAddress: string }>}
 */
export function buildActionPsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('action.psbt', opts));
}

/**
 * §17.4 / §30.1 / G024 — user-initiated message signing.
 *
 * @param {{ walletId: string, addressId: string, password: string, message: string, bip39Passphrase?: string }} opts
 * @returns {Promise<{ signature: string }>}
 */
export function signMessageRequest(opts) {
    return /** @type {any} */ (sendMessage('auth.signMessage', opts));
}

/**
 * §17.5 / G025 — verify a signature against an address.
 *
 * @param {{ chainId: string, address: string, message: string, signature: string }} opts
 * @returns {Promise<{ valid: boolean }>}
 */
export function verifyMessageRequest(opts) {
    return /** @type {any} */ (sendMessage('auth.verifyMessage', opts));
}

/**
 * §49.5 / G154 — list signed transactions queued for broadcast on this
 * wallet. UI surface ships at v0.170.0; auto-enqueue from offline
 * broadcasts is tracked as a Cluster G FOLLOWUP, so the list is empty
 * in v1 unless something explicitly enqueues.
 *
 * @param {{ walletId: string }} opts
 * @returns {Promise<Array<{ id: string, chainId: string, signedTxHex: string, summary: string, signedAt: number }>>}
 */
export function listQueuedBroadcasts(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.list', opts));
}

/**
 * §49.5 / G154 — broadcast a queued signed transaction. Caller is the
 * QueuedBroadcastBanner action button.
 *
 * @param {{ walletId: string, id: string }} opts
 */
export function broadcastQueuedRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.broadcast', opts));
}

/**
 * §49.5 / G154 — discard a queued signed transaction without broadcast.
 *
 * @param {{ walletId: string, id: string }} opts
 */
export function discardQueuedRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.discard', opts));
}

/**
 * Cluster G FOLLOWUP 1 — push a signed-but-unbroadcast tx onto the
 * per-walletId queue. Action handlers auto-enqueue on broadcast
 * failure server-side; this shim is for explicit caller use (e.g.
 * PsbtSignForm broadcasting a watcher-signed PSBT).
 *
 * @param {{ walletId: string, chainId: string, signedTxHex: string, summary?: string, signedAt?: number, txid?: string }} opts
 */
export function enqueueBroadcastRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.queue.enqueue', opts));
}

/**
 * §49.1 / G153 — reachability probe across the supplied chains.
 * Returns `{ overall, perChain }`. Polled by the React `useReachability`
 * hook to drive the offline / degraded banner.
 *
 * @param {{ chainIds: string[], timeoutMs?: number }} opts
 * @returns {Promise<{ overall: 'normal' | 'degraded' | 'offline', perChain: Array<{ chainId: string, mode: 'normal' | 'degraded' | 'offline' | 'not-configured', services: { explorer: string, encoder: string, hub: string } }> }>}
 */
export function checkReachabilityRequest(opts) {
    return /** @type {any} */ (sendMessage('reachability.check', opts));
}

/**
 * §30.4 / G088 — read-only PSBT decompose. The PsbtSignForm uses this to
 * surface inputs / outputs / fee on the paste screen before the user
 * commits a password.
 *
 * @param {{ chainId: string, psbtHex: string }} opts
 * @returns {Promise<{ decomposed: import('@xchain-wallet/core/signers/types').DecomposedPsbt }>}
 */
export function parsePsbtRequest(opts) {
    return /** @type {any} */ (sendMessage('psbt.parse', opts));
}

/**
 * §30.4 / G088 — user-initiated PSBT signing. Caller supplies the
 * wallet's chosen signing address (`addressId`); background matches
 * inputs by address and signs only those it owns, returning a
 * partially- or fully-signed PSBT depending on what the wallet could
 * cover.
 *
 * @param {{ walletId: string, addressId: string, password: string, psbtHex: string, bip39Passphrase?: string }} opts
 * @returns {Promise<{ signedPsbtHex: string, txHex: string, txid: string }>}
 */
export function signPsbtUserInitiated(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt', opts));
}

/**
 * §30.4 / Cluster E FOLLOWUP 1 — HW variant of `signPsbtUserInitiated`.
 * No password — background resolves the signer record from the chosen
 * address and routes the sign call through the renderer-hosted Trezor /
 * Ledger transport. Same return shape as the software path.
 *
 * @param {{ walletId: string, addressId: string, psbtHex: string }} opts
 * @returns {Promise<{ signedPsbtHex: string, txHex: string, txid: string }>}
 */
export function signPsbtUserInitiatedHw(opts) {
    return /** @type {any} */ (sendMessage('auth.signPsbt.hw', opts));
}

/**
 * §20 / G040 FOLLOWUP 1 — broadcast a signed transaction. Caller passes
 * the txHex extracted from a signed PSBT (see signPsbtUserInitiated's
 * return shape) plus the chainId. Resolves with the broadcast txid.
 *
 * @param {{ chainId: string, txHex: string }} opts
 * @returns {Promise<{ txid: string }>}
 */
export function broadcastSignedTxRequest(opts) {
    return /** @type {any} */ (sendMessage('broadcast.signedTx', opts));
}

/**
 * §19.3 — reveal the wallet's seed mnemonic.
 *
 * @param {{ walletId: string, password: string }} opts
 * @returns {Promise<{ mnemonic: string, format: string, passphraseEnabled: boolean }>}
 */
export function revealMnemonicRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.revealMnemonic', opts));
}

/**
 * §19.6 — dry-run restore from a candidate mnemonic.
 *
 * @param {{ walletId: string, mnemonic: string, format?: string, bip39Passphrase?: string, gapLimit?: number }} opts
 * @returns {Promise<{ overallMatch: boolean, perChain: Array<object> }>}
 */
export function dryRunRestoreRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.dryRunRestore', opts));
}

/**
 * §19.5.2 / G037 — manual on-chain label publish. Encrypts the
 * wallet's labels + contacts under the seed-derived commitment key
 * and broadcasts the ciphertext as a FILE action on the chosen chain.
 *
 * Resolves to `{ txid, chainId, discoveryName, sizeBytes, fromAddress }`.
 *
 * @param {{ walletId: string, password: string, chainId: string, bip39Passphrase?: string, fee?: number, feePerKb?: number }} opts
 */
export function publishLabelsRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.publishLabels', opts));
}

/**
 * §15.5 / G020 — add a single imported WIF (private key) to an existing
 * HD wallet. The shell is responsible for surfacing the §15.5.3
 * backup-implications warning before invoking this.
 *
 * Resolves to `{ wallet, address }`.
 *
 * @param {{ walletId: string, password: string, chainId: string, wif: string, addressType?: string, label?: string }} opts
 */
export function importWifRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importWif', opts));
}

/**
 * §19.4 / G036 — restore an encrypted backup envelope into the live vault.
 *
 * Resolves to `{ walletId, writes, skipped, walletName }`.
 *
 * @param {{ fileContent: string, password: string, onConflict?: 'overwrite' | 'preserve' | 'error' }} opts
 */
export function importBackupRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.importBackup', opts));
}

/**
 * §48.3 / G149 — runtime chain activation. Seeds settings.fees +
 * ads.perChain for the chainId and derives the first address on that
 * chain for every existing account. Idempotent.
 *
 * @param {{ walletId: string, chainId: string, password: string, bip39Passphrase?: string, signerId?: string | null }} opts
 * @returns {Promise<{ chainId: string, addresses: Array<{ accountId: string, address: any }>, skippedAccounts: number }>}
 */
export function activateChainRequest(opts) {
    return /** @type {any} */ (sendMessage('wallet.activateChain', opts));
}

/**
 * §50 / G156 — diagnostic dump for bug-report copy-paste. Resolves to a
 * `DiagnosticDump` object with wallet metadata + chain registry +
 * counts + recent errors.
 */
export function getDiagnosticDump() {
    return /** @type {any} */ (sendMessage('diagnostic.dump'));
}

/**
 * HW-wallet variant of sendToken. No password (HW keys live on the
 * device). The background handler resolves the `signerId` to a
 * SignerRecord, builds a RemoteSigner wrapping a transport that
 * routes `signer.sign.request` messages to the renderer-hosted
 * Trezor/Ledger signer instance (registered at pair time via
 * `signerBridge.connect`), and calls sendToken with the injected
 * signer — bypassing the software-wallet password-unlock path.
 *
 * Until the renderer↔background port RPC ships, the background
 * handler throws "signer bridge not connected"; the Send form
 * surfaces this at submit time so the UX is honest about which
 * surface is wired.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.signerId
 * @param {{ address: string, publicKey: string, derivationPath: string, addressId: string, source: 'trezor'|'ledger' }} opts.from
 * @param {string} opts.to
 * @param {string} opts.tick
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @returns {Promise<any>}
 */
export function sendAssetHw(opts) {
    return /** @type {any} */ (sendMessage('action.send.hw', opts));
}

/**
 * Query the live status of a paired HW signer. Returns the same
 * SignerStatus values the Signer interface defines
 * (`'available' | 'wrong-app' | 'locked' | 'disconnected' | 'error'`).
 * Used by sign screens to drive HwSignBlock's status banner.
 *
 * @param {{ signerId: string, chainId?: string }} opts
 * @returns {Promise<string | { status: string, detail?: string }>}
 */
export function getSignerStatus(opts) {
    return /** @type {any} */ (sendMessage('signer.status', opts));
}

// HW variants for every action flow. Semantics mirror the software
// counterparts above, minus the `password` field — HW signing keys
// live on the device. The background handler resolves the
// `from.addressId` → Address record → SignerRecord, builds a
// RemoteSigner wrapping the signer-bridge transport, and calls the
// same core flow with the signer injected.

/** @param {object} opts */
export function issueTokenHw(opts) { return /** @type {any} */ (sendMessage('action.issue.hw', opts)); }
/** @param {object} opts */
export function mintAssetHw(opts) { return /** @type {any} */ (sendMessage('action.mint.hw', opts)); }
/** @param {object} opts */
export function destroyAssetHw(opts) { return /** @type {any} */ (sendMessage('action.destroy.hw', opts)); }
/** @param {object} opts */
export function broadcastActionHw(opts) { return /** @type {any} */ (sendMessage('action.broadcast.hw', opts)); }
/** @param {object} opts */
export function dispenserActionHw(opts) { return /** @type {any} */ (sendMessage('action.dispenser.hw', opts)); }
/** @param {object} opts */
export function dividendActionHw(opts) { return /** @type {any} */ (sendMessage('action.dividend.hw', opts)); }
/** @param {object} opts */
export function createListHw(opts) { return /** @type {any} */ (sendMessage('action.createList.hw', opts)); }
/** @param {object} opts */
export function airdropActionHw(opts) { return /** @type {any} */ (sendMessage('action.airdrop.hw', opts)); }
/** @param {object} opts */
export function advancedActionHw(opts) { return /** @type {any} */ (sendMessage('action.advanced.hw', opts)); }

/**
 * Build, sign, and broadcast an ISSUE action — creates or updates a
 * token on the XChain protocol. Fee-paid from the wallet's source
 * address (`from`); ticker + supply + lock flags + transfer targets
 * live in `params`. The Token Creation Wizard is the primary caller;
 * standalone ISSUE / admin forms (§40.2 + §40.5) will use it too.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params        ISSUE field map
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function issueToken(opts) {
    return /** @type {any} */ (sendMessage('action.issue', opts));
}

/**
 * Build, sign, and broadcast a MINT action — mints additional supply of
 * an existing mintable token. Per-mint-limit enforcement happens at the
 * protocol level; this helper doesn't re-check it.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params        MINT field map (TICK, AMOUNT, optional DESTINATION)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function mintToken(opts) {
    return /** @type {any} */ (sendMessage('action.mint', opts));
}

/**
 * Build, sign, and broadcast a DESTROY action — burns `AMOUNT` of the
 * caller's balance of `TICK`. Irreversible at the protocol level.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params        DESTROY field map (TICK, AMOUNT)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function destroyToken(opts) {
    return /** @type {any} */ (sendMessage('action.destroy', opts));
}

/**
 * Build, sign, and broadcast a BROADCAST action — publishes arbitrary
 * text / oracle value / feed reference on-chain, tied to the source
 * address (§40.6). Version selection is the caller's responsibility:
 * v0 plain message, v1 oracle (MESSAGE + VALUE + FEE), v2 feed
 * (MESSAGE + FEE), v3 feed results (BROADCAST_ACTION_INDEX + VALUE).
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params   BROADCAST field map (VERSION, MESSAGE or BROADCAST_ACTION_INDEX, optional VALUE, FEE, MEMO)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function broadcastAction(opts) {
    return /** @type {any} */ (sendMessage('action.broadcast', opts));
}

/**
 * Build, sign, and broadcast a DISPENSER action — opens a vending-
 * machine that dispenses GIVE_TICK when triggered by a GET_COIN or
 * GET_TICK payment (§40.7). Version: '0' create, '1' cancel, '2' edit.
 * Cancel + edit require DISPENSER_ACTION_INDEX.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params   DISPENSER field map (VERSION + create / cancel / edit fields per DISPENSER.md)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function dispenserAction(opts) {
    return /** @type {any} */ (sendMessage('action.dispenser', opts));
}

/**
 * List dispensers the address opened ("My dispensers"). Read-only
 * passthrough to `explorer.getDispensers(address, 'source')`.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 * @returns {Promise<any>}
 */
export function getDispensersForSource(req) {
    return /** @type {any} */ (sendMessage('dispensers.forSource', req));
}

/**
 * List dispensers where the address is either source OR dispenser
 * address.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getDispensersForAddress(req) {
    return /** @type {any} */ (sendMessage('dispensers.forAddress', req));
}

/**
 * List dispensers filtered by token ticker. Used by the buyer-facing
 * explorer (Step 22b).
 *
 * @param {{ chainId: string, token: string, opts?: object }} req
 */
export function getDispensersForToken(req) {
    return /** @type {any} */ (sendMessage('dispensers.forToken', req));
}

/**
 * Fetch a single dispenser by action index. Used by the detail page.
 *
 * @param {{ chainId: string, actionIndex: string }} req
 */
export function getDispenserByActionIndex(req) {
    return /** @type {any} */ (sendMessage('dispensers.byActionIndex', req));
}

/**
 * List dispense events (fills) by type.
 *
 * @param {{ chainId: string, query: string, type: 'address' | 'source' | 'destination' | 'token' | 'block', opts?: object }} req
 */
export function getDispenses(req) {
    return /** @type {any} */ (sendMessage('dispenses.query', req));
}

/**
 * List contracts deployed by a given address. Backs the §42.2 "My
 * contracts" section.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getContractsForSource(req) {
    return /** @type {any} */ (sendMessage('contracts.forSource', req));
}

/**
 * List contracts where the address is either source OR contract
 * address. Preserved for future surfaces that need the broader lane.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getContractsForAddress(req) {
    return /** @type {any} */ (sendMessage('contracts.forAddress', req));
}

/**
 * Paginated list of all contracts on a chain. Backs the §42.2 "Browse
 * all contracts" section.
 *
 * @param {{ chainId: string, opts?: object }} req
 */
export function getContractsBrowseAll(req) {
    return /** @type {any} */ (sendMessage('contracts.browseAll', req));
}

/**
 * List DEPOSIT actions for an address. Merged with withdrawals to
 * compose §42.2 "My interactions".
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getDepositsForAddress(req) {
    return /** @type {any} */ (sendMessage('deposits.forAddress', req));
}

/**
 * List WITHDRAW actions for an address. Paired with deposits to
 * compose §42.2 "My interactions".
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getWithdrawalsForAddress(req) {
    return /** @type {any} */ (sendMessage('withdrawals.forAddress', req));
}

/**
 * Contract metadata by action index — owner, deploy block, gas limit,
 * status, code hash. Backs the §42.3 detail header.
 *
 * @param {{ chainId: string, contractActionIndex: string }} req
 */
export function getContractByActionIndex(req) {
    return /** @type {any} */ (sendMessage('contracts.byActionIndex', req));
}

/**
 * Phase F — a contract's permissions manifest for the inline consent
 * disclosure. Resolves `{ permissions, maxTakeBps }`; never rejects on
 * a missing/undeclared manifest (host flow degrades to nulls).
 *
 * @param {{ chainId: string, contractActionIndex: string }} req
 */
export function getContractManifest(req) {
    return /** @type {any} */ (sendMessage('contracts.manifest', req));
}

/**
 * Phase F — canonical controller action-class list for the bind form's
 * dropdown. Resolves `{ actionClasses: string[] }`.
 *
 * @param {{ chainId: string }} req
 */
export function getControllerActionClasses(req) {
    return /** @type {any} */ (sendMessage('controller.actionClasses', req));
}

/**
 * Phase F — build the `{ action, params }` for a controller bind/unbind
 * via the SDK's controller helper (host-side). Rejects with a clear
 * message when the installed SDK lacks the controller helper.
 *
 * @param {object} req
 */
export function buildControllerBindParams(req) {
    return /** @type {any} */ (sendMessage('controller.buildParams', req));
}

/**
 * Fetch the originating DEPLOY action (NAME / CODE_HASH /
 * CONSTRUCTOR_PARAMS) for the §42.3 detail page. Generic action_index
 * lookup behind the scenes.
 *
 * @param {{ chainId: string, actionIndex: string }} req
 */
export function getActionByIndex(req) {
    return /** @type {any} */ (sendMessage('actions.byIndex', req));
}

/**
 * Fetch expandable contract state. Omit `key` to get all keys.
 *
 * @param {{ chainId: string, contractActionIndex: string, key?: string }} req
 */
export function getContractState(req) {
    return /** @type {any} */ (sendMessage('contracts.state', req));
}

/**
 * Fetch per-token balances held by the contract. Omit `tick` to get
 * every balance.
 *
 * @param {{ chainId: string, contractActionIndex: string, tick?: string }} req
 */
export function getContractBalance(req) {
    return /** @type {any} */ (sendMessage('contracts.balance', req));
}

/**
 * Paginated EXECUTE-action history scoped to one contract.
 *
 * @param {{ chainId: string, contractActionIndex: string, opts?: object }} req
 */
export function getExecutionsForContract(req) {
    return /** @type {any} */ (sendMessage('executions.forContract', req));
}

/**
 * Build, sign, and broadcast a DEPLOY action (§42.6). Hex-encoding of
 * the contract source is handled by the SDK validator chain — pass
 * raw UTF-8 source as params.CODE.
 *
 * @param {object} opts
 */
export function deployAction(opts) {
    return /** @type {any} */ (sendMessage('action.deploy', opts));
}

/** @param {object} opts */
export function deployActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.deploy.hw', opts));
}

/**
 * Build, sign, and broadcast an EXECUTE action (§42.4). Calls a method
 * on a deployed contract with optional pipe-delimited PARAMS.
 *
 * @param {object} opts
 */
export function executeAction(opts) {
    return /** @type {any} */ (sendMessage('action.execute', opts));
}

/** @param {object} opts */
export function executeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.execute.hw', opts));
}

/**
 * Build, sign, and broadcast a DEPOSIT action (§42.5). Sends TICK /
 * QUANTITY to the contract at CONTRACT_ACTION_INDEX.
 *
 * @param {object} opts
 */
export function depositAction(opts) {
    return /** @type {any} */ (sendMessage('action.deposit', opts));
}

/** @param {object} opts */
export function depositActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.deposit.hw', opts));
}

/**
 * Build, sign, and broadcast a WITHDRAW action (§42.5). Pulls TICK /
 * QUANTITY out of the contract at CONTRACT_ACTION_INDEX back to the
 * caller's address. Rejected on-chain if the caller isn't authorized
 * by the contract's internal rules.
 *
 * @param {object} opts
 */
export function withdrawAction(opts) {
    return /** @type {any} */ (sendMessage('action.withdraw', opts));
}

/** @param {object} opts */
export function withdrawActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.withdraw.hw', opts));
}

/**
 * Fetch STAKE entries for an address. Backs the §42.7.4 dashboard's
 * "Your stake" row.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getStakesForAddress(req) {
    return /** @type {any} */ (sendMessage('stakes.forAddress', req));
}

/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getDelegationsForAddress(req) {
    return /** @type {any} */ (sendMessage('delegations.forAddress', req));
}

/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getRewardsForAddress(req) {
    return /** @type {any} */ (sendMessage('rewards.forAddress', req));
}

/** @param {{ chainId: string, opts?: object }} req */
export function getValidatorsForChain(req) {
    return /** @type {any} */ (sendMessage('validators.forChain', req));
}

/** @param {{ chainId: string }} req */
export function getCapabilityThresholds(req) {
    return /** @type {any} */ (sendMessage('capabilities.thresholds', req));
}

/**
 * Build, sign, and broadcast a STAKE action (§42.7.1). Tier 1 +
 * Tier 2 authoring surfaces supported; Tier 3 (oracle publisher,
 * requires DOGE_ADDRESS) deferred pending SDK format update.
 *
 * @param {object} opts
 */
export function stakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.stake', opts));
}

/** @param {object} opts */
export function stakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.stake.hw', opts));
}

/**
 * Build, sign, and broadcast an UNSTAKE action (§42.7.2 unstake-lane).
 * Withdraws the FULL tier stake — protocol format carries VERSION|TIER
 * only, not an amount.
 *
 * @param {object} opts
 */
export function unstakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.unstake', opts));
}

/** @param {object} opts */
export function unstakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.unstake.hw', opts));
}

/** @param {object} req */
export function getContractStakesForAddress(req) {
    return /** @type {any} */ (sendMessage('contract_stakes.forAddress', req));
}

/** @param {object} req */
export function getContractUnstakesForAddress(req) {
    return /** @type {any} */ (sendMessage('contract_unstakes.forAddress', req));
}

/** @param {object} req */
export function getSlashEventsForAddress(req) {
    return /** @type {any} */ (sendMessage('slash_events.forAddress', req));
}

/** @param {object} opts */
export function contractStakeAction(opts) {
    return /** @type {any} */ (sendMessage('action.contractStake', opts));
}

/** @param {object} opts */
export function contractStakeActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.contractStake.hw', opts));
}

/**
 * Build, sign, and broadcast a COLLECT action (§42.7.3). One-click
 * from the Staking dashboard — protocol format is just VERSION.
 *
 * @param {object} opts
 */
export function collectAction(opts) {
    return /** @type {any} */ (sendMessage('action.collect', opts));
}

/** @param {object} opts */
export function collectActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.collect.hw', opts));
}

/**
 * Build, sign, and broadcast a DELEGATE action (§42.7.2 delegation-
 * lane). Points your hub-signing authority at a new Ed25519 pubkey
 * without touching the stake amount. Protocol format:
 * VERSION|NEW_SIGNING_PUBKEY.
 *
 * @param {object} opts
 */
export function delegateAction(opts) {
    return /** @type {any} */ (sendMessage('action.delegate', opts));
}

/** @param {object} opts */
export function delegateActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.delegate.hw', opts));
}

/**
 * Build, sign, and broadcast a DELEGATE v2 (capability revoke) action —
 * §42.7.2 delegation-lane. Removes a previously-delegated signing pubkey
 * without replacing it. Protocol format: VERSION|SIGNING_PUBKEY.
 *
 * @param {object} opts
 */
export function revokeDelegationAction(opts) {
    return /** @type {any} */ (sendMessage('action.revokeDelegation', opts));
}

/** @param {object} opts */
export function revokeDelegationActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.revokeDelegation.hw', opts));
}

/**
 * List BROADCAST actions published by an address. Backs the §42.7.5
 * Operator dashboard's Publishing activity section.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getBroadcastsForAddress(req) {
    return /** @type {any} */ (sendMessage('broadcasts.forAddress', req));
}

/**
 * Mixed-action history for a single address (sends, issues, dispenses,
 * orders, links, …). Backs the §23 History timeline. Each entry
 * carries `action`, `action_index`, `block_index`, `timestamp`,
 * `tx_hash`, plus per-action fields the explorer joins in.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getAddressHistory(req) {
    return /** @type {any} */ (sendMessage('history.address', req));
}

/**
 * List LINK actions where `address` is the source. Backs the §23.5
 * cross-chain thread rendering — a LINK row pairs (coin1,
 * coin1_action_index) with (coin2, coin2_action_index), and the
 * History route uses these pairings to show 🔗 badges, vertical
 * connectors, and the dual-side detail card.
 *
 * @param {{ chainId: string, address: string, opts?: object }} req
 */
export function getLinksForAddress(req) {
    return /** @type {any} */ (sendMessage('links.address', req));
}

/**
 * Persist a §22 + §42.9 multisig configuration onto a Wallet record's
 * `.multisig` slot. For taproot-musig2 the bg handler aggregates the
 * cosigner pubkeys via `sdk.musig2.aggregateKeys` before encoding the
 * scriptTemplate.
 *
 * @param {object} req
 */
export function createMultisigConfig(req) {
    return /** @type {any} */ (sendMessage('multisig.create', req));
}

/**
 * Render the multisig output address for the given wallet's persisted
 * MultisigConfig (P2SH / P2WSH / Taproot-MuSig2). Backs the §22 +
 * §42.9 Receive integration. Returns the address plus N-of-M label,
 * scheme tag, and cosigner names so Receive can show the multisig
 * indicator alongside the QR.
 *
 * @param {{ walletId: string, chainId: string }} req
 */
export function getMultisigReceiveAddress(req) {
    return /** @type {any} */ (sendMessage('multisig.receiveAddress', req));
}

/**
 * Plural variant — returns every multisig receive address the wallet
 * has configured for the given chain (§56.3 pre-launch Step 4). Each
 * entry mirrors the single-result shape with an added `multisigConfigId`.
 *
 * @param {{ walletId: string, chainId: string }} req
 */
export function listMultisigReceiveAddresses(req) {
    return /** @type {any} */ (sendMessage('multisig.listAddresses', req));
}

/**
 * §22.3 + §42.9 multisig sign-round persistence (Phase 4 Step 19).
 * Each helper round-trips a small, named request to the background;
 * the actual state machine + cryptography lives in
 * core/flows/multisigSigning.js. The sign-screen UI calls these to
 * drive the dual-mode tracker (single-round for P2SH/P2WSH, two-round
 * for MuSig2) and to surface session state across wallet reloads.
 */
export function startMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.start', req));
}

/** @param {{ sessionId: string }} req */
export function getMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.get', req));
}

/** @param {{ walletId: string }} req */
export function listMultisigSigningSessions(req) {
    return /** @type {any} */ (sendMessage('multisigSign.list', req));
}

/** @param {{ sessionId: string }} req */
export function cancelMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.cancel', req));
}

/** @param {{ sessionId: string, pubkey: string, publicNonceHex: string }} req */
export function contributeMultisigNonce(req) {
    return /** @type {any} */ (sendMessage('multisigSign.contributeNonce', req));
}

/** @param {{ sessionId: string, pubkey: string, signatureHex: string }} req */
export function contributeMultisigSignature(req) {
    return /** @type {any} */ (sendMessage('multisigSign.contributeSignature', req));
}

/** @param {{ sessionId: string }} req */
export function aggregateMultisigSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.aggregate', req));
}

/** @param {{ sessionId: string, finalizedTxHex: string, txid?: string }} req */
export function finalizeMultisigSigningSession(req) {
    return /** @type {any} */ (sendMessage('multisigSign.finalize', req));
}

/**
 * Local-cosigner contribution (Phase 4 Step 21). Dispatches by
 * `(scheme, status)` of the session: MuSig2 round 1 → publicNonce,
 * MuSig2 round 2 → 32-byte partial sig, P2SH/P2WSH → DER-encoded
 * ECDSA signature. Handles unlock + signer routing + contribute call
 * inside the bg handler.
 *
 * @param {{ sessionId: string, password: string, bip39Passphrase?: string }} req
 */
export function signMultisigLocally(req) {
    return /** @type {any} */ (sendMessage('multisigSign.signLocally', req));
}

/**
 * Syntax-validate contract source (acorn parse + size check + float
 * warnings + reserved-identifier check). Pure; no network.
 *
 * @param {{ chainId: string, code: string }} req
 */
export function validateContractCode(req) {
    return /** @type {any} */ (sendMessage('contracts.validate', req));
}

/** @param {{ chainId: string, code: string }} req */
export function checkContractCodeSize(req) {
    return /** @type {any} */ (sendMessage('contracts.checkCodeSize', req));
}

/** @param {{ chainId: string, code: string }} req */
export function suggestContractGasLimit(req) {
    return /** @type {any} */ (sendMessage('contracts.suggestGasLimit', req));
}

/**
 * Build, sign, and broadcast a DIVIDEND action (§40.8). Distributes
 * AMOUNT of DIVIDEND_TICK to every holder of TICK at the snapshot
 * block. Source is excluded from receiving.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params   DIVIDEND field map (VERSION, TICK, DIVIDEND_TICK, AMOUNT, optional MEMO)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function dividendAction(opts) {
    return /** @type {any} */ (sendMessage('action.dividend', opts));
}

/**
 * List holders of a token — drives DividendForm's cost preview
 * ("N holders / ~TOTAL distribution").
 *
 * @param {{ chainId: string, tick: string, opts?: object }} req
 */
export function getHoldersForToken(req) {
    return /** @type {any} */ (sendMessage('holders.forTick', req));
}

/**
 * §27.6 token-detail richer metadata + §27.5 collectibles image URL.
 * Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3. Returns a normalized
 * `TokenInfo` shape — description / creator / supply / locks / market
 * price / extracted imageUrl.
 *
 * @param {{ chainId: string, tick: string }} req
 */
export function getTokenInfo(req) {
    return /** @type {any} */ (sendMessage('token.info', req));
}

/**
 * Substring search for tokens that exist on the platform. Drives
 * ReceivePicker's "On the platform" discovery section so the user
 * can receive a token they've never held before in one tap.
 *
 * @param {{ chainId: string, query: string, limit?: number }} req
 * @returns {Promise<Array<{ tick: string, totalSupply: string | null, maxSupply: string | null }>>}
 */
export function searchTokens(req) {
    return /** @type {any} */ (sendMessage('tokens.search', req));
}

/**
 * List tokens whose issuer (owner) is the given address. Fans out
 * across the user's addresses to drive the My Tokens page.
 *
 * @param {{ chainId: string, address: string, limit?: number }} req
 * @returns {Promise<Array<{ tick: string, totalSupply: string | null, maxSupply: string | null, description: string | null, locked: boolean, divisibility: number | null }>>}
 */
export function getOwnedTokens(req) {
    return /** @type {any} */ (sendMessage('tokens.owned', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getOrdersForToken(req) {
    return /** @type {any} */ (sendMessage('orders.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getSwapsForToken(req) {
    return /** @type {any} */ (sendMessage('swaps.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getHistoryForToken(req) {
    return /** @type {any} */ (sendMessage('history.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getGenesisForToken(req) {
    return /** @type {any} */ (sendMessage('genesis.forToken', req));
}

/** @param {{ chainId: string, tick: string, opts?: object }} req */
export function getSubassetsForToken(req) {
    return /** @type {any} */ (sendMessage('tokens.subassets', req));
}

/**
 * List the gated FILE actions for a token, grouped by KEY_HASH so
 * packs (files sharing one key) appear as one group. Drives the
 * TokenDetail "Unlock" tab. See
 *   xchain-documentation/protocol/TOKEN_GATED_CONTENT.md.
 *
 * @param {{ chainId: string, tick: string }} req
 */
export function listGatedContent(req) {
    return /** @type {any} */ (sendMessage('gatedContent.list', req));
}

/**
 * Unlock a gated FILE. Password-gated: derives WIF for the holder's
 * address, scans MESSAGE history for the symmetric key, AES-256-GCM
 * decrypts the ciphertext. Returns the plaintext as base64.
 *
 * @param {{
 *   walletId: string,
 *   password: string,
 *   bip39Passphrase?: string,
 *   addressId: string,
 *   actionIndex: string | number,
 *   keyHash: string,
 * }} req
 */
export function unlockGatedContent(req) {
    return /** @type {any} */ (sendMessage('gatedContent.unlock', req));
}

/**
 * Build, sign, and broadcast a LIST action (§40.9 stage 3). The
 * §40.9 AIRDROP authoring flow signs LIST first, waits for it to be
 * indexed, then signs an AIRDROP referencing the assigned
 * ACTION_INDEX.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string | string[]>} opts.params   LIST field map (VERSION, TYPE, ITEM[])
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function createList(opts) {
    return /** @type {any} */ (sendMessage('action.createList', opts));
}

/**
 * Build, sign, and broadcast an AIRDROP action (§40.9 stage 6).
 * References a pre-existing LIST via LIST_ACTION_INDEX — the wallet
 * resolves that index from the LIST txid between stages 3 and 5.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {Record<string, string>} opts.params   AIRDROP field map (VERSION, TICK, AMOUNT, LIST_ACTION_INDEX, optional MEMO)
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function airdropAction(opts) {
    return /** @type {any} */ (sendMessage('action.airdrop', opts));
}

/**
 * Resolve an indexed action by tx hash. AirdropForm polls this on
 * stage 4 to learn the LIST's ACTION_INDEX once the LIST is indexed;
 * returns null while still unindexed.
 *
 * @param {{ chainId: string, txid: string }} req
 */
export function getActionByTxid(req) {
    return /** @type {any} */ (sendMessage('actions.byTxid', req));
}

/**
 * Fetch a LIST action by its ACTION_INDEX — used by stage 5 to
 * confirm the list's TYPE + item count on the AIRDROP review screen.
 *
 * @param {{ chainId: string, actionIndex: string }} req
 */
export function getListByActionIndex(req) {
    return /** @type {any} */ (sendMessage('lists.byActionIndex', req));
}

/**
 * Persist a pending-airdrop record after the LIST tx is broadcast.
 * AirdropForm writes here at the stage-3 → stage-4 transition so a
 * crash or close mid-wait is resumable.
 *
 * @param {{ record: import('@xchain-wallet/core').schemas.pendingAirdrop.PendingAirdrop }} req
 */
export function savePendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.save', req));
}

/**
 * Fetch all in-flight airdrops for a wallet. Used by the Home resume
 * card and by AirdropForm when resuming a specific record.
 *
 * @param {{ walletId: string }} req
 */
export function listPendingAirdropsForWallet(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.listForWallet', req));
}

/**
 * Merge a patch into a pending-airdrop record (stage transitions,
 * listActionIndex / airdropTxid updates).
 *
 * @param {{ id: string, patch: object }} req
 */
export function updatePendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.update', req));
}

/**
 * Delete a pending-airdrop record. Called from the Home resume card
 * when the user acknowledges a `done` entry.
 *
 * @param {{ id: string }} req
 */
export function clearPendingAirdrop(req) {
    return /** @type {any} */ (sendMessage('pendingAirdrops.clear', req));
}

// ─────────────────────────────────────────────────────────────────────
// §41.2 – §41.3 DEX market queries — read-only passthroughs to the
// explorer. No signing. All signatures mirror the core flow.
// ─────────────────────────────────────────────────────────────────────

/** @param {{ chainId: string, tick?: string }} req */
export function getMarkets(req) {
    return /** @type {any} */ (sendMessage('markets.list', req));
}
/** @param {{ chainId: string, tick1: string, tick2: string }} req */
export function getMarket(req) {
    return /** @type {any} */ (sendMessage('markets.byPair', req));
}
/** @param {{ chainId: string, tick1: string, tick2: string, address?: string, opts?: object }} req */
export function getMarketHistory(req) {
    return /** @type {any} */ (sendMessage('markets.history', req));
}
/** @param {{ chainId: string, tick1: string, tick2: string, address?: string, opts?: object }} req */
export function getMarketOrders(req) {
    return /** @type {any} */ (sendMessage('markets.orders', req));
}
/** @param {{ chainId: string, tick1: string, tick2: string }} req */
export function getOrderbook(req) {
    return /** @type {any} */ (sendMessage('markets.orderbook', req));
}

// §41.2 watchlist CRUD
/** @param {{ walletId: string }} req */
export function listWatchlistForWallet(req) {
    return /** @type {any} */ (sendMessage('watchlist.listForWallet', req));
}
/** @param {{ walletId: string, chainId: string, tick1: string, tick2: string }} req */
export function saveWatchlistEntry(req) {
    return /** @type {any} */ (sendMessage('watchlist.save', req));
}
/** @param {{ id: string }} req */
export function clearWatchlistEntry(req) {
    return /** @type {any} */ (sendMessage('watchlist.clear', req));
}

// §41.3.4 ORDER + §41.3.5 CANCEL signing lanes.
/** @param {object} opts */
export function orderAction(opts) {
    return /** @type {any} */ (sendMessage('action.order', opts));
}
/** @param {object} opts */
export function orderActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.order.hw', opts));
}
/** @param {object} opts */
export function cancelOrder(opts) {
    return /** @type {any} */ (sendMessage('action.cancelOrder', opts));
}
/** @param {object} opts */
export function cancelOrderHw(opts) {
    return /** @type {any} */ (sendMessage('action.cancelOrder.hw', opts));
}

// §41.4 COINPAY — settle a native-coin obligation from a matched order.
/** @param {object} opts */
export function coinpayAction(opts) {
    return /** @type {any} */ (sendMessage('action.coinpay', opts));
}
/** @param {object} opts */
export function coinpayActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.coinpay.hw', opts));
}
/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getCoinpayObligationsForAddress(req) {
    return /** @type {any} */ (sendMessage('coinpays.obligationsForAddress', req));
}
/** @param {{ chainId: string, address: string, opts?: object }} req */
export function getCoinpaysForAddress(req) {
    return /** @type {any} */ (sendMessage('coinpays.forAddress', req));
}

// §41.5 SWAP — atomic token-pair swap.
/** @param {object} opts */
export function swapAction(opts) {
    return /** @type {any} */ (sendMessage('action.swap', opts));
}
/** @param {object} opts */
export function swapActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.swap.hw', opts));
}

// §42.8.1 LINK — anchor two existing actions across chains.
/** @param {object} opts */
export function linkAction(opts) {
    return /** @type {any} */ (sendMessage('action.link', opts));
}
/** @param {object} opts */
export function linkActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.link.hw', opts));
}

// FILE — public on-chain file upload (NFT artwork attachment).
/** @param {object} opts */
export function fileAction(opts) {
    return /** @type {any} */ (sendMessage('action.file', opts));
}
/** @param {object} opts */
export function fileActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.file.hw', opts));
}

// Project registry — current roster lookup.
/** @param {object} opts */
export function getProjectForToken(opts) {
    return /** @type {any} */ (sendMessage('projects.byTick', opts));
}

// §41.7.2 Messaging inbox — password-gated decrypt.
/** @param {object} opts */
export function getMessagingInbox(opts) {
    return /** @type {any} */ (sendMessage('messaging.inbox', opts));
}

/** Whether the active wallet can sign without a password right now (unlocked session with a pooled signer). */
export function signerReady(opts) {
    return /** @type {any} */ (sendMessage('wallet.signerReady', opts));
}

// §41.7.3 Compose — ECIES encrypt + MESSAGE action signing.
/** @param {object} opts */
export function messageAction(opts) {
    return /** @type {any} */ (sendMessage('action.message', opts));
}
/** @param {object} opts */
export function messageActionHw(opts) {
    return /** @type {any} */ (sendMessage('action.message.hw', opts));
}
/** @param {{ chainId: string, address: string }} req */
export function getRecipientPubkey(req) {
    return /** @type {any} */ (sendMessage('messaging.pubkey', req));
}

// §41.7.4 Contacts — local address book.
export function listContacts() {
    return /** @type {any} */ (sendMessage('contacts.list', {}));
}
/** @param {{ chain: string, address: string }} req */
export function findContactByAddress(req) {
    return /** @type {any} */ (sendMessage('contacts.findByAddress', req));
}
/** @param {object} opts */
export function saveContact(opts) {
    return /** @type {any} */ (sendMessage('contacts.save', opts));
}
/** @param {{ id: string }} req */
export function deleteContact(req) {
    return /** @type {any} */ (sendMessage('contacts.delete', req));
}

/**
 * Submit any XChain action (§40.10 Advanced Actions Form). Takes the
 * same shape as the dedicated per-action helpers but accepts an
 * arbitrary (action, params) pair. The SDK validator runs inside the
 * encoder at sign time — malformed params fail with a structured
 * error rather than broadcasting bad data.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.action     action name (e.g. "LINK", "CALLBACK", "ADDRESS")
 * @param {Record<string, unknown>} opts.params
 * @returns {Promise<any>}
 */
export function advancedAction(opts) {
    return /** @type {any} */ (sendMessage('action.advanced', opts));
}

/**
 * List every action the SDK supports on a given chain. Drives the
 * Advanced Action form's action dropdown.
 *
 * @param {{ chainId: string }} req
 */
export function listActions(req) {
    return /** @type {any} */ (sendMessage('sdk.listActions', req));
}

/**
 * Fetch the format versions (map of version → format string) for an
 * action — used to populate the optional version dropdown.
 *
 * @param {{ chainId: string, action: string }} req
 */
export function getActionFormats(req) {
    return /** @type {any} */ (sendMessage('sdk.getActionFormats', req));
}

/**
 * Fetch the field list for an action (union of all versions when
 * `version` is omitted). Rest-fields keep their `...` prefix so the
 * form can render them as array inputs.
 *
 * @param {{ chainId: string, action: string, version?: number | string }} req
 */
export function getActionFields(req) {
    return /** @type {any} */ (sendMessage('sdk.getActionFields', req));
}

/**
 * Dry-run validation — the SDK reports structured errors without
 * building / serializing the action string. Drives the form's inline
 * error display.
 *
 * @param {{ chainId: string, action: string, params: object }} req
 */
export function validateAction(req) {
    return /** @type {any} */ (sendMessage('sdk.validateAction', req));
}

/**
 * Persist a paired hardware signer (§17.6 / §18.3). The caller runs
 * `pairTrezorSigner` (or the Ledger equivalent) in the renderer,
 * obtains the `pairingInfo` payload, and forwards it here. Idempotent
 * by (walletId, vendor, deviceIdentifier) — re-pairing the same
 * device returns the existing record with bumped `lastSeenAt`.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {'trezor' | 'ledger'} opts.kind
 * @param {string} opts.vendor
 * @param {string} opts.model
 * @param {string} opts.deviceIdentifier
 * @param {string} [opts.label]
 * @param {string | null} [opts.firmwareVersion]
 * @returns {Promise<any>}
 */
export function registerSigner(opts) {
    return /** @type {any} */ (sendMessage('signer.register', opts));
}

/**
 * List signers paired to a wallet.
 *
 * @param {string} walletId
 * @returns {Promise<any[]>}
 */
export function listSigners(walletId) {
    return /** @type {any} */ (sendMessage('signer.list', { walletId }));
}

/**
 * Forget a paired signer. Does not cascade into addresses — existing
 * Address records keep their `signerId` until a later reconciliation
 * pass fills them back in (or the user pairs a replacement device).
 *
 * @param {string} signerId
 * @returns {Promise<{ deleted: boolean }>}
 */
export function unregisterSigner(signerId) {
    return /** @type {any} */ (sendMessage('signer.unregister', { signerId }));
}

/**
 * Export the WIF for an address (§17.7). The core flow rejects
 * watch-only + hardware addresses with a typed error; for HD it
 * decrypts the seed blob under `password` and derives at the address's
 * recorded path.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.addressId
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<{ wif: string, source: 'hd' | 'imported-wif', derivationPath: string | null, address: string, chainId: string }>}
 */
export function exportPrivateKey(opts) {
    return /** @type {any} */ (sendMessage('wallet.exportPrivateKey', opts));
}

// §35 Settings — read + patch the per-vault Settings record. Patch is a
// deep-merge body; see flows/settings.js for the merge semantics.
export function getSettings() {
    return /** @type {any} */ (sendMessage('settings.get'));
}

/** @param {Record<string, unknown>} patch */
export function updateSettings(patch) {
    return /** @type {any} */ (sendMessage('settings.update', { patch }));
}

/**
 * §19.4 encrypted backup. Resolves to `{ fileContent }` — the
 * pretty-printed JSON envelope ready to write to disk.
 *
 * @param {{ walletId: string, password: string, includePendingTxs?: boolean }} opts
 * @returns {Promise<{ fileContent: string }>}
 */
export function exportBackupFile(opts) {
    return /** @type {any} */ (sendMessage('wallet.exportBackup', opts));
}

// §35.1 + §43 connected-sites — list / disconnect. Approvals create
// the records in bridge/handlers.js.
export function listConnectedSites() {
    return /** @type {any} */ (sendMessage('sites.list'));
}
/** @param {{ id: string }} req */
export function deleteConnectedSite(req) {
    return /** @type {any} */ (sendMessage('sites.delete', req));
}
/**
 * §37.2 / Cluster D FOLLOWUP 1 — restore a ConnectedSite from a
 * full record snapshot. Used by the Disconnect-site Undo toast.
 *
 * @param {{ site: object }} req
 */
export function restoreConnectedSite(req) {
    return /** @type {any} */ (sendMessage('sites.restore', req));
}

// §12 / G009 — origin blocklist.
export function listBlockedOrigins() {
    return /** @type {Promise<string[]>} */ (sendMessage('sites.listBlocked'));
}
/** @param {{ origin: string }} req */
export function blockOrigin(req) {
    return /** @type {any} */ (sendMessage('sites.block', req));
}
/** @param {{ origin: string }} req */
export function unblockOrigin(req) {
    return /** @type {any} */ (sendMessage('sites.unblock', req));
}
/**
 * Cluster S FOLLOWUP 4 — read the recent-mutation audit log for the
 * blocklist (newest-last, ring-buffer capped at 50).
 */
export function listBlocklistAuditLog() {
    return /** @type {Promise<Array<{ at: number, action: 'add' | 'remove', entry: string, evictedSiteIds?: string[] }>>} */ (
        sendMessage('sites.auditLog.list')
    );
}
export function clearBlocklistAuditLog() {
    return /** @type {Promise<{ cleared: number }>} */ (sendMessage('sites.auditLog.clear'));
}

// §9.7 / G007 — runtime chain-registry refresh from hub.
export function getChainRegistryStatus() {
    return /** @type {any} */ (sendMessage('chainRegistry.status'));
}
export function refreshChainRegistry() {
    return /** @type {any} */ (sendMessage('chainRegistry.refresh'));
}

// §9.7 / Cluster Q FOLLOWUP 2 — Developer Mode custom chain registry.
export function listCustomChains() {
    return /** @type {Promise<{ descriptors: object[] }>} */ (sendMessage('chainRegistry.listCustomChains'));
}
export function addCustomChain(req) {
    return /** @type {Promise<{ descriptor: object }>} */ (sendMessage('chainRegistry.addCustomChain', req));
}
export function removeCustomChain(req) {
    return /** @type {Promise<{ removed: boolean }>} */ (sendMessage('chainRegistry.removeCustomChain', req));
}

// §31.4 / Cluster O FOLLOWUP 2 — DIVIDEND / AIRDROP recipient resolution
// for save-as-contact in History.
export function getDividendRecipients(req) {
    return /** @type {Promise<{ recipients: object[], tick: string, source?: string | null, snapshotNote: string }>} */ (
        sendMessage('history.getDividendRecipients', req)
    );
}
export function getAirdropRecipients(req) {
    return /** @type {Promise<{ recipients: object[], listActionIndex: string, listType: string | null }>} */ (
        sendMessage('history.getAirdropRecipients', req)
    );
}

/**
 * Destructively remove a wallet and every record linked to it.
 *
 * @param {{ walletId: string }} req
 */
export function removeWallet(req) {
    return /** @type {any} */ (sendMessage('wallet.remove', req));
}

/**
 * Native-coin price oracle — see web shell for shape. Gated on
 * settings.privacy.priceDataEnabled; returns `{ disabled: true }` when
 * the user has opted out.
 *
 * @param {{ chainIds: string[], includeSparkline?: boolean }} opts
 */
export function getNativePricesRequest(opts) {
    return /** @type {any} */ (sendMessage('prices.native', opts));
}
