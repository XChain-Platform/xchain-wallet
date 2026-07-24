// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PriceAlertWatcher: §46 price-alert delivery. The sibling of
// NotificationService: where that one is WebSocket-event-driven (the
// explorer pushes on-chain events), price has no WS channel. The only
// source is the CoinGecko-backed price oracle (an HTTP fetch). So this
// watcher *polls*: every `intervalMs` it reads the user's armed alerts,
// fetches the current native-coin price, and fires a notification (via the
// same injected `notify` adapter the NotificationService uses) when a
// threshold is crossed. One-shot: a fired alert is marked `triggered` so it
// never re-fires until the user re-arms it.
//
// PRIVACY: this is the wallet's only opt-out telemetry (see
// flows/priceOracle.js). A background poll is *new recurring* network
// exposure, so the watcher is hard-gated and makes ZERO network calls
// unless ALL of these hold each tick:
//   1. settings.privacy.priceDataEnabled !== false  (the telemetry opt-out)
//   2. settings.notifications.priceAlerts            (the feature toggle)
//   3. at least one armed alert exists               (nothing to watch)
// With no armed alerts it never touches the network; an idle user with the
// toggle on but no alerts set leaks nothing.

import { isWithinQuietHours } from './quietHours.js';

// Align with priceOracle's SPOT_TTL_MS so a poll usually hits the oracle's
// in-memory cache rather than issuing a fresh CoinGecko request.
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

export class PriceAlertWatcher {
    /**
     * @param {Object} deps
     * @param {(opts: { chainIds: string[], fiatCurrency: string }) => Promise<{ prices?: Record<string, { priceFiat: number|null }|null>, disabled?: boolean, error?: string }>} deps.getNativePrices
     *   the price source (typically a priceOracle.getNativePrices wrapper)
     * @param {() => Promise<import('../schemas/priceAlert.js').PriceAlert[]>} deps.listArmedAlerts
     *   the user's alerts; the watcher filters to status === 'armed'
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     *   read live Settings each tick so toggling a flag off takes effect immediately
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     *   the shell-specific delivery adapter (shared with NotificationService)
     * @param {(id: string) => (void | Promise<void>)} deps.markTriggered
     *   disarm an alert after it fires (one-shot)
     * @param {number} [deps.intervalMs]  poll cadence; defaults to 5 min
     * @param {() => number} [deps.now]   injectable clock; defaults to Date.now
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     */
    constructor({
        getNativePrices,
        listArmedAlerts,
        getSettings,
        notify,
        markTriggered,
        intervalMs,
        now,
        logger,
    } = {}) {
        if (typeof getNativePrices !== 'function') throw new Error('PriceAlertWatcher: getNativePrices is required');
        if (typeof listArmedAlerts !== 'function') throw new Error('PriceAlertWatcher: listArmedAlerts is required');
        if (typeof getSettings !== 'function') throw new Error('PriceAlertWatcher: getSettings is required');
        if (typeof notify !== 'function') throw new Error('PriceAlertWatcher: notify is required');
        if (typeof markTriggered !== 'function') throw new Error('PriceAlertWatcher: markTriggered is required');

        this._getNativePrices = getNativePrices;
        this._listArmedAlerts = listArmedAlerts;
        this._getSettings = getSettings;
        this._notify = notify;
        this._markTriggered = markTriggered;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._log = logger || NOOP_LOGGER;

        this._timer = null;
        /** @type {Set<string>} alert ids fired this session (guards re-fire before markTriggered persists) */
        this._fired = new Set();
        this._ticking = false;
    }

