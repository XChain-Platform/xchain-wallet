// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CoinpayAutopayWatcher (PC-16): the auto-pay engine. COINPAY exists
// because native coin cannot be escrowed by the DEX; without auto-pay,
// a coin-GIVE order is not fire-and-forget. This watcher polls the
// obligation queue for orders the user consented to (autopayOrders
// vault records, written at placement), applies the pure decision
// policy in market/autopayPolicy.js (depth gate, GIVE-side caps,
// arming/retry cutoffs), and pays through the standard coinpayAction
// flow - whose own verified preamble re-reads the obligation from the
// chain immediately before signing, giving the spec's pre-sign
// re-check for free.
//
// Signing model (Phase A): unlocked sessions only. The engine signs
// with the pre-unlocked SoftwareSigner from the shell's SignerPool via
// the injected `getSigner`; when that returns null (locked session,
// HW/watch-only wallet, desktop keychain-only unlock - seeds have
// their own per-wallet KDF, so an open vault alone cannot sign) the
// engine degrades to the high-urgency manual notification. It never
// stores or receives a password.
//
// Single active payer: exactly one instance holds the vault's payer
// lease per cycle; the rest stay notify-only. Vaults are per-shell at
// HEAD, so the racers this arbitrates are same-vault contexts (web
// tabs, MV3 worker restarts); see schemas/autopayLease.js. Defense in
// depth beyond the lease: the own-pendingTx scan (a payment for this
// match already signed/broadcast from this vault counts as attempted)
// and coinpayAction's pending_coinpay re-check.
//
// Reservation: before signing, a hold for payee amount + estimated
// network fee goes into the shared reservation ledger so a
// user-initiated send cannot race the auto-payment out of its funds.
// The hold releases only when the obligation leaves pending (fulfilled
// by anyone / expired) or the payment tx is indexed - broadcast alone
// never releases it, keeping the retry path funded.
//
// WS events (onCoinpayRequired) are used strictly as poll triggers:
// the policy never pays on an event alone (trust-anchor cap 1).

import {
    evaluateObligation,
    leaseState,
} from '../market/autopayPolicy.js';
import { PAYER_LEASE_ID, createAutopayLease } from '../schemas/autopayLease.js';
import {
    listAutopayOrders,
    recordAutopayPayment,
    resolveOrderActionIndexes,
} from '../flows/autopayConsent.js';
import { coinpayAction as defaultCoinpayAction } from '../flows/coinpayAction.js';
import { indexerWatermark } from '../flows/balances.js';
import {
    extractCoinpayRows,
    getCoinpayObligationsForAddress,
} from '../flows/coinpayQueries.js';
import { estimateNativeSendFeeTiers, displayRateToSettingsCustom } from '../flows/feeEstimate.js';
import { baseUnitsToCoinText, obligationBaseUnits } from '../market/obligationStatus.js';
import { randomUUID } from '../util/uuid.js';

const DEFAULT_INTERVAL_MS = 60 * 1000;

// Lease TTL: 3 unrenewed cycles (spec: a shut-down payer must never
// block payment for long; with the 60s default this is a 3-minute
// takeover window, inside the spec's 15-minute bound for 5-min cycles).
const LEASE_CYCLES = 3;

const NOOP_LOGGER = { debug() {}, warn() {}, error() {} };

/** PendingTx statuses that mean "a payment may already be in flight". */
const ATTEMPTED_STATUSES = new Set([
    'signed', 'queued', 'broadcasting', 'broadcast', 'indexed',
]);

/**
 * Does a PendingTx row reference a COINPAY for this ORDER_MATCH?
 * Prefers the structured params snapshot; falls back to the two
 * summary wordings (manual CoinpayForm and this engine's).
 *
 * @param {import('../schemas/pendingTx.js').PendingTx} tx
 * @param {string} matchIndex
 * @returns {boolean}
 */
export function pendingTxReferencesMatch(tx, matchIndex) {
    if (!tx || tx.action !== 'COINPAY') return false;
    const idx = String(matchIndex);
    // The index reaches here straight from an API row; a non-numeric
    // value can never label a real payment and must not reach RegExp.
    if (!/^\d+$/.test(idx)) return false;
    const fromParams = tx.params && tx.params.ORDER_MATCH_ACTION_INDEX != null
        ? String(tx.params.ORDER_MATCH_ACTION_INDEX) === idx
        : false;
    if (fromParams) return true;
    const summary = typeof tx.actionSummary === 'string' ? tx.actionSummary : '';
    // Digit boundary after the index: "#900" must not match inside "#9001".
    const boundary = new RegExp(`(?:ORDER_MATCH|match) #${idx}(?!\\d)`);
    return boundary.test(summary);
}

