// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Automatic donations (§36, operator ruling 2026-11-14): one wallet-wide
// queue kept in fiat (settings.ads).
//
//   Mainnet  - only mainnet counts: a send on a testnet or regtest chain, or
//              made while the wallet's active network is not mainnet, neither
//              adds to the queue nor carries a payout, so test coins never pay
//              a queue that mainnet sends built (isAdsCountedSend).
//   Accrual  - every mainnet transaction the wallet broadcasts, on any chain,
//              adds `perTransaction` to `queued` (commitAdsStep, after broadcast).
//   Payout   - once `queued` reaches `sendAt`, the next mainnet send on ANY
//              chain carries one donation output for the WHOLE queue, converted
//              to that chain's coin at the current price, to the chosen
//              recipient's address for that network (resolveAdsPayout).
//   Reserve  - a send that will carry the payout claims the queue first
//              (reserveAdsPayout: an id and the fiat amount, kept in
//              settings.ads.reserved). A confirm screen claims it when its
//              compose plans the donation (a review claim), so a second review
//              composed meanwhile plans without it; Reject, Back, a closed
//              window or a rebuild without the donation lets it go, and one
//              nobody releases lapses after ADS_RESERVATION_REVIEW_GRACE_MS.
//              Approve hands the review claim to the send's PendingTx id
//              (takeOver). While the claim is held, from review or signing
//              through any wait in a retry or broadcast queue, no other send
//              carries a payout. The claim is settled when its bytes broadcast
//              (commitAdsStep / settleAdsReservation) and released when they
//              are dropped or fail permanently (releaseAdsReservation); a claim
//              whose owner is gone is judged against its PendingTx record
//              (reconcileAdsReservation), so one lost owner never turns
//              donations off for good.
//   Afford   - decided by building, never predicted: the encoder is asked for
//              the transaction WITH the donation, and when it cannot build it
//              (the address cannot cover payment + donation + fees, the extra
//              output's own fee included) the transaction is rebuilt without
//              it (createTxWithAdsFallback, withAdsAtEncode). No price, an
//              output under the chain's dust floor, or no address for the
//              recipient on this network also send without a donation.
//   Settle   - the queue drops by the donated fiat only after the carrying
//              transaction is broadcast (commitAdsStep with the verdict the
//              built bytes carry), never at compose. Never a partial donation,
//              and ADS never blocks or fails a send.

import { ADS_RECIPIENTS, createDefaultAdsSettings } from '../schemas/settings.js';
import { donationAddressForDescriptor, isDonationAddressConfigured } from '../registry/validate.js';
import { nativeDecimalsFor, tickerForDescriptor } from '../registry/coinTicker.js';
import { dustThresholdForCoin, resolveDustThreshold } from '../sdk/nativeFeePreflight.js';
import {
    compareDecimalStrings,
    decimalToBaseUnits,
    subtractDecimalStrings,
    sumDecimalStrings,
} from '../shared/utils/amountFormat.js';
import { getActiveNetwork } from './effectiveNetwork.js';
import { fiatToCoin, getFiatRate, refreshFiatRates } from './priceLookup.js';
import { serializeSettingsWrites } from './settings.js';
import { RESERVATION_TTL_MS } from './reservationLedger.js';

/** Which registry address (descriptor.adsDonationAddresses) each recipient is paid at. */
export const ADS_RECIPIENT_ROLE = Object.freeze({
    protocol: 'DONATE1',
    community: 'DONATE2',
    explorer: 'EXPLORER',
});

// A payout waits this long for a price before the send goes out without one.
export const ADS_PRICE_TIMEOUT_MS = 4000;

// A claim whose send never reached signing (its process ended mid-compose or
// mid-sign) is let go after this long; a hardware prompt can hold a sign open
// for minutes, so the window is generous.
export const ADS_RESERVATION_SIGNING_GRACE_MS = 30 * 60 * 1000;
// A claim with no PendingTx record to judge it by lapses after this long.
export const ADS_RESERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A review claim (a confirm screen open on bytes that carry the donation) whose
// screen never released it, because the window closed or crashed, lapses after
// this long: the same bound the approval reservation ledger puts on a confirm.
export const ADS_RESERVATION_REVIEW_GRACE_MS = RESERVATION_TTL_MS;

const DECIMAL_RE = /^\d+(\.\d+)?$/;
const ADS_BOOKING_KEYS_PER_SCOPE_MAX = 512;

// Claims held by a submit running in this process right now. Such a claim is
// live whatever its record says, so a reconcile never takes it mid-send.
const inFlightReservations = new Set();