    /** Begin polling. Fires an immediate tick, then every intervalMs. Idempotent. */
    start() {
        if (this._timer) return this;
        // Immediate first poll so an already-satisfied alert fires promptly.
        this.pollOnce().catch((e) => this._log.error('PriceAlertWatcher: initial poll failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('PriceAlertWatcher: poll failed', e));
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
        this._fired.clear();
    }

    /**
     * One poll cycle. Public so shells/tests can drive it deterministically.
     * Makes no network call unless the three privacy gates all pass.
     */
    async pollOnce() {
        if (this._ticking) return; // never overlap ticks
        this._ticking = true;
        try {
            let settings;
            try {
                settings = await this._getSettings();
            } catch (e) {
                this._log.error('PriceAlertWatcher: getSettings failed', e);
                return;
            }
            // Gate 1 + 2: telemetry opt-out and feature toggle.
            const privacyOk = !settings || !settings.privacy || settings.privacy.priceDataEnabled !== false;
            const featureOn = Boolean(settings && settings.notifications && settings.notifications.priceAlerts);
            if (!privacyOk || !featureOn) return;

            // Gate 3: nothing armed → no network.
            let armed;
            try {
                armed = (await this._listArmedAlerts()) || [];
            } catch (e) {
                this._log.error('PriceAlertWatcher: listArmedAlerts failed', e);
                return;
            }
            armed = armed.filter((a) => a && a.status === 'armed' && !this._fired.has(a.id));
            if (armed.length === 0) return;

            // Group by fiat currency (one oracle call per currency; almost
            // always just one). Within a currency, fetch the distinct chains.
            const byCurrency = new Map();
            for (const a of armed) {
                const cur = String(a.fiatCurrency || 'usd').toLowerCase();
                if (!byCurrency.has(cur)) byCurrency.set(cur, []);
                byCurrency.get(cur).push(a);
            }

            for (const [fiatCurrency, alerts] of byCurrency.entries()) {
                const chainIds = Array.from(new Set(alerts.map((a) => a.chainId)));
                let result;
                try {
                    result = await this._getNativePrices({ chainIds, fiatCurrency });
                } catch (e) {
                    this._log.error('PriceAlertWatcher: getNativePrices failed', e);
                    continue;
                }
                if (!result || result.disabled || !result.prices) continue;

                for (const alert of alerts) {
                    const entry = result.prices[alert.chainId];
                    const price = entry && typeof entry.priceFiat === 'number' && Number.isFinite(entry.priceFiat)
                        ? entry.priceFiat
                        : null;
                    if (price == null) continue; // no price data for this chain (testnet/regtest/unmapped)
                    if (!this._isSatisfied(alert, price)) continue;
                    await this._fire(alert, price, settings);
                }
            }
        } finally {
            this._ticking = false;
        }
    }

    /** @param {import('../schemas/priceAlert.js').PriceAlert} alert @param {number} price */
    _isSatisfied(alert, price) {
        if (alert.direction === 'above') return price >= alert.targetFiat;
        if (alert.direction === 'below') return price <= alert.targetFiat;
        return false;
    }

    /**
     * @param {import('../schemas/priceAlert.js').PriceAlert} alert
     * @param {number} price
     * @param {import('../schemas/settings.js').Settings | null | undefined} [settings]
     */
    async _fire(alert, price, settings) {
        this._fired.add(alert.id); // guard before any await so a slow markTriggered can't double-fire
        const coin = coinDisplayName(alert.chainId);
        const target = formatTarget(alert.targetFiat, alert.fiatCurrency);
        const dir = alert.direction === 'above' ? 'rose above' : 'fell below';
        //  quiet hours: the threshold still fires and the alert is
        // still marked triggered (one-shot semantics unchanged), but the
        // OS/browser notification itself is suppressed during the DND
        // window. Re-arming after quiet hours behaves exactly like
        // re-arming any other triggered alert.
        if (!isWithinQuietHours(settings)) {
            try {
                await this._notify({
                    kind: 'price-alert',
                    title: 'Price alert',
                    // Privacy-safe: coin + threshold only, no balances or keys.
                    body: `${coin} ${dir} ${target}.`,
                    data: {
                        chainId: alert.chainId,
                        direction: alert.direction,
                        targetFiat: alert.targetFiat,
                        fiatCurrency: alert.fiatCurrency,
                        alertId: alert.id,
                    },
                });
            } catch (e) {
                this._log.error('PriceAlertWatcher: notify adapter threw', e);
            }
        }
        try {
            await this._markTriggered(alert.id);
        } catch (e) {
            this._log.warn('PriceAlertWatcher: markTriggered failed', e);
        }
    }
}

/** 'bitcoin-mainnet' → 'Bitcoin'. Falls back to the raw chainId. */
function coinDisplayName(chainId) {
    if (typeof chainId !== 'string' || !chainId) return String(chainId);
    const coin = chainId.split('-')[0];
    return coin ? coin.charAt(0).toUpperCase() + coin.slice(1) : chainId;
}

/** Compact, locale-free threshold label, e.g. 70000/usd → "$70,000". */
function formatTarget(value, fiatCurrency) {
    const cur = String(fiatCurrency || 'usd').toLowerCase();
    const grouped = groupThousands(value);
    if (cur === 'usd') return `$${grouped}`;
    return `${grouped} ${cur.toUpperCase()}`;
}

/** Insert thousands separators without relying on toLocaleString (determinism). */
function groupThousands(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    const neg = n < 0 ? '-' : '';
    const [intPart, fracPart] = Math.abs(n).toString().split('.');
    const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fracPart ? `${neg}${withSep}.${fracPart}` : `${neg}${withSep}`;
}
