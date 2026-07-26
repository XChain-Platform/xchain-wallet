// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DispenserEscrowWatcher (PC-46): tells an operator their dispenser is nearly
// out of stock, before it silently stops serving buyers.
//
// A dispenser holds a fixed escrow and pays GIVE_AMOUNT per dispense, so the
// useful number is not the raw balance but how many more people it can serve:
//   dispenses left = floor(give_remaining / give_amount)
// A dispenser with 3 dispenses left is worth a nudge; one at 0 is a shopfront
// that looks open and turns everyone away.
//
// WHY THIS ISN'T IN DeadlineWatcher (PC-45), which already lists the same
// dispensers each tick: that watcher answers "is time running out", this one
// answers "is stock running out". Keeping them apart costs one extra listing
// call per address per tick and keeps each module's scope assertion meaningful.
//
// TWO READS PER DISPENSER, and the second is the reason this can't ride the
// listing alone: the dispensers listing carries `give_amount` but NOT the
// remaining escrow. Only the action detail exposes `state.give_remaining`, so
// each open dispenser costs one extra read. That is bounded by
// MAX_DETAIL_READS_PER_TICK; an operator with more dispensers than that gets
// the lowest-indexed ones checked this tick and the rest next tick, and the
// cap is logged rather than silently truncating.
//
// RE-ANNOUNCES ON A FURTHER DROP. The notify-once key carries the bucket the
// dispenser is in (`low` or `empty`), so a dispenser that slides from 3 left to
// 0 announces again. Keying on the id alone would say "running low" once and
// then stay silent through the moment it actually ran dry.
//
// FULL AUTO-REFILL IS DEFERRED (per the item): topping up escrow moves real
// value without a per-event confirmation, which is the same consent problem
// PC-16 solved with an explicit signed mandate. This notifies and deep-links
// to PC-19's refill stage on DispenserDetail instead. The notification does
// NOT promise a refill will be accepted: the protocol caps a dispenser at 5
// refills and a 6,000 lifetime ceiling, and the explorer exposes neither
// refill_count nor per-edit escrow, so only the refill form itself can state
// where the operator stands against that cap.

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** Warn at or below this many remaining dispenses. */
const DEFAULT_LOW_DISPENSES = 3;
const SEEN_CAP_PER_CHAIN = 500;
const MAX_DETAIL_READS_PER_TICK = 25;

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