/**
 * True when a send counts for automatic donations: the chain is a mainnet one
 * AND the wallet's active network is mainnet. Fails closed on an unknown
 * descriptor.
 *
 * @param {{ settings?: any, descriptor?: { networkKind?: string } | null }} args
 */
export function isAdsCountedSend({ settings, descriptor }) {
    return descriptor?.networkKind === 'mainnet' && getActiveNetwork(settings) === 'mainnet';
}

/**
 * @typedef {Object} AdsReservation
 * @property {string} id                  the claiming send (its PendingTx id when it has one)
 * @property {string} fiat                the queued amount its bytes pay, in `currency`
 * @property {string} currency
 * @property {string} chainId
 * @property {string|null} pendingTxId    the record that tells a later reconcile what became of it
 * @property {number} at                  ms since epoch the claim was taken
 * @property {true} [review]              held by an open confirm screen, not yet by a send
 */

/** @returns {value is AdsReservation} */
export function isAdsReservation(value) {
    return Boolean(value) && typeof value === 'object'
        && typeof value.id === 'string' && value.id.length > 0
        && typeof value.fiat === 'string' && DECIMAL_RE.test(value.fiat)
        && typeof value.currency === 'string' && value.currency.length > 0
        && typeof value.chainId === 'string' && value.chainId.length > 0
        && (value.pendingTxId == null || (typeof value.pendingTxId === 'string' && value.pendingTxId.length > 0))
        && Number.isFinite(value.at) && value.at >= 0
        && (value.review === undefined || value.review === true);
}

/** A fresh id for a claim with no PendingTx record (a review, or a send without one). */
export function newAdsReservationId(prefix = 'ads') {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix}-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

/** The claim currently held on the queue, or null. */
export function adsReservationOf(settings) {
    const held = settings?.ads?.reserved;
    return isAdsReservation(held) ? held : null;
}

/**
 * The record's donation settings, every field present. A missing or partial
 * block (an old fixture, a half-written record) reads as the defaults. A
 * reservation is present only while one is held.
 *
 * @param {any} settings
 * @returns {import('../schemas/settings.js').AdsSettings}
 */
export function adsSettingsOf(settings) {
    const stored = settings?.ads && typeof settings.ads === 'object' ? settings.ads : {};
    const merged = { ...createDefaultAdsSettings(settings?.fiatCurrency || 'USD'), ...stored };
    if (!ADS_RECIPIENTS.includes(merged.recipient)) merged.recipient = 'protocol';
    for (const key of ['perTransaction', 'sendAt', 'queued', 'donated']) {
        if (typeof merged[key] !== 'string' || !DECIMAL_RE.test(merged[key])) {
            merged[key] = createDefaultAdsSettings()[key];
        }
    }
    if ('bookedKeys' in merged) {
        const scopes = merged.bookedKeys;
        const valid = scopes && typeof scopes === 'object' && !Array.isArray(scopes)
            && Object.values(scopes).every((keys) => (
                Array.isArray(keys) && keys.every((key) => typeof key === 'string' && key.length > 0)
            ));
        if (!valid) delete merged.bookedKeys;
    }
    if ('reserved' in merged && !isAdsReservation(merged.reserved)) delete merged.reserved;
    return merged;
}

// Same fields, same values (a held reservation compared by reference, since
// adsSettingsOf passes the stored object through).
function sameAds(stored, next) {
    const keys = new Set([...Object.keys(stored), ...Object.keys(next)]);
    for (const key of keys) if (stored[key] !== next[key]) return false;
    return true;
}

/** True when donations are on (a per-transaction amount above zero). */
export function isAdsOn(settings) {
    return compareDecimalStrings(adsSettingsOf(settings).perTransaction, '0') === 1;
}

/** True when the queue has reached its send-at total and donations are on. */
export function isAdsDue(settings) {
    const ads = adsSettingsOf(settings);
    return isAdsOn(settings) && compareDecimalStrings(ads.queued, ads.sendAt) >= 0;
}

function skip(ads, reason) {
    return {
        canSubmit: false,
        reason,
        donationAmount: 0,
        donationAddress: null,
        donationFiat: null,
        coinAmount: null,
        currency: ads?.currency ?? null,
        recipient: ads?.recipient ?? null,
        ticker: null,
    };
}

