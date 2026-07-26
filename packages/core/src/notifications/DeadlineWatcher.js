// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DeadlineWatcher (PC-45): tells the user before one of their own open
// commitments runs out of time. Covers the four things that expire on a
// deadline the user set themselves:
//
//   - orders they placed          (ORDER  EXPIRATION)
//   - swaps they offered          (SWAP   EXPIRATION)
//   - dispensers they run         (DISPENSER EXPIRATION)
//   - polls they created or voted in (VOTE END_BLOCK)
//
// Deliberately NOT covered: COINPAY obligation countdowns belong to PC-15's
// obligations centre and unstake-cooldown maturity to PC-47's dashboards.
// Both already own a timer over the same data, and a second watcher would
// notify twice for one deadline. This watcher deep-links to those surfaces
// instead (see the `route` field on each notification's data).
//
// TWO CLOCKS, AND THEY ARE NOT INTERCHANGEABLE. Orders, swaps and dispensers
// carry EXPIRATION as a UNIX TIMESTAMP the indexer compares against the block
// time (see PC-17/PC-18/PC-20, which fixed exactly this by emitting future
// timestamps rather than block counts). A poll's END_BLOCK is a bare BLOCK
// HEIGHT with no wall-clock component. So a tick reads both the chain's tip
// height and its tip block time, compares each deadline against the matching
// clock, and converts the one warning window into blocks per coin using the
// coin's target block interval. Comparing timestamps against the LOCAL clock
// would drift from the chain the indexer actually settles against, so the
// chain's own block time is the reference here as it is in PC-42.
//
// NO BASELINE TICK, unlike GovernancePollWatcher. That watcher silences its
// first tick so a fresh unlock doesn't replay every long-running poll. Here
// the opposite is right: an order that expires in an hour is the single most
// useful thing to say the moment the wallet opens, and baselining would
// suppress precisely the urgent case. The burst is bounded instead (see
// MAX_NOTIFICATIONS_PER_TICK): past the cap the watcher sends one summary
// rather than a wall of notifications.
//
// Notify-once semantics: keyed `chainId:kind:actionIndex`, pruned when an item
// stops being open, so a re-listed deadline can announce again.
//
// Privacy (§46.4): every notification names only the user's own actions, which
// are public on-chain data. What it reveals to the local OS notification
// centre is that this wallet controls them, the same exposure as the existing
// order-fill notifications.

import { targetBlockSecondsForCoin } from '../shared/utils/blockDateEstimate.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** How far ahead a deadline counts as "approaching". */
const DEFAULT_WINDOW_SECONDS = 24 * 60 * 60;
const SEEN_CAP_PER_CHAIN = 500;
/** Past this many in one tick, send one summary instead. */
const MAX_NOTIFICATIONS_PER_TICK = 5;

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

/** Deep-link targets the shells route on. */
const ROUTE_BY_KIND = {
    order: 'my-orders',
    swap: 'my-swaps',
    dispenser: 'dispenser-detail',
    poll: 'poll-detail',
};

const LABEL_BY_KIND = {
    order: 'order',
    swap: 'swap',
    dispenser: 'dispenser',
    poll: 'poll',
};

export class DeadlineWatcher {
    /**
     * @param {Object} deps
     * @param {() => Promise<import('./getActiveAddresses.js').ActiveAddress[]>} deps.getActiveAddresses
     * @param {(chainId: string) => import('../sdk/SDKRegistry.js').XChainSDKLike} deps.getSdkForChain
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     * @param {(chainId: string) => (string | null)} [deps.coinForChain]  chain -> coin, for the block-interval conversion
     * @param {() => Promise<object | null>} [deps.loadSeen]
     * @param {(seen: object) => (void | Promise<void>)} [deps.saveSeen]
     * @param {number} [deps.intervalMs]
     * @param {number} [deps.windowSeconds]  how far ahead counts as approaching
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     */
    constructor({
        getActiveAddresses,
        getSdkForChain,
        getSettings,
        notify,
        coinForChain,
        loadSeen,
        saveSeen,
        intervalMs,
        windowSeconds,
        logger,
    } = {}) {
        if (typeof getActiveAddresses !== 'function') throw new Error('DeadlineWatcher: getActiveAddresses is required');
        if (typeof getSdkForChain !== 'function') throw new Error('DeadlineWatcher: getSdkForChain is required');
        if (typeof getSettings !== 'function') throw new Error('DeadlineWatcher: getSettings is required');
        if (typeof notify !== 'function') throw new Error('DeadlineWatcher: notify is required');

        this._getActiveAddresses = getActiveAddresses;
        this._getSdkForChain = getSdkForChain;
        this._getSettings = getSettings;
        this._notify = notify;
        this._coinForChain = typeof coinForChain === 'function' ? coinForChain : defaultCoinForChain;
        this._loadSeen = typeof loadSeen === 'function' ? loadSeen : null;
        this._saveSeen = typeof saveSeen === 'function' ? saveSeen : null;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._windowSeconds = Number.isFinite(windowSeconds) && windowSeconds > 0
            ? windowSeconds : DEFAULT_WINDOW_SECONDS;
        this._log = logger || NOOP_LOGGER;

        this._timer = null;
        this._ticking = false;
        /** @type {Map<string, Set<string>>} chainId -> announced `kind:actionIndex` keys */
        this._seen = new Map();
        this._seenLoaded = false;
    }