export class DispenserEscrowWatcher {
    /**
     * @param {Object} deps
     * @param {() => Promise<import('./getActiveAddresses.js').ActiveAddress[]>} deps.getActiveAddresses
     * @param {(chainId: string) => import('../sdk/SDKRegistry.js').XChainSDKLike} deps.getSdkForChain
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     * @param {() => Promise<object | null>} [deps.loadSeen]
     * @param {(seen: object) => (void | Promise<void>)} [deps.saveSeen]
     * @param {number} [deps.intervalMs]
     * @param {number} [deps.lowDispenses]  warn at or below this many remaining
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
        lowDispenses,
        logger,
    } = {}) {
        if (typeof getActiveAddresses !== 'function') throw new Error('DispenserEscrowWatcher: getActiveAddresses is required');
        if (typeof getSdkForChain !== 'function') throw new Error('DispenserEscrowWatcher: getSdkForChain is required');
        if (typeof getSettings !== 'function') throw new Error('DispenserEscrowWatcher: getSettings is required');
        if (typeof notify !== 'function') throw new Error('DispenserEscrowWatcher: notify is required');

        this._getActiveAddresses = getActiveAddresses;
        this._getSdkForChain = getSdkForChain;
        this._getSettings = getSettings;
        this._notify = notify;
        this._loadSeen = typeof loadSeen === 'function' ? loadSeen : null;
        this._saveSeen = typeof saveSeen === 'function' ? saveSeen : null;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._lowDispenses = Number.isFinite(lowDispenses) && lowDispenses >= 0
            ? lowDispenses : DEFAULT_LOW_DISPENSES;
        this._log = logger || NOOP_LOGGER;

        this._timer = null;
        this._ticking = false;
        /** @type {Map<string, Set<string>>} chainId -> announced `actionIndex:bucket` keys */
        this._seen = new Map();
        this._seenLoaded = false;
    }

    /** Begin polling. Fires an immediate tick, then every intervalMs. Idempotent. */
    start() {
        if (this._timer) return this;
        this.pollOnce().catch((e) => this._log.error('DispenserEscrowWatcher: initial poll failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('DispenserEscrowWatcher: poll failed', e));
        }, this._intervalMs);
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

    /** One poll cycle. Public so shells/tests can drive it deterministically. */
    async pollOnce() {
        if (this._ticking) return;
        this._ticking = true;
        try {
            let settings;
            try {
                settings = await this._getSettings();
            } catch (e) {
                this._log.error('DispenserEscrowWatcher: getSettings failed', e);
                return;
            }
            // Default ON when absent (v2-tolerant, same posture as the sibling watchers).
            const featureOn = !settings || !settings.notifications
                || settings.notifications.dispenserEscrow !== false;
            if (!featureOn) return;

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
                        this._log.warn('DispenserEscrowWatcher: loadSeen failed (starting fresh)', e);
                    }
                }
            }

            let addresses;
            try {
                addresses = (await this._getActiveAddresses()) || [];
            } catch (e) {
                this._log.error('DispenserEscrowWatcher: getActiveAddresses failed', e);
                return;
            }
            if (addresses.length === 0) return;

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
                    this._log.warn(`DispenserEscrowWatcher: chain ${chainId} tick failed`, e);
                }
            }
            if (changed && this._saveSeen) {
                try {
                    const out = {};
                    for (const [chainId, ids] of this._seen.entries()) out[chainId] = Array.from(ids);
                    await this._saveSeen(out);
                } catch (e) {
                    this._log.warn('DispenserEscrowWatcher: saveSeen failed', e);
                }
            }
        } finally {
            this._ticking = false;
        }
    }

    /** One chain's cycle. Returns true when the seen-set changed. */
    async _tickChain(chainId, chainLabel, addrs) {
        const sdk = this._getSdkForChain(chainId);
        if (!sdk || typeof sdk.getDispensers !== 'function' || typeof sdk.getAction !== 'function') return false;

        // Pass 1: my open dispensers, by SOURCE (who runs it), deduped across
        // addresses so one dispenser is never read twice in a tick.
        const candidates = new Map();
        for (const address of addrs) {
            let raw;
            try {
                raw = await sdk.getDispensers(address, 'source', { noRetry: true });
            } catch (e) {
                this._log.warn('DispenserEscrowWatcher: getDispensers failed', e);
                continue;
            }
            for (const row of normalizeRows(raw)) {
                if (!row || (row.status != null && String(row.status) !== 'valid')) continue;
                const actionIndex = String(row.action_index ?? '');
                if (!actionIndex || candidates.has(actionIndex)) continue;
                const giveAmount = Number(row.give_amount);
                // A dispenser that gives nothing per dispense has no "how many
                // left" to compute; skip rather than divide by zero.
                if (!Number.isFinite(giveAmount) || giveAmount <= 0) continue;
                candidates.set(actionIndex, { actionIndex, giveAmount, giveTick: row.give_tick || '' });
            }
        }
        if (candidates.size === 0) return false;

        // Pass 2: the remaining escrow, which only the detail read carries.
        const ordered = Array.from(candidates.values())
            .sort((a, b) => Number(a.actionIndex) - Number(b.actionIndex));
        const budget = ordered.slice(0, MAX_DETAIL_READS_PER_TICK);
        if (ordered.length > budget.length) {
            this._log.warn(
                `DispenserEscrowWatcher: ${ordered.length} open dispensers on ${chainId}; checking ${budget.length} this tick`,
            );
        }

        const low = [];
        for (const d of budget) {
            let detail;
            try {
                detail = await sdk.getAction(d.actionIndex, { noRetry: true });
            } catch (e) {
                this._log.warn(`DispenserEscrowWatcher: getAction ${d.actionIndex} failed`, e);
                continue;
            }
            const state = detail && typeof detail === 'object' ? detail.state : null;
            if (!state || String(state.status) !== 'open') continue;
            const remaining = Number(state.give_remaining);
            if (!Number.isFinite(remaining) || remaining < 0) continue;
            const dispensesLeft = Math.floor(remaining / d.giveAmount);
            if (dispensesLeft > this._lowDispenses) continue;
            low.push({ ...d, remaining, dispensesLeft, bucket: dispensesLeft === 0 ? 'empty' : 'low' });
        }

        const seen = this._seen.get(chainId) || new Set();
        // Prune keys whose dispenser is no longer low (a refill landed), so the
        // next drop announces again.
        const liveKeys = new Set(low.map((d) => `${d.actionIndex}:${d.bucket}`));
        const stillLow = new Set(low.map((d) => d.actionIndex));
        let changed = false;
        for (const key of seen) {
            const id = key.split(':')[0];
            if (!liveKeys.has(key) && !stillLow.has(id)) { seen.delete(key); changed = true; }
        }

        const fresh = low.filter((d) => !seen.has(`${d.actionIndex}:${d.bucket}`));
        for (const d of fresh) {
            if (seen.size >= SEEN_CAP_PER_CHAIN) break;
            seen.add(`${d.actionIndex}:${d.bucket}`);
            changed = true;
        }
        this._seen.set(chainId, seen);

        for (const d of fresh) {
            const empty = d.bucket === 'empty';
            try {
                await this._notify({
                    kind: 'dispenser-escrow',
                    title: empty ? 'Your dispenser is empty' : 'Your dispenser is running low',
                    body: empty
                        ? `Dispenser #${d.actionIndex} on ${chainLabel} has run out of ${d.giveTick} and is turning buyers away. Top it up to start serving again.`
                        : `Dispenser #${d.actionIndex} on ${chainLabel} can serve ${d.dispensesLeft} more buyer${d.dispensesLeft === 1 ? '' : 's'} before it runs out of ${d.giveTick}.`,
                    data: {
                        chainId,
                        actionIndex: d.actionIndex,
                        dispensesLeft: d.dispensesLeft,
                        remaining: String(d.remaining),
                        giveTick: d.giveTick,
                        // PC-19's refill lives as a stage on the dispenser's
                        // own page; the shell opens it directly.
                        route: 'dispenser-detail',
                        intent: 'refill',
                    },
                });
            } catch (e) {
                this._log.error('DispenserEscrowWatcher: notify failed', e);
            }
        }
        return changed;
    }
}

// Accept a bare array, `{ data: [...] }`, or `{ tokens: [...] }` payload.
function normalizeRows(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.tokens)) return raw.tokens;
    return [];
}
