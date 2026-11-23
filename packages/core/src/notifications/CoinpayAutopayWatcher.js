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
// Signing model. Unlocked, the engine signs with the pre-unlocked
// SoftwareSigner from the shell's SignerPool via the injected
// `getSigner` (a desktop keychain restore pools the primary wallet's
// signer too). Locked (Phase B, market/autopaySession.js), the shell
// runs a second instance on the locked session: `getPaySigner` hands
// out a ScopedPaySigner bound to the one payment, which signs nothing
// else. When no signer exists (HW/watch-only wallet, a wallet the
// session holds no key for, a session that has ended) the engine
// degrades to the high-urgency manual notification. A source address
// that cannot sign is different: its live Payment due row carries the
// action for as long as the obligation stays open. It never stores a password.
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
import { ATTEMPTED_STATUSES, pendingTxReferencesMatch } from '../market/coinpayPending.js';
import { readBlockOrderMatches } from '../market/obligationPaging.js';
import {
    extractCoinpayRows,
    getCoinpayObligationsForAddress,
} from '../flows/coinpayQueries.js';
import { estimateNativeSendFeeTiers, displayRateToSettingsCustom } from '../flows/feeEstimate.js';
import { baseUnitsToCoinText, isPendingObligation, obligationBaseUnits } from '../market/obligationStatus.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { randomUUID } from '../util/uuid.js';
import { taggedLogger } from './taggedLogger.js';
import { withAlertInbox } from './notificationInbox.js';
import { announceNotificationsChanged, getDefaultAlertInbox } from '../shared/alertInbox.js';
import { resolveAutopaySource } from './autopaySource.js';

// Two polls per 10-minute BTC block. The WS trigger below still runs a
// cycle as soon as a match is announced, and the 2-block depth gate means
// a faster poll would not pay any sooner (operator ruling 2026-11-20).
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFIED_CAP = 500;

// Lease TTL: 3 unrenewed cycles (spec: a shut-down payer must never
// block payment for long; with the 5-min default this is the spec's
// 15-minute takeover window, well before the 45-minute arming cutoff).
const LEASE_CYCLES = 3;

export { pendingTxReferencesMatch };