    /** Begin polling. Fires an immediate tick, then every intervalMs. Idempotent. */
    start() {
        if (this._timer) return this;
        this.pollOnce().catch((e) => this._log.error('DeadlineWatcher: initial poll failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('DeadlineWatcher: poll failed', e));
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

    /**
     * One poll cycle. Public so shells/tests can drive it deterministically.
     * Makes no network call while the feature toggle is off.
     */
    async pollOnce() {
        if (this._ticking) return;
        this._ticking = true;
        try {
            let settings;
            try {
                settings = await this._getSettings();
            } catch (e) {
                this._log.error('DeadlineWatcher: getSettings failed', e);
                return;
            }
            // Default ON when absent (v2-tolerant, same posture as governancePolls).
            const featureOn = !settings || !settings.notifications
                || settings.notifications.deadlines !== false;
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
                        this._log.warn('DeadlineWatcher: loadSeen failed (starting fresh)', e);
                    }
                }
            }

            let addresses;
            try {
                addresses = (await this._getActiveAddresses()) || [];
            } catch (e) {
                this._log.error('DeadlineWatcher: getActiveAddresses failed', e);
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
                    this._log.warn(`DeadlineWatcher: chain ${chainId} tick failed`, e);
                }
            }
            if (changed && this._saveSeen) {
                try {
                    const out = {};
                    for (const [chainId, ids] of this._seen.entries()) out[chainId] = Array.from(ids);
                    await this._saveSeen(out);
                } catch (e) {
                    this._log.warn('DeadlineWatcher: saveSeen failed', e);
                }
            }
        } finally {
            this._ticking = false;
        }
    }

    /**
     * One chain's cycle. Returns true when the seen-set changed.
     */
    async _tickChain(chainId, chainLabel, addrs) {
        const sdk = this._getSdkForChain(chainId);
        if (!sdk) return false;

        // Both clocks, from ONE status read. Without a usable block time no
        // timestamp deadline can be judged, and without a height no poll
        // deadline can be; each half degrades independently.
        const { blockTime, height } = await this._readClocks(sdk);

        const due = [];
        due.push(...await this._collectMarketDeadlines(sdk, addrs, blockTime));
        due.push(...await this._collectPollDeadlines(sdk, chainId, addrs, height));

        const seen = this._seen.get(chainId) || new Set();
        // Prune: a key whose item is no longer open (or no longer near) may
        // announce again if the user re-lists it.
        const liveKeys = new Set(due.map((d) => d.key));
        let changed = false;
        for (const key of seen) {
            if (!liveKeys.has(key)) { seen.delete(key); changed = true; }
        }

        const fresh = due.filter((d) => !seen.has(d.key));
        for (const d of fresh) {
            if (seen.size >= SEEN_CAP_PER_CHAIN) break;
            seen.add(d.key);
            changed = true;
        }
        this._seen.set(chainId, seen);
        if (fresh.length === 0) return changed;

        // Soonest first: if the burst is capped, the user sees the urgent ones.
        fresh.sort((a, b) => a.remaining - b.remaining);

        if (fresh.length > MAX_NOTIFICATIONS_PER_TICK) {
            await this._safeNotify({
                kind: 'deadline-summary',
                title: `${fresh.length} deadlines approaching`,
                body: `${fresh.length} of your open items on ${chainLabel} run out within ${describeWindow(this._windowSeconds)}. The soonest is your ${LABEL_BY_KIND[fresh[0].kind]} ${fresh[0].remainingText}.`,
                data: { chainId, count: fresh.length, kinds: fresh.map((d) => d.kind) },
            });
            return changed;
        }

        for (const d of fresh) {
            await this._safeNotify({
                kind: 'deadline',
                title: `Your ${LABEL_BY_KIND[d.kind]} ${d.kind === 'poll' ? 'closes soon' : 'expires soon'}`,
                body: d.body(chainLabel),
                data: {
                    chainId,
                    kind: d.kind,
                    actionIndex: d.actionIndex,
                    route: ROUTE_BY_KIND[d.kind],
                    ...(d.expiration != null ? { expiration: d.expiration } : {}),
                    ...(d.endBlock != null ? { endBlock: d.endBlock } : {}),
                },
            });
        }
        return changed;
    }

    /** Tip height + tip block time from one /status read; nulls on any gap. */
    async _readClocks(sdk) {
        if (typeof sdk.getStatus !== 'function') return { blockTime: null, height: null };
        let status;
        try {
            status = await sdk.getStatus({ noRetry: true });
        } catch (e) {
            this._log.warn('DeadlineWatcher: getStatus failed', e);
            return { blockTime: null, height: null };
        }
        const coin = typeof sdk.explorer?.coin === 'string' ? sdk.explorer.coin : null;
        if (!coin || !status || typeof status !== 'object') return { blockTime: null, height: null };
        const blockTime = pickNumber(status.last_block_time, coin);
        // chain_tip is the node's height; last_block is what the indexer has
        // processed. A poll closes on CHAIN height, so prefer chain_tip.
        const height = pickNumber(status.chain_tip, coin) ?? pickNumber(status.last_block, coin);
        return { blockTime, height };
    }

    /**
     * Orders, swaps and dispensers: EXPIRATION is a Unix timestamp, compared
     * against the chain's tip block time.
     */
    async _collectMarketDeadlines(sdk, addrs, blockTime) {
        if (!Number.isFinite(blockTime)) return [];
        const out = [];
        const lanes = [
            { kind: 'order', method: 'getOrders', type: 'address' },
            { kind: 'swap', method: 'getSwaps', type: 'address' },
            // A dispenser's deadline is the operator's problem, so query the
            // source (who runs it), not the address it pays out to.
            { kind: 'dispenser', method: 'getDispensers', type: 'source' },
        ];
        for (const address of addrs) {
            for (const lane of lanes) {
                if (typeof sdk[lane.method] !== 'function') continue;
                let raw;
                try {
                    raw = await sdk[lane.method](address, lane.type, { noRetry: true });
                } catch (e) {
                    this._log.warn(`DeadlineWatcher: ${lane.method} failed`, e);
                    continue;
                }
                for (const row of normalizeRows(raw)) {
                    if (!isOpenRow(row)) continue;
                    const expiration = toNumber(row.expiration);
                    // 0 / absent means "never expires" in every one of these
                    // three actions, so it is not a deadline at all.
                    if (!Number.isFinite(expiration) || expiration <= 0) continue;
                    const remaining = expiration - blockTime;
                    if (remaining <= 0 || remaining > this._windowSeconds) continue;
                    const actionIndex = String(row.action_index ?? '');
                    if (!actionIndex) continue;
                    const remainingText = `in ${describeWindow(remaining)}`;
                    out.push({
                        kind: lane.kind,
                        actionIndex,
                        key: `${lane.kind}:${actionIndex}`,
                        remaining,
                        remainingText,
                        expiration,
                        endBlock: null,
                        body: (chainLabel) =>
                            `Your ${LABEL_BY_KIND[lane.kind]} #${actionIndex} on ${chainLabel} expires ${remainingText}.`,
                    });
                }
            }
        }
        return dedupeByKey(out);
    }

    /**
     * Polls the user created or voted in: END_BLOCK is a block height, so the
     * warning window is converted to blocks at the coin's target interval.
     * One global open-poll query per chain (as GovernancePollWatcher does),
     * intersected locally with the user's own creations and ballots - the
     * wallet never tells the explorer which polls it cares about.
     */
    async _collectPollDeadlines(sdk, chainId, addrs, height) {
        if (!Number.isFinite(height)) return [];
        if (typeof sdk.getPolls !== 'function') return [];
        const blockSeconds = targetBlockSecondsForCoin(this._coinForChain(chainId));
        if (!blockSeconds) return [];
        const windowBlocks = Math.max(1, Math.round(this._windowSeconds / blockSeconds));

        let openRaw;
        try {
            openRaw = await sdk.getPolls('open', 'status', { noRetry: true });
        } catch (e) {
            this._log.warn('DeadlineWatcher: getPolls failed', e);
            return [];
        }
        const open = normalizeRows(openRaw);
        if (open.length === 0) return [];

        const mine = new Set(addrs.map(String));
        // Ballots cast: the poll index the vote points at.
        const votedIn = new Set();
        if (typeof sdk.getVotes === 'function') {
            for (const address of addrs) {
                let raw;
                try {
                    raw = await sdk.getVotes(address, 'address', { noRetry: true });
                } catch (e) {
                    this._log.warn('DeadlineWatcher: getVotes failed', e);
                    continue;
                }
                for (const v of normalizeRows(raw)) {
                    const ref = v?.poll_action_index ?? v?.poll_index ?? v?.poll_ref;
                    if (ref != null) votedIn.add(String(ref));
                }
            }
        }

        const out = [];
        for (const p of open) {
            const actionIndex = String(p.action_index ?? '');
            if (!actionIndex) continue;
            const involved = mine.has(String(p.source)) || votedIn.has(actionIndex);
            if (!involved) continue;
            const endBlock = toNumber(p.end_block);
            if (!Number.isFinite(endBlock)) continue;
            const remainingBlocks = endBlock - height;
            if (remainingBlocks <= 0 || remainingBlocks > windowBlocks) continue;
            const role = mine.has(String(p.source)) ? 'you created' : 'you voted in';
            const remainingText = `in about ${remainingBlocks} block${remainingBlocks === 1 ? '' : 's'}`;
            out.push({
                kind: 'poll',
                actionIndex,
                key: `poll:${actionIndex}`,
                // Ranked against the other lanes in seconds, so a poll and an
                // order can be ordered by real urgency rather than by unit.
                remaining: remainingBlocks * blockSeconds,
                remainingText,
                expiration: null,
                endBlock,
                body: (chainLabel) =>
                    `The ${p.tick || ''} poll ${role} on ${chainLabel} closes ${remainingText} (block ${endBlock}).`.replace(/\s+/g, ' '),
            });
        }
        return dedupeByKey(out);
    }

    async _safeNotify(n) {
        try {
            await this._notify(n);
        } catch (e) {
            this._log.error('DeadlineWatcher: notify failed', e);
        }
    }
}

