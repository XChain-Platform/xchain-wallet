// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// NotificationService (§46 delivery core): Platform-agnostic; it owns the
// "which on-chain event, gated by which setting, becomes which notification"
// logic, and nothing else. The actual OS/browser notification is an injected
// `notify` adapter (browser Notification API on web, chrome.notifications in
// the extension SW, electron.Notification on desktop). `core` imports nothing
// from any shell, so every shell dependency is passed in.
//
// Event source: the SDK's existing explorer-WebSocket subscriptions
// (`sdk.onAddress`). A single `onAddress(addr, cb)` subscription routes
// NEW_ACTION / ORDER_MATCH / SWAP_MATCH / DISPENSE / COINPAY_REQUIRED for that
// address to one callback, so one subscription per active address (well under
// the explorer's 25-sub/connection cap) covers every notification kind.
//
// MEMPOOL_ACTION / MEMPOOL_REMOVED ride that SAME callback: M1.2 put them in
// the SDK's ADDRESS_EVENT_TYPES roster, so `onAddress` already registers for
// them. Calling `sdk.onMempoolAction` here as well would only add a second
// holder of the identical subscription, and the cap is per connection.
//
// Direction matters for NEW_ACTION: source === our address means an action we
// broadcast was indexed (→ tx confirmed); destination === our address means an
// inbound transfer (→ incoming receipt). Using source/destination off the
// action row is precise where an ADDRESS_UPDATE balance snapshot is not (it
// can't tell a send from a receive).
//
// Privacy (§46.4): notification text carries no keys and no precise balances.
// Only the chain name and the event kind are included. (Amount/token inclusion
// gated by the `notifications.showAmounts` preference is a follow-up; bodies
// stay generic for now.)

import { isWithinQuietHours } from './quietHours.js';

const DEDUP_TTL_MS = 30_000;
const DEDUP_CAP = 200;
const SUB_WARN_THRESHOLD = 20; // explorer caps a connection at 25 subscriptions

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

export class NotificationService {
    /**
     * @param {Object} deps
     * @param {() => Promise<import('./getActiveAddresses.js').ActiveAddress[]>} deps.getActiveAddresses
     *   the user's addresses to watch (see getActiveAddresses helper)
     * @param {(chainId: string) => import('../sdk/SDKRegistry.js').XChainSDKLike} deps.getSdkForChain
     *   resolve the SDK instance for a chain (e.g. sdkRegistry.get)
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     *   read the live Settings record; re-read per event so toggling a flag off
     *   takes effect immediately, no resubscribe
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     *   the shell-specific delivery adapter
     * @param {() => Promise<Set<string> | string[]>} [deps.getPendingTxids]
     *   optional: txids the wallet broadcast and is awaiting (status 'broadcast').
     *   When provided, tx-confirmed only fires for txs we actually sent.
     * @param {(txid: string) => (void | Promise<void>)} [deps.onTxConfirmed]
     *   optional: called with a confirmed txid so the shell can flip its
     *   PendingTx record to 'indexed'
     * @param {(txid: string) => (void | Promise<void>)} [deps.onMempoolSeen]
     *   optional: called the first time the network reports holding one of our
     *   broadcast txids, so the shell can stamp `mempoolSeenAt` on its PendingTx
     *   record (§4 M2.2). Called at most once per frame; the shell's writer is
     *   the thing that must be idempotent, since one transaction paying two of
     *   our own addresses arrives once per address channel by design
     * @param {() => number} [deps.now]  injectable clock (dedup); defaults to Date.now
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     */
    constructor({
        getActiveAddresses,
        getSdkForChain,
        getSettings,
        notify,
        getPendingTxids,
        onTxConfirmed,
        onMempoolSeen,
        now,
        logger,
    } = {}) {
        if (typeof getActiveAddresses !== 'function') throw new Error('NotificationService: getActiveAddresses is required');
        if (typeof getSdkForChain !== 'function') throw new Error('NotificationService: getSdkForChain is required');
        if (typeof getSettings !== 'function') throw new Error('NotificationService: getSettings is required');
        if (typeof notify !== 'function') throw new Error('NotificationService: notify is required');

        this._getActiveAddresses = getActiveAddresses;
        this._getSdkForChain = getSdkForChain;
        this._getSettings = getSettings;
        this._notify = notify;
        this._getPendingTxids = typeof getPendingTxids === 'function' ? getPendingTxids : null;
        this._onTxConfirmed = typeof onTxConfirmed === 'function' ? onTxConfirmed : null;
        this._onMempoolSeen = typeof onMempoolSeen === 'function' ? onMempoolSeen : null;
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._log = logger || NOOP_LOGGER;

        this._started = false;
        /** @type {Map<string, { unsub: () => void, chainId: string }>} subKey -> entry */
        this._subs = new Map();
        /** @type {Map<string, import('../sdk/SDKRegistry.js').XChainSDKLike>} chainId -> connected sdk */
        this._conns = new Map();
        /** @type {Map<string, number>} dedup key -> expiry ms */
        this._recent = new Map();
    }

    /** Connect + subscribe for every active address. Idempotent. */
    async start() {
        if (this._started) return this;
        this._started = true;
        await this._sync();
        return this;
    }