export class CoinpayAutopayWatcher {
    /**
     * @param {Object} deps
     * @param {import('../storage/Vault.js').Vault} deps.vault
     * @param {import('../sdk/SDKRegistry.js').SDKRegistry} deps.sdkRegistry
     * @param {import('../registry/index.js').ChainRegistry} deps.chainRegistry
     * @param {(walletId: string) => (object | null)} deps.getSigner
     *   pre-unlocked SoftwareSigner lookup (SignerPool.get); null = cannot sign
     * @param {() => Promise<import('../schemas/settings.js').Settings>} deps.getSettings
     *   read live settings before delivery so the incoming-receipts toggle
     *   gates every CoinPay status notification
     * @param {{ reserve: Function, release: Function }} [deps.reservationLedger]
     * the host-shared ledger; optional so tests / degraded shells run without it
     * @param {(n: { kind: string, title: string, body: string, data?: object }) => (void | Promise<void>)} deps.notify
     * @param {(alert: object) => (void | Promise<void>)} [deps.recordAlert]
     * @param {'desktop' | 'extension' | 'web'} deps.shellKind
     * @param {number} [deps.intervalMs]
     * @param {() => number} [deps.now]
     * @param {{ debug: Function, warn: Function, error: Function }} [deps.logger]
     * @param {Function} [deps.coinpayAction]  injectable for tests
     * @param {string} [deps.instanceId] stable shell identity when one process is the only payer
     * @param {() => Promise<string[] | Set<string>>} [deps.loadNotified]
     * @param {(keys: string[]) => (void | Promise<void>)} [deps.saveNotified]
     * @param {(payment: { walletId: string, consentId: string, chainId: string, payeeAddress: string, amountBase: string, matchIndex: string, deadlineSeconds: number }) => (object | null)} [deps.getPaySigner]
     *   locked auto pay: a signer bound to exactly this payment; null = cannot sign it
     * @param {(result: { ok: boolean, chainId: string, matchIndex: string, consentId: string, amountBase: string }) => void} [deps.onPaymentResult]
     * @param {(consents: object[]) => void} [deps.onCycle]   the autopay-on consent list read each cycle
     */
    constructor({
        vault,
        sdkRegistry,
        chainRegistry,
        getSigner,
        getSettings,
        reservationLedger,
        notify,
        recordAlert,
        shellKind,
        intervalMs,
        now,
        logger,
        coinpayAction,
        instanceId,
        loadNotified,
        saveNotified,
        getPaySigner,
        onPaymentResult,
        onCycle,
    } = {}) {
        if (!vault) throw new Error('CoinpayAutopayWatcher: vault is required');
        if (!sdkRegistry) throw new Error('CoinpayAutopayWatcher: sdkRegistry is required');
        if (!chainRegistry) throw new Error('CoinpayAutopayWatcher: chainRegistry is required');
        if (typeof getSigner !== 'function') throw new Error('CoinpayAutopayWatcher: getSigner is required');
        if (typeof getSettings !== 'function') throw new Error('CoinpayAutopayWatcher: getSettings is required');
        if (typeof notify !== 'function') throw new Error('CoinpayAutopayWatcher: notify is required');
        if (!['desktop', 'extension', 'web'].includes(shellKind)) {
            throw new Error('CoinpayAutopayWatcher: shellKind must be desktop | extension | web');
        }

        this._vault = vault;
        this._sdkRegistry = sdkRegistry;
        this._chainRegistry = chainRegistry;
        this._getSigner = getSigner;
        this._getSettings = getSettings;
        this._ledger = reservationLedger || null;
        this._recordAlert = typeof recordAlert === 'function'
            ? recordAlert
            : (alert) => getDefaultAlertInbox().record(alert);
        this._notify = withAlertInbox(notify, { recordAlert: this._recordAlert, now });
        this._shellKind = shellKind;
        this._intervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        this._now = typeof now === 'function' ? now : () => Date.now();
        this._log = taggedLogger(logger, 'coinpay');
        this._coinpayAction = coinpayAction || defaultCoinpayAction;

        this._instanceId = typeof instanceId === 'string' && instanceId ? instanceId : randomUUID();
        this._loadNotified = typeof loadNotified === 'function' ? loadNotified : null;
        this._saveNotified = typeof saveNotified === 'function' ? saveNotified : null;
        this._stopped = false;
        this._getPaySigner = typeof getPaySigner === 'function' ? getPaySigner : null;
        this._onPaymentResult = typeof onPaymentResult === 'function' ? onPaymentResult : null;
        this._onCycle = typeof onCycle === 'function' ? onCycle : null;
        /** @type {Promise<void> | null} */
        this._inflight = null;
        this._timer = null;
        this._ticking = false;
        this._unsubs = [];
        /** @type {Set<string>} matches this instance attempted (broadcast reached or unknown) */
        this._attempted = new Set();
        /** @type {Set<string>} notification dedupe keys (`${chainId}:${matchIndex}:${reason}`) */
        this._notified = new Set();
        this._notifiedLoaded = false;
        this._notifiedDirty = false;
        /** @type {Map<string, { reservationId: string, chainId: string }>} matchIndex -> hold */
        this._holds = new Map();
        /** @type {{ payer: boolean, armed: number, unsignable: string[] } | null} */
        this._lastStatus = null;
    }

    /** Begin the cycle loop + WS triggers. Idempotent. */
    start() {
        if (this._timer) return this;
        this._stopped = false;
        this.pollOnce().catch((e) => this._log.error('CoinpayAutopayWatcher: initial cycle failed', e));
        this._timer = setInterval(() => {
            this.pollOnce().catch((e) => this._log.error('CoinpayAutopayWatcher: cycle failed', e));
        }, this._intervalMs);
        if (this._timer && typeof this._timer.unref === 'function') this._timer.unref();
        return this;
    }