/** `${coin}` key lookup on a /status map, e.g. last_block_time.RBTC. */
function pickNumber(map, coin) {
    if (!map || typeof map !== 'object') return null;
    const v = map[coin];
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function toNumber(v) {
    if (v == null || v === '') return NaN;
    return Number(v);
}

/** Only a still-open item has a deadline worth announcing. */
function isOpenRow(row) {
    if (!row) return false;
    // `status` is the action's validity; `*_status` is the lifecycle state.
    if (row.status != null && String(row.status) !== 'valid') return false;
    const lifecycle = row.order_status ?? row.swap_status ?? row.dispenser_status ?? null;
    if (lifecycle != null && String(lifecycle) !== 'open') return false;
    return true;
}

function dedupeByKey(rows) {
    const byKey = new Map();
    for (const r of rows) if (!byKey.has(r.key)) byKey.set(r.key, r);
    return Array.from(byKey.values());
}

/** Plain-language duration: "3 days", "5 hours", "20 minutes". */
export function describeWindow(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    const day = 86400;
    const hour = 3600;
    const minute = 60;
    if (s >= day) {
        const d = Math.round(s / day);
        return `${d} day${d === 1 ? '' : 's'}`;
    }
    if (s >= hour) {
        const h = Math.round(s / hour);
        return `${h} hour${h === 1 ? '' : 's'}`;
    }
    if (s >= minute) {
        const m = Math.round(s / minute);
        return `${m} minute${m === 1 ? '' : 's'}`;
    }
    return `${s} second${s === 1 ? '' : 's'}`;
}

/** chainId -> coin, for builds that don't inject a registry lookup. */
function defaultCoinForChain(chainId) {
    if (typeof chainId !== 'string') return null;
    const coin = chainId.split('-')[0];
    return coin || null;
}

// Accept a bare array, `{ data: [...] }`, or `{ tokens: [...] }` payload.
function normalizeRows(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.tokens)) return raw.tokens;
    return [];
}