/**
 * The current price of the chain's coin in `currency`, or null. Refreshes the
 * shared rate cache first (the background host has no screen keeping it warm),
 * honours the price-data privacy switch for the third-party fallback, waits at
 * most ADS_PRICE_TIMEOUT_MS, and treats a stale observation as no price.
 *
 * @param {{ descriptor: { coin: string }, currency: string, settings?: any, signal?: AbortSignal, timeoutMs?: number }} args
 * @returns {Promise<import('./priceLookup.js').FiatRate | null>}
 */
export async function loadAdsRate({ descriptor, currency, settings, signal, timeoutMs = ADS_PRICE_TIMEOUT_MS }) {
    const chainCoin = descriptor?.coin;
    if (!chainCoin || !currency) return null;
    let timer = null;
    try {
        await Promise.race([
            refreshFiatRates({
                chainCoins: [chainCoin],
                fiatCurrency: currency,
                allowCoingeckoFallback: settings?.privacy?.priceDataEnabled !== false,
                signal,
            }),
            new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
        ]);
    } catch {
        // A failed refresh leaves the cache as it was; the read below decides.
    } finally {
        if (timer) clearTimeout(timer);
    }
    const rate = getFiatRate({ chainCoin, fiatCurrency: currency });
    if (!rate || rate.stale || !(Number(rate.rate) > 0)) return null;
    return rate;
}

/**
 * The donation the NEXT transaction on `chainId` should carry, if any.
 * Network work (a price) happens only when the queue is due.
 *
 * @param {object} args
 * @param {any} args.settings
 * @param {string} args.chainId
 * @param {import('../registry/index.js').ChainRegistry} args.chainRegistry
 * @param {any} [args.sdk]                 the chain's SDK, for its live dust floor
 * @param {AbortSignal} [args.signal]
 * @param {typeof loadAdsRate} [args.rateLoader]   injectable for tests
 * @returns {Promise<AdsPlan>}
 *
 * @typedef {Object} AdsPlan
 * @property {boolean} canSubmit          true when the built transaction should carry the output
 * @property {'ok'|'unknown-chain'|'test-network'|'ads-off'|'below-send-at'|'reserved'|'address-not-configured'|'no-price'|'dust'|'unaffordable'|'prebuilt'} reason
 * @property {number|string} donationAmount   the output value in the chain's smallest unit (0 when none)
 * @property {string|null} donationAddress
 * @property {string|null} donationFiat       the whole queue this output pays, in `currency`
 * @property {string|null} coinAmount         the output value in coin units
 * @property {string|null} currency
 * @property {string|null} recipient
 * @property {string|null} ticker
 */
export async function resolveAdsPayout({ settings, chainId, chainRegistry, sdk = null, signal, rateLoader = loadAdsRate }) {
    const ads = adsSettingsOf(settings);
    const descriptor = chainRegistry?.get?.(chainId);
    if (!descriptor) return skip(ads, 'unknown-chain');
    // Test-network coins never pay the queue mainnet sends built.
    if (!isAdsCountedSend({ settings, descriptor })) return skip(ads, 'test-network');
    if (!isAdsOn(settings)) return skip(ads, 'ads-off');
    if (compareDecimalStrings(ads.queued, ads.sendAt) < 0) return skip(ads, 'below-send-at');
    // Another send already carries the payout and has not settled yet.
    if (ads.reserved) return skip(ads, 'reserved');
    const role = ADS_RECIPIENT_ROLE[ads.recipient];
    if (!isDonationAddressConfigured(descriptor, role)) return skip(ads, 'address-not-configured');

    let rate = null;
    try {
        rate = await rateLoader({ descriptor, currency: ads.currency, settings, signal });
    } catch {
        rate = null;
    }
    if (!rate) return skip(ads, 'no-price');

    const decimals = nativeDecimalsFor(descriptor);
    const coinAmount = fiatToCoin(ads.queued, rate, decimals);
    const units = coinAmount === null ? null : decimalToBaseUnits(coinAmount, decimals);
    if (units === null || units <= 0n) return skip(ads, 'no-price');
    const dust = resolveDustThreshold(sdk) ?? dustThresholdForCoin(descriptor.coin);
    // Null means the floor is unknown; an output that cannot be judged is not sent.
    if (dust === null || units < BigInt(dust)) return skip(ads, 'dust');

    return {
        canSubmit: true,
        reason: 'ok',
        donationAmount: units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : String(units),
        donationAddress: donationAddressForDescriptor(descriptor, role),
        donationFiat: ads.queued,
        coinAmount,
        currency: ads.currency,
        recipient: ads.recipient,
        ticker: tickerForDescriptor(descriptor),
    };
}