    /** Reconcile subscriptions against the current active-address set. */
    async refresh() {
        if (!this._started) return this;
        await this._sync();
        return this;
    }

    /** Tear everything down. */
    stop() {
        for (const { unsub } of this._subs.values()) {
            try { unsub(); } catch (e) { this._log.warn('NotificationService: unsubscribe failed', e); }
        }
        this._subs.clear();
        for (const sdk of this._conns.values()) {
            try { if (sdk.disconnectWs) sdk.disconnectWs(); } catch (e) { this._log.warn('NotificationService: disconnect failed', e); }
        }
        this._conns.clear();
        this._recent.clear();
        this._started = false;
    }

    /** Reconcile live subscriptions to match the desired active-address set. */
    async _sync() {
        let active;
        try {
            active = await this._getActiveAddresses();
        } catch (e) {
            this._log.error('NotificationService: getActiveAddresses failed', e);
            return;
        }

        /** @type {Map<string, import('./getActiveAddresses.js').ActiveAddress>} */
        const desired = new Map();
        for (const a of active || []) {
            if (!a || !a.address || !a.chainId) continue;
            desired.set(`${a.chainId}|${a.address}`, a);
        }

        // Drop subscriptions no longer wanted.
        for (const [key, entry] of Array.from(this._subs.entries())) {
            if (!desired.has(key)) {
                try { entry.unsub(); } catch (e) { this._log.warn('NotificationService: unsubscribe failed', e); }
                this._subs.delete(key);
            }
        }

        // Add new subscriptions, connecting each chain's SDK once.
        for (const [key, a] of desired.entries()) {
            if (this._subs.has(key)) continue;
            let sdk = this._conns.get(a.chainId);
            if (!sdk) {
                try {
                    sdk = this._getSdkForChain(a.chainId);
                    await sdk.connectWs();
                    this._conns.set(a.chainId, sdk);
                } catch (e) {
                    this._log.error(`NotificationService: connectWs failed for ${a.chainId}`, e);
                    continue;
                }
            }
            const perChain = Array.from(this._subs.values()).filter((s) => s.chainId === a.chainId).length;
            if (perChain >= SUB_WARN_THRESHOLD) {
                this._log.warn(`NotificationService: ${perChain + 1} subscriptions on ${a.chainId}, nearing the explorer 25-sub cap`);
            }
            try {
                const unsub = sdk.onAddress(a.address, this._makeHandler(a));
                this._subs.set(key, { unsub, chainId: a.chainId });
            } catch (e) {
                this._log.error(`NotificationService: subscribe failed for ${a.address}`, e);
            }
        }

        // Disconnect chains that no longer have any subscription.
        const stillUsed = new Set(Array.from(this._subs.values()).map((s) => s.chainId));
        for (const [chainId, sdk] of Array.from(this._conns.entries())) {
            if (!stillUsed.has(chainId)) {
                try { if (sdk.disconnectWs) sdk.disconnectWs(); } catch (e) { this._log.warn('NotificationService: disconnect failed', e); }
                this._conns.delete(chainId);
            }
        }
    }

    /** @param {import('./getActiveAddresses.js').ActiveAddress} addr */
    _makeHandler(addr) {
        return (msg) => {
            this._handle(addr, msg).catch((e) => this._log.error('NotificationService: handler error', e));
        };
    }

