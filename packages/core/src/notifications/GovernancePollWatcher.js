// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// GovernancePollWatcher (§46 delivery, governance): notifies the holder when
// a new on-chain VOTE poll opens over a token they hold. Voter apathy is the
// classic token-governance attack (a poll nobody sees is a poll nobody
// out-votes; a binding poll can move real value the moment it finalizes), so
// the wallet tells holders a vote exists instead of assuming they watch a
// governance forum.
//
// Polling sibling of PriceAlertWatcher: poll creation has no per-holder WS
// channel (the creator's NEW_ACTION goes to the creator's address, not to
// every holder), so this watcher polls. Each tick, per active chain, it makes
// ONE explorer query for all open polls (`getPolls('open','status')`) and
// intersects with the held-tick set derived from the wallet's own balances.
// Holdings are never sent to the explorer: the open-poll list is a global
// query, and the intersection happens locally.
//
// Notify-once semantics: a poll is announced the first time it is seen open,
// keyed `chainId:action_index`. The first tick after start() BASELINES each
// chain silently (no notifications) so a fresh unlock doesn't replay every
// long-running poll; only polls that appear after the baseline announce.
// Shells may pass loadSeen/saveSeen to persist the seen-set across restarts;
// without them the baseline resets each session (in-session notifications
// only, matching the NotificationService's lifetime).
//
// Privacy (§46.4): the notification names the chain, the token tick, and
// whether the poll is binding. Both facts are public on-chain data; what the
// notification implicitly reveals to the local OS notification center is that
// this wallet holds the token, which is the same exposure as the existing
// incoming-receipt notifications.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const SEEN_CAP_PER_CHAIN = 500; // prune guard; open polls per chain stay far below this

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

export class GovernancePollWatcher {
    /**
     * @param {Object} deps
     * @param {() => Promise<import('./getActiveAddresses.js').ActiveAddress[]>} deps.getActiveAddresses
     *   the user's addresses to watch (see getActiveAddresses helper)
     * @param {(chainId: string) => import('../sdk/SDKRegistry.js').XChainSDKLike} deps.getSdkForChain
     *   resolve the SDK instance for a chain (e.g. sdkRegistry.get)
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     *   read live Settings each tick so toggling the flag off takes effect immediately
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     *   the shell-specific delivery adapter (shared with NotificationService)
     * @param {() => Promise<object | null>} [deps.loadSeen]
     *   optional: restore the seen-state (`{ [chainId]: string[] }`) persisted by saveSeen
     * @param {(seen: object) => (void | Promise<void>)} [deps.saveSeen]
     *   optional: persist the seen-state after a tick that changed it
     * @param {number} [deps.intervalMs]  poll cadence; defaults to 5 min
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     */
    constructor({
        getActiveAddresses,
        getSdkForChain,
        getSettings,
        notify,
        loadSeen,
        saveSeen,
        intervalMs,
        logger,
    } = {}) {
        if (typeof getActiveAddresses !== 'function') throw new Error('GovernancePollWatcher: getActiveAddresses is required');
        if (typeof getSdkForChain !== 'function') throw new Error('GovernancePollWatcher: getSdkForChain is required');
        if (typeof getSettings !== 'function') throw new Error('GovernancePollWatcher: getSettings is required');
        if (typeof notify !== 'function') throw new Error('GovernancePollWatcher: notify is required');

        this._getActiveAddresses = getActiveAddresses;
        this._getSdkForChain = getSdkForChain;
        this._getSettings = getSettings;
        this._notify = notify;
        this._loadSeen = typeof loadSeen === 'function' ? loadSeen : null;
        this._saveSeen = typeof saveSeen === 'function' ? saveSeen : null;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._log = logger || NOOP_LOGGER;

        this._timer = null;
        this._ticking = false;
        /** @type {Map<string, Set<string>>} chainId → seen open-poll action indices */
        this._seen = new Map();
        this._seenLoaded = false;
    }

    /** Begin polling. Fires an immediate tick, then every intervalMs. Idempotent. */
    start() {
        if (this._timer) return this;
        this.pollOnce().catch((e) => this._log.error('GovernancePollWatcher: initial poll failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('GovernancePollWatcher: poll failed', e));
        }, this._intervalMs);
        // Don't keep a Node process (Electron main) alive just for this timer.
        if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
        return this;
    }