    /** Stop the loop, drop WS triggers, release nothing (holds stay until terminal). */
    stop() {
        // A cycle still in flight checks this after each await: a lock that
        // stops this instance hands payment to the locked session (or to
        // nobody), so this one must neither pay nor notify afterwards.
        this._stopped = true;
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
        const run = this._cycle();
        this._inflight = run.then(() => {}, () => {});
        try {
            await run;
        } finally {
            this._ticking = false;
            this._inflight = null;
        }
    }

    /** Resolves once no cycle is running (lock and unlock hand-overs wait on it). */
    whenIdle() {
        return this._inflight || Promise.resolve();
    }

    /** Payer-lease identity, so a hand-over keeps the lease instead of waiting it out. */
    get instanceId() {
        return this._instanceId;
    }

    /** Matches this instance attempted, for the next instance across a lock or unlock. */
    attemptedMatches() {
        return Array.from(this._attempted);
    }

    /** @param {Iterable<string>} matches  attempted set carried from the previous instance */
    seedAttempted(matches) {
        for (const m of matches || []) {
            if (typeof m === 'string' && m) this._attempted.add(m);
        }
    }

    async _cycle() {
        await this._restoreNotified();
        await this._restoreHolds();
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
            this._reportCycle(consents);
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
        this._reportCycle(consents);

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
        await this._persistNotified();
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

        // Read every address's obligations in one go, BEFORE handling any of
        // them: issued in the same tick, the reads land in one coalescing
        // window and reach the explorer as one batch request per chain instead
        // of one per address. A failed read yields null for that address and
        // is skipped below, as the sequential loop skipped it. Handling stays
        // sequential and in consent order on purpose: it reserves, signs and
        // holds, and shares the per-cycle match memo.
        const addresses = Array.from(byAddress.keys());
        const reads = await Promise.all(addresses.map((address) => getCoinpayObligationsForAddress({
            sdkRegistry: this._sdkRegistry, chainId, address,
        }).then((resp) => {
            this._logTruncatedRead(chainId, address, resp?.truncated === true);
            return extractCoinpayRows(resp);
        }, (e) => {
            this._log.warn(`CoinpayAutopayWatcher: obligation read failed for ${chainId}`, e);
            return null;
        })));

        for (const [i, address] of addresses.entries()) {
            const rows = reads[i];
            if (!rows) continue;
            const addrConsents = byAddress.get(address);
            for (const row of rows) {
                const payer = row.payer_address ?? row.payerAddress;
                if (payer !== address) continue;
                await this._handleObligation({
                    chainId, row, addrConsents, tipHeight, matchesByBlock, isPayer, pendingTxs,
                });
            }
        }
    }

    // A block read whole that lacks the match will not gain it by waiting, so
    // the cycle logs it once per match instead of repeating the silent return.
    _logMissingMatch(chainId, blockIndex, matchIndex) {
        this._missingMatches = this._missingMatches || new Set();
        const key = `${chainId}:${matchIndex}`;
        if (this._missingMatches.has(key)) return;
        this._missingMatches.add(key);
        this._log.warn(`CoinpayAutopayWatcher: match ${matchIndex} is not in block ${blockIndex} on ${chainId}`);
    }

    _logTruncatedRead(chainId, address, truncated) {
        this._truncatedReads = this._truncatedReads || new Set();
        const key = `${chainId}:${address}`;
        if (!truncated) {
            this._truncatedReads.delete(key);
            return;
        }
        if (this._truncatedReads.has(key)) return;
        this._truncatedReads.add(key);
        this._log.warn(`CoinpayAutopayWatcher: obligation read for ${chainId} was capped; older obligations on this address are not being watched`);
    }