export class CoinpayAutopayWatcher {
    /**
     * @param {Object} deps
     * @param {import('../storage/Vault.js').Vault} deps.vault
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} deps.sdkRegistry
     * @param {import('../registry/index.js').ChainRegistry} deps.chainRegistry
     * @param {(walletId: string) => (object | null)} deps.getSigner
     *   pre-unlocked SoftwareSigner lookup (SignerPool.get); null = cannot sign
     * @param {{ reserve: Function, release: Function }} [deps.reservationLedger]
     * the host-shared ledger; optional so tests / degraded shells run without it
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     * @param {'desktop' | 'extension' | 'web'} deps.shellKind
     * @param {number} [deps.intervalMs]
     * @param {() => number} [deps.now]
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     * @param {Function} [deps.coinpayAction]  injectable for tests
     */
    constructor({
        vault,
        sdkRegistry,
        chainRegistry,
        getSigner,
        reservationLedger,
        notify,
        shellKind,
        intervalMs,
        now,
        logger,
        coinpayAction,
    } = {}) {
        if (!vault) throw new Error('CoinpayAutopayWatcher: vault is required');
        if (!sdkRegistry) throw new Error('CoinpayAutopayWatcher: sdkRegistry is required');
        if (!chainRegistry) throw new Error('CoinpayAutopayWatcher: chainRegistry is required');
        if (typeof getSigner !== 'function') throw new Error('CoinpayAutopayWatcher: getSigner is required');
        if (typeof notify !== 'function') throw new Error('CoinpayAutopayWatcher: notify is required');
        if (!['desktop', 'extension', 'web'].includes(shellKind)) {
            throw new Error('CoinpayAutopayWatcher: shellKind must be desktop | extension | web');
        }

        this._vault = vault;
        this._sdkRegistry = sdkRegistry;
        this._chainRegistry = chainRegistry;
        this._getSigner = getSigner;
        this._ledger = reservationLedger || null;
        this._notify = notify;
        this._shellKind = shellKind;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._log = logger || NOOP_LOGGER;
        this._coinpayAction = coinpayAction || defaultCoinpayAction;

        this._instanceId = randomUUID();
        this._timer = null;
        this._ticking = false;
        this._unsubs = [];
        /** @type {Set<string>} matches this instance attempted (broadcast reached or unknown) */
        this._attempted = new Set();
        /** @type {Set<string>} notification dedupe keys (`${matchIndex}:${reason}`) */
        this._notified = new Set();
        /** @type {Map<string, { reservationId: string, chainId: string }>} matchIndex -> hold */
        this._holds = new Map();
        /** @type {{ payer: boolean, armed: number, unsignable: string[] } | null} */
        this._lastStatus = null;
    }

    /** Begin the cycle loop + WS triggers. Idempotent. */
    start() {
        if (this._timer) return this;
        this.pollOnce().catch((e) => this._log.error('CoinpayAutopayWatcher: initial cycle failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('CoinpayAutopayWatcher: cycle failed', e));
        }, this._intervalMs);
        if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
        return this;
    }

