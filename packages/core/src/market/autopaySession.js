// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Locked auto pay (PC-16 Phase B, operator ruling 2026-11-13). Auto pay
// keeps paying armed orders after the wallet locks, with no time limit,
// until the person unlocks or stops it; manual signing stays blocked the
// whole time.
//
// AutopaySession is what survives the lock. It is built at lock time, just
// before the signer pool is zeroed, and only when at least one armed order
// still has GIVE left to pay. It holds:
//   - one sealed private key per armed source address, sealed under a
//     non-extractable AES-GCM key that exists only in this process's memory
//     and unsealed for one signature at a time;
//   - the armed-order table (remaining GIVE, price terms, fee-rate ceiling);
//   - the open Vault, privately, so the watcher's encrypted writes and its
//     double-pay guards (pendingTxs, the payment ledger, the payer lease)
//     keep working.
// Nothing here is persisted: no sessionStorage, localStorage,
// chrome.storage, keychain or disk. Shells reach it only through the
// LockedAutopay controller below, which hands out plain status data and a
// stop call, never the session, the vault or a signer.
//
// The session ends (keys zeroed, vault closed) on unlock, on Stop, when no
// order has auto pay switched on any more, on any ScopedPaySigner refusal,
// after three failed payments in a row, and on whatever shell event the
// shell maps to end(): quit, tab close, worker end, wipe, panic. It does not
// end when the armed-order table empties: auto pay stays on, and orders
// placed later are armed by unlocking.

import { listAutopayOrders } from '../flows/autopayConsent.js';
import { getSettings as readSettings } from '../flows/settings.js';
import { estimateNativeSendFeeTiers } from '../flows/feeEstimate.js';
import { remainingGiveBase } from './autopayPolicy.js';
import { baseUnitsToCoinText } from './obligationStatus.js';
import { tickerForCoin } from '../registry/coinTicker.js';
import { ScopedPaySigner } from '../signers/ScopedPaySigner.js';
import { CoinpayAutopayWatcher } from '../notifications/CoinpayAutopayWatcher.js';
import { randomUUID } from '../util/uuid.js';
import { isSigningFrozen, subscribePanicModeState } from '../flows/panicMode.js';
import { withAlertInbox } from '../notifications/notificationInbox.js';

/** Consecutive failed payments that end locked auto pay. */
export const LOCKED_AUTOPAY_MAX_FAILURES = 3;

// The fee-rate ceiling is the chain's fast tier times this. The watcher pays
// at the fast tier, so a real payment sits well under it.
const FEE_RATE_HEADROOM = 4;

// Ends the session reaches on its own, which the person has to be told about.
const SELF_ENDED_REASONS = new Set(['signer-refused', 'payment-failures']);

// How long end() waits for the watcher's last cycle before closing the vault.
const END_WAIT_MS = 2_000;