    /** Stop polling and clear session state. */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        this._seen.clear();
        this._seenLoaded = false;
    }

    /**
     * One poll cycle. Public so shells/tests can drive it deterministically.
     * Makes no network call while the feature toggle is off.
     */
    async pollOnce() {
        if (this._ticking) return; // never overlap ticks
        this._ticking = true;
        try {
            let settings;
            try {
                settings = await this._getSettings();
            } catch (e) {
                this._log.error('GovernancePollWatcher: getSettings failed', e);
                return;
            }
            // Feature toggle. Default ON when the field is absent (v2-tolerant,
            // same posture as notifications.messages).
            const featureOn = !settings || !settings.notifications ||
                settings.notifications.governancePolls !== false;
            if (!featureOn) return;

            // Restore persisted seen-state once per session, before the first
            // baseline decision, so a persisted chain doesn't re-baseline.
            if (!this._seenLoaded) {
                this._seenLoaded = true;
                if (this._loadSeen) {
                    try {
                        const stored = await this._loadSeen();
                        if (stored && typeof stored === 'object') {
                            for (const [chainId, ids] of Object.entries(stored)) {
                                if (Array.isArray(ids)) this._seen.set(chainId, new Set(ids.map(String)));
                            }
                        }
                    } catch (e) {
                        this._log.warn('GovernancePollWatcher: loadSeen failed (starting fresh)', e);
                    }
                }
            }

            let addresses;
            try {
                addresses = (await this._getActiveAddresses()) || [];
            } catch (e) {
                this._log.error('GovernancePollWatcher: getActiveAddresses failed', e);
                return;
            }
            if (addresses.length === 0) return;

            // Group addresses by chain; one open-poll query per chain.
            const byChain = new Map();
            for (const a of addresses) {
                if (!a || !a.chainId || !a.address) continue;
                if (!byChain.has(a.chainId)) byChain.set(a.chainId, { label: a.label || a.chainId, addrs: [] });
                byChain.get(a.chainId).addrs.push(a.address);
            }

            let changed = false;
            for (const [chainId, { label, addrs }] of byChain.entries()) {
                try {
                    changed = (await this._tickChain(chainId, label, addrs)) || changed;
                } catch (e) {
                    this._log.warn(`GovernancePollWatcher: chain ${chainId} tick failed`, e);
                }
            }
            if (changed && this._saveSeen) {
                try {
                    const out = {};
                    for (const [chainId, ids] of this._seen.entries()) out[chainId] = Array.from(ids);
                    await this._saveSeen(out);
                } catch (e) {
                    this._log.warn('GovernancePollWatcher: saveSeen failed', e);
                }
            }
        } finally {
            this._ticking = false;
        }
    }

    /**
     * One chain's cycle: fetch open polls, intersect with held ticks, announce
     * unseen ones. Returns true when the seen-set changed.
     */
    async _tickChain(chainId, chainLabel, addrs) {
        const sdk = this._getSdkForChain(chainId);
        if (!sdk || typeof sdk.getPolls !== 'function') return false;

        // noRetry: a background poll must fail fast (the next tick IS the
        // retry); the SDK's backoff would otherwise hold the event loop open
        // and hammer an explorer that predates the polls endpoint (404).
        const openRaw = await sdk.getPolls('open', 'status', { noRetry: true });
        const open = normalizeRows(openRaw);
        const firstSight = !this._seen.has(chainId);
        const seen = firstSight ? new Set() : this._seen.get(chainId);

        // Prune: only polls still open need remembering; a poll that
        // finalized/failed leaves the open list and can never announce again.
        const openIds = new Set(open.map((p) => String(p.action_index)));
        let changed = false;
        for (const id of seen) {
            if (!openIds.has(id)) { seen.delete(id); changed = true; }
        }

        // Which open polls are news?
        const fresh = open.filter((p) => !seen.has(String(p.action_index)));
        for (const p of fresh) {
            if (seen.size >= SEEN_CAP_PER_CHAIN) break;
            seen.add(String(p.action_index));
            changed = true;
        }
        this._seen.set(chainId, seen);

        // Baseline tick: remember everything currently open, announce nothing.
        if (firstSight || fresh.length === 0) return changed;

        // Held ticks: the wallet's own balances, fetched only when there is
        // something new to check against (fresh polls are rare; balances calls
        // shouldn't run on every idle tick).
        const held = await this._getHeldTicks(sdk, addrs);
        if (held.size === 0) return changed;

        for (const p of fresh) {
            const tick = typeof p.tick === 'string' ? p.tick.toUpperCase() : null;
            if (!tick || !held.has(tick)) continue;
            const binding = p.callback_contract_index !== null && p.callback_contract_index !== undefined;
            try {
                await this._notify({
                    kind: 'governance-poll',
                    title: binding ? 'Binding governance poll' : 'Governance poll',
                    body: binding
                        ? `A binding poll (its result triggers a contract) is open for ${tick} on ${chainLabel}. Review it before it closes.`
                        : `A new poll is open for ${tick} on ${chainLabel}.`,
                    data: {
                        chainId,
                        tick,
                        pollIndex: p.action_index,
                        binding,
                        endBlock: p.end_block ?? null,
                    },
                });
            } catch (e) {
                this._log.error('GovernancePollWatcher: notify failed', e);
            }
        }
        return changed;
    }

    /** Union of ticks held (positive balance) across this chain's addresses. */
    async _getHeldTicks(sdk, addrs) {
        const held = new Set();
        if (typeof sdk.getBalances !== 'function') return held;
        for (const address of addrs) {
            let raw;
            try {
                raw = await sdk.getBalances(address, { noRetry: true });
            } catch (e) {
                this._log.warn('GovernancePollWatcher: getBalances failed', e);
                continue;
            }
            // Accept the explorer's flat array (real SDK) or the wallet's
            // `{ tokens: [...] }` shape (dev-mock SDK), like listOwnedTokens.
            for (const r of normalizeRows(raw)) {
                const tick = typeof r?.tick === 'string' ? r.tick.toUpperCase() : null;
                const qty = r?.quantity ?? r?.amount ?? r?.balance ?? null;
                if (tick && qty != null && String(qty) !== '0' && Number(qty) > 0) held.add(tick);
            }
        }
        return held;
    }
}

// Accept a bare array, `{ data: [...] }`, or `{ tokens: [...] }` payload.
function normalizeRows(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.tokens)) return raw.tokens;
    return [];
}
