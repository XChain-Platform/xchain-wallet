// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Coins this wallet's own sends are spending, shared by every surface the
// background serves.
//
// The encoder holds a build's inputs for five minutes, so a review left open
// longer than that lets another surface build a different payment over the
// same coins. Whichever is approved second then conflicts with the first on
// the network: a higher fee replaces the first payment while both screens
// report it accepted, and a lower one is refused. The tracker cannot catch it,
// because the second transaction was built before the first went out. So each
// send claims its inputs before signing; a claim lasts HOLD_MS from the claim
// and again from a broadcast, and a send whose inputs another claim holds is
// refused before anything is signed. A send that ends unbroadcast drops its
// claim. With a store the claims outlive a restart of the extension worker.
//
// A send that is signed but waiting in the broadcast queue keeps its coins
// until it goes out, is discarded, or is refused for good. The queue itself is
// the record of those coins (it outlives a browser restart, which session
// storage does not), so the caller passes the queued outpoints to each claim,
// and a queued send that does go out holds its coins from then on.
//
// A claim that went out records its transaction id, so the same signed bytes
// sent again (a pasted copy of a send the wallet made) are not refused over
// their own coins.

import { flows } from '@xchain-wallet/core';
import { parseRawTx } from '@xchain-wallet/core/signers/verifySignedTx.js';

// Long enough to outlast any review built before the other send went out; a
// confirmed spend leaves the tracker anyway, so later builds never see it.
export const OWN_SPEND_HOLD_MS = 30 * 60 * 1000;

const keyOf = (chainId, txid, vout) => `${chainId}|${String(txid).toLowerCase()}:${Number(vout)}`;
const txidKey = (txid) => (typeof txid === 'string' ? txid.trim().toLowerCase() : '');
const nameKeyOf = (chainId, tick) => `${chainId}|name:${String(tick).toUpperCase()}`;

/**
 * The token names an ORDER or DISPENSER hands over (GIVE_OWNERSHIP=1).
 *
 * @param {Record<string, unknown> | null | undefined} params
 * @returns {string[]}
 */
export function soldNames(params) {
    if (!params || Number(params.GIVE_OWNERSHIP || 0) !== 1) return [];
    const tick = typeof params.GIVE_TICK === 'string' ? params.GIVE_TICK.trim() : '';
    return tick ? [tick] : [];
}

/**
 * The outpoints a PSBT spends, read with the chain SDK's own decomposer.
 *
 * @param {any} sdk
 * @param {string} psbtHex
 * @returns {Array<{ txid: string, vout: number }>}
 */
export function psbtOutpoints(sdk, psbtHex) {
    if (typeof psbtHex !== 'string' || !psbtHex || typeof sdk?.wallet?.decomposePsbt !== 'function') return [];
    let inputs;
    // A PSBT the decomposer cannot read fails at signing with its own error; claim nothing here.
    try { ({ inputs } = sdk.wallet.decomposePsbt(psbtHex)); } catch { return []; }
    return (Array.isArray(inputs) ? inputs : [])
        .filter((i) => i && i.prevTxHash && Number.isInteger(Number(i.prevTxIndex)))
        .map((i) => ({ txid: String(i.prevTxHash), vout: Number(i.prevTxIndex) }));
}

/**
 * The outpoints a signed transaction spends. Empty for bytes that do not parse,
 * which then hold nothing here and fail on their own at broadcast.
 *
 * @param {unknown} txHex
 * @returns {Array<{ txid: string, vout: number }>}
 */
export function rawTxOutpoints(txHex) {
    if (typeof txHex !== 'string' || !txHex) return [];
    try {
        return parseRawTx(txHex).inputs.map((i) => ({ txid: i.prevTxHash, vout: i.prevTxIndex }));
    } catch {
        return [];
    }
}

/**
 * @typedef {{ key: string, claim: string, until: number, txid?: string }} OwnSpend
 * @typedef {{ load: () => Promise<OwnSpend[]>, save: (entries: OwnSpend[]) => Promise<void> }} OwnSpendStore
 */

/**
 * @param {{ store?: OwnSpendStore, now?: () => number, holdMs?: number }} [opts]
 */