function waitAtMost(promise, ms) {
    if (!promise || typeof promise.then !== 'function') return Promise.resolve();
    let timer = null;
    const cap = new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
        if (timer && typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([promise, cap]).finally(() => clearTimeout(timer));
}

/** Why a locked auto pay session ended. */
export const LOCKED_AUTOPAY_END_REASONS = Object.freeze([
    'unlock', 'stopped', 'autopay-off', 'signer-refused', 'payment-failures',
    'quit', 'page-closed', 'worker-ended', 'sign-out', 'wallet-wipe',
    'password-change', 'wallet-switch', 'panic',
]);

function subtleOf(cryptoImpl) {
    const subtle = cryptoImpl?.subtle;
    if (!subtle || typeof subtle.generateKey !== 'function') {
        throw new Error('autopaySession: WebCrypto subtle is unavailable');
    }
    return subtle;
}

function chainTicker(chainRegistry, chainId) {
    try {
        const coin = chainRegistry.get(chainId)?.coin ?? String(chainId).split('-')[0];
        return tickerForCoin(coin).slice(0, 12) || 'COIN';
    } catch {
        return tickerForCoin(String(chainId).split('-')[0]).slice(0, 12) || 'COIN';
    }
}

function feeRateCeiling(chainRegistry, chainId) {
    const fast = estimateNativeSendFeeTiers({ chainId, chainRegistry })?.fast;
    const sats = Number(fast?.sats);
    const vsize = Number(fast?.vsize);
    if (!Number.isFinite(sats) || sats <= 0 || !Number.isFinite(vsize) || vsize <= 0) return null;
    return Math.ceil(sats / vsize) * FEE_RATE_HEADROOM;
}

function keyRefOf(walletId, chainId, sourceAddress) {
    return `${walletId}\u0000${chainId}\u0000${sourceAddress}`;
}

export class AutopaySession {
    #vault;
    #subtle;
    #cryptoImpl;
    #runtimeKey;
    /** @type {Map<string, { iv: Uint8Array, sealed: Uint8Array }>} */
    #keys = new Map();
    /** @type {Map<string, { consentId: string, walletId: string, chainId: string, sourceAddress: string, orderActionIndex: string | null, remainingBase: bigint, giveCoinAmount: string, getTick: string, getAmount: string }>} */
    #orders = new Map();
    /** @type {Map<string, number>} chainId -> fee-rate ceiling, base units per byte */
    #feeRates = new Map();
    /** @type {Set<string>} `${chainId}:${matchIndex}` paid before or during the session */
    #paid = new Set();
    #failures = 0;
    #ended = false;
    #endReason = null;
    #watcher = null;
    #chainRegistry;
    #sdkRegistry;
    #now;
    #onEnd;

    /** Use AutopaySession.capture; the constructor holds no secrets yet. */
    constructor({ vault, chainRegistry, sdkRegistry, cryptoImpl, now, onEnd }) {
        this.#vault = vault;
        this.#chainRegistry = chainRegistry;
        this.#sdkRegistry = sdkRegistry;
        this.#cryptoImpl = cryptoImpl;
        this.#subtle = subtleOf(cryptoImpl);
        this.#now = typeof now === 'function' ? now : () => Date.now();
        this.#onEnd = typeof onEnd === 'function' ? onEnd : () => {};
    }

    /**
     * Build a session from an unlocked wallet, or return null when there is
     * nothing to keep paying (no armed order with GIVE left, or no software
     * key for any armed source). Must run while the signer pool still holds
     * its keys.
     *
     * @param {Object} opts
     * @param {import('../storage/Vault.js').Vault} opts.vault
     * @param {{ get: (walletId: string) => any }} opts.signerPool
     * @param {any} opts.chainRegistry
     * @param {any} opts.sdkRegistry
     * @param {Crypto} [opts.cryptoImpl]
     * @param {() => number} [opts.now]
     * @param {(reason: string, session: AutopaySession) => void} [opts.onEnd]
     * @returns {Promise<AutopaySession | null>}
     */
    static async capture({ vault, signerPool, chainRegistry, sdkRegistry, cryptoImpl = globalThis.crypto, now, onEnd }) {
        if (!vault || !signerPool || typeof signerPool.get !== 'function') return null;
        const consents = (await listAutopayOrders({ vault })).filter((c) => c.autopay === true);
        const armed = consents.filter((c) => {
            const left = remainingGiveBase(c);
            return left !== null && left > 0n;
        });
        if (armed.length === 0) return null;

        const session = new AutopaySession({ vault, chainRegistry, sdkRegistry, cryptoImpl, now, onEnd });
        await session.#seal(armed, signerPool, await vault.addresses.list());
        if (session.#keys.size === 0) {
            session.#zero();
            return null;
        }
        for (const c of consents) {
            for (const p of c.payments ?? []) {
                if (p?.orderMatchActionIndex) session.#paid.add(`${c.chainId}:${p.orderMatchActionIndex}`);
            }
        }
        return session;
    }

    async #seal(armed, signerPool, addresses) {
        this.#runtimeKey = await this.#subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
        );
        const encoder = new TextEncoder();
        for (const c of armed) {
            const ref = keyRefOf(c.walletId, c.chainId, c.sourceAddress);
            if (!this.#keys.has(ref)) {
                const signer = signerPool.get(c.walletId);
                if (!signer || signer.kind !== 'software') continue;
                const record = (addresses || []).find((a) => a.address === c.sourceAddress
                    && safeChainId(this.#chainRegistry, a) === c.chainId);
                if (!record || record.source === 'watch-only') continue;
                let bytes = null;
                try {
                    const wif = typeof record.derivationPath === 'string' && record.derivationPath.length > 0
                        ? signer.exportWifForPath({ chainId: c.chainId, path: record.derivationPath })
                        : signer.exportWifForAddressId(record.id);
                    bytes = encoder.encode(wif);
                    const iv = this.#cryptoImpl.getRandomValues(new Uint8Array(12));
                    const sealed = new Uint8Array(await this.#subtle.encrypt(
                        { name: 'AES-GCM', iv }, this.#runtimeKey, bytes,
                    ));
                    this.#keys.set(ref, { iv, sealed });
                } catch {
                    continue; // a key we cannot seal is an order we do not pay while locked
                } finally {
                    if (bytes) bytes.fill(0);
                }
            }
            if (!this.#feeRates.has(c.chainId)) {
                const rate = feeRateCeiling(this.#chainRegistry, c.chainId);
                if (rate !== null) this.#feeRates.set(c.chainId, rate);
            }
            this.#orders.set(c.id, {
                consentId: c.id,
                walletId: c.walletId,
                chainId: c.chainId,
                sourceAddress: c.sourceAddress,
                orderActionIndex: c.orderActionIndex ?? null,
                remainingBase: remainingGiveBase(c) ?? 0n,
                giveCoinAmount: c.giveCoinAmount,
                getTick: c.getTick,
                getAmount: c.getAmount,
            });
        }
        // An order whose key could not be sealed is not armed here.
        for (const [id, o] of this.#orders) {
            if (!this.#keys.has(keyRefOf(o.walletId, o.chainId, o.sourceAddress))) this.#orders.delete(id);
        }
    }

    get ended() { return this.#ended; }

    get endReason() { return this.#endReason; }

    /** Plain status for the Locked screen: counts and per-chain caps only. */
    status() {
        if (this.#ended) return { active: false };
        /** @type {Map<string, bigint>} */
        const caps = new Map();
        let orders = 0;
        for (const o of this.#orders.values()) {
            if (o.remainingBase <= 0n) continue;
            orders += 1;
            caps.set(o.chainId, (caps.get(o.chainId) ?? 0n) + o.remainingBase);
        }
        return {
            active: true,
            orders,
            caps: Array.from(caps.entries()).map(([chainId, base]) => ({
                chainId,
                ticker: chainTicker(this.#chainRegistry, chainId),
                amount: baseUnitsToCoinText(base.toString()) ?? base.toString(),
            })),
        };
    }

    /** Whether the session can sign for this wallet at all (watcher presence check). */
    hasSignerFor(walletId) {
        if (this.#ended) return false;
        for (const o of this.#orders.values()) if (o.walletId === walletId) return true;
        return false;
    }

    /**
     * A ScopedPaySigner bound to one payment, or null when the session holds
     * no key for that order's source.
     *
     * @param {{ walletId: string, consentId: string, chainId: string, payeeAddress: string, amountBase: string, matchIndex: string, deadlineSeconds: number }} payment
     */
    signerForPayment(payment) {
        if (this.#ended || !payment) return null;
        const order = this.#orders.get(payment.consentId);
        if (!order || order.walletId !== payment.walletId || order.chainId !== payment.chainId) return null;
        if (!this.#keys.has(keyRefOf(order.walletId, order.chainId, order.sourceAddress))) return null;
        const rate = this.#feeRates.get(order.chainId);
        if (!Number.isFinite(rate)) return null;
        let amount;
        try { amount = BigInt(payment.amountBase); } catch { return null; }
        if (amount <= 0n || amount > order.remainingBase) return null;
        return new ScopedPaySigner({
            binding: {
                walletId: order.walletId,
                chainId: order.chainId,
                sourceAddress: order.sourceAddress,
                payeeAddress: String(payment.payeeAddress),
                amountBase: amount.toString(),
                matchIndex: String(payment.matchIndex),
                deadlineSeconds: Number(payment.deadlineSeconds),
                feeRatePerByteCeiling: rate,
            },
            sdkRegistry: this.#sdkRegistry,
            now: this.#now,
            isPaid: (chainId, matchIndex) => this.#paid.has(`${chainId}:${matchIndex}`),
            onRefusal: () => { void this.end('signer-refused'); },
            signWithSealedKey: (args) => this.#signWithSealedKey(args),
        });
    }

    async #signWithSealedKey({ binding, psbtHex, inputIndices }) {
        if (this.#ended) throw new Error('Locked auto pay has ended.');
        const entry = this.#keys.get(keyRefOf(binding.walletId, binding.chainId, binding.sourceAddress));
        if (!entry) throw new Error('Locked auto pay holds no key for this address.');
        let bytes = null;
        try {
            bytes = new Uint8Array(await this.#subtle.decrypt(
                { name: 'AES-GCM', iv: entry.iv }, this.#runtimeKey, entry.sealed,
            ));
            // The SDK signs from a WIF string; a JS string cannot be zeroed,
            // so it is created here and dropped at once (§17.7.3 caveat).
            const sdk = this.#sdkRegistry.get(binding.chainId);
            const { txHex, txid, psbtHex: signedPsbtHex } = sdk.wallet.signPsbt(
                psbtHex, new TextDecoder().decode(bytes), { inputIndices },
            );
            return { signedPsbtHex, txHex, txid };
        } finally {
            if (bytes) bytes.fill(0);
        }
    }

    /**
     * Watcher report after each payment attempt.
     *
     * @param {{ ok: boolean, chainId: string, matchIndex: string, consentId?: string, amountBase?: string, refused?: boolean }} result
     */
    notePaymentResult(result) {
        if (this.#ended || !result) return;
        if (result.ok) {
            this.#failures = 0;
            this.#paid.add(`${result.chainId}:${result.matchIndex}`);
            const order = result.consentId ? this.#orders.get(result.consentId) : null;
            if (order && typeof result.amountBase === 'string' && /^\d+$/.test(result.amountBase)) {
                const left = order.remainingBase - BigInt(result.amountBase);
                order.remainingBase = left > 0n ? left : 0n;
            }
            return;
        }
        this.#failures += 1;
        if (this.#failures >= LOCKED_AUTOPAY_MAX_FAILURES) void this.end('payment-failures');
    }

    /**
     * Watcher report of the consent list it read this cycle. No order with
     * auto pay switched on means auto pay is off, which ends the session; an
     * empty armed table on its own does not.
     *
     * @param {Array<{ id: string, autopay: boolean, payments?: any[], giveCoinAmount: string }>} consents  autopay === true records
     */
    noteCycle(consents) {
        if (this.#ended) return;
        if (!Array.isArray(consents) || consents.length === 0) {
            void this.end('autopay-off');
            return;
        }
        const live = new Set(consents.map((c) => c.id));
        for (const [id, order] of this.#orders) {
            if (!live.has(id)) { this.#orders.delete(id); continue; }
            const record = consents.find((c) => c.id === id);
            const left = record ? remainingGiveBase(record) : null;
            if (left !== null && left < order.remainingBase) order.remainingBase = left;
            if (record?.orderActionIndex != null) order.orderActionIndex = String(record.orderActionIndex);
        }
    }

    /**
     * Start the watcher on this session. Only this class ever hands the
     * private vault to anything.
     *
     * @param {Object} deps   shell deps forwarded to CoinpayAutopayWatcher (notify, shellKind, ledger, ...)
     */
    startWatcher(deps) {
        if (this.#ended || this.#watcher) return this.#watcher;
        const vault = this.#vault;
        const watcher = new CoinpayAutopayWatcher({
            ...deps,
            vault,
            sdkRegistry: this.#sdkRegistry,
            chainRegistry: this.#chainRegistry,
            getSigner: (walletId) => (this.hasSignerFor(walletId) ? { kind: 'scoped-pay' } : null),
            getPaySigner: (payment) => this.signerForPayment(payment),
            getSettings: () => readSettings(vault),
            onPaymentResult: (result) => this.notePaymentResult(result),
            onCycle: (consents) => this.noteCycle(consents),
            now: this.#now,
        });
        if (Array.isArray(deps?.attempted)) watcher.seedAttempted?.(deps.attempted);
        this.#watcher = watcher;
        watcher.start();
        watcher.refresh().catch(() => { /* WS triggers are best-effort */ });
        return watcher;
    }

    holdsVault(vault) {
        return !this.#ended && vault != null && vault === this.#vault;
    }

    #zero() {
        for (const entry of this.#keys.values()) {
            entry.sealed.fill(0);
            entry.iv.fill(0);
        }
        this.#keys.clear();
        this.#orders.clear();
        this.#runtimeKey = null;
    }

    /**
     * End the session: stop the watcher, wait out its cycle, zero every
     * sealed key, drop the runtime key and close the vault. Idempotent.
     *
     * @param {string} reason   one of LOCKED_AUTOPAY_END_REASONS
     * @returns {Promise<{ attempted: string[] }>}
     */
    async end(reason) {
        if (this.#ended) return { attempted: [] };
        this.#ended = true;
        this.#endReason = reason;
        const watcher = this.#watcher;
        this.#watcher = null;
        let attempted = [];
        // Keys go first: nothing can sign from here on, even mid-cycle.
        this.#zero();
        if (watcher) {
            try { watcher.stop(); } catch { /* best-effort */ }
            // Bounded: the keys are already gone, so a cycle stuck on the
            // network can only delay the vault close, and only this long.
            try { await waitAtMost(watcher.whenIdle?.(), END_WAIT_MS); } catch { /* best-effort */ }
            try { attempted = watcher.attemptedMatches?.() ?? []; } catch { attempted = []; }
        }
        const vault = this.#vault;
        this.#vault = null;
        if (vault) {
            try { vault.close(); } catch { /* already closed */ }
        }
        try { this.#onEnd(reason, this); } catch { /* the session is over regardless */ }
        return { attempted };
    }
}

function safeChainId(chainRegistry, address) {
    try { return chainRegistry.chainIdFor(address.chain, address.network); } catch { return null; }
}

/**
 * Per-shell controller. A shell keeps one of these for its lifetime and
 * calls lock() just before it zeroes the signer pool, end() on every event
 * that must stop locked auto pay, and takeHandoff() when it builds the
 * unlocked watcher, so the payer lease and the attempted set carry over in
 * both directions.
 *
 * @param {Object} opts
 * @param {'desktop' | 'extension' | 'web'} opts.shellKind
 * @param {string} [opts.instanceId]   stable payer-lease identity shared with the unlocked watcher
 * @param {(n: object) => any} opts.notify
 * @param {Function} [opts.recordAlert]
 * @param {() => Promise<string[]>} [opts.loadNotified]
 * @param {(keys: string[]) => any} [opts.saveNotified]
 * @param {any} [opts.logger]
 * @param {(session: { status: () => object }) => void} [opts.onStarted]
 * @param {(reason: string) => void} [opts.onEnded]
 * @param {Crypto} [opts.cryptoImpl]
 * @param {() => number} [opts.now]
 * @param {number} [opts.intervalMs]
 * @param {Function} [opts.coinpayAction]   injectable for tests
 */
export function createLockedAutopay({
    shellKind, instanceId, notify, recordAlert, loadNotified, saveNotified, logger,
    onStarted, onEnded, cryptoImpl, now, intervalMs, coinpayAction,
} = {}) {
    const id = typeof instanceId === 'string' && instanceId ? instanceId : randomUUID();
    /** @type {AutopaySession | null} */
    let session = null;
    /** @type {{ attempted: string[] } | null} */
    let handoff = null;
    /** @type {Promise<boolean> | null} */
    let capturing = null;
    /** @type {(() => void) | null} */
    let unsubscribePanic = null;

    // Panic mode stops locked auto pay in whichever context holds it: every
    // shell applies the freeze to this context's own panicMode state.
    function frozen() {
        try { return isSigningFrozen(); } catch { return false; }
    }
    function watchPanic() {
        if (unsubscribePanic) return;
        try {
            unsubscribePanic = subscribePanicModeState(() => {
                if (session && !session.ended && frozen()) void session.end('panic');
            });
        } catch { unsubscribePanic = null; }
    }
    function unwatchPanic() {
        const unsub = unsubscribePanic;
        unsubscribePanic = null;
        try { unsub?.(); } catch { /* best-effort */ }
    }
    const notifyStopped = typeof notify === 'function' ? withAlertInbox(notify, { recordAlert, now }) : null;
    async function announceStopped(reason) {
        if (!notifyStopped) return;
        try {
            await notifyStopped({
                kind: 'coinpay-autopay-manual',
                title: 'Auto pay stopped',
                body: 'Unlock to resume auto pay, or open Payments due.',
                data: { reason, urgency: 'high' },
            });
        } catch (err) {
            logger?.warn?.('[xchain] auto pay stop notice failed', err);
        }
    }

    async function doLock({ vault, signerPool, chainRegistry, sdkRegistry, reservationLedger, watcher }) {
        if (session && !session.ended) return false;
        if (frozen()) return false;
        let built = null;
        try {
            built = await AutopaySession.capture({
                vault, signerPool, chainRegistry, sdkRegistry, cryptoImpl, now,
                onEnd: (reason, ended) => {
                    if (session === ended) session = null;
                    unwatchPanic();
                    // A session that stopped itself says so: the watcher is
                    // already stopped and its own failure notice is muted.
                    if (SELF_ENDED_REASONS.has(reason)) void announceStopped(reason);
                    try { onEnded?.(reason); } catch { /* best-effort */ }
                },
            });
        } catch (err) {
            logger?.warn?.('[xchain] locked auto pay could not start', err);
            return false;
        }
        if (!built) return false;
        let attempted = [];
        if (watcher) {
            // No wait on the outgoing cycle: a lock must not hang on a network
            // read. stop() makes that cycle inert (it neither pays nor
            // notifies), and it marks a match attempted before it signs, so
            // the set taken now already covers anything it is paying.
            try { watcher.stop(); } catch { /* best-effort */ }
            try { attempted = watcher.attemptedMatches?.() ?? []; } catch { attempted = []; }
        }
        session = built;
        session.startWatcher({
            reservationLedger, notify, recordAlert, shellKind, instanceId: id,
            loadNotified, saveNotified, logger, intervalMs, attempted,
            ...(coinpayAction && { coinpayAction }),
        });
        watchPanic();
        try { onStarted?.({ status: () => session?.status() ?? { active: false } }); } catch { /* best-effort */ }
        return true;
    }

    return {
        instanceId: id,

        /**
         * Start locked auto pay if anything is armed. Returns true when the
         * session took the vault, so the shell must not close it.
         */
        lock(deps) {
            if (capturing) return capturing;
            capturing = doLock(deps || {}).finally(() => { capturing = null; });
            return capturing;
        },

        /** @param {unknown} vault */
        holdsVault(vault) {
            return Boolean(session && session.holdsVault(vault));
        },

        isActive() {
            return Boolean(session && !session.ended);
        },

        /** Plain data for the Locked screen; never a key, vault or signer. */
        status() {
            return session && !session.ended ? session.status() : { active: false };
        },

        /**
         * End locked auto pay. On 'unlock' the attempted set is kept for
         * takeHandoff(). Resolves once the vault is closed.
         *
         * @param {string} reason
         */
        async end(reason) {
            if (capturing) { try { await capturing; } catch { /* ended below */ } }
            const current = session;
            if (!current) return false;
            const { attempted } = await current.end(reason);
            if (reason === 'unlock') handoff = { attempted };
            return true;
        },

        /** The attempted matches the last unlock carried over, once. */
        takeHandoff() {
            const h = handoff;
            handoff = null;
            return h ? h.attempted : [];
        },
    };
}