/** The same plan, marked as not carried (the send went out without it). */
export function withoutAdsPayout(plan, reason) {
    return { ...plan, canSubmit: false, reason };
}

/** The donation output a plan adds, or null. */
export function adsOutputOf(plan) {
    return plan?.canSubmit && plan.donationAddress
        ? { address: plan.donationAddress, value: plan.donationAmount }
        : null;
}

/**
 * `encoderOpts` with the plan's donation appended to `customOutputs` (a new
 * object; unchanged when the plan carries none).
 */
export function foldAdsOutput(plan, encoderOpts) {
    const output = adsOutputOf(plan);
    if (!output) return encoderOpts;
    return {
        ...encoderOpts,
        customOutputs: [
            ...(Array.isArray(encoderOpts?.customOutputs) ? encoderOpts.customOutputs : []),
            output,
        ],
    };
}

function isAbort(err, signal) {
    return Boolean(signal?.aborted) || err?.name === 'AbortError';
}

/**
 * Build with the donation, and when that build fails for any reason, build the
 * same transaction without it. The second build's error, if any, is the send's
 * own error, so ADS can never be what fails a send.
 *
 * @param {object} args
 * @param {AdsPlan} args.plan
 * @param {object} args.encoderOpts           the options WITHOUT the donation
 * @param {(opts: object) => Promise<any>} args.build
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{ encoded: any, plan: AdsPlan, encoderOpts: object }>}
 */
export async function createTxWithAdsFallback({ plan, encoderOpts, build, signal }) {
    if (!plan?.canSubmit) return { encoded: await build(encoderOpts), plan, encoderOpts };
    const withAds = foldAdsOutput(plan, encoderOpts);
    try {
        return { encoded: await build(withAds), plan, encoderOpts: withAds };
    } catch (err) {
        if (isAbort(err, signal)) throw err;
        return {
            encoded: await build(encoderOpts),
            plan: withoutAdsPayout(plan, 'unaffordable'),
            encoderOpts,
        };
    }
}

/**
 * An SDK registry whose encoder for `chainId` folds the plan's donation into
 * the caller's SHARED `customOutputs` array on the first createTx, after the
 * submit pipeline appended its fee outputs, and takes it back out and rebuilds
 * when that build fails. The array is shared so the two-transaction lane and
 * the built-transaction check read the outputs the encoder really built.
 * `state.included` is the verdict for the accounting.
 *
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @param {AdsPlan} plan
 * @param {string} chainId
 * @returns {{ registry: { get: (id: string) => any }, state: { included: boolean } }}
 */