    async _handleObligation({ chainId, row, addrConsents, tipHeight, matchesByBlock, isPayer, pendingTxs }) {
        const matchIndex = String(row.action_index ?? row.actionIndex ?? '');
        if (!matchIndex || this._stopped) return;

        // Any obligation leaving pending releases its hold in the
        // terminal sweep; skip early here for non-pending rows.
        if (!isPendingObligation(row)) {
            this._terminalMatches = this._terminalMatches || new Set();
            this._terminalMatches.add(matchIndex);
            for (const key of this._notified) {
                if (key.includes(`:${matchIndex}:`)) {
                    this._notified.delete(key);
                    this._notifiedDirty = true;
                }
            }
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
                    matchesByBlock.set(blockIndex, await readBlockOrderMatches(sdk, blockIndex));
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
            if (!matchRow && Array.isArray(matchesByBlock.get(blockIndex))) this._logMissingMatch(chainId, blockIndex, matchIndex);
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
                body: this._manualBody(decision.reason, row, consent, chainId),
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
            const payment = this._paymentText(row, chainId);
            await this._notifyOnce(matchIndex, 'locked', {
                kind: 'coinpay-autopay-manual',
                title: 'Auto pay is paused',
                body: `${payment ? `${payment} is due` : 'Payment is due'} for order #${consent.orderActionIndex}. Unlock to resume auto pay, or open Payments due.`,
                data: { chainId, orderMatchActionIndex: matchIndex, reason: 'locked', urgency: 'high' },
            });
            return;
        }

        await this._pay({ chainId, row, consent, matchIndex, signer });
    }

