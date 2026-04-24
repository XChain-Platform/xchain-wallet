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
 * @returns {Promise<Array<{ id: string, name: string, createdAt: string, origin: string, format: string, passphraseEnabled: boolean, multisig: boolean | null }>>}
 */
export function listWallets() {
    return /** @type {any} */ (sendMessage('wallet.list'));
}

/**
 * Aggregate balances for a wallet, grouped by chainId. Per-address
 * entries carry `balances: null` + a `error` string when the SDK
 * read fails — the Home screen renders those as retry rows.
 *
 * @param {string} walletId
 * @returns {Promise<Record<string, Array<{ address: string, addressType: string, label: string, balances: unknown | null, error: string | null }>>>}
 */
export function getWalletBalances(walletId) {
    return /** @type {any} */ (sendMessage('balances.wallet', { walletId }));
}

/**
 * @param {string} walletId
 * @returns {Promise<Record<string, Array<{ address: string, label: string, addressType: string, derivationPath: string | null }>>>}
 */
export function getAddressesByChain(walletId) {
    return /** @type {any} */ (sendMessage('addresses.byChain', { walletId }));
}

/**
 * Newest (highest external index) HD address for a wallet + chain, or
 * `null` if no address exists yet.
 *
 * @param {string} walletId
 * @param {string} chainId
 * @returns {Promise<null | { address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function getNewestAddress(walletId, chainId) {
    return /** @type {any} */ (
        sendMessage('addresses.newest', { walletId, chainId })
    );
}

/**
 * Derive + persist the next unused external address for (wallet, chain).
 * Requires the user's password because the signer re-derives the HD
 * key material; the vault-level unlock doesn't cover the per-wallet
 * seed decryption.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.password
 * @param {string} [opts.bip39Passphrase]
 * @param {string} [opts.addressType]
 * @returns {Promise<{ id: string, address: string, label: string, addressType: string, derivationPath: string | null }>}
 */
export function generateReceiveAddress(opts) {
    return /** @type {any} */ (sendMessage('receive.getAddress', opts));
}

/**
 * Build, sign, and broadcast a SEND action via the host's `action.send`
 * handler. Pass-through to core's `sendAsset` flow — fails loudly
 * against the dev-SDK stub until real xchain-sdk is bundled.
 *
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.password
 * @param {string} opts.chainId
 * @param {{ address: string, publicKey: string, derivationPath?: string | null, addressId?: string }} opts.from
 * @param {string} opts.to
 * @param {string} opts.asset
 * @param {string | number} opts.amount
 * @param {string} [opts.memo]
 * @param {number} [opts.fee]
 * @param {number} [opts.feePerKb]
 * @param {boolean} [opts.rbf]
 * @param {string} [opts.bip39Passphrase]
 * @returns {Promise<any>}
 */
export function sendAsset(opts) {
    return /** @type {any} */ (sendMessage('action.send', opts));
}

/**
 * HW-wallet variant of sendAsset. No password (HW keys live on the
 * device). The background handler resolves the `signerId` to a
 * SignerRecord, builds a RemoteSigner wrapping a transport that
 * routes `signer.sign.request` messages to the renderer-hosted
 * Trezor/Ledger signer instance (registered at pair time via
 * `signerBridge.connect`), and calls sendAsset with the injected
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
 * @param {string} opts.asset
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
export function mintAsset(opts) {
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
export function destroyAsset(opts) {
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