export function withAdsAtEncode(sdkRegistry, plan, chainId) {
    const state = { included: false };
    let wrappedSdk = null;
    let attempted = false;
    let dropped = false;
    const output = adsOutputOf(plan);
    const registry = {
        get(requestedChainId) {
            const sdk = sdkRegistry.get(requestedChainId);
            if (!output || requestedChainId !== chainId || !sdk?.encoder) return sdk;
            if (wrappedSdk) return wrappedSdk;
            const wrappedEncoder = new Proxy(sdk.encoder, {
                get(encoder, property) {
                    if (property === 'createTx') {
                        // Every build that would carry the donation gets the
                        // same fallback, not only the first, so no later
                        // rebuild can fail on it either.
                        return async (encoderOpts) => {
                            const call = (opts) => Reflect.apply(encoder.createTx, encoder, [opts]);
                            const shared = Array.isArray(encoderOpts?.customOutputs) ? encoderOpts.customOutputs : null;
                            if (!attempted && shared && !shared.includes(output)) shared.push(output);
                            attempted = true;
                            const carrying = shared ? shared.includes(output) : !dropped;
                            if (!carrying) return call(encoderOpts);
                            const withAds = shared
                                ? { ...encoderOpts, customOutputs: shared }
                                : foldAdsOutput(plan, encoderOpts);
                            try {
                                const built = await call(withAds);
                                state.included = true;
                                return built;
                            } catch (err) {
                                if (err?.name === 'AbortError') throw err;
                                if (shared) {
                                    const at = shared.lastIndexOf(output);
                                    if (at >= 0) shared.splice(at, 1);
                                }
                                dropped = true;
                                state.included = false;
                                return call(shared ? { ...encoderOpts, customOutputs: shared } : encoderOpts);
                            }
                        };
                    }
                    const value = Reflect.get(encoder, property, encoder);
                    return typeof value === 'function' ? value.bind(encoder) : value;
                },
            });
            wrappedSdk = new Proxy(sdk, {
                get(target, property) {
                    if (property === 'encoder') return wrappedEncoder;
                    const value = Reflect.get(target, property, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            return wrappedSdk;
        },
    };
    return { registry, state };
}

/**
 * The verdict a set of built bytes carries into the accounting: whether they
 * pay the donation, and the fiat amount and currency it settles.
 *
 * @param {AdsPlan | null | undefined} plan
 * @returns {{ included: boolean, fiat: string | null, currency: string | null }}
 */
export function adsVerdictOf(plan) {
    return plan?.canSubmit
        ? { included: true, fiat: plan.donationFiat ?? null, currency: plan.currency ?? null }
        : { included: false, fiat: null, currency: null };
}

/**
 * The settings after one broadcast. Pure; returns the same object when nothing
 * changes.
 *
 * - Every broadcast adds `perTransaction` (nothing while donations are off).
 * - A broadcast that carried the donation also takes `donatedFiat` off the
 *   queue (never below zero) and adds it to the donated total and count. A
 *   carried donation with no amount (an entry written by an older build) only
 *   accrues, so nothing is subtracted that the bytes may not have paid.
 * - While nothing is queued or donated yet, the queue follows the display
 *   currency; afterwards its currency is fixed, so no amount is relabelled.
 * - `mainnet: false` (a testnet or regtest send) adds nothing and takes
 *   nothing off; only a held claim it names is still settled or cleared.
 * - `reservationId` names the claim these bytes took. When it is the claim
 *   held, the claim's own amount is what is taken off the queue and the claim
 *   is cleared. When it names a claim no longer held, the payout was already
 *   settled (or let go), so nothing is taken off twice. Without one (an older
 *   entry, or bytes whose claim was refused) the carried amount settles as before.
 *
 * @param {any} settings
 * @param {{ donationIncluded?: boolean, donatedFiat?: string | null, currency?: string | null, mainnet?: boolean, reservationId?: string | null, accrue?: boolean }} [verdict]
 */
export function stepAdsQueue(settings, {
    donationIncluded = false, donatedFiat = null, currency = null, mainnet = true, reservationId = null, accrue = true,
} = {}) {
    if (!settings) return settings;
    const ads = adsSettingsOf(settings);
    const counts = accrue && mainnet !== false;
    let { queued, donated, donationCount } = ads;
    let nextCurrency = ads.currency;
    const empty = compareDecimalStrings(queued, '0') === 0 && compareDecimalStrings(donated, '0') === 0;
    if (counts && empty && typeof settings.fiatCurrency === 'string' && settings.fiatCurrency && settings.fiatCurrency !== ads.currency) {
        nextCurrency = settings.fiatCurrency;
    }
    const held = ads.reserved ?? null;
    const settlesHeld = typeof reservationId === 'string' && reservationId !== '' && held?.id === reservationId;
    let paidFiat = null;
    if (settlesHeld) {
        if (donationIncluded && held.currency === ads.currency) paidFiat = held.fiat;
    } else if (!(typeof reservationId === 'string' && reservationId !== '') && mainnet !== false) {
        // Test-network bytes never take anything off the queue.
        const paid = donationIncluded
            && typeof donatedFiat === 'string'
            && DECIMAL_RE.test(donatedFiat)
            && (currency == null || currency === ads.currency);
        if (paid) paidFiat = donatedFiat;
    }
    if (paidFiat !== null) {
        const left = subtractDecimalStrings(queued, paidFiat);
        queued = left !== null && compareDecimalStrings(left, '0') === 1 ? left : '0';
        donated = sumDecimalStrings([donated, paidFiat]);
        donationCount += 1;
    }
    if (counts && isAdsOn(settings)) queued = sumDecimalStrings([queued, ads.perTransaction]);
    const nextAds = { ...ads, queued, donated, donationCount, currency: nextCurrency };
    if (settlesHeld) delete nextAds.reserved;
    const stored = settings.ads && typeof settings.ads === 'object' ? settings.ads : {};
    if (sameAds(stored, nextAds)) return settings;
    return { ...settings, ads: nextAds };
}

/**
 * Vault-aware: advance the queue for one broadcast transaction and persist.
 * Serialized with every other settings write on the vault.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {boolean} [opts.donationIncluded]
 * @param {string | null} [opts.donatedFiat]
 * @param {string | null} [opts.currency]
 * @param {boolean} [opts.mainnet]              false for a testnet or regtest send: nothing accrues
 * @param {string | null} [opts.reservationId]  the claim these bytes took, settled here
 * @param {string | null} [opts.bookingScope]   durable idempotence namespace
 * @param {string | null} [opts.bookingKey]     durable idempotence key within the namespace
 * @returns {Promise<any>}
 */
export async function commitAdsStep({
    vault, donationIncluded = false, donatedFiat = null, currency = null, mainnet = true, reservationId = null,
    bookingScope = null, bookingKey = null,
}) {
    return (await commitAdsStepWithBooking({
        vault, donationIncluded, donatedFiat, currency, mainnet, reservationId, bookingScope, bookingKey,
    })).settings;
}

/**
 * Book one broadcast and report the payout that was actually credited. The
 * booking stamp lets a later confirmed replacement correct a payout it
 * removed without guessing from an address or a current exchange rate.
 *
 * @param {Parameters<typeof commitAdsStep>[0]} opts
 * @returns {Promise<{settings: any, booking: {fiat: string, currency: string} | null}>}
 */
export async function commitAdsStepWithBooking({
    vault, donationIncluded = false, donatedFiat = null, currency = null, mainnet = true, reservationId = null,
    bookingScope = null, bookingKey = null,
}) {
    if (!vault) throw new Error('commitAdsStep: vault is required');
    try {
        return await serializeSettingsWrites(vault, async () => {
            const settings = await vault.settings.get();
            if (!settings) return { settings: null, booking: null };
            const ads = adsSettingsOf(settings);
            const keyed = typeof bookingScope === 'string' && bookingScope
                && typeof bookingKey === 'string' && bookingKey;
            if (keyed && ads.bookedKeys?.[bookingScope]?.includes(bookingKey)) {
                return { settings, booking: null };
            }
            const held = adsReservationOf(settings);
            let paidFiat = null;
            if (donationIncluded && reservationId && held?.id === reservationId && held.currency === ads.currency) {
                paidFiat = held.fiat;
            } else if (donationIncluded && !reservationId && mainnet !== false
                && typeof donatedFiat === 'string' && DECIMAL_RE.test(donatedFiat)
                && (currency == null || currency === ads.currency)) {
                paidFiat = donatedFiat;
            }
            let next = stepAdsQueue(settings, { donationIncluded, donatedFiat, currency, mainnet, reservationId });
            if (keyed) {
                const nextAds = adsSettingsOf(next);
                const bookedKeys = { ...(nextAds.bookedKeys ?? {}) };
                bookedKeys[bookingScope] = [
                    ...(bookedKeys[bookingScope] ?? []), bookingKey,
                ].slice(-ADS_BOOKING_KEYS_PER_SCOPE_MAX);
                next = { ...next, ads: { ...nextAds, bookedKeys } };
            }
            if (next !== settings) await vault.settings.put(next);
            return {
                settings: next,
                booking: paidFiat === null ? null : { fiat: paidFiat, currency: ads.currency },
            };
        });
    } finally {
        if (reservationId) inFlightReservations.delete(reservationId);
    }
}

/** Remove completed idempotence namespaces without disturbing later scopes. */
export async function releaseAdsBookingScopes({ vault, prefix }) {
    if (!adsWritable(vault) || typeof prefix !== 'string' || !prefix) return false;
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        if (!settings) return false;
        const ads = adsSettingsOf(settings);
        const entries = Object.entries(ads.bookedKeys ?? {})
            .filter(([scope]) => !scope.startsWith(prefix));
        if (entries.length === Object.keys(ads.bookedKeys ?? {}).length) return false;
        const nextAds = { ...ads };
        if (entries.length > 0) nextAds.bookedKeys = Object.fromEntries(entries);
        else delete nextAds.bookedKeys;
        await vault.settings.put({ ...settings, ads: nextAds });
        return true;
    });
}

/**
 * Put a payout back on the queue after a confirmed replacement removed its
 * output. Pure and idempotence-neutral: callers must invoke it once per
 * booking, only after the replacement outcome is settled.
 *
 * @param {any} settings
 * @param {{fiat?: string, currency?: string} | null | undefined} booking
 */
export function reverseAdsBooking(settings, booking) {
    if (!settings || typeof booking?.fiat !== 'string' || !DECIMAL_RE.test(booking.fiat)) return settings;
    const ads = adsSettingsOf(settings);
    if (booking.currency !== ads.currency) return settings;
    const donated = subtractDecimalStrings(ads.donated, booking.fiat);
    const nextAds = {
        ...ads,
        queued: sumDecimalStrings([ads.queued, booking.fiat]),
        donated: donated !== null && compareDecimalStrings(donated, '0') === 1 ? donated : '0',
        donationCount: Math.max(0, ads.donationCount - 1),
    };
    return { ...settings, ads: nextAds };
}

/** Reverse one confirmed donation-free replacement under the settings queue. */
export async function reverseAdsBookingInVault({ vault, booking }) {
    if (!adsWritable(vault)) return false;
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        const next = reverseAdsBooking(settings, booking);
        if (next === settings) return false;
        await vault.settings.put(next);
        return true;
    });
}