    async _pay({ chainId, row, consent, matchIndex, signer }) {
        const payee = row.payee_address ?? row.payeeAddress;
        // The explorer serves this as the match's DECIMAL coin figure ("10" is
        // ten coins), so it is converted ONCE here and every downstream use -
        // the reservation hold, the caps ledger, the payment itself and the
        // notification copy - reads base units. Taking the raw column into
        // BigInt threw out of the hold computation and killed the whole poll
        // cycle, so an armed order never paid.
        const amountBaseValue = obligationBaseUnits(row.coin_amount ?? row.coinAmount);
        if (amountBaseValue === null || amountBaseValue <= 0n) {
            await this._notifyOnce(matchIndex, 'unusable-amount', {
                kind: 'coinpay-autopay-manual',
                title: 'Payment needs attention',
                body: `The amount due for order #${consent.orderActionIndex} could not be read. Open Payments due to review it.`,
                data: { chainId, orderMatchActionIndex: matchIndex, reason: 'unusable-amount', urgency: 'high' },
            });
            return;
        }
        const amountBase = amountBaseValue.toString();

        // Source ref: the consented order's address record, owned by the
        // consent's wallet and signable by a software key (auto-pay signs
        // with that address's key only and never pulls coin from siblings -
        // funding comes from the source's own UTXOs).
        const resolved = await resolveAutopaySource({
            vault: this._vault, chainRegistry: this._chainRegistry, consent, chainId,
        });
        const sourceRecord = resolved.record;
        if (!sourceRecord) {
            await this._recordPayDueAttention(chainId, matchIndex, resolved.reason);
            return;
        }

        // Locked auto pay: a signer bound to exactly this payment (payee,
        // amount, match, deadline), or none, in which case nothing signs.
        let paySigner = signer;
        if (this._getPaySigner) {
            paySigner = this._getPaySigner({
                walletId: consent.walletId,
                consentId: consent.id,
                chainId,
                payeeAddress: payee,
                amountBase,
                matchIndex,
                deadlineSeconds: Number(row.expiration),
            });
            if (!paySigner) {
                const payment = this._paymentText(row, chainId);
                await this._notifyOnce(matchIndex, 'locked', {
                    kind: 'coinpay-autopay-manual',
                    title: 'Auto pay is paused',
                    body: `${payment ? `${payment} is due` : 'Payment is due'} for order #${consent.orderActionIndex}. Unlock to resume auto pay, or open Payments due.`,
                    data: { chainId, orderMatchActionIndex: matchIndex, reason: 'locked', urgency: 'high' },
                });
                return;
            }
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

        if (this._stopped) {
            await this._releaseHold(matchIndex);
            return;
        }
        // Mark attempted BEFORE signing so a crash mid-broadcast can
        // never double-pay from this instance.
        this._attempted.add(matchIndex);
        let phase = 'composing';
        try {
            const result = await this._coinpayAction({
                vault: this._vault,
                walletId: consent.walletId,
                signer: paySigner,
                // The locked lane builds with no rotated change address; a
                // due automatic donation rides it like any other send.
                ...(paySigner?.kind === 'scoped-pay' && { scopedPayment: true }),
                chainRegistry: this._chainRegistry,
                sdkRegistry: this._sdkRegistry,
                chainId,
                from: sourceRecord,
                orderMatchActionIndex: matchIndex,
                payeeAddress: payee,
                coinAmount: amountBase,
                ...(feePerKb !== undefined && { feePerKb }),
                actionSummary: `Auto paid match #${matchIndex} for order #${consent.orderActionIndex}`,
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
            this._reportPayment({ ok: true, chainId, matchIndex, consentId: consent.id, amountBase });
            await this._notifyOnce(matchIndex, 'autopaid', {
                kind: 'coinpay-autopaid',
                title: 'Auto pay complete',
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
            this._reportPayment({ ok: false, chainId, matchIndex, consentId: consent.id, amountBase });
            const short = /insufficient|fund|utxo/i.test(String(e?.message));
            const failureReason = (String(e?.message || '').trim()
                || 'The wallet service returned no explanation').replace(/[.!?]+$/, '');
            await this._notifyOnce(matchIndex, short ? 'balance-short' : 'pay-failed', {
                kind: 'coinpay-autopay-manual',
                title: short ? `Not enough ${coinTicker} for auto pay` : 'Auto pay failed',
                body: short
                    ? `Order #${consent.orderActionIndex} needs ${baseUnitsToCoinText(amountBase) ?? amountBase} ${coinTicker}. Fund its address or open Payments due.`
                    : `Could not pay ${baseUnitsToCoinText(amountBase) ?? amountBase} ${coinTicker} for order #${consent.orderActionIndex}: ${failureReason}. Open Payments due before the deadline.`,
                data: { chainId, orderMatchActionIndex: matchIndex, reason: short ? 'balance-short' : 'pay-failed', urgency: 'high' },
            });
            this._log.error('CoinpayAutopayWatcher: payment failed', e);
        }
    }

    _reportPayment(result) {
        if (!this._onPaymentResult) return;
        try { this._onPaymentResult(result); } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: payment result hook threw', e);
        }
    }

    _reportCycle(consents) {
        if (!this._onCycle) return;
        try { this._onCycle(consents); } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: cycle hook threw', e);
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

    async _restoreHolds() {
        if (!this._ledger || typeof this._ledger.all !== 'function') return;
        let entries;
        try {
            entries = await this._ledger.all();
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: hold restore failed', e);
            return;
        }
        for (const entry of entries || []) {
            if (!entry || typeof entry.id !== 'string' || typeof entry.chainId !== 'string') continue;
            const prefix = `autopay:${entry.chainId}:`;
            if (!entry.id.startsWith(prefix)) continue;
            const matchIndex = entry.id.slice(prefix.length);
            if (matchIndex) {
                this._holds.set(matchIndex, { reservationId: entry.id, chainId: entry.chainId });
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
     * @param {string} chainId
     */
    _manualBody(reason, row, consent, chainId) {
        const payment = this._paymentText(row, chainId);
        const orderRef = consent.orderActionIndex ? `order #${consent.orderActionIndex}` : 'your order';
        switch (reason) {
            case 'past-arming-cutoff':
            case 'past-retry-cutoff':
                return `${payment ? `Pay ${payment}` : 'Payment is due'} for ${orderRef} before the deadline. Auto pay is off; open Payments due.`;
            case 'amounts-unavailable':
            case 'match-unavailable':
                return `Payment for ${orderRef} could not be verified. Open Payments due to review it.`;
            default:
                return `${payment ? `${payment} is due` : 'A manual payment is due'} for ${orderRef}. Open Payments due to review it.`;
        }
    }

    _paymentText(row, chainId) {
        const baseUnits = obligationBaseUnits(row.coin_amount ?? row.coinAmount);
        const amount = baseUnits === null ? null : baseUnitsToCoinText(baseUnits.toString());
        return amount ? `${amount} ${tickerFor(this._chainRegistry, chainId)}` : null;
    }

    async _recordPayDueAttention(chainId, matchIndex, reason) {
        const key = `${chainId}:${matchIndex}:${reason}`;
        if (this._notified.has(key)) return;
        try {
            await this._recordAlert({
                id: `payment-due:${chainId}:${matchIndex}`,
                type: 'payments',
                title: 'Payment due',
                message: '',
                at: this._now(),
                read: false,
                attention: 'autopay-cannot-sign',
            });
            announceNotificationsChanged({ refreshCoinpayObligations: true });
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: payment-due attention write failed', e);
            return;
        }
        this._notified.add(key);
        this._notifiedDirty = true;
        await this._persistNotified();
    }

    async _notifyOnce(matchIndex, reason, payload) {
        const chainId = typeof payload?.data?.chainId === 'string' ? payload.data.chainId : '';
        const key = `${chainId}:${matchIndex}:${reason}`;
        if (this._notified.has(key)) return;
        // The payment itself still reports; anything else after a stop is
        // stale (a lock in between means the locked session speaks now).
        if (this._stopped && reason !== 'autopaid') return;
        let settings;
        try {
            settings = await this._getSettings();
        } catch (e) {
            this._log.error('CoinpayAutopayWatcher: getSettings failed', e);
            return;
        }
        if (settings?.notifications?.incomingReceipts !== true) return;
        try {
            const delivered = await this._notify(payload);
            if (delivered === false) {
                this._notified.add(key);
                return;
            }
        } catch (e) {
            this._log.error('CoinpayAutopayWatcher: notify adapter threw', e);
            this._notified.add(key);
            return;
        }
        this._notified.add(key);
        this._notifiedDirty = true;
        await this._persistNotified();
    }

    async _restoreNotified() {
        if (this._notifiedLoaded) return;
        this._notifiedLoaded = true;
        if (!this._loadNotified) return;
        try {
            const stored = await this._loadNotified();
            for (const key of stored instanceof Set ? stored : (Array.isArray(stored) ? stored : [])) {
                if (typeof key === 'string' && key) this._notified.add(key);
            }
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: loadNotified failed', e);
        }
    }

    async _persistNotified() {
        if (!this._notifiedDirty || !this._saveNotified) return;
        while (this._notified.size > NOTIFIED_CAP) {
            this._notified.delete(this._notified.values().next().value);
        }
        try {
            await this._saveNotified(Array.from(this._notified));
            this._notifiedDirty = false;
        } catch (e) {
            this._log.warn('CoinpayAutopayWatcher: saveNotified failed', e);
        }
    }
}

/** Chain's native coin ticker for display + reservation rows. */
function tickerFor(chainRegistry, chainId) {
    try {
        const desc = chainRegistry.get(chainId);
        const coin = desc?.coin ?? String(chainId).split('-')[0];
        return tickerForCoin(coin).slice(0, 12) || 'COIN';
    } catch {
        return tickerForCoin(String(chainId).split('-')[0]).slice(0, 12) || 'COIN';
    }
}