export function createOwnSpendLedger({ store, now = () => Date.now(), holdMs = OWN_SPEND_HOLD_MS } = {}) {
    /** @type {OwnSpend[]} */
    let held = [];
    let nextClaim = 0;
    // One load shared by every caller, so a claim made while it runs is never overwritten by it.
    const hydrated = store
        ? Promise.resolve().then(() => store.load()).then(
            (loaded) => { held = [...(Array.isArray(loaded) ? loaded : []), ...held]; },
            () => {},
        )
        : Promise.resolve();

    async function persist() {
        if (!store) return;
        try { await store.save(held.slice()); } catch { /* best-effort: the in-memory claims still hold */ }
    }

    return {
        /**
         * Claim a send's inputs before it signs. The check and the claim run
         * with no await between them, so two surfaces approving at once cannot
         * both pass.
         *
         * @param {string} chainId
         * @param {Array<{ txid: string, vout: number }>} outpoints
         * @param {{ queued?: Array<{ txid: string, vout: number }>, txid?: string }} [opts]
         *   `queued`: outpoints of signed transactions waiting in the broadcast
         *   queue; `txid`: the transaction being sent, whose own earlier claims pass
         * @returns {Promise<string>} the claim id, '' when there was nothing to claim
         */
        async claim(chainId, outpoints, { queued = [], txid = '', names = [] } = {}) {
            await hydrated;
            const coins = Array.isArray(outpoints) ? outpoints : [];
            const sold = (Array.isArray(names) ? names : []).filter(Boolean).map((n) => String(n).toUpperCase());
            if (coins.length === 0 && sold.length === 0) return '';
            const at = now();
            held = held.filter((e) => e.until > at);
            const same = txidKey(txid);
            const keys = new Set(held.filter((e) => !same || e.txid !== same).map((e) => e.key));
            // A name another sale from this wallet holds stays in escrow until
            // that sale ends, so the network would refuse this one after its fees.
            const listed = sold.find((n) => keys.has(nameKeyOf(chainId, n)));
            if (listed) {
                const err = new Error(flows.nameSaleInFlightMessage(listed));
                err.name = flows.NAME_SALE_IN_FLIGHT_NAME;
                throw err;
            }
            for (const o of Array.isArray(queued) ? queued : []) keys.add(keyOf(chainId, o.txid, o.vout));
            const spent = coins.filter((o) => keys.has(keyOf(chainId, o.txid, o.vout)));
            if (spent.length > 0) {
                const err = new Error(flows.livenessMessage({ spent }));
                err.name = flows.INPUTS_ALREADY_SPENT_NAME;
                throw err;
            }
            nextClaim += 1;
            const claim = `${at}-${nextClaim}`;
            for (const o of coins) held.push({ key: keyOf(chainId, o.txid, o.vout), claim, until: at + holdMs });
            for (const n of sold) held.push({ key: nameKeyOf(chainId, n), claim, until: at + holdMs });
            await persist();
            return claim;
        },
        /** The send broadcast: hold its inputs for another holdMs, under its txid when known. */
        async keep(claim, txid) {
            if (!claim) return;
            const until = now() + holdMs;
            const sent = txidKey(txid);
            for (const e of held) {
                if (e.claim !== claim) continue;
                e.until = until;
                if (sent) e.txid = sent;
            }
            await persist();
        },
        /** A queued send went out: hold its inputs for another holdMs. */
        async hold(chainId, outpoints, txid) {
            await hydrated;
            if (!Array.isArray(outpoints) || outpoints.length === 0) return;
            const at = now();
            nextClaim += 1;
            const claim = `${at}-${nextClaim}`;
            held = held.filter((e) => e.until > at);
            const sent = txidKey(txid);
            for (const o of outpoints) {
                held.push({ key: keyOf(chainId, o.txid, o.vout), claim, until: at + holdMs, ...(sent ? { txid: sent } : {}) });
            }
            await persist();
        },
        /** The coins that live claims on this chain hold. */
        async heldOutpoints(chainId) {
            await hydrated;
            const at = now();
            const prefix = `${chainId}|`;
            return held
                .filter((e) => e.until > at && e.key.startsWith(prefix))
                .map((e) => {
                    const [txid, vout] = e.key.slice(prefix.length).split(':');
                    return { txid, vout: Number(vout) };
                });
        },
        /** The send ended without a broadcast: free its inputs. */
        async release(claim) {
            if (!claim) return;
            held = held.filter((e) => e.claim !== claim);
            await persist();
        },
    };
}