function adsWritable(vault) {
    return Boolean(vault?.settings && typeof vault.settings.get === 'function' && typeof vault.settings.put === 'function');
}

/**
 * Claim the due queue for one send that will carry the payout, so no other
 * send carries it while this one is pending. A compare-and-set serialized with
 * every settings write: refused (false) while another claim is held, when the
 * queue is no longer due, or when `fiat` is more than is queued (another send
 * already paid it). Re-claiming with the held id is a no-op success.
 *
 * `review` takes a review claim for a confirm screen: it is not held by a send
 * in this process, so a reconcile lets it go once ADS_RESERVATION_REVIEW_GRACE_MS
 * passes without a release. `takeOver` names the review claim the approved
 * bytes were composed under: a send holding that claim (same amount and
 * currency) takes it over under `id`, with its PendingTx id and a fresh time.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.id
 * @param {string} opts.fiat
 * @param {string} opts.currency
 * @param {string} opts.chainId
 * @param {string | null} [opts.pendingTxId]
 * @param {boolean} [opts.review]
 * @param {string | null} [opts.takeOver]
 * @param {number} [opts.now]
 * @returns {Promise<boolean>}
 */
export async function reserveAdsPayout({
    vault, id, fiat, currency, chainId, pendingTxId = null, review = false, takeOver = null, now = Date.now(),
}) {
    if (!adsWritable(vault) || typeof id !== 'string' || !id) return false;
    if (typeof fiat !== 'string' || !DECIMAL_RE.test(fiat) || typeof chainId !== 'string' || !chainId) return false;
    const pendingId = typeof pendingTxId === 'string' && pendingTxId ? pendingTxId : null;
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        if (!settings) return false;
        const ads = adsSettingsOf(settings);
        const held = ads.reserved;
        if (held) {
            const reclaim = held.id === id;
            const adopt = !reclaim && !review && typeof takeOver === 'string' && takeOver !== ''
                && held.id === takeOver && held.fiat === fiat && held.currency === currency;
            if (!reclaim && !adopt) return false;
            // A send taking over its review claim: from here it is judged by
            // the send's PendingTx, like a claim the send took itself.
            if (adopt || (!review && held.review)) {
                const { review: _review, ...kept } = held;
                const reserved = { ...kept, id, pendingTxId: pendingId ?? kept.pendingTxId ?? null, at: now };
                await vault.settings.put({ ...settings, ads: { ...ads, reserved } });
                inFlightReservations.delete(held.id);
            }
            if (!review) inFlightReservations.add(id);
            return true;
        }
        if (!isAdsOn(settings) || compareDecimalStrings(ads.queued, ads.sendAt) < 0) return false;
        if (currency !== ads.currency || compareDecimalStrings(fiat, ads.queued) === 1) return false;
        const reserved = {
            id,
            fiat,
            currency,
            chainId,
            pendingTxId: pendingId,
            at: now,
            ...(review ? { review: true } : {}),
        };
        await vault.settings.put({ ...settings, ads: { ...ads, reserved } });
        if (!review) inFlightReservations.add(id);
        return true;
    });
}