    /** Stop the loop, drop WS triggers, release nothing (holds stay until terminal). */
    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        for (const unsub of this._unsubs.splice(0)) {
            try { unsub(); } catch { /* best-effort */ }
        }
    }

    /** Re-subscribe WS triggers for the current armed addresses. */
    async refresh() {
        for (const unsub of this._unsubs.splice(0)) {
            try { unsub(); } catch { /* best-effort */ }
        }
        let consents;
        try {
            consents = await listAutopayOrders({ vault: this._vault });
        } catch {
            return;
        }
        const seen = new Set();
        for (const c of consents) {
            if (c.autopay !== true) continue;
            const key = `${c.chainId}:${c.sourceAddress}`;
            if (seen.has(key)) continue;
            seen.add(key);
            try {
                const sdk = this._sdkRegistry.get(c.chainId);
                if (typeof sdk?.onCoinpayRequired !== 'function') continue;
                // Event = poll trigger only; the policy's depth gate makes
                // paying on the event itself impossible.
                const unsub = sdk.onCoinpayRequired(c.sourceAddress, () => {
                    this.pollOnce().catch((e) => this._log.error('CoinpayAutopayWatcher: triggered cycle failed', e));
                });
                if (typeof unsub === 'function') this._unsubs.push(unsub);
            } catch (e) {
                this._log.warn('CoinpayAutopayWatcher: WS subscribe failed', e);
            }
        }
    }

    /** Latest cycle summary for UI status surfaces. */
    statusSnapshot() {
        return this._lastStatus;
    }

    /**
     * One engine cycle. Public so tests and shells drive it
     * deterministically.
     */
    async pollOnce() {
        if (this._ticking) return;
        this._ticking = true;
        try {
            await this._cycle();
        } finally {
            this._ticking = false;
        }
    }

    async _cycle() {
        let consents;
        try {
            consents = (await listAutopayOrders({ vault: this._vault }))
                .filter((c) => c.autopay === true);
        } catch (e) {
            this._log.error('CoinpayAutopayWatcher: consent read failed', e);
            return;
        }
        if (consents.length === 0) {
            this._lastStatus = { payer: false, armed: 0, unsignable: [] };
            return;
        }

        // Backfill order action indexes for newly indexed orders (needed
        // to link obligations to their consented order).
        try {
            await resolveOrderActionIndexes({ vault: this._vault, sdkRegistry: this._sdkRegistry });
            consents = (await listAutopayOrders({ vault: this._vault }))
                .filter((c) => c.autopay === true);
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: index backfill failed', e);
        }

        const isPayer = await this._acquireOrRenewLease();

        // Which armed wallets cannot sign right now (locked / HW /
        // keychain-only desktop unlock): surfaced to the re-arm UI.
        const unsignable = Array.from(new Set(
            consents.filter((c) => !this._getSigner(c.walletId)).map((c) => c.walletId),
        ));
        this._lastStatus = { payer: isPayer, armed: consents.length, unsignable };

        // Own-vault pending payments (defense in depth beside the lease).
        let pendingTxs = [];
        try {
            pendingTxs = await this._vault.pendingTxs.list();
        } catch { /* treated as none */ }

        const byChain = new Map();
        for (const c of consents) {
            if (!byChain.has(c.chainId)) byChain.set(c.chainId, []);
            byChain.get(c.chainId).push(c);
        }

        for (const [chainId, chainConsents] of byChain.entries()) {
            await this._cycleChain({ chainId, chainConsents, isPayer, pendingTxs });
        }

        await this._releaseTerminalHolds(pendingTxs);
    }

    /**
     * @returns {Promise<boolean>} whether this instance is the payer this cycle
     */
    async _acquireOrRenewLease() {
        try {
            const lease = await this._vault.autopayLeases.get(PAYER_LEASE_ID);
            const ttlMs = LEASE_CYCLES * this._intervalMs;
            const state = leaseState(lease, this._instanceId, this._now(), ttlMs);
            if (state === 'other-live') return false;
            // 'mine' or 'claimable': (re)write the lease. Last-write-wins
            // narrows a simultaneous claim to one cycle; the pendingTx scan
            // and coinpayAction's pending re-check cover that window.
            const next = createAutopayLease({
                holderId: this._instanceId,
                shellKind: this._shellKind,
            });
            await this._vault.autopayLeases.put(next);
            return true;
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: lease handling failed; staying notify-only', e);
            return false;
        }
    }

    async _cycleChain({ chainId, chainConsents, isPayer, pendingTxs }) {
        let tipHeight = null;
        try {
            const wm = await indexerWatermark({ sdkRegistry: this._sdkRegistry, chainId });
            tipHeight = wm?.watermark ?? null;
        } catch { /* depth gate will hold everything back */ }

        // Obligations per distinct source address (payer side only).
        const byAddress = new Map();
        for (const c of chainConsents) {
            if (!byAddress.has(c.sourceAddress)) byAddress.set(c.sourceAddress, []);
            byAddress.get(c.sourceAddress).push(c);
        }

        /** @type {Map<string, object[]>} block_index -> order_matches rows (memo per cycle) */
        const matchesByBlock = new Map();

        for (const [address, addrConsents] of byAddress.entries()) {
            let rows;
            try {
                const resp = await getCoinpayObligationsForAddress({
                    sdkRegistry: this._sdkRegistry, chainId, address,
                });
                rows = extractCoinpayRows(resp);
            } catch (e) {
                this._log.warn(`CoinpayAutopayWatcher: obligation read failed for ${chainId}`, e);
                continue;
            }
            for (const row of rows) {
                const payer = row.payer_address ?? row.payerAddress;
                if (payer !== address) continue;
                await this._handleObligation({
                    chainId, row, addrConsents, tipHeight, matchesByBlock, isPayer, pendingTxs,
                });
            }
        }
    }

    async _handleObligation({ chainId, row, addrConsents, tipHeight, matchesByBlock, isPayer, pendingTxs }) {
        const matchIndex = String(row.action_index ?? row.actionIndex ?? '');
        if (!matchIndex) return;

        // Any obligation leaving pending releases its hold in the
        // terminal sweep; skip early here for non-pending rows.
        const status = row.coinpay_status ?? row.coinpayStatus;
        if (status !== 'pending_coinpay') {
            this._terminalMatches = this._terminalMatches || new Set();
            this._terminalMatches.add(matchIndex);
            return;
        }

        // Fetch the match row from the obligation's block (memoized per
        // cycle; obligation and match share a block by construction).
        const blockIndex = Number(row.block_index ?? row.blockIndex);
        let matchRow = null;
        if (Number.isFinite(blockIndex) && blockIndex > 0) {
            if (!matchesByBlock.has(blockIndex)) {
                try {
                    const sdk = this._sdkRegistry.get(chainId);
                    const resp = await sdk.getOrderMatches(String(blockIndex), 'block');
                    matchesByBlock.set(blockIndex, extractCoinpayRows(resp));
                } catch {
                    matchesByBlock.set(blockIndex, null); // unavailable ≠ empty
                }
            }
            const blockRows = matchesByBlock.get(blockIndex);
            matchRow = Array.isArray(blockRows)
                ? blockRows.find((m) => String(m.action_index) === matchIndex) ?? null
                : null;
        }

        // Link to a consented order: the match row names the two order
        // indexes; one of them must be a consent record for this address.
        const consent = addrConsents.find((c) =>
            c.orderActionIndex != null && matchRow &&
            (String(matchRow.give_action_index) === String(c.orderActionIndex) ||
             String(matchRow.get_action_index) === String(c.orderActionIndex)));
        if (!consent) {
            // Without a match row we cannot attribute the obligation to a
            // consented order yet; if any consent still lacks its index or
            // the row is unavailable, wait rather than misclassify.
            return;
        }

        const alreadyAttempted = this._attempted.has(matchIndex) ||
            pendingTxs.some((tx) => ATTEMPTED_STATUSES.has(tx.status) &&
                pendingTxReferencesMatch(tx, matchIndex));

        const decision = evaluateObligation({
            obligation: row,
            consent,
            matchRow,
            tipHeight,
            nowSeconds: Math.floor(this._now() / 1000),
            alreadyAttempted,
        });

        if (!isPayer) return; // notify-only role: a live payer owns both payment and notification

        if (decision.action === 'notify-manual') {
            await this._notifyOnce(matchIndex, decision.reason, {
                kind: 'coinpay-autopay-manual',
                title: 'Payment needs attention',
                body: this._manualBody(decision.reason, row, consent),
                data: {
                    chainId,
                    orderMatchActionIndex: matchIndex,
                    reason: decision.reason,
                    urgency: 'high',
                },
            });
            return;
        }
        if (decision.action !== 'pay') return;

        if (alreadyAttempted) return; // paranoia: policy already gates on this

        const signer = this._getSigner(consent.walletId);
        if (!signer) {
            await this._notifyOnce(matchIndex, 'locked', {
                kind: 'coinpay-autopay-manual',
                title: 'Auto-pay is disarmed',
                body: 'A matched order needs payment but the wallet cannot sign right now. Unlock to arm auto-pay, or pay manually from Payments due.',
                data: { chainId, orderMatchActionIndex: matchIndex, reason: 'locked', urgency: 'high' },
            });
            return;
        }

        await this._pay({ chainId, row, consent, matchIndex, signer });
    }

    async _pay({ chainId, row, consent, matchIndex, signer }) {
        const payee = row.payee_address ?? row.payeeAddress;
        // The explorer serves this as the match's DECIMAL coin figure, so it is
        // converted ONCE here and every downstream use - the reservation hold,
        // the caps ledger, the payment itself and the notification copy - reads
        // base units. Taking the raw column threw `Cannot convert 0.5 to a
        // BigInt` out of the hold computation below, and because that runs
        // inside the poll cycle it killed the whole cycle: no obligation was
        // ever evaluated, so an armed order simply never paid and the only
        // trace was one console line a minute (measured on LTC regtest).
        const amountBaseValue = obligationBaseUnits(row.coin_amount ?? row.coinAmount);
        if (amountBaseValue === null || amountBaseValue <= 0n) {
            await this._notifyOnce(matchIndex, 'unusable-amount', {
                kind: 'coinpay-autopay-manual',
                title: 'Payment needs attention',
                body: 'A matched order needs payment but its amount could not be read. Pay manually from Payments due.',
                data: { chainId, orderMatchActionIndex: matchIndex, reason: 'unusable-amount', urgency: 'high' },
            });
            return;
        }
        const amountBase = amountBaseValue.toString();

        // Source ref: the consented order's address record (auto-pay
        // signs with that address's key only and never pulls coin from
        // siblings - funding comes from the source's own UTXOs).
        let sourceRecord = null;
        try {
            const all = await this._vault.addresses.list();
            sourceRecord = all.find((a) =>
                a.address === consent.sourceAddress &&
                this._chainRegistry.chainIdFor(a.chain, a.network) === chainId) ?? null;
        } catch { /* handled below */ }
        if (!sourceRecord) {
            await this._notifyOnce(matchIndex, 'source-missing', {
                kind: 'coinpay-autopay-manual',
                title: 'Payment needs attention',
                body: 'A matched order needs payment but its address is no longer in this wallet. Pay manually from Payments due.',
                data: { chainId, orderMatchActionIndex: matchIndex, reason: 'source-missing', urgency: 'high' },
            });
            return;
        }

        // Reservation hold: payee amount + estimated network fee, so a
        // user send cannot race the payment out of its funds.
        const holdId = `autopay:${chainId}:${matchIndex}`;
        const coinTicker = tickerFor(this._chainRegistry, chainId);
        const feeTiers = estimateNativeSendFeeTiers({ chainId, chainRegistry: this._chainRegistry });
        const feeSats = Number(feeTiers?.fast?.sats) || 0;
        const holdBase = BigInt(amountBase) + BigInt(Math.max(0, Math.trunc(feeSats)));
        if (this._ledger) {
            try {
                await this._ledger.reserve({
                    id: holdId,
                    chainId,
                    tick: coinTicker,
                    amount: baseUnitsToCoinText(holdBase.toString()) ?? holdBase.toString(),
                    // PC-34: tag the hold with the paying address so a SWEEP
                    // force-closing this address's orders can release it.
                    address: consent.sourceAddress,
                });
                this._holds.set(matchIndex, { reservationId: holdId, chainId });
            } catch (e) {
                this._log.warn('CoinpayAutopayWatcher: reservation failed (continuing)', e);
            }
        }

        // Prior art (FreeWallet autoBtcpay): pay at high-priority fee.
        const fastTier = feeTiers?.fast;
        const feePerKb = (fastTier && feeTiers.unit &&
            Number.isFinite(fastTier.rateValue) && fastTier.rateValue > 0)
            ? displayRateToSettingsCustom(feeTiers.unit, fastTier.rateValue)
            : undefined;

        // Mark attempted BEFORE signing so a crash mid-broadcast can
        // never double-pay from this instance.
        this._attempted.add(matchIndex);
        let phase = 'composing';
        try {
            const result = await this._coinpayAction({
                vault: this._vault,
                walletId: consent.walletId,
                signer,
                chainRegistry: this._chainRegistry,
                sdkRegistry: this._sdkRegistry,
                chainId,
                from: sourceRecord,
                orderMatchActionIndex: matchIndex,
                payeeAddress: payee,
                coinAmount: amountBase,
                ...(feePerKb !== undefined && { feePerKb }),
                actionSummary: `Auto-paid match #${matchIndex} for order #${consent.orderActionIndex}`,
                onProgress: (p) => { phase = p; },
            });
            const txid = result?.txid || result?.broadcast?.txid || '';
            try {
                await recordAutopayPayment({
                    vault: this._vault,
                    id: consent.id,
                    orderMatchActionIndex: matchIndex,
                    coinAmountBase: amountBase,
                    txid,
                });
            } catch (e) {
                // The payment happened; a ledger-write failure must be loud
                // (the cumulative cap would under-count) but not retried
                // into a duplicate payment.
                this._log.error('CoinpayAutopayWatcher: payment ledger write failed', e);
            }
            await this._notifyOnce(matchIndex, 'autopaid', {
                kind: 'coinpay-autopaid',
                title: 'Auto-paid a matched order',
                body: `Paid ${baseUnitsToCoinText(amountBase) ?? amountBase} ${coinTicker} for order #${consent.orderActionIndex}.`,
                data: { chainId, orderMatchActionIndex: matchIndex, txid },
            });
        } catch (e) {
            const broadcastReached = typeof phase === 'string' && phase.includes('broadcast');
            if (!broadcastReached) {
                // Nothing left the wallet: free the attempt for a retry on a
                // later cycle (the cutoffs bound how long we try) and drop
                // the hold.
                this._attempted.delete(matchIndex);
                await this._releaseHold(matchIndex);
            }
            const short = /insufficient|fund|utxo/i.test(String(e?.message));
            await this._notifyOnce(matchIndex, short ? 'balance-short' : 'pay-failed', {
                kind: 'coinpay-autopay-manual',
                title: short ? 'Match found, balance short' : 'Auto-pay attempt failed',
                body: short
                    ? `A matched order needs ${baseUnitsToCoinText(amountBase) ?? amountBase} ${coinTicker} but the order's address cannot cover it. Fund the address or pay manually from Payments due.`
                    : 'An automatic payment attempt failed. Check Payments due to pay manually before the deadline.',
                data: { chainId, orderMatchActionIndex: matchIndex, reason: short ? 'balance-short' : 'pay-failed', urgency: 'high' },
            });
            this._log.error('CoinpayAutopayWatcher: payment failed', e);
        }
    }

    /** Release holds whose obligation left pending or whose payment indexed. */
    async _releaseTerminalHolds(pendingTxs) {
        const terminal = this._terminalMatches || new Set();
        this._terminalMatches = new Set();
        for (const [matchIndex] of Array.from(this._holds.entries())) {
            const paidAndIndexed = pendingTxs.some((tx) =>
                tx.status === 'indexed' && pendingTxReferencesMatch(tx, matchIndex));
            if (terminal.has(matchIndex) || paidAndIndexed) {
                await this._releaseHold(matchIndex);
            }
        }
    }

    async _releaseHold(matchIndex) {
        const hold = this._holds.get(matchIndex);
        if (!hold) return;
        this._holds.delete(matchIndex);
        if (!this._ledger) return;
        try {
            await this._ledger.release(hold.reservationId);
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: hold release failed', e);
        }
    }

    /**
     * @param {string} reason
     * @param {object} row
     * @param {import('../schemas/autopayOrder.js').AutopayOrder} consent
     */
    _manualBody(reason, row, consent) {
        const amount = baseUnitsToCoinText(String(row.coin_amount ?? row.coinAmount ?? ''));
        const orderRef = consent.orderActionIndex ? `order #${consent.orderActionIndex}` : 'your order';
        switch (reason) {
            case 'past-arming-cutoff':
            case 'past-retry-cutoff':
                return `A match on ${orderRef} is close to its payment deadline and auto-pay has stood down. Pay${amount ? ` ${amount}` : ''} manually from Payments due now.`;
            case 'amounts-unavailable':
            case 'match-unavailable':
                return `A match on ${orderRef} could not be verified against the indexer. Review and pay manually from Payments due.`;
            default:
                return `A match on ${orderRef} needs a manual payment. Open Payments due to review it.`;
        }
    }

    async _notifyOnce(matchIndex, reason, payload) {
        const key = `${matchIndex}:${reason}`;
        if (this._notified.has(key)) return;
        this._notified.add(key);
        try {
            await this._notify(payload);
        } catch (e) {
            this._log.error('CoinpayAutopayWatcher: notify adapter threw', e);
        }
    }
}

/** Chain's native coin ticker for display + reservation rows. */
function tickerFor(chainRegistry, chainId) {
    try {
        const desc = chainRegistry.get(chainId);
        const coin = desc?.coin ?? String(chainId).split('-')[0];
        return String(coin).toUpperCase().slice(0, 12) || 'COIN';
    } catch {
        return String(chainId).split('-')[0].toUpperCase() || 'COIN';
    }
}