/**
 * The claims of one signing route. A route can build more than one PSBT (a
 * send or action built at submit time, each leg of a chunked deploy), and each
 * one claims its inputs the moment it exists, before it is signed. Coins the
 * route already holds are not claimed twice, so a later build over them never
 * refuses itself. A transaction that goes out keeps its claim even if a later
 * step of the route fails; the rest are freed unless the route went out.
 *
 * @param {ReturnType<typeof createOwnSpendLedger>} ledger
 * @param {(chainId: string) => Promise<Array<{ txid: string, vout: number }>>} queuedOutpoints
 */
export function createRouteClaims(ledger, queuedOutpoints) {
    /** @type {Array<{ id: string, keys: Set<string>, sent: boolean }>} */
    const claims = [];
    const routeKeys = new Set();
    return {
        /**
         * @param {string} chainId
         * @param {Array<{ txid: string, vout: number }>} outpoints
         */
        async claim(chainId, outpoints) {
            const fresh = (Array.isArray(outpoints) ? outpoints : [])
                .filter((o) => !routeKeys.has(keyOf(chainId, o.txid, o.vout)));
            if (fresh.length === 0) return;
            const id = await ledger.claim(chainId, fresh, { queued: await queuedOutpoints(chainId) });
            if (!id) return;
            const keys = new Set(fresh.map((o) => keyOf(chainId, o.txid, o.vout)));
            for (const key of keys) routeKeys.add(key);
            claims.push({ id, keys, sent: false });
        },
        /**
         * A transaction of the route went out: its claims hold from here.
         *
         * @param {string} chainId
         * @param {Array<{ txid: string, vout: number }>} outpoints
         * @param {string} [txid]
         */
        async sent(chainId, outpoints, txid) {
            const spent = new Set((Array.isArray(outpoints) ? outpoints : []).map((o) => keyOf(chainId, o.txid, o.vout)));
            for (const entry of claims) {
                if (entry.sent || ![...entry.keys].some((key) => spent.has(key))) continue;
                entry.sent = true;
                await ledger.keep(entry.id, txid);
            }
        },
        /** The route ended: keep every claim if it went out, else free the ones nothing sent. */
        async settle(wentOut) {
            for (const entry of claims) {
                if (wentOut) await ledger.keep(entry.id);
                else if (!entry.sent) await ledger.release(entry.id);
            }
        },
    };
}

/**
 * A view of an SDK registry whose encoders report each transaction they build
 * and each one they broadcast, so a route can claim the coins of a PSBT built
 * at submit time before anything signs it. Everything else reads through to
 * the real registry and SDKs.
 *
 * @param {any} registry
 * @param {{
 *   onBuilt: (chainId: string, sdk: any, psbtHex: unknown) => Promise<void>,
 *   onSent: (chainId: string, txHex: string) => Promise<void>,
 * }} hooks
 */
export function claimingSdkRegistry(registry, { onBuilt, onSent }) {
    if (!registry || typeof registry.get !== 'function') return registry;
    /** @type {Map<string, { sdk: any, view: any }>} */
    const views = new Map();
    const passThrough = (target, prop) => {
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
    };
    const viewOf = (chainId, sdk) => {
        const encoder = sdk.encoder;
        if (!encoder || typeof encoder.createTx !== 'function') return sdk;
        const watched = Object.create(encoder);
        watched.createTx = async (params) => {
            const built = await encoder.createTx(params);
            await onBuilt(chainId, sdk, built?.psbt);
            return built;
        };
        if (typeof encoder.broadcastTx === 'function') {
            watched.broadcastTx = async (txHex) => {
                const sent = await encoder.broadcastTx(txHex);
                await onSent(chainId, txHex);
                return sent;
            };
        }
        // A fee estimate builds through createTx as well and spends nothing.
        if (typeof encoder.estimateFee === 'function') {
            watched.estimateFee = (params) => encoder.estimateFee(params);
        }
        return new Proxy(sdk, {
            get: (target, prop) => (prop === 'encoder' ? watched : passThrough(target, prop)),
        });
    };
    return new Proxy(registry, {
        get(target, prop) {
            if (prop !== 'get') return passThrough(target, prop);
            return (chainId) => {
                const sdk = target.get(chainId);
                if (!sdk || typeof sdk !== 'object') return sdk;
                const cached = views.get(chainId);
                if (cached && cached.sdk === sdk) return cached.view;
                const view = viewOf(chainId, sdk);
                views.set(chainId, { sdk, view });
                return view;
            };
        },
    });
}