/**
 * Hand a send's claim back to the confirm screen it was approved from: the
 * send stopped before its bytes could go out (a wrong password, a hardware
 * retry, a refusal), and the screen may approve the same bytes again, which
 * still carry the donation. The claim becomes the review claim `reviewId`
 * again, with a fresh time, so Reject releases it and an abandoned screen
 * lapses it. Only the named claim is touched. Resolves true when it was held.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, reservationId: string | null | undefined, reviewId: string | null | undefined, now?: number }} opts
 */
export async function returnAdsReservationToReview({ vault, reservationId, reviewId, now = Date.now() }) {
    if (typeof reservationId !== 'string' || !reservationId || typeof reviewId !== 'string' || !reviewId) return false;
    inFlightReservations.delete(reservationId);
    if (!adsWritable(vault)) return false;
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        const held = adsReservationOf(settings);
        if (!held || held.id !== reservationId) return false;
        const reserved = { ...held, id: reviewId, pendingTxId: null, at: now, review: true };
        await vault.settings.put({ ...settings, ads: { ...adsSettingsOf(settings), reserved } });
        return true;
    });
}

// Clear the held claim named `reservationId`, paying it when `settle` is set.
async function endReservation(vault, reservationId, settle) {
    if (typeof reservationId !== 'string' || !reservationId) return { ended: false, booking: null };
    inFlightReservations.delete(reservationId);
    if (!adsWritable(vault)) return { ended: false, booking: null };
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        const held = adsReservationOf(settings);
        if (!settings || held?.id !== reservationId) return { ended: false, booking: null };
        const next = stepAdsQueue(settings, { donationIncluded: settle, reservationId, accrue: false });
        if (next !== settings) await vault.settings.put(next);
        return {
            ended: true,
            booking: settle ? { fiat: held.fiat, currency: held.currency } : null,
        };
    });
}