    /**
     * @param {import('./getActiveAddresses.js').ActiveAddress} addr
     * @param {{ type?: string, data?: any, catch_up?: boolean, timestamp?: number }} msg
     */
    async _handle(addr, msg) {
        if (!msg || !msg.type) return;

        // Recording that the network holds one of our transactions is an
        // OBSERVATION, not a notification, so it runs ahead of both gates
        // below. A replayed frame is still evidence a node had it, and the
        // wallet must not be reduced to guessing at a transaction's state
        // because the user turned a notification toggle off.
        if (msg.type === 'MEMPOOL_ACTION') await this._recordMempoolSeen(msg);

        // catch_up events are historical replays sent on (re)connect, not a
        // live occurrence, so never notify on them.
        if (msg.catch_up) return;
        const data = msg.data || {};

        let settings;
        try {
            settings = await this._getSettings();
        } catch (e) {
            this._log.error('NotificationService: getSettings failed', e);
            return;
        }
        const flags = (settings && settings.notifications) || {};

        /** @type {{ kind: string, title: string, body: string } | null} */
        let plan = null;

        switch (msg.type) {
            case 'NEW_ACTION': {
                const source = data.source || null;
                const destination = data.destination || null;
                if (source && source === addr.address) {
                    // An action we broadcast has been indexed → tx confirmed.
                    //
                    // Retiring our own pending record is an OBSERVATION, not a
                    // notification, so it runs ahead of the toggle the same way
                    // the mempool sighting above does. pendingDeltas subtracts
                    // every still-committed record from spendable balance to
                    // block a double-spend, and this hook is the only thing
                    // that ever clears one: gating it on a preference would
                    // understate the balance of a user who turned the toggle
                    // off, by the full amount of every send, for good.
                    const txid = data.tx_hash || data.txid || null;
                    let ours = true;
                    if (this._getPendingTxids) {
                        const pending = await this._safePendingTxids();
                        ours = Boolean(txid) && pending.has(txid);
                    }
                    if (!ours) break; // a stranger's transaction: never write, never notify
                    if (txid && this._onTxConfirmed) {
                        try { await this._onTxConfirmed(txid); } catch (e) { this._log.warn('NotificationService: onTxConfirmed failed', e); }
                    }
                    if (!flags.txConfirmations) break;
                    plan = { kind: 'tx-confirmed', title: 'Transaction confirmed', body: `Your transaction on ${addr.label} was confirmed.` };
                } else if (destination && destination === addr.address) {
                    // An inbound action landed at our address. A MESSAGE is its
                    // own notification kind (gated by its own flag); everything
                    // else is a generic incoming receipt. The action-type string
                    // rides on every live NEW_ACTION event from the explorer.
                    if (data.action === 'MESSAGE') {
                        if (!flags.messages) break;
                        // Privacy (§46.4): no sender, no content, only the chain.
                        plan = { kind: 'incoming-message', title: 'New message', body: `You received a message on ${addr.label}.` };
                    } else {
                        if (!flags.incomingReceipts) break;
                        plan = { kind: 'incoming-receipt', title: `Received on ${addr.label}`, body: `Your ${addr.label} address received a transaction.` };
                    }
                }
                break;
            }
            case 'ORDER_MATCH':
            case 'SWAP_MATCH':
                if (flags.orderFills) {
                    plan = { kind: 'order-fill', title: 'Order matched', body: `Your order on ${addr.label} was matched.` };
                }
                break;
            case 'DISPENSE':
                if (flags.dispenserFills) {
                    plan = { kind: 'dispenser-fill', title: 'Dispenser used', body: `Someone bought from your dispenser on ${addr.label}.` };
                }
                break;
            case 'COINPAY_REQUIRED':
                // BTCPAY-style obligation. No dedicated v1 toggle; gate under
                // incomingReceipts (it's an inbound-settlement prompt).
                if (flags.incomingReceipts) {
                    plan = { kind: 'coinpay-required', title: 'Payment required', body: `A coin payment is required to complete your swap on ${addr.label}.` };
                }
                break;
            // priceAlerts has no client event source in v1 (no alert-threshold
            // store). See the §46 plan's "deferred" note. The toggle exists but
            // this service never fires it.
            default:
                break;
        }

        if (!plan) return;

        // quiet hours: suppress delivery (not queue/defer - the
        // underlying explorer event isn't replayed) during the user's
        // configured DND window. Checked last, after the per-kind flag,
        // so quiet hours never masks a legitimately-off notification kind
        // in tests/logs.
        if (isWithinQuietHours(settings)) return;

        const ident = data.action_index != null
            ? String(data.action_index)
            : String(msg.timestamp || this._now());
        if (this._isDuplicate(`${plan.kind}:${addr.address}:${ident}`)) return;

        try {
            await this._notify({
                kind: plan.kind,
                title: plan.title,
                body: plan.body,
                data: {
                    chainId: addr.chainId,
                    address: addr.address,
                    type: msg.type,
                    actionIndex: data.action_index != null ? data.action_index : null,
                },
            });
        } catch (e) {
            this._log.error('NotificationService: notify adapter threw', e);
        }
    }

    /**
     * A MEMPOOL_ACTION frame names a transaction some node is holding. When it
     * is one WE broadcast, that is the first hard evidence the network took it,
     * and it is what promotes the tx-status timeline out of "Broadcast,
     * awaiting network" (§4 M2.2).
     *
     * Requires the pending roster: without it we cannot tell our own send from
     * a stranger's, and stamping a record we do not own is worse than staying
     * quiet. Failure is logged, never thrown, because this rides the same
     * handler as delivery and a storage hiccup must not cost the user a
     * notification.
     *
     * @param {{ data?: any }} msg
     */
    async _recordMempoolSeen(msg) {
        if (!this._onMempoolSeen || !this._getPendingTxids) return;
        const data = msg.data || {};
        const txid = data.tx_hash || data.txid || null;
        if (!txid) return;
        const pending = await this._safePendingTxids();
        if (!pending.has(txid)) return;
        try {
            await this._onMempoolSeen(txid);
        } catch (e) {
            this._log.warn('NotificationService: onMempoolSeen failed', e);
        }
    }

    async _safePendingTxids() {
        try {
            const s = await this._getPendingTxids();
            return s instanceof Set ? s : new Set(s || []);
        } catch (e) {
            this._log.warn('NotificationService: getPendingTxids failed', e);
            return new Set();
        }
    }

    /** Returns true if this id fired within the dedup window; records it otherwise. */
    _isDuplicate(id) {
        const now = this._now();
        if (this._recent.size > DEDUP_CAP) {
            for (const [k, exp] of this._recent) {
                if (exp <= now) this._recent.delete(k);
            }
        }
        const exp = this._recent.get(id);
        if (exp && exp > now) return true;
        this._recent.set(id, now + DEDUP_TTL_MS);
        return false;
    }
}