/**
 * Let a claim go without paying it: its send was dropped or failed for good,
 * so the queue stays due and the next send may carry it. Only the named claim
 * is cleared. Resolves true when it was held.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, reservationId: string | null | undefined }} opts
 */
export async function releaseAdsReservation({ vault, reservationId }) {
    return (await endReservation(vault, reservationId, false)).ended;
}

/**
 * Settle a claim whose bytes reached the network: its amount comes off the
 * queue and is counted as donated, with no per-transaction accrual (for a
 * broadcast lane that books nothing else). Only the named claim is settled, so
 * a second call is a no-op.
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, reservationId: string | null | undefined }} opts
 */
export async function settleAdsReservation({ vault, reservationId }) {
    return (await endReservation(vault, reservationId, true)).ended;
}

/** Settle a held claim and return the payout credited by that settlement. */
export async function settleAdsReservationWithBooking({ vault, reservationId }) {
    return endReservation(vault, reservationId, true);
}

/** Stop treating a claim as held by a submit running in this process. */
export function forgetInFlightAdsReservation(reservationId) {
    if (reservationId) inFlightReservations.delete(reservationId);
}

const SETTLED_STATUSES = new Set(['broadcast', 'indexed', 'rbf-replaced']);
const PRE_SIGN_STATUSES = new Set(['composing', 'awaiting-signature', 'signed']);

/**
 * Judge a held claim whose owner may be gone (a worker restart mid-send, a
 * queue entry retired without its release) against the PendingTx it names,
 * and settle or release it so one lost owner never turns donations off:
 *
 *   held by a submit in this process         -> kept
 *   review claim, within its grace           -> kept (its confirm screen may be open)
 *   review claim, past the grace             -> released
 *   record queued or broadcasting            -> kept (the queue still owns it)
 *   record broadcast, indexed or replaced    -> settled (its bytes are out)
 *   record failed, or gone                   -> released
 *   record never signed, past the grace      -> released
 *   no record, past ADS_RESERVATION_TTL_MS    -> released
 *
 * A record that cannot be read keeps the claim. Resolves the settings as they
 * stand afterwards (null when there are none).
 *
 * @param {{ vault: import('../storage/Vault.js').Vault, now?: number }} opts
 */
export async function reconcileAdsReservation({ vault, now = Date.now() }) {
    if (!adsWritable(vault)) return null;
    return serializeSettingsWrites(vault, async () => {
        const settings = await vault.settings.get();
        const held = adsReservationOf(settings);
        if (!held || inFlightReservations.has(held.id)) return settings;
        let verdict = 'keep';
        if (held.review) {
            if (now - held.at > ADS_RESERVATION_REVIEW_GRACE_MS) verdict = 'release';
        } else if (held.pendingTxId) {
            if (typeof vault.pendingTxs?.get !== 'function') return settings;
            let record;
            try {
                record = await vault.pendingTxs.get(held.pendingTxId);
            } catch {
                return settings;
            }
            if (!record || record.status === 'failed') verdict = 'release';
            else if (SETTLED_STATUSES.has(record.status)) verdict = 'settle';
            else if (PRE_SIGN_STATUSES.has(record.status) && now - held.at > ADS_RESERVATION_SIGNING_GRACE_MS) verdict = 'release';
        } else if (now - held.at > ADS_RESERVATION_TTL_MS) {
            verdict = 'release';
        }
        if (verdict === 'keep') return settings;
        const next = stepAdsQueue(settings, { donationIncluded: verdict === 'settle', reservationId: held.id, accrue: false });
        if (next !== settings) await vault.settings.put(next);
        return next;
    });
}
